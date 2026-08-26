import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput, assertBaselineMatch } from './e2e-setup.mjs'


//
// E2E delete user test — 後台刪除使用者流程
//
// 對應流程文件: spec/流程_後台刪除使用者.md
// 對應產品碼: LayoutContentUsers.vue (deleteItemsCheck @1340 + saveUsers self-protection @1395)
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-deleteuser.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-deleteuser.test.mjs --timeout 600000
//
// 標準圖存放：test/pics/deleteuser/deleteuser-{lang}-{NNN-name}.png
// 雙語覆蓋：eng + cht
//

let salt = '{salt}'
let baselineDir = './test/pics/deleteuser'
let langs = ['eng', 'cht']

// captureStableWithBox target selectors
let SEL_GRID = '.ag-root-wrapper'         // ag-grid 主體（使用者清單區）
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'  // WDialog 內層 panel（modal 框體, 非全螢幕 shield）

let kpLangText = {
    eng: {
        login: 'Log in',
        usersList: 'Users list',
        editMode: 'Edit mode',
        ok: 'OK',
    },
    cht: {
        login: '登入',
        usersList: '使用者清單',
        editMode: '編輯模式',
        ok: '確認',
    },
}


// 構造 baseline 檔名：deleteuser-{lang}-{name}.png
function bp(lang, name) {
    return path.join(baselineDir, `deleteuser-${lang}-${name}.png`)
}


// 可選 --names <eng-E2E-001-...,cht-E2E-003-...> 進行手術式 baseline 重產
let baselineNamesFilter = null
{
    let i = process.argv.indexOf('--names')
    if (i >= 0 && process.argv[i + 1]) {
        baselineNamesFilter = new Set(process.argv[i + 1].split(','))
    }
}
//是否需要產生此 case 的標準圖. --names 指定時只有指定 case 回 true → 連「截圖」都跳過 (非僅跳寫檔).
function shouldGen(lang, name) {
    return !baselineNamesFilter || baselineNamesFilter.has(`${lang}-${name}`)
}
//寫入標準圖 + 安全網: --names 指定時非指定 case 不寫 (與其他 e2e 檔一致的統一寫法).
function writeBaseline(lang, name, buf) {
    if (baselineNamesFilter && !baselineNamesFilter.has(`${lang}-${name}`)) {
        console.log(`  [skip] ${lang}-${name}`)
        return
    }
    fs.writeFileSync(bp(lang, name), buf)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_後台刪除使用者.md + procLang.mjs 衍生)
// 每張 baseline 配對 spec 檢驗, 防 baseline 變現狀指紋.
// ===================================================================

