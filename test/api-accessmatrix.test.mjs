//api-accessmatrix.test.mjs — 後端存取矩陣: 入口 × 呼叫者 (dspec w-web存取管控表.md 第一節 1.2, ADR-095)
//
// 依據:
//   - C:\opensrcOper\dspec\w-web存取管控表.md 第一節 1.2「後端入口」之每一格(目標); 呼叫者 5 類: 無 token(無)、使用者 token 一般(U)、使用者 token 管理員(A)、
//     應用系統 token・使用者用途(AU: 綁一般使用者 AU-U / 綁管理員 AU-A)、應用系統 token・系統服務用途(AS: 具所需 perm AS+ / 缺所需 perm AS-)
//   - 使用者身分驗證原則.md 二之一: AU 能用之服務＝所綁使用者以自己之使用者 token 能用者(含改自己密碼), 不給期限不能續期; AS＝管理員之服務, 依 perms 收窄(ADR-069), 無「本人」之服務(不得改密碼)
// 作法: 真後端(11007)。每格(入口 × 呼叫者)前重置 base seed 並重建本檔 fixture(logout 類入口會刪 token, 故不共用), 每格後驗副作用(通過者須已生效、拒絕者不得有任何寫入)。
//   SMTP 導向 127.0.0.1:1(連線拒絕): 重設密碼寄信必敗而不外寄(寄信失敗不阻斷, 既有契約)。
// 不在本檔(刻意不測, 見報告輸入空間統計): `[sys:getTableTags]`、`[sys:polling]`(現全公開, 排程第 128 項〔C4〕另輪)、通訊路由 ulctr/slc/dwgfn/dwgf/dw(未註冊監聽, e2e/api 無從呼叫)、
//   `/api/cleanKp*`(固定權杖＋本機白名單, 不屬 token 呼叫者; api-httpendpoints / e2e 輔助已覆蓋)、UI 頁面格(1.1, 由 e2e 覆蓋)。
//   使用者狀態即時失效 / 恢復、鑄造驗證、清單存檔規則、舊列相容見 api-apptoken-usage.test.mjs。

import assert from 'assert'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, apiUrl, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'
import { NEW_PW, callers, insertFixtures, httpApi, getRowsForSave } from './tools/apiAccess.mjs'


let tally = { cells: 0, entries: 0, publicCells: 0 }
let seq = 0


//gate: 管理入口(需 perm): 使用者 token / 使用者用途依(所綁)使用者之管理員身分; 系統服務用途依 perms(readUsers 為基本權限恆具備)
function adminGate(perm) {
    return (c) => {
        if (c.kind === 'none') {
            return false
        }
        if (c.kind === 'appSystem') {
            return perm === 'readUsers' || c.perms.includes(perm)
        }
        return c.admin
    }
}

let notNone = (c) => c.kind !== 'none'


