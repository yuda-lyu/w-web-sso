import assert from 'assert'
import fs from 'fs'
import path from 'path'
import map from 'lodash-es/map.js'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, assertBaselineMatch, baseUrl, maskRegions, overlayRegions, resetToBaseSeed, deleteNonBaseSeed, launchBrowser, REGEN } from './e2e-setup.mjs'
import { mdiChartBoxOutline } from '@mdi/js/mdi.js'


//
// E2E autoLogin test — 驗證自動登入各種情境的畫面（中英文版）
//
// 對應流程文件：spec/流程_使用者自動登入.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-autologin.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-autologin.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/autologin/autologin-{lang}-{number}-{name}.png
// 測試當次截圖不落地，直接以 buffer 與標準圖做像素級比對
//

let salt = '{salt}'
let baselineDir = './test/pics/autologin'
let langs = ['eng', 'cht']

// 可選 --names <eng-001-ok-redir,cht-003-ok-user,...> 進行手術式 baseline 重產
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

// 由 settings.json webKey 組成的 localStorage key
let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


// 各語系 UI 文字
let kpLangText = {
    eng: { login: 'Log in' },
    cht: { login: '登入' },
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_使用者自動登入.md + procLang.mjs 衍生, 非現狀指紋)
// ===================================================================

let expectedSpecText = {
    'E2E-001-ok-redir': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-002-ok-backstage': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-003-ok-user': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-004-no-token': {
        //無 token → 回登入頁, 應見 Log in 按鈕
        eng: { mode: 'text', value: 'Log in' },
        cht: { mode: 'text', value: '登入' },
    },
    'E2E-005-no-redir': {
        //failedLoginForNoRedir WAlert 顯示文字
        eng: { mode: 'text', value: 'Can not get the url for redirection' },
        cht: { mode: 'text', value: '無有效轉址' },
    },
    'E2E-006-inactive-user': {
        //視覺等同 004
        eng: { mode: 'text', value: 'Log in' },
        cht: { mode: 'text', value: '登入' },
    },
    'E2E-007-stale-token': {
        eng: { mode: 'text', value: 'Log in' },
        cht: { mode: 'text', value: '登入' },
    },
    'E2E-008-expired-token': {
        eng: { mode: 'text', value: 'Log in' },
        cht: { mode: 'text', value: '登入' },
    },
    'E2E-009-ok-backstage-nonadmin': {
        //非 admin token + view=backstage → 停留 backstage 但 LayoutContent isAdmin filter
        //只顯示 mmUserInfor menu, 主內容區為 UserInfor (User information / 使用者資訊).
        //對應 LayoutContent.vue 之 menus computed + mounted hook 行為.
        eng: { mode: 'text', value: 'User information' },
        cht: { mode: 'text', value: '使用者資訊' },
    },
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

