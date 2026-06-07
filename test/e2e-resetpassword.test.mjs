import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, cleanup, captureStable, baseUrl, resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// E2E reset-password test — 驗證「後台重設使用者密碼」流程畫面（中英文版）
//
// 對應流程文件：spec/流程_後台重設使用者密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-resetpassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-resetpassword.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/resetpassword/resetpassword-{lang}-{number}-{name}.png
//
// 編號錨點: 對應 spec bullet 順序 (流程_後台重設使用者密碼.md). NNN 不重複, 新增 case 插末尾.
// 涵蓋情境:
//
// 一、管理員觸發 (admin UI + API)
//   - 001-admin-ui-modal-opened: 點 Reset password → CheckYesNo modal 開啟態 (baseline)
//   - 002-admin-ui-cancel-clean: 接 001 點 No → modal 關 + DB 不變 + 無 unhandled rejection (baseline)
//   - 003-admin-ui-success-alert: 點 Reset password → 點 Yes → success alert (baseline)
//   - 004-api-happy-path-side-effect: API 直呼成功, 驗 DB password 變 + isForceChangePw='y' + 回應無明文
//   - 006-admin-ui-self-reject-alert: admin 對自己列點 Reset password → 點 Yes → self-reject alert (baseline)
//   - 007-api-cannot-reset-self: API 直呼 admin 對自己 → reject
//   - 008-api-forbidden-non-admin: API 直呼非 admin → reject
//   - 009-api-user-not-found: API 直呼不存在 userId → reject
//   - 010-api-invalid-userId-empty: API 直呼空 userId → reject
//
// 二、使用者收信並登入
//   - 012-checkyes-prompt: 使用者用隨機密碼登入後彈 CheckYes (baseline) [原 001]
//   - 013-force-form-expanded: 按 OK 進 user view, 表單自動展開, cancel 按鈕隱藏 (baseline) [原 002]
//
// 三、使用者完成強制變更
//   - 015-after-success: 強制變更密碼成功後 isForceChangePw='n', 表單收回 (baseline) [原 003]
//
// 額外
//   - 022-force-redirect-to-user: isForceChangePw='y' 訪問 ?view=backstage 仍被拉回 user view (baseline)
//
// 未涵蓋 (留 gap, 後續階段補):
//   - 005 SMTP 失敗仍 success (一.2) / 011 email 內容驗證 (二.1) / 014 多裝置 token 不清 (二.5)
//   - 016 通知信寄出 (三.1) / 017-020 inline 錯誤 (三.2) / 021 logout-relogin (三.4)
//   - 023 genRandomPassword 規格 (四)
//

let salt = '{salt}'
let baselineDir = './test/pics/resetpassword'
let langs = ['eng', 'cht']

let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


//可選 --names <eng-001-checkyes-prompt,cht-002-force-form-expanded,...> 進行手術式 baseline 重產
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


function bp(lang, name) {
    return path.join(baselineDir, `resetpassword-${lang}-${name}.png`)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_後台重設使用者密碼.md + procLang.mjs 衍生, 非現狀指紋)
// ===================================================================

let expectedSpecText = {
    //=== 一、管理員觸發 (admin UI) ===
    'E2E-001-admin-ui-modal-opened': {
        //adminResetPasswordConfirm: 'Confirm to reset password for {account}?' / '確定對 {account} 重設密碼？'
        eng: { mode: 'text', value: 'Confirm to reset password for' },
        cht: { mode: 'text', value: '確定對' },
    },
    'E2E-002-admin-ui-cancel-clean': {
        //modal 已關 → 不應見「Confirm to reset password」/「確定對」
        eng: { mode: 'absentText', value: 'Confirm to reset password for' },
        cht: { mode: 'absentText', value: '確定對' },
    },
    'E2E-003-admin-ui-success-alert': {
        //adminResetPasswordSuccess: 'Password reset and new password sent to {email}' / '已重設並寄送新密碼至 {email}'
        eng: { mode: 'text', value: 'Password reset and new password sent to' },
        cht: { mode: 'text', value: '已重設並寄送新密碼至' },
    },
    'E2E-004-admin-ui-self-reject-alert': {
        //adminResetPasswordCannotResetSelf
        eng: { mode: 'text', value: 'Cannot reset your own password' },
        cht: { mode: 'text', value: '不可對自己重設密碼' },
    },

    //=== 二、使用者收信並登入 ===
    'E2E-005-checkyes-prompt': {
        //userForceChangePwPrompt
        eng: { mode: 'text', value: 'Your password has been reset by the administrator' },
        cht: { mode: 'text', value: '您的密碼已由管理員重設' },
    },
    'E2E-006-force-form-expanded': {
        //userChangePasswordOldPassword (force form 展開, 應見舊密碼欄 label)
        eng: { mode: 'text', value: 'Old password' },
        cht: { mode: 'text', value: '舊密碼' },
    },

    //=== 三、使用者完成強制變更 ===
    'E2E-007-after-success': {
        //表單收起, 應 *不見* 舊密碼欄 label
        eng: { mode: 'absentText', value: 'Old password' },
        cht: { mode: 'absentText', value: '舊密碼' },
    },

    //=== 三、強制變更 inline 錯誤 (017-020) ===
    'E2E-008-inline-error-old-password-empty': {
        eng: { mode: 'text', value: 'Please enter old password' },
        cht: { mode: 'text', value: '尚未給予舊密碼' },
    },
    'E2E-009-inline-error-new-not-match-confirm': {
        eng: { mode: 'text', value: 'New password and confirm password do not match' },
        cht: { mode: 'text', value: '新密碼與確認密碼不一致' },
    },
    'E2E-010-inline-error-new-not-meet-policy': {
        eng: { mode: 'text', value: 'Password length must be at least 8 characters' },
        cht: { mode: 'text', value: '密碼長度須大於等於8個字元' },
    },
    'E2E-011-inline-error-old-password-wrong': {
        eng: { mode: 'text', value: 'Password change failed' },
        cht: { mode: 'text', value: '密碼變更失敗' },
    },

    //=== 三、強制變更 logout-relogin (021) ===
    'E2E-012-logout-relogin-still-force': {
        //userForceChangePwPrompt (同 012, 因 logout 後重登仍見此 CheckYes)
        eng: { mode: 'text', value: 'Your password has been reset by the administrator' },
        cht: { mode: 'text', value: '您的密碼已由管理員重設' },
    },

    //=== 額外 ===
    'E2E-013-force-redirect-to-user': {
        //force form 展開, 應見舊密碼欄 label (同 013, 但驗點是「沒被 backstage 截走」)
        eng: { mode: 'text', value: 'Old password' },
        cht: { mode: 'text', value: '舊密碼' },
    },
}


