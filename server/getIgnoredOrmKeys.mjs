import get from 'lodash-es/get.js'
import checkOptRemoved from 'w-serv-orm/src/checkOptRemoved.mjs'


//keysRemoved, w-serv-orm 1.1.9 已移除之使用者檢查設定(鍵序即回傳之列出順序)
let keysRemoved = ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin']


/**
 * 列出設定中給予 w-serv-orm 已移除之使用者檢查設定、且其值會被上游拒絕之鍵(R-ORM-02, ADR-083 / ADR-085)
 *
 * w-serv-orm 1.1.9 起移除 useCheckUser、getUserById、useExcludeWhenNotAdmin, 1.1.10 起給予 undefined、null、false 以外之值即於建構時拋錯;
 * 本套件不轉交此三鍵(WServOrm 之 opt 只給診斷輸出之 funLog, R-ORM-04), 部署方舊設定仍給予者由呼叫端忽略並於啟動時記警告, 使舊設定照常啟動.
 * 判定逐鍵委派上游之 checkOptRemoved(其註解明載供包裝層檢查自身之 opt), 與上游之接受集一致: 未給、null、false 不列.
 * 本套件之寫入授權在各功能(清單儲存經 checkToken, 自助註冊由 allowUserRegistration 與輸入驗證守門), 不倚賴 ORM 層.
 *
 * @param {Object} [opt={}] 輸入設定物件(settings 與 optExt 合併後)，預設{}
 * @returns {Array} 回傳應忽略並警告之鍵名陣列，依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序
 */
function getIgnoredOrmKeys(opt = {}) {
    let ignored = []
    for (let k of keysRemoved) {
        try {
            checkOptRemoved({ [k]: get(opt, k) })
        }
        catch (err) {
            ignored.push(k)
        }
    }
    return ignored
}


export default getIgnoredOrmKeys
