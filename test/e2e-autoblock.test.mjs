import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch, launchBrowser, typeIntoNthInput } from './e2e-setup.mjs'


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
//   --names 進行手術式 baseline 重產
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


let baselineNamesFilter = null
{
    let i = process.argv.indexOf('--names')
    if (i >= 0 && process.argv[i + 1]) {
        baselineNamesFilter = new Set(process.argv[i + 1].split(','))
    }
}
function writeBaseline(lang, name, buf) {
    if (baselineNamesFilter && !baselineNamesFilter.has(`${lang}-${name}`)) {
        console.log(`  [skip] ${lang}-${name}`)
        return
    }
    fs.writeFileSync(bp(lang, name), buf)
}
//是否需要產生此 case 的標準圖. --names 指定時只有指定 case 回 true → 連「截圖」都跳過 (非僅跳寫檔).
function shouldGen(lang, name) {
    return !baselineNamesFilter || baselineNamesFilter.has(`${lang}-${name}`)
}


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
    }, null, { timeout: 15000 })
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
    //跨頁 redirect 等 10s
    await page.waitForTimeout(10000)
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
            { timeout: 10000 }
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
        { timeout: 10000 }
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
            { timeout: 10000 }
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
        { timeout: 15000 }
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
        { timeout: 10000 }
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
        { timeout: 15000 }
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

    await page.waitForTimeout(3000)

    //再呼叫應 reject
    let result = await page.evaluate(async ({ apiUrl, token, account }) => {
        let r = await fetch(`${apiUrl}/api/getSsoUserInfor?token=${token}&key=account&value=${account}`)
        return await r.json()
    }, { apiUrl, token, account: u.account })

    //對應 spec「此時重整畫面不會自動登入而是回到登入頁」: token 已失效 → autoLogin 走 stale-token 路徑 → reject → 落回登入頁
    //截圖此終態作為 baseline (login form 出現, 不見 user view)
    let t = kpUiText[lang]
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    //等 SPA mount + autoLogin 失敗後落回登入表單
    await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, null, { timeout: 15000 })
    //再等一下確認停留 login (不會被 autoLogin 拉回)
    await page.waitForTimeout(3000)

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
    }, null, { timeout: 15000 })

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
    await page.waitForTimeout(3000)

    let ips = await woItems.ips.select({ ip: virtIp })

    //驗 UI: 新開 page 進登入頁卡 Connecting (verifyConn 擋連線)
    let page2 = await ctx.newPage()
    await page2.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
    await page2.waitForTimeout(10000)

    //驗 connecting 在 page2 內仍可見, 確認被卡住
    let pageText = await page2.evaluate(() => document.body.innerText || '')
    //框 Connecting 動畫圖示 + 旁邊文字聯集，標注 IP 封鎖後卡 Connecting 的顯示區
    //img_connection 含 SVG <animate>，captureStable 內部 animatedRects 機制自動後製填黑，不需額外 mask
    let buf = await captureStableWithBox(page2, ['img[src^="data:image/svg+xml"]', 'div[style*="margin-left:10px"]'])

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

    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(10000)

    let pageText = await page.evaluate(() => document.body.innerText || '')
    //框 Connecting 動畫圖示 + 旁邊文字聯集，標注 IP 封鎖中進登入頁卡 Connecting 的顯示區
    let buf = await captureStableWithBox(page, ['img[src^="data:image/svg+xml"]', 'div[style*="margin-left:10px"]'])

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
    }, null, { timeout: 15000 })
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
        { timeout: 15000 }
    )
    let url = page.url()

    //等 3s D timer 補登記
    await page.waitForTimeout(3000)
    let ips = await woItems.ips.select({ ip: virtIp })

    //框 user view 卡 (.sb) 標注新 IP 成功登入後的使用者資訊頁（D timer 已補登記至 ips 表）
    let buf = await captureStableWithBox(page, '.sb')

    await deleteIpRecord(virtIp)
    return { buf, url, ips }
}


// ===================================================================
// 產生標準圖 (per case → per lang)
// ===================================================================

