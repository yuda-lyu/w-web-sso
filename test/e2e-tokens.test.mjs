import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import procLang from '../server/procLang.mjs'
import { mdiKeyPlus } from '@mdi/js/mdi.js'
import { startServersOnce, cleanup, captureStable, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, assertBaselineMatch, launchBrowser, waitUntilExist, typeIntoInput } from './tools/e2e-setup.mjs'
import { callFapi } from './tools/api-setup.mjs' //僅 mocha 端之端到端不變式(app token 實際可否呼叫)使用; regen 端不呼叫, 不建立連線
//產製端與比對端同一案例管線 (2026-09-27 起, 規格詳 w-package-tools-e2e 之 README.md §2.1-2.2)
import { runBaselineCase, createBaselineGate, assertTextSpec, pageHasText, collectDomText, waitGridIdle, gridContentBox, itemsUnionBox } from './tools/e2eLib.mjs'


//
// E2E tokens test — 後台金鑰清單流程
//
// 對應流程文件：spec/流程_後台金鑰清單.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-tokens.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-tokens.test.mjs --timeout 240000
//   手術式重產 (截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2):
//     --names <項,...>  每項可帶語系前綴 (eng-/cht-), 不帶則兩語系皆產. 階段圖鍵 (如 eng-E2E-005-3-check-read-tokens) 只寫該張;
//                       案例鍵或其編號前綴 (如 eng-E2E-005-grant-perms-save-success、E2E-005) 寫該案全部階段; 不符任何鍵即報錯
//     --langs <eng,cht> 限語系;  --write-mode missing|changed  只寫缺少者 / 只寫與現行標準圖差異超過容差者 (預設 all)
//     env E2E_BASELINE_OUT_DIR=<dir>  寫到暫存目錄 (等價驗證用, 不動 test/pics)
//   產製端與比對端呼叫同一案例管線 (runBaselineCase): 前置 → 截圖 → 語意斷言 → DB 不變式 → 寫檔 / 比對; 斷言不過一張都不寫.
//   例外: 應用系統權限案例之 API client 端到端檢查 (callFapi) 只在比對端執行. 原因「WServHapiClient 無法關閉, 直跑產製若建立連線將不退出」
//   自 w-serv-hapi 1.1.6 起不成立(clearBroadcast + clearSync 可停止, ADR-085); 改為兩端皆執行須另驗產製端之退出, 列 CLAUDE_rulebook.md 已知缺口.
//   產製端仍不得以 process.exit 繞過 (技能 §9.1; 強制退出之明文例外只在 api-setup 之 root after)
//
// 標準圖存放：test/pics/tokens/tokens-{lang}-{number}-{name}.png
//
// 涵蓋 9 個案例 (× 2 lang; E2E-002 已廢止〈ADR-095: 登入 token 不可升級為應用系統金鑰, 原「勾選 isApp 升級」路徑關閉, 編號保留不再使用, 其 6 張標準圖已刪〉):
//   E2E-001-list-loaded:                        進 Tokens list 顯示初始檢視態 (seed 7 列, 含用途、名稱、應用系統權限欄)
//   E2E-003-1-row-selected-before-save:         勾選目標列後、刪除/Save 前之已選取列觸發態 (stage1)
//   E2E-003-2-delete-row-save-success:          勾選某列刪除 → Save → 成功 modal (stage2)
//   E2E-004-token-expired-save-fail:            Save 前 admin token 過期 → 後端 reject → fail modal
//   E2E-005-1..7:                               應用系統金鑰授予「讀金鑰」權限 → 儲存 (ADR-069)
//   E2E-006-1..7:                               應用系統金鑰撤銷「讀統計」權限 → 儲存 (ADR-069)
//   E2E-007-1..4:                               非編輯模式檢視應用系統權限清單 (唯讀) (ADR-069)
//   E2E-008-1..10:                              新增系統服務用途之應用系統金鑰 (名稱、用途、權限) (ADR-095)
//   E2E-009-1..11:                              新增使用者用途之應用系統金鑰 (名稱、用途、綁定使用者) (ADR-095)
//   E2E-010-1..3:                               勾選使用者用途金鑰刪除並儲存, 該金鑰即失效而所綁使用者之登入不受影響 (ADR-095)
//   E2E-011-1..2:                               檢視升級前已失效之舊金鑰 (用途「已失效」、權限「不適用」、原到期時間) (ADR-095 補記, sso-run02;
//                                               標準圖待主控授權產製: 授權前比對端對缺圖之圖鍵只記 [pending-baseline], 授權後以
//                                               node test/e2e-tokens.test.mjs --baseline --names E2E-011 產製; 授權前實跑確認請務必設 E2E_BASELINE_OUT_DIR 導向 ./tmp)
//
// 所有 capture 透過真實 UI 互動推進: 鍵盤滑鼠輸入 / ag-grid cell checkbox 點擊 /
// row selection checkbox 點擊 / 按鈕 SVG path 點擊。不使用 vm.method() / page.evaluate state mutation 抄捷徑.
//

let salt = '{salt}'
let baselineDir = './test/pics/tokens'
let langs = ['eng', 'cht']

