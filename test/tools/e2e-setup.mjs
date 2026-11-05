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
    maskRegions as pkgMaskRegions,
    overlayRegions as pkgOverlayRegions,
    assertBaselineMatch,
    typeIntoInput,
    typeIntoNthInput,
    waitUntilExist,
    createTempSettings,
    createServiceManager,
    registerCleanupHooks,
    itemsUnionBox,
    probeStuckTooltip as pkgProbeStuckTooltip,
    resolveE2ePort
} from './e2eLib.mjs'
//基準埠與埠保留(排程第 309 項, 2026-11-05 ws309): e2ePorts.mjs 載入時即呼叫 reserveE2ePorts(基準埠有占用時整組位移並寫入 E2E_PORT_OFFSET),
//須早於本檔任何 resolveE2ePort／createServiceManager——ES 模組先評估被匯入者, 故下列匯入早於本檔本體。基準埠只定義於 e2ePorts.mjs(單一定義處).
import { BACKEND_PORT as BACKEND_BASE_PORT, FRONTEND_PORT as FRONTEND_BASE_PORT, UNIT_TEST_PORTS_ACTIVE, reservation } from './e2ePorts.mjs'
//畫面含實際埠(使用者清單／資訊頁之 redir)之比對端覆蓋(規格 E7), 詳 ./e2ePortOverlay.mjs
import { findPortRegions, overlayPortRegions, recordPortRegions } from './e2ePortOverlay.mjs'

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
//多開 (2026-11-04 ws302): 基準埠寫死 (前端 8080、後端 11007; 2026-11-05 ws309 起定義於 ./e2ePorts.mjs), 實際埠經 resolveE2ePort 依環境變數 E2E_PORT_OFFSET 位移
//(供 shardE2e 之臨時實例, 或單開時基準埠被他人占用而由 reserveE2ePorts 自動換埠); 未設或為 0 時 resolveE2ePort 原樣回傳基準埠, 下列各處與導入前逐字相同.
//本專案之後端埠只由 settings.json 之 serverPort 決定 (環境變數與命令列皆不能覆寫), 故位移時須另寫臨時 settings 帶實際埠 (見 genTempSettings、argsOf).
let baseUrl = `http://127.0.0.1:${resolveE2ePort(FRONTEND_BASE_PORT)}`
let apiUrl = `http://127.0.0.1:${resolveE2ePort(BACKEND_BASE_PORT)}`
let isPortShifted = resolveE2ePort(BACKEND_BASE_PORT) !== BACKEND_BASE_PORT
//任一實際埠不同於基準埠 (整組一起位移, 實務上與 isPortShifted 同值; 分開寫是因畫面含前端埠): 位移時畫面上含實際埠之區域由比對端覆蓋 (見 comparePortBuf)
const PORTS_SHIFTED = isPortShifted || resolveE2ePort(FRONTEND_BASE_PORT) !== FRONTEND_BASE_PORT
//標準圖只能在基準埠產製 (畫面含前端埠之 5 個流程, 標準圖內是基準埠之文字): 位移實例 (單開被占用而自動換埠, 或手動設 E2E_PORT_OFFSET) 產製且未導向暫存目錄 (E2E_BASELINE_OUT_DIR) 即拋錯,
//免把帶實際埠之畫面寫成正式標準圖. 等價驗證 (基準埠與位移埠各產圖到隔離目錄) 不受影響. 單元測試專用之基準埠覆寫 (E2E_PORTS_FOR_UNIT_TEST) 生效時基準埠已不是 8080／11007, 視同位移 (誤設時亦擋下).
if (REGEN && (PORTS_SHIFTED || UNIT_TEST_PORTS_ACTIVE) && !process.env.E2E_BASELINE_OUT_DIR) {
    throw new Error(`[e2e-setup] 標準圖只能在基準埠 (後端 ${BACKEND_BASE_PORT}、前端 ${FRONTEND_BASE_PORT}) 產製: 目前埠已位移 (後端 ${resolveE2ePort(BACKEND_BASE_PORT)}、前端 ${resolveE2ePort(FRONTEND_BASE_PORT)}), 畫面含埠之標準圖會被寫成位移後的埠. 請待基準埠空閒再產, 或設 E2E_BASELINE_OUT_DIR 導向暫存目錄 (等價驗證用)`)
}


