import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import map from 'lodash-es/map.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, cleanup, captureStable, baseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// E2E register test — 驗證使用者註冊與驗證信流程畫面（中英文版）
//
// 對應流程文件：spec/流程_使用者創建帳密.md
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

let backendUrl = apiUrl
let salt = '{salt}'
let baselineDir = './test/pics/register'
let langs = ['eng', 'cht']

// 各語系 UI 文字（用於 Playwright 點擊）
let kpLangText = {
    eng: {
        registerLink: 'Register',          // userRegistration
        submit: 'Submit',                  // userRegistrationSubmit
        login: 'Log in',
    },
    cht: {
        registerLink: '申請帳號',
        submit: '送出申請',
        login: '登入',
    },
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_使用者創建帳密.md + procLang.mjs 衍生, 非現狀指紋)
// 每張截圖必須含對應 i18n 鍵的文字; 不含 → 修系統或修 spec, 不改 baseline.
// ===================================================================

let expectedSpecText = {
    'E2E-001-form-initial': {
        //register 模式下表單應出現 submit 按鈕文字
        eng: { mode: 'text', value: 'Submit' },
        cht: { mode: 'text', value: '送出申請' },
    },
    'E2E-002-pw-too-short': {
        //userPassword_keyLimNumLenMin (minLength=8, settings.json)
        eng: { mode: 'text', value: 'Password length must be at least 8 characters' },
        cht: { mode: 'text', value: '密碼長度須大於等於8個字元' },
    },
    'E2E-003-pw-mismatch': {
        //userChangePasswordNotSame
        eng: { mode: 'text', value: 'New password and confirm password do not match' },
        cht: { mode: 'text', value: '新密碼與確認密碼不一致' },
    },
    'E2E-004-pw-multi-errors': {
        //'12345' 觸發 RequireLetter (純數字)
        eng: { mode: 'text', value: 'Password must contain at least one letter' },
        cht: { mode: 'text', value: '密碼須包含至少一個英文字母' },
    },
    'E2E-005-success': {
        //form 切回 login mode, 不應再見 submit 按鈕文字
        eng: { mode: 'absentText', value: 'Submit' },
        cht: { mode: 'absentText', value: '送出申請' },
    },
    'E2E-006-verify-success': {
        //userRegistrationVerifySuccess (server-rendered HTML)
        eng: { mode: 'text', value: 'Email verified successfully' },
        cht: { mode: 'text', value: '電子郵件驗證成功' },
    },
    'E2E-007-verify-invalid': {
        //verifyEmailInvalidToken
        eng: { mode: 'text', value: 'Invalid or expired verification link' },
        cht: { mode: 'text', value: '驗證連結無效或已失效' },
    },
    'E2E-008-verify-already': {
        //verifyEmailAlreadyVerified
        eng: { mode: 'text', value: 'This account has already been verified' },
        cht: { mode: 'text', value: '此帳號已完成驗證' },
    },
    'E2E-009-back-to-login': {
        //切回 login mode, 應見 Log in 按鈕, 不應見 register 的 Submit 按鈕
        eng: { mode: 'text', value: 'Log in' },
        cht: { mode: 'text', value: '登入' },
    },
    'E2E-010-account-empty': {
        //僅驗 form 仍在 register mode (Submit 按鈕還在, 因 account 空所以是灰態)
        eng: { mode: 'text', value: 'Submit' },
        cht: { mode: 'text', value: '送出申請' },
    },
    'E2E-011-password-empty': {
        eng: { mode: 'text', value: 'Submit' },
        cht: { mode: 'text', value: '送出申請' },
    },
    'E2E-012-email-empty': {
        eng: { mode: 'text', value: 'Submit' },
        cht: { mode: 'text', value: '送出申請' },
    },
    'E2E-013-name-empty': {
        eng: { mode: 'text', value: 'Submit' },
        cht: { mode: 'text', value: '送出申請' },
    },
    'E2E-020-resend-email-mismatch': {
        //userRegistrationResendInvalidEmail
        eng: { mode: 'text', value: 'The email address does not match the account' },
        cht: { mode: 'text', value: '電子郵件與帳號不符' },
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
    if (e.mode === 'text') {
        let found = await pageHasText(page, e.value)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期含 spec 文字 "${e.value}" (${name}), 實際: ${dump}`)
        }
    }
    else if (e.mode === 'absentText') {
        let stillHas = await pageHasText(page, e.value)
        if (stillHas) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期不含 "${e.value}" (${name}), 但仍見到. 可見文字: ${dump}`)
        }
    }
    else {
        throw new Error(`未知 mode: ${e.mode}`)
    }
}