async function collectVisibleText2(page) {
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

async function pageHasText2(page, text) {
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
        let found = await pageHasText2(page, e.value)
        if (!found) {
            let dump = await collectVisibleText2(page)
            assert.fail(`預期含 "${e.value}" (${name}), 實際: ${dump}`)
        }
    }
    else if (e.mode === 'absentText') {
        let stillHas = await pageHasText2(page, e.value)
        if (stillHas) {
            let dump = await collectVisibleText2(page)
            assert.fail(`預期不含 "${e.value}" (${name}), 但見到. 可見文字: ${dump}`)
        }
    }
}


//設計不變式：強制變更模式下的 user view 表單區應觸發 .sb 內捲軸
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
    assert.strict.notEqual(m, null, `${label}: .sb 元素不存在`)
    assert.strict.equal(/^(auto|scroll)$/.test(m.overflowY), true, `${label}: .sb overflow-y 應為 auto/scroll，實際 ${m.overflowY}`)
    assert.strict.equal(m.scroll > m.client, true, `${label}: .sb 應觸發捲軸（scroll=${m.scroll} client=${m.client}）`)
}

// --- 測試使用者清單 ---
//
// admin 觸發者 (rp-admin), 受重設者 (rp-target-{lang}), 非 admin 攻擊者 (rp-attacker)
// 各自的 token 由 insertTestUsersAndTokens 寫入 userTokens map
//

let testUsers = {
    admin: {
        id: 'id-rp-admin',
        account: 'rp-admin',
        rawPassword: 'Pw@rpadmin1',
        name: 'Reset Admin',
        email: 'rp-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
    targetEng: {
        id: 'id-rp-target-eng',
        account: 'rp-target-eng',
        //隨機 reset 後使用者收信用此 raw 密碼登入
        //(實際 e2e 跳過 admin 觸發, 直接 seed DB: password = hashPassword(simulatedRandomPw))
        rawPassword: 'Pw@RpRand9',
        name: 'Reset Target Eng',
        email: 'rp-target-eng@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
    targetCht: {
        id: 'id-rp-target-cht',
        account: 'rp-target-cht',
        rawPassword: 'Pw@RpRand9',
        name: 'Reset Target Cht',
        email: 'rp-target-cht@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
    attacker: {
        id: 'id-rp-attacker',
        account: 'rp-attacker',
        rawPassword: 'Pw@rpatk001',
        name: 'Reset Attacker',
        email: 'rp-attacker@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
}

//新使用者用作 modifyUserPassword 變更後的密碼
let chosenNewPassword = 'Pw@MyOwn88'

let userTokens = {}


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens), 再插入本檔專屬資料.
    //此函式為 mocha hook 與 generateBaseline 共用的 own-insert 單一入口, 放在最前一行即可
    //同時覆蓋兩條路徑 (per-test hermetic setup).
    await resetToBaseSeed()

    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 700 + k,
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

    //tokens (admin 與 attacker 各一; target 不需要預先 token)
    let tks = []
    userTokens = {}
    for (let key of ['admin', 'attacker']) {
        let u = testUsers[key]
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        userTokens[u.id] = t.token
        tks.push(t)
    }
    await woItems.tokens.insert(tks)

    console.log(`inserted ${rs.length} test users + ${tks.length} tokens`)
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含動態建立的使用者), 保留 base seed.
    await deleteNonBaseSeed()
    console.log('deleted reset-password test users + tokens')
}


//把目標 user 設為 isForceChangePw='y' + password=hashPassword(rawPassword, salt)
//模擬 admin 已經呼叫 adminResetUserPassword 將隨機密碼塞入
async function simulateAdminReset(targetUser) {
    await woItems.users.save({
        id: targetUser.id,
        password: hashPassword(targetUser.rawPassword, salt),
        isForceChangePw: 'y',
    })
}


// --- 各語系 UI 文字 ---

let kpLangText = {
    eng: {
        login: 'Log in',
        send: 'Send',
        changePassword: 'Change Password',
        ok: 'OK',
        cancel: 'Cancel',
        usersList: 'Users list',
        editMode: 'Edit mode',
        resetPassword: 'Reset password',
        yes: 'Yes',
        no: 'No',
        //confirmReset 含 {account} 後綴, 此處只比對前綴
        confirmReset: 'Confirm to reset password for',
        //resetSuccess 含 {email} 後綴, 此處只比對前綴
        resetSuccess: 'Password reset and new password sent to',
        resetCannotSelf: 'Cannot reset your own password',
    },
    cht: {
        login: '登入',
        send: '送出',
        changePassword: '變更密碼',
        ok: '確認',
        cancel: '取消',
        usersList: '使用者清單',
        editMode: '編輯模式',
        resetPassword: '重設密碼',
        yes: '確定',
        no: '取消',
        //confirmReset 含 {account} 後綴, 此處只比對前綴
        confirmReset: '確定對',
        //resetSuccess 含 {email} 後綴, 此處只比對前綴
        resetSuccess: '已重設並寄送新密碼至',
        resetCannotSelf: '不可對自己重設密碼',
    },
}


//設定語系（eng 為預設無動作; cht 走 UI 切換）
async function setLang(page, lang) {
    if (lang === 'eng') return
    await page.locator('text=English').first().click()
    await page.waitForTimeout(400)
    await page.locator('text=中文').first().click()
    await page.waitForTimeout(600)
}


//回到登入頁、清空 LS、設定語系
async function freshGoto(page, lang) {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)
    await setLang(page, lang)
}


