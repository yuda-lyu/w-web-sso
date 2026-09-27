import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import procLang from '../server/procLang.mjs'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch, launchBrowser, waitUntilExist } from './tools/e2e-setup.mjs'
import { callFapi } from './tools/api-setup.mjs' //僅 mocha 端之端到端不變式(app token 實際可否呼叫)使用; regen 端不呼叫, 不建立連線


//
// E2E tokens test — 後台金鑰清單流程
//
// 對應流程文件：spec/流程_後台金鑰清單.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-tokens.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-tokens.test.mjs --timeout 240000
//   --names <eng-E2E-001-list-loaded,...> 進行手術式 baseline 重產: 給 case 名 (如 eng-E2E-005-grant-perms-save-success)
//   產該 case 全部階段, 給階段圖鍵 (如 eng-E2E-005-3-check-read-tokens) 只寫該張
//
// 標準圖存放：test/pics/tokens/tokens-{lang}-{number}-{name}.png
//
// 涵蓋 7 個案例 (× 2 lang = 50 baselines; E2E-002 多階段 3 張、E2E-003 2 張、E2E-005 / E2E-006 各 7 張、E2E-007 4 張):
//   E2E-001-list-loaded:                        進 Tokens list 顯示初始檢視態 (seed 6 列, 含應用系統權限欄)
//   E2E-002-1-isapp-toggled-before-save:        toggle isApp 後、Save 前的 isApp cell 觸發態 (stage1)
//   E2E-002-2-save-success-modal:               toggle isApp → Save → 成功 modal (stage2)
//   E2E-002-3-toggle-isapp-result-row:          modal 關閉後 isApp 已切換的結果列 (stage3)
//   E2E-003-1-row-selected-before-save:         勾選目標列後、刪除/Save 前之已選取列觸發態 (stage1)
//   E2E-003-2-delete-row-save-success:          勾選某列刪除 → Save → 成功 modal (stage2)
//   E2E-004-token-expired-save-fail:            Save 前 admin token 過期 → 後端 reject → fail modal
//   E2E-005-1..7:                               應用系統金鑰授予「讀金鑰」權限 → 儲存 (ADR-069)
//   E2E-006-1..7:                               應用系統金鑰撤銷「讀統計」權限 → 儲存 (ADR-069)
//   E2E-007-1..4:                               非編輯模式檢視應用系統權限清單 (唯讀) (ADR-069)
//
// 所有 capture 透過真實 UI 互動推進: 鍵盤滑鼠輸入 / ag-grid cell checkbox 點擊 /
// row selection checkbox 點擊 / 按鈕 SVG path 點擊。不使用 vm.method() / page.evaluate state mutation 抄捷徑.
//

let salt = '{salt}'
let baselineDir = './test/pics/tokens'
let langs = ['eng', 'cht']

// captureStableWithBox target selectors
let SEL_GRID = '.ag-root-wrapper'                                    // ag-grid 主體（金鑰清單表格區）
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'  // WDialog 內層 panel（modal 框體, 非全螢幕 shield）


let baselineNamesFilter = null
{
    let i = process.argv.indexOf('--names')
    if (i >= 0 && process.argv[i + 1]) {
        baselineNamesFilter = new Set(process.argv[i + 1].split(','))
    }
}
//--names 指定時: filter 含階段圖鍵 (${lang}-${name}) 只寫該張; 含 case 名 (${lang}-${caseName}) 則寫該 case 全部階段
function writeBaseline(lang, caseName, name, buf) {
    if (baselineNamesFilter && !baselineNamesFilter.has(`${lang}-${name}`) && !baselineNamesFilter.has(`${lang}-${caseName}`)) {
        console.log(`  [skip] ${lang}-${name}`)
        return
    }
    fs.writeFileSync(bp(lang, name), buf)
}


//是否需要產生此 case 的標準圖. --names 指定時只有指定 case 回 true → 連「截圖」都跳過 (非僅跳寫檔).
//多階段 dict case (E2E-002/003/005/006/007) 之階段圖鍵為 E2E-NNN-<序>-<名>, 不含 case 名 (如 case E2E-005-grant-perms-save-success
//之階段 eng-E2E-005-3-check-read-tokens), 故以 case 編號前綴 ${lang}-E2E-NNN- 比對: filter 內有該前綴之鍵 (case 名或任一階段圖鍵)
//即執行此 case, 再由 writeBaseline 只寫指定者. (2026-09-27 前以 ${lang}-${name}- 比對, 階段圖鍵永不命中而整案靜默略過)
function shouldGen(lang, name) {
    if (!baselineNamesFilter) return true
    let prefix = `${lang}-${name.slice(0, 7)}-` //'eng-E2E-005-'
    for (let k of baselineNamesFilter) {
        if (k.startsWith(prefix)) return true
    }
    return false
}


function bp(lang, name) {
    return path.join(baselineDir, `tokens-${lang}-${name}.png`)
}


// ===================================================================
// 預期語意斷言 (從 spec/流程_後台金鑰清單.md + procLang.mjs 衍生, 非現狀指紋)
// 每個 case 對應的可觀察文字; 不含 → 修系統或修 spec, 不改 baseline.
// ===================================================================

