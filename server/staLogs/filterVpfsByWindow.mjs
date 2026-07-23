import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'


//filterVpfsByWindow: 開檔前依「檔名時間窗」過濾 log 檔清單, 剔除窗外檔.
//w-syslog 檔名為 ISO 前綴 (hr: `YYYY-MM-DDTHH.log` / day: `YYYY-MM-DD.log`), 字典序 ≡ 時間序,
//故可用字串比較篩選 (w-syslog 自身 cleanLogs 亦依賴此性質, 見 node_modules/w-syslog/src/WSyslog.mjs:127-128).
//邊界檔一律保留, 其內 per-line `t.isAfter(tStart)` 仍為最終判準 → 輸出語意零改變.
//fail-open: 檔名不符 ISO 前綴者一律保留 (寧可多讀, 不可漏讀).
//vpfs 為 fsTreeFolder 回傳之物件陣列, 每筆含 { path, name, isFolder, level }.
//fmt 直接沿用各 staLogs 檔內既有之 `fmt` 變數 (day: 'YYYY-MM-DD' / hr: 'YYYY-MM-DDTHH').
//【粒度自適應】比較時以「檔名長度」截取 keyStart: srLog 之 logInterval (決定檔名粒度) 與 staLogs 之
//timeInterval (決定 fmt) 為兩個獨立設定, 兩者不一定相同. 若檔名為 day 粒度 (10 字元) 而 fmt 為 hr 粒度
//(13 字元), 直接比較會把「當天檔」誤判為窗外 (`'2026-07-08' < '2026-07-08T21'`) → 漏讀整天資料.
//截取後 day 檔以日期比日期、hr 檔以小時比小時, 兩種粒度皆正確且一律偏保留 (fail-safe).
function filterVpfsByWindow(vpfs, tStart, fmt) {
    let keyStart = tStart.format(fmt)
    return filter(vpfs, (vpf) => {
        let bn = get(vpf, 'name', '').replace(/\.log$/, '')
        if (!/^\d{4}-\d{2}-\d{2}/.test(bn)) {
            return true //fail-open: 非預期檔名一律保留
        }
        return bn >= keyStart.slice(0, bn.length)
    })
}


export default filterVpfsByWindow
