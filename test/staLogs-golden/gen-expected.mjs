//golden fixture / expected 產生器 (由 tmp/zz_gen_golden.mjs 收進本目錄, 使 expected-hr.json / expected-day.json 之真理來源可重產)
//  node test/staLogs-golden/gen-expected.mjs fixture
//      → 產 test/staLogs-golden/logs/*.log (確定性, seeded PRNG; 173 檔)
//  node --import ./test/staLogs-golden/fakeDate.mjs test/staLogs-golden/gen-expected.mjs expected
//      → 以「改造前實作」(./legacy/staToken.mjs, ./legacy/staIp.mjs, ./legacy/staUserAccountLogin.mjs, 即 git 5d341b8^ 之原碼) 於假時鐘產 expected-hr.json / expected-day.json
//FIXED now = 1788150896789 = 2026-08-31 12:34:56.789 (+08:00); tStart(7d) = 2026-08-24 12:34:56.789
//擴充 fixture 時: 改本檔 → 依序重跑 fixture 與 expected → 跑 test/unit-staLogs-golden.test.mjs; expected 永遠由 legacy 產出, 不得手改。
//唯一之刻意差異 (R-STA-01, ADR-102; 2026-11-03 起): 新規則輸出以「現在」所屬桶為上界, legacy (改造前原碼, 只有下界) 之輸出多出之未來時間桶, 於 legacy 輸出之後剔除 (dropFuture);
//  其餘列 (含現在所屬桶內略晚於 FIXED 之紀錄) 一律為 legacy 原樣, legacy 本身不改其語意。
import './setTz.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'

let mode = process.argv[2] || 'fixture'
let fdRoot = path.dirname(fileURLToPath(import.meta.url)) //產物落在本目錄 (fixture 資產, 非使用者工作路徑輸出)
let fdLog = path.join(fdRoot, 'logs')

let FIXED = 1788150896789
let T_START = FIXED - 7 * 86400000

