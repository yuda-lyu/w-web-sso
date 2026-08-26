import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch } from './e2e-setup.mjs'


//
// E2E ips test — 後台 IP 清單流程
//
// 對應流程文件：spec/流程_後台IP清單.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-ips.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-ips.test.mjs --timeout 240000
//   --names <eng-E2E-001-list-loaded,...> 進行手術式 baseline 重產
//
// 標準圖存放：test/pics/ips/ips-{lang}-{number}-{name}.png
//
// 涵蓋 4 個流程 (× 2 lang = 8 cases, × 多階段截圖 = 14 baselines):
//   E2E-001: ips-{lang}-E2E-001-list-loaded.png           (1 張)
//   E2E-002: ips-{lang}-E2E-002-1-ip-edited-before-save   觸發圖 (ip cell 已改未存)
//            ips-{lang}-E2E-002-2-save-success-modal       save 成功 modal
//            ips-{lang}-E2E-002-3-modify-ip-result-row     modal 關閉後已更新列  (3 張)
//   E2E-003: ips-{lang}-E2E-003-1-row-selected-before-save 觸發圖 (列已勾選未刪)
//            ips-{lang}-E2E-003-2-delete-row-save-success  delete + save 成功 modal  (2 張)
//   E2E-004: ips-{lang}-E2E-004-token-expired-save-fail.png (1 張)
//
// 所有 capture 透過真實 UI 互動推進: 鍵盤滑鼠輸入 / ag-grid cell dblclick + Enter /
// checkbox 點擊 / 按鈕 SVG path 點擊。不使用 vm.method() / page.evaluate state mutation 抄捷徑.
//

let salt = '{salt}'
let baselineDir = './test/pics/ips'
let langs = ['eng', 'cht']


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
    return path.join(baselineDir, `ips-${lang}-${name}.png`)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_後台IP清單.md + procLang.mjs 衍生, 非現狀指紋)
// 每個 case 對應的可觀察文字; 不含 → 修系統或修 spec, 不改 baseline.
// ===================================================================

let expectedSpecText = {
    //E2E-001: 表格載入後應見表頭 'IP' 與 seed 的某 ip 字串
    'E2E-001-list-loaded': {
        eng: { mode: 'text', value: '10.0.0.1' },
        cht: { mode: 'text', value: '10.0.0.1' },
    },
    //E2E-002 stage1 (觸發圖): fillAgGridCell 後 Enter 退出 editor、save 前 — ip cell 已顯示新值
    'E2E-002-1-ip-edited-before-save': {
        eng: { mode: 'text', value: '10.0.0.99' },
        cht: { mode: 'text', value: '10.0.0.99' },
    },
    //E2E-002 stage2: 儲存成功 modal 應出現 ipSaveIpsSuccess 文字 (modal 仍顯示時在 capture fn 內斷言, mocha 端跳過)
    'E2E-002-2-save-success-modal': {
        eng: { mode: 'text', value: 'Save IPs successfully' },
        cht: { mode: 'text', value: '儲存IP數據成功' },
    },
    //E2E-002 stage3: modal dismiss 後表格應顯示修改後的 ip 值
    'E2E-002-3-modify-ip-result-row': {
        eng: { mode: 'text', value: '10.0.0.99' },
        cht: { mode: 'text', value: '10.0.0.99' },
    },
    //E2E-003 stage1 (觸發圖): 勾選目標列後、trash/save 前 — 目標 ip 仍在表格
    'E2E-003-1-row-selected-before-save': {
        eng: { mode: 'text', value: '10.0.0.2' },
        cht: { mode: 'text', value: '10.0.0.2' },
    },
    //E2E-003 stage2: 刪除 + save 成功 modal (同 E2E-002, 共用 ipSaveIpsSuccess; modal 仍顯示時在 capture fn 內斷言, mocha 端跳過)
    'E2E-003-2-delete-row-save-success': {
        eng: { mode: 'text', value: 'Save IPs successfully' },
        cht: { mode: 'text', value: '儲存IP數據成功' },
    },
    //E2E-004: 後端 reject → ipSaveIpsFail 前綴 (i18n) + 後端錯誤字串
    'E2E-004-token-expired-save-fail': {
        eng: { mode: 'text', value: 'Failed to save IPs' },
        cht: { mode: 'text', value: '儲存IP數據失敗' },
    },
}