let expectedSpecText = {
    //E2E-001: 表格載入後應見 seed 的某 token 字串
    'E2E-001-list-loaded': {
        eng: { mode: 'text', value: 'test-token-1' },
        cht: { mode: 'text', value: 'test-token-1' },
    },
    //E2E-002: 儲存成功 modal 文字 tokenSaveTokensSuccess
    'E2E-002-toggle-isapp-save-success': {
        eng: { mode: 'text', value: 'Save tokens successfully' },
        cht: { mode: 'text', value: '儲存金鑰數據成功' },
    },
    //E2E-003: 同 002, 共用 tokenSaveTokensSuccess
    'E2E-003-delete-row-save-success': {
        eng: { mode: 'text', value: 'Save tokens successfully' },
        cht: { mode: 'text', value: '儲存金鑰數據成功' },
    },
    //E2E-004: 後端 reject → tokenSaveTokensFail 前綴 (i18n) + 後端錯誤字串
    'E2E-004-token-expired-save-fail': {
        eng: { mode: 'text', value: 'Failed to save tokens' },
        cht: { mode: 'text', value: '儲存金鑰數據失敗' },
    },
    //E2E-005 / E2E-006: 權限變更後儲存成功 modal 文字 tokenSaveTokensSuccess (於 capture 內 modal 仍顯示時斷言, 同 E2E-002)
    'E2E-005-grant-perms-save-success': {
        eng: { mode: 'text', value: 'Save tokens successfully' },
        cht: { mode: 'text', value: '儲存金鑰數據成功' },
    },
    'E2E-006-revoke-perms-save-success': {
        eng: { mode: 'text', value: 'Save tokens successfully' },
        cht: { mode: 'text', value: '儲存金鑰數據成功' },
    },
    //E2E-007: 唯讀清單之標頭 tokenPerms 與基本權限說明 tokenPermsBase 皆可見
    'E2E-007-view-perms-readonly': {
        eng: { mode: 'text', value: 'Basic permission, always granted' },
        cht: { mode: 'text', value: '基本權限，恆具備' },
    },
}


// ===================================================================
// 測試使用者 / Token / Tokens seed
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-tokens-admin',
        account: 'tokens-admin',
        rawPassword: 'Pw@tokensadm1',
        name: 'Tokens Admin',
        email: 'tokens-admin@test.com',
        isAdmin: 'y',
        redir: `${baseUrl}/?view=backstage&token={token}`,
    },
}

let userTokens = {}

//6 個 seed tokens 列 — 固定 id 與 token 字串 (便於 UI 抓 row + 斷言), 不同 userId / isApp 以區分視覺.
//timeEnd 用未來日期, 不同小時數讓 WTimeminute 顯示各異, 更利於視覺辨識
//perms (ADR-069, 僅 isApp='y' 生效): 4 僅基本權限(E2E-005 授予讀金鑰) / 5 讀金鑰+讀統計(E2E-006 撤銷讀統計) / 6 全部權限(E2E-001 顯示「+N」收合、E2E-007 唯讀清單全勾選)
let permsAll = ['writeUsers', 'readTokens', 'writeTokens', 'readIps', 'writeIps', 'readStats']
let testTokens = [
    { id: 'id-test-token-1', token: 'test-token-1', userId: 'id-user-a', isApp: 'n', perms: [], timeEnd: '2030-01-01T00:00:00.000+08:00' },
    { id: 'id-test-token-2', token: 'test-token-2', userId: 'id-user-b', isApp: 'n', perms: [], timeEnd: '2030-06-15T12:00:00.000+08:00' },
    { id: 'id-test-token-3', token: 'test-token-3', userId: 'id-user-c', isApp: 'n', perms: [], timeEnd: '2030-09-20T08:30:00.000+08:00' },
    { id: 'id-test-token-4', token: 'test-token-4', userId: 'id-user-d', isApp: 'y', perms: [], timeEnd: '2030-11-05T15:45:00.000+08:00' },
    { id: 'id-test-token-5', token: 'test-token-5', userId: 'id-user-e', isApp: 'y', perms: ['readTokens', 'readStats'], timeEnd: '2030-12-31T23:00:00.000+08:00' },
    { id: 'id-test-token-6', token: 'test-token-6', userId: 'id-user-f', isApp: 'y', perms: permsAll, timeEnd: '2030-08-08T09:15:00.000+08:00' },
]


async function insertTestUsersAndTokensAndTestTokens() {
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

    //admin token (此 token 由 admin 登入後台用, 與 testTokens seed 不同, id 用 id-tokens-admin-token 區隔)
    //token 值固定為決定性字串 (本檔 Tokens list 會顯示 token 值, funNew 自動產 UUID 每跑都變 → pixel mismatch; 此處鎖定使 pixel 穩定)
    //timeEnd 用未來固定字串 (與 testTokens 同, 凍結 baseline; 原 ot().add(60, 'minute') 為動態 wall-clock,
    //跑測試時與 baseline 凍結時間不同 → 第 1 列 timeEnd 字串浮動 → pixel mismatch — Round-3 audit pre-existing fix)
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.id = 'id-tokens-admin-token'
    t.token = 'fixed-tokens-admin-session-token'
    t.timeEnd = '2030-01-01T00:00:00.000+08:00'
    t.timeCreate = FIX_TIME
    t.timeUpdate = FIX_TIME
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    //testTokens seed — 固定 token 字串方便 UI row 定位
    let tokenRows = testTokens.map((r) => {
        let o = ds.tokens.funNew({ userId: r.userId, isApp: r.isApp })
        o.id = r.id
        o.token = r.token
        o.isApp = r.isApp
        o.perms = [...r.perms]
        o.timeEnd = r.timeEnd
        o.timeCreate = FIX_TIME
        o.timeUpdate = FIX_TIME
        return o
    })
    await woItems.tokens.insert(tokenRows)

    //統一所有 tokens (含 base seed) 之 timeCreate / timeUpdate 為固定值, 避免「Created time」/「Last update time」
    //欄位顯示插入瞬間之 wall-clock → 每跑都變 → pixel mismatch. (base seed tokens 由 resetToBaseSeed 插入,
    //其 timeCreate 為彼時 now; admin token 與 test tokens 也是. 一次性 normalize 所有可見時間.)
    await normalizeTokenTimes()

    console.log(`inserted 1 admin user + 1 admin token + ${tokenRows.length} test tokens`)
}


