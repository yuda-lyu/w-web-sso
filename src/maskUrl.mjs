import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'


/**
 * 將網址轉為可寫入 log 之形式: http(s) 只留 origin + pathname, 捨棄 query / fragment / userinfo(其內常含權杖, 如 ?token=)
 *
 * 屬 M 契約之一部分(spec/設計要點與取捨.md ADR-068), 供對外查詢 helper 之診斷與後端 srLog(server/srLog.mjs re-export)共用:
 * - 陣列逐元素處理(Hapi 對重複之 query 參數給陣列)
 * - 空值回空字串; 其他非字串只回型別, 絕不輸出原值
 * - 非 http(s) 之網址(如 data:)只回 protocol; 無法解析回 '(invalid-url)'
 *
 * @param {*} u 輸入網址
 * @returns {String|Array} 回傳可寫入 log 之字串, 輸入陣列時回傳陣列
 */
function maskUrl(u) {
    if (isarr(u)) {
        return u.map(maskUrl)
    }
    if (u === undefined || u === null || u === '') {
        return ''
    }
    if (!isestr(u)) {
        return `(${typeof u})`
    }
    let x = null
    try {
        x = new URL(u)
    }
    catch (err) {
        return '(invalid-url)'
    }
    if (x.protocol !== 'http:' && x.protocol !== 'https:') {
        return x.protocol
    }
    return `${x.origin}${x.pathname}`
}


export default maskUrl
