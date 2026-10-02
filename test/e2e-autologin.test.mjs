import assert from 'assert'
import fs from 'fs'
import path from 'path'
import map from 'lodash-es/map.js'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, assertBaselineMatch, baseUrl, maskRegions, overlayRegions, resetToBaseSeed, deleteNonBaseSeed, launchBrowser, REGEN, backstageMenuBox, waitUntilExist } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, pageHasText, collectDomText } from './tools/e2eLib.mjs'
import { mdiChartBoxOutline } from '@mdi/js/mdi.js'

//後台之紅框框左側選單可見項目之聯集（backstageMenuBox，見 e2e-setup；2026-09-28 改：原框整個抽屜，非管理者只有 1 項卻框整欄）
const menuItemsBox = backstageMenuBox


//
// E2E autoLogin test — 驗證自動登入各種情境的畫面（中英文版）
//
// 對應流程文件：spec/流程_使用者自動登入.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-autologin.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-autologin.test.mjs --timeout 120000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     案例鍵或編號前綴 (如 E2E-002) 寫該案之圖 (本檔每案 1 張, 案例鍵即圖鍵), 不符任何鍵即報錯;
//     E2E-006 / E2E-007 / E2E-008 為只比對之案例 (共用 E2E-004-no-token 標準圖), 點名即報錯; --langs; --write-mode missing|changed;
//     env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用; 不涵蓋 E2E-002 之 _chartref-{lang}.png 自舉, 見 autoLoginBackstageMasked)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 fresh browser + DB 重置 → 截圖 → 語意斷言 → 寫檔 / 比對; 斷言不過一張都不寫
//
// 標準圖存放：test/pics/autologin/autologin-{lang}-{number}-{name}.png
// 測試當次截圖不落地，直接以 buffer 與標準圖做像素級比對
//

let salt = '{salt}'
let baselineDir = './test/pics/autologin'
let langs = ['eng', 'cht']

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


//頁面文字之走訪 (pageHasText / collectDomText) 取自 e2eLib (原本檔內手寫 collectVisibleText / pageHasText, 內容相同)
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
            let dump = await collectDomText(page)
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
    //此函式為案例管線 (runCase 之 prepare) 之唯一進入點, 產製端與比對端共用.
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
//   4. 偵測 autoLogin 已走完且畫面到達該案 spec 終態（waitAutoLoginSettled，含可能的 redirect），截圖
//
async function autoLoginScreenshot(page, lang, opt = {}) {

    let viewParam = opt.viewParam || ''
    let token = opt.token || ''
    // name: 案例鍵（expectedSpecText 之鍵），決定偵測之終態。2026-09-28 起取代固定 waitMs（原預設 8 秒、E2E-005 為 3.5 秒：
    // 負載高時 autoLogin 之 checkToken → getUserByToken → 轉址未走完即截圖；E2E-005 之提示浮窗約 4 秒自動消失，固定 3.5 秒兩頭都可能落空）
    let name = opt.name
    // boxTarget: captureStableWithBox 的 target。
    //   - 登入頁 / user view → '.sb'（PageLogin.vue 與 PageUser.vue 的主卡片 class 皆為 sb）
    //   - backstage → menuItemsBox()（左側選單可見項目之聯集，見檔頭）
    //   - 提示浮窗 → 浮窗本體（E2E-005）
    // 預設 '.sb'（兩種頁面都有 .sb）；其餘由 caller 傳入。
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
    await waitAutoLoginSettled(page, lang, name)
    //停滑鼠避免 hover 殘留; 提示浮窗於此期間滑入定位(同 logout E2E-004-1 之作法)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)

    return await captureStableWithBox(page, boxTarget)
}


