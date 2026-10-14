import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import genPm from 'wsemi/src/genPm.mjs'
import { staLogs as staLogsCore } from './staLogsCore.mjs'
import resolveShellWorker from './resolveShellWorker.mjs'


//worker 檔之路徑: 首次使用時解析並快取(規則帳本 R-PKG-01; X1, ADR-086). 頂層不宣告 __filename／__dirname、不於載入時以模組位置組路徑:
//本檔被打包成 umd 時, rollup 把 import.meta.url 換成引用 __filename 之墊片且不避讓該名, 頂層同名宣告(本檔或同一 bundle 內任一模組)使載入即 TDZ;
//且打包後模組位置為 bundle 所在之 dist/, 其下無 worker 檔. 亦不可改用 import.meta.dirname／filename／resolve(umd 換成 undefined).
//import.meta.url 只在函數內使用(呼叫時才求值); 解析失敗不快取, 下次呼叫重試
let fpWkCache = ''
function getShellWorkerPath() {
    if (fpWkCache === '') {
        fpWkCache = resolveShellWorker({ fpSelf: fileURLToPath(import.meta.url) })
    }
    return fpWkCache
}


//runWorker: 以單一 worker 執行掃描, 回傳 worker 之 payload; fpWk 可注入 (測試用), 未給則以 getShellWorkerPath 解析
//  解析失敗時 reject 該 Error(訊息含已試之位置), 不 spawn
//  終止路徑一律走 settle(): message(done/error) / error / exit 三者任一先到者定案, 其餘為 no-op, 且皆 terminate 回收
//  exit 為必要: worker 未送任何訊息即結束 (如 worker 內 process.exit) 時若無 exit 監聽, promise 永不落定,
//  又因 staLogsCore 之 single-flight 以 finally 釋放 in-flight key, 該 key 會永久卡死 (後續同參數呼叫皆取得死 promise, 需重啟後端)
function runWorker(param, fpWk = '') {
    let pm = genPm()

    //fpWk
    if (typeof fpWk !== 'string' || fpWk === '') {
        try {
            fpWk = getShellWorkerPath()
        }
        catch (err) {
            pm.reject(err)
            return pm
        }
    }

    //wk
    let wk = new Worker(fpWk)

    //settle
    let settled = false
    let settle = (fn, v) => {
        if (!settled) {
            settled = true
            fn(v)
        }
        //terminate 回傳 Promise 且不 await: 於源頭 catch(本套件不註冊行程層錯誤監聽, w-serv-hapi 1.1.6 起亦不代為吞錯, 未處理之 rejection 即終止行程; R-ERR-01)
        try {
            wk.terminate().catch(() => {})
        }
        catch (err) {}
    }

    wk.on('message', (msg) => {
        if (msg.mode === 'done') {
            settle(pm.resolve, msg.payload)
        }
        else if (msg.mode === 'error') {
            settle(pm.reject, msg.payload)
        }
    })

    wk.on('error', (err) => {
        settle(pm.reject, err)
    })

    wk.on('exit', (code) => {
        settle(pm.reject, new Error(`staLogs worker exited without result, code=${code}`))
    })

    wk.postMessage(param)

    return pm
}


//scanFilesByWorker: 把「需重掃之檔案清單」交給單一 worker 掃描 (主執行緒不阻塞), 回傳每檔彙總
async function scanFilesByWorker(files, tStartMs, fmt) {

    //無需重掃時不 spawn
    if (files.length === 0) {
        return []
    }

    return runWorker({ files, tStartMs, fmt })
}


function staLogs(timeLength = 7, timeInterval = 'hr', opt = {}) {
    //非 async: 保留核心之 single-flight promise 識別
    return staLogsCore(timeLength, timeInterval, { ...opt, scanFiles: scanFilesByWorker })
}


export { staLogs, scanFilesByWorker, runWorker, getShellWorkerPath }
export default staLogs