async function generateBaselineForLang(lang) {
    let testUsers = makeTestUsers(lang)

    let ipSuf = lang === 'eng' ? 100 : 200
    //編號對齊 spec bullet 順序 (非 mocha case index): 共 10 條 spec, gap 在 009.
    //  001-008: account/token/ip 系列封鎖機制
    //  009: 後端取不到 client IP (spec 標明「不測試」) → 無 baseline 檔留 gap
    //  010: new-ip-registration
    //如此 baseline 編號跟 spec bullet 一一對應, 看到 fail 訊息「010-new-ip-registration」
    //就知道是 spec 第 10 條, 對 audit / 追溯都更穩定 (詳全域 CLAUDE.md §6.3 命名編號慣例).
    let cases = [
        {
            name: 'E2E-001-account-block-trigger',
            fn: async (b) => execAccountBlockTrigger(b.page, lang, testUsers.block1),
        },
        {
            name: 'E2E-002-account-failure-reset',
            fn: async (b) => execAccountFailureReset(b.page, lang, testUsers.reset2),
        },
        {
            name: 'E2E-003-blocked-login-rejected',
            fn: async (b) => execBlockedLoginRejected(b.page, lang, testUsers.targetBlocked),
        },
        {
            name: 'E2E-004-block-expiry-implicit-unlock',
            fn: async (b) => execBlockExpiryImplicitUnlock(b.page, lang, testUsers.targetExpired),
        },
        {
            name: 'E2E-005-token-block-trigger',
            fn: async (b) => {
                let r = await execTokenBlockTrigger(b.page, lang, testUsers.token5)
                return r.buf
            },
        },
        {
            name: 'E2E-006-ip-block-trigger',
            fn: async (b) => {
                let r = await execIpBlockTrigger(b.browserRef, lang, testUsers.ipblock6, `1.2.3.${ipSuf}`)
                return r.buf
            },
        },
        {
            name: 'E2E-007-ip-blocked-rejected',
            fn: async (b) => {
                let r = await execIpBlockedRejected(b.browserRef, lang, `1.2.3.${ipSuf + 1}`)
                return r.buf
            },
        },
        {
            name: 'E2E-008-ip-expiry-implicit-unlock',
            fn: async (b) => {
                let r = await execIpExpiryImplicitUnlock(b.browserRef, lang, `1.2.3.${ipSuf + 2}`)
                return r.buf
            },
        },
        {
            name: 'E2E-010-new-ip-registration',
            fn: async (b) => {
                let r = await execNewIpRegistration(b.browserRef, lang, testUsers.ip9, `1.2.3.${ipSuf + 3}`)
                return r.buf
            },
        },
    ]

    for (let { name, fn } of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        //per-case fresh DB + browser, 與 mocha beforeEach 對稱
        //先重置為 base seed (wipe users/tokens/ips + 插 3 users/4 tokens), 再清自己特化資料殘留.
        //須在 fn (內含 insertUser/insertIpWithBlockState) 之前, 因 resetToBaseSeed 會 wipe ips 表.
        await resetToBaseSeed()
        await deleteAllTestUsers(testUsers)
        for (let ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
            await deleteIpRecord(ip)
        }
        await cleanKpIpCallApi()
        await cleanKpAccountLoginFailed()

        let browser = await launchBrowser()
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', (d) => d.accept())

        //部分 case 需重建 browser context (帶 X-Forwarded-For), 透過 ref 物件讓 exec 能換掉 browser
        let browserRef = { current: browser }

        try {
            let buf = await fn({ page, browserRef })
            if (buf) writeBaseline(lang, name, buf)
        }
        finally {
            if (browserRef.current) {
                await browserRef.current.close().catch(() => {})
            }
        }

        //per-case teardown: deleteNonBaseSeed 清掉所有非 base seed users + tokens 並 wipe ips,
        //取代原本的 deleteAllTestUsers (DB rows). in-memory rate-limit 計數由下一輪迴圈開頭的
        //cleanKpIpCallApi() / cleanKpAccountLoginFailed() 重置, deleteNonBaseSeed 不涵蓋.
        await deleteNonBaseSeed()
    }
}