async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    let e = expected[lang]
    if (e.mode === 'absentLoginButton') {
        //已離開 PageLogin → 不應仍有 password input
        //(不用文字檢查 — backstage Statistics 含「使用者登入頻率」/「Login Frequency」誤觸)
        let pwCount = await page.locator('input[type="password"]').count()
        if (pwCount > 0) {
            assert.fail(`預期 autoLogin 成功離開 PageLogin (不應再有 password input), 實際 ${pwCount} 個`)
        }
    }
    else if (e.mode === 'text') {
        let found = await pageHasText(page, e.value)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期含 "${e.value}" (${name}), 實際: ${dump}`)
        }
    }
}


// --- 測試使用者清單 ---

let testUsers = [
    {
        id: 'id-autologin-ok',
        account: 'autologin-ok',
        password: hashPassword('Pw@auto001', salt),
        name: 'AutoLogin OK',
        email: 'autologin-ok@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    },
    {
        //E2E-002-ok-backstage 專用 admin user (view=backstage 須由 admin 觸發, 非 admin 由 LayoutContent
        //之 isAdmin 過濾只能看 mmUserInfor — 詳 LayoutContent.vue 之 isAdmin computed + menus filter).
        //另建 user 而非把 id-autologin-ok 改 isAdmin='y', 避免影響 E2E-001/E2E-003 之 user view baseline
        //(admin 進 user view 之 Role 顯示「Administrator」, 跟 General 像素不同).
        id: 'id-autologin-ok-admin',
        account: 'autologin-ok-admin',
        password: hashPassword('Pw@auto001admin', salt),
        name: 'AutoLogin OK Admin',
        email: 'autologin-ok-admin@test.com',
        redir: `${baseUrl}/?view=backstage&token={token}`,
        isAdmin: 'y',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    },
    {
        id: 'id-autologin-no-redir',
        account: 'autologin-no-redir',
        password: hashPassword('Pw@auto002', salt),
        name: 'AutoLogin No Redir',
        email: 'autologin-no-redir@test.com',
        redir: '', // 空 redir，autoLogin useRedir=true 時會觸發 'failedLoginForNoRedir'
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    },
    {
        id: 'id-autologin-inactive',
        account: 'autologin-inactive',
        password: hashPassword('Pw@auto003', salt),
        name: 'AutoLogin Inactive',
        email: 'autologin-inactive@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'n', // 觸發 getUserByToken reject (查不到 isActive:'y' 的 user)
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    },
]


// --- token 管理 ---

// 由 insertTestUsersAndTokens() 填入：userId → 有效 token 字串
let userTokens = {}

// 由 insertTestUsersAndTokens() 填入：autologin-ok user 的「已過期」token（timeEnd 為過去）
let expiredToken = ''


function bp(lang, name) {
    return path.join(baselineDir, `autologin-${lang}-${name}.png`)
}


// --- 新增/刪除測試使用者與 token ---

async function insertTestUsersAndTokens() {

    //先重設為 base seed (清空 users/tokens/ips + 插入 3 canonical users + 4 tokens),
    //再插入本測試自己的 testUsers + tokens. hermetic: 每次 setup 都從乾淨 base seed 起跳.
    //此函式為 mocha beforeEach 與 generateBaselineForLang 共用唯一進入點, 故置於首行覆蓋兩條路徑.
    await resetToBaseSeed()

    // users
    let rs = map(testUsers, (u, k) => {
        let v = ds.users.funNew({
            order: 200 + k,
            account: u.account,
            password: u.password,
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: u.redir || '',
            isAdmin: u.isAdmin,
            timeVerified: u.timeVerified,
            timeExpired: u.timeExpired,
            timeBlocked: u.timeBlocked,
            isActive: u.isActive,
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.isActive = u.isActive
        v.timeVerified = u.timeVerified
        v.timeExpired = u.timeExpired
        v.timeBlocked = u.timeBlocked
        return v
    })
    await woItems.users.insert(rs)

    // tokens (有效，timeEnd 為未來 60 分鐘)
    let tks = []
    userTokens = {}
    for (let u of testUsers) {
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        userTokens[u.id] = t.token
        tks.push(t)
    }

    // 額外給 autologin-ok 多一個「已過期」token (timeEnd 為過去 60 分鐘)
    let tExpired = ds.tokens.funNew({ userId: 'id-autologin-ok' })
    tExpired.timeEnd = ot().subtract(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    expiredToken = tExpired.token
    tks.push(tExpired)

    await woItems.tokens.insert(tks)

    console.log(`inserted ${rs.length} test users + ${tks.length} tokens`)
}


async function deleteTestUsersAndTokens() {
    await deleteNonBaseSeed()
    console.log(`deleted test users + tokens`)
}


// --- autoLogin 截圖 helper ---
//
// 流程：
//   1. 先 navigate 到 baseUrl 取得乾淨頁面
//   2. 設定 localStorage[lsKey] = token (或清空)
//   3. 重新 navigate 到目標 URL（含 view 與 lang 參數），觸發 SPA mount → autoLogin
//   4. 等 autoLogin 完成（含可能的 redirect），截圖
//
async function autoLoginScreenshot(page, lang, opt = {}) {

    let viewParam = opt.viewParam || ''
    let token = opt.token || ''
    // waitMs 預設 8000；含 redirect 場景用 8s，需截 WAlert 顯示中的場景需 < 4000（WAlert 預設 4s 自動消失）
    let waitMs = opt.waitMs || 8000
    // boxTarget: captureStableWithBox 的 target。
    //   - 登入頁 / user view → '.sb'（PageLogin.vue 與 PageUser.vue 的主卡片 class 皆為 sb）
    //   - backstage → page.locator('[state]').first()（WDrawer 根元素，包含 sidebar 導航與右側內容）
    // 預設 '.sb'（兩種頁面都有 .sb）；backstage case 由 caller 傳入 Locator。
    let boxTarget = opt.boxTarget || '.sb'

    // 構造目標 URL（含 view 與 lang query）
    let qs = []
    if (viewParam) {
        qs.push(`view=${viewParam}`)
    }
    if (lang) {
        qs.push(`lang=${lang}`)
    }
    let url = qs.length > 0 ? `${baseUrl}/?${qs.join('&')}` : baseUrl

    // Step 1: 先到 baseUrl 設置 localStorage
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(({ key, val }) => {
        localStorage.clear()
        if (val) {
            localStorage.setItem(key, val)
        }
    }, { key: lsKey, val: token })

    // Step 2: 真正觸發 autoLogin 的 navigate
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(waitMs)

    return await captureStableWithBox(page, boxTarget)
}


//E2E-002 backstage: Statistics 頁「存取活動監測」區塊起含即時圖表 (WEchartsVue canvas),
//其 GPU/canvas 渲染跨進程 warm/cold 狀態不同 → pixel 永遠漂移, 無法直接比對.
//對策(改良版, 取代填黑): 偵測「存取活動監測」區塊 div 及其下方各區塊 div (含「管控狀態」), 取各自
//bounding rect, 在截圖後用「預存的真實圖表快照 (_chartref-{lang}.png)」覆蓋這些區 → baseline 與
//verify 兩端皆貼同一張快照, 該區永遠一致而視覺上呈現真實頻率圖 (非突兀大黑塊). 上半「使用者資訊統計卡」
//為靜態真實截圖照常比對. 各區塊 rect 為右側內容欄寬度, 不覆蓋左側抽屜.
async function autoLoginBackstageMasked(page, lang, opt = {}) {
    //admin 進 backstage 6 個 grSta 全跑 + echarts canvas init, 對 fresh admin user (無歷史 stats)
    //需 ~26s; 對 base seed user ~16s. 不能用固定 waitMs (§6.3「偵測 driven 步驟流程」), 改 waitForSelector
    //等 chart icon 出現確保載入完成, 再加 3s buffer 給 echarts 動畫 settle, 最後才 captureStable.
    let token = opt.token || ''

    //Step 1: setup LS token
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(({ key, val }) => {
        localStorage.clear()
        if (val) {
            localStorage.setItem(key, val)
        }
    }, { key: lsKey, val: token })

    //Step 2: navigate to backstage
    let url = `${baseUrl}/?view=backstage${lang ? '&lang=' + lang : ''}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })

    //Step 3: 等 chart icon 出現 (admin 完整載入 backstage 之 marker)
    //icon 已由 mdi webfont 改為 @mdi/js SVG path → 以 svg path 之 d 屬性比對 mdiChartBoxOutline 偵測
    await page.waitForFunction((iconPath) => {
        return Array.from(document.querySelectorAll('svg path')).some((p) => p.getAttribute('d') === iconPath)
    }, mdiChartBoxOutline, { timeout: 60000 })

    //Step 4: echarts 動畫 settle buffer
    await page.waitForTimeout(3000)

    //框左側 sidebar 導航本體：divDrawer（WDrawer 內部 ref="divDrawer"）由 v-domstable directive 綁定時
    //呼叫 el.setAttribute('ev-stable', id)，x≈0、寬≈229px，即左側抽屜 sidebar 實體，
    //比 [state]（WDrawer 根、全屏）更聚焦「已進入 backstage（sidebar 出現）」這個驗證標的。
    let buf = await captureStableWithBox(page, page.locator('[ev-stable]').first())

    //取「存取活動監測」區塊及其後所有 sibling 區塊的 rect (fullPage 座標 = viewport rect + scroll)
    let rects = await page.evaluate((iconPath) => {
        //找 d===mdiChartBoxOutline 的 svg path (存取活動監測 header 內的 WIcon)
        let pathEl = Array.from(document.querySelectorAll('svg path')).find((p) => p.getAttribute('d') === iconPath)
        if (!pathEl) return null
        //結構: .space-y-8 > [使用者資訊 div, 存取活動監測 div, 管控狀態 div]
        //path 在「存取活動監測」div 的 header(.pb-1) 內, header.parentElement 即該區塊 div
        let header = pathEl.closest('.pb-1') || pathEl.parentElement
        let section = header ? header.parentElement : null
        if (!section) return null
        let out = []
        //存取活動監測區塊起, 含其後所有 sibling 區塊全部遮黑
        for (let el = section; el; el = el.nextElementSibling) {
            let r = el.getBoundingClientRect()
            out.push({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height })
        }
        return out
    }, mdiChartBoxOutline)
    if (rects == null || rects.length === 0) {
        throw new Error('autoLoginBackstageMasked: 找不到「存取活動監測」區塊 (svg path d=mdiChartBoxOutline)')
    }
    //以「真實圖表快照」覆蓋動態區 (取代填黑): baseline 與 runtime 兩端皆貼同一張 ref 圖 → 該區永遠一致
    //(e2e 穩定), 視覺呈現真實頻率圖而非突兀黑塊 (緣由: echarts canvas GPU 跨進程漂移無法 pixel 穩定).
    //ref 不存在時僅 REGEN (--baseline / E2E_REGEN=1) 允許以當次真實截圖建立 (bootstrap), 之後固定沿用;
    //要更新快照: 刪 _chartref-{lang}.png 再重產. 正常測試模式缺檔即 fail, 不得靜默自舉.
    let refPath = `./test/pics/autologin/_chartref-${lang}.png`
    if (!fs.existsSync(refPath)) {
        if (!REGEN) {
            throw new Error(`per-item ref 不存在: ${refPath}（請以 --baseline 產製）`)
        }
        fs.writeFileSync(refPath, buf)
    }
    let refBuf = fs.readFileSync(refPath)
    return await overlayRegions(buf, rects, refBuf)
}


