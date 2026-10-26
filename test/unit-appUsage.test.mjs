//unit-appUsage.test.mjs — 應用系統金鑰用途 (ADR-095): src/appUsage.mjs 純函式與 procCore 身分解析之單元測試(不起服務)
//
// 依據: 使用者身分驗證原則.md 二之一(使用者用途 / 系統服務用途); 本檔斷言對應 spec/設計要點與取捨.md ADR-095 之決定 1~9
//   AU-01~03 用途判定與保留前綴; AU-10~19 procCore 之身分解析(getUserByToken / checkToken / refreshToken / changePassword / 撤銷範圍 / 鑄造)
// 真服務端到端與逐入口矩陣見 api-accessmatrix / api-apptoken-usage.

import assert from 'assert'
import { getAppUsage, getAppId, isAppUsageValue, isAppIdLike, keysAppUsage, keyAppIdPrefix } from '../src/appUsage.mjs'
import { mkEnvSso, mkToken, errOf, PW_INIT } from './tools/unitEnv.mjs'


let setUsers = (env, id, patch) => env.users.kp.set(id, { ...env.users.get(id), ...patch })


describe('應用系統金鑰用途之純函式 (src/appUsage.mjs)', function() {

    it('AU-01 [決定 1] getAppUsage: user / system 原樣; 既有列(缺欄 / 空字串 / null)視同 system; 未登錄值 fail closed 回空; 非應用系統金鑰回空', function() {
        assert.deepStrictEqual(keysAppUsage, ['user', 'system'])
        assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: 'user' }), 'user')
        assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: 'system' }), 'system')
        for (let v of [undefined, null, '']) {
            assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: v }), 'system', String(v))
        }
        assert.strictEqual(getAppUsage({ isApp: 'y' }), 'system', '缺欄')
        for (let v of ['User', 'SYSTEM', 'service', 'admin', ' user', 1, true, {}, ['user']]) {
            assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: v }), '', JSON.stringify(v))
        }
        for (let isApp of ['n', '', undefined, null, 'Y', 'yes']) {
            assert.strictEqual(getAppUsage({ isApp, appUsage: 'user' }), '', `isApp=${String(isApp)}`)
        }
        assert.strictEqual(getAppUsage(null), '')
    })

    it('AU-02 [決定 1] isAppUsageValue: 新建時須明確給 user / system(不接受缺欄、空字串、大小寫差異)', function() {
        assert.strictEqual(isAppUsageValue('user'), true)
        assert.strictEqual(isAppUsageValue('system'), true)
        for (let v of ['', undefined, null, 'User', 'sys', ['user'], 1]) {
            assert.strictEqual(isAppUsageValue(v), false, JSON.stringify(v))
        }
    })

    it('AU-03 [決定 2] 系統服務用途之反查 id 為 app:<tokens.id>; 使用者主鍵不得落在此保留前綴', function() {
        assert.strictEqual(keyAppIdPrefix, 'app:')
        assert.strictEqual(getAppId({ id: 't-1' }), 'app:t-1')
        assert.strictEqual(isAppIdLike('app:t-1'), true)
        assert.strictEqual(isAppIdLike('app:'), true)
        for (let v of ['app', 'App:x', 'xapp:1', '', undefined, null, 1]) {
            assert.strictEqual(isAppIdLike(v), false, JSON.stringify(v))
        }
    })

})


