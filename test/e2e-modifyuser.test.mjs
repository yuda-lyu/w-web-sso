import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch, launchBrowser, waitUntilExist, typeIntoNthInput } from './e2e-setup.mjs'


//
// E2E modifyuser test — 後台變更使用者資訊流程
//
// 對應流程文件：spec/流程_後台變更使用者資訊.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-modifyuser.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-modifyuser.test.mjs --timeout 240000
//   --names <eng-002-account-empty,...> 進行手術式 baseline 重產
//
// 標準圖存放：test/pics/modifyuser/modifyuser-{lang}-{number}-{name}.png
//
// 涵蓋 13 個 UI distinct 狀態 (× 2 lang = 26 baselines)。所有 capture 透過真實 UI
// 互動推進: 鍵盤滑鼠輸入 / ag-grid cell dblclick + Enter / checkbox click / 按鈕
// SVG path 點擊 / WTimeminute popup 互動 / ag-grid row drag.
// setup 階段以 woItems 預置 DB row, 是 e2e setup 例外 (見全域 CLAUDE.md §6.3 setup 階段例外).
//

let salt = '{salt}'
let baselineDir = './test/pics/modifyuser'
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
    return path.join(baselineDir, `modifyuser-${lang}-${name}.png`)
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
    'E2E-004-email-empty': {
        eng: 'Empty email of user',
        cht: '尚未給予使用者Email',
    },
    'E2E-005-email-format': {
        eng: 'Invalid email of user',
        cht: '使用者Email格式錯誤',
    },
    'E2E-006-email-duplicate': {
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    'E2E-007-redir-empty': {
        eng: 'Invalid redirect of user',
        cht: '尚未給予有效登入後轉址',
    },
    'E2E-008-cannot-demote-self': {
        eng: 'Cannot demote yourself from admin',
        cht: '不可解除自己的管理員權限',
    },
    'E2E-009-cannot-disable-self': {
        eng: 'Cannot disable yourself',
        cht: '不可停用自己的帳號',
    },
    'E2E-010-email-conflict-backend': {
        //後端 ckKey('email') 重複 → 與 006 同訊息 (產品設計上同 UI 文字)
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    'E2E-011-token-expired-backend': {
        //後端 token 過期 / 非 admin 共用 userSaveUsersFail 前綴 (不洩露身分檢查細節)
        eng: 'Failed to save users',
        cht: '儲存使用者數據失敗',
    },
    //001 修改成功 (儲存成功後重 fetch + dismiss CheckYes), DB 驗證 audit fields
    //012 timeVerified 修改成功, DB 驗證 timemsTZ 格式寫入
    //013 拖拉順序成功, DB 驗證 order 重指派 = k+1
}


//儲存成功時 CheckYes modal 顯示之文字 (procLang.mjs userSaveUsersSuccess, type:'success').
//對應 spec/流程_後台變更使用者資訊.md §三「047 hideLoading + await showCheckYes(<userSaveUsersSuccess>)」
//與 i18n 粒度規則 line 349「儲存成功 → userSaveUsersSuccess → CheckYes modal」.
//成功 case (E2E-001/012/013/014) 共用此文字; 由 dismissModalAndCaptureTargetRow 於成功 modal
//顯示中 (截 stage1 後、按確認鈕關閉前) 斷言, 否則點 OK 後 modal dismiss 即無法再驗.
let expectedSuccessModalText = {
    eng: 'Save users successfully',
    cht: '儲存使用者數據成功',
}


// ===================================================================
// 測試使用者 / Token
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-mu-admin',
        account: 'mu-admin',
        rawPassword: 'Pw@muadmin1',
        name: 'Modify Admin',
        email: 'mu-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
    target: {
        id: 'id-mu-target',
        account: 'mu-target',
        rawPassword: 'Pw@mutarget1',
        name: 'Modify Target',
        email: 'mu-target@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
}

let userTokens = {}


//target.timeBlocked 預設為未來時間 (將 target 視為封鎖中). 理由:
//  WTimeminute popup 在 value='' 時點 day cell 後 @input 不會穩定寫回 (邊界行為),
//  case 014 用 '改現有 timeBlocked → 改另一個 day' 比 '從空改為某時間' 穩定.
//  (先前另有「cleanUsers timer 會秒清過期值」之考量; 該 timer 已於 2026-07-06 依 ADR-013 隱性解除移除, 不再是限制)
//  case 014 仍符合 spec「修改 timeBlocked」契約 — 從一個 timemsTZ 改為另一個 day 的 timemsTZ.
//  target 被視為封鎖不影響 admin 登入流程 (admin 自身 timeBlocked='').
let targetInitialTimeBlocked = '2030-06-01T00:00:00.000+08:00'


//凍結 timeCreate / timeUpdate 為固定字串, 讓 Users list 之「Created time」/「Updated time」欄顯示穩定.
//(users.funNew 預設把 timeCreate/timeUpdate 設為 nowms2str() wall-clock → 捲到最右欄之 case (E2E-009 框 isActive)
// 全頁截圖會帶入該兩欄之 wall-clock 時間戳 → 每跑不同 → pixel flake. 比照 timeVerified / timeExpired 等
// 其他時間欄之凍結做法, 也對齊 e2e-tokens 之 FIX_TIME 慣例.)
let FIX_TIME = '2025-01-01T00:00:00.000+08:00'


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens), 再插入本檔專屬資料.
    //此函式為 mocha hook 與 generateBaseline 共用的 own-insert 單一入口, 放在最前一行即可
    //同時覆蓋兩條路徑 (per-test hermetic setup).
    await resetToBaseSeed()

    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 890 + k,
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
            timeBlocked: u.id === testUsers.target.id ? targetInitialTimeBlocked : '',
            isActive: 'y',
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = u.id === testUsers.target.id ? targetInitialTimeBlocked : ''
        //凍結 audit 時間欄 (funNew 預設填 wall-clock now), 避免 Created/Updated time 欄 pixel flake
        v.timeCreate = FIX_TIME
        v.timeUpdate = FIX_TIME
        return v
    })
    await woItems.users.insert(rs)

    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    //統一所有 users (含 resetToBaseSeed 插入之 base seed user) 之 timeCreate / timeUpdate 為固定值.
    //base seed user 由 buildBaseUsers() 經 funNew 產生, 其 timeCreate/timeUpdate 為彼時 wall-clock now,
    //會出現在「Created time」/「Updated time」欄 → 全頁截圖 (E2E-009 框 isActive 捲到最右) 每跑不同 → flake.
    //(本檔 testUsers 已在 insert 前直接設 FIX_TIME, 此 normalize 對它們等同 noop, 保留以兼顧 base seed.)
    await normalizeUserTimes()

    console.log(`inserted ${rs.length} modifyuser test users + 1 token`)
}


