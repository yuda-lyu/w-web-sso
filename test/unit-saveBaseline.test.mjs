//unit-saveBaseline.test.mjs — 後台清單整表存檔之寫入契約(多人同時編輯, 原則 10)
//
// 依據:
//   - 規格 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §3~§8、§13(V1~V14); 上位原則 process_principle.md 第 10 條
//   - 規則帳本 sgud/rule/rulebook_concurrency.md R-CONC-01~05(tokens 採選項 P: app 列嚴格整表比對、session 列逐列寬鬆比對)
// 真實 procCore / procProtect + 真實 w-serv-orm 表鎖與 procOrm + 替身資料表(test/tools/unitEnv.mjs); 管理員之「載入」走 p.getUsersList 等,
// 基準以前端同一工具(src/baselineOf.mjs)自算, 與前端行為一致.
// 命名: SB-U 使用者清單、SB-I IP 清單、SB-T 金鑰清單、SB-S 系統直寫與稽核; 每案註明對應之規格句 / 缺陷編號(E1、X1~X8, 見帳本「現存缺陷實證」).

import assert from 'assert'
import cloneDeep from 'lodash-es/cloneDeep.js'
import { baselineOfUsers, baselineOfIps, baselineOfTokens } from '../src/baselineOf.mjs'
import hashPassword from '../server/hashPassword.mjs'
import procLang from '../server/procLang.mjs'
import { mkEnvSso, mkProtect, mkUser, mkToken, errOf, snapTables, writesAll, holdLocks, track, afterSelectDelete, sleep, PW_INIT, SALT } from './tools/unitEnv.mjs'


//管理員「載入」: 取清單(password / tokenVerify 已剝除)與前端自算之基準
let loadUsers = async (env) => {
    let rows = await env.p.getUsersList()
    rows.sort((a, b) => (a.order || 0) - (b.order || 0))
    return { rows, baseline: baselineOfUsers(rows) }
}
let loadTokens = async (env) => {
    let rows = await env.p.getTokensList()
    return { rows, ...baselineOfTokens(rows) }
}
let loadIps = async (env) => {
    let rows = await env.p.getIpsList()
    return { rows, baseline: baselineOfIps(rows) }
}


//存檔(經權杖檢查包裝, 同 kpfun 之下一層); optClient 為前端第 4 參數, undefined 即不帶基準
let saveUsers = (env, rows, optClient) => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, optClient)
let saveTokens = (env, rows, optClient) => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, optClient)
let saveIps = (env, rows, optClient) => env.p.checkTokenAndUpdateIpsList('tk-admin', rows, {}, optClient)


//rowOf: 取清單列
let rowOf = (rows, id) => rows.find((r) => r.id === id)


//optOf: 金鑰清單載入物件 → 第 4 參數
let optOf = (b) => ({ baseline: b.baseline, baselineSession: b.baselineSession })


//mapRows: 改指定 id 之列
let mapRows = (rows, id, fn) => rows.map((r) => (r.id === id ? fn({ ...r }) : r))


