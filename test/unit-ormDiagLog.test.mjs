import assert from 'assert'
import fs from 'fs'
import path from 'path'
import util from 'util'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from '../src/schema/index.mjs'
import mkOrmFunLog, { maskOrmDetail, wrapProcOrm } from '../server/ormDiagLog.mjs'
import { maskToken } from '../server/srLog.mjs'
import { mkSrLog, mkTable } from './tools/unitProc.mjs'


//
// w-serv-orm 診斷輸出導入 srLog (R-ORM-04; spec: spec/設計要點與取捨.md ADR-098)
//
// w-serv-orm 1.1.20 起診斷輸出預設只在 console 列標籤與不含個資之摘要, 完整細節(失敗列主鍵、ORM 錯誤原文)只交 opt.funLog.
// 本檔以真實 w-serv-orm WServOrm(StubWOrm 令各表即可注入失敗之記憶體資料表, 不碰資料庫)搭配 server/ormDiagLog.mjs 之 funLog, 驗證:
//   ODL-M  細節遮罩之契約(主鍵、信箱、錯誤原文內之同值皆不外露, 有界, 不執行細節內程式)
//   ODL-F  funLog: label / safe / 遮罩後 detail 寫入 srLog.error; console 照舊只列標籤與摘要; 任何輸出失敗皆不影響流程
//   ODL-W  整合: 各類寫入失敗路徑(逐筆失敗、整批 reject、聚合 ok 為 0、列不存在、被拒條件)之 srLog / console / procOrm 回傳契約
//   ODL-L  真實 w-orm-lmdb 之鍵長超限(save 逐筆失敗、insert 整批 reject): ORM 錯誤原文保留且不夾帶資料值(換 ORM 時之警鈴)
//   SITE-ODL  站點全集: 本套件建立 w-serv-orm 之處
// 真後端端到端(WWebSso 實際接上 funLog)見 api-ormdiag.test.mjs.
//


let SECRET_ID = 'secret-id-user-0001-ABCDEFGH'
let SECRET_EMAIL = 'john.doe@example.com'
let SECRET_ERR = `Duplicate entry for key email=${SECRET_EMAIL} (row ${SECRET_ID})`
let SECRET_UUID = '123e4567-e89b-12d3-a456-426614174000'


//strs: 把值序列化為字串, 供「不含某值」之斷言
let strs = (v) => JSON.stringify(v)


//assertNoSecret: 序列化後不含 SECRET_ID / SECRET_EMAIL / 錯誤原文 / uuid
function assertNoSecret(v, msg) {
    let s = strs(v)
    for (let x of [SECRET_ID, SECRET_EMAIL, SECRET_ERR, SECRET_UUID, 'john.doe']) {
        assert.ok(!s.includes(x), `${msg}: 不得含 ${x}, 實際 ${s}`)
    }
}


//captureConsole: 執行 fn 期間收集 console.log 之輸出行(以 util.format 格式化, 同 console.log)
async function captureConsole(fn) {
    let lines = []
    let orig = console.log
    console.log = (...a) => {
        lines.push(util.format(...a))
    }
    try {
        await fn()
    }
    finally {
        console.log = orig
    }
    return lines
}


//mkOrm: 以 StubWOrm 令各表即所給之替身資料表, 組出真實 WServOrm; optServ 即 WServOrm 之 opt(未給即不傳, 同 1.1.20 預設)
function mkOrm(tables, optServ) {
    class StubWOrm {
        constructor(o) {
            return tables[o.cl]
        }
    }
    return optServ === undefined ? WServOrm(ds, StubWOrm, 'stub', 'stub') : WServOrm(ds, StubWOrm, 'stub', 'stub', optServ)
}


//mkTables: 各表替身; 逐筆失敗、整批 reject、聚合 ok 為 0 之故障由各案例覆寫
function mkTables() {
    let tables = {}
    for (let k of Object.keys(ds)) {
        tables[k] = mkTable()
    }
    return tables
}


//mkRun: 同一個故障情境各以「不傳 funLog」與「傳 funLog」各組一個實例並執行 exec, 回傳兩者之 { r(結果或 reject)、lines(console)、srLog }
async function mkRun(setup, exec) {
    let out = {}
    for (let withFun of [false, true]) {
        let tables = mkTables()
        setup(tables)
        let srLog = mkSrLog()
        let orm = mkOrm(tables, withFun ? { funLog: mkOrmFunLog(srLog) } : undefined)
        let procOrm = withFun ? wrapProcOrm(orm.procOrm) : orm.procOrm //同 WWebSso.mjs 之接線
        let r = null
        let lines = await captureConsole(async () => {
            r = await exec({ procOrm }, tables).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
        })
        out[withFun ? 'fun' : 'base'] = { r, lines, srLog, tables }
    }
    return out
}


