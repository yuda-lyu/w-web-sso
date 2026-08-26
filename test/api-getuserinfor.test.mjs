import assert from 'assert'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, apiUrl, resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// E2E getSsoUserInfor test — /api/getSsoUserInfor 之 token 權限驗證
//
// 對應 srv.mjs 之 api 測試註解 (line 38-43) 與 server/WWebSso.mjs line 1081-1138.
//
// 使用方式：
//   npx mocha test/api-getuserinfor.test.mjs --timeout 60000 --reporter list
//
// 本檔為 API-only 測試 (無 UI / 無 Playwright / 無 baseline 截圖):
//   - 用 Node 18+ 內建 fetch 直接打 apiUrl/api/getSsoUserInfor
//   - 全程 sync 比對 HTTP response.status + body.state + body.msg
//
// 涵蓋 spec「重要流程」3 case + spec i18n 表 (流程_查詢使用者資訊.md:130-136) 2 補充分支:
//   E2E-001-admin-query-other-by-token-pass:  admin token 查詢他人 (key=token, value=userBToken)
//                                              → 200, state=success, body.msg 含 userB 之 id/account/isAdmin/isActive
//   E2E-002-user-query-other-by-token-reject: 一般 (非 admin) 使用者 token 查詢他人
//                                              → state=error, msg = key 'tokenExpired' (funCheckAdmin 失敗於 _checkTokenByObj
//                                                之 b2=false 路徑, 由 checkToken 統一收斂為 'tokenExpired', 防 information leakage)
//   E2E-003-invalid-token-reject:              token='invalid' (DB 不存在) 查詢
//                                              → state=error, msg = key 'tokenExpired' (_checkToken 查無紀錄 reject 內層
//                                                'invalid token', 外層 checkToken .catch 覆寫為 'tokenExpired')
//   branch-key-not-token-admin-pass:           admin token + key='account' (非 token 分支) 查存在使用者
//                                              → 200, state=success (走 checkTokenAndGetUserInfor → getUserInfor)
//   branch-target-not-found-no-permission:     admin token + key='account' + 不存在之 value (target 查無)
//                                              → state=error, msg = key 'tokenNoPermission' (handler iseobj(userTarget)
//                                                檢核失敗分支 reject 此 key, WWebSso.mjs:925)
//

let salt = '{salt}'


// ===================================================================
// 測試使用者 / Token seed
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-getuserinfor-admin',
        account: 'getuserinfor-admin',
        rawPassword: 'Pw@admin1',
        name: 'GetUserInfor Admin',
        email: 'getuserinfor-admin@test.com',
        isAdmin: 'y',
    },
    userA: {
        id: 'id-getuserinfor-user-a',
        account: 'getuserinfor-user-a',
        rawPassword: 'Pw@usera1',
        name: 'GetUserInfor UserA',
        email: 'getuserinfor-user-a@test.com',
        isAdmin: 'n',
    },
    userB: {
        id: 'id-getuserinfor-user-b',
        account: 'getuserinfor-user-b',
        rawPassword: 'Pw@userb1',
        name: 'GetUserInfor UserB',
        email: 'getuserinfor-user-b@test.com',
        isAdmin: 'n',
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens + ips 清空), 再插入本檔專屬資料.
    await resetToBaseSeed()

    //3 users (admin / userA / userB)
    let order = 900
    let rows = []
    for (let key of ['admin', 'userA', 'userB']) {
        let u = testUsers[key]
        let v = ds.users.funNew({
            order: order++,
            account: u.account,
            password: hashPassword(u.rawPassword, salt),
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: '',
            isAdmin: u.isAdmin,
            timeVerified: '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = ''
        rows.push(v)
    }
    await woItems.users.insert(rows)

    //3 tokens (timeEnd = 60min 後)
    let tokenRows = []
    for (let key of ['admin', 'userA', 'userB']) {
        let u = testUsers[key]
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        userTokens[u.id] = t.token
        tokenRows.push(t)
    }
    await woItems.tokens.insert(tokenRows)

    console.log(`inserted 3 users (admin/userA/userB) + 3 tokens`)
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含 admin / userA / userB 之 user / token).
    await deleteNonBaseSeed()
    userTokens = {}
    console.log('deleted getuserinfor test users + tokens')
}