// --- 截圖 helper ---
//
// 001-checkyes-prompt：以 raw 密碼登入後 CheckYes 仍顯示中（OK 未按）
// 002-force-form-expanded：按 OK 後進 user view, 表單已展開, cancel 已隱藏
// 003-after-success：填妥三欄成功變更後, 表單收回 (isForceChangePw='n')
//

//真實 user 輸入: click → focus → 清空 → keyboard.type
//(全域 CLAUDE.md §6.3: act 階段禁 .fill(), 必用 keyboard.type)
async function typeIntoInput(page, locator, value) {
    await locator.click()
    await page.waitForTimeout(50)
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.keyboard.type(value, { delay: 0 })
}

async function captureCheckYesPrompt(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //等 CheckYes 浮出（mUI login → updateViewState('user') → PageLogin .then 內 await showCheckYes）
    //showCheckYes 是 Vue dialog, 等 OK 按鈕出現後即可截圖
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(800)
    return await captureStable(page)
}

async function captureForceFormExpanded(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    //等表單展開（input[type=password] x3）
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)
    return await captureStable(page)
}

async function captureAfterSuccess(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(800)

    //填三欄: old=隨機密碼(target.rawPassword), new=chosen, confirm=chosen
    let pwInputs = page.locator('input[type="password"]')
    await typeIntoInput(page, pwInputs.nth(0), target.rawPassword)
    await typeIntoInput(page, pwInputs.nth(1), chosenNewPassword)
    await typeIntoInput(page, pwInputs.nth(2), chosenNewPassword)
    await page.waitForTimeout(300)

    //送出
    await page.locator(`text="${t.send}"`).first().click().catch(() => {})
    // 強制變更成功 → 持久 showCheckYes modal 顯示 userChangePasswordSuccess; 等其文字出現
    let needle = lang === 'eng' ? 'Password change successful' : '密碼變更成功'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 })
    await page.waitForTimeout(1000)
    return await captureStable(page)
}


//017-020: 共用 helper - 先到 force form 展開狀態, 再用 caller 指定 old/new/confirm 填入後送出,
//最後等指定錯誤訊息出現 + capture
async function captureForceFormInlineError(page, lang, target, oldPw, newPw, confirmPw, expectedErrorText) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(800)

    //填三欄
    let pwInputs = page.locator('input[type="password"]')
    if (oldPw !== null) {
        await typeIntoInput(page, pwInputs.nth(0), oldPw)
    }
    if (newPw !== null) {
        await typeIntoInput(page, pwInputs.nth(1), newPw)
    }
    if (confirmPw !== null) {
        await typeIntoInput(page, pwInputs.nth(2), confirmPw)
    }
    await page.waitForTimeout(300)

    //送出
    await page.locator(`text="${t.send}"`).first().click().catch(() => {})
    //等 inline 錯誤訊息出現
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), expectedErrorText, { timeout: 15000 })
    await page.waitForTimeout(1000)
    return await captureStable(page)
}


