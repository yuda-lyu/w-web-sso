import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, baseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed, waitDrawerReady, assertBaselineMatch, captureStableWithBox, overlayRegions, composeBox, launchBrowser, REGEN, waitUntilExist, typeIntoNthInput } from './e2e-setup.mjs'


//
// E2E stainfor test — 後台統計資訊流程
//
// 對應流程文件：spec/流程_後台統計資訊.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-stainfor.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-stainfor.test.mjs --timeout 240000
//   --names <eng-E2E-001-page-loaded,...> 進行手術式 baseline 重產
//
// 標準圖存放：test/pics/stainfor/stainfor-{lang}-{number}-{name}.png
//
// 涵蓋 7 個 UI distinct 狀態 (× 2 lang = 14 baselines):
//   E2E-001-page-loaded:                  進 Statistics 頁顯示初始檢視態 (admin valid)
//   E2E-002-admin-token-expired-page-empty: token 過期後重新 mount Stainfor, 6 個 API
//                                          全 reject, 卡片呈空狀態 (與 E2E-001 同款驗證)
//   E2E-003-user-login-frequency-chart:   存取活動監測「使用者登入頻率」圖 (該 block 無表, 框整 block = 框單一圖)
//   E2E-004-token-usage-frequency-chart:  「金鑰使用頻率」圖 (聚焦金鑰 block 內的圖, clip, 不含下方表)
//   E2E-005-token-user-usage-table:       「金鑰對應使用者用量統計」表 (聚焦金鑰 block 內的表, clip, 不含上方圖)
//   E2E-006-ip-connection-frequency-chart:「IP 連線頻率」圖 (聚焦 IP block 內的圖, clip, 不含下方表)
//   E2E-007-ip-usage-table:               「IP 使用量統計」表 (聚焦 IP block 內的表, clip, 不含上方圖)
//
// E2E-003~007 共用一段「驅動活動」前置 (各 base token 打 /api/checkToken 多次 → fun-checkToken
// log 依 userId 聚合 → 金鑰圖+表; 各 IP 帶 X-Forwarded-For 打 api → verifyConn log 依 ip 聚合 →
// IP 圖+表), 確保 4 圖 2 表皆有資料渲染 (表格 v-if length>0 須有用量才出現).
//
// 聚焦做法 (E2E-004~007): 金鑰 / IP 之 .bg-white block 內「圖」「表」並存且整 block 高 761px > 視窗 720px →
// 若框整 block 會上下裁切 (頁首重疊 / 表末列切邊) 且圖 case 與表 case 視覺相同. 故 E2E-004~007 各自聚焦
// 「單一圖」或「單一表」子元素: scrollIntoView 置中 (捲動容器為內層 overflow-y:auto, 非 window) → clip 到
// 該子元素 bounding rect (+邊距, 含紅框) → 紅框 #f26/5px 只框該子元素 → 各自完整置中不裁切. (E2E-003 該
// block 無表, 維持框整 block 之原範本不動.)
//
// 圖表/表格因 echarts canvas GPU 跨進程漂移 + wall-clock binning, pixel 永不穩定 → 用 overlayRegions
// 貼「per-item ref」(test/pics/stainfor/_staref-<item>-{lang}.png, 底線開頭不被當 baseline): ref 不
// 存在時以當次截圖 bootstrap, 之後固定沿用; baseline 與 runtime 兩端貼同一張 ref → 該區永遠一致而視覺
// 呈現真實圖表/表格 (E2E-004~007 之 ref 為 clip 後同尺寸小圖, overlay 座標轉 clip-relative 對齊).
// 語意斷言 (主) 仍讀 live DOM (圖→標題+canvas; 表→表頭+至少一列資料), 不受貼圖影響.
//
// 本檔不含 ag-grid 互動 (本頁無 grid). 純頁面導覽 + 各區紅框標注 + overlay 穩定化比對.
//

let salt = '{salt}'
let baselineDir = './test/pics/stainfor'
let langs = ['eng', 'cht']


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


function shouldGen(lang, name) {
    return !baselineNamesFilter || baselineNamesFilter.has(`${lang}-${name}`)
}


function bp(lang, name) {
    return path.join(baselineDir, `stainfor-${lang}-${name}.png`)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_後台統計資訊.md + procLang.mjs 衍生)
// ===================================================================