// 可選 --names <eng-001-form-initial,cht-002-pw-too-short,...> 進行手術式 baseline 重產
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


// 設計不變式：register form 高度應觸發 .sb 內捲軸（Playwright headless 不渲染捲軸像素，
// 故無法靠 baseline 比對抓到「max-height/overflow 設計被破壞」的 regression）
async function assertSbOverflows(page, label) {
    let m = await page.evaluate(() => {
        let sb = document.querySelector('.sb')
        if (!sb) return null
        return {
            client: sb.clientHeight,
            scroll: sb.scrollHeight,
            overflowY: getComputedStyle(sb).overflowY,
        }
    })
    assert.strict.notEqual(m, null, `${label}: .sb 元素不存在（max-height/overflow 設計被破壞？）`)
    assert.strict.equal(/^(auto|scroll)$/.test(m.overflowY), true, `${label}: .sb overflow-y 應為 auto/scroll，實際 ${m.overflowY}`)
    assert.strict.equal(m.scroll > m.client, true, `${label}: .sb 應觸發捲軸（scroll=${m.scroll} client=${m.client}）`)
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
    //先重設為 base seed (清空 users/tokens/ips + 插入 3 canonical users + 4 tokens),
    //再插入本測試自己的 verify-test users. hermetic: 每次 setup 都從乾淨 base seed 起跳.
    //此函式為兩個 mocha beforeEach (主 describe + alert 拒絕 describe) 與 generateBaselineForLang
    //共用唯一進入點, 故置於首行覆蓋三條路徑.
    await resetToBaseSeed()
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
    await deleteNonBaseSeed()
    console.log(`deleted register test users`)
}


// 刪除特定 account 的 user（select 取 id 後以 id 刪，因 del by account 無效）
async function deleteUserByAccount(account) {
    let us = await woItems.users.select({ account }).catch(() => [])
    for (let u of us) {
        await woItems.users.del({ id: u.id }).catch(() => {})
    }
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
async function typeIntoInput(page, locator, value) {
    //真實 user 輸入: click → focus → 清空 → keyboard.type
    //(全域 CLAUDE.md §6.3: act 階段禁 .fill(), 必用 keyboard.type)
    await locator.click()
    await page.waitForTimeout(50)
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.keyboard.type(value, { delay: 0 })
}

async function fillRegisterForm(page, opt = {}) {
    let inputs = page.locator('input')
    if (opt.account !== undefined) {
        await typeIntoInput(page, inputs.nth(0), opt.account)
    }
    if (opt.password !== undefined) {
        await typeIntoInput(page, inputs.nth(1), opt.password)
    }
    if (opt.confirmPassword !== undefined) {
        await typeIntoInput(page, inputs.nth(2), opt.confirmPassword)
    }
    if (opt.name !== undefined) {
        await typeIntoInput(page, inputs.nth(3), opt.name)
    }
    if (opt.email !== undefined) {
        await typeIntoInput(page, inputs.nth(4), opt.email)
    }
    await page.waitForTimeout(500)
}


// --- 各情境截圖 helper ---

async function captureFormInitial(page, lang) {
    await gotoRegisterMode(page, lang)
    return await captureStable(page)
}

async function capturePwTooShort(page, lang) {
    await gotoRegisterMode(page, lang)
    // 6 字元短密碼，含字母+數字+特殊符號但長度 < 8
    await fillRegisterForm(page, { password: 'aB1@cd' })
    return await captureStable(page)
}

async function capturePwMismatch(page, lang) {
    await gotoRegisterMode(page, lang)
    await fillRegisterForm(page, {
        password: 'Pw@reg9999',
        confirmPassword: 'Pw@reg8888',
    })
    return await captureStable(page)
}

async function capturePwMultiErrors(page, lang) {
    await gotoRegisterMode(page, lang)
    // '12345' — 5 字元 + 全數字 + 在常見密碼黑名單內，會多項違反
    await fillRegisterForm(page, { password: '12345' })
    //等預期錯誤文字 (語意斷言目標) 浮出再截圖
    let expected = expectedSpecText['E2E-004-pw-multi-errors'][lang].value
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), expected, { timeout: 8000 })
    //鼠標移到角落 (避免 hover / cursor 殘留)
    await page.mouse.move(0, 0)
    return await captureStable(page)
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
    return await captureStable(page)
}

