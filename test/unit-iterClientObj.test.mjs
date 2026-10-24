//unit-iterClientObj.test.mjs — 使用端 / log 來源之字串作為物件鍵與迭代對象 (R-OBJ-ITER-01、R-KEY-01)
//
// 依據: CLAUDE_rulebook.md「R-OBJ-ITER-01」「R-KEY-01」(站點全集與判準); wsemi CLAUDE_rulebook.md R-OBJ-ITER-01
//   - R-OBJ-ITER-01: 迭代 log / 使用端傳入之物件只依自有可列舉字串鍵; 鍵為 `length` 時不得使走訪改成陣列樣(lodash each 對具非負整數 length 之物件只走 0..length-1)
//   - R-KEY-01: 以使用端 / log 來源字串(IP、userId、帳號、token、主鍵)為鍵之容器一律無原型; 查值不把該字串當 lodash 路徑
//     (`constructor`、`__proto__`、`toString` 等原型鍵名使 `kp[key].push` 拋 TypeError、計數累加成字串、`haskey` 誤判、指派被忽略; 含 `.` 之 IP 被當路徑)
// 來源: X-Forwarded-For 標頭第一段即 verifyConn 之 ip(server/procProtect.mjs getIpByHeaders, 未驗證格式), 未登入者可植入任意字串
//
// 分組:
//   IT-S  統計 log 掃描(server/staLogs/staLogsCore.mjs): IP / userId 為上述鍵名時之計數
//   IT-P  統計頁資料(server/procStaInfor.mjs getStaIp / getStaToken, 經真 worker): length 鍵不使整桶失真、不產生假鍵
//   IT-K  防護容器(server/procProtect.mjs): 原型鍵名之 IP / token / 帳號不使 callApiBy* 拋錯、封鎖判定照常
//   IT-C  清單儲存(server/procCore.mjs): 主鍵為原型鍵名可存、非陣列 rows 不被走訪
//   SITE  站點守門: 不再出現列舉之缺陷寫法

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import cloneDeep from 'lodash-es/cloneDeep.js'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import staIp from '../server/staLogs/staIp.mjs'
import staToken from '../server/staLogs/staToken.mjs'
import { mergeAgg, buildOutputs, clearCache } from '../server/staLogs/staLogsCore.mjs'
import procStaInfor from '../server/procStaInfor.mjs'
import { mkOpt, buildProc, buildProtect, mkSrLog, mkTable, mkProcOrm } from './tools/unitProc.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let fdTmp = path.resolve(__dirname, '_tmp', 'unit-iterClientObj')
let fdLog = path.join(fdTmp, 'logs')
let fdRoot = path.resolve(__dirname, '..')


//原型鍵名與特殊鍵名: 每個皆為 JSON / HTTP 標頭可送入之字串
let KEYS_PROTO = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']


//own: 取自有屬性之值(不經原型; `__proto__` 若為自有資料屬性亦可取得)
let own = (o, k) => {
    let d = Object.getOwnPropertyDescriptor(o, k)
    return d === undefined ? undefined : d.value
}


//事件時刻: 90 分鐘前(必在 7 天窗內, 且與目前小時不同桶, 避免跨整點抖動)
let tEv = null
let label = ''
function writeLog(objs) {
    fs.mkdirSync(fdLog, { recursive: true })
    let lines = objs.map((o) => JSON.stringify({ time: tEv.valueOf(), ...o }))
    fs.writeFileSync(path.join(fdLog, `${label}.log`), lines.join('\n') + '\n')
}


//repeat: [[鍵, 次數], ...] 展開成 n 筆事件
function lines(event, field, plan) {
    let r = []
    for (let [k, n] of plan) {
        for (let i = 0; i < n; i++) {
            r.push({ event, [field]: k })
        }
    }
    return r
}


//IP 計畫: length 3 次、原型鍵名各若干、保留字 count 4 次、一般 IPv4 5 次; 總筆數 18
let PLAN_IP = [['length', 3], ['constructor', 2], ['__proto__', 2], ['toString', 1], ['hasOwnProperty', 1], ['count', 4], ['1.2.3.4', 5]]
let N_IP_TOTAL = PLAN_IP.reduce((a, [, n]) => a + n, 0)