let expectedSpecText = {
    //E2E-001: 頁面載入後應見卡片標籤 (i18n 鍵 totalUsers: 'Total Users' / '總使用者')
    'E2E-001-page-loaded': {
        eng: { mode: 'text', value: 'Total Users' },
        cht: { mode: 'text', value: '總使用者' },
    },
    //E2E-002: token 過期後 6 個 API 全 reject, Promise.allSettled throw → mounted catch
    //設 errMsg='getDataError', 主內容隱藏 v-else 顯示載入失敗訊息 (F-035 fix)
    'E2E-002-admin-token-expired-page-empty': {
        eng: { mode: 'text', value: 'Failed to get data, please try again later' },
        cht: { mode: 'text', value: '取得數據失敗，請稍後再試' },
    },
    //E2E-003: 「使用者登入頻率」圖標題 (chart 區語意斷言主要驗標題, canvas 由 customSta 另驗)
    'E2E-003-user-login-frequency-chart': {
        eng: { mode: 'text', value: 'User Login Frequency' },
        cht: { mode: 'text', value: '使用者登入頻率' },
    },
    //E2E-004: 「金鑰使用頻率」圖標題
    'E2E-004-token-usage-frequency-chart': {
        eng: { mode: 'text', value: 'Token Usage Frequency' },
        cht: { mode: 'text', value: '金鑰使用頻率' },
    },
    //E2E-005: 「金鑰對應使用者用量統計」表頭 (Username), 列存在性由 customSta 另驗
    'E2E-005-token-user-usage-table': {
        eng: { mode: 'text', value: 'Username' },
        cht: { mode: 'text', value: '使用者姓名' },
    },
    //E2E-006: 「IP 連線頻率」圖標題
    'E2E-006-ip-connection-frequency-chart': {
        eng: { mode: 'text', value: 'IP Connection Frequency' },
        cht: { mode: 'text', value: 'IP 連線頻率' },
    },
    //E2E-007: 「IP 使用量統計」表頭 (No. / 排序; ip 表頭 'IP' 雙語同字, 改用 numberOrder 區分語系)
    'E2E-007-ip-usage-table': {
        eng: { mode: 'text', value: 'No.' },
        cht: { mode: 'text', value: '排序' },
    },
}


// ===================================================================
// 測試使用者 / Token seed
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-stainfor-admin',
        account: 'stainfor-admin',
        rawPassword: 'Pw@stainfor1',
        name: 'Stainfor Admin',
        email: 'stainfor-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
}

let userTokens = {}


//E2E-007 固定 fixture log (spec 流程_後台統計資訊 E2E-007 測試資料):
//本機 e2e 只有 127.0.0.1 一個真實 IP (後端刻意不讀 x-forwarded-for, WWebSso.mjs:640), 「IP 使用量統計」表之列數
//原本來自 ./logs 內歷史真實資料, 隨 7 天窗移動而漂移 (baseline 5 列 vs 現況 1 列 → 尺寸不符必紅).
//改以「非 ISO 檔名」(filterVpfsByWindow fail-open 一律保留, 且 w-syslog cleanLogs 只刪 ISO 檔名不會誤刪) 寫入
//4 個固定 IP 之 verifyConn 行, time 相對執行當下推算 (2h 前 + 26h 前, 皆在 7 天窗內) → 表恆有 ≥5 個 IP →
//預設只顯示 5 列 (showAllIpUsers=false) → 表格高度確定; 近 N 時計數仍為 wall-clock 會飄, 由既有貼圖覆蓋處理.
let fixtureLogPath = './logs/e2e-stainfor-fixture.log'
function writeFixtureLog() {
    let now = ot()
    let ips = ['203.0.113.11', '203.0.113.12', '203.0.113.13', '203.0.113.14']
    let lines = []
    ips.forEach((ip, i) => {
        let t2h = now.subtract(2, 'hour').valueOf()
        let t26h = now.subtract(26, 'hour').valueOf()
        for (let k = 0; k < 40 - i * 5; k++) {
            lines.push(JSON.stringify({ level: 30, time: t2h + k * 1000, pid: 0, hostname: 'e2e', event: 'verifyConn', ip }))
        }
        for (let k = 0; k < 20 - i * 3; k++) {
            lines.push(JSON.stringify({ level: 30, time: t26h + k * 1000, pid: 0, hostname: 'e2e', event: 'verifyConn', ip }))
        }
    })
    if (!fs.existsSync('./logs')) {
        fs.mkdirSync('./logs', { recursive: true })
    }
    fs.writeFileSync(fixtureLogPath, lines.join('\n') + '\n')
}
function deleteFixtureLog() {
    fs.rmSync(fixtureLogPath, { force: true })
}


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed, 再插入本檔專屬資料.
    await resetToBaseSeed()

    //admin user
    let u = testUsers.admin
    let v = ds.users.funNew({
        order: 900,
        account: u.account,
        password: hashPassword(u.rawPassword, salt),
        name: u.name,
        email: u.email,
        description: '',
        from: 'test',
        redir: u.redir,
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
    await woItems.users.insert([v])

    //admin token
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.id = 'id-stainfor-admin-token'
    t.token = 'fixed-stainfor-admin-session-token'
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    //E2E-007 固定 fixture log (每案重寫, time 相對當下)
    writeFixtureLog()

    console.log('inserted 1 admin user + 1 admin token + fixture log')
}


async function deleteTestUsersAndTokens() {
    await deleteNonBaseSeed()
    deleteFixtureLog()
    console.log('deleted stainfor test users + admin token + fixture log')
}


//每個 it 之間 admin token 都要復原 (E2E-002 會把它弄壞)
async function resetAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.id = 'id-stainfor-admin-token'
    t.token = 'fixed-stainfor-admin-session-token'
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


//強制將 admin token 設為過期 (case E2E-002 用): 模擬「已登入 backstage 後 token 才過期」場景,
//下次切回 Stainfor 時 6 個 getSta* API 用過期 token 全 reject → 卡片區呈空狀態.
async function forceExpireAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) {
        _tk.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.save(_tk).catch(() => {})
    }
}


