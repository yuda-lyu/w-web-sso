import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStableWithBox, assertBaselineMatch, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput } from './e2e-setup.mjs'


//
// E2E change password test — 驗證使用者變更密碼流程畫面（中英文版）
//
// 對應流程文件：spec/流程_使用者變更密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-changepassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-changepassword.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/changepassword/changepassword-{lang}-{number}-{name}.png
//
// 注意：
// - 變更密碼錯誤訊息已改為 inline 紅字（顯示於對應輸入框下方），可 pixel 比對
// - 變更成功通知使用 showCheckYes 持久 modal（WDialog），畫面卡在 modal 顯示狀態
//   直到使用者點確認；008 截圖框取 WDialog 內層 panel，modal 文字含「請使用新密碼重新登入」
//

let salt = '{salt}'
let baselineDir = './test/pics/changepassword'
let langs = ['eng', 'cht']

// 由 settings.json webKey 組成的 localStorage key
let webKey = 'ksso'
let lsKey = `${webKey}:userToken`

// 各語系 UI 文字
let kpLangText = {
    eng: {
        changePassword: 'Change Password',
        send: 'Send',
        cancel: 'Cancel',
    },
    cht: {
        changePassword: '變更密碼',
        send: '送出',
        cancel: '取消',
    },
}

// 測試 user 與 token 設定（每 lang 各一份避免互相污染）
// 帳號 'chpwuser-{lang}' 2-char substrings: ch,hp,pw,wu,us,se,er,r-,-e,en,ng / -c,ch,ht
// 密碼須與帳號無 2 字元連續子字串交集（後端 noConsecutiveCharsFromAccount 策略）
// 'Tk@246802' / 'Tk@975310' 2-char 完全不含 ch/hp/pw/wu/us/se/er/-e/-c/en/ch/ht/ng
let originalPassword = 'Tk@246802'
let newPassword = 'Tk@975310'
let userIdOf = (lang) => `id-changepassword-${lang}`
let accountOf = (lang) => `chpwuser-${lang}`

// 由 insertTestUserAndToken() 填入：lang → token 字串
let userTokens = {}


function bp(lang, name) {
    return path.join(baselineDir, `changepassword-${lang}-${name}.png`)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_使用者變更密碼.md + procLang.mjs 衍生, 非現狀指紋)
// ===================================================================

