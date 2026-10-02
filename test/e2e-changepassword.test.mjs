import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStableWithBox, assertBaselineMatch, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput, launchBrowser, waitUntilExist } from './tools/e2e-setup.mjs'
//產製端與比對端同一案例管線 (2026-09-28 起, 規格詳 w-package-tools-e2e 之 README.md §2.1-2.2)
import { runBaselineCase, createBaselineGate, assertTextSpec } from './tools/e2eLib.mjs'


//
// E2E change password test — 驗證使用者變更密碼流程畫面（中英文版）
//
// 對應流程文件：spec/流程_使用者變更密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-changepassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-changepassword.test.mjs --timeout 120000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     階段圖鍵只寫該張, 案例鍵或編號前綴 (如 E2E-005) 寫該案全部階段 (本檔各案皆單張), 不符任何鍵即報錯; --langs; --write-mode missing|changed;
//     env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 fresh browser + DB 重置 → 截圖後當場語意斷言 (spec 文字; 表單類再驗 .sb 捲軸不變式) → 寫檔 / 比對
//   E2E-010 為只比對案例 (共用 E2E-007 標準圖): 產製端不執行, --names 點名它即報錯
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
        isActive: 'Active', //procLang isActive: 使用者卡片最末列標籤 (spec E2E-001 驗證 2)
    },
    cht: {
        changePassword: '變更密碼',
        send: '送出',
        cancel: '取消',
        isActive: '帳號是否有效',
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


//頁面文字之走訪與 text / absentText 斷言 (assertTextSpec) 取自 w-package-tools-e2e (原本檔內手寫 pageHasText / collectVisibleText, 內容相同)
async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    await assertTextSpec(page, expected[lang], { label: name })
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


// --- 新增/重置/刪除測試使用者與 token ---

async function insertTestUserAndToken(lang) {
    //先重設為 base seed (清空 users/tokens/ips + 插入 3 canonical users + 4 tokens),
    //再插入本測試自己的 user + token. hermetic: 每次 setup 都從乾淨 base seed 起跳.
    //此函式為 runCase 之 prepare (產製端與比對端每案共用) 唯一進入點,
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
    //等 autoLogin 完成: 偵測使用者頁之「變更密碼」鈕可見(技能 §4.4; 原固定 5 秒, 2026-09-28 改)
    await page.locator(`text="${t.changePassword}"`).first().waitFor({ state: 'visible', timeout: 60000 })

    // Step 3: 點「變更密碼」按鈕
    await page.locator(`text="${t.changePassword}"`).first().click()

    // Step 4: 語意斷言 (spec E2E-001 驗證 2): 展開後卡片最末列「帳號是否有效」整列完整落在捲動容器 .sb 內.
    // 部署方 2026-09-14 回報 1600×900 下末列只露出上半; PageUser 改以 scrollIntoView block:'start' 把表單捲至頂端使其下各列一併可見.
    // 每個 case 都經此前置, 故每案皆驗; 量測 DOM 幾何不截圖, 與 baseline 尺寸無關.
    // 先偵測表單已展開(三個密碼欄)且平滑捲動已把末列帶入 .sb, 取代固定 0.8 + 0.6 秒(負載高時捲動未完即量, 2026-09-28);
    // 逾時不在此拋錯, 交由下方斷言附幾何詳情報錯
    await waitUntilExist(page, `展開後最末列「${t.isActive}」完整落在 .sb 內`, (lastText) => {
        let sb = document.querySelector('.sb')
        if (!sb || document.querySelectorAll('input[type="password"]').length < 3) {
            return false
        }
        let sbr = sb.getBoundingClientRect()
        let lbl = [...document.querySelectorAll('div')].find((d) => d.childElementCount === 0 && d.textContent.trim() === lastText)
        let row = lbl && lbl.parentElement && lbl.parentElement.parentElement
        let rr = row ? row.getBoundingClientRect() : null
        return !!(rr && rr.top >= sbr.top - 0.5 && rr.bottom <= sbr.bottom + 0.5)
    }, { arg: t.isActive, timeout: 60000 }).catch(() => {})
    let vis = await page.evaluate((lastText) => {
        let sb = document.querySelector('.sb')
        let sbr = sb.getBoundingClientRect()
        let lbl = [...document.querySelectorAll('div')].find((d) => d.childElementCount === 0 && d.textContent.trim() === lastText)
        let row = lbl && lbl.parentElement && lbl.parentElement.parentElement //標籤 div → flex:1 div → 列 div
        let rr = row ? row.getBoundingClientRect() : null
        return {
            found: !!rr,
            ok: !!(rr && rr.top >= sbr.top - 0.5 && rr.bottom <= sbr.bottom + 0.5),
            sb: { top: sbr.top, bottom: sbr.bottom, scrollTop: sb.scrollTop, scrollH: sb.scrollHeight, clientH: sb.clientHeight },
            row: rr ? { top: rr.top, bottom: rr.bottom } : null,
        }
    }, t.isActive)
    assert.ok(vis.found, `找不到最末列標籤「${t.isActive}」: ${JSON.stringify(vis)}`)
    assert.ok(vis.ok, `展開變更密碼後最末列「${t.isActive}」未完整落在捲動區內: ${JSON.stringify(vis)}`)
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


//偵測錯誤紅字已出現再截圖(2026-09-28 取代固定 0.8～3.5 秒: clickSend 不等點擊完成, 含後端檢核者(E2E-006 / 007)負載高時較久;
//原實際靠 captureStableWithBox 對 Locator 目標捲入時之隱性等待(至多 8 秒)撐著, 改為明示偵測, 上限 60 秒)
async function waitErrShown(page, errText) {
    await page.getByText(errText, { exact: false }).first().waitFor({ state: 'visible', timeout: 60000 })
}


// --- 各情境截圖 helper ---

async function captureFormInitial(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    return await captureStableWithBox(page, '.sb')
}

async function captureOldEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await clickSend(page, lang)
    // E2E-002: 驗 chPwOldError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-002-old-empty'][lang].value
    await waitErrShown(page, errText)
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureNewEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, { oldPassword: originalPassword })
    await clickSend(page, lang)
    // E2E-003: 驗 chPwNewError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-003-new-empty'][lang].value
    await waitErrShown(page, errText)
    return await captureStableWithBox(page, page.getByText(errText, { exact: false }).first())
}

