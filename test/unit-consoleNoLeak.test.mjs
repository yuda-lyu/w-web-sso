import assert from 'assert'
import fs from 'fs'
import util from 'util'
import WWebSso from '../server/WWebSso.mjs'
import { mkEnvSso, mkProtect, mkToken, mkIp, errOf, PW_INIT } from './tools/unitEnv.mjs'
import { fetchSsoMsg } from '../src/fetchSsoMsg.mjs'
import { stripComments } from './tools/diagWire.mjs'


//
// console 診斷不輸出資料值之站點不變式 (R-LOG-01; spec: spec/設計要點與取捨.md ADR-101, 取代 ADR-068 M 契約中 console 之 maskKv 規則與 R-QKEY-01 規則 4 之 console 部分;
// 跨套件規格: C:\opensrcOper\dspec\診斷輸出與遮罩.md D2「預設不輸出資料值」、輸入參數之檢測機制.md V20「訊息與 throw / reject 前之 console 皆不含輸入值」; 使用者 2026-10-29 裁示, 主控 2026-10-31 派工)
//
// 規則(每個 it 標題註明對應之站點): console 診斷只印「鍵名、型別或固定詞彙」, 不印使用者物件、請求本體、傳入參數值、資料表與後端之回傳值(含錯誤原文)、設定值;
//   錯誤只印安全摘要 { errType, errCode }(wsemi getDiagBriefErr), 欄位名須在本套件資料表之欄位名單內才照印, 否則只給型別.
// 作法: 同一組含識別值之測資——識別值 SECRET 置於使用者物件(資料表列)、請求本體(查詢值、語系、欄位名)、建構參數(WOrm、db、url、選項),
//   後端錯誤原文標記 ERRTXT 置於資料表 / 寄信之 reject; 以真實 procCore / procProtect / WWebSso 觸發各站點(真實 w-serv-orm 表鎖 + 替身資料表, 不起 server),
//   斷言 console(log / warn / error / info / debug)之輸出皆不含 SECRET 與 ERRTXT, 並含固定詞彙(證明站點確實被觸發)。
//   端到端(真行程之 stdout / stderr, 含啟動期與 verifyConn 站點)見 api-consoleNoLeak; 站點全集之盤點見檔尾 SITE-CNL。
//


let SECRET = 'ZZ-secret-9317'
let ERRTXT = 'ZZ-errtext-4408'
let errOrig = () => new Error(`driver failed ${ERRTXT} at ${SECRET}`)


//captureConsole: 執行 fn 期間收集 console 五個輸出方法之輸出行(物件以 util.inspect 完整展開, 不因深度被截成 [Object] 而漏看)
async function captureConsole(fn) {
    let lines = []
    let origs = {}
    for (let m of ['log', 'warn', 'error', 'info', 'debug']) {
        origs[m] = console[m]
        console[m] = (...a) => {
            lines.push(a.map((v) => (typeof v === 'string' ? v : util.inspect(v, { depth: null }))).join(' '))
        }
    }
    try {
        await fn()
    }
    finally {
        for (let m of Object.keys(origs)) {
            console[m] = origs[m]
        }
    }
    return lines
}


//assertClean: 站點被觸發(有輸出且含 must 之固定詞彙), 且全部輸出不含識別值與後端錯誤原文
function assertClean(lines, label, must = []) {
    let text = lines.join('\n')
    assert.ok(lines.length > 0, `${label}: 站點未被觸發(無 console 輸出)`)
    for (let x of [SECRET, ERRTXT]) {
        assert.ok(!text.includes(x), `${label}: console 不得含 ${x}: ${text}`)
    }
    for (let x of must) {
        assert.ok(text.includes(x), `${label}: 應含固定詞彙 ${x}: ${text}`)
    }
}


//rejectWith: 令資料表某方法以含 SECRET 與 ERRTXT 之 Error reject(模擬資料庫驅動之錯誤原文)
function rejectWith(table, method) {
    table[method] = async () => Promise.reject(errOrig())
}


