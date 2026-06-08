import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, cleanup, baseUrl, resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


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
// 涵蓋 2 個 UI distinct 狀態 (× 2 lang = 4 baselines):
//   E2E-001-page-loaded:                  進 Statistics 頁顯示初始檢視態 (admin valid)
//   E2E-002-admin-token-expired-page-empty: token 過期後重新 mount Stainfor, 6 個 API
//                                          全 reject, 卡片呈空狀態 (與 E2E-001 同款驗證)
//
// 本檔不含 ag-grid 互動 (本頁無 grid). 純頁面導覽 + cards 區 byte-equal 比對.
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

    console.log('inserted 1 admin user + 1 admin token')
}


async function deleteTestUsersAndTokens() {
    await deleteNonBaseSeed()
    console.log('deleted stainfor test users + admin token')
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
// UI helpers
// ===================================================================

let kpUiText = {
    eng: { login: 'Log in', statisticsMenu: 'Statistics information', statisticsTitle: 'Statistics', usersList: 'Users list', ok: 'OK', totalUsers: 'Total Users', errMsgGetData: 'Failed to get data, please try again later' },
    cht: { login: '登入', statisticsMenu: '統計資訊', statisticsTitle: '統計', usersList: '使用者清單', ok: '確認', totalUsers: '總使用者', errMsgGetData: '取得數據失敗，請稍後再試' },
}


//每步驟先偵測對象出現再操作 (10s timeout). 超時拋錯 = 真實異常 (而非 sleep 不夠).
async function waitUntilExist(page, label, fn, opts = {}) {
    let { timeout = 10000, arg = null } = opts
    try {
        await page.waitForFunction(fn, arg, { timeout })
    }
    catch (err) {
        throw new Error(`waitUntilExist 超過 ${timeout}ms 仍找不到「${label}」 — 此為真實異常 (production race / 元件未渲染)`)
    }
}


//真鍵盤輸入 nth(idx) 的 input (取代 .fill() L4 偷工 — 詳見全域 CLAUDE.md Pattern D)
async function typeIntoNthInput(page, idx, value) {
    let inp = page.locator('input').nth(idx)
    await inp.waitFor({ state: 'visible', timeout: 5000 })

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await inp.click()
        await page.waitForFunction((i) => {
            let inputs = document.querySelectorAll('input')
            return document.activeElement === inputs[i]
        }, idx, { timeout: 3000 })
        let cur = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value || '', idx)
        if (cur) {
            await page.keyboard.press('End')
            for (let k = 0; k < cur.length + 2; k++) await page.keyboard.press('Backspace')
        }
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await page.evaluate((i) => {
            let el = document.querySelectorAll('input')[i]
            return el ? el.value : null
        }, idx)
        if (got === value) return
        console.warn(`typeIntoNthInput attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        await page.waitForTimeout(400)
    }
    let final = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value, idx)
    throw new Error(`typeIntoNthInput ${maxAttempts} 次仍漏字: 預期「${value}」, 最終「${final}」`)
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
//小時 bucket 變動 → 跨測試時間 byte-equal 不穩. cards 區 (Total/Active/Blocked/Expired Users)
//僅依賴 DB seed 計數 (與 wall-clock 無關), 取此區段做 byte-equal 確定性穩定.
//等價 retry-until-stable: 連續兩張截到一致才回傳 (對齊 captureStable 思路).
async function captureCardsOnly(page) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let opts = { animations: 'disabled', clip: { x: 0, y: 0, width: 1280, height: 330 } }
    let prev = await page.screenshot(opts)
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(200)
        let curr = await page.screenshot(opts)
        if (curr.equals(prev)) return curr
        prev = curr
    }
    return prev
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
}


// ===================================================================
// 2 個 capture
// ===================================================================

//E2E-001 初始檢視態: 登入 admin → 進 Statistics → 等 6 個 getSta* 回完 → 截圖 (僅 cards 區)
async function capturePageLoaded(page, lang) {
    await loginAsAdmin(page, lang)
    await waitStaInforReady(page, lang)
    return await captureCardsOnly(page)
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

    return await captureCardsOnly(page)
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-page-loaded', capturePageLoaded],
        ['E2E-002-admin-token-expired-page-empty', captureAdminTokenExpiredPageEmpty],
    ]

    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await chromium.launch({ headless: true })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => { await dialog.accept() })

        let buf = await fn(page, lang)
        fs.writeFileSync(bp(lang, name), buf)

        await browser.close()
        await deleteTestUsersAndTokens()
    }
}


async function generateBaseline() {
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
        assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
        let baselineBuf = fs.readFileSync(baselinePath)
        if (!fs.existsSync('./tmp')) fs.mkdirSync('./tmp', { recursive: true })
        fs.writeFileSync(`./tmp/stainfor-${lang}-${name}-test.png`, buf)
        assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: stainfor-${lang}-${name}`)
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

                browser = await chromium.launch({ headless: true })
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