//021: 強制變更頁點 logout → 再以 raw 密碼登入 → 仍見 CheckYes (spec 三.4)
async function captureLogoutReloginStillForce(page, lang, target) {
    let t = kpLangText[lang]
    //先到 force form 展開狀態
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)

    //點 logout (force mode 下唯一允許的離開動作)
    let logoutText = lang === 'eng' ? 'Log out' : '登出'
    await page.locator(`text="${logoutText}"`).first().click()
    //等回到登入頁 (input 數 < 3, 且見到 login 按鈕)
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length < 3, null, { timeout: 15000 })
    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(2000)

    //以同樣 raw 密碼重登 (target 仍 isForceChangePw='y' 因尚未變更)
    let inputs2 = page.locator('input')
    await typeIntoInput(page, inputs2.nth(0), target.account)
    await typeIntoInput(page, inputs2.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //仍見 CheckYes 提示 (spec 三.4: 直到變更為止)
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(800)
    return await captureStable(page)
}


//inline 錯誤訊息對照 (從 procLang.mjs 衍生)
let kpInlineError = {
    eng: {
        oldEmpty: 'Please enter old password',
        notSame: 'New password and confirm password do not match',
        //weak pw "abc" → numLenMin error
        notMeetPolicy: 'Password length must be at least 8 characters',
        oldWrong: 'Password change failed',
    },
    cht: {
        oldEmpty: '尚未給予舊密碼',
        notSame: '新密碼與確認密碼不一致',
        notMeetPolicy: '密碼長度須大於等於8個字元',
        oldWrong: '密碼變更失敗',
    },
}


//022: force=y 訪問 ?view=backstage 仍被拉回 user view (force form 展開)
async function captureForceRedirectToUser(page, lang, target) {
    let t = kpLangText[lang]
    //URL 帶 ?lang=<lang> 後 SPA 會自動套語系, 不需再 setLang
    await page.goto(`${baseUrl}/?view=backstage&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${baseUrl}/?view=backstage&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)
    return await captureStable(page)
}


//=== admin-ui 共用 helper (multi-lang aware) ===

//admin-UI 截圖前 park mouse 到 (0,0) 並等 1.5s, 讓左側 WDrawer drag-bar 收斂到一致 (no-hover) 態
//(§6.3 殷鑑: 抽屜 bistability 的 canonical 修法), 再 captureStable.
async function captureAdminUiStable(page) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)
    return await captureStable(page)
}

let mdiPlus = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z'

async function adminLoginAndOpenUsersList(page, lang) {
    let t = kpLangText[lang]
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)
    await setLang(page, lang)

    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), testUsers.admin.account)
    await typeIntoInput(page, inputs.nth(1), testUsers.admin.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.waitForTimeout(4000)

    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(2500)

    //等 ag-grid 載入
    await page.waitForFunction(() => {
        return document.querySelectorAll('.ag-row').length >= 4
    }, null, { timeout: 15000 })
    await page.waitForTimeout(1000)

    //Reset password 按鈕僅在 Edit mode on 時可點 (mdiPlus path 只在 Edit on 時 toolbar 才出現).
    let editOn = await page.evaluate((d) => {
        let p = Array.from(document.querySelectorAll('svg path')).find(x => x.getAttribute('d') === d)
        if (!p) return false
        let btn = p.closest('div[tabindex]')
        return !!(btn && btn.offsetParent !== null)
    }, mdiPlus)
    if (!editOn) {
        await page.locator(`text="${t.editMode}"`).first().click()
        await page.waitForTimeout(800)
    }
}

async function clickResetPasswordOnRow(page, account, lang) {
    //找到指定 account 的 row, 點該 row 的 Reset password 按鈕 (WButtonChip → role="button")
    let info = await page.evaluate((acct) => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="account"]'))
        let accounts = cells.map(c => ({ row: c.closest('.ag-row').getAttribute('row-index'), account: (c.innerText || '').trim() }))
        let match = accounts.find(a => a.account === acct)
        return { accounts, match }
    }, account)
    assert.strict.notEqual(info.match, undefined, `account="${account}" row 找不到, 可見列: ${JSON.stringify(info.accounts)}`)
    let rowIdx = info.match.row

    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="password"]`
    await page.locator(cellSel).scrollIntoViewIfNeeded()
    //點 WButtonChip 的 [role="button"] 元素 (確保 @click handler 被觸發)
    let btn = page.locator(`${cellSel} [role="button"]`).first()
    await btn.waitFor({ state: 'visible', timeout: 5000 })
    await btn.click()
    //等 CheckYesNo modal 出現 (偵測 confirmReset 文字)
    let t = kpLangText[lang]
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), t.confirmReset, { timeout: 10000 })
    await page.waitForTimeout(1000)
}


// --- 產生標準圖模式 ---

//baseline gen 對齊 mocha 順序: fresh browser per describe block (admin-ui / user-flow 各一)
//(per CLAUDE.md §6.3 captureStable 規範: 「baseline 產製順序必須與 mocha 全跑順序一致」)

