//逐檔隔離執行 e2e：每個 e2e 檔以「獨立 mocha 進程 + 全新後端」跑（技能 §9.2）；前端 dev server 由各 mocha 進程自起自停（2026-11-05 ws309 實測 log: 每檔皆「starting frontend … frontend ready」）。
//
//why：多 e2e 檔塞單一 mocha 進程（`npm test` 的 mocha 全 glob）會共用被前面測試改過狀態的後端（in-memory 計數 / 快取 /
//  被 restartBackend 換過 settings 之實例），與各檔 solo 自產之 baseline 環境不同；逐檔各給全新後端即回到 solo 之綠燈狀態。
//
//機制：每檔前只殺「本實例」之後端（基準埠 11007 經保留後之實際埠）。新 mocha 進程偵測後端埠沒人 → spawn 全新後端（前端 dev server 每個 mocha 進程各自起停，
//  沿用既有服務只在手動設 E2E_PORT_OFFSET 時；埠被他人占用則整組位移，不沿用、不下殺）。測試檔以 pattern 動態列舉（新增之 e2e-*.test.mjs 自動納入）。2026-09-27 起組裝自 ./srcPack，2026-09-29 起為 w-package-tools-e2e（runIsolatedE2e）。
//  2026-09-30 升 1.0.3 起，有本地 mocha 時以 node 直接執行 node_modules/mocha/bin/mocha.js、不經 shell（原為 npx mocha，Windows 下經 cmd.exe）。
//
//2026-11-05 起(排程第 309 項 ws309, 規格 E1～E4): 本 runner 於最上層(經 e2ePorts.mjs)先呼叫一次 reserveE2ePorts, 子行程之 mocha 繼承保留(E2E_PORT_HOLD／E2E_PORT_OFFSET)而不再各自換埠;
//  原 killPortListeners(依埠殺任何監聽者, 占用者可能是別的套件正在跑之測試; 2026-11-05 修前以真實占用者實測第一檔前即被殺)改為 reservation.killOwnListeners(只殺身分已確認屬本實例者);
//  該埠上有非本實例之監聽者、或查不到監聽者(取行程表失敗)時不殺並拋錯中止(不讓下一檔沿用別人之服務)。
//
//用法：node test/tools/run-e2e-isolated.mjs   (exit 0=全綠；非 0=有失敗檔)

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { runIsolatedE2e } from './e2eLib.mjs'
import { BACKEND_PORT, reservation } from './e2ePorts.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url)) //test/tools
//後端實際埠: 基準埠 11007 經保留後之實際埠(沒有占用且未設 E2E_PORT_OFFSET 時＝11007, 與導入前相同; 與 e2e-setup.mjs 同源)
const BACKEND_ACTUAL_PORT = reservation.portOf(BACKEND_PORT)

//只殺本實例之後端監聽者; 有非本實例之監聽者(skipped)不殺: strict 時拋錯中止(每檔前, 免下一檔沿用別人之服務), 否則只印出(收尾, 不遮蔽逐檔結果)。
//查不到監聽者(r.pids === null: 取行程表失敗, 高負載下偶發逾時)時先重試 3 次; 仍查不到＝無法確認埠上有無別人之服務: 不殺(取不到不殺), 且 strict 時同樣中止
//  (null 不得當成無人: 否則下一檔之 mocha 見埠有回應即沿用占用者之服務; w-web-api wa309 實測 34 次請求打到占用者)。
const killOwnBackend = async (strict) => {
    let r = null
    for (let i = 0; i < 3; i++) {
        r = reservation.killOwnListeners(BACKEND_ACTUAL_PORT)
        if (r.pids !== null) {
            break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (r.pids === null) {
        const msg = `[run-e2e-isolated] 查詢埠 ${BACKEND_ACTUAL_PORT} 監聽者之工具不可用(重試 3 次), 無法確認埠上有無非本實例之監聽者, 未殺`
        if (strict) {
            throw new Error(`${msg}; 為免下一檔沿用別人之服務而中止`)
        }
        console.log(msg)
    }
    else if (r.skipped.length > 0) {
        const msg = `[run-e2e-isolated] 埠 ${BACKEND_ACTUAL_PORT} 有非本實例之監聽者(PID ${r.skipped.join(', ')}), 不下殺(占用者可能是別的套件正在跑之測試)`
        if (strict) {
            throw new Error(`${msg}; 為免下一檔沿用別人之服務而中止`)
        }
        console.log(msg)
    }
    return r
}

let { failed } = await runIsolatedE2e({
    projRoot: join(__dirname, '..', '..'),
    testDir: join(__dirname, '..'),
    beforeEachFile: async () => {
        //每檔前殺本實例之後端 → 新 mocha 進程自 spawn 全新後端（前端亦由其自起）
        await killOwnBackend(true)
        await new Promise((resolve) => setTimeout(resolve, 2000))
    },
    afterAll: async () => {
        //收尾殺本實例之後端（前端留給使用者 / 後續）
        await killOwnBackend(false)
    },
})
process.exit(failed === 0 ? 0 : 1)
