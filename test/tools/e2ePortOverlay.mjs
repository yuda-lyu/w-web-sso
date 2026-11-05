//畫面含實際埠之比對端覆蓋(規格 E7「比對端覆蓋該處」; 排程第 309 項 ws309; 規則帳本 R-E2E-PORT-01; 作法承 w-web-api wa309)。
//
//背景: 使用者清單之「Redirect」欄與使用者資訊頁顯示測試資料之 redir(`${baseUrl}/?view=…`, 登入後真的轉址至此網址, 故資料必須帶各實例自己之前端埠),
//  其埠進標準圖(基準埠之文字); 被占用而位移時, 同一處改顯示實際埠(如 8180), 差異只有幾個數字 glyph(numDiff 21～76 < maxDiffPixels 100, 全綠不能證明畫面不含埠),
//  且位數相同之數字寬度未必相同, 故不能只靠容差。
//作法: 截圖「當下」於頁內掃描含實際埠之可見輸入框(input／textarea 之 value)與可見文字行(文字節點), 記下矩形(頁面座標, 與全頁截圖同座標系);
//  比對端以標準圖同座標之內容覆蓋這些矩形(標準圖不動、產製端原樣寫出)。預設 tight 模式: 文字行只覆蓋「:埠」本身, 同一行其餘文字仍逐像素比對(2026-11-05 ws309 獨立審查指出整行覆蓋會吞掉
//  路徑／view 參數等埠以外之真差異; 位元組級等價驗證實證只覆蓋埠字形即可使位移圖與基準圖全等)。「被覆蓋之值為實際埠」由掃描本身保證(只收含 `:<實際埠>` 且其後非數字者); 輸入框無文字節點可量, 仍覆蓋整框。
//  只在實際埠不同於基準埠(位移)時才量測與覆蓋: 沒有占用時零差異、比對行為與導入前逐位元相同。
//只掃「實際埠」(`:<實際埠>` 且其後非數字): 種子使用者(g_initialData.mjs 之 redir 為 http://localhost:8080/…)與基準埠文字不被誤蓋; 位移時畫面上本來就是基準埠字樣者, 與標準圖同值, 無須覆蓋。
//量不到(元素被遮蓋、捲出可視範圍)即不覆蓋(不遮蔽未量到之區域); 但位數相同之埠數字差異常低於比對容差(maxDiffPixels 100), 量不到不一定使比對失敗,
//  故覆蓋之完整性不靠容差證明, 而靠(1)位元組級等價驗證(基準埠與位移埠各產圖到隔離目錄, 逐像素重算覆蓋後須全等; E2E_PORT_REGIONS_OUT 記錄量測區域)、(2)單元測試(unit-e2ePortOverlay)。
import fs from 'fs'
import crypto from 'crypto'
import { overlayRegions } from './e2eLib.mjs'

//頁內掃描(序列化至頁內執行, 不可有閉包變數)。ports: 實際埠(字串或數字)陣列; 比對 ":<埠>" 且其後非數字(8180 不誤中 81800)
function scanInPage(ports) {
    let esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let src = `:(${ports.map((p) => esc(String(p))).join('|')})(?![0-9])`
    let re = new RegExp(src) //輸入框之值(只需知道有無)
    let reAll = new RegExp(src, 'g') //文字節點(同一節點出現多次者逐一取矩形)
    let sx = window.scrollX
    let sy = window.scrollY
    let out = []
    //矩形中心點須落在視窗內且為該元素(或其後代)所在之最上層, 否則視為不可見(被遮蓋、被捲動容器裁掉)
    let visible = (el, r) => {
        let cx = r.left + r.width / 2
        let cy = r.top + r.height / 2
        if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) {
            return false
        }
        let hit = document.elementFromPoint(cx, cy)
        return !!hit && (hit === el || el.contains(hit))
    }
    for (let el of document.querySelectorAll('input, textarea')) {
        let v = el.value || ''
        if (!re.test(v)) {
            continue
        }
        let r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0 || !visible(el, r)) {
            continue
        }
        out.push({ kind: el.tagName.toLowerCase(), text: v, x: r.left + sx, y: r.top + sy, w: r.width, h: r.height })
    }
    let walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        let par = n.parentElement
        if (!par || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION)$/.test(par.tagName)) {
            continue
        }
        //行尾基準取最近之非行內(block 級)祖先: 父元素為行內元素(如 v-html 高亮之 span)時, 其右緣不是行尾
        let blk = par
        while (blk.parentElement && /^inline/.test(getComputedStyle(blk).display)) {
            blk = blk.parentElement
        }
        let pr = blk.getBoundingClientRect()
        for (let m of n.data.matchAll(reAll)) {
            let range = document.createRange()
            range.setStart(n, m.index)
            range.setEnd(n, m.index + m[0].length)
            for (let r of range.getClientRects()) {
                if (r.width <= 0 || r.height <= 0 || !visible(par, r)) {
                    continue
                }
                //line: 該行自 block 祖先左緣至右緣(埠後之文字寬度隨位數浮動時須涵蓋到行尾); tight: 只含「:埠」本身之 Range 矩形(其餘文字仍逐像素比對)
                out.push({ kind: 'text', text: n.data.slice(0, 80), x: pr.left + sx, y: r.top + sy, w: Math.max(pr.right - pr.left, r.right - pr.left), h: r.height, tight: { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height } })
            }
        }
    }
    return out
}

