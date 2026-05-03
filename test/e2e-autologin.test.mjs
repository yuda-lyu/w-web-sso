import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import map from 'lodash-es/map.js'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce } from './e2e-setup.mjs'


//
// E2E autoLogin test — 驗證自動登入各種情境的畫面（中英文版）
//
// 對應流程文件：z流程_使用者自動登入.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-autologin.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-autologin.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/autologin/autologin-{lang}-{number}-{name}.png
// 測試當次截圖不落地，直接以 buffer 與標準圖做像素級比對
//

let baseUrl = 'http://localhost:8080'
let salt = '{salt}'
let baselineDir = './test/pics/autologin'
let langs = ['eng', 'cht']

// 由 settings.json webKey 組成的 localStorage key
let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


// --- 測試使用者清單 ---

let testUsers = [
    {
        id: 'id-autologin-ok',
        account: 'autologin-ok',
        password: hashPassword('Pw@auto001', salt),
        name: 'AutoLogin OK',
        email: 'autologin-ok@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
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
        redir: `http://localhost:8080/?view=user&token={token}`,
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
    for (let u of testUsers) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await woItems.tokens.del({ userId: u.id }).catch(() => {})
    }
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

    return await page.screenshot({ fullPage: true })
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    await deleteTestUsersAndTokens()
    await insertTestUsersAndTokens()

    let okToken = userTokens['id-autologin-ok']
    let noRedirToken = userTokens['id-autologin-no-redir']

    // 001: token 有效 + view=login → autoLogin 成功 → redirect 到 user view
    console.log(`  001-ok-redir`)
    let buf1 = await autoLoginScreenshot(page, lang, { token: okToken })
    fs.writeFileSync(bp(lang, '001-ok-redir'), buf1)

    // 002: token 有效 + view=backstage → autoLogin 成功 → 停留 backstage
    console.log(`  002-ok-backstage`)
    let buf2 = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'backstage' })
    fs.writeFileSync(bp(lang, '002-ok-backstage'), buf2)

    // 003: token 有效 + view=user → autoLogin 成功 → 停留 user view
    console.log(`  003-ok-user`)
    let buf3 = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'user' })
    fs.writeFileSync(bp(lang, '003-ok-user'), buf3)

    // 004: 無 token → autoLogin 'no token' reject → 回登入頁
    console.log(`  004-no-token`)
    let buf4 = await autoLoginScreenshot(page, lang, { token: '' })
    fs.writeFileSync(bp(lang, '004-no-token'), buf4)

    // 005: token 有效但 user.redir 為空 → 顯示 'failedLoginForNoRedir' alert + 回登入頁
    // 須等 autoLogin 完成 (~2s) 但仍在 WAlert 4s 自動消失前截圖；3.5s 為兩端窗口
    console.log(`  005-no-redir`)
    let buf5 = await autoLoginScreenshot(page, lang, { token: noRedirToken, waitMs: 3500 })
    fs.writeFileSync(bp(lang, '005-no-redir'), buf5)

    await deleteTestUsersAndTokens()
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    let browser = await chromium.launch({ headless: true })
    let page = await browser.newPage()

    page.on('dialog', async (dialog) => {
        await dialog.accept()
    })

    for (let lang of langs) {
        await generateBaselineForLang(page, lang)
    }

    await browser.close()

    console.log('=== 標準圖產生完成 ===')
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

            before(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
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

            after(async function() {
                if (browser) {
                    await browser.close()
                }
                await deleteTestUsersAndTokens()
            })

            it('001-ok-redir: token 有效 + view=login → redirect 至 user view', async function() {
                let okToken = userTokens['id-autologin-ok']
                let buf = await autoLoginScreenshot(page, lang, { token: okToken })

                let baselinePath = bp(lang, '001-ok-redir')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: autologin-${lang}-001-ok-redir`)
            })

            it('002-ok-backstage: token 有效 + view=backstage → 停留 backstage', async function() {
                let okToken = userTokens['id-autologin-ok']
                let buf = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'backstage' })

                let baselinePath = bp(lang, '002-ok-backstage')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: autologin-${lang}-002-ok-backstage`)
            })

            it('003-ok-user: token 有效 + view=user → 停留 user view', async function() {
                let okToken = userTokens['id-autologin-ok']
                let buf = await autoLoginScreenshot(page, lang, { token: okToken, viewParam: 'user' })

                let baselinePath = bp(lang, '003-ok-user')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: autologin-${lang}-003-ok-user`)
            })

            it('004-no-token: 無 token → 回登入頁', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: '' })

                let baselinePath = bp(lang, '004-no-token')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: autologin-${lang}-004-no-token`)
            })

            it('005-no-redir: token 有效但 user.redir 為空 → alert + 回登入頁', async function() {
                let noRedirToken = userTokens['id-autologin-no-redir']
                let buf = await autoLoginScreenshot(page, lang, { token: noRedirToken, waitMs: 3500 })

                let baselinePath = bp(lang, '005-no-redir')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: autologin-${lang}-005-no-redir`)
            })

            // 以下情境視覺結果與 004-no-token 相同（autoLogin reject 後 App.vue catch 統一回登入頁，無顯示錯誤）
            // 為驗證每條程式碼路徑都能達到正確最終狀態，分別測試但共用 004 baseline

            it('stale-token (LS 有 token 但 DB 查無) → 共用 004-no-token baseline', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: 'fake-token-not-in-db' })

                let baselinePath = bp(lang, '004-no-token')
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, '截圖與 004-no-token 不一致（stale token 應與無 token 視覺相同）')
            })

            it('expired-token (token 在 DB 但 timeEnd 已過) → 共用 004-no-token baseline', async function() {
                let buf = await autoLoginScreenshot(page, lang, { token: expiredToken })

                let baselinePath = bp(lang, '004-no-token')
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, '截圖與 004-no-token 不一致（expired token 應與無 token 視覺相同）')
            })

            it('inactive-user (token 有效但 user.isActive=n) → 共用 004-no-token baseline', async function() {
                let inactiveToken = userTokens['id-autologin-inactive']
                let buf = await autoLoginScreenshot(page, lang, { token: inactiveToken })

                let baselinePath = bp(lang, '004-no-token')
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, '截圖與 004-no-token 不一致（inactive user 應與無 token 視覺相同）')
            })

        })

    }

}
