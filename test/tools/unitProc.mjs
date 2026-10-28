import path from 'path'
import { fileURLToPath } from 'url'
import cloneDeep from 'lodash-es/cloneDeep.js'
import merge from 'lodash-es/merge.js'
import isEqual from 'lodash-es/isEqual.js'
import getMapOrm from 'w-serv-orm/src/getMapOrm.mjs'
import getProc from 'w-serv-orm/src/getProc.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from '../../src/schema/index.mjs'
import procCore from '../../server/procCore.mjs'
import procProtect from '../../server/procProtect.mjs'


//unit 測試共用層: 以真實 procCore / procProtect 工廠搭配替身依賴建立受測物件, 不起 server、不碰資料庫


//resolve server/template (scenario B: 路徑落在套件自身資料夾, 用 fileURLToPath, 全域 §11.1)
let __dirname = path.dirname(fileURLToPath(import.meta.url))
let pathTemplate = path.join(__dirname, '..', '..', 'server', 'template')


//passwordPolicy fixture: 與 settings.json 之 passwordPolicy 結構/值一致, 作為 SUT 的策略配置
//「傳入」真實 procCore 工廠 (非本地複製驗證邏輯). procCore.checkUserPassword 完全依此 opt 跑.
let passwordPolicy = {
    minLength: 8,
    maxLength: 16,
    requireLetter: true,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: true,
    requireSpecial: true,
    noSpace: true,
    onlyAscii: true,
    forbiddenChars: ['\\'],
    noConsecutiveCharsFromAccount: true,
    consecutiveCharsMinMatch: 2,
    commonPasswordBlacklist: [
        '1234', '12345', '123456', '1234567', '12345678',
        '123456789', '1234567890', '12345678910',
        '111111', '000000', '666666', '888888', '7777777', '11111111',
        '123123', '123321', '654321', '987654321',
        'qwerty', 'qwerty123', 'qwerty1', 'qwertyuiop', 'qazwsx',
        '1q2w3e4r', '1q2w3e4r5t', '1q2w3e', '1qaz2wsx', 'zxcvbnm',
        'password', 'password1', 'passw0rd', 'admin', 'admin123',
        'welcome', 'letmein', 'login', 'master', 'monkey', 'dragon',
        'shadow', 'sunshine', 'superman', 'batman', 'football',
        'baseball', 'soccer', 'hockey', 'michael', 'jordan', 'jennifer',
        'hunter', 'ranger', 'harley', 'thomas', 'charlie', 'andrew',
        'daniel', 'ashley', 'bailey', 'mustang', 'access', 'secret',
        'ninja', 'jesus', 'hello', 'freedom', 'trustno1',
        '1qaz@WSX', 'P@ssw0rd', 'Pass@123', 'Aa123456', 'Aa@123456',
        'Admin@123', 'abc@123',
        'abc123', 'abcdef', 'abcd1234', 'abc',
        'iloveyou', 'fuckyou', 'f*ckyou', 'whatever', 'nothing',
        'google', 'computer', 'internet', 'samsung', 'apple', 'killer',
        'princess', 'lovely', 'tigger', 'starwars', 'pokemon',
        'minecraft', '123qwe', 'zaq1zaq1', 'photoshop', 'adobe123',
        '18atcskd2w', 'mynoob',
    ],
}


//mkOpt: procCore 工廠之 opt, over 覆寫個別欄位
let mkOpt = (over = {}) => ({
    srLog: { log: () => {} },
    srEmail: { send: async () => {} },
    salt: 'unit-test-salt',
    minExpired: 100,
    kpLang: { eng: { webName: 'Test', regVerifyEmTitle: 'Verify' } },
    pathTemplate,
    passwordPolicy,
    allowUserRegistration: true,
    siteUrl: 'http://localhost',
    verifyBaseUrl: 'http://localhost',
    ...over,
})


