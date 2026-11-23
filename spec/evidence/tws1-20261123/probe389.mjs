//第 389 項負載探測(mocha 檔): 於同一行程內把 e2e-autoblock.test.mjs 載入 N 次(各自為獨立之模組實例, 其 describe／it 皆註冊), 以 --grep 只跑指定案例, 重複 N 輪
//  伺服端(後端與 dev server)由 startServersOnce 只起一次, 各輪共用; 每案仍為 fresh browser 與 DB 重置(案例管線不變)
//環境變數:
//  PROBE_N        重複輪數(預設 5)
//  PROBE_SOURCE   work(預設; 工作樹之測試檔)或 head(git HEAD 之測試檔, 即修前版; 經暫存副本載入)
//  PROBE_LATENCY_MS  >0 時於暫存副本中把「送往本機之請求」各延遲該毫秒才放行(非缺陷之時序變異: 模擬負載下資源載入與回應變慢, 見 dspec〈計時器相關函數之觀察回調與測試〉P7 末段;
//                 只改暫存副本, 不改專案之測試檔)
//用法(於套件根): PROBE_N=10 node node_modules/mocha/bin/mocha.js --no-parallel spec/evidence/tws1-20261123/probe389.mjs --grep "ip-expiry-implicit-unlock" --reporter spec/evidence/tws1-20261123/probe389-reporter.cjs --timeout 600000
//  通常由 probe389-run.mjs 於 CPU 壓力下啟動(見該檔)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

let n = Number(process.env.PROBE_N || 5)
let source = process.env.PROBE_SOURCE || 'work'
let lat = Number(process.env.PROBE_LATENCY_MS || 0)
let here = path.dirname(fileURLToPath(import.meta.url))
let repo = path.resolve(here, '..', '..', '..')
let fpWork = path.join(repo, 'test', 'e2e-autoblock.test.mjs')
let target = pathToFileURL(fpWork).href

if (source !== 'work' || lat > 0) {
    //暫存副本置於 test/_tmp/probe389/(gitignore; 相對匯入改為自該處起算)
    let text = source === 'head' ? execFileSync('git', ['-C', repo, 'show', 'HEAD:test/e2e-autoblock.test.mjs'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }) : fs.readFileSync(fpWork, 'utf8')
    text = text.replaceAll('from \'./tools/', 'from \'../../tools/').replaceAll('from \'../src/', 'from \'../../../src/').replaceAll('from \'../server/', 'from \'../../../server/').replaceAll('from \'../g_mOrm.mjs\'', 'from \'../../../g_mOrm.mjs\'')
    if (lat > 0) {
        let anchor = 'route.continue({ headers })'
        if (text.split(anchor).length !== 2) {
            throw new Error('延遲注入錨點不唯一')
        }
        text = text.replace(anchor, `setTimeout(() => { route.continue({ headers }).catch(() => {}) }, ${lat})`)
    }
    let fd = path.join(repo, 'test', '_tmp', 'probe389')
    fs.mkdirSync(fd, { recursive: true })
    let fp = path.join(fd, 'e2e-autoblock.copy.mjs')
    fs.writeFileSync(fp, text, 'utf8')
    target = pathToFileURL(fp).href
}
for (let i = 0; i < n; i++) {
    await import(`${target}?probe=${i}`)
}
