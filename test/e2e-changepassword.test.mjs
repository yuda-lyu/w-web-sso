import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce } from './e2e-setup.mjs'


//
// E2E change password test — 驗證使用者變更密碼流程畫面（中英文版）
//
// 對應流程文件：z流程_使用者變更密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-changepassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-changepassword.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/changepassword/changepassword-{lang}-{number}-{name}.png
//
// 注意：
// - 變更密碼錯誤訊息已改為 inline 紅字（顯示於對應輸入框下方），可 pixel 比對
// - 變更成功通知仍是 alert（被 Playwright dialog handler 自動 dismiss），故 008 截圖
//   呈現「表單收起回 user info」狀態（cancelChangePassword 在 .then 內被呼叫）
//

let baseUrl = 'http://localhost:8080'
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


// --- 新增/重置/刪除測試使用者與 token ---

async function insertTestUserAndToken(lang) {
    let userId = userIdOf(lang)
    let account = accountOf(lang)

    // clean
    await woItems.users.del({ id: userId }).catch(() => {})
    await woItems.tokens.del({ userId }).catch(() => {})

    // user
    let v = ds.users.funNew({
        order: 400,
        account,
        password: hashPassword(originalPassword, salt),
        name: 'ChangePw User',
        email: `${account}@test.com`,
        description: '',
        from: 'test',
        redir: 'http://localhost:8080/?view=user&token={token}',
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
    for (let lang of langs) {
        await woItems.users.del({ id: userIdOf(lang) }).catch(() => {})
        await woItems.tokens.del({ userId: userIdOf(lang) }).catch(() => {})
    }
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
async function fillChangePwForm(page, opt = {}) {
    // input[type="password"] 篩出三個密碼欄位（Old / New / Confirm）
    let pwInputs = page.locator('input[type="password"]')
    if (opt.oldPassword !== undefined) {
        await pwInputs.nth(0).fill(opt.oldPassword)
    }
    if (opt.newPassword !== undefined) {
        await pwInputs.nth(1).fill(opt.newPassword)
    }
    if (opt.confirmPassword !== undefined) {
        await pwInputs.nth(2).fill(opt.confirmPassword)
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
    return await page.screenshot({ fullPage: true })
}

async function captureOldEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    return await page.screenshot({ fullPage: true })
}

async function captureNewEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, { oldPassword: originalPassword })
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    return await page.screenshot({ fullPage: true })
}

async function captureConfirmEmpty(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
    })
    await clickSend(page, lang)
    await page.waitForTimeout(800)
    return await page.screenshot({ fullPage: true })
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
    return await page.screenshot({ fullPage: true })
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
    return await page.screenshot({ fullPage: true })
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
    return await page.screenshot({ fullPage: true })
}