async function generateAdminUiBaselinesForLang(page, lang) {
    let target = lang === 'eng' ? testUsers.targetEng : testUsers.targetCht

    //=== 一、admin UI 流程 (001/002/003/006) ===
    //本函式 4 個 case 共用「同一個 admin 登入 session + Users list」連續鏈條:
    //  - adminLoginAndOpenUsersList 只跑一次 (此處), 之後 003/006 沿用同一 session
    //  - 001 開 modal → 002 點 No 關 modal (001/002 為一條連續開→關鏈, 不可拆開)
    //  - 003 再開 modal → 點 Yes; 006 對 admin 自己列再開 modal → 點 Yes
    //因此 navigate / login / modal 開關等「狀態推進」動作須無條件執行以維持序列;
    //僅 captureStable + writeBaseline 用 shouldGen 包起來 (--names 時跳過產圖但不破壞鏈條).
    console.log('  001-admin-ui-modal-opened + 002-admin-ui-cancel-clean')
    //確保 target 列存在且狀態固定
    await simulateAdminReset(target)
    await adminLoginAndOpenUsersList(page, lang)
    //在 target 列觸發 modal → screenshot (001) → 點 No → screenshot (002)
    await clickResetPasswordOnRow(page, target.account, lang)
    if (shouldGen(lang, 'E2E-001-admin-ui-modal-opened')) {
        let buf001 = await captureAdminUiStable(page)
        writeBaseline(lang, 'E2E-001-admin-ui-modal-opened', buf001)
    }
    await page.locator(`text="${kpLangText[lang].no}"`).first().click()
    await page.waitForTimeout(1500)
    if (shouldGen(lang, 'E2E-002-admin-ui-cancel-clean')) {
        let buf002 = await captureAdminUiStable(page)
        writeBaseline(lang, 'E2E-002-admin-ui-cancel-clean', buf002)
    }

    console.log('  003-admin-ui-success-alert')
    //再次 reset (上一步 cancel 沒改, 此處仍須確保 target 為已知狀態)
    await simulateAdminReset(target)
    //仍在 Users list (admin 未登出), 直接觸發 modal → 點 Yes → 等 success alert
    await clickResetPasswordOnRow(page, target.account, lang)
    await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
    //等 success modal (vo.$dg.showCheckYes -> CheckYes 對話框) 浮出: 偵測 resetSuccess 文字
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetSuccess, { timeout: 30000 })
    await page.waitForTimeout(1000)
    if (shouldGen(lang, 'E2E-003-admin-ui-success-alert')) {
        let buf003 = await captureAdminUiStable(page)
        writeBaseline(lang, 'E2E-003-admin-ui-success-alert', buf003)
    }
    //dismiss alert
    await page.locator(`text="${kpLangText[lang].ok}"`).first().click().catch(() => {})
    await page.waitForTimeout(800)

    console.log('  006-admin-ui-self-reject-alert')
    //對 admin 自己列觸發 → 點 Yes → reject alert
    await clickResetPasswordOnRow(page, testUsers.admin.account, lang)
    await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetCannotSelf, { timeout: 30000 })
    await page.waitForTimeout(1000)
    if (shouldGen(lang, 'E2E-004-admin-ui-self-reject-alert')) {
        let buf006 = await captureAdminUiStable(page)
        writeBaseline(lang, 'E2E-004-admin-ui-self-reject-alert', buf006)
    }
    //dismiss alert
    await page.locator(`text="${kpLangText[lang].ok}"`).first().click().catch(() => {})
    await page.waitForTimeout(800)

}


