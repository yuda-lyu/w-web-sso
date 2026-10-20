//unit-sourceIp.test.mjs — 來源 IP 之取值: X-Forwarded-For 最左段須為合法 IP 才採用 (R-IP-01, ADR-089)
//
// 依據: CLAUDE_rulebook.md R-IP-01; spec/設計要點與取捨.md ADR-089; 使用者 2026-10-20 裁示「SSO 不做防偽造系統, 偽造屬防火牆責任」
//   - 維持語意: 取 X-Forwarded-For 以 , 分段之第一個非空段(最左); 不預設不信任、不改取最右
//   - 該段為合法 IP(net.isIP 為 4 或 6 且長度 ≤ 64)→ 原字串採用, 不改寫(不剝 ::ffff:、不改大小寫, 否則 ips 表以原字串存之封鎖列不再命中)
//   - 唯一之正規化(run02 裁示 1): IPv4:port、[IPv6]:port 去 port 取 IP(部分雲端閘道於標頭帶來源 port; 退回連線位址則多層反代下全部使用者被視為同一閘道位址);
//     去後仍非 IP 才退回連線位址
//   - 該段非空而非 IP(length、constructor、<img src=x>、unknown、1.2.3.4:abc、超長字串等)→ 退回連線位址並限流記 srLog.warn
//   - 無值(無標頭、空白、僅逗號)→ 靜默退回連線位址, 不記 warn; 各段 trim 後略過空段(沿用 wsemi sep)
// 以真實 procProtect 工廠取得 pp.getIpByHeaders(unitProc.buildProtect); 不起 server.
//   IP-U-001 合法 IP 原樣(含長度邊界)    IP-U-002 非 IP 退回連線位址並記 warn    IP-U-003 無值靜默退回
//   IP-U-004 多段只看最左    IP-U-005 退回順序與皆無    IP-U-006 warn 限流(含時鐘回撥)    IP-U-007 srLog 缺席不拋錯
//   IP-U-008 srLog.warn 拋錯 / reject 不影響取 IP    IP-U-009 preview 控制字元置換
//   IP-U-010 IPv4:port / [IPv6]:port 去 port 取 IP(同 IP 不同 port 為同一 IP)    IP-U-011 去 port 後仍非 IP 或非支援形式 → 退回連線位址並記 warn
//   SITE-IP-001/002 站點守門

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildProtect, mkSrLog, withFakeClock } from './tools/unitProc.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdServer = path.resolve(__dirname, '..', 'server')


//連線位址(測試用, 與任何標頭值皆不同)
let SOCK = '10.9.9.9'


//mkEnv: 真實 procProtect 工廠(計時器不啟用, 本檔只用 getIpByHeaders)
function mkEnv(srLog = mkSrLog()) {
    let { pp } = buildProtect({}, {}, { srLog })
    return { pp, srLog }
}


//mkReq: 請求替身, xff 為 undefined 時不帶標頭
function mkReq(xff, extra = {}) {
    let headers = {}
    if (xff !== undefined) {
        headers['x-forwarded-for'] = xff
    }
    return { headers, info: { remoteAddress: SOCK }, ...extra }
}


//warns: invalidForwardedFor 之 warn 紀錄
let warns = (srLog) => srLog.logs.warn.filter((o) => o.event === 'fun-getIpByHeaders' && o.key === 'invalidForwardedFor')