//entries: 存取表 1.2 之 token 入口(kpfun 與 HTTP); allow(c) 為存取表該格之 ✓/✗; denyErr(c) 為 ✗ 之固定對外鍵
let entries = [
    {
        key: 'HTTP checkToken',
        allow: notNone,
        run: (c) => httpApi('checkToken', { token: c.token }),
        checkOk: (c, r) => assert.strictEqual(r.val, true),
    },
    {
        key: 'kpfun checkToken',
        allow: notNone,
        run: (c) => callFapi('checkToken', [c.token]),
        checkOk: (c, r) => assert.strictEqual(r.val, true),
    },
    {
        key: 'HTTP refreshToken',
        allow: (c) => c.kind === 'user',
        denyErr: (c) => (c.kind === 'appUser' || c.kind === 'appSystem' ? 'tokenAppNoRefresh' : 'tokenExpired'),
        run: (c) => httpApi('refreshToken', { token: c.token }),
        checkOk: (c, r) => assert.ok(typeof r.val === 'string' && r.val.length > 0, '回新到期時間'),
        after: async (c, ok) => {
            let t = (await woItems.tokens.select({ token: c.token }))[0]
            if (c.kind === 'appUser' || c.kind === 'appSystem') {
                assert.strictEqual(t.timeEnd, '', '應用系統金鑰不給期限, timeEnd 不被續期改寫')
            }
        },
    },
    {
        key: 'kpfun refreshToken',
        allow: (c) => c.kind === 'user',
        denyErr: (c) => (c.kind === 'appUser' || c.kind === 'appSystem' ? 'tokenAppNoRefresh' : 'tokenExpired'),
        run: (c) => callFapi('refreshToken', [c.token]),
        checkOk: (c, r) => assert.ok(typeof r.val === 'string' && r.val.length > 0),
        after: async (c, ok) => {
            let t = (await woItems.tokens.select({ token: c.token }))[0]
            if (c.kind === 'appUser' || c.kind === 'appSystem') {
                assert.strictEqual(t.timeEnd, '')
            }
        },
    },
    {
        key: 'HTTP logoutByToken',
        allow: notNone,
        run: (c) => httpApi('logoutByToken', { token: c.token }),
        checkOk: (c, r) => assert.strictEqual(r.val, true),
        after: async (c, ok) => {
            assert.strictEqual((await woItems.tokens.select({ token: c.token })).length, ok ? 0 : (c.kind === 'none' ? 0 : 1), '登出刪除本 token')
        },
    },
    {
        key: 'kpfun logoutByToken',
        allow: notNone,
        run: (c) => callFapi('logoutByToken', [c.token]),
        checkOk: (c, r) => assert.strictEqual(r.val, true),
        after: async (c, ok) => {
            assert.strictEqual((await woItems.tokens.select({ token: c.token })).length, ok ? 0 : (c.kind === 'none' ? 0 : 1))
        },
    },
    {
        key: 'HTTP logoutSsoUser',
        allow: notNone,
        run: (c) => httpApi('logoutSsoUser', { token: c.token }),
        checkOk: (c, r) => assert.strictEqual(r.val, true),
        after: async (c, ok) => {
            assert.strictEqual((await woItems.tokens.select({ token: c.token })).length, ok ? 0 : (c.kind === 'none' ? 0 : 1))
        },
    },
    {
        key: 'kpfun getUserByToken(查自己)',
        allow: notNone,
        run: (c) => callFapi('getUserByToken', [c.token]),
        checkOk: (c, r) => {
            let u = r.val
            if (c.kind === 'user' || c.kind === 'appUser') {
                //使用者 token 與使用者用途: 所綁使用者之實際資料; 使用者用途另帶 isApp='y'
                assert.strictEqual(u.id, c.userId)
                assert.strictEqual(u.account, c.account)
                assert.strictEqual(u.isAdmin, c.admin ? 'y' : 'n')
                assert.strictEqual(u.isApp, c.kind === 'appUser' ? 'y' : 'n')
            }
            else {
                //系統服務用途: 應用系統身分, id 為 app:<tokens.id>(不取建立者), 名稱為金鑰名稱
                assert.strictEqual(u.id, c.token === 'm-as-all' ? 'app:id-m-as-all' : 'app:id-m-as-base')
                assert.strictEqual(u.name, c.token === 'm-as-all' ? 'as-all-name' : 'as-base-name')
                assert.strictEqual(u.isApp, 'y')
                assert.strictEqual(u.isAdmin, 'y')
            }
        },
    },
    {
        key: 'kpfun changeUserPassword',
        allow: (c) => c.kind === 'user' || c.kind === 'appUser',
        denyErr: (c) => (c.kind === 'appSystem' ? 'tokenUserOnly' : 'tokenExpired'),
        run: (c) => callFapi('changeUserPassword', [c.token, 'eng', c.pw || 'pw-viewer', NEW_PW]),
        after: async (c, ok) => {
            //通過者所綁使用者(本人)之密碼已變更, 拒絕者所有使用者之密碼皆不變
            let seed = [['id-for-viewer', 'ac-viewer', 'pw-viewer'], ['id-for-admin', 'ac-admin', 'pw-admin']]
            for (let [id, account, pw] of seed) {
                let changed = ok && c.userId === id
                let login = await callFapi('loginByAccountAndPassword', ['eng', account, changed ? NEW_PW : pw])
                assert.strictEqual(login.ok, true, `${account} 登入(${changed ? '新密碼' : '原密碼'}): ${JSON.stringify(login.err)}`)
            }
        },
    },
    {
        key: 'HTTP getSsoUserInfor(key=id)',
        allow: adminGate('readUsers'),
        run: (c) => httpApi('getSsoUserInfor', { token: c.token, key: 'id', value: 'id-for-viewer' }),
        checkOk: (c, r) => assert.strictEqual(r.val.account, 'ac-viewer'),
    },
    {
        key: 'HTTP getSsoUserInfor(key=token)',
        allow: adminGate('readUsers'),
        run: (c) => httpApi('getSsoUserInfor', { token: c.token, key: 'token', value: 'token-for-viewer' }),
        checkOk: (c, r) => assert.strictEqual(r.val.id, 'id-for-viewer'),
    },
    {
        key: 'HTTP getSsoUsersList',
        allow: adminGate('readUsers'),
        run: (c) => httpApi('getSsoUsersList', { token: c.token }),
        checkOk: (c, r) => assert.ok(r.val.some((u) => u.id === 'id-for-viewer')),
    },
    {
        key: 'kpfun getUserInfor',
        allow: adminGate('readUsers'),
        run: (c) => callFapi('getUserInfor', [c.token, 'id', 'id-for-viewer']),
        checkOk: (c, r) => assert.strictEqual(r.val.account, 'ac-viewer'),
    },
    {
        key: 'kpfun getUsersList',
        allow: adminGate('readUsers'),
        run: (c) => callFapi('getUsersList', [c.token]),
        checkOk: (c, r) => assert.ok(r.val.some((u) => u.id === 'id-for-viewer')),
    },
    {
        key: 'kpfun updateUsersList',
        allow: adminGate('writeUsers'),
        run: async (c, ctx) => {
            let rows = await getRowsForSave('users')
            rows.find((u) => u.id === ctx.targetId).description = `desc-by-${c.key}`
            return callFapi('updateUsersList', [c.token, 'eng', rows])
        },
        after: async (c, ok, ctx) => {
            let u = (await woItems.users.select({ id: ctx.targetId }))[0]
            assert.strictEqual(u.description, ok ? `desc-by-${c.key}` : 'desc-orig')
            assert.strictEqual((await woItems.users.select()).length, 5, '使用者筆數不變(整批存回不得誤刪)')
        },
    },
    {
        key: 'kpfun adminResetUserPassword',
        allow: adminGate('writeUsers'),
        run: (c, ctx) => callFapi('adminResetUserPassword', [c.token, 'eng', ctx.targetId]),
        checkOk: (c, r) => assert.strictEqual(r.val.state, 'success'),
        after: async (c, ok, ctx) => {
            let u = (await woItems.users.select({ id: ctx.targetId }))[0]
            assert.strictEqual(u.isForceChangePw, ok ? 'y' : 'n', '重設成功才標記強制變更密碼')
            assert.strictEqual(u.password !== 'not-used', ok, '重設成功才改寫密碼')
        },
    },
    {
        key: 'kpfun getTokensList',
        allow: adminGate('readTokens'),
        run: (c) => callFapi('getTokensList', [c.token]),
        checkOk: (c, r) => assert.ok(r.val.some((t) => t.token === 'm-probe')),
    },
    {
        key: 'kpfun updateTokensList',
        allow: adminGate('writeTokens'),
        run: async (c) => {
            let rows = await getRowsForSave('tokens')
            rows.find((t) => t.id === 'id-m-probe').perms = ['readStats']
            return callFapi('updateTokensList', [c.token, 'eng', rows])
        },
        after: async (c, ok) => {
            let t = (await woItems.tokens.select({ id: 'id-m-probe' }))[0]
            assert.deepStrictEqual(t.perms, ok ? ['readStats'] : [])
        },
    },
    {
        key: 'kpfun createAppToken',
        allow: adminGate('writeTokens'),
        run: (c) => callFapi('createAppToken', [c.token, 'eng', { name: `by-${c.key}`, usage: 'system', perms: [] }]),
        checkOk: (c, r) => assert.ok(typeof r.val.token === 'string' && r.val.token.length > 0),
        after: async (c, ok) => {
            let ts = (await woItems.tokens.select()).filter((t) => t.appName === `by-${c.key}`)
            assert.strictEqual(ts.length, ok ? 1 : 0, '鑄造成功才寫入')
        },
    },
    {
        key: 'kpfun getIpsList',
        allow: adminGate('readIps'),
        run: (c) => callFapi('getIpsList', [c.token]),
        checkOk: (c, r) => assert.ok(r.val.some((v) => v.id === 'id-m-ip')),
    },
    {
        key: 'kpfun updateIpsList',
        allow: adminGate('writeIps'),
        run: async (c) => {
            let rows = await getRowsForSave('ips')
            rows.find((v) => v.id === 'id-m-ip').ip = '192.0.2.11'
            return callFapi('updateIpsList', [c.token, 'eng', rows])
        },
        after: async (c, ok) => {
            let v = (await woItems.ips.select({ id: 'id-m-ip' }))[0]
            assert.strictEqual(v.ip, ok ? '192.0.2.11' : '192.0.2.10')
        },
    },
    ...['getStaUserSummary', 'getStaTokenSummary', 'getStaIpSummary', 'getStaUserAccountLogin', 'getStaToken', 'getStaIp'].map((fn) => ({
        key: `kpfun ${fn}`,
        allow: adminGate('readStats'),
        run: (c) => callFapi(fn, [c.token]),
    })),
]