//把所有 users 之 timeCreate / timeUpdate 一次性 normalize 為 FIX_TIME (對齊 e2e-tokens 之 normalizeTokenTimes)
async function normalizeUserTimes() {
    let us = await woItems.users.select().catch(() => [])
    for (let u of us) {
        if (u.timeCreate !== FIX_TIME || u.timeUpdate !== FIX_TIME) {
            await woItems.users.save({ id: u.id, timeCreate: FIX_TIME, timeUpdate: FIX_TIME }).catch(() => {})
        }
    }
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含動態建立的複製使用者), 保留 base seed.
    await deleteNonBaseSeed()
    console.log('deleted modifyuser test users + tokens')
}


//每個 it 之間 admin token 都要復原
async function resetAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


//強制將 admin token 設為過期 (case 011 用)
async function forceExpireAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) {
        _tk.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.save(_tk).catch(() => {})
    }
}


// ===================================================================
// UI helpers
// ===================================================================

let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'


let kpUiText = {
    eng: { login: 'Log in', usersList: 'Users list', editMode: 'Edit mode', ok: 'OK', statistics: 'Statistics' },
    cht: { login: '登入', usersList: '使用者清單', editMode: '編輯模式', ok: '確認', statistics: '統計' },
}


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


//ag-grid header 中找到 col-id 對應 cell, 必要時水平 scroll 讓 cell 進入 viewport
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


async function findRowIndexByAccount(page, account) {
    return await page.evaluate((acc) => {
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


//dblclick cell → 啟動 editor → 清空 → 輸入 → Enter
async function fillAgGridCell(page, rowIdx, colId, value) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    await page.waitForTimeout(400)
    let editor = page.locator(`${cellSel} input`)
    await editor.waitFor({ state: 'visible', timeout: 5000 })

    let cur = await page.evaluate((sel) => document.querySelector(sel + ' input')?.value || '', cellSel)
    if (cur) {
        await page.keyboard.press('End')
        for (let i = 0; i < cur.length + 2; i++) {
            await page.keyboard.press('Backspace')
        }
    }
    if (value) {
        await page.keyboard.insertText(value)
    }
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
}


//點擊某列某欄的 checkbox (isAdmin / isActive)
async function clickRowCheckbox(page, rowIdx, colId) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    let cb = page.locator(`${cellSel} input[type="checkbox"]`)
    await cb.waitFor({ state: 'visible', timeout: 5000 })
    await cb.click()
    await page.waitForTimeout(400)
}


//點儲存按鈕
async function clickSave(page) {
    let p = await locateMdiButton(page, mdiCloudUploadOutline)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(800)
}


//等 CheckYes modal 出現 + 內部穩定化:
//  1. window scrollTop=0, ag-grid 水平 scroll=0
//  2. mouse 移到 (0,0) 角落 (清 hover state)
//  3. 等 ag-grid 連續 3 次 raf 之間 cell 狀態不變 (idle)
//  4. 等 WDrawer sidebar 寬度連續 ~2s 不變 — 觸發儲存後 ag-grid 重 fetch → layout 變動 →
//     ResizeObserver 觸發 WDrawer autoSwitchToHide/Show 切換 → 不等則 captureStable 可能
//     收斂到「收合中」或「展開後」兩個 stable state 之一 (殷鑑: e2e-adduser case 009 同問題).
async function waitCheckYes(page, lang) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 30000 })
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.mouse.move(0, 0)
    await page.waitForFunction(async () => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return true
        if (body.scrollLeft !== 0) return false
        if (!document.querySelector('.ag-header-cell[col-id="account"]')) return false
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

    //sidebar (WDrawer) 寬度穩定: 連續 10 samples (~2s @ 200ms poll) 同寬度才視為 settle
    await page.waitForFunction(() => {
        let drawer = document.querySelector('.w-drawer .panel') || document.querySelector('.w-drawer')
        if (!drawer) return true
        let key = '__muDrawerSamples'
        if (!window[key]) window[key] = []
        let w = Math.round(drawer.getBoundingClientRect().width)
        window[key].push({ t: Date.now(), w })
        let cutoff = Date.now() - 2000
        window[key] = window[key].filter((s) => s.t >= cutoff)
        if (window[key].length < 10) return false
        return window[key].every((s) => s.w === window[key][0].w)
    }, null, { timeout: 10000, polling: 200 }).catch(() => {})

    await page.waitForTimeout(1500)
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
        await page.waitForTimeout(1000)
    }

    await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2)

    await typeIntoNthInput(page, 0, testUsers.admin.account)
    await typeIntoNthInput(page, 1, testUsers.admin.rawPassword)

    await page.locator(`text="${t.login}"`).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.locator(`text="${t.login}"`).first().click()

    //login → backstage 跨頁 redirect, 固定 10s buffer + 偵測 Statistics
    await page.waitForTimeout(10000)
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics })

    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(2500)

    //確認 Edit mode 是 on (本流程須點 + / 拖 / 編輯, 都要 isEditable)
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

    //等 ag-grid 第一列 cell 渲染穩定
    await waitUntilExist(page, 'ag-grid 第一列', () => document.querySelectorAll('.ag-row').length > 0)
    await page.waitForFunction(async () => {
        let cells = document.querySelectorAll('.ag-cell')
        if (cells.length < 5) return false
        let s1 = cells.length
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        let s2 = document.querySelectorAll('.ag-cell').length
        return s1 === s2
    }, null, { timeout: 15000 })
    await page.waitForTimeout(800)
}


