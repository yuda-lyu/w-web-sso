import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput, assertBaselineMatch, launchBrowser } from './tools/e2e-setup.mjs'
//產製端與比對端同一案例管線 (2026-09-28 起, 規格詳 w-package-tools-e2e 之 README.md §2.1-2.2)
import { runBaselineCase, createBaselineGate, assertTextSpec, gridContentBox } from './tools/e2eLib.mjs'


//
// E2E reset-password test — 驗證「後台重設使用者密碼」流程畫面（中英文版）
//
// 對應流程文件：spec/流程_後台重設使用者密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-resetpassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-resetpassword.test.mjs --timeout 120000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     階段圖鍵只寫該張 (如 eng-E2E-007-2-after-success), 案例鍵或編號前綴 (如 E2E-007-after-success、E2E-007) 寫該案全部階段,
//     不符任何鍵即報錯; --langs; --write-mode missing|changed; env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 fresh browser + DB 重置 (+ 案例前置) → 流程中每張截圖後當場語意斷言 → DB 不變式 → 寫檔 / 比對
//
// 標準圖存放：test/pics/resetpassword/resetpassword-{lang}-{number}-{name}.png
//
// 編號錨點: 對應 spec bullet 順序 (流程_後台重設使用者密碼.md). NNN 不重複, 新增 case 插末尾.
// 涵蓋情境 (本檔為需 Playwright + baseline 之 UI cases; API 契約 cases 已遷至 test/api-resetpassword.test.mjs):
//
// 一、管理員觸發 — admin UI:
//   - E2E-001-admin-ui-modal-opened: 點 Reset password → CheckYesNo modal 開啟態
//   - E2E-002-admin-ui-cancel-clean: 點 No → modal 關 + DB 不變 + 無 unhandled rejection
//   - E2E-003-admin-ui-success-alert: 點 Yes → success alert + DB password 變 + isForceChangePw='y'
//   - E2E-004-admin-ui-self-reject-alert: admin 對自己列 → 點 Yes → self-reject alert + admin DB 不變
//
// 二、使用者收信並登入:
//   - E2E-005-checkyes-prompt: 隨機密碼登入後彈 CheckYes 強制變更提示
//   - E2E-006-force-form-expanded: 按 OK 進 user view, 表單自動展開, cancel 隱藏
//
// 三、使用者完成強制變更:
//   - E2E-007: 強制變更成功 → 兩階段截圖：007-1 三欄填妥送出前（force form SEL_USER_CARD） + 007-2 成功 modal（SEL_MODAL）
//   - E2E-008~011: force 模式 inline 錯誤 (空舊密 / 新密≠確認 / 不符策略 / 舊密錯)
//   - E2E-012-logout-relogin-still-force: 強制變更頁 logout → 重登仍見 CheckYes
//
// 額外:
//   - E2E-013-force-redirect-to-user: isForceChangePw='y' 訪 ?view=backstage 仍被拉回 user view
//
// API 契約 (已遷至 test/api-resetpassword.test.mjs):
//   API-001 happy-path side-effect / API-002 SMTP 失敗仍 success / API-003 cannot-reset-self /
//   API-004 forbidden-non-admin / API-005 user-not-found / API-006 invalid-userId-empty /
//   API-007 email 內容模板 / API-008 多裝置 token 不清 / API-009 通知信模板
//
// 未涵蓋 (留 gap):
//   - genRandomPassword 規格驗證 (spec 四) — spec 明標留 gap, 建議走 unit test
//

let salt = '{salt}'
let baselineDir = './test/pics/resetpassword'
let langs = ['eng', 'cht']

// captureStableWithBox target selectors
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'  // WDialog 內層 panel（modal 框體, 非全螢幕 shield）
let SEL_GRID = '.ag-root-wrapper'                          // ag-grid 主體（Users list 後台清單; 紅框經 gridContentBox 取標頭＋可見資料列, 2026-09-28 改, 技能 §7.2 表格列）
let SEL_USER_CARD = '.sb'                                  // PageUser 表單卡捲動容器（含變更密碼表單 / inline 錯誤）