describe('procCore 之 console 站點不輸出資料值 (R-LOG-01, ADR-101)', function() {

    it('CNL-C01 [_getGenUserByKV 資料庫錯誤分支] 查詢值(含識別欄 account / id)、欄位名、錯誤原文皆不輸出; 固定詞彙 failed to find user 保留', async function() {
        let env = mkEnvSso()
        rejectWith(env.users, 'select')
        //識別欄與非識別欄之值都不輸出(原 maskKv 對識別欄照記, 為使用者之裁定所取代); 欄位名由使用端自填者(SECRET)亦不輸出
        for (let [k, v] of [['account', SECRET], ['id', SECRET], ['email', SECRET], ['tokenVerify', SECRET], [SECRET, SECRET]]) {
            let r = null
            let lines = await captureConsole(async () => {
                r = await errOf(env.p.getGenUserByKV(k, v))
            })
            assert.strictEqual(r, 'failed to find user')
            assertClean(lines, `getGenUserByKV(${k === SECRET ? '<外來欄位名>' : k})`, ['failed to find user'])
        }
    })

    it('CNL-C02 [getTokenByKV] 資料表錯誤原文不輸出; 重複分支之欄位名在 tokens 欄位名單內照印(userId), 外來欄位名只給型別', async function() {
        let env = mkEnvSso()
        rejectWith(env.tokens, 'select')
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.getTokenByKV('token', SECRET))
        })
        assert.strictEqual(r, 'failed to find token')
        assertClean(lines, 'getTokenByKV 資料表錯誤', ['failed to find token'])

        //重複分支: 欄位名為 SECRET(兩列皆有該自有屬性)
        let env2 = mkEnvSso()
        await env2.tokens.insert([
            mkToken('t-d1', 'tk-d1', 'u-a', { [SECRET]: 'x' }),
            mkToken('t-d2', 'tk-d2', 'u-a', { [SECRET]: 'x' }),
        ])
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.getTokenByKV(SECRET, 'x'))
        })
        assert.ok(typeof r === 'string' && r.startsWith('duplicate token'), String(r))
        assertClean(lines, 'getTokenByKV 外來欄位名', ['duplicate token by keyToken['])

        //對照: 欄位名在名單內(userId)照印
        let env3 = mkEnvSso()
        await env3.tokens.insert([mkToken('t-e1', 'tk-e1', 'u-dup'), mkToken('t-e2', 'tk-e2', 'u-dup')])
        lines = await captureConsole(async () => {
            r = await errOf(env3.p.getTokenByKV('userId', SECRET))
        })
        assert.ok(lines.length === 0, '無重複(查無)不輸出')
        lines = await captureConsole(async () => {
            r = await errOf(env3.p.getTokenByKV('userId', 'u-dup'))
        })
        assert.ok(lines.join('\n').includes('duplicate token by keyToken[userId]'), `欄位名單內之欄位名照印: ${lines.join('\n')}`)
    })

    it('CNL-C03 [getIpByKV] 查詢值(IP)、資料表錯誤原文不輸出; 欄位名同規則', async function() {
        let env = mkEnvSso()
        rejectWith(env.ips, 'select')
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.getIpByKV('ip', SECRET))
        })
        assert.strictEqual(r, 'failed to find ip')
        assertClean(lines, 'getIpByKV 資料表錯誤', ['failed to find ip', 'keyIp ip', 'valueIp (typeof string)'])

        //資料表錯誤分支: 欄位名為 SECRET(外來欄位名不印)
        lines = await captureConsole(async () => {
            r = await errOf(env.p.getIpByKV(SECRET, 'x'))
        })
        assert.strictEqual(r, 'failed to find ip')
        assertClean(lines, 'getIpByKV 資料表錯誤(外來欄位名)', ['failed to find ip', 'keyIp (typeof string)'])

        //重複分支: 值為 SECRET; 欄位名為 SECRET
        let env2 = mkEnvSso()
        await env2.ips.insert([mkIp('ip-d1', SECRET), mkIp('ip-d2', SECRET), mkIp('ip-d3', 'x', { [SECRET]: 'y' }), mkIp('ip-d4', 'x', { [SECRET]: 'y' })])
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.getIpByKV('ip', SECRET))
        })
        assert.ok(typeof r === 'string' && r.startsWith('duplicate ip'), String(r))
        assertClean(lines, 'getIpByKV 重複(值)', ['duplicate ip by keyIp[ip]'])
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.getIpByKV(SECRET, 'y'))
        })
        assert.ok(typeof r === 'string' && r.startsWith('duplicate ip'), String(r))
        assertClean(lines, 'getIpByKV 重複(外來欄位名)', ['duplicate ip by keyIp['])
    })

    it('CNL-C04 [createToken] 建構參數 minExpired 無效時不輸出其值; 鎖內重讀使用者之資料表錯誤原文不輸出', async function() {
        //minExpired 為傳入 procCore 之參數(WWebSso 已先正規化, 此為 procCore 被直接建構時之守門): 值為 SECRET
        let env = mkEnvSso({ minExpired: SECRET })
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.loginByAccountAndPassword('auser', PW_INIT))
        })
        assert.strictEqual(r, 'invalid minExpired')
        assertClean(lines, 'createToken minExpired', ['invalid minExpired'])

        //鎖內 recheckUser 之 users.select({ id }) 以含原文之 Error reject(登入第一步 select({ account }) 不受影響)
        let env2 = mkEnvSso()
        let orig = env2.users.select
        env2.users.select = async (find) => {
            if (find && Object.keys(find).join() === 'id') {
                return Promise.reject(errOrig())
            }
            return orig(find)
        }
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.loginByAccountAndPassword('auser', PW_INIT))
        })
        assert.strictEqual(r, 'can not create a token from userId')
        assertClean(lines, 'createToken 鎖內錯誤', ['can not create a token from userId'])
    })

    it('CNL-C05 [isActorLive / _refreshToken 之 timeEnd] 權杖列之 timeEnd(資料值)無論無效、已過期皆不輸出', async function() {
        let env = mkEnvSso()
        await env.tokens.insert([
            mkToken('t-bad', 'tk-bad', 'u-a', { timeEnd: SECRET }), //timeEnd 非時間字串
            mkToken('t-old', 'tk-old', 'u-a', { timeEnd: '2001-02-03T04:05:06.007+08:00' }), //已過期
        ])
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.checkToken('tk-bad'))
        })
        assert.strictEqual(r, 'tokenExpired')
        assertClean(lines, 'isActorLive invalid timeEnd', ['invalid timeEnd'])

        lines = await captureConsole(async () => {
            r = await errOf(env.p.refreshToken('tk-bad'))
        })
        assert.strictEqual(r, 'invalid timeEnd')
        assertClean(lines, '_refreshToken invalid timeEnd', ['invalid timeEnd'])

        lines = await captureConsole(async () => {
            r = await errOf(env.p.refreshToken('tk-old'))
        })
        assert.strictEqual(r, 'tokenExpired')
        assertClean(lines, '_refreshToken token expired', ['token expired'])
        assert.ok(!lines.join('\n').includes('2001-02-03'), `已過期之 timeEnd 不輸出: ${lines.join('\n')}`)
    })

    it('CNL-C06 [checkToken 內層 reject / checkTokenByObj 以外之權杖鏈] 資料表錯誤原文不輸出, 只給錯誤類型; 對外仍為固定 key tokenExpired', async function() {
        let env = mkEnvSso()
        rejectWith(env.tokens, 'select')
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.checkToken('tk-a1'))
        })
        assert.strictEqual(r, 'tokenExpired')
        assertClean(lines, 'checkToken inner reject', ['checkToken inner reject', 'errType'])

        //經 getActorByToken 之內層錯誤(使用者表錯誤)亦同: 以 checkTokenAndGetUserByToken(自身權杖驗證)觸發
        let env2 = mkEnvSso()
        rejectWith(env2.users, 'select')
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.checkToken('tk-a1'))
        })
        assert.strictEqual(r, 'tokenExpired')
        assertClean(lines, 'checkToken inner reject(users)', ['checkToken inner reject'])
    })

    it('CNL-C07 [refreshToken 寫入失敗 / logoutByToken 刪除失敗 / createToken 寫入失敗] 失敗筆主鍵與資料表錯誤原文不輸出', async function() {
        //refreshToken: 列主鍵為 SECRET 且逐筆寫入失敗 → procOrm 之 reject 訊息含失敗筆主鍵
        let env = mkEnvSso()
        await env.tokens.insert([mkToken(SECRET, 'tk-sf', 'u-a')])
        env.tokens.fail.save.add(SECRET)
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(env.p.refreshToken('tk-sf'))
        })
        assert.strictEqual(r, 'can not update timeEnd for token')
        assertClean(lines, 'refreshToken save', ['can not update timeEnd for token'])

        //logoutByToken: 刪除以含原文之 Error reject
        let env2 = mkEnvSso()
        rejectWith(env2.tokens, 'del')
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.logoutByToken('tk-a1'))
        })
        assert.strictEqual(r, 'failed to delete token')
        assertClean(lines, 'logoutByToken del', ['failed to delete token'])

        //createToken: 寫入(procOrm insert)之 reject 含失敗列主鍵與原文(以 tokens.insert 整批 reject 注入)
        let env3 = mkEnvSso()
        rejectWith(env3.tokens, 'insert')
        lines = await captureConsole(async () => {
            r = await errOf(env3.p.loginByAccountAndPassword('auser', PW_INIT))
        })
        assert.strictEqual(r, 'can not create a token from userId')
        assertClean(lines, 'createToken insert', ['can not create a token from userId'])
    })

    it('CNL-C08 [寄信失敗: 自助註冊 / 重寄驗證信 / 改密碼 / 重設密碼] 寄信之錯誤原文(可夾帶收件者)不輸出, 只給錯誤類型', async function() {
        let send = async () => {
            throw new Error(`smtp rejected ${ERRTXT} rcpt ${SECRET}@example.com`)
        }

        //createUser(請求本體含 SECRET 之姓名)
        let env = mkEnvSso({ srEmail: { send } })
        let r = null
        let lines = await captureConsole(async () => {
            r = await env.p.createUser('eng', { account: 'newusr9317', name: SECRET, email: 'newusr9317@example.com', password: 'Ab@12345', confirmPassword: 'Ab@12345' })
        })
        assert.strictEqual(r.state, 'success', JSON.stringify(r))
        assertClean(lines, 'createUser 寄信失敗', ['send verify email error', 'errType'])

        //resendVerifyEmail(未驗證之 vuser)
        let env2 = mkEnvSso({ srEmail: { send } })
        lines = await captureConsole(async () => {
            r = await errOf(env2.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com'))
        })
        assert.strictEqual(r, 'userRegistrationResendFailed')
        assertClean(lines, 'resendVerifyEmail 寄信失敗', ['resend verify email error', 'errType'])

        //checkTokenAndChangePassword: 寄信失敗不中斷流程
        let env3 = mkEnvSso({ srEmail: { send } })
        lines = await captureConsole(async () => {
            r = await env3.p.checkTokenAndChangePassword('tk-a1', 'eng', PW_INIT, 'New@5678')
        })
        assertClean(lines, 'checkTokenAndChangePassword 寄信失敗', ['errType'])

        //adminResetUserPassword: 寄信失敗不中斷流程
        let env4 = mkEnvSso({ srEmail: { send } })
        lines = await captureConsole(async () => {
            r = await env4.p.adminResetUserPassword('tk-admin', 'eng', 'u-a')
        })
        assert.deepStrictEqual(r, { state: 'success' })
        assertClean(lines, 'adminResetUserPassword 寄信失敗', ['errType'])
    })

    it('CNL-C09 [改密碼寄信前置檢查: 語系字典、信件標題] 請求之語系值(lang)與整本語系字典不輸出', async function() {
        //lang 為請求本體之值(SECRET): 取不到寄件者名稱 → 原印出 get(kpLang, lang) 與 lang
        let env = mkEnvSso()
        let r = null
        let lines = await captureConsole(async () => {
            r = await env.p.checkTokenAndChangePassword('tk-a1', SECRET, PW_INIT, 'New@5678')
        })
        assertClean(lines, '改密碼 invalid sender', ['lang'])
        assert.ok(r === undefined || r === null || typeof r === 'object', '寄信前置檢查失敗不中斷流程')

        //取得寄件者名稱但取不到信件標題
        let env2 = mkEnvSso({ kpLang: { eng: { webName: 'Test' }, [SECRET]: { webName: 'Test' } } })
        lines = await captureConsole(async () => {
            r = await env2.p.checkTokenAndChangePassword('tk-a1', SECRET, PW_INIT, 'New@5678')
        })
        assertClean(lines, '改密碼 invalid title', ['lang'])

        //語系字典存在但取不到寄件者名稱(webName 為空): 原整本字典(含其中之值)原樣印出
        let env3 = mkEnvSso({ kpLang: { eng: { webName: 'Test' }, [SECRET]: { webName: '', note: SECRET } } })
        lines = await captureConsole(async () => {
            r = await env3.p.checkTokenAndChangePassword('tk-a1', SECRET, PW_INIT, 'New@5678')
        })
        assertClean(lines, '改密碼 invalid sender(語系字典含值)', ['get(kpLang, lang) (typeof object)', 'lang (typeof string)'])
    })

})


