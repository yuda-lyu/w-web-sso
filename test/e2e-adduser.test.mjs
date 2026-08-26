import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, assertBaselineMatch, baseUrl, resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// E2E adduser test — 後台新增使用者流程
//
// 對應流程文件：spec/流程_後台新增使用者.md
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


//是否需要產生此 case 的標準圖. --names 指定時只有指定 case 回 true → 連「截圖」都跳過 (非僅跳寫檔).
function shouldGen(lang, name) {
    return !baselineNamesFilter || baselineNamesFilter.has(`${lang}-${name}`)
}


function bp(lang, name) {
    return path.join(baselineDir, `adduser-${lang}-${name}.png`)
}


// ===================================================================
// 預期 modal 文字 (從 spec / procLang.mjs 衍生, 不是現狀指紋)
// 每張截圖必須包含對應 i18n 鍵的文字; 不含 → 修系統或修 spec, 不改 baseline.
// ===================================================================

let expectedModalText = {
    'E2E-002-account-empty': {
        eng: 'Invalid account of user',
        cht: '尚未給予有效使用者帳號',
    },
    'E2E-003-account-duplicate': {
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    'E2E-004-password-empty': {
        eng: 'Empty password of user',
        cht: '尚未給予使用者密碼',
    },
    'E2E-005-email-empty': {
        eng: 'Empty email of user',
        cht: '尚未給予使用者Email',
    },
    'E2E-006-email-format': {
        eng: 'Invalid email of user',
        cht: '使用者Email格式錯誤',
    },
    'E2E-007-email-duplicate': {
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    'E2E-008-redir-empty': {
        eng: 'Invalid redirect of user',
        cht: '尚未給予有效登入後轉址',
    },
    'E2E-009-rows-empty': {
        eng: 'No user',
        cht: '尚未新增使用者資料',
    },
    'E2E-010-cannot-demote-self': {
        eng: 'Cannot demote yourself from admin',
        cht: '不可解除自己的管理員權限',
    },
    'E2E-011-cannot-disable-self': {
        eng: 'Cannot disable yourself',
        cht: '不可停用自己的帳號',
    },
    'E2E-012-password-policy-backend': {
        //後端 reject 訊息以 userSaveUsersFail 為前綴
        eng: 'Failed to save users',
        cht: '儲存使用者數據失敗',
    },
    'E2E-013-account-conflict-backend': {
        //同表內重複 (ckKey) → 與 003 同訊息
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    'E2E-014-email-conflict-backend': {
        //同表內重複 (ckKey) → 與 007 同訊息
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    'E2E-015-token-expired-backend': {
        //後端 token 過期 / 非 admin 共用 userSaveUsersFail 前綴 (不洩露身分檢查細節)
        eng: 'Failed to save users',
        cht: '儲存使用者數據失敗',
    },
    //001 happy-path: 補成功 modal 文字斷言 (見 expectedSuccessModalText) + 表內含新帳號雙重驗證
}


//儲存成功時 CheckYes modal 顯示之文字 (procLang.mjs userSaveUsersSuccess, type:'success').
//對應 spec/流程_後台新增使用者.md 之儲存成功路徑 (與 LayoutContentUsers.vue saveUsers
//showCheckYes(userSaveUsersSuccess) 一致). E2E-001 happy-path 於成功 modal 顯示中 (截 stage2 modal 後、
//按確認鈕關閉前) 斷言此文字, 否則點 OK 後 modal dismiss 即無法再驗.
let expectedSuccessModalText = {
    eng: 'Save users successfully',
    cht: '儲存使用者數據成功',
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
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
    existing: {
        id: 'id-au-existing',
        account: 'au-existing',
        rawPassword: 'Pw@auexist1',
        name: 'AddUser Existing',
        email: 'au-existing@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
}

let userTokens = {}


//凍結所有 user 的 timeCreate / timeUpdate, 避免 E2E-011 等捲到右側 Created/Updated time 欄時
//顯示動態 wall-clock → pixel flake (對齊 tokens FIX_TIME / modifyuser normalizeUserTimes 慣例).
let FIX_TIME = '2025-01-01T00:00:00.000+08:00'


async function normalizeUserTimes() {
    let us = await woItems.users.select().catch(() => [])
    for (let u of us) {
        if (u.timeCreate !== FIX_TIME || u.timeUpdate !== FIX_TIME) {
            await woItems.users.save({ id: u.id, timeCreate: FIX_TIME, timeUpdate: FIX_TIME }).catch(() => {})
        }
    }
}


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens), 再插入本檔專屬資料.
    //此函式為 mocha hook 與 generateBaseline 共用的 own-insert 單一入口, 放在最前一行即可
    //同時覆蓋兩條路徑 (per-test hermetic setup).
    await resetToBaseSeed()

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

    await normalizeUserTimes() //凍結 Created/Updated time 欄, 防 E2E-011 等捲到右側時 pixel flake
    console.log(`inserted ${rs.length} test users + 1 token`)
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含動態建立的 au-newuser-* / 複製使用者), 保留 base seed.
    await deleteNonBaseSeed()
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
        redir: `${baseUrl}/?view=user&token={token}`,
        isAdmin: opt.isAdmin || 'n',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
}


//每個 it 之間 admin token 都要復原
async function resetAdminToken() {
    //w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


//強制將 admin token 設為過期 (case E2E-015 用): 模擬「填完新列後 token 才過期」場景,
//下次點儲存時後端 checkToken reject → CheckYes modal 含 userSaveUsersFail 前綴.
async function forceExpireAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) {
        _tk.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.save(_tk).catch(() => {})
    }
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
let mdiContentCopy = 'M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z'

let kpUiText = {
    eng: { login: 'Log in', usersList: 'Users list', editMode: 'Edit mode', ok: 'OK', statistics: 'Statistics' },
    cht: { login: '登入', usersList: '使用者清單', editMode: '編輯模式', ok: '確認', statistics: '統計' },
}


//每步驟先偵測對象出現再操作 (10s timeout). 超時拋錯 = 真實異常 (而非 sleep 不夠).
//設計理由: navigate / Vue mount / refetch 都是 async 且時序不可預測, fixed waitForTimeout
//容易撞「sleep 太短點空 body」或「sleep 太長浪費時間」. 改成等具體 DOM 條件再行動.
//arg: 傳給 fn 的參數 (因 page.waitForFunction 內 fn 是序列化跨 process 執行, 不能 closure).
async function waitUntilExist(page, label, fn, opts = {}) {
    let { timeout = 10000, arg = null } = opts
    try {
        await page.waitForFunction(fn, arg, { timeout })
    }
    catch (err) {
        throw new Error(`waitUntilExist 超過 ${timeout}ms 仍找不到「${label}」 — 此為真實異常 (production race / 元件未渲染)`)
    }
}


//真鍵盤輸入 nth(idx) 的 input (取代 .fill() L4 偷工 — 全域 CLAUDE.md §6.3 act 階段操作層級表).
//click 取得 focus → 驗證 activeElement → keyboard.insertText 整段 → 驗證 → 不符則清空重打 (最多 3 次).
//
//用 insertText (非 keyboard.type): type 逐字打在 Vue v-model 場景觸發 N 次 input event → N 次 re-render
//→ focus 中途被吃掉導致漏字 (觀察過: 11 字密碼只進 1 字). insertText 一次 inject 全段, 1 次 input event,
//本專案 WText/WTextCore 沒 hook keydown listener (僅 @input/@focus/@blur/@change/@keyup.enter),
//所以 insertText 跟 type 行為等價. 不碰剪貼簿, scoped 到 page renderer, 不影響其他平行 agent.
async function typeIntoNthInput(page, idx, value) {
    let inp = page.locator('input').nth(idx)
    await inp.waitFor({ state: 'visible', timeout: 5000 })

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await inp.click()
        await page.waitForFunction((i) => {
            let inputs = document.querySelectorAll('input')
            return document.activeElement === inputs[i]
        }, idx, { timeout: 3000 })
        //清空 (Backspace N 次, 不用剪貼簿 / Ctrl+A 組合鍵)
        let cur = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value || '', idx)
        if (cur) {
            await page.keyboard.press('End')
            for (let k = 0; k < cur.length + 2; k++) await page.keyboard.press('Backspace')
        }
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await page.evaluate((i) => {
            let el = document.querySelectorAll('input')[i]
            return el ? el.value : null
        }, idx)
        if (got === value) return

        console.warn(`typeIntoNthInput attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        await page.waitForTimeout(400)
    }

    let final = await page.evaluate((i) => document.querySelectorAll('input')[i]?.value, idx)
    throw new Error(`typeIntoNthInput ${maxAttempts} 次仍漏字: 預期「${value}」(${value.length} 字), 最終「${final}」(${(final || '').length} 字)`)
}


//輔助: 用 Backspace 清空 input.value, 不碰剪貼簿 / 不用 Ctrl+A 組合鍵 (避免影響其他平行 agent 測試)
async function clearInputByBackspace(page, cellSel) {
    let cur = await page.evaluate((sel) => document.querySelector(sel + ' input')?.value || '', cellSel)
    if (!cur) return
    await page.keyboard.press('End')
    for (let i = 0; i < cur.length + 2; i++) {
        await page.keyboard.press('Backspace')
    }
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

    //偵測: 等 login 表單 input 元件出現 (Vue mount + getWebInfor 完成的證明)
    await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2)

    await typeIntoNthInput(page, 0, testUsers.admin.account)
    await typeIntoNthInput(page, 1, testUsers.admin.rawPassword)

    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.locator(`text="${t.login}"`).first().click()

    //login → backstage 為跨頁 redirect, 較久. 一律先 fixed 10s 等 redirect 啟動, 避免
    //偵測抓到「點 Log in 前的 login 頁殘留 DOM」(殘留 DOM 不會立刻被清, redirect 啟動才換).
    await page.waitForTimeout(10000)

    //偵測: 等 backstage Statistics 文字 (login 成功 + redirect 完成)
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics })

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


//ag-grid 文字欄位編輯: dblclick → 偵測 input 出現 → 1s pre-buffer → insertText → 驗證 → retry × 3 → Enter
//(詳細設計理由見全域 CLAUDE.md §6.3 Pattern D)
async function fillAgGridCell(page, rowIdx, colId, value) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    let editor = page.locator(`${cellSel} input`)
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(1000)

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await editor.click()
        await clearInputByBackspace(page, cellSel)
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await page.evaluate((sel) => {
            let el = document.querySelector(sel + ' input')
            return el ? el.value : null
        }, cellSel)
        if (got === value) break
        console.warn(`fillAgGridCell ${colId} attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        if (attempt === maxAttempts) {
            throw new Error(`fillAgGridCell ${colId} ${maxAttempts} 次仍漏字: 預期「${value}」, 最終「${got}」`)
        }
        await page.waitForTimeout(400)
    }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
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
    //[多階段 stage1] 按「+」新增鈕後, 出現空白待填列 (供使用者填入) — 框「新列本身」(首列 row-index=0,
    //跨 pinned-left + center container 取聯集成整列寬), 而非整個表格
    let bufNewRow = await captureStableWithBox(page, ['.ag-pinned-left-cols-container .ag-row[row-index="0"]', '.ag-center-cols-container .ag-row[row-index="0"]'])
    await fillAgGridCell(page, 0, 'account', newAccount)
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', newEmail)
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    await clickSave(page)
    await waitCheckYes(page, lang) //success modal 出現
    //[多階段 stage2] 關閉前先截「儲存成功 modal (綠勾)」— 框 WDialog 內層 panel
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    //語意斷言 (成功 modal 文字): 對應 spec 儲存成功路徑 (LayoutContentUsers.vue showCheckYes(userSaveUsersSuccess)).
    //須在點 OK 關閉前驗 (dismiss 後 DOM 即無此字); mocha 與 --baseline 兩條路徑皆執行.
    let successNeedle = expectedSuccessModalText[lang]
    let hasSuccess = await page.evaluate((s) => (document.body.innerText || '').includes(s), successNeedle)
    assert.strict.equal(hasSuccess, true, `儲存成功 modal 應含成功訊息文字「${successNeedle}」 (E2E-001 happy-path)`)
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

    //[多階段 stage3] 觀看區 = 儲存成功後新使用者「那一列」(剛存入排在首列 row-index=0), 框該列本身
    //而非整表 (聚焦驗證標的: 新使用者已出現於清單)
    let buf = await captureStableWithBox(page, ['.ag-pinned-left-cols-container .ag-row[row-index="0"]', '.ag-center-cols-container .ag-row[row-index="0"]'])

    //cleanup: 透過 woItems 直接刪 (測試環境 admin 操作)
    let us = await woItems.users.select({ account: newAccount }).catch(() => [])
    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})

    //多階段回傳 dict (baselineName → buf); 數字前綴使檔名排序 ≡ 流程階段順序:
    //  1 按+出現空白待填列 → 2 儲存成功 modal(綠勾) → 3 表格新使用者列
    return {
        'E2E-001-1-new-blank-row': bufNewRow,
        'E2E-001-2-save-success-modal': bufModal,
        'E2E-001-3-after-save-with-new-user': buf,
    }
}


