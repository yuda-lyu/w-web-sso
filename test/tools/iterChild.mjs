//iterChild.mjs — unit-iterClientObj 之子行程執行器(R-OBJ-ITER-01): 在獨立行程內以極大 length 之物件呼叫 procCore, 供父行程以逾時判定是否空轉
//用法: node test/tools/iterChild.mjs <案名>; 結果以單行 JSON 輸出到 stdout: { name, err, ms }
//  rows-length-max: checkTokenAndUpdateUsersList('tk-admin', 'eng', { length: 4294967295 }) —— 不得走訪 length 次, 立即以 invalidRows 拒絕
//父行程以 spawnSync 的 timeout 終止未結束者, 故修改前(空轉)只佔用逾時秒數, 不吊住 mocha.

import ds from '../../src/schema/index.mjs'
import { buildProc, mkSrLog, mkTable, mkProcOrm } from './unitProc.mjs'


let name = process.argv[2]

let users = mkTable([
    { ...ds.users.funNew({ account: 'admin1', name: 'admin1', email: 'admin1@example.com', password: 'x', isAdmin: 'y', timeVerified: '2026-01-01T00:00:00.000+08:00' }), id: 'u-admin', order: 1 },
])
let tokens = mkTable([
    { ...ds.tokens.funNew({ userId: 'u-admin' }), id: 't-admin', token: 'tk-admin', isApp: 'n', timeEnd: '2099-01-01T00:00:00.000+08:00' },
])
let ips = mkTable([])
let woItems = { users, tokens, ips }
let p = buildProc(woItems, mkProcOrm(ds, woItems), { srLog: mkSrLog() })

let t0 = Date.now()
let err = null
if (name === 'rows-length-max') {
    await p.checkTokenAndUpdateUsersList('tk-admin', 'eng', { length: 4294967295 })
        .catch((e) => {
            err = String(e)
        })
}
else {
    err = `unknown case ${name}`
}
console.log(JSON.stringify({ name, err, ms: Date.now() - t0 }))
process.exit(0)
