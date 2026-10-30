import assert from 'assert'
import fs from 'fs'
import net from 'net'
import util from 'util'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import getDiagSecrets from 'wsemi/src/getDiagSecrets.mjs'
import diagCases from 'wsemi/src/_diagCases.mjs'
import ds from '../src/schema/index.mjs'
import WWebSso from '../server/WWebSso.mjs'
import guardOrm from '../server/guardOrm.mjs'
import ormWrite from '../server/ormWrite.mjs'
import srEmailInit from '../server/srEmail.mjs'
import { buildProc, mkSrLog, mkTable, mkProcOrm } from './tools/unitProc.mjs'
import { pathRoot, pathWWebSso, stripComments, getWiredExpr, mkWiredFunLog } from './tools/diagWire.mjs'


//
// 診斷輸出與遮罩之接線測試 (R-ORM-04 / R-DIAG-01; spec: spec/設計要點與取捨.md ADR-098、ADR-099; 跨套件規格: C:\opensrcOper\dspec\診斷輸出與遮罩.md, 以下稱 dspec)
//
// 遮罩與摘要之實作全在 wsemi(getDiag / genDiagFunLog 等), 形態類案(輸入形態 × 期望)由 wsemi 共用語料 _diagCases 驅動, 本檔只驗「本套件的站點有接上」:
//   DGF  w-serv-orm 之 funLog 經 genDiagFunLog 轉寫 srLog.warn: 只有 label 與安全摘要、無 detail、無 console 雙寫(dspec Q1); 轉接器失效不影響 procOrm; 語料 A01 / A07 以本套件之轉接器重跑
//         本檔所用之 funLog 一律由 test/tools/diagWire.mjs 自 server/WWebSso.mjs 原始碼取出接線運算式求值(不手寫第二份轉接器)
//   DGS  轉接器之白名單(第二道防線, R-ORM-04 / R-DIAG-02): 以 genDiagFunLog(…, { safeKeys: SAFE_KEYS }) 接管, 名單外之鍵不入日誌、名單內(w-serv-orm 實際產出)之鍵不丟失
//   DGX  外來值入口遮罩: 資料表(guardOrm)、寄信(srEmail)與逐筆 err(ormWrite)之 reject 含憑證者被遮, 本套件以固定詞彙組成之 reject 原樣(語料 T01 / T07 / R01 / R02 / R04 / R07 / R11 / R12 以本套件之呼叫點重跑)
//   DGC  建構期: 連線字串不回顯於輸出; 資料庫連線初始化錯誤遮罩後才輸出與重拋
//   SITE 站點全集(原始碼盤點): 接線處恰在預期位置, 已刪之自寫遮罩不復存在
//


//ctx 工廠: 語料之固定測試秘密組
let mkCtx = () => diagCases.mkCtx({ util: true })
let caseOf = (id) => {
    let c = diagCases.cases.find((x) => x.id === id)
    assert.ok(c, `語料含 ${id}`)
    return c
}


//strs: 把值序列化為字串, 供「不含某值」之斷言
let strs = (v) => JSON.stringify(v)


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


//countUnhandled: 執行 fn 期間統計 unhandledRejection 件數
async function countUnhandled(fn) {
    let n = 0
    let h = () => {
        n++
    }
    process.on('unhandledRejection', h)
    try {
        await fn()
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    finally {
        process.off('unhandledRejection', h)
    }
    return n
}


//mkFunLog: server/WWebSso.mjs 之接線(自原始碼取出該行運算式求值, 見 test/tools/diagWire.mjs; SITE-DG-002 / SITE-DG-010 以原始碼盤點鎖定該行)
let mkFunLog = (srLog) => mkWiredFunLog(srLog).funLog


//mkOrm: 以 StubWOrm 令各表即所給之替身資料表, 組出真實 WServOrm; optServ 即 WServOrm 之 opt(未給即不傳, 同 1.1.20 之預設)
function mkOrm(tables, optServ) {
    class StubWOrm {
        constructor(o) {
            return tables[o.cl]
        }
    }
    return optServ === undefined ? WServOrm(ds, StubWOrm, 'stub', 'stub') : WServOrm(ds, StubWOrm, 'stub', 'stub', optServ)
}


//mkTables: 各表替身; 故障由各案例覆寫
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
        let orm = mkOrm(tables, withFun ? { funLog: mkFunLog(srLog) } : undefined)
        let r = null
        let lines = await captureConsole(async () => {
            r = await exec(orm, tables).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
        })
        out[withFun ? 'fun' : 'base'] = { r, lines, srLog, tables }
    }
    return out
}


let SECRET_ID = 'secret-id-user-0001-ABCDEFGH'
let SECRET_EMAIL = 'john.doe@example.com'
let SECRET_ERR = `Duplicate entry for key email=${SECRET_EMAIL} (row ${SECRET_ID})`
let ROW = { id: SECRET_ID, account: 'johndoe', name: 'John Doe', email: SECRET_EMAIL }


//assertNoSecret: 序列化後不含主鍵 / 信箱 / 錯誤原文
function assertNoSecret(v, msg) {
    let s = strs(v)
    for (let x of [SECRET_ID, SECRET_EMAIL, SECRET_ERR, 'john.doe']) {
        assert.ok(!s.includes(x), `${msg}: 不得含 ${x}, 實際 ${s}`)
    }
}


