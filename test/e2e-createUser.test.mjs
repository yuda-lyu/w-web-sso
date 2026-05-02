import assert from 'assert'
import { chromium } from 'playwright'
import { startServersOnce } from './e2e-setup.mjs'


//
// E2E test for user registration feature
//
// 執行：npx mocha test/e2e-createUser.test.mjs --timeout 180000
// 若前後端 server 未啟動，本測試會自動 spawn（首次 vue-cli-service 編譯約 15~30 秒）
// 若 port 11007/8080 已被開發者手動啟動，會直接重用不再 spawn
//
// Screenshots saved to: test/e2e-screenshots/
//

let baseUrl = 'http://localhost:8080'
let screenshotDir = './test/pics'

// unique account per test run
let ts = Date.now()
let testAccount = `qauser`
let testPassword = 'Tk@24680'
let testName = `QA User`
let testEmail = `qauser@test.com`

let browser
let page


describe('User Registration E2E', function() {
    this.timeout(120000)


    before(async function() {
        this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
        await startServersOnce()

        browser = await chromium.launch({ headless: true })
        let context = await browser.newContext()
        page = await context.newPage()

        // ensure screenshot directory exists
        let fs = await import('fs')
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true })
        }
    })


    after(async function() {
        if (browser) {
            await browser.close()
        }
    })


    it('1. should show registration link on login page', async function() {
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(5000)

        await page.screenshot({ path: `${screenshotDir}/01-login-page.png`, fullPage: true })

        let regLink = page.locator('text=Register')
        assert.strict.equal(await regLink.first().isVisible(), true, 'Register link should be visible')
    })


    it('2. should switch to registration form', async function() {
        await page.locator('text=Register').first().click()
        await page.waitForTimeout(500)

        await page.screenshot({ path: `${screenshotDir}/02-register-form.png`, fullPage: true })

        assert.strict.equal(await page.locator('text=Name').first().isVisible(), true)
        assert.strict.equal(await page.locator('text=Email').first().isVisible(), true)
        assert.strict.equal(await page.locator('text=Confirm password').first().isVisible(), true)
        assert.strict.equal(await page.locator('text=Submit').first().isVisible(), true)

        let inputCount = await page.locator('input').count()
        assert.strict.equal(inputCount, 5, `expected 5 inputs, got ${inputCount}`)
    })


    it('3. should switch back to login form', async function() {
        await page.locator('text=Back to login').first().click()
        await page.waitForTimeout(500)

        await page.screenshot({ path: `${screenshotDir}/03-back-to-login.png`, fullPage: true })

        assert.strict.equal(await page.locator('text=Log in').first().isVisible(), true)

        let inputCount = await page.locator('input').count()
        assert.strict.equal(inputCount, 2, `expected 2 inputs (login mode), got ${inputCount}`)
    })


    it('4. should register a new user successfully', async function() {

        let dialogMsg = ''
        let dialogHandler = async (dialog) => {
            dialogMsg = dialog.message()
            await dialog.accept()
        }
        page.on('dialog', dialogHandler)

        await page.locator('text=Register').first().click()
        await page.waitForTimeout(500)

        let inputs = page.locator('input')
        await inputs.nth(0).fill(testAccount)        // Account
        await inputs.nth(1).fill(testPassword)       // Password
        await inputs.nth(2).fill(testPassword)       // Confirm password
        await inputs.nth(3).fill(testName)            // Name
        await inputs.nth(4).fill(testEmail)           // Email
        await page.waitForTimeout(500)

        await page.screenshot({ path: `${screenshotDir}/04-register-filled.png`, fullPage: true })

        await page.locator('text=Submit').first().click()
        await page.waitForTimeout(5000)

        await page.screenshot({ path: `${screenshotDir}/04-register-result.png`, fullPage: true })

        page.removeListener('dialog', dialogHandler)

        let isSuccess = dialogMsg.includes('successful') || dialogMsg.includes('成功')
        assert.strict.equal(isSuccess, true, `expected success, got: "${dialogMsg}"`)
    })


    it('5. should fail to register duplicate account', async function() {

        let dialogMsg = ''
        let dialogHandler = async (dialog) => {
            dialogMsg = dialog.message()
            await dialog.accept()
        }
        page.on('dialog', dialogHandler)

        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(3000)
        await page.locator('text=Register').first().click()
        await page.waitForTimeout(500)

        let inputs = page.locator('input')
        await inputs.nth(0).fill(testAccount)        // Account
        await inputs.nth(1).fill(testPassword)       // Password
        await inputs.nth(2).fill(testPassword)       // Confirm password
        await inputs.nth(3).fill(testName)            // Name
        await inputs.nth(4).fill(`dup@test.com`)     // Email
        await page.waitForTimeout(500)

        await page.screenshot({ path: `${screenshotDir}/05-duplicate-filled.png`, fullPage: true })

        await page.locator('text=Submit').first().click()
        await page.waitForTimeout(5000)

        await page.screenshot({ path: `${screenshotDir}/05-duplicate-result.png`, fullPage: true })

        page.removeListener('dialog', dialogHandler)

        let isExists = dialogMsg.includes('already exists') || dialogMsg.includes('已存在')
        assert.strict.equal(isExists, true, `expected account exists, got: "${dialogMsg}"`)
    })


    it('6. should fail to login with unverified account', async function() {

        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(3000)

        let inputs = page.locator('input')
        await inputs.nth(0).fill(testAccount)
        await inputs.nth(1).fill(testPassword)
        await page.waitForTimeout(500)

        await page.screenshot({ path: `${screenshotDir}/06-login-unverified-filled.png`, fullPage: true })

        let dialogHandler = async (dialog) => {
            await dialog.accept()
        }
        page.on('dialog', dialogHandler)

        await page.locator('text=Log in').first().click()
        await page.waitForTimeout(5000)

        await page.screenshot({ path: `${screenshotDir}/06-login-unverified-result.png`, fullPage: true })

        page.removeListener('dialog', dialogHandler)

        // 未驗證帳號不應能登入，應顯示未驗證提示（不會有通用登入失敗的 dialog）
        // showResendVerify UI 會出現在頁面上
        let resendVisible = await page.locator('text=Resend verification email').first().isVisible().catch(() => false)
        assert.strict.equal(resendVisible, true, `should show resend verification UI for unverified account`)
    })


})
