//跨行程舊快照之最小重現(ADR-081; CLAUDE_rulebook.md「已知缺口」): 讀者行程先讀一次(lmdb-js 續用讀交易並排定 setTimeout(resetReadTxn, 0)),
//隨即請寫者子行程寫入新鍵, 於收到其 IPC 回覆之回呼內立即再讀. 開啟參數同 w-orm-lmdb(WOrmLmdb.mjs 之 open: compression、useVersions).
//執行: node spec/evidence/2026-10-12-lmdb-cross-process-stale-read.mjs [mode] [N]
//  mode: plain(預設, 回呼內立即讀) | wait1(讀前先等一個 1ms 計時器) | reset(讀前呼叫 db.resetReadTxn())
//2026-10-12 本機(Windows 11, Node 24.19.0, lmdb 3.5.6)結果: plain 200 次中 106 次讀不到(回覆距前次讀取 2~4ms); wait1 0 次; reset 0 次.
//暫存資料庫置於 test/_tmp/(gitignore), 結束即刪.
import { fork } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { open } from 'lmdb'

let __filename = fileURLToPath(import.meta.url)
let isChild = process.argv[2] === '--child'
let dbPath = path.resolve('./test/_tmp/lmdb-stale-read')

if (isChild) {
    let db = open({ path: dbPath, compression: true, useVersions: true })
    process.on('message', async (m) => {
        if (m.cmd === 'exit') {
            await db.close()
            process.exit(0)
        }
        await db.put(m.key, { id: m.key, v: m.i })
        process.send({ done: m.key })
    })
    process.send({ ready: true })
}
else {
    let mode = process.argv[2] || 'plain'
    let N = Number(process.argv[3] || 200)
    fs.rmSync(dbPath, { recursive: true, force: true })
    let db = open({ path: dbPath, compression: true, useVersions: true })
    let readAll = () => {
        let n = 0
        for (let { key } of db.getRange()) {
            n += key ? 1 : 0
        }
        return n
    }
    let child = fork(__filename, ['--child'])
    await new Promise((r) => child.once('message', r))
    let stale = 0
    let samples = []
    for (let i = 0; i < N; i++) {
        let key = `k${i}`
        readAll() //續用(renew)讀交易, 排定 setTimeout(resetReadTxn, 0)
        let t0 = performance.now()
        await new Promise((resolve) => {
            child.once('message', async () => {
                let dt = performance.now() - t0
                if (mode === 'wait1') {
                    await new Promise((r) => setTimeout(r, 1))
                }
                if (mode === 'reset') {
                    db.resetReadTxn()
                }
                if (db.get(key) === undefined) {
                    stale++
                    if (samples.length < 5) {
                        samples.push({ i, dt: Number(dt.toFixed(2)) })
                    }
                }
                resolve()
            })
            child.send({ key, i })
        })
        await new Promise((r) => setTimeout(r, 30)) //讓讀交易重設, 下一輪重新開始
    }
    child.send({ cmd: 'exit' })
    await new Promise((r) => child.once('exit', r))
    await db.close()
    fs.rmSync(dbPath, { recursive: true, force: true })
    console.log(`mode=${mode} N=${N} stale=${stale}`, JSON.stringify(samples))
}
