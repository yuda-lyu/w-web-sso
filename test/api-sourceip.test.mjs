//api-sourceip.test.mjs — 來源 IP 之格式驗證與計數容器鍵清理經真實 HTTP / 資料通道 (R-IP-01、R-CNT-01, ADR-089)
//
// 依據: CLAUDE_rulebook.md R-IP-01 / R-CNT-01; 單元層 unit-sourceIp、unit-countKeys; 使用者 2026-10-20 裁示「SSO 不做防偽造系統」(維持 X-Forwarded-For 最左段語意)
//   - IP-A-001 標頭首段非 IP(length、constructor、<img src=x>、unknown、1.2.3.4:abc、1000 字元): ips 表與統計皆記連線位址, 原字串不進任何持久面; log 有限流之 warn
//   - IP-A-002 標頭首段為合法 IP(IPv4、IPv6、::ffff:、大寫 IPv6): ips 表與統計原樣登錄(不改寫)
//   - IP-A-003 以原字串寫入 ips 表之封鎖列(::ffff:203.0.113.20)仍命中; 未映射之 203.0.113.20 不受影響(無正規化)
//   - IP-A-004 窗口(minForIpCallApi)過後無新請求之 IP, 其計數鍵被刪除: 系統管理者自 ips 表刪除之列不再被偵測計時器復活(修改前鍵永久殘留, 每 2 秒復活)
//   - IP-A-005 標頭非 IP 時以連線位址判定: 多個不同非 IP 標頭值共用連線位址之計數(超過門檻即封鎖該連線位址), 封鎖後非 IP 標頭之請求被拒、合法他 IP 不受影響
//   - IP-A-006 標頭帶 port(IPv4:port、[IPv6]:port): 去 port 取 IP——ips 表與統計皆記去 port 後之 IP(同 IP 不同 port 為同一 IP), 不退回連線位址(run02 裁示 1)
//   - IP-A-007 帶 port 之請求以 IP 本身計數與判定封鎖: 不同 port 合併計次而封鎖該 IP、以原字串寫入之封鎖列對帶 port 之請求命中, 連線位址與其他 IP 不受牽連
// 作法: 每案以臨時 settings(logFd 指向 test/_tmp/api-sourceip/logs)重啟全新後端——①統計只讀本檔造成之 log, 不汙染 ./logs;
//   ②計數容器與統計快取皆為新行程之空狀態. 檔尾以預設 settings 重啟、刪臨時資料夾並還原 base seed(偵測計時器會把標頭 IP 登錄進 ips 表).

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import { woItems } from '../g_mOrm.mjs'
import { callFapi, apiUrl } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'
import { pollUntil } from './tools/e2eLib.mjs'


let fdTmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'api-sourceip')
let fdLogs = path.join(fdTmp, 'logs')
let logFd = './test/_tmp/api-sourceip/logs' //相對後端之 cwd(專案根)
let ADMIN = 'token-for-admin' //base seed

//測試行程連線後端之連線位址(Node 提供, 依 IPv4 / IPv6 / mapped 形式)
let LOOP = ['127.0.0.1', '::1', '::ffff:127.0.0.1']


//w-syslog 落檔等待(同 api-srlog-noleak)
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let TIME_LOG_FLUSH = 3000


//own: 取自有屬性之值
let own = (o, k) => {
    let d = Object.getOwnPropertyDescriptor(o, k)
    return d === undefined ? undefined : d.value
}


//sumKey: 全部時間桶中某鍵之自有值加總
let sumKey = (rs, k) => rs.reduce((a, r) => a + (own(r.data, k) || 0), 0)


//allKeys: 全部時間桶中出現過之鍵(不含 count)
let allKeys = (rs) => {
    let r = new Set()
    for (let b of rs) {
        for (let k of Object.keys(b.data)) {
            if (k !== 'count') {
                r.add(k)
            }
        }
    }
    return [...r]
}


//postMain: 資料通道端點(verifyConn 先記 log 再解析本體, 本體無效不影響記錄), 同 api-iterclient; 回傳 { status, msg }
async function postMain(headers = {}) {
    return await fetch(`${apiUrl}/api/main`, { method: 'POST', headers, body: 'x' })
        .then((r) => ({ status: r.status, msg: r.headers.get('return-msg') || '' }))
        .catch((err) => ({ status: `ERR ${err.message}`, msg: '' }))
}


