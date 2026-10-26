import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'


//應用系統金鑰(app token, tokens.isApp='y')之用途 (ADR-095; 前後端共用)
//
//用途分兩種, 以 tokens.appUsage 區分:
//- 'user'(使用者用途): 以 tokens.userId 綁定一位使用者(可綁系統管理者), 代表所綁使用者本人, 授權等同所綁使用者之使用者 token; 不適用 perms; 每次使用皆依所綁使用者「當前」狀態判定
//- 'system'(系統服務用途): 不綁使用者, 代表外部應用系統本身, 授權依 perms (ADR-069); tokens.userId 只記建立者(稽核), 不得當身分使用(不據以反查、撤銷、改密碼)
//- 既有列(升級前建立, 無此欄或 ''): 升級後第一次啟動時由 procCore.migrateLegacyAppTokens 一次性定案 (ADR-095 補記, 見 classifyLegacyAppToken):
//  升級前可用者(timeEnd 為合法時間且未逾期)寫為 'system'(不設期限, 預設相容部署中之整合不中斷); 升級前即不可用者(已逾期、無 timeEnd、timeEnd 格式錯)寫為 'retired'(維持失效, 不因「不設期限」而復活, 列保留不刪)
//  尚未定案之列(缺欄或 ''; 遷移進行中、失敗,或啟動後才由外部直寫庫)於後端讀取時依同一判準即時判定(procCore.loadActor 授權; procCore.getTokensList 回傳之用途,
//  後台顯示與統計皆取該回傳值, 前端不以瀏覽器時間重新推算): 升級前可用者視同 'system'、否則已失效——永不比升級前更寬;
//  本檔 getAppUsage 對缺欄 / '' 仍回 'system'(僅供命名、顯示預設; 後端授權不採用, 見 loadActor)
//- 'retired'(已失效之舊列): 永不可用, 僅供後台檢視與刪除; 不由任何入口寫入(後台清單存檔不採用客戶端值), 只由升級遷移寫入
//- 其餘值(未登錄字串、非字串): 一律不可用(fail closed)


//keysAppUsage: 用途字串全集(新建時可選者), 順序即後台新增對話框之顯示序
let keysAppUsage = ['user', 'system']


//keyAppUsageRetired: 升級遷移時對「升級前即不可用」之舊列所寫之用途值; 非新建時可選之用途, 故不入 keysAppUsage
let keyAppUsageRetired = 'retired'


//keyAppIdPrefix: 系統服務用途之反查身分 id 前綴; id = 前綴 + tokens.id, 於 token 存續期間穩定, 且使用者主鍵不得以此前綴開頭(後台清單存檔拒收), 故不與使用者 id 相撞
let keyAppIdPrefix = 'app:'


//getAppUsage: 取應用系統金鑰之有效用途; 回 'user' | 'system' | 'retired'(已失效之舊列, 不可用) | ''(未登錄之值, 不可用)
//非應用系統金鑰(isApp !== 'y')回 ''; 缺欄 / '' / null 視同 'system'(尚未定案之既有列)
function getAppUsage(tk) {
    if (get(tk, 'isApp', '') !== 'y') {
        return ''
    }
    let v = get(tk, 'appUsage', '')
    if (v === undefined || v === null || v === '' || v === 'system') {
        return 'system'
    }
    if (v === 'user') {
        return 'user'
    }
    if (v === keyAppUsageRetired) {
        return keyAppUsageRetired
    }
    return ''
}


//isLegacyAppToken: 是否為尚未定案之舊應用系統金鑰列(isApp='y' 且 appUsage 缺欄 / null / ''); 已有任何用途值(含未登錄字串)者不是, 遷移不碰
function isLegacyAppToken(tk) {
    if (get(tk, 'isApp', '') !== 'y') {
        return false
    }
    let v = get(tk, 'appUsage', '')
    return v === undefined || v === null || v === ''
}


//classifyLegacyAppToken: 升級遷移對一筆舊列之定案; tn 為現在時間字串(YYYY-MM-DDTHH:mm:ss.SSSZ, 即伺服器本機偏移之 ISO 字串)
//判準 = 升級前 _checkTokenByObj 對該列之判定(commit 88b2397) ∧ 真實時刻未逾期(從嚴, 外審 sol F1 / F7):
//  升級前之判定: timeEnd 須為合法時間(istimemsTZ), 否則 reject 'invalid timeEnd'(不可用); 且現在 < timeEnd(以「字串」逐字比較, 不是時刻比較)才可用, 否則已逾期(不可用);
//  再加「以時刻比較亦未逾期」: 伺服器寫入之 timeEnd 與 tn 同偏移, 字串序 = 時刻序, 兩者一致, 此條不改變任何伺服器產生之資料之結果;
//  兩者不一致者只見於(a)手動寫入之非本機偏移時間字串(如 Z、+14:00); (b)升級同時更換伺服器時區(新行程之 tn 偏移不同於舊資料之偏移, 字串序失真)——
//  一律從嚴為已失效, 不使「升級前不可用 / 時刻上已逾期」者因字串序失真而永久復活
//- 可用 → 'system'(升級後視為系統服務用途, 不設期限)
//- 不可用(已逾期、無 timeEnd、timeEnd 格式錯、字串序與時刻序不一致而任一判逾期) → 'retired'(維持失效)
//非舊列回 ''(不在遷移範圍)
function classifyLegacyAppToken(tk, tn) {
    if (!isLegacyAppToken(tk)) {
        return ''
    }
    let timeEnd = get(tk, 'timeEnd', '')
    if (istimemsTZ(timeEnd) && tn < timeEnd) {
        let a = Date.parse(tn)
        let b = Date.parse(timeEnd)
        if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
            return 'system'
        }
    }
    return keyAppUsageRetired
}


//isAppUsageValue: 新建時之用途值是否合法(須明確給予, 不接受缺欄或 '')
function isAppUsageValue(v) {
    return isestr(v) && keysAppUsage.includes(v)
}


//getAppId: 系統服務用途之反查身分 id
function getAppId(tk) {
    return `${keyAppIdPrefix}${get(tk, 'id', '')}`
}


//isAppIdLike: 使用者主鍵是否落在系統服務用途之保留前綴
function isAppIdLike(id) {
    return isestr(id) && id.startsWith(keyAppIdPrefix)
}


export {
    keysAppUsage,
    keyAppUsageRetired,
    keyAppIdPrefix,
    getAppUsage,
    isLegacyAppToken,
    classifyLegacyAppToken,
    isAppUsageValue,
    getAppId,
    isAppIdLike
}
