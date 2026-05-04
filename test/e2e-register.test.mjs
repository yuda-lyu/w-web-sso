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


//
// E2E register test — 驗證使用者註冊與驗證信流程畫面（中英文版）
//
// 對應流程文件：z流程_使用者創建帳密.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-register.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-register.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/register/register-{lang}-{number}-{name}.png
//
// 注意：
// - 後端錯誤（如帳號/email 已存在、email 格式錯）以 window.alert 通知，
//   會被 Playwright dialog handler 自動 dismiss，無法 pixel 比對；
//   故 baseline 著重於前端可見的驗證狀態與 server-rendered 結果頁。
//

let baseUrl = 'http://localhost:8080'
let backendUrl = 'http://localhost:11007'
let salt = '{salt}'
let baselineDir = './test/pics/register'
let langs = ['eng', 'cht']

// 各語系 UI 文字（用於 Playwright 點擊）
let kpLangText = {
    eng: {
        registerLink: 'Register',          // userRegistration
        submit: 'Submit',                  // userRegistrationSubmit
    },
    cht: {
        registerLink: '申請帳號',
        submit: '送出申請',
    },
}


function bp(lang, name) {
    return path.join(baselineDir, `register-${lang}-${name}.png`)
}


// --- 測試使用者清單 ---
//
// 與本測試相關的所有 user 都用 'register-*' 開頭的 account 與 'id-register-*' 的 id，
// 方便 cleanup 時針對性清除，不影響其他測試
//

let verifyTokens = {
    success: {},  // lang → token
    already: {},  // lang → token
}

// 取得 lang 對應的「驗證成功」測試 user 物件（lang 包進去避免兩語系互相污染）
function makeVerifyOkUser(lang, tokenVerify) {
    let v = ds.users.funNew({
        order: 300,
        account: `register-verify-ok-${lang}`,
        password: hashPassword('Pw@reg9999', salt),
        name: 'Verify OK',
        email: `register-verify-ok-${lang}@test.com`,
        description: '',
        from: 'test',
        redir: '',
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    })
    v.id = `id-register-verify-ok-${lang}`
    v.tokenVerify = tokenVerify
    v.timeVerified = ''
    v.timeExpired = '2030-01-01T00:00:00.000+08:00'
    v.timeBlocked = ''
    return v
}

function makeVerifyAlreadyUser(lang, tokenVerify) {
    let v = ds.users.funNew({
        order: 301,
        account: `register-verify-already-${lang}`,
        password: hashPassword('Pw@reg9999', salt),
        name: 'Verify Already',
        email: `register-verify-already-${lang}@test.com`,
        description: '',
        from: 'test',
        redir: '',
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    })
    v.id = `id-register-verify-already-${lang}`
    v.tokenVerify = tokenVerify
    v.timeVerified = '2025-01-01T00:00:00.000+08:00'
    v.timeExpired = '2030-01-01T00:00:00.000+08:00'
    v.timeBlocked = ''
    return v
}


// --- 新增/刪除測試使用者 ---

async function insertVerifyTestUsers() {
    let users = []
    for (let lang of langs) {
        let tk1 = `${genIDSeq()}`
        let tk2 = `${genIDSeq()}`
        verifyTokens.success[lang] = tk1
        verifyTokens.already[lang] = tk2
        users.push(makeVerifyOkUser(lang, tk1))
        users.push(makeVerifyAlreadyUser(lang, tk2))
    }
    await woItems.users.insert(users)
    console.log(`inserted ${users.length} verify-test users`)
}

async function deleteAllRegisterTestUsers() {
    // 涵蓋本測試所有可能產生的 user
    let ids = []
    for (let lang of langs) {
        ids.push(`id-register-verify-ok-${lang}`)
        ids.push(`id-register-verify-already-${lang}`)
    }
    // 註冊成功流程產生的 user，account 為 qauser-{lang}，id 由 funNew 隨機產生，須以 account 刪除
    for (let id of ids) {
        await woItems.users.del({ id }).catch(() => {})
    }
    for (let lang of langs) {
        await woItems.users.del({ account: `qauser-${lang}` }).catch(() => {})
    }
    console.log(`deleted register test users`)
}


// --- 切換 UI 語系 ---

