import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, typeIntoInput, assertBaselineMatch, launchBrowser } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, waitGridIdle, gridContentBox } from './tools/e2eLib.mjs'


//
// E2E delete user test — 後台刪除使用者流程
//
// 對應流程文件: spec/流程_後台刪除使用者.md
// 對應產品碼: LayoutContentUsers.vue (deleteItemsCheck @1340 + saveUsers self-protection @1395)
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-deleteuser.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-deleteuser.test.mjs --timeout 600000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2): --names <項,...> 每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產;
//     階段圖鍵只寫該張, 案例鍵或編號前綴 (如 E2E-005) 寫該案全部階段, 不符任何鍵即報錯; --langs; --write-mode missing|changed;
//     env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄 (等價驗證用)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 每案 fresh browser + DB 重置 → 流程中每階段截圖後當場語意斷言 → DB / DOM 不變式 → 寫檔 / 比對
//
// 標準圖存放：test/pics/deleteuser/deleteuser-{lang}-{NNN-name}.png
// 雙語覆蓋：eng + cht
//

let salt = '{salt}'
let baselineDir = './test/pics/deleteuser'
let langs = ['eng', 'cht']

// captureStableWithBox target selectors
//表格一律經 gridContentBox 框標頭＋可見資料列（空表為標頭＋「無資料」訊息）：技能 §7.2 表格列、§7.3-2；
//2026-09-28 改：原直接框表格外框，列少時框進大片空白
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
    await page.locator(`text="${t.usersList}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    await page.locator(`text="${t.usersList}"`).first().click()
    //等清單頁之「編輯模式」勾選列渲染後再判斷(取代固定 2.5 秒: 未渲染時新增鈕必不可見而誤判, 2026-09-28; 以下偵測上限同日放寬至 60 秒)
    await page.locator(`text="${t.editMode}"`).first().waitFor({ state: 'visible', timeout: 60000 })

    //確認 Edit mode 開
    let plusVisible = await locateMdiButton(page, mdiPlus)
    if (!plusVisible) {
        await page.locator(`text="${t.editMode}"`).first().click()
        await page.waitForTimeout(800)
    }

    //等 ag-grid 載入穩定 (waitGridIdle: 至少 5 格, 且內容＋幾何簽章連續 1s 不變)
    await waitGridIdle(page, { minCells: 5, timeout: 60000 })
    await page.waitForTimeout(800)
}


// ===================================================================
// 案例流程 (產製端與比對端共用; 每階段截圖後當場對 spec 做語意斷言, 狀態仍在畫面上)
// 回傳 dict { 圖鍵 → buf }; DB / DOM 不變式於 verify (寫檔 / 比對之前)
// ===================================================================

let saveBtnSel = `div[tabindex]:has(svg path[d="${mdiCloudUploadOutline}"])`

//E2E-001 進 Users list 不勾選 → 初始狀態
async function runInitialList(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    //baseline 001 — 初始 Users list (框 ag-grid)
    let buf = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-001-initial-users-list')
    return { 'E2E-001-initial-users-list': buf }
}


//刪除 journey (承接式, 一個 case 多階段截圖): trash-pending(E2E-002) → save→success modal(E2E-003) → OK→refetch 永刪(E2E-004)
async function runDeleteSuccess(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)
    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    assert.strict.notEqual(tgtRowIdx, null, 'target row 應存在於 ag-grid')
    await checkRowSelectionByRowIdx(page, tgtRowIdx)

    //baseline 002-1 — 勾選後、trash 前截「target 列已被勾選」觸發態 (框該列, pinned-left checkbox + center 內容聯集)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf002Sel = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))
    await assertSpecForCase(page, lang, 'E2E-002-1-target-selected')

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    assert.strict.notEqual(trashBtn, null, '勾選後 trash 按鈕應出現')
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //baseline 002 — trash 後該列自表中移除 (pending, save 前, DB 未刪) 之中間截圖點 (框 ag-grid)
    let buf002 = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-002-after-trash-pending-save')

    await page.locator(saveBtnSel).first().click()

    //等 success modal
    let successText = expectedSpecText['E2E-003-modal-delete-success'][lang].value
    await page.waitForFunction(
        (txt) => (document.body.innerText || '').includes(txt),
        successText,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    //baseline 003 — success modal (框 WDialog 內層 panel)
    let buf003 = await captureStableWithBox(page, SEL_MODAL)
    await assertSpecForCase(page, lang, 'E2E-003-modal-delete-success')

    //點 OK 等表格刷新 (對應 bullet 8)
    await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
    await page.waitForTimeout(3000)

    //baseline 004 — 重拉後 target 永刪 (框 ag-grid)
    let buf004 = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-004-after-refetch-target-deleted')

    return {
        'E2E-002-1-target-selected': buf002Sel,
        'E2E-002-after-trash-pending-save': buf002,
        'E2E-003-modal-delete-success': buf003,
        'E2E-004-after-refetch-target-deleted': buf004,
    }
}


//E2E-005 勾全選 → trash → save → userAddEmpty modal (DB 不變)
async function runDeleteAllRows(page, lang, ctx) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let dbBefore = await woItems.users.select()
    ctx.countBefore = dbBefore.length

    let allRowIdxs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ag-row[row-index]'))
            .map(r => r.getAttribute('row-index')))
    assert.strict.equal(allRowIdxs.length > 0, true, '表中應至少有一列可勾選')
    for (let idx of allRowIdxs) {
        await checkRowSelectionByRowIdx(page, idx)
    }

    //[E2E-005 stage1] 全選後、trash 前截「全部列已被勾選」觸發態 (框整個 ag-grid, 所有 checkbox + header 全選勾選)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf005Sel = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-005-1-all-rows-selected')

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(1000)

    //[E2E-005 stage2] trash 後 save 前的空 grid — 全選刪除後所有列已從前端移除 (框整個 ag-grid 呈現空表)
    let buf005Grid = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-005-2-empty-grid')

    await page.locator(saveBtnSel).first().click()

    let txt = expectedSpecText['E2E-005-3-modal-userAddEmpty'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 15000 }
    )
    await page.waitForTimeout(500)

    //[E2E-005 stage3] userAddEmpty modal (框 WDialog 內層 panel)
    let buf005Modal = await captureStableWithBox(page, SEL_MODAL)
    await assertSpecForCase(page, lang, 'E2E-005-3-modal-userAddEmpty')

    //確認順序對 (rows.length===0 在 cannotDeleteSelf 之前); modal 仍顯示時檢查
    let modalText = await page.evaluate(() => document.body.innerText || '')
    assert.strict.equal(modalText.includes(expectedSpecText['E2E-006-3-modal-cannot-delete-self'][lang].value), false,
        `應為 userAddEmpty 而非 cannotDeleteSelf (rows.length===0 檢查在自我保護之前)`)

    await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
    await page.waitForTimeout(1000)

    return {
        'E2E-005-1-all-rows-selected': buf005Sel,
        'E2E-005-2-empty-grid': buf005Grid,
        'E2E-005-3-modal-userAddEmpty': buf005Modal,
    }
}


//E2E-006 勾自己 → trash → save → cannotDeleteSelf modal (admin 不變)
async function runCannotDeleteSelf(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let selfRowIdx = await findRowIndexByAccount(page, testUsers.admin.account)
    assert.strict.notEqual(selfRowIdx, null, 'admin 自己列應存在')

    await checkRowSelectionByRowIdx(page, selfRowIdx)

    //[E2E-006 stage1] 勾選後、trash 前截「admin 自己列已被勾選」觸發態 (框該列, pinned-left checkbox + center 內容聯集)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf006Sel = await captureStableWithBox(page, rowBoxSel(selfRowIdx))
    await assertSpecForCase(page, lang, 'E2E-006-1-self-row-selected')

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //[E2E-006 stage2] trash 後 save 前的 grid — admin 自己列已從前端移除 (DB 未刪; 框 ag-grid)
    let buf006Grid = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-006-2-grid-after-self-trash')

    await page.locator(saveBtnSel).first().click()

    let txt = expectedSpecText['E2E-006-3-modal-cannot-delete-self'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    //[E2E-006 stage3] cannotDeleteSelf modal (框 WDialog 內層 panel)
    let buf006Modal = await captureStableWithBox(page, SEL_MODAL)
    await assertSpecForCase(page, lang, 'E2E-006-3-modal-cannot-delete-self')

    await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
    await page.waitForTimeout(1000)

    return {
        'E2E-006-1-self-row-selected': buf006Sel,
        'E2E-006-2-grid-after-self-trash': buf006Grid,
        'E2E-006-3-modal-cannot-delete-self': buf006Modal,
    }
}


//E2E-007 登入後 admin token 中途被刪 → save → userSaveUsersFail modal (target 不變)
async function runTokenDeletedReject(page, lang) {
    await loginAsAdminAndOpenUsersList(page, lang)

    let tgtRowIdx = await findRowIndexByAccount(page, testUsers.target.account)
    await checkRowSelectionByRowIdx(page, tgtRowIdx)

    //[E2E-007 stage1] 勾選後、trash 前截「target 列已被勾選」觸發態 (框該列, pinned-left checkbox + center 內容聯集; token 此時仍有效)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf007Sel = await captureStableWithBox(page, rowBoxSel(tgtRowIdx))
    await assertSpecForCase(page, lang, 'E2E-007-1-target-row-selected')

    let trashBtn = await locateMdiButton(page, mdiTrashCanOutline)
    await page.mouse.click(trashBtn.x, trashBtn.y)
    await page.waitForTimeout(800)

    //[E2E-007 stage2] trash 後 save 前的 grid — target 列已從前端移除 (DB 未刪; token 此時仍有效; 框 ag-grid)
    let buf007Grid = await captureStableWithBox(page, gridContentBox(SEL_GRID))
    await assertSpecForCase(page, lang, 'E2E-007-2-grid-after-target-trash')

    //中途刪 admin token (對應 spec bullet 4, stage1/stage2 截圖後才刪)
    await _delTokensByUserId(testUsers.admin.id)
    let leftover = await woItems.tokens.select({ userId: testUsers.admin.id })
    assert.strict.equal(leftover.length, 0, `admin tokens 應全清空, 實際剩 ${leftover.length} 筆`)

    await page.locator(saveBtnSel).first().click()

    let txt = expectedSpecText['E2E-007-3-modal-save-fail-token-deleted'][lang].value
    await page.waitForFunction(
        (t) => (document.body.innerText || '').includes(t),
        txt,
        { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    //[E2E-007 stage3] save fail modal (token 被刪後端 reject; 框 WDialog 內層 panel)
    let buf007Modal = await captureStableWithBox(page, SEL_MODAL)
    await assertSpecForCase(page, lang, 'E2E-007-3-modal-save-fail-token-deleted')

    await page.locator(`text="${kpLangText[lang].ok}"`).first().click()
    await page.waitForTimeout(1000)

    return {
        'E2E-007-1-target-row-selected': buf007Sel,
        'E2E-007-2-grid-after-target-trash': buf007Grid,
        'E2E-007-3-modal-save-fail-token-deleted': buf007Modal,
    }
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//順序與 mocha it 相同 (產製順序 ≡ 比對順序); title 為 mocha it 標題 (--grep 依之); stages 為該案產出之圖鍵 (與寫檔名、比對名一致)
let cases = [
    {
        name: 'E2E-002-delete-success',
        title: 'delete-success: trash(E2E-002) → save → success modal(E2E-003) → 表格刷新 target 永刪(E2E-004)',
        run: runDeleteSuccess,
        stages: ['E2E-002-1-target-selected', 'E2E-002-after-trash-pending-save', 'E2E-003-modal-delete-success', 'E2E-004-after-refetch-target-deleted'],
        verify: async () => {
            //DB 驗證 (補強): target 已自 DB 移除
            let stillInDb = await woItems.users.select({ id: testUsers.target.id })
            assert.strict.equal(stillInDb.length, 0, `target user 應已自 DB 移除, 實際 ${stillInDb.length} 筆`)
        },
    },
    {
        name: 'E2E-001-initial-users-list',
        title: 'trash-button-hidden-when-no-selection: 進 Users list 不勾選 → 初始狀態, trash 不可見',
        run: runInitialList,
        stages: ['E2E-001-initial-users-list'],
        verify: async (ctx) => {
            //trash 按鈕應不存在 (對應 spec hasItemsCheck=false 條件)
            let trashBtn = await locateMdiButton(ctx.page, mdiTrashCanOutline)
            assert.strict.equal(trashBtn, null, `無勾選時 trash 按鈕不應顯示, 實際找到於 (${trashBtn?.x}, ${trashBtn?.y})`)
        },
    },
    {
        name: 'E2E-005-delete-all-rows',
        title: 'delete-all-rows-shows-userAddEmpty: 勾全選 → trash → save → modal (DB 不變)',
        run: runDeleteAllRows,
        stages: ['E2E-005-1-all-rows-selected', 'E2E-005-2-empty-grid', 'E2E-005-3-modal-userAddEmpty'],
        verify: async (ctx) => {
            let dbAfter = await woItems.users.select()
            assert.strict.equal(dbAfter.length, ctx.countBefore, `DB users 數量應不變, before=${ctx.countBefore} after=${dbAfter.length}`)
        },
    },
    {
        name: 'E2E-006-cannot-delete-self',
        title: 'cannot-delete-self: 勾自己 → trash → save → cannotDeleteSelf modal (admin 不變)',
        run: runCannotDeleteSelf,
        stages: ['E2E-006-1-self-row-selected', 'E2E-006-2-grid-after-self-trash', 'E2E-006-3-modal-cannot-delete-self'],
        verify: async () => {
            let adminStillInDb = await woItems.users.select({ id: testUsers.admin.id })
            assert.strict.equal(adminStillInDb.length, 1, 'admin 應仍在 DB')
        },
    },
    {
        name: 'E2E-007-token-deleted-reject',
        title: 'token-deleted-reject: 登入後 admin token 中途被刪 → save → userSaveUsersFail modal (target 不變)',
        run: runTokenDeletedReject,
        stages: ['E2E-007-1-target-row-selected', 'E2E-007-2-grid-after-target-trash', 'E2E-007-3-modal-save-fail-token-deleted'],
        verify: async () => {
            let stillInDb = await woItems.users.select({ id: testUsers.target.id })
            assert.strict.equal(stillInDb.length, 1, 'target 應仍在 DB (token 失效未刪)')
        },
    },
]

//單一案例管線: per-case DB 重置 + fresh browser (新 context, 自動接受 dialog) → 流程 (每階段截圖後語意斷言) → DB / DOM 不變式 → 寫檔 / 比對 → 關瀏覽器 → 清資料
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
        labelOf: (lg, key) => `deleteuser-${lg}-${key}`,
        match: assertBaselineMatch,
        prepare: async () => {
            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokens()
        },
        afterCase: async () => {
            await deleteTestUsersAndTokens()
        },
        ...extra,
    })
}


// ===================================================================
// Baseline 產製模式
// ===================================================================

async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    //截圖前篩選 (--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR); 不符任何鍵即於此報錯
    let gate = createBaselineGate({ langs, cases })
    console.log(gate.describe())
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    for (let lang of gate.langs) {
        console.log(`=== generating baseline for ${lang} ===`)
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }
    //--names 之任一項未產出即報錯 (不靜默略過)
    gate.finalize()

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

        describe(`DeleteUser E2E [${lang}] — 後台刪除使用者`, function() {
            this.timeout(180000)

            //per-case 獨立 (fresh browser + DB 重置) 由 runCase 負責, 確保單 case --grep 也能跑
            beforeEach(async function() {
                this.timeout(180000)
                await startServersOnce()
            })

            //每階段截圖後當場語意斷言、DB / DOM 不變式皆於比對標準圖之前 (pixel baseline 為補強層)
            for (let c of cases) {
                it(c.title, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }


            //
            // rows-restore-by-refetch case 已刪除 (spec/流程_後台刪除使用者.md 對應 bullet 已移除).
            // non-admin-token-reject API 契約 case 已遷至 test/api-deleteuser.test.mjs (Node + 無 browser).
            //

        })

    }

}