describe('後端存取矩陣 — token 入口 × 呼叫者 (dspec 存取表 1.2; ADR-095)', function() {
    this.timeout(600000)

    before(async function() {
        await startServersOnce()
        //SMTP 導向必敗之 127.0.0.1:1: 重設密碼寄信失敗不阻斷(既有契約), 避免對外寄信
        await restartBackend(genTempSettings({}), {
            EM_SRC_HOST: '127.0.0.1',
            EM_SRC_PORT: '1',
            EM_SRC_PW: 'x',
            EM_SRC_EMAIL: 'example@gmail.com',
        })
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json')
    })

    for (let e of entries) {
        it(`MX[${e.key}]: 7 類呼叫者之通過 / 拒絕(對外固定鍵)與副作用符合存取表`, async function() {
            tally.entries++
            let miss = []
            for (let c of callers) {
                tally.cells++
                let ctx = { targetId: `id-m-target-${++seq}` }
                await resetToBaseSeed()
                await insertFixtures(ctx.targetId)
                let ok = e.allow(c)
                let r = await e.run(c, ctx)
                if (r.ok !== ok) {
                    miss.push(`[${c.key}] 預期${ok ? '通過' : '拒絕'}, 實際${r.ok ? '通過' : `拒絕(${r.err})`}`)
                    continue
                }
                try {
                    if (ok && e.checkOk) {
                        e.checkOk(c, r)
                    }
                    if (!ok) {
                        let denyErr = e.denyErr ? e.denyErr(c) : 'tokenExpired'
                        assert.strictEqual(r.err, denyErr, '拒絕之對外固定鍵')
                    }
                    if (e.after) {
                        await e.after(c, ok, ctx)
                    }
                }
                catch (err) {
                    miss.push(`[${c.key}] ${err.message}`)
                }
            }
            assert.strictEqual(miss.length, 0, `不符 ${miss.length} 格:\n  ${miss.join('\n  ')}`)
        })
    }

})


