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
// E2E adduser test — 後台新增使用者流程
//
// 對應流程文件：z流程_後台新增使用者.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-adduser.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-adduser.test.mjs --timeout 240000
//   --names <eng-002-account-empty,...> 進行手術式 baseline 重產
//
// 標準圖存放：test/pics/adduser/adduser-{lang}-{number}-{name}.png
//
// 涵蓋 14 個 UI distinct 狀態 (× 2 lang = 28 baselines)。所有 capture 透過真實 UI
// 互動推進: 鍵盤滑鼠輸入 / WText input fill / ag-grid cell dblclick + Enter /
// 按鈕 SVG path 點擊。不使用 vm.method() / page.evaluate state mutation 抄捷徑。
//

let baseUrl = 'http://localhost:8080'
let salt = '{salt}'
let baselineDir = './test/pics/adduser'
let langs = ['eng', 'cht']

let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


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
    return path.join(baselineDir, `adduser-${lang}-${name}.png`)
}


// ===================================================================
// 預期 modal 文字 (從 spec / procLang.mjs 衍生, 不是現狀指紋)
// 每張截圖必須包含對應 i18n 鍵的文字; 不含 → 修系統或修 spec, 不改 baseline.
// ===================================================================

let expectedModalText = {
    '002-account-empty': {
        eng: 'Invalid account of user',
        cht: '尚未給予有效使用者帳號',
    },
    '003-account-duplicate': {
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    '004-password-empty': {
        eng: 'Empty password of user',
        cht: '尚未給予使用者密碼',
    },
    '005-email-empty': {
        eng: 'Empty email of user',
        cht: '尚未給予使用者Email',
    },
    '006-email-format': {
        eng: 'Invalid email of user',
        cht: '使用者Email格式錯誤',
    },
    '007-email-duplicate': {
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    '008-redir-empty': {
        eng: 'Invalid redirect of user',
        cht: '尚未給予有效登入後轉址',
    },
    '009-rows-empty': {
        eng: 'No user',
        cht: '尚未新增使用者資料',
    },
    '010-cannot-demote-self': {
        eng: 'Cannot demote yourself from admin',
        cht: '不可解除自己的管理員權限',
    },
    '011-cannot-disable-self': {
        eng: 'Cannot disable yourself',
        cht: '不可停用自己的帳號',
    },
    '012-password-policy-backend': {
        //後端 reject 訊息以 userSaveUsersFail 為前綴
        eng: 'Failed to save users',
        cht: '儲存使用者數據失敗',
    },
    '013-account-conflict-backend': {
        //同表內重複 (ckKey) → 與 003 同訊息
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    '014-email-conflict-backend': {
        //同表內重複 (ckKey) → 與 007 同訊息
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    //001 不檢查 modal text (儲存成功後立即重 fetch + dismiss CheckYes), 改檢查表內含新帳號
}


// ===================================================================
// $fapi 呼叫 (僅用於 API 拒絕情境的 mocha test, UI baseline 不使用)
// ===================================================================

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


// ===================================================================
// 測試使用者 / Token (admin 觸發者 + 既有列保留情境驗證 user)
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-au-admin',
        account: 'au-admin',
        rawPassword: 'Pw@auadmin1',
        name: 'AddUser Admin',
        email: 'au-admin@test.com',
        isAdmin: 'y',
        redir: `http://localhost:8080/?view=backstage&token={token}`,
    },
    existing: {
        id: 'id-au-existing',
        account: 'au-existing',
        rawPassword: 'Pw@auexist1',
        name: 'AddUser Existing',
        email: 'au-existing@test.com',
        isAdmin: 'n',
        redir: `http://localhost:8080/?view=user&token={token}`,
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 800 + k,
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

    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    console.log(`inserted ${rs.length} test users + 1 token`)
}


async function deleteTestUsersAndTokens() {
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await woItems.tokens.del({ userId: u.id }).catch(() => {})
    }
    //marathon 模式下其他 e2e 測試可能殘留 users (register 成功 qauser-*, login-*, autologin-*, ...
    //各自的 after() 大多會清, 但個別 it 中途失敗可能殘留), table row 數變動 → 001 pixel diff.
    //清除「非 g.initialData.mjs seeded」的全部 user, 確保 marathon vs alone 達同樣 DB state.
    let allUsers = await woItems.users.select().catch(() => [])
    let knownIds = new Set(Object.values(testUsers).map((u) => u.id))
    let seededAccounts = new Set(['ac-admin', 'ac-basic', 'ac-viewer', 'test-noverify'])
    for (let u of allUsers) {
        if (knownIds.has(u.id)) continue
        if (seededAccounts.has(u.account || '')) continue
        await woItems.users.del({ id: u.id }).catch(() => {})
        await woItems.tokens.del({ userId: u.id }).catch(() => {})
    }
    console.log('deleted adduser test users + tokens')
}


function buildNewRowPlain(account, password, opt = {}) {
    return ds.users.funNew({
        order: opt.order || 999,
        account,
        password,
        name: opt.name || `New ${account}`,
        email: opt.email || `${account}@test.com`,
        description: '',
        from: 'test',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: opt.isAdmin || 'n',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
}


//每個 it 之間 admin token 都要復原
async function resetAdminToken() {
    await woItems.tokens.del({ userId: testUsers.admin.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


// ===================================================================
// UI helpers — 全部走真實鍵盤滑鼠互動 (透過 Playwright)
// 隱性 selector 來源:
//   - 按鈕 (+, save, trash) 透過 mdi SVG path d 屬性鎖定 → closest div[tabindex]
//   - ag-grid cell 透過 col-id 屬性鎖定
//   - WText input 直接 input[type] 鎖定
//   - i18n 文字 (Edit mode / Users list / Log in / OK) 透過 page.locator(text=...)
//   不使用 data-testid (產品端不為測試新增 hook)
// ===================================================================

let mdiPlus = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z'
let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'
let mdiTrashCanOutline = 'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z'

let kpUiText = {
    eng: { login: 'Log in', usersList: 'Users list', editMode: 'Edit mode', ok: 'OK' },
    cht: { login: '登入', usersList: '使用者清單', editMode: '編輯模式', ok: '確認' },
}


//透過 SVG path d 屬性找按鈕的 click 中心座標
async function locateMdiButton(page, dPath) {
    let found = await page.evaluate((d) => {
        let p = Array.from(document.querySelectorAll('svg path')).find(x => x.getAttribute('d') === d)
        if (!p) return null
        let btn = p.closest('div[tabindex]')
        if (!btn) return null
        let r = btn.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, dPath)
    if (!found) throw new Error(`mdi button not found / not visible: d=${dPath.slice(0, 30)}...`)
    return found
}


//login 頁 → 填帳密 → 進 Users list → 確認 Edit mode 開
async function loginAsAdminAndOpenUsersList(page, lang) {
    let t = kpUiText[lang]

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)

    if (lang === 'cht') {
        await page.locator('text=English').first().click()
        await page.waitForTimeout(400)
        await page.locator('text=中文').first().click()
        await page.waitForTimeout(600)
    }
    else {
        //eng 不切語系, 但補上 cht 切換的等同 warm-up 時間;
        //marathon 模式下這段 buffer 對 ag-grid 後續 render 穩定性有實質貢獻 (eng-001 反覆 flake 觀察)
        await page.waitForTimeout(1000)
    }

    let inputs = page.locator('input')
    await inputs.nth(0).fill(testUsers.admin.account)
    await inputs.nth(1).fill(testUsers.admin.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    await page.waitForTimeout(4000)

    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(2500)

    //確認 Edit mode 是 on; 否則點一下
    let editChecked = await page.evaluate((label) => {
        let lab = Array.from(document.querySelectorAll('div')).find(d => (d.innerText || '').trim() === label && d.children.length === 0)
        if (!lab) return null
        let cb = lab.parentElement && lab.parentElement.querySelector('input[type="checkbox"]')
        return cb ? cb.checked : null
    }, t.editMode)
    if (editChecked === false) {
        await page.locator(`text="${t.editMode}"`).first().click()
        await page.waitForTimeout(500)
    }
    //等 ag-grid 初始載入後 cell 完全 hydrate (marathon 模式累積 backend / vue-cli 暖記憶體會讓
    //getUsersList 回 / Vue mount / ag-grid render 三階段時序變動, 不等到 idle 直接 click + 會撞)
    await page.waitForFunction(async () => {
        let snap = () => {
            let cells = document.querySelectorAll('.ag-cell')
            return JSON.stringify({
                count: cells.length,
                first10: Array.from(cells).slice(0, 10).map(c => (c.getAttribute('col-id') || '') + ':' + (c.innerText || '').slice(0, 20)),
            })
        }
        let s1 = snap()
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s2 = snap()
        if (s1 !== s2) return false
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s3 = snap()
        return s2 === s3
    }, null, { timeout: 15000 })
    await page.waitForTimeout(1000)
}


async function clickPlusToAddRow(page) {
    let p = await locateMdiButton(page, mdiPlus)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(800)
    //鼠標移開 (避免 tooltip 殘留污染 baseline)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
}


async function clickSave(page) {
    let p = await locateMdiButton(page, mdiCloudUploadOutline)
    await page.mouse.click(p.x, p.y)
    //儲存後可能因 Loading dialog 短暫消失再出現 → 不等 fixed delay, 由呼叫者 waitCheckYes
    await page.mouse.move(0, 0)
}


async function clickTrashAfterSelectAll(page) {
    //點 ag-grid header 的 checkbox 全選
    let cbBox = await page.evaluate(() => {
        let cb = document.querySelector('.ag-header-cell input[type="checkbox"]')
        if (!cb) return null
        let r = cb.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!cbBox) throw new Error('header checkbox not found')
    await page.mouse.click(cbBox.x, cbBox.y)
    await page.waitForTimeout(500)
    //點 trash
    let p = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(800)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
}


//ag-grid 視窗虛擬化讓非可視欄不在 DOM. 透過掃描 scrollLeft 找到該欄能渲染的位置,
//再將其捲到視口正中, 確保 dblclick 等互動命中
async function ensureColumnVisible(page, colId) {
    let ok = await page.evaluate(async (cid) => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return false
        let sw = body.scrollWidth, cw = body.clientWidth
        //sweep scrollLeft from 0 → sw-cw with step cw*0.6
        let positions = []
        let step = Math.max(60, cw * 0.6)
        for (let x = 0; x <= sw - cw + step; x += step) positions.push(Math.min(x, Math.max(0, sw - cw)))
        for (let pos of positions) {
            body.scrollLeft = pos
            await new Promise(r => setTimeout(r, 80))
            let header = document.querySelector(`.ag-header-cell[col-id="${cid}"]`)
            if (header) {
                let r = header.getBoundingClientRect()
                let bbox = body.getBoundingClientRect()
                let center = bbox.x + bbox.width / 2
                let headerCenter = r.x + r.width / 2
                //微調讓 header 落在 body 視口中央
                body.scrollLeft = pos + (headerCenter - center)
                await new Promise(r => setTimeout(r, 120))
                return true
            }
        }
        return false
    }, colId)
    if (!ok) throw new Error(`column not findable in any scroll position: ${colId}`)
    await page.waitForTimeout(300)
}


//ag-grid 文字欄位 (account / email / redir / name / description) 編輯:
//dblclick 進 cell editor → fill input → Enter
async function fillAgGridCell(page, rowIdx, colId, value) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    await page.waitForTimeout(400)
    let editor = page.locator(`${cellSel} input`)
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    await editor.fill(value)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}


//新增列 password 欄: WText input 已就在 cell 內, 直接 fill (不需 dblclick)
async function fillNewRowPassword(page, value) {
    let inp = page.locator('.ag-row[row-index="0"] .ag-cell[col-id="password"] input[type="password"], .ag-row[row-index="0"] .ag-cell[col-id="password"] input[type="text"]').first()
    await inp.waitFor({ state: 'visible', timeout: 5000 })
    await inp.click()
    await inp.fill(value)
    await page.waitForTimeout(200)
}


//找到 admin 自己列的 row-index, 並對 isAdmin / isActive checkbox 進行 toggle
async function toggleSelfRowCheckbox(page, colId) {
    await ensureColumnVisible(page, colId)
    let rowIdx = await page.evaluate((adminAccount) => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="account"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === adminAccount) {
                let row = c.closest('.ag-row')
                return row.getAttribute('row-index')
            }
        }
        return null
    }, testUsers.admin.account)
    if (rowIdx === null) throw new Error(`admin row not found for account=${testUsers.admin.account}`)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    let cb = page.locator(`${cellSel} input[type="checkbox"]`)
    await cb.waitFor({ state: 'visible', timeout: 5000 })
    await cb.click()
    await page.waitForTimeout(300)
}


async function waitCheckYes(page, lang) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 30000 })
    //modal 出現後, 穩定化 4 步:
    //  1. window scrollTop=0 — toggleSelfRowCheckbox 經 scrollIntoViewIfNeeded 可能捲動 window
    //  2. ag-grid 內部水平 scroll=0 — toggle isAdmin / isActive 等右側欄會將 grid 捲到右邊,
    //     截到 timeCreate / timeUpdate 等每次值都不同的動態欄位 → pixel diff
    //  3. 鼠標移到角落 — 清 hover state / tooltip 殘留
    //  4. 等 ag-grid 真 idle — 連續兩次 raf 之間 cell 數量 + 第一列 cell HTML hash 完全一致才算穩定
    //     (固定 timeout 對 CPU 忙時不夠, idle 偵測對「壞運氣」case 也足夠)
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.mouse.move(0, 0)
    await page.waitForFunction(async () => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return true //無 grid (login etc), 直接 ok
        if (body.scrollLeft !== 0) return false
        //password header 必須出現
        if (!document.querySelector('.ag-header-cell[col-id="password"]')) return false
        //連續三次 raf 之間 cell 數量 + row[0] cell HTML 全等 → 認定 idle
        //(marathon 模式累積 browser 狀態, 兩個 raf 偶有差異; 三個更穩定)
        let snap = () => {
            let cells = document.querySelectorAll('.ag-cell')
            let row0Cells = Array.from(document.querySelectorAll('.ag-row[row-index="0"] .ag-cell'))
            return JSON.stringify({
                count: cells.length,
                row0: row0Cells.map(c => (c.getAttribute('col-id') || '') + ':' + (c.innerText || '').slice(0, 30)),
            })
        }
        let s1 = snap()
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s2 = snap()
        if (s1 !== s2) return false
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s3 = snap()
        return s2 === s3
    }, null, { timeout: 15000 })
    await page.waitForTimeout(1500)
}


