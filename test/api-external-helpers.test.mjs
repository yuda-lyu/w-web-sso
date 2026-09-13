//api-external-helpers.test.mjs — 外部系統直接調用之查詢 helper 契約測試
//
// 對象: src/getUserByToken.mjs / src/getUsersByToken.mjs / src/getUserByUserId.mjs
//   三支為套件對外提供、供外部系統於 node (或瀏覽器) 端直接 import 呼叫, 內部以內建 fetch 打本套件 HTTP 端點 (ADR-056).
// 依據: spec/流程_查詢使用者資訊.md (HTTP /api/getSsoUserInfor 之權限與 {state,msg} 契約) + helper 自身之
//   參數檢查 / 回傳 / reject 字串契約 (helper 對外契約, 部署端依 reject 字串判斷).
// 環境: 真後端 (startServersOnce) + base seed (resetToBaseSeed, g_initialData.mjs):
//   token-for-admin (admin user) / token-for-viewer (一般 user) / token-for-app (isApp='y', 無對應 user → 虛擬使用者).
//   本檔不建立任何資料, 測後 DB 仍為 base seed, 無須清理.
//
// 涵蓋: HLP-UBT-001~011 (getUserByToken) / HLP-UST-001~005 (getUsersByToken) / HLP-UID-001~004 (getUserByUserId)

import assert from 'assert'
import { startServersOnce, apiUrl, resetToBaseSeed } from './tools/e2e-setup.mjs'
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


//helper 於 reject 路徑會 console.log 診斷, 預期 reject 之 case 以此靜音, 避免污染 reporter 輸出
async function quiet(fn) {
    let log = console.log
    console.log = () => {}
    try {
        return await fn()
    }
    finally {
        console.log = log
    }
}


//取 reject 值 (helper 之 reject 為字串); resolve 時回 null
async function rejectOf(pm) {
    try {
        await pm
        return null
    }
    catch (err) {
        return err
    }
}


