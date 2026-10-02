//逐檔隔離執行 e2e：每個 e2e 檔以「獨立 mocha 進程 + 全新後端」跑，前端 dev server 保持暖機共用（技能 §9.2）。
//
//why：多 e2e 檔塞單一 mocha 進程（`npm test` 的 mocha 全 glob）會共用被前面測試改過狀態的後端（in-memory 計數 / 快取 /
//  被 restartBackend 換過 settings 之實例），與各檔 solo 自產之 baseline 環境不同；逐檔各給全新後端即回到 solo 之綠燈狀態。
//
//機制：每檔前只殺後端（11007，專屬本專案，CLAUDE.md 明文例外）、保留前端（8080，無狀態且啟動慢）。新 mocha 進程偵測 11007 沒人 → spawn 全新後端；
//  8080 已起 → reuse。測試檔以 pattern 動態列舉（新增之 e2e-*.test.mjs 自動納入）。2026-09-27 起組裝自 ./srcPack，2026-09-29 起為 w-package-tools-e2e（runIsolatedE2e、killPortListeners）。
//  2026-09-30 升 1.0.3 起，有本地 mocha 時以 node 直接執行 node_modules/mocha/bin/mocha.js、不經 shell（原為 npx mocha，Windows 下經 cmd.exe）。
//
//用法：node test/tools/run-e2e-isolated.mjs   (exit 0=全綠；非 0=有失敗檔)

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { runIsolatedE2e, killPortListeners } from './e2eLib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url)) //test/tools
const BACKEND_PORT = 11007

let { failed } = await runIsolatedE2e({
    projRoot: join(__dirname, '..', '..'),
    testDir: join(__dirname, '..'),
    beforeEachFile: async () => {
        //每檔前殺後端 → 新 mocha 進程自 spawn 全新後端；前端保持暖機（查詢工具不可用時不殺，同抽提前）
        killPortListeners(BACKEND_PORT)
        await new Promise((resolve) => setTimeout(resolve, 2000))
    },
    afterAll: () => {
        //收尾殺後端（前端留給使用者 / 後續）
        killPortListeners(BACKEND_PORT)
    },
})
process.exit(failed === 0 ? 0 : 1)
