//api-apptoken-usage.test.mjs — 應用系統金鑰之兩種用途與使用者身分驗證缺口 (ADR-095; dspec 存取管控表第四節 S-1~S-6)
//
// 依據: C:\opensrcOper\dspec\使用者身分驗證原則.md 二之一、w-web存取管控表.md 第一節與第四節; 專案 CLAUDE.md/提示詞〈範圍一〉〈範圍二〉
//   S-1/S-3 使用者用途: 以 userId 綁使用者, 每次使用皆依所綁使用者「當前」狀態判定(存在、啟用、未封鎖、帳號未到期、已驗證, 與登入同一判準), 授權等同所綁使用者之使用者 token, perms 不適用,
//           反查回所綁使用者實際資料＋isApp='y', 可改所綁使用者密碼(須舊密碼), 自我保護適用, 不給期限不能續期;
//           系統服務用途: 不綁使用者, 反查回應用系統身分(id=app:<tokens.id>, 名稱=金鑰名稱), 授權依 perms, 不得改密碼, 建立者被停用 / 刪除 / 封鎖時不撤銷; 既有無用途欄之列視同系統服務用途
//   S-2 adminResetUserPassword 之系統管理者判定同其他管理入口(funCheckAdmin), 非系統管理者同回 tokenExpired
//   S-4 使用者 token 之「本人」入口(checkToken / refreshToken / getUserByToken / changeUserPassword)亦依使用者當前狀態判定
//   S-5 以 key=token 查他人時, 目標 token 須未逾期且其使用者目前可用, 否則一律固定鍵 tokenNoPermission
// 作法: 真後端(11007), 直寫庫改變使用者狀態(不經清單存檔, 故不觸發撤銷)以驗「即時失效、恢復」; 經清單存檔之停用 / 刪除另驗撤銷範圍。
//   矩陣(入口 × 呼叫者)見 api-accessmatrix.test.mjs; 本檔為狀態、鑄造、清單存檔規則與舊列相容。

import assert from 'assert'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings, cleanKpAccountLoginFailed } from './tools/e2e-setup.mjs'
import { PERMS_ALL, NEW_PW, callers, mkAppToken, insertFixtures, httpApi, getRowsForSave, usable } from './tools/apiAccess.mjs'


let FUTURE = '2030-01-01T00:00:00.000+08:00'
let PAST = '2020-01-01T00:00:00.000+08:00'
let VERIFIED = '2025-01-01T00:00:00.000+08:00'
let byKey = (k) => callers.find((c) => c.key === k)
let seqT = 0
let nextTarget = () => `id-u-target-${++seqT}`


async function saveUsers(token, mutate) {
    let rows = await getRowsForSave('users')
    mutate(rows)
    return callFapi('updateUsersList', [token, 'eng', rows])
}