// captureStableWithBox target selectors
//表格一律經 gridContentBox 框標頭＋可見資料列：技能 §7.2 表格列、§7.3-2；2026-09-28 改：原直接框表格外框，列下方空白一併框入
let SEL_GRID = '.ag-root-wrapper'                                    // ag-grid 主體（金鑰清單表格區）
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'  // WDialog 內層 panel（modal 框體, 非全螢幕 shield）


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
    //E2E-003: 儲存成功 modal 文字 tokenSaveTokensSuccess
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
    //E2E-008 / E2E-009: 新增應用系統金鑰成功 modal 文字 tokenAppCreateSuccess (ADR-095; 於 capture 內 modal 仍顯示時斷言)
    'E2E-008-add-system-key-success': {
        eng: { mode: 'text', value: 'App token added successfully' },
        cht: { mode: 'text', value: '新增應用系統金鑰成功' },
    },
    'E2E-009-add-user-key-success': {
        eng: { mode: 'text', value: 'App token added successfully' },
        cht: { mode: 'text', value: '新增應用系統金鑰成功' },
    },
    //E2E-010: 刪除後儲存成功 modal 文字 tokenSaveTokensSuccess
    'E2E-010-delete-user-key-save-success': {
        eng: { mode: 'text', value: 'Save tokens successfully' },
        cht: { mode: 'text', value: '儲存金鑰數據成功' },
    },
    //E2E-011: 已失效之舊列之用途 / 權限 / 到期欄文字於 capture 內逐格斷言 (見 captureViewRetiredKeys), 此處僅確認清單已載入
    'E2E-011-view-retired-keys': {
        eng: { mode: 'text', value: 'test-token-8' },
        cht: { mode: 'text', value: 'test-token-8' },
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

//7 個 seed tokens 列 — 固定 id 與 token 字串 (便於 UI 抓 row + 斷言), 不同 userId / isApp 以區分視覺.
//登入 token (1~3) 之 timeEnd 用未來日期, 不同小時數讓 WTimeminute 顯示各異, 更利於視覺辨識; 應用系統金鑰 (4~7) 不給期限 (timeEnd 為空, ADR-095)
//perms (ADR-069, 僅系統服務用途生效): 4 僅基本權限(E2E-005 授予讀金鑰) / 5 讀金鑰+讀統計(E2E-006 撤銷讀統計) / 6 全部權限(E2E-001 顯示「+N」收合、E2E-007 唯讀清單全勾選)
//用途與名稱 (ADR-095): 4 為升級前之既有列(無用途欄與名稱欄; 升級前可用者, 即 timeEnd 為合法未逾期值〔固定遠期值, 顯示仍為「不設期限」, 圖不變〕,
//  視同系統服務用途, 顯示「系統服務用途」而名稱空白; sso-run02 起 timeEnd 空者依升級前判定為已失效, 不可作為可用之既有列, 見 E2E-011) / 5、6 為系統服務用途 / 7 為使用者用途(綁 base seed 之 id-for-viewer, E2E-010 刪除)
let permsAll = ['writeUsers', 'readTokens', 'writeTokens', 'readIps', 'writeIps', 'readStats']
let testTokens = [
    { id: 'id-test-token-1', token: 'test-token-1', userId: 'id-user-a', isApp: 'n', perms: [], timeEnd: '2030-01-01T00:00:00.000+08:00' },
    { id: 'id-test-token-2', token: 'test-token-2', userId: 'id-user-b', isApp: 'n', perms: [], timeEnd: '2030-06-15T12:00:00.000+08:00' },
    { id: 'id-test-token-3', token: 'test-token-3', userId: 'id-user-c', isApp: 'n', perms: [], timeEnd: '2030-09-20T08:30:00.000+08:00' },
    { id: 'id-test-token-4', token: 'test-token-4', userId: 'id-user-d', isApp: 'y', perms: [], timeEnd: '2099-01-01T00:00:00.000+08:00' },
    { id: 'id-test-token-5', token: 'test-token-5', userId: 'id-user-e', isApp: 'y', appUsage: 'system', appName: 'svc-sync', perms: ['readTokens', 'readStats'], timeEnd: '' },
    { id: 'id-test-token-6', token: 'test-token-6', userId: 'id-user-f', isApp: 'y', appUsage: 'system', appName: 'svc-admin', perms: permsAll, timeEnd: '' },
    { id: 'id-test-token-7', token: 'test-token-7', userId: 'id-for-viewer', isApp: 'y', appUsage: 'user', appName: 'viewer-key', perms: [], timeEnd: '' },
]

//mkTestTokenRows: 由 testTokens 產生 tokens 列 (固定 timeCreate / timeUpdate; 無用途欄者不寫用途與名稱, 即升級前之既有列)
function mkTestTokenRows() {
    return testTokens.map((r) => {
        let o = ds.tokens.funNew({ userId: r.userId, isApp: r.isApp })
        o.id = r.id
        o.token = r.token
        o.isApp = r.isApp
        o.perms = [...r.perms]
        o.timeEnd = r.timeEnd
        o.timeCreate = FIX_TIME
        o.timeUpdate = FIX_TIME
        if (r.appUsage === undefined) {
            delete o.appUsage
            delete o.appName
        }
        else {
            o.appUsage = r.appUsage
            o.appName = r.appName
        }
        return o
    })
}


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
    let tokenRows = mkTestTokenRows()
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


//重設 testTokens seed (case E2E-003/004/008~010 在 it 內可能變動 tokens, 須回到 seed 狀態).
//只刪 id-test-token-* 前綴與案例新鑄造之金鑰 (E2E-008 / E2E-009 之 id-new-key-*; 避免動到 admin token / base seed tokens), 然後重新插入 testTokens.
async function resetTestTokensSeed() {
    let all = await woItems.tokens.select().catch(() => [])
    for (let _tk of all) {
        if ((_tk.id || '').startsWith('id-test-token-') || (_tk.appName === NEW_KEY_NAME_SYS || _tk.appName === NEW_KEY_NAME_USR)) {
            await woItems.tokens.del({ id: _tk.id }).catch(() => {})
        }
    }
    await woItems.tokens.insert(mkTestTokenRows())
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
        //新增應用系統金鑰對話框 (ADR-095)
        kpUiText[lang].usersList = kpLang[lang].mmUsersList
        kpUiText[lang].addApp = kpLang[lang].tokenAddApp
        kpUiText[lang].appName = kpLang[lang].tokenAppName
        kpUiText[lang].usageUser = kpLang[lang].tokenAppUsageUser
        kpUiText[lang].usageSystem = kpLang[lang].tokenAppUsageSystem
        kpUiText[lang].boundUser = kpLang[lang].tokenAppBoundUser
        kpUiText[lang].create = kpLang[lang].tokenAppCreate
        //已失效之舊列 (ADR-095 補記, E2E-011)
        kpUiText[lang].usageRetired = kpLang[lang].tokenAppUsageRetired
        kpUiText[lang].permsRetired = kpLang[lang].tokenPermsRetired
        kpUiText[lang].noExpire = kpLang[lang].tokenNoExpire
    }
}