// ===================================================================
// 測試使用者 / Token / Ips seed
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-ips-admin',
        account: 'ips-admin',
        rawPassword: 'Pw@ipsadmin1',
        name: 'Ips Admin',
        email: 'ips-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
}

let userTokens = {}

//5 個 seed ips 列 — 固定 id (便於斷言), 不同 ip / timeBlocked 以區分視覺.
//timeBlocked 用未來日期, 不同小時數讓 WTimeminute 顯示各異, 更利於視覺辨識
let testIps = [
    { id: 'id-test-ip-1', ip: '10.0.0.1', timeBlocked: '2030-01-01T00:00:00.000+08:00' },
    { id: 'id-test-ip-2', ip: '10.0.0.2', timeBlocked: '2030-06-15T12:00:00.000+08:00' },
    { id: 'id-test-ip-3', ip: '10.0.0.3', timeBlocked: '2030-09-20T08:30:00.000+08:00' },
    { id: 'id-test-ip-4', ip: '10.0.0.4', timeBlocked: '2030-11-05T15:45:00.000+08:00' },
    { id: 'id-test-ip-5', ip: '10.0.0.5', timeBlocked: '2030-12-31T23:00:00.000+08:00' },
]


async function insertTestUsersAndTokensAndIps() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens + ips 清空), 再插入本檔專屬資料.
    await resetToBaseSeed()

    //admin user
    let u = testUsers.admin
    let v = ds.users.funNew({
        order: 900,
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
    await woItems.users.insert([v])

    //admin token
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    //ips seed
    let ipsRows = testIps.map((r) => {
        let o = ds.ips.funNew({ ip: r.ip, timeBlocked: r.timeBlocked })
        o.id = r.id
        return o
    })
    await woItems.ips.insert(ipsRows)

    console.log(`inserted 1 admin user + 1 token + ${ipsRows.length} ips rows`)
}


async function deleteTestUsersAndTokensAndIps() {
    //刪除所有非 base seed 的專屬資料 (含 admin user / token), ips 全清空.
    await deleteNonBaseSeed()
    console.log('deleted ips test users + tokens + ips')
}


//每個 it 之間 admin token 都要復原 (token 過期 case 會把它弄壞)
async function resetAdminToken() {
    //w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


//強制將 admin token 設為過期 (case E2E-004 用): 模擬「填完編輯後 token 才過期」場景,
//下次點儲存時後端 checkToken (funCheckAdmin) reject → CheckYes modal 含 ipSaveIpsFail 前綴.
async function forceExpireAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) {
        _tk.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.save(_tk).catch(() => {})
    }
}


//重設 ips 表 (case E2E-002/003/004 在 it 內可能變動 ips, 須回到 seed 狀態)
async function resetIpsSeed() {
    await woItems.ips.delAll()
    let ipsRows = testIps.map((r) => {
        let o = ds.ips.funNew({ ip: r.ip, timeBlocked: r.timeBlocked })
        o.id = r.id
        return o
    })
    await woItems.ips.insert(ipsRows)
}


// ===================================================================
// UI helpers — 全部走真實鍵盤滑鼠互動 (透過 Playwright)
// (參考 e2e-adduser 共用 pattern)
// ===================================================================

let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'
let mdiTrashCanOutline = 'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z'

let kpUiText = {
    eng: { login: 'Log in', ipsList: 'Ips list', editMode: 'Edit mode', ok: 'OK', statistics: 'Statistics' },
    cht: { login: '登入', ipsList: 'IP清單', editMode: '編輯模式', ok: '確認', statistics: '統計' },
}


//每步驟先偵測對象出現再操作 (10s timeout). 超時拋錯 = 真實異常 (而非 sleep 不夠).
async function waitUntilExist(page, label, fn, opts = {}) {
    let { timeout = 10000, arg = null } = opts
    try {
        await page.waitForFunction(fn, arg, { timeout })
    }
    catch (err) {
        throw new Error(`waitUntilExist 超過 ${timeout}ms 仍找不到「${label}」 — 此為真實異常 (production race / 元件未渲染)`)
    }
}


//真鍵盤輸入 nth(idx) 的 input (取代 .fill() L4 偷工 — 詳見 e2e-adduser 之說明)
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


//輔助: 用 Backspace 清空 input.value, 不碰剪貼簿 / 不用 Ctrl+A 組合鍵
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