//002 account 空 (password / email 填妥, 觸發 errInAccounts CheckYes)
async function captureAccountEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    //account 故意不填
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-newuser-002@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框新列 (row-index=0) 的「account 空格」, 讓讀者看到
    //「正是這個欄位沒填」才觸發錯誤 (modal 蓋住前的狀態)
    await ensureColumnVisible(page, 'account')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="account"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（帳號空的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-002-1-account-empty-cell': bufTrigger,
        'E2E-002-2-account-empty': bufModal,
    }
}


//003 account 同表內重複 (新加 2 列同 account)
async function captureAccountDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    //加 row1
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup1@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //加 row2 (同 account, 不同 email)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup2@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框首兩列 (row-index=0,1) 的「account 兩格聯集」,
    //讓讀者看到「正是這兩格帳號相同」才觸發重複錯誤
    await ensureColumnVisible(page, 'account')
    let bufTrigger = await captureStableWithBox(page, [
        '.ag-row[row-index="0"] .ag-cell[col-id="account"]',
        '.ag-row[row-index="1"] .ag-cell[col-id="account"]',
    ])
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（帳號同表重複的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-003-1-duplicate-account-cells': bufTrigger,
        'E2E-003-2-account-duplicate': bufModal,
    }
}


//004 password 空
async function capturePasswordEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-004')
    //password 故意不填
    await fillAgGridCell(page, 0, 'email', 'au-newuser-004@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框新列 (row-index=0) 的「password 空格」
    await ensureColumnVisible(page, 'password')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="password"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（密碼空的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-004-1-password-empty-cell': bufTrigger,
        'E2E-004-2-password-empty': bufModal,
    }
}


