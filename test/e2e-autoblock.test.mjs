import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch, launchBrowser, typeIntoNthInput, waitUntilExist } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, itemsUnionBox, pollUntil } from './tools/e2eLib.mjs'


//
// E2E auto-block test — 自動封鎖機制完整覆蓋 (中英文版)
//
// 對應流程文件: spec/流程_自動封鎖機制.md (A/B/C/D 區塊)
//
// 涵蓋 9 個情境 (第 9 條「取不到 client IP」spec 標明不測, 走 unit test):
//   A 區塊 - 帳號登入失敗封鎖: account-block-trigger / account-failure-reset / blocked-login-rejected / block-expiry-implicit-unlock
//   B 區塊 - Token 調用 API 次數封鎖: token-block-trigger (reload 後落回登入頁有 UI baseline)
//   C 區塊 - IP 調用 API 次數封鎖: ip-block-trigger / ip-blocked-rejected / ip-expiry-implicit-unlock
//   D 區塊 - 新 IP 首次調用 → 自動登記: new-ip-registration
//
// 使用方式:
//   1. 先產生標準圖: node test/e2e-autoblock.test.mjs --baseline
//   2. 跑測試比對:   npx mocha test/e2e-autoblock.test.mjs --timeout 240000 --reporter list
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     案例鍵或編號前綴 (如 eng-E2E-006、E2E-010-new-ip-registration) 寫該案之圖 (本檔每案 1 張, 案例鍵即圖鍵), 不符任何鍵即報錯;
//     --langs; --write-mode missing|changed; env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 DB 重置 + in-memory 計數清除 (cleanKpIpCallApi / cleanKpAccountLoginFailed)
//     → fresh browser → 流程 → 語意斷言 (semantic) → DB / API 不變式 (verify) → 寫檔 / 比對; 斷言不過一張都不寫
//
// 標準圖存放: test/pics/autoblock/autoblock-{lang}-{name}.png
//   9 case × 2 lang = 18 baselines
//


let salt = '{salt}'
let baselineDir = './test/pics/autoblock'
let langs = ['eng', 'cht']

//對應 settings.json 與 WWebSso 預設值
let numForAccountLoginFailed = 3
let numForTokenCallApi = 1000
let numForIpCallApi = 12000

//對應 settings.json 的 cleanKpIpCallApiForToken (呼叫 /api/cleanKpIpCallApi 須附帶之識別 token)
let cleanKpIpCallApiForToken = '{cleanKpIpCallApiForToken}'
let cleanKpAccountLoginFailedForToken = '{cleanKpAccountLoginFailedForToken}'


function bp(lang, name) {
    return path.join(baselineDir, `autoblock-${lang}-${name}.png`)
}


//D24 anti-enum: 帳號被封鎖後登入不再回 distinct 'loginAccountBlocked', 改回 generic
//'failedLoginForCatch' (procLang.mjs:314-317), 與「密碼錯誤」「帳號不存在」三者文案一致 →
//封鎖畫面顯示文字 == 密碼錯誤畫面 == eng 'User account or password is incorrect' / cht
//'使用者帳密錯誤無法登入'. 故封鎖斷言與密碼錯誤斷言共用同一 needle 'loginIncorrect'
//(子字串 'incorrect' / '錯誤' 命中該統一訊息). 不再有 'temporarily locked' / '暫時鎖定' 之 distinct 封鎖文字.
let kpUiText = {
    eng: {
        login: 'Log in',
        connecting: 'Connecting',
        loginIncorrect: 'incorrect',
    },
    cht: {
        login: '登入',
        connecting: '連線中',
        loginIncorrect: '錯誤',
    },
}


//每 case 用獨立帳號, 避免 server 內 kpAccountLoginFailed / kpTokenCallApi 等 in-memory state 跨 case 殘留
//(beforeEach 只清 DB, in-memory state 不受影響, 同帳號重用會被 stale block 卡)
//帳號 suffix 加上 lang 避免兩語系跑時撞 in-memory state
function makeTestUsers(lang) {
    let sx = lang //帳號 lang 後綴
    return {
        block1: {
            id: `id-ab-block1-${sx}`,
            account: `ab-block1-${sx}`,
            rawPassword: 'Pw@abblock1A',
            name: 'AutoBlock Block1',
            email: `ab-block1-${sx}@test.com`,
        },
        reset2: {
            id: `id-ab-reset2-${sx}`,
            account: `ab-reset2-${sx}`,
            rawPassword: 'Pw@abreset2A',
            name: 'AutoBlock Reset2',
            email: `ab-reset2-${sx}@test.com`,
        },
        targetBlocked: {
            id: `id-ab-blocked-${sx}`,
            account: `ab-blocked-${sx}`,
            rawPassword: 'Pw@abblocked1',
            name: 'AutoBlock Blocked',
            email: `ab-blocked-${sx}@test.com`,
        },
        targetExpired: {
            id: `id-ab-expired-${sx}`,
            account: `ab-expired-${sx}`,
            rawPassword: 'Pw@abexpired1',
            name: 'AutoBlock Expired',
            email: `ab-expired-${sx}@test.com`,
        },
        token5: {
            id: `id-ab-token5-${sx}`,
            account: `ab-token5-${sx}`,
            rawPassword: 'Pw@abtoken5A',
            name: 'AutoBlock Token5',
            email: `ab-token5-${sx}@test.com`,
        },
        ipblock6: {
            id: `id-ab-ipblock6-${sx}`,
            account: `ab-ipblock6-${sx}`,
            rawPassword: 'Pw@abipblk6A',
            name: 'AutoBlock IpBlock6',
            email: `ab-ipblock6-${sx}@test.com`,
        },
        ip9: {
            id: `id-ab-ip9-${sx}`,
            account: `ab-ip9-${sx}`,
            rawPassword: 'Pw@abip9AAAA',
            name: 'AutoBlock Ip9',
            email: `ab-ip9-${sx}@test.com`,
        },
    }
}