describe('ODL-M maskOrmDetail: 細節遮罩之契約', function() {

    it('ODL-M01 逐筆失敗清單: k 保留, id 遮罩為 maskToken 形式, err 內之同值與信箱 / uuid 樣式被置換, 其餘文字保留', function() {
        //spec: 細節(失敗列主鍵與 ORM 錯誤原文)寫入 srLog 前遮罩主鍵與錯誤原文中之資料值
        let r = maskOrmDetail([{ k: 0, id: SECRET_ID, err: `${SECRET_ERR} uuid ${SECRET_UUID}` }])
        assert.deepStrictEqual(r, [{
            k: 0,
            id: maskToken(SECRET_ID),
            err: `Duplicate entry for key email=(email) (row ${maskToken(SECRET_ID)}) uuid (uuid)`,
        }])
        assertNoSecret(r, 'M01')
    })

    it('ODL-M02 非錯誤原文位置之字串一律遮罩(被拒條件之快照: 欄位名保留、值遮罩)', function() {
        let r = maskOrmDetail({ account: SECRET_EMAIL, nested: { name: 'John Doe', list: ['aaaa-bbbb-cccc'] } })
        assert.deepStrictEqual(r, {
            account: maskToken(SECRET_EMAIL),
            nested: { name: maskToken('John Doe'), list: [maskToken('aaaa-bbbb-cccc')] },
        })
        assertNoSecret(r, 'M02')
    })

    it('ODL-M03 鍵名像識別欄之數字(數字主鍵)遮罩, 其他數字(k、n、ok)與布林、null 原樣', function() {
        let r = maskOrmDetail({ id: 123456789, userId: 42, k: 3, n: 12, ok: 0, flag: true, none: null })
        assert.deepStrictEqual(r, { id: maskToken('123456789'), userId: maskToken('42'), k: 3, n: 12, ok: 0, flag: true, none: null })
        //錯誤原文內夾帶之數字主鍵亦置換
        let r2 = maskOrmDetail([{ k: 0, id: 123456789, err: 'bad row 123456789' }])
        assert.strictEqual(r2[0].err, `bad row ${maskToken('123456789')}`)
    })

    it('ODL-M04 Error: 只留類別名稱與遮罩後訊息, 不含 stack; 類別名稱不合白名單樣式者為 Error; 頂層字串視為錯誤原文', function() {
        class DbError extends Error {}
        let e = new DbError(`write failed for ${SECRET_EMAIL}`)
        let r = maskOrmDetail(e)
        assert.deepStrictEqual(r, { errType: 'DbError', message: 'write failed for (email)' })
        assert.ok(!strs(r).includes('stack'), '不含 stack')
        //類別名稱含空白與信箱(建構子名稱可被改寫)
        class OtherError extends Error {}
        Object.defineProperty(OtherError, 'name', { value: `bad ${SECRET_EMAIL}` })
        let r2 = maskOrmDetail(new OtherError('x'))
        assert.strictEqual(r2.errType, 'Error')
        assertNoSecret(r2, 'M04')
        assert.strictEqual(maskOrmDetail(`oops ${SECRET_EMAIL}`), 'oops (email)')
    })

    it('ODL-M05 錯誤原文: 控制字元換 ?, 超長者截斷並附原長(防以長文字放大 log 與換行偽造)', function() {
        let r = maskOrmDetail([{ k: 0, id: 'abcdefgh-1', err: 'line1\r\nline2\u0000\u007f' }])
        assert.strictEqual(r[0].err, 'line1??line2??')
        let long = 'x'.repeat(5000)
        let r2 = maskOrmDetail({ err: long })
        assert.ok(r2.err.length < 300 && /\.\.\.\(len=\d+\)$/.test(r2.err), `截斷: ${r2.err.length}`)
    })

    it('ODL-M06 有界: 超過層數者為 [Truncated], 節點數與循環參照不使輸出或耗時放大', function() {
        let deep = { a: { b: { c: { d: { e: { f: { g: { h: 'x' } } } } } } } }
        assert.ok(strs(maskOrmDetail(deep)).includes('[Truncated]'), '層數上限')
        let big = {}
        for (let k = 0; k < 5000; k++) {
            big[`key${k}`] = `value-${k}-padding`
        }
        let rBig = maskOrmDetail(big)
        assert.ok(Object.keys(rBig).length <= 200, `節點上限: ${Object.keys(rBig).length}`)
        let cyc = { name: 'loop-name' }
        cyc.self = cyc
        let rCyc = maskOrmDetail(cyc)
        assert.ok(strs(rCyc).includes('[Truncated]'), '循環參照止於層數上限')
        let arr = new Array(100000).fill('abcdefgh')
        assert.ok(maskOrmDetail(arr).length <= 201, '大陣列')
    })

    it('ODL-M07 不執行細節內程式: getter 不被呼叫(以標記代替), Proxy 陷阱不觸發', function() {
        let called = 0
        let o = {}
        Object.defineProperty(o, 'id', { enumerable: true, get() { called++; return SECRET_ID } })
        let px = new Proxy({ id: SECRET_ID }, { ownKeys() { called++; return ['id'] }, get() { called++; return SECRET_ID }, getOwnPropertyDescriptor() { called++; return undefined } })
        let r = maskOrmDetail({ o, px })
        assert.strictEqual(called, 0, '不執行 getter 與 Proxy 陷阱')
        assert.deepStrictEqual(r, { o: { id: '[Getter/Setter]' }, px: '[Proxy]' })
    })

    it('ODL-M08 w-serv-orm 之固定標記字串與本檔標記原樣保留; 函數 / 二進位 / Map / Set 轉為純資料', function() {
        let r = maskOrmDetail({ f: '[Function]', b: '[Binary 5 bytes]', u: '(unprintable)', fn: () => 1, buf: Buffer.from('secret'), m: new Map([['k1', 'secret-value']]), s: new Set(['secret-member']) })
        assert.strictEqual(r.f, '[Function]')
        assert.strictEqual(r.b, '[Binary 5 bytes]')
        assert.strictEqual(r.u, '(unprintable)')
        assert.strictEqual(r.fn, '[Function]')
        assert.strictEqual(r.buf, '[Binary]')
        assert.ok(!strs(r).includes('secret-value') && !strs(r).includes('secret-member'), 'Map / Set 之值遮罩')
    })

    it('ODL-M09 不改動輸入(細節與其後流程共用之物件)', function() {
        let d = [{ k: 0, id: SECRET_ID, err: SECRET_ERR }]
        let before = JSON.stringify(d)
        maskOrmDetail(d)
        assert.strictEqual(JSON.stringify(d), before)
    })

    it('ODL-M12 鍵為 __proto__ 時(JSON.parse 可產生)輸出保留該自有鍵且不改設輸出物件之原型', function() {
        let d = JSON.parse(`{"__proto__":{"id":"${SECRET_ID}"},"account":"${SECRET_EMAIL}"}`)
        let r = maskOrmDetail(d)
        assert.strictEqual(Object.getPrototypeOf(r), Object.prototype)
        assert.deepStrictEqual(Object.keys(r), ['__proto__', 'account'])
        assertNoSecret(r, 'M12')
        assert.strictEqual(Object.getOwnPropertyDescriptor(r, '__proto__').value.id, maskToken(SECRET_ID))
    })

    it('ODL-M13 超長主鍵(真 LMDB 鍵長超限情境): 遮罩形式記原長, 錯誤原文其餘文字(固定訊息)保留供診斷', function() {
        //spec: 寫入失敗須可診斷——真 LMDB 對鍵長超過 1978 位元組回 'Key size is larger than the maximum key size (1978)'(實測見 ADR-098)
        let longId = `${'K'.repeat(2100)}@example.com`
        let r = maskOrmDetail([{ k: 0, id: longId, err: 'Key size is larger than the maximum key size (1978)' }])
        assert.deepStrictEqual(r, [{ k: 0, id: maskToken(longId), err: 'Key size is larger than the maximum key size (1978)' }])
        assert.ok(r[0].id.endsWith(`(len=${longId.length})`), `記原長: ${r[0].id}`)
        assert.ok(!strs(r).includes('K'.repeat(10)), '長主鍵本文不外露')
    })

    it('ODL-M14 憑證(tokens 表之 token 欄): 呼叫輸入內之 token 值夾帶在錯誤原文時被遮罩, 細節內 token 鍵之字串亦遮罩', function() {
        //spec: R-SEC-01 權杖不得進入任何輸出(srLog 亦然); 憑證為 tokens.token 欄, 主鍵 id 另計
        let TOKEN = 'tok-3f9a1c7e-credential-value-0001'
        let ctx = { userId: 'op', input: [{ id: 'token-row-id-0001', token: TOKEN, userId: 'u-owner-0001' }] }
        let r = maskOrmDetail([{ k: 0, id: 'token-row-id-0001', err: `write failed token=${TOKEN} owner u-owner-0001` }], { ctx })
        assert.deepStrictEqual(r, [{ k: 0, id: maskToken('token-row-id-0001'), err: `write failed token=${maskToken(TOKEN)} owner ${maskToken('u-owner-0001')}` }])
        let r2 = maskOrmDetail({ token: TOKEN, tokens: [TOKEN] })
        assert.deepStrictEqual(r2, { token: maskToken(TOKEN), tokens: [maskToken(TOKEN)] })
        assert.ok(!strs([r, r2]).includes(TOKEN), 'token 值不外露')
    })

    it('ODL-M10 進行中呼叫之輸入(ctx): 鍵名像識別欄之值併入置換依據, 錯誤原文內夾帶者(細節內無該值)亦被遮罩; 一般欄位值不併入', function() {
        //spec: 遮罩錯誤原文中之資料值; catch 路徑之細節只有 Error, 不含主鍵與信箱, 資料值來自該次呼叫之輸入
        let ctx = {
            userId: 'operator-0001',
            input: [{ id: SECRET_ID, account: 'johndoe', email: SECRET_EMAIL, name: 'John Doe', isActive: 'true', order: 120000, lang: 'eng' }],
        }
        let e = new Error(`write failed: row ${SECRET_ID} account johndoe owner operator-0001 name John Doe in length 120000 lang eng active true`)
        let r = maskOrmDetail(e, { ctx })
        assert.strictEqual(r.message, `write failed: row ${maskToken(SECRET_ID)} account ${maskToken('johndoe')} owner ${maskToken('operator-0001')} name ${maskToken('John Doe')} in length 120000 lang eng active true`)
        assertNoSecret(r, 'M10')
        //無 ctx: 只有信箱 / uuid 樣式可辨識, 主鍵原樣(殘餘風險, 見 maskOrmDetail 註解; 由 wrapProcOrm 補強)
        assert.ok(maskOrmDetail(e).message.includes(SECRET_ID), '無輸入脈絡時無從辨識細節外之主鍵')
    })

    it('ODL-M11 ctx 之輸入為被拒條件(含 $in 陣列、巢狀)時亦收集識別欄之值; ctx 形狀不符(null、字串)者忽略', function() {
        let ctx = { userId: 'op', input: { add: [{ id: SECRET_ID }], del: [{ id: 'del-row-0002-xyz' }], diff: [], find: { id: { $in: ['in-row-0003-abc'] }, email: { $ne: SECRET_EMAIL } } } }
        let r = maskOrmDetail(`bad ${SECRET_ID} ${'del-row-0002-xyz'} ${'in-row-0003-abc'} ${SECRET_EMAIL}`, { ctx })
        //已知識別值(含條件運算子 $in / $ne 內者)換成與他處一致之遮罩
        assert.strictEqual(r, `bad ${maskToken(SECRET_ID)} ${maskToken('del-row-0002-xyz')} ${maskToken('in-row-0003-abc')} ${maskToken(SECRET_EMAIL)}`)
        for (let c of [null, 'x', 1, undefined]) {
            assert.doesNotThrow(() => maskOrmDetail('x', { ctx: c }))
        }
        assert.doesNotThrow(() => maskOrmDetail('x', null))
    })

})