//005 email 空
async function captureEmailEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-005')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    //email 故意不填
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框新列 (row-index=0) 的「email 空格」
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="email"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（email 空的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-005-1-email-empty-cell': bufTrigger,
        'E2E-005-2-email-empty': bufModal,
    }
}


//006 email 格式錯
async function captureEmailFormatBad(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-006')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'not-an-email')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框新列 (row-index=0) 的「email 格 (顯示 not-an-email)」
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="email"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（email 格式錯的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-006-1-email-format-cell': bufTrigger,
        'E2E-006-2-email-format': bufModal,
    }
}


//007 email 同表內重複
async function captureEmailDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup-em-1')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup-em@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-dup-em-2')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-dup-em@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前的觸發狀態: 框首兩列 (row-index=0,1) 的「email 兩格聯集」,
    //讓讀者看到「正是這兩格 email 相同」才觸發重複錯誤
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, [
        '.ag-row[row-index="0"] .ag-cell[col-id="email"]',
        '.ag-row[row-index="1"] .ag-cell[col-id="email"]',
    ])
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（email 同表重複的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-007-1-duplicate-email-cells': bufTrigger,
        'E2E-007-2-email-duplicate': bufModal,
    }
}


//008 redir 空
async function captureRedirEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-008')
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', 'au-newuser-008@test.com')
    //redir 故意不填
    //[多階段 stage1] save 前的觸發狀態: 框新列 (row-index=0) 的「redir 空格」.
    //redir 欄須橫向捲動才可見, ensureColumnVisible 先把該欄捲到視口中央 (與 fillAgGridCell
    //填 redir 同款捲動機制), captureStableWithBox 內 scrollIntoViewIfNeeded 再確認命中.
    await ensureColumnVisible(page, 'redir')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="redir"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（redir 空的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-008-1-redir-empty-cell': bufTrigger,
        'E2E-008-2-redir-empty': bufModal,
    }
}


