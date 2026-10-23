//api-concurrency.test.mjs — 多人同時編輯之寫入契約(原則 10)之端到端守護: 真後端(11007) + 真資料庫 + 真傳輸(WServHapiClient, JSON), 不經 UI
//
// 依據:
//   - 規格 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §3~§8、§13 V1~V14; 上位原則 process_principle.md 第 10 條
//   - 規則帳本 sgud/rule/rulebook_concurrency.md R-CONC-01~05; 缺陷編號 E1、X1~X8 見該冊「現存缺陷實證」(修前探測腳本 p1~p9 之修後對應)
// 管理員「載入」走 RPC getUsersList / getTokensList / getIpsList, 基準以前端同一工具(src/baselineOf.mjs)自算, 存檔走 RPC updateXxxList 第 4 參數,
// 與前端實際傳輸路徑一致(V10: 前端算之基準 = 伺服端新鮮讀取所算, 含傳輸後之型別).
// 外部應用(app 權杖)直呼、載入後登入 / 登出 / 自助註冊 / 自動封鎖等「他人或系統之寫入」亦走真實入口.
// 並行語意(V14, 人為延遲)與 19 站點逐一取鎖見 unit-tablock; 細緻的存檔分支見 unit-saveBaseline; 本檔驗證接線(kpfun 第 4 參數、真 LMDB、真傳輸).
// 每案例前重置 base seed + 本檔 fixture, 案例後只刪非 base seed(對齊其他 api 檔); SMTP 導向 127.0.0.1:1(寄信必敗而不外寄, 寄信失敗不阻斷既有契約).

import assert from 'assert'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import contracts from '../src/writeContracts/index.mjs'
import { baselineOfUsers, baselineOfTokens, baselineOfIps } from '../src/baselineOf.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'


let SALT = '{salt}' //同 settings.json 之 salt 與 g_initialData
let ADMIN = 'token-for-admin' //base seed 之管理員 session 權杖(使用者 id-for-admin)
let ADMIN_ID = 'id-for-admin'
let TIME_END = '2030-01-01T00:00:00.000+08:00'
let TIME_OK = '2025-01-01T00:00:00.000+08:00'
let PW = 'Pw@Concurrency1'


//mkUserFx: 一般使用者(已驗證)
function mkUserFx(key, ext = {}) {
    let account = `ac-cc-${key}`
    let v = ds.users.funNew({
        order: 900,
        account,
        password: hashPassword(PW, SALT),
        name: `cc ${key}`,
        email: `${account}@test.com`,
        description: '',
        from: 'test',
        redir: '',
        isAdmin: 'n',
        timeVerified: TIME_OK,
        timeExpired: TIME_END,
        timeBlocked: '',
        isActive: 'y',
    })
    v.id = `id-cc-${key}`
    v.timeVerified = TIME_OK
    return { ...v, ...ext }
}


//mkTokenFx: 權杖列(預設 session 列); ext 可覆寫(如 isApp: 'y')
function mkTokenFx(key, userId, ext = {}) {
    let t = ds.tokens.funNew({ userId })
    t.id = `id-cc-${key}`
    t.token = `cc-${key}`
    t.timeEnd = TIME_END
    return { ...t, ...ext }
}


//client: 管理員載入(RPC)與自算基準; 傳輸後之 JSON 即前端所見之列
async function loadUsers() {
    let r = await callFapi('getUsersList', [ADMIN])
    assert.strict.equal(r.ok, true, JSON.stringify(r))
    let rows = r.val.sort((a, b) => (a.order || 0) - (b.order || 0))
    return { rows, baseline: baselineOfUsers(rows) }
}
async function loadTokens() {
    let r = await callFapi('getTokensList', [ADMIN])
    assert.strict.equal(r.ok, true, JSON.stringify(r))
    return { rows: r.val, ...baselineOfTokens(r.val) }
}
async function loadIps() {
    let r = await callFapi('getIpsList', [ADMIN])
    assert.strict.equal(r.ok, true, JSON.stringify(r))
    return { rows: r.val, baseline: baselineOfIps(r.val) }
}
let saveUsers = (rows, opt, token = ADMIN) => callFapi('updateUsersList', opt === undefined ? [token, 'eng', rows] : [token, 'eng', rows, opt])
let saveTokens = (rows, opt, token = ADMIN) => callFapi('updateTokensList', opt === undefined ? [token, 'eng', rows] : [token, 'eng', rows, opt])
let saveIps = (rows, opt, token = ADMIN) => callFapi('updateIpsList', opt === undefined ? [token, 'eng', rows] : [token, 'eng', rows, opt])
let editRow = (rows, id, fn) => rows.map((r) => (r.id === id ? fn({ ...r }) : r))
let optT = (b) => ({ baseline: b.baseline, baselineSession: b.baselineSession })


