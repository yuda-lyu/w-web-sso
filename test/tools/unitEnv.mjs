import ot from 'dayjs'
import cloneDeep from 'lodash-es/cloneDeep.js'
import ds from '../../src/schema/index.mjs'
import hashPassword from '../../server/hashPassword.mjs'
import { mkOpt, buildProc, buildProtect, mkServ, mkSrLog, mkTable, mkProcOrm } from './unitProc.mjs'


//unit 測試共用環境(多人同時編輯之寫入契約相關測試用): 真實 procCore / procProtect + 真實 w-serv-orm 表鎖(mkServ) + 替身資料表(mkTable),
//不起 server、不碰資料庫. 固定種子:
//  users:  u-admin(系統管理者, order 1)、u-a(order 2)、u-b(order 3)、u-v(未驗證, tokenVerify 'tv-1', order 4); 密碼皆為 PW_INIT
//  tokens: t-admin / t-a1 / t-b1 為 session 列(isApp 'n', 對應 tk-admin / tk-a1 / tk-b1), t-app1 / t-app2 為應用系統金鑰列(isApp 'y')
//  ips:    ip-1 / ip-2


let SALT = mkOpt().salt
let PW_INIT = 'Init@1234'
let HASH_INIT = hashPassword(PW_INIT, SALT)


//tFuture: token 到期時間(1 小時後)
let tFuture = () => ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')


//sleep
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//mkUser: 依 schema funNew 產生完整欄位之使用者列, 再以固定主鍵與 ext 覆寫
let mkUser = (id, account, order, ext = {}) => {
    let u = ds.users.funNew({
        account,
        name: account,
        email: `${account}@example.com`,
        password: HASH_INIT,
        isAdmin: 'n',
        timeVerified: '2026-01-01T00:00:00.000+08:00',
    })
    return { ...u, id, order, ...ext }
}


//mkToken: ext 可覆寫(如 isApp: 'y')
let mkToken = (id, token, userId, ext = {}) => {
    return { ...ds.tokens.funNew({ userId }), id, token, isApp: 'n', timeEnd: tFuture(), ...ext }
}


//mkIp
let mkIp = (id, ip, ext = {}) => {
    return { ...ds.ips.funNew({ ip }), id, timeBlocked: '', ...ext }
}


//mkEnvSso: 每案例獨立之資料表、procOrm、表鎖與 procCore; over 覆寫 procCore 之 opt.
//over.trackLocks 為 true 時記錄「寫入發生時該表之表鎖是否被站點自己持有」: 回傳 env.outsideWrites(未持該表表鎖而寫入之 '表.方法' 清單; 測試自己的 holdLocks 不計入),
//供斷言「站點之全部寫入皆在表鎖內」(unit-tablock SITE-LOCK-W01); 抓得到「先空取鎖再釋放、於鎖外做事」這類只驗得出『曾經等待』的測試抓不到的錯誤
function mkEnvSso(over = {}) {
    let { trackLocks = false, ...rest } = over
    let users = mkTable([
        mkUser('u-admin', 'admin1', 1, { isAdmin: 'y' }),
        mkUser('u-a', 'auser', 2),
        mkUser('u-b', 'buser', 3),
        mkUser('u-v', 'vuser', 4, { tokenVerify: 'tv-1', timeVerified: '' }),
    ])
    let tokens = mkTable([
        mkToken('t-admin', 'tk-admin', 'u-admin'),
        mkToken('t-a1', 'tk-a1', 'u-a'),
        mkToken('t-b1', 'tk-b1', 'u-b'),
        mkToken('t-app1', 'tk-app1', 'id-app-1', { isApp: 'y', perms: ['readTokens'] }),
        mkToken('t-app2', 'tk-app2', 'id-app-2', { isApp: 'y', perms: [] }),
    ])
    let ips = mkTable([
        mkIp('ip-1', '10.0.0.1'),
        mkIp('ip-2', '10.0.0.2'),
    ])
    let woItems = { users, tokens, ips }

    //trackLocks: 站點自己持有之表鎖計數(由包裝後之 withTabLocks / guardWrite 增減)與寫入方法之包裝
    let held = { users: 0, tokens: 0, ips: 0 }
    let outsideWrites = []
    let serv = mkServ(woItems)
    let withTabLocks = serv.withTabLocks
    let guardWrite = serv.guardWrite
    if (trackLocks) {
        for (let name of ['users', 'tokens', 'ips']) {
            let t = woItems[name]
            for (let m of ['insert', 'save', 'del']) {
                let orig = t[m]
                t[m] = async (...a) => {
                    if (held[name] <= 0) {
                        outsideWrites.push(`${name}.${m}`)
                    }
                    return orig.apply(t, a)
                }
            }
        }
        let inc = (tables, d) => {
            for (let n of tables) {
                held[n] += d
            }
        }
        withTabLocks = (tables, fn) => serv.withTabLocks(tables, async () => {
            inc(tables, 1)
            try {
                return await fn()
            }
            finally {
                inc(tables, -1)
            }
        })
        guardWrite = (args) => serv.guardWrite({
            ...args,
            write: async (...w) => {
                inc(args.tables, 1)
                try {
                    return await args.write(...w)
                }
                finally {
                    inc(args.tables, -1)
                }
            },
        })
    }

    let procOrm = mkProcOrm(ds, woItems)
    let srLog = mkSrLog()
    let mails = []
    let srEmail = {
        send: async (sender, title, content, email) => {
            mails.push({ sender, title, content, email })
        },
    }
    let kpLang = {
        eng: {
            webName: 'Test',
            regVerifyEmTitle: 'Verify',
            regVerifyEmContent: '{verifyUrl}',
            chpwEmTitle: 'Changed',
            chpwEmContent: '{name}',
            resetPwEmTitle: 'Reset',
            resetPwEmContent: '{newPassword}',
        },
    }
    let p = buildProc(woItems, procOrm, { srLog, srEmail, kpLang, withTabLocks, guardWrite, ...rest })
    return { users, tokens, ips, woItems, procOrm, srLog, mails, p, serv, outsideWrites }
}


