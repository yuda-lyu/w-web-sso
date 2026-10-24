import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import isarr from 'wsemi/src/isarr.mjs'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import dtpick from 'wsemi/src/dtpick.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import ot from 'dayjs'


let keyTable = 'tokens'
let tableNameCht = '金鑰'
let tableNameEng = 'Tokens'


let settings = {
    id: {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    token: {
        name: '金鑰',
        type: 'STRING',
    },
    userId: {
        name: '使用者主鍵',
        type: 'STRING',
    },
    isApp: {
        name: '是否為應用系統',
        type: 'STRING',
    },
    perms: { //權限字串陣列, 多元素即聯集; 僅isApp='y'且為系統服務用途時生效, 基本權限readUsers恆具備, 權限全集見src/appPerms.mjs (ADR-069)
        name: '應用系統權限',
        type: 'TEXT',
    },
    appUsage: { //應用系統金鑰之用途: 'user'(使用者用途, userId為所綁使用者) | 'system'(系統服務用途, userId只記建立者); 缺欄或''(既有列)視同'system'; 非應用系統金鑰為'' (ADR-095, src/appUsage.mjs)
        name: '應用系統金鑰用途',
        type: 'STRING',
    },
    appName: { //應用系統金鑰之名稱, 系統服務用途之反查身分以此為名稱; 非應用系統金鑰為'' (ADR-095)
        name: '應用系統金鑰名稱',
        type: 'STRING',
    },
    timeCreate: {
        name: '創建時間',
        type: 'STRING',
    },
    timeEnd: {
        name: '到期時間',
        type: 'STRING',
    },
    userIdUpdate: { //最後修改者(伺服器專有, 由 procOrm 戳記; 系統計時器寫入記常數 'system', 見 rulebook_concurrency R-CONC-04); userId 為擁有者, 不被操作者覆寫
        name: '最新變更使用者主鍵',
        type: 'STRING',
    },
    timeUpdate: {
        name: '更新時間',
        type: 'STRING',
    },
}

let funNew = (ndata = {}) => {
    let o = dtmapping(ndata, keys(settings))
    o.id = `${genIDSeq()}`
    o.token = `${genIDSeq()}`
    if (!isarr(o.perms)) {
        o.perms = [] //未給予時為空陣列, 即僅具基本權限
    }
    o.timeCreate = nowms2str()
    o.timeEnd = ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ') //預設30min, 可由創建處再依照設定更新
    o.timeUpdate = o.timeCreate
    return o
}

let funTest = () => {
    let rs = []
    return rs
}

let tab = {
    keyTable,
    tableNameCht,
    tableNameEng,
    settings,
    funNew,
    funTest,
}


export default tab