// ===================================================================
// 驅動活動 (E2E-003~007 前置): 產生金鑰用量 + IP 連線用量, 使 4 圖 2 表有資料渲染
// ===================================================================
//
// - 金鑰圖 + 金鑰用量表: 各 base token 打 /api/checkToken 多次 → 後端 p.checkToken 寫 fun-checkToken
//   log (含 userId) → staToken 依 userId 聚合 → optToken (圖) + tokenUsageSummary (表, v-if length>0).
//   用 base seed 4 token: token-for-viewer/basic/admin/app (對應 viewer/basic/admin/id-for-app).
// - IP 圖 + IP 用量表: 各 IP 帶 X-Forwarded-For 打 api → 後端 verifyConn log (含 ip) → staIp 依 ip
//   聚合 → optIp (圖) + ipUsageSummary (表, v-if length>0). 用 page.context().browser().newContext()
//   + route 注入 x-forwarded-for (僅對 localhost 連線, 不影響 CDN), 不直接封 127.0.0.1 (會自鎖).
// - 高頻調用走 browser networking stack (page.evaluate 內 Promise.allSettled 並行 fetch), 非從
//   test runner 直接打 (跳過 browser stack 屬 integration). 登入頻率圖通常已累積大量歷史 (免驅動).
//
async function driveActivity(page) {
    //各 base token 打 checkToken (各 4 次) → fun-checkToken log 依 userId 聚合
    let tokens = ['token-for-viewer', 'token-for-basic', 'token-for-admin', 'token-for-app']
    for (let tok of tokens) {
        await page.evaluate(async ({ apiUrl, tok, n }) => {
            let ps = []
            for (let i = 0; i < n; i++) {
                ps.push(fetch(`${apiUrl}/api/checkToken?token=${tok}&key=token`).catch(() => {}))
            }
            await Promise.allSettled(ps)
        }, { apiUrl, tok, n: 4 })
    }

    //各 IP 帶 X-Forwarded-For 打 api (各 4 次) → verifyConn log 依 ip 聚合
    let ips = ['11.0.0.1', '11.0.0.2', '11.0.0.3']
    for (let ip of ips) {
        let ctx = await page.context().browser().newContext()
        await ctx.route('**/*', (route, req) => {
            let url = req.url()
            if (url.includes('127.0.0.1') || url.includes('localhost')) {
                route.continue({ headers: { ...req.headers(), 'x-forwarded-for': ip } })
            }
            else {
                route.continue()
            }
        })
        let p2 = await ctx.newPage()
        await p2.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
        await p2.evaluate(async ({ apiUrl, n }) => {
            let ps = []
            for (let i = 0; i < n; i++) {
                ps.push(fetch(`${apiUrl}/api/checkToken?token=token-for-admin&key=token`).catch(() => {}))
            }
            await Promise.allSettled(ps)
        }, { apiUrl, n: 4 })
        await ctx.close()
    }
}


// ===================================================================
// UI helpers
// ===================================================================

let kpUiText = {
    eng: { login: 'Log in', statisticsMenu: 'Statistics information', statisticsTitle: 'Statistics', usersList: 'Users list', ok: 'OK', totalUsers: 'Total Users', errMsgGetData: 'Failed to get data, please try again later', loginFreq: 'User Login Frequency', tokenFreq: 'Token Usage Frequency', ipFreq: 'IP Connection Frequency' },
    cht: { login: '登入', statisticsMenu: '統計資訊', statisticsTitle: '統計', usersList: '使用者清單', ok: '確認', totalUsers: '總使用者', errMsgGetData: '取得數據失敗，請稍後再試', loginFreq: '使用者登入頻率', tokenFreq: '金鑰使用頻率', ipFreq: 'IP 連線頻率' },
}


