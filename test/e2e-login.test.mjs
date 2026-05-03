import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import map from 'lodash-es/map.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce } from './e2e-setup.mjs'

let agentmailApiKey = 'am_us_95ca6a0ff720d8d7eb96437bd10e81fcd03b20ec7d0a81f963a2dfc63421bf8a'
let agentmailInboxId = 'ager@agentmail.to'


//
// E2E login test — 驗證各種登入狀態的畫面（中英文版）
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-login.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-login.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/login/login-{lang}-{number}-{name}.png
// 測試當次截圖不落地，直接以 buffer 與標準圖做像素級比對
//

let baseUrl = 'http://localhost:8080'
let salt = '{salt}'
let baselineDir = './test/pics/login'

let langs = ['eng', 'cht']

// 各語系 UI 文字（用於 Playwright 點擊）
let kpLangText = {
    eng: {
        login: 'Log in',
        resendLink: 'Resend verification email',
        resendSubmit: 'Send verification email',
        ok: 'OK',
    },
    cht: {
        login: '登入',
        resendLink: '重寄驗證信',
        resendSubmit: '寄送驗證信',
        ok: '確認',
    },
}


// 構造 baseline 檔名：login-{lang}-{name}.png
function bp(lang, name) {
    return path.join(baselineDir, `login-${lang}-${name}.png`)
}


// --- 測試使用者清單 ---

let testUsers = [
    {
        id: 'id-login-ok',
        account: 'login-ok',
        password: hashPassword('Pw@login1', salt),
        rawPassword: 'Pw@login1',
        name: 'Login OK',
        email: 'login-ok@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'success',
        screenshotName: '001-ok',
    },
    {
        id: 'id-login-wrong-pw',
        account: 'login-wrongpw',
        password: hashPassword('Pw@login2', salt),
        rawPassword: 'Pw@wrong99',
        name: 'Wrong PW',
        email: 'login-wrongpw@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'incorrect user account or password',
        screenshotName: '002-wrong-pw',
    },
    {
        id: 'id-notverify-flow',
        account: 'notverify-flow',
        password: hashPassword('Tk@24680', salt),
        rawPassword: 'Tk@24680',
        name: 'NotVerify Flow',
        email: agentmailInboxId,
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        fullFlow: true, // 特殊測試：不用 loginAndScreenshot，改走 notVerifiedFullFlow
    },
    {
        id: 'id-login-inactive',
        account: 'login-inactive',
        password: hashPassword('Pw@login4', salt),
        rawPassword: 'Pw@login4',
        name: 'Inactive',
        email: 'login-inactive@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'n',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'account inactive',
        screenshotName: '008-inactive',
    },
    {
        id: 'id-login-expired',
        account: 'login-expired',
        password: hashPassword('Pw@login5', salt),
        rawPassword: 'Pw@login5',
        name: 'Expired',
        email: 'login-expired@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2020-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'account expired',
        screenshotName: '009-expired',
    },
    {
        id: 'id-login-blocked',
        account: 'login-blocked',
        password: hashPassword('Pw@login6', salt),
        rawPassword: 'Pw@login6',
        name: 'Blocked',
        email: 'login-blocked@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '2030-01-01T00:00:00.000+08:00',
        expect: 'account blocked',
        screenshotName: '010-blocked',
    },
    {
        id: 'id-resend-invalid-account',
        account: 'resend-invalid-account',
        password: hashPassword('Pw@resend1', salt),
        rawPassword: 'Pw@resend1',
        name: 'Resend Invalid',
        email: 'resend-invalid-account@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        customTest: 'c1', // 走 resendErrorFlow，填錯誤 email 觸發 'invalid account or email'
    },
    {
        id: 'id-resend-already-verified',
        account: 'resend-already-verified',
        password: hashPassword('Pw@resend2', salt),
        rawPassword: 'Pw@resend2',
        name: 'Resend Verified',
        email: 'resend-already-verified@test.com',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        customTest: 'c2', // 走 resendErrorFlow，送出前先把 timeVerified 填上，觸發 'account already verified'
    },
    {
        id: 'id-no-redir',
        account: 'no-redir',
        password: hashPassword('Pw@noredir', salt),
        rawPassword: 'Pw@noredir',
        name: 'No Redir',
        email: 'no-redir@test.com',
        redir: '', // 空 redir，view=login 時觸發 'failedLoginForNoRedir'
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        customTest: 'd2',
    },
]