describe('ODL-F mkOrmFunLog: 導入 srLog', function() {

    it('ODL-F01 label / safe / 遮罩後 detail 寫入 srLog.error(event orm-diag); safe 未給 / detail 未給者無該鍵', async function() {
        let srLog = mkSrLog()
        let f = mkOrmFunLog(srLog)
        await captureConsole(async () => {
            f('users.save fail', { n: 1, ks: [0] }, [{ k: 0, id: SECRET_ID, err: SECRET_ERR }])
            f('tokens.save row not found')
        })
        assert.strictEqual(srLog.logs.error.length, 2)
        assert.deepStrictEqual(srLog.logs.error[0], {
            event: 'orm-diag',
            label: 'users.save fail',
            safe: { n: 1, ks: [0] },
            detail: [{ k: 0, id: maskToken(SECRET_ID), err: `Duplicate entry for key email=(email) (row ${maskToken(SECRET_ID)})` }],
        })
        assert.deepStrictEqual(srLog.logs.error[1], { event: 'orm-diag', label: 'tokens.save row not found' })
        assert.strictEqual(srLog.logs.info.length + srLog.logs.warn.length + srLog.logs.debug.length, 0, '只用 error 層級')
        assertNoSecret(srLog.logs.error, 'F01')
    })

    it('ODL-F02 console 照舊輸出標籤與摘要(同 w-serv-orm 預設之 console.log(label, safe)), 細節不進 console', async function() {
        let srLog = mkSrLog()
        let f = mkOrmFunLog(srLog)
        let lines = await captureConsole(async () => {
            f('users.save fail', { n: 1, ks: [0] }, [{ k: 0, id: SECRET_ID, err: SECRET_ERR }])
            f('tokens.save row not found')
        })
        assert.deepStrictEqual(lines, [util.format('users.save fail', { n: 1, ks: [0] }), 'tokens.save row not found'])
        assertNoSecret(lines, 'F02')
    })

    it('ODL-F03 srLog 寫入拋錯、console 拋錯、label 與 safe 為怪異值皆不使 funLog 拋出(不影響 procOrm 流程)', async function() {
        let bad = { error: () => { throw new Error('srLog down') } }
        assert.doesNotThrow(() => mkOrmFunLog(bad)('users.save fail', { n: 1 }, []))
        //console.log 拋錯仍寫 srLog
        let srLog = mkSrLog()
        let orig = console.log
        console.log = () => { throw new Error('stdout closed') }
        try {
            assert.doesNotThrow(() => mkOrmFunLog(srLog)('users.save fail', { n: 1, ks: [0] }, []))
        }
        finally {
            console.log = orig
        }
        assert.strictEqual(srLog.logs.error.length, 1)
        //label 含控制字元(縱深防禦)
        await captureConsole(async () => {
            mkOrmFunLog(srLog)('a\nb', undefined)
        })
        assert.strictEqual(srLog.logs.error[1].label, 'a?b')
    })

})