//userId 計畫(對應使用者名稱見 IT-P-002)
let PLAN_TK = [['length', 3], ['constructor', 2], ['u1', 4], ['__proto__', 1], ['count', 2]]
let N_TK_TOTAL = PLAN_TK.reduce((a, [, n]) => a + n, 0)


describe('R-OBJ-ITER-01 / R-KEY-01 統計與防護之使用端字串鍵', function() {
    this.timeout(120000)

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        tEv = ot().subtract(90, 'minute')
        label = tEv.format('YYYY-MM-DDTHH')
        writeLog([
            ...lines('verifyConn', 'ip', PLAN_IP),
            ...lines('fun-checkToken', 'userId', PLAN_TK),
        ])
        clearCache()
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            let d = path.dirname(fdTmp)
            if (fs.existsSync(d) && fs.readdirSync(d).length === 0) {
                fs.rmdirSync(d)
            }
        }
        catch (err) { /* ignore */ }
    })


    describe('IT-S 統計 log 掃描', function() {

        it('IT-S-001 IP 為 length / 原型鍵名 / count / 一般 IPv4: 該桶 data 之鍵與計數精確, count 為該桶總筆數', async function() {
            clearCache()
            let rs = await staIp(7, 'hr', { fdLog })
            let b = rs.find((r) => r.time === label)
            assert.ok(b, '應存在事件所屬之時間桶')
            let d = b.data
            //spec(R-KEY-01): 輸出為一般物件, 供 JSON 序列化與既有消費端
            assert.strictEqual(Object.getPrototypeOf(d), Object.prototype)
            //spec(R-OBJ-ITER-01): length 為一般鍵, 值為其出現次數
            assert.strictEqual(own(d, 'length'), 3)
            //spec(R-KEY-01): 原型鍵名為一般鍵, 值為數字(原實作 constructor 等累加成 "function Object() ...1" 字串; __proto__ 之指派被忽略而遺失)
            assert.strictEqual(own(d, 'constructor'), 2)
            assert.strictEqual(own(d, '__proto__'), 2)
            assert.strictEqual(own(d, 'toString'), 1)
            assert.strictEqual(own(d, 'hasOwnProperty'), 1)
            assert.strictEqual(own(d, '1.2.3.4'), 5)
            //spec: count 為該桶 verifyConn 總筆數(保留字); IP 值恰為 "count" 者之筆數併入總數, 不覆寫總數(原實作 { count: 總數, ...kp } 被 kp.count 覆寫為 4)
            assert.strictEqual(own(d, 'count'), N_IP_TOTAL)
            assert.deepStrictEqual(Object.keys(d).sort(), ['1.2.3.4', '__proto__', 'constructor', 'count', 'hasOwnProperty', 'length', 'toString'])
        })

        it('IT-S-002 userId 為 length / 原型鍵名 / count: 同上(staToken)', async function() {
            clearCache()
            let rs = await staToken(7, 'hr', { fdLog })
            let d = rs.find((r) => r.time === label).data
            assert.strictEqual(Object.getPrototypeOf(d), Object.prototype)
            assert.strictEqual(own(d, 'length'), 3)
            assert.strictEqual(own(d, 'constructor'), 2)
            assert.strictEqual(own(d, '__proto__'), 1)
            assert.strictEqual(own(d, 'u1'), 4)
            assert.strictEqual(own(d, 'count'), N_TK_TOTAL)
            assert.deepStrictEqual(Object.keys(d).sort(), ['__proto__', 'constructor', 'count', 'length', 'u1'])
        })

        it('IT-S-003 檔級彙總合併(mergeAgg): 同一原型鍵名跨檔累加為數字, 不累加成字串', function() {
            //worker 回傳經結構化複製, kp 為一般物件; 模擬兩個檔之彙總(含自有的 __proto__ 資料屬性, JSON.parse 可產生)
            let mk = (n) => ({
                token: {},
                ip: { [label]: { count: n * 3, kp: JSON.parse(`{"constructor":${n},"__proto__":${n},"length":${n}}`) } },
                login: {},
            })
            let target = { token: {}, ip: {}, login: {} }
            mergeAgg(target, mk(2))
            mergeAgg(target, mk(3))
            let { ip } = buildOutputs(target, [label])
            let d = ip.find((r) => r.time === label).data
            assert.strictEqual(own(d, 'constructor'), 5)
            assert.strictEqual(own(d, '__proto__'), 5)
            assert.strictEqual(own(d, 'length'), 5)
            assert.strictEqual(own(d, 'count'), 15)
        })

        it('IT-S-004 輸出對照: 無特殊鍵名之桶, 輸出與 { count, ...明細 } 相同(鍵序 count 在前)', function() {
            let target = { token: {}, ip: {}, login: {} }
            mergeAgg(target, { token: {}, ip: { [label]: { count: 3, kp: { '10.0.0.1': 2, '10.0.0.2': 1 } } }, login: {} })
            let d = buildOutputs(target, [label]).ip.find((r) => r.time === label).data
            assert.deepStrictEqual(d, { 'count': 3, '10.0.0.1': 2, '10.0.0.2': 1 })
            assert.deepStrictEqual(Object.keys(d), ['count', '10.0.0.1', '10.0.0.2'])
        })

    })


    describe('IT-P 統計頁資料(經真 worker)', function() {

        let users = [
            { id: 'length', name: 'UserLen' },
            { id: 'constructor', name: 'UserCtor' },
            { id: 'u1', name: 'User1' },
        ]
        let mkSta = () => procStaInfor({}, { getUsersListCache: async () => users, getTokensListCache: async () => [] }, { srLog: mkSrLog(), logFd: fdLog })

        it('IT-P-001 getStaIp: IP 為 length 時該桶明細不被略過、各桶不出現索引假鍵(0..length-1)', async function() {
            clearCache()
            let rs = await mkSta().getStaIp()
            //spec(R-OBJ-ITER-01): length 為一般鍵; 原實作 each 走 0,1,2 並把真實鍵略過(該桶 1.2.3.4 與 count 全失)
            for (let r of rs) {
                for (let k of Object.keys(r.data)) {
                    assert.ok(!/^\d+$/.test(k), `不得有純數字假鍵 ${k}(桶 ${r.time})`)
                }
            }
            let d = rs.find((r) => r.time === label).data
            assert.strictEqual(own(d, 'length'), 3)
            assert.strictEqual(own(d, '1.2.3.4'), 5)
            assert.strictEqual(own(d, 'constructor'), 2)
            assert.strictEqual(own(d, '__proto__'), 2)
            assert.strictEqual(own(d, 'count'), N_IP_TOTAL)
            //其他桶: 鍵集合與事件桶一致, 計數補 0(供前端逐桶對齊); count 為各桶總數(無事件者 0)
            let d0 = rs.find((r) => r.time !== label).data
            assert.strictEqual(own(d0, 'length'), 0)
            assert.strictEqual(own(d0, '1.2.3.4'), 0)
            assert.strictEqual(own(d0, '__proto__'), 0)
            assert.strictEqual(own(d0, 'count'), 0)
        })

        it('IT-P-002 getStaToken: userId 為 length / 原型鍵名: 以使用者名稱為鍵, 無對應使用者者保留 userId', async function() {
            clearCache()
            let rs = await mkSta().getStaToken()
            for (let r of rs) {
                for (let k of Object.keys(r.data)) {
                    assert.ok(!/^\d+$/.test(k), `不得有純數字假鍵 ${k}(桶 ${r.time})`)
                }
            }
            let d = rs.find((r) => r.time === label).data
            assert.strictEqual(own(d, 'UserLen'), 3)
            assert.strictEqual(own(d, 'UserCtor'), 2)
            assert.strictEqual(own(d, 'User1'), 4)
            assert.strictEqual(own(d, '__proto__'), 1) //無對應使用者: 保留 userId
            assert.strictEqual(own(d, 'count'), N_TK_TOTAL)
            let d0 = rs.find((r) => r.time !== label).data
            assert.strictEqual(own(d0, 'UserLen'), 0)
            assert.strictEqual(own(d0, 'count'), 0)
        })

    })


    describe('IT-P 補: 使用者名稱為保留字 count', function() {

        it('IT-P-003 getStaToken: 使用者名稱恰為 count 者, 其筆數已含於總數、不另列、不覆寫總數', async function() {
            clearCache()
            let users = [
                { id: 'u1', name: 'count' }, //名稱為保留字
                { id: 'length', name: 'UserLen' },
            ]
            let sta = procStaInfor({}, { getUsersListCache: async () => users, getTokensListCache: async () => [] }, { srLog: mkSrLog(), logFd: fdLog })
            let rs = await sta.getStaToken()
            let d = rs.find((r) => r.time === label).data
            //spec(R-KEY-01 規則 3): count 為該桶總筆數; 名稱為 count 之 u1(4 筆)併入總數, 不另列
            assert.strictEqual(own(d, 'count'), N_TK_TOTAL)
            assert.strictEqual(own(d, 'UserLen'), 3)
            assert.deepStrictEqual(Object.keys(d).sort(), ['UserLen', '__proto__', 'constructor', 'count'])
        })

    })


    describe('IT-K 防護容器(procProtect)', function() {

        //opt: 門檻取大值, 使本組不觸發封鎖(封鎖路徑另案 IT-K-004)
        let optBig = {
            minForAccountLoginFailed: 10,
            numForAccountLoginFailed: 3,
            minBlockForAccountLoginFailed: 30,
            minForTokenCallApi: 10,
            numForTokenCallApi: 100000,
            minBlockForTokenCallApi: 30,
            minForIpCallApi: 10,
            numForIpCallApi: 100000,
            minBlockForIpCallApi: 30,
        }

        let mkProtect = (extra = {}) => {
            let inserted = []
            let saves = []
            let woItems = {
                ips: {
                    insert: async (d) => {
                        inserted.push(...d)
                        return { n: d.length, nInserted: d.length, ok: 1 }
                    },
                },
                users: {
                    //select: 封鎖於 [tokens, users] 鎖內重讀使用者, 且 procOrm mustExist 以 { id: { $in } } 檢查存在 (R-CONC-01)
                    //帳號封鎖另於鎖內以 { account, isActive } 再驗帳號仍屬該使用者(替身之主鍵為 u-<帳號>)
                    select: async (find) => {
                        if (find && typeof find.account === 'string') {
                            return [{ id: `u-${find.account}`, account: find.account, timeBlocked: '' }]
                        }
                        let ids = (find && find.id && Array.isArray(find.id.$in)) ? find.id.$in : [find && find.id]
                        return ids.map((id) => ({ id, account: String(id).replace(/^u-/, ''), timeBlocked: '' }))
                    },
                    save: async (d) => {
                        let rows = Array.isArray(d) ? d : [d]
                        saves.push(...cloneDeep(rows))
                        return rows.map(() => ({ ok: 1, n: 1, nModified: 1 }))
                    },
                },
            }
            let p = {
                getIpsList: async () => [],
                getGenUserByAccount: async (a) => ({ id: `u-${a}`, account: a, timeBlocked: '' }),
                loginByAccountAndPassword: async () => Promise.reject('wrongPassword'),
                revokeTokensByUserId: async () => {},
                revokeTokensByUserIdLocked: async () => {}, //封鎖於表鎖內撤銷用持鎖版
                ...extra,
            }
            let { pp, timers } = buildProtect(woItems, p, { srLog: mkSrLog(), ...optBig })
            return { pp, timers, inserted, saves }
        }

        it('IT-K-001 callApiByIp / callApiByToken: 原型鍵名與 length 不拋錯, 各自獨立計數', async function() {
            let env = mkProtect()
            for (let k of [...KEYS_PROTO, 'length', 'count', '10.0.0.1']) {
                //spec(R-KEY-01): 原實作 kpIpCallApi[k].push 為 not a function(未 await 之 async 拋錯 → unhandledRejection → 行程結束)
                await env.pp.callApiByIp(k)
                await env.pp.callApiByIp(k)
                await env.pp.callApiByToken(k)
                assert.strictEqual(await env.pp.getCountsByIpCallApi(k), 2, `ip ${k}`)
                assert.strictEqual(await env.pp.getCountsByTokenCallApi(k), 1, `token ${k}`)
            }
        })

        it('IT-K-002 查值不把使用端字串當路徑: a 已有紀錄時, a.length / a.0 / a[0] 為無紀錄', async function() {
            let env = mkProtect()
            await env.pp.callApiByIp('a')
            await env.pp.callApiByToken('a')
            for (let k of ['a.length', 'a.0', 'a[0]']) {
                //spec(R-KEY-01 / R-AUTH-PATH-01 同型): 原實作 get(kp, 'a.length') 取得 kp.a.length(數字 1)而非空陣列
                assert.deepStrictEqual(await env.pp.getInforsByIpCallApi(k), [], `ip ${k}`)
                assert.deepStrictEqual(await env.pp.getInforsByTokenCallApi(k), [], `token ${k}`)
                assert.strictEqual(await env.pp.getCountsByIpCallApi(k), 0, `ip ${k}`)
            }
            //精確鍵照常: 含 . 之 IP 若有紀錄, 精確命中
            await env.pp.callApiByIp('a.length')
            assert.strictEqual(await env.pp.getCountsByIpCallApi('a.length'), 1)
            assert.strictEqual(await env.pp.getCountsByIpCallApi('a'), 1)
        })

        it('IT-K-003 偵測新 IP 計時器: 原型鍵名與 length 之 IP 皆登錄, 計時器照常結束', async function() {
            let env = mkProtect()
            let ips = [...KEYS_PROTO, 'length', 'count', '10.0.0.1']
            for (let k of ips) {
                await env.pp.callApiByIp(k)
            }
            await env.timers[2]() //ipDetectNew
            //spec(R-KEY-01): 原實作 kpIpNew['__proto__'] = true 被忽略而 __proto__ 不登錄; haskey(kpIpOld, 'constructor') 為真而 constructor 不登錄
            assert.deepStrictEqual(env.inserted.map((o) => o.ip).sort(), [...ips].sort())
            //其餘三個計時器對這些鍵照常執行(不拋錯)
            await env.timers[0]()
            await env.timers[1]()
            await env.timers[3]()
        })

        it('IT-K-004 帳號登入失敗紀錄: 帳號為原型鍵名時照常計次並於超過門檻後封鎖(原實作 TypeError 且永不封鎖)', async function() {
            for (let account of ['constructor', '__proto__', 'toString']) {
                let env = mkProtect()
                let errs = []
                for (let i = 0; i < 4; i++) {
                    let err = await env.pp.loginByAccountAndPassword(account, 'x').then(() => null, (e) => e)
                    errs.push(err)
                }
                //spec: 失敗一律回原因(此處 stub 為 wrongPassword), 不得為 TypeError
                assert.deepStrictEqual(errs, ['wrongPassword', 'wrongPassword', 'wrongPassword', 'wrongPassword'], account)
                //spec: 失敗次數 > numForAccountLoginFailed(3) 時封鎖該帳號(第 4 次失敗觸發 blockAccount → users.save timeBlocked)
                assert.strictEqual(env.saves.length, 1, account)
                assert.strictEqual(env.saves[0].id, `u-${account}`, account)
                assert.ok(env.saves[0].timeBlocked, account)
            }
        })

        it('IT-K-005 清除 API(cleanKpIpCallApi / cleanKpAccountLoginFailed)後容器仍可用', async function() {
            let env = mkProtect()
            await env.pp.callApiByIp('constructor')
            await env.pp.cleanKpIpCallApi()
            assert.strictEqual(await env.pp.getCountsByIpCallApi('constructor'), 0)
            await env.pp.callApiByIp('constructor')
            assert.strictEqual(await env.pp.getCountsByIpCallApi('constructor'), 1)
            await env.pp.cleanKpAccountLoginFailed()
            let err = await env.pp.loginByAccountAndPassword('constructor', 'x').then(() => null, (e) => e)
            assert.strictEqual(err, 'wrongPassword')
        })

    })


    describe('IT-C 清單儲存(procCore)', function() {

        let SALT = mkOpt().salt
        let HASH = hashPassword('Init@1234', SALT)
        let tFuture = () => ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        let mkEnv = () => {
            let u = (id, account, order, ext = {}) => ({
                ...ds.users.funNew({ account, name: account, email: `${account}@example.com`, password: HASH, isAdmin: 'n', timeVerified: '2026-01-01T00:00:00.000+08:00' }),
                id,
                order,
                ...ext,
            })
            let users = mkTable([u('u-admin', 'admin1', 1, { isAdmin: 'y' }), u('u-z', 'zuser', 2)])
            let tokens = mkTable([{ ...ds.tokens.funNew({ userId: 'u-admin' }), id: 't-admin', token: 'tk-admin', isApp: 'n', timeEnd: tFuture() }])
            let ips = mkTable([])
            let woItems = { users, tokens, ips }
            let srLog = mkSrLog()
            let p = buildProc(woItems, mkProcOrm(ds, woItems), { srLog })
            return { users, tokens, ips, p, srLog }
        }
        let listRows = (t) => {
            return [...t.kp.values()].map((r) => {
                let c = cloneDeep(r)
                delete c.password
                return c
            }).sort((a, b) => (a.order || 0) - (b.order || 0))
        }
        let mkUserNew = (id, account) => ({ ...ds.users.funNew({ account, name: account, email: `${account}@example.com`, isAdmin: 'n' }), id, password: 'Good@2468', _isNew: true })

        it('IT-C-001 使用者清單新增列之主鍵 / 帳號為原型鍵名: 可存, 明文密碼照常雜湊(原實作 constructor 等之 oldById 查得 Object, 密碼被清為 undefined; haskey 誤判為重複)', async function() {
            for (let name of ['constructor', '__proto__', 'toString', 'valueOf']) {
                let env = mkEnv()
                let rows = listRows(env.users)
                rows.push(mkUserNew(name, `acct-${name.toLowerCase().replace(/_/g, '')}`))
                await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows)
                let saved = env.users.kp.get(name)
                assert.ok(saved, `主鍵 ${name} 應已寫入`)
                assert.strictEqual(verifyPassword('Good@2468', saved.password, SALT), true, `${name} 之密碼應已雜湊`)
                assert.strictEqual(env.users.kp.size, 3)
            }
        })

        it('IT-C-002 帳號為原型鍵名: 本批重複與既有衝突之判定照常(重複者拒絕 accountDuplicate, 單一者通過)', async function() {
            let env = mkEnv()
            let rows = listRows(env.users)
            rows.push(mkUserNew('n1', 'constructor'))
            rows.push({ ...mkUserNew('n2', 'constructor'), email: 'n2@example.com' })
            let err = await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows).then(() => null, (e) => e)
            assert.strictEqual(err, 'accountDuplicate')
            //單一者通過
            let env2 = mkEnv()
            let rows2 = listRows(env2.users)
            rows2.push(mkUserNew('n1', 'constructor'))
            await env2.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows2)
            assert.ok(env2.users.kp.get('n1'))
        })

        it('IT-C-003 權杖清單既有列 / IP 清單新增列主鍵為原型鍵名: 可存', async function() {
            let env = mkEnv()
            //權杖清單存檔只改不增(ADR-095, 應用系統金鑰只經 createAppToken 鑄造且主鍵由伺服端產生), 原型鍵名主鍵之權杖列以「既有列(庫內已有)之修改」驗證
            let tCtor = { ...ds.tokens.funNew({ userId: 'u-z' }), id: 'constructor', token: 'tk-ctor', isApp: 'y', timeEnd: '' }
            env.tokens.kp.set('constructor', tCtor)
            let tkRows = [...env.tokens.kp.values()].map((r) => cloneDeep(r))
            tkRows.find((r) => r.id === 'constructor').perms = ['readIps']
            await env.p.checkTokenAndUpdateTokensList('tk-admin', tkRows)
            assert.deepStrictEqual(env.tokens.kp.get('constructor').perms, ['readIps'])
            let ipRows = [{ ...ds.ips.funNew({ ip: '10.0.0.7' }), id: '__proto__', timeBlocked: '', _isNew: true }]
            await env.p.checkTokenAndUpdateIpsList('tk-admin', ipRows)
            assert.ok(env.ips.kp.get('__proto__'))
        })

        it('IT-C-004 使用者清單 rows 為帶 length 之物件: 立即以 invalidRows 拒絕, 資料無變更(原實作先以 each 走訪 length 次, 且依索引 0 無值回 cannotDeleteSelf)', async function() {
            let env = mkEnv()
            let before = JSON.stringify([...env.users.kp.entries()])
            for (let rows of [{ length: 3 }, { length: 0 }, { length: 1, 0: { id: 'u-admin' } }, { length: -1 }, { length: 1.5 }, { length: '3' }, { length: null }, 'abc', 5, null]) {
                let err = await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows).then(() => null, (e) => e)
                assert.strictEqual(err, 'invalidRows', JSON.stringify(rows))
            }
            assert.strictEqual(JSON.stringify([...env.users.kp.entries()]), before)
        })

        it('IT-C-006 權杖清單 rows 為非陣列(帶 length 之物件、數字、null): 回 invalidRows, 資料無變更(原實作 for…of 拋 TypeError rows is not iterable)', async function() {
            let env = mkEnv()
            let before = JSON.stringify([...env.tokens.kp.entries()])
            for (let rows of [{ length: 3 }, { length: 4294967295 }, 5, null, undefined]) {
                let err = await env.p.checkTokenAndUpdateTokensList('tk-admin', rows).then(() => null, (e) => e)
                assert.strictEqual(err, 'invalidRows', JSON.stringify(rows))
            }
            assert.strictEqual(JSON.stringify([...env.tokens.kp.entries()]), before)
        })

        it('IT-C-005 使用者清單 rows 為 { length: 2^32-1 }: 子行程內立即拒絕, 不空轉(原實作單一 each 空轉數十秒)', function() {
            let r = spawnSync(process.execPath, ['test/tools/iterChild.mjs', 'rows-length-max'], { cwd: fdRoot, timeout: 20000, killSignal: 'SIGKILL', encoding: 'utf8' })
            assert.strictEqual(r.error, undefined, `子行程應在 20 秒內結束(逾時即空轉): ${r.error && r.error.message}`)
            let o = JSON.parse(r.stdout.trim().split('\n').pop())
            assert.strictEqual(o.err, 'invalidRows')
            assert.ok(o.ms < 2000, `耗時 ${o.ms} ms`)
        })

    })


    describe('SITE 站點守門(R-OBJ-ITER-01 / R-KEY-01)', function() {

        let read = (rel) => fs.readFileSync(path.join(fdRoot, rel), 'utf8')

        it('SITE-IT-001 統計 / 防護 / 清單儲存不再以 lodash 迭代 log 或使用端物件', function() {
            //盤點指令見 CLAUDE_rulebook.md R-OBJ-ITER-01; 以下為其中「已套站點」之可執行版
            let src = read('server/procStaInfor.mjs')
            assert.ok(!/\beach\(\s*v\.data\b/.test(src), 'procStaInfor 不得 each(v.data, …)')
            let core = read('server/procCore.mjs')
            assert.ok(!/\beach\(\s*rows\s*,\s*\(rr\)/.test(core), 'checkTokenAndUpdateUsersList 不得 each(rows, (rr) …)')
            let protect = read('server/procProtect.mjs')
            assert.ok(!/\beach\(\s*kpIpNew\b/.test(protect), 'procProtect 不得 each(kpIpNew, …)')
        })

        it('SITE-IT-003 後台使用者清單頁之重複 / 空值檢查容器(鍵為使用者輸入之帳號、email、主鍵)為無原型, 查值為自有鍵', function() {
            let src = read('src/components/LayoutContentUsers.vue')
            //外審(minimax)指出: 前端 haskey(kpAccount, 'constructor') 為真, 後端放行之帳號會被前端預檢擋下
            assert.ok(!/let (kpErr|kpAccount|kpEmail) = \{\}/.test(src), 'kpErr / kpAccount / kpEmail 不得以字面 {} 建立')
            assert.ok(!/get\(\s*errMaps\[field\]/.test(src), 'cellFieldErr 不得 get(errMaps[field], v)')
            assert.ok(!/get\(\s*vo\.errItemsByPassword/.test(src), 'cellPasswordErr 不得 get(vo.errItemsByPassword, id)')
        })

        it('SITE-IT-002 以使用端 / log 字串為鍵之容器皆為無原型, 查值不經 lodash get 路徑', function() {
            let protect = read('server/procProtect.mjs')
            for (let nm of ['kpAccountLoginFailed', 'kpTokenCallApi', 'kpIpCallApi', 'kpIpOld', 'kpIpNew']) {
                let re = new RegExp(`\\b${nm}\\s*=\\s*(\\{\\s*\\}|\\[\\s*\\])`)
                assert.ok(!re.test(protect), `${nm} 不得以字面 {} 建立(應為 Object.create(null))`)
            }
            assert.ok(!/\bget\(\s*kp(Token|Ip)CallApi\b/.test(protect), 'procProtect 不得 get(kpXxxCallApi, 使用端字串)')
            let sta = read('server/procStaInfor.mjs')
            assert.ok(!/\bget\(\s*kpUsername\b/.test(sta), 'procStaInfor 不得 get(kpUsername, userId)')
            let logs = read('server/staLogs/staLogsCore.mjs')
            assert.ok(!/\bkp:\s*\{\s*\}/.test(logs), 'staLogsCore 之 kp 不得以字面 {} 建立')
        })

    })

})