//login 頁 → 填帳密 → 進 backstage (預設 Statistics 頁)
async function loginAsAdmin(page, lang) {
    let t = kpUiText[lang]

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)

    if (lang === 'cht') {
        await page.locator('text=English').first().click()
        await page.waitForTimeout(400)
        await page.locator('text=中文').first().click()
        await page.waitForTimeout(600)
    }
    else {
        await page.waitForTimeout(1000)
    }

    await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2)

    await typeIntoNthInput(page, 0, testUsers.admin.account)
    await typeIntoNthInput(page, 1, testUsers.admin.rawPassword)

    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.locator(`text="${t.login}"`).first().click()

    //login → backstage 跨頁 redirect, 較久. 一律先 fixed 10s 等 redirect 啟動.
    await page.waitForTimeout(10000)

    //偵測: 等 backstage "Statistics information" 左側 menu 文字
    await waitUntilExist(page, `backstage ${t.statisticsMenu} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statisticsMenu })
}


//等 Statistics 頁完整 render: 等 6 個 getSta* API 全回完 + 卡片數字綁定完成 + chart instance 初始化完成
//timeout 設 60s: cht 路徑因 lang switch 額外開銷, 加上 chart 大量 echarts 初始化, 20s 對 cht 易卡 (race 觀察)
async function waitStaInforReady(page, lang) {
    let t = kpUiText[lang]
    //等卡片標籤出現 (代表主 layout 渲染完成)
    await waitUntilExist(page, `Statistics 頁卡片 "${t.totalUsers}"`, (s) => document.body.innerText.includes(s), { arg: t.totalUsers, timeout: 60000 })
    //再等待固定時間, 給 6 個 async API + chart resize debounce 充分 settle
    await page.waitForTimeout(8000)
}


//等 Statistics 頁顯示「載入失敗」訊息 (F-035 fix 後 token 失效時走此路徑):
//token 過期 → 6 個 getSta* reject → Promise.allSettled throw → mounted catch 設 errMsg → v-else 顯示
async function waitStaInforErrMsg(page, lang) {
    let t = kpUiText[lang]
    //等 errMsg 文字出現 (代表 mounted catch 設了 errMsg 且 v-else 已 render)
    await waitUntilExist(page, `Statistics errMsg "${t.errMsgGetData}"`, (s) => document.body.innerText.includes(s), { arg: t.errMsgGetData, timeout: 20000 })
    //再等待固定時間給 DOM settle
    await page.waitForTimeout(3000)
}


//僅截 Statistics 頁上方 cards 區 (y:0..330), 排除下方頻率圖表.
//理由: 圖表呈現「最近 7 天」資料且依登入活動 binning, X 軸 spike 位置隨測試執行所在的
//小時 bucket 變動 → 跨測試時間 pixel 不穩. cards 區 (Total/Active/Blocked/Expired Users)
//僅依賴 DB seed 計數 (與 wall-clock 無關), 取此區段做 pixel 確定性穩定.
//等價 retry-until-stable: 連續兩張截到一致才回傳 (對齊 captureStable 思路).
//
//target: CSS selector 字串, 指定本 case 要標注的區域元素. 紅框改為截圖後以 composeBox (sharp 合成)
//疊上 (2026-09-01 起, 不再注入暫時 DOM 紅框元素 — 技能 §8.3「截圖後合成, 不注入 DOM」).
//null 時不疊框 (fallback). clip 原點 (0,0) 與 viewport 左上角重合 (呼叫時頁面未捲動), 故
//getBoundingClientRect 座標可直接當 clip buffer 座標傳給 composeBox, 不需另加 scrollX/Y.
//
//  E2E-001-page-loaded:                 '.space-y-8 > div:first-child'
//    ↑ 使用者資訊區 wrapper (標籤行 + 4 張 user 卡片), y 落在 0..330 內.
//  E2E-002-admin-token-expired-page-empty: 'div[style*="padding:10px 15px"]'
//    ↑ v-else 內 errMsg div (E2E-002 時 firstLoading=false, 只有 errMsg div 渲染, 唯一匹配).
async function captureCardsOnly(page, target = null) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    //clip 區 (x:0..1280, y:0..330) 含左側 WDrawer sidebar — captureCardsOnly 走裸 clip screenshot
    //繞過 captureStable, 故須各自呼叫共用 waitDrawerReady, 等 sidebar drawer 展開到位才截圖,
    //否則 token expired re-mount 時 sidebar 滑左外 (x<0) 之 flake 會被 clip 截入 (殷鑑: stainfor
    //E2E-002-admin-token-expired-page-empty 偶發 sidebar 空白). 對齊「進後台截圖皆先 waitDrawerReady」.
    await waitDrawerReady(page)

    //取 target 元素之 clip buffer 座標框 (截圖前量, 版面於截圖過程不變動)
    let box = null
    if (target) {
        let rc = await page.evaluate((sel) => {
            let el = document.querySelector(sel)
            if (!el) return null
            let r = el.getBoundingClientRect()
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }, target)
        if (rc) box = rc
    }

    let opts = { animations: 'disabled', clip: { x: 0, y: 0, width: 1280, height: 330 } }
    let prev = await page.screenshot(opts)
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(200)
        let curr = await page.screenshot(opts)
        if (curr.equals(prev)) {
            return box ? await composeBox(curr, box) : curr
        }
        prev = curr
    }
    //未 settle 仍回傳最後一張 (視需要疊框)
    return box ? await composeBox(prev, box) : prev
}


// ===================================================================
// 共用語意斷言 helpers
// ===================================================================

async function pageHasText(page, text) {
    return await page.evaluate((t) => {
        let walk = (el) => {
            if (!el) return false
            if (el.nodeType === 3) return (el.nodeValue || '').includes(t)
            if (el.nodeType !== 1) return false
            let tag = el.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false
            for (let c of el.childNodes) {
                if (walk(c)) return true
            }
            return false
        }
        return walk(document.body)
    }, text)
}


async function collectVisibleText(page) {
    return await page.evaluate(() => {
        let parts = []
        let walk = (el) => {
            if (!el) return
            if (el.nodeType === 3) {
                let t = (el.nodeValue || '').trim()
                if (t) parts.push(t)
                return
            }
            if (el.nodeType !== 1) return
            let tag = el.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return
            for (let c of el.childNodes) walk(c)
        }
        walk(document.body)
        return parts.join(' | ').slice(0, 2000)
    })
}


async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    let e = expected[lang]
    if (e.mode === 'text') {
        let found = await pageHasText(page, e.value)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期含 "${e.value}" (${name}), 實際: ${dump}`)
        }
    }

    //E2E-003/004/006 (圖): 對應 frequency block 內須有 echarts canvas (圖確實渲染, 非僅標題)
    //E2E-005/007 (表): 對應 table 須有表頭 + 至少一列資料 (tbody tr ≥ 1; 不驗會飄的計數值)
    let extra = {
        'E2E-003-user-login-frequency-chart': { kind: 'chart', title: kpUiText[lang].loginFreq },
        'E2E-004-token-usage-frequency-chart': { kind: 'chart', title: kpUiText[lang].tokenFreq },
        'E2E-005-token-user-usage-table': { kind: 'table', title: kpUiText[lang].tokenFreq },
        'E2E-006-ip-connection-frequency-chart': { kind: 'chart', title: kpUiText[lang].ipFreq },
        'E2E-007-ip-usage-table': { kind: 'table', title: kpUiText[lang].ipFreq },
    }[name]
    if (extra) {
        let r = await page.evaluate((arg) => {
            let blocks = Array.from(document.querySelectorAll('.bg-white'))
            let blk = blocks.find((b) => {
                let sp = b.querySelector('span.text-lg')
                return sp && sp.textContent.includes(arg.title)
            })
            if (!blk) {
                return { ok: false, reason: 'block-not-found' }
            }
            if (arg.kind === 'chart') {
                return { ok: blk.querySelectorAll('canvas').length > 0, reason: 'no-canvas' }
            }
            //table: 表頭 th + tbody 資料列
            let tb = blk.querySelector('table')
            if (!tb) {
                return { ok: false, reason: 'no-table' }
            }
            let rows = tb.querySelectorAll('tbody tr').length
            return { ok: rows > 0, reason: `tbody-rows=${rows}` }
        }, extra)
        if (!r.ok) {
            assert.fail(`${name} (${lang}) 額外語意斷言失敗 [${extra.kind}]: ${r.reason}`)
        }
    }
}


