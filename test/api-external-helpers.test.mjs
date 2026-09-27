//api-external-helpers.test.mjs — 外部系統直接調用之查詢 helper 契約測試
//
// 對象: src/getUserByToken.mjs / src/getUsersByToken.mjs / src/getUserByUserId.mjs
//   三支為套件對外提供、供外部系統於伺服端直接 import 呼叫, 內部以內建 fetch 打本套件 HTTP 端點 (ADR-056).
// 依據: spec/流程_查詢使用者資訊.md (HTTP /api/getSsoUserInfor 之權限與 {state,msg} 契約) + ADR-068 之 K 契約:
//   reject 一律為固定 key (不含網址與權杖), console 每次失敗一行且不含任何權杖字元.
//   2026-09-07 版本曾逐字斷言「含權杖之網址」為契約 (把外洩凍結成規格), 2026-09-24 依 ADR-068 改為 key + 負向斷言.
// 環境: 真後端 (startServersOnce) + base seed (resetToBaseSeed, g_initialData.mjs):
//   token-for-admin (admin user) / token-for-viewer (一般 user) / token-for-app (isApp='y', 無對應 user → 虛擬使用者).
//   HLP-UBT-012 另插一筆含保留字元之 token (after 以 deleteNonBaseSeed 清除), 其餘不建立資料.
//   不需後端之失敗點 (網址無法解析 / 非 JSON / 無資料 / 轉換拋錯 / 代入編碼) 見 unit-external-helpers.test.mjs.
//
// 涵蓋: HLP-UBT-001~012 (getUserByToken) / HLP-UST-001~005 (getUsersByToken) / HLP-UID-001~004 (getUserByUserId)

import assert from 'assert'
import util from 'util'
import ds from '../src/schema/index.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, apiUrl, resetToBaseSeed, deleteNonBaseSeed } from './tools/e2e-setup.mjs'
import getUserByToken from '../src/getUserByToken.mjs'
import getUsersByToken from '../src/getUsersByToken.mjs'
import getUserByUserId from '../src/getUserByUserId.mjs'


let urlByToken = `${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=token&value={token}`
let urlUsers = `${apiUrl}/api/getSsoUsersList?token={sysToken}`
let urlById = `${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=id&value={userId}`
let urlNoListen = `http://127.0.0.1:1/api/getSsoUserInfor?token={sysToken}&key=token&value={token}` //無服務之 port → 連線失敗
let urlNotFound = `${apiUrl}/api/noSuchEndpoint?token={sysToken}&key=token&value={token}` //Hapi 404 → 非 2xx

let SYS_ADMIN = 'token-for-admin'
let SYS_APP = 'token-for-app'
let TK_VIEWER = 'token-for-viewer'


//執行並攔下 console.log (helper 於失敗路徑印一行診斷); 回 { ok, v, out }
async function run(fn) {
    let lines = []
    let log = console.log
    console.log = (...a) => {
        lines.push(a.map((v) => (typeof v === 'string' ? v : util.inspect(v, { depth: 5 }))).join(' '))
    }
    let r
    try {
        r = { ok: true, v: await fn() }
    }
    catch (err) {
        r = { ok: false, v: err }
    }
    finally {
        console.log = log
    }
    r.out = lines.join('\n')
    return r
}


//reject 值與 console 皆不得含所用權杖之完整值 (ADR-068: helper 輸出不含任何權杖字元)
function assertNoToken(r, tokens) {
    let text = `${util.inspect(r.v, { depth: 5 })}\n${r.out}`
    for (let t of tokens) {
        assert.strict.equal(text.includes(t), false, `輸出含權杖 ${t}:\n${text}`)
    }
}