//009 全表空 (header checkbox 全選 + trash 刪光 → save → CheckYes 'userAddEmpty')
//刪光所有 row 後 layout 縮窄, 觸發 WDrawer ResizeObserver → autoSwitchToHide/Show, 此切換
//可能在 waitCheckYes 結束後才完成, sidebar 在「收合中 (drawer 滑左外)」與「展開後」間隨機收斂.
//drawer 展開到位偵測 (sidebar 導航項目 x>=0) 已抽成 captureStable 共用前置 (取代原本只在本
//case 局部、且 '.w-drawer' selector 實際未命中 DOM 而空轉的 drawer width settle 偵測).
//詳 e2e-setup.mjs captureStable 之「主動等 WDrawer drawer 整體展開到位」段.
async function captureRowsEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    //點 ag-grid header checkbox 全選 (與 clickTrashAfterSelectAll 同款定位, 此處拆開以在「全選後、
    //trash 前」插入截圖, 讓讀者看到「正是全選了所有列」才觸發刪光)
    let cbBox = await page.evaluate(() => {
        let cb = document.querySelector('.ag-header-cell input[type="checkbox"]')
        if (!cb) return null
        let r = cb.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!cbBox) throw new Error('header checkbox not found')
    await page.mouse.click(cbBox.x, cbBox.y)
    await page.waitForTimeout(500)
    await page.mouse.move(0, 0)
    //[多階段 stage1] 全選態: header + 所有列 checkbox 已勾選 (列還在), 框整表呈現「全選了哪些列」
    let bufSelected = await captureStableWithBox(page, '.ag-theme-balham')
    //點 trash 刪光
    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)
    await page.mouse.move(0, 0)
    //[多階段 stage2] trash 後 save 前的「空 ag-grid」(整表已空)
    let bufEmpty = await captureStableWithBox(page, '.ag-theme-balham')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage3] 觀看區 = CheckYes modal（整表空的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-009-1-all-rows-selected': bufSelected,
        'E2E-009-2-empty-grid': bufEmpty,
        'E2E-009-3-rows-empty': bufModal,
    }
}