describe('procCore 之身分解析與用途語意 (ADR-095)', function() {

    let addApp = (env, id, usage, userId, extra = {}) => {
        let t = mkToken(id, `tk-${id}`, userId, { isApp: 'y', perms: [], ...extra })
        t.timeEnd = ''
        if (usage !== undefined) {
            t.appUsage = usage
        }
        env.tokens.kp.set(id, t)
        return t
    }

    it('AU-10 [決定 2、3] getUserByToken: 使用者用途回所綁使用者實際資料＋isApp=y; 系統服務用途回應用系統身分(id=app:<tokens.id>, 名稱=金鑰名稱, isAdmin=y), 不取 tokens.userId', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a', { appName: 'svc-name' })
        let au = await env.p.getUserByToken('tk-t-au')
        assert.deepStrictEqual([au.id, au.account, au.isAdmin, au.isApp], ['u-a', 'auser', 'n', 'y'])
        let as = await env.p.getUserByToken('tk-t-as')
        assert.deepStrictEqual([as.id, as.name, as.isAdmin, as.isApp], ['app:t-as', 'svc-name', 'y', 'y'])
        //擁有者欄不存在之使用者: 系統服務用途仍可反查, 使用者用途不可
        env.tokens.kp.set('t-as', { ...env.tokens.get('t-as'), userId: 'u-none' })
        env.tokens.kp.set('t-au', { ...env.tokens.get('t-au'), userId: 'u-none' })
        assert.strictEqual((await env.p.getUserByToken('tk-t-as')).id, 'app:t-as')
        assert.strictEqual(await errOf(env.p.getUserByToken('tk-t-au')) !== null, true)
        //既有列(無用途欄、無名稱; 升級前可用者, 即 timeEnd 為合法且未逾期): 視同系統服務用途, 名稱 no name
        //(尚未定案之舊列依升級前規則即時判定, 逾期 / 無 timeEnd 者已失效, 見 unit-appUpgrade.test.mjs)
        let lg = addApp(env, 't-lg', undefined, 'u-a')
        lg.timeEnd = '2099-01-01T00:00:00.000+08:00'
        delete lg.appName
        assert.deepStrictEqual([(await env.p.getUserByToken('tk-t-lg')).id, (await env.p.getUserByToken('tk-t-lg')).name], ['app:t-lg', 'no name'])
    })

    it('AU-11 [決定 2] 使用者用途每次使用皆依所綁使用者當前狀態: 停用 / 封鎖 / 帳號到期 / 未驗證 / 不存在即不可用, 恢復即可用; 不看 timeEnd', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        let future = '2030-01-01T00:00:00.000+08:00'
        let past = '2020-01-01T00:00:00.000+08:00'
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-au')), null)
        for (let [patch, restore] of [
            [{ isActive: 'n' }, { isActive: 'y' }],
            [{ timeBlocked: future }, { timeBlocked: '' }],
            [{ timeExpired: past }, { timeExpired: '' }],
            [{ timeVerified: '' }, { timeVerified: '2026-01-01T00:00:00.000+08:00' }],
        ]) {
            setUsers(env, 'u-a', patch)
            assert.strictEqual(await errOf(env.p.checkToken('tk-t-au')), 'tokenExpired', JSON.stringify(patch))
            assert.strictEqual(await errOf(env.p.getUserByToken('tk-t-au')) !== null, true, JSON.stringify(patch))
            setUsers(env, 'u-a', restore)
            assert.strictEqual(await errOf(env.p.checkToken('tk-t-au')), null, `恢復 ${JSON.stringify(restore)}`)
        }
        let u = env.users.get('u-a')
        env.users.kp.delete('u-a')
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-au')), 'tokenExpired', '不存在')
        env.users.kp.set('u-a', u)
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-au')), null)
    })

    it('AU-12 [決定 3] 系統服務用途不隨擁有者(建立者)狀態: 擁有者停用 / 刪除 / 空字串皆仍可用', async function() {
        let env = mkEnvSso()
        addApp(env, 't-as', 'system', 'u-a')
        setUsers(env, 'u-a', { isActive: 'n' })
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-as')), null)
        env.users.kp.delete('u-a')
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-as')), null)
        env.tokens.kp.set('t-as', { ...env.tokens.get('t-as'), userId: '' })
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-as')), null)
    })

    it('AU-13 [決定 3] 授權: 使用者用途依所綁使用者角色(perms 不適用); 系統服務用途依 perms; 用途值未登錄 fail closed', async function() {
        let env = mkEnvSso()
        let isAdminFun = (tk, u) => u.isAdmin === 'y'
        addApp(env, 't-au-n', 'user', 'u-a')
        addApp(env, 't-au-y', 'user', 'u-admin', { perms: [] })
        addApp(env, 't-as-r', 'system', 'u-a', { perms: ['readIps'] })
        addApp(env, 't-bad', 'weird', 'u-admin', { perms: ['readIps'] })
        let gate = (tk) => errOf(env.p.checkToken(tk, { fun: isAdminFun, perm: 'readIps' }))
        assert.strictEqual(await gate('tk-t-au-n'), 'tokenExpired', '綁一般使用者: 管理服務不可')
        assert.strictEqual(await gate('tk-t-au-y'), null, '綁系統管理者: 管理服務可(即使 perms 為空)')
        assert.strictEqual(await gate('tk-t-as-r'), null, '系統服務用途具 readIps')
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-as-r', { fun: isAdminFun, perm: 'readTokens' })), 'tokenExpired', '缺 perm')
        assert.strictEqual(await gate('tk-t-bad'), 'tokenExpired', '未登錄之用途值')
        assert.strictEqual(await errOf(env.p.checkToken('tk-t-bad')), 'tokenExpired')
    })

    it('AU-14 [決定 4] refreshToken: 應用系統金鑰一律 tokenAppNoRefresh(不給期限), timeEnd 不變; 使用者 token 照常; 使用者不可用者不得續期', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a')
        for (let tk of ['tk-t-au', 'tk-t-as', 'tk-app1']) {
            assert.strictEqual(await errOf(env.p.refreshToken(tk)), 'tokenAppNoRefresh', tk)
        }
        assert.strictEqual(env.tokens.get('t-au').timeEnd, '')
        assert.strictEqual(await errOf(env.p.refreshToken('tk-a1')), null)
        setUsers(env, 'u-a', { timeBlocked: '2030-01-01T00:00:00.000+08:00' })
        assert.strictEqual(await errOf(env.p.refreshToken('tk-a1')), 'tokenExpired', 'S-4: 被封鎖者不可續期')
    })

    it('AU-15 [決定 3] changePassword: 系統服務用途 tokenUserOnly; 使用者用途作用於所綁使用者(須舊密碼)', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a')
        assert.strictEqual(await errOf(env.p.checkTokenAndChangePassword('tk-t-as', 'eng', PW_INIT, 'New@5678')), 'tokenUserOnly')
        assert.strictEqual(await errOf(env.p.checkTokenAndChangePassword('tk-t-au', 'eng', 'Wrong@0000', 'New@5678')), 'userChangePasswordIncorrectOld')
        let pw0 = env.users.get('u-a').password
        let pwB = env.users.get('u-b').password
        assert.strictEqual(await errOf(env.p.checkTokenAndChangePassword('tk-t-au', 'eng', PW_INIT, 'New@5678')), null)
        assert.notStrictEqual(env.users.get('u-a').password, pw0, '所綁使用者密碼已變更')
        assert.strictEqual(env.users.get('u-b').password, pwB, '他人不變')
    })

    it('AU-16 [決定 4] 撤銷範圍: revokeTokensByUserId 預設只撤登入 token; includeAppUser 另撤綁其之使用者用途金鑰; 系統服務用途(含擁有者欄為該使用者者)與既有列一律不撤', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a')
        addApp(env, 't-lg', undefined, 'u-a')
        addApp(env, 't-au-b', 'user', 'u-b')
        assert.strictEqual(await env.p.revokeTokensByUserId('u-a'), 1, '預設: 僅 t-a1')
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.ok(env.tokens.get('t-au') && env.tokens.get('t-as') && env.tokens.get('t-lg'))
        assert.strictEqual(await env.p.revokeTokensByUserId('u-a', { includeAppUser: true }), 1, 'includeAppUser: 另撤 t-au')
        assert.strictEqual(env.tokens.get('t-au'), undefined)
        assert.ok(env.tokens.get('t-as') && env.tokens.get('t-lg') && env.tokens.get('t-au-b'), '系統服務用途、既有列、他人之金鑰不動')
    })

    it('AU-17 [決定 5] 清單存檔自我保護: 使用者用途操作者即所綁使用者, 不得刪除 / 降權 / 停用自己; 系統服務用途操作者無此限', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-admin', { perms: [] })
        addApp(env, 't-as', 'system', 'u-a', { perms: ['writeUsers'] })
        let rows = async () => (await env.p.getUsersList()).sort((a, b) => a.order - b.order)
        let put = (tk, mutate) => async () => {
            let rs = await rows()
            mutate(rs)
            return errOf(env.p.checkTokenAndUpdateUsersList(tk, 'eng', rs, { fun: (t, u) => u.isAdmin === 'y', perm: 'writeUsers' }))
        }
        assert.strictEqual(await put('tk-t-au', (rs) => rs.splice(rs.findIndex((u) => u.id === 'u-admin'), 1))(), 'cannotDeleteSelf')
        assert.strictEqual(await put('tk-t-au', (rs) => {
            rs.find((u) => u.id === 'u-admin').isAdmin = 'n'
        })(), 'cannotDemoteSelf')
        assert.strictEqual(await put('tk-t-au', (rs) => {
            rs.find((u) => u.id === 'u-admin').isActive = 'n'
        })(), 'cannotDisableSelf')
        assert.strictEqual(await put('tk-t-as', (rs) => {
            rs.find((u) => u.id === 'u-admin').isActive = 'n'
        })(), null, '系統服務用途無「自己」')
        assert.strictEqual(env.users.get('u-admin').isActive, 'n')
    })

    it('AU-18 [決定 2] S-5 查他人: 目標權杖逾期 / 查無 / 其使用者不可用 → checkTokenAndGetUserByToken 回 null(對外固定鍵 tokenNoPermission); 目標為應用系統金鑰時依用途回身分', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a', { appName: 'svc' })
        let q = (t) => env.p.checkTokenAndGetUserByToken('tk-admin', t)
        assert.strictEqual((await q('tk-b1')).id, 'u-b')
        assert.strictEqual((await q('tk-t-au')).id, 'u-a')
        assert.strictEqual((await q('tk-t-as')).id, 'app:t-as')
        env.tokens.kp.set('t-b1', { ...env.tokens.get('t-b1'), timeEnd: '2020-01-01T00:00:00.000+08:00' })
        assert.strictEqual(await q('tk-b1'), null, '逾期')
        assert.strictEqual(await q('tk-none'), null, '查無')
        setUsers(env, 'u-a', { isActive: 'n' })
        assert.strictEqual(await q('tk-t-au'), null, '所綁使用者停用')
        assert.strictEqual((await q('tk-t-as')).id, 'app:t-as', '系統服務用途不受影響')
    })

    it('AU-19 [決定 6、7] createAppToken: 權杖字串與主鍵伺服端產生、不給期限、擁有者依用途; 驗證失敗零寫入; 清單存檔不新增', async function() {
        let env = mkEnvSso()
        let n0 = env.tokens.kp.size
        let r = await env.p.createAppToken({ name: ' k1 ', usage: 'user', userId: 'u-a', token: 'x', id: 'y', timeEnd: '2030-01-01T00:00:00.000+08:00' }, { operatorId: 'u-admin' })
        let row = env.tokens.get(r.id)
        assert.deepStrictEqual([row.isApp, row.appUsage, row.appName, row.userId, row.timeEnd, row.perms], ['y', 'user', 'k1', 'u-a', '', []])
        assert.ok(r.token && r.token !== 'x' && r.id !== 'y')
        let r2 = await env.p.createAppToken({ name: 'k2', usage: 'system', perms: ['readStats', 'readIps'] }, { operatorId: 'u-admin' })
        assert.deepStrictEqual([env.tokens.get(r2.id).userId, env.tokens.get(r2.id).perms], ['u-admin', ['readIps', 'readStats']])
        assert.strictEqual(env.tokens.kp.size, n0 + 2)
        let bad = [
            [{ name: 'k', usage: 'user', userId: 'u-none' }, 'tokenAppUserInvalid'],
            [{ name: 'k', usage: 'user', userId: 'u-a', perms: ['readIps'] }, 'tokenAppPermsNotForUser'],
            [{ name: 'k', usage: 'system', userId: 'u-a' }, 'tokenAppUserNotForSystem'],
            [{ name: 'k', usage: 'system', perms: ['x'] }, 'tokenPermsInvalid'],
            [{ name: '', usage: 'system' }, 'tokenAppNameInvalid'],
            [{ name: 'k', usage: '' }, 'tokenAppUsageInvalid'],
        ]
        setUsers(env, 'u-b', { isActive: 'n' })
        bad.push([{ name: 'k', usage: 'user', userId: 'u-b' }, 'tokenAppUserInvalid'])
        for (let [data, key] of bad) {
            assert.strictEqual(await errOf(env.p.createAppToken(data, { operatorId: 'u-admin' })), key, JSON.stringify(data))
        }
        assert.strictEqual(env.tokens.kp.size, n0 + 2, '驗證失敗零寫入')
    })

    it('AU-20 [決定 2、外審 sol#4] 即時判準與登入一致: 舊格式驗證時間(非空、非 timemsTZ)可登入者其 token 不得被判失效; isActive 非 n 即可; 使用者用途與系統服務用途不看過去之 timeEnd', async function() {
        let env = mkEnvSso()
        addApp(env, 't-au', 'user', 'u-a')
        addApp(env, 't-as', 'system', 'u-a')
        setUsers(env, 'u-a', { timeVerified: '2026-09-01 12:00:00' }) //舊版 now2str 秒級格式, 登入以 isestr 判已驗證
        for (let tk of ['tk-a1', 'tk-t-au', 'tk-t-as']) {
            assert.strictEqual(await errOf(env.p.checkToken(tk)), null, `${tk} 舊格式驗證時間仍可用`)
        }
        //timeEnd 在過去: 登入 token 逾期, 應用系統金鑰(兩種用途)不看 timeEnd
        let past = '2020-01-01T00:00:00.000+08:00'
        for (let id of ['t-au', 't-as']) {
            env.tokens.kp.set(id, { ...env.tokens.get(id), timeEnd: past })
            assert.strictEqual(await errOf(env.p.checkToken(`tk-${id}`)), null, `${id} 過去之 timeEnd 不影響`)
        }
        env.tokens.kp.set('t-a1', { ...env.tokens.get('t-a1'), timeEnd: past })
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired', '登入 token 逾期')
    })

    it('AU-21 [決定 6、外審 sol#1] createAppToken 綁定值含會被 XSS 清除改寫之標記: 拒絕(驗證所綁之使用者須即實際寫入者)', async function() {
        let env = mkEnvSso()
        env.users.kp.set('<x>u', { ...env.users.get('u-a'), id: '<x>u', account: 'xx' })
        let n0 = env.tokens.kp.size
        assert.strictEqual(await errOf(env.p.createAppToken({ name: 'k', usage: 'user', userId: '<x>u' }, { operatorId: 'u-admin' })), 'tokenAppUserInvalid')
        assert.strictEqual(env.tokens.kp.size, n0, '零寫入')
    })

    it('AU-22 [決定 6、外審 sol#10] createAppToken 寫入以 reject(null) / reject(undefined) 失敗: 不得誤報成功, 回 tokenAppCreateFailed 且不留列', async function() {
        for (let bad of [null, undefined, 0, '']) {
            let env = mkEnvSso()
            let n0 = env.tokens.kp.size
            env.tokens.insert = async () => Promise.reject(bad)
            assert.strictEqual(await errOf(env.p.createAppToken({ name: 'k', usage: 'system', perms: [] }, { operatorId: 'u-admin' })), 'tokenAppCreateFailed', `reject(${String(bad)})`)
            assert.strictEqual(env.tokens.kp.size, n0)
        }
    })

    it('AU-23 [決定 4、外審 sol#11] 系統服務用途之呼叫統計以其應用系統身分記錄(app:<主鍵>), 不記建立者; 使用者 token 與使用者用途記使用者', async function() {
        let env = mkEnvSso()
        addApp(env, 't-as', 'system', 'u-a', { appName: 'svc-name' })
        addApp(env, 't-au', 'user', 'u-b')
        for (let tk of ['tk-t-as', 'tk-t-au', 'tk-a1']) {
            await env.p.checkToken(tk)
        }
        let who = env.srLog.logs.info.filter((o) => o.event === 'fun-checkToken').map((o) => o.userId)
        assert.deepStrictEqual(who, ['app:t-as', 'u-b', 'u-a'])
    })

})