//ipsRows: ips 表全部列之 ip 字串
async function ipsRows() {
    let rs = await woItems.ips.select()
    return rs.map((r) => r.ip)
}


//readLogs: 本次後端寫出之 log 全文
function readLogs() {
    let text = ''
    for (let f of fs.readdirSync(fdLogs)) {
        text += fs.readFileSync(path.join(fdLogs, f), 'utf8')
    }
    return text
}


//fresh: 以臨時 settings 重啟全新後端
async function fresh(over = {}) {
    fs.mkdirSync(fdLogs, { recursive: true })
    await restartBackend(genTempSettings({ logFd, ...over }))
}


describe('來源 IP 之格式驗證與計數鍵清理經真後端 (R-IP-01 / R-CNT-01)', function() {
    this.timeout(180000)

    //不呼叫 startServersOnce: 本檔只需後端, 由 beforeEach 之 restartBackend 起(不依賴前端 8080 之編譯)

    after(async function() {
        await restartBackend('./settings.json') //還原預設 settings
        fs.rmSync(fdTmp, { recursive: true, force: true })
        await resetToBaseSeed() //標頭 IP 已被偵測計時器登錄進 ips 表
        await deleteNonBaseSeed()
    })

    beforeEach(async function() {
        this.timeout(120000)
        fs.rmSync(fdTmp, { recursive: true, force: true })
        await resetToBaseSeed()
    })


    it('IP-A-001 標頭首段非 IP: ips 表與統計皆記連線位址, 原字串不進任何持久面, log 有限流之 warn', async function() {
        await fresh()
        //1000 字元者打頭: 它必為首筆 warn(限流窗內其後者被略過), 用以驗證真實落檔的 log 只留長度與 64 字元預覽
        let bad = ['a'.repeat(1000), 'length', 'constructor', '<img src=x>', 'unknown', '1.2.3.4:abc']
        let tStart = Date.now()
        for (let v of bad) {
            await postMain({ 'X-Forwarded-For': v })
        }
        await postMain({}) //對照: 無標頭, 連線位址
        let tEnd = Date.now()
        //spec(R-IP-01): 偵測新 IP 計時器登錄 ips 表; 等連線位址之列出現後再多等一輪, 確認標頭原字串不會在後續輪次出現
        await pollUntil('ips 表出現連線位址之列', async () => (await ipsRows()).some((ip) => LOOP.includes(ip)), { timeout: 30000 })
        await sleep(2500)
        let ips = await ipsRows()
        assert.ok(ips.length >= 1)
        for (let ip of ips) {
            assert.ok(LOOP.includes(ip), `ips 表只應有連線位址, 實得 ${JSON.stringify(ip.slice(0, 40))}`)
        }
        //統計: 全部請求(含 6 筆標頭值非 IP 者)皆記連線位址
        await sleep(TIME_LOG_FLUSH)
        let r = await callFapi('getStaIp', [ADMIN])
        assert.strictEqual(r.ok, true, `getStaIp 應成功: ${r.err}`)
        let ks = allKeys(r.val)
        for (let k of ks) {
            assert.ok(LOOP.includes(k), `統計之 IP 鍵只應有連線位址, 實得 ${JSON.stringify(k.slice(0, 40))}`)
        }
        assert.ok(LOOP.reduce((a, k) => a + sumKey(r.val, k), 0) >= 7)
        //log: 有 warn(同一 10 秒窗口內限流為一筆)、不含完整的 1000 字元原值; verifyConn 之 ip 為連線位址
        let text = readLogs()
        assert.ok(text.includes('"key":"invalidForwardedFor"'), 'log 應有 invalidForwardedFor 之 warn')
        let nWarn = (text.match(/"key":"invalidForwardedFor"/g) || []).length
        //限流: 至多每 10 秒一筆, 上限依實際經過時間(含 log 落檔延遲前之請求期間)計
        let nMax = Math.floor((tEnd - tStart) / 10000) + 1
        assert.ok(nWarn >= 1 && nWarn <= nMax, `warn 應受限流(實得 ${nWarn} 筆, 經過 ${tEnd - tStart} ms, 上限 ${nMax})`)
        //首筆(1000 字元)之 log: len 為原長、preview 恰 64 字元; 完整原值不入 log
        assert.ok(text.includes('"len":1000'), 'warn 應記原長 1000')
        assert.ok(text.includes(`"preview":"${'a'.repeat(64)}"`), 'warn 應含 64 字元預覽')
        assert.ok(!text.includes('a'.repeat(65)), 'log 不得含超過 64 字元之原值')
    })

    it('IP-A-002 標頭首段為合法 IP: ips 表與統計原樣登錄(不改寫)', async function() {
        await fresh()
        let valid = ['203.0.113.9', '2001:db8::7', '::ffff:203.0.113.10', '2001:DB8::ABCD']
        for (let v of valid) {
            await postMain({ 'X-Forwarded-For': v })
        }
        await pollUntil('ips 表出現全部合法 IP', async () => {
            let ips = await ipsRows()
            return valid.every((v) => ips.includes(v))
        }, { timeout: 30000 })
        //spec(R-IP-01 規則 1): 原字串, 非正規化形式(不剝 ::ffff:、不改大小寫)
        let ips = await ipsRows()
        for (let v of valid) {
            assert.strictEqual(ips.filter((ip) => ip === v).length, 1, v)
        }
        assert.ok(!ips.includes('203.0.113.10'), '::ffff: 形式不得被剝成 IPv4')
        assert.ok(!ips.includes('2001:db8::abcd'), 'IPv6 不得被改為小寫')
        await sleep(TIME_LOG_FLUSH)
        let r = await callFapi('getStaIp', [ADMIN])
        assert.strictEqual(r.ok, true, `getStaIp 應成功: ${r.err}`)
        for (let v of valid) {
            assert.strictEqual(sumKey(r.val, v), 1, v)
        }
        //合法 IP 不觸發 warn
        assert.ok(!readLogs().includes('"key":"invalidForwardedFor"'))
    })

    it('IP-A-003 以原字串寫入 ips 表之封鎖列仍命中; 未映射形式不受影響(無正規化)', async function() {
        await fresh()
        let tFuture = ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        let oip = ds.ips.funNew({ ip: '::ffff:203.0.113.20' })
        oip.timeBlocked = tFuture
        await woItems.ips.insert([oip])
        //spec(R-IP-01 規則 1): 合法 IP 原樣, 封鎖查詢以精確字串比對 → 命中
        let rBlocked = await postMain({ 'X-Forwarded-For': '::ffff:203.0.113.20' })
        assert.strictEqual(rBlocked.msg, 'permission denied', `封鎖列應命中(實得 ${JSON.stringify(rBlocked)})`)
        //未映射形式為另一字串, 無封鎖列 → 放行(本請求之本體無效, 但不是 permission denied)
        let rOther = await postMain({ 'X-Forwarded-For': '203.0.113.20' })
        assert.notStrictEqual(rOther.msg, 'permission denied', `203.0.113.20 無封鎖列(實得 ${JSON.stringify(rOther)})`)
        //標頭非 IP → 以連線位址判定, 連線位址無封鎖列 → 放行
        let rBad = await postMain({ 'X-Forwarded-For': '::ffff:203.0.113.20x' })
        assert.notStrictEqual(rBad.msg, 'permission denied', `非 IP 標頭應以連線位址判定(實得 ${JSON.stringify(rBad)})`)
    })

    it('IP-A-004 窗口過後無新請求之 IP 其計數鍵被刪除: 系統管理者刪除之 ips 列不再被偵測計時器復活', async function() {
        //窗口 0.1 分鐘 = 6 秒(剪枝與偵測計時器皆每 2 秒, 登錄與剪枝之間留足餘裕); 門檻取大值不觸發封鎖
        await fresh({ minForIpCallApi: 0.1, numForIpCallApi: 100000 })
        let ip = '203.0.113.50'
        await postMain({ 'X-Forwarded-For': ip })
        await pollUntil('偵測計時器登錄新 IP', async () => (await ipsRows()).includes(ip), { timeout: 30000 })
        //窗口(6 秒)+ 一輪剪枝(2 秒)+ 餘裕
        await sleep(11000)
        let rows = await woItems.ips.select({ ip })
        assert.strictEqual(rows.length, 1)
        for (let e of rows) {
            await woItems.ips.del({ id: e.id })
        }
        assert.strictEqual((await woItems.ips.select({ ip })).length, 0)
        //spec(R-CNT-01): 鍵已於窗口過後被刪 → 之後的偵測輪次(至少 3 輪)不再登錄(修改前鍵永久殘留, 每 2 秒復活)
        await sleep(7000)
        assert.strictEqual((await woItems.ips.select({ ip })).length, 0, '被刪除之 ips 列不應被復活')
    })

    it('IP-A-005 標頭非 IP 時以連線位址判定: 不同非 IP 標頭值共用連線位址之計數與封鎖, 合法他 IP 不受影響', async function() {
        //門檻 6 次 / 1 分鐘, 封鎖 5 分鐘
        await fresh({ numForIpCallApi: 6, minForIpCallApi: 1, minBlockForIpCallApi: 5 })
        try {
            //8 次請求, 標頭值各不相同且皆非 IP: 修改前各成一鍵(各 1 次, 不達門檻), R-IP-01 後合併計於連線位址(8 > 6)
            let bads = ['length', 'constructor', 'unknown', '1.2.3.4:abc', '<b>x</b>', 'abc', 'def', 'ghi']
            for (let v of bads) {
                await postMain({ 'X-Forwarded-For': v })
            }
            //ipCallApi 計時器(每 2 秒)將連線位址寫入 ips.timeBlocked 為未來
            let rows = await pollUntil('連線位址被計次封鎖(ips.timeBlocked 為未來)', async () => {
                let rs = (await woItems.ips.select()).filter((r) => LOOP.includes(r.ip) && r.timeBlocked > ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                return rs.length > 0 ? rs : null
            }, { timeout: 30000 })
            assert.strictEqual(rows.length, 1)
            //spec(R-IP-01): 非 IP 標頭以連線位址判定封鎖——被拒(修改前以標頭原字串判定, 查無列而放行)
            let r1 = await postMain({ 'X-Forwarded-For': 'length' })
            assert.strictEqual(r1.msg, 'permission denied', `連線位址已封鎖, 非 IP 標頭應被拒(實得 ${JSON.stringify(r1)})`)
            let r2 = await postMain({ 'X-Forwarded-For': '999.1.1.1' })
            assert.strictEqual(r2.msg, 'permission denied')
            //合法他 IP: 以標頭值本身判定, 不受連線位址之封鎖影響
            let r3 = await postMain({ 'X-Forwarded-For': '203.0.113.77' })
            assert.notStrictEqual(r3.msg, 'permission denied', `合法他 IP 不應被拒(實得 ${JSON.stringify(r3)})`)
        }
        finally {
            //清除封鎖列, 使其後之 restartBackend 與其他測試不因連線位址被封鎖而受阻
            for (let r of await woItems.ips.select()) {
                await woItems.ips.del({ id: r.id })
            }
        }
    })

    it('IP-A-006 標頭帶 port: 去 port 取 IP, ips 表與統計皆記去 port 後之 IP(同 IP 不同 port 為同一 IP), 不退回連線位址', async function() {
        await fresh()
        //spec(run02 裁示 1): IPv4:port、[IPv6]:port 去 port 取 IP; 去後之 IP 原樣(大小寫不改)
        let reqs = [
            ['203.0.113.88:1111', '203.0.113.88'], ['203.0.113.88:2222', '203.0.113.88'], ['203.0.113.88', '203.0.113.88'],
            ['[2001:db8::88]:3333', '2001:db8::88'], ['[2001:db8::88]:4444', '2001:db8::88'], ['[2001:DB8::99]:5555', '2001:DB8::99'],
        ]
        for (let [xff] of reqs) {
            await postMain({ 'X-Forwarded-For': xff })
        }
        let expected = [...new Set(reqs.map((r) => r[1]))].sort()
        await pollUntil('ips 表出現去 port 後之全部 IP', async () => {
            let ips = await ipsRows()
            return expected.every((v) => ips.includes(v))
        }, { timeout: 30000 })
        await sleep(2500)
        //ips 表: 去 port 後之 IP 各恰一列, 無帶 port 之原字串; 其餘只可能是連線位址(測試框架重啟後端時之就緒探測不帶標頭, 其本身會登錄連線位址)
        let ips = await ipsRows()
        for (let v of expected) {
            assert.strictEqual(ips.filter((ip) => ip === v).length, 1, `${v} 應恰一列(實得 ${JSON.stringify(ips)})`)
        }
        for (let ip of ips) {
            assert.ok(expected.includes(ip) || LOOP.includes(ip), `ips 表只應有去 port 後之 IP 與連線位址, 實得 ${JSON.stringify(ip)}`)
        }
        //統計: 同 IP 不同 port 計為同一 IP(若帶 port 者退回連線位址, 下列各 IP 之計數皆為 0)
        await sleep(TIME_LOG_FLUSH)
        let r = await callFapi('getStaIp', [ADMIN])
        assert.strictEqual(r.ok, true, `getStaIp 應成功: ${r.err}`)
        for (let k of allKeys(r.val)) {
            assert.ok(expected.includes(k) || LOOP.includes(k), `統計之 IP 鍵只應有去 port 後之 IP 與連線位址, 實得 ${JSON.stringify(k)}`)
        }
        assert.strictEqual(sumKey(r.val, '203.0.113.88'), 3)
        assert.strictEqual(sumKey(r.val, '2001:db8::88'), 2)
        assert.strictEqual(sumKey(r.val, '2001:DB8::99'), 1)
        //帶 port 屬合法形式: 不記 warn
        assert.ok(!readLogs().includes('"key":"invalidForwardedFor"'), '帶 port 不應記 invalidForwardedFor')
    })

    it('IP-A-007 帶 port 之請求以 IP 本身計數與判定封鎖: 不同 port 合併計次、原字串封鎖列命中, 連線位址與他 IP 不受牽連', async function() {
        //門檻 6 次 / 1 分鐘, 封鎖 5 分鐘
        await fresh({ numForIpCallApi: 6, minForIpCallApi: 1, minBlockForIpCallApi: 5 })
        try {
            let tFuture = ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            let rowBlocked = (ip) => {
                let o = ds.ips.funNew({ ip })
                o.timeBlocked = tFuture
                return o
            }
            await woItems.ips.insert([rowBlocked('2001:db8::31'), rowBlocked('203.0.113.33')])
            //以原字串寫入之封鎖列對帶 port 之請求命中(判定以去 port 後之 IP; 修改前帶 port 者以原字串〔含 port〕判定而查無列放行)
            let rV4 = await postMain({ 'X-Forwarded-For': '203.0.113.33:4321' })
            assert.strictEqual(rV4.msg, 'permission denied', `封鎖列 203.0.113.33 應對 203.0.113.33:4321 命中(實得 ${JSON.stringify(rV4)})`)
            let rV6 = await postMain({ 'X-Forwarded-For': '[2001:db8::31]:5555' })
            assert.strictEqual(rV6.msg, 'permission denied', `封鎖列 2001:db8::31 應對 [2001:db8::31]:5555 命中(實得 ${JSON.stringify(rV6)})`)

            //8 次請求, 同一 IP 不同 port: 去 port 後合併計於同一 IP(8 > 6)而封鎖該 IP
            for (let p = 1001; p <= 1008; p++) {
                await postMain({ 'X-Forwarded-For': `203.0.113.31:${p}` })
            }
            let rows = await pollUntil('203.0.113.31 被計次封鎖(ips.timeBlocked 為未來)', async () => {
                let rs = (await woItems.ips.select()).filter((r) => r.ip === '203.0.113.31' && r.timeBlocked > ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                return rs.length > 0 ? rs : null
            }, { timeout: 30000 })
            assert.strictEqual(rows.length, 1)
            //封鎖以 IP 本身判定: 任何 port、不帶 port 皆被拒
            assert.strictEqual((await postMain({ 'X-Forwarded-For': '203.0.113.31:9999' })).msg, 'permission denied')
            assert.strictEqual((await postMain({ 'X-Forwarded-For': '203.0.113.31' })).msg, 'permission denied')
            //連線位址未被牽連(全部請求皆帶標頭、不得因帶 port 而以連線位址計次); 他 IP 不受影響
            let rConn = await postMain({})
            assert.notStrictEqual(rConn.msg, 'permission denied', `連線位址不應被封鎖(實得 ${JSON.stringify(rConn)})`)
            let rOther = await postMain({ 'X-Forwarded-For': '203.0.113.32:1001' })
            assert.notStrictEqual(rOther.msg, 'permission denied', `他 IP 不應被拒(實得 ${JSON.stringify(rOther)})`)
            let now = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            let rowsLoop = (await woItems.ips.select()).filter((r) => LOOP.includes(r.ip) && r.timeBlocked > now)
            assert.strictEqual(rowsLoop.length, 0, '連線位址不應有未來之封鎖列')
        }
        finally {
            for (let r of await woItems.ips.select()) {
                await woItems.ips.del({ id: r.id })
            }
        }
    })

})