//臨時 settings: 以 ./settings.json (JSON5) 淺合併 overrides 寫出純 JSON 至 test/_tmp/ (gitignore; ./tmp 為 AI 暫存區不可用),
//供需不同設定啟動 backend 之情境 (如 allowUserRegistration=false); cleanup() 逐檔刪除
let { genTempSettings: genTempSettingsInner, cleanupTempSettings } = createTempSettings({
    basePath: './settings.json',
    tmpDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_tmp'),
})

//位移時於基底設定之上先注入三鍵 (再套呼叫端之 overrides): serverPort 為後端實際監聽埠; verifyBaseUrl 為驗證信內連結之後端網址
//(少了它連結仍指向基準埠, 即他實例或無人之埠, e2e-login 之驗證信流程會連錯); siteUrl 為前端網址 (目前後端不讀取, 與 settings.json 同形保持一致).
//主機維持 settings.json 原有之 localhost 形式. 未位移時不注入任何鍵: 臨時設定與導入前逐字相同.
function genTempSettings(overrides = {}) {
    let portOverrides = isPortShifted ? {
        serverPort: resolveE2ePort(BACKEND_BASE_PORT),
        verifyBaseUrl: `http://localhost:${resolveE2ePort(BACKEND_BASE_PORT)}`,
        siteUrl: `http://localhost:${resolveE2ePort(FRONTEND_BASE_PORT)}`,
    } : {}
    return genTempSettingsInner({ ...portOverrides, ...overrides })
}

//位移時 srv.mjs 之設定路徑引數須指向帶實際埠之臨時設定: 預設 (未給或 './settings.json') 改走 genTempSettings({}), 已是臨時設定者 (測試以 genTempSettings 產生) 原樣.
//未位移時 args 原樣傳入.
function argsOf(args) {
    if (!isPortShifted) {
        return args
    }
    let a0 = args[0]
    return [!a0 || a0 === './settings.json' ? genTempSettings({}) : a0, ...args.slice(1)]
}


//
// e2e 自動啟動 / 關閉前後端 (2026-11-05 ws309 起已導入單開自動換埠, 規格 E1～E8; 沒有占用時埠與行為同導入前):
// - startServersOnce(): 基準埠 11007 / 8080 (被占用則整組位移, 見 ./e2ePorts.mjs) 各自偵測, port 沒人 → spawn; 之後之呼叫不再偵測.
//   保留之後該埠才被他人占走 (已有回應而本實例未啟動過) → 拋錯寫明占用者, 不沿用、不下殺 (重跑即重選埠); 只有手動設 E2E_PORT_OFFSET (含 0, 沿用本機已起之服務之逃生口) 才沿用既有服務.
//   前端 dev server 就緒後另核對其輸出之 Local 網址埠 (vue-cli 之 --port 只是 portfinder 起點, 埠被搶走時靜默改埠, 見 checkDevServerTail).
// - restartBackend(pathSettings, envOverride): 殺自建 backend 並等 port 釋放; port 仍被非自建者占用 → 只殺「身分已確認屬本實例」者 (reservation.killOwnListeners), 其餘拋錯寫明占用者,
//   絕不依埠下殺 (占用者可能是別的套件正在跑之測試; 2026-11-05 修前以真實占用者實測: 占 11007 跑 e2e-init 全綠而占用者被殺), 再以 node srv.mjs <pathSettings> 重啟並等 ready.
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
            port: BACKEND_BASE_PORT, //基準埠; 實際埠由 createServiceManager 經 resolveE2ePort 位移
            readyTimeoutMs: 30000,
            spawn: ({ args, env }) => spawn('node', ['srv.mjs', ...argsOf(args)], { stdio: 'ignore', env, windowsHide: true }),
        },
        {
            name: 'frontend',
            port: FRONTEND_BASE_PORT,
            readyTimeoutMs: 90000, //vue-cli-service serve 首次編譯約 15~30 秒
            startNote: 'first compile ~15-30s',
            //單一指令字串: shell:true 帶參數陣列會觸發 Node 24 DEP0190(參數只被串接、不跳脫; 2026-09-30 改, 指令列相同)
            //位移時以收到之 port 指定 dev server 埠 (未指定時 vue-cli 遇占用會自動遞增, 而本檔仍等實際埠); 未位移時維持原指令 'npm run serve'.
            //dev server 之 proxy 目標由 vue.config.js 依同一環境變數位移 (子行程繼承 process.env)
            //stdout／stderr 改 pipe 並只留尾段 (trackDevServer), 供就緒後核對實際綁定埠; 輸出一律被消耗, 不會塞滿 pipe
            spawn: ({ port }) => trackDevServer(spawn(port === FRONTEND_BASE_PORT ? 'npm run serve' : `npm run serve -- --port ${port}`, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true }), port),
        },
    ],
    //已導入埠保留 (reservation 明確帶入): restart 要殺非自建之監聽者時, 管理器改走 reservation.killOwnListeners, 只殺身分已確認 (noteOwn 取樣之 PID＋起始時間＋映像) 屬本實例者,
    //其餘拋錯寫明占用者; killForeignOnRestart 仍須為 true 才進入下殺判斷 (規格 E4: 絕不殺占用者, 除非已正面確認是本實例之殘留)
    reservation,
    killForeignOnRestart: true,
    onCleanup: () => cleanupTempSettings(),
})

