import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStableWithBox, assertBaselineMatch, baseUrl, resetToBaseSeed, deleteNonBaseSeed, launchBrowser } from './e2e-setup.mjs'


//
// E2E logout test — 驗證登出流程 (eng + cht 各 3 case)
//
// 對應規格 (spec/流程_使用者登出.md / Layout.vue / PageUser.vue 行為衍生):
//   - logout-from-backstage: admin autoLogin backstage → 點 user popup → 點 Log out → token 清空 + 回 login 頁
//   - logout-from-user-view: user autoLogin user view → 點 Log out chip → token 清空 + 回 login 頁
//   - logout-then-reload: logout 後 reload → 應停在 login (不可 autoLogin 復原)
//
// 流程驗證重點 (語意斷言):
//   1. localStorage[`ksso:userToken`] 變為空字串 (mUI.logout 內 setItem('', '') 不 removeItem)
//   2. 畫面切回 login 頁 (出現 Log in / 登入 文字)
//   3. reload 後不會被 autoLogin 拉回 (token 已被清空, 落到 login 頁)
//
// 視覺斷言 (補強):
//   logout 後 login 頁 pixel baseline 比對 (3 case × 2 lang = 6 張)
//

let salt = '{salt}'

let webKey = 'ksso'
let lsKey = `${webKey}:userToken`

let langs = ['eng', 'cht']

let kpUiText = {
    eng: { login: 'Log in', logout: 'Log out', statistics: 'Statistics information', userInfor: 'User information', userStatus: 'Status', noWebKey: 'Can not get the web key' },
    cht: { login: '登入', logout: '登出', statistics: '統計資訊', userInfor: '使用者資訊', userStatus: '帳號狀態', noWebKey: '無有效站台唯一識別資訊' },
}

let testUsers = {
    admin: {
        id: 'id-lo-admin',
        account: 'lo-admin',
        rawPassword: 'Pw@logout1',
        name: 'Logout Admin',
        email: 'lo-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
    user: {
        id: 'id-lo-user',
        account: 'lo-user',
        rawPassword: 'Pw@logout2',
        name: 'Logout User',
        email: 'lo-user@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
}

let userTokens = {}

let baselineDir = './test/pics/logout'
let bp = (lang, name) => path.join(baselineDir, `logout-${lang}-${name}.png`)

// --names <eng-logout-from-backstage,cht-logout-then-reload,...> 進行手術式 baseline 重產
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


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 800 + k,
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
        return v
    })
    await woItems.users.insert(rs)

    //tokens (admin + user 各一)
    let tks = []
    userTokens = {}
    for (let key of Object.keys(testUsers)) {
        let u = testUsers[key]
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        userTokens[u.id] = t.token
        tks.push(t)
    }
    await woItems.tokens.insert(tks)

    console.log(`inserted ${rs.length} logout test users + ${tks.length} tokens`)
}


async function deleteTestUsersAndTokens() {
    await deleteNonBaseSeed()
    console.log('deleted logout test users + tokens')
}