async function generateUserFlowBaselinesForLang(page, lang) {
    let target = lang === 'eng' ? testUsers.targetEng : testUsers.targetCht

    //=== 二、使用者收信並登入 (012/013) + 三、強制變更 (015) ===
    //每個 block 自含 setup: 先 simulateAdminReset(target) 重置 (admin-ui-success 已把 password 改為
    //隨機; 為使 user 能以已知 rawPassword 登入須重置), 再走 captureXxx (內含 freshGoto 全新登入).
    //各 block 互不依賴, 可獨立 guard.

    if (shouldGen(lang, 'E2E-005-checkyes-prompt')) {
        await simulateAdminReset(target)
        console.log('  012-checkyes-prompt')
        let buf012 = await captureCheckYesPrompt(page, lang, target)
        writeBaseline(lang, 'E2E-005-checkyes-prompt', buf012)
    }

    if (shouldGen(lang, 'E2E-006-force-form-expanded')) {
        await simulateAdminReset(target)
        console.log('  013-force-form-expanded')
        let buf013 = await captureForceFormExpanded(page, lang, target)
        writeBaseline(lang, 'E2E-006-force-form-expanded', buf013)
    }

    if (shouldGen(lang, 'E2E-007-after-success')) {
        await simulateAdminReset(target)
        console.log('  015-after-success')
        let buf015 = await captureAfterSuccess(page, lang, target)
        writeBaseline(lang, 'E2E-007-after-success', buf015)
        await page.locator(`text="${kpLangText[lang].ok}"`).first().click().catch(() => {})
        await page.waitForTimeout(500)
    }

    //=== 三、強制變更 inline 錯誤 (017/018/019/020) ===
    if (shouldGen(lang, 'E2E-008-inline-error-old-password-empty')) {
        await simulateAdminReset(target)
        console.log('  017-inline-error-old-password-empty')
        let buf017 = await captureForceFormInlineError(page, lang, target, '', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldEmpty)
        writeBaseline(lang, 'E2E-008-inline-error-old-password-empty', buf017)
    }

    if (shouldGen(lang, 'E2E-009-inline-error-new-not-match-confirm')) {
        await simulateAdminReset(target)
        console.log('  018-inline-error-new-not-match-confirm')
        let buf018 = await captureForceFormInlineError(page, lang, target, target.rawPassword, chosenNewPassword, `${chosenNewPassword}XX`, kpInlineError[lang].notSame)
        writeBaseline(lang, 'E2E-009-inline-error-new-not-match-confirm', buf018)
    }

    if (shouldGen(lang, 'E2E-010-inline-error-new-not-meet-policy')) {
        await simulateAdminReset(target)
        console.log('  019-inline-error-new-not-meet-policy')
        let buf019 = await captureForceFormInlineError(page, lang, target, target.rawPassword, 'abc', 'abc', kpInlineError[lang].notMeetPolicy)
        writeBaseline(lang, 'E2E-010-inline-error-new-not-meet-policy', buf019)
    }

    if (shouldGen(lang, 'E2E-011-inline-error-old-password-wrong')) {
        await simulateAdminReset(target)
        console.log('  020-inline-error-old-password-wrong')
        let buf020 = await captureForceFormInlineError(page, lang, target, 'Pw@WrongOld88', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldWrong)
        writeBaseline(lang, 'E2E-011-inline-error-old-password-wrong', buf020)
    }

    //=== 三、logout-relogin (021) ===
    if (shouldGen(lang, 'E2E-012-logout-relogin-still-force')) {
        await simulateAdminReset(target)
        console.log('  021-logout-relogin-still-force')
        let buf021 = await captureLogoutReloginStillForce(page, lang, target)
        writeBaseline(lang, 'E2E-012-logout-relogin-still-force', buf021)
    }

    //=== 022 force-redirect-to-user ===
    if (shouldGen(lang, 'E2E-013-force-redirect-to-user')) {
        await simulateAdminReset(target)
        console.log('  022-force-redirect-to-user')
        let buf022 = await captureForceRedirectToUser(page, lang, target)
        writeBaseline(lang, 'E2E-013-force-redirect-to-user', buf022)
    }
}