async function setLangViaUI(page, lang) {
    if (lang === 'eng') {
        return
    }
    await page.locator('text=English').first().click()
    await page.waitForTimeout(500)
    await page.locator('text=中文').first().click()
    await page.waitForTimeout(800)
}


// --- 進入 register 模式 ---

async function gotoRegisterMode(page, lang) {
    let t = kpLangText[lang]

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    // 點擊「申請帳號 / Register」連結進入 register 模式
    await page.locator(`text="${t.registerLink}"`).first().click()
    await page.waitForTimeout(800)
}


// --- 填入 register 表單 ---
//
// register 模式下 input 順序：account, password, regConfirmPassword, regName, regEmail
//
async function fillRegisterForm(page, opt = {}) {
    let inputs = page.locator('input')
    if (opt.account !== undefined) {
        await inputs.nth(0).fill(opt.account)
    }
    if (opt.password !== undefined) {
        await inputs.nth(1).fill(opt.password)
    }
    if (opt.confirmPassword !== undefined) {
        await inputs.nth(2).fill(opt.confirmPassword)
    }
    if (opt.name !== undefined) {
        await inputs.nth(3).fill(opt.name)
    }
    if (opt.email !== undefined) {
        await inputs.nth(4).fill(opt.email)
    }
    await page.waitForTimeout(500)
}


// --- 各情境截圖 helper ---

async function captureFormInitial(page, lang) {
    await gotoRegisterMode(page, lang)
    return await page.screenshot({ fullPage: true })
}

async function capturePwTooShort(page, lang) {
    await gotoRegisterMode(page, lang)
    // 6 字元短密碼，含字母+數字+特殊符號但長度 < 8
    await fillRegisterForm(page, { password: 'aB1@cd' })
    return await page.screenshot({ fullPage: true })
}

async function capturePwMismatch(page, lang) {
    await gotoRegisterMode(page, lang)
    await fillRegisterForm(page, {
        password: 'Pw@reg9999',
        confirmPassword: 'Pw@reg8888',
    })
    return await page.screenshot({ fullPage: true })
}

async function capturePwMultiErrors(page, lang) {
    await gotoRegisterMode(page, lang)
    // '12345' — 5 字元 + 全數字 + 在常見密碼黑名單內，會多項違反
    await fillRegisterForm(page, { password: '12345' })
    return await page.screenshot({ fullPage: true })
}

async function captureSuccess(page, lang) {
    let t = kpLangText[lang]
    await gotoRegisterMode(page, lang)
    // 帳號 'qauser-' 與密碼 'Pw@reg9999' 無 2 字元連續子字串交集，避開後端
    // noConsecutiveCharsFromAccount 策略（consecutiveCharsMinMatch:2）
    await fillRegisterForm(page, {
        account: `qauser-${lang}`,
        password: 'Pw@reg9999',
        confirmPassword: 'Pw@reg9999',
        name: 'New User',
        email: `qauser-${lang}@test.com`,
    })
    page.locator(`text="${t.submit}"`).first().click().catch(() => {})
    // 等 viewMode 由 register 切回 login（input 從 5 個降回 2 個）
    // 後端 srEmail.send() 在 SMTP 不通時會等網路 timeout (~30s)，故給 60s 寬限
    await page.waitForFunction(() => document.querySelectorAll('input').length <= 2, null, { timeout: 60000 })
    await page.waitForTimeout(1500) // 給 Vue re-render 穩定
    return await page.screenshot({ fullPage: true })
}