//「無」之子類(外審 sol 補格): 矩陣之「無 token」格只測空字串; 實際入口另會收到未知字串與已逾期之登入 token(含重複列、非字串由 _strictStr 等外層擋, 見 api-httpendpoints)。
//未知字串: 一律拒絕、對外固定鍵 tokenExpired(不洩漏 invalid token / duplicate tokens 等內部字串); 已逾期之登入 token: 管理 / 查詢類入口皆拒絕(同鍵),
//登出類入口例外——持有者清理自己已失效之 token(只刪本 token、不回任何資料、不行使任何能力), 屬刻意設計, 見 ADR-095 補記與報告 裁示項
describe('後端存取矩陣 — 失效 token 子類: 未知字串 / 已逾期登入 token × 全部 token 入口', function() {
    this.timeout(600000)

    let PAST = '2020-01-01T00:00:00.000+08:00'
    let dead = [
        { key: 'unknown', kind: 'none', token: 'no-such-token-0xdead', admin: false },
        { key: 'expired', kind: 'user', token: 'token-expired-admin', admin: true, userId: 'id-for-admin', account: 'ac-admin', pw: 'pw-admin' },
    ]

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
        await restartBackend('./settings.json')
    })

    for (let e of entries) {
        it(`MX-DEAD[${e.key}]: 未知字串與已逾期登入 token 之通過 / 拒絕(對外固定鍵)符合存取表(登出類例外)`, async function() {
            tally.entries2 = (tally.entries2 || 0) + 1
            let miss = []
            for (let c of dead) {
                tally.cells++
                tally.deadCells = (tally.deadCells || 0) + 1
                let ctx = { targetId: `id-m-target-${++seq}` }
                await resetToBaseSeed()
                await insertFixtures(ctx.targetId)
                let tk = ds.tokens.funNew({ userId: 'id-for-admin' })
                tk.token = 'token-expired-admin'
                tk.timeEnd = PAST
                await woItems.tokens.insert([tk])
                let ok = c.key === 'expired' && /logout/i.test(e.key)
                let r = await e.run(c, ctx)
                if (r.ok !== ok) {
                    miss.push(`[${c.key}] 預期${ok ? '通過' : '拒絕'}, 實際${r.ok ? '通過' : `拒絕(${r.err})`}`)
                    continue
                }
                try {
                    if (!ok) {
                        //既有契約(api-httpendpoints「refreshToken: 無效 token」、api-concurrency CC-A-009「重複登出」): 自行查表之三個本人入口
                        //(refreshToken / logoutByToken / logoutSsoUser)對「查無此權杖」回內部字串 'invalid token'(不經 checkToken 之收斂); 其餘入口與逾期登入 token 皆為 tokenExpired.
                        //此差異使呼叫者能區分「權杖不存在」與「已逾期」(列舉預言機, 權杖為 UUIDv7 128 bit 故實務利用空間小); 維持既有契約未改, 列 sso-run01 報告待裁示
                        let want = (c.key === 'unknown' && /refreshToken|logout/i.test(e.key)) ? 'invalid token' : 'tokenExpired'
                        assert.strictEqual(r.err, want, '拒絕之對外鍵')
                    }
                    if (e.after) {
                        await e.after(c, ok, ctx)
                    }
                }
                catch (err) {
                    miss.push(`[${c.key}] ${err.message}`)
                }
            }
            assert.strictEqual(miss.length, 0, `不符 ${miss.length} 格:\n  ${miss.join('\n  ')}`)
        })
    }

})


