//auto-load 專案根目錄之 .env 到 process.env (供 AGENTMAIL_API_KEY 等 secret 用).
//.env 已 gitignore, 不會進 repo. mocha 跑時須先有此檔; 若無則 env var 用呼叫端
//export 提供, 或單一 case 自行檢查並 throw (詳 e2e-login.test.mjs:14 註解).
import 'dotenv/config'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import sharp from 'sharp'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { woItems } from '../g.mOrm.mjs'
import { buildBaseUsers, buildBaseTokens } from '../g.initialData.mjs'

//D21: 測試環境放行佔位符 pepper (測試密碼非機密; spawn 的 backend 繼承此 env → WWebSso 啟動檢查放行).
//生產環境不設此旗標 + 未注入 SALT → 後端拒啟. 種子(此檔 buildBaseUsers)與後端 verify 在測試下同用 '{salt}', 一致.
process.env.ALLOW_PLACEHOLDER_SALT = process.env.ALLOW_PLACEHOLDER_SALT || '1'

//
// e2e 共用 base URL
//
// 一律用 127.0.0.1 不用 localhost: webpack-dev-server (8080) 只綁 IPv4 (0.0.0.0),
// 瀏覽器解析 localhost 會先試 IPv6 ::1 → 連線失敗 → 回退 IPv4, 每次連線多 ~155ms
// (Happy-Eyeballs 回退延遲). 直接用 127.0.0.1 跳過 IPv6 解析, 每請求從 ~180ms 降到 ~15ms.
//
let baseUrl = 'http://127.0.0.1:8080'
let apiUrl = 'http://127.0.0.1:11007'

//
// e2e 測試自動啟動／關閉前後端 server
//
// 行為：
// - 第一次呼叫 startServersOnce()：對 11007 / 8080 各自檢查，
//   port 沒人 → spawn；port 已被佔用 → 重用（不 spawn 也不負責關）
// - 後續呼叫：只認 started 旗標，立即 return（多個 e2e 檔共用同一份 server）
// - 「只關自己 spawn 的」：cleanup 只殺 backendProc / frontendProc 兩個變數指向的 process，
//   完全沒 spawn 過 → cleanup 是 no-op
//
// 觸發 cleanup 的時機（防卡 mocha exit）：
// - mocha root after()：主動在 mocha teardown 階段觸發, 子進程死 → event loop 清空 → mocha exit
//   (不能只靠 process.on('exit', cleanup) — 它要等 event loop 清空才觸發, 但 spawn 的子進程
//    本身 hold 著 event loop, 形成死結)
// - SIGINT / SIGTERM：使用者 Ctrl+C 中斷時走這條
// - process.on('exit') 備援：mocha 沒有 after global (例: 走 --baseline 路徑直接 node 跑) 時
//

let backendProc = null
let frontendProc = null
let started = false


async function isPortUp(port) {
    try {
        let ctrl = new AbortController()
        let timer = setTimeout(() => ctrl.abort(), 1500)
        await fetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal })
        clearTimeout(timer)
        return true
    }
    catch (err) {
        return false
    }
}


async function waitForPort(port, timeoutMs) {
    let start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (await isPortUp(port)) {
            return
        }
        await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`server not ready on port ${port} after ${timeoutMs / 1000}s`)
}


function killProc(proc) {
    if (!proc || proc.killed) {
        return
    }
    if (process.platform === 'win32') {
        // Windows: 殺整個 process tree（npm.cmd → node → vue-cli-service 等子孫）
        try {
            execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' })
        }
        catch (err) {
            // already dead or pid invalid, ignore
        }
    }
    else {
        try {
            proc.kill('SIGKILL')
        }
        catch (err) {
            // ignore
        }
    }
}


async function startServersOnce() {
    if (started) {
        return
    }
    started = true

    // backend (port 11007)
    if (await isPortUp(11007)) {
        console.log('[e2e-setup] backend already running on 11007, reusing')
    }
    else {
        console.log('[e2e-setup] starting backend (port 11007)...')
        backendProc = spawn('node', ['srv.mjs'], { stdio: 'ignore' })
        await waitForPort(11007, 30000)
        console.log('[e2e-setup] backend ready')
    }

    // frontend (port 8080) — vue-cli-service serve 首次編譯約 15~30 秒
    if (await isPortUp(8080)) {
        console.log('[e2e-setup] frontend already running on 8080, reusing')
    }
    else {
        console.log('[e2e-setup] starting frontend (port 8080), first compile ~15-30s...')
        frontendProc = spawn('npm', ['run', 'serve'], { stdio: 'ignore', shell: true })
        await waitForPort(8080, 90000)
        console.log('[e2e-setup] frontend ready')
    }
}