//snapshot: 三表全部列(依主鍵排序)
async function snapshot() {
    let one = async (t) => (await woItems[t].select()).sort((a, b) => (a.id < b.id ? -1 : 1))
    return { users: await one('users'), tokens: await one('tokens'), ips: await one('ips') }
}


async function insertFixtures() {
    await woItems.users.insert([mkUserFx('a'), mkUserFx('b')])
    await woItems.tokens.insert([
        mkTokenFx('sess-a', 'id-cc-a'),
        mkTokenFx('app-1', 'id-cc-owner-1', { isApp: 'y', perms: ['readTokens'] }),
        mkTokenFx('app-2', 'id-cc-app-2', { isApp: 'y', perms: [] }),
        mkTokenFx('app-w', 'id-cc-app-w', { isApp: 'y', perms: ['writeUsers', 'writeTokens', 'writeIps'] }),
    ])
    await woItems.ips.insert([{ ...ds.ips.funNew({ ip: '192.0.2.31', timeBlocked: '' }), id: 'id-cc-ip-1' }, { ...ds.ips.funNew({ ip: '192.0.2.32', timeBlocked: '' }), id: 'id-cc-ip-2' }])
    //讓 base seed 之名次連續(使用者 order 0、1、2 → 1、2、3 之重編只在第一次存檔發生, 使後續「無變更重送零寫入」案可判)
    let r = await loadUsers()
    let s = await saveUsers(r.rows, undefined)
    assert.strict.equal(s.ok, true, JSON.stringify(s))
}


