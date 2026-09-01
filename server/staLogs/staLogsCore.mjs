import fs from 'fs'
import path from 'path'
import readline from 'readline'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import filterVpfsByWindow from './filterVpfsByWindow.mjs'


//staLogsCore: staToken / staIp / staUserAccountLogin 三支統計之共用核心
//  1. 單趟掃描: 每個 log 檔只讀一次, 同時餵三個過濾器 (原三檔各掃一趟)
//  2. 逐行先比 event 再算時間: time 為 epoch ms 數值 (pino) 直接數值比較, 桶鍵以分鐘整數 memo 查表, 不逐行 dayjs
//  3. 檔級彙總快取: w-syslog 依寫入當下時鐘切檔, 整點跨過後舊檔不再被寫入 (transport 緩衝外溢會落新檔而非舊檔),
//     故每檔彙總以 (name, size, mtimeMs) 為鍵快取; 檔內最早可計入行 minTimeMs > tStartMs 時窗過濾為 no-op, 快取可直接沿用,
//     否則 (邊界檔) 重掃; 當前小時檔 size 持續變動自然每次重掃
//  4. single-flight: 同參數併發呼叫共用同一 in-flight promise
//  輸出形狀與原三檔一致 (golden test: test/unit-staLogs-golden.test.mjs 以改造前實作產出之 expected 深比較)
//  刻意差異: 無 time (或 time 無法解析) 之行不計入任何桶 (原實作 ot(undefined) 視為 now 而計入當前桶)


let EV_TOKEN = 'fun-checkToken'
let EV_IP = 'verifyConn'
let EV_LOGIN_BEFORE = 'kpfun-loginByAccountAndPassword-before'
let EV_LOGIN_SUCCESS = 'kpfun-loginByAccountAndPassword-success'
let EV_LOGIN_ERROR = 'kpfun-loginByAccountAndPassword-error'


//快取: fdLog 絕對路徑 → Map(檔名 → { size, mtimeMs, minTimeMs, agg })
let kpCache = new Map()

//single-flight: key → promise
let kpInflight = new Map()


function normTimeInterval(timeInterval) {
    //非 'day' 一律視同 'hr' (原三檔以 ==='day' 決定 fmt、==='hr' 決定 unit, 傳其他值時兩者不一致, 此處收斂為單一判斷)
    return timeInterval === 'day' ? 'day' : 'hr'
}


function genPlan(timeLength = 7, timeInterval = 'hr', opt = {}) {

    //fdLog
    let fdLog = get(opt, 'fdLog')
    if (!isestr(fdLog)) {
        fdLog = './logs'
    }

    //timeInterval, fmt, unit
    let ti = normTimeInterval(timeInterval)
    let fmt = ti === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH'
    let unit = ti === 'day' ? 'day' : 'hour'

    //now, 測試可由 opt.timeNow (epoch ms) 釘住
    let timeNow = get(opt, 'timeNow')
    let now = (typeof timeNow === 'number') ? ot(timeNow) : ot()

    //tStart
    let tStart = now.subtract(timeLength, 'day')
    let tStartMs = tStart.valueOf()

    //kpTime, 產生完整的時間區間
    let tCurr = tStart.startOf(unit)
    let tEnd = now.startOf(unit)
    let kpTime = []
    while (!tCurr.isAfter(tEnd)) {
        kpTime.push(tCurr.format(fmt))
        tCurr = tCurr.add(1, unit)
    }

    return { fdLog, timeInterval: ti, fmt, unit, tStart, tStartMs, kpTime, timeNow: now.valueOf() }
}


