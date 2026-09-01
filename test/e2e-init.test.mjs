import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { cleanup, captureStableWithBox, apiUrl, genTempSettings, restartBackend, assertBaselineMatch, launchBrowser } from './e2e-setup.mjs'


//
// E2E Init test — 初始畫面語系 (server 注入, 非 UI 切換)
//
// 對應 CLAUDE.md「e2e 測試『初始畫面語系』(server 注入, 非 UI 切換)」.
//
// 驗證: 設定檔指定 language 後, 後端 serve 的 dist 初始連線畫面即呈現該語系
// (window.___pmwsso___.language 由 WWebSso 啟動時把 dist 模板的 {language} 佔位符注入).
//
// 涵蓋 5 個畫面語系 (× 2 lang; 依連線生命週期順序編號):
//   E2E-001-connecting-screen: 進站第一眼的「連線中」畫面 (csIng) — 攔截 converhp 主連線使其懸置以穩定呈現;
//                              spinner SVG <animate> 由 captureStable animatedRects 自動填黑遮蔽 (同 autoblock connecting);
//                              驗連線中文字 (Connecting.../連線中...) 來自 mUI 內建字典依注入語系, 後端 kpLang 未載入亦正確.
//   E2E-002-loggedin-screen:   連線中之後的「已登入」過場 (csLogin) — 有 token 自動登入成功、跳轉前短暫顯示.
//                              route-hang 全 /api + 強制 updateConnState; spinner 為 SVG 動畫 → animatedRects 遮蔽 (同 connecting).
//                              驗 mUI fallback 文字 (Logged in/已登入) 依注入語系.
//   E2E-003-login-screen:      連線建立後無 token → 顯示登入表單 (PageLogin, app 內容).
//   E2E-004-err-login-screen:  「拒絕登入」狀態 (csErrLogin) — 同強制法 (作法對齊 w-web-perm e2e-init). 靜態 PNG, 免遮蔽.
//                              驗 (Login denied/拒絕登入) 依注入語系.
//   E2E-005-err-conn-screen:   「無法連線」狀態 (csErrConn) — 同上 (Unable to connect/無法連線). 靜態 PNG, 免遮蔽.
//
// 三個必守陷阱 (見 CLAUDE.md):
//   1. 打後端 dist (apiUrl 11007), 不是 dev server (8080 不做注入 → 永遠 eng).
//   2. 必須有 dist/index.tmp 不可變模板 ({language} 被取代後即消失); 本檔 setup 由 dist/index.html 還原重建.
//   3. URL 不可帶 ?lang= (URL 語系優先序最高會蓋掉 server 注入值).
//
// 使用方式:
//   1. 先 npm run build 產 dist.
//   2. 產標準圖: node test/e2e-init.test.mjs --baseline
//   3. 跑測試:   npx mocha test/e2e-init.test.mjs --timeout 120000 --reporter list
//   --names <eng-E2E-001-connecting-screen,...> 手術式重產.
//
// 標準圖: test/pics/init/init-{lang}-{NNN-name}.png
//

let baselineDir = './test/pics/init'
let langs = ['eng', 'cht']


let baselineNamesFilter = null
{
    let i = process.argv.indexOf('--names')
    if (i >= 0 && process.argv[i + 1]) {
        baselineNamesFilter = new Set(process.argv[i + 1].split(','))
    }
}
function shouldGen(lang, name) {
    return !baselineNamesFilter || baselineNamesFilter.has(`${lang}-${name}`)
}
function bp(lang, name) {
    return path.join(baselineDir, `init-${lang}-${name}.png`)
}


//每語系: server 注入後各初始畫面應呈現之文字 (從 procLang / mUI 內建字典對應, 非現狀指紋)
let expectedText = {
    eng: { title: 'Single Sign-On System', login: 'Log in', connecting: 'Connecting', errLogin: 'Login denied', errConn: 'Unable to connect', loggedIn: 'Logged in' },
    cht: { title: '單一登入系統', login: '登入', connecting: '連線中', errLogin: '拒絕登入', errConn: '無法連線', loggedIn: '已登入' },
}


//確保 dist/index.tmp 不可變模板存在: 由 dist/index.html 以正規式把已注入的 language 值還原為 {language} 佔位符.
//冪等 — 不論 dist/index.html 目前是 'eng' / 'cht' / '{language}' 皆還原成模板. (陷阱 2)
function ensureIndexTmpl() {
    let distHtml = './dist/index.html'
    let distTmp = './dist/index.tmp'
    if (!fs.existsSync(distHtml)) {
        throw new Error('dist/index.html 不存在 — 請先 npm run build 產 dist')
    }
    let c = fs.readFileSync(distHtml, 'utf8')
    c = c.replace(/language: '[^']*'/, "language: '{language}'")
    fs.writeFileSync(distTmp, c, 'utf8')
}