//010 admin 解除自己 isAdmin (前端 self-lockout)
//多階段: stage1 = save 前框 admin 自己列的 isAdmin checkbox 格 (已取消勾選), stage2 = CheckYes modal
async function captureCannotDemoteSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    //取得 admin 自己列的 row-index (toggleSelfRowCheckbox 內部同款邏輯, 此處先取出供 stage1 selector 用)
    let adminRowIdx = await page.evaluate((adminAccount) => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="account"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === adminAccount) {
                let row = c.closest('.ag-row')
                return row ? row.getAttribute('row-index') : null
            }
        }
        return null
    }, testUsers.admin.account)
    if (adminRowIdx === null) throw new Error(`admin row not found for account=${testUsers.admin.account}`)
    await toggleSelfRowCheckbox(page, 'isAdmin')
    //[多階段 stage1] save 前框 admin 自己列 isAdmin checkbox 格 (已取消勾選)
    await ensureColumnVisible(page, 'isAdmin')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${adminRowIdx}"] .ag-cell[col-id="isAdmin"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（不可解除自己管理員權限的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-010-1-isadmin-uncheck-cell': bufTrigger,
        'E2E-010-2-cannot-demote-self': bufModal,
    }
}


//011 admin 停用自己 isActive
//多階段: stage1 = save 前框 admin 自己列的 isActive checkbox 格 (已取消勾選), stage2 = CheckYes modal
async function captureCannotDisableSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    //取得 admin 自己列的 row-index (toggleSelfRowCheckbox 內部同款邏輯, 此處先取出供 stage1 selector 用)
    let adminRowIdx = await page.evaluate((adminAccount) => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="account"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === adminAccount) {
                let row = c.closest('.ag-row')
                return row ? row.getAttribute('row-index') : null
            }
        }
        return null
    }, testUsers.admin.account)
    if (adminRowIdx === null) throw new Error(`admin row not found for account=${testUsers.admin.account}`)
    await toggleSelfRowCheckbox(page, 'isActive')
    //[多階段 stage1] save 前框 admin 自己列 isActive checkbox 格 (已取消勾選)
    await ensureColumnVisible(page, 'isActive')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${adminRowIdx}"] .ag-cell[col-id="isActive"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（不可停用自己帳號的前端攔截訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-011-1-isactive-uncheck-cell': bufTrigger,
        'E2E-011-2-cannot-disable-self': bufModal,
    }
}


//012 password 違反後端 policy (繞過前端 isError, 由 checkUserPassword reject)
//多階段: stage1 = save 前框新列 (row-index=0) 的 password 格 (顯示弱密 'short'), stage2 = CheckYes modal
async function capturePasswordPolicyBackend(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', 'au-newuser-012')
    await fillAgGridCell(page, 0, 'password', 'short') //非空, 通過前端; 但長度<8 後端 reject
    await fillAgGridCell(page, 0, 'email', 'au-newuser-012@test.com')
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)
    //[多階段 stage1] save 前框新列 (row-index=0) 的 password 格 (顯示已填入的弱密值)
    await ensureColumnVisible(page, 'password')
    let bufTrigger = await captureStableWithBox(page, '.ag-row[row-index="0"] .ag-cell[col-id="password"]')
    await clickSave(page)
    await waitCheckYes(page, lang)
    //[多階段 stage2] 觀看區 = CheckYes modal（密碼違反後端策略的錯誤訊息）
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-012-1-password-policy-cell': bufTrigger,
        'E2E-012-2-password-policy-backend': bufModal,
    }
}


//013 account 與 DB 既有衝突 — 同表內重複的 ckKey path 會以同訊息呈現,
//   故重用 003 的 captureAccountDuplicate 路徑作為此情境之 UI 代表.
//   003 多階段化後回 dict, 此處將 dict key remap 為 013 自己的階段名 (檔名歸屬 013, 不撞 003).
async function captureAccountConflictBackend(page, lang) {
    let r = await captureAccountDuplicate(page, lang)
    return {
        'E2E-013-1-duplicate-account-cells': r['E2E-003-1-duplicate-account-cells'],
        'E2E-013-2-account-conflict-backend': r['E2E-003-2-account-duplicate'],
    }
}


//014 email 與 DB 既有衝突 — 同上, 重用 007 (同樣 remap dict key 為 014 自己的階段名)
async function captureEmailConflictBackend(page, lang) {
    let r = await captureEmailDuplicate(page, lang)
    return {
        'E2E-014-1-duplicate-email-cells': r['E2E-007-1-duplicate-email-cells'],
        'E2E-014-2-email-conflict-backend': r['E2E-007-2-email-duplicate'],
    }
}


