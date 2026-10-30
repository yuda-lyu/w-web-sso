//unit-queryKey.test.mjs — 以使用端給定之欄位名查使用者: 欄位名白名單 id / account / email / name (R-QKEY-01, run02 裁示 2 與 3)
//
// 依據: CLAUDE_rulebook.md R-QKEY-01; 主控第 93 項 run01 複審裁示
//   - 查詢欄位名採白名單 id / account / email / name: 白名單外 reject 固定 key 'invalidUserQueryKey', 不回顯 key 與 value, 不查資料庫
//   - 檢查置於 checkToken 之後(未授權者先得 tokenExpired, 不得藉此探測白名單)
//   - procCore._getGenUserByKV 的 debug 記錄(userNotFound / userDuplicate)之 valueUser 以 maskKv 遮罩(與同函式 console 一致)
//   - 對外 helper 之網址範本檢查改完整參數比對見 unit-external-helpers
// 以真實 procCore 工廠搭配記憶體資料表; 不起 server. 經真後端之 HTTP / kpfun 案例見 api-getuserinfor、api-srlog-noleak.
//   QK-001 白名單內四欄可查    QK-002 白名單外全被拒且不查庫    QK-003 非字串欄位名被拒
//   QK-004 reject 值為固定 key、不含 key 與 value    QK-005 未授權先得 tokenExpired
//   QK-006 白名單內查無 → null(行為不變)    QK-007 debug 記錄之 valueUser 遮罩    SITE-QK-001/002 站點守門

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import procLang from '../server/procLang.mjs'
import { keysUserQuery, maskKv, capText, LOG_TEXT_MAX } from '../server/srLog.mjs'
import { mkOpt, buildProc, mkSrLog, mkTable, mkProcOrm } from './tools/unitProc.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdRoot = path.resolve(__dirname, '..')

let SALT = mkOpt().salt
let HASH = hashPassword('Init@1234', SALT)
let tFuture = () => ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')


//mkEnv: 兩位使用者(admin1 / zuser)與一張有效權杖, 另可附加 extraUsers
function mkEnv(extraUsers = []) {
    let u = (id, account, order, ext = {}) => ({
        ...ds.users.funNew({ account, name: `name-${account}`, email: `${account}@example.com`, password: HASH, isAdmin: 'n', timeVerified: '2026-01-01T00:00:00.000+08:00' }),
        id,
        order,
        ...ext,
    })
    let users = mkTable([u('u-admin', 'admin1', 1, { isAdmin: 'y' }), u('u-z', 'zuser', 2, { tokenVerify: 'TV-SECRET-OF-ZUSER-0123456789' }), ...extraUsers.map((e, i) => u(e.id, e.account, 10 + i, e.ext || {}))])
    let tokens = mkTable([{ ...ds.tokens.funNew({ userId: 'u-admin' }), id: 't-admin', token: 'tk-admin', isApp: 'n', timeEnd: tFuture() }])
    let ips = mkTable([])
    let woItems = { users, tokens, ips }
    let srLog = mkSrLog()
    let p = buildProc(woItems, mkProcOrm(ds, woItems), { srLog })
    return { users, tokens, p, srLog }
}


//run: 回 { ok, v }
let run = (fn) => fn().then((v) => ({ ok: true, v }), (v) => ({ ok: false, v }))


