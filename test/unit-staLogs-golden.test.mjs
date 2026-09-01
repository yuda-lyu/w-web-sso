//staLogsCore golden / 快取 / 併發 / 失敗路徑 單元測試
//對應需求 (tmp/validate-plan.md R01–R12; 契約: 改造前三支掃描器之輸出語意):
//  fixture: test/staLogs-golden/logs/ (由 tmp/zz_gen_golden.mjs 確定性產生, 173 檔)
//  expected: test/staLogs-golden/expected-{hr,day}.json —— 以「改造前」之 staToken/staIp/staUserAccountLogin
//            在假時鐘 FIXED=1788150896789 (2026-08-31 12:34:56.789 +08:00) 下產出, 為本測試之真理來源
//  重產方式: 自 git 歷史還原舊三檔至 tmp/old/ 並改 zz_gen_golden.mjs 之 import, 再 node --import ./tmp/zz_fakeDate.mjs tmp/zz_gen_golden.mjs expected
import './staLogs-golden/setTz.mjs'
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import staToken from '../server/staLogs/staToken.mjs'
import staIp from '../server/staLogs/staIp.mjs'
import staUserAccountLogin from '../server/staLogs/staUserAccountLogin.mjs'
import staTokenWk from '../server/staLogs/staToken.callWorker.mjs'
import staIpWk from '../server/staLogs/staIp.callWorker.mjs'
import staUserAccountLoginWk from '../server/staLogs/staUserAccountLogin.callWorker.mjs'
import { staLogs, scanFiles, scanFile, genPlan, clearCache, getCacheSize } from '../server/staLogs/staLogsCore.mjs'
import srLogInit from '../server/srLog.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdGolden = path.resolve(__dirname, 'staLogs-golden')
let fdLog = path.join(fdGolden, 'logs')
let fdCopy = path.resolve(__dirname, '..', 'tmp', 'golden-copy') //快取/失敗路徑測試用之可寫副本
let fdTmp = path.resolve(__dirname, '..', 'tmp', 'golden-tmp')

let FIXED = 1788150896789
let T_START = FIXED - 7 * 86400000

let expectedHr = JSON.parse(fs.readFileSync(path.join(fdGolden, 'expected-hr.json'), 'utf8'))
let expectedDay = JSON.parse(fs.readFileSync(path.join(fdGolden, 'expected-day.json'), 'utf8'))

function sumKey(rs, key) {
    return rs.reduce((a, r) => a + (r.data[key] || 0), 0)
}

function copyDir(src, dst) {
    fs.rmSync(dst, { recursive: true, force: true })
    fs.mkdirSync(dst, { recursive: true })
    for (let fn of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, fn), path.join(dst, fn))
    }
}

//以 spy 包住 scanFiles, 記錄每次呼叫之檔名清單
function makeSpy() {
    let calls = []
    let fn = async (files, tStartMs, fmt) => {
        calls.push(files.map((f) => f.name))
        return scanFiles(files, tStartMs, fmt)
    }
    return { calls, fn }
}