describe('DGF genDiagFunLog 轉接: w-serv-orm 之 funLog → srLog.warn (dspec Q1)', function() {

    it('DGF-01 save 逐筆失敗: srLog.warn 恰一筆 { event, label, safe }(無 detail), 其他層級與 console 皆空(無雙寫); procOrm 之 reject 契約不變', async function() {
        //spec(dspec Q1): sso 只寫安全摘要; 日誌等級 error → warn; 不再 console 雙寫; 不讀細節
        let setup = (t) => {
            t.users.save = async (data) => data.map(() => ({ n: 1, nInserted: 0, nModified: 0, ok: 0, err: SECRET_ERR }))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'save', [ROW]))
        //procOrm 回傳契約: 兩者皆 reject 同一字串(列主鍵之訊息屬回傳契約)
        assert.strictEqual(fun.r.ok, false)
        assert.strictEqual(fun.r.e, base.r.e)
        assert.strictEqual(fun.r.e, `failed to save data: id[${SECRET_ID}]`)
        //srLog: 恰一筆 warn, 鍵恰為 event / label / safe
        assert.deepStrictEqual(fun.srLog.logs.warn, [{ event: 'orm-diag', label: 'users.save fail', safe: { n: 1, ks: [0] } }])
        assert.strictEqual(fun.srLog.logs.error.length + fun.srLog.logs.info.length + fun.srLog.logs.debug.length, 0, '只用 warn 層級')
        assertNoSecret(fun.srLog.logs, 'DGF-01 srLog')
        //console: 傳 funLog 後 w-serv-orm 不寫 console, 本套件亦不補寫(對照: 未傳者 console 有診斷行)
        assert.deepStrictEqual(fun.lines, [])
        assert.deepStrictEqual(base.lines, [util.format('users.save fail', { n: 1, ks: [0] })])
        //未傳 funLog 者 srLog 無此紀錄
        assert.strictEqual(base.srLog.logs.warn.length, 0)
    })

    it('DGF-02 del 逐筆失敗(tokens): label 含表名與操作, 摘要為筆數與位置', async function() {
        let setup = (t) => {
            t.tokens.del = async (data) => data.map(() => ({ n: 1, nDeleted: 0, ok: 0, err: SECRET_ERR }))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'tokens', 'del', [{ id: SECRET_ID }]))
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.srLog.logs.warn, [{ event: 'orm-diag', label: 'tokens.del fail', safe: { n: 1, ks: [0] } }])
        assert.deepStrictEqual(fun.lines, [])
        assertNoSecret(fun.srLog.logs, 'DGF-02')
    })

    it('DGF-03 insert 整批 reject(ORM 拋 Error, 訊息夾帶信箱): 摘要只有類別, 不含訊息; procOrm 之 reject 為固定字串', async function() {
        let setup = (t) => {
            t.users.insert = async () => Promise.reject(new Error(SECRET_ERR))
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]))
        assert.strictEqual(fun.r.e, base.r.e)
        assert.strictEqual(fun.r.e, 'failed to insert data')
        assert.deepStrictEqual(fun.srLog.logs.warn, [{ event: 'orm-diag', label: 'users.insert catch', safe: { errType: 'Error' } }])
        assertNoSecret(fun.srLog.logs, 'DGF-03')
    })

    it('DGF-04 insert 聚合 ok 為 0(違約形狀): 摘要 { ok: 0 }', async function() {
        let setup = (t) => {
            t.users.insert = async () => ({ n: 1, nInserted: 0, ok: 0, err: SECRET_ERR, id: SECRET_ID })
        }
        let { base, fun } = await mkRun(setup, (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]))
        assert.strictEqual(fun.r.e, 'failed to insert data')
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.srLog.logs.warn, [{ event: 'orm-diag', label: 'users.insert fail', safe: { ok: 0 } }])
        assertNoSecret(fun.srLog.logs, 'DGF-04')
    })

    it('DGF-05 mustExist 列不存在: 只有標籤(safe 未給)', async function() {
        let { base, fun } = await mkRun(() => {}, (orm) => orm.procOrm('op-user', 'tokens', 'save', [{ id: SECRET_ID, timeEnd: 'x' }], { mustExist: true }))
        assert.strictEqual(fun.r.e, 'rowNotFound')
        assert.strictEqual(fun.r.e, base.r.e)
        assert.deepStrictEqual(fun.srLog.logs.warn, [{ event: 'orm-diag', label: 'tokens.save row not found', safe: undefined }])
        assert.deepStrictEqual(fun.lines, [])
    })

    it('DGF-06 被拒之查詢條件(含信箱值): 摘要只有拒收原因, 不含條件值', async function() {
        let find = { email: SECRET_EMAIL, [Symbol('sym')]: 1 }
        let { base, fun } = await mkRun(() => {}, (orm) => orm.procOrm('op-user', 'users', 'select', find))
        assert.strictEqual(fun.r.ok, false)
        assert.strictEqual(fun.r.e, base.r.e)
        let [o] = fun.srLog.logs.warn
        assert.strictEqual(fun.srLog.logs.warn.length, 1)
        assert.strictEqual(o.label, 'users.select invalid find')
        assert.ok(typeof o.safe.reason === 'string' && o.safe.reason.length > 0, '拒收原因')
        assertNoSecret(o, 'DGF-06')
    })

    it('DGF-07 成功寫入不產生任何診斷(srLog 與 console 皆空), 資料照寫', async function() {
        let { fun } = await mkRun(() => {}, (orm, tables) => orm.procOrm('op-user', 'users', 'save', [ROW]).then(() => tables.users.get(SECRET_ID)))
        assert.strictEqual(fun.r.ok, true)
        assert.strictEqual(fun.r.v.email, SECRET_EMAIL)
        assert.deepStrictEqual(fun.lines, [])
        assert.deepStrictEqual(fun.srLog.logs, { info: [], warn: [], debug: [], error: [] })
    })

    it('DGF-08 srLog.warn 同步拋錯 / 回傳 rejected promise: procOrm 之結果、資料表狀態與 console 皆與未接線者相同, 且無 unhandledRejection', async function() {
        //spec(dspec §6.8、設計 A03): 寫入失敗不放大; srLog 回傳之 rejected promise 由轉接器標記已處理
        let setup = (t) => {
            t.users.save = async (data) => data.map(() => ({ n: 1, ok: 0, err: SECRET_ERR }))
        }
        let tablesA = mkTables()
        setup(tablesA)
        let ormA = mkOrm(tablesA)
        let ra = null
        let la = await captureConsole(async () => {
            ra = await ormA.procOrm('op-user', 'users', 'save', [ROW]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
        })
        let warnThrow = () => {
            throw new Error('srLog down')
        }
        let warnReject = () => Promise.reject(new Error('srLog down'))
        for (let [name, warn] of [['同步拋錯', warnThrow], ['rejected promise', warnReject]]) {
            let tablesB = mkTables()
            setup(tablesB)
            let ormB = mkOrm(tablesB, { funLog: mkWiredFunLog({ warn }).funLog })
            let rb = null
            let lb = null
            let nu = await countUnhandled(async () => {
                lb = await captureConsole(async () => {
                    rb = await ormB.procOrm('op-user', 'users', 'save', [ROW]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))
                })
            })
            assert.deepStrictEqual(rb, ra, `${name}: procOrm 結果不變`)
            assert.deepStrictEqual(lb, [], `${name}: 傳 funLog 者 console 為空`)
            assert.deepStrictEqual(la.length, 1)
            assert.deepStrictEqual(tablesB.users.calls, tablesA.users.calls, `${name}: 資料表呼叫不變`)
            assert.strictEqual(nu, 0, `${name}: 無 unhandledRejection`)
        }
    })

    it('DGF-09 label 含控制字元換 ?(消除日誌行偽造)', function() {
        let srLog = mkSrLog()
        mkFunLog(srLog)('a\nb\u0000c', {})
        assert.strictEqual(srLog.logs.warn[0].label, 'a?b?c')
    })

    it('DGF-10 srLog 為 w-syslog 實例之形狀: 事件名預設 orm-diag, 寫入不改動 safe 之原物件', function() {
        let srLog = mkSrLog()
        let safe = { n: 1, ks: [0] }
        mkFunLog(srLog)('users.save fail', safe)
        assert.deepStrictEqual(safe, { n: 1, ks: [0] })
        assert.strictEqual(srLog.logs.warn[0].event, 'orm-diag')
    })

    it(`DGF-corpus-A01 語料 A01 以本套件之轉接器重跑: ${caseOf('A01').label}`, function() {
        //語料 A01 之轉接器未給白名單(預期 safe 原樣 { a: 1 }); 本套件之轉接器帶 { safeKeys: SAFE_KEYS }, 名單外之 a 被丟棄, 故 safe 改以名單內之 n 斷言「第 3 引數不讀」與「safe 照寫」, 其餘判定(getter 0 次)沿用語料
        let c = caseOf('A01')
        let ctx = mkCtx()
        let srLog = mkSrLog()
        //funLog 收到第 3 引數(細節)時不讀(getter 0 次)
        mkFunLog(srLog)('lb', { n: 1, a: 1 }, c.make(ctx))
        assert.deepStrictEqual(srLog.logs.warn, [{ event: 'orm-diag', label: 'lb', safe: { n: 1 } }])
        assert.strictEqual(c.expect.userCode, 0, '語料 A01 之期望含 getter 0 次')
        assert.strictEqual(diagCases.verify({ expect: { userCode: c.expect.userCode } }, srLog.logs.warn, ctx), null, 'getter 0 次')
    })

    it(`DGF-corpus-A07 語料 A07 以本套件之轉接器重跑: ${caseOf('A07').label}`, function() {
        //w-serv-orm 內部以 getDiag({ funLog }, ...) 為出口: funLog 帶 noDetail 時不呼叫 getDetail(語料之 check 預期 wsemi 自測用之事件名 x-diag, 此處改斷言本套件之預設事件名)
        let c = caseOf('A07')
        let ctx = mkCtx()
        let srLog = mkSrLog()
        //safe 之鍵取 SAFE_KEYS 內之 n(語料原用 mode, 非本套件名單內之鍵, 會被轉接器之白名單丟棄)
        getDiag({ funLog: mkFunLog(srLog) }, { safeKeys: ['n'] })('lb', { n: 1 }, c.make(ctx))
        assert.deepStrictEqual(srLog.logs.warn, [{ event: 'orm-diag', label: 'lb', safe: { n: 1 } }])
        assert.strictEqual(diagCases.verify({ expect: { userCode: 0 } }, srLog.logs.warn, ctx), null, 'getDetail 0 次')
    })

})