function listFiles(fdLog, tStart, fmt) {

    //vpfs
    let vpfs = fsTreeFolder(fdLog)

    //剔除資料夾項目 (fsTreeFolder 會列出子資料夾, 對其開讀取串流會 throw)
    vpfs = vpfs.filter((vpf) => {
        return !get(vpf, 'isFolder', false)
    })

    //開檔前剔除窗外檔, 見該模組註解
    vpfs = filterVpfsByWindow(vpfs, tStart, fmt)

    //stat
    let files = []
    for (let vpf of vpfs) {
        try {
            let st = fs.statSync(vpf.path)
            if (!st.isFile()) {
                continue
            }
            files.push({ path: vpf.path, name: vpf.name, size: st.size, mtimeMs: st.mtimeMs })
        }
        catch (err) {
            //列出後即被移除 (cleanLogs) → 略過
        }
    }

    return files
}


function createBucketLabeler(fmt) {
    //以分鐘整數為 memo 鍵 (任何整分鐘偏移之時區皆與逐行 format 等價), 標籤仍由 dayjs 產生
    let kp = new Map()
    return (tms) => {
        let k = Math.floor(tms / 60000)
        let s = kp.get(k)
        if (s === undefined) {
            s = ot(k * 60000).format(fmt)
            kp.set(k, s)
        }
        return s
    }
}


function toMs(t) {
    if (typeof t === 'number') {
        return t
    }
    if (isestr(t)) {
        return ot(t).valueOf() //ISO 字串 (非 w-syslog 之來源) 走慢路徑; 無法解析回 NaN
    }
    return NaN
}


function readLines(fp, onLine) {
    return new Promise((resolve, reject) => {
        let errTemp = null
        let stream = fs.createReadStream(fp, { encoding: 'utf8' })
        let rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity,
        })
        rl.on('line', onLine)
        let onError = (err) => {
            errTemp = err
            rl.close()
        }
        stream.on('error', onError)
        rl.on('error', onError) //readline Interface 會把 input 之 error 再拋一次, 未監聽即 unhandled
        stream.on('close', () => {
            if (errTemp) {
                reject(errTemp)
            }
            else {
                resolve()
            }
        })
    })
}


async function scanFile(fp, tStartMs, fmt, labeler = null) {
    if (!isfun(labeler)) {
        labeler = createBucketLabeler(fmt)
    }

    //agg, 各桶: token/ip → { count, kp:{id:n} }, login → { attempt, success, error }
    let agg = { minTimeMs: null, token: {}, ip: {}, login: {} }

    await readLines(fp, (line) => {

        //v
        let v = null
        try {
            v = JSON.parse(line)
        }
        catch (err) {
            return
        }
        if (v === null || typeof v !== 'object') {
            return
        }

        //kind, 先以 event 分類, 不命中即 return (不做任何時間運算)
        let e = v.event
        let kind = 0
        if (e === EV_TOKEN) {
            kind = 1
        }
        else if (e === EV_IP) {
            kind = 2
        }
        else if (e === EV_LOGIN_BEFORE) {
            kind = 3
        }
        else if (e === EV_LOGIN_SUCCESS) {
            kind = 4
        }
        else if (e === EV_LOGIN_ERROR) {
            kind = 5
        }
        if (kind === 0) {
            return
        }

        //tms
        let tms = toMs(v.time)
        if (Number.isNaN(tms)) {
            return //無 time 或無法解析: 不計入 (刻意差異, 見檔頭)
        }

        //minTimeMs, 對所有可計入之行取最小值 (不論是否在窗內), 供快取有效性判斷
        if (agg.minTimeMs === null || tms < agg.minTimeMs) {
            agg.minTimeMs = tms
        }

        //窗判斷, 對齊原 t.isAfter(tStart)
        if (!(tms > tStartMs)) {
            return
        }

        //label
        let label = labeler(tms)

        //accumulate
        if (kind === 1) {
            let b = agg.token[label]
            if (b === undefined) {
                b = { count: 0, kp: {} }
                agg.token[label] = b
            }
            b.count += 1
            let id = v.userId
            b.kp[id] = (b.kp[id] || 0) + 1
        }
        else if (kind === 2) {
            let b = agg.ip[label]
            if (b === undefined) {
                b = { count: 0, kp: {} }
                agg.ip[label] = b
            }
            b.count += 1
            let ip = v.ip
            b.kp[ip] = (b.kp[ip] || 0) + 1
        }
        else {
            let b = agg.login[label]
            if (b === undefined) {
                b = { attempt: 0, success: 0, error: 0 }
                agg.login[label] = b
            }
            if (kind === 3) {
                b.attempt += 1
            }
            else if (kind === 4) {
                b.success += 1
            }
            else {
                b.error += 1
            }
        }

    })

    return agg
}


