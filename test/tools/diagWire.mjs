import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'


//ORM 診斷轉接器(server/WWebSso.mjs 之 funLog)的接線取樣: 不另手寫一份「看起來一樣」的轉接器, 而是從 WWebSso.mjs 原始碼取出產生 funLog 的那一行運算式,
//以真實的 genDiagFunLog、真實的 SAFE_KEYS(w-serv-orm 公開入口)與測試提供的 srLog 求值, 因此 WWebSso.mjs 的接線改了(拿掉 safeKeys、換成別的名單、換寫入出口), 本函數的行為隨之改變, 測試才抓得到
//(scenario B: 路徑落在套件自身資料夾, 用 fileURLToPath, 全域 §7.1)
let __dirname = path.dirname(fileURLToPath(import.meta.url))
let pathRoot = path.join(__dirname, '..', '..')
let pathWWebSso = path.join(pathRoot, 'server', 'WWebSso.mjs')


//stripComments: 去除行註解與區塊註解(僅供盤點接線行, 不處理字串內的 //)
function stripComments(s) {
    return s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}


//getWiredExpr: 取出 WWebSso.mjs 中 `let { funLog } = <運算式>` 的運算式字串; 恰須一行, 否則拋錯(接線被拆散時要讓測試顯式失敗, 而非靜默改測別的)
function getWiredExpr(file = pathWWebSso) {
    let c = stripComments(fs.readFileSync(file, 'utf8'))
    let ms = [...c.matchAll(/^[ \t]*let \{ funLog \} = (.+?)[ \t]*$/gm)]
    if (ms.length !== 1) {
        throw new Error(`${file}: 'let { funLog } = ...' 應恰一行, 實際 ${ms.length} 行`)
    }
    return ms[0][1]
}


//mkWiredFunLog: 以真實接線運算式組出 { funLog, close }; 運算式可引用的識別字僅 genDiagFunLog / srLog / SAFE_KEYS, 多引用其他識別字即 ReferenceError(接線被改成引用別處時顯式失敗)
function mkWiredFunLog(srLog, file = pathWWebSso) {
    let expr = getWiredExpr(file)
    // eslint-disable-next-line no-new-func
    let fn = new Function('genDiagFunLog', 'srLog', 'SAFE_KEYS', `return (${expr})`)
    return fn(genDiagFunLog, srLog, SAFE_KEYS)
}


export {
    pathRoot,
    pathWWebSso,
    stripComments,
    getWiredExpr,
    mkWiredFunLog
}
