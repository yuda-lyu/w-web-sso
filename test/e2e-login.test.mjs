import assert from 'assert'
import fs from 'fs'
import path from 'path'
import map from 'lodash-es/map.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, assertBaselineMatch, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput, launchBrowser, backstageMenuBox, waitUntilExist } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, pageHasText, collectDomText, itemsUnionBox, waitAlertGone } from './tools/e2eLib.mjs'
import { mdiEye, mdiEyeOff } from '@mdi/js/mdi.js'

//AgentMail key / inbox: 由 env var 提供, 不寫死 in repo (避免 public open-source repo 內含 live secret).
//使用前 export AGENTMAIL_API_KEY=<key> AGENTMAIL_INBOX_ID=<inbox> (對 notverify-flow 之 email 驗證 case 必要).
let agentmailApiKey = process.env.AGENTMAIL_API_KEY || ''
let agentmailInboxId = process.env.AGENTMAIL_INBOX_ID || 'ager@agentmail.to'


//
// E2E login test — 驗證各種登入狀態的畫面（中英文版）
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-login.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-login.test.mjs --timeout 120000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     階段圖鍵只寫該張 (如 E2E-005-notverify-resend-sent, 或編號前綴 E2E-005: notverify 旅程照跑、只寫該階段),
//     案例鍵寫該案全部階段 (如 E2E-003~007-notverify-full-flow 寫旅程 5 張), 不符任何鍵即報錯;
//     E2E-015 為只比對之案例 (共用 E2E-002-wrong-pw 標準圖), 點名即報錯; E2E-017 / E2E-018 只有 eng (cht- 前綴即報錯);
//     --langs; --write-mode missing|changed; env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 fresh browser + DB 重置 → 流程 → 語意斷言 (notverify 旅程為每階段
//     當下記錄之 specHits) → 寫檔 / 比對; 斷言不過一張都不寫
//   外部依賴: notverify 旅程 (E2E-003~007) 經真實 SMTP 寄驗證信並以 AgentMail API 收信, 須 export AGENTMAIL_API_KEY, 未設即 fail-fast
//
// 標準圖存放：test/pics/login/login-{lang}-{number}-{name}.png
// 測試當次截圖不落地，直接以 buffer 與標準圖做像素級比對
//

let salt = '{salt}'
let baselineDir = './test/pics/login'
//eye toggle 用 sample 密碼, 讓 baseline 視覺上能區分「遮罩 = dots」vs「明文 = 純文字」
let sampleEyeTogglePw = 'Pw@EyeToggle123!'

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


// ===================================================================
// 預期語意斷言 (從 spec/流程_使用者一般登入.md + procLang.mjs / PageLogin.vue 衍生, 非現狀指紋)
// 每張截圖必須含對應 i18n 鍵的可見文字; 不含 → 修系統或修 spec, 不改 baseline.
// 'absentLoginButton' = 成功 case, 不應再看到 "Log in" / "登入" 按鈕 (頁面已跳走)
// ===================================================================

let expectedSpecText = {
    'E2E-001-ok': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-002-wrong-pw': {
        eng: { mode: 'text', value: 'User account or password is incorrect' },
        cht: { mode: 'text', value: '使用者帳密錯誤無法登入' },
    },
    'E2E-003-notverify-login-failed': {
        eng: { mode: 'text', value: 'Your account has not been verified' },
        cht: { mode: 'text', value: '您的帳號尚未完成 email 驗證' },
    },
    'E2E-004-notverify-resend-page': {
        eng: { mode: 'text', value: 'Send verification email' },
        cht: { mode: 'text', value: '寄送驗證信' },
    },
    'E2E-005-notverify-resend-sent': {
        eng: { mode: 'text', value: 'Verification email has been resent' },
        cht: { mode: 'text', value: '驗證信已重新寄出' },
    },
    'E2E-006-notverify-verified': {
        eng: { mode: 'text', value: 'Email verified successfully' },
        cht: { mode: 'text', value: '電子郵件驗證成功' },
    },
    'E2E-007-notverify-logged-in': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-008-inactive': {
        //inactive 由 procProtect 階段 reject 'can not find the user by account',
        //PageLogin 顯示同 failedLoginForCatch (與 002-wrong-pw 一致, 防帳號列舉)
        eng: { mode: 'text', value: 'User account or password is incorrect' },
        cht: { mode: 'text', value: '使用者帳密錯誤無法登入' },
    },
    'E2E-009-expired': {
        eng: { mode: 'text', value: 'Your account has expired' },
        cht: { mode: 'text', value: '您的帳號已過期' },
    },
    'E2E-010-blocked': {
        //D24 anti-enum: 被封鎖帳號登入不再回 distinct 'loginAccountBlocked', 改回 generic
        //'failedLoginForCatch'(與 002-wrong-pw / 008-inactive 一致, 不洩漏帳號是否被封鎖/存在)
        eng: { mode: 'text', value: 'User account or password is incorrect' },
        cht: { mode: 'text', value: '使用者帳密錯誤無法登入' },
    },
    'E2E-011-view-backstage': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-012-view-user': {
        eng: { mode: 'absentLoginButton' },
        cht: { mode: 'absentLoginButton' },
    },
    'E2E-013-resend-invalid-account': {
        eng: { mode: 'text', value: 'The email address does not match the account' },
        cht: { mode: 'text', value: '電子郵件與帳號不符' },
    },
    'E2E-014-resend-already-verified': {
        eng: { mode: 'text', value: 'This account has already been verified' },
        cht: { mode: 'text', value: '此帳號已完成驗證' },
    },
    'E2E-015-account-not-exist': {
        //不存在帳號 = 與密碼錯誤完全同訊息 (防帳號列舉, 同 002)
        eng: { mode: 'text', value: 'User account or password is incorrect' },
        cht: { mode: 'text', value: '使用者帳密錯誤無法登入' },
    },
    'E2E-016-login-no-redir': {
        eng: { mode: 'text', value: 'Can not get the url for redirection' },
        cht: { mode: 'text', value: '無有效轉址' },
    },
}