describe('使用者清單存檔 (users; 嚴格整表比對, 先動先贏)', function() {

    it('SB-U01 [V1] A、B 載入同一清單, A 先存; B 以舊基準存 → 整次拒收 saveStale, 零寫入, 庫內等於 A 存後', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        let b = await loadUsers(env)
        await saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline })
        assert.strictEqual(env.users.get('u-a').name, 'A-edit')
        let snap = snapTables(env)
        let w0 = writesAll(env)
        let err = await errOf(saveUsers(env, mapRows(b.rows, 'u-b', (r) => ({ ...r, description: 'B-edit' })), { baseline: b.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.deepStrictEqual(snapTables(env), snap, 'B 零寫入: 庫內與 A 存後逐列相同')
        assert.strictEqual(writesAll(env), w0)
    })

    it('SB-U02 [§6 只寫契約欄位] 基準相符時只寫管理員實際動過之列; 未動之列不寫(不戳記更新者, X2-f); 更新者記操作管理員', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        env.users.log.save.length = 0
        await saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline })
        let ids = env.users.log.save.flat().map((r) => r.id)
        assert.deepStrictEqual(ids, ['u-a'], '只有被改之列進入寫入')
        assert.strictEqual(env.users.get('u-a').userIdUpdate, 'u-admin')
        assert.strictEqual(env.users.get('u-b').userIdUpdate, '', '未動之列不被標為管理員最後修改')
        //寫入列只含契約 fields(+ order): 不含伺服器專有欄位
        let w = env.users.log.save.flat()[0]
        assert.ok(!('password' in w) || w.password === undefined, '不寫 password')
        assert.ok(!('tokenVerify' in w), '不寫 tokenVerify')
    })

    it('SB-U03 [§6 刪除集合 = 基準內 − 送出] 存檔成功後以伺服端重新讀取之列為新基準, 連續存檔皆可成功', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        await saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-1' })), { baseline: a.baseline })
        let a2 = await loadUsers(env) //前端存檔成功後重新取清單作為新基準
        await saveUsers(env, mapRows(a2.rows, 'u-a', (r) => ({ ...r, name: 'A-2' })), { baseline: a2.baseline })
        assert.strictEqual(env.users.get('u-a').name, 'A-2')
        //不得以「自己送出之值」當新基準: 存 a<b 會被 clearXSS 改寫為 a&lt;b → 以送出值當基準下次必被誤拒; 此處以 A-1 之基準(舊)再存, 應被拒
        let err = await errOf(saveUsers(env, mapRows(a2.rows, 'u-b', (r) => ({ ...r, name: 'B-x' })), { baseline: a2.baseline }))
        assert.strictEqual(err, 'saveStale')
    })

    it('SB-U04 [V7、V8、X3] 載入後他人刪除一列、另有一列新增: 舊基準存檔整次拒收, 他人之新增不被刪、被刪之列不復活', async function() {
        let env = mkEnvSso()
        let b = await loadUsers(env)
        //他人(A): 刪除 u-b; 自助註冊新增 newbie(載入後出現之使用者)
        let a = await loadUsers(env)
        await saveUsers(env, a.rows.filter((r) => r.id !== 'u-b'), { baseline: a.baseline })
        await env.p.createUser('eng', { account: 'newbie', name: 'newbie', email: 'newbie@example.com', password: 'Pass@9876', confirmPassword: 'Pass@9876' })
        let err = await errOf(saveUsers(env, mapRows(b.rows, 'u-a', (r) => ({ ...r, name: 'B-edit' })), { baseline: b.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.strictEqual(env.users.get('u-b'), undefined, '被刪之列不復活')
        assert.ok([...env.users.kp.values()].some((u) => u.account === 'newbie'), '載入後新增之使用者不被刪')
        assert.strictEqual(env.users.get('u-a').name, 'auser', 'B 之修改零寫入')
    })

    it('SB-U05 [V4、X2-a] 系統直寫雙方欄位 timeVerified(驗證信)後, 持舊畫面存檔者被拒; 驗證結果不被舊值蓋回', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        await env.p.verifyEmail('tv-1')
        assert.ok(env.users.get('u-v').timeVerified !== '')
        let err = await errOf(saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.ok(env.users.get('u-v').timeVerified !== '', '已驗證狀態維持')
        assert.strictEqual(env.users.get('u-a').name, 'auser')
        //重新載入後可存, 且驗證時間維持
        let a2 = await loadUsers(env)
        await saveUsers(env, mapRows(a2.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a2.baseline })
        assert.strictEqual(env.users.get('u-a').name, 'A-edit')
        assert.ok(env.users.get('u-v').timeVerified !== '')
    })

    it('SB-U06 [V4、X2-b] 自動封鎖(timeBlocked, 並撤銷 token)後, 持舊畫面存檔者被拒; 封鎖不被舊值解除', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await loadUsers(env)
        for (let i = 0; i < 2; i++) {
            await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))
        }
        assert.ok(env.users.get('u-a').timeBlocked !== '', '已被自動封鎖')
        assert.strictEqual(env.users.get('u-a').userIdUpdate, 'system', '自動封鎖記常數 system (D7)')
        let err = await errOf(saveUsers(env, mapRows(a.rows, 'u-b', (r) => ({ ...r, name: 'B-edit' })), { baseline: a.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.ok(env.users.get('u-a').timeBlocked !== '', '封鎖維持')
    })

    it('SB-U07 [V5、X2-c、X2-d] 系統寫入伺服器專有欄位(重寄驗證信之 tokenVerify、變更密碼之 password)後, 管理員可存; 該欄維持系統所寫之值', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        await env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com')
        let tvNew = env.users.get('u-v').tokenVerify
        assert.notStrictEqual(tvNew, 'tv-1')
        await env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678')
        let pwNew = env.users.get('u-a').password
        //isForceChangePw 為 'n' → 'n'(雙方欄位, 值未變, 摘要不變)故不誤擋
        await saveUsers(env, mapRows(a.rows, 'u-b', (r) => ({ ...r, name: 'B-edit' })), { baseline: a.baseline })
        assert.strictEqual(env.users.get('u-b').name, 'B-edit')
        assert.strictEqual(env.users.get('u-v').tokenVerify, tvNew, 'tokenVerify 維持系統所寫')
        assert.strictEqual(env.users.get('u-a').password, pwNew, 'password 維持系統所寫')
    })

    it('SB-U08 [V4、X2-c] 管理員重設密碼(isForceChangePw → y, 雙方欄位)後, 持舊畫面存檔者被拒; 強制變更旗標不被舊值蓋回', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-b')
        assert.strictEqual(env.users.get('u-b').isForceChangePw, 'y')
        let err = await errOf(saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.strictEqual(env.users.get('u-b').isForceChangePw, 'y')
    })

    it('SB-U09 [§4 伺服器專有欄位不採用客戶端值] 客戶端(舊版)送出含 password / tokenVerify / 稽核欄之舊值: 帶或不帶基準皆不寫入, 庫內維持', async function() {
        for (let useBaseline of [true, false]) {
            let env = mkEnvSso()
            let a = await loadUsers(env)
            let before = cloneDeep(env.users.get('u-v'))
            let rows = mapRows(a.rows, 'u-v', (r) => ({ ...r, name: 'V-edit', password: 'HACK', tokenVerify: 'HACK', userId: 'HACK', timeCreate: 'HACK', userIdUpdate: 'HACK', timeUpdate: 'HACK' }))
            await saveUsers(env, rows, useBaseline ? { baseline: a.baseline } : undefined)
            let after = env.users.get('u-v')
            assert.strictEqual(after.name, 'V-edit')
            assert.strictEqual(after.password, before.password, 'password')
            assert.strictEqual(after.tokenVerify, before.tokenVerify, 'tokenVerify')
            assert.strictEqual(after.userId, before.userId, 'userId')
            assert.strictEqual(after.timeCreate, before.timeCreate, 'timeCreate')
            assert.strictEqual(after.userIdUpdate, 'u-admin', 'userIdUpdate 由 procOrm 戳記為操作者, 不採客戶端值')
        }
    })

    it('SB-U10 [V9] 他人重排(名次改變)→ 舊基準被拒; 系統重編號(order 值變而名次同)→ 舊基準可存', async function() {
        //重排被偵測
        let env = mkEnvSso()
        let a = await loadUsers(env)
        let b = await loadUsers(env)
        await saveUsers(env, [...a.rows].reverse().map((r) => ({ ...r })), { baseline: a.baseline }) //A 將列序整個反轉(admin 仍在內)
        assert.strictEqual(env.users.get('u-v').order, 1)
        assert.strictEqual(await errOf(saveUsers(env, mapRows(b.rows, 'u-a', (r) => ({ ...r, name: 'B' })), { baseline: b.baseline })), 'saveStale')
        //重編號(名次不變)不誤擋: order 值改為 10/20/30/40, 名次同
        let env2 = mkEnvSso()
        let c = await loadUsers(env2)
        let k = 10
        for (let r of c.rows) {
            env2.users.kp.set(r.id, { ...env2.users.get(r.id), order: k })
            k += 10
        }
        await saveUsers(env2, mapRows(c.rows, 'u-a', (r) => ({ ...r, name: 'C' })), { baseline: c.baseline })
        assert.strictEqual(env2.users.get('u-a').name, 'C')
    })

    it('SB-U11 [V12] 多列提交其中一列庫內已被他人改: 整次拒收, 其餘列零寫入', async function() {
        let env = mkEnvSso()
        let b = await loadUsers(env)
        env.users.kp.set('u-b', { ...env.users.get('u-b'), name: 'by-other' }) //他人於載入後改 u-b
        let w0 = writesAll(env)
        let rows = mapRows(mapRows(b.rows, 'u-a', (r) => ({ ...r, name: 'B-a' })), 'u-b', (r) => ({ ...r, name: 'B-b' }))
        let err = await errOf(saveUsers(env, rows, { baseline: b.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.strictEqual(env.users.get('u-a').name, 'auser', '其餘列零寫入')
        assert.strictEqual(env.users.get('u-b').name, 'by-other')
        assert.strictEqual(writesAll(env), w0)
    })

    it('SB-U12 [V13] 基準格式或版本不識 → saveBaselineFormat, 零寫入, 不降級為不帶基準', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        let rows = mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' }))
        let snap = snapTables(env)
        let ok = a.baseline
        let bads = [
            ['null 基準', { baseline: null }],
            ['非陣列', { baseline: 'h1:abc' }],
            ['物件', { baseline: { u: 1 } }],
            ['未知版本', { baseline: [['u-a', 'h9:00000000000000']] }],
            ['摘要長度錯', { baseline: [['u-a', 'h1:abc']] }],
            ['重複 id', { baseline: [ok[0], ok[0]] }],
            ['缺 id', { baseline: [['', ok[0][1]]] }],
            ['項非二元', { baseline: [['u-a']] }],
            ['opt 為字串', 'x'],
            ['opt 為 null', null],
            ['opt 為陣列', [ok]],
            ['opt 為空物件(無 baseline 鍵)', {}],
            ['多餘鍵', { baseline: ok, mustExist: false }],
            ['多餘鍵 baselineSession 用於 users', { baseline: ok, baselineSession: ok }],
        ]
        for (let [name, opt] of bads) {
            let err = await errOf(saveUsers(env, rows, opt))
            assert.strictEqual(err, 'saveBaselineFormat', name)
            assert.deepStrictEqual(snapTables(env), snap, `${name}: 零寫入`)
        }
        //格式正確但內容不符(空陣列)→ 比對不符
        assert.strictEqual(await errOf(saveUsers(env, rows, { baseline: [] })), 'saveStale')
    })

    it('SB-U13 [X8、§7 鎖] 自助註冊與管理員清單新增同帳號並行: 恰一方成功, 帳號不重複(createUser 入 users 表鎖並於鎖內驗唯一)', async function() {
        for (let order of ['createUser先', '清單新增先']) {
            let env = mkEnvSso()
            let a = await loadUsers(env)
            let rowNew = { ...mkUser('u-dup', 'dupone', 5), password: 'Zq#8765Wm', _isNew: true }
            let fnCreate = () => env.p.createUser('eng', { account: 'dupone', name: 'dupone', email: 'dupone-self@example.com', password: 'Zq#8765Wm', confirmPassword: 'Zq#8765Wm' })
            let fnSave = () => saveUsers(env, [...a.rows, rowNew], undefined)
            let h = await holdLocks(env, ['users'])
            let first = track(order === 'createUser先' ? fnCreate() : fnSave())
            await sleep(20)
            let second = track(order === 'createUser先' ? fnSave() : fnCreate())
            await sleep(40)
            assert.ok(!first.state.done && !second.state.done, '他人持表鎖時二者皆等待')
            h.release()
            await h.done
            await first.pm
            await second.pm
            let n = [...env.users.kp.values()].filter((u) => u.account === 'dupone').length
            assert.strictEqual(n, 1, `${order}: 帳號 dupone 恰一列`)
            assert.ok(first.state.ok, `${order}: 先到者成功`)
            assert.ok(!second.state.ok, `${order}: 後到者被唯一性檢查擋下`)
        }
    })

    it('SB-U14 [§3 不帶基準] 不帶基準(app 權杖直呼、舊版頁面): 仍取鎖; 後者蓋前者; 刪除集合 = 庫內全部 − 送出; 伺服器專有欄位不採用', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        env.users.kp.set('u-a', { ...env.users.get('u-a'), name: 'by-other' })
        let rows = mapRows(a.rows.filter((r) => r.id !== 'u-b'), 'u-a', (r) => ({ ...r, name: 'last-writer' }))
        await saveUsers(env, rows, undefined)
        assert.strictEqual(env.users.get('u-a').name, 'last-writer', '後者蓋前者')
        assert.strictEqual(env.users.get('u-b'), undefined, '不帶基準: 庫內有而送出沒有者刪除')
        //並行寫入時仍等待表鎖
        let h = await holdLocks(env, ['tokens', 'users'])
        let t = track(saveUsers(env, rows, undefined))
        await sleep(50)
        assert.ok(!t.state.done, '不帶基準亦取表鎖')
        h.release()
        await h.done
        await t.pm
    })

    it('SB-U15 [T3] getUsersList 不回傳 tokenVerify(憑證類欄位收回); updateUsersList 回傳亦不含', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        assert.ok(a.rows.every((r) => !('tokenVerify' in r) && !('password' in r)), '清單列不含 tokenVerify / password')
        assert.strictEqual(env.users.get('u-v').tokenVerify, 'tv-1', '庫內仍有')
        let out = await saveUsers(env, a.rows, { baseline: a.baseline })
        assert.ok(out.every((r) => !('tokenVerify' in r) && !('password' in r)))
    })

    it('SB-U16 [修改只改不增、深度防禦] 管理員存檔讀取後、寫入前列被不經表鎖之寫入者刪除: 拒絕(saveWriteFail)且不新增殘缺列', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        let restore = afterSelectDelete(env.users, 'u-a')
        let err = await errOf(saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), undefined))
        restore()
        assert.strictEqual(err, 'saveWriteFail')
        assert.strictEqual(env.users.get('u-a'), undefined, '已刪之列不復活')
    })

    it('SB-U17 [規格 §6 rowsInvalid] 庫內讀出之列主鍵重複(伺服端資料錯誤, 非客戶端基準問題): 回 anUnexpectedErrorOccurred 並記 error, 零寫入, 不回契約拒收鍵', async function() {
        for (let which of ['users', 'ips']) {
            let env = mkEnvSso()
            let a = which === 'users' ? await loadUsers(env) : await loadIps(env)
            let t = env[which]
            let dup = [...t.kp.values()][0]
            let orig = t.select
            t.select = async (...x) => {
                let r = await orig.apply(t, x)
                return x.length === 0 ? [...r, { ...dup }] : r //整表讀取(guardWrite 之 read)回傳主鍵重複之列
            }
            let w0 = writesAll(env)
            let err = await errOf(which === 'users'
                ? saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline })
                : saveIps(env, mapRows(a.rows, 'ip-1', (r) => ({ ...r, ip: '10.9.9.1' })), { baseline: a.baseline }))
            t.select = orig
            assert.strictEqual(err, 'anUnexpectedErrorOccurred', which)
            assert.strictEqual(writesAll(env), w0, `${which}: 零寫入`)
            assert.strictEqual(env.srLog.logs.error.filter((o) => o.event === 'fun-updateTabItems-rowsInvalid').length, 1, `${which}: 記 error`)
        }
    })

    it('SB-U18 [外審 sol#10、規格 §6 opt 只由伺服端自組] 行程內直接呼叫: 基準內含存取器(getter)或洞者不被執行, 一律 saveBaselineFormat(不拋原始例外、零寫入)', async function() {
        let env = mkEnvSso()
        let a = await loadUsers(env)
        let rows = mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' }))
        let snap = snapTables(env)
        let called = 0
        let evilGetter = {
            get() {
                called++
                throw new Error('getter executed')
            },
        }
        let evilPair = [a.baseline[0][0], a.baseline[0][1]]
        Object.defineProperty(evilPair, 1, evilGetter)
        let evilList = [...a.baseline]
        Object.defineProperty(evilList, 0, evilGetter)
        let holey = [...a.baseline]
        delete holey[1]
        let longPair = [[a.baseline[0][0], a.baseline[0][1], 'extra'], ...a.baseline.slice(1)]
        let bads = [
            ['二元項含 getter', { baseline: [evilPair, ...a.baseline.slice(1)] }],
            ['列表含 getter', { baseline: evilList }],
            ['列表有洞', { baseline: holey }],
            ['二元項過長', { baseline: longPair }],
        ]
        for (let [name, opt] of bads) {
            let err = await errOf(saveUsers(env, rows, opt))
            assert.strictEqual(err, 'saveBaselineFormat', name)
            assert.deepStrictEqual(snapTables(env), snap, `${name}: 零寫入`)
        }
        assert.strictEqual(called, 0, '存取器不被執行')
        //金鑰清單兩份基準同理
        let t = await loadTokens(env)
        let tokRows = mapRows(t.rows, 't-app1', (r) => ({ ...r, perms: ['readIps'] }))
        let evilT = [...t.baselineSession]
        Object.defineProperty(evilT, 0, evilGetter)
        assert.strictEqual(await errOf(saveTokens(env, tokRows, { baseline: t.baseline, baselineSession: evilT })), 'saveBaselineFormat')
        assert.strictEqual(called, 0)
        assert.deepStrictEqual(snapTables(env), snap, '金鑰清單零寫入')
        //正常基準仍可存(複製不改語意)
        await saveUsers(env, rows, { baseline: a.baseline })
        assert.strictEqual(env.users.get('u-a').name, 'A-edit')
    })

})


