import { types } from 'util'
import { AsyncLocalStorage } from 'async_hooks'
import { maskToken, capText, safeText } from './srLog.mjs'


//MAX_DEPTH, MAX_NODES, MAX_NODES_IN, MAX_SECRETS, MAX_PRESCRUB: 走訪之層數、細節之節點數(含鍵)、進行中呼叫之輸入的節點數、收集的識別值個數,
//與錯誤原文進入置換前之截斷長度, 兼作識別值長度上限(更長者不可能出現在已截斷之原文內; 輸出與耗時皆不隨輸入放大; 走訪只在診斷輸出發生時才做, 不在正常寫入路徑)
let MAX_DEPTH = 6
let MAX_NODES = 200
let MAX_NODES_IN = 20000
let MAX_SECRETS = 1000
let MAX_PRESCRUB = 2000

//als, 進行中之 procOrm 呼叫(操作者與輸入列 / 條件): w-serv-orm 的 funLog 收不到呼叫的輸入, 而 ORM 錯誤原文可能夾帶輸入中的資料值(主鍵、信箱等),
//funLog 同步於該呼叫的非同步流程內執行, 由此取得輸入, 把其中的識別值併入遮罩依據(wrapProcOrm)
let als = new AsyncLocalStorage()

//keysErrText, 值為 ORM 錯誤原文之鍵(w-serv-orm 逐筆失敗清單之 err 等); 其餘位置之字串一律視為資料值
let keysErrText = ['err', 'error', 'message', 'msg']

//reKeyData, 鍵名像主鍵 / 身分 / 憑證者: 其值即使為數字也遮罩(數字主鍵)
let reKeyData = /id$|account|email|name|pass|pw$|token/i

//reMarker, w-serv-orm 與本檔自身之固定標記字串(不是資料, 原樣保留): [Function]、[Binary n bytes]、[Getter/Setter]、[Truncated]、(unprintable) 等
let reMarker = /^(\[[A-Za-z/]+( \d+ bytes)?\]|\(unprintable\))$/

//reEmail, reUuid, 錯誤原文內不依賴同筆細節即可辨識之個資樣式
let reEmail = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
let reUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

//reErrType, 錯誤類別名稱(建構子名稱)白名單樣式, 同 w-serv-orm 摘要之 errType
let reErrType = /^[A-Za-z][A-Za-z0-9_]{0,39}$/


function setOwn(o, k, v) {
    //以 defineProperty 建立自有屬性: 鍵為 __proto__ 時(JSON.parse 等可產生)不會改設輸出物件之原型而丟失該鍵
    Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
}


function readData(o, k) {
    //取自有資料屬性之值, 不執行 getter; 非資料屬性或無則 undefined
    try {
        let d = Object.getOwnPropertyDescriptor(o, k)
        return d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined
    }
    catch (err) {
        return undefined
    }
}


function getErrType(e) {
    //錯誤的類別名稱, 取建構子名稱(程式識別字); 不合白名單樣式者為 Error
    try {
        let ctor = Object.getPrototypeOf(e).constructor
        let name = typeof ctor === 'function' ? ctor.name : ''
        return reErrType.test(name) ? name : 'Error'
    }
    catch (err) {
        return 'Error'
    }
}