let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


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
    'E2E-007-1-force-form-filled': {
        //三欄填妥、送出前 — 舊密碼欄 label 應在（表單展開且已填寫）
        eng: { mode: 'text', value: 'Old password' },
        cht: { mode: 'text', value: '舊密碼' },
    },
    'E2E-007-2-after-success': {
        //成功 modal — 表單收起, 應 *不見* 舊密碼欄 label
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


//頁面文字之走訪與 text / absentText 斷言 (assertTextSpec) 取自 w-package-tools-e2e (原本檔內手寫 pageHasText2 / collectVisibleText2, 內容相同)
async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    await assertTextSpec(page, expected[lang], { label: name })
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
        isActive: 'Active', //procLang isActive: 使用者卡片最末列標籤 (spec E2E-006 驗證: 強制模式展開表單後末列完整可見)
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
        isActive: '帳號是否有效',
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

//typeIntoInput 改用 e2e-setup.mjs 之 shared Pattern D 實作 (insertText + retry × 3, 防 Vue v-model 漏字 race)

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
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(800)
    return await captureStableWithBox(page, SEL_MODAL)
}

async function captureForceFormExpanded(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.ok}"`).first().click()
    //等表單展開（input[type=password] x3）
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)

    //語意斷言 (spec E2E-006): 強制模式由 mounted 自動展開表單, 與按鈕展開走同一 clickChangePassword —— 展開後卡片最末列「帳號是否有效」須完整落在捲動容器 .sb 內
    //(部署方 2026-09-14 回報 1600×900 下末列只露出上半; 兩個展開入口皆驗, 見 e2e-changepassword 之 gotoUserViewAndOpenChangePw)
    let vis = await page.evaluate((lastText) => {
        let sb = document.querySelector('.sb')
        let sbr = sb.getBoundingClientRect()
        let lbl = [...document.querySelectorAll('div')].find((d) => d.childElementCount === 0 && d.textContent.trim() === lastText)
        let row = lbl && lbl.parentElement && lbl.parentElement.parentElement
        let rr = row ? row.getBoundingClientRect() : null
        return { found: !!rr, ok: !!(rr && rr.top >= sbr.top - 0.5 && rr.bottom <= sbr.bottom + 0.5), sb: { top: sbr.top, bottom: sbr.bottom, scrollTop: sb.scrollTop }, row: rr ? { top: rr.top, bottom: rr.bottom } : null }
    }, t.isActive)
    assert.ok(vis.found, `找不到最末列標籤「${t.isActive}」: ${JSON.stringify(vis)}`)
    assert.ok(vis.ok, `強制變更密碼表單展開後最末列「${t.isActive}」未完整落在捲動區內: ${JSON.stringify(vis)}`)

    return await captureStableWithBox(page, SEL_USER_CARD)
}

