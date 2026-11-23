//第 389 項負載探測之啟動器: 起 K 個低優先權 CPU 燒耗行程(K ≤ 邏輯核數 − 2, 預設如此), 同時以 mocha 跑 probe389.mjs, 結束時終止燒耗行程並回驗其已消失
//用法(於套件根, 通常包在 quiet-run --lock-exclusive 內): node spec/evidence/tws1-20261123/probe389-run.mjs <輸出 jsonl> [--burners K] [--grep 案例名] [--n 輪數] [--no-load]
//  --no-load: 不起燒耗行程(對照組)
import os from 'os'
import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

if (process.argv[2] === '__burn__') {
    //燒耗行程: 純 CPU 迴圈(不讓出; 由啟動器終止)
    let x = 0
    for (;;) {
        x = (x + Math.sqrt(Math.random() * 1e6)) % 1e9
    }
}

let argv = process.argv.slice(2)
let opt = (k, d) => {
    let i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : d
}
let fpOut = path.resolve(argv[0])
let K = argv.includes('--no-load') ? 0 : Number(opt('--burners', Math.max(1, os.cpus().length - 2)))
if (K > Math.max(1, os.cpus().length - 2)) {
    throw new Error(`壓力行程數 ${K} 超過邏輯核數減 2`)
}
let grep = opt('--grep', 'ip-expiry-implicit-unlock')
let n = opt('--n', '5')
let here = path.dirname(fileURLToPath(import.meta.url))
let projRoot = path.resolve(here, '..', '..', '..')

//起燒耗行程(低於標準優先權, 隱藏視窗)
let burners = []
for (let i = 0; i < K; i++) {
    let c = spawn(process.execPath, [fileURLToPath(import.meta.url), '__burn__'], { windowsHide: true, stdio: 'ignore' })
    try {
        os.setPriority(c.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    }
    catch (err) {}
    burners.push(c)
}
console.log(`[probe389] burners=${K} pids=${burners.map((b) => b.pid).join(',')} grep=${grep} n=${n}`)

let alive = (pid) => {
    let r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true })
    return String(r.stdout || '').includes(String(pid))
}

let code = 1
try {
    let r = spawnSync(process.execPath, [
        path.join(projRoot, 'node_modules', 'mocha', 'bin', 'mocha.js'), '--no-parallel',
        path.join(here, 'probe389.mjs'), '--grep', grep, '--reporter', path.join(here, 'probe389-reporter.cjs'), '--timeout', '600000',
    ], { cwd: projRoot, env: { ...process.env, PROBE_N: n }, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
    fs.writeFileSync(fpOut, String(r.stdout || ''), 'utf8')
    fs.writeFileSync(`${fpOut}.stderr.txt`, String(r.stderr || '').slice(-20000), 'utf8')
    code = r.status === null ? 1 : r.status
}
finally {
    for (let b of burners) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(b.pid)], { windowsHide: true })
    }
    let left = burners.filter((b) => alive(b.pid)).map((b) => b.pid)
    console.log(`[probe389] burners killed; remaining=${left.length} ${left.join(',')}`)
}
process.exit(code)
