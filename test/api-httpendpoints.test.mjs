import assert from 'assert'
import ot from 'dayjs'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, apiUrl } from './api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// D14 — 對外 HTTP 端點 api 測試 (填補 v2 audit A-6)
//
// 涵蓋 server/WWebSso.mjs 兩條「直接以 HTTP GET 打」之對外 REST route, 既有 e2e 多走 kpfun WS 通道,
// 這兩條 HTTP route 先前無測試:
//   - GET /api/getSsoUsersList  (WWebSso.mjs:854-892) → p.checkTokenAndGetUsersList(token, { fun: funCheckAdmin })
//   - GET /api/refreshToken     (WWebSso.mjs:776-813) → p.refreshToken(token)
//
// 使用方式:
//   npx mocha test/api-httpendpoints.test.mjs --timeout 60000 --reporter list
//
// 本檔為 API-only 測試 (無 UI / 無 Playwright / 無 baseline 截圖):
//   - act 走「真實 HTTP 請求」: Node 18+ 內建 fetch 直接打 apiUrl/api/<route>?token=...
//     (非 callFapi WS — 本測試重點正是這兩個 HTTP route 本身)
//   - assert 比對 HTTP response.status + body.state + body.msg
//
// 回傳格式 (pm2resolve / pmConvertResolve, node_modules/wsemi/src/pmConvertResolve.mjs):
//   { state: 'success'|'error'|'cancelled', msg: <value> }
//   - resolve → state='success', msg=回傳值
//   - reject  → state='error',   msg=reject 字串 (handler 內 isErr 時取 .message, 字串原樣保留)
//   - 兩種情況 HTTP 皆 200 (reject 包進 body, 不反映於 HTTP 狀態碼)
//
// 契約 (讀 handler / procCore 實際 reject 值確認, 非 spec 舊字串):
//
//   GET /api/getSsoUsersList  (checkTokenAndGetUsersList → checkToken(token,{fun}) → getUsersList):
//     - admin token  : checkToken 通過 (_checkTokenByObj b1=未過期 && b2=funCheckAdmin=true)
//                       → getUsersList 回 user 物件陣列 (procCore.mjs:1648, deletePassword 預設 true → 不含 password)
//                       → state='success', msg=array
//     - 無 token      : checkToken !isestr(token) guard → reject 'tokenExpired' (procCore.mjs:551-553)
//     - 無效 token    : _checkToken 查無紀錄 reject 內層 'invalid token' (procCore.mjs:488),
//                       checkToken .catch 統一覆寫對外為 'tokenExpired' (procCore.mjs:565-571, 防 information leakage)
//     - 非 admin token: _checkTokenByObj b2=funCheckAdmin(checkUserAdmin)=false → 回 false
//                       → checkToken .then res===false → errTemp='tokenExpired' (procCore.mjs:559-563)
//                       → reject 'tokenExpired' (funCheckAdmin 擋下, 與過期同訊息防帳號/權限列舉)
//
//   GET /api/refreshToken  (p.refreshToken, procCore.mjs:582-666):
//     - 有效 token (未過期): 查得單筆 token → 更新 timeEnd = now + minExpired(min) (procCore.mjs:641,648)
//                            → resolve timeEndNew (TZ datetime 字串) → state='success'
//                            → DB 內該 token 之 timeEnd 被延長至較原值大
//     - 無效 token (DB 無): ntks===0 → reject 'invalid token' (procCore.mjs:600-604)
//                            注意: refreshToken 不經 checkToken 之 .catch 收斂, 故對外為原字串 'invalid token'
//     - 過期 token        : tn >= timeEnd → reject 'tokenExpired' (procCore.mjs:632-638)
//     - 無 token (空字串)  : !isestr(token) guard → reject 'tokenExpired' (procCore.mjs:586-588)
//


// ===================================================================
// 本檔特化 token seed (僅 refreshToken 延長案需要「近未來 timeEnd」之 token —
// base seed token 之 timeEnd 為 2030-01-01 遠未來, refresh 後 now+minExpired 反而更小,
// 無法乾淨斷言「延長」, 故另插一筆近未來 (未過期) token 與一筆已過期 token)
// ===================================================================

let extendTokenStr = ''       //近未來有效 token (供 refresh 延長案)
let extendTokenOrigEnd = ''   //其原始 timeEnd, 供比對延長後變大
let expiredTokenStr = ''      //已過期 token (供 refresh 過期 reject 案)