//取得頁內含實際埠之可見區域矩形陣列[{kind,text,x,y,w,h}](頁面座標)。ports 為空陣列回 []
async function findPortRegions(page, ports) {
    let list = (ports || []).map((p) => String(p))
    if (list.length === 0) {
        return []
    }
    return await page.evaluate(scanInPage, list)
}

//以標準圖(baselinePath)同座標之內容覆蓋 buf 之 rects(外擴 pad px, 涵蓋文字邊緣之反鋸齒); 無矩形回原 buf。
//mode 'tight'(預設): 文字行只覆蓋「:埠」本身(Range 矩形), 同一行其餘文字(路徑、view 參數、token 佔位)仍逐像素比對——覆蓋範圍越小, 越不會吞掉埠以外之真差異;
//  輸入框之值(input／textarea)在 DOM 中無文字節點可量, 仍覆蓋整個輸入框矩形。mode 'line': 文字行自 block 祖先左緣覆蓋至右緣(較寬)。
//矩形外擴後若超出左／上緣(負座標), 夾到 0 並同步縮減寬高(不向右／下多覆蓋)。
async function overlayPortRegions(buf, baselinePath, rects, pad = 2, mode = 'tight') {
    if (mode !== 'tight' && mode !== 'line') {
        throw new Error(`overlayPortRegions: mode 須為 'tight' 或 'line', 實得 ${JSON.stringify(mode)}`)
    }
    if (!rects || rects.length === 0) {
        return buf
    }
    let rs = rects.map((r0) => {
        let r = mode === 'tight' && r0.tight ? r0.tight : r0
        let x = r.x - pad
        let y = r.y - pad
        let w = r.w + 2 * pad
        let h = r.h + 2 * pad
        if (x < 0) {
            w += x
            x = 0
        }
        if (y < 0) {
            h += y
            y = 0
        }
        return { x, y, w, h }
    })
    return await overlayRegions(buf, rs, fs.readFileSync(baselinePath))
}


//診斷／等價驗證用(平時關閉): 環境變數 E2E_PORT_REGIONS_OUT 給定時, 把「截圖 Buffer 之 sha1 → 該圖含實際埠之區域」附加一行 JSON 至該檔。
//  產製端(REGEN)寫出之 PNG 位元組即該 Buffer, 故事後可由檔案 sha1 取回當次量測之區域, 逐像素重算比對端覆蓋(證明覆蓋既完整又未遮蔽其他區域)。未設環境變數時零行為。
function recordPortRegions(buf, regions) {
    let fp = process.env.E2E_PORT_REGIONS_OUT
    if (!fp) {
        return
    }
    fs.appendFileSync(fp, JSON.stringify({ sha1: crypto.createHash('sha1').update(buf).digest('hex'), regions }) + '\n')
}


export { findPortRegions, overlayPortRegions, recordPortRegions, scanInPage }
