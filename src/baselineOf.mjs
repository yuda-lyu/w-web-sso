import { buildBaseline, digestRow } from 'w-serv-orm/src/baseline.mjs'
import contracts from './writeContracts/index.mjs'


//後台三個清單頁(使用者 / 金鑰 / IP)共用之基準工具 (多人同時編輯之寫入契約, 原則 10; 規則帳本 rulebook_concurrency R-CONC-05):
//前端於載入(及存檔成功後重新讀取)時, 以 buildBaseline 對「畫面所見之同一快照」自算有序基準 [[id, 列摘要]], 存檔時隨第 4 參數送後端;
//後端於表鎖內新鮮讀取、重算比對, 不符整次拒收(零寫入, 先動先贏, 回 saveStale 等語系鍵提示重新載入). 不另向後端取雜湊, RPC 回傳形狀不變.
//算不出基準(列格式異常等)回 null: 送出時 null 被後端視為格式不識而拒收 saveBaselineFormat(提示重新載入), 不降級為不帶基準.


//safeBaseline
function safeBaseline(rows, contract) {
    try {
        return buildBaseline(rows, contract)
    }
    catch (err) {
        console.log('buildBaseline catch', err)
        return null
    }
}


//baselineOfUsers: rows 為 getUsersList 之回傳(未排序、未變動); 回傳基準陣列或 null
function baselineOfUsers(rows) {
    return safeBaseline(rows, contracts.users)
}


//baselineOfIps: rows 為 getIpsList 之回傳
function baselineOfIps(rows) {
    return safeBaseline(rows, contracts.ips)
}


//baselineOfTokens: rows 為 getTokensList 之回傳; 回傳 { baseline, baselineSession } 或 null
//baseline 為應用系統金鑰列(isApp === 'y', 嚴格整表比對), baselineSession 為 session 列(逐列寬鬆比對, 契約 tokensSession)
function baselineOfTokens(rows) {
    let baseline = safeBaseline(rows, contracts.tokens)
    let baselineSession = safeBaseline(rows, contracts.tokensSession)
    if (baseline === null || baselineSession === null) {
        return null
    }
    return { baseline, baselineSession }
}


//isSameSnapshot: 兩份列(各依主鍵)之契約 fields 摘要是否全相同(含列數); 存檔成功重新讀取後, 送出之列與伺服端列相同者保留現畫面,
//不同者(如他人於載入後有更動、伺服端正規化)須改以伺服端列取代, 令畫面所見之列與新基準來自同一快照 (規格 §8)
//不比對列序: 僅供無名次欄(orderKey)之金鑰 / IP 清單使用(顯示序由前端自排); 使用者清單存檔成功後一律以重新讀取之列取代, 不用本函數
function isSameSnapshot(rowsA, rowsB, contract) {
    try {
        if (!Array.isArray(rowsA) || !Array.isArray(rowsB) || rowsA.length !== rowsB.length) {
            return false
        }
        let mp = new Map()
        for (let r of rowsA) {
            mp.set(r.id, digestRow(r, contract))
        }
        if (mp.size !== rowsA.length) {
            return false
        }
        for (let r of rowsB) {
            if (mp.get(r.id) !== digestRow(r, contract)) {
                return false
            }
        }
        return true
    }
    catch (err) {
        return false
    }
}


export { baselineOfUsers, baselineOfIps, baselineOfTokens, isSameSnapshot }
export default { baselineOfUsers, baselineOfIps, baselineOfTokens, isSameSnapshot }