// ===================================================================
// 2 個 capture
// ===================================================================

//E2E-001 初始檢視態: 登入 admin → 進 Statistics → 等 6 個 getSta* 回完 → 截圖 (僅 cards 區)
//target: 使用者資訊區 wrapper div (.space-y-8 > div:first-child), 涵蓋標籤行 + 4 張 user 卡片,
//落在 clip y:0..330 範圍內 (實際 y 約 60-270).
async function capturePageLoaded(page, lang) {
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureCardsOnly(page, '.space-y-8 > div:first-child')
}


//E2E-002 token 過期後重新 mount 之空狀態:
//  登入 admin → 進 Statistics → 切去 Users list (Stainfor unmount) → 過期 admin token →
//  切回 Statistics (Stainfor 重新 mount, 6 個 getSta* API 用過期 token 全 reject) → 截圖
async function captureAdminTokenExpiredPageEmpty(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)

    //切去 Users list (Stainfor unmount)
    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(3000)

    //過期 admin token
    await forceExpireAdminToken()

    //切回 Statistics (Stainfor 重新 mount, 6 API 用過期 token 全 reject → errMsg 顯示)
    await page.locator(`text="${t.statisticsMenu}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.statisticsMenu}"`).first().click()
    await page.waitForTimeout(3000)
    await waitStaInforErrMsg(page, lang)

    //target: v-else 內 errMsg div. E2E-002 時 firstLoading=false, 主內容 v-if 為 false →
    //firstLoading div 亦不渲染, 只有 errMsg div 存在 → div[style*="padding:10px 15px"] 唯一匹配.
    //errMsg div y 位置約 60-80 (page header 之下), 落在 clip y:0..330 範圍內.
    return await captureCardsOnly(page, 'div[style*="padding:10px 15px"]')
}


