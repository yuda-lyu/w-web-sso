//api-passwordsession.test.mjs — 改密碼後之 session 處置(R-SESS-01, ADR-093; sso-run04 第 117 項)之端到端守護: 真後端(11007) + 真資料庫 + 真傳輸(WServHapiClient), 不經 UI
//
// 依據:
//   - 使用者 2026-10-23 裁示(OWASP ASVS「改密碼後提供終止其他所有 session」):「管理員重設時撤銷對方全部 session; 自己改密碼時保留目前 session、撤銷其他 session」
//   - spec/流程_後台重設使用者密碼.md、spec/流程_使用者變更密碼.md〈改密碼後之 session 處置〉; ADR-093; 規則帳本 sgud/rule/rulebook_security.md R-SESS-01
// 作法: session 一律由真實登入(RPC loginByAccountAndPassword)取得; 「權杖是否有效」以對外同一入口 checkToken / getUserByToken 判定(被撤銷者回 tokenExpired);
// 重設 / 改密碼走實際 RPC(adminResetUserPassword / changeUserPassword). app 權杖以資料庫夾具建立(其產生途徑為後台金鑰清單, 與本規則無關).
// 管理員重設對同一對象有 30 秒節流(adminResetPasswordAlreadyTriggered), 故每案例用各自的被重設對象(mkTarget(key)).
// SMTP 導向 127.0.0.1:1(寄信必敗而不外寄, 寄信失敗不阻斷既有契約). 每案例前重置 base seed + 共用 fixture, 案例後只刪非 base seed(對齊其他 api 檔).
// 單元層(替身資料表, 含故障注入、鎖與競態)見 unit-passwordSession.

import assert from 'assert'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'


let SALT = '{salt}' //同 settings.json 之 salt 與 g_initialData
let ADMIN = 'token-for-admin' //base seed 之管理員 session 權杖(使用者 id-for-admin)
let TIME_END = '2030-01-01T00:00:00.000+08:00'
let TIME_OK = '2025-01-01T00:00:00.000+08:00'
let PW = 'Pw@PassSess1'
let PW_NEW = 'Zq#8765Wm'