//共用: 開新瀏覽器打後端 dist 初始畫面. 不帶 ?lang= (陷阱 3); 清 localStorage 避免 autoLogin.
//routeHang=true 時攔截 converhp 主連線使其懸而不答 → connState 卡 'csIng' → 穩定呈現「連線中」畫面.
async function withFreshPage(routeHang, fn) {
    let browser = await launchBrowser()
    try {
        let page = await (await browser.newContext()).newPage()
        if (routeHang) {
            //converhp 主連線 (apiName='api' → /api/main 等) 懸置 → 卡連線中
            await page.route('**/api/main', () => {})
            await page.route('**/api/ulctr', () => {})
            await page.route('**/api/slc', () => {})
        }
        return await fn(page)
    }
    finally {
        await browser.close()
    }
}


//E2E-001: 連線建立後的登入畫面 (csLogin)
async function captureLoginScreen(lang) {
    await restartBackend(genTempSettings({ language: lang }))
    return await withFreshPage(false, async (page) => {
        await page.goto(`${apiUrl}/`, { waitUntil: 'networkidle', timeout: 20000 })
        await page.evaluate(() => localStorage.clear())
        await page.goto(`${apiUrl}/`, { waitUntil: 'networkidle', timeout: 20000 })
        await page.waitForTimeout(3000)
        await page.mouse.move(0, 0)
        let info = await page.evaluate(() => ({
            winLang: (window.___pmwsso___ || {}).language,
            body: (document.body.innerText || '').replace(/\s+/g, ' '),
        }))
        //觀看區 = 登入卡 (.sb): 含標題 / 帳密欄 / 登入按鈕 / 申請帳號, 整片語系皆在此呈現
        let buf = await captureStableWithBox(page, '.sb')
        return { buf, info }
    })
}


//E2E-002: 連線建立中的「連線中」畫面 (csIng) — converhp 主連線懸置以穩定呈現
async function captureConnectingScreen(lang) {
    await restartBackend(genTempSettings({ language: lang }))
    return await withFreshPage(true, async (page) => {
        await page.goto(`${apiUrl}/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        //等「連線中」文字渲染 (connState 卡 csIng)
        await page.waitForFunction(
            (t) => (document.body.innerText || '').includes(t),
            expectedText[lang].connecting,
            { timeout: 15000 }
        )
        await page.mouse.move(0, 0)
        let info = await page.evaluate(() => ({
            winLang: (window.___pmwsso___ || {}).language,
            body: (document.body.innerText || '').replace(/\s+/g, ' '),
        }))
        //觀看區 = connecting spinner SVG + 連線中文字 (聯集); SVG <animate> 由 captureStable animatedRects
        //自動填黑遮蔽 (同 autoblock connecting, 不需額外 mask). 文字用 getByText 定位 (inline style
        //`margin-left:10px` 渲染後變 `margin-left: 10px` 冒號後加空格, CSS attr selector 不命中, 故改文字定位).
        let buf = await captureStableWithBox(page, ['img[src^="data:image/svg+xml"]', page.getByText(expectedText[lang].connecting).first()])
        return { buf, info }
    })
}


//E2E-002/004/005: 「強制連線狀態」畫面之語系文字 (csLogin 已登入 / csErrLogin 拒絕登入 / csErrConn 無法連線).
//csLogin「已登入」為「連線中」之後的過場 (有 token 自動登入成功、跳轉前短暫顯示, App.vue autoLogining=true 時).
//機制 (對齊參考專案 w-web-perm 之 e2e-init captureConnState): route-hang 全部 /api 使連線懸置 (autoLogining
//保持 true → LayoutState 顯示) → 等 window.$vo (App mounted, App.vue:91) → 強制 $ui.updateConnState(目標態)
//→ 該態文字走 mUI kpFallback 依「server 注入語系」(window.___pmwsso___.language) 顯示 → 等文字渲染 → 截圖.
//imgPrefix: 錯誤態用靜態 PNG (img_dissconnection, 免遮蔽); csLogin 用 SVG spinner (img_connection, 動畫 →
//captureStable animatedRects 自動填黑遮蔽, 同 connecting).
async function captureForcedState(lang, connState, key, imgPrefix) {
    await restartBackend(genTempSettings({ language: lang }))
    let browser = await launchBrowser()
    try {
        let page = await (await browser.newContext()).newPage()
        await page.route('**/api/**', () => {}) //全部 /api 懸置 → 連線不 resolve, connState 可被強制保持
        await page.goto(`${apiUrl}/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForFunction(() => !!window.$vo, null, { timeout: 60000 }) //等 App mounted
        await page.evaluate((cs) => { window.$vo.$ui.updateConnState(cs) }, connState) //強制連線狀態
        await page.waitForFunction(
            (t) => (document.body.innerText || '').includes(t),
            expectedText[lang][key],
            { timeout: 15000 }
        )
        await page.mouse.move(0, 0)
        let info = await page.evaluate(() => ({
            winLang: (window.___pmwsso___ || {}).language,
            body: (document.body.innerText || '').replace(/\s+/g, ' '),
        }))
        //觀看區 = 狀態圖示 + 狀態文字 (聯集); 文字用 getByText 定位 (避 inline style 正規化不命中)
        let buf = await captureStableWithBox(page, [`img[src^="${imgPrefix}"]`, page.getByText(expectedText[lang][key]).first()])
        return { buf, info }
    }
    finally {
        await browser.close()
    }
}
async function captureErrLogin(lang) { return await captureForcedState(lang, 'csErrLogin', 'errLogin', 'data:image/png') }
async function captureErrConn(lang) { return await captureForcedState(lang, 'csErrConn', 'errConn', 'data:image/png') }
async function captureLoggedIn(lang) { return await captureForcedState(lang, 'csLogin', 'loggedIn', 'data:image/svg+xml') }


//依連線生命週期順序: 連線中(001) → 已登入過場(002) → 登入表單(003); 另涵蓋錯誤態: 拒絕登入(004)/無法連線(005)
let cases = [
    { name: 'E2E-001-connecting-screen', kind: 'connecting', capture: captureConnectingScreen },
    { name: 'E2E-002-loggedin-screen', kind: 'connstate', key: 'loggedIn', label: '已登入', capture: captureLoggedIn },
    { name: 'E2E-003-login-screen', kind: 'login', capture: captureLoginScreen },
    { name: 'E2E-004-err-login-screen', kind: 'connstate', key: 'errLogin', label: '拒絕登入', capture: captureErrLogin },
    { name: 'E2E-005-err-conn-screen', kind: 'connstate', key: 'errConn', label: '無法連線', capture: captureErrConn },
]


async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }
    ensureIndexTmpl()
    for (let lang of langs) {
        for (let { name, capture } of cases) {
            if (!shouldGen(lang, name)) {
                continue
            }
            let { buf } = await capture(lang)
            fs.writeFileSync(bp(lang, name), buf)
            console.log(`  ✔ ${lang}/${name} (${buf.length} bytes)`)
        }
    }
    await restartBackend('./settings.json') //還原預設語系
    console.log('=== 標準圖產生完成 ===')
    cleanup() //←【必】非 mocha 環境須顯式呼叫, 否則 process 不退
}


