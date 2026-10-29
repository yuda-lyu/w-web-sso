//
// srvOrmDiag.mjs — api-ormdiag.test.mjs 用之獨立後端(私有埠 / 私有資料庫 / 私有 log 資料夾, 不碰 11007 與 ./db)
//
// 與 srv.mjs 的差別只有 WOrm: 以 WOrmFail 包裝 w-orm-lmdb,
//   - 臨時檔 ORMDIAG_ARM_FILE 存在時令 users 表之 insert 回傳 ok 為 0 之聚合物件(違反 insert 契約之形狀, w-serv-orm 視為失敗並走診斷輸出),
//     且 err 與 id 夾帶測試用之個資字串, 供驗證 srLog 與 stdout 皆不含之;
//   - 臨時檔 ORMDIAG_REJECT_FILE 存在時令 users、tokens 表之 select 以 Error reject, 訊息回顯寄信密碼(ORMDIAG_SMTP_PW; 模擬後端/驅動錯誤夾帶憑證),
//     供驗證本套件直接呼叫資料表之 reject 於進入時已遮罩(回遠端之回應與 srLog 皆不含憑證).
// 其餘(WWebSso、srLog、w-serv-orm 之接線)皆為正式程式碼.
//
// 環境變數: ORMDIAG_PORT(後端埠)、ORMDIAG_DB_URL(lmdb 資料夾)、ORMDIAG_LOG_FD(srLog 資料夾)、ORMDIAG_ARM_FILE(聚合 ok 為 0 之故障開關檔)、
//   ORMDIAG_REJECT_FILE(select reject 之開關檔)、ORMDIAG_SMTP_PW(寄信密碼, 亦為 reject 訊息回顯之憑證)
//

import fs from 'fs'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebSso from '../../server/WWebSso.mjs'


let port = parseInt(process.env.ORMDIAG_PORT, 10)
let dbUrl = process.env.ORMDIAG_DB_URL
let logFd = process.env.ORMDIAG_LOG_FD
let armFile = process.env.ORMDIAG_ARM_FILE
let errSecret = process.env.ORMDIAG_ERR_SECRET || ''
let rejectFile = process.env.ORMDIAG_REJECT_FILE
let smtpPw = process.env.ORMDIAG_SMTP_PW


function WOrmFail(opt) {
    let wo = new WOrmLmdb(opt)
    if (opt.cl === 'users' || opt.cl === 'tokens') {
        let select = wo.select
        wo.select = async (...args) => {
            if (fs.existsSync(rejectFile)) {
                return Promise.reject(new Error(`driver auth failed for password ${smtpPw} at ${opt.cl}`))
            }
            return select.apply(wo, args)
        }
    }
    if (opt.cl === 'users') {
        let insert = wo.insert
        wo.insert = async (...args) => {
            if (fs.existsSync(armFile)) {
                let rows = Array.isArray(args[0]) ? args[0] : [args[0]]
                return { n: rows.length, nInserted: 0, ok: 0, err: `${errSecret} account[${rows[0].account}] email[${rows[0].email}] id[${rows[0].id}]` }
            }
            return insert.apply(wo, args)
        }
    }
    return wo
}


let inst = WWebSso(WOrmFail, dbUrl, 'wsso', './settings.json', {
    serverPort: port,
    verifyBaseUrl: `http://127.0.0.1:${port}`,
    logFd,
    allowUserRegistration: true,
    emSrcHost: '127.0.0.1', //寄信必敗而不外寄(本測試之故障發生在寄信之前, 此為縱深防禦)
    emSrcPort: 1,
    emSrcPW: smtpPw, //寄信密碼: 本套件宣告為診斷遮罩之秘密(R-DIAG-01)
})

inst.on('error', (err) => {
    console.log('[srvOrmDiag] error', err)
})
