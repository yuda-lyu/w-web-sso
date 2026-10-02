//auto-load 專案根目錄之 .env 到 process.env (供 AGENTMAIL_API_KEY 等 secret 用).
//.env 已 gitignore, 不會進 repo. mocha 跑時須先有此檔; 若無則 env var 用呼叫端
//export 提供, 或單一 case 自行檢查並 throw (詳 e2e-login.test.mjs:14 註解).
import 'dotenv/config'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { woItems } from '../../g_mOrm.mjs'
import { buildBaseUsers, buildBaseTokens } from '../../g_initialData.mjs'
//e2e 共用設施 (2026-09-27 起組裝自本專案 ./srcPack; 2026-09-29 起為 devDependency w-package-tools-e2e 1.0.2, 同名同行為; 2026-09-30 起 1.0.3; 規格與 API 詳其 README.md; 一律經 ./e2eLib.mjs 引用).
//本檔只保留本專案之組態 (port、spawn 指令、WDrawer settle、資料庫種子), 匯出名稱與簽章與抽提前相同, 測試檔不必改 import.
import {
    getE2eMode,
    chromiumLaunchArgs,
    launchBrowser as pkgLaunchBrowser,
    captureStable as pkgCaptureStable,
    captureStableWithBox as pkgCaptureStableWithBox,
    composeBox as composeBoxCore,
    waitColResizeOverlay,
    waitDrawerReady,
    maskRegions,
    overlayRegions,
    assertBaselineMatch,
    typeIntoInput,
    typeIntoNthInput,
    waitUntilExist,
    createTempSettings,
    createServiceManager,
    registerCleanupHooks,
    itemsUnionBox,
    probeStuckTooltip as pkgProbeStuckTooltip
} from './e2eLib.mjs'

//REGEN: 標準圖產製模式 (各檔直跑 --baseline 或 env E2E_REGEN=1). 供「只在 regen 才允許之副作用」判斷 (如 _staref 自舉)
//規則: 診斷 env (E2E_BARE / E2E_DIAG) 生效時絕不可寫正式 baseline, getE2eMode 於此拋錯 (技能 references/pixel-mismatch-diagnosis.md §6)
let { regen: REGEN } = getE2eMode()

//確定性渲染組六旗標 (chromiumLaunchArgs) 與唯一 launch 出口; 2026-09-01 由舊四旗標升級並全量重產 baseline (技能 §8.4)
async function launchBrowser() {
    return await pkgLaunchBrowser()
}

//
// e2e 共用 base URL: 一律 127.0.0.1 不用 localhost (webpack-dev-server 只綁 IPv4, localhost 先試 ::1 每連線多 ~155ms)
//
let baseUrl = 'http://127.0.0.1:8080'
let apiUrl = 'http://127.0.0.1:11007'


//臨時 settings: 以 ./settings.json (JSON5) 淺合併 overrides 寫出純 JSON 至 test/_tmp/ (gitignore; ./tmp 為 AI 暫存區不可用),
//供需不同設定啟動 backend 之情境 (如 allowUserRegistration=false); cleanup() 逐檔刪除
let { genTempSettings, cleanupTempSettings } = createTempSettings({
    basePath: './settings.json',
    tmpDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_tmp'),
})


//
// e2e 自動啟動 / 關閉前後端 (沿用政策 reuse):
// - startServersOnce(): 11007 / 8080 各自偵測, port 沒人 → spawn; 已被佔用 → 沿用 (不 spawn 也不負責關); 之後之呼叫不再偵測
// - restartBackend(pathSettings, envOverride): 殺自建 backend 並等 port 釋放; backend 非自建 (沿用中) 而 11007 被佔用 → 殺其監聽者
//   (11007 專屬本專案, CLAUDE.md 明文例外), 再以 node srv.mjs <pathSettings> 重啟並等 ready.
//   envOverride: 與 process.env 淺合併後傳 spawn, 只作用於本次. why: backend 最終設定 = settings 檔 overlay g_getSettings(),
//   後者會把 .env 之 EM_SRC_* 覆寫進去 (連 genTempSettings 都被蓋掉), 但 g_getSettings 之 loadEnv 對「process.env 已有之 key」不從 .env 載入,
//   故在 spawn env 預先放 EM_SRC_HOST 等即可使 .env 失效 (典型: E2E-021 以 EM_SRC_PORT=1 讓寄信瞬間失敗)
// - cleanup(): 只殺自己 spawn 的、重置一次性狀態 (中途被誤呼叫後之 startServersOnce 能重新偵測, ADR-057)、刪臨時 settings
// - 觸發 cleanup: mocha root after (子進程 hold event loop, 不能只靠 exit) + exit / SIGINT / SIGTERM 備援; 直跑 --baseline 由各檔主函式末尾呼叫
//
let services = createServiceManager({
    services: [
        {
            name: 'backend',
            port: 11007,
            readyTimeoutMs: 30000,
            spawn: ({ args, env }) => spawn('node', ['srv.mjs', ...args], { stdio: 'ignore', env }),
        },
        {
            name: 'frontend',
            port: 8080,
            readyTimeoutMs: 90000, //vue-cli-service serve 首次編譯約 15~30 秒
            startNote: 'first compile ~15-30s',
            //單一指令字串: shell:true 帶參數陣列會觸發 Node 24 DEP0190(參數只被串接、不跳脫; 2026-09-30 改, 指令列相同)
            spawn: () => spawn('npm run serve', { stdio: 'ignore', shell: true }),
        },
    ],
    killForeignOnRestart: true,
    onCleanup: () => cleanupTempSettings(),
})