async function captureConfirmEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
    })
    await clickSend(page, lang)
    // E2E-004: 驗 chPwConfirmError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-004-confirm-empty'][lang].value
    await waitErrShown(page, errText)
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
    // E2E-005: 驗 chPwConfirmError inline 紅字 → 框錯誤紅字本身
    let errText = expectedSpecText['E2E-005-pw-mismatch'][lang].value
    await waitErrShown(page, errText)
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
    // E2E-006: 驗 chPwNewError inline 紅字 → 框錯誤紅字本身(經後端 checkUserPassword)
    let errText = expectedSpecText['E2E-006-pw-policy-fail'][lang].value
    await waitErrShown(page, errText)
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
    // E2E-007: 驗 chPwOldError inline 紅字 → 框錯誤紅字本身(經後端 checkUserPassword + changeUserPassword)
    let errText = expectedSpecText['E2E-007-old-wrong'][lang].value
    await waitErrShown(page, errText)
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
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 }) //偵測上限放寬(原 15 秒, 2026-09-28)
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
    await page.waitForFunction((t) => (document.body.innerText || '').includes(t), needle, { timeout: 60000 }) //偵測上限放寬(原 15 秒, 2026-09-28)
    await page.waitForTimeout(500)
    // E2E-010: 驗 chPwOldError inline 紅字（與 E2E-007 同文字）→ 框錯誤紅字本身
    let errText10 = expectedSpecText['E2E-010-token-invalid'][lang].value
    return await captureStableWithBox(page, page.getByText(errText10, { exact: false }).first())
}


