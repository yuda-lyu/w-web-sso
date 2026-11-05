//測試畫面含實際埠之比對端覆蓋(規則帳本 R-E2E-PORT-01 規則 7; 規格 E7; 排程第 309 項 ws309)
//
//受測: test/tools/e2ePortOverlay.mjs(findPortRegions 頁內掃描、overlayPortRegions 以標準圖同座標內容覆蓋)、test/tools/e2e-setup.mjs(captureStable／captureStableWithBox 於位移時登記含埠區域、
//      portCompareBuf 於位移時覆蓋、未位移為 null、clip／視窗截圖含埠時拋錯)。
//契約:
//  1. findPortRegions 只回「含實際埠(:<埠> 且其後非數字)之可見輸入框與可見文字行」: 不含種子資料(基準埠 8080 之 redir)、不含埠為更長數字之字串、不含不可見(display:none、捲動容器裁掉)者。
//  2. 文字行之矩形自 block 祖先左緣涵蓋到右緣(埠後之文字寬度隨位數浮動, 須涵蓋到行尾)。
//  3. 覆蓋後之當次截圖與「同版面但埠不同之標準圖」逐像素(RGBA)全等; 不覆蓋時兩者確實不同(測試有鑑別力); 覆蓋區之外仍逐像素比對。
//  4. 沒有矩形或沒有埠時原樣回傳(零行為差異, 對應「沒有占用時比對不變」)。
//  5. 經 e2e-setup 之包裝(captureStableWithBox → portCompareBuf): 位移實例之截圖覆蓋後與基準埠實例之標準圖逐像素全等; 未位移 portCompareBuf 為 null; 含埠而為 clip 截圖時拋錯(不靜默覆蓋到錯位置)。
//真實瀏覽器(chromium headless, 固定版面之 DOM fixture, 不起任何伺服器、不占埠)。
//跑法: node C:/opensrcOper/tools/quiet-run.mjs --name e2ePortOverlay --lock -- npx mocha test/unit-e2ePortOverlay.test.mjs --timeout 120000
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import sharp from 'sharp'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { launchBrowser } from './tools/e2eLib.mjs'
import { findPortRegions, overlayPortRegions } from './tools/e2ePortOverlay.mjs'

const A = assert.strict
const fdTest = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.join(fdTest, '..')
const fdTmp = path.join(fdTest, '_tmp', 'e2ePortOverlay') //測試中介資料(測完即刪)
const SETUP_URL = pathToFileURL(path.join(fdTest, 'tools', 'e2e-setup.mjs')).href

//固定版面之 fixture(模擬使用者資訊頁之 redir 輸入框與使用者清單之 Redirect 儲存格): 等寬字型使不同埠之寬度相同, 差異只在數字字形;
//含應被覆蓋者(input、清單儲存格之 redir 行)與不應被覆蓋者(種子資料之基準埠 8080、更長數字〔固定字串, 兩次渲染相同, 其值本身不被覆蓋〕、被裁掉、display:none)
let html = (port) => `<!doctype html><html><body style="margin:0;font:14px monospace;background:#fff">
<div style="padding:20px"><input id="addr" style="width:420px;height:28px" value="http://127.0.0.1:${port}/?view=user&token={token}"></div>
<div id="cell" style="margin:0 20px;width:520px;background:#eef;padding:2px">http://127.0.0.1:${port}/?view=backstage&token={token}</div>
<div style="padding:20px"><input id="seed" style="width:420px;height:28px" value="http://localhost:8080/?view=user&token={token}"></div>
<div id="clipBox" style="margin:0 20px;height:40px;width:300px;overflow:hidden"><div style="height:120px"></div><input id="clipped" value="http://127.0.0.1:${port}/clipped"></div>
<input id="hid" style="display:none" value="http://127.0.0.1:${port}/hidden">
<div id="long" style="padding:20px">http://127.0.0.1:818000/not-the-port 30611000 30511000</div>
</body></html>`