async function captureSuccess(page, lang) {
    await gotoUserViewAndOpenChangePw(page, lang)
    await fillChangePwForm(page, {
        oldPassword: originalPassword,
        newPassword,
        confirmPassword: newPassword,
    })
    await clickSend(page, lang)
    // 等後端 checkUserPassword + changeUserPassword + 寄信 + alert dismiss + cancelChangePassword
    // 寄信 SMTP timeout 較長，須等表單收起（showChangePassword=false）
    await page.waitForFunction(() => {
        // 表單收起時應只有 user info 欄位（無 password type input）
        return document.querySelectorAll('input[type="password"]').length === 0
    }, null, { timeout: 60000 })
    await page.waitForTimeout(1500) // 給 Vue re-render 穩定
    return await page.screenshot({ fullPage: true })
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    // 每個 lang 開頭重置 user（前一輪 008 success 會改 password）
    await insertTestUserAndToken(lang)

    console.log('  001-form-initial')
    let buf1 = await captureFormInitial(page, lang)
    fs.writeFileSync(bp(lang, '001-form-initial'), buf1)

    console.log('  002-old-empty')
    let buf2 = await captureOldEmpty(page, lang)
    fs.writeFileSync(bp(lang, '002-old-empty'), buf2)

    console.log('  003-new-empty')
    let buf3 = await captureNewEmpty(page, lang)
    fs.writeFileSync(bp(lang, '003-new-empty'), buf3)

    console.log('  004-confirm-empty')
    let buf4 = await captureConfirmEmpty(page, lang)
    fs.writeFileSync(bp(lang, '004-confirm-empty'), buf4)

    console.log('  005-pw-mismatch')
    let buf5 = await capturePwMismatch(page, lang)
    fs.writeFileSync(bp(lang, '005-pw-mismatch'), buf5)

    console.log('  006-pw-policy-fail')
    let buf6 = await capturePwPolicyFail(page, lang)
    fs.writeFileSync(bp(lang, '006-pw-policy-fail'), buf6)

    console.log('  007-old-wrong')
    let buf7 = await captureOldWrong(page, lang)
    fs.writeFileSync(bp(lang, '007-old-wrong'), buf7)

    // 008 會改 user.password；放最後執行避免影響其他情境
    console.log('  008-success')
    let buf8 = await captureSuccess(page, lang)
    fs.writeFileSync(bp(lang, '008-success'), buf8)
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

    await deleteTestUsersAndTokens()

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

        describe(`ChangePassword E2E [${lang}] — 變更密碼流程`, function() {
            this.timeout(120000)

            before(async function() {
                this.timeout(180000)
                await startServersOnce()

                browser = await chromium.launch({ headless: true })
                let context = await browser.newContext()
                page = await context.newPage()

                page.on('dialog', async (dialog) => {
                    await dialog.accept()
                })
            })

            beforeEach(async function() {
                // 每個 it 之前重置 user（008 會改 password；其他情境不會但保險起見）
                await insertTestUserAndToken(lang)
            })

            after(async function() {
                if (browser) {
                    await browser.close()
                }
                await deleteTestUsersAndTokens()
            })

            it('001-form-initial: 點變更密碼，表單剛展開', async function() {
                let buf = await captureFormInitial(page, lang)
                let baselinePath = bp(lang, '001-form-initial')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-001-form-initial`)
            })

            it('002-old-empty: 三欄空送出 → 舊密碼下方紅字', async function() {
                let buf = await captureOldEmpty(page, lang)
                let baselinePath = bp(lang, '002-old-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-002-old-empty`)
            })

            it('003-new-empty: 只填舊密碼送出 → 新密碼下方紅字', async function() {
                let buf = await captureNewEmpty(page, lang)
                let baselinePath = bp(lang, '003-new-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-003-new-empty`)
            })

            it('004-confirm-empty: 填舊+新送出 → 確認密碼下方紅字', async function() {
                let buf = await captureConfirmEmpty(page, lang)
                let baselinePath = bp(lang, '004-confirm-empty')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-004-confirm-empty`)
            })

            it('005-pw-mismatch: 新密碼≠確認密碼 → 確認密碼下方紅字', async function() {
                let buf = await capturePwMismatch(page, lang)
                let baselinePath = bp(lang, '005-pw-mismatch')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-005-pw-mismatch`)
            })

            it('006-pw-policy-fail: 新密碼不符策略 → 新密碼下方紅字', async function() {
                let buf = await capturePwPolicyFail(page, lang)
                let baselinePath = bp(lang, '006-pw-policy-fail')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-006-pw-policy-fail`)
            })

            it('007-old-wrong: 舊密碼錯 → 舊密碼下方紅字「變更失敗」', async function() {
                let buf = await captureOldWrong(page, lang)
                let baselinePath = bp(lang, '007-old-wrong')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-007-old-wrong`)
            })

            it('008-success: 三欄填妥+正確 → 表單收起回 user info', async function() {
                let buf = await captureSuccess(page, lang)
                let baselinePath = bp(lang, '008-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: changepassword-${lang}-008-success`)
            })

        })

    }

}