describe('後端存取矩陣 — 公開入口(1.2 前段): 呼叫者攜帶之 token 不影響, 與註冊開關 (S-6)', function() {
    this.timeout(300000)

    before(async function() {
        await startServersOnce()
        await restartBackend('./settings.json') //預設 allowUserRegistration=true
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures('id-m-target-pub')
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json')
    })

    it('MX-PUB-01 靜態檔 GET /: 7 類呼叫者(以 Authorization 標頭攜帶其 token)皆 200(伺服端不讀標頭 token 決定公開入口)', async function() {
        for (let c of callers) {
            tally.publicCells++
            let res = await fetch(`${apiUrl}/`, { headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} })
            assert.strictEqual(res.status, 200, c.key)
        }
    })

    it('MX-PUB-02 getWebInfor / checkUserPassword / loginByAccountAndPassword / [sys:getFuncList]: 不讀 token, 無 token 即可呼叫(呼叫者維度不適用, 各測一格)', async function() {
        tally.publicCells += 4
        let r1 = await callFapi('getWebInfor', [])
        assert.strictEqual(r1.ok, true)
        assert.strictEqual(r1.val.allowUserRegistration, true)
        let r2 = await callFapi('checkUserPassword', ['eng', NEW_PW])
        assert.strictEqual(r2.ok, true)
        assert.strictEqual(r2.val.state, 'success')
        let r3 = await callFapi('loginByAccountAndPassword', ['eng', 'ac-viewer', 'pw-viewer'])
        assert.strictEqual(r3.ok, true)
        assert.ok(r3.val.token)
        //[sys:getFuncList] 由 w-serv-webdata 之資料通道提供, api-setup 的 client 初始化即以它於無 token 下取得函數清單(callFapi 能呼叫上列函數即證明公開可呼叫)
    })

    it('MX-PUB-03 createUser / verifyEmail(HTTP、函數) / resendVerifyEmail: 註冊開啟時可呼叫(7 類呼叫者之 HTTP 格以 Authorization 標頭攜帶 token)', async function() {
        //verifyEmail HTTP: 準備一位未驗證使用者與其驗證權杖
        await woItems.users.save([{ id: 'id-for-basic', tokenVerify: 'tv-mx-1' }])
        for (let c of callers) {
            tally.publicCells++
            await woItems.users.save([{ id: 'id-for-basic', timeVerified: '', tokenVerify: 'tv-mx-1' }])
            let res = await fetch(`${apiUrl}/api/verifyEmail?token=tv-mx-1&lang=eng`, { headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} })
            let html = await res.text()
            assert.ok(html.includes('verified') || html.includes('Verified') || html.includes('success') || html.length > 0, c.key)
            let u = (await woItems.users.select({ id: 'id-for-basic' }))[0]
            assert.ok(u.timeVerified !== '', `${c.key}: 註冊開啟時驗證連結生效`)
        }
        tally.publicCells += 3
        let r1 = await callFapi('createUser', ['eng', 'ac-mx-new', NEW_PW, NEW_PW, 'mx new', 'mx-new@example.com'])
        assert.strictEqual(r1.ok, true, JSON.stringify(r1))
        await woItems.users.save([{ id: 'id-for-basic', timeVerified: '', tokenVerify: 'tv-mx-2' }])
        let r2 = await callFapi('verifyEmail', ['tv-mx-2'])
        assert.strictEqual(r2.ok, true, JSON.stringify(r2))
        let r3 = await callFapi('resendVerifyEmail', ['eng', 'ac-mx-new', 'mx-new@example.com'])
        //帳號 ac-mx-new 剛建立且未驗證: 走到功能本身——成功, 或寄信失敗(測試環境 SMTP 為 placeholder, userRegistrationResendFailed), 或 30 秒節流(userRegistrationResendThrottled);
        //不得是註冊開關拒絕, 亦不得是其他鍵(如 tokenExpired / 查無函數: 否則「不是 NotAllowed」不證明功能可用; 外審 sol#14)
        assert.ok(r3.ok === true || ['userRegistrationResendFailed', 'userRegistrationResendThrottled'].includes(r3.err), JSON.stringify(r3))
        //帳號 / email 不符走功能本身之統一拒絕鍵(防列舉), 證明入口在註冊開啟時確實進入重寄邏輯
        let r4 = await callFapi('resendVerifyEmail', ['eng', 'ac-mx-none', 'none@example.com'])
        assert.strictEqual(r4.err, 'userRegistrationResendInvalidEmail', JSON.stringify(r4))
    })

})