async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
        await generateBaselineForLang(lang)
    }

    //token-block 不出 baseline, 略過產製階段

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

        let browser
        let page
        let testUsers = makeTestUsers(lang)

        describe(`AutoBlock E2E [${lang}] — 自動封鎖機制完整覆蓋`, function() {
            this.timeout(180000)

            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()

                //先重置為 canonical base seed (wipe users/tokens/ips 全表 + 插入 3 users + 4 tokens),
                //再清自己的特化資料殘留 + reset in-memory rate-limit state.
                //resetToBaseSeed 會 wipe ips 表, 故須在每 case 自己 insertUser/insertIpWithBlockState 之前呼叫.
                //(autoblock 的 own-data insert 發生在各 it() 內的 exec* 函式, beforeEach 是唯一共同前置點)
                await resetToBaseSeed()

                await deleteAllTestUsers(testUsers)
                for (let ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
                    await deleteIpRecord(ip)
                }
                await cleanKpIpCallApi()
                await cleanKpAccountLoginFailed()

                browser = await launchBrowser()
                let context = await browser.newContext()
                page = await context.newPage()
                page.on('dialog', (d) => d.accept())
            })

            afterEach(async function() {
                if (browser) {
                    await browser.close().catch(() => {})
                    browser = null
                }
                //deleteNonBaseSeed 已清掉所有非 base seed 的 users + tokens 並 wipe ips 表,
                //取代原本的 deleteAllTestUsers (DB rows). server in-memory rate-limit 計數
                //(kpIpCallApi / kpAccountLoginFailed) 不屬 DB rows, deleteNonBaseSeed 不涵蓋,
                //由 beforeEach 的 cleanKpIpCallApi() + cleanKpAccountLoginFailed() 重置 (此處不需重複).
                await deleteNonBaseSeed()
            })


            async function assertBaseline(buf, caseName) {
                let baselinePath = bp(lang, caseName)
                //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
                assertBaselineMatch(buf, baselinePath, `autoblock-${lang}-${caseName}`)
            }


            it(`account-block-trigger: 真打 ${numForAccountLoginFailed + 1} 次失敗 → 即時封鎖 (D24) → DB timeBlocked 寫入 + 再登入 UI 顯示統一失敗訊息`, async function() {
                let u = testUsers.block1
                let buf = await execAccountBlockTrigger(page, lang, u)
                await assertBaseline(buf, 'E2E-001-account-block-trigger')

                //DB: user.timeBlocked 為未來時間 (對應 spec E2E-001 驗證「DB users.timeBlocked 為未來時間」)
                let users = await woItems.users.select({ id: u.id })
                assert.strict.equal(users.length, 1)
                let blockTime = new Date(users[0].timeBlocked).getTime()
                assert.strict.equal(blockTime > Date.now(), true, `timeBlocked 應為未來時間, 實際 ${users[0].timeBlocked}`)

                //UI 語意 (對應 spec E2E-001 驗證「UI 出現對應 i18n 之封鎖訊息」): 顯示統一失敗訊息
                //(D24 anti-enum, == 密碼錯誤文案; 子字串 loginIncorrect 命中 failedLoginForCatch 翻譯)
                let pageText = await page.evaluate(() => document.body.innerText || '')
                assert.strict.equal(pageText.includes(kpUiText[lang].loginIncorrect), true, `應顯示統一登入失敗訊息, 實際前 200 字: ${pageText.slice(0, 200)}`)

                //UI 語意斷言 (對應 spec E2E-001 驗證「當前 URL 不含 view=user (仍停留登入頁)」): 不應 redirect 至 user view
                let urlNow = page.url()
                assert.strict.equal(urlNow.includes('view=user'), false)
            })


            it(`account-failure-reset: ${numForAccountLoginFailed} 次失敗 (達門檻邊界未封鎖) + 1 次成功 → 失敗歸零, 轉跳使用者資訊頁`, async function() {
                let u = testUsers.reset2
                let buf = await execAccountFailureReset(page, lang, u)
                await assertBaseline(buf, 'E2E-002-account-failure-reset')

                //URL 跳 view=user (對應 spec E2E-002 驗證「當前 URL 含 view=user」)
                let url = page.url()
                assert.strict.match(url, /view=user/, `應跳至 user view, 實際 URL: ${url}`)

                //user.timeBlocked 應仍空 (對應 spec E2E-002 驗證「DB users.timeBlocked 仍為空字串, 失敗紀錄已歸零、未觸發封鎖」)
                //D07 門檻 >: numForAccountLoginFailed 次失敗 (== 上限, 未 > 上限) 本就不封鎖; 即時化下成功登入亦同步清空 in-memory 失敗紀錄.
                await page.waitForTimeout(3000)
                let users = await woItems.users.select({ id: u.id })
                assert.strict.equal(users[0].timeBlocked, '', `失敗歸零後不應封鎖, 實際 "${users[0].timeBlocked}"`)
            })


            it('blocked-login-rejected: timeBlocked=未來 + 正確密碼 → 顯示統一登入失敗訊息', async function() {
                let u = testUsers.targetBlocked
                let buf = await execBlockedLoginRejected(page, lang, u)
                await assertBaseline(buf, 'E2E-003-blocked-login-rejected')

                //UI 語意 (對應 spec E2E-003 驗證「UI 出現對應 i18n 之封鎖訊息」): 顯示統一失敗訊息
                //(D24 anti-enum, == 密碼錯誤文案; 子字串 loginIncorrect 命中 failedLoginForCatch 翻譯)
                let pageText = await page.evaluate(() => document.body.innerText || '')
                assert.strict.equal(pageText.includes(kpUiText[lang].loginIncorrect), true, `應顯示統一登入失敗訊息, 實際前 200 字: ${pageText.slice(0, 200)}`)

                //對應 spec E2E-003 驗證「當前 URL 不含 view=user (仍停留登入頁)」
                let urlNow = page.url()
                assert.strict.equal(urlNow.includes('view=user'), false)

                //對應 spec E2E-003 驗證「DB users.timeBlocked 仍為未來時間」
                let users = await woItems.users.select({ id: u.id })
                let blockTime = new Date(users[0].timeBlocked).getTime()
                assert.strict.equal(blockTime > Date.now(), true)
            })


            it('block-expiry-implicit-unlock: timeBlocked=創建後30s → 等33s過期 → 隱性解除 → 登入成功轉跳 user 頁', async function() {
                this.timeout(180000)
                let u = testUsers.targetExpired
                let buf = await execBlockExpiryImplicitUnlock(page, lang, u)
                await assertBaseline(buf, 'E2E-004-block-expiry-implicit-unlock')

                let urlNow = page.url()
                assert.strict.equal(urlNow.includes('view=user'), true, `應已 redirect 至 user view, 實際 URL: ${urlNow}`)
            })


            it(`token-block-trigger: Promise.allSettled ${numForTokenCallApi + 1} 次 getSsoUserInfor → token 失效, reload 後落回登入頁`, async function() {
                let u = testUsers.token5
                let r = await execTokenBlockTrigger(page, lang, u)

                await assertBaseline(r.buf, 'E2E-005-token-block-trigger')

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

                //UI 語意: reload 後落回登入頁 (見 Log in 按鈕, 不被 autoLogin 拉回)
                assert.strict.equal(r.hasLogin, true, `reload 後應落回登入頁見 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            })


            it(`ip-block-trigger: Promise.allSettled ${numForIpCallApi + 1} 次 $fapi.getWebInfor → C timer 觸發 → 進登入頁 10s 後仍卡 Connecting`, async function() {
                this.timeout(600000)
                let u = testUsers.ipblock6
                let virtIp = `1.2.3.${lang === 'eng' ? 100 : 200}`
                let browserRef = { current: browser }
                let r = await execIpBlockTrigger(browserRef, lang, u, virtIp)
                //更新 outer browser 變數 (afterEach 須能關到最新 browser)
                browser = browserRef.current

                await assertBaseline(r.buf, 'E2E-006-ip-block-trigger')

                //驗 1 DB: ips.timeBlocked 為未來時間
                assert.strict.equal(r.ips.length, 1, `ips 表應有 ${virtIp} 紀錄, 實際 ${r.ips.length} 筆`)
                let blockTime = new Date(r.ips[0].timeBlocked).getTime()
                assert.strict.equal(blockTime > Date.now(), true, `timeBlocked 應為未來時間, 實際 ${r.ips[0].timeBlocked}`)

                //驗 2 UI 語意: 10s 後仍顯示 Connecting, 不應出現 Log in 按鈕
                assert.strict.equal(r.hasConnecting, true, `10s 後應仍顯示 Connecting, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
                assert.strict.equal(r.hasLogin, false, `不應出現 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            })


            it('ip-blocked-rejected: ips.timeBlocked=未來 + X-Forwarded-For 該 IP → 進登入頁卡 Connecting', async function() {
                let virtIp = `1.2.3.${lang === 'eng' ? 101 : 201}`
                let browserRef = { current: browser }
                let r = await execIpBlockedRejected(browserRef, lang, virtIp)
                browser = browserRef.current

                await assertBaseline(r.buf, 'E2E-007-ip-blocked-rejected')

                assert.strict.equal(r.hasConnecting, true, `10s 後應仍顯示 Connecting, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
                assert.strict.equal(r.hasLogin, false, `不應出現 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            })


            it('ip-expiry-implicit-unlock: ips.timeBlocked=10s 後 → 等過期 → 進登入頁可見表單', async function() {
                let virtIp = `1.2.3.${lang === 'eng' ? 102 : 202}`
                let browserRef = { current: browser }
                let r = await execIpExpiryImplicitUnlock(browserRef, lang, virtIp)
                browser = browserRef.current

                await assertBaseline(r.buf, 'E2E-008-ip-expiry-implicit-unlock')

                assert.strict.equal(r.hasLogin, true, `過期後應可進登入頁見 Log in 按鈕, 實際前 200 字: ${r.pageText.slice(0, 200)}`)
            })


            it('new-ip-registration: 新 IP 成功登入轉跳使用者資訊頁 → D timer 觸發 → ips 表自動補登記', async function() {
                let u = testUsers.ip9
                let virtIp = `1.2.3.${lang === 'eng' ? 103 : 203}`
                let browserRef = { current: browser }
                let r = await execNewIpRegistration(browserRef, lang, u, virtIp)
                browser = browserRef.current

                await assertBaseline(r.buf, 'E2E-010-new-ip-registration')

                //URL 跳 view=user
                assert.strict.match(r.url, /view=user/, `應跳至 user view, 實際 URL: ${r.url}`)

                //ips 表自動補登記
                assert.strict.equal(r.ips.length, 1, `ips 表應有 ${virtIp} 紀錄, 實際 ${r.ips.length} 筆`)
                assert.strict.equal(r.ips[0].timeBlocked, '', `純登記, timeBlocked 應為空, 實際 "${r.ips[0].timeBlocked}"`)
            })

        })

    }

}
