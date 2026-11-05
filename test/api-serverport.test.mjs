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
import { BACKEND_PORT, reservation } from './tools/e2ePorts.mjs'


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
            //本案斷言產品之預設埠 11007 本身(缺鍵／無效時後端須聽 11007): 前提是 11007 為本實例所有。基準埠被他人占用而整組位移(ws309 自動換埠)、
            //或多開實例位移時, 本實例之後端埠不是 11007——預設埠無從驗起(強行啟動會綁到別人的 11007 或逾時), 且不得為此下殺占用者(規格 E4)。
            //明確略過並寫明原因(不靜默通過); 沒有位移(全套之 rest 段、單開且 11007 空閒)時照常驗, 此為環境前提而非常態略過。
            if (reservation.portOf(BACKEND_PORT) !== BACKEND_PORT) {
                this.skip()
            }
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