//ag-grid 視窗虛擬化讓非可視欄不在 DOM. 透過掃描 scrollLeft 找到該欄能渲染的位置.
async function ensureColumnVisible(page, colId) {
    let ok = await page.evaluate(async (cid) => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return false
        let sw = body.scrollWidth, cw = body.clientWidth
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
    await page.waitForTimeout(500)
}


//依 row-index 勾選該列的 selection checkbox.
async function checkRowSelectionByRowIdx(page, rowIdx) {
    let sel = `.ag-row[row-index="${rowIdx}"] .ag-selection-checkbox input[type="checkbox"]`
    let n = await page.locator(sel).count()
    if (n === 0) {
        //fallback: 該列第一個 checkbox
        sel = `.ag-row[row-index="${rowIdx}"] input[type="checkbox"]`
    }
    let cb = page.locator(sel).first()
    await cb.waitFor({ state: 'visible', timeout: 5000 })
    await cb.check()
    await page.waitForTimeout(400)
}


//login 頁 → 填帳密 → 進 Ips list → 確認 Edit mode 開
async function loginAsAdminAndOpenIpsList(page, lang) {
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
        await page.waitForTimeout(1000)
    }

    //偵測: 等 login 表單 input 元件出現
    await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2)

    await typeIntoNthInput(page, 0, testUsers.admin.account)
    await typeIntoNthInput(page, 1, testUsers.admin.rawPassword)

    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.locator(`text="${t.login}"`).first().click()

    //login → backstage 跨頁 redirect, 較久. 一律先 fixed 10s 等 redirect 啟動.
    await page.waitForTimeout(10000)

    //偵測: 等 backstage Statistics 文字 (login 成功 + redirect 完成)
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics })

    //點 Ips list
    await page.locator(`text="${t.ipsList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.ipsList}"`).first().click()
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

    //等 ag-grid 初始載入後 cell 完全 hydrate
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


async function clickSave(page) {
    let p = await locateMdiButton(page, mdiCloudUploadOutline)
    await page.mouse.click(p.x, p.y)
    //儲存後可能因 Loading dialog 短暫消失再出現 → 不等 fixed delay, 由呼叫者 waitCheckYes
    await page.mouse.move(0, 0)
}


async function clickTrash(page) {
    let p = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(800)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
}