function mkUserFx(key, ext = {}) {
    let account = `ac-ps-${key}`
    let v = ds.users.funNew({
        order: 900,
        account,
        password: hashPassword(PW, SALT),
        name: `ps ${key}`,
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
    v.id = `id-ps-${key}`
    v.timeVerified = TIME_OK
    return { ...v, ...ext }
}


function mkAppTokenFx(key, userId, perms) {
    let t = ds.tokens.funNew({ userId })
    t.id = `id-ps-${key}`
    t.token = `ps-${key}`
    t.isApp = 'y'
    t.perms = perms
    t.timeEnd = TIME_END
    return t
}


//mkTarget: 被重設 / 改密碼之使用者(帳號 ac-ps-<key>)與以其為擁有者之 app 權杖(權杖字串 ps-app-own-<key>); 回傳 { id, account, appToken }
async function mkTarget(key) {
    await woItems.users.insert([mkUserFx(key)])
    await woItems.tokens.insert([mkAppTokenFx(`app-own-${key}`, `id-ps-${key}`, [])])
    return { id: `id-ps-${key}`, account: `ac-ps-${key}`, appToken: `ps-app-own-${key}` }
}


//login: 真實登入取得 session 權杖
async function login(account, pw = PW) {
    let r = await callFapi('loginByAccountAndPassword', ['eng', account, pw])
    assert.strictEqual(r.ok, true, `login ${account}: ${JSON.stringify(r)}`)
    return r.val.token
}


//alive: 以對外 checkToken 判定權杖是否有效
async function alive(token) {
    let r = await callFapi('checkToken', [token])
    if (r.ok) {
        return true
    }
    assert.strictEqual(r.err, 'tokenExpired', `被撤銷 / 無效之權杖一律回 tokenExpired, 實際 ${JSON.stringify(r)}`)
    return false
}


//dbTokens: 某使用者名下全部權杖列(依權杖字串排序)
async function dbTokens(userId) {
    return (await woItems.tokens.select({ userId })).sort((a, b) => (a.token < b.token ? -1 : 1))
}


describe('改密碼後之 session 處置 (api, 真後端 / 真傳輸; R-SESS-01)', function() {
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
        //共用: 另一般使用者 b(其 session 不得受影響)、具 writeUsers 之 app 權杖(虛擬使用者 id-ps-appw)
        await woItems.users.insert([mkUserFx('b')])
        await woItems.tokens.insert([mkAppTokenFx('app-w', 'id-ps-appw', ['writeUsers'])])
    })

    afterEach(async function() {
        await deleteNonBaseSeed()
    })


    it('PSA-001 [管理員重設 → 對方全部 session 失效] 對方 3 個真實 session 皆被撤銷(checkToken 拒); 對方之 app 權杖、他人 session、管理員自己之 session 不受影響; 強制下次登入改密碼不變', async function() {
        let t = await mkTarget('t1')
        let s1 = await login(t.account)
        let s2 = await login(t.account)
        let s3 = await login(t.account)
        let sb = await login('ac-ps-b')
        for (let s of [s1, s2, s3, sb, ADMIN, t.appToken, 'ps-app-w']) {
            assert.strictEqual(await alive(s), true, '重設前皆有效')
        }
        let pw0 = (await woItems.users.select({ id: t.id }))[0].password
        let r = await callFapi('adminResetUserPassword', [ADMIN, 'eng', t.id])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        for (let s of [s1, s2, s3]) {
            assert.strictEqual(await alive(s), false, '對方 session 立即無效')
        }
        assert.deepStrictEqual((await dbTokens(t.id)).map((x) => x.token), [t.appToken], '庫內對方只剩 app 權杖')
        for (let s of [sb, ADMIN, t.appToken, 'ps-app-w']) {
            assert.strictEqual(await alive(s), true, '他人 session、管理員 session、app 權杖不受影響')
        }
        let u = (await woItems.users.select({ id: t.id }))[0]
        assert.notStrictEqual(u.password, pw0, '密碼已重設')
        assert.strictEqual(u.isForceChangePw, 'y', '強制下次登入改密碼不變')
        assert.strictEqual(u.userIdUpdate, 'id-for-admin', '更新者為操作管理員')
        let rLogin = await callFapi('loginByAccountAndPassword', ['eng', t.account, PW])
        assert.strictEqual(rLogin.ok, false, '舊密碼不可再登入')
    })

    it('PSA-002 [app 權杖(writeUsers)重設 → 對方全部 session 失效] app 權杖(含呼叫者與對方之 app 權杖)不受影響', async function() {
        let t = await mkTarget('t2')
        let s1 = await login(t.account)
        let s2 = await login(t.account)
        let r = await callFapi('adminResetUserPassword', ['ps-app-w', 'eng', t.id])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual(await alive(s1), false)
        assert.strictEqual(await alive(s2), false)
        assert.deepStrictEqual((await dbTokens(t.id)).map((x) => x.token), [t.appToken])
        assert.strictEqual(await alive('ps-app-w'), true)
        assert.strictEqual(await alive(t.appToken), true)
    })

    it('PSA-003 [自行改密碼 → 保留目前 session、撤銷其他 session] 以 s2 改密碼: s2 仍可用, s1 / s3 失效; app 權杖與他人 session 不動; 新密碼可登入、舊密碼被拒', async function() {
        let t = await mkTarget('t3')
        let s1 = await login(t.account)
        let s2 = await login(t.account)
        let s3 = await login(t.account)
        let sb = await login('ac-ps-b')
        let r = await callFapi('changeUserPassword', [s2, 'eng', PW, PW_NEW])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual(await alive(s2), true, '目前 session 仍可用')
        let ru = await callFapi('getUserByToken', [s2])
        assert.strictEqual(ru.ok, true, `目前 session 仍可取得使用者資訊: ${JSON.stringify(ru)}`)
        assert.strictEqual(ru.val.account, t.account)
        assert.strictEqual(await alive(s1), false)
        assert.strictEqual(await alive(s3), false)
        let rows = await dbTokens(t.id)
        assert.deepStrictEqual(rows.map((x) => x.token).sort(), [t.appToken, s2].sort(), '庫內只剩 app 權杖與目前 session')
        assert.strictEqual(await alive(t.appToken), true, 'app 權杖不撤銷')
        assert.strictEqual(await alive(sb), true, '他人 session 不動')
        let u = (await woItems.users.select({ id: t.id }))[0]
        assert.strictEqual(verifyPassword(PW_NEW, u.password, SALT), true, '新密碼已寫入')
        assert.strictEqual(u.userIdUpdate, t.id, '更新者記使用者本人')
        let rOld = await callFapi('loginByAccountAndPassword', ['eng', t.account, PW])
        assert.strictEqual(rOld.ok, false, '舊密碼被拒')
        let rNew = await callFapi('loginByAccountAndPassword', ['eng', t.account, PW_NEW])
        assert.strictEqual(rNew.ok, true, '新密碼可登入')
    })

    it('PSA-004 [驗證未過不撤銷] 舊密碼錯 → 拒絕, 3 個 session 全數仍有效且密碼不變', async function() {
        let t = await mkTarget('t4')
        let ss = [await login(t.account), await login(t.account), await login(t.account)]
        let pw0 = (await woItems.users.select({ id: t.id }))[0].password
        let r = await callFapi('changeUserPassword', [ss[0], 'eng', 'Wrong@0000', PW_NEW])
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.err, 'userChangePasswordIncorrectOld')
        for (let s of ss) {
            assert.strictEqual(await alive(s), true)
        }
        assert.strictEqual((await woItems.users.select({ id: t.id }))[0].password, pw0)
    })

    it('PSA-005 [重設後再登入再改密碼] 重設撤銷舊 session 後, 使用者重新登入產生之新 session, 於其自行改密碼時依規則保留目前者、撤銷其餘; 改密碼解除強制變更(不變)', async function() {
        let t = await mkTarget('t5')
        let old = await login(t.account)
        let r = await callFapi('adminResetUserPassword', [ADMIN, 'eng', t.id])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual(await alive(old), false)
        //新密碼為隨機值(寄信必敗不外寄); 以資料庫夾具模擬「使用者收信後以新密碼登入」: 把密碼寫成已知值(保持 isForceChangePw='y'), 其餘走真實入口
        await woItems.users.save({ id: t.id, password: hashPassword(PW, SALT), isForceChangePw: 'y' })
        let n1 = await login(t.account)
        let n2 = await login(t.account)
        let rc = await callFapi('changeUserPassword', [n1, 'eng', PW, PW_NEW])
        assert.strictEqual(rc.ok, true, JSON.stringify(rc))
        assert.strictEqual(await alive(n1), true)
        assert.strictEqual(await alive(n2), false)
        assert.strictEqual((await woItems.users.select({ id: t.id }))[0].isForceChangePw, 'n', '改密碼解除強制變更(不變)')
    })

    it('PSA-006 [app 權杖(擁有者為該使用者)呼叫 changeUserPassword] 無「目前 session」可保留 → 該使用者全部 session 失效, app 權杖本身不撤銷', async function() {
        let t = await mkTarget('t6')
        let s1 = await login(t.account)
        let s2 = await login(t.account)
        let r = await callFapi('changeUserPassword', [t.appToken, 'eng', PW, PW_NEW])
        assert.strictEqual(r.ok, true, JSON.stringify(r))
        assert.strictEqual(await alive(s1), false)
        assert.strictEqual(await alive(s2), false)
        assert.strictEqual(await alive(t.appToken), true)
        assert.deepStrictEqual((await dbTokens(t.id)).map((x) => x.token), [t.appToken])
    })

})