async function captureAfterSuccess(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), target.account)
    await typeIntoInput(page, inputs.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(800)

    //填三欄: old=隨機密碼(target.rawPassword), new=chosen, confirm=chosen
    let pwInputs = page.locator('input[type="password"]')
    await typeIntoInput(page, pwInputs.nth(0), target.rawPassword)
    await typeIntoInput(page, pwInputs.nth(1), chosenNewPassword)
    await typeIntoInput(page, pwInputs.nth(2), chosenNewPassword)
    await page.waitForTimeout(500)

    //stage1: 三欄填妥、送出前 — 截表單卡片區（SEL_USER_CARD）
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1000)
    let bufFormFilled = await captureStableWithBox(page, SEL_USER_CARD)
    //stage1 截圖後當場語意斷言 (表單仍展開: 舊密碼欄 label 在); 舊比對端因送出後才斷言、label 已消失而略過 (skipSpec), 2026-09-28 起於此時點執行
    await assertSpecForCase(page, lang, 'E2E-007-1-force-form-filled')

    //送出
    await page.locator(`text="${t.send}"`).first().click().catch(() => {})
    // 強制變更成功 → 持久 showCheckYes modal 顯示 userChangePasswordSuccess; 等其文字出現
    let needle = lang === 'eng' ? 'Password change successful' : '密碼變更成功'
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 })
    await page.waitForTimeout(1000)

    //stage2: 成功 modal
    let bufAfterSuccess = await captureStableWithBox(page, SEL_MODAL)
    //stage2 截圖後當場語意斷言 (成功 modal 持久, 表單已收起: 不見舊密碼欄 label)
    await assertSpecForCase(page, lang, 'E2E-007-2-after-success')

    return {
        'E2E-007-1-force-form-filled': bufFormFilled,
        'E2E-007-2-after-success': bufAfterSuccess,
    }
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
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
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
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), expectedErrorText, { timeout: 60000 }) //含伺服器檢核, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(1000)
    return await captureStableWithBox(page, SEL_USER_CARD)
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
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)

    //點 logout (force mode 下唯一允許的離開動作)
    let logoutText = lang === 'eng' ? 'Log out' : '登出'
    await page.locator(`text="${logoutText}"`).first().click()
    //等回到登入頁 (input 數 < 3, 且見到 login 按鈕)
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length < 3, null, { timeout: 60000 }) //含登出伺服器往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    await page.waitForTimeout(2000)

    //以同樣 raw 密碼重登 (target 仍 isForceChangePw='y' 因尚未變更)
    let inputs2 = page.locator('input')
    await typeIntoInput(page, inputs2.nth(0), target.account)
    await typeIntoInput(page, inputs2.nth(1), target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //仍見 CheckYes 提示 (spec 三.4: 直到變更為止)
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(800)
    return await captureStableWithBox(page, SEL_MODAL)
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
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含伺服器登入往返, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)
    return await captureStableWithBox(page, SEL_USER_CARD)
}


//=== admin-ui 共用 helper (multi-lang aware) ===

//admin-UI 截圖前 park mouse 到 (0,0) 並等 1.5s, 讓左側 WDrawer drag-bar 收斂到一致 (no-hover) 態
//(§6.3 殷鑑: 抽屜 bistability 的 canonical 修法), 再 captureStableWithBox 標注 target 區域.
//target: captureStableWithBox 之目標 (e.g. SEL_MODAL / gridContentBox(SEL_GRID)), 原樣傳給 captureStableWithBox 繪製紅框.
async function captureAdminUiStable(page, target) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)
    return await captureStableWithBox(page, target)
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

    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 60000 }) //含登入轉址, 偵測上限放寬(原 15 秒, 2026-09-28)
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(2500)

    //等 ag-grid 載入(getUsersList 伺服器往返; 偵測上限放寬, 原 15 秒, 2026-09-28)
    await page.waitForFunction(() => {
        return document.querySelectorAll('.ag-row').length >= 4
    }, null, { timeout: 60000 })
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


//每 case 前重置 DB 為乾淨 base seed + 本檔 testUsers/tokens (runCase 之 prepare; 產製端與比對端每案共用)
async function seedRp() {
    await deleteTestUsersAndTokens()
    await insertTestUsersAndTokens()
}


//受重設者依語系各一 (rp-target-eng / rp-target-cht)
function targetOf(lang) {
    return lang === 'eng' ? testUsers.targetEng : testUsers.targetCht
}


// ===================================================================
// 案例流程 (產製端與比對端共用; 截圖後當場對 spec 做語意斷言, 狀態仍在畫面上)
// admin UI 001-004: 取舊產製端流程 (標準圖由其產出), 併入舊比對端之斷言; DB 不變式於各案 verify (寫檔 / 比對之前)
// ===================================================================

//001: admin 點 Reset password → CheckYesNo modal 開啟態
async function runAdminModalOpened(page, lang, ctx) {
    await adminLoginAndOpenUsersList(page, lang)
    await clickResetPasswordOnRow(page, ctx.target.account, lang)
    let buf = await captureAdminUiStable(page, SEL_MODAL)
    await assertSpecForCase(page, lang, 'E2E-001-admin-ui-modal-opened')
    return { 'E2E-001-admin-ui-modal-opened': buf }
}