//E2E-008 截圖與語意斷言後點確認收掉成功 modal 留乾淨終態 (舊產製端於寫檔後、舊比對端於比對後皆有此步; 在截圖之後, 不影響圖)
async function dismissSuccessModal(page, lang) {
    let okText = lang === 'eng' ? 'OK' : '確認'
    await page.locator(`text="${okText}"`).first().click().catch(() => {})
    await page.waitForTimeout(500)
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//順序與 mocha it 相同 (產製順序 ≡ 比對順序; 008 會改 user.password, 沿舊序放最後); title 為 mocha it 標題 (--grep 依之);
//stages 為該案產出之圖鍵 (與寫檔名、比對名一致); capture 為截圖流程 (回傳單張 buf); sbOverflows 為截圖後加驗 .sb 捲軸不變式之案例;
//只比對之案例 (compareOnly) 直接宣告其比對之共用圖鍵為 stages; 篩選器之 --names 解析只由產圖案例負責寫檔
//(--names E2E-007-old-wrong 只選到 E2E-007; 與 login / autologin 同一寫法). 2026-09-28 移除原為閃避舊篩選器缺陷之 sharedKey.
let cases = [
    {
        name: 'E2E-001-form-initial',
        title: 'E2E-001-form-initial: 點變更密碼，表單剛展開',
        capture: captureFormInitial,
        stages: ['E2E-001-form-initial'],
        sbOverflows: true,
    },
    {
        name: 'E2E-002-old-empty',
        title: 'E2E-002-old-empty: 三欄空送出 → 舊密碼下方紅字',
        capture: captureOldEmpty,
        stages: ['E2E-002-old-empty'],
        sbOverflows: true,
    },
    {
        name: 'E2E-003-new-empty',
        title: 'E2E-003-new-empty: 只填舊密碼送出 → 新密碼下方紅字',
        capture: captureNewEmpty,
        stages: ['E2E-003-new-empty'],
        sbOverflows: true,
    },
    {
        name: 'E2E-004-confirm-empty',
        title: 'E2E-004-confirm-empty: 填舊+新送出 → 確認密碼下方紅字',
        capture: captureConfirmEmpty,
        stages: ['E2E-004-confirm-empty'],
        sbOverflows: true,
    },
    {
        name: 'E2E-005-pw-mismatch',
        title: 'E2E-005-pw-mismatch: 新密碼≠確認密碼 → 確認密碼下方紅字',
        capture: capturePwMismatch,
        stages: ['E2E-005-pw-mismatch'],
        sbOverflows: true,
    },
    {
        name: 'E2E-006-pw-policy-fail',
        title: 'E2E-006-pw-policy-fail: 新密碼不符策略 → 新密碼下方紅字',
        capture: capturePwPolicyFail,
        stages: ['E2E-006-pw-policy-fail'],
        sbOverflows: true,
    },
    {
        name: 'E2E-007-old-wrong',
        title: 'E2E-007-old-wrong: 舊密碼錯 → 舊密碼下方紅字「變更失敗」',
        capture: captureOldWrong,
        stages: ['E2E-007-old-wrong'],
        sbOverflows: true,
    },
    {
        name: 'E2E-009-network-error',
        title: 'E2E-009-network-error: 前端 checkUserPassword 網路錯誤 → 新密碼下方紅字',
        capture: captureNetworkError,
        stages: ['E2E-009-network-error'],
    },
    {
        //token 失效視覺等同 007 (chPwOldError = '變更失敗'): 共用 E2E-007 標準圖, 不另存; 產製端不執行 (舊產製端亦不產)
        name: 'E2E-010-token-invalid',
        title: 'E2E-010-token-invalid: token 失效 (DB 中途刪除) → 舊密碼下方紅字「變更失敗」(共用 E2E-007 baseline)',
        capture: captureTokenInvalidated,
        compareOnly: true,
        stages: ['E2E-007-old-wrong'],
    },
    {
        name: 'E2E-008-success',
        title: 'E2E-008-success: 三欄填妥+正確 → showCheckYes modal 顯示完整成功訊息',
        capture: captureSuccess,
        stages: ['E2E-008-success'],
        afterShot: dismissSuccessModal,
    },
]

//單張案例之流程 (產製端與比對端共用): 截圖 → 當場語意斷言 (狀態仍在畫面上: spec 文字; 表單類再驗 .sb 捲軸不變式) → 截圖後步驟 → { 圖鍵: buf }
//(舊比對端於截圖後做同樣斷言 (E2E-001 在比對後), 舊產製端不斷言; 2026-09-28 起兩端同跑且皆在寫檔 / 比對之前)
//圖鍵一律為宣告之 stages[0] (只比對之案例即其比對之共用圖鍵)
async function runShot(c, page, lang) {
    let buf = await c.capture(page, lang)
    await assertSpecForCase(page, lang, c.name)
    if (c.sbOverflows) {
        await assertSbOverflows(page, `changepassword-${lang}-${c.name}`)
    }
    if (c.afterShot) {
        await c.afterShot(page, lang)
    }
    return { [c.stages[0]]: buf }
}

//單一案例管線: per-case DB 重置 + fresh browser (新 context, 自動接受 dialog) → 流程 (截圖後當場語意斷言) → 寫檔 / 比對 → 關瀏覽器 → 清資料
//只比對之案例: 產出＝宣告 (共用圖鍵), 產製端不寫 (compareOnly)
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: (page, lg) => runShot(c, page, lg),
        stages: c.stages,
        compareOnly: !!c.compareOnly,
        launch: launchBrowser,
        pathOf: bp,
        //只比對案例之失敗證據標籤帶案例鍵 (否則以共用之 E2E-007 圖鍵命名, 誤判為 007 失敗)
        labelOf: (lg, key) => (c.compareOnly ? `changepassword-${lg}-${c.name}-shared-${key}` : `changepassword-${lg}-${key}`),
        match: assertBaselineMatch,
        prepare: async () => {
            await insertTestUserAndToken(lang)
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

    //每案 fresh browser + DB 重置 (runCase), 與比對端相同 (2026-09-28 前產製端為每語系共用一個 browser 且只於語系開頭與 008 前 seed)
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

        describe(`ChangePassword E2E [${lang}] — 變更密碼流程`, function() {
            this.timeout(120000)

            //per-case 獨立 (fresh browser + DB 重置) 由 runCase 負責, 確保單 case --grep 也能跑
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()
            })

            //截圖後當場語意斷言皆於比對標準圖之前 (pixel baseline 為補強層); E2E-010 比對共用之 E2E-007 標準圖
            for (let c of cases) {
                it(c.title, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

            //
            // 009-cancel case 已刪除 (spec/流程_使用者變更密碼.md 對應 bullet 已移除,
            // cancel 收起表單視為元件行為非流程契約).
            //

        })

    }

}