describe('procProtect 之 console 站點不輸出資料值 (R-LOG-01, ADR-101)', function() {

    //封鎖流程於表鎖內遇下層錯誤(以 withTabLocks 之 reject 注入, 其值含原文與 SECRET)
    let failLocks = { withTabLocks: async () => Promise.reject(errOrig()) }

    it('CNL-P01 [帳號登入失敗封鎖] blockAccount 之 reject(下層錯誤原文)不輸出', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env, failLocks)
        let lines = await captureConsole(async () => {
            await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000'))
            await errOf(pp.loginByAccountAndPassword('auser', 'Wrong@0000')) //第 2 次失敗 > 門檻 1 → blockAccount
        })
        assertClean(lines, 'procProtect 帳號封鎖', ['errType'])
    })

    it('CNL-P02 [權杖調用次數封鎖計時器] blockAccountByToken 之 reject 不輸出', async function() {
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env, failLocks)
        await pp.callApiByToken('tk-a1')
        await pp.callApiByToken('tk-a1')
        let lines = await captureConsole(async () => {
            await timers[1]()
        })
        assertClean(lines, 'procProtect 權杖封鎖', ['errType'])
    })

    it('CNL-P03 [IP 調用次數封鎖計時器] blockIpByIp 之 reject(含失敗列主鍵)不輸出', async function() {
        //下層錯誤: 表鎖 reject
        let env = mkEnvSso()
        let { pp, timers } = mkProtect(env, failLocks)
        await pp.callApiByIp('10.0.0.9')
        await pp.callApiByIp('10.0.0.9')
        let lines = await captureConsole(async () => {
            await timers[3]()
        })
        assertClean(lines, 'procProtect IP 封鎖(表鎖錯誤)', ['errType'])

        //下層錯誤: 既有 IP 列(主鍵為 SECRET)封鎖寫入逐筆失敗 → procOrm 之 reject 訊息含失敗筆主鍵
        let env2 = mkEnvSso()
        await env2.ips.insert([mkIp(SECRET, '10.0.0.9')])
        env2.ips.fail.save.add(SECRET)
        let { pp: pp2, timers: timers2 } = mkProtect(env2)
        await pp2.callApiByIp('10.0.0.9')
        await pp2.callApiByIp('10.0.0.9')
        lines = await captureConsole(async () => {
            await timers2[3]()
        })
        assertClean(lines, 'procProtect IP 封鎖(逐筆寫入失敗)', ['errType'])
    })

    it('CNL-P04 [取不到來源 IP] 只印標頭名稱(鍵名), 標頭之值(authorization、referer、自訂標頭)不輸出(對照: 修前亦綠, 守住不得改回整包標頭)', async function() {
        let env = mkEnvSso()
        let { pp } = mkProtect(env)
        let ip = null
        let lines = await captureConsole(async () => {
            ip = pp.getIpByHeaders({ headers: { 'authorization': `Bearer ${SECRET}`, 'referer': `http://localhost/?token=${SECRET}`, 'x-test': SECRET } })
        })
        assert.strictEqual(ip, '')
        assertClean(lines, 'getIpByHeaders', ['headers(keys)', 'can not get ip of user'])
        assert.ok(lines.join('\n').includes('authorization'), '標頭名稱(鍵名)可印')
    })

})