//產生臨時 settings.json: 複製 ./settings.json, 套用 overrides, 寫到 ./tmp/ 回傳路徑.
//用於 e2e 需要不同設定啟動 backend 的情境 (如 allowUserRegistration=false 測「不允許註冊」).
//注意: 本專案 ./settings.json 為 JSON5 格式 (無引號鍵 / 單引號字串 / 註解 / 尾逗號),
//backend 用 JSON5 解析 (server/procSettings.mjs), 故此處讀檔須用 JSON5.parse 不可用 JSON.parse.
//寫出時用 JSON.stringify 產出純 JSON — JSON5 解析器吃純 JSON 沒問題, backend 啟動可正常讀取.
function genTempSettings(overrides = {}) {
    let base = JSON5.parse(fs.readFileSync('./settings.json', 'utf8'))
    let merged = { ...base, ...overrides }
    if (!fs.existsSync('./tmp')) fs.mkdirSync('./tmp', { recursive: true })
    let p = `./tmp/settings-e2e-${Date.now()}.json`
    fs.writeFileSync(p, JSON.stringify(merged, null, 2))
    return p
}


//以指定 settings 檔重啟 backend (殺掉現有 backendProc, 用 node srv.mjs <pathSettings> 重啟並等 ready).
//給「需要特殊 settings 的單一 describe」用: before() restartBackend(genTempSettings({...})), after() restartBackend('./settings.json') 還原.
//若 port 11007 已被佔用但 backendProc=null (代表「startServersOnce 階段偵測到外部已啟動的 backend 直接 reuse」場景),
//原本實作 killProc(null) noop → spawn 新 backend 撞 port silent fail → 舊 backend 仍跑舊 settings → E2E-017 之類「settings overide」測試失敗.
//修法: backendProc=null 時用 OS-level 查 port 11007 之 PID + taskkill, 殺乾淨後才 spawn 新.
//
//envOverride: 可選, 注入額外環境變數給新 backend 進程 (與 process.env 淺合併後傳 spawn).
//why 需要它而非僅靠 genTempSettings 改 settings 檔: backend 最終設定 = settings 檔 overlay g.getSettings()
//(srv.mjs 把 g.getSettings() 當 optExt 傳入, WWebSso 內 { ...settings檔, ...optExt } → optExt 後蓋勝),
//而 g.getSettings() 會把 .env 的 EM_SRC_* 等覆寫進 optExt → 真實 SMTP 憑證凌駕 settings 檔之上, 連
//genTempSettings({emSrcHost:...}) 都被蓋掉. 但 g.getSettings 的 loadEnv 是「process.env 已有該 key 就不從
//.env 載入」(g.getSettings.mjs:23) → 故在 spawn env 預先放 EM_SRC_HOST 等, 即可使 .env 失效、改用注入值.
//典型用途: E2E-021 以 EM_SRC_HOST=127.0.0.1 / EM_SRC_PORT=1 (connection-refused) 讓 srEmail.send 瞬間失敗.
async function restartBackend(pathSettings = './settings.json', envOverride = null) {
    if (backendProc) {
        killProc(backendProc)
    }
    else {
        //backendProc=null 但 port 11007 可能被外部 backend 佔用 (startServersOnce reuse 過); OS-level 查 PID 殺乾淨
        if (await isPortUp(11007)) {
            if (process.platform === 'win32') {
                try {
                    let netstat = execSync('netstat -ano | findstr ":11007"', { encoding: 'utf8' })
                    let lines = netstat.split(/\r?\n/).filter((l) => /LISTENING/.test(l))
                    let pids = new Set()
                    for (let line of lines) {
                        let m = line.match(/\s(\d+)\s*$/)
                        if (m) {
                            pids.add(m[1])
                        }
                    }
                    for (let pid of pids) {
                        try {
                            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
                        }
                        catch (err) { /* already dead */ }
                    }
                }
                catch (err) { /* netstat 失敗, fallback 不殺 (spawn 可能撞 port 但至少不 throw) */ }
            }
            else {
                try {
                    let out = execSync('lsof -ti:11007', { encoding: 'utf8' })
                    let pids = out.trim().split(/\s+/).filter(Boolean)
                    for (let pid of pids) {
                        try {
                            execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
                        }
                        catch (err) { /* already dead */ }
                    }
                }
                catch (err) { /* lsof 失敗, fallback */ }
            }
            //等舊 port 確實釋放, 避免新 spawn 立即被舊 socket 殘留干擾
            let waitStart = Date.now()
            while (Date.now() - waitStart < 5000) {
                if (!(await isPortUp(11007))) break
                await new Promise((r) => setTimeout(r, 200))
            }
        }
    }
    backendProc = null
    //env: 預設繼承 process.env; 有 envOverride 時淺合併 (override 後蓋), 使注入之 EM_SRC_* 等先於 .env 生效 (詳函式 doc)
    let spawnEnv = envOverride ? { ...process.env, ...envOverride } : process.env
    backendProc = spawn('node', ['srv.mjs', pathSettings], { stdio: 'ignore', env: spawnEnv })
    await waitForPort(11007, 30000)
}


// 進程結束時 cleanup（只殺自己 spawn 的）
function cleanup() {
    if (frontendProc) {
        killProc(frontendProc)
        frontendProc = null
    }
    if (backendProc) {
        killProc(backendProc)
        backendProc = null
    }
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
    cleanup()
    process.exit(130)
})
process.on('SIGTERM', () => {
    cleanup()
    process.exit(143)
})