describe('ODL-W 整合: 真實 w-serv-orm + 可注入失敗之資料表', function() {

    let ROW = { id: SECRET_ID, account: 'johndoe', name: 'John Doe', email: SECRET_EMAIL }

    it('ODL-W01 save 逐筆失敗: srLog 有 label 與摘要, 細節遮罩; console 與未傳 funLog 者逐行相同; procOrm 之 reject 契約不變', async function() {
        //spec: 把 w-serv-orm 診斷輸出導入 srLog; console 不多出輸出; 不改 w-serv-orm 之其他行為
        let setup = (t) => {
            t.users.save = async (data) => data.map(() => ({ n: 1, nInserted: 0, nModified: 0, ok: 0, err: SECRET_ERR }))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'save', [ROW]))
        //procOrm 回傳契約: 兩者皆 reject 同一字串(列主鍵之訊息屬回傳契約)
        assert.strictEqual(base.r.ok, false)
        assert.strictEqual(fun.r.ok, false)
        assert.strictEqual(fun.r.e, base.r.e)
        assert.strictEqual(fun.r.e, `failed to save data: id[${SECRET_ID}]`)
        //console: 與 1.1.20 預設逐行相同, 且不含個資
        assert.deepStrictEqual(fun.lines, base.lines)
        assert.deepStrictEqual(fun.lines, [util.format('users.save fail', { n: 1, ks: [0] })])
        assertNoSecret(fun.lines, 'W01 console')
        //srLog: label、摘要與遮罩後細節
        assert.strictEqual(fun.srLog.logs.error.length, 1)
        let o = fun.srLog.logs.error[0]
        assert.strictEqual(o.event, 'orm-diag')
        assert.strictEqual(o.label, 'users.save fail')
        assert.deepStrictEqual(o.safe, { n: 1, ks: [0] })
        //信箱為該次呼叫輸入內之值(ROW.email), 換成與他處一致之遮罩
        assert.deepStrictEqual(o.detail, [{ k: 0, id: maskToken(SECRET_ID), err: `Duplicate entry for key email=${maskToken(SECRET_EMAIL)} (row ${maskToken(SECRET_ID)})` }])
        assertNoSecret(o, 'W01 srLog')
        //未傳 funLog 者 srLog 無此紀錄(對照: 無此接線時診斷只在 console)
        assert.strictEqual(base.srLog.logs.error.length, 0)
    })

    it('ODL-W02 del 逐筆失敗(tokens): label 含表名與操作, 摘要為筆數與位置', async function() {
        let setup = (t) => {
            t.tokens.del = async (data) => data.map(() => ({ n: 1, nDeleted: 0, ok: 0, err: SECRET_ERR }))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'tokens', 'del', [{ id: SECRET_ID }]))
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.lines, base.lines)
        let o = fun.srLog.logs.error[0]
        assert.strictEqual(o.label, 'tokens.del fail')
        assert.deepStrictEqual(o.safe, { n: 1, ks: [0] })
        assertNoSecret(o, 'W02')
    })

    it('ODL-W03 insert 整批 reject(ORM 拋 Error, 訊息夾帶信箱): 摘要只有類別, 細節為遮罩後訊息; procOrm 之 reject 為固定字串', async function() {
        let setup = (t) => {
            t.users.insert = async () => Promise.reject(new Error(SECRET_ERR))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]))
        assert.strictEqual(fun.r.e, base.r.e)
        assertNoSecret(fun.r, 'W03 回傳')
        assert.deepStrictEqual(fun.lines, base.lines)
        let o = fun.srLog.logs.error[0]
        assert.strictEqual(o.label, 'users.insert catch')
        assert.deepStrictEqual(o.safe, { errType: 'Error' })
        assert.strictEqual(o.detail.errType, 'Error')
        assert.strictEqual(o.detail.message, `Duplicate entry for key email=${maskToken(SECRET_EMAIL)} (row ${maskToken(SECRET_ID)})`)
        assertNoSecret(o, 'W03')
    })

    it('ODL-W04 insert 聚合 ok 為 0(違約形狀): 摘要 { ok: 0 }, 細節之原文遮罩', async function() {
        let setup = (t) => {
            t.users.insert = async () => ({ n: 1, nInserted: 0, ok: 0, err: SECRET_ERR, id: SECRET_ID })
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]))
        assert.strictEqual(fun.r.e, 'failed to insert data')
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.lines, base.lines)
        let o = fun.srLog.logs.error[0]
        assert.strictEqual(o.label, 'users.insert fail')
        assert.deepStrictEqual(o.safe, { ok: 0 })
        assert.strictEqual(o.detail.id, maskToken(SECRET_ID))
        assert.strictEqual(o.detail.ok, 0)
        assertNoSecret(o, 'W04')
    })

    it('ODL-W05 mustExist 列不存在: 只有標籤(無 safe、無 detail)', async function() {
        let { base, fun } = await mkRun(() => {}, (orm) => orm.procOrm('op-user', 'tokens', 'save', [{ id: SECRET_ID, timeEnd: 'x' }], { mustExist: true }))
        assert.strictEqual(fun.r.e, 'rowNotFound')
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.lines, base.lines)
        assert.deepStrictEqual(fun.srLog.logs.error, [{ event: 'orm-diag', label: 'tokens.save row not found' }])
    })

    it('ODL-W06 被拒之查詢條件(含信箱值): 摘要只有拒收原因, 細節之條件值遮罩', async function() {
        let find = { email: SECRET_EMAIL, [Symbol('sym')]: 1 }
        let { base, fun } = await mkRun(() => {}, (orm) => orm.procOrm('op-user', 'users', 'select', find))
        assert.strictEqual(fun.r.ok, false)
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.lines, base.lines)
        let o = fun.srLog.logs.error[0]
        assert.strictEqual(o.label, 'users.select invalid find')
        assert.ok(typeof o.safe.reason === 'string' && o.safe.reason.length > 0, '拒收原因')
        assertNoSecret(o, 'W06')
        assert.ok(strs(o.detail).includes(maskToken(SECRET_EMAIL)), `條件值為遮罩形式: ${strs(o.detail)}`)
    })

    it('ODL-W07 srLog 寫入拋錯時 procOrm 之結果、資料表狀態與 console 皆與未接線者相同', async function() {
        let setup = (t) => {
            t.users.save = async (data) => data.map(() => ({ n: 1, ok: 0, err: SECRET_ERR }))
        }
        let tablesA = mkTables()
        setup(tablesA)
        let tablesB = mkTables()
        setup(tablesB)
        let ormA = mkOrm(tablesA)
        let ormB = mkOrm(tablesB, { funLog: mkOrmFunLog({ error: () => { throw new Error('srLog down') } }) })
        let ra = null
        let rb = null
        let la = await captureConsole(async () => {
            ra = await ormA.procOrm('op-user', 'users', 'save', [ROW]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
        })
        let lb = await captureConsole(async () => {
            rb = await wrapProcOrm(ormB.procOrm)('op-user', 'users', 'save', [ROW]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
        })
        assert.deepStrictEqual(rb, ra)
        assert.deepStrictEqual(lb, la)
        assert.deepStrictEqual(tablesB.users.calls, tablesA.users.calls)
    })

    it('ODL-W09 wrapProcOrm: 並行呼叫各有自己的輸入脈絡(交錯完成時各自遮罩各自輸入之值), 成功時回傳與未包裝者相同', async function() {
        //spec: 錯誤原文中之資料值來自該次呼叫之輸入; 並行之兩次呼叫不得互相取得對方輸入(脈絡洩漏會使遮罩誤用或漏用)
        let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        let tables = mkTables()
        tables.users.insert = async (data) => {
            await sleep(data[0].account === 'account-alpha-001' ? 40 : 5)
            throw new Error(`dup account ${data[0].account}`)
        }
        let srLog = mkSrLog()
        let procOrm = wrapProcOrm(mkOrm(tables, { funLog: mkOrmFunLog(srLog) }).procOrm)
        let rs = null
        await captureConsole(async () => {
            rs = await Promise.allSettled([
                procOrm('op-user', 'users', 'insert', [{ ...ROW, id: 'id-alpha-0001', account: 'account-alpha-001' }]),
                procOrm('op-user', 'users', 'insert', [{ ...ROW, id: 'id-beta-00002', account: 'account-beta-0002' }]),
            ])
        })
        assert.deepStrictEqual(rs.map((x) => x.status), ['rejected', 'rejected'])
        let msgs = srLog.logs.error.map((o) => o.detail.message).sort()
        assert.deepStrictEqual(msgs, [`dup account ${maskToken('account-alpha-001')}`, `dup account ${maskToken('account-beta-0002')}`].sort())
        assert.ok(!strs(srLog.logs.error).includes('account-alpha') && !strs(srLog.logs.error).includes('account-beta'), '兩個帳號皆不外露')
        //成功時回傳與未包裝者相同(包裝只多一層脈絡)
        let t2 = mkTables()
        let o2 = mkOrm(t2)
        let ra = await o2.procOrm('op-user', 'users', 'save', [{ ...ROW, id: 'id-ok-0000001' }])
        let t3 = mkTables()
        let o3 = mkOrm(t3)
        let rb = await wrapProcOrm(o3.procOrm)('op-user', 'users', 'save', [{ ...ROW, id: 'id-ok-0000001' }])
        assert.deepStrictEqual(rb, ra)
    })

    it('ODL-W08 成功寫入不產生任何診斷(srLog 與 console 皆空), 資料照寫', async function() {
        let { base, fun } = await mkRun(() => {}, (orm, tables) => orm.procOrm('op-user', 'users', 'save', [ROW]).then(() => tables.users.get(SECRET_ID)))
        assert.strictEqual(fun.r.ok, true)
        assert.strictEqual(fun.r.v.email, SECRET_EMAIL)
        assert.deepStrictEqual(fun.lines, [])
        assert.deepStrictEqual(base.lines, [])
        assert.strictEqual(fun.srLog.logs.error.length, 0)
    })

})