describe('外部查詢 helper — getUserByToken / getUsersByToken / getUserByUserId (真後端 + base seed)', function() {
    this.timeout(60000)

    before(async function() {
        await startServersOnce()
        await resetToBaseSeed()
    })

    describe('getUserByToken', function() {

        it('HLP-UBT-001-admin-sys-token-resolves-target-profile: admin sysToken 查 viewer token → 白名單 profile (id/account/isAdmin/isActive; 不含 password)', async function() {
            //spec E2E-001: admin 操作者 token + key=token → msg 為 target profile; spec 邊界: 白名單欄位不含 password
            let u = await getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER)
            assert.strict.equal(u.id, 'id-for-viewer')
            assert.strict.equal(u.account, 'ac-viewer')
            assert.strict.equal(u.isAdmin, 'n')
            assert.strict.equal(u.isActive, 'y')
            assert.strict.equal('password' in u, false, '回傳 profile 不得含 password')
        })

        it('HLP-UBT-002-app-sys-token-allowed: isApp 應用系統 token 作 sysToken → 視同 admin 可查', async function() {
            //spec 規則摘要: endpoint 僅接受 admin user 或 app token 之 caller (isApp bypass funCheckAdmin)
            let u = await getUserByToken(urlByToken, SYS_APP, TK_VIEWER)
            assert.strict.equal(u.id, 'id-for-viewer')
            assert.strict.equal(u.account, 'ac-viewer')
        })

        it('HLP-UBT-003-app-token-as-target-virtual-user: 目標為 app token → 虛擬使用者 (isApp=y / isAdmin=y / isActive=y)', async function() {
            //spec 契約: app token 於 getUserByToken 走 bypass, 虛擬 user 之 isAdmin='y' / isActive='y' 為固定值
            let u = await getUserByToken(urlByToken, SYS_ADMIN, SYS_APP)
            assert.strict.equal(u.id, 'id-for-app')
            assert.strict.equal(u.isApp, 'y')
            assert.strict.equal(u.isAdmin, 'y')
            assert.strict.equal(u.isActive, 'y')
        })

        it('HLP-UBT-004-non-admin-sys-token-rejected: 一般使用者 token 作 sysToken → reject "cannotGetUserDataByUrl", 輸出不含權杖', async function() {
            //spec E2E-002: 非 admin → body state=error (msg=tokenExpired) → helper 之 F3 key
            let r = await run(() => getUserByToken(urlByToken, TK_VIEWER, TK_VIEWER))
            assert.strict.equal(r.v, 'cannotGetUserDataByUrl')
            assertNoToken(r, [TK_VIEWER])
        })

        it('HLP-UBT-005-invalid-sys-token-rejected: sysToken 於 DB 不存在 → 同 004 之 F3 key, 輸出不含權杖', async function() {
            //spec E2E-003: 無效 token → state=error (msg=tokenExpired)
            let r = await run(() => getUserByToken(urlByToken, 'no-such-sys-token', TK_VIEWER))
            assert.strict.equal(r.v, 'cannotGetUserDataByUrl')
            assertNoToken(r, ['no-such-sys-token', TK_VIEWER])
        })

        it('HLP-UBT-006-target-token-not-found-rejected: 目標 token 不存在 → F3 key (endpoint 回 tokenNoPermission), 輸出不含權杖', async function() {
            //spec: caller 通過認證但 target 查無 → state=error (msg=tokenNoPermission)
            let r = await run(() => getUserByToken(urlByToken, SYS_ADMIN, 'no-such-target-token'))
            assert.strict.equal(r.v, 'cannotGetUserDataByUrl')
            assertNoToken(r, [SYS_ADMIN, 'no-such-target-token'])
        })

        it('HLP-UBT-007-url-missing-placeholder-rejected: url 缺 token={sysToken} / key=token / value={token} 任一 → reject "noTokenKeyValueInUrl"', async function() {
            //helper 契約: 三者缺一即拒 (不打 HTTP)
            let k = 'noTokenKeyValueInUrl'
            assert.strict.equal((await run(() => getUserByToken(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=token`, SYS_ADMIN, TK_VIEWER))).v, k)
            assert.strict.equal((await run(() => getUserByToken(`${apiUrl}/api/getSsoUserInfor?key=token&value={token}`, SYS_ADMIN, TK_VIEWER))).v, k)
            assert.strict.equal((await run(() => getUserByToken(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&value={token}`, SYS_ADMIN, TK_VIEWER))).v, k)
        })

        it('HLP-UBT-008-invalid-args-rejected: url / tokenSelf / tokenTar 空字串 → invalidUrl / invalidTokenSelf / invalidTokenTar', async function() {
            assert.strict.equal((await run(() => getUserByToken('', SYS_ADMIN, TK_VIEWER))).v, 'invalidUrl')
            assert.strict.equal((await run(() => getUserByToken(urlByToken, '', TK_VIEWER))).v, 'invalidTokenSelf')
            assert.strict.equal((await run(() => getUserByToken(urlByToken, SYS_ADMIN, ''))).v, 'invalidTokenTar')
        })

        it('HLP-UBT-009-connection-refused-rejected: 無服務之 port → reject "cannotGetUserByUrl", 輸出不含權杖', async function() {
            let r = await run(() => getUserByToken(urlNoListen, SYS_ADMIN, TK_VIEWER))
            assert.strict.equal(r.v, 'cannotGetUserByUrl')
            assertNoToken(r, [SYS_ADMIN, TK_VIEWER])
        })

        it('HLP-UBT-010-http-404-rejected: 非 2xx (404 路徑) → reject "cannotGetUserByUrl" (httpGetJson 比照 axios 將非 2xx 視為錯誤), 輸出不含權杖', async function() {
            let r = await run(() => getUserByToken(urlNotFound, SYS_ADMIN, TK_VIEWER))
            assert.strict.equal(r.v, 'cannotGetUserByUrl')
            assertNoToken(r, [SYS_ADMIN, TK_VIEWER])
        })

        it('HLP-UBT-011-funConvertUser: 同步 / 非同步轉換皆生效; 轉換結果非物件 → reject "noUserDataAfterConvert"', async function() {
            let u1 = await getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: (u) => ({ acc: u.account }) })
            assert.deepStrictEqual(u1, { acc: 'ac-viewer' })
            let u2 = await getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: async (u) => ({ id: u.id }) })
            assert.deepStrictEqual(u2, { id: 'id-for-viewer' })
            let r = await run(() => getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: () => null }))
            assert.strict.equal(r.v, 'noUserDataAfterConvert')
        })

        it('HLP-UBT-012-token-with-reserved-chars: 目標 token 含 + & $` 等字元 → 依原值查得使用者 (代入經 encodeURIComponent 且不受 $ 樣式影響)', async function() {
            //ADR-068 K 契約: 代入以 split/join + encodeURIComponent. 修正前: + 被解成空白、&key= 形成重複參數 (陣列 → tokenExpired)、$` 展開成網址前綴
            let t = ds.tokens.funNew({ userId: 'id-for-viewer' })
            t.token = 'enc+tok&key=account$`-for-helper-test'
            t.timeEnd = '2030-01-01T00:00:00.000+08:00'
            await woItems.tokens.insert([t])
            try {
                let r = await run(() => getUserByToken(urlByToken, SYS_ADMIN, t.token))
                assert.strict.equal(r.ok, true, `預期查得 viewer, 實得: ${util.inspect(r.v)}\n${r.out}`)
                assert.strict.equal(r.v.id, 'id-for-viewer')
            }
            finally {
                await deleteNonBaseSeed()
            }
        })

    })

    describe('getUsersByToken', function() {

        it('HLP-UST-001-admin-sys-token-resolves-list: admin sysToken → base seed 三使用者 (ac-admin/ac-basic/ac-viewer), 不含 password 與 tokenVerify', async function() {
            let us = await getUsersByToken(urlUsers, SYS_ADMIN)
            let accounts = us.map((u) => u.account).sort()
            assert.deepStrictEqual(accounts, ['ac-admin', 'ac-basic', 'ac-viewer'])
            for (let u of us) {
                assert.strict.equal('password' in u, false, `${u.account} 不得含 password`)
                assert.strict.equal('tokenVerify' in u, false, `${u.account} 不得含 tokenVerify (ADR-068: 對外清單不輸出憑證欄)`)
            }
        })

        it('HLP-UST-002-app-sys-token-allowed: isApp 應用系統 token 作 sysToken → 可取清單', async function() {
            let us = await getUsersByToken(urlUsers, SYS_APP)
            assert.strict.equal(us.length, 3)
        })

        it('HLP-UST-003-non-admin-rejected: 一般使用者 token 作 sysToken → reject "cannotGetUsersDataByUrl", 輸出不含權杖', async function() {
            let r = await run(() => getUsersByToken(urlUsers, TK_VIEWER))
            assert.strict.equal(r.v, 'cannotGetUsersDataByUrl')
            assertNoToken(r, [TK_VIEWER])
        })

        it('HLP-UST-004-url-missing-placeholder-rejected: url 缺 token={sysToken} → "noTokenInUrl"; 參數空 → invalidUrl / invalidTokenSelf', async function() {
            assert.strict.equal((await run(() => getUsersByToken(`${apiUrl}/api/getSsoUsersList`, SYS_ADMIN))).v, 'noTokenInUrl')
            assert.strict.equal((await run(() => getUsersByToken('', SYS_ADMIN))).v, 'invalidUrl')
            assert.strict.equal((await run(() => getUsersByToken(urlUsers, ''))).v, 'invalidTokenSelf')
        })

        it('HLP-UST-005-funConvertUser-each: 逐筆轉換 (含非同步); 任一筆轉換非物件 → reject "noUserDataAfterConvert"', async function() {
            let us = await getUsersByToken(urlUsers, SYS_ADMIN, { funConvertUser: async (u) => ({ acc: u.account }) })
            assert.deepStrictEqual(us.map((u) => u.acc).sort(), ['ac-admin', 'ac-basic', 'ac-viewer'])
            let r = await run(() => getUsersByToken(urlUsers, SYS_ADMIN, { funConvertUser: (u) => (u.account === 'ac-basic' ? null : u) }))
            assert.strict.equal(r.v, 'noUserDataAfterConvert')
        })

    })

    describe('getUserByUserId', function() {

        it('HLP-UID-001-admin-sys-token-resolves-by-id: key=id 查 id-for-viewer → 白名單 profile (不含 password)', async function() {
            //spec: key !== 'token' 走 checkTokenAndGetUserInfor, 以指定欄位查使用者; 後端查詢鍵為 id (helper 原範例 key=userId 不被後端接受, 2026-09-07 修正)
            let u = await getUserByUserId(urlById, SYS_ADMIN, 'id-for-viewer')
            assert.strict.equal(u.id, 'id-for-viewer')
            assert.strict.equal(u.account, 'ac-viewer')
            assert.strict.equal('password' in u, false, '回傳 profile 不得含 password')
        })

        it('HLP-UID-002-unknown-id-rejected: 不存在之 id → reject "cannotGetUserDataByUrl" (endpoint 回 tokenNoPermission), 輸出不含權杖', async function() {
            let r = await run(() => getUserByUserId(urlById, SYS_ADMIN, 'no-such-id'))
            assert.strict.equal(r.v, 'cannotGetUserDataByUrl')
            assertNoToken(r, [SYS_ADMIN])
        })

        it('HLP-UID-003-non-admin-rejected: 一般使用者 token 作 sysToken → reject "cannotGetUserDataByUrl", 輸出不含權杖', async function() {
            let r = await run(() => getUserByUserId(urlById, TK_VIEWER, 'id-for-viewer'))
            assert.strict.equal(r.v, 'cannotGetUserDataByUrl')
            assertNoToken(r, [TK_VIEWER])
        })

        it('HLP-UID-004-invalid-args-and-url-rejected: userIdTar 空 → "invalidUserIdTar"; url 缺 value={userId} → "noTokenKeyUserIdInUrl"', async function() {
            assert.strict.equal((await run(() => getUserByUserId(urlById, SYS_ADMIN, ''))).v, 'invalidUserIdTar')
            assert.strict.equal((await run(() => getUserByUserId(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=id`, SYS_ADMIN, 'id-for-viewer'))).v, 'noTokenKeyUserIdInUrl')
        })

    })

})
