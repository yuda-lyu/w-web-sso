//api-srlog-noleak.test.mjs — sso 後端寫入 srLog 前之權杖遮罩 (ADR-068)
//
// 對象 (server/WWebSso.mjs):
//   - 資料通道 verifyConn 記錄之 referer: 前端以 ?token= 開站, 同源請求依瀏覽器預設政策帶完整網址 → 只可記 origin + pathname
//   - HTTP 路由記錄之 token 欄: Hapi 對重複之 query 參數 (?token=a&token=b) 給陣列 → 須逐元素遮罩 (7 處在型別檢查前記 log)
//   - getSsoUserInfor(HTTP 路由與 kpfun 兩站點)記錄之 value 欄: key 為憑證欄 (如 tokenVerify) 時其值即憑證 → 非 id/account/email/name 一律遮罩
//     (R-QKEY-01: 欄位名白名單 id/account/email/name 置於 srLog.info 之後——白名單外之查詢被 reject, 但稽核紀錄仍留且 value 已遮罩;
//      故以 tokenVerify 探測仍可由真後端觀察 log 遮罩, 並同時驗 reject 為固定 key、回應不回顯查詢值)
// 作法: 以含時間戳之唯一合成值打真後端 (startServersOnce: 11007), 待 log 落檔後讀本次後端之 srLog 檔
//   (settings.json 之 logFd = './logs'; w-syslog 每行一筆 JSON), 斷言合成值不出現. 本檔不寫 DB.

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { startServersOnce, apiUrl, callFapi } from './tools/api-setup.mjs'


let logFd = './logs' //與 settings.json 之 logFd 一致 (backend 以專案根為 cwd 啟動)
let stamp = Date.now()
let REF = `SYNTH-REF-${stamp}-aaaa`
let ARR1 = `SYNTH-ARR1-${stamp}-bbbb`
let ARR2 = `SYNTH-ARR2-${stamp}-cccc`
let TV = `SYNTH-TV-${stamp}-dddd`
let TVK = `SYNTH-TVK-${stamp}-eeee`
let LONGK = `LK${stamp}`.padEnd(3000, 'q') //3000 字元之欄位名
let LONGV = `LV${stamp}`.padEnd(3000, 'w') //3000 字元之查詢值


//讀取 t0 之後有寫入之 log 檔全文 (跨整點時可能分屬兩檔)
function readLogsSince(t0) {
    let text = ''
    for (let f of fs.readdirSync(logFd)) {
        let p = path.join(logFd, f)
        if (fs.statSync(p).mtimeMs >= t0 - 1000) {
            text += fs.readFileSync(p, 'utf8')
        }
    }
    return text
}


