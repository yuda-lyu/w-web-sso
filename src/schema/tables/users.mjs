import map from 'lodash-es/map.js'
import keys from 'lodash-es/keys.js'
import genID from 'wsemi/src/genID.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import dtpick from 'wsemi/src/dtpick.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'


let keyTable = 'users'
let tableNameCht = '使用者'
let tableNameEng = 'Users'


let settings = {
    id: {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    order: {
        name: '順序',
        type: 'INTEGER',
    },
    account: {
        name: '帳號',
        type: 'STRING',
    },
    password: {
        name: '密碼', //須儲存加鹽雜湊處理後密碼
        type: 'STRING',
    },
    name: {
        name: '姓名',
        type: 'STRING',
    },
    email: {
        name: '電子郵件',
        type: 'STRING',
    },
    description: {
        name: '描述',
        type: 'TEXT',
    },
    from: {
        name: '來源',
        type: 'STRING',
    },
    // ruleGroupsIds: {
    //     name: '所屬權限群組主鍵', //多主鍵用分號區隔
    //     type: 'STRING',
    // },
    redir: {
        name: '登入後轉址',
        type: 'STRING',
    },
    isAdmin: {
        name: '是否為系統管理員',
        type: 'STRING',
    },
    isVerified: {
        name: '帳號是否驗證',
        type: 'STRING',
    },
    timeVerified: {
        name: '驗證時間',
        type: 'STRING',
    },
    // isExpired: {
    //     name: '帳號是否過期',
    //     type: 'STRING',
    // },
    timeExpired: {
        name: '過期時間',
        type: 'STRING',
    },
    // isBlocked: {
    //     name: '帳號是否封鎖',
    //     type: 'STRING',
    // },
    timeBlocked: {
        name: '封鎖時間',
        type: 'STRING',
    },
    userId: {
        name: '創建使用者主鍵',
        type: 'STRING',
    },
    timeCreate: {
        name: '創建時間',
        type: 'STRING',
    },
    userIdUpdate: {
        name: '最新變更使用者主鍵',
        type: 'STRING',
    },
    timeUpdate: {
        name: '更新時間',
        type: 'STRING',
    },
    isActive: {
        name: '是否有效',
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

