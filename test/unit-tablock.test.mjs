//unit-tablock.test.mjs — 寫入站點之表鎖 (每表一鍵、全實例共用; 多人同時編輯之寫入契約 §7、§13 V14)
//
// 依據:
//   - 規格 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §7(鎖)、§13 V14(並行: 比對與寫入間不可能插入他人寫入)
//   - 規則帳本 sgud/rule/rulebook_concurrency.md R-CONC-01: server/ 之 19 個 ORM 寫入站點 S01~S19 全數在該表表鎖內執行
// 作法(人為延遲, 同 V14): 由測試以 withTabLocks(與 procCore / procProtect 同一組鎖管理器)持有該表之鎖 → 觸發站點 →
//   斷言「站點未完成、該表無任何寫入」→ 放行 → 站點完成且已寫入. 無鎖之站點在持鎖期間即寫入或完成而失敗.
// 站點編號見帳本 R-CONC-01 表(S10~S14 為 updateTabItems 之 users / tokens / ips 三路徑各自之刪除 / 新增 / 修改).

import assert from 'assert'
import { mkEnvSso, mkProtect, mkUser, mkToken, errOf, writesOf, writesAll, holdLocks, track, sleep, PW_INIT } from './tools/unitEnv.mjs'
import { baselineOfUsers } from '../src/baselineOf.mjs'


//rowsOf: 清單頁送回之整表(使用者清單已剝除 password)
let rowsOf = async (env, name) => {
    let rs = await env.p[`get${name}List`]()
    return rs.sort((a, b) => (a.order || 0) - (b.order || 0))
}


//tbl: 表名 → 資料表替身
let tbl = (env, name) => env[name]


//assertWaits: 他人持有 tables 之表鎖時, 站點(trigger)須等待而不先寫; 放行後完成並寫入 writeTables 至少一表
async function assertWaits(label, env, tables, writeTables, trigger, opt = {}) {
    let h = await holdLocks(env, tables)
    let w0 = writeTables.map((n) => writesOf(tbl(env, n)))
    let t = track(Promise.resolve().then(trigger))
    await sleep(80)
    assert.ok(!t.state.done, `${label}: 他人持表鎖 [${tables.join(',')}] 時站點不得完成(value=${JSON.stringify(t.state.value)}, err=${String(t.state.err)})`)
    writeTables.forEach((n, i) => {
        assert.strictEqual(writesOf(tbl(env, n)), w0[i], `${label}: 他人持鎖期間不得先寫 ${n}`)
    })
    h.release()
    await h.done
    await t.pm
    if (opt.expectErr !== undefined) {
        assert.strictEqual(t.state.err, opt.expectErr, `${label}: 放行後之結果`)
    }
    else {
        assert.ok(t.state.ok, `${label}: 放行後應完成, 實際 err=${String(t.state.err)}`)
    }
    if (opt.expectWrite !== false) {
        assert.ok(writeTables.some((n, i) => writesOf(tbl(env, n)) > w0[i]), `${label}: 放行後應寫入 ${writeTables.join('/')}`)
    }
    return t.state
}