//002: 開 modal → 點 No → modal 關 (本 case 自含開→關完整鏈) + 無 unhandled rejection
async function runAdminCancelClean(page, lang, ctx) {
    await adminLoginAndOpenUsersList(page, lang)
    //arm unhandled rejection capture (nav 完成後才掛, 否則 goto 會清掉 listener); 舊比對端原有, 併入兩端 (只掛監聽, 無畫面效果)
    await page.evaluate(() => {
        window.__capturedErrors = []
        window.addEventListener('unhandledrejection', e => window.__capturedErrors.push(String(e.reason)))
    })
    await clickResetPasswordOnRow(page, ctx.target.account, lang)
    await page.locator(`text="${kpLangText[lang].no}"`).first().click()
    await page.waitForTimeout(1500)
    let buf = await captureAdminUiStable(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-002-admin-ui-cancel-clean')
    //無 unhandled rejection
    let errs = await page.evaluate(() => window.__capturedErrors || [])
    assert.strict.equal(errs.length, 0, `應無 unhandled rejection, 實際: ${JSON.stringify(errs)}`)
    return { 'E2E-002-admin-ui-cancel-clean': buf }
}

//003: 開 modal → 點 Yes → success alert (vo.$dg.showCheckYes, 持久待點確認)
async function runAdminSuccessAlert(page, lang, ctx) {
    await adminLoginAndOpenUsersList(page, lang)
    await clickResetPasswordOnRow(page, ctx.target.account, lang)
    await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
    //等 success modal (vo.$dg.showCheckYes -> CheckYes 對話框)
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetSuccess, { timeout: 30000 })
    await page.waitForTimeout(1000)
    let buf = await captureAdminUiStable(page, SEL_MODAL)
    //modal 持久: 截圖後當場斷言 (舊比對端在截圖前斷言, 舊產製端無斷言)
    await assertSpecForCase(page, lang, 'E2E-003-admin-ui-success-alert')
    return { 'E2E-003-admin-ui-success-alert': buf }
}

//004: admin 對自己列 → 點 Yes → self-reject alert (持久待點確認)
async function runAdminSelfRejectAlert(page, lang) {
    await adminLoginAndOpenUsersList(page, lang)
    await clickResetPasswordOnRow(page, testUsers.admin.account, lang)
    await page.locator(`text="${kpLangText[lang].yes}"`).first().click()
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), kpLangText[lang].resetCannotSelf, { timeout: 30000 })
    await page.waitForTimeout(1000)
    let buf = await captureAdminUiStable(page, SEL_MODAL)
    //modal 持久: 截圖後當場斷言 (舊比對端在截圖前斷言, 舊產製端無斷言)
    await assertSpecForCase(page, lang, 'E2E-004-admin-ui-self-reject-alert')
    return { 'E2E-004-admin-ui-self-reject-alert': buf }
}

//使用者流程之單張案例 (005/006/008-013): capture(page, lang, target) → 截圖後當場語意斷言 → 其餘畫面斷言 (checks) → { 圖鍵: buf }
function userShot(key, capture, checks = null) {
    return async (page, lang, ctx) => {
        let buf = await capture(page, lang, ctx.target)
        await assertSpecForCase(page, lang, key)
        if (checks) {
            await checks(page, lang)
        }
        return { [key]: buf }
    }
}

//006 之其餘畫面斷言 (舊比對端原有, 在比對之後): .sb 捲軸不變式 + 強制模式下 cancel 按鈕隱藏
async function checkForceFormExpanded(page, lang) {
    await assertSbOverflows(page, `resetpassword-${lang}-006-force-form-expanded`)
    //驗證 cancel 按鈕真的不存在 (force mode hide)
    let t = kpLangText[lang]
    let cancelCount = await page.locator(`text="${t.cancel}"`).count()
    assert.strict.equal(cancelCount, 0, `force mode 下 cancel 按鈕應隱藏，實際看見 ${cancelCount} 個`)
}

//013 之其餘畫面斷言 (舊比對端原有, 在比對之後): 已落到 user view 且 force-mode form 展開, 也代表 backstage 並未顯示
async function checkRedirectedToUser(page, lang) {
    let pwInputCount = await page.locator('input[type="password"]').count()
    assert.strict.equal(pwInputCount, 3, `應有 3 個 password input (force form 展開), 實際 ${pwInputCount}`)
    //backstage 才會出現的 nav 按鈕 (Users list) 不應存在
    let t = kpLangText[lang]
    let usersLinkCount = await page.locator(`text="${t.usersList}"`).count()
    assert.strict.equal(usersLinkCount, 0, `不應顯示 backstage 的 ${t.usersList} 連結, 實際 ${usersLinkCount}`)
}