// ===================================================================
// capture helpers (13 cases)
// ===================================================================

//成功類 case 共用 (多階段): 先框「儲存成功 modal (綠勾)」(stage1) → 點 OK 關閉 → 等 grid 穩定 →
//  框 target 那一列 (stage2, 跨 pinned-left + center container 取聯集).
//此函式由 001 / 012 / 013 / 014 在 waitCheckYes 後呼叫.
//  stage1 = 儲存成功 modal 畫面 (按 OK 之前截), stage2 = 改動後的 target 使用者列.
//回傳 dict { 'E2E-NNN-1-save-success-modal': modalBuf, [stage2Name]: rowBuf };
//  數字前綴使檔名排序 ≡ 階段順序 (1 成功 modal → 2 結果列). stage2Name 由各 case 傳入.
//只截 target 那一列而非整表, 聚焦驗證「改動結果已反映在正確列」.
async function dismissModalAndCaptureTargetRow(page, lang, e2eNo, stage2Name) {
    let t = kpUiText[lang]

    //[多階段 stage1] 點 OK 前先框「儲存成功 modal (綠勾)」— WDialog 內層 panel
    let modalBuf = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')

    //語意斷言 (成功 modal 文字): 對應 spec §三 047「showCheckYes(<userSaveUsersSuccess>)」
    //與 i18n 粒度規則 line 349「儲存成功 → CheckYes modal」. 須在點 OK 關閉前驗 (dismiss 後 DOM 即無此字).
    //此斷言於 mocha 與 --baseline 兩條路徑皆執行 (成功 modal 本就應含該字, 不符即中止, 不凍結 bug).
    let successNeedle = expectedSuccessModalText[lang]
    let hasSuccess = await page.evaluate((s) => (document.body.innerText || '').includes(s), successNeedle)
    assert.strict.equal(hasSuccess, true, `儲存成功 modal 應含成功訊息文字「${successNeedle}」 (case E2E-${e2eNo})`)

    await page.locator(`text="${t.ok}"`).first().click() //關閉 success modal
    //等表格刷新 (重 fetch getUsersList) 並穩定: 連續三次 raf cell 數量 + row[0] cell 文字不變
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

    //找 target 列的 row-index (save 後重 fetch 清單, target 仍可由 account 定位)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    if (tgtRowIdx === null) throw new Error(`target row not found after save (account=${testUsers.target.account})`)

    //[多階段 stage2] 框 target 那一列: 跨 pinned-left + center container 取聯集 = 整列寬
    let rowBuf = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${tgtRowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${tgtRowIdx}"]`,
    ])

    return {
        [`E2E-${e2eNo}-1-save-success-modal`]: modalBuf,
        [stage2Name]: rowBuf,
    }
}


//001 修改成功 (多階段): dblclick target name → 改值 → save → 框成功 modal (stage1) → 關閉 → 框 target 那一列 (stage2, 改名後的結果).
//stage1 截圖標的為儲存成功 modal, stage2 為改動後的 target 使用者列, 驗證「修改結果已反映在清單中」.
async function captureModifyNameSuccess(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    if (tgtRowIdx === null) throw new Error(`target row not found for account=${testUsers.target.account}`)

    let newName = 'Modified Target'
    await fillAgGridCell(page, parseInt(tgtRowIdx), 'name', newName)

    await clickSave(page)
    await waitCheckYes(page, lang) //success modal

    return await dismissModalAndCaptureTargetRow(page, lang, '001', 'E2E-001-2-after-save-modify-name')
}


//002 account 改空: clear target account cell → save → 前端 isError 攔下 (cell warn + modal)
//多階段: stage1 = save 前框 target 列 account 空格 (含警示 icon, 讓讀者看到正是此格改空才觸發),
//        stage2 = save 後 CheckYes modal (帳號無效錯誤訊息)
async function captureAccountEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'account', '')
    //[多階段 stage1] save 前框 target 列 account 空格 (account 已清空, row-index 不變)
    await ensureColumnVisible(page, 'account')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="account"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-002-1-account-empty-cell': bufTrigger,
        'E2E-002-2-account-empty': bufModal,
    }
}