//依 case 種類做語意斷言: 確認 server 注入語系 + 該畫面呈現該語系文字, 且不含另一語系
function assertLang(kind, lang, info, key) {
    let exp = expectedText[lang]
    let other = expectedText[lang === 'eng' ? 'cht' : 'eng']
    assert.strict.equal(info.winLang, lang, `window.___pmwsso___.language 應=${lang}, 實際: ${info.winLang}`)
    if (kind === 'login') {
        assert.ok(info.body.includes(exp.title), `登入畫面應含標題「${exp.title}」, 實際: ${info.body.slice(0, 200)}`)
        assert.ok(info.body.includes(exp.login), `登入畫面應含登入按鈕「${exp.login}」`)
        assert.ok(!info.body.includes(other.title), `登入畫面不應含另一語系標題「${other.title}」`)
    }
    else if (kind === 'connecting') {
        assert.ok(info.body.includes(exp.connecting), `連線中畫面應含「${exp.connecting}」, 實際: ${info.body.slice(0, 200)}`)
        assert.ok(!info.body.includes(other.connecting), `連線中畫面不應含另一語系「${other.connecting}」`)
        assert.ok(!info.body.includes(exp.login), `連線中畫面不應已顯示登入按鈕「${exp.login}」(應仍卡連線中)`)
    }
    else if (kind === 'connstate') {
        assert.ok(info.body.includes(exp[key]), `${key} 連線狀態畫面應含「${exp[key]}」, 實際: ${info.body.slice(0, 200)}`)
        assert.ok(!info.body.includes(other[key]), `${key} 連線狀態畫面不應含另一語系「${other[key]}」`)
    }
}


if (process.argv.includes('--baseline')) {
    generateBaseline()
}
else {
    describe('Init E2E — 初始畫面語系 (server 注入)', function() {
        this.timeout(120000)

        before(function() {
            ensureIndexTmpl()
        })

        after(async function() {
            this.timeout(30000)
            await restartBackend('./settings.json') //還原預設語系給後續測試
        })

        let kindLabel = { login: '登入', connecting: '連線中' }
        for (let lang of langs) {
            for (let { name, kind, capture, key, label } of cases) {
                it(`${name} [${lang}]: 設定語系=${lang} → ${label || kindLabel[kind]}畫面呈現 ${lang}`, async function() {
                    let { buf, info } = await capture(lang)
                    assertLang(kind, lang, info, key) //語意斷言
                    assertBaselineMatch(buf, bp(lang, name), `init-${lang}-${name}`) //像素斷言
                })
            }
        }
    })
}