describe('後端存取矩陣 — 註冊關閉 (allowUserRegistration=false): 驗證信與重寄驗證信一併拒絕 (S-6, 原則 13「附屬入口隨主功能開關」)', function() {
    this.timeout(300000)

    before(async function() {
        await startServersOnce()
        await restartBackend(genTempSettings({ allowUserRegistration: false }))
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures('id-m-target-pub')
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json')
    })

    after(function() {
        console.log(`[access-matrix] token 入口 ${tally.entries} 個 × 呼叫者 ${callers.length} 類 = ${tally.entries * callers.length} 格 + 失效 token 子類(未知字串、已逾期登入 token) ${tally.deadCells || 0} 格 = ${tally.cells} 格已測; 公開入口格(含註冊開關) ${tally.publicCells}`)
    })

    it('MX-REG-01 createUser: 註冊關閉即拒絕 userRegistrationNotAllowed(既有行為, 對照)', async function() {
        tally.publicCells++
        let r = await callFapi('createUser', ['eng', 'ac-mx-new2', NEW_PW, NEW_PW, 'mx new2', 'mx-new2@example.com'])
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.err, 'userRegistrationNotAllowed')
    })

    it('MX-REG-02 verifyEmail(函數): 即使連結權杖有效亦拒絕固定鍵 userRegistrationNotAllowed, 使用者仍未驗證', async function() {
        tally.publicCells++
        await woItems.users.save([{ id: 'id-for-basic', timeVerified: '', tokenVerify: 'tv-reg-1' }])
        let r = await callFapi('verifyEmail', ['tv-reg-1'])
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.err, 'userRegistrationNotAllowed')
        let r2 = await callFapi('verifyEmail', ['tv-not-exist'])
        assert.strictEqual(r2.err, 'userRegistrationNotAllowed', '無效權杖亦同一固定鍵(不洩漏權杖有效與否)')
        assert.strictEqual((await woItems.users.select({ id: 'id-for-basic' }))[0].timeVerified, '', '未驗證')
    })

    it('MX-REG-03 verifyEmail(HTTP): 7 類呼叫者皆顯示「不開放註冊」結果頁, 不驗證; 成功文字不出現', async function() {
        await woItems.users.save([{ id: 'id-for-basic', timeVerified: '', tokenVerify: 'tv-reg-2' }])
        for (let lang of ['eng', 'cht']) {
            for (let c of callers) {
                tally.publicCells++
                let res = await fetch(`${apiUrl}/api/verifyEmail?token=tv-reg-2&lang=${lang}`, { headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} })
                let html = await res.text()
                let msg = lang === 'eng' ? 'User registration is not available.' : '目前不開放使用者自行申請帳號。'
                assert.ok(html.includes(msg), `${c.key}/${lang}: 結果頁應顯示不開放註冊訊息`)
                assert.strictEqual((await woItems.users.select({ id: 'id-for-basic' }))[0].timeVerified, '', `${c.key}/${lang}: 未驗證`)
            }
        }
    })

    it('MX-REG-04 resendVerifyEmail: 即使帳號 / 信箱相符且未驗證亦拒絕 userRegistrationNotAllowed, 不產新權杖', async function() {
        tally.publicCells++
        await woItems.users.save([{ id: 'id-for-basic', timeVerified: '', tokenVerify: 'tv-reg-3' }])
        let r = await callFapi('resendVerifyEmail', ['eng', 'ac-basic', 'basic@example.com'])
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.err, 'userRegistrationNotAllowed')
        assert.strictEqual((await woItems.users.select({ id: 'id-for-basic' }))[0].tokenVerify, 'tv-reg-3', '權杖未被更換')
    })

})
