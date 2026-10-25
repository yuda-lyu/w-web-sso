//summ.mjs — 彙整 netcap jsonl: 依 label(情境) × func 統計 送出數、__sysToken__ 狀態、回應(sso-run01 暫存)
//用法: node tmp/sso-run01/summ.mjs <jsonl...>
import fs from 'fs'

let files = process.argv.slice(2)
let labels = new Map()
let get = (lab) => {
    if (!labels.has(lab)) labels.set(lab, { auth: new Map(), funcs: new Map(), http: new Map() })
    return labels.get(lab)
}
let getF = (L, f) => {
    if (!L.funcs.has(f)) L.funcs.set(f, { n: 0, tok: new Map(), res: new Map(), pollIn: new Set() })
    return L.funcs.get(f)
}
let inc = (m, k) => m.set(k, (m.get(k) || 0) + 1)
for (let f of files) {
    for (let ln of fs.readFileSync(f, 'utf8').split('\n').filter((x) => x.trim())) {
        let r = JSON.parse(ln)
        let L = get(r.label)
        if (r.phase === 'req') {
            inc(L.auth, `${r.method} ${r.path} auth=${r.auth}`)
        }
        else if (r.phase === 'send') {
            let F = getF(L, r.func || '(undecoded)')
            F.n++
            inc(F.tok, r.sysToken || '-')
            if (r.pollingInput) F.pollIn.add(JSON.stringify(r.pollingInput).replace(/"clientId":"[^"]*"/, '"clientId":"<id>"'))
        }
        else if (r.phase === 'res') {
            if (r.resp && r.resp.success) {
                let F = getF(L, r.resp.success.func)
                let o = r.resp.success.output
                let s = `${r.status} ` + (Array.isArray(o) ? `output=array(${o.length})` : JSON.stringify(o)).replace(/"clientId":"[^"]*"/g, '"clientId":"<id>"').slice(0, 150)
                inc(F.res, s)
            }
            else if (r.resp && r.resp.error !== undefined) {
                inc(L.http, `${r.status} error=${JSON.stringify(r.resp.error).slice(0, 120)}`)
            }
            else {
                inc(L.http, `${r.status} ${r.ct || ''} ${r.path}`)
            }
        }
    }
}
for (let [lab, L] of [...labels.entries()].sort()) {
    console.log(`## ${lab}`)
    for (let [k, c] of L.auth) console.log(`   ${k}  x${c}`)
    for (let [k, c] of L.http) console.log(`   http: ${k}  x${c}`)
    for (let [fn, F] of [...L.funcs.entries()].sort()) {
        console.log(`   ${fn}  send x${F.n}  sysToken={${[...F.tok.entries()].map(([k, c]) => `${k}:${c}`).join(', ')}}`)
        for (let [s, c] of F.res) console.log(`        -> ${s}  x${c}`)
        for (let p of F.pollIn) console.log(`        in ${p}`)
    }
}
