import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import genID from 'wsemi/src/genID.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import dtpick from 'wsemi/src/dtpick.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'


let keyTable = 'ips'
let tableNameCht = 'IP使用者'
let tableNameEng = 'IPs'


let settings = {
    id: {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    ip: {
        name: 'IP',
        type: 'STRING',
    },
    isBlocked: {
        name: '帳號是否封鎖',
        type: 'STRING',
    },
    timeBlocked: {
        name: '封鎖時間',
        type: 'STRING',
    },
}

let funNew = (ndata = {}) => {
    let o = dtmapping(ndata, keys(settings))
    o.id = `${now2strp()}-${genID()}`
    o.isAdmin = 'n'
    o.userIdUpdate = o.userId
    o.timeCreate = nowms2str()
    o.timeUpdate = o.timeCreate
    o.isActive = 'y'
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