//新增金鑰案例之名稱與所綁使用者(base seed 之 id-for-viewer: 帳號 ac-viewer、名稱 viewer)
let NEW_KEY_NAME_SYS = 'svc-demo'
let NEW_KEY_NAME_USR = 'user-demo'
let NEW_KEY_BOUND_TEXT = 'ac-viewer (viewer)'
//新鑄造之金鑰其權杖字串與建立 / 更新時間為不可固定之值(伺服端產生、取當下時間): 結果列截圖前先於資料庫改為固定值並重新進入清單 (見 fixNewKeyAndReenter)
let NEW_KEY_FIXED_TOKEN = 'new-key-fixed-token'
let FIX_TIME_NEW = '2026-06-01T00:00:00.000+08:00' //固定之建立 / 更新時間, 晚於其他列之 FIX_TIME 使新列排於最上
//新鑄造後(尚未固定值前)清單最上列(新列, 依建立時間由新到舊排序)之權杖儲存格, 其字串為伺服端產生之隨機值: 供成功訊息截圖遮蔽
let SEL_NEW_ROW_TOKEN_CELL = '.ag-row[row-index="0"] .ag-cell[col-id="token"]'


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
//align: 'center'(預設)使該欄標頭置於捲動區中央; 'start' 使其左緣貼齊捲動區左緣 (其右側連續欄位須一併入鏡時用, 如權限欄與其後之建立、到期時間欄)
async function ensureColumnVisible(page, colId, align = 'center') {
    let ok = await page.evaluate(async ({ cid, align }) => {
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
                if (align === 'start') {
                    body.scrollLeft = pos + (r.x - bbox.x)
                }
                else {
                    let center = bbox.x + bbox.width / 2
                    let headerCenter = r.x + r.width / 2
                    body.scrollLeft = pos + (headerCenter - center)
                }
                await new Promise(r => setTimeout(r, 120))
                return true
            }
        }
        return false
    }, { cid: colId, align })
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
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics, timeout: 60000 })

    //點 Tokens list
    await page.locator(`text="${t.tokensList}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    await page.locator(`text="${t.tokensList}"`).first().click()
    //等清單頁之「編輯模式」勾選列渲染後再讀其狀態(取代固定 2.5 秒: 未渲染時下方讀到 null 即略過開啟, 2026-09-28; 以下偵測上限同日放寬至 60 秒)
    await page.locator(`text="${t.editMode}"`).first().waitFor({ state: 'visible', timeout: 60000 })

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

    //等 ag-grid 初始載入後 cell 完全 hydrate (waitGridIdle: 內容＋幾何簽章連續 1s 不變; 清單必有 seed 金鑰列, 故 minCells:1 不把尚未出現之表格當靜止)
    await waitGridIdle(page, { minCells: 1, timeout: 60000 })
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
    //modal 出現後穩定化: 1) 捲軸歸位 2) hover state 清除 3) 等 ag-grid idle (waitGridIdle: 內容＋幾何簽章連續 1s 不變)
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.mouse.move(0, 0)
    //token 標頭須出現、水平捲動量須為 0; 呼叫處 (E2E-002~006 儲存後 modal 顯示中) 表格必有列 (003 刪 1 列仍有他列), 故 minCells:1
    await waitGridIdle(page, { requireSelector: '.ag-header-cell[col-id="token"]', requireScrollLeftZero: true, minCells: 1, timeout: 15000 })
    await page.waitForTimeout(1500)
}


//點 OK 關閉 System message modal → 等 modal 消失 → 捲軸歸位 → 等 ag-grid idle
//(waitGridIdle: token 標頭已出現、水平捲動量 0、內容＋幾何簽章連續 1s 不變, 與 waitCheckYes 同款選項; E2E-002 / E2E-005 / E2E-006 共用)
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
    //呼叫處 (E2E-002 / 005 / 006 儲存成功點 OK 後) 表格必有列, 故 minCells:1
    await waitGridIdle(page, { requireSelector: '.ag-header-cell[col-id="token"]', requireScrollLeftZero: true, minCells: 1, timeout: 15000 })
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
//框此浮層一律經 itemsUnionBox fit: 浮層(position:fixed)框線置於浮層內容與背後內容之間隙正中(背後有表格之晶片與文字處退入浮層內距, 四周空白處照常外擴), 不蓋背後內容也不貼浮層內之字 (2026-09-28, 業主: 亂框亂壓遮蔽有效資訊即缺陷)
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

//頁面文字之走訪 (pageHasText / collectDomText) 與 text / absentText 斷言 (assertTextSpec) 取自 w-package-tools-e2e (原本檔內手寫, 內容相同)
async function assertSpecForCase(page, lang, name) {
    let expected = expectedSpecText[name]
    if (!expected || !expected[lang]) {
        throw new Error(`expectedSpecText 未為 case "${name}" / lang "${lang}" 定義`)
    }
    await assertTextSpec(page, expected[lang], { label: name })
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
    return await captureStableWithBox(page, gridContentBox(SEL_GRID))
}


//E2E-002 已廢止(編號保留不再使用): 原「勾選 isApp 把登入 token 升級為應用系統金鑰並儲存」之路徑自 ADR-095 起關閉
//(前端 isApp 欄唯讀、後端清單存檔拒收 tokenSessionUpgradeNotAllowed, 見 api-apptoken-usage LIST); 取而代之者為 E2E-008 / E2E-009 之「新增應用系統金鑰」.


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

    //先勾選 test-token-3 並刪除讓 isModified=true (否則 Save 按鈕不顯示; 原以勾選 isApp 修改, ADR-095 起 isApp 欄唯讀, 改以刪除列為「修改」代表)
    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-3')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-3`)
    await checkRowSelectionByRowIdx(page, parseInt(rowIdx, 10))
    await clickTrash(page)

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
        let dump = await collectDomText(page)
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
    //ADR-095 起表格多「用途」「名稱」兩欄, 1280 寬時應用系統權限欄於捲軸歸位時在可視範圍外: 先橫向捲動帶入(使用者亦須如此操作)
    await ensureColumnVisible(page, 'perms')
    let trig = permsTriggerSel(rowIdx)
    await assertInViewport(page, trig)

    //1 點擊前: 框觸發框
    let buf1 = await captureStableWithBox(page, trig)
    await page.locator(trig).click()
    await permsPopupLoc(page, lang).waitFor({ state: 'visible', timeout: 5000 })

    //2 點擊後: 框清單浮層
    let buf2 = await captureStableWithBox(page, itemsUnionBox(permsPopupLoc(page, lang), { fit: true }))

    //3 點擊前: 框該權限整列 (勾選框∪名稱∪說明; 該列無可見邊界且緊貼說明文字, 經 itemsUnionBox fit 外擴文字墨跡, 免紅框壓字, 2026-09-28)
    let buf3 = await captureStableWithBox(page, itemsUnionBox(permsItemRowLoc(page, lang, permText), { fit: true }))
    await permsItemLoc(page, lang, permText).click()

    //勾選即標記已修改: 清單未關閉即出現儲存鈕
    await waitSaveButton(page)

    //4 點擊後: 框清單浮層
    let buf4 = await captureStableWithBox(page, itemsUnionBox(permsPopupLoc(page, lang), { fit: true }))

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
    await ensureColumnVisible(page, 'perms') //關閉 modal 時捲軸已歸位(closeCheckYesAndWaitGridIdle), 再橫向捲動帶入
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

    //1 點擊前: 框編輯模式開關 (loginAsAdminAndOpenTokensList 已確保編輯模式為開; 開關列無可見邊界且緊貼標籤, 經 itemsUnionBox fit 外擴文字墨跡, 免紅框壓字)
    let buf1 = await captureStableWithBox(page, itemsUnionBox(editSwitchLoc(page, lang), { fit: true }))
    await editSwitchLoc(page, lang).click()
    //偵測: 表格重建為非編輯模式 (列選取框消失)
    await waitUntilExist(page, 'grid rebuilt without selection checkbox', () => {
        return !!document.querySelector('.ag-header-cell[col-id="token"]') && document.querySelectorAll('.ag-selection-checkbox').length === 0
    })

    //2 點擊後: 框表格之標頭與資料列（非編輯模式重建後之表格）
    let buf2 = await captureStableWithBox(page, gridContentBox(SEL_GRID))

    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-6')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-6`)
    await ensureColumnVisible(page, 'perms') //同 E2E-005: 應用系統權限欄須橫向捲動帶入
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
    let buf4 = await captureStableWithBox(page, itemsUnionBox(permsPopupLoc(page, lang), { fit: true }))

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
// 新增 / 刪除應用系統金鑰 (ADR-095): E2E-008 / E2E-009 / E2E-010
// ===================================================================

//功能列「新增應用系統金鑰」鈕 (圖示 mdiKeyPlus; 可點層為最近之 tabindex 容器, 同 locateMdiButton)
function addBtnLoc(page) {
    return page.locator(`svg path[d="${mdiKeyPlus}"]`).locator('xpath=ancestor::div[@tabindex][1]')
}

async function clickAddBtn(page) {
    let p = await locateMdiButton(page, mdiKeyPlus)
    await page.mouse.click(p.x, p.y)
    await page.mouse.move(0, 0)
}

//新增對話框面板 (WConfirm → WDialog 內層 panel; 同時只開一個對話框時唯一)
function addDlgLoc(page) {
    return page.locator(SEL_MODAL).first()
}

//對話框內以標籤文字取該欄位區塊 (標籤 div 之父層即含標籤與控制項之區塊)
function addDlgBlockLoc(page, labelText) {
    return addDlgLoc(page).locator(`text="${labelText}"`).first().locator('xpath=ancestor::div[1]')
}

//對話框內某選項 / 項目之文字(點選處)與其整列(可點層為 WInputRadio / WInputCheckbox 每項之 inline-block 容器)
function addDlgItemLoc(page, text) {
    return addDlgLoc(page).locator(`text="${text}"`).first()
}
function addDlgItemRowLoc(page, text) {
    return addDlgItemLoc(page, text).locator('xpath=ancestor::div[contains(@style,"inline-block")][1]')
}

//「建立」鈕(對話框頁腳之 WButtonChip, 文字 tokenAppCreate)
function addDlgCreateBtnLoc(page, lang) {
    return addDlgLoc(page).locator('div[tabindex]').filter({ hasText: kpUiText[lang].create }).last()
}