let expectedSpecText = {
    'E2E-001-initial-users-list': {
        // 初始 Users list: 看得到 admin + target row
        eng: { mode: 'present', includes: ['du-admin', 'du-target'] },
        cht: { mode: 'present', includes: ['du-admin', 'du-target'] },
    },
    'E2E-002-1-target-selected': {
        // 勾選 target 列後、trash 前: target 列還在表中且 checkbox 已勾選, 可見 target 帳號文字
        eng: { mode: 'present', includes: ['du-target'] },
        cht: { mode: 'present', includes: ['du-target'] },
    },
    'E2E-002-after-trash-pending-save': {
        // trash 後 UI 過濾 target (DB 仍存)
        eng: { mode: 'absent', value: 'du-target' },
        cht: { mode: 'absent', value: 'du-target' },
    },
    'E2E-003-modal-delete-success': {
        eng: { mode: 'text', value: 'Save users successfully' },
        cht: { mode: 'text', value: '儲存使用者數據成功' },
    },
    'E2E-004-after-refetch-target-deleted': {
        // success modal 點 OK 後, 表格刷新, target 永刪
        eng: { mode: 'absent', value: 'du-target' },
        cht: { mode: 'absent', value: 'du-target' },
    },
    'E2E-005-1-all-rows-selected': {
        // 全選後、trash 前: 所有列仍在表中且 checkbox 已勾選, 可見 admin 帳號文字
        eng: { mode: 'present', includes: ['du-admin'] },
        cht: { mode: 'present', includes: ['du-admin'] },
    },
    'E2E-005-2-empty-grid': {
        // 全選 trash 後 save 前: 表格為空 (無任何 ag-row)
        eng: { mode: 'absent', value: 'du-admin' },
        cht: { mode: 'absent', value: 'du-admin' },
    },
    'E2E-005-3-modal-userAddEmpty': {
        eng: { mode: 'text', value: 'No user' },
        cht: { mode: 'text', value: '尚未新增使用者資料' },
    },
    'E2E-006-1-self-row-selected': {
        // 勾 admin 自己列後、trash 前: 自己列還在表中且 checkbox 已勾選, 可見 admin 帳號文字
        eng: { mode: 'present', includes: ['du-admin'] },
        cht: { mode: 'present', includes: ['du-admin'] },
    },
    'E2E-006-2-grid-after-self-trash': {
        // 勾 admin 自己 trash 後 save 前: admin 列已從表移除
        eng: { mode: 'absent', value: 'du-admin' },
        cht: { mode: 'absent', value: 'du-admin' },
    },
    'E2E-006-3-modal-cannot-delete-self': {
        eng: { mode: 'text', value: 'Admin cannot delete yourself' },
        cht: { mode: 'text', value: '管理員不得刪除自己' },
    },
    'E2E-007-1-target-row-selected': {
        // 勾 target 列後、trash 前: target 列還在表中且 checkbox 已勾選, 可見 target 帳號文字
        eng: { mode: 'present', includes: ['du-target'] },
        cht: { mode: 'present', includes: ['du-target'] },
    },
    'E2E-007-2-grid-after-target-trash': {
        // 勾 target trash 後 save 前: target 列已從表移除
        eng: { mode: 'absent', value: 'du-target' },
        cht: { mode: 'absent', value: 'du-target' },
    },
    'E2E-007-3-modal-save-fail-token-deleted': {
        eng: { mode: 'text', value: 'Failed to save users' },
        cht: { mode: 'text', value: '儲存使用者數據失敗' },
    },
    //舊鍵保留供孤兒 baseline 檔命名對應（中央清除前勿刪）
    'E2E-005-modal-userAddEmpty': {
        eng: { mode: 'text', value: 'No user' },
        cht: { mode: 'text', value: '尚未新增使用者資料' },
    },
    'E2E-006-modal-cannot-delete-self': {
        eng: { mode: 'text', value: 'Admin cannot delete yourself' },
        cht: { mode: 'text', value: '管理員不得刪除自己' },
    },
    'E2E-007-modal-save-fail-token-deleted': {
        eng: { mode: 'text', value: 'Failed to save users' },
        cht: { mode: 'text', value: '儲存使用者數據失敗' },
    },
    //插入「勾選」階段後, 既有 stage1 grid 鍵編號順延 (-1- → -2-), 舊鍵成孤兒保留供中央清除前對應
    'E2E-005-1-empty-grid': {
        eng: { mode: 'absent', value: 'du-admin' },
        cht: { mode: 'absent', value: 'du-admin' },
    },
    'E2E-006-1-grid-after-self-trash': {
        eng: { mode: 'absent', value: 'du-admin' },
        cht: { mode: 'absent', value: 'du-admin' },
    },
    'E2E-007-1-grid-after-target-trash': {
        eng: { mode: 'absent', value: 'du-target' },
        cht: { mode: 'absent', value: 'du-target' },
    },
}


