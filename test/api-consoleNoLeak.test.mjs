import assert from 'assert'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn } from 'child_process'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'


//
// console 診斷不輸出資料值之端到端 (R-LOG-01; spec: spec/設計要點與取捨.md ADR-101; 跨套件規格 dspec〈診斷輸出與遮罩〉D2、〈輸入參數之檢測機制〉V20; 單元層見 unit-consoleNoLeak)
//
// 規則: 真行程之 stdout / stderr 皆不含識別值 SECRET、後端錯誤原文標記 ERRTXT 與被封鎖之來源 IP; 只出現鍵名、型別、固定詞彙與錯誤摘要。
// 作法: 獨立後端(test/tools/srvConsoleLeak.mjs: 私有埠 11309、私有 lmdb 與 log 資料夾於 test/_tmp/api-consoleNoLeak/, 不碰 11007 與 ./db),
//   正式 WWebSso 搭配包裝 w-orm-lmdb 之 WOrm; 選項把 SECRET 置於設定值(pathTemplate、verifyEmailResultContent 之路徑、寄信主機), 請求把 SECRET 置於權杖、使用者姓名,
//   開關檔存在時 users / tokens 之 select 以含 ERRTXT 與 SECRET 之 Error reject, ips 表遇指定 IP 時回封鎖中之虛擬列。
//   觸發: 啟動期(設定值警告)、GET /api/checkToken(內層 reject)、資料通道 POST /api/main 帶 X-Forwarded-For(verifyConn 封鎖分支)、RPC createUser(寄信失敗)。
//   後端 stdout 與 stderr 合併收集, 於各步驟之前後取增量斷言。
//

let PORT = 11309
let TMP = path.resolve('./test/_tmp/api-consoleNoLeak')
let DB_URL = path.join(TMP, 'db')
let LOG_FD = path.join(TMP, 'logs')
let REJECT_FILE = path.join(TMP, 'reject.flag')
let SECRET = 'ZZ-secret-9317'
let ERRTXT = 'ZZ-errtext-4408'
let BLOCK_IP = '203.0.113.77'
let PW = 'Zq#8765Wm'
let apiUrl = `http://127.0.0.1:${PORT}`

let child = null
let out = ''
let exited = false


function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


//canConnect: 埠是否有人監聽
function canConnect() {
    return new Promise((resolve) => {
        let s = net.connect({ port: PORT, host: '127.0.0.1' })
        s.once('connect', () => {
            s.destroy()
            resolve(true)
        })
        s.once('error', () => {
            resolve(false)
        })
    })
}


//rmTmp: 刪 test/_tmp/api-consoleNoLeak(lmdb 檔案於行程結束後才釋放, 重試)
async function rmTmp() {
    for (let k = 0; k < 20; k++) {
        try {
            fs.rmSync(TMP, { recursive: true, force: true })
            if (!fs.existsSync(TMP)) {
                return
            }
        }
        catch (err) {
            //重試
        }
        await sleep(250)
    }
}