//tokens 的 timeCreate / timeUpdate 固定字串, 確保 Tokens list 之「Created time」/「Last update time」欄顯示穩定 (pixel 穩定)
let FIX_TIME = '2025-01-01T00:00:00.000+08:00'

//base seed tokens (token-for-*) 由 resetToBaseSeed 插入, 其 timeCreate 為彼時 now, 須 post-insert normalize.
//admin token + test tokens 改在 insert 時直接設 timeCreate / timeUpdate (此函式對它們等同 noop, 但保留以兼顧 base seed).
async function normalizeTokenTimes() {
    let all = await woItems.tokens.select().catch(() => [])
    for (let tk of all) {
        if (tk.timeCreate !== FIX_TIME || tk.timeUpdate !== FIX_TIME) {
            await woItems.tokens.save({ id: tk.id, timeCreate: FIX_TIME, timeUpdate: FIX_TIME }).catch(() => {})
        }
    }
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含 admin user / admin token / testTokens).
    await deleteNonBaseSeed()
    console.log('deleted tokens test users + admin token + test tokens')
}


//每個 it 之間 admin token 都要復原 (token 過期 case 會把它弄壞)
async function resetAdminToken() {
    //w-orm-lmdb 的 del 嚴格認 .id, 須先 select 再逐筆 del by id
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.id = 'id-tokens-admin-token'
    t.token = 'fixed-tokens-admin-session-token'
    //timeEnd 對齊 insertTestUsersAndTokensAndTestTokens 用固定未來時間 (Round-3 audit pre-existing fix, 詳該處註解)
    t.timeEnd = '2030-01-01T00:00:00.000+08:00'
    t.timeCreate = FIX_TIME
    t.timeUpdate = FIX_TIME
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
    //base seed tokens 仍透過 normalize 處理 (resetToBaseSeed 不會被 caller 重跑)
    await normalizeTokenTimes()
}