describe('unit-e2ePortOverlay (畫面含實際埠之比對端覆蓋, R-E2E-PORT-01 規則 7)', function() {
    this.timeout(120000)

    let browser = null
    let shot = async (port) => {
        let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        try {
            await page.setContent(html(port))
            let regions = await findPortRegions(page, [port])
            let buf = await page.screenshot({ fullPage: true })
            return { regions, buf }
        }
        finally {
            await page.close()
        }
    }
    //統一轉成 RGBA 再比(覆蓋輸出為含 alpha 通道之 PNG, 瀏覽器截圖為 RGB; 比較像素值不比通道數)
    let raw = async (buf) => await sharp(buf).ensureAlpha().raw().toBuffer()

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        browser = await launchBrowser()
    })

    after(async function() {
        if (browser) {
            await browser.close()
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('OV-001 只回含實際埠之可見輸入框與文字行: 不含種子資料(基準埠 8080)、更長數字、被裁掉、display:none', async function() {
        let { regions } = await shot(8180)
        let kinds = regions.map((r) => r.kind).sort()
        A.deepEqual(kinds, ['input', 'text'], `應只有 redir 輸入框與儲存格文字行各一, 實得 ${JSON.stringify(regions.map((r) => ({ kind: r.kind, text: r.text })))}`)
        let inp = regions.find((r) => r.kind === 'input')
        A.equal(inp.text, 'http://127.0.0.1:8180/?view=user&token={token}')
        A.ok(inp.w > 300 && inp.h > 15, `輸入框矩形應為其實際尺寸(約 420×28), 實得 ${inp.w}×${inp.h}`)
        let txt = regions.find((r) => r.kind === 'text')
        A.ok(txt.text.includes('127.0.0.1:8180/?view=backstage'), `文字行應為含實際埠之儲存格文字節點, 實得「${txt.text}」`)
    })

    it('OV-002 以種子資料之基準埠(8080)當「實際埠」時只命中種子輸入框(證明比對的是傳入之埠, 不是寫死)', async function() {
        let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        try {
            await page.setContent(html(8180))
            let regions = await findPortRegions(page, [8080])
            A.deepEqual(regions.map((r) => r.text), ['http://localhost:8080/?view=user&token={token}'])
            A.deepEqual(await findPortRegions(page, []), [], 'ports 為空陣列回 []')
            A.deepEqual(await findPortRegions(page, [8181]), [], '無人使用之埠回 []')
        }
        finally {
            await page.close()
        }
    })

    it('OV-003 文字行矩形自 block 祖先左緣涵蓋到右緣(埠後文字寬度隨位數浮動, 須涵蓋到行尾)', async function() {
        let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        try {
            await page.setContent(html(8180))
            let regions = await findPortRegions(page, [8180])
            let txt = regions.find((r) => r.kind === 'text')
            let cell = await page.evaluate(() => {
                let r = document.getElementById('cell').getBoundingClientRect()
                return { left: r.left, right: r.right }
            })
            A.ok(Math.abs(txt.x - cell.left) <= 1, `起點應為儲存格左緣 ${cell.left}, 實得 ${txt.x}`)
            A.ok(Math.abs(txt.x + txt.w - cell.right) <= 1, `終點應為儲存格右緣 ${cell.right}, 實得 ${txt.x + txt.w}`)
        }
        finally {
            await page.close()
        }
    })

    it('OV-004 覆蓋後之當次截圖與「同版面但埠不同之標準圖」逐像素全等; 不覆蓋時確實不同', async function() {
        let cur = await shot(8180) //位移後之當次截圖
        let base = await shot(8080) //基準埠之標準圖(同版面)
        let fpBase = path.join(fdTmp, 'baseline.png')
        fs.writeFileSync(fpBase, base.buf)
        A.ok(!(await raw(cur.buf)).equals(await raw(base.buf)), '前提: 不覆蓋時兩張因埠數字不同而不全等(否則本測試無鑑別力)')
        let out = await overlayPortRegions(cur.buf, fpBase, cur.regions)
        A.ok((await raw(out)).equals(await raw(base.buf)), '覆蓋後應與標準圖逐像素全等(RGBA)')
    })

    it('OV-005 沒有矩形時原樣回傳同一個 Buffer(沒有占用之情形零行為差異)', async function() {
        let cur = await shot(8180)
        let fpBase = path.join(fdTmp, 'baseline2.png')
        fs.writeFileSync(fpBase, cur.buf)
        A.equal(await overlayPortRegions(cur.buf, fpBase, []), cur.buf)
        A.equal(await overlayPortRegions(cur.buf, fpBase, null), cur.buf)
        A.equal(await overlayPortRegions(cur.buf, fpBase, undefined), cur.buf)
    })

    it('OV-006 覆蓋區之外仍逐像素比對: 覆蓋區外之差異不會被遮蔽', async function() {
        let cur = await shot(8180)
        let base = await shot(8080)
        //在覆蓋區外(畫面最下方之空白區)塗一塊紅色, 模擬覆蓋區外之真差異
        let tampered = await sharp(cur.buf).composite([{ input: await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 560, top: 440 }]).png().toBuffer()
        let fpBase = path.join(fdTmp, 'baseline3.png')
        fs.writeFileSync(fpBase, base.buf)
        let out = await overlayPortRegions(tampered, fpBase, cur.regions)
        A.ok(!(await raw(out)).equals(await raw(base.buf)), '覆蓋區外之差異須仍存在(覆蓋不得吞掉整張圖)')
    })

    it('OV-007 同一文字節點出現兩次埠皆取得; 父元素為行內元素(如 v-html 高亮之 span)時行尾基準取 block 祖先', async function() {
        let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        try {
            await page.setContent('<!doctype html><html><body style="margin:0;font:14px monospace"><pre id="p2" style="margin:0 20px;width:500px"><span id="sp">  "a": "127.0.0.1:8180", "b": "127.0.0.1:8180"</span></pre></body></html>')
            let regions = await findPortRegions(page, [8180])
            A.equal(regions.length, 2, `同一文字節點內兩處皆須取得, 實得 ${regions.length}`)
            let pre = await page.evaluate(() => {
                let r = document.getElementById('p2').getBoundingClientRect()
                return { left: r.left, right: r.right }
            })
            for (let r of regions) {
                A.equal(r.kind, 'text')
                A.ok(Math.abs(r.x - pre.left) <= 1, `起點應為 block 祖先(pre)左緣 ${pre.left}, 實得 ${r.x}`)
                A.ok(Math.abs(r.x + r.w - pre.right) <= 1, `終點應為 block 祖先(pre)右緣 ${pre.right}(非行內 span 之右緣), 實得 ${r.x + r.w}`)
            }
        }
        finally {
            await page.close()
        }
    })

    it('OV-009 預設 tight 只覆蓋「:埠」本身: 同一行埠以外之文字有真差異時仍被抓到; line 模式(整行)則會吞掉; 外擴後越過左／上緣時夾到 0 且不向右／下多覆蓋', async function() {
        //位移端把同一儲存格內埠以外之文字改掉(view=backstage → view=backstagX), 模擬 redir 路徑／參數之真迴歸
        let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
        let tampered
        try {
            await page.setContent(html(8180).replace('view=backstage', 'view=backstagX'))
            tampered = { regions: await findPortRegions(page, [8180]), buf: await page.screenshot({ fullPage: true }) }
        }
        finally {
            await page.close()
        }
        let base = await shot(8080)
        let fpBase = path.join(fdTmp, 'baseline4.png')
        fs.writeFileSync(fpBase, base.buf)
        let tight = await overlayPortRegions(tampered.buf, fpBase, tampered.regions) //預設 tight
        let line = await overlayPortRegions(tampered.buf, fpBase, tampered.regions, 2, 'line')
        A.ok(!(await raw(tight)).equals(await raw(base.buf)), 'tight: 埠以外之真差異須仍存在(不得被覆蓋吞掉)')
        A.ok((await raw(line)).equals(await raw(base.buf)), '前提(對照): line 模式整行覆蓋會吞掉同一行之真差異——這正是改採 tight 之理由')
        //tight 矩形只含「:埠」: 寬度遠小於整行(儲存格寬 520)
        let txt = tampered.regions.find((r) => r.kind === 'text')
        A.ok(txt.tight && txt.tight.w > 0 && txt.tight.w < 80, `tight 矩形應只含「:8180」(約 5 字元寬), 實得 ${JSON.stringify(txt.tight)}`)
        A.ok(txt.w > 400, `line 矩形應為整行寬, 實得 ${txt.w}`)
    })

    it('OV-009b 折行之文字(一個文字節點分成多個矩形)每個矩形各自登記 tight, 且 tight 覆蓋後與同版面標準圖逐像素全等', async function() {
        //窄容器使 URL 於 / 與 ? 處折行, 且「:埠」落在折行的一側
        let h = (port) => `<!doctype html><html><body style="margin:0;font:14px monospace;background:#fff"><div id="w" style="margin:20px;width:150px;word-break:break-all;background:#eef">http://127.0.0.1:${port}/?view=backstage&token={token}</div></body></html>`
        let one = async (port) => {
            let page = await browser.newPage({ viewport: { width: 640, height: 480 } })
            try {
                await page.setContent(h(port))
                return { regions: await findPortRegions(page, [port]), buf: await page.screenshot({ fullPage: true }) }
            }
            finally {
                await page.close()
            }
        }
        let cur = await one(8180)
        let base = await one(8080)
        A.ok(cur.regions.length >= 1 && cur.regions.every((r) => r.kind === 'text' && r.tight && r.tight.w > 0), `每個矩形皆有 tight: ${JSON.stringify(cur.regions.map((r) => r.tight))}`)
        let fp = path.join(fdTmp, 'wrap-base.png')
        fs.writeFileSync(fp, base.buf)
        A.ok(!(await raw(cur.buf)).equals(await raw(base.buf)), '前提: 不覆蓋時不全等')
        A.ok((await raw(await overlayPortRegions(cur.buf, fp, cur.regions))).equals(await raw(base.buf)), '折行時 tight 覆蓋後仍與標準圖逐像素全等')
    })

    it('OV-010 負座標夾邊: 外擴後越過左／上緣時夾到 0 並同步縮減寬高——覆蓋範圍恰為 x 0..42、y 0..14, 其右／下緊鄰像素不被多蓋; mode 非 tight／line 即拋錯', async function() {
        //合成圖: 標準圖全白; 當次圖全白但 (43,5) 與 (5,15) 各有一個紅點(夾邊後的覆蓋範圍之外一格), 另 (10,5) 紅點在覆蓋範圍內
        let mk = async (pts) => {
            let w = 100
            let h = 50
            let data = Buffer.alloc(w * h * 3, 255)
            for (let [x, y] of pts) {
                let i = (y * w + x) * 3
                data[i] = 255
                data[i + 1] = 0
                data[i + 2] = 0
            }
            return await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
        }
        let base = await mk([])
        let cur = await mk([[43, 5], [5, 15], [10, 5]])
        let fp = path.join(fdTmp, 'clamp-base.png')
        fs.writeFileSync(fp, base)
        //rect {x:1,y:1,w:40,h:12} + pad 2 → x=-1,y=-1,w=44,h=16 → 夾邊後 x=0,y=0,w=43,h=15(覆蓋 x 0..42、y 0..14); 若夾邊時不縮寬高(w=44,h=16)則會多蓋 x=43、y=15
        let out = await overlayPortRegions(cur, fp, [{ kind: 'text', x: 1, y: 1, w: 40, h: 12, tight: { x: 1, y: 1, w: 40, h: 12 } }])
        let o = (await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
        let px = (x, y) => [o.data[(y * o.info.width + x) * 4], o.data[(y * o.info.width + x) * 4 + 1], o.data[(y * o.info.width + x) * 4 + 2]].join(',')
        A.equal(px(10, 5), '255,255,255', '覆蓋範圍內之紅點須被標準圖內容(白)取代')
        A.equal(px(43, 5), '255,0,0', 'x=43 在夾邊後之覆蓋範圍之外, 紅點須仍在(不得因負座標向右多蓋)')
        A.equal(px(5, 15), '255,0,0', 'y=15 在夾邊後之覆蓋範圍之外, 紅點須仍在(不得向下多蓋)')
        let bad
        try {
            await overlayPortRegions(cur, fp, [{ kind: 'text', x: 1, y: 1, w: 4, h: 4 }], 2, 'tigth')
        }
        catch (e) {
            bad = e
        }
        A.ok(bad && /mode 須為/.test(bad.message), `mode 拼錯須拋錯(不得靜默退成整行): ${bad && bad.message}`)
    })

    describe('經 e2e-setup 之包裝(位移實例對基準埠實例之標準圖)', function() {
        //子行程: 匯入 e2e-setup(E2E_PORTS_FOR_UNIT_TEST 令基準埠為動態埠, E2E_PORT_OFFSET 釘住位移 0／100, 不偵測占用、不占埠、不起服務)後,
        //  以 fixture(顯示前端實際埠)走 captureStableWithBox／captureStable; 位移實例另以 portCompareBuf 覆蓋後存檔
        let childCode = (mode) => `
import fs from 'fs'
const m = await import(${JSON.stringify(SETUP_URL)})
const port = Number(new URL(m.baseUrl).port)
const html = ${html.toString()}
const out = { port, shifted: m.PORTS_SHIFTED, cmp: m.portCompareBuf === null ? null : typeof m.portCompareBuf }
const browser = await m.launchBrowser()
try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    await page.setContent(html(port))
    const withBox = await m.captureStableWithBox(page, '#addr')
    const plain = await m.captureStable(page)
    //截圖後再處理(e2e-stainfor／e2e-autologin 於 captureStable 之後另做 maskRegions／composeBox): 新 Buffer 須延用含埠區域
    const post = await m.maskRegions(plain, [{ x: 590, y: 450, w: 30, h: 20 }])
    const composed = await m.composeBox(plain, { left: 20, top: 440, right: 120, bottom: 470 })
    //composeBox 之第三參數 opt 須原樣轉交套件(e2e-stainfor 以 onSkip 偵測「紅框未畫出」; 包裝若丟掉 opt 該守門即失效)
    let skipReason = null
    await m.composeBox(plain, { left: 5000, top: 5000, right: 5001, bottom: 5001 }, { onSkip: (r) => { skipReason = r } })
    out.onSkip = skipReason
    fs.writeFileSync(process.env.WS309_OUT + '-box.png', withBox)
    fs.writeFileSync(process.env.WS309_OUT + '-plain.png', plain)
    fs.writeFileSync(process.env.WS309_OUT + '-post.png', post)
    fs.writeFileSync(process.env.WS309_OUT + '-composed.png', composed)
    if (${JSON.stringify(mode)} === 'shifted') {
        const b1 = await m.portCompareBuf(withBox, process.env.WS309_BASE + '-box.png')
        const b2 = await m.portCompareBuf(plain, process.env.WS309_BASE + '-plain.png')
        fs.writeFileSync(process.env.WS309_OUT + '-box-cmp.png', b1)
        fs.writeFileSync(process.env.WS309_OUT + '-plain-cmp.png', b2)
        fs.writeFileSync(process.env.WS309_OUT + '-post-cmp.png', await m.portCompareBuf(post, process.env.WS309_BASE + '-post.png'))
        fs.writeFileSync(process.env.WS309_OUT + '-composed-cmp.png', await m.portCompareBuf(composed, process.env.WS309_BASE + '-composed.png'))
        //clip 截圖且畫面含實際埠 → 拋錯(座標與頁面座標不同, 不靜默覆蓋到錯位置)
        try {
            await m.captureStable(page, { shotOpts: { fullPage: false, clip: { x: 0, y: 0, width: 300, height: 120 } } })
            out.clipThrows = false
        }
        catch (e) {
            out.clipThrows = true
            out.clipMsg = String(e.message)
        }
        //畫面不含實際埠時 clip 截圖照常
        await page.setContent('<!doctype html><html><body style="margin:0">no port here</body></html>')
        try {
            await m.captureStable(page, { shotOpts: { fullPage: false, clip: { x: 0, y: 0, width: 100, height: 40 } } })
            out.clipNoPortThrows = false
        }
        catch (e) {
            out.clipNoPortThrows = true
        }
    }
    await page.close()
}
finally {
    await browser.close()
}
console.log('RESULT ' + JSON.stringify(out))
m.cleanup()
`
        let runKid = (mode, offset, bases, outBase, baseBase) => {
            let env = { ...process.env, E2E_PORTS_FOR_UNIT_TEST: bases.join(','), E2E_PORT_OFFSET: String(offset), E2E_PORT_REG_DIR: path.join(fdTmp, 'reg'), WS309_OUT: outBase, WS309_BASE: baseBase || '' }
            //外層 shell 之等價驗證變數不得影響本檔(與 unit-e2ePortReserve 的 baseEnv 同一份清除清單)
            for (let k of ['E2E_PORT_HOLD', 'E2E_REGEN', 'E2E_BARE', 'E2E_DIAG', 'E2E_COLLECT', 'E2E_BASELINE_OUT_DIR', 'E2E_PORT_REGIONS_OUT', 'E2E_STRICT_CAPTURE', 'E2E_COVER_CHECK']) {
                delete env[k]
            }
            let r = spawnSync(process.execPath, ['--input-type=module', '-e', typeof mode === 'string' && mode.startsWith('CODE:') ? mode.slice(5) : childCode(mode)], { cwd: projRoot, env, encoding: 'utf8', timeout: 110000, windowsHide: true })
            let m = /RESULT (.*)/.exec(r.stdout || '')
            A.ok(m, `子行程失敗(status ${r.status}): ${(r.stderr || '').slice(-600)} ${(r.stdout || '').slice(-300)}`)
            return { ...JSON.parse(m[1]), stdout: r.stdout || '' }
        }

        it('OV-011 輸入框含實際埠: 值恰為本實例網址才允許整框覆蓋、值含其他內容即拋錯; 位移時比對未登記之截圖原樣回傳並只印一次警告', function() {
            let code = `
const m = await import(${JSON.stringify(SETUP_URL)})
const port = Number(new URL(m.baseUrl).port)
const browser = await m.launchBrowser()
const out = {}
try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    await page.setContent('<!doctype html><html><body><input id="a" style="width:420px;height:28px" value="http://127.0.0.1:' + port + '/?view=user&token={token}"></body></html>')
    try {
        await m.captureStable(page)
        out.okInputThrows = false
    }
    catch (e) {
        out.okInputThrows = true
        out.okMsg = String(e.message)
    }
    await page.setContent('<!doctype html><html><body><input id="a" style="width:420px;height:28px" value="note: http://127.0.0.1:' + port + '/x and more"></body></html>')
    try {
        await m.captureStable(page)
        out.badInputThrows = false
    }
    catch (e) {
        out.badInputThrows = true
        out.badMsg = String(e.message)
    }
    await page.close()
}
finally {
    await browser.close()
}
const foreign = Buffer.from('not-a-registered-shot')
out.foreignSame1 = (await m.portCompareBuf(foreign, 'x.png')) === foreign
out.foreignSame2 = (await m.portCompareBuf(foreign, 'x.png')) === foreign
console.log('RESULT ' + JSON.stringify(out))
m.cleanup()
`
            let r = runKid('CODE:' + code, 100, [30011, 30511], path.join(fdTmp, 'ov011'), '')
            A.equal(r.okInputThrows, false, `值恰為本實例網址之輸入框須通過: ${r.okMsg}`)
            A.equal(r.badInputThrows, true, '值含其他內容之輸入框須拋錯(整框覆蓋會吞掉未知內容)')
            A.ok(/不是單純的本實例網址/.test(r.badMsg), r.badMsg)
            A.equal(r.foreignSame1, true, '未登記之截圖原樣回傳')
            A.equal(r.foreignSame2, true)
            A.equal((r.stdout.match(/未登記含埠區域之截圖/g) || []).length, 1, '警告只印一次(免洗版)')
        })

        it('OV-008 位移實例(釘住位移 100)經 captureStableWithBox／captureStable 與 portCompareBuf 覆蓋後, 與基準埠實例之標準圖逐像素(RGBA)全等; 未覆蓋時確實不同; 基準埠實例之 portCompareBuf 為 null', async function() {
            let bases = [30011, 30511] //動態性不影響本案(不占埠、不起服務, 只用於顯示於畫面之埠數字); 兩者位移 100 後仍為 5 位數, 文字寬度相同
            let fdBase = path.join(fdTmp, 'kidBase')
            let fdShift = path.join(fdTmp, 'kidShift')
            fs.mkdirSync(fdBase, { recursive: true })
            fs.mkdirSync(fdShift, { recursive: true })
            let b = runKid('base', 0, bases, path.join(fdBase, 's'))
            A.equal(b.shifted, false)
            A.equal(b.cmp, null, '基準埠實例(未位移)之 portCompareBuf 為 null(不覆蓋, 行為同導入前)')
            A.equal(b.port, bases[1])
            A.ok(/框過小/.test(b.onSkip || ''), `composeBox 之 opt.onSkip 須被轉交套件並觸發(基準埠實例): ${b.onSkip}`)
            let s = runKid('shifted', 100, bases, path.join(fdShift, 's'), path.join(fdBase, 's'))
            A.ok(/框過小/.test(s.onSkip || ''), `composeBox 之 opt.onSkip 須被轉交套件並觸發(位移實例): ${s.onSkip}`)
            A.equal(s.shifted, true)
            A.equal(s.cmp, 'function')
            A.equal(s.port, bases[1] + 100)
            for (let k of ['box', 'plain', 'post', 'composed']) {
                let base = await raw(fs.readFileSync(path.join(fdBase, `s-${k}.png`)))
                let cur = await raw(fs.readFileSync(path.join(fdShift, `s-${k}.png`)))
                let cmp = await raw(fs.readFileSync(path.join(fdShift, `s-${k}-cmp.png`)))
                A.ok(!cur.equals(base), `前提(${k}): 不覆蓋時位移實例與基準埠實例因埠數字不同而不全等(否則本案無鑑別力)`)
                A.ok(cmp.equals(base), `(${k}) 覆蓋後應與基準埠實例之標準圖逐像素全等`)
            }
            A.equal(s.clipThrows, true, '畫面含實際埠而為 clip 截圖須拋錯')
            A.ok(/clip／視窗截圖/.test(s.clipMsg), `錯誤須寫明原因: ${s.clipMsg}`)
            A.equal(s.clipNoPortThrows, false, '畫面不含實際埠時 clip 截圖照常')
        })
    })
})
