//api-srlog-noleak.test.mjs — sso 後端寫入 srLog 前之權杖遮罩 (ADR-068)
//
// 對象 (server/WWebSso.mjs):
//   - 資料通道 verifyConn 記錄之 referer: 前端以 ?token= 開站, 同源請求依瀏覽器預設政策帶完整網址 → 只可記 origin + pathname
//   - HTTP 路由記錄之 token 欄: Hapi 對重複之 query 參數 (?token=a&token=b) 給陣列 → 須逐元素遮罩 (7 處在型別檢查前記 log)
//   - getSsoUserInfor(HTTP 路由與 kpfun 兩站點)記錄之 value 欄: key 為憑證欄 (如 tokenVerify) 時其值即憑證 → 非 id/account/email/name 一律遮罩
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
        await fetch(`${apiUrl}/api/getSsoUserInfor?token=token-for-app&key=tokenVerify&value=${TV}`).catch(() => {})
        await callFapi('getUserInfor', ['token-for-app', 'tokenVerify', TVK])

        //等 w-syslog 落檔
        await new Promise((r) => setTimeout(r, 2500))
        text = readLogsSince(t0)
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
        assert.ok(text.includes('"event":"kpfun-getUserInfor"'), 'kpfun getUserInfor 應有記錄 (確認該站點確實被觸發)')
    })

})