//withIntervals: 執行 fn 期間攔截 setInterval, 所建 timer 一律 unref 並於 fn 結束後清除(不吊住 mocha 行程, 不需 --exit),
//回傳 fn 之結果與攔得之 timer 回呼(依建立順序), 供測試直接呼叫回呼以取代等待 timer 觸發. 不更動 production code.
function withIntervals(fn) {
    let realSetInterval = globalThis.setInterval
    let timers = []
    let callbacks = []
    globalThis.setInterval = (cb, ...a) => {
        let t = realSetInterval(cb, ...a)
        if (t && typeof t.unref === 'function') {
            t.unref()
        }
        timers.push(t)
        callbacks.push(cb)
        return t
    }
    try {
        let r = fn()
        for (let t of timers) {
            clearInterval(t)
        }
        return { r, callbacks }
    }
    finally {
        globalThis.setInterval = realSetInterval
    }
}


//withFakeClock: 執行 fn 期間以可控時鐘取代 global Date(dayjs 的 ot() 與 Date.now 皆受控, 逾時窗口類邏輯不需實際等待),
//fn 收到 clock = { now(), set(ms), advance(ms) }; 結束後(含 fn 拋錯)還原 Date. mocha 於載入時已保存自身的 Date, 不受影響.
let fakeClockActive = false
async function withFakeClock(fn, start = Date.now()) {
    //不可巢狀或並行: 全域 Date 只有一份, 後進者結束時會把先進者之 FakeDate 當成「原本的 Date」還原而洩漏; 前一個 fn 逾時未落定時亦於此處明確失敗
    if (fakeClockActive) {
        throw new Error('withFakeClock: 已有進行中之假時鐘(不可巢狀、並行, 或前一個 fn 尚未落定)')
    }
    fakeClockActive = true
    let RealDate = globalThis.Date
    let t = start
    class FakeDate extends RealDate {
        constructor(...a) {
            if (a.length === 0) {
                super(t)
            }
            else {
                super(...a)
            }
        }

        static now() {
            return t
        }
    }
    globalThis.Date = FakeDate
    try {
        return await fn({
            now: () => t,
            set: (ms) => {
                t = ms
            },
            advance: (ms) => {
                t += ms
            },
        })
    }
    finally {
        globalThis.Date = RealDate
        fakeClockActive = false
    }
}


//mkServ: 以替身 woItems 組出真實 w-serv-orm WServOrm 實例(withTabLocks / guardWrite 皆為核心真實作, 每個 woItems 一個實例、一組鎖管理器, 同表之寫入者共用),
//供 procCore / procProtect 取表鎖(多人同時編輯之寫入契約, 規格 §7): 以 StubWOrm 令各表 ORM 即替身表, 不碰資料庫.
//procOrm 仍由各測試依需要自組(mkProcOrm, 可含故障注入); 同一 woItems 重複呼叫回同一實例
let servs = new WeakMap()
function mkServ(woItems) {
    let s = servs.get(woItems)
    if (s === undefined) {
        class StubWOrm {
            constructor(o) {
                let t = woItems[o.cl]
                if (t !== undefined) {
                    return t
                }
            }
        }
        s = WServOrm(ds, StubWOrm, 'stub', 'stub')
        servs.set(woItems, s)
    }
    return s
}


//procs: 記錄 buildProc 所組之 p 其對應的 procOrm 與表鎖, 供 buildProtect 沿用(procCore 與 procProtect 須共用同一組表鎖)
let procs = new WeakMap()


//buildProc: 取得真實 procCore 工廠回傳的 p.
//procCore 工廠先前裝有 cleanUsers / cleanIps 背景清理 timer, 會吊住 node process 不退;
//該兩 timer 已於 2026-07-06 依 ADR-013 (隱性解除) 移除. 攔截 setInterval 之防護保留, 若日後 procCore 再引入 timer, unit 測試仍可獨立退出.
//withTabLocks / guardWrite 未給時取 mkServ(woItems) 之真實作
function buildProc(woItems, procOrm, over = {}) {
    let serv = mkServ(woItems)
    let withTabLocks = over.withTabLocks || serv.withTabLocks
    let guardWrite = over.guardWrite || serv.guardWrite
    let p = withIntervals(() => procCore(woItems, procOrm, mkOpt({ withTabLocks, guardWrite, ...over }))).r
    procs.set(p, { procOrm, withTabLocks })
    return p
}