function buildUser(u, timeBlocked = '') {
    let v = ds.users.funNew({
        order: 910,
        account: u.account,
        password: hashPassword(u.rawPassword, salt),
        name: u.name,
        email: u.email,
        description: '',
        from: 'test',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
    v.id = u.id
    v.timeVerified = '2025-01-01T00:00:00.000+08:00'
    v.timeExpired = '2030-01-01T00:00:00.000+08:00'
    v.timeBlocked = timeBlocked
    return v
}


async function insertUser(u) {
    await woItems.users.del({ id: u.id }).catch(() => {})
    await woItems.users.insert([buildUser(u)])
}


async function insertUserWithBlock(u, timeBlocked) {
    await woItems.users.del({ id: u.id }).catch(() => {})
    await woItems.users.insert([buildUser(u, timeBlocked)])
}


async function deleteAllTestUsers(testUsers) {
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        //w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id
        let _tks = await woItems.tokens.select({ userId: u.id }).catch(() => [])
        for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    }
}


//對指定 IP 預設 timeBlocked
async function insertIpWithBlockState(ip, timeBlocked) {
    let existing = await woItems.ips.select({ ip })
    for (let e of existing) {
        await woItems.ips.del({ id: e.id })
    }
    let oip = ds.ips.funNew({ ip })
    oip.timeBlocked = timeBlocked
    await woItems.ips.insert([oip])
}


//清除指定 IP 的紀錄
async function deleteIpRecord(ip) {
    let existing = await woItems.ips.select({ ip })
    for (let e of existing) {
        await woItems.ips.del({ id: e.id })
    }
}


//清空 server in-memory 的 kpIpCallApi
async function cleanKpIpCallApi() {
    try {
        let r = await fetch(`${apiUrl}/api/cleanKpIpCallApi?token=${encodeURIComponent(cleanKpIpCallApiForToken)}`)
        let j = await r.json()
        if (j.state !== 'success') {
            console.warn(`[cleanKpIpCallApi] server 回應非 success: ${JSON.stringify(j)}`)
        }
    }
    catch (err) {
        console.warn(`[cleanKpIpCallApi] 呼叫失敗: ${err.message}`)
    }
}


//清空 server in-memory 的 kpAccountLoginFailed (所有帳號的登入失敗計數)
//e2e 與 server 為獨立進程, in-memory state 無法由測試直接清除, 透過 server 的
///api/cleanKpAccountLoginFailed route (僅放行本機連入 + token 驗證) 觸發 pp.cleanKpAccountLoginFailed().
async function cleanKpAccountLoginFailed() {
    try {
        let r = await fetch(`${apiUrl}/api/cleanKpAccountLoginFailed?token=${encodeURIComponent(cleanKpAccountLoginFailedForToken)}`)
        let j = await r.json()
        if (j.state !== 'success') {
            console.warn(`[cleanKpAccountLoginFailed] server 回應非 success: ${JSON.stringify(j)}`)
        }
    }
    catch (err) {
        console.warn(`[cleanKpAccountLoginFailed] 呼叫失敗: ${err.message}`)
    }
}


//建立 chromium context 並僅對 localhost 連線注入 X-Forwarded-For header.
//不能用 newContext({ extraHTTPHeaders: { 'X-Forwarded-For': virtIp } }) — 該 header 會
//套用至「所有」requests, 包含 CDN (例: cdn.jsdelivr.net 的 @mdi/font), CDN 收到
//虛擬 IP 的 XFF 會回 font load error → 頁面缺 mdi icon → baseline 缺圖.
//改用 page.route() 攔截 + 選擇性注入: 只在 url 含 localhost / 127.0.0.1 時加 header.
async function makeXForwardedForContext(browser, virtIp) {
    let ctx = await browser.newContext()
    await ctx.route('**/*', (route, req) => {
        let url = req.url()
        let toLocal = url.includes('127.0.0.1') || url.includes('localhost')
        if (toLocal) {
            let headers = { ...req.headers(), 'x-forwarded-for': virtIp }
            route.continue({ headers })
        }
        else {
            route.continue()
        }
    })
    return ctx
}


//gotoCleanLogin: 進登入頁 + 設指定語系 + 等表單 mount
//?lang= URL 參數為 SPA 最高優先語系設定來源 (詳 src/plugins/mUI.mjs:137)
async function gotoCleanLogin(page, lang) {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForFunction(() => {
        let inps = document.querySelectorAll('input')
        return inps.length >= 2
    }, null, { timeout: 60000 }) //偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(500)
}


async function attemptLogin(page, lang, account, password) {
    let t = kpUiText[lang]
    await typeIntoNthInput(page, 0, account)
    await typeIntoNthInput(page, 1, password)
    await page.waitForTimeout(200)
    await page.locator(`text="${t.login}"`).first().click()
}


//login → 取 token (從 LS 讀)
async function loginAndGetToken(page, lang, account, password) {
    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, account, password)
    //偵測式等待「登入完成且已轉至使用者頁」再讀權杖(技能 §4.4; 原固定 10 秒——亦順帶等過轉址)。
    //只等權杖寫入不夠: 權杖寫入後隨即轉址, 接著之 evaluate 落在轉址途中而 context 被銷毀(2026-09-28 重跑 eng 抓出);
    //故條件為「無密碼欄且有使用者頁 .sb 且權杖已寫入」(登入頁亦有 .sb, 但有密碼欄)
    await waitUntilExist(page, '登入完成並轉至使用者頁', () => document.querySelectorAll('input[type="password"]').length === 0 && !!document.querySelector('.sb') && !!localStorage.getItem('ksso:userToken'), { timeout: 60000 })
    let token = await page.evaluate(() => localStorage.getItem('ksso:userToken'))
    return token
}