//mocha root after() — 主動在所有 test 跑完後觸發 cleanup, 殺掉自己 spawn 的子進程,
//event loop 才能清空讓 mocha 順利 exit. 不註冊的話, process.on('exit', cleanup) 永遠等不到,
//因為子進程 (backend srv.mjs / frontend npm run serve) 本身 hold 住 event loop.
//走 --baseline 路徑時 (e2e-adduser 等) 不經 mocha, 此時 globalThis.after 未定義, 跳過.
if (typeof globalThis.after === 'function') {
    globalThis.after(function() {
        this.timeout(20000)
        cleanup()
    })
}


//pixel baseline 截圖統一 helper: retry 至連續兩張一致再回傳, 治 cold-start /
//CJK glyph lazy rasterization / GPU init / paint timing 等不可預測 pixel drift.
//策略與 Playwright 內建 expect(page).toHaveScreenshot() 一致 (反覆截圖直到 settled).
//
//initialWaitMs 預設 1500ms: 開頭等一段, 因為 retry-until-stable 治不了 setTimeout-based
//delayed-reveal (如 WDrawer 內 setTimeout 300ms 後才把拖曳分隔條 opacity 0→1).
//Playwright animations:'disabled' 不 fast-forward setTimeout, 所以 captureStable 若
//在 300ms 內 settle 會 catch 到「未 reveal」state, 跨 session 與「已 reveal」state
//byte-mismatch. 1500ms initial wait 涵蓋 300ms × 3-5 連鎖動畫 + 確保 backstage sidebar
//葉節點已 mount (供其後 drawer-ready 偵測判斷展開到位) → 確定性 catch reveal 後 final state.
//
//(詳: 全域 CLAUDE.md §6.3「截圖穩定性」+「setTimeout-based delayed reveal 的限制」)
//
//所有 baseline 端 (regen) 與比對端 (mocha) 都應用此 helper, 不要用裸 page.screenshot();
//兩邊用同款 helper 才能保證 cold/warm browser 都產生一致的「page settled」截圖.
//主動等 WDrawer drawer 整體「展開到位」(sidebar 導航項目 getBoundingClientRect x>=0) 之共用前置.
//凡「進後台 (backstage)」之頁面都用 LayoutContent.vue 之 WDrawer 渲染左側 sidebar, 故所有
//backstage 截圖前都須呼叫此 helper, 避免截到「sidebar 未展開」之 flake。
//
//根因 (w-screenctl 實測): backstage mount 後 navVisible (body innerText) 立即 ready, 但
//WDrawer drawer 初始滑在 viewport 左外 (sidebar 導航項目 x≈-185), @domresize/autoSwitch
//異步觸發後才滑入展開 (x>=0), 滯後 navDOM-ready ~150ms; 偶發 (CJK 字型光柵化 / 連跑資源
//累積 / CPU 忙) 超過上游 wait → 截到 sidebar 空白 (flake: adduser-007 / resetpassword-
//002/003/006 / modifyuser / stainfor-002 等 backstage 截圖, 後者 clip 區含 sidebar)。
//
//設計:
//- 呼叫端須先確保 backstage sidebar 葉節點已 mount (captureStable 之 initialWaitMs=1500 /
//  stainfor 之 waitStaInforReady/ErrMsg 已足); 此 helper 只負責「等 drawer 展開 x>=0」。
//- 無 WDrawer 頁 (login / register / user view) 無 sidebar 帶導航葉節點 → items 為空 → 立即放行不卡。
//- 偵測點用導航文字錨點 (eng + cht 全集) 而非 class (WDrawer 渲染後 DOM 無穩定 class)。
//  ★ NAV 須與 LayoutContent.vue menus computed (mmStaInfor/mmUserInfor/mmUsersList/mmTokensList/
//    mmIpsList) + server/procLang.mjs 對應 eng/cht 翻譯逐字同步; 未來新增/改名導航項須一併更新。
//- 用 x < SIDEBAR_X_MAX 過濾「只看 viewport 左側 sidebar 帶」, 排除 content 區置中標題干擾:
//  PageUser (user view) 以 $t('mmUserInfor') 置中當頁標題 (x≈viewport 中央); backstage content
//  頁標題 x>=260; sidebar 導航項目 x: 展開 ~24-45 / flake 滑左外 ~-185, 皆 < 250。
//- 失敗 (timeout) 不阻塞: .catch 吞掉, 交由呼叫端後續 retry-until-stable 兜底。
//等 WDrawer 抽屜到達「穩定態」(opened/hidden) 才放行 — 讀 WDrawer 元件 export 的 state 屬性
//(w-component-vue WDrawer.vue 根節點 :state, 由 drawer 平移 transitionend 決定性標記:
// hidden / opening / opened / hiding). state='opened' = translateX 動畫真的跑完、定位到最終位置.
//
//why 改用 state 而非舊作法 (poll nav x 是否穩定): poll x 在高負載下 (全套長跑尾段 CPU 忙 /
//setTimeout 階段被 throttle) 會被「減速尾段 / 階段間中間 hold」騙 — 連續兩次讀到相同 x 卻其實
//還沒到終點 → 誤判停止而截到 mid-slide (殷鑑: rp-002/004 等 backstage 截圖之 ~6000px / 8px drawer
//位移 flake, 獨立跑負載低恰好 settle 而矇對, 全套尾段才暴露). transitionend 為事件驅動 (compositor
//完成 transition 才觸發), 不受主執行緒負載影響, 故 state='opened' 是可靠的「真正到位」訊號.
//
//非 backstage 頁 (login / register / user view) 無 WDrawer → 無 drawer state 元素 → 立即放行.
async function waitDrawerReady(page) {
    await page.waitForFunction(() => {
        let drawerStates = Array.from(document.querySelectorAll('[state]'))
            .map((e) => e.getAttribute('state'))
            .filter((s) => ['hidden', 'opening', 'opened', 'hiding'].includes(s))
        if (drawerStates.length === 0) {
            return true //無 WDrawer (非 backstage 頁), 放行
        }
        //所有 drawer 須為穩定態 (opened 或 hidden), 不可停在 opening / hiding 過渡中
        return drawerStates.every((s) => s === 'opened' || s === 'hidden')
    }, null, { timeout: 10000, polling: 100 }).catch(() => {})
}