describe('WWebSso 建構期之 console 站點不輸出傳入值 (R-LOG-01, ADR-101)', function() {

    it('CNL-W01 [invalid WOrm / invalid url / invalid db] 建構參數無效時只印型別, 不印傳入值(含物件之內容); 仍拋固定訊息', async function() {
        let cases = [
            { args: [{ pw: SECRET }, 'lmdb://x', 'wsso'], msg: 'invalid WOrm', label: 'WOrm' },
            { args: [class {}, { user: 'u', password: SECRET }, 'wsso'], msg: 'invalid url', label: 'url' },
            { args: [class {}, `lmdb://${SECRET}`, { db: SECRET, list: [SECRET] }], msg: 'invalid db', label: 'db' },
            { args: [class {}, `lmdb://${SECRET}`, 12345], msg: 'invalid db', label: 'db(number)' },
        ]
        for (let c of cases) {
            let e = null
            let lines = await captureConsole(async () => {
                try {
                    WWebSso(...c.args)
                }
                catch (err) {
                    e = err
                }
            })
            assert.strictEqual(e.message, c.msg)
            assertClean(lines, `WWebSso ${c.label}`, [c.msg])
        }
    })

    it('CNL-W02 [WServOrm init failed] 資料庫連線初始化錯誤之原文(含連線字串與外來值)不輸出, 只給錯誤類型; 重拋之錯誤仍為遮罩後之原錯誤', async function() {
        let dir = './test/_tmp/unit-consoleNoLeak'
        fs.rmSync(dir, { recursive: true, force: true })
        class WOrmThrow {
            constructor() {
                throw new Error(`connect failed ${ERRTXT} at ${SECRET}`)
            }
        }
        let e = null
        let lines = await captureConsole(async () => {
            try {
                WWebSso(WOrmThrow, 'lmdb://db.example.com/x', 'wsso', './settings.json', { serverPort: 11397, logFd: `${dir}/logs`, allowUserRegistration: true, emSrcHost: '127.0.0.1', emSrcPort: 1 })
            }
            catch (err) {
                e = err
            }
        })
        try {
            assert.ok(e instanceof Error)
            assert.ok(e.message.includes('connect failed'), `重拋之錯誤保留診斷文字(對外值, D3): ${e.message}`)
            assertClean(lines, 'WServOrm init failed', ['WServOrm init failed', 'errType'])
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
        assert.ok(!fs.existsSync(dir), 'test/_tmp/unit-consoleNoLeak 已清除')
    })

})


describe('對外查詢 helper 之診斷行不輸出傳入值 (R-LOG-01, ADR-101; src/fetchSsoMsg.mjs, 跑於引用方之後端)', function() {

    it('CNL-F01 [fetchSsoMsg 診斷行] 權杖與網址範本(含 origin、pathname)皆不輸出, 只留 helper 名、固定 key、錯誤類別與代碼; reject 仍為固定 key', async function() {
        //網址範本之 pathname 含 SECRET(部署方設定值); 權杖為請求之值(SECRET); 連線埠 1 必拒絕(離線, 不外連)
        let url = `http://127.0.0.1:1/${SECRET}/api/getSsoUserInfor?token={token}`
        let r = null
        let lines = await captureConsole(async () => {
            r = await errOf(fetchSsoMsg('getUserByToken', url, [['{token}', SECRET]], { keyRequest: 'cannotGetUserByUrl', keyData: 'cannotGetUserDataByUrl', keyNoData: 'noUserDataByUrl', isValid: () => true }))
        })
        assert.strictEqual(r, 'cannotGetUserByUrl')
        assertClean(lines, 'fetchSsoMsg 連線失敗', ['[w-web-sso] getUserByToken cannotGetUserByUrl'])
        let text = lines.join('\n')
        for (let x of ['127.0.0.1', '/api/getSsoUserInfor', 'http://']) {
            assert.ok(!text.includes(x), `診斷行不得含網址片段 ${x}: ${text}`)
        }
    })

})


describe('輔助函數 logType / logKey (server/srLog.mjs)', function() {

    it('CNL-H01 logType 只給型別: 任何值(字串、物件、陣列、null、數字)皆不含其內容; logKey 名單內照印, 名單外與非字串只給型別', async function() {
        let { logType, logKey } = await import('../server/srLog.mjs')
        assert.strictEqual(logType(SECRET), '(typeof string)')
        assert.strictEqual(logType({ a: SECRET }), '(typeof object)')
        assert.strictEqual(logType([SECRET]), '(typeof array)')
        assert.strictEqual(logType(null), '(typeof null)')
        assert.strictEqual(logType(undefined), '(typeof undefined)')
        assert.strictEqual(logType(12345), '(typeof number)')
        assert.strictEqual(logType(() => SECRET), '(typeof function)')
        assert.strictEqual(logKey('account', ['id', 'account']), 'account')
        assert.strictEqual(logKey(SECRET, ['id', 'account']), '(typeof string)')
        assert.strictEqual(logKey('', ['id', 'account']), '(typeof string)')
        assert.strictEqual(logKey(['id'], ['id', 'account']), '(typeof array)')
        assert.strictEqual(logKey('id', undefined), '(typeof string)')
        for (let k of ['__proto__', 'constructor', 'toString']) {
            assert.strictEqual(logKey(k, ['id', 'account']), '(typeof string)', `原型鏈名稱 ${k} 非名單內`)
        }
    })

})


//
// 站點全集(原始碼盤點): server/ 全部與 srv.mjs 之活碼 console 呼叫, 其每個引數皆須屬下列允許形態之一; 新增或改寫站點若輸出原始變數(使用者物件、請求值、錯誤物件、設定值)即失敗,
// 須改用 logType / logKey / diag.brief 或先登錄於 DYN_ARGS(附判定理由)。站點之數量依檔鎖定, 新增站點須同時更新(盤點表見 sgud/rule/rulebook_security.md R-LOG-01)。
//
describe('SITE-CNL 站點全集(原始碼盤點; R-LOG-01)', function() {

    //listMjs: 目錄下全部 .mjs(遞迴)
    let listMjs = (dir) => {
        let out = []
        for (let f of fs.readdirSync(dir, { withFileTypes: true })) {
            let p = `${dir}/${f.name}`
            if (f.isDirectory()) {
                out.push(...listMjs(p))
            }
            else if (/\.mjs$/.test(f.name)) {
                out.push(p)
            }
        }
        return out
    }

    //matchEnd: 自 s[i](須為 '(')起配對括號, 回傳配對之 ')' 之索引(略過引號內之括號); 配不到回 -1
    let matchEnd = (s, i) => {
        let d = 0
        let q = ''
        for (let k = i; k < s.length; k++) {
            let ch = s[k]
            if (q !== '') {
                if (ch === '\\') {
                    k++
                }
                else if (ch === q) {
                    q = ''
                }
                continue
            }
            if (ch === '\'' || ch === '"' || ch === '`') {
                q = ch
            }
            else if (ch === '(') {
                d++
            }
            else if (ch === ')') {
                d--
                if (d === 0) {
                    return k
                }
            }
        }
        return -1
    }

    //consoleCalls: 去註解後之 console.<方法>( ... ) 呼叫文字(空白收斂)
    let consoleCalls = (file) => {
        let c = stripComments(fs.readFileSync(file, 'utf8'))
        let out = []
        let re = /console\.(log|warn|error|info|debug|trace|table|dir)\(/g
        let m = null
        while ((m = re.exec(c)) !== null) {
            let j = matchEnd(c, m.index + m[0].length - 1)
            assert.ok(j > 0, `${file}: console 呼叫括號未配對`)
            out.push(c.slice(m.index, j + 1).replace(/\s+/g, ' '))
        }
        return out
    }

    //splitArgs: 以頂層逗號切引數
    let splitArgs = (call) => {
        let inner = call.slice(call.indexOf('(') + 1, call.length - 1)
        let args = []
        let cur = ''
        let d = 0
        let q = ''
        for (let k = 0; k < inner.length; k++) {
            let ch = inner[k]
            if (q !== '') {
                cur += ch
                if (ch === '\\') {
                    cur += inner[++k]
                }
                else if (ch === q) {
                    q = ''
                }
                continue
            }
            if (ch === '\'' || ch === '"' || ch === '`') {
                q = ch
            }
            else if ('([{'.includes(ch)) {
                d++
            }
            else if (')]}'.includes(ch)) {
                d--
            }
            else if (ch === ',' && d === 0) {
                args.push(cur.trim())
                cur = ''
                continue
            }
            cur += ch
        }
        if (cur.trim() !== '') {
            args.push(cur.trim())
        }
        return args
    }

    //isCall: a 恰為單一函數呼叫 name(...)(首個括號之配對即結尾)
    let isCall = (a, name) => a.startsWith(`${name}(`) && matchEnd(a, name.length) === a.length - 1

    //DYN_ARGS: 允許直接輸出之動態運算式(逐項附判定); 其餘動態運算式一律不允許
    let DYN_ARGS = [
        'tn', //伺服器時鐘(procCore _refreshToken 已過期分支; 程式自產, 非輸入)
        'typeof url', //WWebSso 建構參數 url 無效時只給型別(不輸出連線字串)
        'fpEntryIn', //WWebSso 入口檔(index.tmp / index.html)之路徑: 由內建常數與啟動路徑推導, 非輸入
        'Object.keys(headers || {})', //procProtect 取不到來源 IP 時之標頭名稱(鍵名; 值不印)
    ]
    //樣板字串內允許之插值: logKey(欄位名, 欄位名單)、logBoot 之等級與訊息(logBoot 之訊息由各呼叫點組成, 另見 SITE-CNL-005 之呼叫點盤點)、入口檔名常數
    let isOkInterp = (e) => {
        e = e.trim()
        return (/^logKey\(\w+, [\w.]+\)$/.test(e) && isCall(e, 'logKey')) || ['level.toUpperCase()', 'msg', 'fnEntryOut'].includes(e)
    }

    let isOkArg = (a) => {
        if (/^'[^']*'$/.test(a) || /^"[^"]*"$/.test(a)) {
            return true
        }
        if (/^`[^`]*`$/.test(a)) {
            return [...a.matchAll(/\$\{([^}]*)\}/g)].every((m) => isOkInterp(m[1]))
        }
        if (/^diag\.brief\(\w+\)$/.test(a) || /^getDiagBriefErr\(\w+\)$/.test(a)) {
            return true
        }
        if (isCall(a, 'logType')) {
            return true
        }
        if (isCall(a, 'logKey') && /^logKey\(\w+, [\w.]+\)$/.test(a)) {
            return true
        }
        return DYN_ARGS.includes(a)
    }

    //盤點範圍: server/ 全部、srv.mjs(示範入口)、g_initialData.mjs 與 g_initialTestData.mjs(離線種子腳本之 catch); g.mjs 為時間字串試算之草稿腳本(只印試算用之時間值), 不在此列
    let files = [...listMjs('./server'), './srv.mjs', './g_initialData.mjs', './g_initialTestData.mjs']

    it('SITE-CNL-001 每個活碼 console 呼叫之引數皆為固定字串、logType / logKey、diag.brief / getDiagBriefErr 或 DYN_ARGS 登錄者(不輸出原始變數)', function() {
        let bad = []
        let total = 0
        for (let f of files) {
            for (let call of consoleCalls(f)) {
                total++
                for (let a of splitArgs(call)) {
                    if (!isOkArg(a)) {
                        bad.push(`${f}: ${call}  <- 引數 ${a}`)
                    }
                }
            }
        }
        assert.ok(total > 0)
        assert.deepStrictEqual(bad, [])
    })

    it('SITE-CNL-002 站點數量依檔鎖定(server/ 全部 + srv.mjs + 離線種子腳本): 新增或刪除站點須同步更新本表與帳本 R-LOG-01 之站點全表', function() {
        let counts = {}
        for (let f of files) {
            let n = consoleCalls(f).length
            if (n > 0) {
                counts[f.replace(/^\.\//, '')] = n
            }
        }
        assert.deepStrictEqual(counts, {
            'g_initialData.mjs': 2,
            'g_initialTestData.mjs': 2,
            'server/WWebSso.mjs': 10,
            'server/procCore.mjs': 48,
            'server/procProtect.mjs': 5,
            'srv.mjs': 1,
        })
    })

    it('SITE-CNL-003 錯誤物件不經原始變數輸出: server/ 內無 console.<方法>(...err / errTemp / errMasked ...) 以原始變數為引數者; 錯誤一律經 diag.brief / getDiagBriefErr', function() {
        let hits = []
        for (let f of files) {
            for (let call of consoleCalls(f)) {
                for (let a of splitArgs(call)) {
                    if (/^(err|errTemp|errMasked|error|e|res|u|user|row|rows|payload|body|input)$/.test(a)) {
                        hits.push(`${f}: ${call}`)
                    }
                }
            }
        }
        assert.deepStrictEqual(hits, [])
        //procCore 與 procProtect 之 console 不使用 maskKv(原 ADR-068 M 契約之 console 規則已為 ADR-101 取代; srLog 記錄之 maskKv 不在此限)
        for (let f of ['./server/procCore.mjs', './server/procProtect.mjs', './server/WWebSso.mjs']) {
            assert.ok(!consoleCalls(f).some((c) => /\bmask(Kv|Token|Url)\(/.test(c)), `${f}: console 不得再輸出經 maskKv / maskToken / maskUrl 之值(值本身不印)`)
        }
    })

    it('SITE-CNL-004 引用方後端執行之 src/ 模組(排除僅瀏覽器執行之 baselineOf、plugins/mUI)恰一個活碼 console 站點: fetchSsoMsg 之診斷行, 其明細不含 url', function() {
        let browserOnly = ['./src/baselineOf.mjs', './src/plugins/mUI.mjs']
        let counts = {}
        for (let f of listMjs('./src')) {
            if (browserOnly.includes(f)) {
                continue
            }
            let n = consoleCalls(f).length
            if (n > 0) {
                counts[f.replace(/^\.\//, '')] = n
            }
        }
        assert.deepStrictEqual(counts, { 'src/fetchSsoMsg.mjs': 1 })
        // eslint-disable-next-line no-template-curly-in-string
        assert.deepStrictEqual(consoleCalls('./src/fetchSsoMsg.mjs'), ['console.log(`[w-web-sso] ${name} ${key} ${JSON.stringify(detail)}`)'])
        let c = stripComments(fs.readFileSync('./src/fetchSsoMsg.mjs', 'utf8'))
        assert.ok(!/\burl\s*:\s*urlLog\b/.test(c) && !/\bmaskUrl\b/.test(c), 'fetchSsoMsg 之診斷明細不含網址')
        let calls = [...c.matchAll(/logFail\(name, (\w+), \{([^}]*)\}\)/g)].map((m) => ({ key: m[1], keys: [...m[2].matchAll(/(\w+):/g)].map((x) => x[1]) }))
        assert.deepStrictEqual(calls, [
            { key: 'keyRequest', keys: ['errName', 'errCode', 'status'] },
            { key: 'keyData', keys: ['ssoState', 'ssoMsg', 'bodyType'] },
            { key: 'keyNoData', keys: [] },
        ])
    })

    it('SITE-CNL-005 WWebSso 之 logBoot(console 與 srLog 雙寫)呼叫點之訊息不含傳入值: 模板字串之插值僅限鍵名清單(ignoredOrmKeys)、程式自算之計數與預設網址、diag.brief 摘要、label(settings 鍵名)', function() {
        let c = stripComments(fs.readFileSync('./server/WWebSso.mjs', 'utf8'))
        let interps = []
        let re = /logBoot\('(?:info|warn|error)', (`[^`]*`|'[^']*')\)/g
        let m = null
        let n = 0
        while ((m = re.exec(c)) !== null) {
            n++
            interps.push(...[...m[1].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]))
        }
        assert.strictEqual(n, 7, 'logBoot 呼叫點')
        assert.deepStrictEqual(interps, [
            'ignoredOrmKeys.join(\'、\')', //settings / optExt 中被忽略之鍵名(鍵名, 非值)
            'label', //settings 鍵名
            'verifyBaseUrl', //未提供時之預設 http://localhost:<已正規化之正整數埠>, 程式自算
            'r.marked', 'r.system', 'r.retired', //遷移計數
            'JSON.stringify(diag.brief(err))', //遷移失敗之錯誤摘要
        ])
    })

})
