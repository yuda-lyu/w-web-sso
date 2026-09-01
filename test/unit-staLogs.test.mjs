//staLogs 之 staIp / staToken / staUserAccountLogin / filterVpfsByWindow 單元測試。
//對應規格來源(read-only, 逐行讀過):
//  server/staLogs/staIp.mjs                —— 時間桶產生(:30-39)、per-line 窗+event 判斷(:56-73)、依 ip 分組(:88-105)
//  server/staLogs/staToken.mjs             —— 時間桶產生(:30-39)、per-line 窗+event 判斷(:56-73)、依 userId 分組(:88-105)
//  server/staLogs/staUserAccountLogin.mjs  —— 時間桶產生(:29-38)、per-line 窗+event 判斷(:57-90)、attempt/success/error 聚合(:108-119)
//  server/staLogs/filterVpfsByWindow.mjs   —— 檔名粒度自適應防線(:16-25)
//
//fixture 於 tmp/fixture-logs/ 自造 w-syslog 格式 log(檔名 `YYYY-MM-DDTHH.log`(hr)或 `YYYY-MM-DD.log`(day),
//每行一筆 JSON,依各統計函式逐行取用之欄位造:staIp 取 event='verifyConn'+ip, staToken 取 event='fun-checkToken'+userId,
//staUserAccountLogin 取 event='kpfun-loginByAccountAndPassword-{before,success,error}'),時間一律以執行當下 dayjs 相對推算(不寫死日期)。

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import staIp from '../server/staLogs/staIp.mjs'
import staToken from '../server/staLogs/staToken.mjs'
import staUserAccountLogin from '../server/staLogs/staUserAccountLogin.mjs'
import filterVpfsByWindow from '../server/staLogs/filterVpfsByWindow.mjs'


//fixture 目錄錨定於 test/_tmp/(gitignore, after() 清除),不受執行 cwd 影響; 不落專案 ./tmp/(AI 代理暫存區, 隨時會被整個清除)
let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdLog = path.resolve(__dirname, '_tmp', 'fixture-logs')

//hr fmt(各 staLogs 於 timeInterval='hr' 之 fmt,見 staIp.mjs:25)
let fmt = 'YYYY-MM-DDTHH'

//以 hr 粒度檔名寫入一批事件行(檔名取事件時刻之小時桶),objs 為要寫入之事件物件陣列
function writeHrLog(t, objs) {
    let fp = path.join(fdLog, t.format('YYYY-MM-DDTHH') + '.log')
    let lines = objs.map((o) => JSON.stringify({ time: t.format(), ...o }))
    //同一小時桶可能多批 → append 不覆寫
    fs.appendFileSync(fp, lines.join('\n') + '\n')
}

//以 day 粒度檔名寫入事件行(檔名為日期,不含小時 → 模擬 srLog logInterval='day' 而 staLogs fmt='hr' 之粒度不一致)
function writeDayLog(tFile, tEvent, objs) {
    let fp = path.join(fdLog, tFile.format('YYYY-MM-DD') + '.log')
    let lines = objs.map((o) => JSON.stringify({ time: tEvent.format(), ...o }))
    fs.appendFileSync(fp, lines.join('\n') + '\n')
}

//跨全部時間桶累加某欄位(ip / userId)之計數
function sumKey(rs, key) {
    return rs.reduce((a, r) => a + (r.data[key] || 0), 0)
}

//跨全部時間桶累加某 data 子欄位(attempt / success / error)
function sumField(rs, field) {
    return rs.reduce((a, r) => a + (r.data[field] || 0), 0)
}

//依時刻取回對應之時間桶
function findBucket(rs, t) {
    return rs.find((r) => r.time === t.format(fmt))
}


