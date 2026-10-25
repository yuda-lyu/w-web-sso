//agg-sys.mjs — 彙整全部 e2e 擷取(netcap jsonl): 每個函數 × 回應結果之次數; 標出所有 [sys:*] 之結果與非預期者(sso-run01 暫存)
//用法: node tmp/sso-run01/agg-sys.mjs <jsonl...>
import fs from 'fs'

let files = process.argv.slice(2)
let sends = new Map() //func → n
let results = new Map() //func → Map(outcome → n)
let tokenState = new Map() //func → Map(state → n)
let httpPaths = new Map()
let nRes = 0
for (let f of files) {
    for (let ln of fs.readFileSync(f, 'utf8').split('\n').filter((x) => x.trim())) {
        let r = JSON.parse(ln)
        if (r.phase === 'send') {
            sends.set(r.func, (sends.get(r.func) || 0) + 1)
            let m = tokenState.get(r.func) || new Map()
            let k = (r.sysToken || '-').replace(/\(len=\d+\)/, '')
            m.set(k, (m.get(k) || 0) + 1)
            tokenState.set(r.func, m)
        }
        else if (r.phase === 'res') {
            nRes++
            let func = r.resp && r.resp.success && r.resp.success.func
            if (func) {
                let o = r.resp.success.output
                let oc = Array.isArray(o) ? `array(${o.length})` : (o && o.state ? `${o.state}${o.state === 'error' ? ':' + String(o.msg).slice(0, 60) : ''}` : JSON.stringify(o).slice(0, 40))
                let m = results.get(func) || new Map()
                m.set(oc, (m.get(oc) || 0) + 1)
                results.set(func, m)
            }
            else {
                let k = `${r.status} ${r.resp && r.resp.error !== undefined ? 'error=' + String(r.resp.error).slice(0, 60) : (r.ct || '')} ${r.path}`
                httpPaths.set(k, (httpPaths.get(k) || 0) + 1)
            }
        }
    }
}
console.log(`回應總數 ${nRes}`)
console.log('\n## 系統函數([sys:*]): 送出數 × 結果 × __sysToken__ 狀態')
for (let [fn, n] of [...sends.entries()].filter(([k]) => String(k).startsWith('[sys:')).sort()) {
    console.log(`${fn}  送出 ${n}`)
    for (let [oc, c] of results.get(fn) || []) console.log(`    結果 ${oc}: ${c}`)
    console.log(`    __sysToken__: ${[...tokenState.get(fn)].map(([k, c]) => `${k}=${c}`).join(', ')}`)
}
console.log('\n## 其餘函數(kpfun): 送出數 / 結果')
for (let [fn, n] of [...sends.entries()].filter(([k]) => !String(k).startsWith('[sys:')).sort()) {
    let rs = [...(results.get(fn) || [])].map(([k, c]) => `${k}=${c}`).join('; ')
    console.log(`${fn}  ${n}  ${rs.slice(0, 160)}`)
}
console.log('\n## 非函數回應(HTTP 頁 / 錯誤)')
for (let [k, c] of httpPaths) console.log(`${k}: ${c}`)
let sysNames = [...sends.keys()].filter((k) => String(k).startsWith('[sys:'))
console.log('\n[sys:*] 函數名全集:', JSON.stringify(sysNames.sort()))