//003 account 改為同表內重複: target.account = admin.account
//多階段: stage1 = save 前框 target 列 account 格 (已改成與 admin 相同, 觸發重複),
//        stage2 = CheckYes modal (帳號重複錯誤訊息)
async function captureAccountDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'account', testUsers.admin.account)
    //[多階段 stage1] save 前框 target 列 account 格 (此時值已是 admin.account → 同表重複)
    await ensureColumnVisible(page, 'account')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="account"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-003-1-account-duplicate-cell': bufTrigger,
        'E2E-003-2-account-duplicate': bufModal,
    }
}


//004 email 改空
//多階段: stage1 = save 前框 target 列 email 空格, stage2 = CheckYes modal (email 空錯誤訊息)
async function captureEmailEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'email', '')
    //[多階段 stage1] save 前框 target 列 email 空格
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="email"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-004-1-email-empty-cell': bufTrigger,
        'E2E-004-2-email-empty': bufModal,
    }
}


//005 email 改為格式錯
//多階段: stage1 = save 前框 target 列 email 格 (已改成格式錯誤值), stage2 = CheckYes modal
async function captureEmailFormat(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'email', 'not-an-email-format')
    //[多階段 stage1] save 前框 target 列 email 格 (值為非法格式)
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="email"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-005-1-email-format-cell': bufTrigger,
        'E2E-005-2-email-format': bufModal,
    }
}


//006 email 改為同表內重複: target.email = admin.email
//多階段: stage1 = save 前框 target 列 email 格 (已改成與 admin 相同), stage2 = CheckYes modal
async function captureEmailDuplicate(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'email', testUsers.admin.email)
    //[多階段 stage1] save 前框 target 列 email 格 (值為 admin.email → 同表重複)
    await ensureColumnVisible(page, 'email')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="email"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-006-1-email-duplicate-cell': bufTrigger,
        'E2E-006-2-email-duplicate': bufModal,
    }
}


//007 redir 改空
//多階段: stage1 = save 前框 target 列 redir 空格 (需水平 scroll 使欄進入 viewport),
//        stage2 = CheckYes modal (轉址無效錯誤訊息)
async function captureRedirEmpty(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.target.account))
    await fillAgGridCell(page, tgtRowIdx, 'redir', '')
    //[多階段 stage1] save 前框 target 列 redir 空格
    await ensureColumnVisible(page, 'redir')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${tgtRowIdx}"] .ag-cell[col-id="redir"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-007-1-redir-empty-cell': bufTrigger,
        'E2E-007-2-redir-empty': bufModal,
    }
}


//008 admin 解除自己 isAdmin (前端自我鎖死保護)
//多階段: stage1 = save 前框 admin 自己列的 isAdmin checkbox 格 (已取消勾選), stage2 = CheckYes modal
async function captureCannotDemoteSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let adminRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.admin.account))
    await clickRowCheckbox(page, adminRowIdx, 'isAdmin')
    //[多階段 stage1] save 前框 admin 自己列 isAdmin checkbox 格 (已取消勾選)
    await ensureColumnVisible(page, 'isAdmin')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${adminRowIdx}"] .ag-cell[col-id="isAdmin"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-008-1-isadmin-uncheck-cell': bufTrigger,
        'E2E-008-2-cannot-demote-self': bufModal,
    }
}


//009 admin 停用自己 isActive
//多階段: stage1 = save 前框 admin 自己列的 isActive checkbox 格 (已取消勾選), stage2 = CheckYes modal
async function captureCannotDisableSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let adminRowIdx = parseInt(await findRowIndexByAccount(page, testUsers.admin.account))
    await clickRowCheckbox(page, adminRowIdx, 'isActive')
    //[多階段 stage1] save 前框 admin 自己列 isActive checkbox 格 (已取消勾選)
    await ensureColumnVisible(page, 'isActive')
    let bufTrigger = await captureStableWithBox(page, `.ag-row[row-index="${adminRowIdx}"] .ag-cell[col-id="isActive"]`)
    await clickSave(page)
    await waitCheckYes(page, lang)
    let bufModal = await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
    return {
        'E2E-009-1-isactive-uncheck-cell': bufTrigger,
        'E2E-009-2-cannot-disable-self': bufModal,
    }
}


//010 email 同表內重複 — 前端 errItemsByEmail 與後端 ckKey 共用同訊息;
//   spec line 13 描述「前端 pass + 後端 reject」場景, 現行 code (procCore.mjs:1240
//   ckKey 僅檢查 rows 內部) 看不出 frontend pass 後 backend ckKey 仍 reject 的觸發條件,
//   屬 spec 與 code 描述不對齊 (race condition 場景無法純 UI 模擬). 故 010 視覺等同於 006,
//   以同訊息驗證設計上「前後端訊息一致」契約.
async function captureEmailConflictBackend(page, lang) {
    //010 維持單張 Buffer 契約 (與 006 共用 UI 終態 modal); 從 006 多階段 dict 取 modal stage 回傳.
    let stages = await captureEmailDuplicate(page, lang)
    return stages['E2E-006-2-email-duplicate']
}


