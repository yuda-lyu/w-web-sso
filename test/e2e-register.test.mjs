import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import map from 'lodash-es/map.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, cleanup, captureStable, baseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed, genTempSettings, restartBackend, typeIntoInput } from './e2e-setup.mjs'


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
// - 後端錯誤（invalid email format / 帳號已存在 / email 已存在）已改為 PageLogin register()
//   的 inline 紅字 (reactive regError, 模板 v-if="viewMode==='register' && regError" 的 div),
//   viewMode 維持 register (5 inputs), 為穩定 DOM 視覺終態 → E2E-014~016 升級為完整 baseline E2E。
// - 註冊成功改用 vo.$dg.showCheckYes (= CheckYes modal 對話框, 持久顯示須點 OK 確認), 點 OK 後
//   form 清空回 login mode (viewMode='login', 5→2 inputs)。E2E-005 baseline 等 modal 確認後截穩定 login 表單。
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
        //成功後 showCheckYes modal 顯示註冊成功訊息 (modal 持久, assert 安全)
        eng: { mode: 'text', value: 'Registration successful' },
        cht: { mode: 'text', value: '帳號申請成功' },
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
    'E2E-014-email-format-invalid': {
        //後端 reject 'invalid email format' → register() 對應 $t('userRegistrationEmailFormatInvalid')
        //顯示於 inline regError 紅字 (viewMode 維持 register)
        eng: { mode: 'text', value: 'Please enter a valid email address.' },
        cht: { mode: 'text', value: '請輸入有效的電子郵件格式。' },
    },
    'E2E-015-account-duplicate': {
        //後端回傳已在地化的 userRegistrationAccountExists → 直接顯示為 inline regError 紅字
        eng: { mode: 'text', value: 'This account already exists.' },
        cht: { mode: 'text', value: '此帳號已存在。' },
    },
    'E2E-016-email-duplicate': {
        //後端回傳已在地化的 userRegistrationEmailExists → 直接顯示為 inline regError 紅字
        eng: { mode: 'text', value: 'This email already exists.' },
        cht: { mode: 'text', value: '此電子郵件已存在。' },
    },
    'E2E-017-registration-not-allowed': {
        //allowUserRegistration=false → 登入頁不顯示 Register link.
        //登入頁終態應見 Log in 按鈕, 不應見 Register / 申請帳號 link 文字.
        eng: { mode: 'absentText', value: 'Register' },
        cht: { mode: 'absentText', value: '申請帳號' },
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


//插入一個已驗證的既有 user 占用指定 account / email (供 E2E-015/016 構造唯一性衝突).
//id 用 'id-{account}' 以利 deleteNonBaseSeed cleanup (非 base seed account → 一併清除).
async function insertExistUser(account, email) {
    await woItems.users.del({ id: `id-${account}` }).catch(() => {})
    await woItems.users.insert([
        ds.users.funNew({
            id: `id-${account}`,
            account,
            password: hashPassword('Cd@9876bklm', salt),
            name: 'Exist User',
            email,
            from: 'test',
            timeVerified: '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        }),
    ])
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
//typeIntoInput 改用 e2e-setup.mjs 之 shared Pattern D 實作 (insertText + retry × 3, 防 Vue v-model 漏字 race)

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
    // 成功 → 持久 showCheckYes modal (System message) 顯示 userRegistrationSuccess; 等其文字出現
    let needle = lang === 'eng' ? 'Registration successful' : '帳號申請成功'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 })
    await page.waitForTimeout(1000)
    await page.mouse.move(0, 0)
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


//E2E-017: 系統不允許自助註冊 (settings.json allowUserRegistration=false).
//backend 須已以 allowUserRegistration=false 重啟 (由 describe before() 的 restartBackend 完成).
//fresh navigate 登入頁 → 前端 fetch webInfor 取得 allowUserRegistration=false →
//PageLogin computed allowUserRegistration=false → Register link 區塊 v-if 不成立 → link 不顯示.
//終態 = 純登入頁 (2 inputs), 無 Register / 申請帳號 link, 使用者無從進入 register mode.
async function captureRegistrationNotAllowed(page, lang) {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)
    //等 login form ready (2 inputs)
    await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, null, { timeout: 8000 })
    await page.waitForTimeout(500)
    await page.mouse.move(0, 0)
    return await captureStable(page)
}