describe('以使用端給定之欄位名查使用者——白名單 id / account / email / name (R-QKEY-01)', function() {

    it('QK-001 白名單內四欄可查: 命中回白名單欄位之物件(不含 password)', async function() {
        let env = mkEnv()
        //spec(R-QKEY-01 規則 1): id / account / email / name 照常查
        let cases = [['id', 'u-z'], ['account', 'zuser'], ['email', 'zuser@example.com'], ['name', 'name-zuser']]
        for (let [key, value] of cases) {
            let r = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', key, value))
            assert.strictEqual(r.ok, true, `${key}: ${JSON.stringify(r.v)}`)
            assert.strictEqual(r.v.id, 'u-z', key)
            assert.strictEqual(r.v.account, 'zuser', key)
            assert.strictEqual(r.v.password, undefined, key)
        }
        assert.deepStrictEqual([...keysUserQuery].sort(), ['account', 'email', 'id', 'name'])
    })

    it('QK-002 白名單外之欄位名一律 reject invalidUserQueryKey, 不查資料庫(憑證欄、建立者欄、旗標欄、原型鍵名、近似名稱)', async function() {
        let env = mkEnv()
        let bad = [
            'tokenVerify', 'password', 'userId', 'userIdUpdate', 'isAdmin', 'isActive', 'timeBlocked', 'token', 'description', 'from', 'redir', 'order',
            //原型鍵名(白名單以陣列比對, 不是物件鍵查詢)
            'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'length',
            //近似名稱、大小寫、前後空白、路徑樣式、運算子樣式
            'ID', 'Id', 'Account', 'EMAIL', 'Name', 'id ', ' id', 'account\n', 'id.x', 'a.b', '$ne', '$where', 'id,account', 'id=x', 'idx', 'accounts',
            'x'.repeat(5000),
        ]
        //checkToken 本身會讀使用者(使用者當前狀態判定, S-4), 先量一次 checkToken 之查詢數, 其後白名單外之查詢不得再多查
        let n0 = env.users.calls.select
        await env.p.checkToken('tk-admin')
        let perCheck = env.users.calls.select - n0
        for (let key of bad) {
            let nSel = env.users.calls.select
            let r = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', key, 'zuser'))
            assert.strictEqual(r.ok, false, key.slice(0, 20))
            assert.strictEqual(r.v, 'invalidUserQueryKey', key.slice(0, 20))
            //spec: 白名單外不進資料庫(不作為選擇器鍵): 除 checkToken 之使用者狀態查詢外無其他查詢
            assert.strictEqual(env.users.calls.select - nSel, perCheck, `${key.slice(0, 20)} 不應查庫`)
        }
    })

    it('QK-003 欄位名非字串(型別錯誤)亦 reject invalidUserQueryKey, 不查資料庫', async function() {
        let env = mkEnv()
        let n0 = env.users.calls.select
        await env.p.checkToken('tk-admin')
        let perCheck = env.users.calls.select - n0 //checkToken 本身會讀使用者(使用者當前狀態判定, S-4)
        for (let key of [undefined, null, 1, true, {}, ['id'], () => 'id', Symbol.iterator]) {
            let nSel = env.users.calls.select
            let r = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', key, 'zuser'))
            assert.strictEqual(r.ok, false, String(key))
            assert.strictEqual(r.v, 'invalidUserQueryKey', String(key))
            assert.strictEqual(env.users.calls.select - nSel, perCheck)
        }
    })

    it('QK-004 reject 值為固定 key: 不含欄位名與查詢值之任何內容; procLang 有 eng + cht', async function() {
        let env = mkEnv()
        let key = 'SECRET-KEY-NAME-9f3a'
        let value = 'SECRET-VALUE-7c2b'
        let r = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', key, value))
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.v, 'invalidUserQueryKey')
        assert.ok(!String(r.v).includes('SECRET'), 'reject 值不得回顯 key 或 value')
        //srLog 未被寫入欄位名與查詢值(此層不記; 入口層之 info 記錄見 api-srlog-noleak)
        let text = JSON.stringify(env.srLog.logs)
        assert.ok(!text.includes('SECRET-VALUE'), 'srLog 不得含查詢值')
        //procLang 有 eng + cht(系統回應文字須有 key 與對應語系文字)
        let kp = procLang()
        assert.ok(typeof kp.eng.invalidUserQueryKey === 'string' && kp.eng.invalidUserQueryKey !== '', 'procLang 應有 invalidUserQueryKey.eng')
        assert.ok(typeof kp.cht.invalidUserQueryKey === 'string' && kp.cht.invalidUserQueryKey !== '', 'procLang 應有 invalidUserQueryKey.cht')
        assert.ok(!kp.eng.invalidUserQueryKey.includes('SECRET'))
    })

    it('QK-005 未授權者先得 tokenExpired(檢查在 checkToken 之後): 無效權杖不論欄位名是否在白名單皆回 tokenExpired, 不得探測白名單', async function() {
        let env = mkEnv()
        for (let key of ['account', 'tokenVerify', 'constructor']) {
            let r = await run(() => env.p.checkTokenAndGetUserInfor('no-such-token', key, 'zuser'))
            assert.strictEqual(r.ok, false, key)
            assert.strictEqual(r.v, 'tokenExpired', key)
        }
    })

    it('QK-006 白名單內查無或重複: 行為不變(回 null, 不洩漏存在性)', async function() {
        let env = mkEnv([{ id: 'u-dup1', account: 'dup', ext: { name: 'same-name' } }, { id: 'u-dup2', account: 'dup2', ext: { name: 'same-name' } }])
        let r1 = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', 'account', 'no-such-account'))
        assert.deepStrictEqual(r1, { ok: true, v: null })
        let r2 = await run(() => env.p.checkTokenAndGetUserInfor('tk-admin', 'name', 'same-name'))
        assert.deepStrictEqual(r2, { ok: true, v: null }, 'name 重複 → 視同無權限(null)')
    })

    it('QK-007 _getGenUserByKV 之 debug 記錄: valueUser 以 maskKv 遮罩(非識別欄之值可能即憑證); 識別欄照記供追查', async function() {
        let secret = 'TV-SECRET-OF-ZUSER-0123456789'
        let missing = 'TV-MISSING-SECRET-ABCDEFGHIJ'
        let dup = 'TV-DUP-SECRET-KLMNOPQRSTUV'
        let dupName = 'dup-name-0123456789-plain'
        let env = mkEnv([
            { id: 'u-d1', account: 'd1', ext: { tokenVerify: dup } }, { id: 'u-d2', account: 'd2', ext: { tokenVerify: dup } },
            { id: 'u-n1', account: 'n1', ext: { name: dupName } }, { id: 'u-n2', account: 'n2', ext: { name: dupName } },
        ])
        //userNotFound: 非識別欄、查無
        let r1 = await run(() => env.p.getGenUserByKV('tokenVerify', missing))
        assert.strictEqual(r1.ok, false)
        //userDuplicate: 非識別欄、重複
        let r2 = await run(() => env.p.getGenUserByKV('tokenVerify', dup))
        assert.strictEqual(r2.ok, false)
        //userNotFound: 識別欄、查無(照記)
        let r3 = await run(() => env.p.getGenUserByKV('account', 'nobody-here'))
        assert.strictEqual(r3.ok, false)
        //userDuplicate: 識別欄、重複(照記; 與 userNotFound 之識別欄對稱)
        let r4 = await run(() => env.p.getGenUserByKV('name', dupName))
        assert.strictEqual(r4.ok, false)
        let ds1 = env.srLog.logs.debug.filter((o) => o.event === 'fun-getGenUserByKV')
        assert.strictEqual(ds1.length, 4)
        let [a, b, c, d4] = ds1
        assert.strictEqual(a.key, 'userNotFound')
        assert.strictEqual(b.key, 'userDuplicate')
        assert.strictEqual(c.key, 'userNotFound')
        //spec(R-QKEY-01 規則 4): 非識別欄之值遮罩, 完整值不得出現於任何紀錄
        assert.strictEqual(a.valueUser, maskKv('tokenVerify', missing))
        assert.strictEqual(b.valueUser, maskKv('tokenVerify', dup))
        assert.notStrictEqual(a.valueUser, missing)
        assert.notStrictEqual(b.valueUser, dup)
        let text = JSON.stringify(env.srLog.logs)
        for (let s of [missing, dup, secret]) {
            assert.ok(!text.includes(s), `srLog 不得含完整查詢值 ${s.slice(0, 8)}…`)
        }
        //識別欄照記
        assert.strictEqual(c.valueUser, 'nobody-here')
        assert.strictEqual(c.keyUser, 'account')
        assert.strictEqual(d4.key, 'userDuplicate')
        assert.strictEqual(d4.valueUser, dupName, '識別欄(name)之重複亦照記原值')
        //maskKv 對近似名稱(大小寫不同、前後空白、控制字元)一律視為非識別欄而遮罩(外審 agy-opus 之格); 四個識別欄原樣
        for (let k of ['ID', 'Id', 'account ', ' account', 'EMAIL', 'Name', 'name\n', 'constructor', '__proto__', 'userId', 'token', '']) {
            assert.notStrictEqual(maskKv(k, secret), secret, `maskKv(${JSON.stringify(k)}) 應遮罩`)
            assert.ok(maskKv(k, secret).includes('(len='), `maskKv(${JSON.stringify(k)}) 應為遮罩形式`)
        }
        for (let k of keysUserQuery) {
            assert.strictEqual(maskKv(k, secret), secret, `maskKv(${k}) 識別欄應原樣`)
        }
        for (let k of [undefined, null, 1, {}, ['id']]) {
            assert.notStrictEqual(maskKv(k, secret), secret, `maskKv(非字串欄位名) 應遮罩`)
        }
    })

    it('QK-008 _getGenUserByKV 資料庫錯誤分支之 console 輸出: 查詢值(非識別欄與識別欄)一律只給型別、不輸出其值(console 屬 R-SEC-01 輸出面; ADR-101 取代原「非識別欄遮罩、識別欄照記」), 識別欄之欄位名照印、名單外之欄位名只給型別', async function() {
        let secret = 'TV-CONSOLE-SECRET-0123456789'
        let env = mkEnv()
        env.users.fail.batch.add('select') //select 整批 reject → 走 console 錯誤分支
        let lines = []
        let realLog = console.log
        console.log = (...a) => {
            lines.push(a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '))
        }
        let r1 = null
        let r2 = null
        try {
            r1 = await run(() => env.p.getGenUserByKV('tokenVerify', secret))
            r2 = await run(() => env.p.getGenUserByKV('account', 'nobody-here'))
        }
        finally {
            console.log = realLog
        }
        assert.strictEqual(r1.ok, false)
        assert.strictEqual(r2.ok, false)
        let text = lines.join('\n')
        assert.ok(text.includes('valueUser'), '應有 valueUser 之 console 輸出(確認錯誤分支確實被觸發)')
        assert.ok(!text.includes(secret), 'console 不得含非識別欄之查詢值明文')
        assert.ok(!text.includes(maskKv('tokenVerify', secret)), 'console 不得含遮罩形式(值本身不印, ADR-101)')
        assert.ok(!text.includes('nobody-here'), '識別欄之值亦不印(原照記, ADR-101 取代)')
        assert.ok(text.includes('valueUser (typeof string)'), 'valueUser 只給型別')
        assert.ok(text.includes('keyUser account'), '識別欄之欄位名照印')
        assert.ok(text.includes('keyUser (typeof string)'), '名單外之欄位名(tokenVerify)只給型別')
    })

    it('QK-009 log 衛生(規則 6): 使用端可控之 key 與識別欄 value 寫入 log 前置換控制字元並限制長度, 短字串原樣; 非識別欄仍 maskToken', async function() {
        assert.strictEqual(LOG_TEXT_MAX, 256)
        //短字串原樣
        for (let s of ['abc', 'user@example.com', 'id-0123', 'x'.repeat(256)]) {
            assert.strictEqual(capText(s), s)
        }
        //控制字元(< 32、127)置換為 ?
        assert.strictEqual(capText('a\r\nb\u0000c\u007fd'), 'a??b?c?d')
        //超過上限: 截斷並附 ...(len=N)
        assert.strictEqual(capText('y'.repeat(257)), `${'y'.repeat(256)}...(len=257)`)
        assert.strictEqual(capText('z'.repeat(5000)), `${'z'.repeat(256)}...(len=5000)`)
        //長度以原字串計(控制字元置換不改長度)
        assert.strictEqual(capText(`\n${'w'.repeat(300)}`), `?${'w'.repeat(255)}...(len=301)`)
        //非字串原樣(不拋錯)
        for (let v of [undefined, null, 1, true, ['id']]) {
            assert.strictEqual(capText(v), v)
        }
        //maskKv: 識別欄 → capText; 非識別欄 → 遮罩(maskToken, 不外露中段)
        assert.strictEqual(maskKv('account', 'bob'), 'bob')
        assert.strictEqual(maskKv('account', 'a'.repeat(5000)), `${'a'.repeat(256)}...(len=5000)`)
        assert.strictEqual(maskKv('name', 'n\nm'), 'n?m')
        assert.ok(maskKv('tokenVerify', 'S'.repeat(5000)).length < 40)
        //procCore debug 記錄之 keyUser: 使用端可控, 同樣受限
        let env = mkEnv()
        let longKey = 'k'.repeat(5000)
        let r = await run(() => env.p.getGenUserByKV(longKey, 'v'))
        assert.strictEqual(r.ok, false)
        let rec = env.srLog.logs.debug.find((o) => o.event === 'fun-getGenUserByKV')
        assert.ok(rec)
        assert.strictEqual(rec.keyUser, `${'k'.repeat(256)}...(len=5000)`)
        assert.ok(JSON.stringify(rec).length < 800, 'debug 記錄長度')
    })

})


