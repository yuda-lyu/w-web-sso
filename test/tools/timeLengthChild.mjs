//unit-staLogs-timeLength 之子行程(排程第 301 項; 非測試案例, 不帶 .test. 中綴): 對單一 timeLength 或 opt.timeNow 候選值依序跑各層入口, 每層完成即輸出一行 JSON.
//why 子行程: 修前之 timeLength 為 NaN、'abc'、±Infinity、{}、1e20 等時 genPlan 之 kpTime 迴圈為同步無窮迴圈, 同行程內 mocha 之逾時計時器亦無法觸發; 由父行程以 spawnSync 之 timeout 終止.
//用法: node test/tools/timeLengthChild.mjs <候選名> <空 log 夾>
//輸出(每層一行): { layer, kind: 'ok'|'reject'|'throw', v: 回傳摘要或固定鍵 }; 父行程以「缺行」判定該層卡住或行程崩潰
import fs from 'fs'
import { staLogs, genPlan } from '../../server/staLogs/staLogsCore.mjs'
import staToken from '../../server/staLogs/staToken.mjs'
import staIp from '../../server/staLogs/staIp.mjs'
import staUserAccountLogin from '../../server/staLogs/staUserAccountLogin.mjs'
import staLogsWk from '../../server/staLogs/staLogsCore.callWorker.mjs'
import staTokenWk from '../../server/staLogs/staToken.callWorker.mjs'
import staIpWk from '../../server/staLogs/staIp.callWorker.mjs'
import staUserAccountLoginWk from '../../server/staLogs/staUserAccountLogin.callWorker.mjs'


//ANCHOR: 固定之「現在」(2026-11-23 12:00 UTC+8), 使 hr 粒度之桶數可預期(7 天 → 169 桶)
const ANCHOR = Date.UTC(2026, 10, 23, 4, 0, 0)

//候選值(含 JSON 無法表達者: NaN、±Infinity、undefined、BigInt、Symbol、包裝物件、含方法之物件、已撤銷之 Proxy)
function genCands() {
    let revoked = Proxy.revocable({}, {})
    revoked.revoke()
    return {
        //有效
        'v-0': () => 0,
        'v-negzero': () => -0,
        'v-1': () => 1,
        'v-7': () => 7,
        'v-30': () => 30,
        'v-3650': () => 3650,
        'v-undef': () => undefined, //未給 → 預設 7
        'v-str7': () => '7',
        'v-str-spaced': () => ' 7 ',
        'v-str-sci': () => '1e1',
        'v-str-plus': () => '+7',
        //無效
        'x-NaN': () => NaN,
        'x-Infinity': () => Infinity,
        'x-negInfinity': () => -Infinity,
        'x-neg1': () => -1,
        'x-negHuge': () => -1e9,
        'x-float1.5': () => 1.5,
        'x-3651': () => 3651,
        'x-str3651': () => '3651',
        'x-2e53': () => 2 ** 53,
        'x-100000': () => 100000,
        'x-1e20': () => 1e20,
        'x-1e308': () => 1e308,
        'x-strAbc': () => 'abc',
        'x-strEmpty': () => '',
        'x-strSpace': () => '   ',
        'x-strHex': () => '0x10',
        'x-strInfinity': () => 'Infinity',
        'x-strNaN': () => 'NaN',
        'x-strFloat': () => '7.5',
        'x-strNeg': () => '-1',
        'x-strHuge': () => '1e400',
        'x-strMarker': () => 'NP',
        'x-null': () => null,
        'x-true': () => true,
        'x-false': () => false,
        'x-obj': () => ({}),
        'x-objValueOf': () => ({
            valueOf: () => 7,
            toString: () => '7',
        }),
        'x-arr': () => [],
        'x-arr7': () => [7],
        'x-bigint': () => 7n,
        'x-symbol': () => Symbol('x'),
        'x-numberObj': () => new Number(7), // eslint-disable-line no-new-wrappers
        'x-fn': () => () => 7,
        'x-revokedProxy': () => revoked.proxy,
        'x-date': () => new Date(0),
    }
}


