//unit-staUsage.test.mjs — 統計頁資料處理 (src/plugins/staUsage.mjs; R-OBJ-ITER-01、R-KEY-01)
//
// 依據: CLAUDE_rulebook.md「R-OBJ-ITER-01」「R-KEY-01」; spec/流程_後台統計資訊.md (使用者使用統計與 IP 使用統計之總計與近 1 日 / 8 / 4 / 1 小時、名次)
//   - 伺服器回傳之時間桶 { time, data: { count, [使用者名稱或IP]: 次數 } } 中, 鍵可為 length(IP 取自 X-Forwarded-For, 未登入者可植入)、含 . 之 IPv4、原型鍵名
//   - calcUsageSummary: 依自有鍵走訪(原 omit 後 each 對 length 鍵改走索引 0..length-1, 該桶全部明細略過)
//   - getFreqVal / sumFreqVal: 鍵不當 lodash 路徑(原 get(item, 'data.1.2.3.4') 恆得預設值 0, 逐 IP 圖表與時間分組恆為 0)
// 對照: 一般資料(無特殊鍵)下與修改前實作(本檔 refCalc, 逐行取自修改前 LayoutContentStaInfor.vue 之 calculateIpUsageSummary)輸出相同——不改變既有行為

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import omit from 'lodash-es/omit.js'
import reduce from 'lodash-es/reduce.js'
import toPairs from 'lodash-es/toPairs.js'
import sortBy from 'lodash-es/sortBy.js'
import reverse from 'lodash-es/reverse.js'
import sumBy from 'lodash-es/sumBy.js'
import groupBy from 'lodash-es/groupBy.js'
import haskey from 'wsemi/src/haskey.mjs'
import { getFreqVal, sumFreqVal, groupFreq, calcUsageSummary } from '../src/plugins/staUsage.mjs'


//refCalc: 修改前之實作(逐行取自 LayoutContentStaInfor.vue calculateIpUsageSummary, 僅 now 改為參數)
function refCalc(ipFrequency, now) {
    let ips = reduce(ipFrequency, (acc, entry) => {
        let ipData = omit(get(entry, 'data', {}), 'count')
        each(keys(ipData), (ip) => {
            if (!haskey(acc, ip)) {
                acc[ip] = { ip, total: 0, last1d: 0, last8h: 0, last4h: 0, last1h: 0 }
            }
        })
        return acc
    }, {})
    each(ipFrequency, (entry) => {
        let t = ot(entry.time)
        let diff1d = now.diff(t, 'hour') <= 24
        let diff8h = now.diff(t, 'hour') <= 8
        let diff4h = now.diff(t, 'hour') <= 4
        let diff1h = now.diff(t, 'hour') <= 1
        let ipData = omit(get(entry, 'data', {}), 'count')
        each(ipData, (value, ip) => {
            if (haskey(ips, ip)) {
                ips[ip].total += value
                if (diff1d) {
                    ips[ip].last1d += value
                }
                if (diff8h) {
                    ips[ip].last8h += value
                }
                if (diff4h) {
                    ips[ip].last4h += value
                }
                if (diff1h) {
                    ips[ip].last1h += value
                }
            }
        })
    })
    let sortedSummary = toPairs(ips)
    sortedSummary = map(sortedSummary, (v) => v[1])
    sortedSummary = sortBy(sortedSummary, 'total')
    sortedSummary = reverse(sortedSummary)
    sortedSummary = map(sortedSummary, (v, k) => {
        v.number = k + 1
        return v
    })
    return sortedSummary
}


let __dirname = path.dirname(fileURLToPath(import.meta.url))


//refGroup: 修改前之時間分組(逐行取自修改前 LayoutContentStaInfor.vue genOpt, 路徑字串加總)
function refGroup(arr, groupHours, keysPick) {
    let gs = groupBy(arr, (v) => {
        let t = ot(v.time)
        let h = t.hour()
        let hGroup = Math.floor(h / groupHours)
        let tNew = t.startOf('day').add(hGroup * groupHours, 'hour')
        return tNew.format()
    })
    return map(gs, (vs, time) => {
        let r = { time, data: {} }
        each(keysPick, (k) => {
            r.data[k] = sumBy(vs, `data.${k}`)
        })
        return r
    })
}


