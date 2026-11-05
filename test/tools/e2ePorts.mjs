//e2e 埠之單一定義與保留(排程第 309 項, 2026-11-05 ws309; 規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E1～E8; 套件 w-package-tools-e2e >= 1.0.22 README §2.12; 規則帳本 R-E2E-PORT-01)。
//
//本模組為「基準埠」唯一定義處, 並於模組載入時呼叫一次 reserveE2ePorts(本實例全部基準埠)——須早於任何 resolveE2ePort／createServiceManager:
//  e2e-setup.mjs 與 run-e2e-isolated.mjs 皆自本檔取得基準埠(ES 模組先評估被匯入者, 故先於其本體之任何取埠)。
//行為(沒有占用時與導入前相同):
//  - 基準埠 11007(後端)／8080(前端 dev server)皆空閒 → 即基準埠, E2E_PORT_OFFSET 維持未設, 標準圖與行為不變。
//  - 任一基準埠被占用(別的套件正在跑, 或本機其他服務; 8080 為 w-pubsub、w-serv-broadcast、w-flow-vue 之常用埠) → 整組位移 portStep(預設 100)至空閒之組,
//    位移寫入 E2E_PORT_OFFSET, 其後 resolveE2ePort／createServiceManager／子行程(含 vue.config.js 之 proxy 目標)一律取得同一組實際埠; 實際埠印入輸出([e2e-port] …)。絕不殺占用者(E4)。
//  - 手動設 E2E_PORT_OFFSET(含 0)＝不換埠(多開工具配發位移; 0 為「沿用本機已起之服務」逃生口); 上層已保留(E2E_PORT_HOLD; 逐檔 runner 之子行程、多開各組)＝沿用上層之位移。
//OTHER_TEST_PORTS 為本套件 api-／unit- 測試寫死之監聽埠(盤點 2026-11-05, 實查見規則帳本 R-E2E-PORT-01; 以 unit-e2ePortReserve PR-013 守護與實際寫死埠一致):
//  位移後之實際埠不得落在其上。11007 以間距 100 位移, 位移 300 時後端為 11307＝api-ormdiag 之私有埠, 故此清單實際生效(該位移直接跳過, 改試 400)。
//  這些測試埠本身與他套件(w-web-task 之 11309 等)之撞埠屬規格 E8(非 e2e 測試之監聽埠), 由測試閘 portGroups 互斥, 不在此處理。

import { reserveE2ePorts } from './e2eLib.mjs'

//api-／unit- 測試寫死之監聽埠: api-ormdiag 11307(私有後端)、api-consoleNoLeak 11309(私有後端)、unit-consoleNoLeak 11397(WWebSso serverPort)、
//  unit-diaglog 11398(net 伺服器)與 11399(WWebSso serverPort)
export const OTHER_TEST_PORTS = [11307, 11309, 11397, 11398, 11399]

//單元測試專用之基準埠覆寫(環境變數 E2E_PORTS_FOR_UNIT_TEST="<後端埠>,<前端埠>"): 占用情境之單元測試(unit-e2ePortReserve)以作業系統配發之動態埠當基準埠,
//  不在真實之 11007／8080 起占用者——8080 為多套件共用(w-pubsub、w-serv-broadcast、w-flow-vue), Windows 允許並存綁定而搶走對方之連線(規格 E5)。
//  只供單元測試之子行程設定; 正式與 e2e 執行一律不設, 此時基準埠即下列寫死值。值須為兩個相異之 1024～64999 整數, 且(含位移 0～300 之各組)不落在 OTHER_TEST_PORTS 上, 否則忽略(印警告, 不靜默採用不合理的值)。
//  生效時 e2e-setup 之 startServersOnce／restartBackend 直接拋錯(後端埠只由 settings.json 決定、前端指令與 vue.config.js 皆以 11007／8080 為準, 起服務會錯配), 產製標準圖亦視同位移而被擋。
const UNIT_TEST_PORTS_RAW = String(process.env.E2E_PORTS_FOR_UNIT_TEST || '').trim()
const UNIT_TEST_PORTS = UNIT_TEST_PORTS_RAW.split(',').map((s) => Number(s.trim()))
const useUnitTestPorts = UNIT_TEST_PORTS.length === 2 && UNIT_TEST_PORTS.every((n) => Number.isInteger(n) && n >= 1024 && n < 65000) && UNIT_TEST_PORTS[0] !== UNIT_TEST_PORTS[1] &&
    UNIT_TEST_PORTS.every((n) => [0, 100, 200, 300].every((o) => !OTHER_TEST_PORTS.includes(n + o)))
//覆寫生效或給了無效值時都印一行(誤設時從輸出即可看出, 不靜默)
if (useUnitTestPorts) {
    console.log(`[e2ePorts] 單元測試專用基準埠覆寫(E2E_PORTS_FOR_UNIT_TEST): 後端 ${UNIT_TEST_PORTS[0]}、前端 ${UNIT_TEST_PORTS[1]}`)
}
else if (UNIT_TEST_PORTS_RAW !== '') {
    console.log(`[e2ePorts] 警告: E2E_PORTS_FOR_UNIT_TEST="${UNIT_TEST_PORTS_RAW}" 無效(須為「後端埠,前端埠」兩個相異之 1024～64999 整數, 且不落在 OTHER_TEST_PORTS 上), 已忽略, 基準埠維持 11007／8080`)
}
export const UNIT_TEST_PORTS_ACTIVE = useUnitTestPorts

//後端基準埠(正式實例用; 與 settings.json 之 serverPort、WWebSso 之預設 11007 一致; 後端同時 serve build 後之 dist 與 API)。
//其餘組埠處一律經 resolveE2ePort(基準埠)／reservation.portOf(基準埠)。
export const BACKEND_PORT = useUnitTestPorts ? UNIT_TEST_PORTS[0] : 11007
//前端 dev server 基準埠(npm run serve; vue-cli 預設 8080)。dev server 之 proxy 目標由 vue.config.js 依 E2E_PORT_OFFSET 位移。
export const FRONTEND_PORT = useUnitTestPorts ? UNIT_TEST_PORTS[1] : 8080

export const reservation = reserveE2ePorts([BACKEND_PORT, FRONTEND_PORT], { avoid: OTHER_TEST_PORTS })