describe('應用系統金鑰兩種用途與使用者身分驗證缺口 (ADR-095)', function() {
    this.timeout(900000)

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
        await cleanKpAccountLoginFailed()
        await restartBackend('./settings.json')
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures(nextTarget())
    })


    //
    // S-4 / S-1: 使用者當前狀態即時失效、恢復
    //
    let states = [
        { key: '停用(isActive=n)', patch: { isActive: 'n' }, restore: { isActive: 'y' } },
        { key: '手動封鎖(timeBlocked 在未來)', patch: { timeBlocked: FUTURE }, restore: { timeBlocked: '' } },
        { key: '帳號到期(timeExpired 在過去)', patch: { timeExpired: PAST }, restore: { timeExpired: FUTURE } },
        { key: '未驗證(timeVerified 清空)', patch: { timeVerified: '' }, restore: { timeVerified: VERIFIED } },
    ]

    //探針: 本人各入口(使用者 token 與使用者用途); 狀態不可用時皆拒絕, 可用時皆通過; 回傳每個探針之結果摘要
    async function probeSelf(c) {
        let tokenSelf = c.token
        let out = {}
        out.httpCheck = (await httpApi('checkToken', { token: tokenSelf })).ok
        out.fnCheck = (await callFapi('checkToken', [tokenSelf])).ok
        out.getUser = (await callFapi('getUserByToken', [tokenSelf])).ok
        let pw = await callFapi('changeUserPassword', [tokenSelf, 'eng', 'wrong-old-pw', NEW_PW]) //舊密碼錯: 通過閘後才被舊密碼檢查拒絕, 不改密碼
        out.passGate = pw.err !== 'tokenExpired' //true 表示越過 token 閘(失敗原因為舊密碼錯)
        if (c.kind === 'user') {
            let rf = await callFapi('refreshToken', [tokenSelf])
            out.refresh = rf.ok
        }
        else {
            let rf = await callFapi('refreshToken', [tokenSelf])
            out.refreshKey = rf.err //使用者用途一律 tokenAppNoRefresh(固定鍵), 不隨使用者狀態
        }
        return out
    }

    for (let st of states) {
        for (let ck of ['U', 'A', 'AU-U', 'AU-A']) {
            it(`ST[${st.key}][${ck}] 所(綁)使用者${st.key}: 本人各入口立即不可用; 解除後可用(直寫庫改狀態, 不經清單存檔故不撤銷)`, async function() {
                let c = byKey(ck)
                let before = await probeSelf(c)
                assert.strictEqual(before.httpCheck && before.fnCheck && before.getUser && before.passGate, true, `前置: 正常狀態應可用 ${JSON.stringify(before)}`)
                await woItems.users.save([{ id: c.userId, ...st.patch }])
                let inState = await probeSelf(c)
                assert.deepStrictEqual(
                    [inState.httpCheck, inState.fnCheck, inState.getUser, inState.passGate],
                    [false, false, false, false],
                    `狀態中應全拒: ${JSON.stringify(inState)}`
                )
                if (c.kind === 'user') {
                    assert.strictEqual(inState.refresh, false, 'refreshToken 亦隨使用者狀態(S-4)')
                }
                else {
                    assert.strictEqual(inState.refreshKey, 'tokenAppNoRefresh', '使用者用途 refresh 一律固定鍵')
                }
                //系統管理者綁定者: 管理入口亦拒; 一般使用者綁定者本即拒
                let lst = await callFapi('getUsersList', [c.token])
                assert.strictEqual(lst.ok, false)
                assert.strictEqual(lst.err, 'tokenExpired')
                //他人以 key=token 查此權杖: 目標使用者目前不可用 → 固定鍵 tokenNoPermission (S-5 延伸: 與登入同一判準)
                let tgt = await httpApi('getSsoUserInfor', { token: 'm-as-all', key: 'token', value: c.token })
                assert.strictEqual(tgt.ok, false)
                assert.strictEqual(tgt.err, 'tokenNoPermission')
                //token 列未被刪(恢復後可用)
                assert.strictEqual((await woItems.tokens.select({ token: c.token })).length, 1)
                await woItems.users.save([{ id: c.userId, ...st.restore }])
                let after = await probeSelf(c)
                assert.strictEqual(after.httpCheck && after.fnCheck && after.getUser && after.passGate, true, `解除後應恢復可用 ${JSON.stringify(after)}`)
                let tgt2 = await httpApi('getSsoUserInfor', { token: 'm-as-all', key: 'token', value: c.token })
                assert.strictEqual(tgt2.ok, true, JSON.stringify(tgt2))
                assert.strictEqual(tgt2.val.id, c.userId)
            })
        }
    }

    //外審 sol#4: 即時判準須與登入一致. 舊版(now2str 秒級)寫入之 timeVerified 非 timemsTZ 格式, 登入以「非空」判已驗證而放行,
    //若即時判準要求 timemsTZ, 該使用者登入後所持 token 立即全數失效(登得進去卻什麼都不能做)
    for (let ck of ['U', 'A', 'AU-U', 'AU-A']) {
        it(`ST[舊格式驗證時間][${ck}] timeVerified 為非空、非 timemsTZ 之舊格式: 本人各入口(checkToken / getUserByToken / changeUserPassword 閘 / refresh)與登入同一判準, 不得被判失效`, async function() {
            let c = byKey(ck)
            await woItems.users.save([{ id: c.userId, timeVerified: '2026-09-01 12:00:00' }])
            let r = await probeSelf(c)
            assert.strictEqual(r.httpCheck && r.fnCheck && r.getUser && r.passGate, true, JSON.stringify(r))
            if (c.kind === 'user') {
                assert.strictEqual(r.refresh, true)
            }
        })
    }

    it('ST[應用系統金鑰不看過去之 timeEnd] 使用者用途與系統服務用途金鑰之 timeEnd 為過去值: 仍可用(不設期限); 同樣之登入 token 逾期即拒', async function() {
        for (let k of ['m-au-u', 'm-au-a', 'm-as-all', 'm-as-base']) {
            await woItems.tokens.save([{ id: `id-${k}`, timeEnd: PAST }])
            assert.strictEqual((await callFapi('checkToken', [k])).ok, true, `${k} 不看 timeEnd`)
        }
        assert.strictEqual((await callFapi('getUserByToken', ['m-au-u'])).ok, true)
        let tk = (await woItems.tokens.select({ token: 'token-for-viewer' }))[0]
        await woItems.tokens.save([{ id: tk.id, timeEnd: PAST }])
        assert.strictEqual((await callFapi('checkToken', ['token-for-viewer'])).ok, false, '登入 token 逾期即拒')
    })

    it('ST[刪除使用者列(直寫庫, 不經清單)] 所綁使用者列不存在: 使用者用途與其使用者 token 皆不可用; 同 id 使用者列恢復後使用者用途可用', async function() {
        let u = (await woItems.users.select({ id: 'id-for-viewer' }))[0]
        await woItems.users.del({ id: 'id-for-viewer' })
        for (let k of ['AU-U', 'U']) {
            let c = byKey(k)
            assert.strictEqual(await usable(c.token), false, `${k} 不可用`)
            assert.strictEqual((await callFapi('getUserByToken', [c.token])).ok, false)
        }
        await woItems.users.insert([u])
        assert.strictEqual(await usable('m-au-u'), true, '恢復')
    })

    it('ST[系統服務用途不隨建立者狀態] 建立者(userId 欄)停用 / 封鎖 / 到期 / 刪除 / 未驗證 / 根本不存在: 系統服務用途金鑰仍可用, 授權仍只依 perms', async function() {
        let probe = async () => {
            let a = await callFapi('getUsersList', ['m-as-all'])
            let b = await callFapi('getIpsList', ['m-as-all'])
            let d = await callFapi('getIpsList', ['m-as-base'])
            let g = await callFapi('getUserByToken', ['m-as-all'])
            return { usersList: a.ok, ipsList: b.ok, baseIps: d.ok, who: g.ok ? g.val.id : g.err }
        }
        assert.deepStrictEqual(await probe(), { usersList: true, ipsList: true, baseIps: false, who: 'app:id-m-as-all' })
        for (let st of states) {
            await woItems.users.save([{ id: 'id-creator', ...st.patch }])
            assert.deepStrictEqual(await probe(), { usersList: true, ipsList: true, baseIps: false, who: 'app:id-m-as-all' }, st.key)
            await woItems.users.save([{ id: 'id-creator', ...st.restore }])
        }
        await woItems.users.del({ id: 'id-creator' })
        assert.deepStrictEqual(await probe(), { usersList: true, ipsList: true, baseIps: false, who: 'app:id-m-as-all' }, '建立者列不存在')
        //建立者欄為不存在之 id(含空字串)亦可用(原 getUserByToken 對空 userId reject invalid userId from token)
        await woItems.tokens.save([{ id: 'id-m-as-all', userId: '' }])
        assert.deepStrictEqual(await probe(), { usersList: true, ipsList: true, baseIps: false, who: 'app:id-m-as-all' }, '建立者欄為空')
    })


    //
    // 經清單存檔之停用 / 刪除: 撤銷範圍 (停用、刪除使用者之撤銷只作用於其登入 token 與綁其之使用者用途金鑰)
    //
    it('REV[停用] 系統管理者經清單停用使用者: 其登入 token 與綁其之使用者用途金鑰皆撤銷(列刪除); 系統服務用途金鑰(含建立者欄為該使用者者)不撤銷; 重新啟用後已撤銷者不恢復', async function() {
        await woItems.tokens.save([{ id: 'id-m-as-base', userId: 'id-for-viewer' }]) //建立者欄指向被停用者
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.find((u) => u.id === 'id-for-viewer').isActive = 'n'
        })
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual((await woItems.tokens.select({ token: 'token-for-viewer' })).length, 0, '登入 token 撤銷')
        assert.strictEqual((await woItems.tokens.select({ token: 'm-au-u' })).length, 0, '使用者用途金鑰撤銷')
        assert.strictEqual((await woItems.tokens.select({ token: 'm-as-base' })).length, 1, '系統服務用途金鑰不撤銷(建立者欄僅為稽核)')
        assert.strictEqual(await usable('m-as-base'), true)
        assert.strictEqual((await woItems.tokens.select({ token: 'm-au-a' })).length, 1, '他人之金鑰不動')
        let r2 = await saveUsers('token-for-admin', (rows) => {
            rows.find((u) => u.id === 'id-for-viewer').isActive = 'y'
        })
        assert.strictEqual(r2.ok, true, JSON.stringify(r2))
        assert.strictEqual(await usable('m-au-u'), false, '停用後重新啟用不恢復已撤銷之使用者用途金鑰(停用恢復者除外之規則)')
        assert.strictEqual(await usable('token-for-viewer'), false)
    })

    it('REV[刪除] 系統管理者經清單刪除使用者: 其登入 token 與使用者用途金鑰撤銷; 系統服務用途金鑰不撤銷', async function() {
        await woItems.tokens.save([{ id: 'id-m-as-base', userId: 'id-for-viewer' }])
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.splice(rows.findIndex((u) => u.id === 'id-for-viewer'), 1)
        })
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual((await woItems.tokens.select({ token: 'token-for-viewer' })).length, 0)
        assert.strictEqual((await woItems.tokens.select({ token: 'm-au-u' })).length, 0)
        assert.strictEqual((await woItems.tokens.select({ token: 'm-as-base' })).length, 1)
        assert.strictEqual(await usable('m-as-base'), true)
    })

    it('REV[建立者經清單停用 / 刪除] 系統服務用途金鑰之建立者被停用或刪除: 金鑰不撤銷、仍可用', async function() {
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.find((u) => u.id === 'id-creator').isActive = 'n'
        })
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        for (let t of ['m-as-all', 'm-as-base', 'm-probe']) {
            assert.strictEqual((await woItems.tokens.select({ token: t })).length, 1, `${t} 停用建立者後仍在`)
        }
        assert.strictEqual((await callFapi('getUsersList', ['m-as-all'])).ok, true)
        let r2 = await saveUsers('token-for-admin', (rows) => {
            rows.splice(rows.findIndex((u) => u.id === 'id-creator'), 1)
        })
        assert.strictEqual(r2.ok, true, JSON.stringify(r2))
        for (let t of ['m-as-all', 'm-as-base', 'm-probe']) {
            assert.strictEqual((await woItems.tokens.select({ token: t })).length, 1, `${t} 刪除建立者後仍在`)
        }
        assert.strictEqual((await callFapi('getUsersList', ['m-as-all'])).ok, true)
    })

    it('REV[自動封鎖] 登入失敗封鎖所綁使用者: 登入 token 撤銷(既有行為), 使用者用途金鑰不刪(隨封鎖狀態即時不可用, 封鎖解除後恢復); 避免他人以刻意登入失敗使整合金鑰被刪', async function() {
        for (let i = 0; i < 4; i++) { //門檻為「次數 > numForAccountLoginFailed(3)」, 第 4 次失敗即封鎖(D07)
            await callFapi('loginByAccountAndPassword', ['eng', 'ac-viewer', 'wrong-pw-xx'])
        }
        //封鎖於失敗當下即時判定並寫入(blockAccount); 輪詢至使用者被標記封鎖
        let blocked = false
        for (let i = 0; i < 40 && !blocked; i++) {
            let u = (await woItems.users.select({ id: 'id-for-viewer' }))[0]
            blocked = u.timeBlocked !== ''
            if (!blocked) {
                await new Promise((resolve) => setTimeout(resolve, 250))
            }
        }
        assert.strictEqual(blocked, true, '登入失敗超過門檻後帳號應被封鎖')
        assert.strictEqual((await woItems.tokens.select({ token: 'token-for-viewer' })).length, 0, '登入 token 撤銷(既有)')
        assert.strictEqual((await woItems.tokens.select({ token: 'm-au-u' })).length, 1, '使用者用途金鑰不刪')
        assert.strictEqual(await usable('m-au-u'), false, '封鎖中不可用')
        await woItems.users.save([{ id: 'id-for-viewer', timeBlocked: '' }])
        await cleanKpAccountLoginFailed()
        assert.strictEqual(await usable('m-au-u'), true, '封鎖解除後恢復')
    })


    //
    // S-2: adminResetUserPassword 之系統管理者判定
    //
    it('S-2 adminResetUserPassword 與其他管理入口同一系統管理者判準: 被封鎖 / 帳號到期 / 未驗證 / 已停用 / 已降權之「系統管理者」(token 仍在)一律回 tokenExpired, 與 getUsersList 同鍵, 目標密碼不變', async function() {
        let cases = [
            { key: '封鎖', patch: { timeBlocked: FUTURE } },
            { key: '帳號到期', patch: { timeExpired: PAST } },
            { key: '未驗證', patch: { timeVerified: '' } },
            { key: '停用', patch: { isActive: 'n' } },
            { key: '降權', patch: { isAdmin: 'n' } },
        ]
        for (let c of cases) {
            for (let tk of ['token-for-admin', 'm-au-a']) {
                let tid = nextTarget()
                await insertTargetOnly(tid)
                await woItems.users.save([{ id: 'id-for-admin', ...c.patch }])
                let r = await callFapi('adminResetUserPassword', [tk, 'eng', tid])
                let g = await callFapi('getUsersList', [tk])
                assert.strictEqual(r.ok, false, `${c.key}/${tk}`)
                assert.strictEqual(r.err, 'tokenExpired', `${c.key}/${tk}: 與其他管理入口同鍵`)
                assert.strictEqual(g.err, r.err, `${c.key}/${tk}: 與 getUsersList 同鍵`)
                assert.strictEqual((await woItems.users.select({ id: tid }))[0].password, 'not-used', `${c.key}/${tk}: 目標密碼不變`)
                await woItems.users.save([{ id: 'id-for-admin', timeBlocked: '', timeExpired: FUTURE, timeVerified: VERIFIED, isActive: 'y', isAdmin: 'y' }])
            }
        }
        //對照: 正常系統管理者可重設
        let tid = nextTarget()
        await insertTargetOnly(tid)
        let ok = await callFapi('adminResetUserPassword', ['token-for-admin', 'eng', tid])
        assert.strictEqual(ok.ok, true, JSON.stringify(ok))
        //舊鍵 adminResetPasswordForbidden 不再由本入口產生(procLang 亦已移除)
        let viewer = await callFapi('adminResetUserPassword', ['token-for-viewer', 'eng', tid])
        assert.strictEqual(viewer.err, 'tokenExpired')
    })

    async function insertTargetOnly(tid) {
        let { default: ds } = await import('../src/schema/index.mjs')
        let t = ds.users.funNew({ order: 900 + seqT, account: `ac-${tid}`, password: 'not-used', name: tid, email: `${tid}@example.com`, description: 'desc-orig', from: 'test', redir: '', isAdmin: 'n' })
        t.id = tid
        t.timeVerified = VERIFIED
        await woItems.users.insert([t])
    }


    //
    // S-5: 以 key=token 查他人
    //
    it('S-5 getSsoUserInfor(key=token): 目標 token 逾期、查無、使用者不可用一律固定鍵 tokenNoPermission; 未逾期者回資料; 目標為應用系統金鑰: 使用者用途回所綁使用者、系統服務用途回應用系統身分', async function() {
        let q = (v) => httpApi('getSsoUserInfor', { token: 'token-for-admin', key: 'token', value: v })
        //未逾期
        let live = await q('token-for-viewer')
        assert.strictEqual(live.ok, true)
        assert.strictEqual(live.val.id, 'id-for-viewer')
        //逾期(timeEnd 在過去)
        await woItems.tokens.save([{ id: 'id-for-token-for-viewer', timeEnd: PAST }])
        let expired = await q('token-for-viewer')
        assert.deepStrictEqual([expired.ok, expired.err], [false, 'tokenNoPermission'])
        //查無
        let none = await q('no-such-token-xyz')
        assert.deepStrictEqual([none.ok, none.err], [false, 'tokenNoPermission'])
        //逾期與查無同鍵, 且不回顯
        assert.strictEqual(expired.err, none.err)
        //應用系統金鑰為目標
        let au = await q('m-au-a')
        assert.strictEqual(au.ok, true)
        assert.strictEqual(au.val.id, 'id-for-admin')
        assert.strictEqual(au.val.isApp, 'y')
        let as = await q('m-as-all')
        assert.strictEqual(as.ok, true)
        assert.strictEqual(as.val.id, 'app:id-m-as-all')
        assert.strictEqual(as.val.name, 'as-all-name')
        //kpfun getUserByToken(查自己)亦同: 逾期之使用者 token 查自己 → tokenExpired
        let self = await callFapi('getUserByToken', ['token-for-viewer'])
        assert.deepStrictEqual([self.ok, self.err], [false, 'tokenExpired'])
    })


    //
    // 自我保護 (updateUsersList)
    //
    it('SELF 使用者用途綁系統管理者(AU-A): 不得刪除、降權、停用所綁使用者自己(同使用者 token); 可改他人; 系統服務用途操作者(AS+)無「自己」故不受此限', async function() {
        let del = await saveUsers('m-au-a', (rows) => {
            rows.splice(rows.findIndex((u) => u.id === 'id-for-admin'), 1)
        })
        assert.deepStrictEqual([del.ok, del.err], [false, 'cannotDeleteSelf'])
        let dem = await saveUsers('m-au-a', (rows) => {
            rows.find((u) => u.id === 'id-for-admin').isAdmin = 'n'
        })
        assert.deepStrictEqual([dem.ok, dem.err], [false, 'cannotDemoteSelf'])
        let dis = await saveUsers('m-au-a', (rows) => {
            rows.find((u) => u.id === 'id-for-admin').isActive = 'n'
        })
        assert.deepStrictEqual([dis.ok, dis.err], [false, 'cannotDisableSelf'])
        //同使用者 token 對照
        let dis2 = await saveUsers('token-for-admin', (rows) => {
            rows.find((u) => u.id === 'id-for-admin').isActive = 'n'
        })
        assert.deepStrictEqual([dis2.ok, dis2.err], [false, 'cannotDisableSelf'])
        let u0 = (await woItems.users.select({ id: 'id-for-admin' }))[0]
        assert.deepStrictEqual([u0.isActive, u0.isAdmin], ['y', 'y'], '零寫入')
        //改他人可
        let other = await saveUsers('m-au-a', (rows) => {
            rows.find((u) => u.id === 'id-for-viewer').description = 'edited-by-au-a'
        })
        assert.strictEqual(other.ok, true, JSON.stringify(other))
        assert.strictEqual((await woItems.users.select({ id: 'id-for-viewer' }))[0].description, 'edited-by-au-a')
        //寫入稽核: 更新者記所綁使用者(身分), 非 app 權杖列
        assert.strictEqual((await woItems.users.select({ id: 'id-for-viewer' }))[0].userIdUpdate, 'id-for-admin')
        //AS+ 停用該系統管理者: 允許(無自己), 更新者記應用系統身分
        let as = await saveUsers('m-as-all', (rows) => {
            rows.find((u) => u.id === 'id-for-admin').isActive = 'n'
        })
        assert.strictEqual(as.ok, true, JSON.stringify(as))
        assert.strictEqual((await woItems.users.select({ id: 'id-for-admin' }))[0].isActive, 'n')
        assert.strictEqual((await woItems.users.select({ id: 'id-for-admin' }))[0].userIdUpdate, 'app:id-m-as-all')
        assert.strictEqual((await woItems.tokens.select({ token: 'm-au-a' })).length, 0, '被停用之系統管理者之使用者用途金鑰隨之撤銷')
    })

    it('SELF[保留前綴] 後台清單新增之使用者主鍵不得以 app: 開頭(應用系統身分專用前綴); 既有列不受影響', async function() {
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.push({ ...rows[0], id: 'app:fake', account: 'ac-fake', email: 'fake@example.com', name: 'fake', password: NEW_PW, _isNew: true })
        })
        assert.deepStrictEqual([r.ok, r.err], [false, 'invalidRows'])
        assert.strictEqual((await woItems.users.select({ id: 'app:fake' })).length, 0)
    })


    //
    // 金鑰清單存檔規則 (只改不增、不改身分)
    //
    it('LIST 金鑰清單存檔: 不可升級登入 token、不可新增應用系統金鑰列、既有應用系統金鑰之身分欄(token/userId/isApp/timeEnd)不可變更; 使用者用途不可設 perms; 用途與名稱為伺服器專有欄位(客戶端值不寫入); 零寫入', async function() {
        let snap = async () => JSON.stringify((await woItems.tokens.select()).sort((a, b) => a.id.localeCompare(b.id)))
        let s0 = await snap()
        let save = async (mutate) => {
            let rows = await getRowsForSave('tokens')
            mutate(rows)
            return callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        }
        let cases = [
            ['升級登入 token', (rows) => {
                Object.assign(rows.find((t) => t.token === 'token-for-viewer'), { isApp: 'y' })
            }, 'tokenSessionUpgradeNotAllowed'],
            ['新增應用系統金鑰列', (rows) => {
                rows.push({ ...rows.find((t) => t.id === 'id-m-probe'), id: 'id-m-new', token: 'm-new' })
            }, 'tokenAppAddNotAllowed'],
            ['改權杖字串', (rows) => {
                rows.find((t) => t.id === 'id-m-probe').token = 'm-probe-2'
            }, 'tokenAppLocked'],
            ['改 userId', (rows) => {
                rows.find((t) => t.id === 'id-m-au-u').userId = 'id-for-admin'
            }, 'tokenAppLocked'],
            ['改 timeEnd', (rows) => {
                rows.find((t) => t.id === 'id-m-probe').timeEnd = FUTURE
            }, 'tokenAppLocked'],
            ['應用系統金鑰改回登入 token', (rows) => {
                rows.find((t) => t.id === 'id-m-probe').isApp = 'n'
            }, 'tokenAppLocked'],
            ['使用者用途設 perms', (rows) => {
                rows.find((t) => t.id === 'id-m-au-u').perms = ['readIps']
            }, 'tokenAppPermsNotForUser'],
        ]
        for (let [name, mutate, err] of cases) {
            let r = await save(mutate)
            assert.deepStrictEqual([name, r.ok, r.err], [name, false, err])
            assert.strictEqual(await snap(), s0, `${name}: 零寫入`)
        }
        //可改: 系統服務用途之 perms; 同批送入用途 / 名稱之客戶端值不寫入
        let ok = await save((rows) => {
            let t = rows.find((x) => x.id === 'id-m-probe')
            t.perms = ['readStats']
            t.appUsage = 'user'
            t.appName = 'hacked'
        })
        assert.strictEqual(ok.ok, true, JSON.stringify(ok))
        let p = (await woItems.tokens.select({ id: 'id-m-probe' }))[0]
        assert.deepStrictEqual(p.perms, ['readStats'])
        assert.strictEqual(p.appUsage, 'system')
        assert.strictEqual(p.appName, 'probe')
        assert.strictEqual(p.timeEnd, '')
        //可刪: 撤銷應用系統金鑰
        let del = await save((rows) => {
            rows.splice(rows.findIndex((t) => t.id === 'id-m-probe'), 1)
        })
        assert.strictEqual(del.ok, true, JSON.stringify(del))
        assert.strictEqual((await woItems.tokens.select({ id: 'id-m-probe' })).length, 0)
    })


    //
    // 鑄造 createAppToken
    //
    it('MINT 使用者用途: 綁存在且啟用之使用者(可綁系統管理者); 權杖字串與主鍵由伺服端產生(忽略客戶端指定); 不給期限; 反查為所綁使用者; 可改所綁使用者密碼', async function() {
        let r = await callFapi('createAppToken', ['token-for-admin', 'eng', { name: '  my-user-key  ', usage: 'user', userId: 'id-for-viewer', token: 'client-chosen', id: 'client-id', timeEnd: FUTURE }])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.notStrictEqual(r.val.token, 'client-chosen')
        assert.notStrictEqual(r.val.id, 'client-id')
        let row = (await woItems.tokens.select({ id: r.val.id }))[0]
        assert.deepStrictEqual(
            [row.isApp, row.appUsage, row.appName, row.userId, row.timeEnd, row.userIdUpdate, row.token === r.val.token, row.perms],
            ['y', 'user', 'my-user-key', 'id-for-viewer', '', 'id-for-admin', true, []]
        )
        let g = await callFapi('getUserByToken', [r.val.token])
        assert.strictEqual(g.ok, true, JSON.stringify(g))
        assert.deepStrictEqual([g.val.id, g.val.account, g.val.isApp, g.val.isAdmin], ['id-for-viewer', 'ac-viewer', 'y', 'n'])
        assert.strictEqual((await callFapi('getUsersList', [r.val.token])).err, 'tokenExpired', '綁一般使用者: 管理服務不可用')
        let cp = await callFapi('changeUserPassword', [r.val.token, 'eng', 'pw-viewer', NEW_PW])
        assert.strictEqual(cp.ok, true, JSON.stringify(cp))
        assert.strictEqual((await callFapi('loginByAccountAndPassword', ['eng', 'ac-viewer', NEW_PW])).ok, true)
        //綁系統管理者
        let ra = await callFapi('createAppToken', ['token-for-admin', 'eng', { name: 'admin-key', usage: 'user', userId: 'id-for-admin' }])
        assert.strictEqual(ra.ok, true, JSON.stringify(ra))
        assert.strictEqual((await callFapi('getUsersList', [ra.val.token])).ok, true, '綁系統管理者: 管理服務可用')
        //兩次鑄造之權杖字串互異
        let rb = await callFapi('createAppToken', ['token-for-admin', 'eng', { name: 'admin-key', usage: 'user', userId: 'id-for-admin' }])
        assert.notStrictEqual(rb.val.token, ra.val.token)
    })

    it('MINT 系統服務用途: 不綁使用者(擁有者欄記建立者); perms 去重排序; 不給期限; 缺 perm 之呼叫被拒; 建立者為應用系統金鑰時記其應用系統身分', async function() {
        let r = await callFapi('createAppToken', ['token-for-admin', 'eng', { name: 'svc', usage: 'system', perms: ['readStats', 'readIps', 'readStats'] }])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        let row = (await woItems.tokens.select({ id: r.val.id }))[0]
        assert.deepStrictEqual([row.appUsage, row.appName, row.userId, row.timeEnd, row.perms], ['system', 'svc', 'id-for-admin', '', ['readIps', 'readStats']])
        assert.strictEqual((await callFapi('getIpsList', [r.val.token])).ok, true)
        assert.strictEqual((await callFapi('getTokensList', [r.val.token])).ok, false)
        assert.strictEqual((await callFapi('changeUserPassword', [r.val.token, 'eng', 'x', NEW_PW])).err, 'tokenUserOnly')
        //由具 writeTokens 之系統服務用途鑄造: 擁有者 / 更新者記應用系統身分
        let r2 = await callFapi('createAppToken', ['m-as-all', 'eng', { name: 'svc2', usage: 'system', perms: [] }])
        assert.strictEqual(r2.ok, true, JSON.stringify(r2))
        let row2 = (await woItems.tokens.select({ id: r2.val.id }))[0]
        assert.deepStrictEqual([row2.userId, row2.userIdUpdate], ['app:id-m-as-all', 'app:id-m-as-all'])
        //缺 writeTokens
        let r3 = await callFapi('createAppToken', ['m-as-base', 'eng', { name: 'svc3', usage: 'system', perms: [] }])
        assert.deepStrictEqual([r3.ok, r3.err], [false, 'tokenExpired'])
    })

    it('MINT 驗證: 名稱 / 用途 / 綁定使用者 / perms 不合法一律固定鍵、零寫入', async function() {
        let n0 = (await woItems.tokens.select()).length
        let call = (data) => callFapi('createAppToken', ['token-for-admin', 'eng', data])
        await woItems.users.save([{ id: 'id-for-basic', isActive: 'n' }])
        let cases = [
            [{ usage: 'user', userId: 'id-for-viewer' }, 'tokenAppNameInvalid'],
            [{ name: '', usage: 'system' }, 'tokenAppNameInvalid'],
            [{ name: '   ', usage: 'system' }, 'tokenAppNameInvalid'],
            [{ name: 'x'.repeat(61), usage: 'system' }, 'tokenAppNameInvalid'],
            [{ name: 123, usage: 'system' }, 'tokenAppNameInvalid'],
            [{ name: '<b onclick=1>x', usage: 'system' }, 'htmlMarkupNotAllowed'],
            [{ name: 'k' }, 'tokenAppUsageInvalid'],
            [{ name: 'k', usage: '' }, 'tokenAppUsageInvalid'],
            [{ name: 'k', usage: 'admin' }, 'tokenAppUsageInvalid'],
            [{ name: 'k', usage: ['user'] }, 'tokenAppUsageInvalid'],
            [{ name: 'k', usage: 'user' }, 'tokenAppUserInvalid'],
            [{ name: 'k', usage: 'user', userId: 'id-not-exist' }, 'tokenAppUserInvalid'],
            [{ name: 'k', usage: 'user', userId: 'id-for-basic' }, 'tokenAppUserInvalid'], //已停用
            [{ name: 'k', usage: 'user', userId: { $ne: 'x' } }, 'tokenAppUserInvalid'],
            [{ name: 'k', usage: 'user', userId: '<x>u' }, 'tokenAppUserInvalid'], //含會被 XSS 清除改寫之標記(外審 sol#1)
            [{ name: 'k', usage: 'user', userId: 'id-for-viewer', perms: ['readIps'] }, 'tokenAppPermsNotForUser'],
            [{ name: 'k', usage: 'system', userId: 'id-for-viewer' }, 'tokenAppUserNotForSystem'],
            [{ name: 'k', usage: 'system', perms: ['readToken'] }, 'tokenPermsInvalid'],
            [{ name: 'k', usage: 'system', perms: 'readIps' }, 'tokenPermsInvalid'],
        ]
        for (let [data, err] of cases) {
            let r = await call(data)
            assert.deepStrictEqual([JSON.stringify(data), r.ok, r.err], [JSON.stringify(data), false, err])
        }
        let bad = await callFapi('createAppToken', ['token-for-admin', 'eng', 'not-an-object'])
        assert.deepStrictEqual([bad.ok, bad.err], [false, 'tokenAppUsageInvalid'])
        assert.strictEqual((await woItems.tokens.select()).length, n0, '零寫入')
    })

    it('MINT 雙擊: 同一操作者並行鑄造兩次, 失敗者只能是 saveInProgress, 資料筆數 = 成功數', async function() {
        let n0 = (await woItems.tokens.select()).length
        let rs = await Promise.all([1, 2].map((i) => callFapi('createAppToken', ['token-for-admin', 'eng', { name: `dc-${i}`, usage: 'system', perms: [] }])))
        let okN = rs.filter((r) => r.ok).length
        assert.ok(okN >= 1)
        for (let r of rs.filter((x) => !x.ok)) {
            assert.strictEqual(r.err, 'saveInProgress')
        }
        assert.strictEqual((await woItems.tokens.select()).length - n0, okN)
    })

    it('MINT 與刪除使用者同鎖: 綁定者經清單刪除後不可再鑄造綁其之金鑰', async function() {
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.splice(rows.findIndex((u) => u.id === 'id-for-viewer'), 1)
        })
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        let m = await callFapi('createAppToken', ['token-for-admin', 'eng', { name: 'late', usage: 'user', userId: 'id-for-viewer' }])
        assert.deepStrictEqual([m.ok, m.err], [false, 'tokenAppUserInvalid'])
    })


    //
    // 舊列相容 (無用途欄、升級前可用〔timeEnd 合法且未逾期〕 → 視同系統服務用途; 升級前已失效者維持失效, 見 api-apptoken-upgrade.test.mjs)
    //
    it('LEGACY 升級前可用之應用系統金鑰列(無 appUsage / appName 欄、timeEnd 為合法未逾期值、擁有者為任意字串): 視同系統服務用途, 授權依 perms, 反查為應用系統身分(名稱 no name), refresh 拒絕, 不改密碼, 擁有者欄使用者被停用 / 刪除不撤銷; 用途值未登錄者一律不可用', async function() {
        let legacy = mkAppToken('id-m-legacy', 'm-legacy', 'id-for-viewer', undefined, '', ['readStats'])
        legacy.timeEnd = FUTURE
        let weird = mkAppToken('id-m-weird', 'm-weird', 'id-creator', 'service', 'weird', PERMS_ALL)
        await woItems.tokens.insert([legacy, weird])
        assert.strictEqual((await callFapi('getStaIp', ['m-legacy'])).ok, true, 'readStats 依 perms')
        assert.strictEqual((await callFapi('getUsersList', ['m-legacy'])).ok, true, '基本權限 readUsers')
        assert.strictEqual((await callFapi('getIpsList', ['m-legacy'])).ok, false, '缺 readIps')
        let g = await callFapi('getUserByToken', ['m-legacy'])
        assert.deepStrictEqual([g.ok, g.val.id, g.val.name, g.val.isApp, g.val.isAdmin], [true, 'app:id-m-legacy', 'no name', 'y', 'y'])
        assert.strictEqual((await callFapi('refreshToken', ['m-legacy'])).err, 'tokenAppNoRefresh')
        assert.strictEqual((await callFapi('changeUserPassword', ['m-legacy', 'eng', 'pw-viewer', NEW_PW])).err, 'tokenUserOnly')
        assert.strictEqual((await woItems.tokens.select({ id: 'id-m-legacy' }))[0].timeEnd, FUTURE, 'timeEnd 不被改寫')
        let r = await saveUsers('token-for-admin', (rows) => {
            rows.find((u) => u.id === 'id-for-viewer').isActive = 'n'
        })
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual((await woItems.tokens.select({ id: 'id-m-legacy' })).length, 1, '擁有者欄使用者被停用不撤銷既有列')
        assert.strictEqual(await usable('m-legacy'), true)
        //未登錄之用途值: fail closed
        assert.strictEqual(await usable('m-weird'), false)
        assert.strictEqual((await callFapi('getUsersList', ['m-weird'])).ok, false)
        //後台清單存回既有列(未改): 可存, 不因缺用途欄被拒或被改寫
        let rows = await getRowsForSave('tokens')
        let sv = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strictEqual(sv.ok, true, JSON.stringify(sv))
        let l2 = (await woItems.tokens.select({ id: 'id-m-legacy' }))[0]
        assert.strictEqual(l2.timeEnd, FUTURE)
        assert.strictEqual(l2.appUsage === undefined || l2.appUsage === '', true, '未改之既有列不被寫入用途欄')
    })

    it('SESSION 使用者 token 之既有行為不變: 登入產生之 token 仍有 timeEnd 期限, refreshToken 續期, 逾期即不可用', async function() {
        let login = await callFapi('loginByAccountAndPassword', ['eng', 'ac-viewer', 'pw-viewer'])
        assert.strictEqual(login.ok, true)
        let row = (await woItems.tokens.select({ token: login.val.token }))[0]
        assert.strictEqual(row.isApp !== 'y', true)
        assert.ok(row.timeEnd && row.timeEnd !== '', '登入 token 帶期限')
        assert.strictEqual(row.appUsage === undefined || row.appUsage === '', true)
        let rf = await callFapi('refreshToken', [login.val.token])
        assert.strictEqual(rf.ok, true)
        assert.ok(rf.val >= row.timeEnd, '續期後到期時間不早於原到期')
        await woItems.tokens.save([{ id: row.id, timeEnd: PAST }])
        assert.strictEqual(await usable(login.val.token), false, '逾期不可用')
        assert.strictEqual((await callFapi('refreshToken', [login.val.token])).err, 'tokenExpired')
    })

})