//
// DGS 轉接器之白名單(第二道防線)
//   w-serv-orm 1.1.23 起公開 SAFE_KEYS(其 funLog 所產生 safe 之頂層鍵, 凍結陣列, w-serv-orm/src/safeKeys.mjs), WWebSso 以 genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }) 接管:
//   srLog 是 safe 的最後出口, 即使產生端(w-serv-orm 或日後換版)多給了名單外之鍵(密碼、憑證、整個物件), 也在寫入前丟棄; errType、errCode 由 wsemi 恆保留
//
describe('DGS 轉接器白名單: genDiagFunLog(…, { safeKeys: SAFE_KEYS }) (R-ORM-04 / R-DIAG-02)', function() {

    let PW = 'Zq#8765Wm-NOT-FOR-LOG'

    it('DGS-01 safe 含白名單外之鍵(password、token、url、巢狀物件): srLog.warn 只收 SAFE_KEYS 內之鍵與 errType / errCode, 名單外之值不入日誌', function() {
        //spec(派工 b-sso 第 1 點、dspec D2): 轉接器為寫入日誌之最後出口, 名單外之鍵一律丟棄(修前未給 safeKeys 時全數寫入)
        let srLog = mkSrLog()
        let safe = { n: 1, ks: [0], errType: 'Error', errCode: '23505', password: PW, token: PW, url: `mongodb://u:${PW}@h/db`, sub: { password: PW }, nested: { n: 1 } }
        mkFunLog(srLog)('users.save fail', safe)
        assert.deepStrictEqual(srLog.logs.warn, [{ event: 'orm-diag', label: 'users.save fail', safe: { n: 1, ks: [0], errType: 'Error', errCode: '23505' } }])
        assert.ok(!strs(srLog.logs).includes(PW), '名單外之值不得入日誌')
        //輸入之原物件不被改動
        assert.deepStrictEqual(Object.keys(safe), ['n', 'ks', 'errType', 'errCode', 'password', 'token', 'url', 'sub', 'nested'])
    })

    it('DGS-02 SAFE_KEYS 內每個鍵逐一保留(不丟失本套件宣告之鍵); errType / errCode 不在名單內仍恆保留', function() {
        //spec(派工 b-sso 第 2 點): w-serv-orm 實際產出之鍵經轉接後不丟失; 名單為 w-serv-orm 公開之單一來源, 不手寫第二份
        assert.ok(Array.isArray(SAFE_KEYS) && SAFE_KEYS.length > 0 && Object.isFrozen(SAFE_KEYS), 'SAFE_KEYS 為非空之凍結陣列')
        assert.ok(!SAFE_KEYS.includes('errType') && !SAFE_KEYS.includes('errCode'), '名單不列恆含之 errType / errCode')
        let srLog = mkSrLog()
        let funLog = mkFunLog(srLog)
        for (let k of SAFE_KEYS) {
            funLog(`lb-${k}`, { [k]: 1 })
        }
        assert.deepStrictEqual(srLog.logs.warn.map((o) => o.safe), SAFE_KEYS.map((k) => ({ [k]: 1 })), '每個名單內之鍵皆保留')
        let srLog2 = mkSrLog()
        mkFunLog(srLog2)('lb', { errType: 'Error', errCode: 'ECONNREFUSED' })
        assert.deepStrictEqual(srLog2.logs.warn[0].safe, { errType: 'Error', errCode: 'ECONNREFUSED' })
    })

    it('DGS-03 safe 的鍵全在名單外: 事件照寫, safe 為空物件(label 保留); safe 未給仍為 undefined', function() {
        let srLog = mkSrLog()
        let funLog = mkFunLog(srLog)
        funLog('lb1', { password: PW, mode: 'm' })
        funLog('lb2')
        assert.deepStrictEqual(srLog.logs.warn, [
            { event: 'orm-diag', label: 'lb1', safe: {} },
            { event: 'orm-diag', label: 'lb2', safe: undefined },
        ])
    })

    //情境: 本套件既有之 ORM 失敗情境(同 DGF-01~06), 各驅動真實 WServOrm, 比對 w-serv-orm 交給 funLog 之原產出與轉接後寫入 srLog 者
    let scenarios = [
        {
            id: 'save 逐筆失敗',
            setup: (t) => {
                t.users.save = async (data) => data.map(() => ({ n: 1, nInserted: 0, nModified: 0, ok: 0, err: SECRET_ERR }))
            },
            exec: (orm) => orm.procOrm('op-user', 'users', 'save', [ROW]),
            keys: ['n', 'ks'],
        },
        {
            id: 'del 逐筆失敗',
            setup: (t) => {
                t.tokens.del = async (data) => data.map(() => ({ n: 1, nDeleted: 0, ok: 0, err: SECRET_ERR }))
            },
            exec: (orm) => orm.procOrm('op-user', 'tokens', 'del', [{ id: SECRET_ID }]),
            keys: ['n', 'ks'],
        },
        {
            id: 'insert 整批 reject',
            setup: (t) => {
                t.users.insert = async () => Promise.reject(new Error(SECRET_ERR))
            },
            exec: (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]),
            keys: ['errType'],
        },
        {
            id: 'insert 整批 reject(帶 SQLSTATE 代碼)',
            setup: (t) => {
                t.users.insert = async () => Promise.reject(Object.assign(new Error(SECRET_ERR), { code: '23505' }))
            },
            exec: (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]),
            keys: ['errType', 'errCode'],
        },
        {
            id: 'insert 聚合 ok 為 0',
            setup: (t) => {
                t.users.insert = async () => ({ n: 1, nInserted: 0, ok: 0, err: SECRET_ERR, id: SECRET_ID })
            },
            exec: (orm) => orm.procOrm('op-user', 'users', 'insert', [ROW]),
            keys: ['ok'],
        },
        {
            id: '被拒之查詢條件',
            setup: () => {},
            exec: (orm) => orm.procOrm('op-user', 'users', 'select', { email: SECRET_EMAIL, [Symbol('sym')]: 1 }),
            keys: ['reason'],
        },
    ]

    it('DGS-04 w-serv-orm 實際產出之診斷經轉接後鍵不丟失: 各既有 ORM 失敗情境, 轉接後 srLog 之 safe 與 w-serv-orm 交給 funLog 之原產出完全相同, 且原產出之鍵皆在 SAFE_KEYS 內或為 errType / errCode', async function() {
        //spec(派工 b-sso 第 2 點②): 白名單不得誤傷本套件實際會遇到之診斷; 比對原產出(記錄替身)與轉接後, 不手寫期望之第二份
        let seen = new Set()
        for (let sc of scenarios) {
            //原產出: 記錄替身 funLog(帶 noDetail, 同 genDiagFunLog 所產生者, w-serv-orm 不取細節)
            let raws = []
            let spy = Object.assign((label, safe) => {
                raws.push({ label, safe })
            }, { noDetail: true })
            let tablesA = mkTables()
            sc.setup(tablesA)
            await captureConsole(async () => {
                await sc.exec(mkOrm(tablesA, { funLog: spy })).catch(() => {})
            })
            //轉接後: 本套件之接線
            let srLog = mkSrLog()
            let tablesB = mkTables()
            sc.setup(tablesB)
            await captureConsole(async () => {
                await sc.exec(mkOrm(tablesB, { funLog: mkFunLog(srLog) })).catch(() => {})
            })
            assert.strictEqual(raws.length, 1, `${sc.id}: w-serv-orm 恰產出一筆診斷`)
            let raw = raws[0]
            let rawKeys = Object.keys(raw.safe)
            for (let k of sc.keys) {
                assert.ok(rawKeys.includes(k), `${sc.id}: 情境確實產出 ${k}(情境失效不得靜默少覆蓋), 實際 ${rawKeys.join(',')}`)
                seen.add(k)
            }
            for (let k of rawKeys) {
                assert.ok(SAFE_KEYS.includes(k) || k === 'errType' || k === 'errCode', `${sc.id}: w-serv-orm 產出之鍵 ${k} 須在 SAFE_KEYS 內`)
            }
            assert.deepStrictEqual(srLog.logs.warn, [{ event: 'orm-diag', label: raw.label, safe: raw.safe }], `${sc.id}: 轉接後與原產出一致(鍵不丟失)`)
            assertNoSecret(srLog.logs, `DGS-04 ${sc.id}`)
        }
        assert.deepStrictEqual([...seen].sort(), ['errCode', 'errType', 'ks', 'n', 'ok', 'reason'], '情境涵蓋之鍵')
    })

})


