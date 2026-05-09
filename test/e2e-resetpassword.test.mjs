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
// E2E reset-password test — 驗證「後台重設使用者密碼」流程畫面（中英文版）
//
// 對應流程文件：z流程_後台重設使用者密碼.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-resetpassword.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-resetpassword.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/resetpassword/resetpassword-{lang}-{number}-{name}.png
//
// 涵蓋情境（對應規劃決策 D 1-5, 7, 8, 9）：
//   - 001-checkyes-prompt：使用者用隨機密碼登入後彈 CheckYes
//   - 002-force-form-expanded：按 OK 進 user view, 表單自動展開, cancel 按鈕隱藏
//   - 003-after-success：強制變更密碼成功後 isForceChangePw 變 'n', 表單收回
//   - api-cannot-reset-self：admin 對自己觸發 → reject
//   - api-forbidden-non-admin：非 admin 呼叫 API → reject
//   - api-user-not-found：admin 對不存在 userId 觸發 → reject
//   - force-redirect-to-user：isForceChangePw='y' 訪問 ?view=backstage 仍被拉回 user view
//
// SMTP 失敗仍 success（D8）由 admin reset 流程隱式涵蓋（測試環境本就無真 SMTP）。
//

let baseUrl = 'http://localhost:8080'
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


function bp(lang, name) {
    return path.join(baselineDir, `resetpassword-${lang}-${name}.png`)
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


//經 Vue 應用呼叫 $fapi.<funcName>，回傳 { ok, val? , err? }
//(Vue 2 render 後 #app 會被 template root 取代; 改以 DOM 走訪找出第一個帶 __vue__ 的元素)
async function callFapi(page, funcName, args) {
    return await page.evaluate(async ({ funcName, args }) => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) {
                let r = findVue(c)
                if (r) return r
            }
            return null
        }
        let app = findVue(document.body)
        if (!app) return { ok: false, err: 'no Vue root instance' }
        try {
            let val = await app.$fapi[funcName](...args)
            return { ok: true, val }
        }
        catch (err) {
            let m = (err && typeof err === 'string') ? err : (err && err.message) || String(err)
            return { ok: false, err: m }
        }
    }, { funcName, args })
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
        redir: `http://localhost:8080/?view=backstage&token={token}`,
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
        redir: `http://localhost:8080/?view=user&token={token}`,
    },
    targetCht: {
        id: 'id-rp-target-cht',
        account: 'rp-target-cht',
        rawPassword: 'Pw@RpRand9',
        name: 'Reset Target Cht',
        email: 'rp-target-cht@test.com',
        isAdmin: 'n',
        redir: `http://localhost:8080/?view=user&token={token}`,
    },
    attacker: {
        id: 'id-rp-attacker',
        account: 'rp-attacker',
        rawPassword: 'Pw@rpatk001',
        name: 'Reset Attacker',
        email: 'rp-attacker@test.com',
        isAdmin: 'n',
        redir: `http://localhost:8080/?view=user&token={token}`,
    },
}

//新使用者用作 modifyUserPassword 變更後的密碼
let chosenNewPassword = 'Pw@MyOwn88'

let userTokens = {}


async function insertTestUsersAndTokens() {
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
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await woItems.tokens.del({ userId: u.id }).catch(() => {})
    }
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
    eng: { login: 'Log in', send: 'Send', changePassword: 'Change Password', ok: 'OK', cancel: 'Cancel' },
    cht: { login: '登入', send: '送出', changePassword: '變更密碼', ok: '確認', cancel: '取消' },
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

