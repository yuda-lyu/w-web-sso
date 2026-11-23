//第 301 項(統計 timeLength / opt.timeNow 入口檢測)最小重現: 逐候選以逾時保護之子行程跑 test/tools/timeLengthChild.mjs; 逾時視為同步無窮迴圈或過慢
//用法(於套件根): node spec/evidence/tws1-20261123/repro301-run.mjs <輸出 jsonl 路徑> [逾時 ms, 預設 6000]
//輸出: 每候選一行 { name, hang, layers: { 層: { kind, v } } }; hang=true 表示逾時被終止(此時 layers 只含逾時前已完成之層)
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

let fpOut = path.resolve(process.argv[2] || './tmp/repro301.jsonl')
let timeout = Number(process.argv[3] || 6000)
let child = path.resolve('./test/tools/timeLengthChild.mjs')
let fdLog = path.resolve('./tmp/repro301-emptylogs')
fs.mkdirSync(path.dirname(fpOut), { recursive: true })

let names = [
    'v-0', 'v-1', 'v-7', 'v-undef', 'v-str7', 'v-3650',
    'x-NaN', 'x-Infinity', 'x-negInfinity', 'x-neg1', 'x-negHuge', 'x-float1.5', 'x-3651', 'x-100000', 'x-1e20',
    'x-strAbc', 'x-strEmpty', 'x-null', 'x-true', 'x-obj', 'x-arr',
    'now-NaN', 'now-Infinity', 'now-neg-Infinity', 'now-1e300', 'now-str', 'now-date-max', 'now-date-min', 'now-beyond-2100', 'now-negative-epoch', 'now-ok-epoch0',
]
let lines = []
for (let n of names) {
    let r = spawnSync(process.execPath, [child, n, fdLog], { timeout, windowsHide: true, encoding: 'utf8', killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 })
    let hang = (r.error && r.error.code === 'ETIMEDOUT') === true
    let layers = {}
    for (let ln of String(r.stdout || '').split(/\r?\n/)) {
        try {
            let o = JSON.parse(ln)
            layers[o.layer] = { kind: o.kind, v: o.v }
        }
        catch (err) {}
    }
    let o = { name: n, hang, status: r.status, layers }
    lines.push(JSON.stringify(o))
    console.log(JSON.stringify({ name: n, hang, genPlan: layers.genPlan || null }))
}
fs.writeFileSync(fpOut, lines.join('\n') + '\n', 'utf8')
fs.rmSync(fdLog, { recursive: true, force: true })