describe('來源 IP 之取值 (R-IP-01, ADR-089)', function() {

    it('IP-U-001 合法 IP 原樣採用(不改寫), 不記 warn', function() {
        //spec(R-IP-01 規則 1): net.isIP 為 4 或 6 者原字串採用; 不剝 ::ffff:、不改大小寫、不壓縮
        let valid = [
            '203.0.113.9', '0.0.0.0', '255.255.255.255', '127.0.0.1',
            '::1', '::', '2001:db8::1', '2001:DB8::ABCD', '2001:0db8:0000:0000:0000:0000:0000:0001',
            '::ffff:203.0.113.9', '::FFFF:203.0.113.9', '::ffff:cb00:7109', 'fe80::1%eth0',
            //IPv6 文字最長 45 字元(含內嵌 IPv4)與帶短 zone 識別碼者(長度 ≤ 64)
            '0000:0000:0000:0000:0000:ffff:255.255.255.255', 'fe80::1%en0.1',
            //長度上限邊界: 63、64 字元(含 zone)皆採用
            `fe80::1%${'a'.repeat(55)}`, `fe80::1%${'a'.repeat(56)}`,
        ]
        for (let v of valid) {
            let env = mkEnv()
            assert.strictEqual(env.pp.getIpByHeaders(mkReq(v)), v, v)
            assert.strictEqual(warns(env.srLog).length, 0, v)
        }
        assert.strictEqual(valid[valid.length - 1].length, 64)
        //前後空白沿用既有行為: 先 trim 再驗證, 採用 trim 後之值
        let env = mkEnv()
        assert.strictEqual(env.pp.getIpByHeaders(mkReq('  203.0.113.9  ')), '203.0.113.9')
        assert.strictEqual(warns(env.srLog).length, 0)
    })

    it('IP-U-002 第一段非 IP: 退回連線位址並記 warn(含 key、長度、前 64 字元預覽、採用之連線位址)', function() {
        let bad = [
            'length', 'constructor', '__proto__', 'toString', '<img src=x>', '<b>x</b>',
            'unknown', '_hidden', 'null', '1.2.3.4:abc', '[::1]', '1.2.3', '1.2.3.4.5', '256.1.1.1',
            '0x7f.0.0.1', '127.1', '01.02.03.04', '1.2.3.4 5.6.7.8', '1.2.3.4\'; x y;--',
            '１２７.0.0.1', '::g', 'fe80::1%', 'a'.repeat(1000),
            //net.isIP 對 IPv6 zone 識別碼長度無上限(下列者 isIP 皆為 6), 超過 64 字元者不採用
            `fe80::1%${'a'.repeat(57)}`, `fe80::1%${'a'.repeat(100)}`, `::1%${'b'.repeat(15000)}`,
        ]
        for (let v of bad) {
            let env = mkEnv()
            //spec: 退回連線位址(原實作回標頭原字串)
            assert.strictEqual(env.pp.getIpByHeaders(mkReq(v)), SOCK, v.slice(0, 30))
            let ws = warns(env.srLog)
            assert.strictEqual(ws.length, 1, v.slice(0, 30))
            assert.strictEqual(ws[0].len, v.length)
            assert.strictEqual(ws[0].preview, v.slice(0, 64))
            assert.strictEqual(ws[0].ip, SOCK)
            assert.strictEqual(ws[0].suppressed, 0)
            //spec: log 物件不帶完整原值(超長字串只留 64 字元預覽)
            assert.ok(JSON.stringify(ws[0]).length < 400, 'warn 紀錄長度')
        }
        //邊界: 65 字元(含 zone)被拒, 64 字元(IP-U-001)被採用
        assert.strictEqual(`fe80::1%${'a'.repeat(57)}`.length, 65)
    })

    it('IP-U-003 標頭無值(無標頭、空值、空白、僅逗號): 靜默退回連線位址, 不記 warn', function() {
        for (let xff of [undefined, '', '   ', ',', ' , ,']) {
            let env = mkEnv()
            //spec: 空值不是「非 IP 字串」, 與無標頭同
            assert.strictEqual(env.pp.getIpByHeaders(mkReq(xff)), SOCK, JSON.stringify(xff))
            assert.strictEqual(env.srLog.logs.warn.length, 0, JSON.stringify(xff))
        }
    })

    it('IP-U-004 多段只看最左(第一個非空段): 合法者採用; 非 IP 即退回連線位址(不改取後段)', function() {
        let env = mkEnv()
        //spec(使用者裁示): 維持最左段語意
        assert.strictEqual(env.pp.getIpByHeaders(mkReq('203.0.113.9, 10.0.0.1, 10.0.0.2')), '203.0.113.9')
        assert.strictEqual(env.pp.getIpByHeaders(mkReq('2001:db8::1,198.51.100.7')), '2001:db8::1')
        assert.strictEqual(warns(env.srLog).length, 0)
        //沿用既有行為: 各段 trim 後略過空段(wsemi sep), 取第一個非空段
        assert.strictEqual(env.pp.getIpByHeaders(mkReq(', 203.0.113.9')), '203.0.113.9')
        assert.strictEqual(env.pp.getIpByHeaders(mkReq(' , 2001:db8::1 , 10.0.0.1')), '2001:db8::1')
        //後段為非 IP 或超長不影響首段被採用(只驗證被選中的那一段, 不因後段拒絕、不記 warn)
        assert.strictEqual(env.pp.getIpByHeaders(mkReq(`203.0.113.9, garbage, ${'z'.repeat(500)}`)), '203.0.113.9')
        assert.strictEqual(warns(env.srLog).length, 0)
        //首段非 IP: 不取後段(取後段等於改變語意)
        let env2 = mkEnv()
        assert.strictEqual(env2.pp.getIpByHeaders(mkReq('garbage, 203.0.113.9')), SOCK)
        let ws = warns(env2.srLog)
        assert.strictEqual(ws.length, 1)
        assert.strictEqual(ws[0].len, 7)
    })

    it('IP-U-005 退回順序 info → socket → connection; 空白或缺席者續往下; 皆無則為空字串', function() {
        let xff = 'length'
        let mk = (o) => ({ headers: { 'x-forwarded-for': xff }, ...o })
        let env = mkEnv()
        assert.strictEqual(env.pp.getIpByHeaders(mk({ info: { remoteAddress: '10.1.1.1' }, socket: { remoteAddress: '10.2.2.2' }, connection: { remoteAddress: '10.3.3.3' } })), '10.1.1.1')
        assert.strictEqual(env.pp.getIpByHeaders(mk({ socket: { remoteAddress: '10.2.2.2' }, connection: { remoteAddress: '10.3.3.3' } })), '10.2.2.2')
        assert.strictEqual(env.pp.getIpByHeaders(mk({ connection: { remoteAddress: '10.3.3.3' } })), '10.3.3.3')
        //上一層為空白字串: 續往下一層(trim 後為空視同缺席)
        assert.strictEqual(env.pp.getIpByHeaders(mk({ info: { remoteAddress: '  ' }, socket: { remoteAddress: '10.2.2.2' } })), '10.2.2.2')
        assert.strictEqual(env.pp.getIpByHeaders(mk({ socket: { remoteAddress: '' }, connection: { remoteAddress: '10.3.3.3' } })), '10.3.3.3')
        //皆無: 空字串(呼叫端 verifyConn 以 getBlockedByIp 之 invalid ip 視為封鎖, 行為同修改前無標頭且無連線位址)
        assert.strictEqual(env.pp.getIpByHeaders(mk({})), '')
        //請求物件缺席或無標頭: 不拋錯
        assert.strictEqual(env.pp.getIpByHeaders(undefined), '')
        assert.strictEqual(env.pp.getIpByHeaders({}), '')
        assert.strictEqual(env.pp.getIpByHeaders({ info: { remoteAddress: '10.1.1.1' } }), '10.1.1.1')
        //連線位址為 IPv4-mapped 等 Node 提供之形式: 不再驗證、原樣
        assert.strictEqual(env.pp.getIpByHeaders(mk({ info: { remoteAddress: '::ffff:127.0.0.1' } })), '::ffff:127.0.0.1')
    })

    it('IP-U-006 warn 限流: 10 秒內至多一筆, 被略過之次數於下一筆以 suppressed 帶出; 時鐘回撥不致每筆皆記', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            let t0 = clock.now()
            assert.strictEqual(env.pp.getIpByHeaders(mkReq('length')), SOCK)
            assert.strictEqual(env.pp.getIpByHeaders(mkReq('constructor')), SOCK)
            clock.advance(9999)
            assert.strictEqual(env.pp.getIpByHeaders(mkReq('<img src=x>')), SOCK)
            //spec: 回傳值不受限流影響(每次皆退回連線位址), 只有 warn 受限
            let ws = warns(env.srLog)
            assert.strictEqual(ws.length, 1)
            assert.strictEqual(ws[0].preview, 'length')
            assert.strictEqual(ws[0].suppressed, 0)
            //滿 10 秒後下一筆 warn 帶出被略過之 2 筆
            clock.set(t0 + 10000)
            env.pp.getIpByHeaders(mkReq('unknown'))
            ws = warns(env.srLog)
            assert.strictEqual(ws.length, 2)
            assert.strictEqual(ws[1].preview, 'unknown')
            assert.strictEqual(ws[1].suppressed, 2)
            //再下一個窗口: 無被略過者, suppressed 歸零
            clock.advance(10000)
            env.pp.getIpByHeaders(mkReq('_hidden'))
            ws = warns(env.srLog)
            assert.strictEqual(ws.length, 3)
            assert.strictEqual(ws[2].suppressed, 0)
            //合法 IP 不觸發 warn 亦不影響限流狀態
            env.pp.getIpByHeaders(mkReq('203.0.113.9'))
            assert.strictEqual(warns(env.srLog).length, 3)
        })
    })

    it('IP-U-006b 時鐘回撥: 連續回撥每筆不致皆記 warn; 回撥後滿 10 秒再記並帶出被略過數', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            let t0 = clock.now()
            env.pp.getIpByHeaders(mkReq('a1'))
            assert.strictEqual(warns(env.srLog).length, 1)
            //連續回撥 1 ms 三次(原實作每次皆因 now < 前次而視為新窗口, 共記 4 筆)
            for (let i = 1; i <= 3; i++) {
                clock.set(t0 - i)
                env.pp.getIpByHeaders(mkReq(`a${i + 1}`))
            }
            assert.strictEqual(warns(env.srLog).length, 1)
            //自最後一次回撥點起滿 10 秒: 再記一筆, 帶出被略過之 3 筆
            clock.set(t0 - 3 + 10000)
            env.pp.getIpByHeaders(mkReq('a5'))
            let ws = warns(env.srLog)
            assert.strictEqual(ws.length, 2)
            assert.strictEqual(ws[1].suppressed, 3)
            //大幅回撥(1 小時): 略過本筆並以現時重設窗口; 滿 10 秒後恢復正常記錄
            clock.set(t0 - 3600 * 1000)
            env.pp.getIpByHeaders(mkReq('a6'))
            assert.strictEqual(warns(env.srLog).length, 2)
            clock.advance(10000)
            env.pp.getIpByHeaders(mkReq('a7'))
            ws = warns(env.srLog)
            assert.strictEqual(ws.length, 3)
            assert.strictEqual(ws[2].suppressed, 1)
        })
    })

    it('IP-U-007 srLog 未給或無 warn 函式: 退回連線位址且不拋錯(同 logError 之守衛)', function() {
        let { pp } = buildProtect({}, {}, {})
        assert.strictEqual(pp.getIpByHeaders(mkReq('length')), SOCK)
        let { pp: pp2 } = buildProtect({}, {}, { srLog: { info: () => {} } })
        assert.strictEqual(pp2.getIpByHeaders(mkReq('constructor')), SOCK)
    })

    it('IP-U-008 srLog.warn 同步拋錯或回傳 reject: 取 IP 結果不受影響(記錄失敗不得放大為請求失敗)', async function() {
        //同步拋錯
        let nThrow = 0
        let warnThrow = () => {
            nThrow++
            throw new Error('disk full')
        }
        let { pp } = buildProtect({}, {}, { srLog: { warn: warnThrow } })
        //spec: 使用端以非 IP 標頭即可觸發此記錄路徑, 記錄器故障時仍須回連線位址
        assert.strictEqual(pp.getIpByHeaders(mkReq('length')), SOCK)
        assert.strictEqual(nThrow, 1)
        //回傳被 reject 之 Promise: 不產生未處理之 rejection
        let unhandled = []
        let onUnhandled = (err) => {
            unhandled.push(err)
        }
        process.on('unhandledRejection', onUnhandled)
        try {
            let { pp: pp2 } = buildProtect({}, {}, { srLog: { warn: () => Promise.reject(new Error('async fail')) } })
            assert.strictEqual(pp2.getIpByHeaders(mkReq('constructor')), SOCK)
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
        assert.deepStrictEqual(unhandled, [])
    })

    it('IP-U-009 preview 之控制字元置換為 ?(同 maskToken 之 log 衛生), len 為原長', function() {
        let env = mkEnv()
        let v = `\u0001ab\u007fc\u001bd`
        assert.strictEqual(env.pp.getIpByHeaders(mkReq(v)), SOCK)
        let ws = warns(env.srLog)
        assert.strictEqual(ws.length, 1)
        assert.strictEqual(ws[0].len, 7)
        assert.strictEqual(ws[0].preview, '?ab?c?d')
    })

    it('IP-U-010 IPv4:port 與 [IPv6]:port 去 port 取 IP(唯一之正規化): 同 IP 不同 port 為同一 IP, 不記 warn, 去後之 IP 原樣', function() {
        //spec(run02 裁示 1): 帶 port 者不得退回連線位址(否則多層反代下全部使用者被視為同一閘道位址); 其餘合法 IP 字串仍原樣、不改寫
        let cases = [
            ['203.0.113.9:8080', '203.0.113.9'], ['203.0.113.9:0', '203.0.113.9'], ['203.0.113.9:1', '203.0.113.9'],
            ['203.0.113.9:65535', '203.0.113.9'], ['203.0.113.9:00080', '203.0.113.9'], ['0.0.0.0:80', '0.0.0.0'],
            ['  203.0.113.9:443  ', '203.0.113.9'],
            ['[2001:db8::1]:443', '2001:db8::1'], ['[::1]:80', '::1'], ['[::]:80', '::'],
            //括號形式之 port 邊界(與 IPv4 形式對稱): 0、1、65535
            ['[::1]:0', '::1'], ['[::1]:1', '::1'], ['[::1]:65535', '::1'], ['[2001:db8::1]:0', '2001:db8::1'], ['[2001:db8::1]:65535', '2001:db8::1'],
            ['[fe80::1%eth0]:65535', 'fe80::1%eth0'], ['[::1]:00080', '::1'],
            //去後之 IP 原樣: 不改大小寫、不剝 ::ffff:、不去 zone
            ['[2001:DB8::ABCD]:8080', '2001:DB8::ABCD'], ['[::ffff:203.0.113.9]:80', '::ffff:203.0.113.9'], ['[::FFFF:203.0.113.9]:80', '::FFFF:203.0.113.9'],
            ['[fe80::1%eth0]:80', 'fe80::1%eth0'],
            //長度上限針對去 port 後之 IP: 64 字元(含 zone)採用
            [`[fe80::1%${'a'.repeat(56)}]:80`, `fe80::1%${'a'.repeat(56)}`],
            //只看最左段: 其後之段為任何內容皆不影響
            ['203.0.113.9:8080, 10.0.0.1:99', '203.0.113.9'], ['[2001:db8::1]:443, 198.51.100.7', '2001:db8::1'], [', 203.0.113.9:8080', '203.0.113.9'],
            //裸 IPv6 本身即合法(尾綴像 port 者不是 port): 原樣
            ['2001:db8::1:80', '2001:db8::1:80'], ['::1:80', '::1:80'], ['2001:db8:0:0:0:0:0:1', '2001:db8:0:0:0:0:0:1'],
        ]
        for (let [raw, expected] of cases) {
            let env = mkEnv()
            assert.strictEqual(env.pp.getIpByHeaders(mkReq(raw)), expected, raw)
            assert.strictEqual(warns(env.srLog).length, 0, raw)
        }
        //同一 IP 不同 port(與不帶 port)為同一 IP
        let env = mkEnv()
        let a = env.pp.getIpByHeaders(mkReq('203.0.113.9:1111'))
        let b = env.pp.getIpByHeaders(mkReq('203.0.113.9:2222'))
        let c = env.pp.getIpByHeaders(mkReq('203.0.113.9'))
        assert.deepStrictEqual([a, b, c], ['203.0.113.9', '203.0.113.9', '203.0.113.9'])
        let d = env.pp.getIpByHeaders(mkReq('[2001:db8::7]:1111'))
        let e = env.pp.getIpByHeaders(mkReq('[2001:db8::7]:2222'))
        assert.deepStrictEqual([d, e], ['2001:db8::7', '2001:db8::7'])
        assert.strictEqual(warns(env.srLog).length, 0)
    })

    it('IP-U-011 去 port 後仍非 IP 或非支援之形式: 才退回連線位址並記 warn(len / preview 為整段原值)', function() {
        let bad = [
            //去 port 後仍非 IP
            '256.1.1.1:80', '1.2.3.:80', '01.02.03.04:80', '[::g]:80', '[]:80', `[fe80::1%${'a'.repeat(57)}]:80`,
            //port 非 1~5 位十進位數字或超過 65535 或為空
            '1.2.3.4:abc', '1.2.3.4:65536', '1.2.3.4:99999', '1.2.3.4:123456', '1.2.3.4:000080', '1.2.3.4:', '1.2.3.4:-1', '1.2.3.4:8o', '[::1]:abc', '[::1]:65536', '[::1]:000080', '[::1]:',
            //非 IPv4:port / [IPv6]:port 之形式
            '1.2.3.4:80:90', '1.2.3.4: 80', '[::1]', '[::1]x:80', 'x[::1]:80', '[[::1]]:80', '[::1]:80]', '[1.2.3.4]:80', '::1]:80', '[::1:80',
            'length:80', 'localhost:80', 'unknown:8080', 'a'.repeat(100) + ':80',
            //前綴雜字 / 多出的位元組(正規式須有 ^ 與 $ 錨點; 外審 agy-opus 之存活變異: 去 ^ 後仍全綠)
            'x1.2.3.4:80', '1.1.2.3.4:80', 'xx[::1]:80', '1.2.3.4:80x', '[::1]:80x', 'v1.2.3.4:80',
            //非預期之裸形式: 帶 :port 之 IPv4-mapped(不屬 IPv4:port / [IPv6]:port, 依裁示僅此兩種形式去 port; 外審 agy-opus 提出, 不採)
            '::ffff:203.0.113.9:5678',
        ]
        for (let raw of bad) {
            let env = mkEnv()
            assert.strictEqual(env.pp.getIpByHeaders(mkReq(raw)), SOCK, raw.slice(0, 30))
            let ws = warns(env.srLog)
            assert.strictEqual(ws.length, 1, raw.slice(0, 30))
            assert.strictEqual(ws[0].len, raw.trim().length, raw.slice(0, 30))
            assert.strictEqual(ws[0].preview, raw.trim().slice(0, 64), raw.slice(0, 30))
            assert.strictEqual(ws[0].ip, SOCK)
        }
    })

})