//015 token 過期 / 非 admin 共用 (spec 不洩露身分檢查):
//   1. 進 backstage Users list (token 有效) → 點 + 新增一列 → 填妥合法欄位 (前端 isError 全過)
//   2. 後端 DB 操作: 把 admin token timeEnd 設為過去 (模擬「填完新列後 token 才過期」)
//   3. clickSave → 後端 checkToken reject → CheckYes modal 含 userSaveUsersFail 前綴
async function captureTokenExpiredBackend(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let newAccount = `au-newuser-015`
    await clickPlusToAddRow(page)
    await fillAgGridCell(page, 0, 'account', newAccount)
    await fillAgGridCell(page, 0, 'password', 'Pw@KLMN5678')
    await fillAgGridCell(page, 0, 'email', `${newAccount}@test.com`)
    await fillAgGridCell(page, 0, 'redir', `${baseUrl}/?view=user&token={token}`)

    //儲存前讓 token 過期 (繞過前端時序, 模擬「修改完之後 token 才過期」場景)
    await forceExpireAdminToken()

    await clickSave(page)
    await waitCheckYes(page, lang)
    //E2E-015: 觀看區 = CheckYes modal（token 過期後端 reject 的錯誤訊息）
    return await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-after-save-with-new-user', captureSuccessAfterSave],
        ['E2E-002-account-empty', captureAccountEmpty],
        ['E2E-003-account-duplicate', captureAccountDuplicate],
        ['E2E-004-password-empty', capturePasswordEmpty],
        ['E2E-005-email-empty', captureEmailEmpty],
        ['E2E-006-email-format', captureEmailFormatBad],
        ['E2E-007-email-duplicate', captureEmailDuplicate],
        ['E2E-008-redir-empty', captureRedirEmpty],
        ['E2E-009-rows-empty', captureRowsEmpty],
        ['E2E-010-cannot-demote-self', captureCannotDemoteSelf],
        ['E2E-011-cannot-disable-self', captureCannotDisableSelf],
        ['E2E-012-password-policy-backend', capturePasswordPolicyBackend],
        ['E2E-013-account-conflict-backend', captureAccountConflictBackend],
        ['E2E-014-email-conflict-backend', captureEmailConflictBackend],
        ['E2E-015-token-expired-backend', captureTokenExpiredBackend],
    ]

    //per-case fresh browser + DB setup, 與 mocha test 端 beforeEach/afterEach 對稱.
    //保證 marathon mode 與 single-case run 收斂到同一 stable state (無 cross-case browser
    //state 累積). 詳全域 CLAUDE.md §6.3「截圖穩定性」.
    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => { await dialog.accept() })

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            fs.writeFileSync(bp(lang, bname), b)
        }

        await browser.close()
        await deleteTestUsersAndTokens()
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

    await deleteTestUsersAndTokens()

    console.log('=== 標準圖產生完成 ===')

    cleanup()
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

    //
    // API 契約 cases (password-* / self-lockout-* / happy-path / existing-row-password-preserved)
    // 已遷至 test/api-adduser.test.mjs (Node + 無 browser).
    // 此檔僅保留需 Playwright + baseline 的 UI cases (包含 copy-clone-then-save 下方).
    //


    // --- 衍生操作 / copyItem 複製列 ---
    //
    // 對應 spec: spec/流程_後台新增使用者.md「執行流程 → 五、衍生操作 → copyItem」
    //   - 勾選表內單一列, copy 按鈕始出現 (hasItemCheckOne)
    //   - 點 copy → 新列插入最首 (_isNew=true), password 清空, 其他欄位 clone 自源頭列
    //   - 改新列 account / email 避開同表重複 → 重新填 password → 儲存
    //   - 儲存路徑與 addItem 共用 add 群組, 源頭列不受影響, DB 兩列共存
    //
    // 使用 e2e-adduser 共用 setup (testUsers admin/existing + helpers loginAsAdminAndOpenUsersList /
    // fillAgGridCell / ensureColumnVisible / locateMdiButton / resetAdminToken).
    // existing 列 (au-existing) 即作為被複製的源頭列, 不另設源頭使用者.

    describe('AddUser E2E — 衍生操作 / copyItem 複製列', function() {
        this.timeout(180000)

        let browser
        let page

        //per-case 獨立: 與其他 describe 同款架構 (fresh browser + DB setup), 確保 --grep 可單跑.
        beforeEach(async function() {
            this.timeout(180000)
            await startServersOnce()

            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokens()

            browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
            let context = await browser.newContext()
            page = await context.newPage()
            page.on('dialog', async (dialog) => { await dialog.accept() })
        })

        afterEach(async function() {
            if (browser) {
                await browser.close()
                browser = null
            }
            await deleteTestUsersAndTokens()
        })


        //依 account innerText 找該列 row-index (ag-grid 用)
        async function findRowIndexByAccount(p, account) {
            return await p.evaluate((acc) => {
                let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="account"]'))
                for (let c of cells) {
                    if ((c.innerText || '').trim() === acc) {
                        let row = c.closest('.ag-row')
                        return row.getAttribute('row-index')
                    }
                }
                return null
            }, account)
        }


        //勾選指定列 (row-index) 的 selection checkbox.
        //ag-grid row selection checkbox 預設在第一欄, 用 .ag-selection-checkbox input.
        async function checkRowSelectionByRowIdx(p, rowIdx) {
            let sel = `.ag-row[row-index="${rowIdx}"] .ag-selection-checkbox input[type="checkbox"]`
            let n = await p.locator(sel).count()
            if (n === 0) {
                //fallback: 該列第一個 checkbox
                sel = `.ag-row[row-index="${rowIdx}"] input[type="checkbox"]`
            }
            let cb = p.locator(sel).first()
            await cb.waitFor({ state: 'visible', timeout: 5000 })
            await cb.check()
            await p.waitForTimeout(400)
        }


        it('copy-clone-then-save: 勾選 existing 列 → copy → 新列首列 password 空 + 其他欄位 clone → 改 account/email 填密碼 → 儲存 → DB 兩列共存', async function() {
            await resetAdminToken()
            await loginAsAdminAndOpenUsersList(page, 'eng')

            //新列改寫的 account / password, 須避開後端 noConsecutiveCharsFromAccount 策略
            let copyAccount = 'au-existing-copy'
            let copyPassword = 'Pw@RaN9876!'

            //找 existing 列 (作為被複製的源頭)
            let srcRowIdx = await findRowIndexByAccount(page, testUsers.existing.account)
            assert.strict.notEqual(srcRowIdx, null, `應找到 source 列 (${testUsers.existing.account})`)

            //勾選 source 列
            await checkRowSelectionByRowIdx(page, srcRowIdx)

            //對應 spec: 勾選單一列後 copy 按鈕始出現 (hasItemCheckOne)
            let copyBtn = await locateMdiButton(page, mdiContentCopy)
            assert.strict.notEqual(copyBtn, null, `勾選 1 列後 copy 按鈕應出現`)

            //點 copy
            await page.mouse.click(copyBtn.x, copyBtn.y)
            await page.waitForTimeout(800)

            //對應 spec: 新列插入最首 (row-index="0"), account 沿用 source
            await ensureColumnVisible(page, 'account')
            let accountText = await page.evaluate(() => {
                let row0 = document.querySelector('.ag-row[row-index="0"]')
                if (!row0) return null
                let cell = row0.querySelector('.ag-cell[col-id="account"]')
                return cell ? (cell.innerText || '').trim() : null
            })
            assert.strict.notEqual(accountText, null, `新列應出現於首列`)
            assert.strict.equal(accountText, testUsers.existing.account, `新列 account 應 clone 自 source (${testUsers.existing.account}), 實際 ${accountText}`)

            //對應 spec: password 清空 (新列 _isNew=true, 走 ag-grid 標準 cellRenderer 顯示純文字)
            //ag-grid 含 pinned-left + center 兩個容器, .ag-row[row-index="0"] 會匹配多個;
            //直接用 col-id 全文件搜尋 cell 再判斷 row-index.
            await ensureColumnVisible(page, 'password')
            await page.waitForTimeout(400)
            let pwInfo = await page.evaluate(() => {
                let cells = Array.from(document.querySelectorAll('.ag-cell[col-id="password"]'))
                let row0PwCell = cells.find(c => {
                    let row = c.closest('.ag-row')
                    return row && row.getAttribute('row-index') === '0'
                })
                if (!row0PwCell) {
                    let cellsInfo = cells.map(c => {
                        let row = c.closest('.ag-row')
                        return row ? row.getAttribute('row-index') : 'noRow'
                    })
                    return { found: false, debug: { passwordCells: cellsInfo } }
                }
                return {
                    found: true,
                    cellText: (row0PwCell.innerText || '').trim(),
                }
            })
            assert.strict.equal(pwInfo.found, true, `password cell 應存在於首列, debug=${JSON.stringify(pwInfo.debug)}`)
            assert.strict.equal(pwInfo.cellText, '', `新列 password 應被清空, 實際 "${pwInfo.cellText}"`)

            //避開同表重複: 改 account + email (其他欄位保留, 依 spec)
            await fillAgGridCell(page, 0, 'account', copyAccount)
            await fillAgGridCell(page, 0, 'email', `${copyAccount}@test.com`)

            //重新填 password (走 ag-grid 標準編輯)
            await fillAgGridCell(page, 0, 'password', copyPassword)

            //儲存
            let saveBtn = await locateMdiButton(page, mdiCloudUploadOutline)
            assert.strict.notEqual(saveBtn, null, `修改後 save 按鈕應出現`)
            await page.mouse.click(saveBtn.x, saveBtn.y)

            //CheckYes 浮出 → 點 OK
            await page.locator(`text="OK"`).first().waitFor({ state: 'visible', timeout: 30000 })
            await page.waitForTimeout(500)
            await page.locator(`text="OK"`).first().click()
            await page.waitForTimeout(3000)

            //對應 spec: 源頭列不受影響, DB 兩列共存
            let srcUsers = await woItems.users.select({ account: testUsers.existing.account })
            let copyUsers = await woItems.users.select({ account: copyAccount })
            assert.strict.equal(srcUsers.length, 1, `source user 仍應存在 (${testUsers.existing.account})`)
            assert.strict.equal(copyUsers.length, 1, `cloned user 應已建立 (${copyAccount})`)

            //對應 spec: cloned user password 為新填明文之 hash, 其他欄位 clone 自 source
            let cloned = copyUsers[0]
            assert.strict.equal(verifyPassword(copyPassword, cloned.password, salt), true, `cloned user password 應可由新填明文驗證通過`)
            assert.strict.equal(cloned.name, testUsers.existing.name, `cloned user name 應 clone 自 source`)
            assert.strict.equal(cloned.isAdmin, testUsers.existing.isAdmin, `cloned user isAdmin 應 clone 自 source`)

            //cleanup cloned user (existing 會由 afterEach 清)
            await woItems.users.del({ id: cloned.id }).catch(() => {})
        })

    })


    // --- UI baseline 比對 (14 case × 2 lang = 28 baselines) ---

    for (let lang of langs) {

        describe(`AddUser E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            let browser
            let page

            //per-case 獨立: 每個 it 都 fresh browser + DB setup, 確保單 case --grep 也能跑.
            //(設計理由: 避免 marathon flake — 多 case 在同 browser 跑會累積 GPU/font/CSS state
            //導致 baseline 不確定. per-case 隔離雖 launch overhead 較高, 但換來 case 獨立可
            //除錯 + baseline 確定性.)
            beforeEach(async function() {
                this.timeout(240000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()

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

            let cases = [
                ['E2E-001-after-save-with-new-user', captureSuccessAfterSave],
                ['E2E-002-account-empty', captureAccountEmpty],
                ['E2E-003-account-duplicate', captureAccountDuplicate],
                ['E2E-004-password-empty', capturePasswordEmpty],
                ['E2E-005-email-empty', captureEmailEmpty],
                ['E2E-006-email-format', captureEmailFormatBad],
                ['E2E-007-email-duplicate', captureEmailDuplicate],
                ['E2E-008-redir-empty', captureRedirEmpty],
                ['E2E-009-rows-empty', captureRowsEmpty],
                ['E2E-010-cannot-demote-self', captureCannotDemoteSelf],
                ['E2E-011-cannot-disable-self', captureCannotDisableSelf],
                ['E2E-012-password-policy-backend', capturePasswordPolicyBackend],
                ['E2E-013-account-conflict-backend', captureAccountConflictBackend],
                ['E2E-014-email-conflict-backend', captureEmailConflictBackend],
                ['E2E-015-token-expired-backend', captureTokenExpiredBackend],
            ]

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    await resetAdminToken()
                    let result = await fn(page, lang)

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

                    if (name === 'E2E-001-after-save-with-new-user') {
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

                    //E2E-015: token 過期 → 後端 reject → 新使用者不應被建立 (DB 副作用驗證)
                    if (name === 'E2E-015-token-expired-backend') {
                        let created = await woItems.users.select({ account: 'au-newuser-015' }).catch(() => [])
                        assert.strict.equal(created.length, 0, `token 過期 reject 後新使用者 au-newuser-015 不應被建立, 實際 ${created.length} 筆`)
                    }

                    //像素斷言 (補強, 視覺回歸); 多階段 fn 回 dict { baselineName: buf } → 逐張比對
                    //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
                    let stages = Buffer.isBuffer(result) ? { [name]: result } : result
                    for (let [bname, b] of Object.entries(stages)) {
                        assertBaselineMatch(b, bp(lang, bname), `adduser-${lang}-${bname}`)
                    }
                })
            }

            it(`new-user-can-login: 用 admin 設定的密碼登入新 user → 進 user view (非強制變更)`, async function() {
                let loginText = lang === 'eng' ? 'Log in' : '登入'
                let newAccount = `au-newuser-${lang}-login`
                let rawPw = 'Pw@KLMN5678'

                await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
                })

                //per-case beforeEach 後 page 還是 about:blank, callFapi 需要 Vue app 載入, 故先導頁
                await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
                await page.waitForTimeout(2500)

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

                //偵測: 等 login 表單 input 元件出現
                await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2)

                await typeIntoNthInput(page, 0, newAccount)
                await typeIntoNthInput(page, 1, rawPw)

                await page.locator(`text="${loginText}"`).first().waitFor({ state: 'visible', timeout: 10000 })
                await page.locator(`text="${loginText}"`).first().click()

                //login → view=user 為跨頁 redirect, 較久. 一律先 fixed 5s 等 redirect 啟動.
                await page.waitForTimeout(5000)

                //偵測: 等 url 變為 view=user (login 成功 + redirect 完成)
                await waitUntilExist(page, 'url 含 view=user', () => location.href.includes('view=user'))

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
