import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import join from 'lodash-es/join.js'
import isfun from 'wsemi/src/isfun.mjs'
import getItemsFail from 'w-serv-orm/src/getItemsFail.mjs'


/**
 * 呼叫 ORM 逐筆寫入函數(save、del)並逐筆檢查結果, 供直接使用 woItems 之寫入點(ADR-080)
 *
 * w-orm 系列規格: save、del 遇單筆失敗時整批仍 resolve, 該筆以 ok 為 0 並附 err 回報, 須由呼叫端逐筆檢查;
 * 未檢查者其 catch 永不觸發, 失敗被當成功而照常執行後續(寄信、記節流、回報成功).
 * procOrm 自 w-serv-orm 1.1.7 起已內含此檢查(逐筆失敗即 reject), 經 procOrm 之寫入點不需再用本函數.
 * 單筆失敗不中斷整批, 故 reject 時其餘筆數已寫入.
 *
 * @param {Object} wo 輸入 ORM 物件(woItems 內之資料表), 須有 mode 對應之函數
 * @param {String} mode 輸入寫入函數名稱字串, 僅 'save' 或 'del'(insert 回傳聚合物件且錯誤皆屬整批性, 不適用)
 * @param {Object|Array} data 輸入數據物件或陣列
 * @returns {Promise} 回傳 Promise, resolve 回傳 ORM 逐筆結果陣列; reject 回傳錯誤: 整批性錯誤為 ORM 之 reject 原樣, 逐筆失敗為含失敗筆主鍵與錯誤原文之字串. 錯誤供 log, 回傳前端前須由呼叫端轉為語系鍵
 */
async function ormWrite(wo, mode, data) {

    //check
    if (mode !== 'save' && mode !== 'del') {
        return Promise.reject(`invalid mode[${mode}]`)
    }
    if (!isfun(get(wo, mode))) {
        return Promise.reject(`invalid wo.${mode}`)
    }

    //rs, 整批性錯誤由 ORM reject, 原樣透出
    let rs = await wo[mode](data)

    //fails, 逐筆失敗者
    let fails = getItemsFail(rs, data)
    if (size(fails) > 0) {
        let ss = map(fails, (v) => {
            return `id[${v.id}]: ${v.err}`
        })
        return Promise.reject(`${mode} fail: ${join(ss, '; ')}`)
    }

    return rs
}


export default ormWrite