async function waitCheckYes(page, lang) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 30000 })
    //modal 出現後穩定化: 1) 捲軸歸位 2) hover state 清除 3) 等 ag-grid idle (連續三 raf 不變)
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.mouse.move(0, 0)
    await page.waitForFunction(async () => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return true //無 grid, 直接 ok
        if (body.scrollLeft !== 0) return false
        //ip header 必須出現
        if (!document.querySelector('.ag-header-cell[col-id="ip"]')) return false
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
// 共用語意斷言 helpers
// ===================================================================

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


// ===================================================================
// 4 個 capture (全 UI 互動, 不走 vm.method / state mutation)
// ===================================================================

//E2E-001 初始檢視態: 進 Ips list, 表格顯示 seed 列, 截圖
async function captureListLoaded(page, lang) {
    await loginAsAdminAndOpenIpsList(page, lang)
    //等 seed ip (10.0.0.1) 在 table 內可見
    await waitUntilExist(page, 'first seed ip 10.0.0.1', () => document.body.innerText.includes('10.0.0.1'))
    //框 ag-grid 表格區域 (觀看區: IP 清單表格全體)
    return await captureStableWithBox(page, '.ag-theme-balham')
}


//E2E-002 修改 ip 欄位後 Save 成功 (多階段, 3 張截圖)
//  stage1: fillAgGridCell + Enter 退出 editor 後、clickSave 前 → 'E2E-002-1-ip-edited-before-save'
//  stage2: waitCheckYes 後、點 OK 之前截「成功 modal」(框 modal panel) → 'E2E-002-2-save-success-modal'
//  stage3: 點 OK → 等 grid 重 fetch 顯示 10.0.0.99 → 框修改後那一列   → 'E2E-002-3-modify-ip-result-row'
//
//note: 流程文件描述為「修改封鎖時間」, 但 timeBlocked cell 使用 WTimeminute 自訂渲染器,
//編輯路徑為時間選擇器點擊. ip 欄位使用標準 ag-grid 文字編輯 (kpCellEditable.ip=true),
//走的是同一個 saveIps + updateIpsList 路徑 (前端 isModified=true → rowsChange 觸發).
//此 case 用 ip 欄位修改作為「修改任一欄位後儲存成功」的代表.
//
//stage3 定位法: ip 值 '10.0.0.99' 動態找 row-index (不 hardcode, 避免 grid 排序/前置列差異)
//pinned-left + center 聯集: 若該 grid 無 pinned-left 欄, captureStableWithBox 會靜默略過
//找不到的 selector (rects 為空則不畫紅框), 故聯集寫法為安全寫法.
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'
async function captureModifyIpSaveSuccess(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdminAndOpenIpsList(page, lang)

    //找 ip='10.0.0.1' 的列 row-index, 將 ip 改成新值
    let rowIdx = await page.evaluate(() => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="ip"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === '10.0.0.1') {
                let row = c.closest('.ag-row')
                return row.getAttribute('row-index')
            }
        }
        return null
    })
    if (rowIdx === null) throw new Error(`seed ip row not found: 10.0.0.1`)

    await fillAgGridCell(page, parseInt(rowIdx, 10), 'ip', '10.0.0.99')

    //[stage1] ip cell 已顯示新值 10.0.0.99、save 前 → 截觸發圖 (觀看區: 被編輯的 ip cell)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(800)
    let bufEdited = await captureStableWithBox(page, `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="ip"]`)

    await clickSave(page)
    await waitCheckYes(page, lang)

    //[stage2 語意斷言] modal 仍顯示時 (點 OK 之前) 斷言成功 modal 文字出現 —
    //此為 stage2 modal 文字的正確時機 (post-capture 時 modal 已 dismiss, 文字不在頁面).
    {
        let exp = expectedSpecText['E2E-002-2-save-success-modal'][lang].value
        let found = await pageHasText(page, exp)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期成功 modal 含 "${exp}" (E2E-002-2-save-success-modal), 實際: ${dump}`)
        }
    }

    //[stage2] 成功 modal 浮出後、點 OK 之前 → 截 modal 畫面 (觀看區: System message 持久 modal)
    let bufModal = await captureStableWithBox(page, SEL_MODAL)

    //關閉 success modal
    await page.locator(`text="${t.ok}"`).first().click()

    //等 grid 重 fetch 並顯示修改後 ip (10.0.0.99)
    await page.locator('text="10.0.0.99"').first().waitFor({ state: 'visible', timeout: 15000 })

    //等 ag-grid 重 fetch 後重畫穩定 (連續三 raf cell 不變)
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

    //動態找 ip='10.0.0.99' 的 row-index (grid 重 fetch 後排序可能與修改前不同)
    let updatedRowIdx = await page.evaluate(() => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="ip"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === '10.0.0.99') {
                let row = c.closest('.ag-row')
                return row ? row.getAttribute('row-index') : null
            }
        }
        return null
    })
    if (updatedRowIdx === null) throw new Error(`modified ip row not found: 10.0.0.99`)

    //[stage3] 框被修改的那一列 (聯集 pinned-left + center 兩容器取完整列寬)
    let bufRow = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${updatedRowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${updatedRowIdx}"]`,
    ])

    //多階段回傳 dict (baselineName → buf); 數字前綴使檔名排序 ≡ 流程階段順序:
    //  1 觸發圖 (ip cell 已改未存) → 2 成功 modal → 3 表格中已更新的 ip 列
    return {
        'E2E-002-1-ip-edited-before-save': bufEdited,
        'E2E-002-2-save-success-modal': bufModal,
        'E2E-002-3-modify-ip-result-row': bufRow,
    }
}