async function assertSpecForCase(page, lang, name) {
    let spec = expectedSpecText[name]?.[lang]
    if (!spec) {
        throw new Error(`expectedSpecText 未定義 ${name}/${lang}`)
    }
    let bodyText = await page.evaluate(() => document.body.innerText || '')
    if (spec.mode === 'text') {
        assert.strict.equal(bodyText.includes(spec.value), true,
            `[${name}/${lang}] body 應含 "${spec.value}", 實際前 200 字: ${bodyText.slice(0, 200)}`)
    }
    else if (spec.mode === 'absent') {
        assert.strict.equal(bodyText.includes(spec.value), false,
            `[${name}/${lang}] body 不應含 "${spec.value}", 實際前 200 字: ${bodyText.slice(0, 200)}`)
    }
    else if (spec.mode === 'present') {
        for (let v of spec.includes) {
            assert.strict.equal(bodyText.includes(v), true,
                `[${name}/${lang}] body 應含 "${v}", 實際前 200 字: ${bodyText.slice(0, 200)}`)
        }
    }
    else {
        throw new Error(`unknown spec mode: ${spec.mode}`)
    }
}


// ===================================================================
// 測試使用者 / Token
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-du-admin',
        account: 'du-admin',
        rawPassword: 'Pw@duadmin1',
        name: 'Delete Admin',
        email: 'du-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
    target: {
        id: 'id-du-target',
        account: 'du-target',
        rawPassword: 'Pw@dutarget1',
        name: 'Delete Target',
        email: 'du-target@test.com',
        isAdmin: 'n',
        redir: `${baseUrl}/?view=user&token={token}`,
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens), 再插入本檔專屬資料.
    //此函式為 mocha hook 與 generateBaseline 共用的 own-insert 單一入口, 放在最前一行即可
    //同時覆蓋兩條路徑 (per-test hermetic setup).
    await resetToBaseSeed()

    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 870 + k,
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
}


//w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id (傳 {userId} 是 silent no-op)
async function _delTokensByUserId(userId) {
    let tks = await woItems.tokens.select({ userId }).catch(() => [])
    for (let tk of tks) await woItems.tokens.del({ id: tk.id }).catch(() => {})
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含動態建立的使用者), 保留 base seed.
    await deleteNonBaseSeed()
}


// ===================================================================
// MDI icon paths + UI helpers
// ===================================================================

let mdiPlus = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z'
let mdiTrashCanOutline = 'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z'
let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'


async function locateMdiButton(page, dPath) {
    return await page.evaluate((d) => {
        let p = Array.from(document.querySelectorAll('svg path')).find(x => x.getAttribute('d') === d)
        if (!p) return null
        let btn = p.closest('div[tabindex]')
        if (!btn) return null
        let r = btn.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, dPath)
}


//typeIntoInput 改用 e2e-setup.mjs 之 shared Pattern D 實作 (insertText + retry × 3, 防 Vue v-model 漏字 race)


//API 拒絕情境用 — 經由 SPA $fapi 直接打後端 API, 不需 UI 互動.
//(對齊 e2e-adduser.test.mjs:127 callFapi 模式)
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


//框某列之 selector (pinned-left + center 兩容器聯集): checkbox 勾選狀態 (pinned-left) + 列內容 (center) 都框進.
//對齊 e2e-tokens / e2e-ips E2E-003 canonical 截圖.
function rowBoxSel(rowIdx) {
    return [
        `.ag-pinned-left-cols-container .ag-row[row-index="${rowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`,
    ]
}


async function checkRowSelectionByRowIdx(page, rowIdx) {
    let sel = `.ag-row[row-index="${rowIdx}"] input[type="checkbox"]`
    let cb = page.locator(sel).first()
    await cb.waitFor({ state: 'visible', timeout: 5000 })
    await cb.check()
    await page.waitForTimeout(400)
}


async function loginAsAdminAndOpenUsersList(page, lang) {
    let t = kpLangText[lang]

    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${baseUrl}/?lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)

    let inputs = page.locator('input')
    await typeIntoInput(page, inputs.nth(0), testUsers.admin.account)
    await typeIntoInput(page, inputs.nth(1), testUsers.admin.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${t.login}"`).first().click()
    //login → backstage 跨頁 redirect, 固定 buffer + 偵測 Users list 文字
    await page.waitForTimeout(10000)
    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(2500)

    //確認 Edit mode 開
    let plusVisible = await locateMdiButton(page, mdiPlus)
    if (!plusVisible) {
        await page.locator(`text="${t.editMode}"`).first().click()
        await page.waitForTimeout(800)
    }

    //等 ag-grid 載入穩定
    await page.waitForFunction(async () => {
        let cells = document.querySelectorAll('.ag-cell')
        if (cells.length < 5) return false
        let s1 = cells.length
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        let s2 = document.querySelectorAll('.ag-cell').length
        return s1 === s2
    }, null, { timeout: 15000 })
    await page.waitForTimeout(800)
}


// ===================================================================
// State-producing functions (for baseline 產製)
// 每個函式建構出對應 baseline 的 stable visual state, return 截圖 buffer.
// ===================================================================

async function captureInitialState(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    return await captureStableWithBox(page, SEL_GRID)
}


async function captureAfterTrashPending(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await checkRowSelectionByRowIdx(page, tgtRowIdx)

    //[多階段 stage1] 勾選後、trash 前截「target 列已被勾選」觸發態 — 框該列 (pinned-left checkbox + center 內容聯集)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufSelected = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //[多階段 stage2] trash 後該列自表移除 (pending, DB 未刪)
    let bufGrid = await captureStableWithBox(page, SEL_GRID)
    return {
        'E2E-002-1-target-selected': bufSelected,
        'E2E-002-after-trash-pending-save': bufGrid,
    }
}


async function captureDeleteSuccessModal(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await checkRowSelectionByRowIdx(page, tgtRowIdx)
    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)
    let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
    await page.locator(saveBtnSel).first().click()
    let successText = expectedSpecText['E2E-003-modal-delete-success'][lang].value
    await page.waitForFunction(
        (txt) => (document.body.innerText || '').includes(txt),
        successText,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)
    return await captureStableWithBox(page, SEL_MODAL)
}


