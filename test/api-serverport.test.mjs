//api-serverport.test.mjs — 部署設定未給或給無效之 serverPort 時, 後端於預設 11007 就緒 (ADR-085)
//
// 依據: server/WWebSso.mjs 之 JSDoc「optExt.serverPort=11007」; spec/設計要點與取捨.md ADR-085
//   - serverPort 未給或非正整數時, 後端監聽 11007(與驗證信連結之回退網址 http://localhost:11007 為同一個值)
//   - 修改前: hapi 收到未正規化之 opt.serverPort, 未給或無效時改聽 w-serv-hapi 之預設 8080
//     (api 測試期間 8080 為前端 dev server, 後端綁定失敗; 11007 永不就緒)
// 作法: 真後端以缺 serverPort 鍵(SP-001)或 serverPort:'abc'(SP-002)之臨時 settings 重啟;
//   genTempSettings 只能改值不能缺鍵(CLAUDE_experience.md 套件身分第 5 條), 故自寫 settings 至 test/_tmp/api-serverport/;
//   檔尾以預設 settings 重啟並刪除該目錄.

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import JSON5 from 'json5'
import { startServersOnce, apiUrl } from './tools/api-setup.mjs'
import { restartBackend } from './tools/e2e-setup.mjs'


let fdTmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'api-serverport')


//writeSettings: 以 ./settings.json(JSON5)為底, 經 mutate 改寫後寫出純 JSON
function writeSettings(name, mutate) {
    let st = JSON5.parse(fs.readFileSync('./settings.json', 'utf8'))
    mutate(st)
    fs.mkdirSync(fdTmp, { recursive: true })
    let fp = path.join(fdTmp, `${name}.json`)
    fs.writeFileSync(fp, JSON.stringify(st, null, 4))
    return fp
}


describe('部署設定之 serverPort 缺省 / 無效時之監聽埠 (ADR-085)', function() {
    this.timeout(180000)

    before(async function() {
        await startServersOnce()
    })

    after(async function() {
        await restartBackend('./settings.json') //還原預設 settings
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    let cases = [
        ['SP-001', '未給 serverPort', (st) => {
            delete st.serverPort
        }],
        ['SP-002', '給非正整數之 serverPort(\'abc\')', (st) => {
            st.serverPort = 'abc'
        }],
    ]
    for (let [id, label, mutate] of cases) {
        it(`${id} ${label}: 後端於 11007 就緒並回應`, async function() {
            let fp = writeSettings(id, mutate)
            //spec: 後端監聽 11007——restartBackend 等 11007 就緒, 逾時即拋錯(修改前後端改聽 8080 而逾時)
            await restartBackend(fp)
            //spec: 於 11007 回應 HTTP 端點; 不存在之權杖 → checkToken 之錯誤 key(ADR-006)
            let r = await fetch(`${apiUrl}/api/checkToken?token=sp-no-such-token`)
            assert.strictEqual(r.status, 200)
            assert.deepStrictEqual(await r.json(), { state: 'error', msg: 'tokenExpired' })
        })
    }

})