//buildProtect: 取得真實 procProtect 工廠回傳的 pp 與其 timer 回呼(依 procProtect 內建立順序), 回呼為 async 函數可直接 await
//procOrm / withTabLocks 未給時沿用 buildProc 為 p 所用者(同一組表鎖)
function buildProtect(woItems, p, opt = {}) {
    let used = procs.get(p) || {}
    let procOrm = opt.procOrm || used.procOrm || mkProcOrm(ds, woItems)
    let withTabLocks = opt.withTabLocks || used.withTabLocks || mkServ(woItems).withTabLocks
    let { r, callbacks } = withIntervals(() => procProtect(woItems, p, { procOrm, withTabLocks, ...opt }))
    return { pp: r, timers: callbacks }
}


//mkSrLog: 記錄各層級呼叫之 srLog 替身, logs[level] 為各次呼叫之物件
function mkSrLog() {
    let logs = { info: [], warn: [], debug: [], error: [] }
    let srLog = {
        logs,
        log: () => {},
    }
    for (let level of Object.keys(logs)) {
        srLog[level] = (o) => {
            logs[level].push(o)
        }
    }
    return srLog
}


//mkTable: 記憶體資料表, 語意對齊 w-orm-lmdb(1.0.38 WOrmLmdb.mjs 之 insert / save / del; 1.0.37 → 1.0.38 未改下列語意, 只另加操作中被 close 之整批 reject 與 del 讀取錯誤之逐筆失敗, 替身不模擬):
//save、del 回傳與輸入等長保序之逐筆陣列, 單筆失敗時整批仍 resolve, 該筆 ok 為 0 並附 err; insert 回傳聚合物件, 錯誤皆屬整批性而 reject.
//insert 遇既存主鍵略過(ifNoExists, 以 nInserted 計實際新增筆數, 不 reject); save 以 lodash merge 合併舊列(陣列逐索引合併, 較短之新陣列殘留舊尾端, ADR-069),
//合併後與舊列相同者不寫入(nModified 0). 主鍵 UTF-8 位元組數超過 LMDB 鍵長上限(lmdb/open.js DEFAULT_MAX_KEY_SIZE 1978)者: insert 整批 reject, save 該筆 ok 為 0
//(真 LMDB 之 insert 於拋錯前已送出之列可能已寫入, 替身簡化為不寫入).
//故障注入: fail.save / fail.del 放入主鍵即令該筆逐筆失敗; fail.batch 放入函數名(select、insert、save、del)即令該次呼叫整批 reject.
//calls 記錄各函數之呼叫次數(供觀察快取是否重抓、驗證階段之拒絕未觸發任何寫入); log 記錄各次寫入呼叫之輸入(供核對寫入內容與順序).
let MAX_KEY_BYTES = 1978
function mkTable(rows = []) {
    let kp = new Map()
    for (let r of rows) {
        kp.set(r.id, cloneDeep(r))
    }
    let fail = { save: new Set(), del: new Set(), batch: new Set() }
    let calls = { select: 0, insert: 0, save: 0, del: 0 }
    let log = { insert: [], save: [], del: [] }
    let toArr = (data) => (Array.isArray(data) ? data : [data])
    //isMatch: 欄位相等, 或 { $in: [...] }(w-serv-orm 1.1.16 起 mustExist 之存在檢查以 select({ id: { $in: [...] } }) 查詢)
    let isMatch = (r, find) => Object.keys(find || {}).every((k) => {
        let f = find[k]
        if (f !== null && typeof f === 'object' && Array.isArray(f.$in)) {
            return f.$in.includes(r[k])
        }
        return r[k] === f
    })
    let rejectBatch = (mode) => Promise.reject(new Error(`injected ${mode} batch fail`))
    let isKeyTooLarge = (id) => typeof id === 'string' && Buffer.byteLength(id, 'utf8') > MAX_KEY_BYTES
    let errKeySize = `Key size is larger than the maximum key size (${MAX_KEY_BYTES})`
    return {
        kp,
        fail,
        calls,
        log,
        get: (id) => cloneDeep(kp.get(id)),
        select: async (find) => {
            calls.select++
            if (fail.batch.has('select')) {
                return rejectBatch('select')
            }
            return [...kp.values()].filter((r) => isMatch(r, find)).map((r) => cloneDeep(r))
        },
        insert: async (data) => {
            calls.insert++
            log.insert.push(cloneDeep(data))
            if (fail.batch.has('insert')) {
                return rejectBatch('insert')
            }
            let arr = toArr(data)
            if (arr.some((v) => isKeyTooLarge(v.id))) {
                return Promise.reject(new Error(errKeySize))
            }
            let nInserted = 0
            for (let v of arr) {
                if (!kp.has(v.id)) {
                    kp.set(v.id, cloneDeep(v))
                    nInserted++
                }
            }
            return { n: arr.length, nInserted, ok: 1 }
        },
        //save(data, opt): opt.autoInsert 為 false(procOrm mustExist 轉傳, 只改不增)時, 列不存在則不新增, 回 n 為 0(對齊 w-orm 系列: 未命中回 { n: 0, ok: 1 })
        save: async (data, opt) => {
            calls.save++
            log.save.push(cloneDeep(data))
            if (fail.batch.has('save')) {
                return rejectBatch('save')
            }
            let autoInsert = !(opt && opt.autoInsert === false)
            return toArr(data).map((v) => {
                if (fail.save.has(v.id)) {
                    return { n: 1, nInserted: 0, nModified: 0, ok: 0, err: `injected save fail id[${v.id}]` }
                }
                if (isKeyTooLarge(v.id)) {
                    return { n: 1, nInserted: 0, nModified: 0, ok: 0, err: errKeySize }
                }
                let old = kp.get(v.id)
                if (old) {
                    let vm = merge({}, old, cloneDeep(v))
                    if (isEqual(vm, old)) {
                        return { n: 1, nInserted: 0, nModified: 0, ok: 1 }
                    }
                    kp.set(v.id, vm)
                    return { n: 1, nInserted: 0, nModified: 1, ok: 1 }
                }
                if (!autoInsert) {
                    return { n: 0, nInserted: 0, nModified: 0, ok: 1 }
                }
                kp.set(v.id, cloneDeep(v))
                return { n: 1, nInserted: 1, nModified: 0, ok: 1 }
            })
        },
        del: async (data) => {
            calls.del++
            log.del.push(cloneDeep(data))
            if (fail.batch.has('del')) {
                return rejectBatch('del')
            }
            return toArr(data).map((v) => {
                if (fail.del.has(v.id)) {
                    return { n: 1, nDeleted: 0, ok: 0, err: `injected del fail id[${v.id}]` }
                }
                if (kp.delete(v.id)) {
                    return { n: 1, nDeleted: 1, ok: 1 }
                }
                return { n: 0, nDeleted: 0, ok: 1 }
            })
        },
    }
}


//mkProcOrm: 以替身 woItems 組出真實 w-serv-orm 之 procOrm, 組法同其 WServOrm(getMapOrm → getProc), 與 SSO 正式之 WServOrm 同樣不傳已移除之設定(1.1.9 起無設定鍵, R-ORM-02);
//SSO 正式另傳診斷輸出之 funLog(R-ORM-04), 不影響 procOrm 語意, 本函數不傳(診斷輸出走 w-serv-orm 預設之 console), funLog 之行為由 unit-ormDiagLog 以真實 WServOrm 驗證.
//w-serv-orm 1.1.8 起 getMapOrm 與 getProc 皆為各實例狀態, 同一行程內多次組出互不干擾(他檔載入 g_mOrm 之正式實例亦不受影響).
function mkProcOrm(ds, woItems) {
    return getProc(getMapOrm(ds, woItems)).procOrm
}


export {
    passwordPolicy,
    mkOpt,
    withIntervals,
    withFakeClock,
    buildProc,
    buildProtect,
    mkServ,
    mkSrLog,
    mkTable,
    mkProcOrm
}
