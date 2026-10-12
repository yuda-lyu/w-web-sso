//w-orm-lmdb 跨行程舊快照之重現(以 w-orm-lmdb 自身 API; 供 ADR-081 取證與 ADR-082 修復驗證, 1.0.38 起各情境應為 0): 行程 A 先讀一次(lmdb-js 續用讀交易),
//請行程 B 寫入後, A 於收到 B 之 IPC 回覆之回呼內立即操作, 觀察是否用到寫入前之快照.
//執行: node spec/evidence/2026-10-12-worm-lmdb-cross-process-stale-read.mjs [N] [yield]
//  N: 每情境次數(預設 100); yield: 給 1 則 A 操作前先讓出 1ms 計時器(對照組)
//  環境變數 WORM_LMDB_SRC: 改用指定路徑之 WOrmLmdb.mjs(驗證修正版; 未給則用已安裝之 w-orm-lmdb)
//情境: select(查無 B 剛新增之列)、selectByPk(同)、save(A 之後發之更新被快速路徑略過, B 之舊更新存活)、del(A 刪除 B 剛新增之列時判為查無而未刪)
//暫存資料庫置於 test/_tmp/(gitignore), 結束即刪.
import { fork } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

let srcWorm = process.env.WORM_LMDB_SRC ? pathToFileURL(path.resolve(process.env.WORM_LMDB_SRC)).href : 'w-orm-lmdb/src/WOrmLmdb.mjs'
let { default: WOrmLmdb } = await import(srcWorm)

let __filename = fileURLToPath(import.meta.url)
let isChild = process.argv[2] === '--child'
let base = path.resolve('./test/_tmp/worm-lmdb-stale-read')
let opt = { url: base, db: 'worm', cl: 't' }

if (isChild) {
    let wo = WOrmLmdb(opt)
    process.on('message', async (m) => {
        if (m.cmd === 'exit') {
            await wo.close()
            process.exit(0)
        }
        if (m.cmd === 'insert') {
            await wo.insert({ id: m.id, v: 'B' })
        }
        if (m.cmd === 'save') {
            await wo.save({ id: m.id, v: m.v })
        }
        process.send({ done: m.cmd })
    })
    process.send({ ready: true })
}
else {
    let N = Number(process.argv[2] || 100)
    let useYield = process.argv[3] === '1'
    fs.rmSync(base, { recursive: true, force: true })
    let wo = WOrmLmdb(opt)
    await wo.insert({ id: 'seed', v: 'A' }) //先建立資料表
    let child = fork(__filename, ['--child'])
    await new Promise((r) => child.once('message', r))
    let ask = (m) => new Promise((resolve) => {
        child.once('message', resolve)
        child.send(m)
    })
    let pause = (ms) => new Promise((r) => setTimeout(r, ms))
    let fresh = async (fn) => {
        await pause(1)
        return fn()
    }
    let count = { select: 0, selectByPk: 0, save: 0, del: 0 }
    for (let i = 0; i < N; i++) {

        //select: A 讀 → B 新增 → A 立即以 select 查該列
        await wo.select()
        await ask({ cmd: 'insert', id: `s${i}` })
        if (useYield) await pause(1)
        if ((await wo.select({ id: `s${i}` })).length === 0) count.select++
        await pause(20)

        //selectByPk: 同上, 以 selectByPk 查
        await wo.select()
        await ask({ cmd: 'insert', id: `p${i}` })
        if (useYield) await pause(1)
        if ((await wo.selectByPk(`p${i}`)) === null) count.selectByPk++
        await pause(20)

        //save: A 先把 r 設為 X → A 讀 → B 把 r 設為 Y → A(其後)再把 r 設為 X; 正確終值為 X(A 之更新在後)
        await wo.save({ id: 'r', v: 'X' })
        await wo.selectByPk('r')
        await ask({ cmd: 'save', id: 'r', v: 'Y' })
        if (useYield) await pause(1)
        await wo.save({ id: 'r', v: 'X' })
        if ((await fresh(() => wo.selectByPk('r'))).v !== 'X') count.save++
        await pause(20)

        //del: A 讀 → B 新增 → A 立即刪除該列; 正確結果為已刪除
        await wo.select()
        await ask({ cmd: 'insert', id: `d${i}` })
        if (useYield) await pause(1)
        await wo.del({ id: `d${i}` })
        if ((await fresh(() => wo.selectByPk(`d${i}`))) !== null) count.del++
        await pause(20)

    }
    child.send({ cmd: 'exit' })
    await new Promise((r) => child.once('exit', r))
    await wo.close()
    fs.rmSync(base, { recursive: true, force: true })
    console.log(`N=${N} yield=${useYield ? 1 : 0} anomalies=${JSON.stringify(count)}`)
}
