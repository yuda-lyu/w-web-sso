//unit-passwordSession.test.mjs — 改密碼後之 session 處置 (R-SESS-01; sso-run04 第 117 項; 使用者 2026-10-23 裁示, 依 OWASP ASVS「改密碼後提供終止其他所有 session」)
//
// 依據(規則來源):
//   - 使用者原文:「系統管理者重設時撤銷對方全部 session; 自己改密碼時保留目前 session、撤銷其他 session」
//   - spec/流程_後台重設使用者密碼.md〈改密碼後之 session 處置〉、spec/流程_使用者變更密碼.md 同節; spec/設計要點與取捨.md ADR-093
//   - 規則帳本 sgud/rule/rulebook_security.md R-SESS-01
// 規則(每個 it 的標題註明對應句):
//   S1 系統管理者(或具 writeUsers 之 app 權杖)重設他人密碼 → 撤銷對方全部 session 權杖(isApp !== 'y')
//   S2 使用者自行改密碼 → 保留發出此請求之目前 session, 撤銷該使用者其他所有 session 權杖
//   S3 只撤銷 session 權杖: app 權杖(isApp === 'y', 含擁有者為該使用者者)不是 session, 不撤銷
//   S4 密碼寫入與撤銷在 [tokens, users] 同一組表鎖內; 密碼變更必伴隨撤銷(撤銷失敗 → 密碼不變)
//   S5 被撤銷之權杖立即無效(checkToken 拒絕)
//   S6 驗證未通過(舊密碼錯、新密碼不合策略)時不撤銷任何權杖
// 作法: 真實 procCore + 真實 w-serv-orm 表鎖 + 替身資料表(test/tools/unitEnv.mjs), 不起 server; 真後端之端到端見 api-passwordsession.

import assert from 'assert'
import { mkEnvSso, mkToken, errOf, snapTables, holdLocks, track, sleep, PW_INIT } from './tools/unitEnv.mjs'
import { verifyPassword } from '../server/hashPassword.mjs'
import { mkOpt } from './tools/unitProc.mjs'


let NEW_PW = 'New@5678'


//ids: 某表中屬於某使用者(userId)之權杖主鍵(排序)
let idsOf = (env, userId, pred = () => true) => {
    return [...env.tokens.kp.values()].filter((t) => t.userId === userId && pred(t)).map((t) => t.id).sort()
}
let sessionIdsOf = (env, userId) => idsOf(env, userId, (t) => t.isApp !== 'y')
let appIdsOf = (env, userId) => idsOf(env, userId, (t) => t.isApp === 'y')


//mkEnv: 基本種子(t-a1 為 u-a 之目前 session) + u-a 另有 2 個 session(t-a2 / t-a3)與 1 個以 u-a 為擁有者之 app 權杖(t-a-app)
//+ 具 writeUsers 之 app 權杖(tk-appw, 虛擬使用者 id-app-w, 供「app 權杖重設他人密碼」)
async function mkEnv() {
    let env = mkEnvSso()
    await env.tokens.insert([
        mkToken('t-a2', 'tk-a2', 'u-a'),
        mkToken('t-a3', 'tk-a3', 'u-a'),
        mkToken('t-a-app', 'tk-a-app', 'u-a', { isApp: 'y', perms: [] }),
        mkToken('t-appw', 'tk-appw', 'id-app-w', { isApp: 'y', perms: ['writeUsers'] }),
    ])
    return env
}