describe('多人同時編輯之寫入契約 (api, 真後端 / 真傳輸)', function() {
    this.timeout(180000)

    before(async function() {
        await startServersOnce()
        await restartBackend(genTempSettings({}), {
            EM_SRC_HOST: '127.0.0.1',
            EM_SRC_PORT: '1',
            EM_SRC_PW: 'x',
            EM_SRC_EMAIL: 'example@gmail.com',
        })
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json') //還原預設 settings 與環境
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures()
    })

    afterEach(async function() {
        await deleteNonBaseSeed()
    })


    it('CC-A-001 [V1] 使用者清單: A、B 載入同一清單, A 先存; B 以舊基準存 → saveStale, 零寫入(庫內等於 A 存後)', async function() {
        let a = await loadUsers()
        let b = await loadUsers()
        let ra = await saveUsers(editRow(a.rows, 'id-cc-a', (r) => ({ ...r, name: 'A-edit' })), { baseline: a.baseline })
        assert.strict.equal(ra.ok, true, JSON.stringify(ra))
        let snap = await snapshot()
        let rb = await saveUsers(editRow(b.rows, 'id-cc-b', (r) => ({ ...r, description: 'B-edit' })), { baseline: b.baseline })
        assert.strict.equal(rb.ok, false)
        assert.strict.equal(rb.err, 'saveStale')
        assert.deepStrictEqual(await snapshot(), snap, 'B 零寫入')
    })

    it('CC-A-002 [V1] 金鑰清單(app 列): 舊基準存檔 → saveStale, 零寫入', async function() {
        let a = await loadTokens()
        let b = await loadTokens()
        let ra = await saveTokens(editRow(a.rows, 'id-cc-app-1', (r) => ({ ...r, perms: ['readIps'] })), optT(a))
        assert.strict.equal(ra.ok, true, JSON.stringify(ra))
        let snap = await snapshot()
        let rb = await saveTokens(editRow(b.rows, 'id-cc-app-2', (r) => ({ ...r, perms: ['readStats'] })), optT(b))
        assert.strict.equal(rb.ok, false)
        assert.strict.equal(rb.err, 'saveStale')
        assert.deepStrictEqual(await snapshot(), snap)
        let t = (await woItems.tokens.select({ id: 'id-cc-app-1' }))[0]
        assert.strict.equal(t.userIdUpdate, ADMIN_ID, '更新者為操作管理員(updateTokensList 傳入 operatorId)')
        assert.strict.equal(t.userId, 'id-cc-owner-1', '擁有者不被操作者覆寫')
    })

    it('CC-A-003 [V1] IP 清單: 舊基準存檔 → saveStale, 零寫入', async function() {
        let a = await loadIps()
        let b = await loadIps()
        let ra = await saveIps(editRow(a.rows, 'id-cc-ip-1', (r) => ({ ...r, ip: '192.0.2.41' })), { baseline: a.baseline })
        assert.strict.equal(ra.ok, true, JSON.stringify(ra))
        let snap = await snapshot()
        let rb = await saveIps(editRow(b.rows, 'id-cc-ip-2', (r) => ({ ...r, ip: '192.0.2.42' })), { baseline: b.baseline })
        assert.strict.equal(rb.err, 'saveStale')
        assert.deepStrictEqual(await snapshot(), snap)
        assert.strict.equal((await woItems.ips.select({ id: 'id-cc-ip-1' }))[0].userIdUpdate, ADMIN_ID, 'ips 補 userIdUpdate')
    })

    it('CC-A-004 [V2 適配] 不帶基準之無變更重送: 零寫入(稽核欄與時間不變); 管理員先前載入之基準仍可存', async function() {
        let a = await loadUsers()
        let snap = await snapshot()
        let r = await saveUsers(a.rows, undefined) //app 權杖 / 舊版頁面型: 不帶基準, 內容未變
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.deepStrictEqual(await snapshot(), snap, '摘要與稽核欄皆不變(零寫入)')
        let r2 = await saveUsers(editRow(a.rows, 'id-cc-a', (x) => ({ ...x, name: 'A-after-resend' })), { baseline: a.baseline })
        assert.strict.equal(r2.ok, true, `先前基準仍有效: ${JSON.stringify(r2)}`)
    })

    it('CC-A-005 [V3] app 權杖(writeUsers)改一列後, 管理員以舊基準存 → saveStale', async function() {
        let a = await loadUsers()
        let cur = await loadUsers()
        let rApp = await saveUsers(editRow(cur.rows, 'id-cc-b', (r) => ({ ...r, name: 'by-app' })), undefined, 'cc-app-w') //不帶基準
        assert.strict.equal(rApp.ok, true, JSON.stringify(rApp))
        assert.strict.equal((await woItems.users.select({ id: 'id-cc-b' }))[0].userIdUpdate, 'id-cc-app-w', '更新者為 app 權杖之虛擬使用者')
        let r = await saveUsers(editRow(a.rows, 'id-cc-a', (x) => ({ ...x, name: 'A-edit' })), { baseline: a.baseline })
        assert.strict.equal(r.err, 'saveStale')
    })

    it('CC-A-006 [V4] 系統直寫雙方欄位: 真實自動封鎖(連續登入失敗)後 users 舊基準被拒; app 權杖 refreshToken 延長 timeEnd 後 tokens 舊基準被拒', async function() {
        let u = await loadUsers()
        for (let i = 0; i < 5; i++) {
            await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-a', 'Wrong@0000'])
        }
        let ua = (await woItems.users.select({ id: 'id-cc-a' }))[0]
        assert.ok(ua.timeBlocked !== '', '已被自動封鎖')
        assert.strict.equal(ua.userIdUpdate, 'system')
        assert.deepStrictEqual(await woItems.tokens.select({ userId: 'id-cc-a' }), [], '同鎖撤銷其 token')
        let r = await saveUsers(editRow(u.rows, 'id-cc-b', (x) => ({ ...x, name: 'B-edit' })), { baseline: u.baseline })
        assert.strict.equal(r.err, 'saveStale')
        assert.ok((await woItems.users.select({ id: 'id-cc-a' }))[0].timeBlocked !== '', '封鎖不被舊值解除')

        let t = await loadTokens()
        let rf = await callFapi('refreshToken', ['cc-app-1'])
        assert.strict.equal(rf.ok, true, JSON.stringify(rf))
        let r2 = await saveTokens(editRow(t.rows, 'id-cc-app-2', (x) => ({ ...x, perms: ['readIps'] })), optT(t))
        assert.strict.equal(r2.err, 'saveStale')
    })

    it('CC-A-007 [V5、X2-c、X2-d] 系統寫伺服器專有欄位(重寄驗證信之 tokenVerify、變更密碼之 password)後, 管理員可存; 該欄維持系統所寫之值', async function() {
        let pending = mkUserFx('pend', { timeVerified: '', tokenVerify: 'cc-tv-pend' })
        await woItems.users.insert([pending])
        let u = await loadUsers()
        //SMTP 導向必敗: 重寄之信寄不出而回 userRegistrationResendFailed(既有契約), 新 tokenVerify 已寫入
        let rr = await callFapi('resendVerifyEmail', ['eng', pending.account, pending.email])
        assert.strict.equal(rr.err, 'userRegistrationResendFailed', JSON.stringify(rr))
        let tvNew = (await woItems.users.select({ id: pending.id }))[0].tokenVerify
        assert.notStrictEqual(tvNew, 'cc-tv-pend')
        let lg = await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-a', PW])
        assert.strict.equal(lg.ok, true, JSON.stringify(lg))
        let rc = await callFapi('changeUserPassword', [lg.val.token, 'eng', PW, 'Zq#8765Wm'])
        assert.strict.equal(rc.ok, true, JSON.stringify(rc))
        let pwNew = (await woItems.users.select({ id: 'id-cc-a' }))[0].password
        let r = await saveUsers(editRow(u.rows, 'id-cc-b', (x) => ({ ...x, name: 'B-edit' })), { baseline: u.baseline })
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.strict.equal((await woItems.users.select({ id: pending.id }))[0].tokenVerify, tvNew)
        assert.strict.equal((await woItems.users.select({ id: 'id-cc-a' }))[0].password, pwNew)
    })

    it('CC-A-008 [V6、X5] 系統直寫對已刪之列: verifyEmail / refreshToken 拒絕且庫內無殘缺列; 其後管理員原樣存回清單可成功', async function() {
        let pending = mkUserFx('gone', { timeVerified: '', tokenVerify: 'cc-tv-gone' })
        await woItems.users.insert([pending])
        await woItems.users.del({ id: pending.id })
        let rv = await callFapi('verifyEmail', ['cc-tv-gone'])
        assert.strict.equal(rv.ok, false)
        assert.strict.equal(rv.err, 'verifyEmailInvalidToken')
        let tk = mkTokenFx('gone', 'id-cc-a')
        await woItems.tokens.insert([tk])
        await woItems.tokens.del({ id: tk.id })
        let rf = await callFapi('refreshToken', [tk.token])
        assert.strict.equal(rf.ok, false)
        assert.strict.equal(rf.err, 'invalid token')
        let us = await woItems.users.select()
        assert.deepStrictEqual(us.filter((x) => x.id === pending.id), [], '無殘缺 users 列')
        let ts = await woItems.tokens.select()
        assert.deepStrictEqual(ts.filter((x) => !x.token || !x.userId), [], '無殘缺 tokens 列')
        let a = await loadUsers()
        let r = await saveUsers(a.rows, { baseline: a.baseline })
        assert.strict.equal(r.ok, true, `原樣存回: ${JSON.stringify(r)}`)
    })

    it('CC-A-009 [V7] 重複登出 → invalid token(既有鍵); 帶基準而 app 列已被他人刪除 → saveStale', async function() {
        let r1 = await callFapi('logoutByToken', ['cc-sess-a'])
        assert.strict.equal(r1.ok, true, JSON.stringify(r1))
        let r2 = await callFapi('logoutByToken', ['cc-sess-a'])
        assert.strict.equal(r2.ok, false)
        assert.strict.equal(r2.err, 'invalid token')
        let a = await loadTokens()
        let b = await loadTokens()
        await saveTokens(a.rows.filter((r) => r.id !== 'id-cc-app-2'), optT(a)) //A 刪除 app-2
        let rb = await saveTokens(editRow(b.rows, 'id-cc-app-2', (x) => ({ ...x, perms: ['readIps'] })), optT(b))
        assert.strict.equal(rb.err, 'saveStale')
        assert.deepStrictEqual(await woItems.tokens.select({ id: 'id-cc-app-2' }), [], '被刪之列不復活')
    })

    it('CC-A-010 [E1、V8] 載入後才登入之 session token: 管理員存檔(只改 app 權杖權限)後仍有效, 不被刪', async function() {
        let a = await loadTokens()
        let lg = await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-b', PW])
        assert.strict.equal(lg.ok, true, JSON.stringify(lg))
        let r = await saveTokens(editRow(a.rows, 'id-cc-app-1', (x) => ({ ...x, perms: ['readIps'] })), optT(a))
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let chk = await callFapi('checkToken', [lg.val.token])
        assert.strict.equal(chk.ok, true, `載入後登入之 token 仍有效: ${JSON.stringify(chk)}`)
        assert.deepStrictEqual((await woItems.tokens.select({ id: 'id-cc-app-1' }))[0].perms, ['readIps'])
    })

    it('CC-A-011 [X1 安全] 載入後被登出 / 被自動封鎖撤銷之 session token: 管理員存舊清單後不復活', async function() {
        let lgB = await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-b', PW])
        assert.strict.equal(lgB.ok, true)
        let b = await loadTokens() //含 u-b 之 session
        await callFapi('logoutByToken', ['cc-sess-a']) //u-a 登出
        for (let i = 0; i < 5; i++) {
            await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-b', 'Wrong@0000']) //u-b 被自動封鎖並撤銷
        }
        assert.ok((await woItems.users.select({ id: 'id-cc-b' }))[0].timeBlocked !== '')
        let r = await saveTokens(editRow(b.rows, 'id-cc-app-1', (x) => ({ ...x, perms: ['readIps'] })), optT(b))
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.deepStrictEqual(await woItems.tokens.select({ token: 'cc-sess-a' }), [], '已登出之 token 不復活')
        assert.deepStrictEqual(await woItems.tokens.select({ userId: 'id-cc-b' }), [], '已被封鎖撤銷之 token 不復活')
        for (let tk of ['cc-sess-a', lgB.val.token]) {
            let chk = await callFapi('checkToken', [tk])
            assert.strict.equal(chk.ok, false, `${tk} 應維持失效`)
        }
    })

    it('CC-A-012 [X3、V8] 載入後新增之使用者(自助註冊): 舊基準存檔整次拒收, 新使用者不被刪', async function() {
        let a = await loadUsers()
        let rc = await callFapi('createUser', ['eng', 'ac-cc-newbie', 'Zq#8765Wm', 'Zq#8765Wm', 'newbie', 'cc-newbie@test.com'])
        assert.strict.equal(rc.ok, true, JSON.stringify(rc))
        let r = await saveUsers(editRow(a.rows, 'id-cc-a', (x) => ({ ...x, name: 'A-edit' })), { baseline: a.baseline })
        assert.strict.equal(r.err, 'saveStale')
        assert.strict.equal((await woItems.users.select({ account: 'ac-cc-newbie' })).length, 1)
        assert.strict.equal((await woItems.users.select({ id: 'id-cc-a' }))[0].name, 'cc a', '舊畫面之修改零寫入')
    })

    it('CC-A-013 [X4、V8] 載入後新增之 IP 與被改之封鎖狀態: 舊基準存檔整次拒收, 新 IP 不被刪', async function() {
        let a = await loadIps()
        await woItems.ips.insert([{ ...ds.ips.funNew({ ip: '192.0.2.99', timeBlocked: '' }), id: 'id-cc-ip-new' }]) //計時器登錄新 IP 之等價寫入
        let r = await saveIps(editRow(a.rows, 'id-cc-ip-1', (x) => ({ ...x, ip: '192.0.2.41' })), { baseline: a.baseline })
        assert.strict.equal(r.err, 'saveStale')
        assert.strict.equal((await woItems.ips.select({ id: 'id-cc-ip-new' })).length, 1)
        assert.strict.equal((await woItems.ips.select({ id: 'id-cc-ip-1' }))[0].ip, '192.0.2.31')
    })

    it('CC-A-014 [V9] 使用者清單: 他人重排(名次改變)→ 舊基準被拒; 系統重編號(order 值變而名次同)→ 舊基準可存', async function() {
        let a = await loadUsers()
        let b = await loadUsers()
        let ra = await saveUsers([...a.rows].reverse(), { baseline: a.baseline })
        assert.strict.equal(ra.ok, true, JSON.stringify(ra))
        let r = await saveUsers(editRow(b.rows, 'id-cc-a', (x) => ({ ...x, name: 'B-edit' })), { baseline: b.baseline })
        assert.strict.equal(r.err, 'saveStale')
        //重編號: 直接把 order 值改為 x10, 名次同
        let c = await loadUsers()
        for (let u of c.rows) {
            await woItems.users.save({ id: u.id, order: u.order * 10 })
        }
        let rc = await saveUsers(editRow(c.rows, 'id-cc-a', (x) => ({ ...x, name: 'C-edit' })), { baseline: c.baseline })
        assert.strict.equal(rc.ok, true, JSON.stringify(rc))
    })

    it('CC-A-015 [V10] 前端經 RPC 傳輸後所算之基準 = 伺服端新鮮讀取所算(含缺欄 / null / 陣列 perms / 缺 timeBlocked)', async function() {
        //舊版資料: 缺欄之使用者、perms 為 null 與缺欄之金鑰、缺 timeBlocked 之 IP
        //order 取與重編後名次相同之值(base seed 3 + fixture 2 + legacy = 6 列, legacy 排最後), 使其不因 order 重編而被改寫
        await woItems.users.insert([{ id: 'id-cc-legacy', order: 6, account: 'ac-cc-legacy', password: hashPassword(PW, SALT), email: 'cc-legacy@test.com', isAdmin: 'n', isActive: 'y', timeVerified: TIME_OK, from: null }])
        let t1 = mkTokenFx('legacy-1', 'id-cc-a', { isApp: 'y' })
        delete t1.perms
        await woItems.tokens.insert([t1, mkTokenFx('legacy-2', 'id-cc-a', { isApp: 'y', perms: null })])
        await woItems.ips.insert([{ id: 'id-cc-ip-legacy', ip: '192.0.2.77' }])
        let u = await loadUsers()
        assert.deepStrictEqual(u.baseline, buildBaseline(await woItems.users.select(), contracts.users), 'users')
        let t = await loadTokens()
        assert.deepStrictEqual(t.baseline, buildBaseline(await woItems.tokens.select(), contracts.tokens), 'tokens app')
        assert.deepStrictEqual(t.baselineSession, buildBaseline(await woItems.tokens.select(), contracts.tokensSession), 'tokens session')
        let i = await loadIps()
        assert.deepStrictEqual(i.baseline, buildBaseline(await woItems.ips.select(), contracts.ips), 'ips')
        //未動之缺欄列不被重寫(不戳記更新者)
        let r = await saveUsers(editRow(u.rows, 'id-cc-a', (x) => ({ ...x, name: 'A-edit' })), { baseline: u.baseline })
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.strict.equal((await woItems.users.select({ id: 'id-cc-legacy' }))[0].userIdUpdate, undefined, '未動之舊版列不被重寫')
    })

    it('CC-A-016 [V12] 多列提交其中一列庫內已被他人改: 整次拒收, 其餘列零寫入', async function() {
        let b = await loadUsers()
        await woItems.users.save({ id: 'id-cc-b', name: 'by-other' })
        let snap = await snapshot()
        let rows = editRow(editRow(b.rows, 'id-cc-a', (x) => ({ ...x, name: 'B-a' })), 'id-cc-b', (x) => ({ ...x, name: 'B-b' }))
        let r = await saveUsers(rows, { baseline: b.baseline })
        assert.strict.equal(r.err, 'saveStale')
        assert.deepStrictEqual(await snapshot(), snap)
    })

    it('CC-A-017 [V13、規格 §6] 基準格式或版本不識 / 多餘鍵(opt 只由伺服端自組, 不展開客戶端物件) → saveBaselineFormat, 零寫入, 不降級', async function() {
        let u = await loadUsers()
        let t = await loadTokens()
        let i = await loadIps()
        let snap = await snapshot()
        let cases = [
            [() => saveUsers(u.rows, { baseline: null }), 'null'],
            [() => saveUsers(u.rows, { baseline: [['id-cc-a', 'h9:00000000000000']] }), '未知版本'],
            [() => saveUsers(u.rows, { baseline: 'x' }), '字串'],
            [() => saveUsers(u.rows, {}), '空物件'],
            [() => saveUsers(u.rows, 'x'), 'opt 字串'],
            [() => saveUsers(u.rows, { baseline: u.baseline, keepUserId: true, mustExist: false }), '多餘鍵 keepUserId / mustExist'],
            [() => saveTokens(t.rows, { baseline: t.baseline }), 'tokens 缺 baselineSession'],
            [() => saveTokens(t.rows, { baseline: t.baseline, baselineSession: null }), 'tokens baselineSession null'],
            [() => saveIps(i.rows, { baseline: [['id-cc-ip-1']] }), 'ips 項非二元'],
        ]
        for (let [fn, name] of cases) {
            let r = await fn()
            assert.strict.equal(r.ok, false, name)
            assert.strict.equal(r.err, 'saveBaselineFormat', name)
        }
        assert.deepStrictEqual(await snapshot(), snap, '零寫入')
    })

    it('CC-A-018 [X2、T3、§4] 後台清單不含 tokenVerify / password; 客戶端(舊版)回寫伺服器專有欄位之舊值不被採用(帶或不帶基準)', async function() {
        let pending = mkUserFx('pw', { timeVerified: '', tokenVerify: 'cc-tv-pw' })
        await woItems.users.insert([pending])
        let u = await loadUsers()
        assert.ok(u.rows.every((r) => !('tokenVerify' in r) && !('password' in r)))
        let before = (await woItems.users.select({ id: pending.id }))[0]
        for (let useBaseline of [true, false]) {
            let cur = useBaseline ? u : await loadUsers()
            let rows = editRow(cur.rows, pending.id, (x) => ({ ...x, name: `edit-${useBaseline}`, password: 'HACK', tokenVerify: 'HACK', userId: 'HACK', timeCreate: 'HACK' }))
            let r = await saveUsers(rows, useBaseline ? { baseline: cur.baseline } : undefined)
            assert.strict.equal(r.ok, true, JSON.stringify(r))
            let after = (await woItems.users.select({ id: pending.id }))[0]
            assert.strict.equal(after.name, `edit-${useBaseline}`)
            assert.strict.equal(after.password, before.password)
            assert.strict.equal(after.tokenVerify, before.tokenVerify)
            assert.strict.equal(after.userId, before.userId)
            assert.strict.equal(after.timeCreate, before.timeCreate)
        }
    })

    it('CC-A-019 [X8] 自助註冊與管理員清單新增同帳號並行: 恰一方成功, 帳號不重複', async function() {
        for (let round = 0; round < 3; round++) {
            let account = `ac-cc-dup${round}`
            let a = await loadUsers()
            let rowNew = { ...mkUserFx(`dup${round}`, { account, email: `${account}@test.com` }), password: 'Zq#8765Wm', _isNew: true }
            let [rc, rs] = await Promise.all([
                callFapi('createUser', ['eng', account, 'Zq#8765Wm', 'Zq#8765Wm', 'dup', `${account}-self@test.com`]),
                saveUsers([...a.rows, rowNew], undefined),
            ])
            let n = (await woItems.users.select({ account })).length
            assert.strict.equal(n, 1, `第 ${round} 輪帳號 ${account} 恰一列(createUser=${rc.ok}/${rc.err}, save=${rs.ok}/${rs.err})`)
            assert.strict.equal(rc.ok !== rs.ok, true, '恰一方成功')
        }
    })

    it('CC-A-020 [X6、V14] 兩位管理員並行存檔: 結果等於某一串行順序(不同操作者互斥於表鎖)', async function() {
        let admin2 = mkUserFx('adm2', { isAdmin: 'y' })
        await woItems.users.insert([admin2])
        await woItems.tokens.insert([mkTokenFx('adm2', admin2.id)])
        let base = (await loadIps()).rows
        let [r1, r2] = await Promise.all([
            saveIps([...base, { id: 'id-cc-ip-x', ip: '192.0.2.81', timeBlocked: '' }], undefined),
            saveIps([...base, { id: 'id-cc-ip-y', ip: '192.0.2.82', timeBlocked: '' }], undefined, 'cc-adm2'),
        ])
        assert.strict.equal(r1.ok && r2.ok, true, `${JSON.stringify(r1)} ${JSON.stringify(r2)}`)
        let ids = (await woItems.ips.select()).map((x) => x.id).filter((x) => x.startsWith('id-cc-ip-')).sort().join(',')
        let serial = ['id-cc-ip-1,id-cc-ip-2,id-cc-ip-y', 'id-cc-ip-1,id-cc-ip-2,id-cc-ip-x']
        assert.ok(serial.includes(ids), `最終 ${ids} 須為串行結果之一(後存者刪除先存者新增之列)`)
    })

    it('CC-A-021 [E2E-003 行為不變、選項 P] 管理員刪除 session 列(強制登出): 該 token 失效; 升級 session 列為應用系統金鑰: 以 fields 寫入', async function() {
        let a = await loadTokens()
        let r = await saveTokens(a.rows.filter((x) => x.id !== 'id-cc-sess-a'), optT(a))
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let chk = await callFapi('checkToken', ['cc-sess-a'])
        assert.strict.equal(chk.ok, false)
        let b = await loadTokens()
        let r2 = await saveTokens(editRow(b.rows, 'id-for-token-for-basic', (x) => ({ ...x, isApp: 'y', perms: ['readStats'] })), optT(b))
        assert.strict.equal(r2.ok, true, JSON.stringify(r2))
        let t = (await woItems.tokens.select({ id: 'id-for-token-for-basic' }))[0]
        assert.strict.equal(t.isApp, 'y')
        assert.deepStrictEqual(t.perms, ['readStats'])
    })

    //CC-A-022~024: 清單存檔不得新增庫內不存在之 session 列(isApp !== 'y'; ADR-092). 修改前: 以 app 權杖直呼、不帶基準時, 已撤銷之 session 列被當新增寫回而復活(繞過自動封鎖)
    it('CC-A-022 [ADR-092 X1 補強: 不帶基準] app 權杖(writeTokens)直呼 updateTokensList, 整份舊清單含已登出 / 已被自動封鎖撤銷之 session 列: 整次拒收 tokenSessionAddNotAllowed, 零寫入, 該 token 仍無效', async function() {
        let lgB = await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-b', PW])
        assert.strict.equal(lgB.ok, true)
        let old = await loadTokens() //含 sess-a 與 u-b 之 session
        await callFapi('logoutByToken', ['cc-sess-a'])
        for (let i = 0; i < 5; i++) {
            await callFapi('loginByAccountAndPassword', ['eng', 'ac-cc-b', 'Wrong@0000']) //u-b 被自動封鎖並撤銷
        }
        assert.ok((await woItems.users.select({ id: 'id-cc-b' }))[0].timeBlocked !== '')
        let snap = await snapshot()
        let r = await saveTokens(editRow(old.rows, 'id-cc-app-1', (x) => ({ ...x, perms: ['readIps'] })), undefined, 'cc-app-w')
        assert.strict.equal(r.ok, false, JSON.stringify(r))
        assert.strict.equal(r.err, 'tokenSessionAddNotAllowed')
        assert.deepStrictEqual(await snapshot(), snap, '零寫入(同批合法修改亦不寫)')
        for (let tk of ['cc-sess-a', lgB.val.token]) {
            let chk = await callFapi('checkToken', [tk])
            assert.strict.equal(chk.ok, false, `${tk} 應維持失效`)
        }
    })

    it('CC-A-023 [ADR-092 X1 補強: 帶基準] 基準之外之已撤銷 session 列(庫內不存在)送入: 整次拒收, 零寫入, 該 token 仍無效', async function() {
        let old = await loadTokens()
        await callFapi('logoutByToken', ['cc-sess-a'])
        let cur = await loadTokens() //撤銷後才載入: sess-a 不在基準內
        let snap = await snapshot()
        let rowGone = old.rows.find((x) => x.id === 'id-cc-sess-a')
        assert.ok(rowGone, '舊畫面含已撤銷之列')
        let r = await saveTokens([...editRow(cur.rows, 'id-cc-app-1', (x) => ({ ...x, perms: ['readIps'] })), rowGone], optT(cur))
        assert.strict.equal(r.ok, false, JSON.stringify(r))
        assert.strict.equal(r.err, 'tokenSessionAddNotAllowed')
        assert.deepStrictEqual(await snapshot(), snap, '零寫入')
        let chk = await callFapi('checkToken', ['cc-sess-a'])
        assert.strict.equal(chk.ok, false, '已撤銷之 token 仍失效')
    })

    it('CC-A-024 [ADR-092 不變] app 權杖新增應用系統金鑰列與升級 session 列(不帶基準)、管理員新增 app 列與刪除 session 列(帶基準)照常; 同批混入新 session 列則整批拒收', async function() {
        let a = await loadTokens()
        let appNew = (key) => mkTokenFx(key, `id-cc-${key}`, { isApp: 'y', perms: [] })
        //不帶基準(app 權杖): 新增 app 列 + 升級 sess-a
        let r1 = await saveTokens([...editRow(a.rows, 'id-cc-sess-a', (x) => ({ ...x, isApp: 'y', perms: ['readStats'] })), appNew('minted-1')], undefined, 'cc-app-w')
        assert.strict.equal(r1.ok, true, JSON.stringify(r1))
        assert.strict.equal((await woItems.tokens.select({ id: 'id-cc-minted-1' }))[0].isApp, 'y')
        assert.strict.equal((await woItems.tokens.select({ id: 'id-cc-sess-a' }))[0].isApp, 'y')
        //帶基準(管理員): 新增 app 列 + 刪除 session 列 id-for-token-for-basic
        let b = await loadTokens()
        let r2 = await saveTokens([...b.rows.filter((x) => x.id !== 'id-for-token-for-basic'), appNew('minted-2')], optT(b))
        assert.strict.equal(r2.ok, true, JSON.stringify(r2))
        assert.strict.equal((await woItems.tokens.select({ id: 'id-cc-minted-2' })).length, 1)
        assert.deepStrictEqual(await woItems.tokens.select({ id: 'id-for-token-for-basic' }), [], '帶基準刪除 session 列照常')
        //同批混入新 session 列: 整批拒收, 其中合法之新 app 列亦不寫
        let c = await loadTokens()
        let snap = await snapshot()
        let r3 = await saveTokens([...c.rows, appNew('minted-3'), mkTokenFx('minted-sess', 'id-cc-a')], optT(c))
        assert.strict.equal(r3.err, 'tokenSessionAddNotAllowed', JSON.stringify(r3))
        assert.deepStrictEqual(await snapshot(), snap, '零寫入')
    })

})