//帶 token + lang 進指定 view, 等 autoLogin 完成
//?lang= URL 參數 (src/plugins/mUI.mjs:137) 在 SPA 啟動時被讀取, 為最高優先語系設定來源.
//login → backstage/user 為跨頁 redirect, 固定 10s buffer + 偵測 target marker
//(全域 CLAUDE.md §6.3「偵測 driven 步驟流程 — 跨頁 redirect 場景」)
async function loginViaAutoLogin(page, user, view, lang) {
    let t = kpUiText[lang]
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(({ key, val }) => {
        localStorage.clear()
        localStorage.setItem(key, val)
    }, { key: lsKey, val: userTokens[user.id] })

    await page.goto(`${baseUrl}/?view=${view}&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    //固定 10s buffer 等 redirect 啟動 + mount
    await page.waitForTimeout(10000)
    //偵測 target 出現 (backstage: statistics 文字; user view: user.name)
    let marker = view === 'backstage' ? t.statistics : user.name
    await page.waitForFunction((m) => document.body.innerText.includes(m), marker, { timeout: 15000 })
}


async function getLsToken(page) {
    return await page.evaluate((key) => localStorage.getItem(key), lsKey)
}


//等指定文字出現在頁面 (user-facing observation), timeout 拋錯
async function waitForTextVisible(page, text, timeout = 10000) {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
}


//斷言指定文字不存在於頁面 (settle 後檢查 count, 對齊 §6.3 e2e rubric 反向斷言策略).
//先等 1500ms 給 page DOM 與 SPA 路由 settle, 再用 locator.count() 確認 0.
//不採 waitFor({state:'hidden'}) 因若元素根本不在 DOM 內, hidden 不會 fire.
async function assertTextNotVisible(page, text, label = '') {
    await page.waitForTimeout(1500)
    let count = await page.getByText(text, { exact: false }).count()
    assert.strict.equal(count, 0, label || `預期不見「${text}」, 實際出現 ${count} 處`)
}


//等 login 頁出現 (login 文字可見, 隨 lang 變)
async function waitForLoginPage(page, lang) {
    let t = kpUiText[lang]
    await page.waitForFunction((needle) => {
        let walk = (el) => {
            if (!el) return false
            if (el.nodeType === 3) return (el.nodeValue || '').includes(needle)
            if (el.nodeType !== 1) return false
            let tag = el.tagName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false
            for (let c of el.childNodes) {
                if (walk(c)) return true
            }
            return false
        }
        return walk(document.body)
    }, t.login, { timeout: 15000 })
}


// --- capture helpers (3 case per lang) ---

async function captureLogoutFromBackstage(page, lang) {
    let t = kpUiText[lang]
    await loginViaAutoLogin(page, testUsers.admin, 'backstage', lang)

    //切至「使用者資訊」頁再開 popup: backstage 落地頁(統計資訊)含隨 log 內容變動之活圖表
    //(2026-07-10 fdLog 修復後統計面板由恆掛 Waiting data 轉為真實載入), 非本案例主題,
    //不可作為 baseline 背景(跨日/新 log 即 drift)。使用者資訊頁內容全由固定 seed 導出(2025/2030 固定日期), 決定性。
    await page.locator(`text="${t.userInfor}"`).first().click()
    await page.locator(`text="${t.userStatus}"`).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(500)

    //點 user popup trigger (右上角 user name)
    await page.locator(`text="${testUsers.admin.name}"`).first().click()
    await page.waitForTimeout(500)

    //popup 浮出後 — [stage1] 截「popup 展開 + logout 按鈕可見」畫面, 框 logout 按鈕本身
    let logoutLoc = page.locator(`text="${t.logout}"`).first()
    await logoutLoc.waitFor({ state: 'visible', timeout: 5000 })
    //park 滑鼠避免 hover 殘留在 user name trigger 上
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
    let bufPopup = await captureStableWithBox(page, logoutLoc)

    //點 logout
    await logoutLoc.click()

    //等回 login 頁
    await waitForLoginPage(page, lang)

    //[stage2] 截登出後登入頁 (與原 baseline 相同)
    let bufLoginPage = await captureStableWithBox(page, '.sb')

    //多階段回傳 dict: stage1 = popup 展開畫面, stage2 = 登出後登入頁
    return {
        'E2E-001-1-logout-popup-open': bufPopup,
        'E2E-001-2-logout-from-backstage': bufLoginPage,
    }
}


async function captureLogoutFromUserView(page, lang) {
    let t = kpUiText[lang]
    await loginViaAutoLogin(page, testUsers.user, 'user', lang)

    //點 Log out chip (PageUser.vue 直接顯示, 不需 popup)
    await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
    await page.locator(`text="${t.logout}"`).first().click()

    await waitForLoginPage(page, lang)

    return await captureStableWithBox(page, '.sb')
}


async function captureLogoutThenReload(page, lang) {
    let t = kpUiText[lang]
    await loginViaAutoLogin(page, testUsers.user, 'user', lang)

    //logout
    await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
    await page.locator(`text="${t.logout}"`).first().click()
    await waitForLoginPage(page, lang)

    //reload — 確保仍在 login 頁 (不可 autoLogin 復原)
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await waitForLoginPage(page, lang)

    return await captureStableWithBox(page, '.sb')
}


//Item 4 (重要流程 bullet 4): 後端 logoutByToken reject → 前端屏蔽錯誤訊息仍續走清空 LS + 回登入頁
//設計: page.route 攔截 /api/logoutByToken 並 abort, mUI.logout core() 內 .catch(() => {})
//吃掉 reject, 仍續走 localStorage.setItem(key, '') + updateViewState('login'), 終態與 Item 2 同 (login 頁)
async function captureBackendRejectLogout(page, lang) {
    let t = kpUiText[lang]
    await loginViaAutoLogin(page, testUsers.user, 'user', lang)

    //攔截 logoutByToken — 模擬網路 / 後端 reject
    await page.route('**/api/logoutByToken*', (route) => route.abort('failed'))

    //點 Log out chip
    await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
    await page.locator(`text="${t.logout}"`).first().click()

    //預期: 即使後端 reject, 前端仍切回 login 頁
    await waitForLoginPage(page, lang)

    return await captureStableWithBox(page, '.sb')
}


//Item 5 (重要流程 bullet 5): webKey 尚未取得時呼叫登出 → alert webKey 取得失敗 + LS token 不清
//設計: 走 user view 入口 (PageUser.vue 的 Log out chip), 進 user view autoLogin 完成後,
//經 store.commit(UpdateWebInfor, {webKey: '', ...}) 抹掉 webKey, 再點 logout.
//mUI.logout 在 core() 第 683 行讀 $keyLS 為空字串 → reject('invalid $keyLS') →
//.catch 顯示 noWebKey alert, 不繼續清空 LS. 終態仍在 user view (viewState 未切 login).
//
//走 user view 不走 backstage 的理由: backstage 含動態 User Login Frequency chart, 圖表 bar 高度
//隨各 case 累積的 login 計數變動, baseline pixelmatch 容差比對會撞 dynamic data drift (8 px 差於
//chart 區). user view 無此類動態統計, capture 穩定.
//
//spec 容許: spec/流程_使用者登出.md:5-10 兩入口 (backstage popup / user view chip) 共用同一條
//vo.$ui.logout() 邏輯, Item 5 的 webKey 驗證失敗發生在共用邏輯內, 兩入口行為一致.
async function captureWebKeyMissingLogout(page, lang) {
    let t = kpUiText[lang]
    await loginViaAutoLogin(page, testUsers.user, 'user', lang)

    //抹掉 store 內 webKey, 觸發 logout 前置驗證失敗
    //(App.vue 的 root 不掛 id="app", Vue 2 mount 後原 #app 已被替換, 用 __vue__ tree-walk 找 root 實例)
    await page.evaluate(() => {
        let walk = (el) => {
            if (!el) return null
            if (el.__vue__) return el.__vue__
            for (let c of el.children) {
                let r = walk(c)
                if (r) return r
            }
            return null
        }
        let app = walk(document.body)
        if (!app) throw new Error('cannot find Vue root via __vue__ walk')
        let store = app.$store
        let current = JSON.parse(JSON.stringify(store.state.webInfor || {}))
        current.webKey = ''
        store.commit(store.types.UpdateWebInfor, current)
    })

    //點 Log out chip (PageUser.vue 直接顯示, 不需 popup)
    await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
    await page.locator(`text="${t.logout}"`).first().click()

    //$alert 為自訂 DOM 元素 (wsemi domAlert) 非 native dialog, 等 alert 浮出 → 截 stage1 → 等 alert 移除
    //domAlert id 格式: alt-{genID()}, 可用 div[id^="alt-"] 定位 alert 容器
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), t.noWebKey, { timeout: 10000 })

    //[stage1] 截「$alert 顯示中」畫面 — alert 已浮出但尚未淡出, 框 alert 元素本身
    //park 滑鼠避免 hover 殘留影響截圖
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
    let bufAlert = await captureStableWithBox(page, page.locator('div[id^="alt-"]').first())

    //等 user name 仍在 (alert 尚存時 user view 確認)
    await page.waitForFunction((m) => document.body.innerText.includes(m), testUsers.user.name, { timeout: 10000 })
    //等 alert 從 DOM 移除 (fade-out 完成, removeItemByID)
    await page.waitForFunction((needle) => !document.body.innerText.includes(needle), t.noWebKey, { timeout: 10000 })
    await page.waitForTimeout(1000)

    //[stage2] 截「alert 淡出後的 user view 終態」(原 baseline)
    let bufUserView = await captureStableWithBox(page, '.sb')

    //多階段回傳 dict: stage1 = alert 顯示中, stage2 = alert 淡出後的 user view 終態
    return {
        'E2E-004-1-alert-showing': bufAlert,
        'E2E-004-2-logout-webkey-missing': bufUserView,
    }
}


// ===================================================================
// Baseline 產製模式
// ===================================================================

async function generateBaselineForLang(lang) {
    //順序須與下面 mocha it() 順序完全一致 (§6.3「baseline 產製順序必須與 mocha 全跑順序一致」)
    //不一致時, 第 N case 在 regen 與 mocha 中的 chromium 進程級 GPU/glyph atlas 狀態不同 →
    //captureStable 雖能 settle 但收斂到不同 stable state → pixel mismatch
    //
    //name: 作為 shouldGen / --names 過濾的 case key (多階段 case 用「首張」名稱作代表).
    //fn 可回傳 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔.
    let cases = [
        { name: 'E2E-001-1-logout-popup-open', fn: captureLogoutFromBackstage },
        { name: 'E2E-002-logout-from-user-view', fn: captureLogoutFromUserView },
        { name: 'E2E-003-logout-backend-reject', fn: captureBackendRejectLogout },
        { name: 'E2E-004-1-alert-showing', fn: captureWebKeyMissingLogout },
        { name: 'E2E-005-logout-then-reload', fn: captureLogoutThenReload },
    ]

    for (let { name, fn } of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        //per-case fresh DB + browser — 與 mocha beforeEach 對稱, 避免 cold/warm GPU/glyph
        //atlas 差異 (§6.3 截圖穩定性已知限制)
        //先重置為 base seed, 再插本測試 own-data, 與 mocha beforeEach 對稱
        await resetToBaseSeed()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await launchBrowser()
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', (d) => d.accept())

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            writeBaseline(lang, bname, b)
        }

        await browser.close()
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

        let browser
        let page

        describe(`Logout E2E [${lang}]`, function() {
            this.timeout(120000)

            //per-case 獨立: fresh browser + fresh DB tokens (logout 會 invalidate server-side token, 須每 case 重產)
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()

                //先重置為 canonical base seed (wipe users/tokens/ips + 插 3 users/4 tokens),
                //再清自己特化資料殘留 + 插入本測試 own-data (lo-admin / lo-user + tokens).
                await resetToBaseSeed()
                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()

                browser = await launchBrowser()
                let context = await browser.newContext()
                page = await context.newPage()
                page.on('dialog', (d) => d.accept())
            })

            afterEach(async function() {
                if (browser) {
                    await browser.close()
                    browser = null
                }
                await deleteTestUsersAndTokens()
            })


            it(`logout-from-backstage: admin autoLogin backstage → 點 user popup → 點 Log out → token 清空 + 回 login 頁`, async function() {
                let t = kpUiText[lang]
                await loginViaAutoLogin(page, testUsers.admin, 'backstage', lang)

                //語意斷言 1: 已進 backstage
                await waitForTextVisible(page, t.statistics, 10000)

                //語意斷言 2: token 存在
                let tokenBefore = await getLsToken(page)
                assert.strict.equal(tokenBefore, userTokens[testUsers.admin.id], `登入後 token 應存在 LS`)

                //切至「使用者資訊」頁再開 popup(與 captureLogoutFromBackstage 同步:
                //統計落地頁含活圖表非本案例主題, 不可作 baseline 背景;使用者資訊頁由固定 seed 導出, 決定性)
                await page.locator(`text="${t.userInfor}"`).first().click()
                await page.locator(`text="${t.userStatus}"`).first().waitFor({ state: 'visible', timeout: 10000 })
                await page.waitForTimeout(500)

                //點 user popup trigger
                await page.locator(`text="${testUsers.admin.name}"`).first().click()
                await page.waitForTimeout(500)

                //等 logout 按鈕可見 (popup 已展開)
                let logoutLoc = page.locator(`text="${t.logout}"`).first()
                await logoutLoc.waitFor({ state: 'visible', timeout: 5000 })

                //像素斷言 stage1: popup 展開中、點 Log out 前的畫面 (讓讀者看到登出操作位置)
                await page.mouse.move(0, 0)
                await page.waitForTimeout(300)
                let bufPopup = await captureStableWithBox(page, logoutLoc)
                let baselinePopupPath = bp(lang, 'E2E-001-1-logout-popup-open')
                assertBaselineMatch(bufPopup, baselinePopupPath, `logout-${lang}-001-1-logout-popup-open`)

                //點 logout
                await logoutLoc.click()

                await waitForLoginPage(page, lang)

                //像素斷言 stage2: 登出後回到登入頁 (補強)
                let bufLoginPage = await captureStableWithBox(page, '.sb')
                let baselineLoginPath = bp(lang, 'E2E-001-2-logout-from-backstage')
                assertBaselineMatch(bufLoginPage, baselineLoginPath, `logout-${lang}-001-2-logout-from-backstage`)

                //語意斷言 3: token 清空 (mUI.logout 用 setItem('', '') 不 removeItem)
                let tokenAfter = await getLsToken(page)
                assert.strict.equal(tokenAfter, '', `logout 後 LS token 應為空字串, 實際: ${JSON.stringify(tokenAfter)}`)

                //語意斷言 4 (DB 副作用): 後端 logoutByToken 已自 DB 刪除該 admin token.
                //對應 spec/流程_使用者登出.md 執行流程「015 刪除該 token 列」與契約 line 157
                //「後端 logoutByToken 成功刪除 token 後寫 srLog」. 查該 user 之 token 列應已不存在 (count 0).
                let adminTokensInDb = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
                assert.strict.equal(adminTokensInDb.length, 0, `logout 後 DB 中 admin token 應已被刪除, 實際殘留 ${adminTokensInDb.length} 筆`)

                //語意斷言 5: backstage nav 已消失
                await assertTextNotVisible(page, t.statistics, `logout 後不應再見 backstage nav (${t.statistics})`)
            })


            it(`logout-from-user-view: user autoLogin user view → 點 Log out chip → token 清空 + 回 login 頁`, async function() {
                let t = kpUiText[lang]
                await loginViaAutoLogin(page, testUsers.user, 'user', lang)

                await waitForTextVisible(page, testUsers.user.name, 10000)

                let tokenBefore = await getLsToken(page)
                assert.strict.equal(tokenBefore, userTokens[testUsers.user.id], `登入後 token 應存在 LS`)

                await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
                await page.locator(`text="${t.logout}"`).first().click()

                await waitForLoginPage(page, lang)

                let buf = await captureStableWithBox(page, '.sb')
                let baselinePath = bp(lang, 'E2E-002-logout-from-user-view')
                assertBaselineMatch(buf, baselinePath, `logout-${lang}-002-logout-from-user-view`)

                let tokenAfter = await getLsToken(page)
                assert.strict.equal(tokenAfter, '', `logout 後 LS token 應為空字串, 實際: ${JSON.stringify(tokenAfter)}`)

                //語意斷言 (DB 副作用): 後端 logoutByToken 已自 DB 刪除該 user token.
                //對應 spec/流程_使用者登出.md 執行流程「015 刪除該 token 列」與契約 line 157.
                let userTokensInDb = await woItems.tokens.select({ userId: testUsers.user.id }).catch(() => [])
                assert.strict.equal(userTokensInDb.length, 0, `logout 後 DB 中 user token 應已被刪除, 實際殘留 ${userTokensInDb.length} 筆`)
            })


            it(`logout-backend-reject: 後端 logoutByToken reject → 前端屏蔽錯誤訊息仍續走清空 LS + 回登入頁`, async function() {
                let t = kpUiText[lang]
                await loginViaAutoLogin(page, testUsers.user, 'user', lang)

                let tokenBefore = await getLsToken(page)
                assert.strict.equal(tokenBefore, userTokens[testUsers.user.id], `登入後 token 應存在 LS`)

                //攔截 logoutByToken — 模擬網路 / 後端 reject
                await page.route('**/api/logoutByToken*', (route) => route.abort('failed'))

                await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
                await page.locator(`text="${t.logout}"`).first().click()

                //預期: 即使後端 reject, 前端仍切回 login 頁 (mUI.logout core() 內 .catch(() => {}) 屏蔽 reject)
                await waitForLoginPage(page, lang)

                //像素斷言 (補強) — 終態 login 頁應與 Item 2 (logout-from-user-view) 視覺一致, 但獨立 baseline 留住規格意圖
                let buf = await captureStableWithBox(page, '.sb')
                let baselinePath = bp(lang, 'E2E-003-logout-backend-reject')
                assertBaselineMatch(buf, baselinePath, `logout-${lang}-003-logout-backend-reject`)

                //語意斷言: token 已被清空 (後端 reject 不阻擋前端 LS 清空)
                let tokenAfter = await getLsToken(page)
                assert.strict.equal(tokenAfter, '', `後端 reject 後 LS token 仍應被前端清空, 實際: ${JSON.stringify(tokenAfter)}`)
            })


            it(`logout-webkey-missing: webKey 尚未取得時呼叫登出 → alert webKey 取得失敗 + LS token 不清`, async function() {
                let t = kpUiText[lang]
                //走 user view 入口 (詳 captureWebKeyMissingLogout 註解: backstage 動態 chart 會撞 baseline drift)
                await loginViaAutoLogin(page, testUsers.user, 'user', lang)

                let tokenBefore = await getLsToken(page)
                assert.strict.equal(tokenBefore, userTokens[testUsers.user.id], `登入後 token 應存在 LS`)

                //抹掉 store 內 webKey, 觸發 logout 前置驗證失敗
                //(App.vue 的 root 不掛 id="app", Vue 2 mount 後原 #app 已被替換, 用 __vue__ tree-walk 找 root 實例)
                await page.evaluate(() => {
                    let walk = (el) => {
                        if (!el) return null
                        if (el.__vue__) return el.__vue__
                        for (let c of el.children) {
                            let r = walk(c)
                            if (r) return r
                        }
                        return null
                    }
                    let app = walk(document.body)
                    if (!app) throw new Error('cannot find Vue root via __vue__ walk')
                    let store = app.$store
                    let current = JSON.parse(JSON.stringify(store.state.webInfor || {}))
                    current.webKey = ''
                    store.commit(store.types.UpdateWebInfor, current)
                })

                //點 Log out chip (PageUser.vue 直接顯示, 不需 popup)
                await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
                await page.locator(`text="${t.logout}"`).first().click()

                //$alert 為自訂 DOM 元素 (wsemi domAlert), 非 native window.alert, page.on('dialog') 不會 fire.
                //偵測方式: 等 body 內出現含 noWebKey 文字的 DOM (alert 浮出後即可見)
                await page.waitForFunction((needle) => document.body.innerText.includes(needle), t.noWebKey, { timeout: 10000 })

                //像素斷言 stage1: $alert 顯示中的畫面 (讓讀者看到實際的錯誤警示彈窗)
                //domAlert id 格式: alt-{genID()}, 框 div[id^="alt-"] 定位 alert 容器
                await page.mouse.move(0, 0)
                await page.waitForTimeout(300)
                let bufAlert = await captureStableWithBox(page, page.locator('div[id^="alt-"]').first())
                let baselineAlertPath = bp(lang, 'E2E-004-1-alert-showing')
                assertBaselineMatch(bufAlert, baselineAlertPath, `logout-${lang}-004-1-alert-showing`)

                //等 alert auto fade-out 後 (domAlert 預設 timer 約 3s) 終態仍在 user view
                await page.waitForFunction((m) => document.body.innerText.includes(m), testUsers.user.name, { timeout: 10000 })
                //等 alert 從 DOM 移除 (fade-out 完成, removeItemByID)
                await page.waitForFunction((needle) => !document.body.innerText.includes(needle), t.noWebKey, { timeout: 10000 })
                await page.waitForTimeout(1000)

                //像素斷言 stage2: alert 淡出後的 user view 終態 (補強)
                let bufUserView = await captureStableWithBox(page, '.sb')
                let baselineUserViewPath = bp(lang, 'E2E-004-2-logout-webkey-missing')
                assertBaselineMatch(bufUserView, baselineUserViewPath, `logout-${lang}-004-2-logout-webkey-missing`)

                //語意斷言: LS token 仍存在 (未被清空, 因 logout 前置 reject)
                let tokenAfter = await getLsToken(page)
                assert.strict.equal(tokenAfter, userTokens[testUsers.user.id], `webKey 缺失時 LS token 應仍保留, 實際: ${JSON.stringify(tokenAfter)}`)

                //語意斷言: 仍在 user view (viewState 未切 login, 仍見 user name)
                await waitForTextVisible(page, testUsers.user.name, 10000)
            })


            it(`logout-then-reload: logout 後 reload → 應停在 login (不可 autoLogin 復原)`, async function() {
                let t = kpUiText[lang]
                await loginViaAutoLogin(page, testUsers.user, 'user', lang)

                //logout
                await page.locator(`text="${t.logout}"`).first().waitFor({ state: 'visible', timeout: 5000 })
                await page.locator(`text="${t.logout}"`).first().click()
                await waitForLoginPage(page, lang)

                //reload
                await page.reload({ waitUntil: 'networkidle', timeout: 15000 })
                await page.waitForTimeout(3000)
                await waitForLoginPage(page, lang)

                //像素斷言
                let buf = await captureStableWithBox(page, '.sb')
                let baselinePath = bp(lang, 'E2E-005-logout-then-reload')
                assertBaselineMatch(buf, baselinePath, `logout-${lang}-005-logout-then-reload`)

                //語意斷言: 仍在 login 頁
                await waitForTextVisible(page, t.login, 10000)

                //語意斷言: 不在 user view (不應見 user name)
                await assertTextNotVisible(page, testUsers.user.name, `reload 不應 autoLogin 回 user view, 但見 user name`)

                //語意斷言: token 仍為空
                let tokenAfter = await getLsToken(page)
                assert.strict.equal(tokenAfter, '', `reload 後 LS token 仍應為空, 實際: ${JSON.stringify(tokenAfter)}`)
            })

        })

    }

}