//掃描一批檔案, 回傳 [{ name, ok, agg | err }]; 單檔失敗不影響其他檔 (worker 端亦呼叫此函式)
async function scanFiles(files, tStartMs, fmt) {
    let labeler = createBucketLabeler(fmt)
    let rs = []
    for (let f of files) {
        try {
            let agg = await scanFile(f.path, tStartMs, fmt, labeler)
            rs.push({ name: f.name, ok: true, agg })
        }
        catch (err) {
            rs.push({ name: f.name, ok: false, err: String(get(err, 'message', err)) })
        }
    }
    return rs
}


function mergeAgg(target, agg) {
    for (let label in agg.token) {
        let s = agg.token[label]
        let b = target.token[label]
        if (b === undefined) {
            b = { count: 0, kp: {} }
            target.token[label] = b
        }
        b.count += s.count
        for (let id in s.kp) {
            b.kp[id] = (b.kp[id] || 0) + s.kp[id]
        }
    }
    for (let label in agg.ip) {
        let s = agg.ip[label]
        let b = target.ip[label]
        if (b === undefined) {
            b = { count: 0, kp: {} }
            target.ip[label] = b
        }
        b.count += s.count
        for (let id in s.kp) {
            b.kp[id] = (b.kp[id] || 0) + s.kp[id]
        }
    }
    for (let label in agg.login) {
        let s = agg.login[label]
        let b = target.login[label]
        if (b === undefined) {
            b = { attempt: 0, success: 0, error: 0 }
            target.login[label] = b
        }
        b.attempt += s.attempt
        b.success += s.success
        b.error += s.error
    }
    return target
}


function buildOutputs(merged, kpTime) {

    //對齊原 merge({}, kpTime, gsLog) + Object.keys().sort(): 窗內桶補零, 資料桶 (含未來時間桶) 聯集

    let toRs = (kpZero, kpData, toData) => {
        let kp = {}
        for (let label of kpTime) {
            kp[label] = kpZero()
        }
        for (let label in kpData) {
            kp[label] = toData(kpData[label])
        }
        return Object.keys(kp)
            .sort()
            .map((time) => ({
                time,
                data: kp[time],
            }))
    }

    let token = toRs(
        () => ({ count: 0 }),
        merged.token,
        (b) => ({ count: b.count, ...b.kp }),
    )
    let ip = toRs(
        () => ({ count: 0 }),
        merged.ip,
        (b) => ({ count: b.count, ...b.kp }),
    )
    let login = toRs(
        () => ({ attempt: 0, success: 0, error: 0 }),
        merged.login,
        (b) => ({ attempt: b.attempt, success: b.success, error: b.error }),
    )

    return { token, ip, login }
}


function getCacheDir(fdLogAbs) {
    let m = kpCache.get(fdLogAbs)
    if (!m) {
        m = new Map()
        kpCache.set(fdLogAbs, m)
    }
    return m
}


function clearCache() {
    kpCache.clear()
}


function getCacheKey(fdLog, fmt) {
    //快取鍵含 fmt: 每檔彙總之桶標籤依 fmt 產生, hr/day 不可互用
    return `${path.resolve(fdLog)}|${fmt}`
}


function getCacheSize(fdLog = './logs', timeInterval = 'hr') {
    let fmt = normTimeInterval(timeInterval) === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH'
    let m = kpCache.get(getCacheKey(fdLog, fmt))
    return m ? m.size : 0
}


