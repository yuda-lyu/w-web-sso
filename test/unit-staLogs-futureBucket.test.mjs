//unit-staLogs-futureBucket.test.mjs — 統計之桶輸出不含晚於「現在」所屬桶之未來時間桶 (規則 R-STA-01, ADR-102; Gitea #56)
//
//規則 (翻譯為斷言之來源句):
//  R1  輸出以「現在所屬桶」(timeNow 所屬之桶, 窗之最末桶) 為上界, 晚於它之資料桶一律不輸出 (hr / day; token / ip / login 三種輸出)
//  R2  現在所屬桶內略晚於 timeNow 之紀錄照計 (統計執行期間新寫入者不被丟棄); 上界以「桶」為單位, 不以 timeNow 之毫秒為單位
//  R3  只在輸出層過濾, 掃描與快取不動: 快取開啟時 timeNow 移到未來紀錄之後, 該桶須出現且計數正確, 且不影響先前之查詢結果
//  R4  合法輸入 (無未來紀錄) 之輸出與修前逐位元相同 (由 golden 與 L3 前後 diff 證明, 見 test/unit-staLogs-golden.test.mjs)
//  成因: 紀錄之 time 取寫入當下之真實時鐘, 而統計之「現在」可由 opt.timeNow 或程序級假時鐘釘住; 兩者不一致時 (或時鐘回撥) 輸出多出窗外之桶
//
//中介資料落 test/_tmp/unit-staLogs-futureBucket/ (gitignore, after 清除); 時間一律以本機時區之 dayjs 推算 (桶標籤依本機時區產生)

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import { staLogs, buildOutputs, clearCache } from '../server/staLogs/staLogsCore.mjs'
import procStaInfor from '../server/procStaInfor.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdRoot = path.resolve(__dirname, '_tmp', 'unit-staLogs-futureBucket')

let NOW_T = ot('2026-01-02T12:00:00') //統計之「現在」(本機時區之整點, 使 hr 桶為 2026-01-02T12, day 桶為 2026-01-02)
let NOW = NOW_T.valueOf()
let H = 3600 * 1000
let FUTURE_T = NOW_T.add(300, 'day') //300 日後 (本機時區之 2026-10-29 12:00)
let KEYS = ['token', 'ip', 'login']
let FMT = { hr: 'YYYY-MM-DDTHH', day: 'YYYY-MM-DD' }


//一個時刻寫入五種統計事件各一行: token (fun-checkToken) / ip (verifyConn) / login (before、success、error)
function evLines(tms) {
    let line = (o) => JSON.stringify({ level: 30, time: tms, pid: 1, hostname: 'h', ...o })
    return [
        line({ event: 'fun-checkToken', userId: 'u1' }),
        line({ event: 'verifyConn', ip: '10.0.0.1' }),
        line({ event: 'kpfun-loginByAccountAndPassword-before', account: 'a' }),
        line({ event: 'kpfun-loginByAccountAndPassword-success', account: 'a' }),
        line({ event: 'kpfun-loginByAccountAndPassword-error', account: 'a', err: 'x' }),
    ]
}

//於 fd 下以檔名 name 寫入各時刻之事件行 (檔名只影響檔名層過濾, 與紀錄 time 無關)
function writeLog(fd, name, times) {
    fs.mkdirSync(fd, { recursive: true })
    let lines = []
    for (let t of times) {
        lines.push(...evLines(t))
    }
    fs.writeFileSync(path.join(fd, name), lines.join('\n') + '\n', 'utf8')
}

//窗內基本資料: 2 小時前 3 筆 (桶 2026-01-02T10)、現在所屬桶 2 筆 (整點當下與 +60 秒, 後者略晚於 timeNow)
function writeBase(fd) {
    writeLog(fd, '2026-01-02T10.log', [NOW - 2 * H, NOW - 2 * H + 1000, NOW - 2 * H + 2000])
    writeLog(fd, '2026-01-02T12.log', [NOW, NOW + 60 * 1000])
}

let run = (fdLog, ti, opt = {}) => staLogs(7, ti, { fdLog, timeNow: NOW, useCache: false, ...opt })

