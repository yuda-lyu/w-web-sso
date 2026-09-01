import { staLogs } from './staLogsCore.callWorker.mjs'


//staIp (worker 版): 掃描交由 staLogsCore 單一 worker, 快取與 single-flight 在主執行緒; 簽章與輸出形狀不變
async function staIp(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let r = await staLogs(timeLength, timeInterval, opt)
    return r.ip
}


export default staIp