// ===================================================================
// case 1-9 capture/exec functions (lang 透過參數傳入)
// 9 個 case 都回傳 buf 給 baseline (含 token-block-trigger reload 後落回登入頁的終態).
// ===================================================================

//case 1 (對應 spec E2E-001): 真打「上限 + 1」次失敗 → 即時封鎖 (D24-即時, 失敗當下同步寫 timeBlocked,
//非 2s timer) → 再以正確帳密登入仍失敗顯示統一訊息.
//終態 UI: 登入頁 + 顯示統一封鎖/失敗訊息 (eng 'User account or password is incorrect' / cht '使用者帳密錯誤無法登入')
async function execAccountBlockTrigger(page, lang, u) {
    let t = kpUiText[lang]
    await insertUser(u)

    //對應 spec E2E-001 操作「連續以正確帳號 + 錯誤密碼嘗試登入『上限 + 1』次」: D07 門檻由 >= 改為 >,
    //須打 numForAccountLoginFailed + 1 次失敗才觸發封鎖 (procProtect.mjs:225 `nrecs > numForAccountLoginFailed`).
    for (let i = 0; i < numForAccountLoginFailed + 1; i++) {
        await gotoCleanLogin(page, lang)
        await attemptLogin(page, lang, u.account, 'WrongPw@99')
        await page.waitForFunction(
            (needle) => (document.body.innerText || '').includes(needle),
            t.loginIncorrect,
            { timeout: 60000 } //偵測上限放寬(原 10 秒; 負載高時登入回應較久, 2026-09-28)
        )
    }

    //D24-即時: 封鎖於最後一次失敗當下同步完成 (2s timer 已移除), 不需再等 timer 結算.

    //對應 spec E2E-001 操作「再以正確帳號 + 正確密碼嘗試登入一次」+ 驗證「UI 出現對應 i18n 之封鎖訊息」:
    //anti-enum (D24) 下封鎖訊息 == 密碼錯誤訊息, 故用正確密碼仍失敗即證明封鎖生效 (非密碼問題).
    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, u.account, u.rawPassword)
    await page.waitForFunction(
        (needle) => (document.body.innerText || '').includes(needle),
        t.loginIncorrect,
        { timeout: 60000 } //偵測上限放寬(原 10 秒; 負載高時登入回應較久, 2026-09-28)
    )
    await page.waitForTimeout(1500)

    //框封鎖訊息紅字本身，標注統一登入失敗訊息區（loginError inline div）
    let errorLoc001 = page.getByText(t.loginIncorrect, { exact: false }).first()
    return await captureStableWithBox(page, errorLoc001)
}


//case 2 (對應 spec E2E-002): 「上限」次失敗 (D07 門檻 >, 上限次未達 > 不封鎖, 為「最多可失敗而不封鎖」邊界)
//+ 1 次成功 → 失敗紀錄歸零, 跳 user view.
async function execAccountFailureReset(page, lang, u) {
    let t = kpUiText[lang]
    await insertUser(u)

    //對應 spec E2E-002 操作「連續以正確帳號 + 錯誤密碼嘗試登入『上限』次」: 門檻為 > (procProtect.mjs:225),
    //失敗 numForAccountLoginFailed 次 (== 上限, 未 > 上限) 不觸發封鎖, 即「失敗到邊界但尚未封鎖」.
    for (let i = 0; i < numForAccountLoginFailed; i++) {
        await gotoCleanLogin(page, lang)
        await attemptLogin(page, lang, u.account, 'WrongPw@99')
        await page.waitForFunction(
            (needle) => (document.body.innerText || '').includes(needle),
            t.loginIncorrect,
            { timeout: 60000 } //偵測上限放寬(原 10 秒; 負載高時登入回應較久, 2026-09-28)
        )
    }

    //最後 1 次輸對 → kpAccountLoginFailed 清空
    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, u.account, u.rawPassword)
    await page.waitForTimeout(10000)

    //等使用者資訊頁 mount (見 user name)
    await page.waitForFunction(
        (n) => (document.body.innerText || '').includes(n),
        u.name,
        { timeout: 60000 } //登入後轉址於負載高時較久, 偵測上限放寬(原 15 秒, 2026-09-28)
    )

    //框 user view 卡 (.sb) 標注登入成功後的使用者資訊頁
    return await captureStableWithBox(page, '.sb')
}


//case 3 (對應 spec E2E-003): timeBlocked=未來 + 正確密碼 → 保護層以 timeBlocked 判封鎖中 reject,
//回統一訊息 (D24 anti-enum: 與密碼錯誤同文案, 不洩漏封鎖狀態).
async function execBlockedLoginRejected(page, lang, u) {
    let t = kpUiText[lang]
    await insertUserWithBlock(u, ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, u.account, u.rawPassword)
    //對應 spec E2E-003 驗證「UI 出現對應 i18n 之封鎖訊息」: 封鎖訊息已統一為 failedLoginForCatch 文案.
    await page.waitForFunction(
        (needle) => (document.body.innerText || '').includes(needle),
        t.loginIncorrect,
        { timeout: 60000 } //偵測上限放寬(原 10 秒; 負載高時登入回應較久, 2026-09-28)
    )
    await page.waitForTimeout(1500)
    //框封鎖訊息紅字本身，標注封鎖中嘗試登入後的統一登入失敗訊息區（loginError inline div）
    let errorLoc003 = page.getByText(t.loginIncorrect, { exact: false }).first()
    return await captureStableWithBox(page, errorLoc003)
}


