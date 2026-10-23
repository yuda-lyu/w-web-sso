import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


//後台使用者清單之 redir(登入後轉址)檢查 (R-VAL-02, ADR-094; 第 116 項):
//- redir 不可由管理員在本次編輯中設為空: 新增列、或既有列之 redir 由非空改為空者攔下(提示「尚未給予有效登入後轉址」, 該列 redir 格顯示警示)
//- 載入時即為空的既有列不擋存檔、不標警示: 自助註冊者即如此(註冊流程不收 redir, 預設空字串; 使用者於 view=user / view=backstage 登入不需 redir,
//  view=login 登入時以「無有效轉址」提示, 見 spec/流程_使用者一般登入.md E2E-016、spec/流程_使用者自動登入.md E2E-005); 一列之既有資料問題不得擋住整份清單之存檔
//- 比對基準 redirOrig 為 Map(列主鍵 → 載入(及存檔成功後重新讀取)時畫面所見之 redir 原值): 用 Map 而非物件, 因基準存於 Vue data,
//  Vue 2 會把純物件轉為響應式並以 `__ob__` 鍵掛 Observer(列主鍵恰為 `__ob__` 時會覆蓋其原值), Map 不被響應式處理, 且任何主鍵字串(`__proto__` 等)皆無原型鍵衝突(R-KEY-01)
//- 基準算不出(null, 如存檔成功後重新讀取失敗)時: 只檢查新增列; 既有列不檢查——此時 baseline 亦為 null, 後端對無基準之存檔一律拒收(saveBaselineFormat, 提示重新載入),
//  不會有任何列被寫入, 不必在前端對既有列先擋(先擋反而使使用者先看到不相干之 redir 訊息而到不了重新載入提示); 列不在基準內且非新增者(基準有效時)視為管理員所設, 嚴格檢查


//redirOrigOfUsers: rows 為 getUsersList 之回傳(未排序、未變動); 回傳 Map(id → redir 原值; 非字串者記為空字串)
function redirOrigOfUsers(rows) {
    let mp = new Map()
    for (let r of Array.isArray(rows) ? rows : []) {
        let id = get(r, 'id', '')
        if (typeof id !== 'string') {
            continue
        }
        let redir = get(r, 'redir', '')
        mp.set(id, typeof redir === 'string' ? redir : '')
    }
    return mp
}


//redirErrIdsOfUsers: rows 為畫面當前之列(含 _isNew 標記), redirOrig 為 redirOrigOfUsers 之結果或 null; 回傳 { [id]: true }(無原型物件)為不合規則之列
function redirErrIdsOfUsers(rows, redirOrig) {
    let kp = Object.create(null)
    let known = redirOrig instanceof Map
    for (let r of Array.isArray(rows) ? rows : []) {

        //redir 非空即合規
        if (isestr(get(r, 'redir', ''))) {
            continue
        }

        //id
        let id = get(r, 'id', '')

        //新增列: 一律嚴格(標記優先於基準, 即使主鍵碰巧與基準內某列相同)
        let isNew = get(r, '_isNew') === true

        if (!isNew) {

            //基準算不出: 既有列不檢查(後端無基準一律拒收, 見檔頭)
            if (!known) {
                continue
            }

            //載入時即為空之既有列: 既有資料之狀態, 不屬本次編輯所致
            if (typeof id === 'string' && redirOrig.has(id) && !isestr(redirOrig.get(id))) {
                continue
            }

        }

        kp[typeof id === 'string' ? id : String(id)] = true
    }
    return kp
}


export { redirOrigOfUsers, redirErrIdsOfUsers }
export default { redirOrigOfUsers, redirErrIdsOfUsers }