//callRpc: 直打 POST /api/main(同 api-ormdiag); 回傳 { ok, msg }
async function callRpc(funcName, args, token = 'dummy') {
    let payload = { func: funcName, input: { __sysInputArgs__: args, __sysToken__: token } }
    let r = await fetch(`${apiUrl}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let respObj = u8arr2obj(new Uint8Array(await r.arrayBuffer()))
    let o = respObj && respObj.success ? respObj.success.output : null
    if (o && o.state === 'success') {
        return { ok: true, msg: o.msg }
    }
    return { ok: false, msg: o ? o.msg : null }
}


//cut: 取 out 自 from 起之增量
let cut = (from) => out.slice(from)


//assertNoLeak: 文字不含識別值、後端錯誤原文與被封鎖之 IP
function assertNoLeak(text, label) {
    for (let x of [SECRET, SECRET.toLowerCase(), ERRTXT, BLOCK_IP]) {
        assert.ok(!text.includes(x), `${label}: stdout/stderr 不得含 ${x}:\n${text}`)
    }
}


describe('api-consoleNoLeak console 診斷不輸出資料值之端到端 (R-LOG-01, ADR-101)', function() {

    before(async function() {
        this.timeout(120000)
        if (await canConnect()) {
            throw new Error(`port ${PORT} 已被佔用, api-consoleNoLeak 需要專屬埠(請先確認並釋放)`)
        }
        await rmTmp()
        fs.mkdirSync(LOG_FD, { recursive: true })
        child = spawn(process.execPath, ['test/tools/srvConsoleLeak.mjs'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                CNL_PORT: String(PORT),
                CNL_DB_URL: DB_URL,
                CNL_LOG_FD: LOG_FD,
                CNL_REJECT_FILE: REJECT_FILE,
                CNL_SECRET: SECRET,
                CNL_ERRTXT: ERRTXT,
                CNL_BLOCK_IP: BLOCK_IP,
            },
        })
        child.stdout.on('data', (d) => {
            out += d.toString()
        })
        child.stderr.on('data', (d) => {
            out += d.toString()
        })
        child.on('exit', () => {
            exited = true
        })
        let t0 = Date.now()
        // eslint-disable-next-line no-unmodified-loop-condition
        while (!(await canConnect())) {
            if (exited) {
                throw new Error(`srvConsoleLeak 提前結束: ${out.slice(-1000)}`)
            }
            if (Date.now() - t0 > 90000) {
                throw new Error(`srvConsoleLeak 啟動逾時: ${out.slice(-1000)}`)
            }
            await sleep(300)
        }
    })

    after(async function() {
        this.timeout(30000)
        if (child !== null && !exited) {
            child.kill()
            let t0 = Date.now()
            // eslint-disable-next-line no-unmodified-loop-condition
            while (!exited && Date.now() - t0 < 15000) {
                await sleep(100)
            }
        }
        //回驗: 行程已結束且埠已釋放
        assert.ok(exited, '後端行程已結束')
        assert.strictEqual(await canConnect(), false, `port ${PORT} 已釋放`)
        await rmTmp()
        assert.ok(!fs.existsSync(TMP), 'test/_tmp/api-consoleNoLeak 已清除')
    })

    it('CNL-A01 啟動期: 設定值(路徑、寄信主機)含識別值時, 警告只列 settings 鍵名與固定詞彙, 不輸出設定值; 已忽略之設定鍵只列鍵名', async function() {
        //spec(dspec D2 / V20): 傳入參數值(含設定值)不輸出. 啟動期之 logBoot 為 console 與 srLog 雙寫, 兩處皆不含設定值
        assertNoLeak(out, '啟動期')
        assert.ok(out.includes('settings.pathTemplate 指定之資料夾不存在, 改採套件內建模板'), `pathTemplate 警告(固定詞彙): ${out}`)
        assert.ok(out.includes('settings.verifyEmailResultContent 疑似檔案路徑但檔案不存在, 將原樣視為文字'), `verifyEmailResultContent 警告(只列鍵名): ${out}`)
        assert.ok(out.includes('useCheckUser'), `已忽略之設定鍵只列鍵名: ${out}`)
        //srLog(boot 事件之 msg)亦不含設定值
        await sleep(1500)
        let logs = ''
        for (let f of fs.readdirSync(LOG_FD)) {
            logs += fs.readFileSync(path.join(LOG_FD, f), 'utf8')
        }
        assert.ok(logs.includes('boot'), 'srLog 有 boot 事件')
        for (let x of [SECRET, SECRET.toLowerCase()]) {
            assert.ok(!logs.includes(x), `srLog 之 boot 事件不得含 ${x}`)
        }
    })

    it('CNL-A02 GET /api/checkToken: 無效權杖(固定詞彙)與資料表錯誤(含原文與識別值)之 console 皆不含識別值與原文, 只印錯誤摘要; 回應為固定 key', async function() {
        this.timeout(60000)
        let from = out.length
        let r = await fetch(`${apiUrl}/api/checkToken?token=${SECRET}`)
        let j = await r.json()
        assert.strictEqual(j.state, 'error')
        await sleep(300)
        assert.ok(cut(from).includes('invalid token'), `固定詞彙: ${cut(from)}`)
        assertNoLeak(cut(from), 'checkToken 無效權杖')

        //資料表錯誤原文(含 ERRTXT 與 SECRET)
        fs.writeFileSync(REJECT_FILE, 'on')
        from = out.length
        try {
            r = await fetch(`${apiUrl}/api/checkToken?token=${SECRET}`)
            j = await r.json()
            await sleep(300)
        }
        finally {
            fs.rmSync(REJECT_FILE, { force: true })
        }
        assert.strictEqual(j.state, 'error')
        let s = cut(from)
        assert.ok(s.includes('checkToken inner reject') && s.includes('errType'), `只印錯誤摘要: ${s}`)
        assertNoLeak(s, 'checkToken 資料表錯誤')
        assert.ok(!JSON.stringify(j).includes(ERRTXT), '回應不含後端錯誤原文')
    })

    it('CNL-A03 verifyConn 封鎖分支: 被封鎖之來源 IP(請求之值)不輸出於 console, 只印事件; 請求被拒', async function() {
        this.timeout(60000)
        let from = out.length
        let r = await fetch(`${apiUrl}/api/main`, { method: 'POST', headers: { 'X-Forwarded-For': BLOCK_IP }, body: 'x' })
        assert.ok(r.status >= 400 || (r.headers.get('return-msg') || '') === 'permission denied', `被封鎖之請求被拒: status=${r.status} msg=${r.headers.get('return-msg')}`)
        await sleep(300)
        let s = cut(from)
        assert.ok(s.includes('block ip'), `應印封鎖事件(固定詞彙): ${s}`)
        assertNoLeak(s, 'verifyConn 封鎖')
    })

    it('CNL-A04 RPC createUser 寄信失敗(寄信主機名稱解析失敗, 錯誤原文含識別值): console 只印錯誤摘要, 不含原文、主機、姓名、收件者', async function() {
        this.timeout(120000)
        let from = out.length
        let r = await callRpc('createUser', ['eng', 'zzcnl9317', PW, PW, SECRET, 'zz9317@example.com'])
        assert.strictEqual(r.ok, true, `createUser: ${JSON.stringify(r)}`) //寄信失敗不中斷註冊(ADR-018)
        await sleep(500)
        let s = cut(from)
        assert.ok(s.includes('send verify email error') && s.includes('errType'), `只印錯誤摘要: ${s}`)
        assertNoLeak(s, 'createUser 寄信失敗')
        assert.ok(!s.includes('zz9317@example.com'), `console 不得含收件者: ${s}`)
        assert.ok(!s.includes('getaddrinfo'), `console 不得含錯誤原文: ${s}`)
    })

    it('CNL-A05 全程對照: 後端 stdout / stderr 自啟動起全文不含識別值、後端錯誤原文與被封鎖之 IP', async function() {
        assertNoLeak(out, '全文')
    })

})
