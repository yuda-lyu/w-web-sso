//unit-countKeys.test.mjs — 計數容器之鍵清理: 週期剪枝後窗內無紀錄之鍵須刪除 (R-CNT-01, ADR-089)
//
// 依據: CLAUDE_rulebook.md R-CNT-01; spec/設計要點與取捨.md ADR-089
//   - kpTokenCallApi / kpIpCallApi / kpAccountLoginFailed 之鍵為權杖 / 來源 IP / 帳號(使用端可植入互異字串);
//     剪枝計時器對每個鍵: 窗內無紀錄 → 刪鍵(不留空陣列), 有 → 只留窗內紀錄. 修改前 tokenCallApi / ipCallApi 只換陣列、不刪鍵
//   - 剪枝單一擁有者 pruneKpKey, 以 identity 守門: 計時器逐鍵 await 封鎖寫入之間 cleanKp* 換掉容器時, 不得以舊陣列覆蓋 / 刪除新紀錄,
//     且不得以舊快照之紀錄作為封鎖依據(pruneKpKey 回 null, 呼叫端略過該鍵)
//   - 偵測新 IP(ipDetectNew)於讀完 ips 清單後才取容器之鍵: 讀取等待期間已被剪枝刪除之鍵不再登錄, 同期新出現之鍵一併登錄
// 計時器回呼由 unitProc.buildProtect 攔得(依 procProtect 內建立順序: 0 accountLoginFailedPrune、1 tokenCallApi、2 ipDetectNew、3 ipCallApi),
// 窗口以 withFakeClock 的可控時鐘推進, 不實際等待. 鍵數由 pp.getKpKeyCounts() 觀察(三容器目前之鍵數; 診斷用).
//   CNT-001 權杖  CNT-002 IP  CNT-003 窗內仍有紀錄者保留(同鍵新舊混合只留新)  CNT-004 窗內全有者不動
//   CNT-005 原型鍵名與特殊鍵名可刪  CNT-006 大量互異鍵過期後全數退場  CNT-007 identity 守門(不覆蓋新紀錄)
//   CNT-008 帳號容器(鍵退場、成功登入即刪鍵、行為不變)  CNT-009 容器被換掉後不以舊快照封鎖  CNT-010 窗口起點邊界(恰在窗起點者保留)
//   CNT-011 偵測新 IP 於讀取等待期間之鍵變動
//   SITE-CNT-001 剪枝站點守門

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildProtect, mkSrLog, withFakeClock } from './tools/unitProc.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))


let MIN = 60 * 1000


//opt: 窗口 1 分鐘; 門檻取大值使多數案不觸發封鎖
let optBase = {
    minForAccountLoginFailed: 1,
    numForAccountLoginFailed: 100000,
    minBlockForAccountLoginFailed: 30,
    minForTokenCallApi: 1,
    numForTokenCallApi: 100000,
    minBlockForTokenCallApi: 30,
    minForIpCallApi: 1,
    numForIpCallApi: 100000,
    minBlockForIpCallApi: 30,
}


//mkEnv: 真實 procProtect 工廠 + 替身依賴
function mkEnv(over = {}, extra = {}) {
    let inserted = []
    let saves = []
    let woItems = {
        ips: {
            insert: async (d) => {
                inserted.push(...(Array.isArray(d) ? d : [d]))
                return { n: 1, nInserted: 1, ok: 1 }
            },
            save: async (d) => {
                saves.push(d)
                return [{ ok: 1, n: 1, nModified: 1 }]
            },
        },
        users: {
            save: async (d) => {
                saves.push(d)
                return [{ ok: 1, n: 1, nModified: 1 }]
            },
        },
    }
    let p = {
        getIpsList: async () => [],
        getIpByKV: async () => Promise.reject('can not find the ip by keyIp[ip]'),
        getTokenByKV: async () => ({ isApp: 'y' }), //應用系統權杖: 超限時明確跳過, 不寫入
        getGenUserByAccount: async (a) => ({ id: `u-${a}`, account: a, timeBlocked: '' }),
        loginByAccountAndPassword: async () => Promise.reject('wrongPassword'),
        revokeTokensByUserId: async () => {},
        ...extra,
    }
    let srLog = mkSrLog()
    let { pp, timers } = buildProtect(woItems, p, { srLog, ...optBase, ...over })
    return { pp, timers, srLog, inserted, saves }
}


//counts: 三容器目前之鍵數
let counts = (env) => env.pp.getKpKeyCounts()


