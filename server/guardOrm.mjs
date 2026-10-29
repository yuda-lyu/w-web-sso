import isfun from 'wsemi/src/isfun.mjs'


function guardCall(diag, fn, self, args) {
    //同步拋錯與 Promise reject 皆為外來值(資料庫驅動之錯誤), 出口前經 diag.err; resolve 之結果原樣
    let r
    try {
        r = Reflect.apply(fn, self, args)
    }
    catch (err) {
        throw diag.err(err)
    }
    if (r !== null && typeof r === 'object' && isfun(r.then)) {
        return Promise.resolve(r).catch((err) => {
            return Promise.reject(diag.err(err))
        })
    }
    return r
}


function guardTable(diag, wo) {
    if (wo === null || typeof wo !== 'object') {
        return wo
    }
    return new Proxy(wo, {
        get: (target, key) => {
            let v = Reflect.get(target, key, target)
            return isfun(v) ? (...args) => guardCall(diag, v, target, args) : v
        },
    })
}


/**
 * 外來值入口遮罩: 包裝 w-serv-orm 之 woItems(各資料表之 ORM 物件), 使資料庫驅動回傳之錯誤進入本套件前先遮罩憑證(R-DIAG-01, 規格 dspec〈診斷輸出與遮罩〉)
 *
 * 本套件直接呼叫 woItems.<表>.select / save / del 等(procCore、procProtect、ormWrite), 其 reject(或同步拋錯)為後端/驅動之外來值, 可能夾帶連線字串與帳密;
 * 這些值之後會被寫入 console、srLog.error 之 err 欄位, 或原樣 reject 至 kpfun 與 HTTP 端點(回遠端), 故於進入點一次遮罩: 回傳包裝後之 woItems(各表以 Proxy 轉呼叫, 函數之 reject 與同步拋錯
 * 經 diag.err, 無憑證者回原物件、身分不變; 有憑證者為保型副本), resolve 之結果與非函數屬性原樣. 本套件自身以固定詞彙組成之 reject(如 'tokenExpired')不經本函數, 故不會被秘密之子字串切碎.
 * 遮罩邏輯全部由 wsemi 之 diag 實例(getDiag)提供, 本函數不含任何遮罩實作.
 *
 * @param {Object} diag 輸入診斷遮罩實例(wsemi getDiag 之回傳, 需有 err 函數)
 * @param {Object} woItems 輸入 w-serv-orm 之 woItems，格式為 { <woName>: <ORM 物件> }
 * @returns {Object} 回傳同鍵之包裝後 woItems
 */
function guardOrm(diag, woItems) {
    let r = {}
    for (let k of Object.keys(woItems)) {
        r[k] = guardTable(diag, woItems[k])
    }
    return r
}


export default guardOrm