//取各 key 之最末桶標籤
let lastLabel = (r, key) => r[key][r[key].length - 1].time


describe('unit-staLogs-futureBucket', function() {
    this.timeout(300000)

    let fdClean = path.join(fdRoot, 'clean') //只有窗內紀錄
    let fdDirty = path.join(fdRoot, 'dirty') //窗內紀錄 + 300 日後之紀錄

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        writeBase(fdClean)
        writeBase(fdDirty)
        writeLog(fdDirty, '2026-10-29T12.log', [FUTURE_T.valueOf(), FUTURE_T.valueOf() + 1000]) //檔名亦為未來時段
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    beforeEach(function() {
        clearCache()
    })


    //FUT-001 (R1; issue §2.1): 記錄目錄放窗內紀錄與 300 日後之紀錄, 輸出須與移除未來紀錄時相同; hr、day 皆驗, 三種輸出皆驗
    for (let ti of ['hr', 'day']) {
        for (let key of KEYS) {
            it(`FUT-001-${ti}-${key}: 未來紀錄不產生桶, 輸出與無該紀錄時相同, 且無晚於現在所屬桶之標籤`, async function() {
                let r0 = await run(fdClean, ti)
                let r1 = await run(fdDirty, ti)
                let labelNow = NOW_T.format(FMT[ti])
                assert.deepStrictEqual(r1[key], r0[key])
                assert.strictEqual(r1[key].some((v) => v.time > labelNow), false, `${ti}/${key} 不得含晚於 ${labelNow} 之桶`)
                assert.strictEqual(lastLabel(r1, key), labelNow, `${ti}/${key} 最末桶須為現在所屬桶`)
            })
        }
    }


    //FUT-002 (R2; issue §2.2): 現在所屬桶內略晚於 timeNow 之紀錄仍計入 (整點當下 1 筆 + 60 秒後 1 筆 = 2 筆), 且為最末桶
    for (let ti of ['hr', 'day']) {
        it(`FUT-002-${ti}: 現在所屬桶內略晚於 timeNow 之紀錄照計`, async function() {
            let r = await run(fdDirty, ti)
            let labelNow = NOW_T.format(FMT[ti])
            for (let key of KEYS) {
                assert.strictEqual(lastLabel(r, key), labelNow)
            }
            let b = (key) => r[key].find((v) => v.time === labelNow).data
            //hr: 現在所屬桶只有該小時內之 2 筆; day: 同日 5 筆 (2 小時前 3 筆 + 該 2 筆)
            let n = ti === 'hr' ? 2 : 5
            assert.strictEqual(b('token').count, n)
            assert.strictEqual(b('ip').count, n)
            assert.deepStrictEqual(b('login'), { attempt: n, success: n, error: n })
        })
    }


    //FUT-003 (R1、R2 邊界; 對上界之「>」判定): 現在所屬桶之最後 1 毫秒計入, 下一桶之第 1 毫秒不計入
    for (let ti of ['hr', 'day']) {
        it(`FUT-003-${ti}: 上界為桶邊界 (桶末 1 毫秒計入, 下一桶起點 0 毫秒不計入)`, async function() {
            let fd = path.join(fdRoot, `boundary-${ti}`)
            let unit = ti === 'hr' ? 'hour' : 'day'
            let tEnd = NOW_T.endOf(unit).valueOf() //現在所屬桶之最後 1 毫秒
            let tNext = tEnd + 1 //下一桶之起點
            writeLog(fd, '2026-01-02T10.log', [NOW - 2 * H])
            writeLog(fd, `${NOW_T.format('YYYY-MM-DDTHH')}-end.log`, [tEnd]) //檔名帶後綴, 僅為避開同名
            writeLog(fd, `${ot(tNext).format('YYYY-MM-DDTHH')}-next.log`, [tNext])
            let r = await run(fd, ti)
            let labelNow = NOW_T.format(FMT[ti])
            let nextLabel = ot(tNext).format(FMT[ti])
            assert.notStrictEqual(nextLabel, labelNow)
            for (let key of KEYS) {
                assert.strictEqual(lastLabel(r, key), labelNow, `${ti}/${key} 最末桶須為 ${labelNow}, 不含 ${nextLabel}`)
                assert.strictEqual(r[key].some((v) => v.time === nextLabel), false)
            }
            //桶末 1 毫秒之紀錄計入現在所屬桶: hr 時現在所屬桶只有該筆 (1 筆); day 時另含 2 小時前之 1 筆 (共 2 筆)
            let n = ti === 'hr' ? 1 : 2
            assert.strictEqual(r.ip.find((v) => v.time === labelNow).data.count, n)
            assert.strictEqual(r.token.find((v) => v.time === labelNow).data.count, n)
        })
    }


    //FUT-004 (R3; issue §2.3): 快取開啟, timeNow 移到未來紀錄之後, 該桶須出現且計數正確; 掃描與快取不因先前查詢而遺失、亦不被污染
    it('FUT-004: 快取開啟時 timeNow 移到未來紀錄之後, 未來桶出現且計數正確 (沿用快取之彙總)', async function() {
        let T1 = FUTURE_T.add(30, 'minute').valueOf() //未來紀錄之後 (同屬 2026-10-29T12 桶)
        let labelFuture = FUTURE_T.format(FMT.hr)

        //先以 timeNow = NOW 查詢 (快取開啟): 未來桶不輸出, 但其彙總已入快取
        let r0 = await staLogs(7, 'hr', { fdLog: fdDirty, timeNow: NOW })
        assert.strictEqual(r0.ip.some((v) => v.time === labelFuture), false)
        assert.strictEqual(r0.stat.nCached, 0)

        //再以 timeNow = T1 查詢: 未來檔之彙總沿用快取 (nCached >= 1), 未來桶出現, 計數 = 該檔之 2 筆
        let r1 = await staLogs(7, 'hr', { fdLog: fdDirty, timeNow: T1 })
        assert.ok(r1.stat.nCached >= 1, `未來檔之彙總應沿用快取, nCached=${r1.stat.nCached} nFiles=${r1.stat.nFiles}`)
        assert.strictEqual(lastLabel(r1, 'ip'), labelFuture)
        assert.strictEqual(r1.ip.find((v) => v.time === labelFuture).data.count, 2)
        assert.strictEqual(r1.token.find((v) => v.time === labelFuture).data.count, 2)
        assert.deepStrictEqual(r1.login.find((v) => v.time === labelFuture).data, { attempt: 2, success: 2, error: 2 })

        //沿用快取之輸出 = 不用快取全掃之輸出
        let r1f = await staLogs(7, 'hr', { fdLog: fdDirty, timeNow: T1, useCache: false })
        for (let key of KEYS) {
            assert.deepStrictEqual(r1[key], r1f[key])
        }

        //timeNow 回到 NOW: 結果與第一次相同 (T1 之查詢未污染)
        let r2 = await staLogs(7, 'hr', { fdLog: fdDirty, timeNow: NOW })
        for (let key of KEYS) {
            assert.deepStrictEqual(r2[key], r0[key])
        }
    })


    //FUT-005 (R1): 窗為空 (timeLength 為負, 窗之起點晚於現在) 時不拋錯, 因無任何紀錄屬於「現在所屬桶以前」, 三種輸出皆為空陣列
    for (let ti of ['hr', 'day']) {
        it(`FUT-005-${ti}: 窗為空時未來紀錄不輸出, 不拋錯`, async function() {
            let r = await staLogs(-1, ti, { fdLog: fdDirty, timeNow: NOW, useCache: false })
            for (let key of KEYS) {
                assert.deepStrictEqual(r[key], [], `${ti}/${key}`)
            }
        })
    }


    //FUT-006 (R1): 桶標籤為定寬 4 位數年之字串, 字典序即時間序; time 為垃圾值而年份達 5 位數以上 (如 12000 年) 者, 字串比較會錯置 → 仍視為未來而不輸出
    it('FUT-006: 年份達 5 位數之垃圾 time 不產生桶 (字典序不可誤判為過去)', async function() {
        let fd = path.join(fdRoot, 'garbage-year')
        writeBase(fd)
        writeLog(fd, 'notes.log', [Date.UTC(12000, 0, 1), Date.UTC(30000, 5, 1)]) //非 ISO 檔名, 檔名層過濾 fail-open 保留
        let r0 = await run(fdClean, 'hr')
        let r1 = await run(fd, 'hr')
        for (let key of KEYS) {
            assert.deepStrictEqual(r1[key], r0[key], key)
        }
    })


    //FUT-007 (R1): buildOutputs 之上界參數: 省略時取 kpTime 之最末桶; 給定時以給定者為準; 上界桶本身保留
    it('FUT-007: buildOutputs 以 kpTime 最末桶 (或明給之 labelEnd) 為上界', function() {
        let merged = {
            token: {
                '2026-01-02T11': { count: 1, kp: { u1: 1 } },
                '2026-01-02T12': { count: 2, kp: { u1: 2 } },
                '2026-01-02T13': { count: 4, kp: { u1: 4 } },
            },
            ip: {},
            login: { '2026-01-02T14': { attempt: 1, success: 0, error: 0 } },
        }
        let kpTime = ['2026-01-02T11', '2026-01-02T12']
        let r = buildOutputs(merged, kpTime)
        assert.deepStrictEqual(r.token.map((v) => v.time), kpTime)
        assert.strictEqual(r.token[1].data.count, 2)
        assert.deepStrictEqual(r.login.map((v) => v.time), kpTime)
        assert.deepStrictEqual(r.login.map((v) => v.data), [{ attempt: 0, success: 0, error: 0 }, { attempt: 0, success: 0, error: 0 }])
        let r2 = buildOutputs(merged, kpTime, '2026-01-02T13')
        assert.deepStrictEqual(r2.token.map((v) => v.time), ['2026-01-02T11', '2026-01-02T12', '2026-01-02T13'])
        assert.deepStrictEqual(r2.login.map((v) => v.time), ['2026-01-02T11', '2026-01-02T12'])
    })


    //FUT-008 (R1; 下游消費端): 後台統計 getStaIp / getStaIpSummary (近 24 小時連線數 conn24h) 不含未來時間桶 (真實時鐘; 經真 worker)
    //  procStaInfor.getStaIpSummary 以 `t >= 24 小時前` 加總各桶, 無上界, 修前未來桶之筆數會併入 conn24h
    it('FUT-008: getStaIp 不含未來時間桶, getStaIpSummary.conn24h 只含過去與現在所屬桶之筆數', async function() {
        let fd = path.join(fdRoot, 'proc-real-clock')
        let now = ot()
        let nowBucket = now.format(FMT.hr)
        let tPast = now.subtract(1, 'hour').valueOf() //1 小時前 3 筆 (計入 conn24h)
        let times = [tPast, tPast + 1000, tPast + 2000]
        let tFuture = now.add(30, 'day').valueOf() //30 日後 2 筆 (不得輸出, 不得計入 conn24h)
        let tNextHours = now.add(2, 'hour').valueOf() //2 小時後 1 筆 (不得輸出, 不得計入 conn24h)
        let lines = []
        for (let t of [...times, tFuture, tFuture + 1000, tNextHours]) {
            lines.push(JSON.stringify({ level: 30, time: t, pid: 1, hostname: 'h', event: 'verifyConn', ip: '10.9.9.9' }))
        }
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, 'fixture.log'), lines.join('\n') + '\n', 'utf8') //非 ISO 檔名, 檔名層過濾 fail-open 保留
        let p = {
            getIpsListCache: async () => [],
            getUsersListCache: async () => [],
            getTokensListCache: async () => [],
        }
        let pf = procStaInfor({}, p, { srLog: null, logFd: fd })
        let sis = await pf.getStaIp()
        assert.strictEqual(sis.some((v) => v.time > nowBucket), false, '不得含晚於現在所屬桶之標籤')
        assert.strictEqual(sis[sis.length - 1].time, nowBucket)
        let r = await pf.getStaIpSummary()
        assert.strictEqual(r.conn24h, 3)
    })

})