//gate: 由測試控制放行時機之閘門; entered 在被測程式到達閘門時落定
function gate() {
    let release = null
    let entered = null
    let pm = new Promise((resolve) => {
        release = resolve
    })
    let pmEntered = new Promise((resolve) => {
        entered = resolve
    })
    return { pm, pmEntered, release, entered }
}


//until: 等閘門到達, 設上限避免被測程式未到達時永久懸置(withFakeClock 之 finally 才得以還原 Date)
async function until(pm, label, ms = 5000) {
    let t = null
    let pmTimeout = new Promise((resolve, reject) => {
        t = setTimeout(() => reject(new Error(`逾時未到達: ${label}`)), ms)
    })
    try {
        await Promise.race([pm, pmTimeout])
    }
    finally {
        clearTimeout(t)
    }
}


describe('計數容器之鍵清理 (R-CNT-01, ADR-089)', function() {

    it('CNT-001 權杖容器: 窗口過後無紀錄之鍵被刪除(修改前只剪紀錄、鍵殘留為空陣列)', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            await env.pp.callApiByToken('t-a')
            await env.pp.callApiByToken('t-a')
            await env.pp.callApiByToken('t-b')
            assert.strictEqual((await counts(env)).tokenCallApi, 2)
            clock.advance(MIN + 1000)
            await env.timers[1]() //tokenCallApi
            //spec(R-CNT-01 規則 1): 窗內無紀錄 → 刪鍵
            assert.strictEqual((await counts(env)).tokenCallApi, 0)
            assert.strictEqual(await env.pp.getCountsByTokenCallApi('t-a'), 0)
        })
    })

    it('CNT-002 IP 容器: 窗口過後無紀錄之鍵被刪除(修改前只剪紀錄、鍵殘留為空陣列)', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            await env.pp.callApiByIp('203.0.113.1')
            await env.pp.callApiByIp('203.0.113.1')
            await env.pp.callApiByIp('203.0.113.2')
            assert.strictEqual((await counts(env)).ipCallApi, 2)
            clock.advance(MIN + 1000)
            await env.timers[3]() //ipCallApi
            assert.strictEqual((await counts(env)).ipCallApi, 0)
            assert.strictEqual(await env.pp.getCountsByIpCallApi('203.0.113.1'), 0)
        })
    })

    it('CNT-003 窗內仍有紀錄者保留: 同鍵新舊混合只留窗內紀錄, 全舊之鍵退場', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            await env.pp.callApiByIp('x')
            await env.pp.callApiByIp('y')
            await env.pp.callApiByToken('x')
            await env.pp.callApiByToken('y')
            clock.advance(40 * 1000)
            await env.pp.callApiByIp('x')
            await env.pp.callApiByToken('x')
            clock.advance(30 * 1000) //x 之第 1 筆已 70 秒(窗外), 第 2 筆 30 秒(窗內); y 僅 70 秒
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 1, ipCallApi: 1 })
            assert.strictEqual(await env.pp.getCountsByIpCallApi('x'), 1)
            assert.strictEqual(await env.pp.getCountsByIpCallApi('y'), 0)
            assert.strictEqual(await env.pp.getCountsByTokenCallApi('x'), 1)
            assert.strictEqual(await env.pp.getCountsByTokenCallApi('y'), 0)
        })
    })

    it('CNT-004 窗內全有者不動: 鍵保留、筆數不變', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            await env.pp.callApiByIp('203.0.113.7')
            await env.pp.callApiByIp('203.0.113.7')
            await env.pp.callApiByToken('t-live')
            clock.advance(20 * 1000)
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 1, ipCallApi: 1 })
            assert.strictEqual(await env.pp.getCountsByIpCallApi('203.0.113.7'), 2)
            assert.strictEqual(await env.pp.getCountsByTokenCallApi('t-live'), 1)
        })
    })

    it('CNT-005 原型鍵名與特殊鍵名(constructor、__proto__、length、count、含 . 者)之鍵同樣可退場', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            let ks = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'length', 'count', 'a.b', '[0]']
            for (let k of ks) {
                await env.pp.callApiByIp(k)
                await env.pp.callApiByToken(k)
            }
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: ks.length, ipCallApi: ks.length })
            clock.advance(MIN + 1000)
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 0, ipCallApi: 0 })
        })
    })

    it('CNT-006 大量互異鍵(權杖參數 / 標頭值每次不同)過期後全數退場, 不累積', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            let n = 300
            for (let i = 0; i < n; i++) {
                await env.pp.callApiByToken(`tok-${i}`)
                await env.pp.callApiByIp(`198.51.100.${i % 250}-${i}`)
            }
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: n, ipCallApi: n })
            clock.advance(MIN + 1000)
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 0, ipCallApi: 0 })
        })
    })

    it('CNT-007 identity 守門: 計時器等待封鎖寫入期間容器被 cleanKpIpCallApi 換掉, 不以舊陣列覆蓋新紀錄', async function() {
        await withFakeClock(async (clock) => {
            let g = gate()
            //A 超限(門檻 1)→ blockIpByIp 於 getIpByKV 停住; 之後計時器才輪到 B
            let env = mkEnv({ numForIpCallApi: 1 }, {
                getIpByKV: async () => {
                    g.entered()
                    await g.pm
                    return Promise.reject('can not find the ip by keyIp[ip]')
                },
            })
            await env.pp.callApiByIp('A') //鍵順序: A 在前、B 在後
            await env.pp.callApiByIp('B')
            clock.advance(70 * 1000) //兩者的第 1 筆皆已在窗外
            await env.pp.callApiByIp('A')
            await env.pp.callApiByIp('A') //A 窗內 2 筆 > 1 → 封鎖
            let run = env.timers[3]()
            await until(g.pmEntered, '計時器停在 A 的封鎖寫入')
            await env.pp.cleanKpIpCallApi() //換掉整個容器
            await env.pp.callApiByIp('B') //新容器內 B 之新紀錄
            g.release()
            await run
            //spec(R-CNT-01 規則 2): 計時器輪到 B 時, 手上是舊容器之舊陣列(已全在窗外); 容器已換, 不得覆蓋 / 刪除新紀錄
            assert.strictEqual(await env.pp.getCountsByIpCallApi('B'), 1)
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 0, ipCallApi: 1 })
            //封鎖照常執行(A 超限 → 無此 IP 列 → 插入封鎖列)
            assert.strictEqual(env.inserted.filter((o) => o.ip === 'A').length, 1)
        })
    })

    it('CNT-008 帳號容器: 窗口過後鍵退場; 成功登入即刪鍵; 窗內累計超過門檻即封鎖, 窗外之失敗不計', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv({ numForAccountLoginFailed: 2 })
            //acc-1: 窗內 3 次失敗 > 2 → 封鎖
            for (let i = 0; i < 3; i++) {
                await env.pp.loginByAccountAndPassword('acc-1', 'x').catch(() => {})
            }
            assert.strictEqual(env.saves.filter((s) => s.id === 'u-acc-1').length, 1)
            //acc-2: 2 次失敗, 窗口過後剪枝, 再 1 次失敗 → 窗內僅 1 次, 不封鎖
            await env.pp.loginByAccountAndPassword('acc-2', 'x').catch(() => {})
            await env.pp.loginByAccountAndPassword('acc-2', 'x').catch(() => {})
            assert.strictEqual((await counts(env)).accountLoginFailed, 2)
            clock.advance(MIN + 1000)
            await env.timers[0]() //accountLoginFailedPrune
            //spec(R-CNT-01 規則 1): 兩帳號之紀錄皆在窗外 → 鍵退場(修改後帳號計時器若停擺, 此處為 2)
            assert.strictEqual((await counts(env)).accountLoginFailed, 0)
            await env.pp.loginByAccountAndPassword('acc-2', 'x').catch(() => {})
            assert.strictEqual(env.saves.filter((s) => s.id === 'u-acc-2').length, 0)
            //未過窗口之同帳號再失敗 2 次 → 窗內 3 次 > 2 → 封鎖
            await env.pp.loginByAccountAndPassword('acc-2', 'x').catch(() => {})
            await env.pp.loginByAccountAndPassword('acc-2', 'x').catch(() => {})
            assert.strictEqual(env.saves.filter((s) => s.id === 'u-acc-2').length, 1)
        })
        //成功登入: 該帳號之失敗紀錄即刪鍵(原置為空陣列而留鍵至下一輪剪枝)
        let env2 = mkEnv({}, { loginByAccountAndPassword: async (a, pw) => (pw === 'ok' ? { id: 'u' } : Promise.reject('wrongPassword')) })
        await env2.pp.loginByAccountAndPassword('acc-3', 'x').catch(() => {})
        assert.strictEqual((await counts(env2)).accountLoginFailed, 1)
        await env2.pp.loginByAccountAndPassword('acc-3', 'ok')
        assert.strictEqual((await counts(env2)).accountLoginFailed, 0)
    })

    it('CNT-009 容器被換掉後, 計時器不以舊快照之紀錄封鎖(清理即取消尚未開始處理之鍵的封鎖判定)', async function() {
        await withFakeClock(async () => {
            let g = gate()
            //A、B 皆於窗內各 2 筆 > 門檻 1; 計時器先處理 A 並停在其封鎖寫入
            let env = mkEnv({ numForIpCallApi: 1 }, {
                getIpByKV: async (k, ip) => {
                    if (ip === 'A') {
                        g.entered()
                        await g.pm
                    }
                    return Promise.reject('can not find the ip by keyIp[ip]')
                },
            })
            for (let ip of ['A', 'A', 'B', 'B']) {
                await env.pp.callApiByIp(ip)
            }
            let run = env.timers[3]()
            await until(g.pmEntered, '計時器停在 A 的封鎖寫入')
            await env.pp.cleanKpIpCallApi() //管理端清空計數
            await env.pp.callApiByIp('B') //清理後 B 僅 1 筆 <= 門檻
            g.release()
            await run
            //spec(R-CNT-01 規則 2): B 之舊快照(2 筆)已非現行計數, 不得據以封鎖; 新紀錄保留(修改前 B 被封鎖)
            assert.deepStrictEqual(env.inserted.map((o) => o.ip), ['A'])
            assert.strictEqual(await env.pp.getCountsByIpCallApi('B'), 1)
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 0, ipCallApi: 1 })
        })
    })

    it('CNT-010 窗口起點邊界: 恰在窗起點之紀錄保留, 早 1 ms 者剔除(三容器)', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnv()
            await env.pp.callApiByToken('t')
            await env.pp.callApiByIp('i')
            await env.pp.loginByAccountAndPassword('acc', 'x').catch(() => {})
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 1, tokenCallApi: 1, ipCallApi: 1 })
            clock.advance(MIN) //timeStart 恰等於紀錄時刻
            await env.timers[0]()
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 1, tokenCallApi: 1, ipCallApi: 1 })
            clock.advance(1) //紀錄早於窗起點 1 ms
            await env.timers[0]()
            await env.timers[1]()
            await env.timers[3]()
            assert.deepStrictEqual(await counts(env), { accountLoginFailed: 0, tokenCallApi: 0, ipCallApi: 0 })
        })
    })

    it('CNT-011 偵測新 IP 於讀取 ips 清單等待期間: 已被剪枝刪鍵者不登錄, 同期新出現者一併登錄', async function() {
        await withFakeClock(async (clock) => {
            let g = gate()
            let env = mkEnv({}, {
                getIpsList: async () => {
                    g.entered()
                    await g.pm
                    return []
                },
            })
            await env.pp.callApiByIp('X') //將於等待期間過期被剪枝
            let run = env.timers[2]() //ipDetectNew: 停在讀取 ips 清單
            await until(g.pmEntered, '偵測計時器停在 getIpsList')
            clock.advance(MIN + 1000)
            await env.timers[3]() //剪枝: X 已過窗 → 刪鍵
            await env.pp.callApiByIp('Y') //等待期間新出現之 IP
            g.release()
            await run
            //spec(R-CNT-01 規則 4): 鍵於讀完清單後才取——X 已退場不復活(修改前於讀取前取鍵, X 仍被登錄), Y 同輪登錄
            assert.deepStrictEqual(env.inserted.map((o) => o.ip), ['Y'])
        })
    })

})