async function captureStable(page, opts = {}) {
    let { maxRetries = 8, intervalMs = 200, initialWaitMs = 1500 } = opts
    //animations: 'disabled' 是 baseline 的標配 (finite 動畫跳完, infinite 動畫 reset),
    //與 Playwright toHaveScreenshot 預設一致
    let shotOpts = { fullPage: true, animations: 'disabled' }

    //park mouse 到 (0,0) — 點擊後 mouse 留在被點元素位置, 若該位置在某 hover-active UI 區
    //(button hover / tooltip / cell hover / drawer 邊緣 hover), 不同次跑 hover state 命中
    //與否不同 → 截圖 byte 不穩. 強制移到 viewport 左上角消除所有 hover state.
    //(詳 §6.3「點擊後 capture 前必 park mouse 到 (0,0)」)
    await page.mouse.move(0, 0)

    //initialWaitMs: 開頭等一段, 確保 setTimeout-based 的 delayed-show effects 已 fire +
    //hover-leave 動畫 + chain animation 都 settle. 1500ms 涵蓋 300ms × 3-5 連鎖動畫.
    //殷鑑: WDrawer (w-component-vue) 內有 300ms timer 控制拖曳分隔條 overlay 是否顯示
    //(showOverlay5DragDrawerBar). 300ms 前後 overlay opacity 從 0→1, 視覺上幾乎一樣但
    //pixel 差 ~7-8 px (sidebar 右緣). Playwright animations:'disabled' 不 fast-forward
    //setTimeout, captureStable 若在 300ms 內 settle 會 catch 到「無 overlay」狀態,
    //跨 session 與「有 overlay」狀態 byte-mismatch.
    await page.waitForTimeout(initialWaitMs)

    //主動等 WDrawer 拖曳分隔條 overlay (showOverlay5DragDrawerBar) 變 opacity=1.
    //該 overlay 的 inline style 含 cursor:col-resize, opacity 由 setTimeout(300ms) 控
    //制 0→1. CPU 忙 / tab unfocused 時 setTimeout 可能被 throttle 到超過 500ms initialWait,
    //故 polling 直到 opacity 變 1 才繼續. 失敗也不阻塞 (有些頁面沒有 WDrawer).
    await page.evaluate(async () => {
        let deadline = Date.now() + 5000
        while (Date.now() < deadline) {
            let bars = Array.from(document.querySelectorAll('[style*="cursor:col-resize"], [style*="cursor: col-resize"]'))
            if (bars.length === 0) return //無 WDrawer, 直接過
            let allReady = bars.every(b => parseFloat(getComputedStyle(b).opacity) === 1)
            if (allReady) return
            await new Promise(r => setTimeout(r, 50))
        }
    })

    //主動等 WDrawer drawer 整體「展開到位」(共用 helper, 詳 waitDrawerReady 定義處註解).
    //凡「進後台 (backstage)」之截圖都會遇 WDrawer sidebar, 都須先 waitDrawerReady 才截圖 —
    //captureStable 內建涵蓋所有經 captureStable 之 backstage 截圖; 另有 stainfor captureCardsOnly
    //(裸 clip screenshot 繞過 captureStable) 亦各自呼叫 waitDrawerReady 補上 (見該處).
    await waitDrawerReady(page)

    //hover tooltip 穩定化策略 (w-component-vue WButtonCircle/WButtonChip 之 :tooltip, 如 saveChanges
    //雲端儲存 / userAdd / userCopy / delete / showTabCols 等): WTooltip 為 hover 驅動 (mouseenter 顯示
    /// mouseleave 隱藏), teleport 到 body 為 <div class="WPopperFix">. 點擊按鈕時 mouse 停在按鈕上 →
    //tooltip 顯示. 上方 mouse.move(0,0) 提供「滑鼠移出」事件讓 tooltip 消失 (淡出 transitionTime 200ms,
    //由 initialWaitMs 涵蓋), 此即穩定化關鍵.
    //【可接受例外】若按鈕點擊後「立即彈出 dialog」(WDialog 全屏背景遮蔽層), 遮蔽層會擋住按鈕收到滑鼠
    //移動訊息 → 該 tooltip 不會因 mouse.move(0,0) 消失, 截圖會含 tooltip. 此為「一致地存在」(baseline
    //與測試端皆然 → 穩定), 視為可接受狀況, 不另強制移除 (強制等它消失反而會空等到逾時且徒勞).

    //凍結 inline <svg> 的 SMIL animation: pauseAnimations() + setCurrentTime(0) 凍在 t=0
    //(Playwright animations:'disabled' 只凍 CSS, 不影響 SVG SMIL <animate> 標籤)
    await page.evaluate(() => {
        document.querySelectorAll('svg').forEach((svg) => {
            if (typeof svg.pauseAnimations === 'function') {
                svg.pauseAnimations()
                if (typeof svg.setCurrentTime === 'function') {
                    svg.setCurrentTime(0)
                }
            }
        })
    })

    //等 web fonts (含 @mdi/font CDN) 載入完成 — 否則 mdi 圖標可能尚未 ready, 截圖時 span.mdi
    //文字佔位但 glyph 未渲染 → baseline 缺 icon. 對全新 chromium context (例: autoblock 部分
    //case 重建 browser 帶 X-Forwarded-For) 尤為關鍵, 無 font cache 須等 CDN 載入.
    await page.evaluate(() => {
        return document.fonts && typeof document.fonts.ready?.then === 'function' ? document.fonts.ready : Promise.resolve()
    })

    //找出 <img src="data:image/svg+xml;...含 <animate>"> 的 bounding rect — 該類 SVG 在 <img>
    //內由 browser image pipeline 渲染, 不暴露為 DOM, pauseAnimations 觸達不了. 改用「截圖後
    //對該區域填黑」的後製方式: baseline 與 verify 兩端都在相同 bbox 填相同黑色, 動畫 frame 無關.
    //(用黑色而非白色: 黑色區塊明顯, 一眼看出是「刻意遮蔽動態內容」而非「該處無內容」)
    //殷鑑: LayoutState.vue img_connection (連線中 ripple spinner, 1.26s infinite SMIL),
    //使 autoblock ip-block-trigger / ip-blocked-rejected baseline 跨 session 永遠不同.
    //放在 fonts.ready 之後執行, 此時 layout 已穩定, bbox 不會再變.
    let animatedRects = await page.evaluate(() => {
        let rects = []
        document.querySelectorAll('img').forEach((img) => {
            let src = img.src || ''
            if (!src.startsWith('data:image/svg+xml')) return
            let decoded = ''
            try {
                if (src.startsWith('data:image/svg+xml;base64,')) {
                    decoded = atob(src.slice('data:image/svg+xml;base64,'.length))
                }
                else {
                    decoded = decodeURIComponent(src)
                }
            }
            catch (err) {
                decoded = ''
            }
            if (/<animate/i.test(decoded)) {
                let r = img.getBoundingClientRect()
                rects.push({ x: r.left, y: r.top, w: r.width, h: r.height })
            }
        })
        return rects
    })

    let prev = await page.screenshot(shotOpts)
    if (animatedRects.length > 0) prev = await maskRegions(prev, animatedRects)
    for (let i = 0; i < maxRetries; i++) {
        await page.waitForTimeout(intervalMs)
        let curr = await page.screenshot(shotOpts)
        if (animatedRects.length > 0) curr = await maskRegions(curr, animatedRects)
        if (curr.equals(prev)) {
            return curr
        }
        prev = curr
    }
    //未 settle 也回傳最後一張, 後續 baseline 之 pixelmatch 容差比對失敗會揭露真實 flake (而非偽裝穩定)
    return prev
}