describe('改密碼後之 session 處置 (R-SESS-01, ADR-093)', function() {

    it('PS-U-001 [S1、S5] 系統管理者重設他人密碼 → 對方全部 session(t-a1、t-a2、t-a3)被撤銷, checkToken 皆拒; 對方之 app 權杖、他人 session、系統管理者自己之 session 不動', async function() {
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')
        assert.deepStrictEqual(r, { state: 'success' })
        assert.notStrictEqual(env.users.get('u-a').password, pw0, '密碼已重設')
        assert.strictEqual(env.users.get('u-a').isForceChangePw, 'y', '強制下次登入改密碼不變')
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [], '對方全部 session 被撤銷')
        for (let tk of ['tk-a1', 'tk-a2', 'tk-a3']) {
            assert.strictEqual(await errOf(env.p.checkToken(tk)), 'tokenExpired', `${tk} 立即無效`)
        }
        assert.deepStrictEqual(appIdsOf(env, 'u-a'), ['t-a-app'], '以對方為擁有者之 app 權杖不是 session, 不撤銷')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a-app')), null, 'app 權杖仍可用')
        assert.ok(env.tokens.get('t-b1'), '他人(u-b)之 session 不動')
        assert.ok(env.tokens.get('t-admin'), '系統管理者自己之 session 不動')
        assert.ok(env.tokens.get('t-app1') && env.tokens.get('t-app2') && env.tokens.get('t-appw'), '其他 app 權杖不動')
    })

    it('PS-U-002 [S1] 具 writeUsers 之 app 權杖重設他人密碼 → 同樣撤銷對方全部 session, app 權杖(含呼叫者自己)不動', async function() {
        let env = await mkEnv()
        let r = await env.p.adminResetUserPassword('tk-appw', 'eng', 'u-a')
        assert.deepStrictEqual(r, { state: 'success' })
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [])
        assert.deepStrictEqual(appIdsOf(env, 'u-a'), ['t-a-app'])
        assert.ok(env.tokens.get('t-appw'), '呼叫之 app 權杖不動')
        assert.ok(env.tokens.get('t-b1') && env.tokens.get('t-admin'), '他人 session 不動')
    })

    it('PS-U-003 [S1] 重設對象沒有任何 session → 成功且不動任何權杖(冪等)', async function() {
        let env = mkEnvSso() // u-v 無任何權杖
        let snapBefore = snapTables(env).tokens
        let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-v')
        assert.deepStrictEqual(r, { state: 'success' })
        assert.deepStrictEqual(snapTables(env).tokens, snapBefore)
    })

    it('PS-U-004 [S2、S5] 使用者自行改密碼 → 發出請求之目前 session(t-a1)保留且仍可用; 其他 session(t-a2、t-a3)被撤銷; app 權杖與他人 session 不動', async function() {
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        await env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)
        assert.notStrictEqual(env.users.get('u-a').password, pw0, '密碼已變更')
        assert.strictEqual(env.users.get('u-a').isForceChangePw, 'n')
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), ['t-a1'], '只留目前 session')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), null, '目前 session 仍可用')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a2')), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a3')), 'tokenExpired')
        assert.deepStrictEqual(appIdsOf(env, 'u-a'), ['t-a-app'], 'app 權杖不撤銷')
        assert.ok(env.tokens.get('t-b1') && env.tokens.get('t-admin'), '他人 session 不動')
    })

    it('PS-U-005 [S2] 改密碼之呼叫者不是 t-a1 而是 t-a3 → 保留的是 t-a3(保留者隨呼叫之權杖, 不寫死)', async function() {
        let env = await mkEnv()
        await env.p.checkTokenAndChangePassword('tk-a3', 'eng', PW_INIT, NEW_PW)
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), ['t-a3'])
    })

    it('PS-U-006 [S2、S3、ADR-095] 使用者用途金鑰(綁 u-a)呼叫 changeUserPassword → 無「目前 session」可保留, u-a 全部 session 被撤銷, 金鑰本身不撤銷; 系統服務用途金鑰(擁有者欄為 u-a)一律拒絕 tokenUserOnly, 三表零變動', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        //系統服務用途(無 appUsage 之既有列視同系統服務用途): 不綁使用者, 無本人可改
        assert.strictEqual(await errOf(env.p.checkTokenAndChangePassword('tk-a-app', 'eng', PW_INIT, NEW_PW)), 'tokenUserOnly')
        assert.deepStrictEqual(snapTables(env), before, '系統服務用途被拒, 三表零變動')
        //使用者用途: 綁 u-a, 須舊密碼, 作用於所綁使用者
        env.tokens.kp.set('t-a-app', { ...env.tokens.get('t-a-app'), appUsage: 'user' })
        await env.p.checkTokenAndChangePassword('tk-a-app', 'eng', PW_INIT, NEW_PW)
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [])
        assert.deepStrictEqual(appIdsOf(env, 'u-a'), ['t-a-app'])
        assert.strictEqual(await errOf(env.p.checkToken('tk-a-app')), null)
    })

    it('PS-U-007 [S6] 舊密碼錯 → 拒絕, 密碼不變且不撤銷任何權杖', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        let err = await errOf(env.p.checkTokenAndChangePassword('tk-a1', 'eng', 'Wrong@0000', NEW_PW))
        assert.strictEqual(err, 'userChangePasswordIncorrectOld')
        assert.deepStrictEqual(snapTables(env), before, '三表零變動')
    })

    it('PS-U-008 [S6] 新密碼不合策略 → 拒絕, 密碼不變且不撤銷任何權杖', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        let err = await errOf(env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'short'))
        assert.ok(String(err).startsWith('userPassword_'), `err=${err}`)
        assert.deepStrictEqual(snapTables(env), before)
    })

    it('PS-U-009 [S6] 系統管理者重設: 對自己 / 目標不存在 → 拒絕, 不撤銷任何權杖', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        assert.strictEqual(await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-admin')), 'adminResetPasswordCannotResetSelf')
        assert.strictEqual(await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-none')), 'adminResetPasswordUserNotFound')
        assert.strictEqual(await errOf(env.p.adminResetUserPassword('tk-a1', 'eng', 'u-b')), 'tokenExpired', '非系統管理者: 與其他管理入口同鍵(S-2)')
        assert.deepStrictEqual(snapTables(env), before)
    })

    it('PS-U-010 [S4] 撤銷失敗(tokens 刪除逐筆失敗) → 系統管理者重設整體拒絕且密碼不變(密碼變更必伴隨撤銷)', async function() {
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        env.tokens.fail.del.add('t-a2')
        let err = await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a'))
        assert.strictEqual(err, 'adminResetPasswordFailed')
        assert.strictEqual(env.users.get('u-a').password, pw0, '密碼不變')
        assert.strictEqual(env.users.get('u-a').isForceChangePw, 'n', '強制旗標不變')
        assert.strictEqual(env.mails.length, 0, '未寄出新密碼信')
        //部分撤銷之狀態(外審 nemotron#1 補): 逐筆刪除成功者之權杖已無效, 刪除失敗者(t-a2)仍在; 密碼不變, 使用者以原密碼可重新登入
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired', '已撤銷者立即無效')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a3')), 'tokenExpired', '已撤銷者立即無效')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a2')), null, '刪除失敗者仍在')
    })

    it('PS-U-011 [S4] 撤銷失敗 → 使用者自行改密碼整體拒絕且密碼不變', async function() {
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        env.tokens.fail.del.add('t-a2')
        let err = await errOf(env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW))
        assert.strictEqual(err, 'userChangePasswordFail')
        assert.strictEqual(env.users.get('u-a').password, pw0)
        assert.strictEqual(env.mails.length, 0, '未寄「密碼已變更」信')
        assert.ok(env.tokens.get('t-a1'), '目前 session 仍在')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), null, '目前 session 仍可用')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a3')), 'tokenExpired', '已撤銷者(逐筆刪除成功)立即無效(外審 nemotron#1 補)')
    })

    it('PS-U-012 [S4] 密碼寫入失敗 → 拒絕(fail closed: 不會出現「密碼已變更但舊 session 仍有效」; 此時舊 session 可能已先撤銷, 密碼不變)', async function() {
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        env.users.fail.save.add('u-a')
        let err = await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a'))
        assert.strictEqual(err, 'adminResetPasswordFailed')
        assert.strictEqual(env.users.get('u-a').password, pw0)
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [], '撤銷先於密碼寫入: 寫入失敗時 session 已撤銷(使用者須重新登入, 密碼不變), 為 fail closed 方向')
        assert.strictEqual(env.mails.length, 0, '未寄出新密碼信')
        let env2 = await mkEnv()
        let pw1 = env2.users.get('u-a').password
        env2.users.fail.save.add('u-a')
        let err2 = await errOf(env2.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW))
        assert.strictEqual(err2, 'userChangePasswordFail')
        assert.strictEqual(env2.users.get('u-a').password, pw1)
        assert.deepStrictEqual(sessionIdsOf(env2, 'u-a'), ['t-a1'], '目前 session 仍在, 其他 session 已撤銷')
        assert.strictEqual(env2.mails.length, 0, '未寄「密碼已變更」信')
        assert.strictEqual(await errOf(env2.p.checkToken('tk-a2')), 'tokenExpired', '已撤銷者立即無效(外審 nemotron#1 補)')
        assert.strictEqual(await errOf(env.p.checkToken('tk-a1')), 'tokenExpired', '系統管理者重設寫入失敗時 session 已先撤銷(fail closed, 使用者以原密碼重新登入)')
    })

    it('PS-U-013 [S4] 取鎖: 他人持有 tokens 表鎖時, 系統管理者重設與自行改密碼皆須等待(兩把鎖 [tokens, users] 任一被占用皆等待), 且等待期間 users / tokens 皆不先寫', async function() {
        for (let held of [['tokens'], ['users']]) {
            for (let [label, trigger] of [
                ['adminReset', (env) => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')],
                ['changePassword', (env) => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)],
            ]) {
                let env = await mkEnv()
                let h = await holdLocks(env, held)
                let w0 = env.users.calls.save + env.tokens.calls.del
                let t = track(Promise.resolve().then(() => trigger(env)))
                await sleep(80)
                assert.ok(!t.state.done, `${label} hold[${held}]: 他人持鎖時不得完成`)
                assert.strictEqual(env.users.calls.save + env.tokens.calls.del, w0, `${label} hold[${held}]: 他人持鎖期間不得先寫`)
                h.release()
                await h.done
                await t.pm
                assert.ok(t.state.ok, `${label} hold[${held}]: 放行後應完成, err=${String(t.state.err)}`)
                assert.deepStrictEqual(sessionIdsOf(env, 'u-a').filter((id) => id !== 't-a1'), [], `${label}: 放行後撤銷已完成`)
            }
        }
    })

    it('PS-U-014 [S4] 競態(登入排在重設之前): 登入先取得 tokens 鎖並建立新 session, 其後重設撤銷之 → 重設完成後 u-a 無任何 session', async function() {
        let env = await mkEnv()
        let h = await holdLocks(env, ['tokens'])
        let pmLogin = track(Promise.resolve().then(() => env.p.loginByAccountAndPassword('auser', PW_INIT)))
        await sleep(30)
        let pmReset = track(Promise.resolve().then(() => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')))
        await sleep(30)
        h.release()
        await h.done
        await Promise.all([pmLogin.pm, pmReset.pm])
        assert.ok(pmLogin.state.ok, `login err=${String(pmLogin.state.err)}`)
        assert.ok(pmReset.state.ok, `reset err=${String(pmReset.state.err)}`)
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [], '登入建立之新 session 亦被重設撤銷')
    })

    it('PS-U-015 [S4] 競態(重設排在登入之前): 以舊密碼通過驗證之登入, 於重設完成後取得鎖時被拒(鎖內再判密碼未變) → 無任何 session', async function() {
        let env = await mkEnv()
        let h = await holdLocks(env, ['tokens'])
        let pmReset = track(Promise.resolve().then(() => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')))
        await sleep(30)
        let pmLogin = track(Promise.resolve().then(() => env.p.loginByAccountAndPassword('auser', PW_INIT)))
        await sleep(30)
        h.release()
        await h.done
        await Promise.all([pmLogin.pm, pmReset.pm])
        assert.ok(pmReset.state.ok, `reset err=${String(pmReset.state.err)}`)
        assert.ok(!pmLogin.state.ok, '以舊密碼之登入被拒')
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [])
    })

    it('PS-U-018 [S4] 競態(外審 nemotron#2 補): 系統管理者重設與同一使用者自行改密碼並行(兩者 kmx 鍵不同, 僅靠表鎖序列化)——兩種次序之終態皆守不變式, 後寫者勝', async function() {
        //次序一: 自行改密碼先取得鎖(成功, 保留 t-a1) → 系統管理者重設後取得鎖: 密碼為重設值(isForceChangePw y)、t-a1 亦被撤銷, 無任何 session
        let env = await mkEnv()
        let h = await holdLocks(env, ['tokens'])
        let pmChange = track(Promise.resolve().then(() => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)))
        await sleep(40)
        let pmReset = track(Promise.resolve().then(() => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')))
        await sleep(40)
        h.release()
        await h.done
        await Promise.all([pmChange.pm, pmReset.pm])
        assert.ok(pmChange.state.ok, `change err=${String(pmChange.state.err)}`)
        assert.ok(pmReset.state.ok, `reset err=${String(pmReset.state.err)}`)
        assert.strictEqual(env.users.get('u-a').isForceChangePw, 'y', '後寫者(重設)勝')
        assert.strictEqual(verifyPassword(NEW_PW, env.users.get('u-a').password, mkOpt().salt), false, '自行改之密碼被重設覆寫')
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), [], '重設撤銷全部 session(含自行改密碼時保留之 t-a1)')

        //次序二: 系統管理者重設先取得鎖 → 自行改密碼後取得鎖: 鎖內驗舊密碼已不符, 被拒, 不撤銷(已無 session 可撤), 密碼為重設值
        let env2 = await mkEnv()
        let h2 = await holdLocks(env2, ['tokens'])
        let pmReset2 = track(Promise.resolve().then(() => env2.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')))
        await sleep(40)
        let pmChange2 = track(Promise.resolve().then(() => env2.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)))
        await sleep(40)
        h2.release()
        await h2.done
        await Promise.all([pmReset2.pm, pmChange2.pm])
        assert.ok(pmReset2.state.ok, `reset err=${String(pmReset2.state.err)}`)
        assert.strictEqual(pmChange2.state.err, 'tokenExpired', '重設先取得鎖並撤銷全部 session, 後到之改密碼於鎖內再驗權杖即被拒(外審 sol#1; 未有此驗證時為舊密碼不符)')
        assert.strictEqual(env2.users.get('u-a').isForceChangePw, 'y')
        assert.deepStrictEqual(sessionIdsOf(env2, 'u-a'), [])
    })

    it('PS-U-019 [S5] 鎖內再驗呼叫權杖(外審 sol#1): 鎖外 checkToken 通過後、等鎖期間該 session 被撤銷 → 請求拒絕(tokenExpired), 密碼不變、不再撤銷他人', async function() {
        //(a) 直接模擬等鎖期間被撤銷
        let env = await mkEnv()
        let pw0 = env.users.get('u-a').password
        let h = await holdLocks(env, ['tokens'])
        let pm = track(Promise.resolve().then(() => env.p.checkTokenAndChangePassword('tk-a2', 'eng', PW_INIT, NEW_PW)))
        await sleep(60)
        env.tokens.kp.delete('t-a2') //等鎖期間 t-a2 被撤銷(如另一請求或系統管理者重設)
        h.release()
        await h.done
        await pm.pm
        assert.strictEqual(pm.state.err, 'tokenExpired', '被撤銷之權杖不得再改密碼')
        assert.strictEqual(env.users.get('u-a').password, pw0, '密碼不變')
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), ['t-a1', 't-a3'], '不再撤銷他人')
        assert.strictEqual(env.mails.length, 0)

        //(b) 外審情境: 同使用者兩個 session 並行改密碼(新舊密碼相同, 使第二次之舊密碼比對仍過): 第一個保留自己、撤銷第二個; 第二個於鎖內被拒, 不得連第一個也撤銷
        let env2 = await mkEnv()
        let h2 = await holdLocks(env2, ['tokens'])
        let pm1 = track(Promise.resolve().then(() => env2.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, PW_INIT)))
        await sleep(60)
        let pm2 = track(Promise.resolve().then(() => env2.p.checkTokenAndChangePassword('tk-a2', 'eng', PW_INIT, NEW_PW)))
        await sleep(60)
        h2.release()
        await h2.done
        await Promise.all([pm1.pm, pm2.pm])
        assert.ok(pm1.state.ok, `s1 err=${String(pm1.state.err)}`)
        assert.strictEqual(pm2.state.err, 'tokenExpired', 's2 之權杖已被 s1 之改密碼撤銷')
        assert.deepStrictEqual(sessionIdsOf(env2, 'u-a'), ['t-a1'], '最終保留第一個請求之 session')
        assert.strictEqual(verifyPassword(PW_INIT, env2.users.get('u-a').password, mkOpt().salt), true)
    })

    it('PS-U-020 [S4] 撤銷以 reject(null) / reject(undefined) 失敗(外審 sol#2): 仍視為失敗, 不寫密碼、不回報成功', async function() {
        for (let rej of [null, undefined]) {
            let env = await mkEnv()
            let pw0 = env.users.get('u-a').password
            env.tokens.del = async () => Promise.reject(rej)
            let err = await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a'))
            assert.strictEqual(err, 'adminResetPasswordFailed', `reject(${rej}) 系統管理者重設`)
            assert.strictEqual(env.users.get('u-a').password, pw0)
            assert.strictEqual(env.mails.length, 0)
            let env2 = await mkEnv()
            let pw1 = env2.users.get('u-a').password
            env2.tokens.del = async () => Promise.reject(rej)
            let err2 = await errOf(env2.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW))
            assert.strictEqual(err2, 'userChangePasswordFail', `reject(${rej}) 自行改密碼`)
            assert.strictEqual(env2.users.get('u-a').password, pw1)
            assert.strictEqual(env2.mails.length, 0)
        }
    })

    it('PS-U-021 [S4] 撤銷與密碼寫入之間不得插入以舊密碼通過驗證之登入(外審 sol#5): 於撤銷進行中(持鎖)觸發登入, 該登入須待密碼寫入後於鎖內被拒; 兩入口皆然', async function() {
        for (let [label, run, keep] of [
            ['changePassword', (env) => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW), ['t-a1']],
            ['adminReset', (env) => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a'), []],
        ]) {
            let env = await mkEnv()
            let delOrig = env.tokens.del
            let pmLogin = null
            env.tokens.del = async (...a) => {
                //撤銷進行中: 觸發同使用者之登入(舊密碼仍正確), 待其通過驗證並排入 tokens 鎖之等待佇列後, 才讓撤銷完成
                pmLogin = track(Promise.resolve().then(() => env.p.loginByAccountAndPassword('auser', PW_INIT)))
                await sleep(400)
                return delOrig.apply(env.tokens, a)
            }
            await run(env)
            await pmLogin.pm
            assert.ok(!pmLogin.state.ok, `${label}: 以舊密碼之登入須被拒(鎖內再判密碼已變), 實際成功=${JSON.stringify(pmLogin.state.value)}`)
            assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), keep, `${label}: 無任何以舊密碼取得之 session`)
        }
    })

    it('PS-U-016 既有語意不變: 重設後以舊密碼不可驗證; 使用者改密碼後新密碼可驗證; 信件照寄(重設一封、改密碼一封)', async function() {
        let env = await mkEnv()
        await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')
        assert.strictEqual(verifyPassword(PW_INIT, env.users.get('u-a').password, mkOpt().salt), false)
        assert.strictEqual(env.mails.length, 1)
        let env2 = await mkEnv()
        await env2.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)
        assert.strictEqual(verifyPassword(NEW_PW, env2.users.get('u-a').password, mkOpt().salt), true)
        assert.strictEqual(env2.mails.length, 1)
    })

    it('PS-U-017 [S3] 取樣: 權杖逾期(timeEnd 已過)之其他 session 亦被撤銷(以 userId 與 isApp 判定, 不看是否逾期); 未逾期之目前 session 保留', async function() {
        let env = await mkEnv()
        await env.tokens.save({ id: 't-a2', timeEnd: '2000-01-01T00:00:00.000+08:00' })
        await env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, NEW_PW)
        assert.deepStrictEqual(sessionIdsOf(env, 'u-a'), ['t-a1'])
    })

})