async function captureVerifyResult(page, lang, token) {
    let url = `${backendUrl}/api/verifyEmail?token=${token}&lang=${lang}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2000)
    return await captureStable(page)
}


//E2E-009: 點 Back to login link, viewMode 由 register 切回 login (5 input → 2 input)
async function captureBackToLogin(page, lang) {
    let backText = lang === 'eng' ? 'Back to login' : '返回登入'
    await gotoRegisterMode(page, lang)
    //先確認進入 register mode (5 inputs)
    await page.waitForFunction(() => document.querySelectorAll('input').length >= 5, null, { timeout: 8000 })
    //點 Back to login link
    await page.locator(`text="${backText}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input').length <= 2, null, { timeout: 8000 })
    await page.waitForTimeout(1500)
    return await captureStable(page)
}


//E2E-010~013: register form 缺少指定欄位, Submit 灰態無法提交
async function captureFieldEmpty(page, lang, emptyField) {
    await gotoRegisterMode(page, lang)
    let fill = {
        account: `qareg-${lang}`,
        password: 'Pw@RegFill123',
        confirmPassword: 'Pw@RegFill123',
        name: 'Reg Filler',
        email: `qareg-${lang}@test.com`,
    }
    delete fill[emptyField]
    await fillRegisterForm(page, fill)
    return await captureStable(page)
}