let expectedSpecText = {
    'E2E-001-form-initial': {
        //表單展開: 應見「送出」按鈕文字
        eng: { mode: 'text', value: 'Send' },
        cht: { mode: 'text', value: '送出' },
    },
    'E2E-002-old-empty': {
        //userChangePasswordForNoOldPassword
        eng: { mode: 'text', value: 'Please enter old password' },
        cht: { mode: 'text', value: '尚未給予舊密碼' },
    },
    'E2E-003-new-empty': {
        //userChangePasswordForNoNewPassword
        eng: { mode: 'text', value: 'Please enter new password' },
        cht: { mode: 'text', value: '尚未給予新密碼' },
    },
    'E2E-004-confirm-empty': {
        //userChangePasswordForNoConfirmPassword
        eng: { mode: 'text', value: 'Please enter confirm password' },
        cht: { mode: 'text', value: '尚未給予確認密碼' },
    },
    'E2E-005-pw-mismatch': {
        //userChangePasswordNotSame
        eng: { mode: 'text', value: 'New password and confirm password do not match' },
        cht: { mode: 'text', value: '新密碼與確認密碼不一致' },
    },
    'E2E-006-pw-policy-fail': {
        //'12345' 5 字元 → 後端 checkUserPassword 先回長度錯誤 (NumLenMin 優先於 RequireLetter)
        eng: { mode: 'text', value: 'Password length must be at least 8 characters' },
        cht: { mode: 'text', value: '密碼長度須大於等於8個字元' },
    },
    'E2E-007-old-wrong': {
        //userChangePasswordFail (統一訊息, 不洩露細節)
        eng: { mode: 'text', value: 'Password change failed' },
        cht: { mode: 'text', value: '密碼變更失敗' },
    },
    'E2E-008-success': {
        //成功後 showCheckYes modal 顯示變更成功訊息 (modal 持久, assert 安全)
        //完整文字來自 procLang.mjs userChangePasswordSuccess:
        //  eng: 'Password change successful, please log in again.'
        //  cht: '密碼變更成功，請使用新密碼重新登入。'
        eng: { mode: 'text', value: 'Password change successful, please log in again.' },
        cht: { mode: 'text', value: '密碼變更成功，請使用新密碼重新登入。' },
    },
    'E2E-009-network-error': {
        //userChangePasswordForNetError
        eng: { mode: 'text', value: 'Password validation failed' },
        cht: { mode: 'text', value: '密碼檢測失敗' },
    },
    'E2E-010-token-invalid': {
        //userChangePasswordFail (與 E2E-007 同訊息)
        eng: { mode: 'text', value: 'Password change failed' },
        cht: { mode: 'text', value: '密碼變更失敗' },
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
            assert.fail(`預期含 "${e.value}" (${name}), 實際: ${dump}`)
        }
    }
    else if (e.mode === 'absentText') {
        let stillHas = await pageHasText(page, e.value)
        if (stillHas) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期不含 "${e.value}" (${name}), 但見到. 可見文字: ${dump}`)
        }
    }
}


// 設計不變式：變更密碼表單展開時應觸發 .sb 內捲軸（Playwright headless 不渲染捲軸像素，
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


// 可選 --names <eng-001-form-initial,cht-008-success,...> 進行手術式 baseline 重產
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


// --- 新增/重置/刪除測試使用者與 token ---

async function insertTestUserAndToken(lang) {
    //先重設為 base seed (清空 users/tokens/ips + 插入 3 canonical users + 4 tokens),
    //再插入本測試自己的 user + token. hermetic: 每次 setup 都從乾淨 base seed 起跳.
    //此函式為 mocha beforeEach 與 generateBaselineForLang (含 008 前重插) 共用唯一進入點,
    //故置於首行覆蓋所有路徑. 下方既有的 per-lang del 保留 (resetToBaseSeed 已清, 但無害).
    await resetToBaseSeed()

    let userId = userIdOf(lang)
    let account = accountOf(lang)

    // clean (w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id)
    await woItems.users.del({ id: userId }).catch(() => {})
    let _tks = await woItems.tokens.select({ userId }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})

    // user
    let v = ds.users.funNew({
        order: 400,
        account,
        password: hashPassword(originalPassword, salt),
        name: 'ChangePw User',
        email: `${account}@test.com`,
        description: '',
        from: 'test',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
    })
    v.id = userId
    v.timeVerified = '2025-01-01T00:00:00.000+08:00'
    v.timeExpired = '2030-01-01T00:00:00.000+08:00'
    v.timeBlocked = ''
    await woItems.users.insert([v])

    // token
    let t = ds.tokens.funNew({ userId })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    await woItems.tokens.insert([t])

    userTokens[lang] = t.token
    console.log(`inserted user ${account} + token`)
}

async function deleteTestUsersAndTokens() {
    await deleteNonBaseSeed()
    console.log(`deleted changepassword test users + tokens`)
}


// --- 開啟 user view 並展開變更密碼表單 ---
//
// 步驟：
//   1. 先 navigate 到 baseUrl 設定 localStorage token
//   2. navigate 到 baseUrl/?view=user&lang=Y 觸發 autoLogin
//   3. autoLogin 成功後留在 user view（useRedir=false）
//   4. 點「變更密碼」按鈕展開表單
//
async function gotoUserViewAndOpenChangePw(page, lang) {
    let t = kpLangText[lang]

    // Step 1: 先到 baseUrl 設置 localStorage token
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(({ key, val }) => {
        localStorage.clear()
        localStorage.setItem(key, val)
    }, { key: lsKey, val: userTokens[lang] })

    // Step 2: 帶 lang 參數 navigate
    await page.goto(`${baseUrl}/?view=user&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(5000) // 等 autoLogin 完成

    // Step 3: 點「變更密碼」按鈕
    await page.locator(`text="${t.changePassword}"`).first().click()
    await page.waitForTimeout(800) // 等表單展開
}


// --- 填變更密碼表單 ---
//
// 表單展開後，input nth(0)=Account（user info，唯讀）、(1)=Email（user info）...
// Change Password 區塊內的 input 順序：oldPassword, newPassword, confirmPassword
// 由於 user info 區塊也有顯示型 input，需以表單區塊內的相對位置取值。
// 改用 input[type="password"]:not([disabled]) 取變更密碼三欄（其他 user info 欄位非 password type）。
//
//typeIntoInput 改用 e2e-setup.mjs 之 shared Pattern D 實作 (insertText + retry × 3, 防 Vue v-model 漏字 race)

