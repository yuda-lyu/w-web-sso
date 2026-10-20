//統計頁(LayoutContentStaInfor.vue)之資料處理: 以伺服器回傳之「依時間桶的 { time, data }」陣列, 其 data 之鍵為使用者名稱 / IP (來自 log, IP 取自 X-Forwarded-For 標頭, 使用端可植入任意字串)
//規則見 CLAUDE_rulebook.md「R-OBJ-ITER-01」「R-KEY-01」:
//  - data 依自有可列舉字串鍵走訪 (lodash each / omit 後 each 對具數字 length 鍵之物件會改走索引 0..length-1, 真實鍵被略過)
//  - 以名稱 / IP 為鍵之容器無原型 (constructor、__proto__ 等為一般鍵)
//  - 取值不把名稱 / IP 當 lodash 路徑 (get(item, 'data.1.2.3.4') 會解析為 data → 1 → 2 → 3 → 4 而恆得預設值)
//data.count 為該桶總筆數(保留字), 不列為名稱 / IP
import ot from 'dayjs'
import map from 'lodash-es/map.js'
import groupBy from 'lodash-es/groupBy.js'
import sortBy from 'lodash-es/sortBy.js'
import reverse from 'lodash-es/reverse.js'


let hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)


/**
 * 取時間桶 data 內某鍵之值(自有屬性; 不把鍵當 lodash 路徑)
 *
 * @param {Object} item 輸入時間桶物件，格式為{ time, data }
 * @param {String} key 輸入鍵字串，可為使用者名稱或IP(含 . 與 [ 皆視為一般字元)
 * @param {Number} [def=0] 輸入無此鍵時之預設值，預設0
 * @returns {*} 回傳值，無此自有鍵或值為undefined時回傳預設值
 * @example
 *
 * console.log(getFreqVal({ time: 't', data: { count: 6, '1.2.3.4': 5 } }, '1.2.3.4'))
 * // => 5
 * console.log(getFreqVal({ time: 't', data: { '1.2.3.4': 5 } }, '1.2.3.5'))
 * // => 0
 *
 */
function getFreqVal(item, key, def = 0) {
    let d = (item !== null && typeof item === 'object') ? item.data : null
    if (d === null || typeof d !== 'object' || !hasOwn(d, key)) {
        return def
    }
    let v = d[key]
    return v === undefined ? def : v
}


/**
 * 加總多個時間桶 data 內某鍵之值
 *
 * @param {Array} items 輸入時間桶陣列，格式為[{ time, data }]
 * @param {String} key 輸入鍵字串，可為使用者名稱或IP
 * @returns {Number} 回傳加總值，無任何桶含此鍵時為0
 * @example
 *
 * console.log(sumFreqVal([{ data: { 'a.b': 2 } }, { data: { 'a.b': 3 } }], 'a.b'))
 * // => 5
 *
 */
function sumFreqVal(items, key) {
    let s = 0
    for (let item of items) {
        s += getFreqVal(item, key, 0)
    }
    return s
}


/**
 * 依時間分組(每 groupHours 小時一組)合併時間桶並加總指定鍵之值(圖表之 4 小時 / 8 小時 / 1 日分組)
 *
 * @param {Array} arr 輸入依時間桶之使用頻率陣列，格式為[{ time, data: { count, [名稱或IP]: 次數 } }]
 * @param {Number} groupHours 輸入每組小時數，如4、8、24
 * @param {Array} keysPick 輸入要加總之鍵陣列，如['count']或全部名稱 / IP；可含 . 或 __proto__ 等任意字串
 * @returns {Array} 回傳分組後之陣列，格式為[{ time, data: { [鍵]: 加總值 } }]；data 為無原型物件(鍵以自有屬性保存)
 * @example
 *
 * let arr = [{ time: '2026-10-20T01:00:00+08:00', data: { '1.2.3.4': 2 } }, { time: '2026-10-20T02:00:00+08:00', data: { '1.2.3.4': 3 } }]
 * console.log(groupFreq(arr, 4, ['1.2.3.4'])[0].data['1.2.3.4'])
 * // => 5
 *
 */