//mkProtect: 該環境之 procProtect(門檻小以便快速觸發)
function mkProtect(env, over = {}) {
    return buildProtect(env.woItems, env.p, {
        srLog: env.srLog,
        minForAccountLoginFailed: 10,
        numForAccountLoginFailed: 1,
        minBlockForAccountLoginFailed: 10,
        minForTokenCallApi: 10,
        numForTokenCallApi: 1,
        minBlockForTokenCallApi: 10,
        minForIpCallApi: 10,
        numForIpCallApi: 1,
        minBlockForIpCallApi: 10,
        ...over,
    })
}


//errOf: 取 promise 之 reject 值, resolve 時回 null
let errOf = async (pm) => {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    return null
}


//snapTables: 三表全部列之快照(依主鍵排序), 供斷言「資料庫無任何變更」
let snapTables = (env) => {
    let snap = (t) => [...t.kp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => cloneDeep(r))
    return { users: snap(env.users), tokens: snap(env.tokens), ips: snap(env.ips) }
}


//writesOf: 資料表之寫入呼叫次數(insert + save + del)
let writesOf = (t) => t.calls.insert + t.calls.save + t.calls.del


//writesAll: 三表寫入呼叫總次數
let writesAll = (env) => writesOf(env.users) + writesOf(env.tokens) + writesOf(env.ips)


//holdLocks: 由測試持有指定表之表鎖(與 procCore / procProtect 同一組鎖管理器), 直到呼叫 release(); 回傳 { release, done }, 取得鎖後才 resolve
async function holdLocks(env, tables) {
    let release = null
    let entered = null
    let pmEntered = new Promise((resolve) => {
        entered = resolve
    })
    let done = env.serv.withTabLocks(tables, async () => {
        entered()
        await new Promise((resolve) => {
            release = resolve
        })
    })
    await pmEntered
    return { release: () => release(), done }
}


//track: 追蹤 promise 是否已落定, 回傳 { pm, state } (state.done / state.value / state.err)
function track(pm) {
    let state = { done: false, ok: false, value: undefined, err: undefined }
    let wrapped = pm.then((v) => {
        state.done = true
        state.ok = true
        state.value = v
    }, (e) => {
        state.done = true
        state.err = e
    })
    return { pm: wrapped, state }
}


//afterSelectDelete: 令資料表第 nth 次(預設第 1 次)回傳含指定主鍵之列的 select 之後, 立即刪除該列, 模擬「讀取之後、寫入之前被不經表鎖之寫入者刪除」(深度防禦: 只改不增須擋殘缺列復活)
function afterSelectDelete(table, id, nth = 1) {
    let orig = table.select
    let n = 0
    table.select = async (...a) => {
        let r = await orig.apply(table, a)
        if (n < nth && r.some((x) => x.id === id)) {
            n++
            if (n === nth) {
                table.kp.delete(id)
            }
        }
        return r
    }
    return () => {
        table.select = orig
    }
}


export {
    SALT,
    PW_INIT,
    HASH_INIT,
    tFuture,
    sleep,
    mkUser,
    mkToken,
    mkIp,
    mkEnvSso,
    mkProtect,
    errOf,
    snapTables,
    writesOf,
    writesAll,
    holdLocks,
    track,
    afterSelectDelete
}