async function run(plan, opt = {}) {

    //useCache
    let useCache = get(opt, 'useCache') !== false

    //scanFilesFn, callWorker 注入 worker 版
    let scanFilesFn = get(opt, 'scanFiles')
    if (!isfun(scanFilesFn)) {
        scanFilesFn = scanFiles
    }

    //srLog
    let srLog = get(opt, 'srLog', null)

    //files
    let files = listFiles(plan.fdLog, plan.tStart, plan.fmt)

    //cacheDir
    let cacheDir = getCacheDir(getCacheKey(plan.fdLog, plan.fmt))

    //分流: 快取可沿用 vs 需重掃
    let toScan = []
    let kpAgg = {} //name → agg (依 files 順序合併)
    for (let f of files) {
        let c = useCache ? cacheDir.get(f.name) : undefined
        let b = c !== undefined &&
            c.size === f.size &&
            c.mtimeMs === f.mtimeMs &&
            (c.minTimeMs === null || c.minTimeMs > plan.tStartMs)
        if (b) {
            kpAgg[f.name] = c.agg
        }
        else {
            toScan.push(f)
        }
    }

    //淘汰已不存在之檔 (cleanLogs 刪舊檔)
    if (useCache) {
        let kpName = new Set(files.map((f) => f.name))
        for (let name of cacheDir.keys()) {
            if (!kpName.has(name)) {
                cacheDir.delete(name)
            }
        }
    }

    //scan
    let errors = []
    if (toScan.length > 0) {
        let rs = await scanFilesFn(toScan.map((f) => ({ path: f.path, name: f.name })), plan.tStartMs, plan.fmt)
        let kpRs = {}
        for (let r of rs) {
            kpRs[r.name] = r
        }
        for (let f of toScan) {
            let r = kpRs[f.name]
            if (r && r.ok) {
                kpAgg[f.name] = r.agg
                if (useCache) {
                    cacheDir.set(f.name, { size: f.size, mtimeMs: f.mtimeMs, minTimeMs: r.agg.minTimeMs, agg: r.agg })
                }
            }
            else {
                //單檔失敗: 略過該檔且不入快取 (下次再試), 不整體失敗
                let err = get(r, 'err', 'no result')
                errors.push({ name: f.name, err })
                if (useCache) {
                    cacheDir.delete(f.name)
                }
                if (srLog && isfun(srLog.warn)) {
                    srLog.warn({ event: 'fun-staLogs', key: 'staLogsFileSkipped', name: f.name, err })
                }
            }
        }
    }

    //merge
    let merged = { token: {}, ip: {}, login: {} }
    for (let f of files) {
        let agg = kpAgg[f.name]
        if (agg) {
            mergeAgg(merged, agg)
        }
    }

    //outputs
    let r = buildOutputs(merged, plan.kpTime)
    r.stat = {
        nFiles: files.length,
        nScanned: toScan.length,
        nCached: files.length - toScan.length,
        errors,
    }

    return r
}


function staLogs(timeLength = 7, timeInterval = 'hr', opt = {}) {
    //非 async: 併發呼叫須回傳同一個 promise 物件 (async 包裝會另建 promise)

    //plan
    let plan = genPlan(timeLength, timeInterval, opt)

    //single-flight
    let key = JSON.stringify([path.resolve(plan.fdLog), timeLength, plan.timeInterval, get(opt, 'timeNow', null)])
    if (kpInflight.has(key)) {
        return kpInflight.get(key)
    }
    let pm = run(plan, opt)
        .finally(() => {
            kpInflight.delete(key)
        })
    kpInflight.set(key, pm)

    return pm
}


export { staLogs, genPlan, listFiles, scanFile, scanFiles, mergeAgg, buildOutputs, clearCache, getCacheSize, normTimeInterval }
export default staLogs