//整張全頁截圖 + 在「此 e2e 要比對的區塊」外圍畫紅框 (#f26、5px) 標注, 讓報表/審查委員一眼看出本
//case 驗的是哪一區. 截圖仍為完整畫面、保留 UI 脈絡, 不裁切成小片. (對齊技能[role-code-for-test-e2e]
//「標注要求」: 顏色 #f26、線寬 5px; 移植自 w-web-api 之 captureStableWithBox.)
//
//target: CSS selector 字串 / 字串陣列 / Playwright Locator / 以上混合陣列 (多個取聯集框成一個框).
//  ——欄位列須依 label 文字定位時用 Locator (如 page.locator('.ag-row').filter({hasText:'帳號'})).
//fold 以下的目標會先把第一個 scrollIntoView 捲進視窗再框 (同組目標應在同一捲動位置).
//opts.mask: 要遮黑的非決定性區域陣列 (selector 字串, 或 { sel, fixedWidth } 錨右緣固定寬度往左延伸).
//
//紅框由 DOM 注入 (<div id="__e2e_box__">), 故 baseline 產製端與比對端只要傳相同 target 即得相同框,
//截完移除不殘留. 內部仍走 captureStable (沿用 WDrawer 展開等待 / SVG 凍結 / 字型就緒等所有穩定化處理).
async function captureStableWithBox(page, target, opts = {}) {
    let { mask = [] } = opts
    let items = Array.isArray(target) ? target : [target]
    let isLoc = (x) => x && typeof x === 'object' && typeof x.boundingBox === 'function'
    //先把第一個目標捲進視窗 (同組目標應在同一捲動位置)
    let firstLoc = isLoc(items[0]) ? items[0].first() : page.locator(items[0]).first()
    await firstLoc.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(300)
    await page.mouse.move(0, 0)
    //取每個目標的 viewport rect (Locator → boundingBox; CSS 字串 → querySelector)
    let rects = []
    for (let it of items) {
        if (isLoc(it)) {
            let bb = await it.first().boundingBox()
            if (bb) {
                rects.push(bb)
            }
        }
        else {
            let r = await page.evaluate((s) => {
                let e = document.querySelector(s)
                if (!e) {
                    return null
                }
                let rc = e.getBoundingClientRect()
                return { x: rc.left, y: rc.top, width: rc.width, height: rc.height }
            }, it)
            if (r) {
                rects.push(r)
            }
        }
    }
    //畫紅框 (多個取聯集; 四邊夾在視窗內避免貼邊元素框線跑出畫面而少邊) + 遮黑非決定性區域
    await page.evaluate((arg) => {
        let rs = arg.rs
        let ms = arg.ms
        let M = 3
        let vw = window.innerWidth
        let vh = window.innerHeight
        if (rs.length > 0) {
            let left = Math.min(...rs.map((r) => r.x))
            let top = Math.min(...rs.map((r) => r.y))
            let right = Math.max(...rs.map((r) => r.x + r.width))
            let bottom = Math.max(...rs.map((r) => r.y + r.height))
            let bl = Math.max(M, left - 6)
            let bt = Math.max(M, top - 6)
            let br = Math.min(vw - M, right + 6)
            let bb = Math.min(vh - M, bottom + 6)
            let box = document.createElement('div')
            box.id = '__e2e_box__'
            box.style.cssText = `position:fixed; left:${bl}px; top:${bt}px; width:${br - bl}px; height:${bb - bt}px; border:5px solid #f26; box-sizing:border-box; z-index:2147483647; pointer-events:none; border-radius:4px;`
            document.body.appendChild(box)
        }
        ms.forEach((s) => {
            let sel = (typeof s === 'string') ? s : s.sel
            let e = document.querySelector(sel)
            if (!e) {
                return
            }
            let r = e.getBoundingClientRect()
            let left = r.left
            let width = r.width
            if (typeof s === 'object' && s.fixedWidth) {
                width = s.fixedWidth
                left = (r.left + r.width) - width
            }
            let m = document.createElement('div')
            m.className = '__e2e_mask__'
            m.style.cssText = `position:fixed; left:${left}px; top:${r.top}px; width:${width}px; height:${r.height}px; background:#000; z-index:2147483646; pointer-events:none;`
            document.body.appendChild(m)
        })
    }, { rs: rects, ms: mask })
    await page.waitForTimeout(150)
    let buf = await captureStable(page)
    await page.evaluate(() => {
        let b = document.getElementById('__e2e_box__')
        if (b) {
            b.remove()
        }
        document.querySelectorAll('.__e2e_mask__').forEach((m) => m.remove())
    })
    return buf
}