describe('unit-staLogs', function() {
    this.timeout(300000)

    //時刻於 before 內以執行當下推算, describe scope 共享供各 it 定位桶
    let now, t1h, t23h, t6d, t20d, tDayEvent

    before(function() {
        //乾淨重建 fixture 目錄
        fs.rmSync(fdLog, { recursive: true, force: true })
        fs.mkdirSync(fdLog, { recursive: true })

        now = ot()
        t1h = now.subtract(1, 'hour')     //窗內 1h 前
        t23h = now.subtract(23, 'hour')   //窗內 23h 前
        t6d = now.subtract(6, 'day')      //7 天窗內邊界 6 天前
        t20d = now.subtract(20, 'day')    //7 天窗外 20 天前
        tDayEvent = now.subtract(2, 'hour') //day 粒度檔內之事件時刻(窗內 2h 前)

        //每個窗內時刻同時寫入三支統計各自可辨識之事件(各取不同 event 名 + 分組欄位, 互不干擾)
        //窗內 1h 前
        writeHrLog(t1h, [
            { event: 'verifyConn', ip: '10.0.0.1' },
            { event: 'fun-checkToken', userId: 'user-1h' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
            { event: 'kpfun-loginByAccountAndPassword-success' },
        ])

        //窗內 23h 前
        writeHrLog(t23h, [
            { event: 'verifyConn', ip: '10.0.0.23' },
            { event: 'fun-checkToken', userId: 'user-23h' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
            { event: 'kpfun-loginByAccountAndPassword-error' },
        ])

        //7 天窗內邊界 6 天前:各事件寫 2 筆, 驗證計數與寫入筆數一致
        writeHrLog(t6d, [
            { event: 'verifyConn', ip: '10.0.0.6' },
            { event: 'verifyConn', ip: '10.0.0.6' },
            { event: 'fun-checkToken', userId: 'user-6d' },
            { event: 'fun-checkToken', userId: 'user-6d' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
        ])

        //7 天窗外 20 天前:應被完全排除(filterVpfsByWindow 檔名層剔除 + per-line 窗判斷雙重擋下)
        //分組欄位一律用可辨識之 out 值, 供斷言其絕不出現於任何桶
        writeHrLog(t20d, [
            { event: 'verifyConn', ip: '10.0.0.20' },
            { event: 'fun-checkToken', userId: 'user-20d' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
        ])

        //day 粒度檔名(窗內):檔名為今日日期(10 字元), 事件時刻 2h 前 → 驗證 hr fmt 下當天 day 檔不被誤剔
        writeDayLog(now, tDayEvent, [
            { event: 'verifyConn', ip: '10.0.0.day' },
            { event: 'fun-checkToken', userId: 'user-day' },
            { event: 'kpfun-loginByAccountAndPassword-before' },
            { event: 'kpfun-loginByAccountAndPassword-success' },
        ])

        //非 ISO 檔名 + 非 JSON 內容:fail-open 保留, 但無可解析事件(不應污染任何計數)
        fs.writeFileSync(path.join(fdLog, 'notes.txt.log'), 'this is not json\nplain text line\n')
    })

    after(function() {
        fs.rmSync(fdLog, { recursive: true, force: true })
        //測完即刪: test/_tmp/ 本身若已空也移除
        try {
            let d = path.dirname(fdLog)
            if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d)
        }
        catch (err) { /* ignore */ }
    })


    //UNIT-001:staIp 基本語意 + 窗外排除
    //  spec: staIp.mjs:36-39 產生 tStart.startOf(hour)..now.startOf(hour) 逐小時桶, timeLength=7 → 7*24+1=169 桶。
    //  spec: staIp.mjs:63 b2=(event==='verifyConn') 僅計 verifyConn; :88-105 依 ip 分組, data.count 為該桶 verifyConn 總數。
    //  spec: staIp.mjs:43 filterVpfsByWindow 檔名層剔除 + :62 b1=t.isAfter(tStart) per-line 窗判斷 → 20 天前不計入。
    it('UNIT-001-staIp-basic-and-out-of-window', async function() {
        let rs = await staIp(7, 'hr', { fdLog })

        //回傳為陣列
        assert.strict.ok(Array.isArray(rs), 'staIp 應回傳陣列')

        //時間桶數量 = 7 天 × 24 + 1 = 169(staIp.mjs:36-39 之 while 迴圈含頭尾端點)
        assert.strict.equal(rs.length, 7 * 24 + 1, '時間桶數量應為 7*24+1=169')

        //每個桶結構含 time(字串)與 data.count(數字)(staIp.mjs:37,99-104)
        for (let r of rs) {
            assert.strict.equal(typeof r.time, 'string', '每個桶應含字串 time')
            assert.strict.equal(typeof r.data.count, 'number', '每個桶 data.count 應為數字')
        }

        //fixture 事件被計入正確的桶:1h 前之 verifyConn 落於 (now-1h) 之小時桶, ip 計數=1
        let b1h = findBucket(rs, t1h)
        assert.strict.ok(b1h, '應存在 (now-1h) 之時間桶')
        assert.strict.equal(b1h.data['10.0.0.1'], 1, '1h 前 verifyConn 應計入該桶之 ip 10.0.0.1 各 1 筆')

        //6 天前邊界寫入 2 筆 → 該桶 ip 計數=2(計數與寫入筆數一致)
        let b6d = findBucket(rs, t6d)
        assert.strict.ok(b6d, '應存在 (now-6day) 之時間桶')
        assert.strict.equal(b6d.data['10.0.0.6'], 2, '6 天前 verifyConn 寫入 2 筆應計為 2')

        //20 天前(窗外)事件不出現在任何桶
        assert.strict.equal(sumKey(rs, '10.0.0.20'), 0, '20 天前(窗外)verifyConn 之 ip 不應出現在任何桶')
        assert.strict.ok(
            !findBucket(rs, t20d),
            '20 天前之時間桶不應存在於 7 天窗內之桶序列'
        )
    })


    //UNIT-002:staToken 基本語意 + 窗外排除
    //  spec: staToken.mjs:36-39 逐小時桶 169; :63 b2=(event==='fun-checkToken') 僅計 fun-checkToken;
    //        :88-105 依 userId 分組; :43+:62 檔名層+per-line 窗判斷 → 20 天前不計入。
    it('UNIT-002-staToken-basic-and-out-of-window', async function() {
        let rs = await staToken(7, 'hr', { fdLog })

        //回傳為陣列
        assert.strict.ok(Array.isArray(rs), 'staToken 應回傳陣列')

        //時間桶數量 = 169(staToken.mjs:36-39)
        assert.strict.equal(rs.length, 7 * 24 + 1, '時間桶數量應為 7*24+1=169')

        //每個桶結構含 time 與 data.count
        for (let r of rs) {
            assert.strict.equal(typeof r.time, 'string', '每個桶應含字串 time')
            assert.strict.equal(typeof r.data.count, 'number', '每個桶 data.count 應為數字')
        }

        //fixture 事件被計入正確的桶:1h 前之 fun-checkToken 落於 (now-1h) 桶, userId 計數=1
        let b1h = findBucket(rs, t1h)
        assert.strict.ok(b1h, '應存在 (now-1h) 之時間桶')
        assert.strict.equal(b1h.data['user-1h'], 1, '1h 前 fun-checkToken 應計入該桶之 userId user-1h 各 1 筆')

        //6 天前邊界寫入 2 筆 → userId 計數=2
        let b6d = findBucket(rs, t6d)
        assert.strict.ok(b6d, '應存在 (now-6day) 之時間桶')
        assert.strict.equal(b6d.data['user-6d'], 2, '6 天前 fun-checkToken 寫入 2 筆應計為 2')

        //20 天前(窗外)事件不出現在任何桶
        assert.strict.equal(sumKey(rs, 'user-20d'), 0, '20 天前(窗外)fun-checkToken 之 userId 不應出現在任何桶')
        assert.strict.ok(
            !findBucket(rs, t20d),
            '20 天前之時間桶不應存在於 7 天窗內之桶序列'
        )
    })


    //UNIT-003:staUserAccountLogin 基本語意 + 窗外排除
    //  spec: staUserAccountLogin.mjs:35-38 逐小時桶 169, 每桶 data={attempt,success,error};
    //        :73-77 b2 僅計 kpfun-loginByAccountAndPassword-{before,success,error};
    //        :108-119 before→attempt / success→success / error→error 聚合;
    //        :43+:72 檔名層+per-line 窗判斷 → 20 天前 before 不計入 → 窗內 attempt 總計=5(1+1+2+1), 非 6。
    it('UNIT-003-staUserAccountLogin-basic-and-out-of-window', async function() {
        let rs = await staUserAccountLogin(7, 'hr', { fdLog })

        //回傳為陣列
        assert.strict.ok(Array.isArray(rs), 'staUserAccountLogin 應回傳陣列')

        //時間桶數量 = 169(staUserAccountLogin.mjs:35-38)
        assert.strict.equal(rs.length, 7 * 24 + 1, '時間桶數量應為 7*24+1=169')

        //每個桶結構含 attempt/success/error 三數字欄位(staUserAccountLogin.mjs:36,112-118)
        for (let r of rs) {
            assert.strict.equal(typeof r.data.attempt, 'number', '每個桶 data.attempt 應為數字')
            assert.strict.equal(typeof r.data.success, 'number', '每個桶 data.success 應為數字')
            assert.strict.equal(typeof r.data.error, 'number', '每個桶 data.error 應為數字')
        }

        //fixture 事件被計入正確的桶:1h 前寫 before+success → 該桶 attempt≥1 且 success≥1
        let b1h = findBucket(rs, t1h)
        assert.strict.ok(b1h, '應存在 (now-1h) 之時間桶')
        assert.strict.equal(b1h.data.attempt, 1, '1h 前 before 應計為該桶 attempt=1')
        assert.strict.equal(b1h.data.success, 1, '1h 前 success 應計為該桶 success=1')

        //窗內聚合總計(before→attempt): 1h(1)+23h(1)+6d(2)+dayFile(1)=5; 20 天前 before 被剔除故非 6
        assert.strict.equal(sumField(rs, 'attempt'), 5, '窗內 attempt 總計應為 5(20 天前 before 被剔除)')
        //success: 1h(1)+dayFile(1)=2; error: 23h(1)=1
        assert.strict.equal(sumField(rs, 'success'), 2, '窗內 success 總計應為 2')
        assert.strict.equal(sumField(rs, 'error'), 1, '窗內 error 總計應為 1')

        //20 天前(窗外)之時間桶不應存在
        assert.strict.ok(
            !findBucket(rs, t20d),
            '20 天前之時間桶不應存在於 7 天窗內之桶序列'
        )
    })


    //UNIT-004:粒度自適應(直接測 filterVpfsByWindow)
    //  spec: filterVpfsByWindow.mjs:23 bn >= keyStart.slice(0, bn.length) —— 以檔名長度截取比較;
    //        :20-22 非 ISO 前綴檔名 fail-open 保留。
    //  情境: day 粒度檔名(10 字元)× hr 粒度 fmt(13 字元)。
    it('UNIT-004-filterVpfsByWindow-granularity-adaptive', function() {
        //固定 tStart 使 keyStart='2026-07-10T21'(此測不依賴 now, 直接驗字串比較邏輯)
        let tStart = ot('2026-07-10T21:30:00')

        let vpfs = [
            { name: '2026-07-10.log', path: '/x/2026-07-10.log' },      //day 檔(含 tStart 當天)→ 應保留
            { name: '2026-07-01T05.log', path: '/x/2026-07-01T05.log' }, //hr 檔(明確窗外)→ 應剔除
            { name: 'notes.txt.log', path: '/x/notes.txt.log' },         //非 ISO 檔名 → fail-open 保留
        ]
        let kept = filterVpfsByWindow(vpfs, tStart, fmt).map((v) => v.name)

        //含 tStart 當天之 day 檔(10 字元)被保留:'2026-07-10' >= '2026-07-10T21'.slice(0,10)='2026-07-10'
        assert.strict.ok(kept.includes('2026-07-10.log'), '含 tStart 當天之 day 檔應被保留')

        //明確窗外之 hr 檔被剔除:'2026-07-01T05' < '2026-07-10T21'
        assert.strict.ok(!kept.includes('2026-07-01T05.log'), '明確窗外之 hr 檔應被剔除')

        //非 ISO 檔名 fail-open 保留(filterVpfsByWindow.mjs:20-22)
        assert.strict.ok(kept.includes('notes.txt.log'), '非 ISO 檔名應 fail-open 保留')
    })


    //UNIT-005:粒度自適應之整合驗證(擇 staIp)
    //  spec: staIp.mjs:43 之 filterVpfsByWindow 於 hr fmt(13 字元)下, 不得誤剔窗內之 day 粒度檔(10 字元);
    //        證明當天 day 檔(檔名 10 字元)內之事件確有被 staIp 計入(粒度自適應在整合路徑生效)。
    it('UNIT-005-staIp-day-file-integration', async function() {
        let rs = await staIp(7, 'hr', { fdLog })

        //day 粒度檔(檔名 10 字元)內之 verifyConn(ip 10.0.0.day)應被計入(證明未於檔名層被誤剔)
        assert.strict.equal(sumKey(rs, '10.0.0.day'), 1, '窗內 day 粒度檔之 verifyConn 應被 staIp 計入 1 筆')

        //且落於事件時刻(now-2h)對應之小時桶
        let bDay = findBucket(rs, tDayEvent)
        assert.strict.ok(bDay, '應存在 (now-2h) 之時間桶')
        assert.strict.equal(bDay.data['10.0.0.day'], 1, 'day 檔事件應落於 (now-2h) 之小時桶')
    })

})