//case 4: timeBlocked=創建後30s → 等33s過期 → 登入成功 → user view
async function execBlockExpiryImplicitUnlock(page, lang, u) {
    let timeBlocked = ot().add(30, 'second').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    await insertUserWithBlock(u, timeBlocked)

    //等 33s 過期 (30s + 3s buffer; 隱性解除 (ADR-013): 由登入時 getBlockedByUser 比對當前時間判定, 無清理 timer)
    await page.waitForTimeout(33000)

    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, u.account, u.rawPassword)
    await page.waitForTimeout(10000)

    await page.waitForFunction(
        (n) => (document.body.innerText || '').includes(n),
        u.name,
        { timeout: 60000 } //登入後轉址於負載高時較久, 偵測上限放寬(原 15 秒, 2026-09-28)
    )

    //框 user view 卡 (.sb) 標注封鎖到期隱性解除後登入成功的使用者資訊頁
    return await captureStableWithBox(page, '.sb')
}


//case 5 (token-block): 純 API 驗證, 不回傳 buf
async function execTokenBlockTrigger(page, lang, u) {
    await insertUser(u)

    let token = await loginAndGetToken(page, lang, u.account, u.rawPassword)
    assert.strict.notEqual(token, null, 'login 應拿到 valid token')
    assert.strict.notEqual(token, '', 'login 應拿到非空 token')

    await page.evaluate(async ({ apiUrl, token, account, n }) => {
        let promises = []
        for (let i = 0; i < n; i++) {
            promises.push(fetch(`${apiUrl}/api/getSsoUserInfor?token=${token}&key=account&value=${account}`).catch(() => {}))
        }
        await Promise.allSettled(promises)
    }, { apiUrl, token, account: u.account, n: numForTokenCallApi + 1 })

    //等權杖封鎖計時器結算: 後端每 2 秒掃描權杖調用數, 超限即封鎖使用者並刪除其權杖(server/procProtect.mjs:386、:341-349);
    //以「DB 權杖已刪」為完成訊號(原固定 3 秒, 負載高時計時器延遲即誤判, 2026-09-28 改)
    await pollUntil('權杖封鎖計時器結算(該使用者權杖已刪)', async () => (await woItems.tokens.select({ userId: u.id })).length === 0, { timeout: 60000 })

    //再呼叫應 reject
    let result = await page.evaluate(async ({ apiUrl, token, account }) => {
        let r = await fetch(`${apiUrl}/api/getSsoUserInfor?token=${token}&key=account&value=${account}`)
        return await r.json()
    }, { apiUrl, token, account: u.account })

    //對應 spec「此時重整畫面不會自動登入而是回到登入頁」: token 已失效 → autoLogin 走 stale-token 路徑 → reject → 落回登入頁
    //截圖此終態作為 baseline (login form 出現, 不見 user view)
    let t = kpUiText[lang]
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    //等 autoLogin 走失效路徑落回登入表單: autoLogin 進行中只渲染連線狀態, 結束後才依結果渲染頁面(src/App.vue:7、:17、:113),
    //故登入表單出現即 autoLogin 已結束且為 reject, 不會再被拉回; 另驗其清空 LS 權杖(src/plugins/mUI.mjs:606, 失效路徑之確定訊號).
    //原「等表單後再固定等 3 秒確認停留」無非同步來源可等, 2026-09-28 改為此偵測(上限放寬至 60 秒供負載高時)
    await waitUntilExist(page, 'autoLogin 失效路徑落回登入表單(LS 權杖已清空)', () => document.querySelectorAll('input').length >= 2 && localStorage.getItem('ksso:userToken') === '', { timeout: 60000 })

    let pageText = await page.evaluate(() => document.body.innerText || '')
    //框登入卡 (.sb) 標注 token 失效後 reload 落回登入頁的表單區
    let buf = await captureStableWithBox(page, '.sb')

    return { result, token, userId: u.id, buf, pageText, hasLogin: pageText.includes(t.login) }
}