//對截圖 buffer 的指定 viewport 矩形區域填色 (用 sharp composite, 不需 PNG decode/encode 細節).
//用途: 動態內容 (SVG SMIL 動畫 img / 即時圖表 / 即時數值) 無法在 DOM 層凍結, 改在 PNG 後製把
//那塊區域填純色 → 跨 session pixel 完全一致, baseline 比對穩定.
//預設黑色 (而非白色): 黑色區塊明顯, 一眼看出是「刻意遮蔽動態內容」, 不會被誤解為「該處無內容」.
async function maskRegions(buf, rects, color = { r: 0, g: 0, b: 0 }) {
    //讀 image 邊界, clamp rect 避免 sharp composite "Image to composite must have same dimensions
    //or smaller" 錯誤 (rect 部分區域超出 image 時須裁切)
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let composite = rects
        .filter((r) => r.w > 0 && r.h > 0)
        .map((r) => {
            let left = Math.max(0, Math.round(r.x))
            let top = Math.max(0, Math.round(r.y))
            //clamp width/height 至 image 邊界內
            let width = Math.min(Math.round(r.w), imgW - left)
            let height = Math.min(Math.round(r.h), imgH - top)
            return { left, top, width, height }
        })
        .filter((c) => c.width > 0 && c.height > 0 && c.left < imgW && c.top < imgH)
        .map((c) => ({
            input: {
                create: {
                    width: c.width,
                    height: c.height,
                    channels: 3,
                    background: color,
                },
            },
            left: c.left,
            top: c.top,
        }))
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}


