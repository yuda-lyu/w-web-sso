import { fileURLToPath } from 'url'
import path from 'path'
import { Worker } from 'worker_threads'
import genPm from 'wsemi/src/genPm.mjs'
import { staLogs as staLogsCore } from './staLogsCore.mjs'


let __filename = fileURLToPath(import.meta.url)
let __dirname = path.dirname(__filename)

let fpWkDefault = path.resolve(__dirname, 'staLogsCore.shellWorker.mjs')


//runWorker: 以單一 worker 執行掃描, 回傳 worker 之 payload; fpWk 可注入 (測試用)
//  終止路徑一律走 settle(): message(done/error) / error / exit 三者任一先到者定案, 其餘為 no-op, 且皆 terminate 回收
//  exit 為必要: worker 未送任何訊息即結束 (如 worker 內 process.exit) 時若無 exit 監聽, promise 永不落定,
//  又因 staLogsCore 之 single-flight 以 finally 釋放 in-flight key, 該 key 會永久卡死 (後續同參數呼叫皆取得死 promise, 需重啟後端)
function runWorker(param, fpWk = fpWkDefault) {
    let pm = genPm()

    //wk
    let wk = new Worker(fpWk)

    //settle
    let settled = false
    let settle = (fn, v) => {
        if (!settled) {
            settled = true
            fn(v)
        }
        try {
            wk.terminate()
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


export { staLogs, scanFilesByWorker, runWorker }
export default staLogs