describe('19 個 server 寫入站點皆在表鎖內 (R-CONC-01, V14)', function() {

    it('SITE-LOCK-S01 loginByAccountAndPassword → createToken (tokens insert)', async function() {
        let env = mkEnvSso()
        let st = await assertWaits('S01', env, ['tokens'], ['tokens'], () => env.p.loginByAccountAndPassword('buser', PW_INIT))
        assert.ok(st.value.token)
    })

    it('SITE-LOCK-S02 refreshToken (tokens save)', async function() {
        let env = mkEnvSso()
        await assertWaits('S02', env, ['tokens'], ['tokens'], () => env.p.refreshToken('tk-a1'))
    })

    it('SITE-LOCK-S03 logoutByToken (tokens del)', async function() {
        let env = mkEnvSso()
        await assertWaits('S03', env, ['tokens'], ['tokens'], () => env.p.logoutByToken('tk-a1'))
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
    })

    it('SITE-LOCK-S04 createUser (users insert; 唯一性檢查與 insert 同鎖)', async function() {
        let env = mkEnvSso()
        await assertWaits('S04', env, ['users'], ['users'], () => env.p.createUser('eng', { account: 'dupone', name: 'dupone', email: 'dupone@example.com', password: 'Zq#8765Wm', confirmPassword: 'Zq#8765Wm' }))
        assert.ok([...env.users.kp.values()].some((u) => u.account === 'dupone'))
    })

    it('SITE-LOCK-S05 verifyEmail (users save timeVerified)', async function() {
        let env = mkEnvSso()
        await assertWaits('S05', env, ['users'], ['users'], () => env.p.verifyEmail('tv-1'))
        assert.ok(env.users.get('u-v').timeVerified !== '')
    })

    it('SITE-LOCK-S06 resendVerifyEmail (users save tokenVerify)', async function() {
        let env = mkEnvSso()
        await assertWaits('S06', env, ['users'], ['users'], () => env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com'))
        assert.notStrictEqual(env.users.get('u-v').tokenVerify, 'tv-1')
    })

    it('SITE-LOCK-S07 checkTokenAndChangePassword (users save password)', async function() {
        let env = mkEnvSso()
        let pw0 = env.users.get('u-a').password
        await assertWaits('S07', env, ['users'], ['users'], () => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678'))
        assert.notStrictEqual(env.users.get('u-a').password, pw0)
    })

    it('SITE-LOCK-S08 adminResetUserPassword (users save password)', async function() {
        let env = mkEnvSso()
        await assertWaits('S08', env, ['users'], ['users'], () => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-b'))
        assert.strictEqual(env.users.get('u-b').isForceChangePw, 'y')
    })

    it('SITE-LOCK-S09 revokeTokensByUserId (tokens del; 持鎖版供上游同鎖使用)', async function() {
        let env = mkEnvSso()
        let st = await assertWaits('S09', env, ['tokens'], ['tokens'], () => env.p.revokeTokensByUserId('u-a'))
        assert.strictEqual(st.value, 1)
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
    })

    it('SITE-LOCK-S10 updateTabItems 刪除: users([tokens, users] 兩把鎖任一被占用皆等待)、tokens、ips', async function() {
        for (let held of [['users'], ['tokens']]) {
            let env = mkEnvSso()
            let rows = (await rowsOf(env, 'Users')).filter((r) => r.id !== 'u-b')
            await assertWaits(`S10 users del hold[${held}]`, env, held, ['users'], () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined))
            assert.strictEqual(env.users.get('u-b'), undefined)
            assert.strictEqual(env.tokens.get('t-b1'), undefined, '同鎖撤銷被刪使用者之 token')
        }
        let env2 = mkEnvSso()
        let rowsT = (await rowsOf(env2, 'Tokens')).filter((r) => r.id !== 't-app2')
        await assertWaits('S10 tokens del', env2, ['tokens'], ['tokens'], () => env2.p.checkTokenAndUpdateTokensList('tk-admin', rowsT, {}, undefined))
        let env3 = mkEnvSso()
        let rowsI = (await rowsOf(env3, 'Ips')).filter((r) => r.id !== 'ip-2')
        await assertWaits('S10 ips del', env3, ['ips'], ['ips'], () => env3.p.checkTokenAndUpdateIpsList('tk-admin', rowsI, {}, undefined))
    })

    it('SITE-LOCK-S11 updateTabItems tokens 新增(鑄造應用系統金鑰, keepUserId)', async function() {
        let env = mkEnvSso()
        let rows = await rowsOf(env, 'Tokens')
        rows.push(mkToken('t-new', 'tk-new', 'id-app-new', { isApp: 'y', perms: ['readStats'] }))
        await assertWaits('S11', env, ['tokens'], ['tokens'], () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined))
        assert.strictEqual(env.tokens.get('t-new').userId, 'id-app-new')
    })

    it('SITE-LOCK-S12 updateTabItems users / ips 新增', async function() {
        let env = mkEnvSso()
        let rows = await rowsOf(env, 'Users')
        rows.push({ ...mkUser('u-n', 'nuser', 5), password: 'Zq#8765Wm', _isNew: true })
        await assertWaits('S12 users', env, ['users'], ['users'], () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined))
        assert.ok(env.users.get('u-n'))
        let env2 = mkEnvSso()
        let rowsI = await rowsOf(env2, 'Ips')
        rowsI.push({ id: 'ip-n', ip: '10.0.0.9', timeBlocked: '' })
        await assertWaits('S12 ips', env2, ['ips'], ['ips'], () => env2.p.checkTokenAndUpdateIpsList('tk-admin', rowsI, {}, undefined))
        assert.ok(env2.ips.get('ip-n'))
    })

    it('SITE-LOCK-S13 updateTabItems tokens 權限縮短之前置清空(perms:null)與整列修改', async function() {
        let env = mkEnvSso()
        let rows = (await rowsOf(env, 'Tokens')).map((r) => (r.id === 't-app1' ? { ...r, perms: [] } : r))
        env.tokens.log.save.length = 0
        await assertWaits('S13', env, ['tokens'], ['tokens'], () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined))
        let payloads = env.tokens.log.save
        assert.ok(payloads.some((pl) => pl.some((v) => v.id === 't-app1' && v.perms === null)), '前置清空之寫入')
        assert.deepStrictEqual(env.tokens.get('t-app1').perms, [])
    })

    it('SITE-LOCK-S14 updateTabItems users / tokens / ips 整列修改', async function() {
        let env = mkEnvSso()
        let rows = (await rowsOf(env, 'Users')).map((r) => (r.id === 'u-a' ? { ...r, name: 'edit' } : r))
        await assertWaits('S14 users', env, ['users'], ['users'], () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined))
        assert.strictEqual(env.users.get('u-a').name, 'edit')
        let rowsT = (await rowsOf(env, 'Tokens')).map((r) => (r.id === 't-app1' ? { ...r, perms: ['readIps'] } : r))
        await assertWaits('S14 tokens', env, ['tokens'], ['tokens'], () => env.p.checkTokenAndUpdateTokensList('tk-admin', rowsT, {}, undefined))
        let rowsI = (await rowsOf(env, 'Ips')).map((r) => (r.id === 'ip-1' ? { ...r, ip: '10.9.9.9' } : r))
        await assertWaits('S14 ips', env, ['ips'], ['ips'], () => env.p.checkTokenAndUpdateIpsList('tk-admin', rowsI, {}, undefined))
    })

    it('SITE-LOCK-S15 blockAccount 登入失敗達門檻(users save timeBlocked 與撤銷 token 同在 [tokens, users] 鎖內)', async function() {
        for (let held of [['users'], ['tokens']]) {
            let env = mkEnvSso()
            let { pp } = mkProtect(env)
            await assertWaits(`S15 hold[${held}]`, env, held, ['users', 'tokens'], async () => {
                for (let i = 0; i < 2; i++) {
                    await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))
                }
            })
            assert.ok(env.users.get('u-a').timeBlocked !== '')
            assert.strictEqual(env.tokens.get('t-a1'), undefined)
        }
    })

    it('SITE-LOCK-S16 blockAccountByToken 權杖呼叫次數超限(計時器)', async function() {
        for (let held of [['users'], ['tokens']]) {
            let env = mkEnvSso()
            let { pp, timers } = mkProtect(env)
            await pp.callApiByToken('tk-a1')
            await pp.callApiByToken('tk-a1')
            await assertWaits(`S16 hold[${held}]`, env, held, ['users', 'tokens'], () => timers[1]())
            assert.ok(env.users.get('u-a').timeBlocked !== '')
            assert.strictEqual(env.tokens.get('t-a1'), undefined)
        }
    })

    it('SITE-LOCK-S17 blockIpByIp 未登記 IP 超限(ips insert)', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        await pp.callApiByIp('10.0.0.9')
        await pp.callApiByIp('10.0.0.9')
        await assertWaits('S17', env, ['ips'], ['ips'], () => timers[3]())
        let v = [...env.ips.kp.values()].find((x) => x.ip === '10.0.0.9')
        assert.ok(v && v.timeBlocked !== '')
        assert.strictEqual(v.userIdUpdate, 'system')
    })

    it('SITE-LOCK-S18 blockIpByIp 已登記 IP 超限(ips save timeBlocked)', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        await pp.callApiByIp('10.0.0.1')
        await pp.callApiByIp('10.0.0.1')
        await assertWaits('S18', env, ['ips'], ['ips'], () => timers[3]())
        assert.ok(env.ips.get('ip-1').timeBlocked !== '')
        assert.strictEqual(env.ips.get('ip-1').userIdUpdate, 'system')
    })

    it('SITE-LOCK-S19 ipDetectNew 計時器登錄新 IP(ips insert)', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env)
        await pp.callApiByIp('10.0.0.50')
        await assertWaits('S19', env, ['ips'], ['ips'], () => timers[2]())
        let v = [...env.ips.kp.values()].find((x) => x.ip === '10.0.0.50')
        assert.ok(v)
        assert.strictEqual(v.userIdUpdate, 'system')
    })

})