async function captureVerifyResult(page, lang, token) {
    let url = `${backendUrl}/api/verifyEmail?token=${token}&lang=${lang}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2000)
    return await page.screenshot({ fullPage: true })
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    // 001 form initial
    console.log('  001-form-initial')
    let buf1 = await captureFormInitial(page, lang)
    fs.writeFileSync(bp(lang, '001-form-initial'), buf1)

    // 002 pw too short
    console.log('  002-pw-too-short')
    let buf2 = await capturePwTooShort(page, lang)
    fs.writeFileSync(bp(lang, '002-pw-too-short'), buf2)

    // 003 pw mismatch
    console.log('  003-pw-mismatch')
    let buf3 = await capturePwMismatch(page, lang)
    fs.writeFileSync(bp(lang, '003-pw-mismatch'), buf3)

    // 004 pw multi errors
    console.log('  004-pw-multi-errors')
    let buf4 = await capturePwMultiErrors(page, lang)
    fs.writeFileSync(bp(lang, '004-pw-multi-errors'), buf4)

    // 005 success → form 清空回 login mode（先清掉前次殘留 user）
    console.log('  005-success')
    await woItems.users.del({ account: `qauser-${lang}` }).catch(() => {})
    let buf5 = await captureSuccess(page, lang)
    fs.writeFileSync(bp(lang, '005-success'), buf5)

    // 006 verify success（須先 reset verify users，因為 005 success 流程不影響 verify users，但保險起見）
    console.log('  006-verify-success')
    let buf6 = await captureVerifyResult(page, lang, verifyTokens.success[lang])
    fs.writeFileSync(bp(lang, '006-verify-success'), buf6)

    // 007 verify invalid
    console.log('  007-verify-invalid')
    let buf7 = await captureVerifyResult(page, lang, 'fake-token-not-in-db')
    fs.writeFileSync(bp(lang, '007-verify-invalid'), buf7)

    // 008 verify already
    console.log('  008-verify-already')
    let buf8 = await captureVerifyResult(page, lang, verifyTokens.already[lang])
    fs.writeFileSync(bp(lang, '008-verify-already'), buf8)
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    await deleteAllRegisterTestUsers()
    await insertVerifyTestUsers()

    let browser = await chromium.launch({ headless: true })
    let page = await browser.newPage()

    page.on('dialog', async (dialog) => {
        await dialog.accept()
    })

    for (let lang of langs) {
        await generateBaselineForLang(page, lang)
    }

    await browser.close()

    await deleteAllRegisterTestUsers()

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

        describe(`Register E2E [${lang}] — 註冊與驗證信流程`, function() {
            this.timeout(120000)

            before(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
                await startServersOnce()

                await deleteAllRegisterTestUsers()
                await insertVerifyTestUsers()

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
                await deleteAllRegisterTestUsers()
            })

            it('001-form-initial: 進入 register 模式，表單空白', async function() {
                let buf = await captureFormInitial(page, lang)
                let baselinePath = bp(lang, '001-form-initial')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-001-form-initial`)
            })

            it('002-pw-too-short: 密碼長度不足 → inline 紅字', async function() {
                let buf = await capturePwTooShort(page, lang)
                let baselinePath = bp(lang, '002-pw-too-short')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-002-pw-too-short`)
            })

            it('003-pw-mismatch: 密碼≠確認密碼 → inline 紅字', async function() {
                let buf = await capturePwMismatch(page, lang)
                let baselinePath = bp(lang, '003-pw-mismatch')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-003-pw-mismatch`)
            })

            it('004-pw-multi-errors: 密碼觸發多項策略違反 → 多條紅字', async function() {
                let buf = await capturePwMultiErrors(page, lang)
                let baselinePath = bp(lang, '004-pw-multi-errors')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-004-pw-multi-errors`)
            })

            it('005-success: 註冊成功 → form 清空回 login mode', async function() {
                await woItems.users.del({ account: `qauser-${lang}` }).catch(() => {})
                let buf = await captureSuccess(page, lang)
                let baselinePath = bp(lang, '005-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-005-success`)
            })

            it('006-verify-success: 驗證連結 token 正確 → server-rendered 成功頁', async function() {
                // 因 005 success 與 008 already 都不會影響此 user，但若多次跑 mocha test mode 會狀態髒；before 已 reset
                // 此 it 之後 user.timeVerified 會被寫入；下一輪 before 會重新 reset
                let buf = await captureVerifyResult(page, lang, verifyTokens.success[lang])
                let baselinePath = bp(lang, '006-verify-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-006-verify-success`)
            })

            it('007-verify-invalid: 驗證連結 token 無效 → server-rendered 失敗頁', async function() {
                let buf = await captureVerifyResult(page, lang, 'fake-token-not-in-db')
                let baselinePath = bp(lang, '007-verify-invalid')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-007-verify-invalid`)
            })

            it('008-verify-already: 驗證連結 token 已驗證 → server-rendered 已驗證頁', async function() {
                let buf = await captureVerifyResult(page, lang, verifyTokens.already[lang])
                let baselinePath = bp(lang, '008-verify-already')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-008-verify-already`)
            })

        })

    }

}