//E2E-020: 未驗證帳號 login → resend UI → 填錯 email → resendError inline
//預先 seed 未驗證 user, login → 切 resend mode → 填不符 email → reject + inline error
async function captureResendEmailMismatch(page, lang) {
    let t = kpLangText[lang]
    let resendLink = lang === 'eng' ? 'Resend verification email' : '重寄驗證信'
    let resendBtn = lang === 'eng' ? 'Send verification email' : '寄送驗證信'

    //預先插入未驗證 user (timeVerified='')
    let unverifiedAccount = `qareg-unverified-${lang}`
    let unverifiedEmail = `qareg-unverified-${lang}@test.com`
    let rawPw = 'Cd@9876bklm'
    await woItems.users.del({ id: `id-${unverifiedAccount}` }).catch(() => {})
    let u = ds.users.funNew({
        id: `id-${unverifiedAccount}`,
        order: 500,
        account: unverifiedAccount,
        password: hashPassword(rawPw, salt),
        name: 'Unverified User',
        email: unverifiedEmail,
        description: '',
        from: 'test',
        redir: '',
        isAdmin: 'n',
        timeVerified: '',  //未驗證
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
    u.id = `id-${unverifiedAccount}`
    u.timeVerified = ''
    await woItems.users.insert([u])

    //navigate to login + clear LS
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)
    await setLangViaUI(page, lang)

    //login with unverified account
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), unverifiedAccount)
    await typeIntoInput(page, inputs.nth(1), rawPw)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //等 resend UI 出現 (showResendVerify=true → "重寄驗證信" link)
    await page.waitForFunction((n) => (document.body.innerText || '').includes(n), resendLink, { timeout: 15000 })
    //點 "重寄驗證信" link → viewMode='resend'
    await page.locator(`text="${resendLink}"`).first().click()
    //等 resend form 出現 (Email input + "寄送驗證信" button)
    await page.waitForFunction((n) => (document.body.innerText || '').includes(n), resendBtn, { timeout: 8000 })
    await page.waitForTimeout(500)

    //填錯誤 email (不符 user 實際 email)
    let resendInputs = page.locator('input')
    let resendInputCount = await resendInputs.count()
    //在 resend mode 下應有 1 個 email input (前面 login 模式的 inputs 已被 resend template 取代)
    let emailInputIdx = resendInputCount - 1  //假設最後一個是 email
    await typeIntoInput(page, resendInputs.nth(emailInputIdx), `wrong-${lang}@notmatch.com`)
    await page.waitForTimeout(300)

    //點寄送按鈕
    await page.locator(`text="${resendBtn}"`).first().click()
    //等 resendError inline text 出現
    let errText = lang === 'eng' ? 'does not match' : '電子郵件與帳號不符'
    await page.waitForFunction((n) => (document.body.innerText || '').includes(n), errText, { timeout: 15000 })
    await page.waitForTimeout(500)
    return await captureStable(page)
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        { name: 'E2E-001-form-initial', fn: captureFormInitial },
        { name: 'E2E-002-pw-too-short', fn: capturePwTooShort },
        { name: 'E2E-003-pw-mismatch', fn: capturePwMismatch },
        { name: 'E2E-004-pw-multi-errors', fn: capturePwMultiErrors },
        {
            name: 'E2E-005-success',
            fn: captureSuccess,
            prep: async () => deleteUserByAccount(`qauser-${lang}`),
        },
        { name: 'E2E-006-verify-success', fn: (page, lang) => captureVerifyResult(page, lang, verifyTokens.success[lang]) },
        { name: 'E2E-007-verify-invalid', fn: (page, lang) => captureVerifyResult(page, lang, 'fake-token-not-in-db') },
        { name: 'E2E-008-verify-already', fn: (page, lang) => captureVerifyResult(page, lang, verifyTokens.already[lang]) },
        { name: 'E2E-009-back-to-login', fn: captureBackToLogin },
        { name: 'E2E-010-account-empty', fn: (page, lang) => captureFieldEmpty(page, lang, 'account') },
        { name: 'E2E-011-password-empty', fn: (page, lang) => captureFieldEmpty(page, lang, 'password') },
        { name: 'E2E-012-email-empty', fn: (page, lang) => captureFieldEmpty(page, lang, 'email') },
        { name: 'E2E-013-name-empty', fn: (page, lang) => captureFieldEmpty(page, lang, 'name') },
        { name: 'E2E-020-resend-email-mismatch', fn: captureResendEmailMismatch },
    ]

    for (let { name, fn, prep } of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)
        //per-case 重整 DB + fresh browser, 與 mocha beforeEach 一致, 避免 cold/warm
        //GPU/glyph atlas 差異導致跨模式 pixel drift (§6.3 截圖穩定性已知限制)
        await deleteAllRegisterTestUsers()
        await insertVerifyTestUsers()
        if (prep) await prep()

        let browser = await chromium.launch({ headless: true })
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        let buf = await fn(page, lang)
        writeBaseline(lang, name, buf)

        await browser.close()
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

    await deleteAllRegisterTestUsers()

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

        describe(`Register E2E [${lang}] — 註冊與驗證信流程`, function() {
            this.timeout(120000)

            //per-case 獨立: fresh browser + DB (對齊 e2e-adduser 標準)
            beforeEach(async function() {
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

            afterEach(async function() {
                if (browser) {
                    await browser.close()
                    browser = null
                }
                await deleteAllRegisterTestUsers()
            })

            it('E2E-001-form-initial: 進入 register 模式，表單空白', async function() {
                let buf = await captureFormInitial(page, lang)
                await assertSpecForCase(page, lang, 'E2E-001-form-initial')
                let baselinePath = bp(lang, 'E2E-001-form-initial')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-001-form-initial`)
                await assertSbOverflows(page, `register-${lang}-001-form-initial`)
            })

            it('E2E-002-pw-too-short: 密碼長度不足 → inline 紅字', async function() {
                let buf = await capturePwTooShort(page, lang)
                await assertSpecForCase(page, lang, 'E2E-002-pw-too-short')
                let baselinePath = bp(lang, 'E2E-002-pw-too-short')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-002-pw-too-short`)
                await assertSbOverflows(page, `register-${lang}-002-pw-too-short`)
            })

            it('E2E-003-pw-mismatch: 密碼≠確認密碼 → inline 紅字', async function() {
                let buf = await capturePwMismatch(page, lang)
                await assertSpecForCase(page, lang, 'E2E-003-pw-mismatch')
                let baselinePath = bp(lang, 'E2E-003-pw-mismatch')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-003-pw-mismatch`)
                await assertSbOverflows(page, `register-${lang}-003-pw-mismatch`)
            })

            it('E2E-004-pw-multi-errors: 密碼觸發多項策略違反 → 多條紅字', async function() {
                let buf = await capturePwMultiErrors(page, lang)
                await assertSpecForCase(page, lang, 'E2E-004-pw-multi-errors')
                let baselinePath = bp(lang, 'E2E-004-pw-multi-errors')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-004-pw-multi-errors`)
                await assertSbOverflows(page, `register-${lang}-004-pw-multi-errors`)
            })

            it('E2E-005-success: 註冊成功 → form 清空回 login mode', async function() {
                await deleteUserByAccount(`qauser-${lang}`)
                let buf = await captureSuccess(page, lang)
                await assertSpecForCase(page, lang, 'E2E-005-success')
                let baselinePath = bp(lang, 'E2E-005-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-005-success`)
            })

            it('E2E-006-verify-success: 驗證連結 token 正確 → server-rendered 成功頁', async function() {
                let buf = await captureVerifyResult(page, lang, verifyTokens.success[lang])
                await assertSpecForCase(page, lang, 'E2E-006-verify-success')
                let baselinePath = bp(lang, 'E2E-006-verify-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-006-verify-success`)
            })

            it('E2E-007-verify-invalid: 驗證連結 token 無效 → server-rendered 失敗頁', async function() {
                let buf = await captureVerifyResult(page, lang, 'fake-token-not-in-db')
                await assertSpecForCase(page, lang, 'E2E-007-verify-invalid')
                let baselinePath = bp(lang, 'E2E-007-verify-invalid')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-007-verify-invalid`)
            })

            it('E2E-008-verify-already: 驗證連結 token 已驗證 → server-rendered 已驗證頁', async function() {
                let buf = await captureVerifyResult(page, lang, verifyTokens.already[lang])
                await assertSpecForCase(page, lang, 'E2E-008-verify-already')
                let baselinePath = bp(lang, 'E2E-008-verify-already')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-008-verify-already`)
            })

            it('E2E-009-back-to-login: 點 Back to login link → input 從 5 回到 2 (登入頁)', async function() {
                let buf = await captureBackToLogin(page, lang)
                await assertSpecForCase(page, lang, 'E2E-009-back-to-login')
                let baselinePath = bp(lang, 'E2E-009-back-to-login')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-009-back-to-login`)
                //驗證 input 數 = 2 (代表確實回到 login mode)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 2, `Back to login 後應有 2 個 input, 實際 ${inpCount}`)
            })

            it('E2E-010-account-empty: register 缺帳號 → Submit 灰態無法觸發', async function() {
                let buf = await captureFieldEmpty(page, lang, 'account')
                await assertSpecForCase(page, lang, 'E2E-010-account-empty')
                let baselinePath = bp(lang, 'E2E-010-account-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-010-account-empty`)
                //驗證 register form 仍有 5 input (未送出, viewMode 仍為 register)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `account 空 + Submit 灰態, form 仍應 5 input, 實際 ${inpCount}`)
            })

            it('E2E-011-password-empty: register 缺密碼 → Submit 灰態無法觸發', async function() {
                let buf = await captureFieldEmpty(page, lang, 'password')
                await assertSpecForCase(page, lang, 'E2E-011-password-empty')
                let baselinePath = bp(lang, 'E2E-011-password-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-011-password-empty`)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `password 空 + Submit 灰態, form 仍應 5 input, 實際 ${inpCount}`)
            })

            it('E2E-012-email-empty: register 缺 email → Submit 灰態無法觸發', async function() {
                let buf = await captureFieldEmpty(page, lang, 'email')
                await assertSpecForCase(page, lang, 'E2E-012-email-empty')
                let baselinePath = bp(lang, 'E2E-012-email-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-012-email-empty`)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `email 空 + Submit 灰態, form 仍應 5 input, 實際 ${inpCount}`)
            })

            it('E2E-013-name-empty: register 缺姓名 → Submit 灰態無法觸發', async function() {
                let buf = await captureFieldEmpty(page, lang, 'name')
                await assertSpecForCase(page, lang, 'E2E-013-name-empty')
                let baselinePath = bp(lang, 'E2E-013-name-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-013-name-empty`)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `name 空 + Submit 灰態, form 仍應 5 input, 實際 ${inpCount}`)
            })

            it('E2E-020-resend-email-mismatch: 未驗證 login → resend UI → 錯 email → resendError inline 紅字', async function() {
                let buf = await captureResendEmailMismatch(page, lang)
                await assertSpecForCase(page, lang, 'E2E-020-resend-email-mismatch')
                let baselinePath = bp(lang, 'E2E-020-resend-email-mismatch')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-020-resend-email-mismatch`)
            })

        })


        //E2E-014~016: backend reject 走 alert, 無法 pixel baseline. 改用 dialog text 斷言.
        //per-case 獨立 dialog capture; 不重用 lang 主 describe 的 dialog handler (那邊只 accept 不 capture).
        describe(`Register E2E [${lang}] — alert 拒絕情境 (E2E-014~016)`, function() {
            this.timeout(120000)

            let browser
            let page
            let capturedAlerts

            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()
                await deleteAllRegisterTestUsers()
                await insertVerifyTestUsers()

                browser = await chromium.launch({ headless: true })
                let context = await browser.newContext()
                page = await context.newPage()
                capturedAlerts = []
                page.on('dialog', async (dialog) => {
                    capturedAlerts.push(dialog.message())
                    await dialog.accept()
                })
            })

            afterEach(async function() {
                if (browser) {
                    await browser.close()
                    browser = null
                }
                await deleteAllRegisterTestUsers()
            })

            async function fillAndSubmit(opt) {
                let t = kpLangText[lang]
                await gotoRegisterMode(page, lang)
                await fillRegisterForm(page, opt)
                await page.locator(`text="${t.submit}"`).first().click().catch(() => {})
                //等 alert 出現 (capturedAlerts.length > 0)
                let start = Date.now()
                while (capturedAlerts.length === 0 && Date.now() - start < 60000) {
                    await page.waitForTimeout(200)
                }
            }

            it('E2E-014-email-format-invalid: email 格式不合 → alert 顯示對應錯誤', async function() {
                let badEmail = 'not-an-email-format'
                await fillAndSubmit({
                    account: `qareg-bad-email-${lang}`,
                    password: 'Pw@RegFill123',
                    confirmPassword: 'Pw@RegFill123',
                    name: 'Reg Filler',
                    email: badEmail,
                })
                assert.strict.equal(capturedAlerts.length >= 1, true, `應有 alert 出現, 實際 ${capturedAlerts.length}`)
                let msg = capturedAlerts.join(' | ')
                let expected = lang === 'eng' ? 'email' : '電子郵件'
                assert.strict.equal(msg.toLowerCase().includes('email') || msg.includes(expected), true,
                    `alert 應提示 email 相關錯誤, 實際: ${msg}`)
            })

            it('E2E-015-account-duplicate: 帳號已被註冊 → alert 顯示對應錯誤', async function() {
                //預先插入一個 user, 占用 account
                //note: account 用 'jb-oldusr-{lang}' 規避所有跟密碼字元的 2-char 重疊
                //(後端 checkUserPassword 在帳號唯一性檢查前, 密碼撞 noConsecutiveCharsFromAccount 會先 reject)
                let existAccount = `jb-oldusr-${lang}`
                let existEmail = `jb-oldusr-${lang}@test.com`
                await woItems.users.insert([
                    ds.users.funNew({
                        id: `id-${existAccount}`,
                        account: existAccount,
                        password: hashPassword('Cd@9876bklm', salt),
                        name: 'Exist User',
                        email: existEmail,
                        from: 'test',
                        timeVerified: '2025-01-01T00:00:00.000+08:00',
                        timeExpired: '2030-01-01T00:00:00.000+08:00',
                        timeBlocked: '',
                        isActive: 'y',
                    }),
                ])

                await fillAndSubmit({
                    account: existAccount,  //撞 account
                    password: 'Cd@9876bklm',
                    confirmPassword: 'Cd@9876bklm',
                    name: 'Reg Filler',
                    email: `jb-fresh-${lang}@test.com`,
                })
                assert.strict.equal(capturedAlerts.length >= 1, true, `應有 alert 出現, 實際 ${capturedAlerts.length}`)
                let msg = capturedAlerts.join(' | ')
                let expected = lang === 'eng' ? 'account' : '帳號'
                assert.strict.equal(msg.toLowerCase().includes('account') || msg.includes(expected), true,
                    `alert 應提示 account 相關錯誤 (重複), 實際: ${msg}`)
            })

            it('E2E-016-email-duplicate: email 已被註冊 → alert 顯示對應錯誤', async function() {
                let existAccount = `jb-mailusr-${lang}`
                let existEmail = `jb-mailusr-${lang}@test.com`
                await woItems.users.insert([
                    ds.users.funNew({
                        id: `id-${existAccount}`,
                        account: existAccount,
                        password: hashPassword('Cd@9876bklm', salt),
                        name: 'Exist User',
                        email: existEmail,
                        from: 'test',
                        timeVerified: '2025-01-01T00:00:00.000+08:00',
                        timeExpired: '2030-01-01T00:00:00.000+08:00',
                        timeBlocked: '',
                        isActive: 'y',
                    }),
                ])

                await fillAndSubmit({
                    account: `jb-newusr-${lang}`,
                    password: 'Cd@9876bklm',
                    confirmPassword: 'Cd@9876bklm',
                    name: 'Reg Filler',
                    email: existEmail,  //撞 email
                })
                assert.strict.equal(capturedAlerts.length >= 1, true, `應有 alert 出現, 實際 ${capturedAlerts.length}`)
                let msg = capturedAlerts.join(' | ')
                let expected = lang === 'eng' ? 'email' : '電子郵件'
                assert.strict.equal(msg.toLowerCase().includes('email') || msg.includes(expected), true,
                    `alert 應提示 email 相關錯誤 (重複), 實際: ${msg}`)
            })

        })

    }

    //
    // (註: 原 viewMode / Back to login 獨立 describe 已合併至 lang loop 內 E2E-009-back-to-login,
    //  涵蓋 register → login 切換 + baseline pixel 比對 (兩語系各一份), 行為更完整.)
    //

}