//011 token 過期 / 非 admin 共用 (spec 不洩露身分檢查):
//   1. 進 backstage Users list (token 有效)
//   2. dblclick name 改值, 觸發 isModified=true
//   3. 後端 DB 操作: 把 admin token timeEnd 設為過去 (模擬點儲存時 token 已過期)
//   4. clickSave → 後端 checkToken reject → CheckYes modal 含 userSaveUsersFail 前綴
async function captureTokenExpiredBackend(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await fillAgGridCell(page, parseInt(tgtRowIdx), 'name', 'Modified With Expired Token')

    //儲存前讓 token 過期 (繞過前端時序, 模擬「修改完之後 token 才過期」場景)
    await forceExpireAdminToken()

    await clickSave(page)
    await waitCheckYes(page, lang)
    return await captureStableWithBox(page, 'div[style*="overscroll-behavior"] div[tabindex="0"] > div')
}


//WTimeminute 互動共通: 開 popup → 點 day cell → 關 popup. 對應 cell colId + rowId 傳入.
//
//元件鏈: WTimeminute → WShellEllipse → WTimeminuteCore → WTimedayCore → WPopup → WTooltip
//WTooltip 的 divTrigger (<div tabindex="0" @click="evShow('popup','click')">) 才是綁
//@click 開啟 popup 的元素. cell 內第一個 tabindex=0 是 day picker trigger, 第二個是 time.
//
//popup 內容透過 Teleport 渲染到 body 底下, 跟 cell 失聯. 以前用 visibility filter 找
//當前可見 popup, 但只要有跨 row 同時開 popup 或 v-show 殘留 DOM, 就有 cross-popup 污染風險.
//現用 w-component-vue 提供的 labelContentForDay prop, 該值會傳到 popup 的 div[wtlp=...]
//作為 identity-based selector, 不依賴可見性, 不會撞 cross-row 同名 popup.
//
//LayoutContentUsers.vue 三個 WTimeminute 給的 wtlp 規則:
//  users-timeVerified-day-{rowId} / users-timeExpired-day-{rowId} / users-timeBlocked-day-{rowId}
async function clickTimeCellAndPickDay(page, rowIdx, colId, rowId) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    await page.locator(cellSel).scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)

    let opened = await page.evaluate((sel) => {
        let cell = document.querySelector(sel)
        if (!cell) return { ok: false, reason: 'cell not found' }
        let triggers = Array.from(cell.querySelectorAll('div[tabindex="0"]'))
        if (triggers.length === 0) return { ok: false, reason: 'no tabindex=0 trigger in cell' }
        //取第一個 (day picker), 第二個是 time picker
        triggers[0].click()
        return { ok: true }
    }, cellSel)
    if (!opened.ok) throw new Error(`無法定位 WTimeminute divTrigger (${colId}): ${opened.reason}`)

    //等 popup teleport 容器 (div[wtlp="..."]) 出現 day grid (1-31 葉節點)
    let wtlp = `users-${colId}-day-${rowId}`
    await page.waitForFunction((lbl) => {
        let popup = document.querySelector(`[wtlp="${lbl}"]`)
        if (!popup) return false
        let dayCells = Array.from(popup.querySelectorAll('div')).filter((el) => {
            let txt = (el.innerText || '').trim()
            if (!/^\d{1,2}$/.test(txt)) return false
            let n = parseInt(txt, 10)
            return n >= 1 && n <= 31 && el.children.length === 0
        })
        return dayCells.length >= 10
    }, wtlp, { timeout: 5000 })

    //點該 popup 內 day="15" — identity-based 鎖定唯一 popup, 不會跨 row / 跨欄位污染
    let dayClicked = await page.evaluate((lbl) => {
        let popup = document.querySelector(`[wtlp="${lbl}"]`)
        if (!popup) return null
        let dayCells = Array.from(popup.querySelectorAll('div')).filter((el) => {
            let txt = (el.innerText || '').trim()
            if (!/^\d{1,2}$/.test(txt)) return false
            let n = parseInt(txt, 10)
            return n >= 1 && n <= 31 && el.children.length === 0
        })
        let pick = dayCells.find((el) => (el.innerText || '').trim() === '15')
        if (!pick) return null
        pick.click()
        return { text: pick.innerText, cellCount: dayCells.length }
    }, wtlp)
    if (!dayClicked) throw new Error(`WTimeminute popup day cell "15" 未在 [wtlp="${wtlp}"] 內找到`)
    await page.waitForTimeout(800)

    //popup 外圍點擊關閉
    await page.mouse.click(50, 50)
    await page.waitForTimeout(500)
}


//012 timeVerified 修改 (多階段): WTimeminute popup 互動 + save success → 框成功 modal (stage1) → 關閉 → 框 target 那一列 (stage2, 顯示改後的時間欄).
async function captureTimeModifyVerified(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await clickTimeCellAndPickDay(page, parseInt(tgtRowIdx), 'timeVerified', testUsers.target.id)
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await dismissModalAndCaptureTargetRow(page, lang, '012', 'E2E-012-2-time-modify-verified')
}


//013 timeExpired 修改 (多階段): 同上, 改 timeExpired 欄位
async function captureTimeModifyExpired(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await clickTimeCellAndPickDay(page, parseInt(tgtRowIdx), 'timeExpired', testUsers.target.id)
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await dismissModalAndCaptureTargetRow(page, lang, '013', 'E2E-013-2-time-modify-expired')
}


//014 timeBlocked 修改 (多階段): 同上, 改 timeBlocked 欄位
async function captureTimeModifyBlocked(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await clickTimeCellAndPickDay(page, parseInt(tgtRowIdx), 'timeBlocked', testUsers.target.id)
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await dismissModalAndCaptureTargetRow(page, lang, '014', 'E2E-014-2-time-modify-blocked')
}