async function startServersOnce() {
    await services.startServersOnce()
}

async function restartBackend(pathSettings = './settings.json', envOverride = null) {
    await services.restart('backend', { args: [pathSettings], env: envOverride })
}

function cleanup() {
    services.cleanup()
}

//模組頂層註冊: 本檔被 api-setup.mjs 先 import, root after 因而排在其強制退出 (process.exit) 之前
registerCleanupHooks(cleanup, { afterTimeoutMs: 20000 })


//pixel baseline 截圖統一入口 (retry-until-stable; regen 端 strict). 本專案之 settle 訊號為 WDrawer:
//拖曳分隔條 overlay 由 setTimeout(300ms) 控 opacity 0→1 (waitColResizeOverlay), 抽屜以根節點 [state] 標記
//hidden/opening/opened/hiding (waitDrawerReady, transitionend 事件驅動, 不受主執行緒負載影響).
//strict 未指定時於每次呼叫讀 E2E_STRICT_CAPTURE (各檔 generateBaseline 設為 '1').
//提示框殘留是缺陷, 不是可接受狀態 (2026-09-29 更正; 原載「按鈕點擊後立即彈 dialog 者, 遮罩擋住 mouseleave, 截圖含 tooltip 視為可接受」不成立):
//單純出現遮罩時移開游標仍會觸發 mouseleave(最小重現 spec/evidence/2026-09-29-tooltip-mouseleave-repro.mjs); 曾見成因為 w-component-vue ≤2.5.23 之
//WButtonCircle 以 v-if 換掉游標下之圖示(promiseUnlock 載入圖示)再出現遮罩, 2.5.24 起圖示層與停用遮罩 pointer-events:none 已修正(ADR-077).
//每次截圖前以 probeStuckTooltip 守門: 再出現即拋錯使該案失敗(不凍結為標準圖).
async function captureStable(page, opts = {}) {
    return await pkgCaptureStable(page, { settle: [waitColResizeOverlay, waitDrawerReady], ...opts, beforeShots: [probeStuckTooltip, ...(opts.beforeShots || [])] })
}

//probeStuckTooltip: 提示框殘留之回歸守門(技能 role-coder-for-test-e2e §10〈提示框／hover 殘留〉; 規則 R-E2E-TIP). captureStable 已將游標移至 (0,0)
//並等待 ≥1.5 秒, 此時仍顯示之 hover 型提示框(WTooltip mode='tooltip', 文字不限)必為殘留: mouseleave 未送達其觸發區, 拋錯使該案失敗
//(2026-09-30 起; 元件修正前為只認 saveChanges 之 knownDefect pending). 點開型浮層(mode='popup': WPopup、下拉清單)為刻意開啟, 不在此列.
//判斷由套件 probeStuckTooltip 執行(1.0.3 起; 原四專案各自手寫之同一實作收斂至套件, 未給 rootSel 時頁內邏輯與原實作相同):
//以 WTooltip 內部結構辨識($refs.divTrigger/divContent、props.mode、data.valueTrans), 根實例取 window.$vo(App.vue 掛上), 無則取 body 直屬元素之 __vue__.
//元件改寫會使其找不到提示框而一律通過(靜默失效), 升級 w-component-vue 時依 R-E2E-TIP 以真元件頁複驗. 本檔只注入錯誤訊息(指出成因與先查何處).
async function probeStuckTooltip(page) {
    return await pkgProbeStuckTooltip(page, {
        createError: (texts) => new Error(`游標已移開, 提示框「${texts.join('」「')}」仍顯示(提示框殘留; w-component-vue 2.5.24 已修正 WButtonCircle 之成因, 再現即回歸, 先確認已安裝之 WButtonCircle.vue 圖示層仍帶 pointer-events:none)`),
    })
}