//refSum / refGet: 修改前之取值(路徑字串)
let refSum = (vs, k) => sumBy(vs, `data.${k}`)
let refGet = (item, k) => get(item, `data.${k}`, 0)


let NOW = ot('2026-10-20T12:30:00+08:00')
let at = (h) => NOW.subtract(h, 'hour').format('YYYY-MM-DDTHH:mm:ssZ')


describe('staUsage — 統計頁資料處理 (R-OBJ-ITER-01 / R-KEY-01)', function() {

    it('SU-001 IP 為 length / 原型鍵名 / 含 . 之 IPv4: 各自為一列, 總計與近 N 小時正確, 依總計排序並加名次', function() {
        let freq = [
            { time: at(30), data: { count: 9, length: 9 } }, //超過 24 小時: 只計入總計
            { time: at(10), data: { 'count': 7, 'length': 3, '1.2.3.4': 4 } }, //9~24 小時
            { time: at(5), data: { 'count': 5, '1.2.3.4': 1, 'constructor': 4 } }, //5~8 小時
            { time: at(3), data: { 'count': 3, ['__proto__']: 2, '1.2.3.4': 1 } }, //4 小時內(以計算屬性名建立自有的 __proto__ 資料屬性; 寫成字面 '__proto__': 2 反而不會建立自有屬性)
            { time: at(0), data: { 'count': 2, 'length': 1, '1.2.3.4': 1 } }, //1 小時內
        ]
        let rs = calcUsageSummary(freq, 'ip', NOW)
        //spec: 每個名稱 / IP 一列, count 為保留字不列(原實作遇 length 鍵之桶, 該桶明細全部略過, 並多出索引 0.. 之假列)
        let byIp = Object.fromEntries(rs.map((r) => [r.ip, r]))
        assert.deepStrictEqual(rs.map((r) => r.ip).sort(), ['1.2.3.4', '__proto__', 'constructor', 'length'])
        assert.deepStrictEqual(byIp['length'], { ip: 'length', total: 13, last1d: 4, last8h: 1, last4h: 1, last1h: 1, number: byIp['length'].number })
        assert.deepStrictEqual(byIp['1.2.3.4'], { ip: '1.2.3.4', total: 7, last1d: 7, last8h: 3, last4h: 2, last1h: 1, number: byIp['1.2.3.4'].number })
        assert.deepStrictEqual(byIp['constructor'], { ip: 'constructor', total: 4, last1d: 4, last8h: 4, last4h: 0, last1h: 0, number: byIp['constructor'].number })
        assert.deepStrictEqual(byIp['__proto__'], { ip: '__proto__', total: 2, last1d: 2, last8h: 2, last4h: 2, last1h: 0, number: byIp['__proto__'].number }) // eslint-disable-line no-proto
        //spec: 總計由大到小, 名次由 1 起
        assert.deepStrictEqual(rs.map((r) => [r.ip, r.number]), [['length', 1], ['1.2.3.4', 2], ['constructor', 3], ['__proto__', 4]])
    })

    it('SU-002 保留字: data.count 不列為一列; 名稱以 username 欄位輸出', function() {
        let freq = [{ time: at(0), data: { count: 8, alice: 5, count2: 3 } }]
        let rs = calcUsageSummary(freq, 'username', NOW)
        assert.deepStrictEqual(rs.map((r) => r.username), ['alice', 'count2'])
        assert.ok(rs.every((r) => !('ip' in r)))
    })

    it('SU-003 一般資料下與修改前實作輸出相同(固定種子之 50 組隨機資料, 不含 length / 含 . 之鍵除外之特殊鍵; 含一般 IPv4)', function() {
        let seed = 20261020
        let rnd = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }
        let pool = ['10.0.0.1', '10.0.0.2', '192.168.1.5', 'alice', 'bob', 'u-1', '8.8.8.8']
        for (let c = 0; c < 50; c++) {
            let freq = []
            let nBucket = 1 + Math.floor(rnd() * 8)
            for (let i = 0; i < nBucket; i++) {
                let data = { count: 0 }
                for (let k of pool) {
                    if (rnd() < 0.5) {
                        let n = 1 + Math.floor(rnd() * 20)
                        data[k] = n
                        data.count += n
                    }
                }
                freq.push({ time: at(Math.floor(rnd() * 40)), data })
            }
            assert.deepStrictEqual(calcUsageSummary(freq, 'ip', NOW), refCalc(freq, NOW), `組 ${c}`)
        }
    })

    it('SU-004 getFreqVal: 含 . / [ 之鍵(IPv4)取自有值, 不當路徑; 無此鍵、非物件之 item / data 回預設值; 原型鍵名不取繼承值', function() {
        let item = { time: 't', data: { 'count': 6, '1.2.3.4': 5, 'a[0]': 2, 'length': 3, ['__proto__']: 7 } }
        assert.strictEqual(getFreqVal(item, '1.2.3.4'), 5)
        assert.strictEqual(getFreqVal(item, 'a[0]'), 2)
        assert.strictEqual(getFreqVal(item, 'length'), 3)
        assert.strictEqual(getFreqVal(item, '__proto__'), 7)
        assert.strictEqual(getFreqVal(item, '1.2.3.5'), 0)
        assert.strictEqual(getFreqVal(item, '1.2.3.5', -1), -1)
        assert.strictEqual(getFreqVal(item, 'constructor'), 0)
        assert.strictEqual(getFreqVal(item, 'toString'), 0)
        assert.strictEqual(getFreqVal({ data: { x: undefined } }, 'x', 9), 9)
        for (let bad of [null, undefined, 5, 'abc', { data: null }, { data: 'abc' }, {}]) {
            assert.strictEqual(getFreqVal(bad, 'x'), 0)
        }
        //修改前對照(缺陷事實): 路徑字串取值對含 . 之 IPv4 恆得預設值
        assert.strictEqual(refGet(item, '1.2.3.4'), 0)
    })

    it('SU-007 groupFreq: 一般資料(無 . 與特殊鍵)下與修改前分組輸出相同(各桶時間鍵、各鍵加總; 缺值以 0 計, 同圖表 getFreqVal 預設)', function() {
        let seed = 7
        let rnd = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }
        let pool = ['count', 'alice', 'bob', 'u-1']
        for (let c = 0; c < 30; c++) {
            let arr = []
            for (let i = 0; i < 12; i++) {
                let data = {}
                for (let k of pool) {
                    if (rnd() < 0.6) {
                        data[k] = 1 + Math.floor(rnd() * 9)
                    }
                }
                arr.push({ time: NOW.subtract(Math.floor(rnd() * 70), 'hour').format('YYYY-MM-DDTHH:mm:ssZ'), data })
            }
            for (let groupHours of [4, 8, 24]) {
                let a = groupFreq(arr, groupHours, pool)
                let b = refGroup(arr, groupHours, pool)
                assert.deepStrictEqual(a.map((x) => x.time), b.map((x) => x.time), `組 ${c} / ${groupHours}h: 時間鍵`)
                for (let i = 0; i < a.length; i++) {
                    for (let k of pool) {
                        assert.strictEqual(getFreqVal(a[i], k, 0), getFreqVal(b[i], k, 0), `組 ${c} / ${groupHours}h / ${k}`)
                    }
                }
            }
        }
    })

    it('SU-008 groupFreq: 鍵為含 . 之 IPv4、length、__proto__、constructor 時加總正確並保留(原路徑字串加總得 undefined, __proto__ 之指派被忽略)', function() {
        let mk = (h, n) => ({ time: NOW.subtract(h, 'hour').format('YYYY-MM-DDTHH:mm:ssZ'), data: { 'count': n * 4, '1.2.3.4': n, 'length': n * 2, 'constructor': n, ['__proto__']: n * 3 } })
        let arr = [mk(1, 1), mk(2, 2), mk(40, 3)]
        let keys4 = ['1.2.3.4', 'length', 'constructor', '__proto__', 'count']
        let g = groupFreq(arr, 24, keys4)
        //1、2 小時前同一日(以 NOW=12:30 計: 11:30、10:30 同日)合為一組: 加總 1+2=3; 40 小時前另一組(3)
        let total = (k) => g.reduce((a, x) => a + getFreqVal(x, k, 0), 0)
        assert.strictEqual(total('1.2.3.4'), 6)
        assert.strictEqual(total('length'), 12)
        assert.strictEqual(total('constructor'), 6)
        assert.strictEqual(total('__proto__'), 18) // eslint-disable-line no-proto
        assert.strictEqual(total('count'), 24)
        assert.strictEqual(g.length, 2)
        //缺陷事實(修改前): 路徑字串加總對含 . 之鍵得 undefined
        assert.strictEqual(refGroup(arr, 24, ['1.2.3.4'])[0].data['1.2.3.4'], undefined)
    })

    it('SU-006 freq 非陣列、含非物件元素或元素無 data: 不拋錯(空統計 / 略過該元素)', function() {
        for (let bad of [undefined, null, 'abc', 5, {}, { length: 3 }]) {
            assert.deepStrictEqual(calcUsageSummary(bad, 'ip', NOW), [], String(bad))
        }
        let rs = calcUsageSummary([null, 5, 'x', { time: at(0) }, { time: at(0), data: null }, { time: at(0), data: { 'count': 1, 'a': 1 } }], 'ip', NOW)
        assert.deepStrictEqual(rs.map((r) => [r.ip, r.total]), [['a', 1]])
    })

    it('SITE-SU-001 統計頁(LayoutContentStaInfor.vue)不再以 lodash 迭代 / 取路徑處理以名稱或 IP 為鍵之 data', function() {
        let src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'components', 'LayoutContentStaInfor.vue'), 'utf8')
        assert.ok(!/\beach\(\s*(userData|ipData)\b/.test(src), '不得 each(userData / ipData, …)')
        assert.ok(!/omit\(\s*get\(\s*entry\s*,\s*'data'/.test(src), '不得 omit(get(entry, \'data\'…)) 後走訪')
        assert.ok(!/sumBy\(\s*vs\s*,\s*`data\./.test(src), '不得 sumBy(vs, 以 data. 開頭之樣板字串路徑)')
        assert.ok(!/get\(\s*item\s*,\s*`data\./.test(src), '不得 get(item, 以 data. 開頭之樣板字串路徑)')
        assert.ok(/groupFreq\(arr, groupHours, keysPick\)/.test(src), '時間分組應經 groupFreq')
        assert.ok(/calcUsageSummary\(tokenFrequency, 'username'\)/.test(src))
        assert.ok(/calcUsageSummary\(ipFrequency, 'ip'\)/.test(src))
    })

    it('SU-005 sumFreqVal: 跨桶加總, 缺鍵之桶計 0; 含 . 之鍵不當路徑(原 sumBy 路徑字串得 undefined)', function() {
        let vs = [{ data: { '1.2.3.4': 2 } }, { data: { x: 1 } }, { data: { '1.2.3.4': 3 } }]
        assert.strictEqual(sumFreqVal(vs, '1.2.3.4'), 5)
        assert.strictEqual(sumFreqVal(vs, 'x'), 1)
        assert.strictEqual(sumFreqVal(vs, 'none'), 0)
        assert.strictEqual(sumFreqVal([], 'x'), 0)
        assert.strictEqual(refSum(vs, '1.2.3.4'), undefined)
        //無特殊鍵時與修改前相同
        assert.strictEqual(sumFreqVal(vs, 'x'), refSum(vs, 'x'))
    })

})