describe('IP 清單存檔 (ips; 嚴格整表比對)', function() {

    it('SB-I01 [V1] 舊基準存檔被拒, 零寫入', async function() {
        let env = mkEnvSso()
        let a = await loadIps(env)
        let b = await loadIps(env)
        await saveIps(env, mapRows(a.rows, 'ip-1', (r) => ({ ...r, ip: '10.9.9.1' })), { baseline: a.baseline })
        let snap = snapTables(env)
        let err = await errOf(saveIps(env, mapRows(b.rows, 'ip-2', (r) => ({ ...r, ip: '10.9.9.2' })), { baseline: b.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.deepStrictEqual(snapTables(env), snap)
        assert.strictEqual(env.ips.get('ip-1').userIdUpdate, 'u-admin', 'ips 補 userIdUpdate: 後台存檔記操作管理員')
        assert.notStrictEqual(env.ips.get('ip-2').userIdUpdate, 'u-admin', '未動之列不戳記')
    })

    it('SB-I02 [X4、V8] 載入後計時器自動登錄之新 IP: 舊畫面存檔整次拒收, 新 IP 不被刪', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        let a = await loadIps(env)
        await pp.callApiByIp('10.0.0.77')
        await timers[2]() //ipDetectNew
        assert.ok([...env.ips.kp.values()].some((v) => v.ip === '10.0.0.77'))
        assert.strictEqual([...env.ips.kp.values()].find((v) => v.ip === '10.0.0.77').userIdUpdate, 'system', '計時器登錄記常數 system (D7)')
        let err = await errOf(saveIps(env, mapRows(a.rows, 'ip-1', (r) => ({ ...r, ip: '10.9.9.1' })), { baseline: a.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.ok([...env.ips.kp.values()].some((v) => v.ip === '10.0.0.77'), '新 IP 仍在')
        assert.strictEqual(env.ips.get('ip-1').ip, '10.0.0.1')
    })

    it('SB-I03 [V4、X4] 系統封鎖 IP(timeBlocked, 雙方欄位)後, 持舊畫面存檔者被拒; 封鎖不被舊值解除', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        let a = await loadIps(env)
        await pp.callApiByIp('10.0.0.1')
        await pp.callApiByIp('10.0.0.1')
        await timers[3]() //ipCallApi
        assert.ok(env.ips.get('ip-1').timeBlocked !== '')
        assert.strictEqual(env.ips.get('ip-1').userIdUpdate, 'system')
        let err = await errOf(saveIps(env, mapRows(a.rows, 'ip-2', (r) => ({ ...r, ip: '10.9.9.2' })), { baseline: a.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.ok(env.ips.get('ip-1').timeBlocked !== '')
    })

    it('SB-I04 [V7] 載入後他人刪除一列: 舊基準存檔被拒, 被刪之列不復活', async function() {
        let env = mkEnvSso()
        let b = await loadIps(env)
        let a = await loadIps(env)
        await saveIps(env, a.rows.filter((r) => r.id !== 'ip-2'), { baseline: a.baseline })
        let err = await errOf(saveIps(env, mapRows(b.rows, 'ip-1', (r) => ({ ...r, ip: '10.9.9.1' })), { baseline: b.baseline }))
        assert.strictEqual(err, 'saveStale')
        assert.strictEqual(env.ips.get('ip-2'), undefined)
    })

    it('SB-I05 [V13] 基準格式不識 → saveBaselineFormat', async function() {
        let env = mkEnvSso()
        let a = await loadIps(env)
        let snap = snapTables(env)
        for (let opt of [{ baseline: null }, { baseline: [['ip-1', 'h2:00000000000000']] }, {}, 'x']) {
            assert.strictEqual(await errOf(saveIps(env, a.rows, opt)), 'saveBaselineFormat')
        }
        assert.deepStrictEqual(snapTables(env), snap)
    })

})


describe('金鑰清單存檔 (tokens; 選項 P: app 列嚴格整表比對、session 列逐列寬鬆比對)', function() {

    it('SB-T01 [V1] app 列: 舊基準存檔被拒, 零寫入', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let b = await loadTokens(env)
        await saveTokens(env, mapRows(a.rows, 't-app1', (r) => ({ ...r, perms: ['readIps'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        let snap = snapTables(env)
        let err = await errOf(saveTokens(env, mapRows(b.rows, 't-app2', (r) => ({ ...r, perms: ['readStats'] })), { baseline: b.baseline, baselineSession: b.baselineSession }))
        assert.strictEqual(err, 'saveStale')
        assert.deepStrictEqual(snapTables(env), snap)
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readIps'])
        assert.strictEqual(env.tokens.get('t-app1').userIdUpdate, 'u-admin', 'tokens 補 userIdUpdate: 後台存檔記操作管理員(updateTokensList 傳入 operatorId)')
        assert.strictEqual(env.tokens.get('t-app1').userId, 'id-app-1', '擁有者 userId 不被操作者覆寫')
    })

    it('SB-T02 [E1] 載入後才登入之 session token: 管理員存檔(只改 app 權杖權限)後該 token 仍有效, 不被刪', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let r = await env.p.loginByAccountAndPassword('buser', PW_INIT) //載入後才登入
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readIps'])
        await env.p.checkToken(r.token) //仍有效(reject 即失敗)
        assert.ok([...env.tokens.kp.values()].some((t) => t.token === r.token))
    })

    it('SB-T03 [X1 安全: 撤銷不得被繞過] 載入後被登出或被自動封鎖撤銷之 session token: 管理員存舊清單後不復活', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await loadTokens(env)
        await env.p.logoutByToken('tk-a1') //u-a 登出
        for (let i = 0; i < 2; i++) {
            await errOf(pp.loginByAccountAndPassword('buser', 'Wrong@0000')) //u-b 被自動封鎖並撤銷
        }
        assert.ok(env.users.get('u-b').timeBlocked !== '')
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.strictEqual(env.tokens.get('t-b1'), undefined)
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readIps'], '管理員之修改已存')
        assert.strictEqual(env.tokens.get('t-a1'), undefined, '已登出之 token 不復活')
        assert.strictEqual(env.tokens.get('t-b1'), undefined, '已被封鎖撤銷之 token 不復活')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkToken('tk-b1')), 'tokenExpired')
    })

    it('SB-T04 [X7] 載入後被續期之 session token: 管理員存檔後 timeEnd 維持續期後之值(不被舊值蓋回)', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let tNew = await env.p.refreshToken('tk-a1')
        assert.notStrictEqual(tNew, rowOf(a.rows, 't-a1').timeEnd)
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.strictEqual(env.tokens.get('t-a1').timeEnd, tNew, '管理員未動之 session 列不寫')
        assert.strictEqual(env.tokens.get('t-a1').userIdUpdate, 'u-a', 'refreshToken 記 token 擁有者')
    })

    it('SB-T05 [管理員有動且庫內已變者拒收] 改了 session 列、而該列於載入後被續期 → 整次拒收, 零寫入; 庫內未變則可存', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let tEdit = '2031-01-01T00:00:00.000+08:00'
        //庫內未變: 可存
        await saveTokens(env, mapRows(a.rows, 't-a1', (x) => ({ ...x, timeEnd: tEdit })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.strictEqual(env.tokens.get('t-a1').timeEnd, tEdit)
        //庫內已變: 拒收
        let b = await loadTokens(env)
        await env.p.refreshToken('tk-b1')
        let snap = snapTables(env)
        let err = await errOf(saveTokens(env, mapRows(b.rows, 't-b1', (x) => ({ ...x, timeEnd: tEdit })), { baseline: b.baseline, baselineSession: b.baselineSession }))
        assert.strictEqual(err, 'saveStale')
        assert.deepStrictEqual(snapTables(env), snap)
    })

    it('SB-T06 [E2E-003 強制登出] 管理員刪除 session 列 → 該 token 失效(行為不變); 已被登出者之刪除冪等; 已被續期者之刪除拒收', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        await saveTokens(env, a.rows.filter((r) => r.id !== 't-a1'), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired')
        assert.ok(env.tokens.get('t-b1'), '他列不受影響')
        //冪等: 載入後 u-b 自行登出, 管理員同時刪除該列
        let b = await loadTokens(env)
        await env.p.logoutByToken('tk-b1')
        await saveTokens(env, b.rows.filter((r) => r.id !== 't-b1'), { baseline: b.baseline, baselineSession: b.baselineSession })
        assert.strictEqual(env.tokens.get('t-b1'), undefined)
        //庫內已變: 載入後 admin 之 session 被續期, 管理員要刪它 → 拒收
        let c = await loadTokens(env)
        await env.p.refreshToken('tk-admin')
        let err = await errOf(saveTokens(env, c.rows.filter((r) => r.id !== 't-admin'), { baseline: c.baseline, baselineSession: c.baselineSession }))
        assert.strictEqual(err, 'saveStale')
        assert.ok(env.tokens.get('t-admin'))
    })

    it('SB-T07 [ADR-095 升級路徑關閉] 管理員將 session 列勾為應用系統金鑰: 帶或不帶基準皆整次拒收 tokenSessionUpgradeNotAllowed, 零寫入; 應用系統金鑰列反向改回登入權杖亦拒收 tokenAppLocked', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let snap = snapTables(env)
        for (let opt of [{ baseline: a.baseline, baselineSession: a.baselineSession }, undefined]) {
            let err = await errOf(saveTokens(env, mapRows(a.rows, 't-a1', (x) => ({ ...x, isApp: 'y', perms: ['readStats'] })), opt))
            assert.strictEqual(err, 'tokenSessionUpgradeNotAllowed', `基準[${opt !== undefined}]`)
            assert.deepStrictEqual(snapTables(env), snap, '零寫入')
        }
        //反向: 應用系統金鑰改回登入權杖(isApp 'n')亦不可
        for (let opt of [{ baseline: a.baseline, baselineSession: a.baselineSession }, undefined]) {
            let err = await errOf(saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, isApp: 'n' })), opt))
            assert.strictEqual(err, 'tokenAppLocked', `基準[${opt !== undefined}]`)
            assert.deepStrictEqual(snapTables(env), snap, '零寫入')
        }
    })

    it('SB-T07b [ADR-095 身分欄鎖定] 應用系統金鑰列之權杖字串、userId、到期時間不可變更(tokenAppLocked, 零寫入); 用途 appUsage / 名稱 appName 為伺服器專有欄位, 客戶端值不寫入', async function() {
        let env = mkEnvSso()
        env.tokens.kp.set('t-app1', { ...env.tokens.get('t-app1'), appUsage: 'system', appName: 'name-orig', timeEnd: '' })
        let a = await loadTokens(env)
        let snap = snapTables(env)
        for (let [k, v] of [['token', 'tk-changed'], ['userId', 'u-other'], ['timeEnd', '2031-01-01T00:00:00.000+08:00']]) {
            let err = await errOf(saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, [k]: v })), { baseline: a.baseline, baselineSession: a.baselineSession }))
            assert.strictEqual(err, 'tokenAppLocked', k)
            assert.deepStrictEqual(snapTables(env), snap, `${k}: 零寫入`)
        }
        //appUsage / appName: 客戶端送 user / 改名 + 改 perms → perms 寫入, 用途與名稱維持庫內值
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, appUsage: 'user', appName: 'name-hacked', perms: ['readStats'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readStats'])
        assert.strictEqual(env.tokens.get('t-app1').appUsage, 'system')
        assert.strictEqual(env.tokens.get('t-app1').appName, 'name-orig')
    })

    it('SB-T13 [外審 beam#1 核對] 載入後某 session 列被他人變為應用系統金鑰(模擬: 直寫庫): 持舊畫面者要刪除或修改該列 → app 層多出一列, 整次拒收(不靜默略過)', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        env.tokens.kp.set('t-a1', { ...env.tokens.get('t-a1'), isApp: 'y', perms: ['readStats'] }) //他人變更(清單存檔已不可升級, ADR-095, 以直寫庫模擬)
        assert.strictEqual(env.tokens.get('t-a1').isApp, 'y')
        let snap = snapTables(env)
        //持舊畫面者: 刪除該列
        let r1 = await errOf(saveTokens(env, a.rows.filter((x) => x.id !== 't-a1'), { baseline: a.baseline, baselineSession: a.baselineSession }))
        assert.strictEqual(r1, 'saveStale')
        //持舊畫面者: 改該列
        let r2 = await errOf(saveTokens(env, mapRows(a.rows, 't-a1', (x) => ({ ...x, timeEnd: '2031-01-01T00:00:00.000+08:00' })), { baseline: a.baseline, baselineSession: a.baselineSession }))
        assert.strictEqual(r2, 'saveStale')
        assert.deepStrictEqual(snapTables(env), snap, '零寫入')
    })

    it('SB-T14 [外審 sol#5] 管理員未動、已不在庫內之 session 列帶毀損 perms: 不阻擋其他列之合法修改; 將寫入之列仍驗 perms', async function() {
        let env = mkEnvSso()
        env.tokens.kp.set('t-b1', { ...env.tokens.get('t-b1'), perms: 'broken' }) //舊資料毀損值(字串)之 session
        let a = await loadTokens(env)
        await env.p.logoutByToken('tk-b1') //載入後該 session 被登出, 列已不在庫內
        assert.strictEqual(env.tokens.get('t-b1'), undefined)
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), optOf(a))
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readIps'])
        assert.strictEqual(env.tokens.get('t-b1'), undefined, '已登出者不復活')
        //將寫入之列仍須驗: 同一批把 t-app2 改為毀損值 → tokenPermsInvalid, 零寫入
        let b = await loadTokens(env)
        let snap = snapTables(env)
        let err = await errOf(saveTokens(env, mapRows(b.rows, 't-app2', (x) => ({ ...x, perms: 'broken-2' })), optOf(b)))
        assert.strictEqual(err, 'tokenPermsInvalid')
        assert.deepStrictEqual(snapTables(env), snap)
    })

    it('SB-T15 [ADR-069、外審 sol#8 核對] 不帶基準: 應用系統金鑰列 perms 為 null / 缺欄 / 毀損值時整批存回, 依既有規則正規化為空陣列(PERM-A-005); 已是合法值者原樣重送零寫入', async function() {
        let env = mkEnvSso()
        env.tokens.kp.set('t-app2', { ...env.tokens.get('t-app2'), perms: null })
        let { perms, ...app1 } = env.tokens.get('t-app1') //缺 perms 欄
        assert.deepStrictEqual(perms, ['readTokens'])
        env.tokens.kp.set('t-app1', app1)
        let rows = [...env.tokens.kp.values()].map((r) => ({ ...r })) //前端所見之列, 原樣送回
        await saveTokens(env, rows, undefined)
        assert.deepStrictEqual(env.tokens.get('t-app2').perms, [], 'null 正規化為空陣列(既有行為)')
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, [], '缺欄正規化為空陣列(既有行為)')
        //正規化之後, 內容原樣重送(已是合法值)零寫入
        let rows2 = [...env.tokens.kp.values()].map((r) => ({ ...r }))
        let w0 = writesAll(env)
        let snap = snapTables(env)
        await saveTokens(env, rows2, undefined)
        assert.strictEqual(writesAll(env), w0, '合法值原樣重送零寫入')
        assert.deepStrictEqual(snapTables(env), snap)
    })

    it('SB-T08 [V13] baseline 與 baselineSession 須成對且格式合法, 否則 saveBaselineFormat, 零寫入', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let rows = mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] }))
        let snap = snapTables(env)
        let bads = [
            ['只有 baseline', { baseline: a.baseline }],
            ['只有 baselineSession', { baselineSession: a.baselineSession }],
            ['baselineSession 為 null', { baseline: a.baseline, baselineSession: null }],
            ['baselineSession 格式錯', { baseline: a.baseline, baselineSession: [['t-a1', 'h9:x']] }],
            ['baseline 格式錯', { baseline: 'x', baselineSession: a.baselineSession }],
            ['多餘鍵', { baseline: a.baseline, baselineSession: a.baselineSession, mustExist: true }],
        ]
        for (let [name, opt] of bads) {
            assert.strictEqual(await errOf(saveTokens(env, rows, opt)), 'saveBaselineFormat', name)
            assert.deepStrictEqual(snapTables(env), snap, name)
        }
    })

    it('SB-T09 [ADR-095 清單存檔只改不增] 帶或不帶基準新增應用系統金鑰列一律整次拒收 tokenAppAddNotAllowed, 零寫入(鑄造只經 createAppToken); 載入後他人新增同 id 者持舊畫面存檔亦拒收', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let snap = snapTables(env)
        let rowNew = { ...mkToken('t-new', 'tk-new', 'id-app-new', { isApp: 'y', perms: ['readStats'] }) }
        for (let opt of [{ baseline: a.baseline, baselineSession: a.baselineSession }, undefined]) {
            let err = await errOf(saveTokens(env, [...a.rows, rowNew], opt))
            assert.strictEqual(err, 'tokenAppAddNotAllowed', `基準[${opt !== undefined}]`)
            assert.deepStrictEqual(snapTables(env), snap, '零寫入')
        }
        //載入後他人(createAppToken)新增: 持舊畫面者(基準不含該列)送出自己的版本 → app 層基準不符 saveStale
        let b = await loadTokens(env)
        let made = await env.p.createAppToken({ name: 'made', usage: 'system', perms: [] }, { operatorId: 'u-x' })
        let err2 = await errOf(saveTokens(env, b.rows, { baseline: b.baseline, baselineSession: b.baselineSession }))
        assert.strictEqual(err2, 'saveStale')
        assert.ok(env.tokens.get(made.id), '他人新鑄造者不被刪')
    })

    it('SB-T10 [§3 不帶基準、D3] 不帶基準: 只處理應用系統金鑰列; session 列不刪、不覆蓋; 升級已不可(ADR-095, 見 SB-T07)', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let r = await env.p.loginByAccountAndPassword('buser', PW_INIT) //載入後才登入
        await env.p.refreshToken('tk-a1') //session 列載入後被續期
        let tA1 = env.tokens.get('t-a1').timeEnd
        let rows = a.rows.filter((x) => x.id !== 't-app2' && x.id !== 't-b1') //送出不含 app2 與 b1
        rows = mapRows(rows, 't-a1', (x) => ({ ...x, timeEnd: '2031-01-01T00:00:00.000+08:00' })) //舊值覆寫 session 列
        await saveTokens(env, rows, undefined)
        assert.strictEqual(env.tokens.get('t-app2'), undefined, 'app 列未送出 → 刪除')
        assert.ok(env.tokens.get('t-b1'), 'session 列未送出 → 不刪')
        assert.ok([...env.tokens.kp.values()].some((t) => t.token === r.token), '載入後才登入之 session 不被刪 (E1)')
        assert.strictEqual(env.tokens.get('t-a1').timeEnd, tA1, 'session 列不以送入值覆蓋 (X7)')
        assert.strictEqual(env.tokens.get('t-admin').isApp, 'n', '登入 token 維持登入 token')
    })

    it('SB-T11 [V4 → ADR-095] 應用系統金鑰不給期限: refreshToken 一律拒絕 tokenAppNoRefresh, timeEnd 不被改(不再有「app 列因續期而變動」使持舊畫面存檔者被拒之情境)', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let tEnd = env.tokens.get('t-app1').timeEnd
        let err = await errOf(env.p.refreshToken('tk-app1'))
        assert.strictEqual(err, 'tokenAppNoRefresh')
        assert.strictEqual(env.tokens.get('t-app1').timeEnd, tEnd, 'timeEnd 不變')
        await saveTokens(env, mapRows(a.rows, 't-app2', (x) => ({ ...x, perms: ['readIps'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.deepStrictEqual(env.tokens.get('t-app2').perms, ['readIps'], '舊畫面之基準仍相符, 可存')
    })

    it('SB-T12 [§4 perms 驗證於鎖內] 不合法 perms → tokenPermsInvalid; 帶基準時未動之毀損值列不驗; 合法者去重排序儲存', async function() {
        let env = mkEnvSso()
        env.tokens.kp.set('t-app2', { ...env.tokens.get('t-app2'), perms: 'writeUsers' }) //毀損值(字串)
        let a = await loadTokens(env)
        let err = await errOf(saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readToken'] })), { baseline: a.baseline, baselineSession: a.baselineSession }))
        assert.strictEqual(err, 'tokenPermsInvalid')
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readStats', 'readTokens', 'readStats'] })), { baseline: a.baseline, baselineSession: a.baselineSession })
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readTokens', 'readStats'])
        assert.strictEqual(env.tokens.get('t-app2').perms, 'writeUsers', '管理員未動之毀損值列不寫(帶基準)')
    })

    //以下 SB-T16~T19: 清單存檔不得新增庫內不存在之 session 列(isApp !== 'y'; ADR-092). 修改前(只收回、不放寬): 不帶基準送回已被登出 / 封鎖撤銷之 session 列被當新增寫回而復活
    it('SB-T16 [ADR-092 X1 補強: 不帶基準] 已被登出或被自動封鎖撤銷之 session 列被整份送回: 整次拒收 tokenSessionAddNotAllowed, 零寫入, 該 token 仍無效', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await loadTokens(env)
        await env.p.logoutByToken('tk-a1') //u-a 登出
        for (let i = 0; i < 2; i++) {
            await errOf(pp.loginByAccountAndPassword('buser', 'Wrong@0000')) //u-b 被自動封鎖並撤銷
        }
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.strictEqual(env.tokens.get('t-b1'), undefined)
        let snap = snapTables(env)
        let w0 = writesAll(env)
        //app 權杖直呼 / 升級前已開啟之舊頁面: 不帶基準, 整份舊清單(含已撤銷之 session 列)
        let err = await errOf(saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), undefined))
        assert.strictEqual(err, 'tokenSessionAddNotAllowed')
        assert.deepStrictEqual(snapTables(env), snap, '零寫入(含同批合法修改亦不寫)')
        assert.strictEqual(writesAll(env), w0)
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkToken('tk-b1')), 'tokenExpired')
        //原則 3: 拒收鍵有 eng + cht 語系文字(固定文字, 不含送入值)
        let lang = procLang({})
        for (let lg of ['eng', 'cht']) {
            let s = lang[lg].tokenSessionAddNotAllowed
            assert.ok(typeof s === 'string' && s !== '', `${lg} 語系文字`)
            assert.ok(!s.includes('tk-a1') && !s.includes('t-a1'), `${lg} 不回顯值`)
        }
        assert.ok(lang.cht.tokenSessionAddNotAllowed.includes('不可新增登入權杖'))
        //原則 3: 後端錯誤須 log 其錯誤 key
        assert.ok(env.srLog.logs.warn.some((l) => l.key === 'tokenSessionAddNotAllowed'), 'srLog.warn 帶拒收 key')
    })

    it('SB-T17[ADR-092 X1 補強: 帶基準] 基準之外之 session 列(庫內不存在)送入: 整次拒收 tokenSessionAddNotAllowed, 零寫入; 基準內管理員未動而已被撤銷者仍照舊略過(不拒收、不復活)', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        await env.p.logoutByToken('tk-a1')
        let b = await loadTokens(env) //撤銷後才載入: t-a1 不在基準內
        let snap = snapTables(env)
        let rowGone = rowOf(a.rows, 't-a1') //已撤銷之列, 由舊畫面取得
        let err = await errOf(saveTokens(env, [...mapRows(b.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), rowGone], optOf(b)))
        assert.strictEqual(err, 'tokenSessionAddNotAllowed')
        assert.deepStrictEqual(snapTables(env), snap, '零寫入')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired')
        //基準內(載入時尚在)、管理員未動、其後被撤銷者: 略過不拒收(SB-T03 同, 此處以基準含該列驗證守門不誤擋)
        await env.p.logoutByToken('tk-b1')
        await saveTokens(env, mapRows(b.rows, 't-app1', (x) => ({ ...x, perms: ['readIps'] })), optOf(b))
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readIps'])
        assert.strictEqual(env.tokens.get('t-b1'), undefined, '基準內而已撤銷者不復活')
    })

    it('SB-T18 [ADR-092 判準: isApp !== "y"] 庫內不存在之新增列 isApp 為 "n" / "" / 缺欄 / "Y" / "yes" 一律拒收(帶或不帶基準); 同批之合法新增 app 列亦不寫', async function() {
        let env = mkEnvSso()
        let a = await loadTokens(env)
        let snap = snapTables(env)
        let rowApp = mkToken('t-new-app', 'tk-new-app', 'id-app-new', { isApp: 'y', perms: ['readStats'] })
        for (let isApp of ['n', '', undefined, 'Y', 'yes']) {
            let row = mkToken('t-new-sess', 'tk-new-sess', 'u-z', { isApp })
            if (isApp === undefined) {
                delete row.isApp
            }
            for (let opt of [undefined, optOf(a)]) {
                let err = await errOf(saveTokens(env, [...a.rows, rowApp, row], opt))
                assert.strictEqual(err, 'tokenSessionAddNotAllowed', `isApp[${isApp}] 基準[${opt !== undefined}]`)
                assert.deepStrictEqual(snapTables(env), snap, `零寫入 isApp[${isApp}] 基準[${opt !== undefined}]`)
            }
        }
        assert.strictEqual(env.tokens.get('t-new-app'), undefined)
        assert.strictEqual(env.tokens.get('t-new-sess'), undefined)
    })

    it('SB-T19 [ADR-092 不變、ADR-095] 刪除 session 列(帶基準)、既有 session 列原樣送回(不帶基準)、修改應用系統金鑰之權限(帶或不帶基準)照常; 新增與升級已於 SB-T07 / SB-T09 改為拒收', async function() {
        let env = mkEnvSso()
        //不帶基準: 既有 session 列原樣送回 + 修改既有應用系統金鑰之 perms
        let a = await loadTokens(env)
        await saveTokens(env, mapRows(a.rows, 't-app1', (x) => ({ ...x, perms: ['readStats'] })), undefined)
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, ['readStats'])
        assert.ok(env.tokens.get('t-b1'), '原樣送回之既有 session 列不動')
        //帶基準: 刪除 session 列 + 修改既有應用系統金鑰之 perms
        let b = await loadTokens(env)
        let rowsB = mapRows(b.rows.filter((x) => x.id !== 't-b1'), 't-app2', (x) => ({ ...x, perms: ['readIps'] }))
        await saveTokens(env, rowsB, optOf(b))
        assert.deepStrictEqual(env.tokens.get('t-app2').perms, ['readIps'])
        assert.strictEqual(env.tokens.get('t-b1'), undefined, '帶基準刪除 session 列(強制登出)照常')
        assert.ok(env.tokens.get('t-admin'), '他列不受影響')
    })

})