describe('unit-staLogs-golden', function() {
    this.timeout(300000)

    before(function() {
        assert.strict.equal(new Date().getTimezoneOffset(), -480, '本測試需於 Asia/Taipei 時區執行 (setTz.mjs 已設 TZ)')
        clearCache()
    })

    after(function() {
        fs.rmSync(fdCopy, { recursive: true, force: true })
        fs.rmSync(fdTmp, { recursive: true, force: true })
        clearCache()
    })


    //GOLD-001 (R01): hr 輸出與舊實作 expected 深比較 (169 桶 token/login, 170 桶 ip 含未來時間桶)
    it('GOLD-001-hr-outputs-deep-equal-legacy-expected', async function() {
        clearCache()
        let opt = { fdLog, timeNow: FIXED }
        let token = await staToken(7, 'hr', opt)
        let ip = await staIp(7, 'hr', opt)
        let login = await staUserAccountLogin(7, 'hr', opt)
        assert.deepStrictEqual(token, expectedHr.token, 'staToken hr 應與舊實作 expected 一致')
        assert.deepStrictEqual(ip, expectedHr.ip, 'staIp hr 應與舊實作 expected 一致')
        assert.deepStrictEqual(login, expectedHr.login, 'staUserAccountLogin hr 應與舊實作 expected 一致')
    })


    //GOLD-002 (R01): day 輸出與舊實作 expected 深比較
    it('GOLD-002-day-outputs-deep-equal-legacy-expected', async function() {
        clearCache()
        let opt = { fdLog, timeNow: FIXED }
        let token = await staToken(7, 'day', opt)
        let ip = await staIp(7, 'day', opt)
        let login = await staUserAccountLogin(7, 'day', opt)
        assert.deepStrictEqual(token, expectedDay.token)
        assert.deepStrictEqual(ip, expectedDay.ip)
        assert.deepStrictEqual(login, expectedDay.login)
    })


    //GOLD-003 (R02): ISO 字串 time (非 w-syslog 來源) 仍以 dayjs 解析計入; 'garbage' time 不計入; tStart 恰等不計、+1ms 計
    it('GOLD-003-iso-string-time-counted-garbage-and-boundary-excluded', async function() {
        let ip = await staIp(7, 'hr', { fdLog, timeNow: FIXED })
        assert.strict.equal(sumKey(ip, '9.9.9.9'), 1, 'ISO 字串 time 之 verifyConn 應計入 1 筆')
        assert.strict.equal(sumKey(ip, '8.8.8.8'), 0, 'time 為 garbage 之行不計入')
        assert.strict.equal(sumKey(ip, '1.1.1.1'), 1, '恰等 tStart 不計, tStart+1ms 計 → 1 筆')
        assert.strict.equal(sumKey(ip, '7.7.7.7'), 1, '未來時間桶以聯集保留')
    })


    //GOLD-004 (R07): 無 time 之行不計入任何桶 (刻意差異: 舊實作 ot(undefined) 視為 now 計入當前桶)
    it('GOLD-004-line-without-time-not-counted', async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        let t = ot(FIXED).subtract(3, 'hour')
        let lines = [
            JSON.stringify({ level: 30, event: 'fun-checkToken', userId: 'no-time' }),
            JSON.stringify({ level: 30, time: t.valueOf(), event: 'fun-checkToken', userId: 'has-time' }),
        ]
        fs.writeFileSync(path.join(fdTmp, t.format('YYYY-MM-DDTHH') + '.log'), lines.join('\n') + '\n')
        let token = await staToken(7, 'hr', { fdLog: fdTmp, timeNow: FIXED })
        assert.strict.equal(sumKey(token, 'no-time'), 0, '無 time 之行不計入')
        assert.strict.equal(sumKey(token, 'has-time'), 1)
        assert.strict.equal(sumKey(token, 'count'), 1)
    })


    //GOLD-005 (R12): timeInterval 非法值一律視同 'hr' (fmt 與 unit 一致)
    it('GOLD-005-invalid-timeInterval-treated-as-hr', async function() {
        let plan = genPlan(7, 'xx', { fdLog, timeNow: FIXED })
        assert.strict.equal(plan.timeInterval, 'hr')
        assert.strict.equal(plan.fmt, 'YYYY-MM-DDTHH')
        assert.strict.equal(plan.unit, 'hour')
        assert.strict.equal(plan.kpTime.length, 169)
        let token = await staToken(7, 'xx', { fdLog, timeNow: FIXED })
        assert.deepStrictEqual(token, expectedHr.token, '非法 timeInterval 輸出應等同 hr')
    })


    //GOLD-006 (R04): hr 與 day 交替呼叫, 快取依 fmt 分開 (桶標籤依 fmt 產生, 不可互用); 兩者輸出各自等於 expected
    //  殷鑑: 首版快取只以 fdLog 為鍵, day 之彙總被 hr 沿用 → hr 桶全為 0 (由本測試前身 GOLD-005 抓到)
    it('GOLD-006-hr-and-day-caches-are-separate', async function() {
        clearCache()
        let opt = { fdLog, timeNow: FIXED }
        let d1 = await staToken(7, 'day', opt)
        let h1 = await staToken(7, 'hr', opt)
        let d2 = await staIp(7, 'day', opt)
        let h2 = await staIp(7, 'hr', opt)
        assert.deepStrictEqual(d1, expectedDay.token)
        assert.deepStrictEqual(h1, expectedHr.token)
        assert.deepStrictEqual(d2, expectedDay.ip)
        assert.deepStrictEqual(h2, expectedHr.ip)
        assert.strict.equal(getCacheSize(fdLog, 'hr'), 171)
        assert.strict.equal(getCacheSize(fdLog, 'day'), 173, 'day fmt 之檔名層窗過濾以日期比較, 08-24T10/T11 兩檔保留 (行內窗判斷仍剔除其內容)')
    })


    //GOLD-010 (R03/R04): 第一次全掃; 第二次 (同 now, 檔案未變) 只重掃邊界檔 (minTimeMs ≤ tStart 之檔)
    it('GOLD-010-second-call-rescans-only-boundary-file', async function() {
        clearCache()
        let spy = makeSpy()
        let opt = { fdLog, timeNow: FIXED, scanFiles: spy.fn }
        let r1 = await staLogs(7, 'hr', opt)
        let r2 = await staLogs(7, 'hr', opt)
        assert.strict.equal(spy.calls.length, 2)
        assert.strict.equal(spy.calls[0].length, r1.stat.nFiles, '第一次應掃全部窗內檔')
        assert.strict.equal(r1.stat.nFiles, 171, '窗內檔 = 169 hr 檔 + day 檔 + 非 ISO 檔 (窗外 2 檔已剔)')
        assert.deepStrictEqual(spy.calls[1], ['2026-08-24T12.log'], '第二次只重掃邊界檔')
        assert.strict.equal(r2.stat.nCached, 170)
        assert.deepStrictEqual(r2.token, r1.token)
        assert.deepStrictEqual(r2.ip, r1.ip)
        assert.deepStrictEqual(r2.login, r1.login)
        assert.deepStrictEqual(r2.token, expectedHr.token, '快取路徑輸出仍等於 expected')
    })


    //GOLD-011 (R04): 封閉檔被補寫 (size/mtime 變) → 重掃該檔且計數反映新行
    it('GOLD-011-modified-closed-file-is-rescanned', async function() {
        copyDir(fdLog, fdCopy)
        clearCache()
        let spy = makeSpy()
        let opt = { fdLog: fdCopy, timeNow: FIXED, scanFiles: spy.fn }
        let r1 = await staLogs(7, 'hr', opt)
        let fn = '2026-08-27T03.log'
        let t = ot('2026-08-27T03:30:00')
        fs.appendFileSync(path.join(fdCopy, fn), JSON.stringify({ level: 30, time: t.valueOf(), event: 'verifyConn', ip: '5.5.5.5' }) + '\n')
        let r2 = await staLogs(7, 'hr', opt)
        assert.ok(spy.calls[1].includes(fn), '被補寫之封閉檔應重掃')
        assert.ok(spy.calls[1].includes('2026-08-24T12.log'), '邊界檔照常重掃')
        assert.strict.equal(spy.calls[1].length, 2)
        assert.strict.equal(sumKey(r2.ip, '5.5.5.5'), 1)
        assert.strict.equal(sumKey(r2.ip, 'count'), sumKey(r1.ip, 'count') + 1)
    })


    //GOLD-012 (R04): now 前進 → 窗移動: 舊邊界檔被檔名層剔除、新邊界檔 (minTimeMs ≤ tStart) 重掃; 快取路徑輸出 = 無快取全掃
    it('GOLD-012-window-advance-cached-equals-fresh', async function() {
        copyDir(fdLog, fdCopy)
        clearCache()
        let spy = makeSpy()
        let now2 = FIXED + 2 * 3600000 //2026-08-31 14:34:56.789 → tStart 2026-08-24 14:34:56.789
        await staLogs(7, 'hr', { fdLog: fdCopy, timeNow: FIXED, scanFiles: spy.fn })
        let rCached = await staLogs(7, 'hr', { fdLog: fdCopy, timeNow: now2, scanFiles: spy.fn })
        let rFresh = await staLogs(7, 'hr', { fdLog: fdCopy, timeNow: now2, useCache: false })
        assert.deepStrictEqual(spy.calls[1], ['2026-08-24T14.log'], '窗前進後只重掃新邊界檔')
        assert.deepStrictEqual(rCached.token, rFresh.token)
        assert.deepStrictEqual(rCached.ip, rFresh.ip)
        assert.deepStrictEqual(rCached.login, rFresh.login)
        assert.strict.equal(rCached.token[0].time, '2026-08-24T14')
    })


    //GOLD-013 (R04): cleanLogs 刪舊檔 → 快取項淘汰, 輸出 = 全掃
    it('GOLD-013-deleted-file-evicted-from-cache', async function() {
        copyDir(fdLog, fdCopy)
        clearCache()
        let opt = { fdLog: fdCopy, timeNow: FIXED }
        await staLogs(7, 'hr', opt)
        let n1 = getCacheSize(fdCopy, 'hr')
        fs.rmSync(path.join(fdCopy, '2026-08-25T00.log'))
        let rCached = await staLogs(7, 'hr', opt)
        let rFresh = await staLogs(7, 'hr', { ...opt, useCache: false })
        assert.strict.equal(getCacheSize(fdCopy, 'hr'), n1 - 1, '刪除之檔應自快取淘汰')
        assert.deepStrictEqual(rCached.token, rFresh.token)
        assert.deepStrictEqual(rCached.ip, rFresh.ip)
    })


    //GOLD-014 (R05): 併發呼叫共用同一 in-flight promise, 只掃一趟
    it('GOLD-014-concurrent-calls-single-flight', async function() {
        clearCache()
        let spy = makeSpy()
        let opt = { fdLog, timeNow: FIXED, scanFiles: spy.fn }
        let p1 = staLogs(7, 'hr', opt)
        let p2 = staLogs(7, 'hr', opt)
        let p3 = staToken(7, 'hr', opt)
        assert.strict.equal(p1, p2, '併發呼叫應回同一 promise')
        let [r1, r2, token] = await Promise.all([p1, p2, p3])
        assert.strict.equal(spy.calls.length, 1, '只掃一趟')
        assert.deepStrictEqual(r1.token, r2.token)
        assert.deepStrictEqual(token, expectedHr.token)
    })


    //GOLD-020 (R06): logs/ 下子資料夾略過, 不 throw, 輸出不變
    it('GOLD-020-subfolder-ignored', async function() {
        copyDir(fdLog, fdCopy)
        fs.mkdirSync(path.join(fdCopy, 'sub'))
        fs.writeFileSync(path.join(fdCopy, 'sub', '2026-08-28T01.log'), JSON.stringify({ level: 30, time: ot('2026-08-28T01:10:00').valueOf(), event: 'verifyConn', ip: '6.6.6.6' }) + '\n')
        clearCache()
        let ip = await staIp(7, 'hr', { fdLog: fdCopy, timeNow: FIXED })
        assert.deepStrictEqual(ip, expectedHr.ip, '子資料夾內容不掃、資料夾項目不致 throw')
        assert.strict.equal(sumKey(ip, '6.6.6.6'), 0)
    })


    //GOLD-021 (R06): 單檔讀取失敗 → 略過該檔 (stat.errors 記錄)、其他檔照常, 且該檔不入快取
    it('GOLD-021-single-file-error-skipped-not-cached', async function() {
        copyDir(fdLog, fdCopy)
        clearCache()
        let warns = []
        let srLog = { warn: (o) => warns.push(o) }
        let badName = '2026-08-25T00.log'
        let scanFilesBad = async (files, tStartMs, fmt) => {
            let fs2 = files.map((f) => (f.name === badName ? { ...f, path: path.join(fdCopy, 'not-exist.log') } : f))
            return scanFiles(fs2, tStartMs, fmt)
        }
        let r = await staLogs(7, 'hr', { fdLog: fdCopy, timeNow: FIXED, scanFiles: scanFilesBad, srLog })
        assert.strict.equal(r.stat.errors.length, 1)
        assert.strict.equal(r.stat.errors[0].name, badName)
        assert.strict.equal(warns.length, 1)
        assert.strict.equal(warns[0].key, 'staLogsFileSkipped')
        assert.strict.equal(r.token.length, 169, '其他檔照常, 桶數不變')
        assert.strict.equal(getCacheSize(fdCopy, 'hr'), 170, '失敗檔不入快取 (171-1)')
        //scanFile 對不存在路徑應 reject 而非懸置
        await assert.rejects(scanFile(path.join(fdCopy, 'not-exist.log'), T_START, 'YYYY-MM-DDTHH'))
    })


    //WORKER-001 (R03/R08): worker 版 (procStaInfor 實際使用路徑) 輸出等於 expected
    it('WORKER-001-callWorker-outputs-deep-equal-expected', async function() {
        clearCache()
        let opt = { fdLog, timeNow: FIXED }
        let [token, ip, login] = await Promise.all([
            staTokenWk(7, 'hr', opt),
            staIpWk(7, 'hr', opt),
            staUserAccountLoginWk(7, 'hr', opt),
        ])
        assert.deepStrictEqual(token, expectedHr.token)
        assert.deepStrictEqual(ip, expectedHr.ip)
        assert.deepStrictEqual(login, expectedHr.login)
        //第二次 (只重掃邊界檔) 亦一致
        let token2 = await staTokenWk(7, 'hr', opt)
        assert.deepStrictEqual(token2, expectedHr.token)
    })


    //SRLOG-001 (R10): logNumKeep opt-in; 未給 → 不傳 numKeep (w-syslog 預設); 給錯 → throw; 給正整數 → cleanLogs 依此保留
    it('SRLOG-001-logNumKeep-opt-in', async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        assert.throws(() => srLogInit({ logFd: fdTmp, logInterval: 'hr', logNumKeep: 'abc' }), /logNumKeep/)
        for (let fn of ['2000-01-01T00.log', '2000-01-01T01.log', '2000-01-01T02.log', '2000-01-01T03.log']) {
            fs.writeFileSync(path.join(fdTmp, fn), '')
        }
        let srLog = srLogInit({ logFd: fdTmp, logInterval: 'hr', logNumKeep: 2 })
        srLog.cleanLogs()
        let left = fs.readdirSync(fdTmp).filter((fn) => fn.startsWith('2000-01-01T'))
        assert.deepStrictEqual(left.sort(), ['2000-01-01T02.log', '2000-01-01T03.log'], 'numKeep=2 應只留最新 2 檔 (當前小時檔名更新, 不影響最舊者被刪)')
        await srLog.clear()
        let srLog2 = srLogInit({ logFd: fdTmp, logInterval: 'hr' }) //未給鍵 → 可啟動
        await srLog2.clear()
    })

})