function groupFreq(arr, groupHours, keysPick) {
    let gs = groupBy(arr, (v) => {
        let t = ot(v.time)
        let h = t.hour()
        let hGroup = Math.floor(h / groupHours)
        let tNew = t.startOf('day').add(hGroup * groupHours, 'hour')
        return tNew.format()
    })
    return map(gs, (vs, time) => {
        //data 無原型: 鍵為 __proto__ 時一般物件之指派會被忽略而遺失加總值 (R-KEY-01)
        let data = Object.create(null)
        for (let k of keysPick) {
            data[k] = sumFreqVal(vs, k)
        }
        return { time, data }
    })
}


/**
 * 由依時間桶之使用頻率計算各名稱 / IP 之使用統計(總計與近1日、8小時、4小時、1小時)並依總計由大到小排序、加上名次
 *
 * @param {Array} freq 輸入依時間桶之使用頻率陣列，格式為[{ time, data: { count, [名稱或IP]: 次數 } }]
 * @param {String} nameKey 輸入輸出列之名稱欄位名，如'username'或'ip'
 * @param {Object} [now] 輸入現在時刻dayjs物件，預設ot()
 * @returns {Array} 回傳統計陣列，格式為[{ [nameKey], total, last1d, last8h, last4h, last1h, number }]
 * @example
 *
 * let freq = [{ time: '2026-10-20T10:00:00+08:00', data: { count: 6, length: 4, '1.2.3.4': 2 } }]
 * console.log(calcUsageSummary(freq, 'ip', ot('2026-10-20T10:30:00+08:00')))
 * // => [ { ip: 'length', total: 4, ..., number: 1 }, { ip: '1.2.3.4', total: 2, ..., number: 2 } ]
 *
 */
function calcUsageSummary(freq, nameKey, now = ot()) {

    //freq 非陣列(如尚無資料)視為空, 元素須為物件(同修改前 lodash reduce / each 對 null、undefined 之容忍)
    freq = Array.isArray(freq) ? freq.filter((entry) => entry !== null && typeof entry === 'object') : []

    //先取得所有名稱(無原型容器, 鍵為使用端可植入之字串)
    let acc = Object.create(null)
    for (let entry of freq) {
        let data = (entry !== null && typeof entry === 'object' && entry.data !== null && typeof entry.data === 'object') ? entry.data : {}
        for (let name of Object.keys(data)) {
            if (name === 'count') {
                continue
            }
            if (!(name in acc)) {
                acc[name] = {
                    [nameKey]: name,
                    total: 0,
                    last1d: 0,
                    last8h: 0,
                    last4h: 0,
                    last1h: 0,
                }
            }
        }
    }

    //迭代各時間桶進行計算
    for (let entry of freq) {
        let t = ot(entry.time)
        let diff1d = now.diff(t, 'hour') <= 24
        let diff8h = now.diff(t, 'hour') <= 8
        let diff4h = now.diff(t, 'hour') <= 4
        let diff1h = now.diff(t, 'hour') <= 1
        let data = (entry.data !== null && typeof entry.data === 'object') ? entry.data : {}
        for (let name of Object.keys(data)) {
            if (name === 'count') {
                continue
            }
            let value = data[name]
            acc[name].total += value
            if (diff1d) {
                acc[name].last1d += value
            }
            if (diff8h) {
                acc[name].last8h += value
            }
            if (diff4h) {
                acc[name].last4h += value
            }
            if (diff1h) {
                acc[name].last1h += value
            }
        }
    }

    //將物件轉換為陣列並排序
    let sortedSummary = map(Object.keys(acc), (k) => acc[k])
    sortedSummary = sortBy(sortedSummary, 'total')
    sortedSummary = reverse(sortedSummary)
    sortedSummary = map(sortedSummary, (v, k) => {
        v.number = k + 1
        return v
    })

    return sortedSummary
}


export { getFreqVal, sumFreqVal, groupFreq, calcUsageSummary }