//seeded PRNG (mulberry32)
function prng(seed) {
    let a = seed >>> 0
    return function() {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
let rnd = prng(20260831)
let pick = (arr) => arr[Math.floor(rnd() * arr.length)]

let userIds = ['id-user-a', 'id-user-b', 'id-user-c', 'id-for-app-main', 'id-for-app-perm']
let ips = ['127.0.0.1', '10.0.0.5', '192.168.1.20', '203.0.113.7']

//依權重取事件, 回傳 {event, extra}
function genEvent() {
    let r = rnd()
    if (r < 0.40) {
        return { event: 'fun-checkToken', userId: pick(userIds), res: true }
    }
    if (r < 0.65) {
        return { event: 'verifyConn', ip: pick(ips) }
    }
    if (r < 0.80) {
        return { event: 'api/checkToken', token: 'abcd...wxyz(len=64)' }
    }
    if (r < 0.88) {
        return { event: 'kpfun-getWebInfor' }
    }
    if (r < 0.93) {
        return { event: 'kpfun-loginByAccountAndPassword-before', account: 'u' }
    }
    if (r < 0.97) {
        return { event: 'kpfun-loginByAccountAndPassword-success', account: 'u' }
    }
    return { event: 'kpfun-loginByAccountAndPassword-error', account: 'u', err: 'wrong password' }
}

function line(timeMs, ev) {
    return JSON.stringify({ level: 30, time: timeMs, pid: 123, hostname: 'h', ...ev })
}

function genFixture() {
    fs.rmSync(fdLog, { recursive: true, force: true })
    fs.mkdirSync(fdLog, { recursive: true })

    let tOut = ot(FIXED).subtract(7, 'day').startOf('hour').subtract(2, 'hour') //2026-08-24T10 (窗外)
    let tEnd = ot(FIXED).startOf('hour') //2026-08-31T12
    let nFiles = 0
    let nLines = 0
    for (let t = tOut; !t.isAfter(tEnd); t = t.add(1, 'hour')) {
        let name = t.format('YYYY-MM-DDTHH') + '.log'
        let lines = []
        let n = 8 + Math.floor(rnd() * 13) //8..20
        let times = []
        for (let i = 0; i < n; i++) {
            times.push(t.valueOf() + Math.floor(rnd() * 3600000))
        }
        times.sort((a, b) => a - b)
        for (let tm of times) {
            lines.push(line(tm, genEvent()))
        }

        //邊界檔(檔名小時 == tStart 小時): 加入 恰等於 tStart / tStart+1 ms 之行(前者不計, 後者計)
        if (t.format('YYYY-MM-DDTHH') === ot(T_START).format('YYYY-MM-DDTHH')) {
            lines.push(line(T_START, { event: 'verifyConn', ip: '1.1.1.1' }))
            lines.push(line(T_START + 1, { event: 'verifyConn', ip: '1.1.1.1' }))
            lines.push(line(T_START - 1, { event: 'fun-checkToken', userId: 'id-user-a', res: true }))
        }

        //邊界檔之下一檔: 前置 3 行 transport 緩衝外溢(time 屬前一小時, 落於本檔)
        if (t.format('YYYY-MM-DDTHH') === ot(T_START).add(1, 'hour').format('YYYY-MM-DDTHH')) {
            let tPrevEnd = t.valueOf() - 1
            lines.unshift(
                line(tPrevEnd - 400, { event: 'fun-checkToken', userId: 'id-user-b', res: true }),
                line(tPrevEnd - 200, { event: 'verifyConn', ip: '10.0.0.5' }),
                line(tPrevEnd, { event: 'kpfun-loginByAccountAndPassword-before', account: 'u' }),
            )
        }

        //某封閉檔: 混入垃圾行 / ISO 字串 time / 無 userId / 無 ip / time 為垃圾
        if (name === '2026-08-26T05.log') {
            lines.push('{"level":30,"time":1787')
            lines.push('')
            lines.push('plain text line')
            lines.push(JSON.stringify({ level: 30, time: ot(t.valueOf() + 600000).format(), event: 'verifyConn', ip: '9.9.9.9' }))
            lines.push(JSON.stringify({ level: 30, time: t.valueOf() + 700000, event: 'fun-checkToken', res: true })) //無 userId
            lines.push(JSON.stringify({ level: 30, time: t.valueOf() + 800000, event: 'verifyConn' })) //無 ip
            lines.push(JSON.stringify({ level: 30, time: 'garbage', event: 'verifyConn', ip: '8.8.8.8' }))
        }

        //當前小時檔: 加一行未來時間(時鐘偏移): legacy 以聯集多出一桶, 新規則 (R-STA-01) 不輸出該桶 (expected 產出時由 dropFuture 剔除, 以驗新規則之上界)
        if (t.valueOf() === tEnd.valueOf()) {
            lines.push(line(ot(FIXED).add(1, 'day').startOf('hour').add(1, 'hour').valueOf(), { event: 'verifyConn', ip: '7.7.7.7' }))
        }

        fs.writeFileSync(path.join(fdLog, name), lines.join('\n') + '\n')
        nFiles++
        nLines += lines.length
    }

    //day 粒度檔名(logInterval='day' 情境), 內容為 2026-08-30 當日事件
    if (true) {
        let tDay = ot('2026-08-30T00:00:00')
        let lines = []
        for (let i = 0; i < 12; i++) {
            lines.push(line(tDay.valueOf() + Math.floor(rnd() * 86400000), genEvent()))
        }
        fs.writeFileSync(path.join(fdLog, '2026-08-30.log'), lines.join('\n') + '\n')
        nFiles++
        nLines += lines.length
    }

    //非 ISO 檔名(fail-open 保留): 含可解析事件 + 垃圾行
    if (true) {
        let lines = [
            line(ot('2026-08-29T08:15:00').valueOf(), { event: 'fun-checkToken', userId: 'id-user-c', res: true }),
            'this is not json',
            '',
            line(ot('2026-08-29T08:16:00').valueOf(), { event: 'verifyConn', ip: '10.0.0.5' }),
        ]
        fs.writeFileSync(path.join(fdLog, 'notes.txt.log'), lines.join('\n') + '\n')
        nFiles++
        nLines += lines.length
    }

    console.log('fixture done', { fdLog, nFiles, nLines })
}

async function genExpected() {
    if (Date.now() !== FIXED) {
        throw new Error('expected 須於假時鐘下產出: node --import ./test/staLogs-golden/fakeDate.mjs test/staLogs-golden/gen-expected.mjs expected')
    }
    //由「改造前實作」(git 5d341b8^ 之 server/staLogs/sta*.mjs) 產出
    let staToken = (await import('./legacy/staToken.mjs')).default
    let staIp = (await import('./legacy/staIp.mjs')).default
    let staUserAccountLogin = (await import('./legacy/staUserAccountLogin.mjs')).default
    console.log('now(fake)', Date.now(), ot().format())

    //dropFuture, 剔除標籤晚於 FIXED 所屬桶之列 (R-STA-01); 桶標籤為定寬 YYYY-MM-DDTHH / YYYY-MM-DD, 字典序即時間序
    let dropFuture = (rows, fmt, name) => {
        let labelEnd = ot(FIXED).format(fmt)
        let rs = rows.filter((r) => r.time <= labelEnd)
        let dropped = rows.filter((r) => r.time > labelEnd).map((r) => r.time)
        console.log('dropFuture', name, { labelEnd, dropped })
        return rs
    }

    for (let ti of ['hr', 'day']) {
        let fmt = ti === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH'
        let token = dropFuture(await staToken(7, ti, { fdLog }), fmt, `${ti}/token`)
        let ip = dropFuture(await staIp(7, ti, { fdLog }), fmt, `${ti}/ip`)
        let login = dropFuture(await staUserAccountLogin(7, ti, { fdLog }), fmt, `${ti}/login`)
        let fp = path.join(fdRoot, `expected-${ti}.json`)
        fs.writeFileSync(fp, JSON.stringify({ token, ip, login }, null, 2))
        console.log('expected done', fp, { token: token.length, ip: ip.length, login: login.length })
    }
}

if (mode === 'fixture') {
    genFixture()
}
else if (mode === 'expected') {
    await genExpected()
}
else {
    throw new Error(`invalid mode[${mode}], use fixture | expected`)
}