describe('ODL-L 真實 ORM(w-orm-lmdb)之寫入失敗: 遮罩後仍可診斷', function() {

    //spec: 寫入失敗須可診斷(ORM 錯誤原文)且不外露資料值; 本組以真 LMDB 為對照, 換 ORM 或升級 w-orm-lmdb 時為錯誤原文是否夾帶資料值之警鈴(ADR-098 殘餘風險)
    let dir = path.resolve('./test/_tmp/unit-ormDiagLog/db')
    let orm = null
    let srLog = mkSrLog()
    let procOrm = null

    before(function() {
        this.timeout(30000)
        console.log('[unit-ormDiagLog] lmdb dir =', dir)
        fs.rmSync(path.dirname(dir), { recursive: true, force: true })
        fs.mkdirSync(dir, { recursive: true })
        orm = WServOrm(ds, WOrmLmdb, dir, 'ormdiag', { funLog: mkOrmFunLog(srLog) })
        procOrm = wrapProcOrm(orm.procOrm)
    })

    after(async function() {
        this.timeout(30000)
        await orm.closeAll()
        for (let k = 0; k < 20 && fs.existsSync(path.dirname(dir)); k++) {
            try {
                fs.rmSync(path.dirname(dir), { recursive: true, force: true })
            }
            catch (err) {
                await new Promise((resolve) => setTimeout(resolve, 250))
            }
        }
        assert.ok(!fs.existsSync(path.dirname(dir)), 'test/_tmp/unit-ormDiagLog 已清除')
    })

    it('ODL-L01 鍵長超限(save 逐筆失敗 / insert 整批 reject): srLog 有固定之 ORM 錯誤原文與遮罩後主鍵, 不含主鍵本文與信箱', async function() {
        let longId = `${'K'.repeat(2100)}@example.com`
        let row = { id: longId, account: 'acct-lmdb-probe', email: 'lmdb.probe@example.com' }
        await captureConsole(async () => {
            await procOrm('op-user', 'users', 'save', [row]).catch(() => {})
            await procOrm('op-user', 'users', 'insert', [row]).catch(() => {})
        })
        let [a, b] = srLog.logs.error
        assert.strictEqual(a.label, 'users.save fail')
        assert.deepStrictEqual(a.safe, { n: 1, ks: [0] })
        assert.deepStrictEqual(a.detail, [{ k: 0, id: maskToken(longId), err: 'Key size is larger than the maximum key size (1978)' }])
        assert.strictEqual(b.label, 'users.insert catch')
        assert.deepStrictEqual(b.safe, { errType: 'Error' })
        assert.deepStrictEqual(b.detail, { errType: 'Error', message: 'can not insert by data[0], Key size is larger than the maximum key size (1978)' })
        let s = strs(srLog.logs.error)
        for (let x of ['K'.repeat(10), 'lmdb.probe', 'acct-lmdb-probe']) {
            assert.ok(!s.includes(x), `不得含 ${x}`)
        }
    })

})