describe('系統直寫: 只改不增、稽核、與表鎖', function() {

    it('SB-S01 [X5-a] refreshToken 讀到 token 後該列被不經表鎖之寫入者刪除: 拒絕, 不新增殘缺列, 不回報續期成功', async function() {
        let env = mkEnvSso()
        let restore = afterSelectDelete(env.tokens, 't-a1')
        let err = await errOf(env.p.refreshToken('tk-a1'))
        restore()
        assert.strictEqual(err, 'can not update timeEnd for token')
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.deepStrictEqual([...env.tokens.kp.values()].filter((t) => !t.token && !t.userId), [], '無殘缺列')
    })

    it('SB-S02 [X5-b] verifyEmail / resendVerifyEmail / changePassword / adminResetPassword 讀到使用者後該列被刪除: 拒絕且不新增殘缺列', async function() {
        //nth: 第幾次回傳含該列之 select 之後刪除(changePassword 於鎖內讀取前, 另讀該使用者 4 次: 鎖外 checkToken、getActorByToken, 鎖內再驗之 checkToken、鎖內重新解析身分之 getActorByToken〔皆為使用者當前狀態判定, S-4〕, 第 5 次才是鎖內之讀取)
        let cases = [
            ['verifyEmail', 'u-v', (env) => env.p.verifyEmail('tv-1'), 'verifyEmailFailed', 1],
            ['resendVerifyEmail', 'u-v', (env) => env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com'), 'userRegistrationResendFailed', 1],
            ['changePassword', 'u-a', (env) => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678'), 'userChangePasswordFail', 5],
            ['adminResetPassword', 'u-b', (env) => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-b'), 'adminResetPasswordFailed', 1],
        ]
        for (let [name, id, fn, key, nth] of cases) {
            let env = mkEnvSso()
            let restore = afterSelectDelete(env.users, id, nth)
            let err = await errOf(fn(env))
            restore()
            assert.strictEqual(err, key, name)
            assert.strictEqual(env.users.get(id), undefined, `${name}: 已刪之列不復活`)
        }
    })

    it('SB-S03 [X5、封鎖] 自動封鎖 / 封鎖 IP 讀到列後該列被刪除: 不新增殘缺列', async function() {
        //帳號封鎖(a): 使用者於封鎖前(鎖外讀取後)已被刪除 → 於表鎖內重讀不到, 無從封鎖: 不新增殘缺列、也不記封鎖失敗
        //(前 2 次登入失敗各讀該列 2 次〔getBlockedByAccount、p.loginByAccountAndPassword〕, 第 5 次為 blockAccount 的 getGenUserByAccount, 其後即刪除)
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let restore = afterSelectDelete(env.users, 'u-a', 5)
        for (let i = 0; i < 2; i++) {
            await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))
        }
        restore()
        assert.strictEqual(env.users.get('u-a'), undefined)
        assert.strictEqual(env.srLog.logs.error.filter((o) => o.event === 'fun-blockAccount').length, 0, '已被刪之使用者無從封鎖, 不當作封鎖失敗')
        //帳號封鎖(b): 於表鎖內重讀之後、寫入之前被不經表鎖之寫入者刪除 → 只改不增(mustExist)拒絕: 不新增殘缺列, 記封鎖失敗
        let envB = mkEnvSso()
        let { pp: ppB } = mkProtect(envB)
        let origB = envB.users.select
        let armedB = true
        envB.users.select = async (...a) => {
            let r = await origB.apply(envB.users, a)
            if (armedB && a.length === 1 && a[0] && typeof a[0].id === 'string' && r.some((x) => x.id === 'u-a')) {
                armedB = false //表鎖內 select({ id }) 之重讀; 其後刪除
                envB.users.kp.delete('u-a')
            }
            return r
        }
        for (let i = 0; i < 2; i++) {
            await errOf(ppB.loginByAccountAndPassword('auser', 'Wrong@0000'))
        }
        envB.users.select = origB
        assert.strictEqual(envB.users.get('u-a'), undefined, '已刪之列不復活(無殘缺列)')
        assert.strictEqual(envB.srLog.logs.error.filter((o) => o.event === 'fun-blockAccount').length, 1, '寫入被只改不增拒絕, 記封鎖失敗')
        //IP 封鎖
        let env2 = mkEnvSso()
        let { pp: pp2, timers } = mkProtect(env2)
        let restore2 = afterSelectDelete(env2.ips, 'ip-1')
        await pp2.callApiByIp('10.0.0.1')
        await pp2.callApiByIp('10.0.0.1')
        await timers[3]()
        restore2()
        assert.strictEqual(env2.ips.get('ip-1'), undefined)
    })

    it('SB-S04 [R-CONC-04] 稽核: 使用者自助流程記該使用者、重設密碼記操作管理員、登入新增 token 記擁有者', async function() {
        let env = mkEnvSso()
        await env.p.verifyEmail('tv-1')
        assert.strictEqual(env.users.get('u-v').userIdUpdate, 'u-v', 'verifyEmail 記該使用者')
        //重寄驗證信: 另一環境(u-v 已驗證後不可重寄), 須確實寫入並記該使用者自己(外審 sol#11: 原案吞掉拒絕而未驗證 S06)
        let envR = mkEnvSso()
        await envR.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com')
        assert.notStrictEqual(envR.users.get('u-v').tokenVerify, 'tv-1', 'resendVerifyEmail 已更新驗證碼')
        assert.strictEqual(envR.users.get('u-v').userIdUpdate, 'u-v', 'resendVerifyEmail 記該使用者')
        await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-b')
        assert.strictEqual(env.users.get('u-b').userIdUpdate, 'u-admin', '重設密碼記操作管理員')
        await env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678')
        assert.strictEqual(env.users.get('u-a').userIdUpdate, 'u-a', '變更密碼記該使用者')
        let r = await env.p.loginByAccountAndPassword('admin1', PW_INIT)
        let t = [...env.tokens.kp.values()].find((x) => x.token === r.token)
        assert.strictEqual(t.userId, 'u-admin')
        assert.strictEqual(t.userIdUpdate, 'u-admin', '登入新增 token 記擁有者')
    })

    it('SB-S05 [S01 登入 vs 停用交錯] 登入驗證密碼後、鑄 token 前使用者被停用 / 刪除 / 封鎖: 不鑄出 token', async function() {
        for (let how of ['停用', '刪除', '封鎖']) {
            let env = mkEnvSso()
            //於 tokens 表鎖被占用時發起登入(驗密碼在鎖外完成, 卡在鑄 token 之表鎖), 此時變更使用者狀態後再放行
            let h = await holdLocks(env, ['tokens'])
            let login = track(env.p.loginByAccountAndPassword('buser', PW_INIT))
            await sleep(50)
            assert.ok(!login.state.done, '鑄 token 須等 tokens 表鎖')
            if (how === '停用') {
                env.users.kp.set('u-b', { ...env.users.get('u-b'), isActive: 'n' })
            }
            else if (how === '刪除') {
                env.users.kp.delete('u-b')
            }
            else {
                env.users.kp.set('u-b', { ...env.users.get('u-b'), timeBlocked: '2099-01-01T00:00:00.000+08:00' })
            }
            let n0 = env.tokens.kp.size
            h.release()
            await h.done
            await login.pm
            assert.strictEqual(login.state.err, 'failedLoginForCatch', how)
            assert.strictEqual(env.tokens.kp.size, n0, `${how}: 未鑄出 token`)
        }
    })

    it('SB-S06 [R-CONC-01 不可重入] 持表鎖之路徑不呼叫會自取表鎖者: users 刪除與停用(同鎖撤銷 token)、封鎖(同鎖撤銷)皆在期限內完成', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await loadUsers(env)
        let rows = a.rows.filter((r) => r.id !== 'u-b').map((r) => (r.id === 'u-a' ? { ...r, isActive: 'n' } : r))
        let t = await Promise.race([saveUsers(env, rows, { baseline: a.baseline }).then(() => 'done'), sleep(3000).then(() => 'deadlock')])
        assert.strictEqual(t, 'done')
        assert.deepStrictEqual([...env.tokens.kp.values()].filter((x) => x.userId === 'u-a' || x.userId === 'u-b'), [], '同鎖撤銷')
        env.users.kp.set('u-v', { ...env.users.get('u-v'), timeVerified: '2026-01-01T00:00:00.000+08:00' })
        let t2 = await Promise.race([Promise.all([1, 2].map(() => pp.loginByAccountAndPassword('vuser', 'Wrong@0000').catch(() => 'x'))).then(() => 'done'), sleep(3000).then(() => 'deadlock')])
        assert.strictEqual(t2, 'done')
    })

    it('SB-S07 [外審 sol#3、S16] 權杖呼叫超限之封鎖於等鎖期間 token 身分已變(升為應用系統金鑰 / 換擁有者 / 已被登出): 鎖內重讀 token 後不封鎖', async function() {
        for (let how of ['升為應用系統金鑰', '換擁有者', '已被登出']) {
            let env = mkEnvSso()
            let { pp, timers } = mkProtect(env)
            await pp.callApiByToken('tk-a1')
            await pp.callApiByToken('tk-a1')
            let h = await holdLocks(env, ['tokens', 'users']) //鎖外判定 token 為使用者 token 與擁有者後, 卡在 [tokens, users] 鎖
            let tm = track(timers[1]())
            await sleep(60)
            assert.ok(!tm.state.done, `${how}: 須等鎖`)
            if (how === '升為應用系統金鑰') {
                env.tokens.kp.set('t-a1', { ...env.tokens.get('t-a1'), isApp: 'y' })
            }
            else if (how === '換擁有者') {
                env.tokens.kp.set('t-a1', { ...env.tokens.get('t-a1'), userId: 'u-b' })
            }
            else {
                env.tokens.kp.delete('t-a1')
            }
            let nTok = env.tokens.kp.size
            h.release()
            await h.done
            await tm.pm
            assert.strictEqual(env.users.get('u-a').timeBlocked, '', `${how}: 原擁有者不被封鎖`)
            assert.strictEqual(env.users.get('u-b').timeBlocked, '', `${how}: 新擁有者亦不被封鎖`)
            assert.strictEqual(env.tokens.kp.size, nTok, `${how}: 不撤銷任何 token`)
        }
    })

    it('SB-S08 [外審 sol#3、S15] 失敗登入達門檻之封鎖於等鎖期間帳號已被改名 / 停用: 該帳號已不屬於這位使用者 → 不封鎖、不撤銷 token', async function() {
        for (let how of ['改名', '停用']) {
            let env = mkEnvSso()
            let { pp } = mkProtect(env)
            await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000')) //第 1 次失敗
            let h = await holdLocks(env, ['tokens', 'users'])
            let lg = track(errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))) //第 2 次失敗達門檻, 卡在 blockAccount 的鎖
            await sleep(60)
            assert.ok(!lg.state.done, `${how}: 須等鎖`)
            if (how === '改名') {
                env.users.kp.set('u-a', { ...env.users.get('u-a'), account: 'auser-renamed' })
            }
            else {
                env.users.kp.set('u-a', { ...env.users.get('u-a'), isActive: 'n' })
            }
            h.release()
            await h.done
            await lg.pm
            assert.strictEqual(env.users.get('u-a').timeBlocked, '', `${how}: 不封鎖`)
            assert.ok(env.tokens.get('t-a1') !== undefined, `${how}: 不撤銷 token`)
        }
    })

    it('SB-S09 [X5、S16] 權杖呼叫超限之封鎖: 於表鎖內重讀使用者之後、寫入之前該列被不經表鎖之寫入者刪除 → 只改不增拒絕: 不新增殘缺列, 記封鎖失敗', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        await pp.callApiByToken('tk-a1')
        await pp.callApiByToken('tk-a1')
        let orig = env.users.select
        let armed = true
        env.users.select = async (...a) => {
            let r = await orig.apply(env.users, a)
            //只攔鎖內 select({ id }) 之重讀(鎖外 getGenUserByUserId 帶 isActive)
            if (armed && a.length === 1 && a[0] && typeof a[0].id === 'string' && !('isActive' in a[0]) && r.some((x) => x.id === 'u-a')) {
                armed = false
                env.users.kp.delete('u-a')
            }
            return r
        }
        await errOf(timers[1]())
        env.users.select = orig
        assert.strictEqual(env.users.get('u-a'), undefined, '已刪之列不復活(無殘缺列)')
        assert.strictEqual(env.srLog.logs.error.filter((o) => o.event === 'fun-blockAccountByToken').length, 1, '寫入被只改不增拒絕, 記封鎖失敗')
    })

    it('SB-S10 [外審 sol#4、S01] 登入於鎖外通過驗證後、鑄 token 前: 密碼被重設 / 驗證被清除 / 帳號已到期 → 不鑄 token, 回與鎖外同序同鍵; 登入回傳值取自鎖內新鮮使用者', async function() {
        let cases = [
            ['密碼被重設', { password: hashPassword('Other@5678', SALT) }, 'failedLoginForCatch'],
            ['驗證被清除', { timeVerified: '' }, 'userRegistrationNotVerified'],
            ['帳號已到期', { timeExpired: '2000-01-01T00:00:00.000+08:00' }, 'loginAccountExpired'],
        ]
        for (let [how, patch, key] of cases) {
            let env = mkEnvSso()
            let h = await holdLocks(env, ['tokens'])
            let login = track(env.p.loginByAccountAndPassword('buser', PW_INIT))
            await sleep(50)
            assert.ok(!login.state.done, `${how}: 鑄 token 須等 tokens 表鎖`)
            env.users.kp.set('u-b', { ...env.users.get('u-b'), ...patch })
            let n0 = env.tokens.kp.size
            h.release()
            await h.done
            await login.pm
            assert.strictEqual(login.state.err, key, how)
            assert.strictEqual(env.tokens.kp.size, n0, `${how}: 未鑄出 token`)
        }
        //等鎖期間強制變更密碼旗標與姓名被改: 回傳值取鎖內新鮮資料(不沿用鎖外舊值)
        let env2 = mkEnvSso()
        let h2 = await holdLocks(env2, ['tokens'])
        let login2 = track(env2.p.loginByAccountAndPassword('buser', PW_INIT))
        await sleep(50)
        env2.users.kp.set('u-b', { ...env2.users.get('u-b'), isForceChangePw: 'y', name: 'Renamed B' })
        h2.release()
        await h2.done
        await login2.pm
        assert.ok(login2.state.ok, String(login2.state.err))
        assert.strictEqual(login2.state.value.isForceChangePw, 'y', '強制變更密碼旗標取新鮮值')
        assert.strictEqual(login2.state.value.name, 'Renamed B')
        assert.ok(login2.state.value.token)
    })

})


