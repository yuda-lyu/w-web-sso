//unit-protectTimers.test.mjs — 背景計時器之錯誤收斂 (R-ERR-01, ADR-085)
//
// 依據: CLAUDE_rulebook.md R-ERR-01; spec/設計要點與取捨.md ADR-085
//   - 計時器之回呼一律經 server/wrapTimer.mjs: 前一次未結束時再觸發即略過; 同步拋錯與 reject 一律攔下交 onError,
//     結束(不論成敗)即釋放, 下一輪照常執行; 包裝本身恆 resolve, onError 自身拋錯亦攔下
//   - procProtect 之 4 個計時器皆經包裝, 錯誤記 srLog.error({ event: 'timer-error', timer, err })
//   - 原「偵測新 IP」之讀取失敗使回呼 reject(無 process 層監聽時後端行程結束)且重入鎖永不釋放
// 計時器回呼由 unitProc.buildProtect 攔得(依 procProtect 內建立順序), 直接呼叫以取代等待 2 秒週期.

import assert from 'assert'
import wrapTimer, { kTimerName } from '../server/wrapTimer.mjs'
import { buildProtect, mkSrLog } from './tools/unitProc.mjs'


//mkEnvIp: 只供「偵測新 IP」計時器所需之替身; fail 可注入 getIpsList 或 ips.insert 之 reject
function mkEnvIp(fail = {}) {
    let n = { getIpsList: 0, insert: 0 }
    let p = {
        getIpsList: async () => {
            n.getIpsList++
            if (fail.getIpsList) {
                return Promise.reject('injected select fail')
            }
            return []
        },
    }
    let woItems = {
        ips: {
            insert: async (d) => {
                n.insert++
                if (fail.insert) {
                    return Promise.reject('injected insert fail')
                }
                return { n: d.length, nInserted: d.length, ok: 1 }
            },
        },
    }
    let srLog = mkSrLog()
    let { pp, timers } = buildProtect(woItems, p, { srLog })
    return { n, pp, timers, srLog }
}


//timerErrors: srLog.error 中 timer-error 之紀錄
let timerErrors = (srLog) => srLog.logs.error.filter((o) => o.event === 'timer-error')


//deferred: 由測試控制結束時機之 promise
function deferred() {
    let done = null
    let pm = new Promise((resolve) => {
        done = resolve
    })
    return { pm, resolve: () => done() }
}


describe('procProtect 計時器之錯誤收斂 (R-ERR-01, ADR-085)', function() {

    it('PT-001 偵測新 IP: 讀取 IP 清單 reject → 回呼不外拋、記 timer-error、下一輪照常讀取(重入鎖已釋放)', async function() {
        let env = mkEnvIp({ getIpsList: true })
        await env.pp.callApiByIp('10.0.0.5')
        //spec: 回呼恆 resolve(原 reject 而於無 process 層監聽時結束行程)
        await env.timers[2]()
        let es = timerErrors(env.srLog)
        assert.strictEqual(es.length, 1)
        assert.deepStrictEqual(es[0], { event: 'timer-error', timer: 'ipDetectNew', err: 'injected select fail' })
        //spec: 結束即釋放, 下一輪照常執行(原重入鎖不釋放, 其後每輪直接 return)
        await env.timers[2]()
        assert.strictEqual(env.n.getIpsList, 2)
        assert.strictEqual(timerErrors(env.srLog).length, 2)
    })

    it('PT-002 偵測新 IP: 新增 IP 列 reject → 回呼不外拋、記 timer-error、下一輪照常新增', async function() {
        let env = mkEnvIp({ insert: true })
        await env.pp.callApiByIp('10.0.0.6')
        await env.timers[2]()
        let es = timerErrors(env.srLog)
        assert.strictEqual(es.length, 1)
        assert.deepStrictEqual(es[0], { event: 'timer-error', timer: 'ipDetectNew', err: 'injected insert fail' })
        await env.timers[2]()
        assert.strictEqual(env.n.insert, 2)
    })

    it('PT-003 包裝: 回呼同步拋錯 → 恆 resolve、onError 收 { timer, err }、可再執行', async function() {
        let nFn = 0
        let got = []
        let run = wrapTimer('t-sync', () => {
            nFn++
            throw new Error('boom')
        }, (o) => got.push(o))
        assert.strictEqual(await run(), undefined)
        assert.strictEqual(got.length, 1)
        assert.strictEqual(got[0].timer, 't-sync')
        assert.strictEqual(got[0].err.message, 'boom')
        await run()
        assert.strictEqual(nFn, 2)
        assert.strictEqual(got.length, 2)
    })

    it('PT-004 包裝: 回呼 reject → 恆 resolve、onError 收原拒絕值、可再執行', async function() {
        let nFn = 0
        let got = []
        let run = wrapTimer('t-reject', async () => {
            nFn++
            return Promise.reject('rejected')
        }, (o) => got.push(o))
        assert.strictEqual(await run(), undefined)
        assert.deepStrictEqual(got, [{ timer: 't-reject', err: 'rejected' }])
        await run()
        assert.strictEqual(nFn, 2)
    })

    it('PT-005 包裝: 前一次未結束時再觸發即略過, 結束後可再執行', async function() {
        let nFn = 0
        let d = deferred()
        let run = wrapTimer('t-reenter', async () => {
            nFn++
            await d.pm
        })
        let pm1 = run()
        await run() //進行中: 略過
        assert.strictEqual(nFn, 1)
        d.resolve()
        await pm1
        await run()
        assert.strictEqual(nFn, 2)
    })

    it('PT-006 包裝: onError 自身拋錯或 reject 亦攔下且仍釋放; fn 非函數於建構時拋錯', async function() {
        for (let [label, onError] of [['sync', () => {
            throw new Error('onError boom')
        }], ['async', async () => Promise.reject('onError rejected')]]) {
            let nFn = 0
            let run = wrapTimer('t-onerror', async () => {
                nFn++
                return Promise.reject('x')
            }, onError)
            assert.strictEqual(await run(), undefined, label)
            await run()
            assert.strictEqual(nFn, 2, label)
        }
        assert.throws(() => wrapTimer('t-bad', null), /invalid fn of timer\[t-bad\]/)
    })

    it('PT-007 procProtect 之 4 個計時器皆經包裝(依建立順序之名稱)', function() {
        let env = mkEnvIp()
        assert.strictEqual(env.timers.length, 4)
        assert.deepStrictEqual(env.timers.map((t) => t[kTimerName]), ['accountLoginFailedPrune', 'tokenCallApi', 'ipDetectNew', 'ipCallApi'])
    })

})