async function captureCheckYesPrompt(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await inputs.nth(0).fill(target.account)
    await inputs.nth(1).fill(target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //等 CheckYes 浮出（mUI login → updateViewState('user') → PageLogin .then 內 await showCheckYes）
    //showCheckYes 是 Vue dialog, 等 OK 按鈕出現後即可截圖
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(800)
    return await page.screenshot({ fullPage: true })
}

async function captureForceFormExpanded(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await inputs.nth(0).fill(target.account)
    await inputs.nth(1).fill(target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    //等表單展開（input[type=password] x3）
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(1500)
    return await page.screenshot({ fullPage: true })
}

async function captureAfterSuccess(page, lang, target) {
    let t = kpLangText[lang]
    await freshGoto(page, lang)
    let inputs = page.locator('input')
    await inputs.nth(0).fill(target.account)
    await inputs.nth(1).fill(target.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })
    await page.waitForTimeout(800)

    //填三欄: old=隨機密碼(target.rawPassword), new=chosen, confirm=chosen
    let pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill(target.rawPassword)
    await pwInputs.nth(1).fill(chosenNewPassword)
    await pwInputs.nth(2).fill(chosenNewPassword)
    await page.waitForTimeout(300)

    //送出
    await page.locator(`text="${t.send}"`).first().click().catch(() => {})
    //等表單收起 (showChangePassword=false → 沒有 password type input)
    await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length === 0, null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    return await page.screenshot({ fullPage: true })
}


// --- 產生標準圖模式 ---

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let target = lang === 'eng' ? testUsers.targetEng : testUsers.targetCht

    //每個 lang 都重置 target 為 force=y + 已知 raw 密碼
    await simulateAdminReset(target)

    console.log('  001-checkyes-prompt')
    let buf1 = await captureCheckYesPrompt(page, lang, target)
    writeBaseline(lang, '001-checkyes-prompt', buf1)

    //再次模擬 admin reset (002 會用掉 OK 按鈕進 user view, 但流程獨立每個 capture 起點都先 reset)
    await simulateAdminReset(target)

    console.log('  002-force-form-expanded')
    let buf2 = await captureForceFormExpanded(page, lang, target)
    writeBaseline(lang, '002-force-form-expanded', buf2)

    //003 會把密碼改成 chosenNewPassword + isForceChangePw='n'; 須再 reset 才能跑下次
    await simulateAdminReset(target)

    console.log('  003-after-success')
    let buf3 = await captureAfterSuccess(page, lang, target)
    writeBaseline(lang, '003-after-success', buf3)
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    await deleteTestUsersAndTokens()
    await insertTestUsersAndTokens()

    for (let lang of langs) {
        let browser = await chromium.launch({ headless: true })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        await generateBaselineForLang(page, lang)

        await browser.close()
    }

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
        let target = lang === 'eng' ? testUsers.targetEng : testUsers.targetCht

        describe(`ResetPassword E2E [${lang}] — 後台重設使用者密碼流程`, function() {
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

            it('001-checkyes-prompt: 使用者用隨機密碼登入 → 顯示 CheckYes 強制變更提示', async function() {
                await simulateAdminReset(target)
                let buf = await captureCheckYesPrompt(page, lang, target)
                let baselinePath = bp(lang, '001-checkyes-prompt')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: resetpassword-${lang}-001-checkyes-prompt`)
            })

            it('002-force-form-expanded: 按 OK 進 user view → 表單自動展開, cancel 隱藏', async function() {
                await simulateAdminReset(target)
                let buf = await captureForceFormExpanded(page, lang, target)
                let baselinePath = bp(lang, '002-force-form-expanded')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: resetpassword-${lang}-002-force-form-expanded`)
                await assertSbOverflows(page, `resetpassword-${lang}-002-force-form-expanded`)

                //驗證 cancel 按鈕真的不存在 (force mode hide)
                let t = kpLangText[lang]
                let cancelCount = await page.locator(`text="${t.cancel}"`).count()
                assert.strict.equal(cancelCount, 0, `force mode 下 cancel 按鈕應隱藏，實際看見 ${cancelCount} 個`)
            })

            it('003-after-success: 強制變更密碼成功 → 表單收回 + isForceChangePw=n', async function() {
                await simulateAdminReset(target)
                let buf = await captureAfterSuccess(page, lang, target)
                let baselinePath = bp(lang, '003-after-success')
                assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                let baselineBuf = fs.readFileSync(baselinePath)
                assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: resetpassword-${lang}-003-after-success`)

                //驗證後端 DB 內 isForceChangePw 已清為 'n'
                let us = await woItems.users.select({ id: target.id })
                assert.strict.equal(us.length, 1, `target user 應存在`)
                assert.strict.equal(us[0].isForceChangePw, 'n', `變更成功後 isForceChangePw 應為 'n', 實際 ${us[0].isForceChangePw}`)
            })

            it('force-redirect-to-user: isForceChangePw=y 訪問 ?view=backstage 仍被拉回 user view', async function() {
                await simulateAdminReset(target)
                let t = kpLangText[lang]

                //登入流程同 002, 但 query 帶 view=backstage (admin 該轉址但 force 應壓過)
                //URL 帶 ?lang=<lang> 後 SPA 會自動套語系, 不需再 setLang (避免找不到 'English' label)
                await page.goto(`${baseUrl}/?view=backstage&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
                await page.evaluate(() => localStorage.clear())
                await page.goto(`${baseUrl}/?view=backstage&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
                await page.waitForTimeout(2500)

                let inputs = page.locator('input')
                await inputs.nth(0).fill(target.account)
                await inputs.nth(1).fill(target.rawPassword)
                await page.waitForTimeout(300)
                await page.locator(`text="${t.login}"`).first().click()
                await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 15000 })
                await page.locator(`text="${t.ok}"`).first().click()
                await page.waitForFunction(() => document.querySelectorAll('input[type="password"]').length >= 3, null, { timeout: 15000 })

                //已落到 user view 且 force-mode form 展開, 也代表 backstage 並未顯示
                let pwInputCount = await page.locator('input[type="password"]').count()
                assert.strict.equal(pwInputCount, 3, `應有 3 個 password input (force form 展開), 實際 ${pwInputCount}`)
                //backstage 才會出現的 nav 按鈕（例如 Users list）不應存在
                let usersLinkCount = await page.locator('text="Users"').count()
                assert.strict.equal(usersLinkCount, 0, `不應顯示 backstage 的 Users 連結, 實際 ${usersLinkCount}`)
            })

        })

    }


    // --- API 層級拒絕情境 (語系無關, 各跑一輪即可) ---

    describe(`ResetPassword E2E API — adminResetUserPassword 拒絕情境`, function() {
        this.timeout(60000)

        let browser
        let page

        before(async function() {
            this.timeout(180000)
            await startServersOnce()

            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokens()

            browser = await chromium.launch({ headless: true })
            let context = await browser.newContext()
            page = await context.newPage()

            //先載入 SPA 才有 $fapi 可用 (透過 #app __vue__)
            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
            await page.waitForTimeout(2500)
        })

        after(async function() {
            if (browser) {
                await browser.close()
            }
            await deleteTestUsersAndTokens()
        })

        it('cannot-reset-self: admin 對自己觸發 → reject "cannot reset self"', async function() {
            let adminToken = userTokens[testUsers.admin.id]
            let r = await callFapi(page, 'adminResetUserPassword', [adminToken, 'eng', testUsers.admin.id])
            assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
            assert.strict.equal(r.err, 'cannot reset self', `錯誤訊息應為 'cannot reset self', 實際: ${r.err}`)
        })

        it('forbidden-non-admin: 非 admin 呼叫 → reject "forbidden"', async function() {
            let attackerToken = userTokens[testUsers.attacker.id]
            let r = await callFapi(page, 'adminResetUserPassword', [attackerToken, 'eng', testUsers.targetEng.id])
            assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
            assert.strict.equal(r.err, 'forbidden', `錯誤訊息應為 'forbidden', 實際: ${r.err}`)
        })

        it('user-not-found: admin 對不存在 userId 觸發 → reject "user not found"', async function() {
            let adminToken = userTokens[testUsers.admin.id]
            let r = await callFapi(page, 'adminResetUserPassword', [adminToken, 'eng', 'id-not-exist-xyz'])
            assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
            assert.strict.equal(r.err, 'user not found', `錯誤訊息應為 'user not found', 實際: ${r.err}`)
        })

        it('invalid-userId-empty: admin 帶空字串 userId → reject "invalid userId"', async function() {
            let adminToken = userTokens[testUsers.admin.id]
            let r = await callFapi(page, 'adminResetUserPassword', [adminToken, 'eng', ''])
            assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
            assert.strict.equal(r.err, 'invalid userId', `錯誤訊息應為 'invalid userId', 實際: ${r.err}`)
        })

        it('happy-path-side-effect: admin 對 targetEng 觸發成功 → DB password 變更 + isForceChangePw=y', async function() {
            //先確認 DB 起點: target 是 isForceChangePw=n + password=原 hash (剛 insert 後)
            await woItems.users.save({
                id: testUsers.targetEng.id,
                password: hashPassword(testUsers.targetEng.rawPassword, salt),
                isForceChangePw: 'n',
            })
            let beforeUs = await woItems.users.select({ id: testUsers.targetEng.id })
            let originalPwHash = beforeUs[0].password
            assert.strict.equal(beforeUs[0].isForceChangePw, 'n', `起點 isForceChangePw 應為 'n'`)

            let adminToken = userTokens[testUsers.admin.id]
            let r = await callFapi(page, 'adminResetUserPassword', [adminToken, 'eng', testUsers.targetEng.id])
            assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)
            assert.strict.equal(r.val.state, 'success', `回應 state 應為 success`)
            assert.strict.equal(r.val.password, undefined, `回應不應含明文密碼`)
            assert.strict.equal(r.val.newPassword, undefined, `回應不應含明文密碼`)

            //DB 確認
            let afterUs = await woItems.users.select({ id: testUsers.targetEng.id })
            assert.strict.equal(afterUs.length, 1, `target user 仍應存在`)
            assert.strict.equal(afterUs[0].isForceChangePw, 'y', `reset 後 isForceChangePw 應為 'y'`)
            assert.strict.notEqual(afterUs[0].password, originalPwHash, `reset 後 password hash 應改變`)
            assert.strict.notEqual(afterUs[0].password, '', `reset 後 password 不應為空`)
        })

    })

}