//強制將 admin token 設為過期 (case E2E-004 用): 模擬「填完編輯後 token 才過期」場景,
//下次點儲存時後端 checkToken (funCheckAdmin) reject → CheckYes modal 含 tokenSaveTokensFail 前綴.
async function forceExpireAdminToken() {
    let _tks = await woItems.tokens.select({ userId: testUsers.admin.id }).catch(() => [])
    for (let _tk of _tks) {
        _tk.timeEnd = ot().subtract(1, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.save(_tk).catch(() => {})
    }
}


//重設 testTokens seed (case E2E-002/003/004 在 it 內可能變動 tokens, 須回到 seed 狀態).
//只刪 id-test-token-* 前綴 (避免動到 admin token / base seed tokens), 然後重新插入 testTokens.
async function resetTestTokensSeed() {
    let all = await woItems.tokens.select().catch(() => [])
    for (let _tk of all) {
        if ((_tk.id || '').startsWith('id-test-token-')) {
            await woItems.tokens.del({ id: _tk.id }).catch(() => {})
        }
    }
    let tokenRows = testTokens.map((r) => {
        let o = ds.tokens.funNew({ userId: r.userId, isApp: r.isApp })
        o.id = r.id
        o.token = r.token
        o.isApp = r.isApp
        o.perms = [...r.perms]
        o.timeEnd = r.timeEnd
        o.timeCreate = FIX_TIME
        o.timeUpdate = FIX_TIME
        return o
    })
    await woItems.tokens.insert(tokenRows)
}


// ===================================================================
// UI helpers — 全部走真實鍵盤滑鼠互動 (透過 Playwright)
// (參考 e2e-adduser 共用 pattern)
// ===================================================================

let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'
let mdiTrashCanOutline = 'M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z'

let kpUiText = {
    eng: { login: 'Log in', tokensList: 'Tokens list', editMode: 'Edit mode', ok: 'OK', statistics: 'Statistics' },
    cht: { login: '登入', tokensList: '金鑰清單', editMode: '編輯模式', ok: '確認', statistics: '統計' },
}
//應用系統權限 (ADR-069) 之畫面文字直接取自 server/procLang.mjs (清單標頭 / 權限名稱), 不另抄寫
{
    let kpLang = procLang()
    for (let lang of ['eng', 'cht']) {
        kpUiText[lang].permsHead = kpLang[lang].tokenPerms
        kpUiText[lang].permReadTokens = kpLang[lang].appPerm_readTokens
        kpUiText[lang].permReadStats = kpLang[lang].appPerm_readStats
    }
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


//Toggle 指定 row 的 isApp checkbox (透過 cell-render template 內 input[type=checkbox]
//的 click handler 觸發 toggleItemIsAppById → isModified=true).
//note: 該 checkbox 不是 selection checkbox; 是 isApp 欄位內的 cell-render checkbox.
async function clickIsAppCheckboxByRowIdx(page, rowIdx) {
    await ensureColumnVisible(page, 'isApp')
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="isApp"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    let cbSel = `${cellSel} input[type="checkbox"]`
    let cb = page.locator(cbSel).first()
    await cb.waitFor({ state: 'visible', timeout: 5000 })
    //click (不是 check/uncheck — toggle 由 @click handler 主導, 不靠 checked attribute)
    await cb.click()
    await page.waitForTimeout(500)
}


//LS 預填 admin token + autoLogin → 進 Tokens list → 確認 Edit mode 開
//用 LS 預填取代 UI 登入: UI 登入會 createToken 建一個 session UUID token (每跑都變), 而 Tokens list
//會顯示此 token → 必然 pixel mismatch. 改用 LS 預填讓 autoLogin 直接用 seed 內固定值的 admin token,
//不會在 DB 多建 token → Tokens list 顯示穩定 (pixel 穩定). (Ips canonical 也走 UI 登入但 ips 表不顯
//示 token 所以無感)
async function loginAsAdminAndOpenTokensList(page, lang) {
    let t = kpUiText[lang]
    let adminToken = userTokens[testUsers.admin.id]

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    //預填 admin token 至 LS, 再以 ?view=backstage 開啟 → mUI.autoLogin 走 seed 內固定 token 完成登入
    await page.evaluate((o) => localStorage.setItem(o.k, o.v), { k: 'ksso:userToken', v: adminToken })

    if (lang === 'cht') {
        //以 ?lang= 設語系 (autoLogin 載入時即生效, 不需點切換 UI)
        await page.goto(`${baseUrl}/?view=backstage&lang=cht`, { waitUntil: 'networkidle', timeout: 15000 })
    }
    else {
        await page.goto(`${baseUrl}/?view=backstage&lang=eng`, { waitUntil: 'networkidle', timeout: 15000 })
    }
    await page.waitForTimeout(3000)

    //偵測: 等 backstage Statistics 文字 (autoLogin 成功 + render 完成)
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics })

    //點 Tokens list
    await page.locator(`text="${t.tokensList}"`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text="${t.tokensList}"`).first().click()
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
        //token header 必須出現
        if (!document.querySelector('.ag-header-cell[col-id="token"]')) return false
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


//點 OK 關閉 System message modal → 等 modal 消失 → 捲軸歸位 → 等 ag-grid idle
//(連續三 raf 之間 cell 數量與首列 cell 內容全等, 與 waitCheckYes 內部同款偵測; E2E-002 / E2E-005 / E2E-006 共用)
async function closeCheckYesAndWaitGridIdle(page, lang) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().click()

    //等 modal 消失 (OK button 不再可見)
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})

    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.waitForFunction(async () => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return true
        if (body.scrollLeft !== 0) return false
        if (!document.querySelector('.ag-header-cell[col-id="token"]')) return false
        let snap = () => {
            let cells = document.querySelectorAll('.ag-cell')
            let row0Cells = Array.from(document.querySelectorAll('.ag-row[row-index="0"] .ag-cell'))
            return JSON.stringify({
                count: cells.length,
                row0: row0Cells.map(c => (c.getAttribute('col-id') || '') + ':' + (c.innerText || '').slice(0, 30)),
            })
        }
        let s1 = snap()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        let s2 = snap()
        if (s1 !== s2) return false
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        let s3 = snap()
        return s2 === s3
    }, null, { timeout: 15000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)
}


// ===================================================================
// 應用系統權限 (ADR-069) 之定位 helpers — 觸發框 / 清單浮層 / 清單中某權限之列 / 儲存鈕 / 編輯模式開關
// ===================================================================

//某列之應用系統權限觸發框 (僅 isApp='y' 之列渲染)
function permsTriggerSel(rowIdx) {
    return `.ag-center-cols-container .ag-row[row-index="${rowIdx}"] .ag-cell[col-id="perms"] .perms-trigger`
}

//展開之權限清單浮層 (teleport 至 body 之 WPopperFix 內層面板, 以清單標頭文字識別)
function permsPopupLoc(page, lang) {
    return page.locator('.WPopperFix').filter({ hasText: kpUiText[lang].permsHead }).locator(':scope > div').first()
}

//清單中某權限之文字 (點選處) 與其整列 (勾選框 + 名稱 + 提示; WInputCheckbox 每項之可點層為 inline-block 容器)
function permsItemLoc(page, lang, text) {
    return permsPopupLoc(page, lang).locator(`text="${text}"`).first()
}
function permsItemRowLoc(page, lang, text) {
    return permsItemLoc(page, lang, text).locator('xpath=ancestor::div[contains(@style,"inline-block")][1]')
}

//儲存鈕 (雲端上傳圖示之最近 tabindex 容器, 同 locateMdiButton 之可點層)
function saveBtnLoc(page) {
    return page.locator(`svg path[d="${mdiCloudUploadOutline}"]`).locator('xpath=ancestor::div[@tabindex][1]')
}

//編輯模式開關整顆 (開關 + 文字; WSwitch 之可點層為 cursor:pointer 之 inline-block 容器)
function editSwitchLoc(page, lang) {
    return page.locator(`text="${kpUiText[lang].editMode}"`).first().locator('xpath=ancestor::div[contains(@style,"cursor: pointer")][1]')
}

//目標須已在視窗內 (1280 寬時應用系統權限欄於捲軸歸位即完整可見, 不以程式捲動帶入)
async function assertInViewport(page, sel) {
    let r = await page.evaluate((s) => {
        let e = document.querySelector(s)
        if (!e) return null
        let b = e.getBoundingClientRect()
        return { left: b.left, right: b.right, vw: window.innerWidth }
    }, sel)
    if (!r) throw new Error(`target not found: ${sel}`)
    if (r.left < 0 || r.right > r.vw) throw new Error(`target not fully in viewport: ${sel} ${JSON.stringify(r)}`)
}

//儲存鈕出現 (勾選權限即標記已修改, 清單未關閉即出現)
async function waitSaveButton(page) {
    await saveBtnLoc(page).first().waitFor({ state: 'visible', timeout: 5000 })
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

//輔助: 找 token='test-token-N' 的列 row-index
async function findRowIdxByTokenValue(page, tokenStr) {
    let rowIdx = await page.evaluate((s) => {
        let cells = Array.from(document.querySelectorAll('.ag-row .ag-cell[col-id="token"]'))
        for (let c of cells) {
            if ((c.innerText || '').trim() === s) {
                let row = c.closest('.ag-row')
                return row.getAttribute('row-index')
            }
        }
        return null
    }, tokenStr)
    return rowIdx
}


//E2E-001 初始檢視態: 進 Tokens list, 表格顯示 seed 列, 截圖
async function captureListLoaded(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)
    //等 seed token (test-token-1) 在 table 內可見
    await waitUntilExist(page, 'first seed token test-token-1', () => document.body.innerText.includes('test-token-1'))
    //框 ag-grid 表格區標注金鑰清單初始檢視態
    return await captureStableWithBox(page, SEL_GRID)
}


//E2E-002 toggle isApp checkbox 後 Save 成功 → 多階段截圖（3 張）:
//  stage1 (E2E-002-1-isapp-toggled-before-save): toggle 後、Save 前截「isApp cell 已切換」觸發態 (框 isApp cell)
//  stage2 (E2E-002-2-save-success-modal): waitCheckYes 後、點 OK 前截成功 modal (框 WDialog 內層 panel)
//  stage3 (E2E-002-3-toggle-isapp-result-row): 點 OK 關閉 modal → 等 grid idle → 框被切換 isApp 的那一列
//note: 流程文件描述為「修改任一欄位」, 此 case 用 isApp checkbox toggle 作為「修改」代表
//(同 ips 改用 ip 文字欄修改的工程取捨). 走的是同一個 saveTokens + updateTokensList 路徑
//(toggleItemIsAppById → isModified=true → Save 按鈕顯示).
//note: saveTokens 成功後前端直接以 vo.tokens=cloneDeep(rows) 更新, 不 refetch getTokensList,
//      故 modal 關閉後 grid 即已呈現 toggle 後狀態, 無需等 newValue 出現.
async function captureToggleIsappSaveSuccess(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)

    //找 test-token-1 的列 row-index (seed 為 isApp='n', toggle 後變 'y')
    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-1')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-1`)

    await clickIsAppCheckboxByRowIdx(page, parseInt(rowIdx, 10))

    //[多階段 stage1] toggle 後、Save 前截「isApp cell 已切換」觸發態 — 框 isApp cell
    //ensureColumnVisible 已在 clickIsAppCheckboxByRowIdx 內呼叫, 此處 isApp 欄必在視口
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufToggled = await captureStableWithBox(page, `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="isApp"]`)

    await clickSave(page)
    await waitCheckYes(page, lang) //success modal 出現

    //[多階段 stage2 語意斷言] modal 仍顯示時 (點 OK 之前) 斷言成功 modal 文字出現 —
    //此為成功 modal 文字的正確時機 (post-capture 時 modal 已 dismiss, 文字不在頁面).
    {
        let exp = expectedSpecText['E2E-002-toggle-isapp-save-success'][lang].value
        let found = await pageHasText(page, exp)
        if (!found) {
            let dump = await collectVisibleText(page)
            assert.fail(`預期成功 modal 含 "${exp}" (E2E-002-2-save-success-modal), 實際: ${dump}`)
        }
    }

    //[多階段 stage2] waitCheckYes 後、點 OK 前截「儲存成功 modal」— 框 WDialog 內層 panel
    let bufModal = await captureStableWithBox(page, SEL_MODAL)

    //關閉 modal (點 OK) → 等 modal 消失與 ag-grid idle
    await closeCheckYesAndWaitGridIdle(page, lang)

    //重新找 test-token-1 的 row-index (儲存後排序可能變動)
    let finalRowIdx = await findRowIdxByTokenValue(page, 'test-token-1')
    if (finalRowIdx === null) throw new Error(`test-token-1 not found in grid after save`)

    //[多階段 stage3] 框被切換 isApp 的那一列 (pinned-left + center 兩容器聯集, 同 adduser canonical 截圖)
    //聚焦驗證標的: test-token-1 的 isApp 欄已切換並顯示於清單
    let bufRow = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${finalRowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${finalRowIdx}"]`,
    ])

    //多階段回傳 dict (baselineName → buf); 數字前綴使檔名排序 ≡ 流程階段順序:
    //  1 toggle 後 save 前之 isApp cell 觸發態 → 2 儲存成功 modal (綠勾) → 3 grid 中被切換 isApp 的 test-token-1 列
    return {
        'E2E-002-1-isapp-toggled-before-save': bufToggled,
        'E2E-002-2-save-success-modal': bufModal,
        'E2E-002-3-toggle-isapp-result-row': bufRow,
    }
}