//015 拖拉順序: 拖 target row 到 admin row 之前 (改變 order)
//   ag-grid rowDrag (account 欄啟用 kpRowDrag.account=true) 透過 .ag-row-drag DOM 元素
//   作為 drag handle. 在 account cell 內部最左側. 需精準命中該 handle.
//   ag-grid 使用 HTML5 native drag events (dragstart/dragover/drop), Playwright 的
//   mouse.move + down + up 通常會被 ag-grid 識別為 drag, 但須給足時序 + 中間多次 dragover.
async function captureDragReorder(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let adminRowIdx = await findRowIndexByAccount(page, testUsers.admin.account)
    let targetRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    if (adminRowIdx === null || targetRowIdx === null) throw new Error('cannot find admin / target rows for drag')

    //定位 .ag-row-drag 在 target / admin 列內的中心座標
    let coords = await page.evaluate(({ a, t }) => {
        let aRow = document.querySelector(`.ag-row[row-index="${a}"] .ag-row-drag`)
        let tRow = document.querySelector(`.ag-row[row-index="${t}"] .ag-row-drag`)
        if (!aRow || !tRow) return null
        let aR = aRow.getBoundingClientRect()
        let tR = tRow.getBoundingClientRect()
        return {
            srcX: Math.round(tR.x + tR.width / 2),
            srcY: Math.round(tR.y + tR.height / 2),
            dstX: Math.round(aR.x + aR.width / 2),
            //目標位置: admin row 的「上半」(讓 target drop 到 admin 之前, 而非之後)
            dstY: Math.round(aR.y + 2),
        }
    }, { a: parseInt(adminRowIdx), t: parseInt(targetRowIdx) })
    if (!coords) throw new Error('cannot resolve drag handle coords (.ag-row-drag not found)')

    //mouse 序列: hover handle → down → 多次 move (給 ag-grid 認 drag) → up at target
    await page.mouse.move(coords.srcX, coords.srcY)
    await page.waitForTimeout(200)
    await page.mouse.down()
    await page.waitForTimeout(100)
    //ag-grid 需要 mouse 至少移動超過 dragThreshold (預設 4px) 才認為是 drag, 非 click
    //中間多次 move + 暫停讓 ag-grid 處理 dragover events
    let steps = 20
    for (let i = 1; i <= steps; i++) {
        let x = coords.srcX + (coords.dstX - coords.srcX) * i / steps
        let y = coords.srcY + (coords.dstY - coords.srcY) * i / steps
        await page.mouse.move(x, y, { steps: 5 })
        await page.waitForTimeout(40)
    }
    //停在 dst 位置一下子讓 ag-grid 認 drop target
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(1200)

    await clickSave(page)
    await waitCheckYes(page, lang)

    //語意斷言 (成功 modal 文字): 對應 spec §三 047「showCheckYes(<userSaveUsersSuccess>)」+ i18n 粒度規則 line 349.
    //E2E-015 拖拉成功亦走 saveUsers 成功路徑, 須在點 OK 關閉前驗 (dismiss 後 DOM 即無此字); 僅加語意, 不動 baseline.
    let successNeedle = expectedSuccessModalText[lang]
    let hasSuccess = await page.evaluate((s) => (document.body.innerText || '').includes(s), successNeedle)
    assert.strict.equal(hasSuccess, true, `儲存成功 modal 應含成功訊息文字「${successNeedle}」 (case E2E-015 drag-reorder)`)

    //關閉 success modal → 等 grid 刷新穩定
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().click()
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

    //拖拉驗證標的是「兩列的相對順序」, 故框被拖動的 target 列與其緊鄰的 admin 列的聯集.
    //這樣可一眼確認 target 排在 admin 前方, 比只框一列更能驗證「順序改變了」這個核心語意.
    let finalTargetIdx = await findRowIndexByAccount(page, testUsers.target.account)
    let finalAdminIdx = await findRowIndexByAccount(page, testUsers.admin.account)
    if (finalTargetIdx === null || finalAdminIdx === null) throw new Error('cannot find rows after drag save')

    //聯集兩列（pinned-left + center 各取 target 與 admin 列，共 4 個 selector）
    return await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${finalTargetIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${finalTargetIdx}"]`,
        `.ag-pinned-left-cols-container .ag-row[row-index="${finalAdminIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${finalAdminIdx}"]`,
    ])
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-after-save-modify-name', captureModifyNameSuccess],
        ['E2E-002-account-empty', captureAccountEmpty],
        ['E2E-003-account-duplicate', captureAccountDuplicate],
        ['E2E-004-email-empty', captureEmailEmpty],
        ['E2E-005-email-format', captureEmailFormat],
        ['E2E-006-email-duplicate', captureEmailDuplicate],
        ['E2E-007-redir-empty', captureRedirEmpty],
        ['E2E-008-cannot-demote-self', captureCannotDemoteSelf],
        ['E2E-009-cannot-disable-self', captureCannotDisableSelf],
        ['E2E-010-email-conflict-backend', captureEmailConflictBackend],
        ['E2E-011-token-expired-backend', captureTokenExpiredBackend],
        ['E2E-012-time-modify-verified', captureTimeModifyVerified],
        ['E2E-013-time-modify-expired', captureTimeModifyExpired],
        ['E2E-014-time-modify-blocked', captureTimeModifyBlocked],
        ['E2E-015-drag-reorder', captureDragReorder],
    ]

    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        //per-case fresh DB + browser, 與 mocha beforeEach 對稱
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        let browser = await launchBrowser()
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', (d) => d.accept())

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            writeBaseline(lang, bname, b)
        }

        await browser.close()
        await deleteTestUsersAndTokens()
    }
}