//
// DGX 外來值入口遮罩
//
describe('DGX 外來值入口遮罩: guardOrm / srEmail / ormWrite (dspec D3、R07)', function() {

    //throughGuard: 以 guardOrm 包 { users } 表, 該表 select 拋出(或 reject) value, 回傳 guardOrm 後之結果值
    async function throughGuard(src, value, how = 'reject') {
        let diag = getDiag({}, { secrets: getDiagSecrets(src) })
        let users = {
            select: async () => {
                if (how === 'throw') {
                    throw value
                }
                return Promise.reject(value)
            },
        }
        let wi = guardOrm(diag, { users })
        return wi.users.select({}).then(() => 'resolved', (e) => e)
    }

    //語料之外來值形態以本套件之入口(guardOrm)重跑
    let WIRE = {
        T01: async (c, ctx) => {
            let masked = await throughGuard(ctx.src(), new Error(c.make(ctx)))
            return diagCases.verify(c, masked.message, ctx)
        },
        T07: async (c, ctx) => {
            let masked = await throughGuard({}, new Error(c.make(ctx)))
            return diagCases.verify(c, masked.message, ctx)
        },
        R01: async (c, ctx) => {
            let e = c.make(ctx)
            let masked = await throughGuard(ctx.src(), e)
            return diagCases.verify(c, [e, masked], ctx)
        },
        R02: async (c, ctx) => {
            let { e, DbErr, src } = c.make(ctx)
            let masked = await throughGuard(src, e)
            return diagCases.verify(c, { r: masked, same: masked === e, inst: masked instanceof DbErr, code: masked.code }, ctx)
        },
        R04: async (c, ctx) => {
            let masked = await throughGuard(ctx.src(), c.make(ctx))
            return diagCases.verify(c, masked, ctx)
        },
        R11: async (c, ctx) => {
            //Q3: 對外錯誤值不遮儲存路徑(診斷輸出才遮)
            let e = c.make(ctx)
            let masked = await throughGuard({ paths: ['D:\\other\\store\\db02'] }, e)
            return masked === e ? null : `reject 不應遮路徑: ${masked.message}`
        },
        R12: async (c, ctx) => {
            //P1: 單獨帳號出現於後端訊息, 對外錯誤值不遮
            let e = c.make(ctx)
            let masked = await throughGuard({ username: 'dbuser', password: ctx.sec.password }, e)
            return masked === e ? null : `reject 不應遮單獨帳號: ${masked.message}`
        },
    }

    for (let id of Object.keys(WIRE)) {
        it(`DGX-corpus-${id} 語料 ${id} 以 guardOrm 重跑: ${caseOf(id).label}`, async function() {
            let c = caseOf(id)
            let err = await WIRE[id](c, mkCtx())
            assert.strictEqual(err, null, String(err))
        })
    }

    it('DGX-01 同步拋錯亦遮罩; resolve 之結果值、this 綁定與非函數屬性原樣', async function() {
        let ctx = mkCtx()
        let src = ctx.src()
        let diag = getDiag({}, { secrets: getDiagSecrets(src) })
        let thisSeen = null
        let rows = [{ id: 'a', password: ctx.sec.password }] //resolve 值內含秘密字串: 非 reject, 不屬本函數遮罩範圍
        let users = {
            tag: 'tbl-users',
            sel: async function() {
                thisSeen = this
                return rows
            },
            boom: () => {
                throw new Error(`connect failed ${ctx.sec.url}`)
            },
        }
        let wi = guardOrm(diag, { users })
        assert.strictEqual(wi.users.tag, 'tbl-users')
        assert.strictEqual(await wi.users.sel(), rows, 'resolve 值同一物件')
        assert.strictEqual(thisSeen, users, 'this 為原資料表')
        let e = null
        try {
            wi.users.boom()
        }
        catch (err) {
            e = err
        }
        assert.ok(e instanceof Error)
        assert.ok(!e.message.includes(ctx.sec.password) && !e.message.includes('db.example.com'), e.message)
    })

    it('DGX-07 woItems 全部資料表(users、tokens、ips)皆經 guardOrm: 任一表之 reject 含憑證者皆被遮罩', async function() {
        //站點全集: server/WWebSso.mjs 之 woItems 即 w-serv-orm 依 schema 建立之全部表; 漏包任一表即漏一個外來值入口
        let ctx = mkCtx()
        let diag = getDiag({}, { secrets: getDiagSecrets(ctx.src()) })
        let raw = {}
        for (let k of Object.keys(ds)) {
            raw[k] = { select: async () => Promise.reject(new Error(`connect failed ${ctx.sec.url}`)) }
        }
        assert.deepStrictEqual(Object.keys(raw).sort(), ['ips', 'tokens', 'users'])
        let wi = guardOrm(diag, raw)
        for (let k of Object.keys(raw)) {
            let e = await wi[k].select({}).then(() => null, (x) => x)
            assert.ok(e instanceof Error && !e.message.includes(ctx.sec.password) && !e.message.includes('db.example.com'), `${k}: ${e && e.message}`)
        }
    })

    it('DGX-02 固定詞彙之 reject 原樣(R07): 秘密為其子字串時 procCore 之固定 key 不被切碎', async function() {
        //spec(dspec R07): 本套件以固定詞彙組成之 reject 不經遮罩. 以秘密 Expired / failedLogin(權杖類, 兩份清單皆列)為 tokenExpired / failedLoginForCatch 之子字串
        let diag = getDiag({}, { secrets: getDiagSecrets({ values: ['Expired', 'failedLogin'] }) })
        let rawTables = { users: mkTable(), tokens: mkTable(), ips: mkTable() }
        let woItems = guardOrm(diag, rawTables)
        let p = buildProc(woItems, mkProcOrm(ds, rawTables), { srLog: mkSrLog(), diag })
        let lines = []
        let e1 = null
        let e2 = null
        lines = await captureConsole(async () => {
            e1 = await p.checkToken('no-such-token').then(() => null, (e) => e)
            e2 = await p.loginByAccountAndPassword('no-such-user', 'Pw@12345x').then(() => null, (e) => e)
        })
        assert.strictEqual(e1, 'tokenExpired')
        assert.strictEqual(e2, 'failedLoginForCatch')
        assert.ok(!strs(lines).includes('***'), `固定詞彙之 console 輸出亦不被遮: ${strs(lines)}`)
    })

    it('DGX-03 外來值 reject 含連線字串與密碼: procCore 登入之 reject 為保型副本(憑證已遮、類別與診斷文字保留); 固定 key 不受影響', async function() {
        let ctx = mkCtx()
        let diag = getDiag({}, { secrets: getDiagSecrets(ctx.src()) })
        let rawTables = { users: mkTable(), tokens: mkTable(), ips: mkTable() }
        rawTables.users.select = async () => Promise.reject(new Error(`connect ECONNREFUSED ${ctx.sec.url} (password ${ctx.sec.password})`))
        let woItems = guardOrm(diag, rawTables)
        let p = buildProc(woItems, mkProcOrm(ds, rawTables), { srLog: mkSrLog(), diag })
        let e = await p.loginByAccountAndPassword('someone', 'Pw@12345x').then(() => null, (x) => x)
        assert.ok(e instanceof Error, `reject 為 Error: ${String(e)}`)
        assert.ok(e.message.includes('connect ECONNREFUSED'), `保留診斷文字: ${e.message}`)
        for (let x of [ctx.sec.password, ctx.sec.username + ':', 'db.example.com']) {
            assert.ok(!e.message.includes(x), `不得含 ${x}: ${e.message}`)
        }
    })

    it('DGX-04 外來值 reject 經 console 出口(procCore.checkToken 內層 reject)不輸出錯誤原文(ADR-101 取代原「遮罩後保留診斷文字」), 只印錯誤類型; 對外仍為固定 key tokenExpired', async function() {
        let ctx = mkCtx()
        let diag = getDiag({}, { secrets: getDiagSecrets(ctx.src()) })
        let rawTables = { users: mkTable(), tokens: mkTable(), ips: mkTable() }
        rawTables.tokens.select = async () => Promise.reject(new Error(`read failed at ${ctx.sec.url}`))
        let woItems = guardOrm(diag, rawTables)
        let p = buildProc(woItems, mkProcOrm(ds, rawTables), { srLog: mkSrLog(), diag })
        let e = null
        let lines = await captureConsole(async () => {
            e = await p.checkToken('tk-any').then(() => null, (x) => x)
        })
        assert.strictEqual(e, 'tokenExpired')
        let s = strs(lines)
        //原斷言: 保留診斷文字 'read failed at'(遮憑證後); 現行: console 只印安全摘要 { errType }, 診斷文字(後端錯誤原文)不印(dspec D2)
        assert.ok(s.includes('checkToken inner reject') && s.includes('errType'), `只印錯誤類型: ${s}`)
        assert.ok(!s.includes('read failed at'), `console 不得含後端錯誤原文: ${s}`)
        for (let x of [ctx.sec.password, 'db.example.com']) {
            assert.ok(!s.includes(x), `console 不得含 ${x}: ${s}`)
        }
    })

    it('DGX-05 逐筆 err(ormWrite): 建立 reject 字串時即遮罩憑證, 失敗筆主鍵與其餘文字保留; 未傳 diag 者用無登錄秘密之預設實例', async function() {
        //spec(dspec §4、設計 §6.10): 結果物件之逐筆 err 於建立時 diag.mask
        let ctx = mkCtx()
        let diag = getDiag({}, { secrets: getDiagSecrets({ password: 'S3cretPw' }) })
        let t = mkTable([{ id: 'a', v: 1 }])
        t.save = async (data) => data.map((v) => ({ n: 1, ok: 0, err: `login failed for S3cretPw (row ${v.id})` }))
        let e = await ormWrite(t, 'save', [{ id: 'a', v: 2 }], diag).then(() => null, (x) => x)
        assert.strictEqual(e, 'save fail: id[a]: login failed for *** (row a)')
        //未傳 diag: 預設實例不認得 S3cretPw(對照: 證明上一斷言之遮罩來自傳入之 diag), 但具名樣式(網址帳密)仍遮
        let e2 = await ormWrite(t, 'save', [{ id: 'a', v: 2 }]).then(() => null, (x) => x)
        assert.strictEqual(e2, 'save fail: id[a]: login failed for S3cretPw (row a)')
        t.save = async (data) => data.map(() => ({ n: 1, ok: 0, err: `open ${ctx.sec.url}` }))
        let e3 = await ormWrite(t, 'save', [{ id: 'a', v: 2 }]).then(() => null, (x) => x)
        assert.ok(!e3.includes(ctx.sec.password), e3)
    })

    it('DGX-06 寄信(srEmail.send): SMTP 驗證失敗之 reject 含寄信密碼者被遮; 型別無效之 srcPW 不回顯其值', async function() {
        //以最小 SMTP 假伺服器令驗證失敗並於回應文字回顯密碼(nodemailer 將回應文字併入 Error.message)
        let pw = 'Smtp9xQ!z7Pw'
        let port = 11398
        let srv = net.createServer((sock) => {
            sock.write('220 fake ESMTP\r\n')
            let buf = ''
            let st = ''
            sock.on('data', (d) => {
                buf += d.toString()
                let ls = buf.split('\r\n')
                buf = ls.pop()
                for (let l of ls) {
                    if (/^EHLO/i.test(l)) {
                        sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n')
                    }
                    else if (/^AUTH PLAIN/i.test(l)) {
                        sock.write(`535 5.7.8 authentication failed for ${pw}\r\n`)
                    }
                    else if (/^AUTH LOGIN/i.test(l)) {
                        st = 'user'
                        sock.write('334 VXNlcm5hbWU6\r\n')
                    }
                    else if (st === 'user') {
                        st = 'pass'
                        sock.write('334 UGFzc3dvcmQ6\r\n')
                    }
                    else if (st === 'pass') {
                        st = ''
                        sock.write(`535 5.7.8 authentication failed for ${pw}\r\n`)
                    }
                    else if (/^QUIT/i.test(l)) {
                        sock.write('221 bye\r\n')
                        sock.end()
                    }
                    else {
                        sock.write('250 ok\r\n')
                    }
                }
            })
        })
        await new Promise((resolve) => srv.listen(port, '127.0.0.1', resolve))
        try {
            let st = { emSrcEmail: 'from@example.com', emSrcPW: pw, emSrcHost: '127.0.0.1', emSrcPort: port }
            let diag = getDiag({}, { secrets: getDiagSecrets({ username: st.emSrcEmail, password: pw }) })
            let em = srEmailInit(st, diag)
            let e = await em.send('n', 't', 'c', 'to@example.com').then(() => null, (x) => x)
            assert.ok(e instanceof Error, String(e))
            assert.ok(e.message.includes('authentication failed'), `保留診斷文字: ${e.message}`)
            assert.ok(!e.message.includes(pw), `不得含寄信密碼: ${e.message}`)
            //本函數以固定詞彙組成之 reject 原樣(不經遮罩)
            let e2 = await em.send('', 't', 'c', 'to@example.com').then(() => null, (x) => x)
            assert.strictEqual(e2, 'invalid srcName[]')
        }
        finally {
            await new Promise((resolve) => srv.close(resolve))
        }
        //srcPW 型別無效: 建構錯誤訊息不回顯其值
        let eInit = null
        try {
            srEmailInit({ emSrcEmail: 'from@example.com', emSrcPW: 12345678, emSrcHost: 'h', emSrcPort: 25 })
        }
        catch (err) {
            eInit = err
        }
        assert.ok(eInit instanceof Error)
        assert.ok(!eInit.message.includes('12345678'), eInit.message)
    })

})