//站點守門(R-CNT-01): 剪枝只有 pruneKpKey 一處賦值 / 刪鍵
describe('計數容器剪枝之站點守門 (R-CNT-01)', function() {

    it('SITE-CNT-001 tokenCallApi / ipCallApi 不再直接 kp[key] = recs; 三個剪枝計時器皆呼叫 pruneKpKey', function() {
        let src = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'procProtect.mjs'), 'utf8').replace(/\r\n/g, '\n')
        let code = src.replace(/\/\/.*$/gm, '')
        assert.ok(!/kp(TokenCallApi|IpCallApi)\[[^\]]+\]\s*=\s*recs/.test(code), 'tokenCallApi / ipCallApi 不得直接賦值 recs(會留下空陣列之鍵)')
        assert.strictEqual((code.match(/let pruneKpKey = /g) || []).length, 1, 'pruneKpKey 應只定義一處')
        //3 次呼叫: accountLoginFailedPrune、tokenCallApi、ipCallApi
        assert.strictEqual((code.match(/pruneKpKey\(/g) || []).length, 3)
        assert.ok(/pmSeries\(kpAccountLoginFailed,[\s\S]*?pruneKpKey\(kpAccountLoginFailed, account/.test(code), '帳號剪枝計時器應走訪 kpAccountLoginFailed 並呼叫 pruneKpKey')
        assert.ok(/pruneKpKey\(kpTokenCallApi, token/.test(code) && /pruneKpKey\(kpIpCallApi, ip/.test(code))
    })

})