// ===================================================================
// E2E-003~007: 存取活動監測 5 個展示項 (圖×3 + 表×2)
// ===================================================================
//
// 共用流程: driveActivity → loginAsAdmin → waitStaInforReady → 捲到該項置中 → captureStableWithBox
// (整張 fullPage + 該 block 紅框 #f26/5px) → overlayRegions 貼 per-item ref (穩定化動態圖表/表格).
//
// itemTitle: 該項 frequency block 的標題文字 (kpUiText[lang].loginFreq/tokenFreq/ipFreq), 用以定位
//            .bg-white block (找含此標題 span.text-lg 的 block). table 案例與其所屬圖共用同一 block.
// overlayKind: 'chart' 覆蓋 block 內 canvas; 'table' 覆蓋 block 內 table wrapper (.overflow-x-auto).
// refName: per-item ref 檔名片段 (test/pics/stainfor/_staref-<refName>-<lang>.png).
//
async function captureActivityItem(page, lang, itemTitle, overlayKind, refName) {
    //定位該 block 並捲到「置中」(不被視窗上下邊界裁切): scrollIntoView({block:'center'})
    await page.evaluate((title) => {
        let blocks = Array.from(document.querySelectorAll('.bg-white'))
        let blk = blocks.find((b) => {
            let sp = b.querySelector('span.text-lg')
            return sp && sp.textContent.includes(title)
        })
        if (blk) {
            blk.scrollIntoView({ block: 'center', inline: 'nearest' })
        }
    }, itemTitle)
    await page.waitForTimeout(800)

    //紅框標注該 block: 以標題文字定位含該 span.text-lg 的 .bg-white block (locator filter).
    let blockLoc = page.locator('.bg-white').filter({ has: page.locator(`span.text-lg`, { hasText: itemTitle }) }).first()

    //captureStableWithBox 內部會把第一個 target scrollIntoViewIfNeeded (同一 block, 維持置中附近)
    //+ 畫紅框 + captureStable (含 WDrawer 展開等待 / SVG 凍結 / 字型就緒). 回傳 fullPage buffer.
    let buf = await captureStableWithBox(page, blockLoc)

    //取 overlay 目標區 (fullPage 座標 = viewport rect + scroll). 一律覆蓋該 block 內「全部動態內容」=
    //canvas (echarts GPU 跨進程漂移) + table wrapper (用量計數隨 wall-clock 漂移, 尤其本機 127.0.0.1
    //連線計數每次跑都增加). 不依 overlayKind 區分覆蓋範圍: 金鑰/IP block 內圖與表並存, 任一未覆蓋的動態
    //區都會造成 pixel drift (殷鑑: E2E-006 chart case 漏蓋同 block 內 IP 表 127.0.0.1 列 → diff 307px).
    //overlayKind 僅決定本 case 語意焦點與 ref 檔名, 不縮限覆蓋範圍.
    let rects = await page.evaluate((arg) => {
        let blocks = Array.from(document.querySelectorAll('.bg-white'))
        let blk = blocks.find((b) => {
            let sp = b.querySelector('span.text-lg')
            return sp && sp.textContent.includes(arg.title)
        })
        if (!blk) {
            return null
        }
        let els = [
            ...Array.from(blk.querySelectorAll('canvas')),
            ...Array.from(blk.querySelectorAll('.overflow-x-auto')),
        ]
        return els.map((el) => {
            let r = el.getBoundingClientRect()
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }
        })
    }, { title: itemTitle, kind: overlayKind })
    if (rects == null || rects.length === 0) {
        throw new Error(`captureActivityItem: 找不到 overlay 目標 (title=${itemTitle}, kind=${overlayKind})`)
    }

    //per-item ref bootstrap: 僅 REGEN (--baseline / E2E_REGEN=1) 允許 ref 不存在時以當次截圖建立,
    //之後固定沿用 (刪檔可重產). 正常測試模式缺檔即 fail, 不得靜默自舉.
    //baseline 與 runtime 兩端貼同一張 ref → 該區永遠一致而視覺呈現真實圖表/表格.
    let refPath = path.join(baselineDir, `_staref-${refName}-${lang}.png`)
    if (!fs.existsSync(refPath)) {
        if (!REGEN) {
            throw new Error(`per-item ref 不存在: ${refPath}（請以 --baseline 產製）`)
        }
        fs.writeFileSync(refPath, buf)
    }
    let refBuf = fs.readFileSync(refPath)
    return await overlayRegions(buf, rects, refBuf)
}