//E2E-003 勾選某列刪除後 Save 成功 modal (多階段, 2 張截圖)
//  stage1: checkRowSelection 後、clickTrash/clickSave 前 → 'E2E-003-1-row-selected-before-save'
//  stage2: waitCheckYes 後 → 'E2E-003-2-delete-row-save-success'
async function captureDeleteRowSaveSuccess(page, lang) {
    await loginAsAdminAndOpenIpsList(page, lang)

    //找 ip='10.0.0.2' 的列 row-index → 勾選 → 截觸發圖 → 刪 → save
    let rowIdx = await page.evaluate(() => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="ip"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === '10.0.0.2') {
                let row = c.closest('.ag-row')
                return row.getAttribute('row-index')
            }
        }
        return null
    })
    if (rowIdx === null) throw new Error(`seed ip row not found: 10.0.0.2`)

    await checkRowSelectionByRowIdx(page, parseInt(rowIdx, 10))

    //[stage1] 勾選後、trash/save 前 → 截觸發圖 (觀看區: 整列 pinned-left + center 聯集顯示勾選態)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(800)
    let bufSelected = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${rowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`,
    ])

    await clickTrash(page)
    await clickSave(page)
    await waitCheckYes(page, lang)

    //[stage2 語意斷言] modal 仍顯示時斷言成功訊息 (post-capture 時 modal 已 dismiss, 文字不在頁面)
    {
        let exp = expectedSpecText['E2E-003-2-delete-row-save-success'][lang].value
        let found = await pageHasText(page, exp)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期成功 modal 含 "${exp}" (E2E-003-2-delete-row-save-success), 實際: ${dump}`)
        }
    }

    //[stage2] 框 CheckYes 成功 modal (觀看區: System message 持久 modal 訊息區)
    let bufModal = await captureStableWithBox(page, SEL_MODAL)

    //多階段回傳 dict (baselineName → buf); 數字前綴使檔名排序 ≡ 流程階段順序:
    //  1 觸發圖 (該列已勾選未刪存) → 2 刪除 + save 成功 modal
    return {
        'E2E-003-1-row-selected-before-save': bufSelected,
        'E2E-003-2-delete-row-save-success': bufModal,
    }
}