//E2E-003 勾選某列刪除後 Save 成功 → 多階段截圖（2 張）:
//  stage1 (E2E-003-1-row-selected-before-save): 勾選後、clickTrash/clickSave 前截「該列已被勾選」觸發態
//                                               (框 pinned-left + center 兩容器聯集的該列)
//  stage2 (E2E-003-2-delete-row-save-success): 勾選 → 刪 → Save → waitCheckYes 後截成功 modal (框 WDialog)
async function captureDeleteRowSaveSuccess(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)

    //找 test-token-2 的列 row-index → 勾選
    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-2')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-2`)

    await checkRowSelectionByRowIdx(page, parseInt(rowIdx, 10))

    //[多階段 stage1] 勾選後、clickTrash 前截「該列已被勾選」觸發態 — 框 pinned-left + center 聯集
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let bufSelected = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${rowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`,
    ])

    await clickTrash(page)
    await clickSave(page)
    await waitCheckYes(page, lang)

    //[多階段 stage2] 框成功 modal（WDialog 內層 panel）標注刪除後儲存成功訊息
    let bufModal = await captureStableWithBox(page, SEL_MODAL)

    //多階段回傳 dict (baselineName → buf); 數字前綴使檔名排序 ≡ 流程階段順序:
    //  1 勾選後 save 前之已選取列觸發態 → 2 刪除後儲存成功 modal
    return {
        'E2E-003-1-row-selected-before-save': bufSelected,
        'E2E-003-2-delete-row-save-success': bufModal,
    }
}


//E2E-004 Save 前 admin token 過期 → 後端 reject → 失敗 modal (tokenSaveTokensFail 前綴)
async function captureTokenExpiredSaveFail(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)

    //先 toggle isApp 讓 isModified=true (否則 Save 按鈕不顯示)
    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-3')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-3`)
    await clickIsAppCheckboxByRowIdx(page, parseInt(rowIdx, 10))

    //儲存前讓 admin token 過期 (模擬「修改完之後 token 才過期」場景)
    await forceExpireAdminToken()

    await clickSave(page)
    await waitCheckYes(page, lang)
    //框失敗 modal（WDialog fixed shield）標注 token 過期 → 後端 reject 失敗訊息
    return await captureStableWithBox(page, SEL_MODAL)
}