// --- 產生標準圖模式 ---

//001~009 每個 case 各自 { name, fn(page) }；fn 內用當次 DB 重建後的 userTokens (見下方迴圈).
function buildAutoLoginCases(lang) {
    return [
        // 001: token 有效 + view=login → autoLogin 成功 → redirect 到 user view
        { name: 'E2E-001-ok-redir', fn: (page) => autoLoginScreenshot(page, lang, { token: userTokens['id-autologin-ok'] }) },
        // 002: token 有效 (admin) + view=backstage → autoLogin 成功 → 停留 backstage 看 full dashboard
        // (「存取活動監測」以下即時圖表填黑遮蔽, 穩定 pixel baseline)
        // admin user: view=backstage 須由 admin 觸發, 否則 LayoutContent isAdmin filter 只能看 mmUserInfor.
        { name: 'E2E-002-ok-backstage', fn: (page) => autoLoginBackstageMasked(page, lang, { token: userTokens['id-autologin-ok-admin'] }) },
        // 003: token 有效 + view=user → autoLogin 成功 → 停留 user view
        { name: 'E2E-003-ok-user', fn: (page) => autoLoginScreenshot(page, lang, { token: userTokens['id-autologin-ok'], viewParam: 'user' }) },
        // 004: 無 token → autoLogin 'no token' reject → 回登入頁
        { name: 'E2E-004-no-token', fn: (page) => autoLoginScreenshot(page, lang, { token: '' }) },
        // 005: token 有效但 user.redir 為空 → 顯示 'failedLoginForNoRedir' alert + 回登入頁
        // 須等 autoLogin 完成 (~2s) 但仍在 WAlert 4s 自動消失前截圖；3.5s 為兩端窗口
        { name: 'E2E-005-no-redir', fn: (page) => autoLoginScreenshot(page, lang, { token: userTokens['id-autologin-no-redir'], waitMs: 3500 }) },
        // 009: token 有效 (非 admin) + view=backstage → autoLogin 成功 → 停留 backstage 但僅
        // mmUserInfor menu (LayoutContent isAdmin filter 阻擋 admin-only menu 與 admin-only API).
        // 對應 LayoutContent.vue: isAdmin computed + menus.adminOnly flag 過濾 + mounted hook
        // 設 menuKey='mmUserInfor'. 議題 1 fix 驗 (commit 5006ac0).
        // 框左側 sidebar 導航本體（[ev-stable]，即 WDrawer 內 ref="divDrawer" + v-domstable，x≈0 寬≈229px），
        // 比 [state]（WDrawer 根、全屏）更聚焦「sidebar 導航項目（確認無 admin-only 項目）」這個驗證標的。
        { name: 'E2E-009-ok-backstage-nonadmin', fn: (page) => autoLoginScreenshot(page, lang, { token: userTokens['id-autologin-ok'], viewParam: 'backstage', boxTarget: page.locator('[ev-stable]').first() }) },
    ]
}