async function fillChangePwForm(page, opt = {}) {
    // input[type="password"] 篩出三個密碼欄位（Old / New / Confirm）
    let pwInputs = page.locator('input[type="password"]')
    if (opt.oldPassword !== undefined) {
        await typeIntoInput(page, pwInputs.nth(0), opt.oldPassword)
    }
    if (opt.newPassword !== undefined) {
        await typeIntoInput(page, pwInputs.nth(1), opt.newPassword)
    }
    if (opt.confirmPassword !== undefined) {
        await typeIntoInput(page, pwInputs.nth(2), opt.confirmPassword)
    }
    await page.waitForTimeout(300)
}


async function clickSend(page, lang) {
    let t = kpLangText[lang]
    page.locator(`text="${t.send}"`).first().click().catch(() => {})
}


// --- 各情境截圖 helper ---

async function captureFormInitial(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    return await captureStableWithBox(page, '.sb')
}

async function captureOldEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    // E2E-002: 驗 chPwOldError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-002-old-empty'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureNewEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, { oldPassword: originalPassword })
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    // E2E-003: 驗 chPwNewError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-003-new-empty'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureConfirmEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
    })
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    // E2E-004: 驗 chPwConfirmError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-004-confirm-empty'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function capturePwMismatch(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
        confirmPassword: 'Tk@975999', // 與 newPassword 不同
    })
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    // E2E-005: 驗 chPwConfirmError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-005-pw-mismatch'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function capturePwPolicyFail(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    // '12345' — 5 字元 + 全數字 + 在常見密碼黑名單內，會多項違反
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword: '12345',
        confirmPassword: '12345',
    })
    await clickSend(page, lang)
    await page.waitForTimeout(2500) // 後端 checkUserPassword API call
    // E2E-006: 驗 chPwNewError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-006-pw-policy-fail'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureOldWrong(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: 'Tk@246999', // 故意錯誤的舊密碼（與真實 originalPassword 不同）
        newPassword,
        confirmPassword: newPassword,
    })
    await clickSend(page, lang)
    await page.waitForTimeout(3500) // 後端 checkUserPassword + changeUserPassword
    // E2E-007: 驗 chPwOldError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-007-old-wrong'][lang].value
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureSuccess(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
        confirmPassword: newPassword,
    })
    await clickSend(page, lang)
    // 成功 → 持久 showCheckYes modal (System message) 顯示 userChangePasswordSuccess; 等其文字出現
    let needle = lang === 'eng' ? 'Password change successful, please log in again.' : '密碼變更成功，請使用新密碼重新登入。'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 })
    await page.waitForTimeout(1000)
    // E2E-008: 驗成功 modal → 框 WDialog 內層 panel (modal 框體, 非全螢幕 shield)
    return await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
}


//E2E-009: 模擬前端 checkUserPassword 網路錯誤
//用 page.route 攔截 /api/main POST 請求, 阻斷後端通訊
//→ checkUserPassword fapi reject (axios 網路錯誤) → chPwNewError 顯示「密碼檢測失敗」
async function captureNetworkError(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
        confirmPassword: newPassword,
    })
    //啟動 route 攔截 (此時表單已填妥, 之前的 fapi calls 都已完成)
    await page.route('**/api/main', (route) => route.abort('failed'))
    await clickSend(page, lang)
    //等 chPwNewError 訊息 (userChangePasswordForNetError) 出現
    let needle = lang === 'eng' ? 'Password validation failed' : '密碼檢測失敗'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 15000 })
    await page.waitForTimeout(500)
    // E2E-009: 驗 chPwNewError inline 紅字 → 框錯誤紅字本身
    let errText9 = expectedSpecText['E2E-009-network-error'][lang].value
    let buf = await captureStableWithBox(page, page.getByText(errText9, { exact: false }).first())
    await page.unroute('**/api/main')
    return buf
}