describe('站點之全部寫入皆發生在自己持有的表鎖內 (R-CONC-01; 外審 sol#12)', function() {

    //上列 SITE-LOCK-S01~S19 只驗「他人持鎖時站點會等待」, 抓不到「先空取鎖再釋放、於鎖外做原讀寫」這類錯誤實作;
    //本案不另持鎖直接執行各站點, 以 mkEnvSso({ trackLocks: true }) 記錄每次寫入當下該表鎖是否被站點自己持有
    it('SITE-LOCK-W01 S01~S19 每個站點執行時, 其 insert / save / del 無一發生在未持該表表鎖時', async function() {
        let sites = [
            ['S01 login', async (env) => () => env.p.loginByAccountAndPassword('buser', PW_INIT)],
            ['S02 refreshToken', async (env) => () => env.p.refreshToken('tk-a1')],
            ['S03 logoutByToken', async (env) => () => env.p.logoutByToken('tk-a1')],
            ['S04 createUser', async (env) => () => env.p.createUser('eng', { account: 'dupone', name: 'dupone', email: 'dupone@example.com', password: 'Zq#8765Wm', confirmPassword: 'Zq#8765Wm' })],
            ['S05 verifyEmail', async (env) => () => env.p.verifyEmail('tv-1')],
            ['S06 resendVerifyEmail', async (env) => () => env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com')],
            ['S07 changePassword', async (env) => () => env.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678')],
            ['S08 adminResetUserPassword', async (env) => () => env.p.adminResetUserPassword('tk-admin', 'eng', 'u-b')],
            ['S09 revokeTokensByUserId', async (env) => () => env.p.revokeTokensByUserId('u-a')],
            ['S10 users del', async (env) => {
                let rows = (await rowsOf(env, 'Users')).filter((r) => r.id !== 'u-b')
                return () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined)
            }],
            ['S10 tokens del', async (env) => {
                let rows = (await rowsOf(env, 'Tokens')).filter((r) => r.id !== 't-app2')
                return () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined)
            }],
            ['S10 ips del', async (env) => {
                let rows = (await rowsOf(env, 'Ips')).filter((r) => r.id !== 'ip-2')
                return () => env.p.checkTokenAndUpdateIpsList('tk-admin', rows, {}, undefined)
            }],
            ['S11 tokens add', async (env) => {
                let rows = await rowsOf(env, 'Tokens')
                rows.push(mkToken('t-new', 'tk-new', 'id-app-new', { isApp: 'y', perms: ['readStats'] }))
                return () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined)
            }],
            ['S12 users add', async (env) => {
                let rows = await rowsOf(env, 'Users')
                rows.push({ ...mkUser('u-n', 'nuser', 5), password: 'Zq#8765Wm', _isNew: true })
                return () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined)
            }],
            ['S12 ips add', async (env) => {
                let rows = await rowsOf(env, 'Ips')
                rows.push({ id: 'ip-n', ip: '10.0.0.9', timeBlocked: '' })
                return () => env.p.checkTokenAndUpdateIpsList('tk-admin', rows, {}, undefined)
            }],
            ['S13 tokens perms 縮短', async (env) => {
                let rows = (await rowsOf(env, 'Tokens')).map((r) => (r.id === 't-app1' ? { ...r, perms: [] } : r))
                return () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined)
            }],
            ['S14 users mod', async (env) => {
                let rows = (await rowsOf(env, 'Users')).map((r) => (r.id === 'u-a' ? { ...r, name: 'edit' } : r))
                return () => env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined)
            }],
            ['S14 tokens mod', async (env) => {
                let rows = (await rowsOf(env, 'Tokens')).map((r) => (r.id === 't-app1' ? { ...r, perms: ['readIps'] } : r))
                return () => env.p.checkTokenAndUpdateTokensList('tk-admin', rows, {}, undefined)
            }],
            ['S14 ips mod', async (env) => {
                let rows = (await rowsOf(env, 'Ips')).map((r) => (r.id === 'ip-1' ? { ...r, ip: '10.9.9.9' } : r))
                return () => env.p.checkTokenAndUpdateIpsList('tk-admin', rows, {}, undefined)
            }],
            ['S15 blockAccount', async (env, pp) => async () => {
                for (let i = 0; i < 2; i++) {
                    await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))
                }
            }],
            ['S16 blockAccountByToken', async (env, pp, timers) => {
                await pp.callApiByToken('tk-a1')
                await pp.callApiByToken('tk-a1')
                return () => timers[1]()
            }],
            ['S17 blockIpByIp 新增', async (env, pp, timers) => {
                await pp.callApiByIp('10.0.0.9')
                await pp.callApiByIp('10.0.0.9')
                return () => timers[3]()
            }],
            ['S18 blockIpByIp 修改', async (env, pp, timers) => {
                await pp.callApiByIp('10.0.0.1')
                await pp.callApiByIp('10.0.0.1')
                return () => timers[3]()
            }],
            ['S19 ipDetectNew', async (env, pp, timers) => {
                await pp.callApiByIp('10.0.0.50')
                return () => timers[2]()
            }],
        ]
        for (let [label, mkTrigger] of sites) {
            let env = mkEnvSso({ trackLocks: true })
            let { pp, timers } = mkProtect(env)
            let trigger = await mkTrigger(env, pp, timers)
            let w0 = writesAll(env)
            let err = await errOf(trigger())
            assert.strictEqual(err, null, `${label}: 站點應成功, 實際 ${String(err)}`)
            assert.ok(writesAll(env) > w0, `${label}: 站點應有寫入`)
            assert.deepStrictEqual(env.outsideWrites, [], `${label}: 全部寫入皆在自己持有的表鎖內`)
        }
    })

})