function toTree(v, depth, ctx) {
    //把任意值轉為有界之純資料樹(字串 / 數字 / 布林 / null / 陣列 / 純物件), 不執行使用端程式(不呼叫 getter、方法, 不觸發 Proxy 陷阱), 超過層數或節點上限者為 [Truncated]
    //Error 轉為 { errType, message } (不取 stack: 內含訊息與本機路徑); Map / Set 轉為陣列; 二進位資料與函數轉為標記字串
    ctx.nodes++
    if (ctx.nodes > ctx.max) {
        return '[Truncated]'
    }
    if (v === null || v === undefined) {
        return null
    }
    let t = typeof v
    if (t === 'string') {
        return v //不截斷: 遮罩形式(maskToken)含原長; 錯誤原文於置換前由 scrubText 截斷
    }
    if (t === 'number' || t === 'boolean') {
        return v
    }
    if (t === 'function') {
        return '[Function]'
    }
    if (t !== 'object') {
        return `[${t}]`
    }
    if (depth >= MAX_DEPTH) {
        return '[Truncated]'
    }
    try {
        if (types.isProxy(v)) {
            return '[Proxy]'
        }
        if (types.isNativeError(v)) {
            let msg = readData(v, 'message')
            return { errType: getErrType(v), message: typeof msg === 'string' ? msg.slice(0, MAX_PRESCRUB) : null }
        }
        if (types.isDate(v)) {
            return '[Date]'
        }
        if (types.isArrayBuffer(v) || types.isSharedArrayBuffer(v) || ArrayBuffer.isView(v)) {
            return '[Binary]'
        }
        if (types.isRegExp(v) || types.isPromise(v) || types.isWeakMap(v) || types.isWeakSet(v)) {
            return '[Object]'
        }
        if (Array.isArray(v)) {
            let r = []
            for (let k = 0; k < v.length && ctx.nodes <= ctx.max; k++) {
                r.push(toTree(readData(v, k), depth + 1, ctx))
            }
            return r
        }
        if (types.isMap(v) || types.isSet(v)) {
            let r = []
            for (let x of (types.isMap(v) ? Map.prototype.entries.call(v) : Set.prototype.values.call(v))) {
                if (ctx.nodes > ctx.max) {
                    break
                }
                r.push(toTree(x, depth + 1, ctx))
            }
            return r
        }
        let r = {}
        for (let k of Object.keys(v)) {
            if (ctx.nodes > ctx.max) {
                break
            }
            let d = Object.getOwnPropertyDescriptor(v, k)
            let kk = capText(safeText(k))
            setOwn(r, kk, d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') ? toTree(d.value, depth + 1, ctx) : '[Getter/Setter]')
        }
        return r
    }
    catch (err) {
        return '[Uncopyable]'
    }
}


function collectSecrets(v, key, secrets, onlyIdent = false) {
    //收集識別值, 供置換錯誤原文內夾帶之同值: 細節內非錯誤原文位置之字串(主鍵、帳號、信箱等)與鍵名像識別欄之數字;
    //onlyIdent 為 true(進行中呼叫之輸入列 / 條件)時只收鍵名像識別欄者, 不收狀態旗標、時間等一般欄位值(短而常見, 置換進一般文字會破壞可讀性)
    if (secrets.size >= MAX_SECRETS) {
        return
    }
    if (typeof v === 'string') {
        //key 為 undefined 者(頂層字串或頂層陣列內之字串)為錯誤原文位置, 不當識別值收集
        if (v.length >= 3 && v.length <= MAX_PRESCRUB && key !== undefined && !reMarker.test(v) && !keysErrText.includes(key) && key !== 'errType' && (!onlyIdent || reKeyData.test(key))) {
            secrets.add(v)
        }
        return
    }
    if (typeof v === 'number') {
        if (key !== undefined && reKeyData.test(key) && String(v).length >= 3) {
            secrets.add(String(v))
        }
        return
    }
    if (Array.isArray(v)) {
        for (let x of v) {
            collectSecrets(x, key, secrets, onlyIdent)
        }
        return
    }
    if (v !== null && typeof v === 'object') {
        for (let k of Object.keys(v)) {
            //條件運算子($in、$ne 等)承接其所屬欄位名: { id: { $in: [...] } } 之值仍屬識別欄
            collectSecrets(v[k], k.startsWith('$') && key !== undefined ? key : k, secrets, onlyIdent)
        }
    }
}


function scrubText(s, secrets) {
    //錯誤原文: 已知之識別值(細節內與該次呼叫輸入內)置換為其遮罩(同值同遮罩, 可與他處紀錄對照); 其餘信箱與 uuid 樣式置換為標記; 最後 capText 置換控制字元並截斷
    let t = s.slice(0, MAX_PRESCRUB)
    let vs = [...secrets].sort((a, b) => b.length - a.length)
    for (let x of vs) {
        if (t.includes(x)) {
            t = t.split(x).join(maskToken(x))
        }
    }
    return capText(t.replace(reEmail, '(email)').replace(reUuid, '(uuid)'))
}


function maskTree(v, key, secrets) {
    if (typeof v === 'string') {
        if (reMarker.test(v) || (key === 'errType' && reErrType.test(v))) {
            return v
        }
        return key === undefined || keysErrText.includes(key) ? scrubText(v, secrets) : maskToken(v)
    }
    if (typeof v === 'number') {
        return key !== undefined && reKeyData.test(key) ? maskToken(String(v)) : v
    }
    if (Array.isArray(v)) {
        return v.map((x) => maskTree(x, key, secrets))
    }
    if (v !== null && typeof v === 'object') {
        let r = {}
        for (let k of Object.keys(v)) {
            setOwn(r, k, maskTree(v[k], k, secrets))
        }
        return r
    }
    return v
}


function capTree(v) {
    //摘要(safe)之處理: w-serv-orm 保證不含主鍵、資料值與錯誤原文, 此處只做縱深防禦(控制字元與長度, 同 capText), 數字與結構原樣
    if (typeof v === 'string') {
        return capText(safeText(v))
    }
    if (Array.isArray(v)) {
        return v.map(capTree)
    }
    if (v !== null && typeof v === 'object') {
        let r = {}
        for (let k of Object.keys(v)) {
            setOwn(r, k, capTree(v[k]))
        }
        return r
    }
    return v
}


/**
 * 遮罩 w-serv-orm 診斷輸出之完整細節(R-ORM-04)
 *
 * 細節含失敗列之主鍵與 ORM 錯誤原文, 寫入 srLog 前先轉為有界之純資料並遮罩(不執行細節內任何使用端程式):
 * 非錯誤原文位置之字串(主鍵、帳號、信箱等)一律遮罩為 maskToken 之形式(前後各至多 4 字元與長度), 鍵名像識別欄之數字亦同;
 * 錯誤原文位置(err、error、message、msg 與頂層字串)保留文字, 但控制字元換為 ?、信箱與 uuid 樣式置換、同筆細節內出現過之識別值置換為其遮罩、長度截斷(256);
 * Error 只留類別名稱與訊息(不含 stack); 層數、節點數與字串長度皆有上限.
 * 錯誤原文可能夾帶不在同筆細節內之資料值(例: catch 路徑之細節只有 Error), 故另可給進行中呼叫之輸入(opt.ctx, 由 wrapProcOrm 於呼叫時記下),
 * 其中鍵名像識別欄(id、userId、account、email、name、token、password 等)之值併入置換依據.
 * 殘餘風險: 錯誤原文夾帶「既不在細節、也不在該次呼叫輸入」的資料值(例如資料庫端既存列之內容), 無從辨識, 只受信箱 / uuid 樣式、控制字元與長度上限的限制.
 *
 * @param {*} detail 輸入 w-serv-orm funLog 之 detail(完整細節)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Object} [opt.ctx] 輸入進行中呼叫之輸入，{ userId, input }
 * @returns {*} 回傳遮罩後之純資料(字串 / 數字 / 布林 / null / 陣列 / 純物件)
 */
function maskOrmDetail(detail, opt = {}) {
    let tree = toTree(detail, 0, { nodes: 0, max: MAX_NODES })
    let secrets = new Set()
    collectSecrets(tree, undefined, secrets)
    let ctx = opt === null || typeof opt !== 'object' ? undefined : opt.ctx
    if (ctx !== null && typeof ctx === 'object') {
        collectSecrets(toTree({ userId: ctx.userId, input: ctx.input }, 0, { nodes: 0, max: MAX_NODES_IN }), undefined, secrets, true)
    }
    return maskTree(tree, undefined, secrets)
}


/**
 * 包裝 procOrm, 記下進行中呼叫之操作者與輸入(R-ORM-04)
 *
 * w-serv-orm 的 funLog 只收到標籤、摘要與細節，收不到該次呼叫的輸入；ORM 錯誤原文可能夾帶輸入中的資料值(主鍵、信箱等)。
 * 包裝後之 procOrm 於非同步脈絡(AsyncLocalStorage)內記下 { userId, input }，funLog 於同一流程內同步執行，據以遮罩。
 * 只多一層脈絡，不改引數、回傳值、reject 與執行時機。
 *
 * @param {Function} procOrm 輸入 w-serv-orm 之 procOrm(userId, woName, mode, input, opt)
 * @returns {Function} 回傳同簽名之 procOrm
 */
function wrapProcOrm(procOrm) {
    return (...args) => {
        return als.run({ userId: args[0], input: args[3] }, () => procOrm(...args))
    }
}


/**
 * 產生 w-serv-orm 之 funLog(opt.funLog), 把診斷輸出導入 srLog(R-ORM-04)
 *
 * 1.1.20 起 w-serv-orm 預設只在 console 輸出標籤與不含個資之摘要, 完整細節(失敗列主鍵、ORM 錯誤原文)只交 funLog.
 * 本函數回傳之 funLog 於給予時取代其 console 輸出, 故:
 * - console: 照舊輸出標籤與摘要(同 w-serv-orm 預設之 console.log(label, safe), 不含主鍵與原文; stdout 仍可見, 同 logBoot 雙寫);
 * - srLog.error: { event: 'orm-diag', label, safe, detail }, detail 經 maskOrmDetail 遮罩(無細節者無此鍵), 遮罩失敗時為 '(unmaskable)'.
 * 輸出之任何失敗(console、遮罩、srLog 寫入)皆吞下, 不影響 procOrm 之流程與結果.
 *
 * @param {Object} srLog 輸入 srLog(w-syslog 實例, 需有 error 函數)
 * @returns {Function} 回傳 funLog(label, safe, detail)
 */
function mkOrmFunLog(srLog) {
    return (label, safe, ...rest) => {

        //console, 同 w-serv-orm 預設輸出
        try {
            if (safe === undefined) {
                console.log(label)
            }
            else {
                console.log(label, safe)
            }
        }
        catch (err) {
            //放棄輸出
        }

        //srLog
        try {
            let o = { event: 'orm-diag', label: capText(safeText(String(label))) }
            if (safe !== undefined) {
                o.safe = capTree(toTree(safe, 0, { nodes: 0, max: MAX_NODES }))
            }
            if (rest.length > 0) {
                try {
                    o.detail = maskOrmDetail(rest[0], { ctx: als.getStore() })
                }
                catch (err) {
                    o.detail = '(unmaskable)'
                }
            }
            srLog.error(o)
        }
        catch (err) {
            //放棄輸出
        }

    }
}


export { maskOrmDetail, wrapProcOrm }
export default mkOrmFunLog
