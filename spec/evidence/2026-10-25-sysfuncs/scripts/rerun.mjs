//rerun.mjs — 逐檔隔離重跑指定之 e2e 檔與案例(sso-run01 暫存; 每次皆換全新後端)
//環境變數 TARGETS="檔名:grep,檔名:grep,..."(grep 可省); 例: e2e-concurrency.test.mjs:E2E-CC-003
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { runIsolatedE2e, killPortListeners } from '../../test/tools/e2eLib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url)) //tmp/sso-run01
const projRoot = join(__dirname, '..', '..')

let items = (process.env.TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    let i = s.indexOf(':')
    return i < 0 ? { file: s, grep: '' } : { file: s.slice(0, i), grep: s.slice(i + 1) }
})
if (items.length === 0) {
    throw new Error('TARGETS 未給')
}

let { results, failed } = await runIsolatedE2e({
    projRoot,
    testDir: join(projRoot, 'test'),
    targets: items,
    beforeEachFile: async () => {
        killPortListeners(11007)
        await new Promise((resolve) => setTimeout(resolve, 2000))
    },
    afterAll: () => {
        killPortListeners(11007)
        killPortListeners(8080)
    },
})
console.log('[rerun] results', JSON.stringify(results))
process.exit(failed === 0 ? 0 : 1)