//全頁穩定截圖 + 紅框 (#f26 / 5px / 圓角 4; 截圖後 sharp 合成, 不注入 DOM; 技能 §8.3) + opts.mask 遮黑.
//target: CSS selector / Locator / 以上混合陣列 (取聯集框成一個框); 第一個目標先捲入視窗.
//紅框夾在 buffer 內 (技能 §8.3 規定夾在視窗內; 本專案頁高皆 ≤ 視窗故等價, 映射表登錄為偏離)
async function captureStableWithBox(page, target, opts = {}) {
    return await pkgCaptureStableWithBox(page, target, { ...opts, capture: captureStable })
}

//紅框合成 (box 為 buffer 座標之目標區, 外擴 6、夾在 buffer 內留 3)
async function composeBox(buf, box) {
    return await composeBoxCore(buf, box)
}


//e2e 資料庫起始狀態重置: 清空 users / tokens / ips 三張表, 再插入「基本測試數據」(g_initialData
//的 3 使用者 + 4 token, 含系統管理員 ac-admin). 每個 e2e 測試 setup 階段先呼叫此函式, 再插入
//自己的特化數據, 即可保證從相同已知 DB 狀態起跑 — 不受其他 e2e 非預期結束殘留 / 既有數據變動影響.
//teardown 階段各測試只刪自己的特化數據, 不動基本種子 → 非 e2e 時段仍保有完整基本數據可用.
async function resetToBaseSeed() {
    await woItems.users.delAll()
    await woItems.tokens.delAll()
    await woItems.ips.delAll()
    await woItems.users.insert(buildBaseUsers())
    await woItems.tokens.insert(buildBaseTokens())
}


//e2e teardown 用: 只刪除「e2e 特化數據」, 保留基本測試數據 (base seed). 作法 = 刪掉所有「不屬於
//base seed」的 users / tokens, 並清空 ips 表. 對齊使用者需求「測試完僅刪除 e2e 特化數據, 保留基本
//數據供非 e2e 時段使用」. 能連動態建立的列 (如 adduser 的 au-newuser-* / register 的 qauser-*)
//一起清掉 (不像逐筆 by-id 刪只能清靜態已知列).
async function deleteNonBaseSeed() {
    let baseUserIds = new Set(buildBaseUsers().map((u) => u.id))
    let baseTokenIds = new Set(buildBaseTokens().map((t) => t.id))
    let us = await woItems.users.select().catch(() => [])
    for (let u of us) {
        if (!baseUserIds.has(u.id)) await woItems.users.del({ id: u.id }).catch(() => {})
    }
    let ts = await woItems.tokens.select().catch(() => [])
    for (let t of ts) {
        if (!baseTokenIds.has(t.id)) await woItems.tokens.del({ id: t.id }).catch(() => {})
    }
    await woItems.ips.delAll().catch(() => {})
}


//後台左側選單之可見項目聯集（紅框目標；「已進入後台、選單依身分列出頁籤」之觀看區）：
//技能 §7.2 清單列「進入頁面 → 當時可見之項目列的聯集」、§7.3-2 不框整欄空白。選單為 WListVertical，項目根元素為 WListItem
//（inline style 帶 border-top-left-radius，無 class 可用）；範圍為 WDrawer 平移層 [ev-stable]（x≈0、寬≈229px 之 sidebar）。
//2026-09-28 收斂自 e2e-autologin（原框整個抽屜，非管理者僅 1 項卻框整欄）並套用於 e2e-login E2E-011（原框整個 body；兩案為同一畫面，須對稱）。
function backstageMenuBox() {
    return itemsUnionBox('div[style*="border-top-left-radius"]', { within: '[ev-stable]' })
}


//typeIntoInput / typeIntoNthInput: Pattern D 真人輸入 (click → 驗焦點 → Backspace 清空 → insertText → 驗值, 重試 3 次), 對 Vue v-model 必用.
//assertBaselineMatch: pixelmatch includeAA:false + threshold 0.1 + maxDiffPixels 100, fail 時三聯組存 ./testPending (永不覆蓋).
//waitUntilExist: 偵測驅動等待 (預設 10000ms), 逾時 = 真實異常.
export { startServersOnce, cleanup, launchBrowser, chromiumLaunchArgs, REGEN, captureStable, captureStableWithBox, composeBox, waitDrawerReady, assertBaselineMatch, baseUrl, apiUrl, maskRegions, overlayRegions, resetToBaseSeed, deleteNonBaseSeed, genTempSettings, restartBackend, typeIntoInput, typeIntoNthInput, waitUntilExist, backstageMenuBox }
