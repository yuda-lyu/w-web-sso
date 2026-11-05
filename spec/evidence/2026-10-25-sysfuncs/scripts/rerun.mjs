//rerun.mjs — 逐檔隔離重跑指定之 e2e 檔與案例(sso-run01 暫存; 每次皆換全新後端)
//環境變數 TARGETS="檔名:grep,檔名:grep,..."(grep 可省); 例: e2e-concurrency.test.mjs:E2E-CC-003
//2026-11-05(ws309): 原 killPortListeners(11007)／(8080) 依埠下殺(會殺到別的套件正在跑之服務)已移除, 改與 test/tools/run-e2e-isolated.mjs 同形——
//  reservation.killOwnListeners 只殺身分已確認屬本實例者; 遇非本實例之監聽者或查不到監聽者即中止, 不下殺。本檔為歷史證據腳本(相對路徑為當時 tmp/sso-run01 之位置), 重跑須自行調整路徑。
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { runIsolatedE2e } from '../../test/tools/e2eLib.mjs'
import { BACKEND_PORT, reservation } from '../../test/tools/e2ePorts.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url)) //tmp/sso-run01
const projRoot = join(__dirname, '..', '..')

let items = (process.env.TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    let i = s.indexOf(':')
    return i < 0 ? { file: s, grep: '' } : { file: s.slice(0, i), grep: s.slice(i + 1) }
})
if (items.length === 0) {
    throw new Error('TARGETS 未給')
}

const killOwnBackend = async (strict) => {
    let port = reservation.portOf(BACKEND_PORT)
    let r = null
    for (let i = 0; i < 3; i++) {
        r = reservation.killOwnListeners(port)
        if (r.pids !== null) {
            break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    let why = r.pids === null ? `查詢埠 ${port} 監聽者之工具不可用, 無法確認` : (r.skipped.length > 0 ? `埠 ${port} 有非本實例之監聽者(PID ${r.skipped.join(', ')})` : '')
    if (why) {
        if (strict) {
            throw new Error(`[rerun] ${why}, 不下殺; 為免下一檔沿用別人之服務而中止`)
        }
        console.log(`[rerun] ${why}, 不下殺`)
    }
}

let { results, failed } = await runIsolatedE2e({
    projRoot,
    testDir: join(projRoot, 'test'),
    targets: items,
    beforeEachFile: async () => {
        await killOwnBackend(true)
        await new Promise((resolve) => setTimeout(resolve, 2000))
    },
    afterAll: async () => {
        await killOwnBackend(false)
    },
})
console.log('[rerun] results', JSON.stringify(results))
process.exit(failed === 0 ? 0 : 1)