//站點守門(R-IP-01): 取 X-Forwarded-For 之唯一站點與驗證方式
describe('來源 IP 取值之站點守門 (R-IP-01)', function() {

    //去除區塊註解與行註解後之原始碼(簡化處理: 行註解自 // 起至行尾)
    let codeOf = (fp) => fs.readFileSync(fp, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    let listFiles = (dir) => {
        let r = []
        for (let e of fs.readdirSync(dir, { withFileTypes: true })) {
            let fp = path.join(dir, e.name)
            if (e.isDirectory()) {
                r.push(...listFiles(fp))
            }
            else if (e.name.endsWith('.mjs')) {
                r.push(fp)
            }
        }
        return r
    }

    it('SITE-IP-001 server/ 內只有 procProtect.mjs 的程式碼(非註解)讀取 x-forwarded-for', function() {
        let hits = listFiles(fdServer).filter((fp) => /x-forwarded-for/i.test(codeOf(fp))).map((fp) => path.basename(fp))
        assert.deepStrictEqual(hits, ['procProtect.mjs'])
    })

    //proc 內第一層函式之完整本體(自宣告起至其縮排 4 格之結尾大括號; 不以 return 截斷), 去行註解
    let bodyOf = (name) => {
        let src = fs.readFileSync(path.join(fdServer, 'procProtect.mjs'), 'utf8').replace(/\r\n/g, '\n')
        let i = src.indexOf(`    let ${name} = `)
        assert.ok(i >= 0, `找不到 ${name}`)
        let j = src.indexOf('\n    }\n', i)
        assert.ok(j > i, `找不到 ${name} 結尾`)
        return { src, code: src.slice(i, j).replace(/\/\/.*$/gm, '') }
    }

    it('SITE-IP-002 取值經 pickForwardedIp(單一擁有者): 以 isIP 驗證、不通過者回空字串, 兩函數對採用值皆不做改寫(去 port 只靠擷取群組)', function() {
        let { src, code: codePick } = bodyOf('pickForwardedIp')
        let { code: codeGet } = bodyOf('getIpByHeaders')
        assert.ok(/from 'net'/.test(src), '應自 net 匯入 isIP')
        assert.ok(/isIP\(/.test(codePick), 'pickForwardedIp 應以 isIP 驗證')
        //驗證不得是死碼: 不通過者回空字串, 使 getIpByHeaders 退回連線位址
        assert.ok(/return ''/.test(codePick), '驗證不通過者應回空字串')
        assert.ok(/pickForwardedIp\(/.test(codeGet), 'getIpByHeaders 應經 pickForwardedIp 取值')
        //getIpByHeaders 不再自行驗證或改寫(單一擁有者)
        assert.ok(!/isIP\(/.test(codeGet), 'getIpByHeaders 不應自行驗證 IP')
        for (let [name, code] of [['pickForwardedIp', codePick], ['getIpByHeaders', codeGet]]) {
            assert.ok(!/\.(replace|replaceAll|toLowerCase|toUpperCase|slice|substring|substr|split)\(/.test(code), `${name} 不得改寫採用值`)
        }
    })

})