async function insertSpecializedTokens() {
    //refresh 延長案: 近未來 (now + 1min, 尚未過期) token, 掛在 base seed 之 admin user 上 (user 內容不影響 refresh)
    let tExt = ds.tokens.funNew({ userId: 'id-for-admin' })
    tExt.timeEnd = ot().add(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    extendTokenStr = tExt.token
    extendTokenOrigEnd = tExt.timeEnd

    //refresh 過期案: now - 1min (已過期) token
    let tExp = ds.tokens.funNew({ userId: 'id-for-admin' })
    tExp.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    expiredTokenStr = tExp.token

    await woItems.tokens.insert([tExt, tExp])
}


// ===================================================================
// HTTP 呼叫 helper — 直接打 backend (apiUrl = http://127.0.0.1:11007), 不經 frontend proxy
// 回傳 { status, body }: status=HTTP status code, body=JSON parse 後物件 (pm2resolve 格式)
// ===================================================================

async function httpGet(route, token) {
    let url = `${apiUrl}/api/${route}?token=${encodeURIComponent(token)}`
    let r = await fetch(url)
    let body = await r.json()
    return { status: r.status, body }
}


// ===================================================================
// mocha 測試
// ===================================================================

describe('對外 HTTP 端點 API — getSsoUsersList / refreshToken (D14)', function() {
    this.timeout(60000)

    beforeEach(async function() {
        this.timeout(60000)
        await startServersOnce()
        //重置為 canonical base seed (3 users + 4 tokens, 含 admin token-for-admin / viewer token-for-viewer)
        await resetToBaseSeed()
        //插入本檔特化 token (refresh 延長/過期案用)
        await insertSpecializedTokens()
    })

    afterEach(async function() {
        //僅刪除本檔特化 token, 保留 base seed
        await deleteNonBaseSeed()
        extendTokenStr = ''
        extendTokenOrigEnd = ''
        expiredTokenStr = ''
    })


    // ---------------------------------------------------------------
    // GET /api/getSsoUsersList
    // ---------------------------------------------------------------

    it('getSsoUsersList: admin token → 200, state=success, msg 為使用者清單陣列 (含 seed user, 不含 password)', async function() {
        //token-for-admin → id-for-admin (isAdmin=y, isActive=y, 已驗證) → funCheckAdmin 通過
        let { status, body } = await httpGet('getSsoUsersList', 'token-for-admin')

        //pm2resolve 將成功包成 200 + state=success
        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'success', `預期 state=success (admin token 通過 funCheckAdmin), 實際: ${JSON.stringify(body)}`)
        //getUsersList 回 array (procCore.mjs:1648-1682)
        assert.strict.equal(Array.isArray(body.msg), true, `預期 msg 為陣列, 實際: ${typeof body.msg}`)
        //至少含 base seed 3 user (resetToBaseSeed 插入 viewer/basic/admin)
        assert.strict.equal(body.msg.length >= 3, true, `預期清單 >=3 筆 (含 base seed 3 user), 實際: ${body.msg.length}`)
        //清單應含 seed admin user (以 account 命中, 驗結構)
        let adminRow = body.msg.find((u) => u.account === 'ac-admin')
        assert.strict.ok(adminRow, `預期清單含 account=ac-admin 之 user, 實際: ${JSON.stringify(body.msg.map((u) => u.account))}`)
        assert.strict.equal(adminRow.id, 'id-for-admin', `預期 ac-admin 之 id=id-for-admin, 實際: ${adminRow.id}`)
        assert.strict.equal(adminRow.isAdmin, 'y', `預期 ac-admin 之 isAdmin=y, 實際: ${adminRow.isAdmin}`)
        //getUsersList deletePassword 預設 true (procCore.mjs:1658-1679) → 每筆皆不含 password
        for (let u of body.msg) {
            assert.strict.equal(u.password, undefined, `預期清單每筆不含 password (deletePassword 預設 true), 違規 row: ${JSON.stringify(u)}`)
        }
    })


    it('getSsoUsersList: 無 token (空字串) → state=error, msg = key "tokenExpired"', async function() {
        //空字串 token → checkToken !isestr(token) guard 直接 reject 'tokenExpired' (procCore.mjs:551-553)
        let { status, body } = await httpGet('getSsoUsersList', '')

        assert.strict.equal(status, 200, `預期 HTTP 200 (pm2resolve 包裝 reject), 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (無 token), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(msgStr.includes('tokenExpired'), true, `預期 msg = key "tokenExpired" (!isestr guard), 實際: ${msgStr}`)
    })


    it('getSsoUsersList: 無效 token (DB 不存在) → state=error, msg = key "tokenExpired"', async function() {
        //'no-such-token' DB 查無 → _checkToken reject 內層 'invalid token' (procCore.mjs:488),
        //checkToken .catch 統一覆寫對外為 'tokenExpired' (procCore.mjs:565-571, 防 information leakage)
        let { status, body } = await httpGet('getSsoUsersList', 'no-such-token')

        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (無效 token), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        //對外為 'tokenExpired' 而非內層 'invalid token' (checkToken .catch 收斂)
        assert.strict.equal(msgStr.includes('tokenExpired'), true, `預期 msg = key "tokenExpired" (checkToken 收斂內層 invalid token), 實際: ${msgStr}`)
    })


    it('getSsoUsersList: 非 admin token (viewer) → state=error, msg = key "tokenExpired" (funCheckAdmin 擋下)', async function() {
        //token-for-viewer → id-for-viewer (isAdmin=n) → funCheckAdmin=checkUserAdmin 回 false (b4=getIsAdmin=false)
        //→ _checkTokenByObj 回 false → checkToken .then res===false → reject 'tokenExpired' (procCore.mjs:559-563)
        //與過期/無效同訊息, 為防權限/帳號列舉之安全設計
        let { status, body } = await httpGet('getSsoUsersList', 'token-for-viewer')

        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (非 admin 不可取清單), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(msgStr.includes('tokenExpired'), true, `預期 msg = key "tokenExpired" (funCheckAdmin 失敗統一收斂), 實際: ${msgStr}`)
    })


    // ---------------------------------------------------------------
    // GET /api/refreshToken
    // ---------------------------------------------------------------

    it('refreshToken: 有效 token → 200, state=success, 回傳延長後 timeEnd 且 DB 內 timeEnd 變大', async function() {
        //extendTokenStr: 近未來 (now+1min) 有效 token. refresh 後 timeEnd = now+minExpired(129600min≈90天) → 必大於原值
        let origEnd = extendTokenOrigEnd
        let { status, body } = await httpGet('refreshToken', extendTokenStr)

        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'success', `預期 state=success (有效 token 可延長), 實際: ${JSON.stringify(body)}`)
        //refreshToken resolve 回傳 timeEndNew 字串 (procCore.mjs:665)
        assert.strict.equal(typeof body.msg, 'string', `預期 msg 為 timeEndNew 字串, 實際: ${typeof body.msg} / ${JSON.stringify(body.msg)}`)
        //回傳之新 timeEnd 應大於原始 timeEnd (同 TZ ISO 格式, 字串比較即時序比較)
        assert.strict.equal(body.msg > origEnd, true, `預期回傳新 timeEnd(${body.msg}) > 原 timeEnd(${origEnd})`)

        //DB 驗證: 重讀該 token, 其 timeEnd 已被持久化延長至回傳值, 且大於原值
        let tks = await woItems.tokens.select({ token: extendTokenStr })
        assert.strict.equal(tks.length, 1, `預期 DB 仍存單筆該 token, 實際筆數: ${tks.length}`)
        assert.strict.equal(tks[0].timeEnd, body.msg, `預期 DB timeEnd 已更新為回傳值 ${body.msg}, 實際: ${tks[0].timeEnd}`)
        assert.strict.equal(tks[0].timeEnd > origEnd, true, `預期 DB timeEnd(${tks[0].timeEnd}) > 原 timeEnd(${origEnd})`)
    })


    it('refreshToken: 無效 token (DB 不存在) → state=error, msg = key "invalid token"', async function() {
        //refreshToken 自行查表, ntks===0 直接 reject 'invalid token' (procCore.mjs:600-604).
        //注意: refreshToken 不經 checkToken 之 .catch 收斂, 故對外保留原字串 'invalid token' (非 'tokenExpired')
        let { status, body } = await httpGet('refreshToken', 'no-such-token')

        assert.strict.equal(status, 200, `預期 HTTP 200 (pm2resolve 包裝 reject), 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (DB 無此 token), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(msgStr.includes('invalid token'), true, `預期 msg = "invalid token" (refreshToken ntks===0, 不經 checkToken 收斂), 實際: ${msgStr}`)
    })


    it('refreshToken: 已過期 token → state=error, msg = key "tokenExpired"', async function() {
        //expiredTokenStr: now-1min (已過期). refreshToken 查得單筆但 tn >= timeEnd → reject 'tokenExpired' (procCore.mjs:632-638)
        let { status, body } = await httpGet('refreshToken', expiredTokenStr)

        assert.strict.equal(status, 200, `預期 HTTP 200, 實際: ${status}`)
        assert.strict.equal(body.state, 'error', `預期 state=error (token 已過期不可延長), 實際: ${JSON.stringify(body)}`)
        let msgStr = typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg)
        assert.strict.equal(msgStr.includes('tokenExpired'), true, `預期 msg = key "tokenExpired" (tn>=timeEnd 過期分支), 實際: ${msgStr}`)
    })

})