//成功 modal 仍顯示時 (點 OK 之前) 斷言其文字 (同 E2E-002 stage2 之時機)
async function assertSuccessModalText(page, lang, name) {
    let exp = expectedSpecText[name][lang].value
    let found = await pageHasText(page, exp)
    if (!found) {
        let dump = await collectVisibleText(page)
        assert.fail(`預期成功 modal 含 "${exp}" (${name}), 實際: ${dump}`)
    }
}


//E2E-005 / E2E-006 共用序列 (ADR-069): 開權限清單 → 勾選或取消某權限 → 儲存 → 成功 modal → 結果列之權限標籤, 共 7 張
//  1 click-perms       點擊前: 框該列應用系統權限觸發框整顆
//  2 perms-list        點擊後: 框展開之權限清單浮層整個 (含標頭)
//  3 check/uncheck-xxx 點擊前: 框清單中該權限之整列 (勾選框 + 名稱 + 提示)
//  4 xxx-checked/unchecked 點擊後: 框權限清單浮層整個 (該權限勾選狀態已改變; 此時儲存鈕已出現)
//  5 click-save        點擊前: 框儲存鈕整顆 (權限清單仍開啟)
//  6 save-success-modal 點擊後: 框成功 modal 面板
//  7 perms-result      點 OK 關閉後: 框該列應用系統權限觸發框 (標籤已反映新權限)
async function capturePermsChangeSave(page, lang, o) {
    let { tokenStr, permText, keyCase, keyStep3, keyStep4 } = o
    await loginAsAdminAndOpenTokensList(page, lang)

    let rowIdx = await findRowIdxByTokenValue(page, tokenStr)
    if (rowIdx === null) throw new Error(`seed token row not found: ${tokenStr}`)
    let trig = permsTriggerSel(rowIdx)
    await assertInViewport(page, trig)

    //1 點擊前: 框觸發框
    let buf1 = await captureStableWithBox(page, trig)
    await page.locator(trig).click()
    await permsPopupLoc(page, lang).waitFor({ state: 'visible', timeout: 5000 })

    //2 點擊後: 框清單浮層
    let buf2 = await captureStableWithBox(page, permsPopupLoc(page, lang))

    //3 點擊前: 框該權限整列
    let buf3 = await captureStableWithBox(page, permsItemRowLoc(page, lang, permText))
    await permsItemLoc(page, lang, permText).click()

    //勾選即標記已修改: 清單未關閉即出現儲存鈕
    await waitSaveButton(page)

    //4 點擊後: 框清單浮層
    let buf4 = await captureStableWithBox(page, permsPopupLoc(page, lang))

    //5 點擊前: 框儲存鈕 (清單仍開啟; 點儲存時清單關閉並寫回勾選)
    let buf5 = await captureStableWithBox(page, saveBtnLoc(page))
    await clickSave(page)
    await waitCheckYes(page, lang)
    await assertSuccessModalText(page, lang, keyCase)

    //6 點擊後: 框成功 modal
    let buf6 = await captureStableWithBox(page, SEL_MODAL)

    //點 OK 關閉 → 等 grid idle
    await closeCheckYesAndWaitGridIdle(page, lang)
    let finalRowIdx = await findRowIdxByTokenValue(page, tokenStr)
    if (finalRowIdx === null) throw new Error(`${tokenStr} not found in grid after save`)
    let trigFinal = permsTriggerSel(finalRowIdx)
    await assertInViewport(page, trigFinal)

    //7 框結果列之觸發框
    let buf7 = await captureStableWithBox(page, trigFinal)

    let n = keyCase.slice(0, 7) //'E2E-00N'
    return {
        [`${n}-1-click-perms`]: buf1,
        [`${n}-2-perms-list`]: buf2,
        [`${n}-3-${keyStep3}`]: buf3,
        [`${n}-4-${keyStep4}`]: buf4,
        [`${n}-5-click-save`]: buf5,
        [`${n}-6-save-success-modal`]: buf6,
        [`${n}-7-perms-result`]: buf7,
    }
}


//E2E-005 授予: test-token-4 (僅基本權限) 勾選「讀金鑰」→ 儲存
async function captureGrantPermsSaveSuccess(page, lang) {
    return await capturePermsChangeSave(page, lang, {
        tokenStr: 'test-token-4',
        permText: kpUiText[lang].permReadTokens,
        keyCase: 'E2E-005-grant-perms-save-success',
        keyStep3: 'check-read-tokens',
        keyStep4: 'read-tokens-checked',
    })
}


//E2E-006 撤銷: test-token-5 (讀金鑰 + 讀統計) 取消「讀統計」→ 儲存
async function captureRevokePermsSaveSuccess(page, lang) {
    return await capturePermsChangeSave(page, lang, {
        tokenStr: 'test-token-5',
        permText: kpUiText[lang].permReadStats,
        keyCase: 'E2E-006-revoke-perms-save-success',
        keyStep3: 'uncheck-read-stats',
        keyStep4: 'read-stats-unchecked',
    })
}