//case 6: 12001 次 $fapi.getWebInfor → C timer 寫 ips.timeBlocked → 新 page 進登入頁卡 Connecting
//終態 UI: 第二個 page 的登入頁顯示 Connecting (verifyConn 擋連線)
async function execIpBlockTrigger(browserRef, lang, u, virtIp) {
    let t = kpUiText[lang]
    await deleteIpRecord(virtIp)
    await insertUser(u)

    //新 browser context 帶 X-Forwarded-For
    await browserRef.current.close()
    browserRef.current = await launchBrowser()
    let ctx = await makeXForwardedForContext(browserRef.current, virtIp)
    let page = await ctx.newPage()

    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForFunction(() => {
        let el = null
        document.querySelectorAll('*').forEach((e) => {
            if (e.__vue__ && !el) {
                el = e
            }
        })
        return !!(el && el.__vue__ && el.__vue__.$root && el.__vue__.$root.$fapi)
    }, null, { timeout: 60000 }) //偵測上限放寬(原 15 秒, 2026-09-28)

    //分批並行打 $fapi.getWebInfor (走 /api/main → verifyConn → kpIpCallApi)
    let total = numForIpCallApi + 1
    let batchSize = 1000
    let sent = 0
    let blocked = false
    while (sent < total && !blocked) {
        let thisBatch = Math.min(batchSize, total - sent)
        await page.evaluate(async (n) => {
            let el = null
            document.querySelectorAll('*').forEach((e) => {
                if (e.__vue__ && !el) {
                    el = e
                }
            })
            let fapi = el.__vue__.$root.$fapi
            let promises = []
            for (let i = 0; i < n; i++) {
                promises.push(fapi.getWebInfor().catch(() => {}))
            }
            await Promise.allSettled(promises)
        }, thisBatch)
        sent += thisBatch
        await page.waitForTimeout(2500)
        let ipsChk = await woItems.ips.select({ ip: virtIp })
        if (ipsChk.length > 0 && ipsChk[0].timeBlocked !== '') {
            blocked = true
        }
    }
    console.log(`[ip-block-trigger ${lang}] 送出 ${sent} 次 $fapi.getWebInfor, blocked=${blocked}`)

    //等 C timer 結算(每 2 秒掃描 IP 調用數, 超限寫 ips.timeBlocked, server/procProtect.mjs:770-818): 迴圈內已見封鎖者立即成立;
    //迴圈以送完次數結束而尚未見封鎖者, 輪詢至寫入為止(原固定 3 秒, 負載高時計時器延遲即讀到未封鎖, 2026-09-28 改)
    let ips = await pollUntil('C timer 寫入 ips.timeBlocked', async () => {
        let rs = await woItems.ips.select({ ip: virtIp })
        return rs.length > 0 && rs[0].timeBlocked !== '' ? rs : null
    }, { timeout: 60000 })

    //驗 UI: 新開 page 進登入頁卡 Connecting (verifyConn 擋連線)
    //另以網路層確認「伺服器確實拒絕」: 連線層未通過時 /api 回應標頭 Return-Msg 為 permission denied
    //(node_modules/w-converhp/src/WConverhpServer.mjs:1139、routeSpec.mjs:22), 使「10s 後仍卡 Connecting」不致於負載高、
    //正常連線本身慢於 10s 時誤判為被擋(spec 之 10s 為使用者觀察期, 仍照等; 2026-09-28 補)
    let page2 = await ctx.newPage()
    let denied2 = page2.waitForResponse((r) => r.url().includes('/api') && r.headers()['return-msg'] === 'permission denied', { timeout: 60000 }).then(() => true, (err) => err)
    await page2.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    await page2.waitForTimeout(10000)
    let d2 = await denied2
    assert.strict.equal(d2, true, `進登入頁後應收到連線層拒絕(Return-Msg: permission denied), 實際: ${d2 && d2.message ? d2.message : d2}`)

    //驗 connecting 在 page2 內仍可見, 確認被卡住
    let pageText = await page2.evaluate(() => document.body.innerText || '')
    //框 Connecting 動畫圖示 + 旁邊文字聯集，標注 IP 封鎖後卡 Connecting 的顯示區
    //img_connection 含 SVG <animate>，captureStable 內部 animatedRects 機制自動貼靜態影格，不需額外 mask
    //文字以 getByText 定位（同 e2e-init）：原 'div[style*="margin-left:10px"]' 永不命中（渲染後 style 為 `margin-left: 10px`，冒號後有空格），
    //聯集只剩圖示、「連線中…」文字落在框外（2026-09-28 修正）；文字經 itemsUnionBox fit 量墨跡並外擴 inkPad（元素緊貼文字，
    //直接框元素時紅框內緣距「…」僅約 1px、紅框壓字，2026-09-28 同日再修）
    let buf = await captureStableWithBox(page2, ['img[src^="data:image/svg+xml"]', itemsUnionBox(page2.getByText(t.connecting).first(), { fit: true })])

    await page2.close()
    await deleteIpRecord(virtIp)

    return { buf, ips, pageText, hasConnecting: pageText.includes(t.connecting), hasLogin: pageText.includes(t.login) }
}


//case 7: ips.timeBlocked=未來 + 該 IP → 卡 Connecting
async function execIpBlockedRejected(browserRef, lang, virtIp) {
    let t = kpUiText[lang]
    let timeBlocked = ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    await insertIpWithBlockState(virtIp, timeBlocked)

    await browserRef.current.close()
    browserRef.current = await launchBrowser()
    let ctx = await makeXForwardedForContext(browserRef.current, virtIp)
    let page = await ctx.newPage()

    //網路層確認伺服器確實拒絕(同 E2E-006, 2026-09-28 補); spec 之 10s 使用者觀察期照等
    let denied = page.waitForResponse((r) => r.url().includes('/api') && r.headers()['return-msg'] === 'permission denied', { timeout: 60000 }).then(() => true, (err) => err)
    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(10000)
    let d = await denied
    assert.strict.equal(d, true, `進登入頁後應收到連線層拒絕(Return-Msg: permission denied), 實際: ${d && d.message ? d.message : d}`)

    let pageText = await page.evaluate(() => document.body.innerText || '')
    //框 Connecting 動畫圖示 + 旁邊文字聯集，標注 IP 封鎖中進登入頁卡 Connecting 的顯示區（文字定位同上，2026-09-28 修正）
    let buf = await captureStableWithBox(page, ['img[src^="data:image/svg+xml"]', itemsUnionBox(page.getByText(t.connecting).first(), { fit: true })])

    await deleteIpRecord(virtIp)
    return { buf, pageText, hasConnecting: pageText.includes(t.connecting), hasLogin: pageText.includes(t.login) }
}


//case 8: ips.timeBlocked=10s 後 → 等過期 → 進登入頁可見表單
async function execIpExpiryImplicitUnlock(browserRef, lang, virtIp) {
    let t = kpUiText[lang]
    let timeBlocked = ot().add(10, 'second').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    await insertIpWithBlockState(virtIp, timeBlocked)

    await browserRef.current.close()
    browserRef.current = await launchBrowser()
    let ctx = await makeXForwardedForContext(browserRef.current, virtIp)
    let page = await ctx.newPage()

    await page.waitForTimeout(12000)

    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })

    await page.waitForFunction(() => {
        let inps = document.querySelectorAll('input')
        return inps.length >= 2
    }, null, { timeout: 60000 }) //偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(500)

    let pageText = await page.evaluate(() => document.body.innerText || '')
    //框登入卡 (.sb) 標注 IP 封鎖到期隱性解除後可正常進入登入頁的表單區
    let buf = await captureStableWithBox(page, '.sb')

    await deleteIpRecord(virtIp)
    return { buf, pageText, hasLogin: pageText.includes(t.login) }
}