//新鑄造之金鑰其權杖字串與建立 / 更新時間為不可固定之值(伺服端產生、取當下時間): 於成功訊息點確認後, 先於資料庫將該列改為固定值,
//再經真實 UI 離開並重新進入金鑰清單(點「使用者清單」再點「金鑰清單」)讓畫面載入固定值, 其後之結果列截圖才可重現 (測試環境呈現, 正式環境無)
async function fixNewKeyAndReenter(page, lang, appName) {
    let t = kpUiText[lang]
    let rows = (await woItems.tokens.select()).filter((r) => r.appName === appName)
    assert.strictEqual(rows.length, 1, `新鑄造之金鑰「${appName}」應恰 1 列, 實際 ${rows.length}`)
    await woItems.tokens.save({ id: rows[0].id, token: NEW_KEY_FIXED_TOKEN, timeCreate: FIX_TIME_NEW, timeUpdate: FIX_TIME_NEW })

    await page.locator(`text="${t.usersList}"`).first().click()
    await page.waitForTimeout(1500)
    await page.locator(`text="${t.tokensList}"`).first().click()
    await page.locator(`text="${t.editMode}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    await waitGridIdle(page, { minCells: 1, requireSelector: '.ag-header-cell[col-id="token"]', requireScrollLeftZero: true, timeout: 60000 })
    await waitUntilExist(page, `fixed new key ${NEW_KEY_FIXED_TOKEN}`, (s) => document.body.innerText.includes(s), { arg: NEW_KEY_FIXED_TOKEN, timeout: 30000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1500)
}


//量測型目標: 某列之「可見部分」(固定欄與捲動欄之列聯集, 夾在表格框內). 橫向捲動後該列之捲動欄矩形左端落在視窗外(整列寬 > 視窗),
//直接取 rowBoxSel 聯集會使紅框左緣被夾到圖緣而蓋住側欄, 故夾在表格框內; 固定欄與捲動欄之列重疊為凍結欄設計, 不屬被蓋住(不需 coverCheck:'off')
function visibleRowBox(rowIdx) {
    return {
        label: `visibleRowBox(${rowIdx})`,
        scroll: `.ag-pinned-left-cols-container .ag-row[row-index="${rowIdx}"]`,
        measure: async (page) => {
            return page.evaluate((idx) => {
                let root = document.querySelector('.ag-root-wrapper')
                if (!root) {
                    return null
                }
                let rr = root.getBoundingClientRect()
                let parts = []
                root.querySelectorAll(`.ag-row[row-index="${idx}"]`).forEach((row) => {
                    let r = row.getBoundingClientRect()
                    if (r.width > 0 && r.height > 0) {
                        parts.push(r)
                    }
                })
                if (parts.length === 0) {
                    return null
                }
                let left = Math.max(Math.min(...parts.map((r) => r.left)), rr.left)
                let top = Math.max(Math.min(...parts.map((r) => r.top)), rr.top)
                let right = Math.min(Math.max(...parts.map((r) => r.right)), rr.right)
                let bottom = Math.min(Math.max(...parts.map((r) => r.bottom)), rr.bottom)
                if (right <= left || bottom <= top) {
                    return null
                }
                return { x: left, y: top, width: right - left, height: bottom - top }
            }, rowIdx)
        },
    }
}


//開啟新增對話框並輸入名稱, 回傳 { buf1: 點擊前框新增鈕, buf2: 對話框面板(兼任「輸入名稱」之點擊前), buf3: 名稱已輸入 }
async function openAddDlgAndTypeName(page, lang, name) {
    let t = kpUiText[lang]
    //1 點擊前: 框新增鈕整顆
    let buf1 = await captureStableWithBox(page, addBtnLoc(page))
    await clickAddBtn(page)
    await addDlgLoc(page).waitFor({ state: 'visible', timeout: 5000 })
    await addDlgItemLoc(page, t.usageSystem).waitFor({ state: 'visible', timeout: 5000 })
    //2 點擊後: 框對話框面板(同時為「輸入名稱」之點擊前圖, 名稱欄在其內, §7.1 相鄰兼任)
    let buf2 = await captureStableWithBox(page, SEL_MODAL)
    await typeIntoInput(page, addDlgLoc(page).locator('input').first(), name)
    //3 點擊後: 框名稱欄(標籤 + 輸入框)
    let buf3 = await captureStableWithBox(page, itemsUnionBox(addDlgBlockLoc(page, t.appName), { fit: true }))
    return { buf1, buf2, buf3 }
}


//E2E-008 新增系統服務用途之應用系統金鑰 (名稱 svc-demo、權限「讀統計」), 共 10 張
//  1 click-add-btn / 2 add-dialog / 3 name-typed / 4 click-usage-system / 5 usage-system-selected / 6 check-read-stats / 7 read-stats-checked / 8 click-create / 9 create-success-modal / 10 created-row
async function captureAddSystemKey(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdminAndOpenTokensList(page, lang)
    let { buf1, buf2, buf3 } = await openAddDlgAndTypeName(page, lang, NEW_KEY_NAME_SYS)

    //4 點擊前: 框「系統服務用途」選項整列
    let buf4 = await captureStableWithBox(page, itemsUnionBox(addDlgItemRowLoc(page, t.usageSystem), { fit: true }))
    await addDlgItemLoc(page, t.usageSystem).click()
    await addDlgItemLoc(page, t.permReadStats).waitFor({ state: 'visible', timeout: 5000 })

    //5 點擊後: 框對話框面板(用途已選, 權限清單出現)
    let buf5 = await captureStableWithBox(page, SEL_MODAL)

    //6 點擊前: 框權限清單中「讀統計」整列
    let buf6 = await captureStableWithBox(page, itemsUnionBox(addDlgItemRowLoc(page, t.permReadStats), { fit: true }))
    await addDlgItemLoc(page, t.permReadStats).click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(400)
    let st = await addDlgLoc(page).evaluate((el) => Array.from(el.querySelectorAll('input[type="checkbox"]')).filter((x) => x.checked && !x.disabled).length)
    assert.strictEqual(st, 1, `勾選讀統計後對話框內應恰 1 項可選權限已勾選, 實際 ${st}`)

    //7 點擊後: 框對話框面板(「讀統計」已勾選)
    let buf7 = await captureStableWithBox(page, SEL_MODAL)

    //8 點擊前: 框「建立」鈕整顆
    let buf8 = await captureStableWithBox(page, addDlgCreateBtnLoc(page, lang))
    await addDlgCreateBtnLoc(page, lang).click()
    await waitCheckYes(page, lang)
    await assertSuccessModalText(page, lang, 'E2E-008-add-system-key-success')

    //9 點擊後: 框成功 modal(同時為「確認」之點擊前圖, 確認鈕在其內, §7.1 相鄰兼任); 背景清單中新列之權杖字串為伺服端產生之隨機值(不可固定), 以黑塊遮蔽該儲存格 (unfixable-values-masking)
    let buf9 = await captureStableWithBox(page, SEL_MODAL, { mask: [SEL_NEW_ROW_TOKEN_CELL] })

    //點確認 → 固定新列不可固定之值並重新進入清單 → 10 框新列
    await closeCheckYesAndWaitGridIdle(page, lang)
    await fixNewKeyAndReenter(page, lang, NEW_KEY_NAME_SYS)
    let rowIdx = await findRowIdxByTokenValue(page, NEW_KEY_FIXED_TOKEN)
    if (rowIdx === null) throw new Error(`new key row not found: ${NEW_KEY_FIXED_TOKEN}`)
    //權限與「不設期限」於 1280 寬之初始位置不在可視範圍(用途、名稱欄之後), 橫向捲動使權限欄貼齊捲動區左緣(其後之建立、到期時間欄一併入鏡)再框新列 (使用者亦須如此操作)
    await ensureColumnVisible(page, 'perms', 'start')
    let buf10 = await captureStableWithBox(page, visibleRowBox(rowIdx))

    return {
        'E2E-008-1-click-add-btn': buf1,
        'E2E-008-2-add-dialog': buf2,
        'E2E-008-3-name-typed': buf3,
        'E2E-008-4-click-usage-system': buf4,
        'E2E-008-5-usage-system-selected': buf5,
        'E2E-008-6-check-read-stats': buf6,
        'E2E-008-7-read-stats-checked': buf7,
        'E2E-008-8-click-create': buf8,
        'E2E-008-9-create-success-modal': buf9,
        'E2E-008-10-created-row': buf10,
    }
}


//E2E-009 新增使用者用途之應用系統金鑰 (名稱 user-demo、綁定使用者 ac-viewer), 共 11 張
//  1 click-add-btn / 2 add-dialog / 3 name-typed / 4 click-usage-user / 5 usage-user-selected / 6 click-bound-user / 7 bound-user-list / 8 bound-user-selected / 9 click-create / 10 create-success-modal / 11 created-row
async function captureAddUserKey(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdminAndOpenTokensList(page, lang)
    let { buf1, buf2, buf3 } = await openAddDlgAndTypeName(page, lang, NEW_KEY_NAME_USR)

    //4 點擊前: 框「使用者用途」選項整列
    let buf4 = await captureStableWithBox(page, itemsUnionBox(addDlgItemRowLoc(page, t.usageUser), { fit: true }))
    await addDlgItemLoc(page, t.usageUser).click()
    await addDlgBlockLoc(page, t.boundUser).waitFor({ state: 'visible', timeout: 5000 })

    //5 點擊後: 框對話框面板(用途已選, 所綁使用者欄出現)
    let buf5 = await captureStableWithBox(page, SEL_MODAL)

    //6 點擊前: 框所綁使用者下拉(標籤 + 下拉)
    let selBlock = addDlgBlockLoc(page, t.boundUser)
    let buf6 = await captureStableWithBox(page, itemsUnionBox(selBlock, { fit: true }))
    await selBlock.locator('xpath=.//div[@tabindex][1]').click().catch(async () => {
        await selBlock.click()
    })
    let list = page.locator('.WPopperFix').filter({ hasText: NEW_KEY_BOUND_TEXT }).locator(':scope > div').first()
    await list.waitFor({ state: 'visible', timeout: 5000 })

    //7 點擊後: 框展開之使用者清單浮層(同時為「選取使用者」之點擊前圖, 項目在其內, §7.1 相鄰兼任)
    let buf7 = await captureStableWithBox(page, itemsUnionBox(list, { fit: true }))
    await list.locator(`text="${NEW_KEY_BOUND_TEXT}"`).first().click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)

    //8 點擊後: 框對話框面板(所綁使用者已選)
    let buf8 = await captureStableWithBox(page, SEL_MODAL)
    assert.ok(await pageHasText(page, NEW_KEY_BOUND_TEXT), '所綁使用者選取後下拉應顯示所選使用者')

    //9 點擊前: 框「建立」鈕整顆
    let buf9 = await captureStableWithBox(page, addDlgCreateBtnLoc(page, lang))
    await addDlgCreateBtnLoc(page, lang).click()
    await waitCheckYes(page, lang)
    await assertSuccessModalText(page, lang, 'E2E-009-add-user-key-success')

    //10 點擊後: 框成功 modal; 背景新列之權杖字串為不可固定之值, 同 E2E-008-9 遮蔽
    let buf10 = await captureStableWithBox(page, SEL_MODAL, { mask: [SEL_NEW_ROW_TOKEN_CELL] })

    //點確認 → 固定新列不可固定之值並重新進入清單 → 11 框新列
    await closeCheckYesAndWaitGridIdle(page, lang)
    await fixNewKeyAndReenter(page, lang, NEW_KEY_NAME_USR)
    let rowIdx = await findRowIdxByTokenValue(page, NEW_KEY_FIXED_TOKEN)
    if (rowIdx === null) throw new Error(`new key row not found: ${NEW_KEY_FIXED_TOKEN}`)
    //同 E2E-008-10: 橫向捲動使權限欄貼齊捲動區左緣, 方能看到「同所綁使用者」與「不設期限」
    await ensureColumnVisible(page, 'perms', 'start')
    let buf11 = await captureStableWithBox(page, visibleRowBox(rowIdx))

    return {
        'E2E-009-1-click-add-btn': buf1,
        'E2E-009-2-add-dialog': buf2,
        'E2E-009-3-name-typed': buf3,
        'E2E-009-4-click-usage-user': buf4,
        'E2E-009-5-usage-user-selected': buf5,
        'E2E-009-6-click-bound-user': buf6,
        'E2E-009-7-bound-user-list': buf7,
        'E2E-009-8-bound-user-selected': buf8,
        'E2E-009-9-click-create': buf9,
        'E2E-009-10-create-success-modal': buf10,
        'E2E-009-11-created-row': buf11,
    }
}


//E2E-010 勾選使用者用途金鑰(test-token-7, 綁 id-for-viewer)刪除並儲存, 共 3 張 (序列同 E2E-003; 差異在目標列為應用系統金鑰與端到端不變式: 該金鑰失效而所綁使用者之登入不受影響)
//  1 row-selected-before-save / 2 delete-key-save-success / 3 key-removed
async function captureDeleteUserKey(page, lang) {
    await loginAsAdminAndOpenTokensList(page, lang)
    let rowIdx = await findRowIdxByTokenValue(page, 'test-token-7')
    if (rowIdx === null) throw new Error(`seed token row not found: test-token-7`)
    await checkRowSelectionByRowIdx(page, parseInt(rowIdx, 10))

    //1 勾選後、刪除 / 儲存前: 框該列(pinned-left + center 聯集)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf1 = await captureStableWithBox(page, [
        `.ag-pinned-left-cols-container .ag-row[row-index="${rowIdx}"]`,
        `.ag-center-cols-container .ag-row[row-index="${rowIdx}"]`,
    ])

    await clickTrash(page)
    await clickSave(page)
    await waitCheckYes(page, lang)
    await assertSuccessModalText(page, lang, 'E2E-010-delete-user-key-save-success')

    //2 點擊後: 框成功 modal
    let buf2 = await captureStableWithBox(page, SEL_MODAL)

    //點確認 → 3 框表格(標頭 + 可見資料列; 該金鑰已不在清單)
    await closeCheckYesAndWaitGridIdle(page, lang)
    let buf3 = await captureStableWithBox(page, gridContentBox(SEL_GRID))

    return {
        'E2E-010-1-row-selected-before-save': buf1,
        'E2E-010-2-delete-key-save-success': buf2,
        'E2E-010-3-key-removed': buf3,
    }
}


//E2E-011 檢視升級前已失效之舊金鑰 (ADR-095 補記; 純檢視, 無點擊步驟), 共 2 張
//  前置另植 2 筆「已定案為已失效」之舊列 (等同升級後第一次啟動之遷移結果): test-token-8 (timeEnd 逾期)、test-token-9 (無到期時間); 本案結束即刪除
//  1 retired-usage: 框住兩列於「用途」欄之儲存格 / 2 retired-expiry: 橫向捲動使權限欄貼齊左緣後, 框住兩列整列之可見部分 (權限欄「不適用」、到期欄原到期時間或空白)
let RETIRED_SEEDS = [
    { id: 'id-test-token-8', token: 'test-token-8', userId: 'id-user-g', timeEnd: '2020-01-01T00:00:00.000+08:00' },
    { id: 'id-test-token-9', token: 'test-token-9', userId: 'id-user-h', timeEnd: '' },
]

async function insertRetiredSeed() {
    let rows = RETIRED_SEEDS.map((r) => {
        let o = ds.tokens.funNew({ userId: r.userId, isApp: 'y' })
        o.id = r.id
        o.token = r.token
        o.isApp = 'y'
        o.appUsage = 'retired'
        o.appName = ''
        o.perms = []
        o.timeEnd = r.timeEnd
        o.timeCreate = FIX_TIME
        o.timeUpdate = FIX_TIME
        return o
    })
    await woItems.tokens.insert(rows)
}

//量測型目標: 多列之「可見部分」聯集 (同 visibleRowBox, 夾在表格框內); 列須相鄰, 否則聯集會框入其間之他列而拋錯
function visibleRowsBox(rowIdxs) {
    let idxs = rowIdxs.map((x) => parseInt(x, 10)).sort((a, b) => a - b)
    return {
        label: `visibleRowsBox(${idxs.join(',')})`,
        scroll: `.ag-pinned-left-cols-container .ag-row[row-index="${idxs[0]}"]`,
        measure: async (page) => {
            return page.evaluate((arr) => {
                let root = document.querySelector('.ag-root-wrapper')
                if (!root) {
                    return null
                }
                let rr = root.getBoundingClientRect()
                let parts = []
                for (let idx of arr) {
                    root.querySelectorAll(`.ag-row[row-index="${idx}"]`).forEach((row) => {
                        let r = row.getBoundingClientRect()
                        if (r.width > 0 && r.height > 0) {
                            parts.push(r)
                        }
                    })
                }
                if (parts.length === 0) {
                    return null
                }
                let left = Math.max(Math.min(...parts.map((r) => r.left)), rr.left)
                let top = Math.max(Math.min(...parts.map((r) => r.top)), rr.top)
                let right = Math.min(Math.max(...parts.map((r) => r.right)), rr.right)
                let bottom = Math.min(Math.max(...parts.map((r) => r.bottom)), rr.bottom)
                if (right <= left || bottom <= top) {
                    return null
                }
                return { x: left, y: top, width: right - left, height: bottom - top }
            }, idxs)
        },
    }
}

async function cellTextOf(page, rowIdx, colId) {
    return await page.evaluate(({ i, c }) => {
        let e = document.querySelector(`.ag-row[row-index="${i}"] .ag-cell[col-id="${c}"]`)
        return e ? (e.innerText || '').trim() : null
    }, { i: rowIdx, c: colId })
}

async function captureViewRetiredKeys(page, lang) {
    let t = kpUiText[lang]
    await loginAsAdminAndOpenTokensList(page, lang)
    await waitUntilExist(page, 'retired seed test-token-8', () => document.body.innerText.includes('test-token-8'))
    let idx = {}
    for (let r of RETIRED_SEEDS) {
        let i = await findRowIdxByTokenValue(page, r.token)
        if (i === null) throw new Error(`seed token row not found: ${r.token}`)
        idx[r.token] = i
    }
    if (Math.abs(parseInt(idx['test-token-8'], 10) - parseInt(idx['test-token-9'], 10)) !== 1) {
        throw new Error(`已失效之兩列須相鄰才能一圖一框, 實際 row-index: ${JSON.stringify(idx)}`)
    }

    //語意(用途欄): 兩列皆為「已失效（升級前）」
    for (let r of RETIRED_SEEDS) {
        let txt = await cellTextOf(page, idx[r.token], 'appUsage')
        assert.strictEqual(txt, t.usageRetired, `${r.token} 之用途欄應為「${t.usageRetired}」, 實際「${txt}」`)
        //文字須完整顯示、不被欄寬截斷(innerText 於截斷時仍為完整字串, 故另量幾何: 儲存格內容寬度不得超過儲存格寬度; 標準圖缺席〔待授權〕時亦能攔下, 外審 sol F9)
        let geo = await page.evaluate(({ i }) => {
            let c = document.querySelector(`.ag-row[row-index="${i}"] .ag-cell[col-id="appUsage"]`)
            return c ? { sw: c.scrollWidth, cw: c.clientWidth } : null
        }, { i: idx[r.token] })
        assert.ok(geo !== null && geo.sw <= geo.cw + 1, `${r.token} 之用途欄文字被截斷(內容寬 ${geo && geo.sw} > 儲存格寬 ${geo && geo.cw})`)
        //已失效之列之「使用者主鍵」欄不顯示(擁有者欄僅作稽核, 非身分; 同系統服務用途)
        let uid = await cellTextOf(page, idx[r.token], 'userId')
        assert.strictEqual(uid, '', `${r.token} 之使用者主鍵欄應空白, 實際「${uid}」`)
    }

    //1 框住兩列於用途欄之儲存格 (純檢視, 無點擊步驟)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf1 = await captureStableWithBox(page, RETIRED_SEEDS.map((r) => `.ag-row[row-index="${idx[r.token]}"] .ag-cell[col-id="appUsage"]`))

    //橫向捲動使權限欄貼齊左緣 (其後之建立、到期時間欄一併入鏡; 使用者亦須如此操作)
    await ensureColumnVisible(page, 'perms', 'start')

    //語意(權限欄 / 到期欄): 權限「不適用」; 到期欄顯示原到期時間(逾期者)或空白(無到期時間), 兩者皆不得出現「不設期限」; 其餘應用系統金鑰列仍為「不設期限」
    let expect8 = ot('2020-01-01T00:00:00.000+08:00').format('YYYY-MM-DD HH:mm:ss')
    for (let r of RETIRED_SEEDS) {
        let p = await cellTextOf(page, idx[r.token], 'perms')
        assert.strictEqual(p, t.permsRetired, `${r.token} 之權限欄應為「${t.permsRetired}」, 實際「${p}」`)
        let e = await cellTextOf(page, idx[r.token], 'timeEnd')
        assert.strictEqual(e, r.token === 'test-token-8' ? expect8 : '', `${r.token} 之到期欄不符, 實際「${e}」`)
        assert.ok(!String(e).includes(t.noExpire), `${r.token} 之到期欄不得顯示「${t.noExpire}」`)
    }
    for (let tk of ['test-token-5', 'test-token-6', 'test-token-7']) {
        let i = await findRowIdxByTokenValue(page, tk)
        if (i === null) throw new Error(`seed token row not found: ${tk}`)
        let e = await cellTextOf(page, i, 'timeEnd')
        assert.strictEqual(e, t.noExpire, `${tk} 之到期欄應仍為「${t.noExpire}」, 實際「${e}」`)
    }

    //2 橫向捲動後框住兩列整列之可見部分
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    let buf2 = await captureStableWithBox(page, visibleRowsBox([idx['test-token-8'], idx['test-token-9']]))

    return {
        'E2E-011-1-retired-usage': buf1,
        'E2E-011-2-retired-expiry': buf2,
    }
}

//待授權之新標準圖 (rule 19): 缺檔時只記 [pending-baseline] 不比對 (語意斷言與端到端不變式照常執行); 授權產製後該檔存在即照常 pixel 比對
async function matchPendingBaseline(buf, baselinePath, label) {
    if (!fs.existsSync(baselinePath)) {
        console.log(`[pending-baseline] ${label}: 標準圖待主控授權產製(sso-run02 E2E-011), 暫不比對`)
        return
    }
    return await assertBaselineMatch(buf, baselinePath, label)
}


// ===================================================================
// 案例宣告與案例管線 (產製端與比對端共用)
// ===================================================================

//stages: 多階段案例之圖鍵 (與 spec 視覺項、寫檔名、比對名一致; 產出與宣告不符即報錯). 單張案例之圖鍵即案例鍵.
let cases = [
    { name: 'E2E-001-list-loaded', run: captureListLoaded },
    //E2E-002 已廢止(編號保留不再使用, ADR-095): 見上方註記
    {
        name: 'E2E-003-delete-row-save-success',
        run: captureDeleteRowSaveSuccess,
        stages: ['E2E-003-1-row-selected-before-save', 'E2E-003-2-delete-row-save-success'],
    },
    { name: 'E2E-004-token-expired-save-fail', run: captureTokenExpiredSaveFail },
    {
        name: 'E2E-005-grant-perms-save-success',
        run: captureGrantPermsSaveSuccess,
        stages: ['E2E-005-1-click-perms', 'E2E-005-2-perms-list', 'E2E-005-3-check-read-tokens', 'E2E-005-4-read-tokens-checked', 'E2E-005-5-click-save', 'E2E-005-6-save-success-modal', 'E2E-005-7-perms-result'],
    },
    {
        name: 'E2E-006-revoke-perms-save-success',
        run: captureRevokePermsSaveSuccess,
        stages: ['E2E-006-1-click-perms', 'E2E-006-2-perms-list', 'E2E-006-3-uncheck-read-stats', 'E2E-006-4-read-stats-unchecked', 'E2E-006-5-click-save', 'E2E-006-6-save-success-modal', 'E2E-006-7-perms-result'],
    },
    {
        name: 'E2E-007-view-perms-readonly',
        run: captureViewPermsReadonly,
        stages: ['E2E-007-1-click-edit-mode', 'E2E-007-2-view-mode', 'E2E-007-3-click-perms', 'E2E-007-4-perms-list-readonly'],
    },
    {
        name: 'E2E-008-add-system-key-success',
        run: captureAddSystemKey,
        stages: ['E2E-008-1-click-add-btn', 'E2E-008-2-add-dialog', 'E2E-008-3-name-typed', 'E2E-008-4-click-usage-system', 'E2E-008-5-usage-system-selected', 'E2E-008-6-check-read-stats', 'E2E-008-7-read-stats-checked', 'E2E-008-8-click-create', 'E2E-008-9-create-success-modal', 'E2E-008-10-created-row'],
    },
    {
        name: 'E2E-009-add-user-key-success',
        run: captureAddUserKey,
        stages: ['E2E-009-1-click-add-btn', 'E2E-009-2-add-dialog', 'E2E-009-3-name-typed', 'E2E-009-4-click-usage-user', 'E2E-009-5-usage-user-selected', 'E2E-009-6-click-bound-user', 'E2E-009-7-bound-user-list', 'E2E-009-8-bound-user-selected', 'E2E-009-9-click-create', 'E2E-009-10-create-success-modal', 'E2E-009-11-created-row'],
    },
    {
        name: 'E2E-010-delete-user-key-save-success',
        run: captureDeleteUserKey,
        stages: ['E2E-010-1-row-selected-before-save', 'E2E-010-2-delete-key-save-success', 'E2E-010-3-key-removed'],
    },
    //E2E-011 (ADR-095 補記, sso-run02): extraSeed 為本案另植之已失效舊列; pendingBaseline 為標準圖待主控授權產製(授權前缺圖只記 [pending-baseline])
    {
        name: 'E2E-011-view-retired-keys',
        run: captureViewRetiredKeys,
        stages: ['E2E-011-1-retired-usage', 'E2E-011-2-retired-expiry'],
        extraSeed: insertRetiredSeed,
        pendingBaseline: true,
    },
]

//語意斷言已在截圖函式內 (成功 modal 仍顯示時) 完成之案例: 截圖後 modal 已關閉, 不再對已消失之文字做斷言, 最終態由 DB 不變式驗
let semanticInCapture = ['E2E-005-grant-perms-save-success', 'E2E-006-revoke-perms-save-success', 'E2E-008-add-system-key-success', 'E2E-009-add-user-key-success', 'E2E-010-delete-user-key-save-success', 'E2E-011-view-retired-keys']

//應用系統權限案例 (ADR-069) 之前後檢查: pre 於操作前確認 app token 之起始能力, post 於寫檔 / 比對標準圖之前驗 DB 與端到端不變式
//(app token 實際呼叫後台功能之成敗), 使標準圖缺漏或不符時仍先驗得流程本身. callFapi 部分只在比對端 (見檔頭說明).
let permsChecks = {
    'E2E-005-grant-perms-save-success': {
        pre: async () => {
            let r = await callFapi('getTokensList', ['test-token-4'])
            assert.strict.equal(r.ok, false, `授予前 test-token-4 (僅基本權限) 不應可讀金鑰清單, 實際: ${JSON.stringify(r).slice(0, 200)}`)
        },
        post: async (ctx) => {
            let rs = await woItems.tokens.select({ id: 'id-test-token-4' })
            assert.deepStrictEqual(rs[0].perms, ['readTokens'], `id-test-token-4 之 perms 應為 ['readTokens'], 實際: ${JSON.stringify(rs[0].perms)}`)
            if (ctx.mode !== 'compare') return
            let r = await callFapi('getTokensList', ['test-token-4'])
            assert.strict.equal(r.ok, true, `授予後 test-token-4 應立即可讀金鑰清單, 實際: ${JSON.stringify(r).slice(0, 200)}`)
        },
    },
    'E2E-006-revoke-perms-save-success': {
        pre: async () => {
            let r = await callFapi('getStaIp', ['test-token-5'])
            assert.strict.equal(r.ok, true, `撤銷前 test-token-5 應可讀統計, 實際: ${JSON.stringify(r).slice(0, 200)}`)
        },
        post: async (ctx) => {
            let rs = await woItems.tokens.select({ id: 'id-test-token-5' })
            assert.deepStrictEqual(rs[0].perms, ['readTokens'], `id-test-token-5 之 perms 應為 ['readTokens'], 實際: ${JSON.stringify(rs[0].perms)}`)
            if (ctx.mode !== 'compare') return
            let r1 = await callFapi('getStaIp', ['test-token-5'])
            assert.strict.equal(r1.ok, false, '撤銷後 test-token-5 應立即不可讀統計')
            assert.strict.equal(r1.err, 'tokenExpired', `撤銷後讀統計之對外 key 應為 tokenExpired, 實際: ${r1.err}`)
            let r2 = await callFapi('getTokensList', ['test-token-5'])
            assert.strict.equal(r2.ok, true, '未撤銷之讀金鑰應仍可用')
        },
    },
    'E2E-007-view-perms-readonly': {
        pre: null,
        post: async () => {
            let rs = await woItems.tokens.select({ id: 'id-test-token-6' })
            assert.deepStrictEqual(rs[0].perms, permsAll, `非編輯模式之操作不得改變 id-test-token-6 之 perms, 實際: ${JSON.stringify(rs[0].perms)}`)
        },
    },
    //新增系統服務用途金鑰 (ADR-095): DB 列(用途、名稱、擁有者為建立者之 admin、不給期限、權限)與端到端不變式(新金鑰實際只能讀統計, 反查為應用系統身分)
    'E2E-008-add-system-key-success': {
        pre: null,
        post: async (ctx) => {
            let rs = (await woItems.tokens.select()).filter((r) => r.appName === NEW_KEY_NAME_SYS)
            assert.strictEqual(rs.length, 1, `應新增恰 1 把「${NEW_KEY_NAME_SYS}」, 實際 ${rs.length}`)
            let r = rs[0]
            assert.deepStrictEqual([r.isApp, r.appUsage, r.userId, r.timeEnd, r.perms], ['y', 'system', testUsers.admin.id, '', ['readStats']], `新金鑰之列不符: ${JSON.stringify(r)}`)
            assert.strictEqual(r.token, NEW_KEY_FIXED_TOKEN, '權杖字串已固定(fixNewKeyAndReenter)')
            if (ctx.mode !== 'compare') return
            let sta = await callFapi('getStaIp', [r.token])
            assert.strictEqual(sta.ok, true, `新金鑰具讀統計, 實際: ${JSON.stringify(sta).slice(0, 200)}`)
            let lst = await callFapi('getTokensList', [r.token])
            assert.strictEqual(lst.ok, false, '新金鑰未授予讀金鑰, 不應可讀金鑰清單')
            let who = await callFapi('getUserByToken', [r.token])
            assert.deepStrictEqual([who.ok, who.val.id, who.val.name, who.val.isApp], [true, `app:${r.id}`, NEW_KEY_NAME_SYS, 'y'], `反查應為應用系統身分: ${JSON.stringify(who).slice(0, 200)}`)
        },
    },
    //新增使用者用途金鑰 (ADR-095): DB 列(綁 id-for-viewer、無 perms)與端到端不變式(反查為所綁使用者, 一般使用者之管理服務不可用)
    'E2E-009-add-user-key-success': {
        pre: null,
        post: async (ctx) => {
            let rs = (await woItems.tokens.select()).filter((r) => r.appName === NEW_KEY_NAME_USR)
            assert.strictEqual(rs.length, 1, `應新增恰 1 把「${NEW_KEY_NAME_USR}」, 實際 ${rs.length}`)
            let r = rs[0]
            assert.deepStrictEqual([r.isApp, r.appUsage, r.userId, r.timeEnd, r.perms], ['y', 'user', 'id-for-viewer', '', []], `新金鑰之列不符: ${JSON.stringify(r)}`)
            if (ctx.mode !== 'compare') return
            let who = await callFapi('getUserByToken', [r.token])
            assert.deepStrictEqual([who.ok, who.val.id, who.val.account, who.val.isApp, who.val.isAdmin], [true, 'id-for-viewer', 'ac-viewer', 'y', 'n'], `反查應為所綁使用者: ${JSON.stringify(who).slice(0, 200)}`)
            let lst = await callFapi('getUsersList', [r.token])
            assert.strictEqual(lst.ok, false, '綁一般使用者之金鑰不應可用管理服務')
        },
    },
    //刪除使用者用途金鑰 (ADR-095): 金鑰列已刪、該金鑰失效; 所綁使用者之登入 token 不受影響
    'E2E-010-delete-user-key-save-success': {
        pre: async () => {
            let who = await callFapi('getUserByToken', ['test-token-7'])
            assert.strictEqual(who.ok, true, `刪除前 test-token-7 應可用, 實際: ${JSON.stringify(who).slice(0, 200)}`)
        },
        post: async (ctx) => {
            assert.strictEqual((await woItems.tokens.select({ id: 'id-test-token-7' })).length, 0, 'id-test-token-7 應已被刪除')
            assert.strictEqual((await woItems.tokens.select({ id: 'id-for-token-for-viewer' })).length, 1, '所綁使用者之登入 token 不受影響')
            if (ctx.mode !== 'compare') return
            let r1 = await callFapi('checkToken', ['test-token-7'])
            assert.strictEqual(r1.ok, false, '刪除後 test-token-7 應立即失效')
            let r2 = await callFapi('checkToken', ['token-for-viewer'])
            assert.strictEqual(r2.ok, true, '所綁使用者之登入 token 仍可用')
        },
    },
    //檢視已失效之舊列 (ADR-095 補記): 兩列仍在(不刪列)、仍為已失效; 端到端不變式: 兩把金鑰皆不可用(tokenExpired), 純檢視不改資料
    'E2E-011-view-retired-keys': {
        pre: async () => {
            for (let r of RETIRED_SEEDS) {
                let c = await callFapi('checkToken', [r.token])
                assert.strictEqual(c.ok, false, `${r.token} 為已失效之舊列, 檢視前即不可用, 實際: ${JSON.stringify(c).slice(0, 200)}`)
            }
        },
        post: async (ctx) => {
            for (let r of RETIRED_SEEDS) {
                let rs = await woItems.tokens.select({ id: r.id })
                assert.strictEqual(rs.length, 1, `${r.id} 應仍在(純檢視不刪列)`)
                assert.deepStrictEqual([rs[0].isApp, rs[0].appUsage, rs[0].timeEnd], ['y', 'retired', r.timeEnd], `${r.id} 不得被改動: ${JSON.stringify(rs[0])}`)
            }
            if (ctx.mode !== 'compare') return
            for (let r of RETIRED_SEEDS) {
                let c = await callFapi('checkToken', [r.token])
                assert.strictEqual(c.ok, false, `${r.token} 檢視後仍不可用`)
                assert.strictEqual(c.err, 'tokenExpired', `${r.token} 對外固定鍵應為 tokenExpired, 實際: ${c.err}`)
            }
        },
    },
}

//DB 副作用斷言 (寫檔 / 比對之前)
async function assertDbSideEffects(name) {
    if (name === 'E2E-003-delete-row-save-success') {
        //刪除後 DB 該列應不存在
        let rs = await woItems.tokens.select({ id: 'id-test-token-2' }).catch(() => [])
        assert.strict.equal(rs.length, 0, `id-test-token-2 應已被刪除, 實際: ${rs.length} 筆`)
        //其他 seed 列應仍在 (只篩 id-test-token-* 前綴, 避開 base seed tokens / admin token)
        let all = await woItems.tokens.select().catch(() => [])
        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-token-'))
        assert.strict.equal(seedRows.length, testTokens.length - 1, `其他 seed tokens 列應仍在, 實際: ${seedRows.length} 筆 (預期 ${testTokens.length - 1})`)
    }
    else if (name === 'E2E-004-token-expired-save-fail') {
        //token 過期 reject → DB 不應變動 (id-test-token-3 已於畫面勾選刪除但未寫入, 仍存在且 isApp 為原值 'n')
        let rs = await woItems.tokens.select({ id: 'id-test-token-3' }).catch(() => [])
        assert.strict.equal(rs.length, 1, `id-test-token-3 應仍存在(畫面之刪除未寫入)`)
        assert.strict.equal(rs[0].isApp, 'n', `token 過期 reject 後 id-test-token-3 之 isApp 不應變動 (預期 'n', 實際: ${rs[0].isApp})`)
        //seed tokens 數量不變 (同上, 只篩 id-test-token-* 前綴)
        let all = await woItems.tokens.select().catch(() => [])
        let seedRows = all.filter(r => (r.id || '').startsWith('id-test-token-'))
        assert.strict.equal(seedRows.length, testTokens.length, `token 過期 reject 後 seed tokens 總數不應變動 (預期 ${testTokens.length}, 實際: ${seedRows.length})`)
    }
}

//單一案例管線: per-case DB 重置 + fresh browser (新 context, 自動接受 dialog) → 前置 → 截圖 → 語意斷言 → DB 不變式 → 寫檔 / 比對 → 關瀏覽器 → 清資料
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages || null,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => `tokens-${lg}-${key}`,
        match: c.pendingBaseline ? matchPendingBaseline : assertBaselineMatch,
        prepare: async () => {
            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokensAndTestTokens()
        },
        beforeRun: async (ctx) => {
            await resetAdminToken()
            await resetTestTokensSeed()
            if (c.extraSeed) {
                await c.extraSeed()
            }
            let pc = permsChecks[c.name]
            if (ctx.mode === 'compare' && pc && pc.pre) {
                await pc.pre()
            }
        },
        semantic: async (ctx) => {
            if (!semanticInCapture.includes(c.name)) {
                await assertSpecForCase(ctx.page, ctx.lang, c.name)
            }
        },
        verify: async (ctx) => {
            if (permsChecks[c.name]) {
                await permsChecks[c.name].post(ctx)
            }
            await assertDbSideEffects(c.name)
        },
        afterCase: async () => {
            await deleteTestUsersAndTokens()
        },
        ...extra,
    })
}


// ===================================================================
// 產生標準圖
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
        console.log(`=== 產生標準圖（${lang}）===`)
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }
    //--names 之任一項未產出即報錯 (不靜默略過)
    gate.finalize()

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

    for (let lang of langs) {

        describe(`Tokens E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(240000)

            //per-case 獨立 (fresh browser + DB 重置) 由 runCase 負責, 確保單 case --grep 也能跑
            beforeEach(async function() {
                this.timeout(240000)
                await startServersOnce()
            })

            //語意斷言與 DB / 端到端不變式皆於比對標準圖之前 (pixel baseline 為補強層)
            for (let c of cases) {
                it(`${c.name}`, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })

    }

}