//產製單一 phase 的 baselines (在自己的 fresh browser 內), 對齊 mocha 各 describe block 的 browser 邊界
async function runPhaseInFreshBrowser(lang, phaseLabel, phaseFn) {
    console.log(`=== 產生標準圖（${lang}）— ${phaseLabel} (fresh browser) ===`)
    let browser = await chromium.launch({ headless: true })
    let context = await browser.newContext()
    let page = await context.newPage()
    page.on('dialog', async (dialog) => {
        await dialog.accept()
    })
    try {
        await phaseFn(page, lang)
    }
    finally {
        await browser.close()
    }
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    await deleteTestUsersAndTokens()
    await insertTestUsersAndTokens()

    //對齊 mocha 順序: [eng] Admin UI → [eng] User flow → [cht] Admin UI → [cht] User flow
    //每個 phase 都 fresh browser (對齊 mocha describe-level browser 隔離)
    for (let lang of langs) {
        await runPhaseInFreshBrowser(lang, 'Admin UI (001/002/003/006)', generateAdminUiBaselinesForLang)
        await runPhaseInFreshBrowser(lang, 'User flow (012-022)', generateUserFlowBaselinesForLang)
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

    //=== baseline 比對 helper (內含: 檔存在 / byte-equal / spec 語意斷言) ===
    async function verifyBaseline(page, lang, name, buf, skipSpec = false) {
        if (!skipSpec) {
            await assertSpecForCase(page, lang, name)
        }
        let baselinePath = bp(lang, name)
        assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
        let baselineBuf = fs.readFileSync(baselinePath)
        //debug: assertion 前先存 test capture, 確保 fail 時有證據可 diff
        if (!fs.existsSync('./tmp')) fs.mkdirSync('./tmp', { recursive: true })
        fs.writeFileSync(`./tmp/resetpassword-${lang}-${name}-test.png`, buf)
        assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: resetpassword-${lang}-${name}`)
    }

    for (let lang of langs) {

        let browser
        let page
        let target = lang === 'eng' ? testUsers.targetEng : testUsers.targetCht

        //=== Admin UI 觸發鏈條 (001/002/003/006): admin 真實點擊 Reset password 按鈕 + CheckYesNo ===
        describe(`ResetPassword E2E [${lang}] — Admin UI 觸發 (001/002/003/006)`, function() {
            this.timeout(180000)

            before(async function() {
                this.timeout(180000)
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

            it('001-admin-ui-modal-opened: 點 Reset password → CheckYesNo modal 開啟態', async function() {
                await simulateAdminReset(target)
                await adminLoginAndOpenUsersList(page, lang)
                await clickResetPasswordOnRow(page, target.account, lang)
                let buf = await captureAdminUiStable(page)
                await verifyBaseline(page, lang, 'E2E-001-admin-ui-modal-opened', buf)
                //dismiss modal 留給下一個 case 乾淨起點
                await page.locator(`text="${kpLangText[lang].no}"`).first().click()
                await page.waitForTimeout(1500)
            })

            it('002-admin-ui-cancel-clean: 接 001 點 No → modal 關 + DB 不變 + 無 unhandled rejection', async function() {
                //arm unhandled rejection capture
                await page.evaluate(() => {
                    window.__capturedErrors = []
                    window.addEventListener('unhandledrejection', e => window.__capturedErrors.push(String(e.reason)))
                })
                //記錄起點 DB state
                let beforeUs = await woItems.users.select({ id: target.id })
                let beforePw = beforeUs[0].password
                let beforeForce = beforeUs[0].isForceChangePw

                //再次開 modal → 點 No (本 case 自含開→關完整鏈)
                await clickResetPasswordOnRow(page, target.account, lang)
                await page.locator(`text="${kpLangText[lang].no}"`).first().click()
                await page.waitForTimeout(1500)

                let buf = await captureAdminUiStable(page)
                await verifyBaseline(page, lang, 'E2E-002-admin-ui-cancel-clean', buf)

                //無 unhandled rejection
                let errs = await page.evaluate(() => window.__capturedErrors || [])
                assert.strict.equal(errs.length, 0, `應無 unhandled rejection, 實際: ${JSON.stringify(errs)}`)

                //DB 不變
                let afterUs = await woItems.users.select({ id: target.id })
                assert.strict.equal(afterUs[0].password, beforePw, `Cancel 後 password 不應變動`)
                assert.strict.equal(afterUs[0].isForceChangePw, beforeForce, `Cancel 後 isForceChangePw 不應變動`)
            })

            it('003-admin-ui-success-alert: 點 Yes → success alert + DB password 變 + isForceChangePw=y', async function() {
                //起點: target isForceChangePw='n' (尚未被重設)
                await woItems.users.save({
                    id: target.id,
                    password: hashPassword(target.rawPassword, salt),
                    isForceChangePw: 'n',
                })
                let beforeUs = await woItems.users.select({ id: target.id })
                let beforePw = beforeUs[0].password

                await clickResetPasswordOnRow(page, target.account, lang)
                await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
                //等 success modal (vo.$dg.showCheckYes -> CheckYes 對話框)
                await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetSuccess, { timeout: 30000 })
                await page.waitForTimeout(1000)
                await assertSpecForCase(page, lang, 'E2E-003-admin-ui-success-alert')

                let buf = await captureAdminUiStable(page)
                await verifyBaseline(page, lang, 'E2E-003-admin-ui-success-alert', buf, true)

                //dismiss alert 留給下一個 case 乾淨起點
                await page.locator(`text="${kpLangText[lang].ok}"`).first().click().catch(() => {})
                await page.waitForTimeout(800)

                //DB password 變 + isForceChangePw=y
                let afterUs = await woItems.users.select({ id: target.id })
                assert.strict.equal(afterUs[0].isForceChangePw, 'y', `reset 後 isForceChangePw 應為 'y', 實際 ${afterUs[0].isForceChangePw}`)
                assert.strict.notEqual(afterUs[0].password, beforePw, `reset 後 password hash 應改變`)
                assert.strict.notEqual(afterUs[0].password, '', `reset 後 password 不應為空`)
            })

            it('006-admin-ui-self-reject-alert: admin 對自己列 → 點 Yes → self-reject alert + admin DB 不變', async function() {
                let beforeUs = await woItems.users.select({ id: testUsers.admin.id })
                let beforePw = beforeUs[0].password

                await clickResetPasswordOnRow(page, testUsers.admin.account, lang)
                await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
                await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetCannotSelf, { timeout: 30000 })
                await page.waitForTimeout(1000)
                await assertSpecForCase(page, lang, 'E2E-004-admin-ui-self-reject-alert')

                let buf = await captureAdminUiStable(page)
                await verifyBaseline(page, lang, 'E2E-004-admin-ui-self-reject-alert', buf, true)

                //dismiss alert
                await page.locator(`text="${kpLangText[lang].ok}"`).first().click().catch(() => {})
                await page.waitForTimeout(800)

                //admin 自己 password 不變 (self reject)
                let afterUs = await woItems.users.select({ id: testUsers.admin.id })
                assert.strict.equal(afterUs[0].password, beforePw, `self-reject 後 admin password 不應變`)
                assert.strict.notEqual(afterUs[0].isForceChangePw, 'y', `self-reject 後 admin isForceChangePw 不應為 'y'`)
            })

        })


        //=== User flow (012/013/015) + 022 force-redirect ===
        describe(`ResetPassword E2E [${lang}] — User 收信並登入 / 強制變更 (012/013/015/022)`, function() {
            this.timeout(120000)

            before(async function() {
                this.timeout(180000)
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

            it('012-checkyes-prompt: 使用者用隨機密碼登入 → 顯示 CheckYes 強制變更提示', async function() {
                await simulateAdminReset(target)
                let buf = await captureCheckYesPrompt(page, lang, target)
                await verifyBaseline(page, lang, 'E2E-005-checkyes-prompt', buf)
            })

            it('013-force-form-expanded: 按 OK 進 user view → 表單自動展開, cancel 隱藏', async function() {
                await simulateAdminReset(target)
                let buf = await captureForceFormExpanded(page, lang, target)
                await verifyBaseline(page, lang, 'E2E-006-force-form-expanded', buf)
                await assertSbOverflows(page, `resetpassword-${lang}-013-force-form-expanded`)

                //驗證 cancel 按鈕真的不存在 (force mode hide)
                let t = kpLangText[lang]
                let cancelCount = await page.locator(`text="${t.cancel}"`).count()
                assert.strict.equal(cancelCount, 0, `force mode 下 cancel 按鈕應隱藏，實際看見 ${cancelCount} 個`)
            })

            it('015-after-success: 強制變更密碼成功 → 表單收回 + isForceChangePw=n', async function() {
                await simulateAdminReset(target)
                let buf = await captureAfterSuccess(page, lang, target)
                await verifyBaseline(page, lang, 'E2E-007-after-success', buf)

                //驗證後端 DB 內 isForceChangePw 已清為 'n'
                let us = await woItems.users.select({ id: target.id })
                assert.strict.equal(us.length, 1, `target user 應存在`)
                assert.strict.equal(us[0].isForceChangePw, 'n', `變更成功後 isForceChangePw 應為 'n', 實際 ${us[0].isForceChangePw}`)

                //dismiss success modal
                let t = kpLangText[lang]
                await page.locator(`text="${t.ok}"`).first().click().catch(() => {})
                await page.waitForTimeout(500)
            })

            it('017-inline-error-old-password-empty: 強制變更頁 → 空舊密 → inline 紅字「請輸入舊密碼」', async function() {
                await simulateAdminReset(target)
                let buf = await captureForceFormInlineError(page, lang, target, '', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldEmpty)
                await verifyBaseline(page, lang, 'E2E-008-inline-error-old-password-empty', buf)
            })

            it('018-inline-error-new-not-match-confirm: 強制變更頁 → 新密 ≠ 確認 → inline 紅字「不一致」', async function() {
                await simulateAdminReset(target)
                let buf = await captureForceFormInlineError(page, lang, target, target.rawPassword, chosenNewPassword, `${chosenNewPassword}XX`, kpInlineError[lang].notSame)
                await verifyBaseline(page, lang, 'E2E-009-inline-error-new-not-match-confirm', buf)
            })

            it('019-inline-error-new-not-meet-policy: 強制變更頁 → 弱新密(過短) → inline 紅字「長度不足」', async function() {
                await simulateAdminReset(target)
                //"abc" 過短, 觸發 isUserPw numLenMin
                let buf = await captureForceFormInlineError(page, lang, target, target.rawPassword, 'abc', 'abc', kpInlineError[lang].notMeetPolicy)
                await verifyBaseline(page, lang, 'E2E-010-inline-error-new-not-meet-policy', buf)
            })

            it('020-inline-error-old-password-wrong: 強制變更頁 → 舊密錯 → inline 紅字「變更失敗」', async function() {
                await simulateAdminReset(target)
                //舊密填錯, 後端 changeUserPassword reject → 前端 chPwOldError='密碼變更失敗'
                let buf = await captureForceFormInlineError(page, lang, target, 'Pw@WrongOld88', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldWrong)
                await verifyBaseline(page, lang, 'E2E-011-inline-error-old-password-wrong', buf)
            })

            it('021-logout-relogin-still-force: 強制變更頁 → logout → 再以 raw 密碼登入 → 仍見 CheckYes', async function() {
                await simulateAdminReset(target)
                let buf = await captureLogoutReloginStillForce(page, lang, target)
                await verifyBaseline(page, lang, 'E2E-012-logout-relogin-still-force', buf)
            })

            it('022-force-redirect-to-user: isForceChangePw=y 訪問 ?view=backstage 仍被拉回 user view', async function() {
                await simulateAdminReset(target)
                let buf = await captureForceRedirectToUser(page, lang, target)
                await verifyBaseline(page, lang, 'E2E-013-force-redirect-to-user', buf)

                //已落到 user view 且 force-mode form 展開, 也代表 backstage 並未顯示
                let pwInputCount = await page.locator('input[type="password"]').count()
                assert.strict.equal(pwInputCount, 3, `應有 3 個 password input (force form 展開), 實際 ${pwInputCount}`)
                //backstage 才會出現的 nav 按鈕 (Users list) 不應存在
                let t = kpLangText[lang]
                let usersLinkCount = await page.locator(`text="${t.usersList}"`).count()
                assert.strict.equal(usersLinkCount, 0, `不應顯示 backstage 的 ${t.usersList} 連結, 實際 ${usersLinkCount}`)
            })

        })

    }


    //
    // API 契約 cases (004/005/007/008/009/010/011/014/016) 已遷至
    // test/api-resetpassword.test.mjs (Node + 無 browser).
    // 此檔僅保留需 Playwright + baseline 的 UI cases.
    //

}
