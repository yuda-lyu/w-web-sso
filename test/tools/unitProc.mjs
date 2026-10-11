import path from 'path'
import { fileURLToPath } from 'url'
import cloneDeep from 'lodash-es/cloneDeep.js'
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


//buildProc: 取得真實 procCore 工廠回傳的 p.
//procCore 工廠先前裝有 cleanUsers / cleanIps 背景清理 timer, 會吊住 node process 不退;
//該兩 timer 已於 2026-07-06 依 ADR-013 (隱性解除) 移除. 攔截 setInterval 之防護保留, 若日後 procCore 再引入 timer, unit 測試仍可獨立退出.
function buildProc(woItems, procOrm, over = {}) {
    return withIntervals(() => procCore(woItems, procOrm, mkOpt(over))).r
}


//buildProtect: 取得真實 procProtect 工廠回傳的 pp 與其 timer 回呼(依 procProtect 內建立順序), 回呼為 async 函數可直接 await
function buildProtect(woItems, p, opt = {}) {
    let { r, callbacks } = withIntervals(() => procProtect(woItems, p, opt))
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


//mkTable: 記憶體資料表, 回傳形式依 w-orm 系列規格(w-orm-lmdb 1.0.37 WOrmLmdb.mjs 之 save/del/insert JSDoc):
//save、del 回傳與輸入等長保序之逐筆陣列, 單筆失敗時整批仍 resolve, 該筆 ok 為 0 並附 err; insert 回傳聚合物件, 錯誤皆屬整批性而 reject.
//故障注入: fail.save / fail.del 放入主鍵即令該筆逐筆失敗; fail.batch 放入函數名(select、insert、save、del)即令該次呼叫整批 reject.
//calls 記錄各函數之呼叫次數, 供觀察快取是否重抓.
function mkTable(rows = []) {
    let kp = new Map()
    for (let r of rows) {
        kp.set(r.id, cloneDeep(r))
    }
    let fail = { save: new Set(), del: new Set(), batch: new Set() }
    let calls = { select: 0, insert: 0, save: 0, del: 0 }
    let toArr = (data) => (Array.isArray(data) ? data : [data])
    let isMatch = (r, find) => Object.keys(find || {}).every((k) => r[k] === find[k])
    let rejectBatch = (mode) => Promise.reject(new Error(`injected ${mode} batch fail`))
    return {
        kp,
        fail,
        calls,
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
            if (fail.batch.has('insert')) {
                return rejectBatch('insert')
            }
            let arr = toArr(data)
            for (let v of arr) {
                if (kp.has(v.id)) {
                    return Promise.reject(new Error(`id[${v.id}] already exists`))
                }
            }
            for (let v of arr) {
                kp.set(v.id, cloneDeep(v))
            }
            return { n: arr.length, nInserted: arr.length, ok: 1 }
        },
        save: async (data) => {
            calls.save++
            if (fail.batch.has('save')) {
                return rejectBatch('save')
            }
            return toArr(data).map((v) => {
                if (fail.save.has(v.id)) {
                    return { n: 1, nInserted: 0, nModified: 0, ok: 0, err: `injected save fail id[${v.id}]` }
                }
                let old = kp.get(v.id)
                if (old) {
                    kp.set(v.id, { ...old, ...cloneDeep(v) })
                    return { n: 1, nInserted: 0, nModified: 1, ok: 1 }
                }
                kp.set(v.id, cloneDeep(v))
                return { n: 1, nInserted: 1, nModified: 0, ok: 1 }
            })
        },
        del: async (data) => {
            calls.del++
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


//loadMapOrm: 以帶查詢字串之 URL 另載一份 w-serv-orm getMapOrm 模組實例, 回傳以替身 woItems 綁定之 mapOrm(即 procOrm 之核心).
//getMapOrm 以模組層變數保存 ds 與 woItems(單例); 本 repo 之 npm test 為單一 mocha 行程(--no-parallel), 他檔載入 g_mOrm 時已以真實資料庫設定該單例,
//另載一份可令替身不覆寫之. SSO 未註冊 addFunCheck / addFunPreProcessing / addFunPostProcessing 且 useCheckUser 為 false(g_mOrm.mjs),
//故 getProc 包裝之 procOrm 與 mapOrm 行為相同.
async function loadMapOrm(ds, woItems, tag = 'unit') {
    let url = import.meta.resolve('w-serv-orm/src/getMapOrm.mjs')
    let m = await import(`${url}?${tag}`)
    return m.default(ds, woItems)
}


export {
    passwordPolicy,
    mkOpt,
    withIntervals,
    buildProc,
    buildProtect,
    mkSrLog,
    mkTable,
    loadMapOrm
}