describe('表鎖之範圍與次序', function() {

    it('SITE-LOCK-G01 每表一鍵: 他人持有 ips 表鎖時, users / tokens 站點不受影響', async function() {
        let env = mkEnvSso()
        let h = await holdLocks(env, ['ips'])
        await env.p.refreshToken('tk-a1')
        await env.p.verifyEmail('tv-1')
        let rows = (await rowsOf(env, 'Users')).map((r) => (r.id === 'u-a' ? { ...r, name: 'edit' } : r))
        await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows, {}, undefined)
        h.release()
        await h.done
        assert.strictEqual(env.users.get('u-a').name, 'edit')
    })

    it('SITE-LOCK-G02 同表寫入者互斥且 FIFO: 後到之站點在先到者完成後才寫', async function() {
        let env = mkEnvSso()
        let h = await holdLocks(env, ['tokens'])
        let order = []
        let a = env.p.refreshToken('tk-a1').then(() => order.push('refresh'))
        await sleep(10)
        let b = env.p.logoutByToken('tk-a1').then(() => order.push('logout'))
        await sleep(30)
        assert.deepStrictEqual(order, [])
        h.release()
        await h.done
        await a
        await b
        assert.deepStrictEqual(order, ['refresh', 'logout'])
    })

    it('SITE-LOCK-G03 多表鎖次序固定(碼元序 tokens 先於 users): 各站點交錯並行不死結', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let a = await rowsOf(env, 'Users')
        let work = []
        for (let i = 0; i < 4; i++) {
            work.push(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', a.map((r) => (r.id === 'u-a' ? { ...r, name: `n${i}` } : r)), {}, undefined).catch((e) => e))
            work.push(env.p.revokeTokensByUserId('u-b').catch((e) => e))
            work.push(env.p.refreshToken('tk-a1').catch((e) => e))
            work.push(env.p.verifyEmail('tv-1').catch((e) => e))
            work.push(pp.loginByAccountAndPassword('buser', 'Wrong@0000').catch((e) => e))
        }
        let r = await Promise.race([Promise.all(work).then(() => 'done'), sleep(8000).then(() => 'deadlock')])
        assert.strictEqual(r, 'done')
    })

    it('SITE-LOCK-G04 [V14] 比對與寫入間插不進他人寫入: 管理員以舊基準存檔讀取後暫停期間, 他人之同表寫入(外部同步型整段 delAll+insert、系統直寫)必須等待', async function() {
        let env = mkEnvSso()
        let a = await rowsOf(env, 'Users')
        let baseline = baselineOfUsers(a)
        let orig = env.users.select
        let gate = null
        let pmGate = new Promise((resolve) => {
            gate = resolve
        })
        let entered = null
        let pmEntered = new Promise((resolve) => {
            entered = resolve
        })
        let armed = true
        env.users.select = async (...x) => {
            let r = await orig.apply(env.users, x)
            if (armed && x.length === 0) {
                armed = false
                entered()
                await pmGate
            }
            return r
        }
        let save = track(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', a.map((r) => (r.id === 'u-a' ? { ...r, name: 'edit' } : r)), {}, { baseline }))
        await pmEntered
        //外部同步型整段寫入(delAll + insert)須取同一把表鎖
        let sync = track(env.serv.withTabLocks(['users'], async () => {
            await env.procOrm('sync', 'users', 'save', [{ id: 'u-b', name: 'by-sync' }], { mustExist: true })
        }))
        let verify = track(env.p.verifyEmail('tv-1'))
        await sleep(80)
        assert.ok(!sync.state.done && !verify.state.done, '他人寫入等待')
        assert.strictEqual(env.users.get('u-b').name, 'buser')
        gate()
        await save.pm
        await sync.pm
        await verify.pm
        assert.ok(save.state.ok, '管理員之比對與寫入未被插隊, 成功')
        assert.strictEqual(env.users.get('u-b').name, 'by-sync')
        env.users.select = orig
    })

})