//E2E-004 Save 前 token 過期 → 後端 reject → 失敗 modal (ipSaveIpsFail 前綴)
async function captureTokenExpiredSaveFail(page, lang) {
    await loginAsAdminAndOpenIpsList(page, lang)

    //先修改 ip 欄位讓 isModified=true (否則 Save 按鈕不顯示)
    let rowIdx = await page.evaluate(() => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="ip"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === '10.0.0.3') {
                let row = c.closest('.ag-row')
                return row.getAttribute('row-index')
            }
        }
        return null
    })
    if (rowIdx === null) throw new Error(`seed ip row not found: 10.0.0.3`)
    await fillAgGridCell(page, parseInt(rowIdx, 10), 'ip', '10.0.0.30')

    //儲存前讓 token 過期 (模擬「修改完之後 token 才過期」場景)
    await forceExpireAdminToken()

    await clickSave(page)
    await waitCheckYes(page, lang)
    //框 CheckYes 失敗 modal (觀看區: System message 持久 modal 訊息區)
    return await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-list-loaded', captureListLoaded],
        ['E2E-002-modify-ip-save-success', captureModifyIpSaveSuccess],
        ['E2E-003-delete-row-save-success', captureDeleteRowSaveSuccess],
        ['E2E-004-token-expired-save-fail', captureTokenExpiredSaveFail],
    ]

    //per-case fresh browser + DB setup, 與 mocha test 端 beforeEach/afterEach 對稱.
    //保證 marathon mode 與 single-case run 收斂到同一 stable state.
    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        await deleteTestUsersAndTokensAndIps()
        await insertTestUsersAndTokensAndIps()

        let browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => { await dialog.accept() })

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            writeBaseline(lang, bname, b)
        }

        await browser.close()
        await deleteTestUsersAndTokensAndIps()
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

    await deleteTestUsersAndTokensAndIps()

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

    //=== baseline 比對 helper (內含: 檔存在 / pixelmatch 反鋸齒容差 / spec 語意斷言) ===
    async function verifyBaseline(page, lang, name, buf, skipSpec = false) {
        if (!skipSpec) {
            await assertSpecForCase(page, lang, name)
        }
        let baselinePath = bp(lang, name)
        //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
        assertBaselineMatch(buf, baselinePath, `ips-${lang}-${name}`)
    }


    for (let lang of langs) {

        describe(`Ips E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            let browser
            let page

            //per-case 獨立: 每個 it 都 fresh browser + DB setup, 確保單 case --grep 也能跑.
            beforeEach(async function() {
                this.timeout(240000)
                await startServersOnce()

                await deleteTestUsersAndTokensAndIps()
                await insertTestUsersAndTokensAndIps()

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
                await deleteTestUsersAndTokensAndIps()
            })

            let cases = [
                ['E2E-001-list-loaded', captureListLoaded],
                ['E2E-002-modify-ip-save-success', captureModifyIpSaveSuccess],
                ['E2E-003-delete-row-save-success', captureDeleteRowSaveSuccess],
                ['E2E-004-token-expired-save-fail', captureTokenExpiredSaveFail],
            ]

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    await resetAdminToken()
                    await resetIpsSeed()
                    let result = await fn(page, lang)

                    //語意斷言 (主): 多階段 fn 回 dict → 逐 stage 各驗其 expectedSpecText
                    //單張 fn 回 Buffer → 沿用 verifyBaseline (skipSpec=false)
                    if (Buffer.isBuffer(result)) {
                        await verifyBaseline(page, lang, name, result)
                    }
                    else {
                        //dict 模式: 各 stage pixel 斷言; 語意斷言只驗 post-capture 仍可觀察之最終態.
                        //以下 key 的 modal 語意已在 capture 函式內 (modal 仍顯示時) 斷言,
                        //此處 modal 已 dismiss → 不可再對 modal 文字做 post-capture pageHasText, 故略過.
                        let skipSpecKeys = new Set([
                            'E2E-002-2-save-success-modal',
                            //E2E-003 觸發圖 (列已勾選未刪): 觸發狀態已由 pixel baseline 驗證 (該列被勾選且 10.0.0.2 在表).
                            //save 流程刪除該列後, post-capture 時 grid 已無 10.0.0.2 → 不可再對其做 post-capture pageHasText, 故略過.
                            'E2E-003-1-row-selected-before-save',
                            'E2E-003-2-delete-row-save-success',
                        ])
                        for (let [bname, b] of Object.entries(result)) {
                            if (expectedSpecText[bname] && !skipSpecKeys.has(bname)) {
                                //最終態語意 (如 E2E-002-1 之 '10.0.0.99' cell 顯示、E2E-002-3 之 grid 改後 IP)
                                await assertSpecForCase(page, lang, bname)
                            }
                            assertBaselineMatch(b, bp(lang, bname), `ips-${lang}-${bname}`)
                        }
                    }

                    //DB 副作用斷言
                    if (name === 'E2E-002-modify-ip-save-success') {
                        //修改後 DB 該列 ip 應變為新值
                        let rs = await woItems.ips.select({ id: 'id-test-ip-1' }).catch(() => [])
                        assert.strict.equal(rs.length, 1, `id-test-ip-1 應存在`)
                        assert.strict.equal(rs[0].ip, '10.0.0.99', `id-test-ip-1 之 ip 應已更新為 10.0.0.99, 實際: ${rs[0].ip}`)
                    }
                    else if (name === 'E2E-003-delete-row-save-success') {
                        //刪除後 DB 該列應不存在
                        let rs = await woItems.ips.select({ id: 'id-test-ip-2' }).catch(() => [])
                        assert.strict.equal(rs.length, 0, `id-test-ip-2 應已被刪除, 實際: ${rs.length} 筆`)
                        //其他 seed 列應仍在 (只篩 id-test-ip-* 前綴, 避開系統自動追蹤之非 seed IP 殘留)
                        let all = await woItems.ips.select().catch(() => [])
                        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-ip-'))
                        assert.strict.equal(seedRows.length, testIps.length - 1, `其他 seed ips 列應仍在, 實際: ${seedRows.length} 筆 (預期 ${testIps.length - 1})`)
                    }
                    else if (name === 'E2E-004-token-expired-save-fail') {
                        //token 過期 reject → DB 不應變動 (id-test-ip-3 之 ip 仍為原值)
                        let rs = await woItems.ips.select({ id: 'id-test-ip-3' }).catch(() => [])
                        assert.strict.equal(rs.length, 1, `id-test-ip-3 應仍存在`)
                        assert.strict.equal(rs[0].ip, '10.0.0.3', `token 過期 reject 後 id-test-ip-3 之 ip 不應變動 (預期 10.0.0.3, 實際: ${rs[0].ip})`)
                        //seed ips 數量不變 (同上, 只篩 id-test-ip-* 前綴)
                        let all = await woItems.ips.select().catch(() => [])
                        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-ip-'))
                        assert.strict.equal(seedRows.length, testIps.length, `token 過期 reject 後 seed ips 總數不應變動 (預期 ${testIps.length}, 實際: ${seedRows.length})`)
                    }
                })
            }

        })

    }

}
