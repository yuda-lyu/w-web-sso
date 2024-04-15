import each from 'lodash-es/each.js'
import set from 'lodash-es/set.js'
import * as types from './types.mjs'
import ds from '../schema/index.mjs'


//state, 全域狀態
let state = {

    hostname: `${window.location.origin}`,
    webInfor: {},
    connState: '連線中...',
    syncState: false,
    viewState: 'lists',
    loading: false,
    settings: {
        leftDrawerWidth: 200,
    },

    heightApp: 0,
    heightAppEff: 0,
    heightToolbar: 60,

    menu: {}, //初始值需為物件, 否則LayoutContent會取menu.key出錯

    userToken: '',
    user: {
        id: '', //id-for-admin
        name: '', //測試者
        email: '', //admin@example.com
        isAdmin: 'n',
    },

    lang: 'cht',
    keyLangs: {

        systemMessage: {
            eng: 'System message',
            cht: '系統確認訊息',
        },
        ok: {
            eng: 'OK',
            cht: '確認',
        },
        no: {
            eng: 'No',
            cht: '取消',
        },
        yes: {
            eng: 'Yes',
            cht: '確定',
        },

        empty: {
            eng: 'Empty',
            cht: '無',
        },
        waitingData: {
            eng: 'Waiting data...',
            cht: '等待數據中...',
        },

        isEditabled: {
            eng: 'Editable',
            cht: '是否編輯',
        },
        saveChanges: {
            eng: `Save changes`,
            cht: `儲存變更`,
        },
        from: {
            eng: `From`,
            cht: `來源`,
        },
        save: {
            eng: `Save`,
            cht: `儲存`,
        },
        close: {
            eng: `Close`,
            cht: `關閉`,
        },
        cancel: {
            eng: `Cancel`,
            cht: `取消`,
        },
        processing: {
            eng: `Processing...`,
            cht: `處理中請稍後...`,
        },
        anUnexpectedErrorOccurred: {
            eng: `An unexpected error occurred, please contact the administrator`,
            cht: `發生非預期錯誤，請洽管理員`,
        },
        unknow: {
            eng: `Unknow`,
            cht: `未知`,
        },

        account: {
            eng: `Account`,
            cht: `帳號`,
        },
        password: {
            eng: `Password`,
            cht: `密碼`,
        },
        username: {
            eng: `Username`,
            cht: `使用者姓名`,
        },
        email: {
            eng: `Email`,
            cht: `電子郵件`,
        },
        name: {
            eng: `Name`,
            cht: `名稱`,
        },
        description: {
            eng: `Description`,
            cht: `說明`,
        },
        noDescription: {
            eng: `No description`,
            cht: `無說明`,
        },

        login: {
            eng: `Login`,
            cht: `登入`,
        },
        logout: {
            eng: `Logout`,
            cht: `登出`,
        },

        failedLoginForNoWebKey: {
            eng: `Can not get the web key`,
            cht: `無有效站台唯一識別資訊`,
        },
        failedLoginForNoToken: {
            eng: `Can not get the token`,
            cht: `無有效金鑰`,
        },
        failedLoginForNoRedir: {
            eng: `Can not get the url for redirection`,
            cht: `無有效轉址`,
        },
        failedLoginForCatch: {
            eng: `User account or password is incorrect`,
            cht: `使用者帳密錯誤無法登入`,
        },

        userList: {
            eng: `User list`,
            cht: `使用者分類清單`,
        },
        addUser: {
            eng: `Add user`,
            cht: `新增使用者`,
        },

        editUser: {
            eng: `Edit user`,
            cht: `編修使用者`,
        },
        isAManager: {
            eng: `Is a manager`,
            cht: `是否為管理者`,
        },
        isActive: {
            eng: 'Is active',
            cht: '是否有效',
        },
        remark: {
            eng: `Remark`,
            cht: `備註`,
        },
        dayCreate: {
            eng: 'Create day',
            cht: '創建日期',
        },
        newUser: {
            eng: `New user`,
            cht: `新使用者`,
        },
        failedToAddUser: {
            eng: `Failed to add the user`,
            cht: `新增使用者失敗`,
        },
        successfulToAddUser: {
            eng: `Add the user successfully`,
            cht: `新增使用者成功`,
        },
        confirmToDeleteUser: {
            eng: `Do you want to delete the user[{name}]?`,
            cht: `確認是否刪除使用者`,
        },
        failedToDeleteUser: {
            eng: `Failed to delete the user`,
            cht: `刪除使用者失敗`,
        },
        successfulToDeleteUser: {
            eng: `Delete the user successfully`,
            cht: `刪除使用者成功`,
        },
        cannotShowUserDetailsInViewMode: {
            eng: `Can not show the user details in the view mode`,
            cht: `非編輯模式無法查閱使用者詳細資訊`,
        },

        allDefaults: {
            eng: `All defaults`,
            cht: `全部項目預設值`,
        },
        show: {
            eng: `Show`,
            cht: `顯示`,
        },
        active: {
            eng: `Active`,
            cht: `啟用`,
        },
        showChildren: {
            eng: `Show children`,
            cht: `所屬顯示`,
        },
        hideChildren: {
            eng: `Hide children`,
            cht: `所屬不顯示`,
        },
        activateChildren: {
            eng: `Activate children`,
            cht: `所屬啟用`,
        },
        deactivateChildren: {
            eng: `Deactivate children`,
            cht: `所屬不啟用`,
        },
        isUsernameEmpty: {
            eng: `Username is empty`,
            cht: `使用者名稱不得為空`,
        },
        failedToSaveUser: {
            eng: `Failed to save the user`,
            cht: `變更使用者失敗`,
        },
        successfulToSaveUser: {
            eng: `Save the user successfully`,
            cht: `變更使用者成功`,
        },

    },
    kpText: {},

}

//添加各資料表
each(ds, (v, k) => {
    state[k] = null //初始化null
})

//儲存至state
export { state }

//mutations, 同步執行
export let mutations = {

    [types.UpdateWebInfor] (state, webInfor) {
        state.webInfor = webInfor
    },

    [types.UpdateLang] (state, lang) {
        state.lang = lang
    },

    [types.UpdateKpText] (state, kpText) {
        state.kpText = kpText
    },

    [types.UpdateConnState] (state, connState) {
        state.connState = connState
    },

    [types.UpdateSyncState] (state, syncState) {
        state.syncState = syncState
    },

    [types.UpdateLoading] (state, loading) {
        state.loading = loading
    },

    [types.UpdateViewState] (state, viewState) {
        state.viewState = viewState
    },

    [types.UpdateTableData] (state, msg) {
        state[msg.tableName] = msg.data
    },

    [types.UpdateData] (state, msg) {
        //msg.path內為存取路徑, 需使用set處理
        // console.log('UpdateData msg', msg)
        set(state, msg.path, msg.data)
    },

    [types.UpdateHeightApp] (state, heightApp) {
        state.heightApp = heightApp
    },

    [types.UpdateHeightAppEff] (state, heightAppEff) {
        state.heightAppEff = heightAppEff
    },

    [types.UpdateHeightToolbar] (state, heightToolbar) {
        state.heightToolbar = heightToolbar
    },

    [types.UpdateMenu] (state, menu) {
        state.menu = menu
    },

    [types.UpdateUserToken] (state, userToken) {
        state.userToken = userToken
    },

    [types.UpdateUserSelf] (state, userSelf) {
        state.userSelf = userSelf
    },

}