//把截圖 buffer 的指定矩形區域, 用「參考圖 refBuf 同座標的內容」覆蓋上去 (取代 maskRegions 填黑).
//用途: 動態圖表 (echarts canvas) 之 GPU warm/cold 跨進程渲染無法 pixel 穩定, 但又不想用突兀黑塊 →
//改貼一張「預存的真實圖表快照」; baseline 與 runtime 兩端都貼同一張 refBuf → 該區永遠一致 (e2e 穩定),
//視覺上呈現真實圖表而非黑塊. refBuf 須與 buf 同尺寸 (相同版面/截圖方式), 才能同座標 extract+composite 對齊.
async function overlayRegions(buf, rects, refBuf) {
    let meta = await sharp(buf).metadata()
    let imgW = meta.width
    let imgH = meta.height
    let refMeta = await sharp(refBuf).metadata()
    let composite = []
    for (let r of rects.filter((r) => r.w > 0 && r.h > 0)) {
        let left = Math.max(0, Math.round(r.x))
        let top = Math.max(0, Math.round(r.y))
        //clamp 至 buf 與 ref 兩者邊界內
        let width = Math.min(Math.round(r.w), imgW - left, refMeta.width - left)
        let height = Math.min(Math.round(r.h), imgH - top, refMeta.height - top)
        if (width <= 0 || height <= 0) continue
        let crop = await sharp(refBuf).extract({ left, top, width, height }).png().toBuffer()
        composite.push({ input: crop, left, top })
    }
    if (composite.length === 0) return buf
    return await sharp(buf).composite(composite).png().toBuffer()
}


//把截圖 buffer 從 y 座標 (含) 以下整個寬度填黑. 供「遮住某段落以下的動態內容」用.
//y 為相對截圖 (fullPage) 頂端的像素值. 自動讀 buffer 實際尺寸, 不需 caller 提供 w/h.
async function maskBelowY(buf, y) {
    let meta = await sharp(buf).metadata()
    let top = Math.max(0, Math.round(y))
    let h = meta.height - top
    if (h <= 0) return buf
    return await maskRegions(buf, [{ x: 0, y: top, w: meta.width, h }])
}


//e2e 資料庫起始狀態重置: 清空 users / tokens / ips 三張表, 再插入「基本測試數據」(g.initialData
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


//真實 user 輸入 helper (Pattern D, 對齊全域 CLAUDE.md §6.3「Vue v-model 文字輸入 race」).
//
//click → 驗證 activeElement === 該 locator (防 focus 被父元素 @mousedown.prevent 攔截) → Backspace 清空
//→ keyboard.insertText 整段 → 驗證 inputValue → 不符則 retry 最多 3 次.
//
//用 insertText (非 keyboard.type): type 逐字打在 Vue v-model 場景觸發 N 次 input event → N 次 re-render
//→ focus 中途被吃掉導致漏字 (殷鑑: 11 字密碼只進 1 字). insertText 一次 inject 全段 (1 個 input event).
//本專案 WText / WTextCore 沒 hook keydown listener, 所以 insertText 跟 type 行為等價.
//
//用 Backspace N 次 (非 Ctrl+A / Ctrl+X / 剪貼簿): 避免跟 OS 全域 shortcut / 其他平行 agent 測試衝突.
//
//此 helper 為 5 個 e2e 檔 (login / register / changepassword / resetpassword / deleteuser) 共用,
//避免每檔 ad-hoc typeIntoInput 各自漂移. 對 Vue v-model input 必用此函式, 不准用 keyboard.type.
async function typeIntoInput(page, locator, value) {
    await locator.waitFor({ state: 'visible', timeout: 5000 })
    //editor mount / focus transfer / Vue model binding settle buffer (對 ag-grid cellEditor 之 transient state 有效)
    await page.waitForTimeout(1000)

    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await locator.click()
        //驗證 focus 真落在 input (被父元素 @mousedown.prevent 攔截的話這裡就抓到, 不會變成靜默漏字)
        let handle = await locator.elementHandle()
        await page.waitForFunction((el) => document.activeElement === el, handle, { timeout: 3000 })
        //清空既有值 (Backspace N 次)
        let cur = await locator.inputValue()
        if (cur) {
            await page.keyboard.press('End')
            for (let k = 0; k < cur.length + 2; k++) await page.keyboard.press('Backspace')
        }
        //一次性 inject
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        //驗證
        let got = await locator.inputValue()
        if (got === value) return
        console.warn(`typeIntoInput attempt ${attempt}/${maxAttempts}: 預期「${value}」實得「${got}」, 重試`)
        await page.waitForTimeout(400)
    }
    let final = await locator.inputValue()
    throw new Error(`typeIntoInput ${maxAttempts} 次仍漏字: 預期「${value}」(${value.length} 字), 最終「${final}」(${(final || '').length} 字)`)
}