describe('sso srLog 權杖遮罩 — referer / 陣列 token / 憑證欄查詢值 (ADR-068)', function() {
    this.timeout(60000)

    let text = ''
    let textNew = '' //本次 t0 之後才寫出之 log 行: log 檔含該整點內歷次執行之記錄, 遮罩形式(只露前後字元與長度)又與歷次相同, 故「記錄存在」類斷言須以 time 欄過濾
    let respHttp = null //HTTP 探測之回應本體
    let respFapi = null //kpfun 探測之結果

    before(async function() {
        await startServersOnce()
        let t0 = Date.now()

        //資料通道: verifyConn 先記 log 再解析本體, 本體無效不影響記錄
        await fetch(`${apiUrl}/api/main`, {
            method: 'POST',
            headers: { 'Referer': `${apiUrl}/?view=x&token=${REF}`, 'Content-Type': 'application/octet-stream' },
            body: 'x',
        }).catch(() => {})

        //重複 token 參數 → Hapi 解析為陣列
        await fetch(`${apiUrl}/api/checkToken?token=${ARR1}&token=${ARR2}`).catch(() => {})

        //key 為憑證欄之查詢: HTTP 路由與 kpfun 各記一筆 value (同一規則之兩個站點)
        //(白名單置於 srLog.info 之後: 兩者皆被 reject, 但記錄在 reject 之前寫出)
        respHttp = await fetch(`${apiUrl}/api/getSsoUserInfor?token=token-for-app&key=tokenVerify&value=${TV}`).then((r) => r.json()).catch(() => null)
        respFapi = await callFapi('getUserInfor', ['token-for-app', 'tokenVerify', TVK])

        //使用端可控之長字串(R-QKEY-01 規則 6): 3000 字元之欄位名(白名單外、被拒)與白名單內欄位之 3000 字元查詢值, 兩入口各一
        await fetch(`${apiUrl}/api/getSsoUserInfor?token=token-for-app&key=${LONGK}&value=short`).catch(() => {})
        await fetch(`${apiUrl}/api/getSsoUserInfor?token=token-for-app&key=account&value=${LONGV}`).catch(() => {})
        await callFapi('getUserInfor', ['token-for-app', LONGK, 'short'])
        await callFapi('getUserInfor', ['token-for-app', 'account', LONGV])

        //等 w-syslog 落檔
        await new Promise((r) => setTimeout(r, 2500))
        text = readLogsSince(t0)
        textNew = text.split('\n').filter((l) => {
            try {
                return JSON.parse(l).time >= t0
            }
            catch (err) {
                return false
            }
        }).join('\n')
    })

    it('LOG-001-referer: verifyConn 之 referer 只記 origin + pathname, 不含 query 之權杖', function() {
        assert.strict.equal(text.includes(REF), false, 'srLog 不得含 referer 之權杖')
        assert.ok(text.includes(`"referer":"${apiUrl}/"`), `srLog 應記 referer 之 origin + pathname (${apiUrl}/)`)
    })

    it('LOG-002-array-token: 重複 token 參數 (陣列) 逐元素遮罩', function() {
        assert.strict.equal(text.includes(ARR1), false, 'srLog 不得含陣列 token 之第 1 個元素')
        assert.strict.equal(text.includes(ARR2), false, 'srLog 不得含陣列 token 之第 2 個元素')
    })

    it('LOG-003-credential-key-value: getSsoUserInfor 之 key 為 tokenVerify 時, value 遮罩 (HTTP 路由與 kpfun 兩站點)', function() {
        assert.strict.equal(text.includes(TV), false, 'srLog 不得含憑證欄查詢值 (HTTP /api/getSsoUserInfor)')
        assert.strict.equal(text.includes(TVK), false, 'srLog 不得含憑證欄查詢值 (kpfun getUserInfor)')
        assert.ok(textNew.includes('"event":"kpfun-getUserInfor"'), 'kpfun getUserInfor 應有記錄 (確認該站點確實被觸發)')
        assert.ok(textNew.includes('"event":"api/getSsoUserInfor"'), 'HTTP getSsoUserInfor 應有記錄 (確認該站點確實被觸發)')
        //兩站點之記錄皆帶 key=tokenVerify 與已遮罩之 value(只留前後字元與長度)
        //(len= 須為各自查詢值之長度: 遮罩的是 value 而非 token 等他欄)
        for (let [ev, v] of [['api/getSsoUserInfor', TV], ['kpfun-getUserInfor', TVK]]) {
            //(同一次 mocha 行程內他檔之測試亦可能寫出同 event 同 key 之記錄, 故以本檔合成值之遮罩形式精確比對)
            let lines = textNew.split('\n').filter((l) => l.includes(`"event":"${ev}"`) && l.includes('"key":"tokenVerify"'))
            assert.ok(lines.length > 0, `${ev} 之記錄應帶 key=tokenVerify`)
            //maskToken 規則: 露出前後各 k=min(4, floor(n/8)) 字元與長度(R-SEC-01 / ADR-068)
            let k = Math.min(4, Math.floor(v.length / 8))
            let mask = `"value":"${v.slice(0, k)}...${v.slice(-k)}(len=${v.length})"`
            assert.ok(lines.some((l) => l.includes(mask)), `${ev} 之 value 應為 maskKv 形式(前後各 ${k} 字元與長度 ${v.length}): ${mask}`)
        }
    })

    it('LOG-005-long-user-strings-capped: 使用端可控之長欄位名與識別欄長查詢值入 log 前截斷(256 字元 + ...(len=N)), 兩入口皆然 (R-QKEY-01 規則 6)', function() {
        let cap = (s) => `${s.slice(0, 256)}...(len=${s.length})`
        //完整長字串(或其超過 256 字元之部分)不得入 log
        assert.strict.equal(textNew.includes(LONGK.slice(0, 300)), false, 'log 不得含欄位名超過 256 字元之部分')
        assert.strict.equal(textNew.includes(LONGV.slice(0, 300)), false, 'log 不得含識別欄查詢值超過 256 字元之部分')
        for (let ev of ['api/getSsoUserInfor', 'kpfun-getUserInfor']) {
            let lines = textNew.split('\n').filter((l) => l.includes(`"event":"${ev}"`))
            assert.ok(lines.some((l) => l.includes(`"key":"${cap(LONGK)}"`)), `${ev} 之 key 應為截斷形式`)
            assert.ok(lines.some((l) => l.includes('"key":"account"') && l.includes(`"value":"${cap(LONGV)}"`)), `${ev} 之識別欄 value 應為截斷形式`)
        }
    })

    it('LOG-004-whitelist-after-log: 白名單外之查詢被 reject(固定 key invalidUserQueryKey), 回應不回顯查詢值; 記錄先於 reject 寫出 (R-QKEY-01)', function() {
        assert.ok(respHttp && respHttp.state === 'error', `HTTP 探測應被拒: ${JSON.stringify(respHttp)}`)
        assert.strict.equal(respHttp.msg, 'invalidUserQueryKey')
        assert.strict.equal(JSON.stringify(respHttp).includes(TV), false, 'HTTP 回應不得回顯查詢值')
        assert.ok(respFapi && respFapi.ok === false, `kpfun 探測應被拒: ${JSON.stringify(respFapi)}`)
        assert.ok(String(respFapi.err).includes('invalidUserQueryKey'), JSON.stringify(respFapi))
        assert.strict.equal(String(respFapi.err).includes(TVK), false, 'kpfun 回應不得回顯查詢值')
        //HTTP 路徑之錯誤 key 亦入 log(原則3: 後端錯誤 log error key)
        assert.ok(textNew.includes('"key":"invalidUserQueryKey"'), 'log 應有 invalidUserQueryKey 之 error key')
    })

})