describe('DGC 建構期輸出', function() {

    it('DGC-01 url 型別無效: console 只印型別不印值, 仍拋 invalid url', async function() {
        let e = null
        let lines = await captureConsole(async () => {
            try {
                WWebSso(class {}, { user: 'u', password: 'PwSecret99' }, 'wsso', './settings.json', {})
            }
            catch (err) {
                e = err
            }
        })
        assert.strictEqual(e.message, 'invalid url')
        assert.deepStrictEqual(lines, ['invalid url object'])
    })

    it('DGC-02 資料庫連線初始化錯誤(WServOrm 建構失敗): console 輸出與重拋之錯誤皆已遮罩連線字串、資料庫密碼與本套件宣告之寄信密碼', async function() {
        //寄信密碼只有本套件的 diag 認得(w-serv-orm 自身只認連線字串與 dbPassword), 故此案能鑑別 WWebSso 建構錯誤 catch 的 diag.err
        let ctx = mkCtx()
        let smtpPw = 'Smtp9xQ!z7Pw'
        let dir = './test/_tmp/unit-diaglog'
        fs.rmSync(dir, { recursive: true, force: true })
        class WOrmThrow {
            constructor() {
                throw new Error(`connect failed ${ctx.sec.url} password ${ctx.sec.password} smtp ${smtpPw}`)
            }
        }
        let e = null
        let lines = await captureConsole(async () => {
            try {
                WWebSso(WOrmThrow, ctx.sec.url, 'wsso', './settings.json', { serverPort: 11399, logFd: `${dir}/logs`, allowUserRegistration: true, emSrcHost: '127.0.0.1', emSrcPort: 1, emSrcPW: smtpPw })
            }
            catch (err) {
                e = err
            }
        })
        try {
            assert.ok(e instanceof Error)
            assert.ok(e.message.includes('connect failed'), `保留診斷文字: ${e.message}`)
            let s = `${e.message}\n${lines.join('\n')}`
            for (let x of [ctx.sec.password, 'db.example.com', smtpPw]) {
                assert.ok(!s.includes(x), `不得含 ${x}: ${s}`)
            }
            assert.ok(lines.some((l) => l.startsWith('WServOrm init failed')), '仍輸出初始化失敗')
        }
        finally {
            //srLog(w-syslog)為背景寫檔: 先等 log 檔出現並靜止再刪, 刪後再等再刪一次, 確認無重建
            let t0 = Date.now()
            while (Date.now() - t0 < 5000 && !(fs.existsSync(`${dir}/logs`) && fs.readdirSync(`${dir}/logs`).length > 0)) {
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
            for (let k = 0; k < 2; k++) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
                fs.rmSync(dir, { recursive: true, force: true })
            }
        }
        assert.ok(!fs.existsSync(dir), 'test/_tmp/unit-diaglog 已清除')
    })

})


