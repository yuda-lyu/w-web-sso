import { staLogs } from './staLogsCore.mjs'


//staIp: IP 連線頻率 (verifyConn 依 ip 分組), 由 staLogsCore 單趟掃描取切片; 簽章與輸出形狀不變
async function staIp(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let r = await staLogs(timeLength, timeInterval, opt)
    return r.ip
}


export default staIp