//使用者流程 (005-013) 之案例前置: simulateAdminReset(target) 把 target 設成 force-change 狀態
//(此 trigger 之真 UI 已由 003-admin-ui-success 涵蓋; captureXxx 內含 freshGoto 全新登入)
async function setupForceChange(ctx) {
    await simulateAdminReset(ctx.target)
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//順序與 mocha it 相同 (每語系: admin UI 001-004 → 使用者流程 005-013; 產製順序 ≡ 比對順序); group 決定所屬之 mocha describe;
//title 為 mocha it 標題 (--grep 依之); stages 為該案產出之圖鍵 (與寫檔名、比對名一致);
//setup 為 seedRp 之後、開瀏覽器之前之案例前置 (可把起點 DB 狀態記入 ctx); verify 為 DB 不變式 (寫檔 / 比對之前)
let cases = [
    {
        name: 'E2E-001-admin-ui-modal-opened',
        group: 'admin',
        title: '001-admin-ui-modal-opened: 點 Reset password → CheckYesNo modal 開啟態',
        stages: ['E2E-001-admin-ui-modal-opened'],
        setup: async (ctx) => {
            await simulateAdminReset(ctx.target) //固定 target 列狀態
        },
        run: runAdminModalOpened,
    },
    {
        name: 'E2E-002-admin-ui-cancel-clean',
        group: 'admin',
        title: '002-admin-ui-cancel-clean: 開 modal → 點 No → modal 關 + DB 不變 + 無 unhandled rejection',
        stages: ['E2E-002-admin-ui-cancel-clean'],
        setup: async (ctx) => {
            await simulateAdminReset(ctx.target)
            //記錄起點 DB state (舊比對端於 admin 登入後讀取; admin 登入不改 target 之 password / isForceChangePw)
            let beforeUs = await woItems.users.select({ id: ctx.target.id })
            ctx.beforePw = beforeUs[0].password
            ctx.beforeForce = beforeUs[0].isForceChangePw
        },
        run: runAdminCancelClean,
        verify: async (ctx) => {
            //DB 不變
            let afterUs = await woItems.users.select({ id: ctx.target.id })
            assert.strict.equal(afterUs[0].password, ctx.beforePw, `Cancel 後 password 不應變動`)
            assert.strict.equal(afterUs[0].isForceChangePw, ctx.beforeForce, `Cancel 後 isForceChangePw 不應變動`)
        },
    },
    {
        name: 'E2E-003-admin-ui-success-alert',
        group: 'admin',
        title: '003-admin-ui-success-alert: 點 Yes → success alert + DB password 變 + isForceChangePw=y',
        stages: ['E2E-003-admin-ui-success-alert'],
        setup: async (ctx) => {
            //起點: target isForceChangePw='n' (尚未被重設)
            await woItems.users.save({ id: ctx.target.id, password: hashPassword(ctx.target.rawPassword, salt), isForceChangePw: 'n' })
            let beforeUs = await woItems.users.select({ id: ctx.target.id })
            ctx.beforePw = beforeUs[0].password
        },
        run: runAdminSuccessAlert,
        verify: async (ctx) => {
            //DB password 變 + isForceChangePw=y
            let afterUs = await woItems.users.select({ id: ctx.target.id })
            assert.strict.equal(afterUs[0].isForceChangePw, 'y', `reset 後 isForceChangePw 應為 'y', 實際 ${afterUs[0].isForceChangePw}`)
            assert.strict.notEqual(afterUs[0].password, ctx.beforePw, `reset 後 password hash 應改變`)
            assert.strict.notEqual(afterUs[0].password, '', `reset 後 password 不應為空`)
        },
    },
    {
        name: 'E2E-004-admin-ui-self-reject-alert',
        group: 'admin',
        title: '004-admin-ui-self-reject-alert: admin 對自己列 → 點 Yes → self-reject alert + admin DB 不變',
        stages: ['E2E-004-admin-ui-self-reject-alert'],
        setup: async (ctx) => {
            let beforeUs = await woItems.users.select({ id: testUsers.admin.id })
            ctx.beforePw = beforeUs[0].password
        },
        run: runAdminSelfRejectAlert,
        verify: async (ctx) => {
            //admin 自己 password 不變 (self reject)
            let afterUs = await woItems.users.select({ id: testUsers.admin.id })
            assert.strict.equal(afterUs[0].password, ctx.beforePw, `self-reject 後 admin password 不應變`)
            assert.strict.notEqual(afterUs[0].isForceChangePw, 'y', `self-reject 後 admin isForceChangePw 不應為 'y'`)
        },
    },
    {
        name: 'E2E-005-checkyes-prompt',
        group: 'user',
        title: '005-checkyes-prompt: 使用者用隨機密碼登入 → 顯示 CheckYes 強制變更提示',
        stages: ['E2E-005-checkyes-prompt'],
        setup: setupForceChange,
        run: userShot('E2E-005-checkyes-prompt', captureCheckYesPrompt),
    },
    {
        name: 'E2E-006-force-form-expanded',
        group: 'user',
        title: '006-force-form-expanded: 按 OK 進 user view → 表單自動展開, cancel 隱藏',
        stages: ['E2E-006-force-form-expanded'],
        setup: setupForceChange,
        run: userShot('E2E-006-force-form-expanded', captureForceFormExpanded, checkForceFormExpanded),
    },
    {
        //承接式兩階段 (同一 browser 內兩個截圖點, 各於截圖後當場語意斷言): 007-1 三欄填妥送出前 → 007-2 成功 modal
        name: 'E2E-007-after-success',
        group: 'user',
        title: '007-after-success: 強制變更密碼成功 → 表單收回 + isForceChangePw=n',
        stages: ['E2E-007-1-force-form-filled', 'E2E-007-2-after-success'],
        setup: setupForceChange,
        run: (page, lang, ctx) => captureAfterSuccess(page, lang, ctx.target),
        verify: async (ctx) => {
            //驗證後端 DB 內 isForceChangePw 已清為 'n'
            let us = await woItems.users.select({ id: ctx.target.id })
            assert.strict.equal(us.length, 1, `target user 應存在`)
            assert.strict.equal(us[0].isForceChangePw, 'n', `變更成功後 isForceChangePw 應為 'n', 實際 ${us[0].isForceChangePw}`)
        },
    },
    {
        name: 'E2E-008-inline-error-old-password-empty',
        group: 'user',
        title: '008-inline-error-old-password-empty: 強制變更頁 → 空舊密 → inline 紅字「請輸入舊密碼」',
        stages: ['E2E-008-inline-error-old-password-empty'],
        setup: setupForceChange,
        run: userShot('E2E-008-inline-error-old-password-empty', (page, lang, target) => captureForceFormInlineError(page, lang, target, '', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldEmpty)),
    },
    {
        name: 'E2E-009-inline-error-new-not-match-confirm',
        group: 'user',
        title: '009-inline-error-new-not-match-confirm: 強制變更頁 → 新密 ≠ 確認 → inline 紅字「不一致」',
        stages: ['E2E-009-inline-error-new-not-match-confirm'],
        setup: setupForceChange,
        run: userShot('E2E-009-inline-error-new-not-match-confirm', (page, lang, target) => captureForceFormInlineError(page, lang, target, target.rawPassword, chosenNewPassword, `${chosenNewPassword}XX`, kpInlineError[lang].notSame)),
    },
    {
        name: 'E2E-010-inline-error-new-not-meet-policy',
        group: 'user',
        title: '010-inline-error-new-not-meet-policy: 強制變更頁 → 弱新密(過短) → inline 紅字「長度不足」',
        stages: ['E2E-010-inline-error-new-not-meet-policy'],
        setup: setupForceChange,
        //"abc" 過短, 觸發 isUserPw numLenMin
        run: userShot('E2E-010-inline-error-new-not-meet-policy', (page, lang, target) => captureForceFormInlineError(page, lang, target, target.rawPassword, 'abc', 'abc', kpInlineError[lang].notMeetPolicy)),
    },
    {
        name: 'E2E-011-inline-error-old-password-wrong',
        group: 'user',
        title: '011-inline-error-old-password-wrong: 強制變更頁 → 舊密錯 → inline 紅字「變更失敗」',
        stages: ['E2E-011-inline-error-old-password-wrong'],
        setup: setupForceChange,
        //舊密填錯, 後端 changeUserPassword reject → 前端 chPwOldError='密碼變更失敗'
        run: userShot('E2E-011-inline-error-old-password-wrong', (page, lang, target) => captureForceFormInlineError(page, lang, target, 'Pw@WrongOld88', chosenNewPassword, chosenNewPassword, kpInlineError[lang].oldWrong)),
    },
    {
        name: 'E2E-012-logout-relogin-still-force',
        group: 'user',
        title: '012-logout-relogin-still-force: 強制變更頁 → logout → 再以 raw 密碼登入 → 仍見 CheckYes',
        stages: ['E2E-012-logout-relogin-still-force'],
        setup: setupForceChange,
        run: userShot('E2E-012-logout-relogin-still-force', captureLogoutReloginStillForce),
    },
    {
        name: 'E2E-013-force-redirect-to-user',
        group: 'user',
        title: '013-force-redirect-to-user: isForceChangePw=y 訪問 ?view=backstage 仍被拉回 user view',
        stages: ['E2E-013-force-redirect-to-user'],
        setup: setupForceChange,
        run: userShot('E2E-013-force-redirect-to-user', captureForceRedirectToUser, checkRedirectedToUser),
    },
]

//單一案例管線: per-case DB 重置 (seedRp + 案例前置) + fresh browser (新 context, 自動接受 dialog) → 流程 (截圖後當場語意斷言) → DB 不變式 → 寫檔 / 比對 → 關瀏覽器 → 清資料
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        verify: c.verify,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => `resetpassword-${lg}-${key}`,
        match: assertBaselineMatch,
        prepare: async (ctx) => {
            ctx.target = targetOf(lang)
            await seedRp()
            if (c.setup) {
                await c.setup(ctx)
            }
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
    //截圖前篩選 (--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR); 不符任何鍵即於此報錯
    let gate = createBaselineGate({ langs, cases })
    console.log(gate.describe())
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    //每案 fresh browser + DB 重置 (runCase), 與比對端相同; 每語系先 admin UI (001-004) 再使用者流程 (005-013)
    for (let lang of gate.langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
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

        //=== Admin UI 觸發 (001/002/003/004): admin 真實點擊 Reset password 按鈕 + CheckYesNo ===
        //per-case: 每個 case 各自 launch browser + seed DB + 各自 admin 登入 (獨立情境, 不共用 session) — 由 runCase 負責.
        describe(`ResetPassword E2E [${lang}] — Admin UI 觸發 (001/002/003/004)`, function() {
            this.timeout(180000)

            before(async function() {
                this.timeout(180000)
                await startServersOnce()
            })

            //截圖後當場語意斷言、DB 不變式皆於比對標準圖之前 (pixel baseline 為補強層)
            for (let c of cases.filter((x) => x.group === 'admin')) {
                it(c.title, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })


        //=== User flow (005/006/007) + inline 錯誤 (008-011) + logout-relogin (012) + 額外 (013) ===
        //per-case: 每個 case 各自 launch browser + seed DB + simulateAdminReset (此 reset trigger 之真 UI 由 003 涵蓋) — 由 runCase 負責.
        describe(`ResetPassword E2E [${lang}] — User 收信並登入 / 強制變更 (005-013)`, function() {
            this.timeout(180000)

            before(async function() {
                this.timeout(180000)
                await startServersOnce()
            })

            //截圖後當場語意斷言 (007 兩階段各一)、其餘畫面斷言與 DB 不變式皆於比對標準圖之前 (pixel baseline 為補強層)
            for (let c of cases.filter((x) => x.group === 'user')) {
                it(c.title, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })

    }


    //
    // API 契約 cases (004/005/007/008/009/010/011/014/016) 已遷至
    // test/api-resetpassword.test.mjs (Node + 無 browser).
    // 此檔僅保留需 Playwright + baseline 的 UI cases.
    //

}