//偵測式等待 spec 預期狀態(技能 §4.4; 取代點登入 / 寄送後之固定 5～10 秒等待——2026-09-28 兩套全套並行、負載高時
//E2E-005 於固定 10 秒時仍為「Processing...」而語意斷言失敗): text 模式等預期文字出現;
//absentLoginButton 模式等「已無密碼欄且已出現使用者頁 .sb 或後台抽屜 [state]」(轉址中之空白頁兩者皆不成立, 不誤判)。
//text 模式另等提示浮窗(domAlert)消失: 同一訊息常同時出現於暫態浮窗與行內紅字(例: E2E-016 無有效轉址, mUI alert 4 秒後消失),
//反應目標為行內紅字, 浮窗在不在畫面上取決於時序——原固定 8 秒恰好等過浮窗, 改偵測式後須顯式等其消失(同日全套抓出)
async function waitForSpecState(page, lang, name, timeout = 60000) {
    let e = expectedSpecText[name][lang]
    if (e.mode === 'text') {
        await waitUntilExist(page, `spec 文字「${e.value}」`, (s) => (document.body.innerText || '').includes(s), { arg: e.value, timeout })
        await waitAlertGone(page, { timeout })
    }
    else {
        await waitUntilExist(page, '已離開登入頁(無密碼欄且有使用者頁或後台)', () => document.querySelectorAll('input[type="password"]').length === 0 && !!document.querySelector('.sb, [state]'), { timeout })
    }
}


