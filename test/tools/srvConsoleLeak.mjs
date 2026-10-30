//
// srvConsoleLeak.mjs — api-consoleNoLeak.test.mjs 用之獨立後端(私有埠 / 私有資料庫 / 私有 log 資料夾, 不碰 11007 與 ./db)
//
// 與 srv.mjs 的差別:
//   - WOrm 以 WOrmFail 包裝 w-orm-lmdb: 開關檔 CNL_REJECT_FILE 存在時令 users、tokens 表之 select 以 Error reject, 訊息含 CNL_ERRTXT(模擬資料庫驅動之錯誤原文)與 CNL_SECRET;
//     ips 表之 select 遇 CNL_BLOCK_IP 時回一筆封鎖中之虛擬列(不寫庫), 供 verifyConn 之封鎖分支;
//   - 選項 optExt 給含 CNL_SECRET 之設定值(路徑類)、寄信主機(令 SMTP 連線失敗之錯誤原文含 CNL_SECRET)與一個已被忽略之設定鍵, 供啟動期 console 站點;
//   - 框架 error 事件之處理同 srv.mjs(只印錯誤摘要)。
// 其餘(WWebSso、srLog、w-serv-orm 之接線)皆為正式程式碼。
//
// 環境變數: CNL_PORT、CNL_DB_URL、CNL_LOG_FD、CNL_REJECT_FILE、CNL_SECRET、CNL_ERRTXT、CNL_BLOCK_IP
//

import fs from 'fs'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import getDiagBriefErr from 'wsemi/src/getDiagBriefErr.mjs'
import WWebSso from '../../server/WWebSso.mjs'


let port = parseInt(process.env.CNL_PORT, 10)
let dbUrl = process.env.CNL_DB_URL
let logFd = process.env.CNL_LOG_FD
let rejectFile = process.env.CNL_REJECT_FILE
let secret = process.env.CNL_SECRET
let errTxt = process.env.CNL_ERRTXT
let blockIp = process.env.CNL_BLOCK_IP


function WOrmFail(opt) {
    let wo = new WOrmLmdb(opt)
    let select = wo.select
    if (opt.cl === 'users' || opt.cl === 'tokens') {
        wo.select = async (...args) => {
            if (fs.existsSync(rejectFile)) {
                return Promise.reject(new Error(`driver failed ${errTxt} at ${secret} (${opt.cl})`))
            }
            return select.apply(wo, args)
        }
    }
    if (opt.cl === 'ips') {
        wo.select = async (...args) => {
            let find = args[0]
            if (find && find.ip === blockIp) {
                return [{ id: 'ip-cnl-blocked', ip: blockIp, timeBlocked: '2099-01-01T00:00:00.000+08:00' }]
            }
            return select.apply(wo, args)
        }
    }
    return wo
}


let inst = WWebSso(WOrmFail, dbUrl, 'wsso', './settings.json', {
    serverPort: port,
    logFd,
    allowUserRegistration: true, //未給 verifyBaseUrl → 啟動期警告(預設網址為程式自算)
    emSrcHost: secret, //寄信主機: 名稱解析必敗, 錯誤原文含 secret(SMTP 錯誤原文可夾帶主機、收件者)
    emSrcPort: 1,
    emSrcPW: 'cnl-smtp-pw-unused',
    pathTemplate: `./${secret}-dir`, //不存在之資料夾 → 啟動期警告(設定值不得輸出)
    verifyEmailResultContent: `./${secret}.html`, //疑似檔案路徑但不存在 → 啟動期警告(設定值不得輸出)
    useCheckUser: true, //w-serv-orm 已移除之設定鍵 → 啟動期警告(只列鍵名)
})

inst.on('error', (err) => {
    console.log('error', getDiagBriefErr(err))
})