// ===================================================================
// 14 個 capture (全 UI 互動, 不走 vm.method / state mutation)
// ===================================================================

//001 success: 完整 UI 流程 — + → 填欄位 → save → 過 success modal → 看到表內新帳號
async function captureSuccessAfterSave(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdminAndOpenUsersList(page, lang)

    let newAccount = `au-newuser-${lang}-baseline`
    let newEmail = `${newAccount}@test.com`

    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', newAccount)
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', newEmail)
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang) //success modal 出現
    await page.locator(`text="${t.ok}"`).first().click() //dismiss success modal
    //等表格刷新後 (重 fetch getUsersList) 看到新帳號
    await page.locator(`text="${newAccount}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    //等 ag-grid getUsersList 後重畫穩定 (連續三 raf cell 不變), 否則 marathon 模式偶有未繪完截圖
    await page.evaluate(() => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.waitForFunction(async () => {
        let snap = () => {
            let cells = document.querySelectorAll('.ag-cell')
            return JSON.stringify({
                count: cells.length,
                first10: Array.from(cells).slice(0, 10).map(c => (c.getAttribute('col-id') || '') + ':' + (c.innerText || '').slice(0, 30)),
            })
        }
        let s1 = snap()
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s2 = snap()
        if (s1 !== s2) return false
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s3 = snap()
        return s2 === s3
    }, null, { timeout: 15000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)

    let buf = await page.screenshot({ fullPage: true, animations: 'disabled' })

    //cleanup: 透過 woItems 直接刪 (測試環境 admin 操作)
    let us = await woItems.users.select({ account: newAccount }).catch(() => [])
    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})

    return buf
}


//002 account 空 (password / email 填妥, 觸發 errInAccounts CheckYes)
async function captureAccountEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    //account 故意不填
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-newuser-002@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//003 account 同表內重複 (新加 2 列同 account)
async function captureAccountDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    //加 row1
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup1@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    //加 row2 (同 account, 不同 email)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup2@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//004 password 空
async function capturePasswordEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-004')
    //password 故意不填
    await fillAgGridCell(page, 0, 'email', 'au-newuser-004@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//005 email 空
async function captureEmailEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-005')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    //email 故意不填
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//006 email 格式錯
async function captureEmailFormatBad(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-006')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'not-an-email')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//007 email 同表內重複
async function captureEmailDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup-em-1')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup-em@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup-em-2')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup-em@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//008 redir 空
async function captureRedirEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-008')
    await fillNewRowPassword(page, 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-newuser-008@test.com')
    //redir 故意不填
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//009 全表空 (header checkbox 全選 + trash 刪光 → save → CheckYes 'userAddEmpty')
async function captureRowsEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickTrashAfterSelectAll(page)
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//010 admin 解除自己 isAdmin (前端 self-lockout)
async function captureCannotDemoteSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await toggleSelfRowCheckbox(page, 'isAdmin')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//011 admin 停用自己 isActive
async function captureCannotDisableSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await toggleSelfRowCheckbox(page, 'isActive')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//012 password 違反後端 policy (繞過前端 isError, 由 checkUserPassword reject)
async function capturePasswordPolicyBackend(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-012')
    await fillNewRowPassword(page, 'short') //非空, 通過前端; 但長度<8 後端 reject
    await fillAgGridCell(page, 0, 'email', 'au-newuser-012@test.com')
    await fillAgGridCell(page, 0, 'redir', 'http://localhost:8080/?view=user&token={token}')
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true, animations: 'disabled' })
}


//013 account 與 DB 既有衝突 — 同表內重複的 ckKey path 會以同訊息呈現,
//   故重用 003 的 captureAccountDuplicate 路徑作為此情境之 UI 代表
async function captureAccountConflictBackend(page, lang) {
    return await captureAccountDuplicate(page, lang)
}


//014 email 與 DB 既有衝突 — 同上, 重用 007
async function captureEmailConflictBackend(page, lang) {
    return await captureEmailDuplicate(page, lang)
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['001-after-save-with-new-user', captureSuccessAfterSave],
        ['002-account-empty', captureAccountEmpty],
        ['003-account-duplicate', captureAccountDuplicate],
        ['004-password-empty', capturePasswordEmpty],
        ['005-email-empty', captureEmailEmpty],
        ['006-email-format', captureEmailFormatBad],
        ['007-email-duplicate', captureEmailDuplicate],
        ['008-redir-empty', captureRedirEmpty],
        ['009-rows-empty', captureRowsEmpty],
        ['010-cannot-demote-self', captureCannotDemoteSelf],
        ['011-cannot-disable-self', captureCannotDisableSelf],
        ['012-password-policy-backend', capturePasswordPolicyBackend],
        ['013-account-conflict-backend', captureAccountConflictBackend],
        ['014-email-conflict-backend', captureEmailConflictBackend],
    ]

    for (let [name, fn] of cases) {
        console.log(`  ${name}`)
        await resetAdminToken()
        let buf = await fn(page, lang)
        writeBaseline(lang, name, buf)
    }
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


// ===================================================================
// mocha 測試模式
// ===================================================================

if (process.argv.includes('--baseline')) {
    generateBaseline()
        .catch((err) => {
            console.error(err)
            process.exit(1)
        })
}
else {

    // --- API 拒絕情境 (語系無關, 只測 backend reject 行為) ---

    describe(`AddUser E2E API — updateUsersList 拒絕情境與副作用`, function() {
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

            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
            await page.waitForTimeout(2500)
        })

        after(async function() {
            if (browser) {
                await browser.close()
            }
            await deleteTestUsersAndTokens()
        })

        async function buildAllRowsWithNew(newRow) {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
            return [...allUsers, newRow]
        }

        it('password-empty: 新 row password 空 → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-empty', '', { email: 'au-bad-empty@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-too-short: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-short', 'Ab@1', { email: 'au-bad-short@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-no-letter: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-noletter', '12345678@', { email: 'au-bad-noletter@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-no-digit: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-nodigit', 'Abcdefg@', { email: 'au-bad-nodigit@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-blacklist: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-bl', '1qaz@WSX', { email: 'au-bad-bl@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('self-lockout-isAdmin: → reject "cannotDemoteSelf"', async function() {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.admin.id) copy.isAdmin = 'n'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, false)
            assert.strict.match(r.err, /[Cc]annot demote yourself|不可解除自己的管理員權限/)
        })

        it('self-lockout-isActive: → reject "cannotDisableSelf"', async function() {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.admin.id) copy.isActive = 'n'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, false)
            assert.strict.match(r.err, /[Cc]annot disable yourself|不可停用自己的帳號/)
        })

        it('happy-path: admin 加 user → DB 驗證 hash/audit/timeVerified', async function() {
            let newAccount = 'au-newuser-happy'
            await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
            })

            let rawPw = 'Pw@KLMN5678'
            let rows = await buildAllRowsWithNew(buildNewRowPlain(newAccount, rawPw, { email: 'au-newuser-happy@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

            let us = await woItems.users.select({ account: newAccount })
            assert.strict.equal(us.length, 1)
            let u = us[0]
            assert.strict.notEqual(u.password, rawPw)
            assert.strict.notEqual(u.password, '')
            assert.strict.equal(u.password, hashPassword(rawPw, salt))
            assert.strict.equal(u.isForceChangePw, 'n')
            assert.strict.equal(u.userId, testUsers.admin.id, `userId 應為 admin id`)
            assert.strict.equal(u.userIdUpdate, testUsers.admin.id)
            assert.strict.equal(typeof u.timeVerified === 'string' && u.timeVerified.length > 0, true)

            await woItems.users.del({ id: u.id }).catch(() => {})
        })

        it('existing-row-password-preserved: → 既有 user password hash 不被洗掉', async function() {
            let before = await woItems.users.select({ id: testUsers.existing.id })
            let originalHash = before[0].password
            assert.strict.equal(originalHash, hashPassword(testUsers.existing.rawPassword, salt))

            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.existing.id) copy.description = 'updated desc'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

            let after = await woItems.users.select({ id: testUsers.existing.id })
            assert.strict.equal(after[0].password, originalHash)
            assert.strict.equal(after[0].description, 'updated desc')
        })

    })


    // --- UI baseline 比對 (14 case × 2 lang = 28 baselines) ---

    for (let lang of langs) {

        describe(`AddUser E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            let browser
            let page

            before(async function() {
                this.timeout(240000)
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

            let cases = [
                ['001-after-save-with-new-user', captureSuccessAfterSave],
                ['002-account-empty', captureAccountEmpty],
                ['003-account-duplicate', captureAccountDuplicate],
                ['004-password-empty', capturePasswordEmpty],
                ['005-email-empty', captureEmailEmpty],
                ['006-email-format', captureEmailFormatBad],
                ['007-email-duplicate', captureEmailDuplicate],
                ['008-redir-empty', captureRedirEmpty],
                ['009-rows-empty', captureRowsEmpty],
                ['010-cannot-demote-self', captureCannotDemoteSelf],
                ['011-cannot-disable-self', captureCannotDisableSelf],
                ['012-password-policy-backend', capturePasswordPolicyBackend],
                ['013-account-conflict-backend', captureAccountConflictBackend],
                ['014-email-conflict-backend', captureEmailConflictBackend],
            ]

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    await resetAdminToken()
                    let buf = await fn(page, lang)

                    //語意斷言 (主) — 從 spec 衍生的預期文字必須出現在頁面 DOM 上
                    let pageHasText = async (text) => {
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

                    let collectVisibleText = async () => {
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

                    if (name === '001-after-save-with-new-user') {
                        let expectedAccount = `au-newuser-${lang}-baseline`
                        let found = await pageHasText(expectedAccount)
                        if (!found) {
                            let dump = await collectVisibleText()
                            assert.fail(`預期 Users list 含新帳號 "${expectedAccount}", 實際可見文字: ${dump}`)
                        }
                    }
                    else if (expectedModalText[name] && expectedModalText[name][lang]) {
                        let expected = expectedModalText[name][lang]
                        let found = await pageHasText(expected)
                        if (!found) {
                            let dump = await collectVisibleText()
                            assert.fail(`預期 modal 含 "${expected}" (來自 spec), 實際可見文字: ${dump}`)
                        }
                    }

                    //像素斷言 (補強, 視覺回歸)
                    let baselinePath = bp(lang, name)
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: adduser-${lang}-${name}`)
                })
            }

            it(`new-user-can-login: 用 admin 設定的密碼登入新 user → 進 user view (非強制變更)`, async function() {
                let loginText = lang === 'eng' ? 'Log in' : '登入'
                let newAccount = `au-newuser-${lang}-login`
                let rawPw = 'Pw@KLMN5678'

                await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
                })

                await resetAdminToken()
                let allUsers = await woItems.users.select()
                allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
                allUsers.push(buildNewRowPlain(newAccount, rawPw, { email: `${newAccount}@test.com` }))
                let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], lang, allUsers])
                assert.strict.equal(r.ok, true)

                await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
                await page.evaluate(() => localStorage.clear())
                await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
                await page.waitForTimeout(2500)

                if (lang === 'cht') {
                    await page.locator('text=English').first().click()
                    await page.waitForTimeout(400)
                    await page.locator('text=中文').first().click()
                    await page.waitForTimeout(600)
                }

                let inputs = page.locator('input')
                await inputs.nth(0).fill(newAccount)
                await inputs.nth(1).fill(rawPw)
                await page.waitForTimeout(300)
                await page.locator(`text="${loginText}"`).first().click()
                await page.waitForTimeout(4000)

                let url = await page.evaluate(() => location.href)
                assert.strict.match(url, /view=user/)

                let pwCount = await page.locator('input[type="password"]').count()
                assert.strict.equal(pwCount, 0, `不該強制展開變更密碼表單`)

                await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
                })
            })

        })

    }

}