//E2E-010: 模擬 token 失效情境
//用 woItems.tokens.del 在 user 已登入後刪除其 token, 再送出 changePassword
//→ backend checkUserPassword 通過 (純函數性檢查, 不需 token) → changeUserPassword reject (invalid token)
//→ chPwOldError = '變更失敗' (與 E2E-007 視覺等同, 共用 baseline)
async function captureTokenInvalidated(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
        confirmPassword: newPassword,
    })
    //在 user 已登入 + form 已填妥之後, 從 DB 刪除該 user 的所有 token
    let userId = userIdOf(lang)
    let tks = await woItems.tokens.select({ userId }).catch(() => [])
    for (let tk of tks) await woItems.tokens.del({ id: tk.id }).catch(() => {})
    await clickSend(page, lang)
    //等 chPwOldError 訊息 (userChangePasswordFail) 出現
    let needle = lang === 'eng' ? 'Password change failed' : '密碼變更失敗'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 15000 })
    await page.waitForTimeout(500)
    // E2E-010: 驗 chPwOldError inline 紅字（與 E2E-007 同文字）→ 框錯誤紅字本身
    let errText10 = expectedSpecText['E2E-010-token-invalid'][lang].value
    return await captureStableWithBox(page, page.getByText(errText10, { exact: false }).first())
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    // 每個 lang 開頭重置 user（前一輪 008 success 會改 password）
    await insertTestUserAndToken(lang)

    if (shouldGen(lang, 'E2E-001-form-initial')) {
        console.log('  001-form-initial')
        let buf1 = await captureFormInitial(page, lang)
        writeBaseline(lang, 'E2E-001-form-initial', buf1)
    }

    if (shouldGen(lang, 'E2E-002-old-empty')) {
        console.log('  002-old-empty')
        let buf2 = await captureOldEmpty(page, lang)
        writeBaseline(lang, 'E2E-002-old-empty', buf2)
    }

    if (shouldGen(lang, 'E2E-003-new-empty')) {
        console.log('  003-new-empty')
        let buf3 = await captureNewEmpty(page, lang)
        writeBaseline(lang, 'E2E-003-new-empty', buf3)
    }

    if (shouldGen(lang, 'E2E-004-confirm-empty')) {
        console.log('  004-confirm-empty')
        let buf4 = await captureConfirmEmpty(page, lang)
        writeBaseline(lang, 'E2E-004-confirm-empty', buf4)
    }

    if (shouldGen(lang, 'E2E-005-pw-mismatch')) {
        console.log('  005-pw-mismatch')
        let buf5 = await capturePwMismatch(page, lang)
        writeBaseline(lang, 'E2E-005-pw-mismatch', buf5)
    }

    if (shouldGen(lang, 'E2E-006-pw-policy-fail')) {
        console.log('  006-pw-policy-fail')
        let buf6 = await capturePwPolicyFail(page, lang)
        writeBaseline(lang, 'E2E-006-pw-policy-fail', buf6)
    }

    if (shouldGen(lang, 'E2E-007-old-wrong')) {
        console.log('  007-old-wrong')
        let buf7 = await captureOldWrong(page, lang)
        writeBaseline(lang, 'E2E-007-old-wrong', buf7)
    }

    if (shouldGen(lang, 'E2E-009-network-error')) {
        console.log('  009-network-error')
        //009 用 route 攔截後端 API, 不影響 DB state
        let buf9 = await captureNetworkError(page, lang)
        writeBaseline(lang, 'E2E-009-network-error', buf9)
    }

    //010 token失效視覺等同 007 (chPwOldError = '變更失敗'), 不另存 baseline
    //(if需要視覺驗證, mocha case 內共用 E2E-007 baseline)

    // 008 會改 user.password；放最後執行避免影響其他情境
    if (shouldGen(lang, 'E2E-008-success')) {
        console.log('  008-success')
        //008 自含 setup: 重新插 user/token (確保 password 為已知 originalPassword), 再 capture
        await insertTestUserAndToken(lang)
        let buf8 = await captureSuccess(page, lang)
        writeBaseline(lang, 'E2E-008-success', buf8)
        let okText = lang === 'eng' ? 'OK' : '確認'
        await page.locator(`text="${okText}"`).first().click().catch(() => {})
        await page.waitForTimeout(500)
    }
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    //每個 lang 啟動 fresh browser, 與 mocha test mode 一致 (每個 describe 各自 launch browser).
    for (let lang of langs) {
        let browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        await generateBaselineForLang(page, lang)

        await browser.close()
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

        describe(`ChangePassword E2E [${lang}] — 變更密碼流程`, function() {
            this.timeout(120000)

            //per-case 獨立: fresh browser + DB (對齊 e2e-adduser 標準)
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()

                await insertTestUserAndToken(lang)

                browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
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

            it('E2E-001-form-initial: 點變更密碼，表單剛展開', async function() {
                let buf = await captureFormInitial(page, lang)
                let baselinePath = bp(lang, 'E2E-001-form-initial')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-001-form-initial`)
                await assertSpecForCase(page, lang, 'E2E-001-form-initial')
                await assertSbOverflows(page, `changepassword-${lang}-001-form-initial`)
            })

            it('E2E-002-old-empty: 三欄空送出 → 舊密碼下方紅字', async function() {
                let buf = await captureOldEmpty(page, lang)
                await assertSpecForCase(page, lang, 'E2E-002-old-empty')
                let baselinePath = bp(lang, 'E2E-002-old-empty')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-002-old-empty`)
                await assertSbOverflows(page, `changepassword-${lang}-002-old-empty`)
            })

            it('E2E-003-new-empty: 只填舊密碼送出 → 新密碼下方紅字', async function() {
                let buf = await captureNewEmpty(page, lang)
                await assertSpecForCase(page, lang, 'E2E-003-new-empty')
                let baselinePath = bp(lang, 'E2E-003-new-empty')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-003-new-empty`)
                await assertSbOverflows(page, `changepassword-${lang}-003-new-empty`)
            })

            it('E2E-004-confirm-empty: 填舊+新送出 → 確認密碼下方紅字', async function() {
                let buf = await captureConfirmEmpty(page, lang)
                await assertSpecForCase(page, lang, 'E2E-004-confirm-empty')
                let baselinePath = bp(lang, 'E2E-004-confirm-empty')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-004-confirm-empty`)
                await assertSbOverflows(page, `changepassword-${lang}-004-confirm-empty`)
            })

            it('E2E-005-pw-mismatch: 新密碼≠確認密碼 → 確認密碼下方紅字', async function() {
                let buf = await capturePwMismatch(page, lang)
                await assertSpecForCase(page, lang, 'E2E-005-pw-mismatch')
                let baselinePath = bp(lang, 'E2E-005-pw-mismatch')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-005-pw-mismatch`)
                await assertSbOverflows(page, `changepassword-${lang}-005-pw-mismatch`)
            })

            it('E2E-006-pw-policy-fail: 新密碼不符策略 → 新密碼下方紅字', async function() {
                let buf = await capturePwPolicyFail(page, lang)
                await assertSpecForCase(page, lang, 'E2E-006-pw-policy-fail')
                let baselinePath = bp(lang, 'E2E-006-pw-policy-fail')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-006-pw-policy-fail`)
                await assertSbOverflows(page, `changepassword-${lang}-006-pw-policy-fail`)
            })

            it('E2E-007-old-wrong: 舊密碼錯 → 舊密碼下方紅字「變更失敗」', async function() {
                let buf = await captureOldWrong(page, lang)
                await assertSpecForCase(page, lang, 'E2E-007-old-wrong')
                let baselinePath = bp(lang, 'E2E-007-old-wrong')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-007-old-wrong`)
                await assertSbOverflows(page, `changepassword-${lang}-007-old-wrong`)
            })

            it('E2E-009-network-error: 前端 checkUserPassword 網路錯誤 → 新密碼下方紅字', async function() {
                let buf = await captureNetworkError(page, lang)
                await assertSpecForCase(page, lang, 'E2E-009-network-error')
                let baselinePath = bp(lang, 'E2E-009-network-error')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-009-network-error`)
            })

            it('E2E-010-token-invalid: token 失效 (DB 中途刪除) → 舊密碼下方紅字「變更失敗」(共用 E2E-007 baseline)', async function() {
                let buf = await captureTokenInvalidated(page, lang)
                await assertSpecForCase(page, lang, 'E2E-010-token-invalid')
                //共用 E2E-007 baseline (視覺等同, chPwOldError = '變更失敗')
                let baselinePath = bp(lang, 'E2E-007-old-wrong')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-010-token-invalid`)
            })

            it('E2E-008-success: 三欄填妥+正確 → showCheckYes modal 顯示完整成功訊息', async function() {
                let buf = await captureSuccess(page, lang)
                await assertSpecForCase(page, lang, 'E2E-008-success')
                let baselinePath = bp(lang, 'E2E-008-success')
                assertBaselineMatch(buf, baselinePath, `changepassword-${lang}-008-success`)
                //dismiss success modal (點 OK) 留乾淨終態
                let okText = lang === 'eng' ? 'OK' : '確認'
                await page.locator(`text="${okText}"`).first().click().catch(() => {})
                await page.waitForTimeout(500)
            })

            //
            // 009-cancel case 已刪除 (spec/流程_使用者變更密碼.md 對應 bullet 已移除,
            // cancel 收起表單視為元件行為非流程契約).
            //

        })

    }

}