//前端 dev server 之 stdout／stderr 只保留末段 (避免 buffer 塞滿又不洩漏到測試輸出); 本實例自建之 dev server 供 startServersOnce 核對其實際綁定埠 (沿用既有服務時為 null)
const DEV_SERVER_TAIL_MAX = 4000
let ownDevServer = null
let devServerVerified = false

/**
 * 追蹤自建 dev server (stdio 須為 pipe): 保留輸出尾段供 startServersOnce 核對實際綁定埠; 單元測試以假服務經此函數走同一條核對路徑.
 * @param {ChildProcess} child 自建之 dev server 行程 (stdout／stderr 為 pipe)
 * @param {Number} port 預期之實際埠 (已含位移)
 * @returns {ChildProcess} 原行程
 */
function trackDevServer(child, port) {
    let tail = ''
    let keep = (d) => {
        tail += String(d)
        if (tail.length > DEV_SERVER_TAIL_MAX) {
            tail = tail.slice(tail.length - DEV_SERVER_TAIL_MAX)
        }
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    ownDevServer = { port, getTail: () => tail }
    devServerVerified = false
    return child
}

/**
 * 由 dev server 輸出之尾段核對其實際綁定埠 (vue-cli 於首編完成後印 `- Local:   http://localhost:<埠>/`).
 * vue-cli 之 --port (或預設 8080) 只是 portfinder 之起點: 埠於 spawn 與綁定之間被搶走時, 仍會靜默改用 port+1 而 baseUrl 不變, 就緒探測若剛好被搶走者回應就會打到別人的服務.
 * @param {String} tail 輸出尾段
 * @param {Number} port 預期之實際埠
 * @returns {Object} { state: 'ok' | 'mismatch' | 'unknown', actual } ok＝與預期埠相同; mismatch＝印出之埠不同 (portfinder 改埠); unknown＝尚未見到 Local 網址
 */
function checkDevServerTail(tail, port) {
    let clean = String(tail).replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g'), '') //去 ANSI 控制碼
    let all = [...clean.matchAll(/Local:\s+https?:\/\/[^\s/:]+:(\d+)\//g)]
    if (all.length === 0) {
        return { state: 'unknown', actual: null }
    }
    let actual = Number(all[all.length - 1][1])
    return { state: actual === Number(port) ? 'ok' : 'mismatch', actual }
}

//就緒後核對自建 dev server 實際綁定之埠: mismatch 即拋錯 (為免打到別人的服務而中止, 重跑即重選埠); 逾時仍未見 Local 網址只警告 (輸出格式不明, 不誤殺)
//逾時給 75 秒: 被搶走時就緒探測會立即被搶走者滿足, 而 vue-cli 首編完才印 Local 網址 (正常約 15～30 秒, 高負載更久); 時限過短會退化為警告而放行 (只在無法核對時才耗到逾時, 正常路徑一見 Local 即回).
//上限需加上服務就緒等待 (readyTimeoutMs 90 秒) 仍小於各 e2e 檔 hook 之 180 秒, 否則 hook 先逾時使「只警告放行」之設計失效
async function verifyDevServerPort({ verifyTimeoutMs = 75000 } = {}) {
    if (!ownDevServer || devServerVerified) {
        return
    }
    let t0 = Date.now()
    for (;;) {
        let r = checkDevServerTail(ownDevServer.getTail(), ownDevServer.port)
        if (r.state === 'mismatch') {
            throw new Error(`dev server 實際綁定埠 ${r.actual} 不是預期之 ${ownDevServer.port}(保留後、綁定前該埠被搶走, vue-cli 之 portfinder 靜默改埠); 為免打到別人的服務而中止, 重跑即重選埠`)
        }
        if (r.state === 'ok') {
            devServerVerified = true
            return
        }
        if (Date.now() - t0 > verifyTimeoutMs) {
            console.log('[e2e-setup] 警告: 未於 dev server 輸出見到 Local 網址, 無法核對其實際綁定埠')
            devServerVerified = true
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
}

//單元測試專用之基準埠覆寫 (E2E_PORTS_FOR_UNIT_TEST) 生效時不得起停服務: 後端埠只由 settings.json 之 serverPort 決定 (未位移時不注入)、前端指令不帶 --port、vue.config.js 之 proxy 讀 11007,
//覆寫後的基準埠與這些不一致, 起服務會綁到真實之 11007／8080 或逾時 (2026-11-05 ws309 複審 M3)
function assertNoUnitTestPorts(what) {
    if (UNIT_TEST_PORTS_ACTIVE) {
        throw new Error(`[e2e-setup] E2E_PORTS_FOR_UNIT_TEST 生效中 (單元測試專用之基準埠覆寫), 不得${what}; 請移除該環境變數`)
    }
}

async function startServersOnce() {
    assertNoUnitTestPorts('啟動服務 (startServersOnce)')
    await services.startServersOnce()
    await verifyDevServerPort()
}

async function restartBackend(pathSettings = './settings.json', envOverride = null) {
    assertNoUnitTestPorts('重啟後端 (restartBackend)')
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
async function captureStableRaw(page, opts = {}) {
    return await pkgCaptureStable(page, { settle: [waitColResizeOverlay, waitDrawerReady], ...opts, beforeShots: [probeStuckTooltip, ...(opts.beforeShots || [])] })
}

//畫面含實際埠之比對端覆蓋 (規格 E7; 排程第 309 項 ws309; 詳 ./e2ePortOverlay.mjs): 位移 (實際埠不同於基準埠) 時, 截圖當下於頁內量測含實際埠之可見區域
//(使用者清單「Redirect」欄與使用者資訊頁顯示之 redir, 其前端埠進標準圖) 並記在該截圖 Buffer 上, 比對端 (runBaselineCase 之 compareBuf = portCompareBuf) 以標準圖同座標內容覆蓋之
//(標準圖不動、產製端原樣寫出; 只覆蓋「:埠」本身, 同一行其餘文字仍逐像素比對, 見 e2ePortOverlay.mjs); 被覆蓋之值為實際埠由掃描本身保證 (只收含 `:<實際埠>` 者). 未位移時不量測也不覆蓋, 比對與導入前逐位元相同.
//量到區域而截圖為 clip／視窗截圖 (座標與頁面座標不同) 時拋錯, 不靜默覆蓋到錯位置.
let portRegionsOf = new WeakMap()
async function notePortRegions(page, buf, opts = {}) {
    if (!PORTS_SHIFTED) {
        return buf
    }
    let actualPorts = [resolveE2ePort(FRONTEND_BASE_PORT), resolveE2ePort(BACKEND_BASE_PORT)]
    let regions = await findPortRegions(page, actualPorts)
    if (regions.length > 0) {
        let so = (opts && opts.shotOpts) || {}
        if (so.clip || so.fullPage === false) {
            throw new Error(`畫面含實際埠 (${regions.length} 處), 但此截圖為 clip／視窗截圖, 座標與頁面座標不同, 無法覆蓋; 請改全頁截圖或擴充 notePortRegions`)
        }
    }
    //輸入框／文字區之值在 DOM 無文字節點可量「:埠」位置, 覆蓋只能蓋整框: 唯有整個值恰為本實例之網址 (http(s)://127.0.0.1|localhost:<實際埠>[/…]) 才允許, 此時被蓋住的內容已知,
    //不是「吞掉未知差異」; 值含其他內容 (例如多行、前後有別的文字) 即拋錯, 不靜默放行 (2026-11-05 ws309 複審 M2).
    let urlOfThisInstance = new RegExp(`^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost):(?:${actualPorts.join('|')})(?:[/?#]\\S*)?$`)
    for (let r of regions) {
        if ((r.kind === 'input' || r.kind === 'textarea') && !urlOfThisInstance.test(String(r.text).trim())) {
            throw new Error(`輸入框含實際埠但值不是單純的本實例網址 (「${String(r.text).slice(0, 80)}」), 整框覆蓋會吞掉未知內容; 請改以文字節點呈現或擴充 notePortRegions`)
        }
    }
    portRegionsOf.set(buf, regions)
    recordPortRegions(buf, regions) //平時關閉 (僅 E2E_PORT_REGIONS_OUT 給定時記錄, 供位元組級等價驗證)
    return buf
}
async function captureStable(page, opts = {}) {
    return await notePortRegions(page, await captureStableRaw(page, opts), opts)
}

//runBaselineCase 之 compareBuf: 位移時以標準圖同座標內容覆蓋含實際埠之區域; 未位移為 null (不覆蓋, 行為同導入前). 各 e2e 檔之 runBaselineCase 皆須帶 compareBuf: portCompareBuf (unit-e2ePortReserve PR-014 守護)
//位移時比對一張「未登記含埠區域」之截圖 (不是經 captureStable／captureStableWithBox 或其後處理包裝產生): 不覆蓋 (與未位移同), 但大聲印一次, 供全套 log 發現漏接 (只印一次, 免洗版)
let warnedUnregistered = false
let comparePortBuf = async (buf, baselinePath) => {
    let regions = portRegionsOf.get(buf)
    if (regions === undefined && !warnedUnregistered) {
        warnedUnregistered = true
        console.log(`[e2e-port] 警告: 位移實例比對了一張未登記含埠區域之截圖 (${baselinePath}); 該圖若含實際埠將不被覆蓋. 截圖須經 e2e-setup 之 captureStable／captureStableWithBox, 後處理須經其 maskRegions／overlayRegions／composeBox 包裝`)
    }
    return await overlayPortRegions(buf, baselinePath, regions)
}
let portCompareBuf = PORTS_SHIFTED ? comparePortBuf : null

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
    //內部截圖用不記錄埠區域之 captureStableRaw (final Buffer 為紅框／遮罩合成後之新 Buffer, 於合成後才量測並登記)
    return await notePortRegions(page, await pkgCaptureStableWithBox(page, target, { ...opts, capture: captureStableRaw }), opts)
}

//截圖後再處理 (紅框合成、遮罩、以參考片覆蓋) 會產生新 Buffer: 位移時把來源 Buffer 登記之含埠區域延用到新 Buffer (座標系不變: 同尺寸之再處理),
//否則比對端 (portCompareBuf) 以 Buffer 為鍵查不到區域而不覆蓋 (e2e-stainfor、e2e-autologin 於 captureStable 之後另做 overlayRegions／composeBox／maskRegions).
//clip 截圖之再處理 (尺寸不同) 若來源含埠區域, 於 notePortRegions 已拋錯, 不會延用到此.
function inheritPortRegions(src, dst) {
    if (PORTS_SHIFTED && portRegionsOf.has(src)) {
        portRegionsOf.set(dst, portRegionsOf.get(src))
    }
    return dst
}

//紅框合成 (box 為 buffer 座標之目標區, 外擴 6、夾在 buffer 內留 3). 第三參數 opt (pad／margin／bounds／guardSmall／onSkip…) 原樣轉交套件:
//e2e-stainfor 以 onSkip 偵測「紅框未畫出」(框被夾邊到不足 5px 而回無框原圖), 丟掉它會使該守門失效 (2026-11-05 ws309 複審指出).
async function composeBox(buf, box, ...rest) {
    return inheritPortRegions(buf, await composeBoxCore(buf, box, ...rest))
}

//遮罩 (rects 填黑) 與以參考片覆蓋 (rects 換成參考片同座標內容): 簽章同套件 maskRegions／overlayRegions, 延用含埠區域
async function maskRegions(buf, ...rest) {
    return inheritPortRegions(buf, await pkgMaskRegions(buf, ...rest))
}
async function overlayRegions(buf, ...rest) {
    return inheritPortRegions(buf, await pkgOverlayRegions(buf, ...rest))
}


//e2e 資料庫起始狀態重置: 清空 users / tokens / ips 三張表, 再插入「基本測試數據」(g_initialData
//的 3 使用者 + 4 token, 含系統管理者 ac-admin). 每個 e2e 測試 setup 階段先呼叫此函式, 再插入
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


//清空 server in-memory 之 IP 調用 API 計數 (kpIpCallApi) 與帳號登入失敗計數 (kpAccountLoginFailed).
//e2e 與 server 為獨立進程, in-memory state 無法由測試直接清除, 透過 server 之 /api/cleanKpIpCallApi、/api/cleanKpAccountLoginFailed
//(僅放行本機連入 + token 驗證; token 對應 settings.json 之 cleanKpIpCallApiForToken / cleanKpAccountLoginFailedForToken) 觸發.
//為何須清: ips 表之資料不只來自測試寫庫, procProtect 之 ipDetectNew 計時器 (每 2 秒) 會把 kpIpCallApi 內「ips 表尚無」之 IP 補登記回表;
//故「只清 DB」不足以讓 ips 表回到固定種子狀態: 計數內殘留之 IP (如 e2e-autoblock 以 X-Forwarded-For 登記之 1.2.3.x) 於數秒內被補登回剛重設之表,
//使後續測試檔之 IP 清單畫面多出一列 (e2e-concurrency E2E-CC-003 全套失敗之成因). 清除順序: 先清計數, 再清 DB (反之則計時器可把殘留 IP 補登回已清空之表).
//失敗只告警不拋錯 (沿用原 e2e-autoblock 行為: 後端不可達時由後續步驟顯現).
let cleanKpIpCallApiForToken = '{cleanKpIpCallApiForToken}'
let cleanKpAccountLoginFailedForToken = '{cleanKpAccountLoginFailedForToken}'

async function callCleanApi(apiName, token) {
    try {
        let r = await fetch(`${apiUrl}/api/${apiName}?token=${encodeURIComponent(token)}`)
        let j = await r.json()
        if (j.state !== 'success') {
            console.warn(`[${apiName}] server 回應非 success: ${JSON.stringify(j)}`)
        }
    }
    catch (err) {
        console.warn(`[${apiName}] 呼叫失敗: ${err.message}`)
    }
}

async function cleanKpIpCallApi() {
    await callCleanApi('cleanKpIpCallApi', cleanKpIpCallApiForToken)
}

async function cleanKpAccountLoginFailed() {
    await callCleanApi('cleanKpAccountLoginFailed', cleanKpAccountLoginFailedForToken)
}


//後台左側選單之可見項目聯集（紅框目標；「已進入後台、選單依身分列出頁籤」之觀看區）：
//技能 §7.2 清單列「進入頁面 → 當時可見之項目列的聯集」、§7.3-2 不框整欄空白。選單為 WListVertical，項目根元素為 WListItem
//（inline style 帶 border-top-left-radius，無 class 可用）；範圍為 WDrawer 平移層 [ev-stable]（x≈0、寬≈229px 之 sidebar）。
//2026-09-28 收斂自 e2e-autologin（原框整個抽屜，非系統管理者僅 1 項卻框整欄）並套用於 e2e-login E2E-011（原框整個 body；兩案為同一畫面，須對稱）。
function backstageMenuBox() {
    return itemsUnionBox('div[style*="border-top-left-radius"]', { within: '[ev-stable]' })
}


//typeIntoInput / typeIntoNthInput: Pattern D 真人輸入 (click → 驗焦點 → Backspace 清空 → insertText → 驗值, 重試 3 次), 對 Vue v-model 必用.
//assertBaselineMatch: pixelmatch includeAA:false + threshold 0.1 + maxDiffPixels 100, fail 時三聯組存 ./testPending (永不覆蓋).
//waitUntilExist: 偵測驅動等待 (預設 10000ms), 逾時 = 真實異常.
export { portCompareBuf, PORTS_SHIFTED, trackDevServer, checkDevServerTail, verifyDevServerPort, startServersOnce, cleanup, launchBrowser, chromiumLaunchArgs, REGEN, captureStable, captureStableWithBox, composeBox, waitDrawerReady, assertBaselineMatch, baseUrl, apiUrl, maskRegions, overlayRegions, resetToBaseSeed, deleteNonBaseSeed, cleanKpIpCallApi, cleanKpAccountLoginFailed, genTempSettings, restartBackend, typeIntoInput, typeIntoNthInput, waitUntilExist, backstageMenuBox }
