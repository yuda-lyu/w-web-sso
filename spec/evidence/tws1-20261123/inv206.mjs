//第 206 項盤點: src/ 下全部可執行 console 站點(檔:行、文字、是否在伺服端匯入閉包、是否印值)
//用法(於套件根): node spec/evidence/tws1-20261123/inv206.mjs > <輸出 tsv>; 欄位: 檔:行 / SRV 或 FRONT / VALUE(引數可能印值)或 ok / 該行文字
//  修前(2026-11-23 HEAD)輸出見 206-sites-prefix.tsv, 修後見 206-sites-postfix.tsv; 引用方後端執行之 src/fetchSsoMsg.mjs 由 unit-consoleNoLeak SITE-CNL-004 涵蓋, 不在前端範圍
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { sourceLines, importClosure, scanConsoleValueArgs } from '../../../test/tools/srcScan.mjs'

const projRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const rel = (fp) => path.relative(projRoot, fp).replace(/\\/g, '/')

let out = []
let walk = (d) => {
    for (let n of fs.readdirSync(d, { withFileTypes: true })) {
        let fp = path.join(d, n.name)
        if (n.isDirectory()) {
            walk(fp)
        }
        else if (/\.(vue|js|mjs)$/.test(n.name)) {
            out.push(fp)
        }
    }
}
walk(path.join(projRoot, 'src'))
out.sort()

let closure = importClosure(path.join(projRoot, 'server', 'WWebSso.mjs'))
let rows = []
for (let fp of out) {
    let inSrv = closure.has(fp)
    let bad = new Set(scanConsoleValueArgs(fp, 'code', {}).map((x) => Number(/:(\d+)/.exec(x)[1])))
    for (let { no, text } of sourceLines(fp, 'code')) {
        if (/\bconsole\b/.test(text)) {
            rows.push({ file: rel(fp), no, inSrv, bad: bad.has(no), text: text.trim() })
        }
    }
}
for (let r of rows) {
    console.log(`${r.file}:${r.no}\t${r.inSrv ? 'SRV' : 'FRONT'}\t${r.bad ? 'VALUE' : 'ok'}\t${r.text}`)
}
let front = rows.filter((r) => !r.inSrv)
console.log(`TOTAL sites=${rows.length} front=${front.length} frontBad=${front.filter((r) => r.bad).length} srv=${rows.length - front.length} srvBad=${rows.filter((r) => r.inSrv && r.bad).length}`)