describe('並行(V14): 比對與寫入間插不進他人寫入', function() {

    it('SB-C01 [V14、X6] 兩位管理員同時存 IP 清單: 後到者必在先到者完成後才讀取; 結果等於某一串行順序', async function() {
        let env = mkEnvSso()
        let log = []
        let origSelect = env.ips.select
        env.ips.select = async (...a) => {
            let r = await origSelect.apply(env.ips, a)
            log.push(`read(${r.map((x) => x.id).sort().join(',')})`)
            await sleep(60) //人為延遲: 讀取後暫停, 無表鎖時他人之讀 / 寫會插入
            return r
        }
        let origIns = env.ips.insert
        env.ips.insert = async (d) => {
            log.push(`insert(${(Array.isArray(d) ? d : [d]).map((x) => x.id).join(',')})`)
            return origIns.call(env.ips, d)
        }
        let tk2 = 'tk-admin2'
        env.users.kp.set('u-admin2', mkUser('u-admin2', 'admin2', 5, { isAdmin: 'y' }))
        env.tokens.kp.set('t-admin2', mkToken('t-admin2', tk2, 'u-admin2'))
        let base = [{ id: 'ip-1', ip: '10.0.0.1', timeBlocked: '' }, { id: 'ip-2', ip: '10.0.0.2', timeBlocked: '' }]
        let [oa, ob] = await Promise.all([
            env.p.checkTokenAndUpdateIpsList('tk-admin', [...base, { id: 'x', ip: '10.0.0.8', timeBlocked: '' }], {}, undefined).then(() => 'ok').catch((e) => `rej:${e}`),
            env.p.checkTokenAndUpdateIpsList(tk2, [...base, { id: 'y', ip: '10.0.0.9', timeBlocked: '' }], {}, undefined).then(() => 'ok').catch((e) => `rej:${e}`),
        ])
        env.ips.select = origSelect
        assert.strictEqual(oa, 'ok')
        assert.strictEqual(ob, 'ok')
        let ids = [...env.ips.kp.keys()].sort().join(',')
        assert.ok(ids === 'ip-1,ip-2,y' || ids === 'ip-1,ip-2,x', `最終 ${ids} 須為串行結果`)
        let iSecondRead = log.findIndex((e, i) => e.startsWith('read') && i > log.findIndex((x) => x.startsWith('read')))
        let iFirstInsert = log.findIndex((e) => e.startsWith('insert'))
        assert.ok(iFirstInsert >= 0 && iSecondRead > iFirstInsert, `第二次讀取在第一次寫入之後: ${log.join(' → ')}`)
    })

    it('SB-C02 [V14] 管理員存檔讀取後暫停時, 系統直寫雙方欄位(帳號封鎖)等待; 放行後完成', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await loadUsers(env)
        let gate = null
        let pmGate = new Promise((resolve) => {
            gate = resolve
        })
        let entered = null
        let pmEntered = new Promise((resolve) => {
            entered = resolve
        })
        let orig = env.users.select
        let armed = true
        env.users.select = async (...x) => {
            let r = await orig.apply(env.users, x)
            //只在管理員存檔於表鎖內之整表讀取(無條件 select())暫停; 鎖外之操作者查詢(帶條件)不暫停
            if (armed && x.length === 0) {
                armed = false
                entered()
                await pmGate
            }
            return r
        }
        let save = track(saveUsers(env, mapRows(a.rows, 'u-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline }))
        await pmEntered
        //系統直寫: 帳號封鎖(users 鎖)
        let block = track((async () => {
            for (let i = 0; i < 2; i++) {
                await errOf(pp.loginByAccountAndPassword('buser', 'Wrong@0000'))
            }
        })())
        await sleep(80)
        assert.strictEqual(env.users.get('u-b').timeBlocked, '', '管理員存檔持鎖期間封鎖不得先寫')
        assert.ok(!block.state.done)
        gate()
        await save.pm
        await block.pm
        assert.ok(save.state.ok, '管理員存檔先到, 成功')
        assert.ok(env.users.get('u-b').timeBlocked !== '', '放行後封鎖寫入')
        env.users.select = orig
    })

})