async function captureAfterRefetchTargetDeleted(page, lang) {
    let t = kpLangText[lang]
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await checkRowSelectionByRowIdx(page, tgtRowIdx)
    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)
    let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
    await page.locator(saveBtnSel).first().click()
    let successText = expectedSpecText['E2E-003-modal-delete-success'][lang].value
    await page.waitForFunction(
        (txt) => (document.body.innerText || '').includes(txt),
        successText,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)
    await page.locator(`text="${t.ok}"`).first().click()
    await page.waitForTimeout(3000)
    return await captureStableWithBox(page, SEL_GRID)
}


async function captureUserAddEmptyModal(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let allRowIdxs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ag-row[row-index]'))
            .map(r => r.getAttribute('row-index')))
    for (let idx of allRowIdxs) {
        await checkRowSelectionByRowIdx(page, idx)
    }

    //[多階段 stage1] 全選後、trash 前截「全部列已被勾選」觸發態 — 框整個 ag-grid (所有 checkbox 勾選 + header 全選勾選)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufSelected = await captureStableWithBox(page, SEL_GRID)

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(1000)

    //[多階段 stage2] trash 後 save 前的空 grid —— 全選刪除後表格已空, 框整個 ag-grid 呈現空表狀態
    let bufGrid = await captureStableWithBox(page, SEL_GRID)

    let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
    await page.locator(saveBtnSel).first().click()
    let txt = expectedSpecText['E2E-005-3-modal-userAddEmpty'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 15000 }
    )
    await page.waitForTimeout(500)

    //[多階段 stage3] userAddEmpty modal
    let bufModal = await captureStableWithBox(page, SEL_MODAL)
    return {
        'E2E-005-1-all-rows-selected': bufSelected,
        'E2E-005-2-empty-grid': bufGrid,
        'E2E-005-3-modal-userAddEmpty': bufModal,
    }
}