// ===================================================================
// E2E-004~007: 聚焦「單一圖」或「單一表」子元素 (clip + 置中, 對齊 E2E-003 單圖聚焦範本)
// ===================================================================
//
// 與 captureActivityItem (E2E-003 用, 框整個 block) 的差異:
// 金鑰 / IP 之 .bg-white block 內「圖」與「表」並存, 整個 block 高 761px 遠超視窗 720px → 框整 block
// 會上下裁切 (頁首重疊 / 表末列切邊) 且圖 case 與表 case 視覺相同. 本 helper 改為聚焦該 block 內的
// 「單一子元素」: kind='chart' → 圖聯集 (標題列 + select 列 + echarts 容器, 高 368px);
// kind='table' → 表 wrapper (.mt-4, 高 337px). 兩者各自可放進視窗, scrollIntoView 置中後完整不裁切.
//
// 截圖採 clip 到「目標子元素 bounding rect + 邊距」(含紅框), 避免把同 block 內的鄰居 (圖 case 不拍到
// 下方會漂移的表; 表 case 不拍到上方圖) 拍進來造成 pixel 污染. 紅框 #f26/5px 只框該單一子元素.
// overlay 只貼該子元素內的動態區 (圖→canvas; 表→table 內容), 座標轉為 clip-relative 後貼 per-item ref.
//
// itemTitle: 該 block 標題 (kpUiText[lang].tokenFreq/ipFreq). kind: 'chart' | 'table'.
// refName: per-item ref 檔名片段 (test/pics/stainfor/_staref-<refName>-<lang>.png).
//
async function captureFocusedItem(page, lang, itemTitle, kind, refName) {
    await page.mouse.move(0, 0)

    //1) 置中: 找 block → 找捲動容器 (內層 overflow-y:auto, 非 window) → 計算目標子元素中心 → 設 scrollTop.
    //   頁面捲動由內層 div (LayoutContentStaInfor 根 overflow-y:auto) 承載, window 不捲, 故不可用 scrollBy.
    let scrolled = await page.evaluate((arg) => {
        let blocks = Array.from(document.querySelectorAll('.bg-white'))
        let blk = blocks.find((b) => {
            let sp = b.querySelector('span.text-lg')
            return sp && sp.textContent.includes(arg.title)
        })
        if (!blk) {
            return { ok: false }
        }
        let titleRow = blk.querySelector('.pb-2')
        let selRow = titleRow ? titleRow.nextElementSibling : null
        let canvas = blk.querySelector('canvas')
        let echartsHost = canvas ? canvas.closest('div[style*="height:300px"], div[style*="height: 300px"]') : null
        let tableWrap = blk.querySelector('.mt-4')

        let top, bottom
        if (arg.kind === 'chart') {
            if (!titleRow || !echartsHost) {
                return { ok: false }
            }
            top = titleRow.getBoundingClientRect().top
            bottom = echartsHost.getBoundingClientRect().bottom
        }
        else {
            if (!tableWrap) {
                return { ok: false }
            }
            let w = tableWrap.getBoundingClientRect()
            top = w.top
            bottom = w.bottom
        }
        let sc = blk.closest('[style*="overflow-y:auto"], [style*="overflow-y: auto"]')
        let centerY = (top + bottom) / 2
        let delta = centerY - window.innerHeight / 2
        if (sc) {
            sc.scrollTop += delta
        }
        else {
            window.scrollBy(0, delta)
        }
        return { ok: true }
    }, { title: itemTitle, kind })
    if (!scrolled.ok) {
        throw new Error(`captureFocusedItem: 找不到目標子元素 (title=${itemTitle}, kind=${kind})`)
    }
    await page.waitForTimeout(800)

    //2) 取置中後的目標 viewport rect + clip rect (含紅框邊距). canvas/table 之 overlay rect 轉 clip-relative.
    let geo = await page.evaluate((arg) => {
        let blocks = Array.from(document.querySelectorAll('.bg-white'))
        let blk = blocks.find((b) => {
            let sp = b.querySelector('span.text-lg')
            return sp && sp.textContent.includes(arg.title)
        })
        if (!blk) {
            return null
        }
        let titleRow = blk.querySelector('.pb-2')
        let selRow = titleRow ? titleRow.nextElementSibling : null
        let canvas = blk.querySelector('canvas')
        let echartsHost = canvas ? canvas.closest('div[style*="height:300px"], div[style*="height: 300px"]') : null
        let tableWrap = blk.querySelector('.mt-4')

        let rectOf = (el) => {
            let r = el.getBoundingClientRect()
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }
        //目標 (圖聯集 / 表 wrapper) viewport rect
        let t
        let overlayEls
        if (arg.kind === 'chart') {
            let a = rectOf(titleRow), s = rectOf(selRow), b = rectOf(echartsHost)
            t = { left: Math.min(a.left, s.left, b.left), top: a.top, right: Math.max(a.right, s.right, b.right), bottom: b.bottom }
            overlayEls = [canvas]   //圖只蓋 canvas (echarts GPU 跨進程漂移)
        }
        else {
            t = rectOf(tableWrap)
            overlayEls = Array.from(tableWrap.querySelectorAll('.overflow-x-auto'))   //表蓋 table 內容 (計數隨 wall-clock 漂移)
        }
        return {
            target: { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
            overlays: overlayEls.filter(Boolean).map((el) => {
                let r = el.getBoundingClientRect()
                return { left: r.left, top: r.top, width: r.width, height: r.height }
            }),
        }
    }, { title: itemTitle, kind })
    if (!geo) {
        throw new Error(`captureFocusedItem: 取置中後 geometry 失敗 (title=${itemTitle}, kind=${kind})`)
    }

    //clip rect: 目標外擴 PAD (>紅框 6px 外距 + 5px 線寬), clamp 在 viewport 內
    let PAD = 16
    let vw = 1280, vh = 720
    let clipX = Math.max(0, Math.round(geo.target.left - PAD))
    let clipY = Math.max(0, Math.round(geo.target.top - PAD))
    let clipR = Math.min(vw, Math.round(geo.target.right + PAD))
    let clipB = Math.min(vh, Math.round(geo.target.bottom + PAD))
    let clip = { x: clipX, y: clipY, width: clipR - clipX, height: clipB - clipY }

    //等左側 WDrawer sidebar 展開到位 (此 clip 不含 sidebar, 但維持與其他 backstage 截圖一致前置)
    await waitDrawerReady(page)

    //3) clip 截圖, retry-until-stable (連兩張一致). 紅框改截圖後以 composeBox (sharp 合成) 疊上
    //(2026-09-01 起, 不再注入暫時 DOM 紅框元素 — 技能 §8.3), 故此處不再插入/移除任何 DOM.
    let shotOpts = { animations: 'disabled', clip }
    let buf = await page.screenshot(shotOpts)
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(200)
        let curr = await page.screenshot(shotOpts)
        if (curr.equals(buf)) {
            buf = curr
            break
        }
        buf = curr
    }

    //4) overlay 貼 per-item ref: 動態區 viewport rect 轉 clip-relative (clip 後 buffer 原點 = clip 左上角)
    let rects = geo.overlays.map((o) => ({
        x: o.left - clip.x,
        y: o.top - clip.y,
        w: o.width,
        h: o.height,
    }))
    if (rects.length === 0) {
        throw new Error(`captureFocusedItem: 找不到 overlay 目標 (title=${itemTitle}, kind=${kind})`)
    }

    //per-item ref bootstrap: 僅 REGEN (--baseline / E2E_REGEN=1) 允許 ref 不存在時以當次 clip 截圖建立,
    //之後固定沿用 (刪檔可重產). 正常測試模式缺檔即 fail, 不得靜默自舉.
    //ref 與 baseline / runtime 皆為 clip 後同尺寸圖 → 同座標 overlay 對齊.
    let refPath = path.join(baselineDir, `_staref-${refName}-${lang}.png`)
    if (!fs.existsSync(refPath)) {
        if (!REGEN) {
            throw new Error(`per-item ref 不存在: ${refPath}（請以 --baseline 產製）`)
        }
        fs.writeFileSync(refPath, buf)
    }
    let refBuf = fs.readFileSync(refPath)
    let overlaid = await overlayRegions(buf, rects, refBuf)

    //5) 紅框只框目標子元素, 疊在遮罩/覆蓋之上 (composeBox 內部自動 outer 擴 6px + M=3 clamp), 座標轉
    //clip-relative (clip 後 buffer 原點 = clip 左上角), 對齊 captureStableWithBox 之「遮罩 → 紅框」順序.
    let box = {
        left: geo.target.left - clip.x,
        top: geo.target.top - clip.y,
        right: geo.target.right - clip.x,
        bottom: geo.target.bottom - clip.y,
    }
    return await composeBox(overlaid, box)
}


