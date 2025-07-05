import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import genID from 'wsemi/src/genID.mjs'
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
    timeCreate: {
        name: '創建時間',
        type: 'STRING',
    },
    timeEnd: {
        name: '到期時間',
        type: 'STRING',
    },
    timeUpdate: {
        name: '更新時間',
        type: 'STRING',
    },
}

let funNew = (ndata = {}) => {
    let o = dtmapping(ndata, keys(settings))
    o.id = `${now2strp()}-${genID()}`
    o.token = `${now2strp()}-${genID()}`
    o.timeCreate = nowms2str()
    o.timeEnd = ot().add(30, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ') //預設30min
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