//E2E-007 唯讀檢視 (ADR-069): 關閉編輯模式 → 開 test-token-6 (全部權限) 之權限清單, 各項不可勾選, 共 4 張
//  1 click-edit-mode      點擊前: 框編輯模式開關整顆
//  2 view-mode            點擊後: 框表格整個 (列選取框與拖曳把手消失)
//  3 click-perms          點擊前: 框 test-token-6 之應用系統權限觸發框整顆
//  4 perms-list-readonly  點擊後: 框展開之權限清單浮層整個 (7 項皆勾選且不可勾選)
async function captureViewPermsReadonly(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)

    //1 點擊前: 框編輯模式開關 (loginAsAdminAndOpenTokensList 已確保編輯模式為開)
    let buf1 = await captureStableWithBox(page, editSwitchLoc(page, lang))
    await editSwitchLoc(page, lang).click()
    //偵測: 表格重建為非編輯模式 (列選取框消失)
    await waitUntilExist(page, 'grid rebuilt without selection checkbox', () => {
        return !!document.querySelector('.ag-header-cell[col-id="token"]') && document.querySelectorAll('.ag-selection-checkbox').length === 0
    })

    //2 點擊後: 框表格整個
    let buf2 = await captureStableWithBox(page, SEL_GRID)

    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-6')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-6`)
    let trig = permsTriggerSel(rowIdx)
    await assertInViewport(page, trig)

    //3 點擊前: 框觸發框
    let buf3 = await captureStableWithBox(page, trig)
    await page.locator(trig).click()
    await permsPopupLoc(page, lang).waitFor({ state: 'visible', timeout: 5000 })

    //語意: 清單 7 項皆勾選且不可勾選
    let st = await permsPopupLoc(page, lang).evaluate((el) => {
        let ins = Array.from(el.querySelectorAll('input[type="checkbox"]'))
        return { n: ins.length, checked: ins.filter((x) => x.checked).length, disabled: ins.filter((x) => x.disabled).length }
    })
    assert.deepStrictEqual(st, { n: 7, checked: 7, disabled: 7 }, `非編輯模式之權限清單應 7 項皆勾選且不可勾選, 實際: ${JSON.stringify(st)}`)

    //4 點擊後: 框清單浮層
    let buf4 = await captureStableWithBox(page, permsPopupLoc(page, lang))

    //點選「讀統計」不改變勾選, 亦不出現儲存鈕
    await permsItemLoc(page, lang, kpUiText[lang].permReadStats).click()
    await page.waitForTimeout(500)
    let st2 = await permsPopupLoc(page, lang).evaluate((el) => Array.from(el.querySelectorAll('input[type="checkbox"]')).filter((x) => x.checked).length)
    assert.strict.equal(st2, 7, `非編輯模式點選權限不應改變勾選, 實際勾選數: ${st2}`)
    assert.strict.equal(await saveBtnLoc(page).count(), 0, '非編輯模式不應出現儲存鈕')

    return {
        'E2E-007-1-click-edit-mode': buf1,
        'E2E-007-2-view-mode': buf2,
        'E2E-007-3-click-perms': buf3,
        'E2E-007-4-perms-list-readonly': buf4,
    }
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['E2E-001-list-loaded', captureListLoaded],
        ['E2E-002-toggle-isapp-save-success', captureToggleIsappSaveSuccess],
        ['E2E-003-delete-row-save-success', captureDeleteRowSaveSuccess],
        ['E2E-004-token-expired-save-fail', captureTokenExpiredSaveFail],
        ['E2E-005-grant-perms-save-success', captureGrantPermsSaveSuccess],
        ['E2E-006-revoke-perms-save-success', captureRevokePermsSaveSuccess],
        ['E2E-007-view-perms-readonly', captureViewPermsReadonly],
    ]

    //per-case fresh browser + DB setup, 與 mocha test 端 beforeEach/afterEach 對稱.
    //保證 marathon mode 與 single-case run 收斂到同一 stable state.
    for (let [name, fn] of cases) {
        if (!shouldGen(lang, name)) continue
        console.log(`  ${name}`)

        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokensAndTestTokens()

        let browser = await launchBrowser()
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => { await dialog.accept() })

        let result = await fn(page, lang)
        //多階段: fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 寫檔
        let stages = Buffer.isBuffer(result) ? { [name]: result } : result
        for (let [bname, b] of Object.entries(stages)) {
            writeBaseline(lang, name, bname, b)
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
        assertBaselineMatch(buf, baselinePath, `tokens-${lang}-${name}`)
    }


    for (let lang of langs) {

        describe(`Tokens E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            let browser
            let page

            //per-case 獨立: 每個 it 都 fresh browser + DB setup, 確保單 case --grep 也能跑.
            beforeEach(async function() {
                this.timeout(240000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokensAndTestTokens()

                browser = await launchBrowser()
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
                ['E2E-001-list-loaded', captureListLoaded],
                ['E2E-002-toggle-isapp-save-success', captureToggleIsappSaveSuccess],
                ['E2E-003-delete-row-save-success', captureDeleteRowSaveSuccess],
                ['E2E-004-token-expired-save-fail', captureTokenExpiredSaveFail],
                ['E2E-005-grant-perms-save-success', captureGrantPermsSaveSuccess],
                ['E2E-006-revoke-perms-save-success', captureRevokePermsSaveSuccess],
                ['E2E-007-view-perms-readonly', captureViewPermsReadonly],
            ]

            //應用系統權限案例 (ADR-069) 之前後斷言: pre 於操作前確認 app token 之起始能力, post 於比對標準圖之前驗 DB 與端到端不變式
            //(app token 實際呼叫後台功能之成敗), 使標準圖缺漏或不符時仍先驗得流程本身
            let permsChecks = {
                'E2E-005-grant-perms-save-success': {
                    pre: async () => {
                        let r = await callFapi('getTokensList', ['test-token-4'])
                        assert.strict.equal(r.ok, false, `授予前 test-token-4 (僅基本權限) 不應可讀金鑰清單, 實際: ${JSON.stringify(r).slice(0, 200)}`)
                    },
                    post: async () => {
                        let rs = await woItems.tokens.select({ id: 'id-test-token-4' })
                        assert.deepStrictEqual(rs[0].perms, ['readTokens'], `id-test-token-4 之 perms 應為 ['readTokens'], 實際: ${JSON.stringify(rs[0].perms)}`)
                        let r = await callFapi('getTokensList', ['test-token-4'])
                        assert.strict.equal(r.ok, true, `授予後 test-token-4 應立即可讀金鑰清單, 實際: ${JSON.stringify(r).slice(0, 200)}`)
                    },
                },
                'E2E-006-revoke-perms-save-success': {
                    pre: async () => {
                        let r = await callFapi('getStaIp', ['test-token-5'])
                        assert.strict.equal(r.ok, true, `撤銷前 test-token-5 應可讀統計, 實際: ${JSON.stringify(r).slice(0, 200)}`)
                    },
                    post: async () => {
                        let rs = await woItems.tokens.select({ id: 'id-test-token-5' })
                        assert.deepStrictEqual(rs[0].perms, ['readTokens'], `id-test-token-5 之 perms 應為 ['readTokens'], 實際: ${JSON.stringify(rs[0].perms)}`)
                        let r1 = await callFapi('getStaIp', ['test-token-5'])
                        assert.strict.equal(r1.ok, false, '撤銷後 test-token-5 應立即不可讀統計')
                        assert.strict.equal(r1.err, 'tokenExpired', `撤銷後讀統計之對外 key 應為 tokenExpired, 實際: ${r1.err}`)
                        let r2 = await callFapi('getTokensList', ['test-token-5'])
                        assert.strict.equal(r2.ok, true, '未撤銷之讀金鑰應仍可用')
                    },
                },
                'E2E-007-view-perms-readonly': {
                    pre: async () => {},
                    post: async () => {
                        let rs = await woItems.tokens.select({ id: 'id-test-token-6' })
                        assert.deepStrictEqual(rs[0].perms, permsAll, `非編輯模式之操作不得改變 id-test-token-6 之 perms, 實際: ${JSON.stringify(rs[0].perms)}`)
                    },
                },
            }

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    await resetAdminToken()
                    await resetTestTokensSeed()
                    if (permsChecks[name]) {
                        await permsChecks[name].pre()
                    }
                    let result = await fn(page, lang)

                    //語意斷言 (主): 以 case name 查 expectedSpecText, 每個 case 執行一次.
                    //E2E-002 (toggle isApp) 例外: 其成功 modal 文字已在 capture 函式內 (modal 仍顯示時) 斷言,
                    //post-capture 時 modal 已 dismiss + toggle 結果無唯一可觀察文字 → 改以下方 DB 狀態斷言驗最終態,
                    //不在此處對已消失的 modal 文字做 pageHasText. E2E-005 / E2E-006 同理 (capture 內斷言成功 modal 文字).
                    if (!['E2E-002-toggle-isapp-save-success', 'E2E-005-grant-perms-save-success', 'E2E-006-revoke-perms-save-success'].includes(name)) {
                        await assertSpecForCase(page, lang, name)
                    }

                    //應用系統權限案例: 先驗 DB 與端到端不變式, 再比對標準圖
                    if (permsChecks[name]) {
                        await permsChecks[name].post()
                    }

                    //pixel baseline (補強): 多階段 fn 可回 Buffer (單張) 或 dict { baselineName: buf } (多張); 統一成 dict 逐張比對
                    let stages = Buffer.isBuffer(result) ? { [name]: result } : result
                    for (let [bname, b] of Object.entries(stages)) {
                        assertBaselineMatch(b, bp(lang, bname), `tokens-${lang}-${bname}`)
                    }

                    //DB 副作用斷言
                    if (name === 'E2E-002-toggle-isapp-save-success') {
                        //toggle 後 DB 該列 isApp 應從 'n' 變 'y'
                        let rs = await woItems.tokens.select({ id: 'id-test-token-1' }).catch(() => [])
                        assert.strict.equal(rs.length, 1, `id-test-token-1 應存在`)
                        assert.strict.equal(rs[0].isApp, 'y', `id-test-token-1 之 isApp 應已 toggle 為 'y', 實際: ${rs[0].isApp}`)
                    }
                    else if (name === 'E2E-003-delete-row-save-success') {
                        //刪除後 DB 該列應不存在
                        let rs = await woItems.tokens.select({ id: 'id-test-token-2' }).catch(() => [])
                        assert.strict.equal(rs.length, 0, `id-test-token-2 應已被刪除, 實際: ${rs.length} 筆`)
                        //其他 seed 列應仍在 (只篩 id-test-token-* 前綴, 避開 base seed tokens / admin token)
                        let all = await woItems.tokens.select().catch(() => [])
                        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-token-'))
                        assert.strict.equal(seedRows.length, testTokens.length - 1, `其他 seed tokens 列應仍在, 實際: ${seedRows.length} 筆 (預期 ${testTokens.length - 1})`)
                    }
                    else if (name === 'E2E-004-token-expired-save-fail') {
                        //token 過期 reject → DB 不應變動 (id-test-token-3 之 isApp 仍為原值 'n')
                        let rs = await woItems.tokens.select({ id: 'id-test-token-3' }).catch(() => [])
                        assert.strict.equal(rs.length, 1, `id-test-token-3 應仍存在`)
                        assert.strict.equal(rs[0].isApp, 'n', `token 過期 reject 後 id-test-token-3 之 isApp 不應變動 (預期 'n', 實際: ${rs[0].isApp})`)
                        //seed tokens 數量不變 (同上, 只篩 id-test-token-* 前綴)
                        let all = await woItems.tokens.select().catch(() => [])
                        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-token-'))
                        assert.strict.equal(seedRows.length, testTokens.length, `token 過期 reject 後 seed tokens 總數不應變動 (預期 ${testTokens.length}, 實際: ${seedRows.length})`)
                    }
                })
            }

        })

    }

}
