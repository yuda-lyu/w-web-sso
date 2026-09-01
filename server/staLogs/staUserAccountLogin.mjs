import { staLogs } from './staLogsCore.mjs'


//staUserAccountLogin: 使用者登入頻率 (kpfun-loginByAccountAndPassword-{before,success,error} → attempt/success/error),
//由 staLogsCore 單趟掃描取切片; 簽章與輸出形狀不變
async function staUserAccountLogin(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let r = await staLogs(timeLength, timeInterval, opt)
    return r.login
}


export default staUserAccountLogin