//case 9: 新 IP 成功登入 → D timer 觸發 → ips 表自動補登記
async function execNewIpRegistration(browserRef, lang, u, virtIp) {
    await deleteIpRecord(virtIp)
    await insertUser(u)

    await browserRef.current.close()
    browserRef.current = await launchBrowser()
    let ctx = await makeXForwardedForContext(browserRef.current, virtIp)
    let page = await ctx.newPage()
    page.on('dialog', (d) => d.accept())

    await gotoCleanLogin(page, lang)
    await attemptLogin(page, lang, u.account, u.rawPassword)
    await page.waitForTimeout(10000)

    await page.waitForFunction(
        (n) => (document.body.innerText || '').includes(n),
        u.name,
        { timeout: 60000 } //登入後轉址於負載高時較久, 偵測上限放寬(原 15 秒, 2026-09-28)
    )
    let url = page.url()

    //等 D timer 補登記(每 2 秒比對 kpIpCallApi 與 ips 表差集並 insert, server/procProtect.mjs:703-765);
    //輪詢至該 IP 出現為止(原固定 3 秒, 負載高時計時器延遲即讀到空表, 2026-09-28 改)
    let ips = await pollUntil('D timer 補登記新 IP 至 ips 表', async () => {
        let rs = await woItems.ips.select({ ip: virtIp })
        return rs.length > 0 ? rs : null
    }, { timeout: 60000 })

    //框 user view 卡 (.sb) 標注新 IP 成功登入後的使用者資訊頁（D timer 已補登記至 ips 表）
    let buf = await captureStableWithBox(page, '.sb')

    await deleteIpRecord(virtIp)
    return { buf, url, ips }
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//虛擬 client IP 之末段基數 (eng 100 / cht 200, 兩語系不撞 in-memory kpIpCallApi 與 ips 表紀錄)
function ipSufOf(lang) {
    return lang === 'eng' ? 100 : 200
}

//UI 文字語意斷言 (原本只在比對端): 頁面顯示統一登入失敗訊息 (D24 anti-enum, == 密碼錯誤文案; 子字串 loginIncorrect 命中 failedLoginForCatch 翻譯)
async function assertLoginIncorrectShown(page, lang) {
    let pageText = await page.evaluate(() => document.body.innerText || '')
    assert.strict.equal(pageText.includes(kpUiText[lang].loginIncorrect), true, `應顯示統一登入失敗訊息, 實際前 200 字: ${pageText.slice(0, 200)}`)
}

//順序與 mocha it 相同 (產製順序 ≡ 比對順序); title 為 mocha it 標題 (--grep 依之); 本檔每案 1 張, 圖鍵即案例鍵.
//編號對齊 spec bullet 順序 (非 mocha case index): 共 10 條 spec, gap 在 009.
//  001-008: account/token/ip 系列封鎖機制
//  009: 後端取不到 client IP (spec 標明「不測試」) → 無 baseline 檔留 gap
//  010: new-ip-registration
//如此 baseline 編號跟 spec bullet 一一對應, 看到 fail 訊息「010-new-ip-registration」
//就知道是 spec 第 10 條, 對 audit / 追溯都更穩定 (詳全域 CLAUDE.md §6.3 命名編號慣例).
//006-010 之 run 會以 ctx.browserRef 換掉瀏覽器 (帶 X-Forwarded-For), 原頁面已關, 故其斷言只讀 run 之回傳 (ctx.result).
let cases = [
    {
        name: 'E2E-001-account-block-trigger',
        title: `account-block-trigger: 真打 ${numForAccountLoginFailed + 1} 次失敗 → 即時封鎖 (D24) → DB timeBlocked 寫入 + 再登入 UI 顯示統一失敗訊息`,
        run: (page, lang) => execAccountBlockTrigger(page, lang, makeTestUsers(lang).block1),
        stages: ['E2E-001-account-block-trigger'],
        semantic: async (ctx) => {
            //UI 語意 (對應 spec E2E-001 驗證「UI 出現對應 i18n 之封鎖訊息」): 顯示統一失敗訊息
            await assertLoginIncorrectShown(ctx.page, ctx.lang)
            //UI 語意斷言 (對應 spec E2E-001 驗證「當前 URL 不含 view=user (仍停留登入頁)」): 不應 redirect 至 user view
            let urlNow = ctx.page.url()
            assert.strict.equal(urlNow.includes('view=user'), false)
        },
        verify: async (ctx) => {
            //DB: user.timeBlocked 為未來時間 (對應 spec E2E-001 驗證「DB users.timeBlocked 為未來時間」)
            let u = makeTestUsers(ctx.lang).block1
            let users = await woItems.users.select({ id: u.id })
            assert.strict.equal(users.length, 1)
            let blockTime = new Date(users[0].timeBlocked).getTime()
            assert.strict.equal(blockTime > Date.now(), true, `timeBlocked 應為未來時間, 實際 ${users[0].timeBlocked}`)
        },
    },
    {
        name: 'E2E-002-account-failure-reset',
        title: `account-failure-reset: ${numForAccountLoginFailed} 次失敗 (達門檻邊界未封鎖) + 1 次成功 → 失敗歸零, 轉跳使用者資訊頁`,
        run: (page, lang) => execAccountFailureReset(page, lang, makeTestUsers(lang).reset2),
        stages: ['E2E-002-account-failure-reset'],
        semantic: async (ctx) => {
            //URL 跳 view=user (對應 spec E2E-002 驗證「當前 URL 含 view=user」)
            let url = ctx.page.url()
            assert.strict.match(url, /view=user/, `應跳至 user view, 實際 URL: ${url}`)
        },
        verify: async (ctx) => {
            //user.timeBlocked 應仍空 (對應 spec E2E-002 驗證「DB users.timeBlocked 仍為空字串, 失敗紀錄已歸零、未觸發封鎖」)
            //D07 門檻 >: numForAccountLoginFailed 次失敗 (== 上限, 未 > 上限) 本就不封鎖; 即時化下成功登入亦同步清空 in-memory 失敗紀錄.
            let u = makeTestUsers(ctx.lang).reset2
            await ctx.page.waitForTimeout(3000)
            let users = await woItems.users.select({ id: u.id })
            assert.strict.equal(users[0].timeBlocked, '', `失敗歸零後不應封鎖, 實際 "${users[0].timeBlocked}"`)
        },
    },
    {
        name: 'E2E-003-blocked-login-rejected',
        title: 'blocked-login-rejected: timeBlocked=未來 + 正確密碼 → 顯示統一登入失敗訊息',
        run: (page, lang) => execBlockedLoginRejected(page, lang, makeTestUsers(lang).targetBlocked),
        stages: ['E2E-003-blocked-login-rejected'],
        semantic: async (ctx) => {
            //UI 語意 (對應 spec E2E-003 驗證「UI 出現對應 i18n 之封鎖訊息」): 顯示統一失敗訊息
            await assertLoginIncorrectShown(ctx.page, ctx.lang)
            //對應 spec E2E-003 驗證「當前 URL 不含 view=user (仍停留登入頁)」
            let urlNow = ctx.page.url()
            assert.strict.equal(urlNow.includes('view=user'), false)
        },
        verify: async (ctx) => {
            //對應 spec E2E-003 驗證「DB users.timeBlocked 仍為未來時間」
            let u = makeTestUsers(ctx.lang).targetBlocked
            let users = await woItems.users.select({ id: u.id })
            let blockTime = new Date(users[0].timeBlocked).getTime()
            assert.strict.equal(blockTime > Date.now(), true)
        },
    },
    {
        name: 'E2E-004-block-expiry-implicit-unlock',
        title: 'block-expiry-implicit-unlock: timeBlocked=創建後30s → 等33s過期 → 隱性解除 → 登入成功轉跳 user 頁',
        timeout: 180000,
        run: (page, lang) => execBlockExpiryImplicitUnlock(page, lang, makeTestUsers(lang).targetExpired),
        stages: ['E2E-004-block-expiry-implicit-unlock'],
        semantic: async (ctx) => {
            let urlNow = ctx.page.url()
            assert.strict.equal(urlNow.includes('view=user'), true, `應已 redirect 至 user view, 實際 URL: ${urlNow}`)
        },
    },
    {
        name: 'E2E-005-token-block-trigger',
        title: `token-block-trigger: Promise.allSettled ${numForTokenCallApi + 1} 次 getSsoUserInfor → token 失效, reload 後落回登入頁`,
        //回傳 { result, token, userId, buf, pageText, hasLogin }: 截圖取 buf, 其餘供斷言 (ctx.result)
        run: (page, lang) => execTokenBlockTrigger(page, lang, makeTestUsers(lang).token5),
        stages: ['E2E-005-token-block-trigger'],
        semantic: async (ctx) => {
            let r = ctx.result
            //UI 語意: reload 後落回登入頁 (見 Log in 按鈕, 不被 autoLogin 拉回)
            assert.strict.equal(r.hasLogin, true, `reload 後應落回登入頁見 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
        },
        verify: async (ctx) => {
            let r = ctx.result
            //API 拒絕
            assert.strict.equal(r.result.state, 'error', `應 reject, 實際 state=${r.result.state}`)
            //ADR-006 對外統一 防 information leakage. getSsoUserInfor 為 server-to-server REST endpoint
            //(非 kpfun, 不經 _tErr 翻譯), 回 machine-readable key 'tokenExpired' 供 API caller 判斷.
            //(批 A: token 驗證鏈 reject 改回 key 名, checkToken/checkTokenByObj catch 統一 'tokenExpired'.)
            assert.strict.equal(r.result.msg, 'tokenExpired', `應回報 key 'tokenExpired' (ADR-006 統一), 實際 msg=${r.result.msg}`)

            //DB token 已刪
            let tokens = await woItems.tokens.select({ userId: r.userId })
            assert.strict.equal(tokens.length, 0, `token 應被刪除, 實際剩 ${tokens.length} 筆`)

            //user.timeBlocked 未來時間
            let users = await woItems.users.select({ id: r.userId })
            let blockTime = new Date(users[0].timeBlocked).getTime()
            assert.strict.equal(blockTime > Date.now(), true)
        },
    },
    {
        name: 'E2E-006-ip-block-trigger',
        title: `ip-block-trigger: Promise.allSettled ${numForIpCallApi + 1} 次 $fapi.getWebInfor → C timer 觸發 → 進登入頁 10s 後仍卡 Connecting`,
        timeout: 600000,
        //回傳 { buf, ips, pageText, hasConnecting, hasLogin }
        run: (page, lang, ctx) => execIpBlockTrigger(ctx.browserRef, lang, makeTestUsers(lang).ipblock6, `1.2.3.${ipSufOf(lang)}`),
        stages: ['E2E-006-ip-block-trigger'],
        semantic: async (ctx) => {
            let r = ctx.result
            //驗 2 UI 語意: 10s 後仍顯示 Connecting, 不應出現 Log in 按鈕
            assert.strict.equal(r.hasConnecting, true, `10s 後應仍顯示 Connecting, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            assert.strict.equal(r.hasLogin, false, `不應出現 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
        },
        verify: async (ctx) => {
            let r = ctx.result
            let virtIp = `1.2.3.${ipSufOf(ctx.lang)}`
            //驗 1 DB: ips.timeBlocked 為未來時間 (run 內刪除該 IP 紀錄前所讀)
            assert.strict.equal(r.ips.length, 1, `ips 表應有 ${virtIp} 紀錄, 實際 ${r.ips.length} 筆`)
            let blockTime = new Date(r.ips[0].timeBlocked).getTime()
            assert.strict.equal(blockTime > Date.now(), true, `timeBlocked 應為未來時間, 實際 ${r.ips[0].timeBlocked}`)
        },
    },
    {
        name: 'E2E-007-ip-blocked-rejected',
        title: 'ip-blocked-rejected: ips.timeBlocked=未來 + X-Forwarded-For 該 IP → 進登入頁卡 Connecting',
        //回傳 { buf, pageText, hasConnecting, hasLogin }
        run: (page, lang, ctx) => execIpBlockedRejected(ctx.browserRef, lang, `1.2.3.${ipSufOf(lang) + 1}`),
        stages: ['E2E-007-ip-blocked-rejected'],
        semantic: async (ctx) => {
            let r = ctx.result
            assert.strict.equal(r.hasConnecting, true, `10s 後應仍顯示 Connecting, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            assert.strict.equal(r.hasLogin, false, `不應出現 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
        },
    },
    {
        name: 'E2E-008-ip-expiry-implicit-unlock',
        title: 'ip-expiry-implicit-unlock: ips.timeBlocked=10s 後 → 等過期 → 進登入頁可見表單',
        //回傳 { buf, pageText, hasLogin }
        run: (page, lang, ctx) => execIpExpiryImplicitUnlock(ctx.browserRef, lang, `1.2.3.${ipSufOf(lang) + 2}`),
        stages: ['E2E-008-ip-expiry-implicit-unlock'],
        semantic: async (ctx) => {
            let r = ctx.result
            assert.strict.equal(r.hasLogin, true, `過期後應可進登入頁見 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
        },
    },
    {
        name: 'E2E-010-new-ip-registration',
        title: 'new-ip-registration: 新 IP 成功登入轉跳使用者資訊頁 → D timer 觸發 → ips 表自動補登記',
        //回傳 { buf, url, ips }
        run: (page, lang, ctx) => execNewIpRegistration(ctx.browserRef, lang, makeTestUsers(lang).ip9, `1.2.3.${ipSufOf(lang) + 3}`),
        stages: ['E2E-010-new-ip-registration'],
        semantic: async (ctx) => {
            //URL 跳 view=user
            assert.strict.match(ctx.result.url, /view=user/, `應跳至 user view, 實際 URL: ${ctx.result.url}`)
        },
        verify: async (ctx) => {
            let r = ctx.result
            let virtIp = `1.2.3.${ipSufOf(ctx.lang) + 3}`
            //ips 表自動補登記 (run 內刪除該 IP 紀錄前所讀)
            assert.strict.equal(r.ips.length, 1, `ips 表應有 ${virtIp} 紀錄, 實際 ${r.ips.length} 筆`)
            assert.strict.equal(r.ips[0].timeBlocked, '', `純登記, timeBlocked 應為空, 實際 "${r.ips[0].timeBlocked}"`)
        },
    },
]

//單一案例管線: per-case 前置 (DB 重置 + 本語系特化帳號清除 + 本機 IP 紀錄清除 + in-memory 計數清除; 開瀏覽器前, 兩端同序)
//→ fresh browser (新 context, 自動接受 dialog; 006-010 由 run 以 ctx.browserRef 換成帶 X-Forwarded-For 之瀏覽器, finally 關最新者)
//→ 流程 → 語意斷言 → DB / API 不變式 → 寫檔 / 比對 → 關瀏覽器 → 清資料
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        semantic: c.semantic,
        verify: c.verify,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => `autoblock-${lg}-${key}`,
        match: assertBaselineMatch,
        prepare: async () => {
            //先重置為 canonical base seed (wipe users/tokens/ips 全表 + 插入 3 users + 4 tokens),
            //再清自己的特化資料殘留 + reset in-memory rate-limit state.
            //resetToBaseSeed 會 wipe ips 表, 故須在每 case 自己 insertUser/insertIpWithBlockState (於 run 內) 之前呼叫.
            await resetToBaseSeed()
            await deleteAllTestUsers(makeTestUsers(lang))
            for (let ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
                await deleteIpRecord(ip)
            }
            await cleanKpIpCallApi()
            await cleanKpAccountLoginFailed()
        },
        afterCase: async () => {
            //deleteNonBaseSeed 清掉所有非 base seed 的 users + tokens 並 wipe ips 表.
            //server in-memory rate-limit 計數 (kpIpCallApi / kpAccountLoginFailed) 不屬 DB rows, 不涵蓋,
            //由下一案 prepare 之 cleanKpIpCallApi() + cleanKpAccountLoginFailed() 重置.
            await deleteNonBaseSeed()
        },
        ...extra,
    })
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    //截圖前篩選 (--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR); 不符任何鍵即於此報錯
    let gate = createBaselineGate({ langs, cases })
    console.log(gate.describe())
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of gate.langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }
    //--names 之任一項未產出即報錯 (不靜默略過)
    gate.finalize()

    console.log('=== 標準圖產生完成 ===')

    cleanup()
}


// ===================================================================
// mocha 測試模式
// ===================================================================

if (process.argv.includes('--baseline')) {
    generateBaseline()
        .catch((err) => {
            console.error(err)
            process.exit(1)
        })
}
else {

    for (let lang of langs) {

        describe(`AutoBlock E2E [${lang}] — 自動封鎖機制完整覆蓋`, function() {
            this.timeout(180000)

            //per-case 獨立 (DB 重置 + in-memory 計數清除 + fresh browser) 由 runCase 負責, 確保單 case --grep 也能跑
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()
            })

            //語意斷言與 DB / API 不變式皆於比對標準圖之前 (pixel baseline 為補強層); 個別案例之 it timeout 保留 (004: 180000, 006: 600000)
            for (let c of cases) {
                it(c.title, async function() {
                    if (c.timeout) {
                        this.timeout(c.timeout)
                    }
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })

    }

}
