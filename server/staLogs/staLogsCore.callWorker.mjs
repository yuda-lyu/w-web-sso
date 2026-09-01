import { fileURLToPath } from 'url'
import path from 'path'
import { Worker } from 'worker_threads'
import genPm from 'wsemi/src/genPm.mjs'
import { staLogs as staLogsCore } from './staLogsCore.mjs'


let __filename = fileURLToPath(import.meta.url)
let __dirname = path.dirname(__filename)


//scanFilesByWorker: 把「需重掃之檔案清單」交給單一 worker 掃描 (主執行緒不阻塞), 回傳每檔彙總
async function scanFilesByWorker(files, tStartMs, fmt) {

    //無需重掃時不 spawn
    if (files.length === 0) {
        return []
    }

    let pm = genPm()

    //fpWk
    let fpWk = path.resolve(__dirname, 'staLogsCore.shellWorker.mjs')

    //wk
    let wk = new Worker(fpWk)

    wk.on('message', (msg) => {

        if (msg.mode === 'done') {
            pm.resolve(msg.payload)
        }
        else if (msg.mode === 'error') {
            pm.reject(msg.payload)
        }

        wk.terminate()

    })

    wk.on('error', (err) => {
        pm.reject(err)
    })

    wk.postMessage({
        files,
        tStartMs,
        fmt,
    })

    return pm
}


async function staLogs(timeLength = 7, timeInterval = 'hr', opt = {}) {
    return staLogsCore(timeLength, timeInterval, { ...opt, scanFiles: scanFilesByWorker })
}


export { staLogs, scanFilesByWorker }
export default staLogs