//站點守門(R-QKEY-01): 白名單單一定義與先驗後查; helper 無子字串檢查
describe('查詢欄位名白名單之站點守門 (R-QKEY-01)', function() {

    let codeOf = (rel) => fs.readFileSync(path.join(fdRoot, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    it('SITE-QK-001 getUserInfor 先驗白名單後查庫; keysUserQuery 由 srLog.mjs 單一定義, maskKv 與 procCore 同源', function() {
        let core = fs.readFileSync(path.join(fdRoot, 'server', 'procCore.mjs'), 'utf8').replace(/\r\n/g, '\n')
        let i = core.indexOf('    let getUserInfor = ')
        assert.ok(i >= 0, '找不到 getUserInfor')
        let j = core.indexOf('\n    }\n', i)
        assert.ok(j > i)
        let body = core.slice(i, j).replace(/\/\/.*$/gm, '')
        let iCheck = body.indexOf('keysUserQuery.includes(')
        let iQuery = body.indexOf('getGenUserByKV(')
        assert.ok(iCheck >= 0, 'getUserInfor 應以 keysUserQuery 檢查欄位名')
        assert.ok(iQuery > iCheck, '白名單檢查須先於查庫')
        assert.ok(/invalidUserQueryKey/.test(body), '白名單外應 reject invalidUserQueryKey')
        //keysUserQuery 單一定義
        let defs = []
        for (let rel of ['server/srLog.mjs', 'server/procCore.mjs', 'server/WWebSso.mjs', 'server/procProtect.mjs']) {
            let m = codeOf(rel).match(/(let|const|var)\s+keysUserQuery\s*=/g)
            if (m) {
                defs.push(`${rel}:${m.length}`)
            }
        }
        assert.deepStrictEqual(defs, ['server/srLog.mjs:1'])
        //maskKv 以同一常數判定識別欄
        let log = codeOf('server/srLog.mjs')
        assert.ok(/keysUserQuery\.includes\(/.test(log), 'maskKv 應以 keysUserQuery 判定')
        assert.ok(/import \{[^}]*keysUserQuery[^}]*\} from '\.\/srLog\.mjs'/.test(core), 'procCore 應自 srLog.mjs 匯入 keysUserQuery')
    })

    it('SITE-QK-003 key 寫入 log 前經 capText: WWebSso 兩入口之 srLog.info、procCore 兩處 debug(keyUser); maskKv 識別欄分支經 capText', function() {
        let web = codeOf('server/WWebSso.mjs')
        assert.strictEqual((web.match(/srLog\.info\(\{ event: '(api\/getSsoUserInfor|kpfun-getUserInfor)', token: maskToken\(token\), key: capText\(key\), value: valueLog \}\)/g) || []).length, 2)
        let core = codeOf('server/procCore.mjs')
        assert.strictEqual((core.match(/keyUser: capText\(keyUser\)/g) || []).length, 2)
        let log = codeOf('server/srLog.mjs')
        assert.ok(/return capText\(value\)/.test(log), 'maskKv 識別欄分支應經 capText')
    })

    it('SITE-QK-002 src/ 之對外 helper 無 indexOf 子字串檢查查詢參數(一律經 hasUrlParam)', function() {
        let hits = []
        for (let f of fs.readdirSync(path.join(fdRoot, 'src'))) {
            if (!f.endsWith('.mjs')) {
                continue
            }
            let code = codeOf(`src/${f}`)
            if (/indexOf\(\s*['"`](key|token|value)=/.test(code)) {
                hits.push(f)
            }
        }
        assert.deepStrictEqual(hits, [])
        for (let f of ['getUserByToken.mjs', 'getUserByUserId.mjs', 'getUsersByToken.mjs']) {
            assert.ok(/hasUrlParam\(/.test(codeOf(`src/${f}`)), `${f} 應經 hasUrlParam 檢查範本`)
        }
    })

})