// ===================================================================
// API 呼叫 helper
// ===================================================================

//直接打 backend (apiUrl = http://127.0.0.1:11007), 不經 frontend proxy.
//回傳 { status, body } — status 為 HTTP status code, body 為 JSON parse 後物件 (符合 pm2resolve
//格式: { state: 'success'|'error'|'cancelled', msg: <value> }).
async function callGetSsoUserInfor(token, key, value) {
    let url = `${apiUrl}/api/getSsoUserInfor`
        + `?token=${encodeURIComponent(token)}`
        + `&key=${encodeURIComponent(key)}`
        + `&value=${encodeURIComponent(value)}`
    let r = await fetch(url)
    let body = await r.json()
    return { status: r.status, body }
}


// ===================================================================
// mocha 測試
// ===================================================================

describe('getSsoUserInfor API E2E — token 權限驗證', function() {
    this.timeout(60000)

    beforeEach(async function() {
        this.timeout(60000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    afterEach(async function() {
        await deleteTestUsersAndTokens()
    })


    it('E2E-001-admin-query-other-by-token-pass: admin token 查詢 userB token → 200, body 含 userB 之 account/email', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let userBToken = userTokens[testUsers.userB.id]

        let { status, body } = await callGetSsoUserInfor(adminToken, 'token', userBToken)

        //HTTP 層應正常 200 (pm2resolve 將 reject 也包成 200 + state=error)
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        //應為 success
        assert.strict.equal(body.state, 'success', `預期 state=success, 實際: ${JSON.stringify(body)}`)
        //body.msg 應為 userB 之 user object, 含 account / email
        assert.strict.equal(typeof body.msg, 'object', `預期 msg 為 user 物件, 實際: ${typeof body.msg}`)
        assert.strict.equal(body.msg.account, testUsers.userB.account, `預期 account=${testUsers.userB.account}, 實際: ${body.msg.account}`)
        assert.strict.equal(body.msg.email, testUsers.userB.email, `預期 email=${testUsers.userB.email}, 實際: ${body.msg.email}`)
    })


    it('E2E-002-user-query-other-by-token-reject: 非 admin 之 userA token 查詢 userB token → state=error, msg = key "tokenExpired"', async function() {
        let userAToken = userTokens[testUsers.userA.id]
        let userBToken = userTokens[testUsers.userB.id]

        let { status, body } = await callGetSsoUserInfor(userAToken, 'token', userBToken)

        //HTTP 層仍 200 (pm2resolve 包裝 reject)
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        //應 reject → state=error
        assert.strict.equal(body.state, 'error', `預期 state=error (非 admin 不可查他人), 實際: ${JSON.stringify(body)}`)
        //msg 應為 key "tokenExpired" — non-admin 觸發 funCheckAdmin 失敗時, procCore.mjs:_checkTokenByObj
        //之 b2=false 路徑統一 reject 為 key "tokenExpired" (與 timeEnd 過期同訊息, 為防 information leakage
        //之安全設計). getSsoUserInfor 為 server-to-server REST endpoint, 回 machine-readable key 供 API caller 判斷.
        //'tokenNoPermission' (key) 為 handler 之另一條 path — checkToken 通過但 target 查不到 user 時才走 (原則5: 外部錯誤回 key).
        //(批 A: token 驗證鏈 reject 改回 key 名 'tokenExpired'.)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(
            msgStr.includes('tokenExpired'),
            true,
            `預期 msg 含 key "tokenExpired" (caller funCheckAdmin 失敗統一收斂), 實際: ${msgStr}`
        )
    })


    it('E2E-003-invalid-token-reject: token=invalid (DB 不存在) 查詢 → state=error, msg = key "tokenExpired"', async function() {
        let userBToken = userTokens[testUsers.userB.id]

        let { status, body } = await callGetSsoUserInfor('invalid', 'token', userBToken)

        //HTTP 層仍 200 (spec:44 — pm2resolve 包裝 reject 於 body 而非 HTTP 狀態碼)
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        //應 reject → state=error (spec:45)
        assert.strict.equal(body.state, 'error', `預期 state=error (invalid token 不可查), 實際: ${JSON.stringify(body)}`)
        //msg 應為 key "tokenExpired" (spec:45): _checkToken 於 woItems.tokens.select 查無紀錄即 reject 內層字串
        //'invalid token', 外層 checkToken 之 .catch 統一覆寫為 'tokenExpired' 對外回應 (防 information leakage,
        //使「查無 token」與「token 過期」對外無法區分). 攔截點位於 funCheckAdmin 觸發前 (token 本身就無法解).
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(
            msgStr.includes('tokenExpired'),
            true,
            `預期 msg 含 key "tokenExpired" (invalid token 統一收斂, 防 information leakage), 實際: ${msgStr}`
        )
    })


    //補充分支 1: key !== 'token' 之查詢分支 (走 checkTokenAndGetUserInfor → getUserInfor, WWebSso.mjs:916).
    //spec i18n 表 (流程_查詢使用者資訊.md:145) 載明: key='account'/'email'/'id' 走此分支以指定欄位查 user.
    //E2E-001 只覆蓋 key='token' 分支 (checkTokenAndGetUserByToken), 此案例補上 key!=='token' 之 golden path,
    //驗證該分支 funCheckAdmin 通過 + getGenUserByKV 命中 → 回完整 profile.
    it('branch-key-not-token-admin-pass: admin token + key=account 查存在使用者 → 200, state=success, msg 為該 user 物件', async function() {
        let adminToken = userTokens[testUsers.admin.id]

        //key='account', value=userB 之帳號 (非 token 分支, 以欄位查)
        let { status, body } = await callGetSsoUserInfor(adminToken, 'account', testUsers.userB.account)

        //HTTP 層 200
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        //admin 通過 funCheckAdmin + getUserInfor 以 account 命中 → success
        assert.strict.equal(body.state, 'success', `預期 state=success (admin 走 key!=='token' 分支命中), 實際: ${JSON.stringify(body)}`)
        //msg 為白名單 user 物件 (procCore.mjs:1580-1593), 含 id/account, 不含 password
        assert.strict.equal(typeof body.msg, 'object', `預期 msg 為 user 物件, 實際: ${typeof body.msg}`)
        assert.strict.equal(body.msg.id, testUsers.userB.id, `預期 id=${testUsers.userB.id}, 實際: ${body.msg.id}`)
        assert.strict.equal(body.msg.account, testUsers.userB.account, `預期 account=${testUsers.userB.account}, 實際: ${body.msg.account}`)
        assert.strict.equal(body.msg.email, testUsers.userB.email, `預期 email=${testUsers.userB.email}, 實際: ${body.msg.email}`)
        //白名單不含敏感欄位 password (spec 規則摘要「回傳之 user 物件為白名單欄位, 不含 password」)
        assert.strict.equal(body.msg.password, undefined, `預期 msg 不含 password (白名單), 實際: ${body.msg.password}`)
    })


    //補充分支 2 (target 查無 → tokenNoPermission): admin token (通過 funCheckAdmin) + key='account' +
    //DB 不存在之 account → getUserInfor 邊界 catch 查無為 null → handler iseobj 檢核失敗 reject key
    //'tokenNoPermission' (procCore.mjs:1607 邊界 + WWebSso handler 映射; D06 修正後不再外洩 raw 英文字串).
    //anti-enumeration: 查無與無權限回同一 key, 不洩露 target 是否存在. 對齊 spec 流程_查詢使用者資訊.md:136/154.
    it('branch-target-not-found-no-permission: admin token 查不存在之 account → state=error, msg = key "tokenNoPermission"', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let { status, body } = await callGetSsoUserInfor(adminToken, 'account', 'no-such-account-xyz')
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (target 查無), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(
            msgStr.includes('tokenNoPermission'),
            true,
            `預期 msg 含 key "tokenNoPermission" (查無→無權限, 不洩露存在性), 實際: ${msgStr}`
        )
    })

})