//opt.timeNow 之候選(僅測試可傳; typeof 為 number 之 NaN、超出 Date 範圍者經 dayjs 為 Invalid Date, 修前使 kpTime 迴圈成為無窮迴圈): 只跑 timeLength=7, 期望無效者退回現在
let nowCands = {
    'now-NaN': NaN,
    'now-Infinity': Infinity,
    'now-neg-Infinity': -Infinity,
    'now-1e300': 1e300,
    'now-neg1e300': -1e300,
    'now-str': '2026-01-01',
    //Date 之極值: timeNow 本身為有效 Date, 但其後 subtract／逐桶 add 溢位成 Invalid Date(使 kpTime 迴圈無窮)
    'now-date-max': 8.64e15,
    'now-date-min': -8.64e15,
    'now-date-max-minus-5d': 8.64e15 - 5 * 86400000,
    'now-date-min-plus-5d': -8.64e15 + 5 * 86400000,
    'now-beyond-2100': 4102444800001,
    'now-negative-epoch': -1,
    'now-year-9999': 253402300799999,
    //有效邊界(照常使用該時刻, 不退回現在)
    'now-ok-epoch0': 0,
    'now-ok-2100': 4102444800000,
}

let name = process.argv[2]
let fdLog = process.argv[3]
let cands = genCands()
let isNow = Object.prototype.hasOwnProperty.call(nowCands, name)
if (!isNow && !Object.prototype.hasOwnProperty.call(cands, name)) {
    console.log(JSON.stringify({ layer: 'child', kind: 'throw', v: 'unknown candidate' }))
    process.exit(2)
}
fs.mkdirSync(fdLog, { recursive: true })

let sum = (rs) => (Array.isArray(rs) ? `array(${rs.length})` : `(typeof ${typeof rs})`)
let emit = (layer, kind, v) => console.log(JSON.stringify({ layer, kind, v }))

//run: 每層各自 try; reject 值為字串(固定鍵)時原樣, 其他以類別名表示(不印訊息文字)
async function run(layer, f) {
    try {
        let r = await f()
        emit(layer, 'ok', sum(r))
    }
    catch (err) {
        emit(layer, 'reject', typeof err === 'string' ? err : `(${(err && err.constructor && err.constructor.name) || typeof err}) ${(err && err.message) || ''}`)
    }
}

let tl = isNow ? 7 : cands[name]() //undefined 者各層以其預設值(7)
let timeNow = isNow ? nowCands[name] : ANCHOR
let opt = { fdLog, timeNow, useCache: false }

//1 genPlan(同步; 無效者同步 throw Error)
try {
    let p = genPlan(tl, 'hr', opt)
    emit('genPlan', 'ok', `kpTime(${p.kpTime.length})`)
    if (isNow) {
        emit('pinned', 'ok', p.labelEnd) //「現在所屬桶」之標籤: 照常使用之 timeNow 與退回現在者可由此區分
    }
}
catch (err) {
    emit('genPlan', 'throw', (err && err.message) || '')
}

//2 staLogs(核心入口; 回傳 Promise, 無效者 reject 固定鍵); 輸出之 token 為窗內逐桶陣列
await run('staLogs', async () => (await staLogs(tl, 'hr', opt)).token)

//3 三支統計(非 worker 版)
await run('staToken', async () => await staToken(tl, 'hr', opt))
await run('staIp', async () => await staIp(tl, 'hr', opt))
await run('staUserAccountLogin', async () => await staUserAccountLogin(tl, 'hr', opt))

//4 worker 版(伺服端實際使用者)
await run('staLogsWorker', async () => (await staLogsWk(tl, 'hr', opt)).token)
await run('staTokenWorker', async () => await staTokenWk(tl, 'hr', opt))
await run('staIpWorker', async () => await staIpWk(tl, 'hr', opt))
await run('staUserAccountLoginWorker', async () => await staUserAccountLoginWk(tl, 'hr', opt))

process.exit(0)