//以 DOM 定位 Register / 申請帳號 link span, 回傳數量 (0 = 不顯示, link 被 v-if 隱藏).
//對應模板: <span @click="viewMode='register'">{{$t('userRegistration')}}</span> (PageLogin.vue ~245),
//僅在 viewMode==='login' && allowUserRegistration && !showResendVerify 時顯示.
async function countRegisterLink(page, linkText) {
    return await page.evaluate((t) => {
        let spans = Array.from(document.querySelectorAll('span'))
        let n = 0
        for (let s of spans) {
            if (s.children.length === 0 && (s.textContent || '').trim() === t) n++
        }
        return n
    }, linkText)
}


//E2E-014~016: 後端 reject → register() catch 設 inline regError 紅字 (viewMode 維持 register).
//走真實 UI: 進 register mode → 填表 → 點 Submit → 等 regError 紅字浮出 → 截穩定圖.
//opt 為 fillRegisterForm 參數; expectedKey 為 expectedSpecText 的 case 名 (用來等對應紅字文字浮出).
async function captureRegBackendError(page, lang, opt, expectedKey) {
    let t = kpLangText[lang]
    await gotoRegisterMode(page, lang)
    await fillRegisterForm(page, opt)
    await page.locator(`text="${t.submit}"`).first().click().catch(() => {})
    //等 inline regError 紅字浮出 (即 expectedSpecText 對應文字).
    //後端唯一性檢查須查全表, SMTP 不通的 invalid-email case 不會走到寄信 (格式檢查在前),
    //但仍給寬鬆 timeout 容納後端往返.
    let expected = expectedSpecText[expectedKey][lang].value
    await page.waitForFunction((tt) => (document.body.innerText || '').includes(tt), expected, { timeout: 30000 })
    //regError 顯示於 Submit 下方, 表單 5 欄在 720px viewport 下使卡片內部 (max-height + overflow-y:auto)
    //溢出捲動, 紅字被捲出卡片可視區 → 截圖看不到. fullPage 無效 (元素層級 overflow 裁切, 非頁面層級).
    //此處用與 getRegErrorText 完全相同的定位邏輯找到該 div, 捲入卡片可視區後再截穩定圖 (固定捲動位置).
    await page.evaluate(() => {
        let divs = Array.from(document.querySelectorAll('div'))
        for (let d of divs) {
            let st = getComputedStyle(d)
            let color = st.color.replace(/\s/g, '')
            //#c62828 = rgb(198,40,40)
            let isRedErr = color === 'rgb(198,40,40)'
            let isBold = (st.fontWeight === '500' || st.fontWeight === 'bold')
            if (isRedErr && isBold && d.children.length === 0) {
                let txt = (d.textContent || '').trim()
                if (txt) {
                    d.scrollIntoView({ block: 'center' })
                    return
                }
            }
        }
    })
    //鼠標移到角落避免 hover / cursor 殘留, 再截穩定圖
    await page.mouse.move(0, 0)
    await page.waitForTimeout(800)
    return await captureStable(page)
}