async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    for (let { name, fn } of buildAutoLoginCases(lang)) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        //per-case fresh DB + browser, 與 mocha beforeEach/afterEach 對稱 (技能 §6 隔離/ §7.5 產製端測試端同管線)
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await launchBrowser()
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        let buf = await fn(page)
        writeBaseline(lang, name, buf)

        await browser.close()
    }

    await deleteTestUsersAndTokens()
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

    console.log('=== 標準圖產生完成 ===')

    cleanup()
}


// --- mocha 測試模式 ---

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

        describe(`AutoLogin E2E [${lang}] — 自動登入各情境`, function() {
            this.timeout(120000)

            //per-case 獨立: fresh browser + DB tokens (對齊 e2e-adduser 標準)
            beforeEach(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
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

            it('E2E-001-ok-redir: token 有效 + view=login → redirect 至 user view', async function() {
                let okToken = userTokens['id-autologin-ok']
                let buf = await autoLoginScreenshot(page, lang, { token: okToken })
                await assertSpecForCase(page, lang, 'E2E-001-ok-redir')
                let baselinePath = bp(lang, 'E2E-001-ok-redir')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-001-ok-redir`)
            })

            it('E2E-002-ok-backstage: token 有效 + view=backstage → 停留 backstage', async function() {
                let okToken = userTokens['id-autologin-ok-admin']
                let buf = await autoLoginBackstageMasked(page, lang, { token: okToken })
                await assertSpecForCase(page, lang, 'E2E-002-ok-backstage')
                let baselinePath = bp(lang, 'E2E-002-ok-backstage')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-002-ok-backstage`)
            })

            it('E2E-003-ok-user: token 有效 + view=user → 停留 user view', async function() {
                let okToken = userTokens['id-autologin-ok']
                let buf = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'user' })
                await assertSpecForCase(page, lang, 'E2E-003-ok-user')
                let baselinePath = bp(lang, 'E2E-003-ok-user')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-003-ok-user`)
            })

            it('E2E-004-no-token: 無 token → 回登入頁', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: '' })
                await assertSpecForCase(page, lang, 'E2E-004-no-token')
                let baselinePath = bp(lang, 'E2E-004-no-token')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-004-no-token`)
            })

            it('E2E-005-no-redir: token 有效但 user.redir 為空 → alert + 回登入頁', async function() {
                let noRedirToken = userTokens['id-autologin-no-redir']
                let buf = await autoLoginScreenshot(page, lang, { token: noRedirToken, waitMs: 3500 })
                await assertSpecForCase(page, lang, 'E2E-005-no-redir')
                let baselinePath = bp(lang, 'E2E-005-no-redir')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-005-no-redir`)
            })

            // 以下情境視覺結果與 E2E-004-no-token 相同（autoLogin reject 後 App.vue catch 統一回登入頁，無顯示錯誤）
            // 為驗證每條程式碼路徑都能達到正確最終狀態，分別測試但共用 E2E-004 baseline (Gap 場景 1)

            it('E2E-006-inactive-user: token 有效但 user.isActive=n → 共用 E2E-004 baseline', async function() {
                let inactiveToken = userTokens['id-autologin-inactive']
                let buf = await autoLoginScreenshot(page, lang, { token: inactiveToken })
                await assertSpecForCase(page, lang, 'E2E-006-inactive-user')
                let baselinePath = bp(lang, 'E2E-004-no-token')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-006-inactive-user-shared-E2E-004`)
            })

            it('E2E-007-stale-token: LS 有 token 但 DB 查無 → 共用 E2E-004 baseline', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: 'fake-token-not-in-db' })
                await assertSpecForCase(page, lang, 'E2E-007-stale-token')
                let baselinePath = bp(lang, 'E2E-004-no-token')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-007-stale-token-shared-E2E-004`)
            })

            it('E2E-008-expired-token: token 在 DB 但 timeEnd 已過 → 共用 E2E-004 baseline', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: expiredToken })
                await assertSpecForCase(page, lang, 'E2E-008-expired-token')
                let baselinePath = bp(lang, 'E2E-004-no-token')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-008-expired-token-shared-E2E-004`)
            })

            it('E2E-009-ok-backstage-nonadmin: 非 admin token + view=backstage → 停留 backstage 但僅 UserInfor (LayoutContent isAdmin filter)', async function() {
                let okToken = userTokens['id-autologin-ok']
                //框左側 sidebar 導航本體（[ev-stable]，即 WDrawer 內 ref="divDrawer" + v-domstable，x≈0 寬≈229px），
                //比 [state]（WDrawer 根、全屏）更聚焦「sidebar 無 admin-only 項目」這個驗證標的。
                let buf = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'backstage', boxTarget: page.locator('[ev-stable]').first() })
                //語意斷言: 顯示 User information sidebar text (mmUserInfor menu 可見)
                await assertSpecForCase(page, lang, 'E2E-009-ok-backstage-nonadmin')
                //語意斷言補強: 不顯示 Statistics Information sidebar text (admin-only mmStaInfor 被過濾)
                let bodyText = await page.evaluate(() => document.body.innerText)
                let staTitle = lang === 'eng' ? 'Statistics information' : '統計資訊'
                assert.strict.equal(
                    bodyText.includes(staTitle),
                    false,
                    `非 admin 進 view=backstage 不應顯示 "${staTitle}" sidebar item (admin-only menu 須被 LayoutContent isAdmin filter 阻擋), 但實際有顯示`
                )
                //視覺斷言: pixel baseline (pixelmatch 反鋸齒感知 + maxDiffPixels 容差)
                let baselinePath = bp(lang, 'E2E-009-ok-backstage-nonadmin')
                assertBaselineMatch(buf, baselinePath, `autologin-${lang}-E2E-009-ok-backstage-nonadmin`)
            })

        })

    }

}