//helper 內以 replaceAll 代入 {sysToken}/{token}/{userId} 後之實際 url (reject 訊息含此 url)
function fill(url, kp) {
    let u = url
    for (let [k, v] of Object.entries(kp)) {
        u = u.replaceAll(`{${k}}`, v)
    }
    return u
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

        it('HLP-UBT-004-non-admin-sys-token-rejected: 一般使用者 token 作 sysToken → reject "can not get user data by url[...]"', async function() {
            //spec E2E-002: 非 admin → body state=error (msg=tokenExpired) → helper 以「取得使用者資訊失敗」二階 reject
            let r = await quiet(() => rejectOf(getUserByToken(urlByToken, TK_VIEWER, TK_VIEWER)))
            assert.strict.equal(r, `can not get user data by url[${fill(urlByToken, { sysToken: TK_VIEWER, token: TK_VIEWER })}]`)
        })

        it('HLP-UBT-005-invalid-sys-token-rejected: sysToken 於 DB 不存在 → 同 004 之二階 reject', async function() {
            //spec E2E-003: 無效 token → state=error (msg=tokenExpired)
            let r = await quiet(() => rejectOf(getUserByToken(urlByToken, 'no-such-sys-token', TK_VIEWER)))
            assert.strict.equal(r, `can not get user data by url[${fill(urlByToken, { sysToken: 'no-such-sys-token', token: TK_VIEWER })}]`)
        })

        it('HLP-UBT-006-target-token-not-found-rejected: 目標 token 不存在 → 二階 reject (endpoint 回 tokenNoPermission)', async function() {
            //spec: caller 通過認證但 target 查無 → state=error (msg=tokenNoPermission)
            let r = await quiet(() => rejectOf(getUserByToken(urlByToken, SYS_ADMIN, 'no-such-target-token')))
            assert.strict.equal(r, `can not get user data by url[${fill(urlByToken, { sysToken: SYS_ADMIN, token: 'no-such-target-token' })}]`)
        })

        it('HLP-UBT-007-url-missing-placeholder-rejected: url 缺 token={sysToken} / key=token / value={token} 任一 → reject "no ... in url"', async function() {
            //helper 契約: 三者缺一即拒 (不打 HTTP)
            let msg = `no 'token={sysToken}', 'key=token', 'value={token}' in url`
            assert.strict.equal(await rejectOf(getUserByToken(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=token`, SYS_ADMIN, TK_VIEWER)), msg)
            assert.strict.equal(await rejectOf(getUserByToken(`${apiUrl}/api/getSsoUserInfor?key=token&value={token}`, SYS_ADMIN, TK_VIEWER)), msg)
            assert.strict.equal(await rejectOf(getUserByToken(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&value={token}`, SYS_ADMIN, TK_VIEWER)), msg)
        })

        it('HLP-UBT-008-invalid-args-rejected: url / tokenSelf / tokenTar 空字串 → 各自 reject', async function() {
            assert.strict.equal(await rejectOf(getUserByToken('', SYS_ADMIN, TK_VIEWER)), 'invalid url')
            assert.strict.equal(await rejectOf(getUserByToken(urlByToken, '', TK_VIEWER)), 'invalid tokenSelf')
            assert.strict.equal(await rejectOf(getUserByToken(urlByToken, SYS_ADMIN, '')), 'invalid tokenTar')
        })

        it('HLP-UBT-009-connection-refused-rejected: 無服務之 port → 一階 reject "can not get user by url[...]"', async function() {
            let r = await quiet(() => rejectOf(getUserByToken(urlNoListen, SYS_ADMIN, TK_VIEWER)))
            assert.strict.equal(r, `can not get user by url[${fill(urlNoListen, { sysToken: SYS_ADMIN, token: TK_VIEWER })}]`)
        })

        it('HLP-UBT-010-http-404-rejected: 非 2xx (404 路徑) → 一階 reject (httpGetJson 比照 axios 將非 2xx 視為錯誤)', async function() {
            let r = await quiet(() => rejectOf(getUserByToken(urlNotFound, SYS_ADMIN, TK_VIEWER)))
            assert.strict.equal(r, `can not get user by url[${fill(urlNotFound, { sysToken: SYS_ADMIN, token: TK_VIEWER })}]`)
        })

        it('HLP-UBT-011-funConvertUser: 同步 / 非同步轉換皆生效; 轉換結果非物件 → reject "no user data after funConvertUser"', async function() {
            let u1 = await getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: (u) => ({ acc: u.account }) })
            assert.deepStrictEqual(u1, { acc: 'ac-viewer' })
            let u2 = await getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: async (u) => ({ id: u.id }) })
            assert.deepStrictEqual(u2, { id: 'id-for-viewer' })
            let r = await quiet(() => rejectOf(getUserByToken(urlByToken, SYS_ADMIN, TK_VIEWER, { funConvertUser: () => null })))
            assert.strict.equal(r, 'no user data after funConvertUser')
        })

    })

    describe('getUsersByToken', function() {

        it('HLP-UST-001-admin-sys-token-resolves-list: admin sysToken → base seed 三使用者 (ac-admin/ac-basic/ac-viewer), 不含 password', async function() {
            let us = await getUsersByToken(urlUsers, SYS_ADMIN)
            let accounts = us.map((u) => u.account).sort()
            assert.deepStrictEqual(accounts, ['ac-admin', 'ac-basic', 'ac-viewer'])
            for (let u of us) {
                assert.strict.equal('password' in u, false, `${u.account} 不得含 password`)
            }
        })

        it('HLP-UST-002-app-sys-token-allowed: isApp 應用系統 token 作 sysToken → 可取清單', async function() {
            let us = await getUsersByToken(urlUsers, SYS_APP)
            assert.strict.equal(us.length, 3)
        })

        it('HLP-UST-003-non-admin-rejected: 一般使用者 token 作 sysToken → reject "can not get users data by url[...]"', async function() {
            let r = await quiet(() => rejectOf(getUsersByToken(urlUsers, TK_VIEWER)))
            assert.strict.equal(r, `can not get users data by url[${fill(urlUsers, { sysToken: TK_VIEWER })}]`)
        })

        it('HLP-UST-004-url-missing-placeholder-rejected: url 缺 token={sysToken} → reject "no \'token={sysToken}\' in url"', async function() {
            assert.strict.equal(await rejectOf(getUsersByToken(`${apiUrl}/api/getSsoUsersList`, SYS_ADMIN)), `no 'token={sysToken}' in url`)
            assert.strict.equal(await rejectOf(getUsersByToken('', SYS_ADMIN)), 'invalid url')
            assert.strict.equal(await rejectOf(getUsersByToken(urlUsers, '')), 'invalid tokenSelf')
        })

        it('HLP-UST-005-funConvertUser-each: 逐筆轉換 (含非同步); 任一筆轉換非物件 → reject "no user data after funConvertUser"', async function() {
            let us = await getUsersByToken(urlUsers, SYS_ADMIN, { funConvertUser: async (u) => ({ acc: u.account }) })
            assert.deepStrictEqual(us.map((u) => u.acc).sort(), ['ac-admin', 'ac-basic', 'ac-viewer'])
            let r = await quiet(() => rejectOf(getUsersByToken(urlUsers, SYS_ADMIN, { funConvertUser: (u) => (u.account === 'ac-basic' ? null : u) })))
            assert.strict.equal(r, 'no user data after funConvertUser')
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

        it('HLP-UID-002-unknown-id-rejected: 不存在之 id → 二階 reject "can not get user data by url[...]" (endpoint 回 tokenNoPermission)', async function() {
            let r = await quiet(() => rejectOf(getUserByUserId(urlById, SYS_ADMIN, 'no-such-id')))
            assert.strict.equal(r, `can not get user data by url[${fill(urlById, { sysToken: SYS_ADMIN, userId: 'no-such-id' })}]`)
        })

        it('HLP-UID-003-non-admin-rejected: 一般使用者 token 作 sysToken → 二階 reject', async function() {
            let r = await quiet(() => rejectOf(getUserByUserId(urlById, TK_VIEWER, 'id-for-viewer')))
            assert.strict.equal(r, `can not get user data by url[${fill(urlById, { sysToken: TK_VIEWER, userId: 'id-for-viewer' })}]`)
        })

        it('HLP-UID-004-invalid-args-and-url-rejected: userIdTar 空 → "invalid userIdTar"; url 缺 value={userId} → reject "no ... in url"', async function() {
            assert.strict.equal(await rejectOf(getUserByUserId(urlById, SYS_ADMIN, '')), 'invalid userIdTar')
            assert.strict.equal(await rejectOf(getUserByUserId(`${apiUrl}/api/getSsoUserInfor?token={sysToken}&key=id`, SYS_ADMIN, 'id-for-viewer')), `no 'token={sysToken}', 'key=id', 'value={userId}' in url`)
        })

    })

})