// --- 新增/刪除測試使用者 ---

async function insertTestUsers() {
    let rs = map(testUsers, (u, k) => {
        let tokenVerify = u.fullFlow ? `${genIDSeq()}` : ''
        let v = ds.users.funNew({
            order: 100 + k,
            account: u.account,
            password: u.password,
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: u.redir || '',
            tokenVerify,
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
        v.tokenVerify = tokenVerify
        return v
    })
    await woItems.users.insert(rs)
    console.log(`inserted ${rs.length} test users`)
}

async function deleteTestUsers() {
    for (let u of testUsers) {
        await woItems.users.del({ id: u.id }).catch(() => {})
    }
    console.log(`deleted test users`)
}


// --- 找出未驗證使用者（fullFlow=true）---

let notVerifyUser = testUsers.find((u) => u.fullFlow === true)
if (!notVerifyUser) {
    throw new Error('testUsers 必須包含一筆 fullFlow=true 的未驗證使用者')
}


// --- AgentMail 收信 ---

async function getVerifyUrlFromEmail(afterTime, retries = 30, interval = 3000) {
    for (let i = 0; i < retries; i++) {
        console.log(`  polling AgentMail... (${i + 1}/${retries})`)
        let res = await fetch(`https://api.agentmail.to/v0/inboxes/${agentmailInboxId}/messages?limit=5`, {
            headers: { 'Authorization': `Bearer ${agentmailApiKey}` },
        })
        let data = await res.json()
        for (let msg of (data.messages || [])) {
            let msgTime = new Date(msg.timestamp).getTime()
            if (msgTime < afterTime) continue // 只看 afterTime 之後的信
            if (msg.subject && (msg.subject.includes('verify') || msg.subject.includes('驗證'))) {
                let msgRes = await fetch(`https://api.agentmail.to/v0/inboxes/${agentmailInboxId}/messages/${encodeURIComponent(msg.message_id)}`, {
                    headers: { 'Authorization': `Bearer ${agentmailApiKey}` },
                })
                let msgData = await msgRes.json()
                let body = msgData.html || msgData.text || ''
                let match = body.match(/href="([^"]*\/api\/verifyEmail[^"]*)"/)
                if (!match) {
                    match = body.match(/(https?:\/\/[^\s<"]*\/api\/verifyEmail[^\s<"]*)/)
                }
                if (match) {
                    return match[1].replaceAll('&amp;', '&')
                }
            }
        }
        await new Promise((resolve) => setTimeout(resolve, interval))
    }
    return null
}


// --- 切換 UI 語系 ---
//
// 預設語系為 eng（settings.json language: 'eng'），eng 直接 return；
// cht 須點擊右上角 WTextSelect 開啟下拉，再點 '中文' 選項。
//
async function setLangViaUI(page, lang) {
    if (lang === 'eng') {
        return
    }
    // 開啟下拉：點擊顯示 'English' 的 select label
    await page.locator('text=English').first().click()
    await page.waitForTimeout(500)
    // 選 '中文' 選項
    await page.locator('text=中文').first().click()
    await page.waitForTimeout(800)
}


// --- 未驗證使用者完整流程 ---
//
// 1. 登入失敗（未驗證）→ 截圖 003-notverify-login-failed
// 2. 點「重寄驗證信」連結 → 截圖 004-notverify-resend-page
// 3. 填 email 點寄送 → 等 CheckYes 彈窗 → 截圖 005-notverify-resend-sent
// 4. 收信（AgentMail API，不截圖）
// 5. 開驗證連結 → 等 CheckYes 彈窗 → 截圖 006-notverify-verified
// 6. 關閉彈窗後登入 → 截圖 007-notverify-logged-in
//
async function notVerifiedFullFlow(page, lang) {
    let t = kpLangText[lang]
    // 減 1 分鐘緩衝，避免本機時鐘與 AgentMail 伺服器時鐘差異導致抓不到信
    let emailSendStart = Date.now() - 60000
    let bufs = {}

    // Step 1: 登入失敗
    console.log(`  [1] login → expect not verified (${lang})`)
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    let inputs = page.locator('input')
    await inputs.nth(0).fill(notVerifyUser.account)
    await inputs.nth(1).fill(notVerifyUser.rawPassword)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await page.waitForTimeout(5000)
    bufs['003-notverify-login-failed'] = await page.screenshot({ fullPage: true })

    // Step 2: 點「重寄驗證信」
    console.log('  [2] click resend link')
    await page.locator(`text="${t.resendLink}"`).first().click()
    await page.waitForTimeout(1500)
    bufs['004-notverify-resend-page'] = await page.screenshot({ fullPage: true })

    // Step 3: 填 email 點寄送
    // 註：登入頁的 input 順序為 [account(text), password(password), email(text)]，取非 password 的最後一個
    console.log('  [3] fill email + send')
    let resendInput = page.locator('input:not([type="password"])').last()
    await resendInput.fill(notVerifyUser.email)
    await page.waitForTimeout(500)
    page.locator(`text="${t.resendSubmit}"`).first().click().catch(() => {})
    // 等寄信 + CheckYes 彈窗
    await page.waitForTimeout(10000)
    bufs['005-notverify-resend-sent'] = await page.screenshot({ fullPage: true })

    // 關閉 CheckYes 彈窗（點 OK / 確認 按鈕）
    await page.locator(`button:has-text("${t.ok}")`).first().click().catch(async () => {
        await page.locator(`text=${t.ok}`).first().click().catch(() => {})
    })
    await page.waitForTimeout(2000)

    // Step 4: 收信取得驗證連結
    console.log('  [4] fetch verify URL from AgentMail')
    let verifyUrl = await getVerifyUrlFromEmail(emailSendStart)
    if (!verifyUrl) {
        throw new Error('無法從 AgentMail 取得驗證連結')
    }
    console.log(`      verifyUrl: ${verifyUrl}`)

    // Step 5: 開驗證連結
    // verifyUrl 已帶 &lang=...，後端依此渲染白底結果頁，不再轉址回 SPA
    console.log('  [5] open verify URL')
    await page.goto(verifyUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2000)
    bufs['006-notverify-verified'] = await page.screenshot({ fullPage: true })

    // Step 6: 驗證後登入
    console.log('  [6] login after verified')
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    inputs = page.locator('input')
    await inputs.nth(0).fill(notVerifyUser.account)
    await inputs.nth(1).fill(notVerifyUser.rawPassword)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await page.waitForTimeout(8000)
    bufs['007-notverify-logged-in'] = await page.screenshot({ fullPage: true })

    return bufs
}


// --- Playwright 登入並截圖 ---

async function loginAndScreenshot(page, lang, account, password, viewParam = null) {
    let t = kpLangText[lang]
    let url = viewParam ? `${baseUrl}/?view=${viewParam}` : baseUrl

    // 清除 localStorage 避免 autoLogin 干擾
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())

    // 重新載入確保乾淨的登入頁
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    let inputs = page.locator('input')
    await inputs.nth(0).fill(account)
    await inputs.nth(1).fill(password)
    await page.waitForTimeout(500)

    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await page.waitForTimeout(8000)

    return await page.screenshot({ fullPage: true })
}


// --- 重寄驗證信錯誤流程 ---
//
// 1. 登入失敗（未驗證）→ 顯示重寄 UI
// 2. 填入 resendEmail
// 3. 執行 preSendHook（可選，例如 C2 在送出前把使用者標為已驗證）
// 4. 點送出 → 等 resendError 顯示
// 5. 截圖
//
async function resendErrorFlow(page, lang, account, password, resendEmail, preSendHook = null) {
    let t = kpLangText[lang]
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    let inputs = page.locator('input')
    await inputs.nth(0).fill(account)
    await inputs.nth(1).fill(password)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await page.waitForTimeout(5000)

    await page.locator(`text="${t.resendLink}"`).first().click()
    await page.waitForTimeout(1500)

    let resendInput = page.locator('input:not([type="password"])').last()
    await resendInput.fill(resendEmail)
    await page.waitForTimeout(500)

    if (preSendHook) {
        await preSendHook()
    }

    page.locator(`text="${t.resendSubmit}"`).first().click().catch(() => {})
    await page.waitForTimeout(5000)

    return await page.screenshot({ fullPage: true })
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    await deleteTestUsers()
    await insertTestUsers()

    for (let u of testUsers) {
        if (u.fullFlow || u.customTest) continue
        let fp = bp(lang, u.screenshotName)
        console.log(`  ${u.account} (expect: ${u.expect}) → ${fp}`)
        let buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword)
        fs.writeFileSync(fp, buf)
    }

    // 未驗證使用者完整流程（產生 003 ~ 007）
    console.log(`=== 未驗證使用者完整流程（${lang}）===`)
    let bufs = await notVerifiedFullFlow(page, lang)
    for (let name of Object.keys(bufs)) {
        fs.writeFileSync(bp(lang, name), bufs[name])
    }

    // A1: view=backstage
    console.log(`=== view=backstage（${lang}）===`)
    let loginOk = testUsers.find((u) => u.account === 'login-ok')
    let bufA1 = await loginAndScreenshot(page, lang, loginOk.account, loginOk.rawPassword, 'backstage')
    fs.writeFileSync(bp(lang, '011-view-backstage'), bufA1)

    // A2: view=user
    console.log(`=== view=user（${lang}）===`)
    let bufA2 = await loginAndScreenshot(page, lang, loginOk.account, loginOk.rawPassword, 'user')
    fs.writeFileSync(bp(lang, '012-view-user'), bufA2)

    // C1: resend invalid account/email
    console.log(`=== resend invalid account（${lang}）===`)
    let c1User = testUsers.find((u) => u.customTest === 'c1')
    let bufC1 = await resendErrorFlow(page, lang, c1User.account, c1User.rawPassword, 'wrong-email@nowhere.com', null)
    fs.writeFileSync(bp(lang, '013-resend-invalid-account'), bufC1)

    // C2: resend already verified（送出前動態標記為已驗證）
    console.log(`=== resend already verified（${lang}）===`)
    let c2User = testUsers.find((u) => u.customTest === 'c2')
    let bufC2 = await resendErrorFlow(page, lang, c2User.account, c2User.rawPassword, c2User.email, async () => {
        await woItems.users.save({ id: c2User.id, timeVerified: '2025-06-01T00:00:00.000+08:00' })
    })
    fs.writeFileSync(bp(lang, '014-resend-already-verified'), bufC2)

    // D2: login success but no redir
    console.log(`=== login no redir（${lang}）===`)
    let noRedirUser = testUsers.find((u) => u.customTest === 'd2')
    let bufD2 = await loginAndScreenshot(page, lang, noRedirUser.account, noRedirUser.rawPassword)
    fs.writeFileSync(bp(lang, '016-login-no-redir'), bufD2)

    // D1 不需產生新 baseline，直接共用 002-wrong-pw

    await deleteTestUsers()
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

        describe(`Login E2E [${lang}] — 各種登入狀態`, function() {
            this.timeout(120000)

            before(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
                await startServersOnce()

                await deleteTestUsers()
                await insertTestUsers()

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
                await deleteTestUsers()
            })

            for (let u of testUsers) {
                if (u.fullFlow || u.customTest) continue
                it(`${u.screenshotName}: ${u.account} (expect: ${u.expect})`, async function() {
                    let baselinePath = bp(lang, u.screenshotName)

                    let buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword)

                    assert.strict.equal(
                        fs.existsSync(baselinePath),
                        true,
                        `標準圖不存在: ${baselinePath}，請先執行 node test/e2e-login.test.mjs --baseline`
                    )

                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-${u.screenshotName}`)
                })
            }

            describe(`[${lang}] notverify: 未驗證使用者完整流程`, function() {
                this.timeout(180000)

                let bufs

                before(async function() {
                    bufs = await notVerifiedFullFlow(page, lang)
                })

                let names = [
                    '003-notverify-login-failed',
                    '004-notverify-resend-page',
                    '005-notverify-resend-sent',
                    '006-notverify-verified',
                    '007-notverify-logged-in',
                ]
                for (let name of names) {
                    it(name, function() {
                        let baselinePath = bp(lang, name)
                        assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                        let baselineBuf = fs.readFileSync(baselinePath)
                        assert.strict.equal(bufs[name].equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-${name}`)
                    })
                }
            })

            describe(`[${lang}] view=backstage`, function() {
                let buf
                before(async function() {
                    let u = testUsers.find((u) => u.account === 'login-ok')
                    buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword, 'backstage')
                })
                it('011-view-backstage', function() {
                    let baselinePath = bp(lang, '011-view-backstage')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-011-view-backstage`)
                })
            })

            describe(`[${lang}] view=user`, function() {
                let buf
                before(async function() {
                    let u = testUsers.find((u) => u.account === 'login-ok')
                    buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword, 'user')
                })
                it('012-view-user', function() {
                    let baselinePath = bp(lang, '012-view-user')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-012-view-user`)
                })
            })

            describe(`[${lang}] resend: invalid account/email`, function() {
                let buf
                before(async function() {
                    let u = testUsers.find((u) => u.customTest === 'c1')
                    buf = await resendErrorFlow(page, lang, u.account, u.rawPassword, 'wrong-email@nowhere.com', null)
                })
                it('013-resend-invalid-account', function() {
                    let baselinePath = bp(lang, '013-resend-invalid-account')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-013-resend-invalid-account`)
                })
            })

            describe(`[${lang}] resend: already verified`, function() {
                let buf
                before(async function() {
                    let u = testUsers.find((u) => u.customTest === 'c2')
                    buf = await resendErrorFlow(page, lang, u.account, u.rawPassword, u.email, async () => {
                        await woItems.users.save({ id: u.id, timeVerified: '2025-06-01T00:00:00.000+08:00' })
                    })
                })
                it('014-resend-already-verified', function() {
                    let baselinePath = bp(lang, '014-resend-already-verified')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-014-resend-already-verified`)
                })
            })

            describe(`[${lang}] account not exist (security: no account enumeration)`, function() {
                let buf
                before(async function() {
                    // 刪掉 login-wrongpw 使此帳號不存在，使用相同輸入驗證截圖與 002 完全一致
                    let u = testUsers.find((u) => u.account === 'login-wrongpw')
                    await woItems.users.del({ id: u.id }).catch(() => {})
                    buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword)
                })
                it(`015-account-not-exist (共用 login-${lang}-002-wrong-pw baseline)`, function() {
                    let baselinePath = bp(lang, '002-wrong-pw')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與 login-${lang}-002 不一致（帳號不存在應與密碼錯顯示完全相同，防帳號列舉）`)
                })
            })

            describe(`[${lang}] login no redir`, function() {
                let buf
                before(async function() {
                    let u = testUsers.find((u) => u.customTest === 'd2')
                    buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword)
                })
                it('016-login-no-redir', function() {
                    let baselinePath = bp(lang, '016-login-no-redir')
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: login-${lang}-016-login-no-redir`)
                })
            })
        })

    }

}