//偵測 autoLogin 已走完且畫面到達該案 spec 終態(依 expectedSpecText; 2026-09-28 取代固定秒數):
//autoLogin 進行中 App 只渲染連線狀態, 結束後才依結果渲染登入頁 / 使用者頁 / 後台(src/App.vue:7、:17、:102-117);
//成功且轉址者(E2E-001)舊頁先切回登入頁(有密碼欄)再導頁(src/plugins/mUI.mjs:661、App.vue:105), 下列條件於舊頁不成立.
async function waitAutoLoginSettled(page, lang, name, timeout = 60000) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`waitAutoLoginSettled: expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    let e = expected[lang]
    if (e.mode === 'absentLoginButton') {
        //使用者頁: 主卡片 .sb 且無密碼欄(登入頁亦有 .sb, 但有密碼欄)
        await waitUntilExist(page, `${name}: 使用者頁`, () => document.querySelectorAll('input[type="password"]').length === 0 && !!document.querySelector('.sb'), { timeout })
    }
    else if (name === 'E2E-005-no-redir') {
        //登入表單與「無有效轉址」提示浮窗(wsemi domAlert, id 以 alt- 開頭)皆已出現; 浮窗約 4 秒後自動消失, spec: 於其顯示中截圖
        await waitUntilExist(page, `${name}: 登入表單與提示浮窗`, (s) => document.querySelectorAll('input').length >= 2 && Array.from(document.querySelectorAll('[id^="alt-"]')).some((el) => (el.innerText || '').includes(s)), { arg: e.value, timeout })
    }
    else if (name === 'E2E-009-ok-backstage-nonadmin') {
        //後台選單項與內容區之使用者資訊皆已載入: 內容區載入前顯示「等待數據中」(src/components/LayoutContentUserInfor.vue:232,
        //鍵 waitingData, server/procLang.mjs:101), 使用者名稱亦可能先見於他處, 故兩者並判
        let userName = testUsers.find((u) => u.id === 'id-autologin-ok').name
        await waitUntilExist(page, `${name}: 後台選單與使用者資訊`, ({ menu, user }) => {
            let t = document.body.innerText || ''
            return t.includes(menu) && t.includes(user) && !t.includes('Waiting data...') && !t.includes('等待數據中...') && document.querySelectorAll('input[type="password"]').length === 0
        }, { arg: { menu: e.value, user: userName }, timeout })
    }
    else {
        //回登入頁(E2E-004 / 006 / 007 / 008): 登入表單出現即 autoLogin 已 reject
        await waitUntilExist(page, `${name}: 回登入頁`, (s) => document.querySelectorAll('input').length >= 2 && (document.body.innerText || '').includes(s), { arg: e.value, timeout })
    }
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

    //Step 4: 等統計頁三張圖表皆已渲染（無「等待數據中」佔位、echarts canvas ≥ 3）; 其後才是 echarts 動畫 settle buffer。
    //2026-09-28 補：原只固定等 3 秒，_chartref 參考片自舉時把「載入中」凍了進去（技能 §7.5 壞畫面不得凍結），參考片已刪除重產
    await page.waitForFunction(() => {
        let t = document.body.innerText || ''
        return document.querySelectorAll('canvas').length >= 3 && !t.includes('Waiting data...') && !t.includes('等待數據中...')
    }, null, { timeout: 60000 })
    await page.waitForTimeout(3000)

    //框左側選單之項目（已進入 backstage、選單依身分列出之頁籤）：範圍為 divDrawer（WDrawer 內部 ref="divDrawer"，
    //由 v-domstable directive 綁定時呼叫 el.setAttribute('ev-stable', id)，x≈0、寬≈229px，即左側抽屜 sidebar 實體），
    //框其內可見選單項目之聯集而非整個抽屜（抽屜下方空白不框）。
    let buf = await captureStableWithBox(page, menuItemsBox())

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
    //(此自舉寫檔不經 runBaselineCase, 故不受 --names / --write-mode / E2E_BASELINE_OUT_DIR 管控; 僅於 ref 缺檔時發生)
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


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//語意斷言 (截圖後、寫檔 / 比對前): 依案例鍵查 expectedSpecText (原本只在比對端執行)
async function specSemantic(ctx) {
    await assertSpecForCase(ctx.page, ctx.lang, ctx.name)
}

//共用 E2E-004 標準圖之只比對案例 (spec: 視覺終態統一回登入頁, 防洩露停用狀態 / token 真偽)
let sharedNoToken = 'E2E-004-no-token'

//順序與 mocha it 相同 (產製順序 ≡ 比對順序; 只比對之案例於產製端不執行); title 為 mocha it 標題 (--grep 依之).
//單張案例之圖鍵即案例鍵 (stages 宣告同名一張). 只比對之案例 (compareOnly) 直接宣告其比對之共用圖鍵為 stages, run 回傳 { 共用圖鍵: buf };
//篩選器之 --names 解析只由產圖案例負責寫檔 (--names E2E-004-no-token 只選到 E2E-004). 2026-09-28 移除原為閃避舊篩選器缺陷之 sharedKey 包裝.
let cases = [
    {
        // 001: token 有效 + view=login → autoLogin 成功 → redirect 到 user view
        name: 'E2E-001-ok-redir',
        title: 'E2E-001-ok-redir: token 有效 + view=login → redirect 至 user view',
        run: (page, lang) => autoLoginScreenshot(page, lang, { name: 'E2E-001-ok-redir', token: userTokens['id-autologin-ok'] }),
        stages: ['E2E-001-ok-redir'],
        semantic: specSemantic,
    },
    {
        // 002: token 有效 (admin) + view=backstage → autoLogin 成功 → 停留 backstage 看 full dashboard
        // (「存取活動監測」以下即時圖表以 _chartref 快照覆蓋, 穩定 pixel baseline)
        // admin user: view=backstage 須由 admin 觸發, 否則 LayoutContent isAdmin filter 只能看 mmUserInfor.
        name: 'E2E-002-ok-backstage',
        title: 'E2E-002-ok-backstage: token 有效 + view=backstage → 停留 backstage',
        run: (page, lang) => autoLoginBackstageMasked(page, lang, { token: userTokens['id-autologin-ok-admin'] }),
        stages: ['E2E-002-ok-backstage'],
        semantic: specSemantic,
    },
    {
        // 003: token 有效 + view=user → autoLogin 成功 → 停留 user view
        name: 'E2E-003-ok-user',
        title: 'E2E-003-ok-user: token 有效 + view=user → 停留 user view',
        run: (page, lang) => autoLoginScreenshot(page, lang, { name: 'E2E-003-ok-user', token: userTokens['id-autologin-ok'], viewParam: 'user' }),
        stages: ['E2E-003-ok-user'],
        semantic: specSemantic,
    },
    {
        // 004: 無 token → autoLogin 'no token' reject → 回登入頁
        name: 'E2E-004-no-token',
        title: 'E2E-004-no-token: 無 token → 回登入頁',
        run: (page, lang) => autoLoginScreenshot(page, lang, { name: 'E2E-004-no-token', token: '' }),
        stages: ['E2E-004-no-token'],
        semantic: specSemantic,
    },
    {
        // 005: token 有效但 user.redir 為空 → 顯示 'failedLoginForNoRedir' alert + 回登入頁
        // 偵測提示浮窗與登入表單皆出現即截圖(浮窗約 4 秒自動消失); 反應為提示訊息, 框浮窗本體(技能 §7.2;
        // 原框登入卡片而關鍵訊息未框, 且以固定 3.5 秒卡浮窗時窗, 2026-09-28 改)
        name: 'E2E-005-no-redir',
        title: 'E2E-005-no-redir: token 有效但 user.redir 為空 → alert + 回登入頁',
        run: (page, lang) => autoLoginScreenshot(page, lang, { name: 'E2E-005-no-redir', token: userTokens['id-autologin-no-redir'], boxTarget: page.locator('div[id^="alt-"]').first() }),
        stages: ['E2E-005-no-redir'],
        semantic: specSemantic,
    },
    // 以下情境視覺結果與 E2E-004-no-token 相同（autoLogin reject 後 App.vue catch 統一回登入頁，無顯示錯誤）
    // 為驗證每條程式碼路徑都能達到正確最終狀態，分別測試但共用 E2E-004 baseline (合法 gap ①: 共用他案標準圖)
    {
        name: 'E2E-006-inactive-user',
        title: 'E2E-006-inactive-user: token 有效但 user.isActive=n → 共用 E2E-004 baseline',
        run: async (page, lang) => ({ [sharedNoToken]: await autoLoginScreenshot(page, lang, { name: 'E2E-006-inactive-user', token: userTokens['id-autologin-inactive'] }) }),
        compareOnly: true,
        stages: [sharedNoToken],
        semantic: specSemantic,
    },
    {
        name: 'E2E-007-stale-token',
        title: 'E2E-007-stale-token: LS 有 token 但 DB 查無 → 共用 E2E-004 baseline',
        run: async (page, lang) => ({ [sharedNoToken]: await autoLoginScreenshot(page, lang, { name: 'E2E-007-stale-token', token: 'fake-token-not-in-db' }) }),
        compareOnly: true,
        stages: [sharedNoToken],
        semantic: specSemantic,
    },
    {
        name: 'E2E-008-expired-token',
        title: 'E2E-008-expired-token: token 在 DB 但 timeEnd 已過 → 共用 E2E-004 baseline',
        run: async (page, lang) => ({ [sharedNoToken]: await autoLoginScreenshot(page, lang, { name: 'E2E-008-expired-token', token: expiredToken }) }),
        compareOnly: true,
        stages: [sharedNoToken],
        semantic: specSemantic,
    },
    {
        // 009: token 有效 (非 admin) + view=backstage → autoLogin 成功 → 停留 backstage 但僅
        // mmUserInfor menu (LayoutContent isAdmin filter 阻擋 admin-only menu 與 admin-only API).
        // 對應 LayoutContent.vue: isAdmin computed + menus.adminOnly flag 過濾 + mounted hook
        // 設 menuKey='mmUserInfor'. 議題 1 fix 驗 (commit 5006ac0).
        // 框左側選單可見項目之聯集（非管理者僅「使用者資訊」一項；確認無 admin-only 項目），範圍為 sidebar 抽屜 [ev-stable]。
        name: 'E2E-009-ok-backstage-nonadmin',
        title: 'E2E-009-ok-backstage-nonadmin: 非 admin token + view=backstage → 停留 backstage 但僅 UserInfor (LayoutContent isAdmin filter)',
        run: (page, lang) => autoLoginScreenshot(page, lang, { name: 'E2E-009-ok-backstage-nonadmin', token: userTokens['id-autologin-ok'], viewParam: 'backstage', boxTarget: menuItemsBox() }),
        stages: ['E2E-009-ok-backstage-nonadmin'],
        semantic: async (ctx) => {
            //語意斷言: 顯示 User information sidebar text (mmUserInfor menu 可見)
            await specSemantic(ctx)
            //語意斷言補強: 不顯示 Statistics Information sidebar text (admin-only mmStaInfor 被過濾)
            let bodyText = await ctx.page.evaluate(() => document.body.innerText)
            let staTitle = ctx.lang === 'eng' ? 'Statistics information' : '統計資訊'
            assert.strict.equal(
                bodyText.includes(staTitle),
                false,
                `非 admin 進 view=backstage 不應顯示 "${staTitle}" sidebar item (admin-only menu 須被 LayoutContent isAdmin filter 阻擋), 但實際有顯示`
            )
        },
    },
]

//單一案例管線: per-case DB 重置 + fresh browser (新 context, 自動接受 dialog) → 截圖 → 語意斷言 → 寫檔 / 比對 → 關瀏覽器 → 清資料
//只比對之案例 (compareOnly): 以宣告之共用圖鍵比對, 產製端不寫; fail-dump 標籤帶案例名 (多案比對同一張圖時可分辨)
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        compareOnly: !!c.compareOnly,
        semantic: c.semantic,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => (c.compareOnly ? `autologin-${lg}-${c.name}-shared-${key}` : `autologin-${lg}-${key}`),
        match: assertBaselineMatch,
        prepare: async () => {
            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokens()
        },
        afterCase: async () => {
            await deleteTestUsersAndTokens()
        },
        ...extra,
    })
}


// --- 產生標準圖模式 ---

async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    //截圖前篩選 (--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR); 不符任何鍵或點名只比對之案例即於此報錯
    let gate = createBaselineGate({ langs, cases })
    console.log(gate.describe())
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of gate.langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
        //gate.casesFor 不含只比對之案例 (E2E-006 / 007 / 008 共用 E2E-004 標準圖, 產製端不執行)
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }
    //--names 之任一項未產出即報錯 (不靜默略過)
    gate.finalize()

    await deleteTestUsersAndTokens()

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

        describe(`AutoLogin E2E [${lang}] — 自動登入各情境`, function() {
            this.timeout(120000)

            //per-case 獨立 (fresh browser + DB 重置) 由 runCase 負責, 確保單 case --grep 也能跑
            beforeEach(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
                await startServersOnce()
            })

            //語意斷言皆於比對標準圖之前 (pixel baseline 為補強層; pixelmatch 反鋸齒感知 + maxDiffPixels 容差)
            for (let c of cases) {
                it(c.title, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })

    }

}