//baseline 比對 + fail 時保留證據到 ./testPending (不覆蓋), 供事後 pixel diff 定位 flake/破壞.
//
//比對採 pixelmatch (反鋸齒感知) + maxDiffPixels 容差, 取代舊的 buf.equals (byte-exact):
//- pixelmatch includeAA:false (預設) 會自動偵測並「忽略反鋸齒邊緣像素」(YIQ 感知色差 + AA slope 偵測),
//  專治 SVG icon / 字型邊緣之次像素 raster 差異 (跨 browser session 不決定性), 不再因此 flake.
//- maxDiffPixels: 允許之最大「真不同」像素數 (預設 100). 反鋸齒殘留遠低於此 (個位數~數十); 真 regression
//  (icon 換 / 版面位移 / 顏色變) 動輒數百~數千 px 遠超此 → 仍被抓到. 業界標準, 同 Playwright toHaveScreenshot.
//- 尺寸不同 = 必為真差異 (版面/裁切變) → 直接 fail.
//- pixel baseline 為補強層, 每 case 仍須語意斷言為主 (全域規範 §6.2): 容差只放輔助層, 主驗證仍嚴.
//
//pass: 靜默通過. fail: 將「當次 capture」「baseline」「diff 標紅圖」存檔 (帶 timestamp 不覆蓋) 後 throw.
//  (./testPending 帶 timestamp 保留, 任何 fail 當次證據都留存可 diff; 已 gitignore, 不進 repo.)
//label: 給檔名用之可讀標籤 (如 'adduser-cht-E2E-003-account-duplicate'); 省略則用 baseline 檔名.
//opts.maxDiffPixels / opts.threshold: 可由呼叫端覆寫 (預設 100 / 0.1), 供個別 case 需更嚴/更鬆時用.
function assertBaselineMatch(buf, baselinePath, label, opts = {}) {
    let { maxDiffPixels = 100, threshold = 0.1 } = opts

    if (!fs.existsSync(baselinePath)) {
        throw new Error(`標準圖不存在: ${baselinePath} (請先執行對應 e2e --baseline 產製)`)
    }
    let baselineBuf = fs.readFileSync(baselinePath)

    //解碼 PNG → RGBA (pngjs 同步; 保持本函式同步, 不需動所有 caller 加 await)
    let capPng = PNG.sync.read(buf)
    let basePng = PNG.sync.read(baselineBuf)

    //fail: 保留 capture + baseline (+ diff 標紅圖) 到 ./testPending (不覆蓋, 帶 timestamp) 後 throw
    let dump = (reason, diffPng) => {
        let dir = './testPending'
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        let safe = (label || path.basename(baselinePath, '.png')).replace(/[^\w.-]/g, '_')
        //ms 精度 timestamp; 同 label 同毫秒撞檔機率近 0, 仍加 -N 後綴保證絕不覆蓋
        let ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
        let stem = `${dir}/${safe}__${ts}`
        let n = 0
        while (fs.existsSync(`${stem}__capture.png`) || fs.existsSync(`${stem}__baseline.png`)) {
            n += 1
            stem = `${dir}/${safe}__${ts}-${n}`
        }
        fs.writeFileSync(`${stem}__capture.png`, buf)
        fs.writeFileSync(`${stem}__baseline.png`, baselineBuf)
        if (diffPng) {
            fs.writeFileSync(`${stem}__diff.png`, PNG.sync.write(diffPng))
        }
        throw new Error(`截圖與標準圖不一致 (${reason}): ${safe} — capture/baseline${diffPng ? '/diff' : ''} 已存 ${stem}__*.png 供 diff`)
    }

    //尺寸不同 = 必為真差異 (版面/裁切變); pixelmatch 要求同尺寸, 故直接 fail
    if (capPng.width !== basePng.width || capPng.height !== basePng.height) {
        dump(`尺寸不同 cap=${capPng.width}x${capPng.height} base=${basePng.width}x${basePng.height}`)
    }

    //pixelmatch: 反鋸齒感知比對, 回傳「真不同」像素數 (反鋸齒邊緣已被忽略)
    let { width, height } = basePng
    let diffPng = new PNG({ width, height })
    let numDiff = pixelmatch(capPng.data, basePng.data, diffPng.data, width, height, { threshold, includeAA: false })
    if (numDiff <= maxDiffPixels) {
        return //通過: 反鋸齒次像素已忽略, 殘留真差異在容差內
    }
    dump(`diff=${numDiff}px > maxDiffPixels=${maxDiffPixels}`, diffPng)
}


export { startServersOnce, cleanup, captureStable, captureStableWithBox, waitDrawerReady, assertBaselineMatch, baseUrl, apiUrl, maskRegions, overlayRegions, maskBelowY, resetToBaseSeed, deleteNonBaseSeed, genTempSettings, restartBackend, typeIntoInput }