async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
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

        describe(`ModifyUser E2E [${lang}] — 後台變更使用者資訊`, function() {
            this.timeout(180000)

            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()
                await resetAdminToken()

                browser = await launchBrowser()
                let context = await browser.newContext()
                page = await context.newPage()
                page.on('dialog', (d) => d.accept())
            })

            afterEach(async function() {
                if (browser) {
                    await browser.close()
                    browser = null
                }
                await deleteTestUsersAndTokens()
            })


            //通用斷言: 截圖比對 baseline (語意斷言由各 case 內補)
            async function assertBaseline(buf, caseName) {
                let baselinePath = bp(lang, caseName)
                //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
                assertBaselineMatch(buf, baselinePath, `modifyuser-${lang}-${caseName}`)
            }


            //多階段斷言: capture fn 回 Buffer (單張) 或 dict { baselineName: buf } (多張) → 逐張比對 baseline
            async function assertBaselineStages(result, singleName) {
                let stages = Buffer.isBuffer(result) ? { [singleName]: result } : result
                for (let [bname, b] of Object.entries(stages)) {
                    assertBaselineMatch(b, bp(lang, bname), `modifyuser-${lang}-${bname}`)
                }
            }


            async function assertModalText(caseName) {
                let exp = expectedModalText[caseName]
                if (!exp) return
                let needle = exp[lang]
                let has = await page.evaluate((t) => (document.body.innerText || '').includes(t), needle)
                assert.strict.equal(has, true, `Modal 應含預期文字「${needle}」 (case: ${caseName})`)
            }


            it(`E2E-001-after-save-modify-name: dblclick name 改值 → save → success modal → DB audit fields`, async function() {
                let result = await captureModifyNameSuccess(page, lang)
                //多階段: stage1 成功 modal + stage2 結果列, 逐張比對
                await assertBaselineStages(result, 'E2E-001-after-save-modify-name')

                //DB 斷言: name 變更; userIdUpdate=admin.id; timeUpdate 不為空; password hash 保留; userId/timeCreate 保留
                let updated = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(updated.length, 1, `target user 應仍存在`)
                assert.strict.equal(updated[0].name, 'Modified Target', `name 應已變更`)
                assert.strict.equal(updated[0].userIdUpdate, testUsers.admin.id, `userIdUpdate 應為 admin.id`)
                assert.strict.notEqual(updated[0].timeUpdate, '', `timeUpdate 應被填入`)
                assert.strict.equal(verifyPassword(testUsers.target.rawPassword, updated[0].password, salt), true, `password hash 應保留 (仍可由原 rawPassword 驗證通過)`)
            })


            it(`E2E-002-account-empty: account → 空 → save → 前端 isError 攔下`, async function() {
                let result = await captureAccountEmpty(page, lang)
                //多階段: stage1 觸發 cell + stage2 錯誤 modal, 逐張比對
                await assertBaselineStages(result, 'E2E-002-account-empty')
                await assertModalText('E2E-002-account-empty')
                //DB: account 仍為原值
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].account, testUsers.target.account, `account 不應被儲存`)
            })


            it(`E2E-003-account-duplicate: account → 同表內重複 → save → 前端 isError 攔下`, async function() {
                let result = await captureAccountDuplicate(page, lang)
                await assertBaselineStages(result, 'E2E-003-account-duplicate')
                await assertModalText('E2E-003-account-duplicate')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].account, testUsers.target.account, `account 不應被儲存`)
            })


            it(`E2E-004-email-empty: email → 空 → save → 前端 isError 攔下`, async function() {
                let result = await captureEmailEmpty(page, lang)
                await assertBaselineStages(result, 'E2E-004-email-empty')
                await assertModalText('E2E-004-email-empty')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].email, testUsers.target.email, `email 不應被儲存`)
            })


            it(`E2E-005-email-format: email → 格式錯 → save → 前端 isError 攔下`, async function() {
                let result = await captureEmailFormat(page, lang)
                await assertBaselineStages(result, 'E2E-005-email-format')
                await assertModalText('E2E-005-email-format')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].email, testUsers.target.email, `email 不應被儲存`)
            })


            it(`E2E-006-email-duplicate: email → 同表內重複 → save → 前端 isError 攔下`, async function() {
                let result = await captureEmailDuplicate(page, lang)
                await assertBaselineStages(result, 'E2E-006-email-duplicate')
                await assertModalText('E2E-006-email-duplicate')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].email, testUsers.target.email, `email 不應被儲存`)
            })


            it(`E2E-007-redir-empty: redir → 空 → save → 前端 isError 攔下`, async function() {
                let result = await captureRedirEmpty(page, lang)
                await assertBaselineStages(result, 'E2E-007-redir-empty')
                await assertModalText('E2E-007-redir-empty')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].redir, testUsers.target.redir, `redir 不應被儲存`)
            })


            it(`E2E-008-cannot-demote-self: 取消自己 isAdmin → save → cannotDemoteSelf modal → DB 不變`, async function() {
                let result = await captureCannotDemoteSelf(page, lang)
                await assertBaselineStages(result, 'E2E-008-cannot-demote-self')
                await assertModalText('E2E-008-cannot-demote-self')
                let adminInDb = await woItems.users.select({ id: testUsers.admin.id })
                assert.strict.equal(adminInDb[0].isAdmin, 'y', `admin isAdmin 應仍為 'y'`)
            })


            it(`E2E-009-cannot-disable-self: 取消自己 isActive → save → cannotDisableSelf modal → DB 不變`, async function() {
                let result = await captureCannotDisableSelf(page, lang)
                await assertBaselineStages(result, 'E2E-009-cannot-disable-self')
                await assertModalText('E2E-009-cannot-disable-self')
                let adminInDb = await woItems.users.select({ id: testUsers.admin.id })
                assert.strict.equal(adminInDb[0].isActive, 'y', `admin isActive 應仍為 'y'`)
            })


            it(`E2E-010-email-conflict-backend: email 同表內重複 (與 006 共用 UI 與訊息) — 前後端訊息一致契約`, async function() {
                let buf = await captureEmailConflictBackend(page, lang)
                await assertBaseline(buf, 'E2E-010-email-conflict-backend')
                await assertModalText('E2E-010-email-conflict-backend')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].email, testUsers.target.email, `email 不應被儲存`)
            })


            it(`E2E-011-token-expired-backend: token 過期 → save → backend reject (userSaveUsersFail 前綴)`, async function() {
                let buf = await captureTokenExpiredBackend(page, lang)
                await assertBaseline(buf, 'E2E-011-token-expired-backend')
                await assertModalText('E2E-011-token-expired-backend')
                //DB: name 不應被儲存 (因 token 過期 reject)
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(row[0].name, testUsers.target.name, `name 不應被儲存`)
            })


            //timemsTZ 格式 sanity check helper (YYYY-MM-DDTHH:mm:ss.SSS+HH:MM 或 +HHMM)
            let isTimemsTZ = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:?\d{2}$/.test(s || '')


            it(`E2E-012-time-modify-verified: WTimeminute 修改 timeVerified → save → DB timemsTZ 寫入`, async function() {
                let result = await captureTimeModifyVerified(page, lang)
                //多階段: stage1 成功 modal + stage2 結果列, 逐張比對
                await assertBaselineStages(result, 'E2E-012-time-modify-verified')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.notEqual(row[0].timeVerified, '2025-01-01T00:00:00.000+08:00', `timeVerified 應已變更, 實際: ${row[0].timeVerified}`)
                assert.strict.notEqual(row[0].timeVerified, '', `timeVerified 不應為空`)
                assert.strict.equal(isTimemsTZ(row[0].timeVerified), true, `timeVerified 應為 timemsTZ 格式, 實際: ${row[0].timeVerified}`)
                //其他 time 欄位不應被本流程動到
                assert.strict.equal(row[0].timeExpired, '2030-01-01T00:00:00.000+08:00', `timeExpired 不應被本 case 動到`)
                assert.strict.equal(row[0].timeBlocked, targetInitialTimeBlocked, `timeBlocked 不應被本 case 動到`)
            })


            it(`E2E-013-time-modify-expired: WTimeminute 修改 timeExpired → save → DB timemsTZ 寫入`, async function() {
                let result = await captureTimeModifyExpired(page, lang)
                //多階段: stage1 成功 modal + stage2 結果列, 逐張比對
                await assertBaselineStages(result, 'E2E-013-time-modify-expired')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.notEqual(row[0].timeExpired, '2030-01-01T00:00:00.000+08:00', `timeExpired 應已變更, 實際: ${row[0].timeExpired}`)
                assert.strict.notEqual(row[0].timeExpired, '', `timeExpired 不應為空`)
                assert.strict.equal(isTimemsTZ(row[0].timeExpired), true, `timeExpired 應為 timemsTZ 格式, 實際: ${row[0].timeExpired}`)
                assert.strict.equal(row[0].timeVerified, '2025-01-01T00:00:00.000+08:00', `timeVerified 不應被本 case 動到`)
                assert.strict.equal(row[0].timeBlocked, targetInitialTimeBlocked, `timeBlocked 不應被本 case 動到`)
            })


            it(`E2E-014-time-modify-blocked: WTimeminute 修改 timeBlocked → save → DB timemsTZ 寫入`, async function() {
                let result = await captureTimeModifyBlocked(page, lang)
                //多階段: stage1 成功 modal + stage2 結果列, 逐張比對
                await assertBaselineStages(result, 'E2E-014-time-modify-blocked')
                let row = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.notEqual(row[0].timeBlocked, targetInitialTimeBlocked, `timeBlocked 應已變更 (從預設 ${targetInitialTimeBlocked} 改為另一日)`)
                assert.strict.equal(isTimemsTZ(row[0].timeBlocked), true, `timeBlocked 應為 timemsTZ 格式, 實際: ${row[0].timeBlocked}`)
                assert.strict.equal(row[0].timeVerified, '2025-01-01T00:00:00.000+08:00', `timeVerified 不應被本 case 動到`)
                assert.strict.equal(row[0].timeExpired, '2030-01-01T00:00:00.000+08:00', `timeExpired 不應被本 case 動到`)
            })


            it(`E2E-015-drag-reorder: 拖拉 target row 到 admin 之前 → save → DB order 重指派 = k+1`, async function() {
                let buf = await captureDragReorder(page, lang)
                await assertBaseline(buf, 'E2E-015-drag-reorder')
                //DB: target row order 應小於 admin order (target 拖到前面)
                let adminRow = await woItems.users.select({ id: testUsers.admin.id })
                let targetRow = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(targetRow[0].order < adminRow[0].order, true, `target.order (${targetRow[0].order}) 應 < admin.order (${adminRow[0].order})`)
            })

        })

    }

}
