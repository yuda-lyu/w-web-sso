import { spawn, execSync } from 'child_process'
import fs from 'fs'
import JSON5 from 'json5'
import sharp from 'sharp'
import { woItems } from '../g.mOrm.mjs'
import { buildBaseUsers, buildBaseTokens } from '../g.initialData.mjs'

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
async function restartBackend(pathSettings = './settings.json') {
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
    backendProc = spawn('node', ['srv.mjs', pathSettings], { stdio: 'ignore' })
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
//initialWaitMs 預設 500ms: 開頭等一段, 因為 retry-until-stable 治不了 setTimeout-based
//delayed-reveal (如 WDrawer 內 setTimeout 300ms 後才把拖曳分隔條 opacity 0→1).
//Playwright animations:'disabled' 不 fast-forward setTimeout, 所以 captureStable 若
//在 300ms 內 settle 會 catch 到「未 reveal」state, 跨 session 與「已 reveal」state
//byte-mismatch. 500ms initial wait 過了大部分 component lib 的 ~300ms 線 → 確定性
//永遠 catch 到 reveal 後的 final state.
//
//(詳: 全域 CLAUDE.md §6.3「截圖穩定性」+「setTimeout-based delayed reveal 的限制」)
//
//所有 baseline 端 (regen) 與比對端 (mocha) 都應用此 helper, 不要用裸 page.screenshot();
//兩邊用同款 helper 才能保證 cold/warm browser 都產生一致的「page settled」截圖.
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
            if (bars.length === 0) return  //無 WDrawer, 直接過
            let allReady = bars.every(b => parseFloat(getComputedStyle(b).opacity) === 1)
            if (allReady) return
            await new Promise(r => setTimeout(r, 50))
        }
    })

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
    //未 settle 也回傳最後一張, 後續 byte-equal 比對失敗會揭露真實 flake (而非偽裝穩定)
    return prev
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


export { startServersOnce, cleanup, captureStable, baseUrl, apiUrl, maskRegions, maskBelowY, resetToBaseSeed, deleteNonBaseSeed, genTempSettings, restartBackend }
