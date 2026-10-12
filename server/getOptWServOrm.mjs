import get from 'lodash-es/get.js'
import keys from 'lodash-es/keys.js'


//kpFixed, 交予 WServOrm 之固定設定(鍵序即 ignored 之列出順序)
let kpFixed = {
    useCheckUser: false,
    getUserById: null,
    useExcludeWhenNotAdmin: false,
}


/**
 * 取交予 WServOrm 之設定, 並列出設定中仍給予之已停用鍵(ADR-083)
 *
 * 本套件不開放 ORM 通道(WServHapi 之 useDbOrm 為 false、不給 operOrm), procOrm 只供內部寫入, 寫入之授權由各功能自行負責:
 * 清單儲存先經 checkToken(使用者須為管理者、應用系統金鑰須具對應寫入權限), 自助註冊為公開流程(allowUserRegistration).
 * w-serv-orm 之 useCheckUser 只查行為者存在且有效, 較上述檢查寬鬆, 且不認得自助註冊之新使用者、應用系統金鑰之虛擬使用者與未帶操作者之金鑰 / IP 清單,
 * 開啟即令該些寫入必然失敗; getUserById 只供 useCheckUser 使用; useExcludeWhenNotAdmin 只作用於經 procOrm 之 select, 本套件之查詢不經 procOrm.
 * 故三鍵固定, 給予非預設值者忽略(w-serv-orm 對非布林之 useCheckUser 預設為 true, 故非布林亦不交出).
 *
 * @param {Object} [opt={}] 輸入設定物件(settings 與 optExt 合併後)，預設{}
 * @returns {Object} 回傳物件，optWServOrm 為交予 WServOrm 之設定物件，ignored 為設定中給予非預設值之已停用鍵名陣列(依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序)
 */
function getOptWServOrm(opt = {}) {

    //ignored, 未給或給予固定值者不列
    let ignored = []
    for (let k of keys(kpFixed)) {
        let v = get(opt, k)
        if (v !== undefined && v !== kpFixed[k]) {
            ignored.push(k)
        }
    }

    return {
        optWServOrm: { ...kpFixed },
        ignored,
    }
}


export default getOptWServOrm