//頁面文字之走訪 (pageHasText / collectDomText) 取自 e2eLib (原本檔內手寫 pageHasText / collectVisibleText, 內容相同)
async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義, spec 來源缺失`)
    }
    let e = expected[lang]
    if (e.mode === 'absentLoginButton') {
        //成功 case: 已離開 PageLogin → 不應仍有 password input (login form 的 [type=password] input)
        //不用文字檢查 ("Log in"/"登入" 在 backstage Statistics 頁有「Login Frequency」「登入頻率」誤觸)
        let pwCount = await page.locator('input[type="password"]').count()
        if (pwCount > 0) {
            assert.fail(`預期登入成功離開 PageLogin (不應再有 password input), 實際 ${pwCount} 個 password input`)
        }
    }
    else if (e.mode === 'text') {
        let found = await pageHasText(page, e.value)
        if (!found) {
            let dump = await collectDomText(page)
            assert.fail(`預期含 spec 文字 "${e.value}" (來自 ${name} 之 i18n / 流程文件), 實際可見文字: ${dump}`)
        }
    }
    else {
        throw new Error(`未知 mode: ${e.mode}`)
    }
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
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'success',
        screenshotName: 'E2E-001-ok',
    },
    {
        id: 'id-login-wrong-pw',
        account: 'login-wrongpw',
        password: hashPassword('Pw@login2', salt),
        rawPassword: 'Pw@wrong99',
        name: 'Wrong PW',
        email: 'login-wrongpw@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'incorrect user account or password',
        screenshotName: 'E2E-002-wrong-pw',
    },
    {
        id: 'id-notverify-flow',
        account: 'notverify-flow',
        password: hashPassword('Tk@24680', salt),
        rawPassword: 'Tk@24680',
        name: 'NotVerify Flow',
        email: agentmailInboxId,
        redir: `${baseUrl}/?view=user&token={token}`,
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
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'n',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'account inactive',
        screenshotName: 'E2E-008-inactive',
    },
    {
        id: 'id-login-expired',
        account: 'login-expired',
        password: hashPassword('Pw@login5', salt),
        rawPassword: 'Pw@login5',
        name: 'Expired',
        email: 'login-expired@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2020-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        expect: 'account expired',
        screenshotName: 'E2E-009-expired',
    },
    {
        id: 'id-login-blocked',
        account: 'login-blocked',
        password: hashPassword('Pw@login6', salt),
        rawPassword: 'Pw@login6',
        name: 'Blocked',
        email: 'login-blocked@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: 'n',
        isActive: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '2030-01-01T00:00:00.000+08:00',
        expect: 'account blocked',
        screenshotName: 'E2E-010-blocked',
    },
    {
        id: 'id-resend-invalid-account',
        account: 'resend-invalid-account',
        password: hashPassword('Pw@resend1', salt),
        rawPassword: 'Pw@resend1',
        name: 'Resend Invalid',
        email: 'resend-invalid-account@test.com',
        redir: `${baseUrl}/?view=user&token={token}`,
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
        redir: `${baseUrl}/?view=user&token={token}`,
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
    //先重設為 base seed (清空 users/tokens/ips + 插入 3 canonical users + 4 tokens),
    //再插入本測試自己的 testUsers. hermetic: 每次 setup 都從乾淨 base seed 起跳.
    //此函式為案例管線 (runCase 之 prepare) 之唯一進入點, 產製端與比對端共用.
    await resetToBaseSeed()
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
    await deleteNonBaseSeed()
    console.log(`deleted test users + tokens`)
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


//typeIntoInput 改用 e2e-setup.mjs 之 shared Pattern D 實作 (insertText + retry × 3, 防 Vue v-model 漏字 race)


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
    //此流程須抓 AgentMail 信箱實際信件 — 須先 export AGENTMAIL_API_KEY (詳 L14 註解).
    //本機開發若未設, fail-fast 顯示明確錯誤而非默默走到 401 Authorization fail.
    if (!agentmailApiKey) {
        throw new Error(`notVerifiedFullFlow 須 export AGENTMAIL_API_KEY=<key> (此案測試會打 AgentMail API 抓驗證信). 若不需測 notverify 流程: 比對端用 --grep 排除此案 (每案自行重置 DB 與開瀏覽器, 可單獨挑選), 產製端用 --names 只點名其他案例`)
    }
    // 減 1 分鐘緩衝，避免本機時鐘與 AgentMail 伺服器時鐘差異導致抓不到信
    let emailSendStart = Date.now() - 60000
    let bufs = {}
    let specHits = {} //每步在當下抓 expected spec 文字是否存在; 由案例之 semantic 於寫檔 / 比對前斷言 (兩端皆跑)

    let recordSpec = async (name) => {
        let expected = expectedSpecText[name]
        if (!expected || !expected[lang]) {
            specHits[name] = { ok: false, err: `expectedSpecText 未定義 ${name}/${lang}` }
            return
        }
        let e = expected[lang]
        if (e.mode === 'absentLoginButton') {
            let stillHas = await pageHasText(page, t.login)
            specHits[name] = { ok: !stillHas, err: stillHas ? `仍含 "${t.login}", 預期已離開 PageLogin` : null }
        }
        else if (e.mode === 'text') {
            let found = await pageHasText(page, e.value)
            if (!found) {
                let dump = await collectDomText(page)
                specHits[name] = { ok: false, err: `未含 "${e.value}". 可見文字: ${dump}` }
            }
            else {
                specHits[name] = { ok: true }
            }
        }
    }

    // Step 1: 登入失敗
    console.log(`  [1] login → expect not verified (${lang})`)
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), notVerifyUser.account)
    await typeIntoInput(page, inputs.nth(1), notVerifyUser.rawPassword)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await waitForSpecState(page, lang, 'E2E-003-notverify-login-failed')
    await recordSpec('E2E-003-notverify-login-failed')
    //框 loginError 紅字本身（未驗證錯誤訊息）: 驗證標的是這條紅字訊息，非整個登入卡
    bufs['E2E-003-notverify-login-failed'] = await captureStableWithBox(page, page.getByText(expectedSpecText['E2E-003-notverify-login-failed'][lang].value, { exact: false }).first())

    // Step 2: 點「重寄驗證信」
    console.log('  [2] click resend link')
    await page.locator(`text="${t.resendLink}"`).first().click()
    //偵測重寄表單已展開(寄送鈕文字出現), 取代固定 1.5 秒(2026-09-28)
    await waitForSpecState(page, lang, 'E2E-004-notverify-resend-page')
    await recordSpec('E2E-004-notverify-resend-page')
    //框登入卡 .sb：resend viewMode 展開後重寄表單仍在 .sb 內
    bufs['E2E-004-notverify-resend-page'] = await captureStableWithBox(page, '.sb')

    // Step 3: 填 email 點寄送
    // 註：登入頁的 input 順序為 [account(text), password(password), email(text)]，取非 password 的最後一個
    console.log('  [3] fill email + send')
    let resendInput = page.locator('input:not([type="password"])').last()
    await typeIntoInput(page, resendInput, notVerifyUser.email)
    await page.waitForTimeout(500)
    page.locator(`text="${t.resendSubmit}"`).first().click().catch(() => {})
    // 等寄信 + CheckYes 彈窗(偵測成功訊息; 真寄信經 SMTP, 放寬至 90 秒)
    await waitForSpecState(page, lang, 'E2E-005-notverify-resend-sent', 90000)
    await recordSpec('E2E-005-notverify-resend-sent')
    //結果: 重寄成功之 CheckYes 彈窗（框住彈窗面板）。彈窗為 overlay 蓋在登入卡 .sb 上，依技能 §7.3-4「被蓋住就框蓋在上面的」
    //（2026-09-28 改：原框被遮罩蓋住之 .sb 並註「作為觀看錨點」；w-package-tools-e2e 被蓋住檢查於全量盤查時抓出）
    bufs['E2E-005-notverify-resend-sent'] = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')

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
    //偵測驗證結果訊息已出現, 取代固定 2 秒(2026-09-28)
    await waitForSpecState(page, lang, 'E2E-006-notverify-verified')
    await recordSpec('E2E-006-notverify-verified')
    //框驗證訊息本體：後端靜態結果頁，訊息在 <body><p>...</p></body> 結構的唯一 <p> 元素；<p> 為撐滿整寬之 block，
    //取其文字墨跡（技能 §7.2 提示訊息→訊息本體；2026-09-28 改：原框 <p> 元素，一行字右側約 900px 空白一併框入）
    bufs['E2E-006-notverify-verified'] = await captureStableWithBox(page, itemsUnionBox('p', { fit: true }))

    // Step 6: 驗證後登入
    console.log('  [6] login after verified')
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), notVerifyUser.account)
    await typeIntoInput(page, inputs.nth(1), notVerifyUser.rawPassword)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await waitForSpecState(page, lang, 'E2E-007-notverify-logged-in')
    await recordSpec('E2E-007-notverify-logged-in')
    //框 .sb：驗證後成功登入轉至 user view，PageUser.vue 同樣使用 .sb class
    bufs['E2E-007-notverify-logged-in'] = await captureStableWithBox(page, '.sb')

    return { bufs, specHits }
}


// --- Playwright 登入並截圖 ---
//
// boxTarget: captureStableWithBox 的 target（CSS selector 字串 / Playwright Locator），預設為 '.sb'（登入卡 / user view 卡）.
// 成功轉址 case (001/007/011/012) → '.sb' 或 'body'（backstage 全螢幕無 .sb）.
// 錯誤訊息 case (002/008/009/010/015/016) → 傳 Locator 精確框 loginError 紅字本身.
//   慣用：page.getByText(<預期文字>, { exact: false }).first()
//   （勿用 div[style*="color:#c62828"]：瀏覽器把 style 序列化為 `color: rgb(198, 40, 40)`，該選擇器永不命中；2026-09-28 更正原註解）
//
//specName: 案例鍵(expectedSpecText 之鍵), 點登入後以之偵測式等待(waitForSpecState), 不以固定秒數
async function loginAndScreenshot(page, lang, account, password, viewParam, boxTarget, specName) {
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
    await typeIntoInput(page, inputs.nth(0), account)
    await typeIntoInput(page, inputs.nth(1), password)
    await page.waitForTimeout(500)

    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await waitForSpecState(page, lang, specName)

    return await captureStableWithBox(page, boxTarget)
}


// --- 重寄驗證信錯誤流程 ---
//
// 1. 登入失敗（未驗證）→ 顯示重寄 UI
// 2. 填入 resendEmail
// 3. 執行 preSendHook（可選，例如 C2 在送出前把使用者標為已驗證）
// 4. 點送出 → 等 resendError 顯示
// 5. 截圖
//
// boxTarget: captureStableWithBox 的 target，預設 '.sb'.
//   錯誤訊息 case (013/014) → 傳 Locator 精確框 resendError 紅字本身.
//   慣用：page.getByText(<預期文字>, { exact: false }).first()（勿用 div[style*="color:#c62828"]，理由見 loginAndScreenshot 註解）
//
//specName: 案例鍵, 寄送後以之偵測式等待錯誤訊息; 點登入後等「未驗證」訊息(同 E2E-003 之 spec 文字)
async function resendErrorFlow(page, lang, account, password, resendEmail, preSendHook, boxTarget, specName) {
    let t = kpLangText[lang]
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await setLangViaUI(page, lang)

    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), account)
    await typeIntoInput(page, inputs.nth(1), password)
    await page.waitForTimeout(500)
    page.locator(`text="${t.login}"`).first().click().catch(() => {})
    await waitForSpecState(page, lang, 'E2E-003-notverify-login-failed')

    await page.locator(`text="${t.resendLink}"`).first().click()
    await page.waitForTimeout(1500)

    let resendInput = page.locator('input:not([type="password"])').last()
    await typeIntoInput(page, resendInput, resendEmail)
    await page.waitForTimeout(500)

    if (preSendHook) {
        await preSendHook()
    }

    page.locator(`text="${t.resendSubmit}"`).first().click().catch(() => {})
    await waitForSpecState(page, lang, specName)

    return await captureStableWithBox(page, boxTarget)
}


// --- per-case cold browser 工廠 (非標準圖之手寫 it 用) ---
//
// per-case 標準 (全域技能 role-coder-for-test-e2e §6): 每個 case 各自 launch 全新 browser/context/page, 不跨 case 帶狀態.
// 標準圖案例 (產製端與比對端) 一律經 runBaselineCase (每案 fresh browser); 本工廠只供不產圖之手寫 it
// (toggle-back-to-hidden) 取得同等之 cold browser (launch → newContext → newPage → 自動接受 dialog → 用畢關閉).
//
async function withFreshPage(fn) {
    let browser = await launchBrowser()
    try {
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })
        return await fn(page)
    }
    finally {
        await browser.close()
    }
}


// --- eye toggle 共用前置 (開乾淨登入頁 + 輸入 sample 密碼) ---
//
// E2E-017 / E2E-018 為各自獨立 case (純 UI, 各自能從零 seed), 共用此前置:
// 開 eng 登入頁 → 等 2 input + eye icon → 於密碼欄輸入 sample 字串 (讓遮罩/明文視覺可辨).
// regen 與 mocha test 共用, 避免兩處前置 drift.
//
async function setupEyePage(page) {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForFunction(() => {
        let inps = document.querySelectorAll('input')
        let eye = document.querySelector('[shellellipse="rightIcon"] svg path')
        return inps.length >= 2 && inps[1].type === 'password' && eye
    }, null, { timeout: 15000 })
    await page.waitForTimeout(500)

    let pwInput = page.locator('input').nth(1)
    await pwInput.click()
    await page.keyboard.type(sampleEyeTogglePw, { delay: 0 })
    await page.waitForTimeout(300)
}


//密碼欄 type 與 eye icon 之 SVG path (DOM 語意斷言用)
async function readToggleState(page) {
    return await page.evaluate(() => {
        let inps = document.querySelectorAll('input')
        let pathEl = document.querySelector('[shellellipse="rightIcon"] svg path')
        return {
            type: inps[1].type,
            iconPath: pathEl ? pathEl.getAttribute('d') : null,
        }
    })
}


//park mouse + 等動畫 settle (對齊全域 CLAUDE.md captureStable 標準)
//框登入卡 .sb：eye icon 及密碼欄位均在 .sb 內，為此 case 的觀看區
async function captureEyeStable(page) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)
    return await captureStableWithBox(page, '.sb')
}


// ===================================================================
// 案例流程 (產製端與比對端共用; 兩端原本即呼叫同一組 helper, 流程一致)
// ===================================================================

//E2E-001 / 002 / 008 / 009 / 010 (各自獨立, 各自一組前置):
//001-ok (absentLoginButton): 框 .sb（成功轉址後的 user view 卡）;
//002 / 008 / 009 / 010 (text mode): 框 loginError 紅字本身（驗證標的是錯誤訊息，非整個登入卡）.
//E2E-008-inactive 有自己的 baseline (帳號欄顯示 login-inactive, 與 E2E-002 之 login-wrongpw 不同 → 無法 pixel 共用);
//防帳號列舉由語意斷言保證 (相同錯誤訊息 'User account or password is incorrect'). 對比 E2E-015 是用「同帳號技巧」
//(打 login-wrongpw 再刪該帳號) 才能與 002 pixel 共用.
function runSimpleLogin(u) {
    return (page, lang) => {
        let eSpec = expectedSpecText[u.screenshotName][lang]
        let boxTarget = eSpec.mode === 'text'
            ? page.getByText(eSpec.value, { exact: false }).first()
            : '.sb'
        return loginAndScreenshot(page, lang, u.account, u.rawPassword, null, boxTarget, u.screenshotName)
    }
}


//E2E-001：共通進場路徑之專用案例（技能 §2.4 每專案一個完整記錄；E 第 1 期試點 2026-09-28）——登入之每個使用者操作兩張、相鄰者一張兼任（§7.3-1）：
//①輸入帳號前：框帳號欄整列 → ②輸入帳號後＝輸入密碼前：框帳號欄∪密碼欄 → ③輸入密碼後＝點登入前：框密碼欄∪「Log in」鈕 → ④點登入後：框 user view 卡。
//其餘借道登入之流程以 helper 抹平此路徑，不重複截圖（cht 輪之語系切換仍由 setLangViaUI 完成、未逐步截圖，列 E 第 2 期）。
let LOGIN_STEP_KEYS = ['E2E-001-1-type-account', 'E2E-001-2-type-password', 'E2E-001-3-click-login', 'E2E-001-4-ok']
function runLoginOkStepped(u) {
    return async (page, lang) => {
        let t = kpLangText[lang]
        //進入乾淨登入頁（同 loginAndScreenshot）
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
        await page.evaluate(() => localStorage.clear())
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(3000)
        await setLangViaUI(page, lang)
        //欄位列 = 登入卡內 inline style 含 align-items: stretch 之列（圖示區＋標籤與輸入框）；登入鈕 = 置中列中文字「恰為」登入鈕字樣者
        //（整字比對：hasText 為子字串比對，cht「登入」會先命中置中之標題「單一登入系統」→ 框成標題∪密碼欄、漏登入鈕，2026-09-28 審圖發現）
        let rows = page.locator('.sb div[style*="align-items: stretch"]')
        let accRow = rows.nth(0)
        let pwRow = rows.nth(1)
        let loginBtn = page.locator('.sb div[style*="text-align: center"]').filter({ hasText: new RegExp(`^\\s*${t.login}\\s*$`) }).first()
        assert.strictEqual((await loginBtn.innerText()).trim(), t.login, `登入鈕定位錯誤: 應為「${t.login}」`)
        let inputs = page.locator('input')
        let shots = {}
        shots['E2E-001-1-type-account'] = await captureStableWithBox(page, accRow)
        await typeIntoInput(page, inputs.nth(0), u.account)
        shots['E2E-001-2-type-password'] = await captureStableWithBox(page, [accRow, pwRow])
        await typeIntoInput(page, inputs.nth(1), u.rawPassword)
        await page.waitForTimeout(500)
        shots['E2E-001-3-click-login'] = await captureStableWithBox(page, [pwRow, loginBtn])
        page.locator(`text="${t.login}"`).first().click().catch(() => {})
        await waitForSpecState(page, lang, 'E2E-001-ok')
        shots['E2E-001-4-ok'] = await captureStableWithBox(page, '.sb')
        return shots
    }
}


//E2E-017: 預設遮罩態 (純 UI 獨立 case, eng only)
async function runEyeHidden(page) {
    await setupEyePage(page)
    //DOM 語意斷言 (原比對端, 截圖前; 唯讀)
    let state = await readToggleState(page)
    assert.strict.equal(state.type, 'password', `密碼欄預設應為 password type, 實際 ${state.type}`)
    assert.strict.equal(state.iconPath, mdiEyeOff, `預設應顯示 eye-off (閉眼) 圖示, SVG path 應為 mdiEyeOff`)
    return await captureEyeStable(page)
}


//E2E-018: 點 eye 切換明文態 (純 UI 獨立 case, eng only)
async function runEyeShown(page) {
    await setupEyePage(page)
    await page.locator('[shellellipse="rightIcon"]').first().click()
    await page.waitForTimeout(300)
    //DOM 語意斷言 (原比對端, 截圖前; 唯讀)
    let state = await readToggleState(page)
    assert.strict.equal(state.type, 'text', `點 eye 後密碼欄應為 text type, 實際 ${state.type}`)
    assert.strict.equal(state.iconPath, mdiEye, `點 eye 後應顯示 eye (開眼) 圖示, SVG path 應為 mdiEye`)
    return await captureEyeStable(page)
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//語意斷言 (截圖後、寫檔 / 比對前): 依案例鍵查 expectedSpecText
async function specSemantic(ctx) {
    await assertSpecForCase(ctx.page, ctx.lang, ctx.name)
}

//notverify 承接式 journey 之 5 階段圖鍵
let nvNames = [
    'E2E-003-notverify-login-failed',
    'E2E-004-notverify-resend-page',
    'E2E-005-notverify-resend-sent',
    'E2E-006-notverify-verified',
    'E2E-007-notverify-logged-in',
]

let titleOf = (c, lang) => (typeof c.title === 'function' ? c.title(lang) : c.title)

//語系案例: 順序與 mocha it 相同 (產製順序 ≡ 比對順序; 只比對之 E2E-015 產製端不執行); title 為 mocha it 標題 (--grep 依之).
//只比對之案例 (compareOnly) 直接宣告其比對之共用圖鍵為 stages, run 回傳 { 共用圖鍵: buf }; 篩選器之 --names 解析只由產圖案例負責寫檔
//(--names E2E-002-wrong-pw 只選到 E2E-002; 點名只比對案例則報「不產圖」). 2026-09-28 移除原為閃避舊篩選器缺陷之 sharedKey 包裝.
let cases = [
    ...testUsers.filter((u) => !u.fullFlow && !u.customTest).map((u) => ({
        name: u.screenshotName,
        title: `${u.screenshotName}: ${u.account} (expect: ${u.expect})`,
        //E2E-001 為共通進場路徑之專用案例（逐步四張，見 runLoginOkStepped）；其餘單張
        run: u.screenshotName === 'E2E-001-ok' ? runLoginOkStepped(u) : runSimpleLogin(u),
        stages: u.screenshotName === 'E2E-001-ok' ? LOGIN_STEP_KEYS : [u.screenshotName],
        semantic: specSemantic,
    })),
    {
        // notverify 承接式 journey = 一個 case (E2E-003 ~ 007), 一個 browser 走完整段, 內含 5 階段截圖.
        // 後段 state 承接前段真實副作用 (登入失敗→重寄→寄出信→AgentMail 收信開驗證連結→驗證後登入),
        // 無法乾淨 seed 中間點, 故不硬拆獨立 case (詳全域技能「承接式 journey = 一個 case 多截圖」).
        // 案例鍵沿用原 mocha 標題之鍵; 外部依賴 AgentMail (未設 AGENTMAIL_API_KEY 即 fail-fast)
        name: 'E2E-003~007-notverify-full-flow',
        title: `E2E-003~007-notverify-full-flow: 未驗證完整流程 (一個 case, 5 階段截圖)`,
        run: async (page, lang) => {
            let { bufs, specHits } = await notVerifiedFullFlow(page, lang)
            return { shots: bufs, specHits }
        },
        stages: nvNames,
        semantic: async (ctx) => {
            //語意斷言: notVerifiedFullFlow 內每階段完成後即時抓 spec 文字, 結果存 specHits[name] (原本產製端丟棄, 只比對端斷言)
            let { specHits } = ctx.result
            for (let name of nvNames) {
                let hit = specHits[name]
                assert.strict.notEqual(hit, undefined, `specHits 缺 "${name}", recordSpec 邏輯異常`)
                assert.strict.equal(hit.ok, true, `語意斷言失敗 (${name}): ${hit.err}`)
            }
        },
    },
    {
        // 011: view=backstage — backstage 為全螢幕 WDrawer 佈局，無 .sb；框左側選單可見項目（backstageMenuBox，非管理者僅「使用者資訊」一項）。
        // 2026-09-28 改：原傳 'body' 框整頁（整張圖一個框＝沒有指出任何東西），且與同畫面之 e2e-autologin E2E-009 框法不對稱
        name: 'E2E-011-view-backstage',
        title: 'E2E-011-view-backstage',
        run: (page, lang) => {
            let u = testUsers.find((u) => u.account === 'login-ok')
            return loginAndScreenshot(page, lang, u.account, u.rawPassword, 'backstage', backstageMenuBox(), 'E2E-011-view-backstage')
        },
        stages: ['E2E-011-view-backstage'],
        semantic: specSemantic,
    },
    {
        // 012: view=user
        name: 'E2E-012-view-user',
        title: 'E2E-012-view-user',
        run: (page, lang) => {
            let u = testUsers.find((u) => u.account === 'login-ok')
            return loginAndScreenshot(page, lang, u.account, u.rawPassword, 'user', '.sb', 'E2E-012-view-user')
        },
        stages: ['E2E-012-view-user'],
        semantic: specSemantic,
    },
    {
        // 013: resend invalid account/email — 框 resendError 紅字本身
        name: 'E2E-013-resend-invalid-account',
        title: 'E2E-013-resend-invalid-account',
        run: (page, lang) => {
            let u = testUsers.find((u) => u.customTest === 'c1')
            let eSpec013 = expectedSpecText['E2E-013-resend-invalid-account'][lang]
            return resendErrorFlow(page, lang, u.account, u.rawPassword, 'wrong-email@nowhere.com', null,
                page.getByText(eSpec013.value, { exact: false }).first(), 'E2E-013-resend-invalid-account')
        },
        stages: ['E2E-013-resend-invalid-account'],
        semantic: specSemantic,
    },
    {
        // 014: resend already verified (送出前動態標記為已驗證) — 框 resendError 紅字本身
        name: 'E2E-014-resend-already-verified',
        title: 'E2E-014-resend-already-verified',
        run: (page, lang) => {
            let u = testUsers.find((u) => u.customTest === 'c2')
            let eSpec014 = expectedSpecText['E2E-014-resend-already-verified'][lang]
            return resendErrorFlow(page, lang, u.account, u.rawPassword, u.email, async () => {
                await woItems.users.save({ id: u.id, timeVerified: '2025-06-01T00:00:00.000+08:00' })
            }, page.getByText(eSpec014.value, { exact: false }).first(), 'E2E-014-resend-already-verified')
        },
        stages: ['E2E-014-resend-already-verified'],
        semantic: specSemantic,
    },
    {
        // 015: account not exist (security: 防帳號列舉, 與 002 共用 baseline) — 框 loginError 紅字本身（與 002 相同訊息）
        name: 'E2E-015-account-not-exist',
        title: (lang) => `E2E-015-account-not-exist (共用 login-${lang}-002-wrong-pw baseline)`,
        compareOnly: true,
        stages: ['E2E-002-wrong-pw'],
        beforeRun: async () => {
            //刪掉 login-wrongpw 使此帳號不存在, 使用相同輸入驗證截圖與 002 完全一致 (原 it 首行, 於 seed 與開瀏覽器之後)
            let u = testUsers.find((u) => u.account === 'login-wrongpw')
            await woItems.users.del({ id: u.id }).catch(() => {})
        },
        run: async (page, lang) => {
            let u = testUsers.find((u) => u.account === 'login-wrongpw')
            let eSpec015 = expectedSpecText['E2E-015-account-not-exist'][lang]
            let buf = await loginAndScreenshot(page, lang, u.account, u.rawPassword, null,
                page.getByText(eSpec015.value, { exact: false }).first(), 'E2E-015-account-not-exist')
            return { 'E2E-002-wrong-pw': buf } //以共用圖鍵回傳 (比對 E2E-002 之標準圖)
        },
        semantic: specSemantic,
    },
    {
        // 016: login no redir — 框 loginError 紅字本身
        name: 'E2E-016-login-no-redir',
        title: 'E2E-016-login-no-redir',
        run: (page, lang) => {
            let u = testUsers.find((u) => u.customTest === 'd2')
            let eSpec016 = expectedSpecText['E2E-016-login-no-redir'][lang]
            return loginAndScreenshot(page, lang, u.account, u.rawPassword, null,
                page.getByText(eSpec016.value, { exact: false }).first(), 'E2E-016-login-no-redir')
        },
        stages: ['E2E-016-login-no-redir'],
        semantic: specSemantic,
    },
]

//PageLogin 密碼欄 eye icon toggle (UI 細節, 對應 spec/流程_使用者一般登入.md 重要流程 E2E-017 / E2E-018):
//不分語系 (純 UI 元件互動, eng / cht 行為一致), 只跑 eng baseline 1 份 (langs: ['eng']); 原產製端與比對端皆不重置 DB (seedDb: false).
//產製端於兩語系案例之後執行 (同原產製順序與 mocha describe 順序). DOM 語意斷言於 run 內截圖前 (原比對端之位置).
let eyeCases = [
    {
        name: 'E2E-017-password-hidden',
        title: 'E2E-017-password-hidden: 預設遮罩態 (input type=password, eye icon = mdi-eye-off)',
        langs: ['eng'],
        seedDb: false,
        run: runEyeHidden,
        stages: ['E2E-017-password-hidden'],
    },
    {
        name: 'E2E-018-password-shown',
        title: 'E2E-018-password-shown: 點 eye icon → 切換明文 (input type=text, eye icon = mdi-eye)',
        langs: ['eng'],
        seedDb: false,
        run: runEyeShown,
        stages: ['E2E-018-password-shown'],
    },
]
let eyeNames = new Set(eyeCases.map((c) => c.name))

//單一案例管線: per-case DB 重置 (乾淨 base seed + testUsers; eye 案例不動 DB) + fresh browser (新 context, 自動接受 dialog)
//→ 流程 → 語意斷言 → 寫檔 / 比對 → 關瀏覽器 → 清資料. 只比對之案例 (compareOnly): 以宣告之共用圖鍵比對, 產製端不寫;
//fail-dump 標籤帶案例名 (兩案比對同一張圖時可分辨是哪一案失敗)
async function runCase(mode, lang, c, extra = {}) {
    let seedDb = c.seedDb !== false
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        compareOnly: !!c.compareOnly,
        beforeRun: c.beforeRun,
        semantic: c.semantic,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => (c.compareOnly ? `login-${lg}-${c.name}-shared-${key}` : `login-${lg}-${key}`),
        match: assertBaselineMatch,
        prepare: seedDb
            ? async () => {
                await deleteTestUsers()
                await insertTestUsers()
            }
            : null,
        afterCase: seedDb
            ? async () => {
                await deleteTestUsers()
            }
            : null,
        ...extra,
    })
}


// --- 產生標準圖模式 ---

async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    //截圖前篩選 (--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR); 不符任何鍵或點名只比對之案例即於此報錯
    let gate = createBaselineGate({ langs, cases: [...cases, ...eyeCases] })
    console.log(gate.describe())
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    //per-case cold browser: runBaselineCase 每案各自 launch 新 browser, 與 mocha test mode 之 per-case 結構完全一致.
    for (let lang of gate.langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
        for (let c of gate.casesFor(lang).filter((c) => !eyeNames.has(c.name))) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }

    //eye toggle (eng only): 017 / 018 各自獨立 case, 各自 cold browser, 於兩語系之後 (同原產製順序)
    for (let c of gate.casesFor('eng').filter((c) => eyeNames.has(c.name))) {
        console.log(`=== eye toggle ${c.name} (eng) ===`)
        await runCase('regen', 'eng', c, { gate })
    }

    //--names 之任一項未產出即報錯 (不靜默略過)
    gate.finalize()

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

        describe(`Login E2E [${lang}] — 各種登入狀態`, function() {
            this.timeout(180000)

            before(async function() {
                this.timeout(180000) // 第一次須等前端首次編譯（~15-30s），給寬鬆 timeout
                await startServersOnce()
            })

            //per-case 標準 (全域技能 role-coder-for-test-e2e §6): 每個 it() 由 runCase 重置 DB (乾淨 base seed + testUsers)
            //+ launch 全新 browser/context/page, 不跨 case 帶 cookie/localStorage/狀態; 語意斷言 (主) 於比對標準圖 (補強) 之前
            for (let c of cases) {
                it(titleOf(c, lang), async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }
        })

    }


    //
    // PageLogin 密碼欄 eye icon toggle (UI 細節, 對應 spec/流程_使用者一般登入.md 重要流程 E2E-017 / E2E-018)
    //
    // 共用 WText 元件提供; 此處於 PageLogin 一處驗證 toggle 行為 (input type 與 mdi-eye class 切換)
    // + baseline pixel 比對確保視覺端不破版.
    // 不分語系: 純 UI 元件互動, 同 eng / cht 行為一致, 故只跑 eng baseline 1 份.
    //
    describe('Login E2E — PageLogin 密碼欄 eye toggle (E2E-017 / E2E-018)', function() {
        this.timeout(60000)

        //per-case 獨立: 標準圖案例由 runCase、手寫 it 由 withFreshPage 各自 fresh browser + setupEyePage, 每 case 從 default state 起跳
        beforeEach(async function() {
            this.timeout(180000)
            await startServersOnce()
        })

        for (let c of eyeCases) {
            it(c.title, async function() {
                await runCase('compare', 'eng', c, { onKnownDefect: () => this.skip() })
            })
        }

        it('toggle-back-to-hidden: 點兩次 eye 回隱藏態 (DOM only, 與 E2E-017 視覺等同, 不重複 baseline)', async function() {
            await withFreshPage(async (page) => {
                //開乾淨 eng 登入頁 + 等表單渲染 + 輸入 sample 密碼 (與標準圖案例共用 setupEyePage, 避免前置 drift)
                await setupEyePage(page)
                await page.locator('[shellellipse="rightIcon"]').first().click()
                await page.waitForTimeout(300)
                await page.locator('[shellellipse="rightIcon"]').first().click()
                await page.waitForTimeout(300)
                let state = await readToggleState(page)
                assert.strict.equal(state.type, 'password', `二次點擊後應回 password type, 實際 ${state.type}`)
                assert.strict.equal(state.iconPath, mdiEyeOff, `二次點擊後應回 eye-off (閉眼) 圖示, SVG path 應為 mdiEyeOff`)
            })
        })
    })

}