async function captureCannotDeleteSelfModal(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let selfRowIdx = await findRowIndexByAccount(page, testUsers.admin.account)
    await checkRowSelectionByRowIdx(page, selfRowIdx)

    //[多階段 stage1] 勾選後、trash 前截「admin 自己列已被勾選」觸發態 — 框該列 (pinned-left checkbox + center 內容聯集)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufSelected = await captureStableWithBox(page, rowBoxSel(selfRowIdx))

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //[多階段 stage2] trash 後 save 前的 grid —— admin 自己列已從表移除 (pending, DB 未刪)
    let bufGrid = await captureStableWithBox(page, SEL_GRID)

    let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
    await page.locator(saveBtnSel).first().click()
    let txt = expectedSpecText['E2E-006-3-modal-cannot-delete-self'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    //[多階段 stage3] cannotDeleteSelf modal
    let bufModal = await captureStableWithBox(page, SEL_MODAL)
    return {
        'E2E-006-1-self-row-selected': bufSelected,
        'E2E-006-2-grid-after-self-trash': bufGrid,
        'E2E-006-3-modal-cannot-delete-self': bufModal,
    }
}


async function captureSaveFailModal(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await checkRowSelectionByRowIdx(page, tgtRowIdx)

    //[多階段 stage1] 勾選後、trash 前截「target 列已被勾選」觸發態 — 框該列 (pinned-left checkbox + center 內容聯集; token 此時仍有效)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufSelected = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //[多階段 stage2] trash 後 save 前的 grid —— target 列已從表移除 (pending, DB 未刪; token 尚有效)
    let bufGrid = await captureStableWithBox(page, SEL_GRID)

    //中途刪 admin token (模擬 token 被刪, 不影響已截 stage1/stage2)
    await _delTokensByUserId(testUsers.admin.id)

    let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
    await page.locator(saveBtnSel).first().click()
    let txt = expectedSpecText['E2E-007-3-modal-save-fail-token-deleted'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    //[多階段 stage3] save fail modal (token 被刪後端 reject)
    let bufModal = await captureStableWithBox(page, SEL_MODAL)
    return {
        'E2E-007-1-target-row-selected': bufSelected,
        'E2E-007-2-grid-after-target-trash': bufGrid,
        'E2E-007-3-modal-save-fail-token-deleted': bufModal,
    }
}


// ===================================================================
// Baseline 產製模式
// ===================================================================

async function generateBaselineForLang(lang) {
    //cases 陣列 key = 代表名稱(供 shouldGen 過濾用); fn 可回 Buffer(單張) 或 dict { baselineName→buf }
    let cases = [
        { name: 'E2E-001-initial-users-list', fn: captureInitialState },
        //E2E-002 含「勾選」+「trash 後」兩 stage, fn 回 dict; case name 設為第一 stage key 供 shouldGen 判斷
        { name: 'E2E-002-1-target-selected', fn: captureAfterTrashPending },
        { name: 'E2E-003-modal-delete-success', fn: captureDeleteSuccessModal },
        { name: 'E2E-004-after-refetch-target-deleted', fn: captureAfterRefetchTargetDeleted },
        //E2E-005/006/007 各有三個 stage (勾選 → trash 後 grid → modal), fn 回 dict; case name 設為第一 stage key 供 shouldGen 判斷
        //shouldGen 以 cases 的 name 判斷; --names 個別控制 stage 請直接指定該 bname, 或不加 --names 全跑.
        { name: 'E2E-005-1-all-rows-selected', fn: captureUserAddEmptyModal },
        { name: 'E2E-006-1-self-row-selected', fn: captureCannotDeleteSelfModal },
        { name: 'E2E-007-1-target-row-selected', fn: captureSaveFailModal },
    ]

    for (let { name, fn } of cases) {
        if (!shouldGen(lang, name)) continue
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()

        //per-case fresh browser — 與 mocha beforeEach 一致, 避免 cold/warm GPU/glyph atlas 差異
        //導致跨模式 pixel drift (§6.3 截圖穩定性「已知限制: baseline 順序與 mocha 跑模式必須同序」)
        let browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
        let context = await browser.newContext()
        let page = await context.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer(單張) 或 dict { baselineName→buf }; 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            writeBaseline(lang, bname, b)
            console.log(`  ✔ ${lang}/${bname} (${b.length} bytes)`)
        }

        await browser.close()
    }
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of langs) {
        console.log(`=== generating baseline for ${lang} ===`)
        await generateBaselineForLang(lang)
    }

    await deleteTestUsersAndTokens()
    console.log('=== 標準圖產生完成 ===')

    //顯式 cleanup — 殺 e2e-setup spawned 的 backend/frontend, event loop 自然清空後 exit.
    //(mocha 模式經 root after() hook 觸發 cleanup, --baseline 不經 mocha 故須手動呼叫)
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

    for (let lang of langs) {

        let browser
        let page

        describe(`DeleteUser E2E [${lang}] — 後台刪除使用者`, function() {
            this.timeout(180000)

            //per-case 獨立: 每個 it 都 fresh browser + DB setup (與 baseline 產製順序一致)
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()

                browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
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


            //工具: 比對 buf 與 baseline + 文件存在性
            function assertBaseline(buf, name) {
                let baselinePath = bp(lang, name)
                //fail 時自動保留 capture + baseline 到 ./testPending (不覆蓋, 帶 timestamp) 供 diff
                assertBaselineMatch(buf, baselinePath, `deleteuser-${lang}-${name}`)
            }


            //刪除 journey (承接式, 一個 case 多階段截圖): trash-pending(E2E-002) → save→success modal(E2E-003) → OK→refetch 永刪(E2E-004)
            it('delete-success: trash(E2E-002) → save → success modal(E2E-003) → 表格刷新 target 永刪(E2E-004)', async function() {
                await loginAsAdminAndOpenUsersList(page, lang)
                let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
                assert.strict.notEqual(tgtRowIdx, null, 'target row 應存在於 ag-grid')
                await checkRowSelectionByRowIdx(page, tgtRowIdx)

                //baseline 002-1 — 勾選後、trash 前截「target 列已被勾選」觸發態 (框該列, 顯示 checkbox 勾選)
                await page.mouse.move(0, 0)
                await page.waitForTimeout(500)
                let buf002Sel = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))
                await assertSpecForCase(page, lang, 'E2E-002-1-target-selected')
                assertBaseline(buf002Sel, 'E2E-002-1-target-selected')

                let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
                assert.strict.notEqual(trashBtn, null, '勾選後 trash 按鈕應出現')
                await page.mouse.click(trashBtn.x, trashBtn.y)
                await page.waitForTimeout(800)

                //baseline 002 — trash 後該列自表中移除 (pending, save 前, DB 未刪) 之中間截圖點
                let buf002 = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-002-after-trash-pending-save')
                assertBaseline(buf002, 'E2E-002-after-trash-pending-save')

                let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
                await page.locator(saveBtnSel).first().click()

                //等 success modal
                let successText = expectedSpecText['E2E-003-modal-delete-success'][lang].value
                await page.waitForFunction(
                    (txt) => (document.body.innerText || '').includes(txt),
                    successText,
                    { timeout: 30000 }
                )
                await page.waitForTimeout(500)

                //baseline 003 — success modal
                let buf003 = await captureStableWithBox(page, SEL_MODAL)
                await assertSpecForCase(page, lang, 'E2E-003-modal-delete-success')
                assertBaseline(buf003, 'E2E-003-modal-delete-success')

                //點 OK 等表格刷新 (對應 bullet 8)
                await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
                await page.waitForTimeout(3000)

                //baseline 004 — 重拉後 target 永刪
                let buf004 = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-004-after-refetch-target-deleted')
                assertBaseline(buf004, 'E2E-004-after-refetch-target-deleted')

                //DB 驗證 (補強)
                let stillInDb = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(stillInDb.length, 0,
                    `target user 應已自 DB 移除, 實際 ${stillInDb.length} 筆`)
            })


            it('trash-button-hidden-when-no-selection: 進 Users list 不勾選 → 初始狀態, trash 不可見', async function() {
                await loginAsAdminAndOpenUsersList(page, lang)

                //baseline 001 — 初始 Users list
                let buf = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-001-initial-users-list')
                assertBaseline(buf, 'E2E-001-initial-users-list')

                //加碼: trash 按鈕應不存在 (對應 spec hasItemsCheck=false 條件)
                let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
                assert.strict.equal(trashBtn, null,
                    `無勾選時 trash 按鈕不應顯示, 實際找到於 (${trashBtn?.x}, ${trashBtn?.y})`)
            })


            it('delete-all-rows-shows-userAddEmpty: 勾全選 → trash → save → modal (DB 不變)', async function() {
                await loginAsAdminAndOpenUsersList(page, lang)

                let dbBefore = await woItems.users.select()
                let countBefore = dbBefore.length

                let allRowIdxs = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('.ag-row[row-index]'))
                        .map(r => r.getAttribute('row-index')))
                assert.strict.equal(allRowIdxs.length > 0, true, '表中應至少有一列可勾選')
                for (let idx of allRowIdxs) {
                    await checkRowSelectionByRowIdx(page, idx)
                }

                //[E2E-005 stage1] 全選後、trash 前截「全部列已被勾選」觸發態 (框整表, 所有 checkbox + header 全選勾選)
                await page.mouse.move(0, 0)
                await page.waitForTimeout(500)
                let buf005Sel = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-005-1-all-rows-selected')
                assertBaseline(buf005Sel, 'E2E-005-1-all-rows-selected')

                let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
                await page.mouse.click(trashBtn.x, trashBtn.y)
                await page.waitForTimeout(1000)

                //[E2E-005 stage2] trash 後 save 前的空 grid — 全選刪除後所有列已從前端移除
                let buf005Grid = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-005-2-empty-grid')
                assertBaseline(buf005Grid, 'E2E-005-2-empty-grid')

                let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
                await page.locator(saveBtnSel).first().click()

                let txt = expectedSpecText['E2E-005-3-modal-userAddEmpty'][lang].value
                await page.waitForFunction(
                    (t) => (document.body.innerText || '').includes(t),
                    txt,
                    { timeout: 15000 }
                )
                await page.waitForTimeout(500)

                //[E2E-005 stage3] userAddEmpty modal
                let buf005Modal = await captureStableWithBox(page, SEL_MODAL)
                await assertSpecForCase(page, lang, 'E2E-005-3-modal-userAddEmpty')
                assertBaseline(buf005Modal, 'E2E-005-3-modal-userAddEmpty')

                //確認順序對 (rows.length===0 在 cannotDeleteSelf 之前)
                let modalText = await page.evaluate(() => document.body.innerText || '')
                assert.strict.equal(modalText.includes(expectedSpecText['E2E-006-3-modal-cannot-delete-self'][lang].value), false,
                    `應為 userAddEmpty 而非 cannotDeleteSelf (rows.length===0 檢查在自我保護之前)`)

                await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
                await page.waitForTimeout(1000)

                //DB 不變
                let dbAfter = await woItems.users.select()
                assert.strict.equal(dbAfter.length, countBefore,
                    `DB users 數量應不變, before=${countBefore} after=${dbAfter.length}`)
            })


            //
            // rows-restore-by-refetch case 已刪除 (spec/流程_後台刪除使用者.md 對應 bullet 已移除).
            //

            it('cannot-delete-self: 勾自己 → trash → save → cannotDeleteSelf modal (admin 不變)', async function() {
                await loginAsAdminAndOpenUsersList(page, lang)

                let selfRowIdx = await findRowIndexByAccount(page, testUsers.admin.account)
                assert.strict.notEqual(selfRowIdx, null, 'admin 自己列應存在')

                await checkRowSelectionByRowIdx(page, selfRowIdx)

                //[E2E-006 stage1] 勾選後、trash 前截「admin 自己列已被勾選」觸發態 (框該列, 顯示 checkbox 勾選)
                await page.mouse.move(0, 0)
                await page.waitForTimeout(500)
                let buf006Sel = await captureStableWithBox(page, rowBoxSel(selfRowIdx))
                await assertSpecForCase(page, lang, 'E2E-006-1-self-row-selected')
                assertBaseline(buf006Sel, 'E2E-006-1-self-row-selected')

                let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
                await page.mouse.click(trashBtn.x, trashBtn.y)
                await page.waitForTimeout(800)

                //[E2E-006 stage2] trash 後 save 前的 grid — admin 自己列已從前端移除 (DB 未刪)
                let buf006Grid = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-006-2-grid-after-self-trash')
                assertBaseline(buf006Grid, 'E2E-006-2-grid-after-self-trash')

                let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
                await page.locator(saveBtnSel).first().click()

                let txt = expectedSpecText['E2E-006-3-modal-cannot-delete-self'][lang].value
                await page.waitForFunction(
                    (t) => (document.body.innerText || '').includes(t),
                    txt,
                    { timeout: 30000 }
                )
                await page.waitForTimeout(500)

                //[E2E-006 stage3] cannotDeleteSelf modal
                let buf006Modal = await captureStableWithBox(page, SEL_MODAL)
                await assertSpecForCase(page, lang, 'E2E-006-3-modal-cannot-delete-self')
                assertBaseline(buf006Modal, 'E2E-006-3-modal-cannot-delete-self')

                await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
                await page.waitForTimeout(1000)

                //DB admin 仍在
                let adminStillInDb = await woItems.users.select({ id: testUsers.admin.id })
                assert.strict.equal(adminStillInDb.length, 1, 'admin 應仍在 DB')
            })


            it('token-deleted-reject: 登入後 admin token 中途被刪 → save → userSaveUsersFail modal (target 不變)', async function() {
                await loginAsAdminAndOpenUsersList(page, lang)

                let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
                await checkRowSelectionByRowIdx(page, tgtRowIdx)

                //[E2E-007 stage1] 勾選後、trash 前截「target 列已被勾選」觸發態 (框該列, 顯示 checkbox 勾選; token 此時仍有效)
                await page.mouse.move(0, 0)
                await page.waitForTimeout(500)
                let buf007Sel = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))
                await assertSpecForCase(page, lang, 'E2E-007-1-target-row-selected')
                assertBaseline(buf007Sel, 'E2E-007-1-target-row-selected')

                let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
                await page.mouse.click(trashBtn.x, trashBtn.y)
                await page.waitForTimeout(800)

                //[E2E-007 stage2] trash 後 save 前的 grid — target 列已從前端移除 (DB 未刪; token 此時仍有效)
                let buf007Grid = await captureStableWithBox(page, SEL_GRID)
                await assertSpecForCase(page, lang, 'E2E-007-2-grid-after-target-trash')
                assertBaseline(buf007Grid, 'E2E-007-2-grid-after-target-trash')

                //中途刪 admin token (對應 spec bullet 4, stage1/stage2 截圖後才刪)
                await _delTokensByUserId(testUsers.admin.id)
                let leftover = await woItems.tokens.select({ userId: testUsers.admin.id })
                assert.strict.equal(leftover.length, 0, `admin tokens 應全清空, 實際剩 ${leftover.length} 筆`)

                let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`
                await page.locator(saveBtnSel).first().click()

                let txt = expectedSpecText['E2E-007-3-modal-save-fail-token-deleted'][lang].value
                await page.waitForFunction(
                    (t) => (document.body.innerText || '').includes(t),
                    txt,
                    { timeout: 30000 }
                )
                await page.waitForTimeout(500)

                //[E2E-007 stage3] save fail modal (token 被刪後端 reject)
                let buf007Modal = await captureStableWithBox(page, SEL_MODAL)
                await assertSpecForCase(page, lang, 'E2E-007-3-modal-save-fail-token-deleted')
                assertBaseline(buf007Modal, 'E2E-007-3-modal-save-fail-token-deleted')

                await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
                await page.waitForTimeout(1000)

                //DB target 仍在 (reject, 未刪)
                let stillInDb = await woItems.users.select({ id: testUsers.target.id })
                assert.strict.equal(stillInDb.length, 1, 'target 應仍在 DB (token 失效未刪)')
            })


            //
            // non-admin-token-reject API 契約 case 已遷至 test/api-deleteuser.test.mjs
            // (Node + 無 browser).
            //

        })

    }

}
