import { parentPort } from 'worker_threads'
import { scanFiles } from './staLogsCore.mjs'


//worker 只負責掃描主執行緒交付之檔案清單, 回傳每檔彙總; 快取本體留在主執行緒 (staLogsCore.mjs)
parentPort.on('message', async (param) => {
    try {
        let r = await scanFiles(param.files, param.tStartMs, param.fmt)
        parentPort.postMessage({
            mode: 'done',
            payload: r,
        })
    }
    catch (err) {
        parentPort.postMessage({
            mode: 'error',
            payload: String((err && err.message) || err),
        })
    }
})