describe('SITE-DG 站點全集(原始碼盤點; R-ORM-04 / R-DIAG-01)', function() {

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
    //code: 去註解(行註解與區塊註解)後之原始碼
    let code = (p) => fs.readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

    it('SITE-DG-001 非測試原始碼中呼叫 WServOrm( 者恰為 server/WWebSso.mjs(接上 funLog)與 g_mOrm.mjs(開發腳本, 刻意不套)', function() {
        let sites = listSources().filter((p) => /\bWServOrm\(/.test(code(p)))
        assert.deepStrictEqual(sites.sort(), ['./g_mOrm.mjs', './server/WWebSso.mjs'])
    })

    it('SITE-DG-002 server/WWebSso.mjs: WServOrm 之 opt 恰為 { funLog }, funLog 恰由 genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }) 產生(只寫安全摘要與白名單內之鍵), srLog 先於 WServOrm 建立', function() {
        let src = fs.readFileSync('./server/WWebSso.mjs', 'utf8')
        let c = code('./server/WWebSso.mjs')
        let m = c.match(/^\s*wp = WServOrm\((.*)\)\s*$/m)
        assert.ok(m, '找到 wp = WServOrm(...) 呼叫')
        assert.strictEqual(m[1], 'ds, WOrm, url, db, { funLog }')
        assert.strictEqual((c.match(/\bgenDiagFunLog\(/g) || []).length, 1, 'genDiagFunLog 恰呼叫一次')
        assert.ok(/let \{ funLog \} = genDiagFunLog\(\(o\) => srLog\.warn\(o\), \{ safeKeys: SAFE_KEYS \}\)/.test(c), 'funLog 由 genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }) 產生')
        assert.ok(src.indexOf('let srLog = srLogInit(opt)') < src.indexOf('wp = WServOrm('), 'srLog 先建立')
        assert.ok(/import genDiagFunLog from 'wsemi\/src\/genDiagFunLog\.mjs'/.test(src), '匯入 genDiagFunLog')
    })

    it('SITE-DG-003 已刪之自寫遮罩與診斷輸出不復存在: server/ormDiagLog.mjs 檔、maskOrmDetail、wrapProcOrm、AsyncLocalStorage、async_hooks', function() {
        assert.ok(!fs.existsSync('./server/ormDiagLog.mjs'), 'server/ormDiagLog.mjs 已刪')
        let hits = listSources().filter((p) => /\b(maskOrmDetail|wrapProcOrm|mkOrmFunLog|ormDiagLog|AsyncLocalStorage)\b|async_hooks/.test(code(p)))
        assert.deepStrictEqual(hits, [])
    })

    it('SITE-DG-004 server/ 與 src/ 不使用 logDetail(會把完整細節還原到 console); funLog 只在 server/WWebSso.mjs 接線', function() {
        let hits = listSources().filter((p) => /^\.\/(server|src)\//.test(p) && /\blogDetail\b/.test(code(p)))
        assert.deepStrictEqual(hits, [])
        let hits2 = listSources().filter((p) => /^\.\/server\//.test(p) && /\bfunLog\b/.test(code(p)))
        assert.deepStrictEqual(hits2.sort(), ['./server/WWebSso.mjs'])
    })

    it('SITE-DG-005 外來值入口: WWebSso 之 woItems 為 guardOrm(diag, woItemsRaw) 之回傳, 原始 woItemsRaw 僅解構與包裝兩處; srEmail 取得 diag', function() {
        let c = code('./server/WWebSso.mjs')
        assert.ok(/let \{ woItems: woItemsRaw, procOrm, withTabLocks, guardWrite \} = wp/.test(c), '解構 woItemsRaw')
        assert.ok(/let woItems = guardOrm\(diag, woItemsRaw\)/.test(c), 'woItems 經 guardOrm 包裝')
        assert.strictEqual((c.match(/\bwoItemsRaw\b/g) || []).length, 2, '原始 woItemsRaw 僅解構與包裝兩處')
        assert.ok(/srEmailInit\(opt, diag\)/.test(c), 'srEmail 取得 diag')
        assert.ok(/procCore\(woItems, procOrm, \{ srLog, diag,/.test(c), 'procCore 取得 diag(ormWrite 逐筆 err)')
        assert.ok(/procProtect\(woItems, p,/.test(c) && /procStaInfor\(woItems, p,/.test(c), 'procProtect / procStaInfor 取得包裝後之 woItems')
    })

    it('SITE-DG-006 diag 實例之秘密來源: 資料庫連線字串 url 與寄信帳密 emSrcEmail / emSrcPW; 本套件以 getDiag 建立, 不自寫遮罩', function() {
        let c = code('./server/WWebSso.mjs')
        let m = c.match(/let diag = getDiag\(\{\}, \{\s*secrets: getDiagSecrets\(\{([\s\S]*?)\}\),\s*\}\)/)
        assert.ok(m, '找到 diag = getDiag(...)')
        assert.ok(/urls: \[url\]/.test(m[1]) && /emSrcEmail/.test(m[1]) && /emSrcPW/.test(m[1]), `秘密來源: ${m[1]}`)
    })

    it('SITE-DG-007 伺服端 reject 入口之 diag 用法恰在預期檔: diag.err 只在 guardOrm / srEmail / WWebSso(建構錯誤); diag.mask 只在 ormWrite; 固定詞彙之 reject 站點不含 diag', function() {
        let files = listSources().filter((p) => /^\.\/server\//.test(p))
        let errUsers = files.filter((p) => /\bdiag\.err\(/.test(code(p))).sort()
        assert.deepStrictEqual(errUsers, ['./server/WWebSso.mjs', './server/guardOrm.mjs', './server/srEmail.mjs'])
        let maskUsers = files.filter((p) => /\bdiag\.mask\(/.test(code(p))).sort()
        assert.deepStrictEqual(maskUsers, ['./server/ormWrite.mjs'])
        //procCore / procProtect 之 reject 皆為固定詞彙或已於入口遮罩者: 不得再包 diag.err(固定 key 被切碎之風險, R07)
        for (let p of ['./server/procCore.mjs', './server/procProtect.mjs', './server/procStaInfor.mjs', './server/lockSave.mjs']) {
            assert.ok(!/\bdiag\.(err|mask)\(/.test(code(p)), `${p} 不得包 diag.err / diag.mask`)
        }
    })

    it('SITE-DG-009 procCore 之直接寫入點 ormWrite( 恰 2 處, 皆帶 diag(逐筆 err 於建立時遮罩); ormWrite.mjs 組字串處經 diag.mask', function() {
        let c = code('./server/procCore.mjs')
        assert.strictEqual((c.match(/\bormWrite\(/g) || []).length, 2, 'ormWrite( 呼叫站點')
        assert.strictEqual((c.match(/\}\), diag\)/g) || []).length, 2, '兩處皆以 diag 為第 4 引數')
        let cw = code('./server/ormWrite.mjs')
        assert.ok(/\$\{diag\.mask\(v\.err\)\}/.test(cw), '逐筆 err 經 diag.mask')
        //全 server/ 內直接呼叫 ormWrite 者僅 procCore(其餘寫入皆經 procOrm)
        let users = listSources().filter((p) => /^\.\/server\//.test(p) && /\bormWrite\(/.test(code(p)) && p !== './server/ormWrite.mjs')
        assert.deepStrictEqual(users, ['./server/procCore.mjs'])
    })

    it('SITE-DG-008 console 出口之外來值: server/ 內不再以 console 直接輸出 catch 到之錯誤物件(原 12 + 3 + 1 處已於 ADR-101 改為只印 diag.brief / getDiagBriefErr 之安全摘要; 站點全集見 unit-consoleNoLeak SITE-CNL)', function() {
        //原: 以 console.log 直接輸出 err / errTemp 者(WWebSso 1、procCore 12、procProtect 3, 錯誤皆來自已於入口遮罩憑證之資料表 / 寄信)被鎖定為已遮罩之外來值入口;
        //ADR-101(dspec〈診斷輸出與遮罩〉D2 預設不輸出資料值與後端錯誤原文)起, console 不再輸出錯誤原文(遮罩只遮憑證, 不遮其他資料值), 站點全數改為只印錯誤類型與代碼; 本盤點改為鎖定「零處」
        let files = listSources().filter((p) => /^\.\/server\//.test(p))
        let counts = {}
        for (let p of files) {
            let n = (code(p).match(/console\.log\((?:'[^']*', )?(?:err|errTemp)\)/g) || []).length
            if (n > 0) {
                counts[p] = n
            }
        }
        assert.deepStrictEqual(counts, {})
    })

    it('SITE-DG-010 白名單接線: server/WWebSso.mjs 自 w-serv-orm 公開入口 safeKeys.mjs 匯入 SAFE_KEYS(恰一次), 不自宣告第二份; 接線運算式恰為 genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS })', function() {
        //spec(派工 b-sso 第 1、2 點③): 名單單一來源在 w-serv-orm; 本套件不手寫名單、不匯入 w-serv-orm 內部檔取名單
        let src = fs.readFileSync(pathWWebSso, 'utf8')
        let c = stripComments(src)
        let impLine = 'import { SAFE_KEYS } from \'w-serv-orm/src/safeKeys.mjs\''
        assert.strictEqual(c.split(/\r?\n/).filter((x) => x === impLine).length, 1, `匯入行恰一行: ${impLine}`)
        assert.strictEqual((c.match(/\bSAFE_KEYS\b/g) || []).length, 2, 'SAFE_KEYS 僅匯入與接線兩處(無自宣告之第二份)')
        assert.strictEqual(getWiredExpr(), 'genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS })')
        assert.ok(src.indexOf(impLine) < src.indexOf('let { funLog } = genDiagFunLog('), '先匯入後使用')
    })

    //w-serv-orm 之匯入全表: 檔 → 模組 → 判定; 公開入口(w-serv-orm README): 主入口 WServOrm.mjs、純函數子模組 baseline.mjs、白名單 safeKeys.mjs; 其餘皆為內部檔
    //內部檔只允許: 測試與測試輔助(組真實 procOrm)、維運腳本(根目錄 g_*.mjs)、與唯一之出貨例外 server/getIgnoredOrmKeys.mjs(checkOptRemoved, R-ORM-02: 上游註解明載供包裝層檢查自身之 opt)
    //新增、刪除或改動任一匯入須先更新此表並寫明判定(spec/evidence/ 為歷史取證腳本, 不出貨亦不執行, 不在盤點範圍)
    let OPEN = ['w-serv-orm/src/WServOrm.mjs', 'w-serv-orm/src/baseline.mjs', 'w-serv-orm/src/safeKeys.mjs']
    let IMPORTS = [
        ['./server/WWebSso.mjs', 'w-serv-orm/src/WServOrm.mjs'],
        ['./server/WWebSso.mjs', 'w-serv-orm/src/safeKeys.mjs'],
        ['./server/procCore.mjs', 'w-serv-orm/src/baseline.mjs'],
        ['./src/baselineOf.mjs', 'w-serv-orm/src/baseline.mjs'],
        ['./server/getIgnoredOrmKeys.mjs', 'w-serv-orm/src/checkOptRemoved.mjs'], //出貨例外: 內部檔, 與診斷輸出無關
        ['./g_mOrm.mjs', 'w-serv-orm/src/WServOrm.mjs'],
        ['./g_backupDb.mjs', 'w-serv-orm/src/getDb.mjs'], //維運腳本
        ['./g_initialTestData.mjs', 'w-serv-orm/src/genTestData.mjs'], //維運腳本
        ['./test/api-concurrency.test.mjs', 'w-serv-orm/src/baseline.mjs'],
        ['./test/unit-writeContract.test.mjs', 'w-serv-orm/src/baseline.mjs'],
        ['./test/unit-diaglog.test.mjs', 'w-serv-orm/src/WServOrm.mjs'],
        ['./test/unit-diaglog.test.mjs', 'w-serv-orm/src/safeKeys.mjs'],
        ['./test/unit-ignoredOrmKeys.test.mjs', 'w-serv-orm/src/getMapOrm.mjs'], //測試: 直接組 procOrm
        ['./test/unit-ignoredOrmKeys.test.mjs', 'w-serv-orm/src/getProc.mjs'],
        ['./test/tools/unitProc.mjs', 'w-serv-orm/src/WServOrm.mjs'],
        ['./test/tools/unitProc.mjs', 'w-serv-orm/src/getMapOrm.mjs'], //測試輔助: 以替身資料表組真實 procOrm
        ['./test/tools/unitProc.mjs', 'w-serv-orm/src/getProc.mjs'],
        ['./test/tools/diagWire.mjs', 'w-serv-orm/src/safeKeys.mjs'],
    ]
    let EXCEPT_PROD = './server/getIgnoredOrmKeys.mjs'

    //listImports: 掃 server/、src/、toolg/、test/(不含 _tmp、pics、staLogs-golden)與根目錄 *.mjs, 取出所有 w-serv-orm 模組之匯入
    //靜態匯入只認行首之 import … from '…'、多行匯入收尾之 } from '…'、import '…', 動態形式認 import('…')、require('…')、import.meta.resolve('…'); 不認字串內容中夾帶之 from '…'(本檔斷言訊息會寫到)
    let RE_IMPORTS = [
        /^[ \t]*import\b[^\n'"`]*?\bfrom[ \t]*(['"`])(w-serv-orm[^'"`\n]*)\1/gm,
        /^[ \t]*\}[ \t]*from[ \t]*(['"`])(w-serv-orm[^'"`\n]*)\1/gm,
        /^[ \t]*import[ \t]+(['"`])(w-serv-orm[^'"`\n]*)\1/gm,
        /\b(?:import|require|import\.meta\.resolve)[ \t]*\([ \t]*(['"`])(w-serv-orm[^'"`\n]*)\1/g,
    ]
    function listImports() {
        let found = []
        let root = pathRoot.replace(/\\/g, '/')
        let scan = (p) => {
            let c = stripComments(fs.readFileSync(`${root}/${p}`, 'utf8'))
            for (let re of RE_IMPORTS) {
                for (let m of c.matchAll(re)) {
                    found.push([`./${p}`, m[2]])
                }
            }
        }
        let walk = (dir) => {
            for (let f of fs.readdirSync(`${root}/${dir}`, { withFileTypes: true })) {
                if (f.isDirectory()) {
                    if (!['_tmp', 'pics', 'staLogs-golden', 'node_modules'].includes(f.name)) {
                        walk(`${dir}/${f.name}`)
                    }
                }
                else if (/\.(mjs|js|vue)$/.test(f.name)) {
                    scan(`${dir}/${f.name}`)
                }
            }
        }
        for (let d of ['server', 'src', 'toolg', 'test']) {
            if (fs.existsSync(`${root}/${d}`)) {
                walk(d)
            }
        }
        for (let f of fs.readdirSync(root)) {
            if (/\.mjs$/.test(f)) {
                scan(f)
            }
        }
        return found
    }

    it('SITE-DG-011 w-serv-orm 之匯入全表(封閉集合): 出貨碼只匯入公開入口(主入口 WServOrm.mjs、baseline.mjs、safeKeys.mjs), 內部檔只在測試、測試輔助、維運腳本與唯一之出貨例外 getIgnoredOrmKeys.mjs; 不匯入 getDiagBrief.mjs 等診斷內部檔', function() {
        let found = listImports()
        let key = (a) => a.map((x) => x.join(' <- ')).sort()
        assert.deepStrictEqual(key(found), key(IMPORTS), '實際匯入與全表一致(新增、刪除或改動匯入須先更新全表並寫明判定)')
        for (let [file, spec] of found) {
            assert.ok(spec.startsWith('w-serv-orm/src/'), `${file} 匯入 ${spec}: 只可深層匯入 src/ 下之模組(主入口為 src/WServOrm.mjs)`)
            if (OPEN.includes(spec)) {
                continue
            }
            let okLoc = /^\.\/test\//.test(file) || /^\.\/g_[^/]+\.mjs$/.test(file) || file === EXCEPT_PROD
            assert.ok(okLoc, `${file} 匯入內部檔 ${spec}: 出貨碼不得匯入 w-serv-orm 之內部檔`)
        }
        let internalProd = found.filter(([file, spec]) => !OPEN.includes(spec) && /^\.\/(server|src|toolg)\//.test(file))
        assert.deepStrictEqual(internalProd, [[EXCEPT_PROD, 'w-serv-orm/src/checkOptRemoved.mjs']], '出貨碼之內部檔匯入僅一處例外')
        assert.ok(!found.some(([, spec]) => /getDiagBrief|getDiag\.mjs/.test(spec)), '不匯入 w-serv-orm 之診斷內部檔')
    })

})