//E2E-003 使用者登入頻率圖 (該 block 無表, 框整 block = 框單一圖, 維持原範本作法不動)
async function captureUserLoginFrequencyChart(page, lang) {
    await driveActivity(page)
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureActivityItem(page, lang, kpUiText[lang].loginFreq, 'chart', 'login-chart')
}


//E2E-004 金鑰使用頻率圖 (聚焦金鑰 block 內的圖, 不含下方表)
async function captureTokenUsageFrequencyChart(page, lang) {
    await driveActivity(page)
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureFocusedItem(page, lang, kpUiText[lang].tokenFreq, 'chart', 'token-chart')
}


//E2E-005 金鑰對應使用者用量統計表 (聚焦金鑰 block 內的表, 不含上方圖)
async function captureTokenUserUsageTable(page, lang) {
    await driveActivity(page)
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureFocusedItem(page, lang, kpUiText[lang].tokenFreq, 'table', 'token-table')
}


//E2E-006 IP 連線頻率圖 (聚焦 IP block 內的圖, 不含下方表)
async function captureIpConnectionFrequencyChart(page, lang) {
    await driveActivity(page)
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureFocusedItem(page, lang, kpUiText[lang].ipFreq, 'chart', 'ip-chart')
}


//E2E-007 IP 使用量統計表 (聚焦 IP block 內的表, 不含上方圖)
async function captureIpUsageTable(page, lang) {
    await driveActivity(page)
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureFocusedItem(page, lang, kpUiText[lang].ipFreq, 'table', 'ip-table')
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-page-loaded', capturePageLoaded],
        ['E2E-002-admin-token-expired-page-empty', captureAdminTokenExpiredPageEmpty],
        ['E2E-003-user-login-frequency-chart', captureUserLoginFrequencyChart],
        ['E2E-004-token-usage-frequency-chart', captureTokenUsageFrequencyChart],
        ['E2E-005-token-user-usage-table', captureTokenUserUsageTable],
        ['E2E-006-ip-connection-frequency-chart', captureIpConnectionFrequencyChart],
        ['E2E-007-ip-usage-table', captureIpUsageTable],
    ]

    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await launchBrowser()
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => { await dialog.accept() })

        let buf = await fn(page, lang)
        fs.writeFileSync(bp(lang, name), buf)

        await browser.close()
        await deleteTestUsersAndTokens()
    }
}


async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of langs) {
        await generateBaselineForLang(lang)
    }

    await deleteTestUsersAndTokens()

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

    async function verifyBaseline(page, lang, name, buf, skipSpec = false) {
        if (!skipSpec) {
            await assertSpecForCase(page, lang, name)
        }
        let baselinePath = bp(lang, name)
        //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
        assertBaselineMatch(buf, baselinePath, `stainfor-${lang}-${name}`)
    }


    for (let lang of langs) {

        describe(`Stainfor E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            let browser
            let page

            beforeEach(async function() {
                this.timeout(240000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()

                browser = await launchBrowser()
                let context = await browser.newContext()
                page = await context.newPage()

                page.on('dialog', async (dialog) => {
                    await dialog.accept()
                })
            })

            afterEach(async function() {
                if (browser) {
                    await browser.close()
                    browser = null
                }
                await deleteTestUsersAndTokens()
            })

            let cases = [
                ['E2E-001-page-loaded', capturePageLoaded],
                ['E2E-002-admin-token-expired-page-empty', captureAdminTokenExpiredPageEmpty],
                ['E2E-003-user-login-frequency-chart', captureUserLoginFrequencyChart],
                ['E2E-004-token-usage-frequency-chart', captureTokenUsageFrequencyChart],
                ['E2E-005-token-user-usage-table', captureTokenUserUsageTable],
                ['E2E-006-ip-connection-frequency-chart', captureIpConnectionFrequencyChart],
                ['E2E-007-ip-usage-table', captureIpUsageTable],
            ]

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    await resetAdminToken()
                    let buf = await fn(page, lang)

                    //語意斷言 (主) + pixel baseline (補)
                    await verifyBaseline(page, lang, name, buf)
                })
            }

        })

    }

}