//以 DOM 結構定位 inline regError 紅字 div, 回傳其 textContent (找不到回 null).
//對應模板: <div ... v-if="viewMode==='register' && regError">{{regError}}</div> (PageLogin.vue ~210),
//該 div 顏色為 #c62828, 與 password 欄逐項紅字 (font-size:0.75rem) 不同 (font-size:0.85rem + font-weight:500).
async function getRegErrorText(page) {
    return await page.evaluate(() => {
        let divs = Array.from(document.querySelectorAll('div'))
        for (let d of divs) {
            //僅含文字 (無子元素 div), 顏色為紅字色, 且 font-weight 500 (regError div 特徵)
            let st = getComputedStyle(d)
            let color = st.color.replace(/\s/g, '')
            //#c62828 = rgb(198,40,40)
            let isRedErr = color === 'rgb(198,40,40)'
            let isBold = (st.fontWeight === '500' || st.fontWeight === 'bold')
            if (isRedErr && isBold && d.children.length === 0) {
                let txt = (d.textContent || '').trim()
                if (txt) return txt
            }
        }
        return null
    })
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
        {
            name: 'E2E-014-email-format-invalid',
            fn: (page, lang) => captureRegBackendError(page, lang, {
                account: `qareg-bad-email-${lang}`,
                password: 'Pw@RegFill123',
                confirmPassword: 'Pw@RegFill123',
                name: 'Reg Filler',
                email: 'not-an-email-format',
            }, 'E2E-014-email-format-invalid'),
        },
        {
            name: 'E2E-015-account-duplicate',
            //account 用 'jb-oldusr-{lang}' 規避與密碼字元的 2-char 重疊
            //(後端 checkUserPassword 在帳號唯一性檢查前, 密碼撞 noConsecutiveCharsFromAccount 會先 reject)
            prep: async () => insertExistUser(`jb-oldusr-${lang}`, `jb-oldusr-${lang}@test.com`),
            fn: (page, lang) => captureRegBackendError(page, lang, {
                account: `jb-oldusr-${lang}`,  //撞 account
                password: 'Cd@9876bklm',
                confirmPassword: 'Cd@9876bklm',
                name: 'Reg Filler',
                email: `jb-fresh-${lang}@test.com`,
            }, 'E2E-015-account-duplicate'),
        },
        {
            name: 'E2E-016-email-duplicate',
            prep: async () => insertExistUser(`jb-mailusr-${lang}`, `jb-mailusr-${lang}@test.com`),
            fn: (page, lang) => captureRegBackendError(page, lang, {
                account: `jb-newusr-${lang}`,
                password: 'Cd@9876bklm',
                confirmPassword: 'Cd@9876bklm',
                name: 'Reg Filler',
                email: `jb-mailusr-${lang}@test.com`,  //撞 email
            }, 'E2E-016-email-duplicate'),
        },
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

        if (name === 'E2E-005-success') {
            //captureSuccess 留下持久 showCheckYes modal, 截完後點 OK 收掉 (不影響 fresh-per-case browser, 但保持對稱)
            let okText = lang === 'eng' ? 'OK' : '確認'
            await page.locator(`text="${okText}"`).first().click().catch(() => {})
            await page.waitForTimeout(500)
        }

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

    //E2E-017: 須以 allowUserRegistration=false 重啟 backend 才能截 (登入頁無 Register link).
    //與其他 case 分開, 因須改動共享 backend; 產完務必還原預設 backend (finally).
    if (shouldGen('eng', 'E2E-017-registration-not-allowed') || shouldGen('cht', 'E2E-017-registration-not-allowed')) {
        console.log('=== 產生標準圖（E2E-017, allowUserRegistration=false）===')
        try {
            await restartBackend(genTempSettings({ allowUserRegistration: false }))
            for (let lang of langs) {
                if (!shouldGen(lang, 'E2E-017-registration-not-allowed')) continue
                console.log(`  E2E-017-registration-not-allowed (${lang})`)
                let browser = await chromium.launch({ headless: true })
                let context = await browser.newContext()
                let page = await context.newPage()
                page.on('dialog', async (dialog) => { await dialog.accept() })
                let buf = await captureRegistrationNotAllowed(page, lang)
                writeBaseline(lang, 'E2E-017-registration-not-allowed', buf)
                await browser.close()
            }
        }
        finally {
            await restartBackend('./settings.json')
        }
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
                let okText = lang === 'eng' ? 'OK' : '確認'
                await page.locator(`text="${okText}"`).first().click().catch(() => {})
                await page.waitForTimeout(500)
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

            it('E2E-014-email-format-invalid: email 格式不合 → 後端 reject → inline regError 紅字', async function() {
                let buf = await captureRegBackendError(page, lang, {
                    account: `qareg-bad-email-${lang}`,
                    password: 'Pw@RegFill123',
                    confirmPassword: 'Pw@RegFill123',
                    name: 'Reg Filler',
                    email: 'not-an-email-format',
                }, 'E2E-014-email-format-invalid')
                //語意: inline regError div 含 userRegistrationEmailFormatInvalid 文字
                await assertSpecForCase(page, lang, 'E2E-014-email-format-invalid')
                let regErr = await getRegErrorText(page)
                let expected = expectedSpecText['E2E-014-email-format-invalid'][lang].value
                assert.strict.notEqual(regErr, null, `應出現 inline regError 紅字 div, 實際找不到`)
                assert.strict.equal(regErr.includes(expected), true, `regError 應含 "${expected}", 實際 "${regErr}"`)
                //viewMode 維持 register (5 inputs, 未送出成功)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `後端 reject 後 form 仍應為 register mode (5 input), 實際 ${inpCount}`)
                //pixel baseline
                let baselinePath = bp(lang, 'E2E-014-email-format-invalid')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-E2E-014-email-format-invalid`)
            })

            it('E2E-015-account-duplicate: 帳號已被註冊 → 後端 reject → inline regError 紅字', async function() {
                await insertExistUser(`jb-oldusr-${lang}`, `jb-oldusr-${lang}@test.com`)
                let buf = await captureRegBackendError(page, lang, {
                    account: `jb-oldusr-${lang}`,  //撞 account
                    password: 'Cd@9876bklm',
                    confirmPassword: 'Cd@9876bklm',
                    name: 'Reg Filler',
                    email: `jb-fresh-${lang}@test.com`,
                }, 'E2E-015-account-duplicate')
                await assertSpecForCase(page, lang, 'E2E-015-account-duplicate')
                let regErr = await getRegErrorText(page)
                let expected = expectedSpecText['E2E-015-account-duplicate'][lang].value
                assert.strict.notEqual(regErr, null, `應出現 inline regError 紅字 div, 實際找不到`)
                assert.strict.equal(regErr.includes(expected), true, `regError 應含 "${expected}", 實際 "${regErr}"`)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `後端 reject 後 form 仍應為 register mode (5 input), 實際 ${inpCount}`)
                let baselinePath = bp(lang, 'E2E-015-account-duplicate')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-E2E-015-account-duplicate`)
            })

            it('E2E-016-email-duplicate: email 已被註冊 → 後端 reject → inline regError 紅字', async function() {
                await insertExistUser(`jb-mailusr-${lang}`, `jb-mailusr-${lang}@test.com`)
                let buf = await captureRegBackendError(page, lang, {
                    account: `jb-newusr-${lang}`,
                    password: 'Cd@9876bklm',
                    confirmPassword: 'Cd@9876bklm',
                    name: 'Reg Filler',
                    email: `jb-mailusr-${lang}@test.com`,  //撞 email
                }, 'E2E-016-email-duplicate')
                await assertSpecForCase(page, lang, 'E2E-016-email-duplicate')
                let regErr = await getRegErrorText(page)
                let expected = expectedSpecText['E2E-016-email-duplicate'][lang].value
                assert.strict.notEqual(regErr, null, `應出現 inline regError 紅字 div, 實際找不到`)
                assert.strict.equal(regErr.includes(expected), true, `regError 應含 "${expected}", 實際 "${regErr}"`)
                let inpCount = await page.locator('input').count()
                assert.strict.equal(inpCount, 5, `後端 reject 後 form 仍應為 register mode (5 input), 實際 ${inpCount}`)
                let baselinePath = bp(lang, 'E2E-016-email-duplicate')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-E2E-016-email-duplicate`)
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

    }

    //
    // (註: 原 viewMode / Back to login 獨立 describe 已合併至 lang loop 內 E2E-009-back-to-login,
    //  涵蓋 register → login 切換 + baseline pixel 比對 (兩語系各一份), 行為更完整.)
    //

    //
    // E2E-017: 系統不允許自助註冊 (allowUserRegistration=false).
    // 獨立 describe — 因須以不同 settings 重啟「共享 backend」(port 11007).
    // before(): 以 allowUserRegistration=false 重啟 backend.
    // after(): 還原預設 backend (./settings.json). after() 必執行 (即使 it 失敗),
    //          確保不把「不允許註冊」的 backend 殘留給其他 test 檔.
    //
    describe('Register E2E — E2E-017 系統不允許自助註冊 (allowUserRegistration=false)', function() {
        this.timeout(120000)

        let browser017
        let page017

        before(async function() {
            this.timeout(60000)
            await startServersOnce()
            await restartBackend(genTempSettings({ allowUserRegistration: false }))
        })

        after(async function() {
            this.timeout(60000)
            //還原預設 backend, 即使前面 it 失敗也要還原 (after 永遠執行)
            await restartBackend('./settings.json')
        })

        afterEach(async function() {
            if (browser017) {
                await browser017.close()
                browser017 = null
            }
        })

        for (let lang of langs) {
            it(`E2E-017-registration-not-allowed [${lang}]: 不允許自助註冊 → 登入頁不顯示 Register link`, async function() {
                browser017 = await chromium.launch({ headless: true })
                let context = await browser017.newContext()
                page017 = await context.newPage()
                page017.on('dialog', async (dialog) => { await dialog.accept() })

                let buf = await captureRegistrationNotAllowed(page017, lang)

                //語意: Register / 申請帳號 link 不存在 (使用者無從進入 register mode)
                let linkText = kpLangText[lang].registerLink
                let nLink = await countRegisterLink(page017, linkText)
                assert.strict.equal(nLink, 0, `不允許註冊時, Register link "${linkText}" 應不存在, 實際出現 ${nLink} 個`)
                await assertSpecForCase(page017, lang, 'E2E-017-registration-not-allowed')
                //仍是純登入頁 (2 inputs, 無從進入 register mode)
                let inpCount = await page017.locator('input').count()
                assert.strict.equal(inpCount, 2, `登入頁應為 2 input, 實際 ${inpCount}`)

                //pixel baseline
                let baselinePath = bp(lang, 'E2E-017-registration-not-allowed')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: register-${lang}-E2E-017-registration-not-allowed`)
            })
        }

    })

}