describe('SITE-ODL 建立 w-serv-orm 之站點全集(R-ORM-04)', function() {

    //列出非測試之原始碼檔(server/、src/、根目錄 *.mjs、toolg/), 不含 node_modules、dist、docs
    function listSources() {
        let out = []
        let walk = (dir) => {
            for (let f of fs.readdirSync(dir, { withFileTypes: true })) {
                let p = `${dir}/${f.name}`
                if (f.isDirectory()) {
                    walk(p)
                }
                else if (/\.(mjs|js|vue)$/.test(f.name)) {
                    out.push(p)
                }
            }
        }
        for (let d of ['./server', './src', './toolg']) {
            if (fs.existsSync(d)) {
                walk(d)
            }
        }
        for (let f of fs.readdirSync('.')) {
            if (/\.mjs$/.test(f)) {
                out.push(`./${f}`)
            }
        }
        return out
    }

    it('SITE-ODL-001 非測試原始碼中呼叫 WServOrm( 者恰為 server/WWebSso.mjs(接上 funLog)與 g_mOrm.mjs(開發腳本, 刻意不套)', function() {
        let sites = listSources().filter((p) => /\bWServOrm\(/.test(fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
        assert.deepStrictEqual(sites.sort(), ['./g_mOrm.mjs', './server/WWebSso.mjs'])
    })

    it('SITE-ODL-002 server/WWebSso.mjs: WServOrm 之 opt 恰為 { funLog: mkOrmFunLog(srLog) }(不另傳 logDetail 或已移除之設定), srLog 先於 WServOrm 建立', function() {
        let src = fs.readFileSync('./server/WWebSso.mjs', 'utf8')
        let m = src.match(/^\s*wp = WServOrm\((.*)\)\s*$/m)
        assert.ok(m, '找到 wp = WServOrm(...) 呼叫')
        assert.strictEqual(m[1], 'ds, WOrm, url, db, { funLog: mkOrmFunLog(srLog) }')
        assert.ok(src.indexOf('let srLog = srLogInit(opt)') < src.indexOf('wp = WServOrm('), 'srLog 先建立')
        assert.ok(/import mkOrmFunLog, \{ wrapProcOrm \} from '\.\/ormDiagLog\.mjs'/.test(src), '匯入 mkOrmFunLog 與 wrapProcOrm')
        //procCore 與 procProtect 取得的 procOrm 是包裝後者: 原始 procOrm 僅在解構與包裝兩處出現
        let code = src.replace(/\/\/.*$/gm, '')
        assert.ok(/let procOrm = wrapProcOrm\(procOrmRaw\)/.test(code), 'procOrm 經 wrapProcOrm 包裝')
        assert.strictEqual((code.match(/\bprocOrmRaw\b/g) || []).length, 2, '原始 procOrm 僅解構與包裝兩處')
    })

    it('SITE-ODL-003 server/ 與 src/ 不使用 logDetail(會把含主鍵與錯誤原文之完整細節還原到 console)', function() {
        let hits = listSources().filter((p) => /^\.\/(server|src)\//.test(p) && /\blogDetail\b/.test(fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '')))
        assert.deepStrictEqual(hits, [])
    })

    it('SITE-ODL-004 funLog 只在 server/WWebSso.mjs 接線(server/ormDiagLog.mjs 只提供函數, 不自建 WServOrm、不另開出口)', function() {
        let hits = listSources().filter((p) => /^\.\/server\//.test(p) && /\bfunLog\b/.test(fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
        assert.deepStrictEqual(hits.sort(), ['./server/WWebSso.mjs'])
    })

})
