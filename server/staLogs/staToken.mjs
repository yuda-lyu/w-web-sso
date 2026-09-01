import { staLogs } from './staLogsCore.mjs'


//staToken: 金鑰使用頻率 (fun-checkToken 依 userId 分組), 由 staLogsCore 單趟掃描取切片; 簽章與輸出形狀不變
async function staToken(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let r = await staLogs(timeLength, timeInterval, opt)
    return r.token
}


export default staToken
