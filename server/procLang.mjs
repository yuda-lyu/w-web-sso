import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import trim from 'lodash-es/trim.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import ispnum from 'wsemi/src/ispnum.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import cint from 'wsemi/src/cint.mjs'
import sep from 'wsemi/src/sep.mjs'
import j2o from 'wsemi/src/j2o.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strright from 'wsemi/src/strright.mjs'
import strdelright from 'wsemi/src/strdelright.mjs'
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
import ltdtmapping from 'wsemi/src/ltdtmapping.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'


let kpLang = {

    csIng: {
        eng: 'Connecting...',
        cht: '連線中...',
    },
    csLogin: {
        eng: 'Logged in',
        cht: '已登入',
    },
    csLogout: {
        eng: 'Logged out',
        cht: '已登出',
    },
    csErrConn: {
        eng: 'Unable to connect',
        cht: '無法連線',
    },
    csErrLogin: {
        eng: 'Login denied',
        cht: '拒絕登入',
    },

    aggridLanguage: {
        eng: 'en',
        cht: 'zh-tw',
    },

    id: {
        eng: 'ID',
        cht: '主鍵',
    },
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
    y: {
        eng: `Yes`,
        cht: `是`,
    },
    n: {
        eng: `No`,
        cht: `否`,
    },
    empty: {
        eng: 'Empty',
        cht: '無',
    },
    to: {
        eng: 'To',
        cht: '至',
    },
    at: {
        eng: 'At',
        cht: '於',
    },
    unknow: {
        eng: `Unknow`,
        cht: `未知`,
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
    send: {
        eng: `Send`,
        cht: `送出`,
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
    getDataError: {
        eng: `Failed to get data, please try again later`,
        cht: `取得數據失敗，請稍後再試`,
    },

    userIdCreate: {
        eng: `ID of the created user`,
        cht: '創建使用者主鍵',
    },
    timeCreate: {
        eng: `Created time`,
        cht: '創建時間',
    },
    userIdUpdate: {
        eng: `ID of the updated user`,
        cht: '最新變更使用者主鍵',
    },
    timeUpdate: {
        eng: `Updated time`,
        cht: '最新變更時間',
    },
    // timeVerified: {
    //     eng: `Verified time`,
    //     cht: `驗證時間`,
    // },
    // timeExpired: {
    //     eng: `Expired time`,
    //     cht: `帳號過期時間`,
    // },
    // timeBlocked: {
    //     eng: `Blocked time`,
    //     cht: `封鎖時間`,
    // },
    // timeEnd: {
    //     eng: 'End time',
    //     cht: '到期時間',
    // },

    userId: {
        eng: `ID of the user`,
        cht: '使用者主鍵',
    },
    account: {
        eng: `Account`,
        cht: `帳號`,
    },
    password: {
        eng: `Password`,
        cht: `密碼`,
    },
    toggleToShowPassword: {
        eng: `To show password`,
        cht: `變更為顯示密碼模式`,
    },
    toggleToHidePassword: {
        eng: `To hide password`,
        cht: `變更為隱藏密碼模式`,
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
    redir: {
        eng: `Redirect`,
        cht: `登入後轉至網址`,
    },

    login: {
        eng: `Log in`,
        cht: `登入`,
    },
    logout: {
        eng: `Log out`,
        cht: `登出`,
    },

    menuTreeShow: {
        eng: `Show menu`,
        cht: `顯示選單`,
    },
    menuTreeHide: {
        eng: `Hide menu`,
        cht: `隱藏選單`,
    },

    mmStaInfor: {
        eng: `Statistics information`,
        cht: `統計資訊`,
    },
    mmStaInforMsg: {
        eng: `Provides important statistical information such as the current system user login frequency, key usage frequency, IP connection frequency, etc.`,
        cht: `提供目前系統使用者登入頻率、金鑰使用頻率、IP連線頻率等重要統計資訊。`,
    },

    mmUserInfor: {
        eng: `User information`,
        cht: `使用者資訊`,
    },

    mmUsersList: {
        eng: `Users list`,
        cht: `使用者清單`,
    },
    mmUsersListMsg: {
        eng: `Provide a list of users, which can be added, edited, deleted, etc.`,
        cht: `提供目前使用者資料清單，可進行新增、編輯、刪除等作業。`,
    },

    mmTokensList: {
        eng: `Tokens list`,
        cht: `金鑰清單`,
    },
    mmTokensListMsg: {
        eng: `Provide a list of tokens, which can be deleted, etc.`,
        cht: `提供目前金鑰資料清單，可進行強制登出等作業。`,
    },

    mmIpsList: {
        eng: `Ips list`,
        cht: `IP清單`,
    },
    mmIpsListMsg: {
        eng: `Provide a list of tokens, which can be deleted, etc.`,
        cht: `提供目前存取IP清單，可進行封鎖等作業。`,
    },

    nowTokensList: {
        eng: `Tokens list`,
        cht: `金鑰清單`,
    },
    nowBlockList: {
        eng: `Block list`,
        cht: `封鎖清單`,
    },
    systemTokenList: {
        eng: `System token list`,
        cht: `系統金鑰清單`,
    },

    // invalidToken: {
    //     eng: 'No valid token',
    //     cht: '無有效金鑰',
    // },

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

    failedLogoutForNoWebKey: {
        eng: `Can not get the web key`,
        cht: `無有效站台唯一識別資訊`,
    },
    failedLogoutForCatch: {
        eng: `Can not logout`,
        cht: `使用者登出失敗`,
    },

    userStatus: {
        eng: `Status`,
        cht: `帳號狀態`,
    },

    isVerified: {
        eng: `Verified`,
        cht: `帳號是否驗證`,
    },
    isVerifiedY: {
        eng: `Verified`,
        cht: `帳號已驗證`,
    },
    isVerifiedN: {
        eng: `Not verified`,
        cht: `帳號未驗證`,
    },
    userTimeVerified: {
        eng: `Verified time`,
        cht: `帳號驗證狀態與時間`,
    },
    isVerifiedWaiting: {
        eng: `Waiting for verification`,
        cht: `等待驗證中`,
    },

    isExpired: {
        eng: `Expired`,
        cht: `帳號是否過期`,
    },
    isExpiredY: {
        eng: `Expired`,
        cht: `帳號已過期`,
    },
    isExpiredN: {
        eng: `Not expired`,
        cht: `帳號未過期`,
    },
    userTimeExpired: {
        eng: `Expired time`,
        cht: `帳號過期狀態與時間`,
    },
    isExpiredDeny: {
        eng: `Account login prohibited`,
        cht: `禁止帳號登入`,
    },
    isExpiredNever: {
        eng: `Never expires`,
        cht: `永不過期`,
    },

    isBlocked: {
        eng: `Blocked`,
        cht: `帳號是否被封鎖`,
    },
    isBlockedY: {
        eng: `Blocked`,
        cht: `帳號已封鎖`,
    },
    isBlockedN: {
        eng: `Not blocked`,
        cht: `帳號未封鎖`,
    },
    userTimeBlocked: {
        eng: `Blocked time`,
        cht: `帳號封鎖狀態與時間`,
    },
    isBlockedNormalStatus: {
        eng: `Normal status`,
        cht: `狀態正常`,
    },

    isAdmin: {
        eng: `Administrator`,
        cht: `是否為系統管理者`,
    },
    isAdminY: {
        eng: `System Administrator`,
        cht: `系統管理者`,
    },
    isAdminN: {
        eng: `Non-System Administrator`,
        cht: `非系統管理者`,
    },
    userRole: {
        eng: `Role`,
        cht: `角色`,
    },
    userRoleAdmin: {
        eng: `Administrator`,
        cht: `系統管理者`,
    },
    userRoleGeneral: {
        eng: `General`,
        cht: `一般使用者`,
    },

    isActive: {
        eng: 'Active',
        cht: '帳號是否有效',
    },
    isActiveY: {
        eng: 'Active',
        cht: '帳號有效',
    },
    isActiveMsgY: {
        eng: 'Enabling',
        cht: '啟用中',
    },
    isActiveN: {
        eng: 'Inactive',
        cht: '帳號無效',
    },
    isActiveMsgN: {
        eng: 'Deactivated',
        cht: '已停用',
    },

    errInNames: {
        eng: `Name errors`,
        cht: `名稱出現錯誤待修復`,
    },
    errInAccounts: {
        eng: `Account errors`,
        cht: `帳號出現錯誤待修復`,
    },
    errInEmails: {
        eng: `Email errors`,
        cht: `Email出現錯誤待修復`,
    },
    errItemsByRedir: {
        eng: `Redirect errors`,
        cht: `登入後轉址出現錯誤待修復`,
    },

    modeEdit: {
        eng: `Edit mode`,
        cht: `編輯模式`,
    },
    showTabCols: {
        eng: `Show columns`,
        cht: `顯示欄位`,
    },

    userList: {
        eng: `User list`,
        cht: `使用者清單`,
    },
    userName: {
        eng: `Name of user`,
        cht: `使用者名稱`,
    },
    userNameEmpty: {
        eng: `Invalid name of user`,
        cht: `尚未給予有效使用者名稱`,
    },
    userNameDuplicate: {
        eng: `Duplicate name of user`,
        cht: `使用者名稱出現重複`,
    },
    userAccountEmpty: {
        eng: `Invalid account of user`,
        cht: `尚未給予有效使用者帳號`,
    },
    userAccountDuplicate: {
        eng: `Duplicate account of user`,
        cht: `使用者帳號出現重複`,
    },
    userEmailEmpty: {
        eng: `Empty email of user`,
        cht: `尚未給予使用者Email`,
    },
    userEmailError: {
        eng: `Invalid email of user`,
        cht: `使用者Email格式錯誤`,
    },
    userEmailDuplicate: {
        eng: `Duplicate email of user`,
        cht: `使用者Email出現重複`,
    },
    userRedirEmpty: {
        eng: `Invalid redirect of user`,
        cht: `尚未給予有效登入後轉址`,
    },
    userTimeEmpty: {
        eng: `Invalid time`,
        cht: `無`,
    },
    userAddEmpty: {
        eng: `No user`,
        cht: `尚未新增使用者資料`,
    },
    userAdd: {
        eng: `Add user`,
        cht: `新增使用者`,
    },
    userAddNameNew: {
        eng: `New user`,
        cht: `新使用者`,
    },
    userAddIdNew: {
        eng: `Waiting generation`,
        cht: `待自動給予`,
    },
    userCopy: {
        eng: `Copy user`,
        cht: `複製使用者`,
    },
    userCopyNameNew: {
        eng: `copy`,
        cht: `複製`,
    },
    userDeleteCheckUsers: {
        eng: `Delete user(s)`,
        cht: `刪除勾選使用者`,
    },
    userResetPassword: {
        eng: `Reset password`,
        cht: `重設密碼`,
    },
    userSaveUsersEmpty: {
        eng: `No user`,
        cht: `未有變更使用者資料`,
    },
    userSaveUsersFail: {
        eng: `Failed to save users`,
        cht: `儲存使用者數據失敗`,
    },
    userSaveUsersSuccess: {
        eng: `Save users successfully`,
        cht: `儲存使用者數據成功`,
    },
    userEditNoUserId: {
        eng: `Can not find the id of user`,
        cht: `無法找到使用者Id`,
    },
    userEditNoUserData: {
        eng: `Can not find the data of user`,
        cht: `無法找到使用者數據`,
    },

    userPassword_keyLimNumLenMinOrMax: {
        eng: 'The minimum password length is greater than the maximum length',
        cht: '設定密碼最小長度大於最大長度',
    },
    userPassword_keyLimHasSpace: {
        eng: 'Password must not contain whitespace characters',
        cht: '密碼不可包含空白字元',
    },
    userPassword_keyLimNumLenMin: {
        eng: 'Password length must be greater than 8 characters',
        cht: '密碼長度須大於8個字元',
    },
    userPassword_keyLimNumLenMax: {
        eng: 'Password length must be less than 30 characters',
        cht: '密碼長度須小於30個字元',
    },
    userPassword_keyLimCombination: {
        eng: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special characte',
        cht: '密碼須包含大寫、小寫英文、數字、特殊符號各1個字元',
    },

    userChangePassword: {
        eng: 'Change Password',
        cht: '變更密碼',
    },
    userChangePasswordOldPassword: {
        eng: 'Old password',
        cht: '舊密碼',
    },
    userChangePasswordNewPassword: {
        eng: 'New password',
        cht: '新密碼',
    },
    userChangePasswordConfirmPassword: {
        eng: 'Confirm password',
        cht: '確認新密碼',
    },
    userChangePasswordForNoOldPassword: {
        eng: 'Please enter old password',
        cht: '尚未給予舊密碼',
    },
    userChangePasswordForNoNewPassword: {
        eng: 'Please enter new password',
        cht: '尚未給予新密碼',
    },
    // userChangePasswordForUnfmtNewPassword: {
    //     eng: 'Passwords must contain one character each of uppercase and lowercase English letters, numbers, and special symbols.',
    //     cht: '密碼須包含大寫、小寫英文、數字、特殊符號各1個字元',
    // },
    userChangePasswordForNoConfirmPassword: {
        eng: 'Please enter confirm password',
        cht: '尚未給予確認密碼',
    },
    userChangePasswordNotSame: {
        eng: 'New password and confirm password do not match',
        cht: '新密碼與確認密碼不一致',
    },
    userChangePasswordSuccess: {
        eng: 'Password change successful, please log in again.',
        cht: '密碼變更成功，請使用新密碼重新登入。',
    },
    userChangePasswordFail: {
        eng: 'Password change failed.',
        cht: '密碼變更失敗，請確認輸入密碼是否正確',
    },
    userChangePasswordForNetError: {
        eng: 'Password validation failed. Please try again later.',
        cht: '密碼檢測失敗，請稍後再試',
    },
    // msgSendChangePasswordEmailSuccess: {
    //     eng: 'Verification email sent. Please check your inbox and click the link to change your password.',
    //     cht: '驗證信已發送，請至信箱收取並點擊連結以變更密碼。',
    // },
    // msgSendChangePasswordEmailFail: {
    //     eng: 'Send failed',
    //     cht: '發送失敗',
    // },

    token: {
        eng: 'Token',
        cht: '金鑰',
    },
    isApp: {
        eng: 'For app',
        cht: '是否為應用系統金鑰',
    },
    tokenTimeCreate: {
        eng: `Created time`,
        cht: '金鑰創建時間',
    },
    tokenTimeEnd: {
        eng: 'End time',
        cht: '金鑰到期時間',
    },
    tokenTimeUpdate: {
        eng: 'End time',
        cht: '金鑰更新時間',
    },
    tokenTimeEmpty: {
        eng: `Invalid time`,
        cht: `無`,
    },
    tokenEditNoTokenId: {
        eng: `Can not find the id of token`,
        cht: `無法找到金鑰Id`,
    },
    tokenEditNoTokenData: {
        eng: `Can not find the data of token`,
        cht: `無法找到金鑰數據`,
    },
    // tokenAddEmpty: {
    //     eng: `No token`,
    //     cht: `尚未新增金鑰資料`,
    // },
    tokenSaveTokensFail: {
        eng: `Failed to save tokens`,
        cht: `儲存金鑰數據失敗`,
    },
    tokenSaveTokensSuccess: {
        eng: `Save tokens successfully`,
        cht: `儲存金鑰數據成功`,
    },

    ip: {
        eng: 'IP',
        cht: 'IP',
    },
    ipTimeBlocked: {
        eng: `Blocked time`,
        cht: `IP封鎖時間`,
    },
    ipDeleteCheckIps: {
        eng: `Delete checked IP(s)`,
        cht: `刪除勾選IP`,
    },
    ipTimeEmpty: {
        eng: `Invalid time`,
        cht: `無`,
    },
    ipEditNoIpId: {
        eng: `Can not find the id of IP`,
        cht: `無法找到IP Id`,
    },
    ipEditNoIpData: {
        eng: `Can not find the data of IP`,
        cht: `無法找到IP數據`,
    },
    // apAddEmpty: {
    //     eng: `No ip`,
    //     cht: `尚未新增IP資料`,
    // },
    ipSaveIpsFail: {
        eng: `Failed to save IPs`,
        cht: `儲存IP數據失敗`,
    },
    ipSaveIpsSuccess: {
        eng: `Save IPs successfully`,
        cht: `儲存IP數據成功`,
    },

    statisticsInformation: {
        eng: 'Statistics Information',
        cht: '統計資訊',
    },
    statisticsInformationDescription: {
        eng: 'Provides an overview of system usage and security metrics.',
        cht: '提供系統使用情況和安全指標的總覽。',
    },
    userGroupInfor: {
        eng: 'User Information',
        cht: '使用者資訊區',
    },
    totalUsers: {
        eng: 'Total Users',
        cht: '總使用者',
    },
    activeUsers: {
        eng: 'Active Users',
        cht: '活躍使用者',
    },
    blockedUsers: {
        eng: 'Blocked Users',
        cht: '已封鎖使用者',
    },
    expiredUsers: {
        eng: 'Expired Users',
        cht: '已過期使用者',
    },
    accessActivityMonitoring: {
        eng: 'Access Activity Monitoring',
        cht: '存取活動監測',
    },
    userLoginFrequency: {
        eng: 'User Login Frequency',
        cht: '使用者登入頻率',
    },
    last7Days: {
        eng: 'Last 7 days',
        cht: '最近7天',
    },
    tokenUsageFrequency: {
        eng: 'Token Usage Frequency',
        cht: '金鑰使用頻率',
    },
    ipConnectionFrequency: {
        eng: 'IP Connection Frequency',
        cht: 'IP 連線頻率',
    },
    controlStatus: {
        eng: 'Control Status',
        cht: '管控狀態',
    },
    tokenCharacteristic: {
        eng: 'Token Characteristic',
        cht: '金鑰狀態',
    },
    activeTokens: {
        eng: 'Active Tokens',
        cht: '有效金鑰數量',
    },
    createdLast24h: {
        eng: 'Created in last 24h',
        cht: '最近24小時內創建',
    },
    endingNext24h: {
        eng: 'Ending in next 24h',
        cht: '未來24小時內到期',
    },
    endedTokens: {
        eng: 'Ended Tokens',
        cht: '已到期金鑰數量',
    },
    ipCharacteristic: {
        eng: 'IP Characteristic',
        cht: 'IP狀態',
    },
    conn24h: {
        eng: 'Connections in last 24h',
        cht: '最近24小時內連線數量',
    },
    blockedIps: {
        eng: 'Blocked IPs',
        cht: '當前已封鎖IP數量',
    },
    selectItem1hr: {
        eng: '1 hour',
        cht: '1小時',
    },
    selectItem4hr: {
        eng: '4 hour',
        cht: '4小時',
    },
    selectItem8hr: {
        eng: '8 hour',
        cht: '8小時',
    },
    selectItem1day: {
        eng: '1 day',
        cht: '1日',
    },
    countAttempt: {
        eng: 'Attempt',
        cht: '嘗試登入',
    },
    countSuccess: {
        eng: 'Success',
        cht: '登入成功',
    },
    countError: {
        eng: 'Error',
        cht: '登入失敗',
    },
    count: {
        eng: 'Count',
        cht: '總次數',
    },

    showIndividually: {
        eng: 'Show individually',
        cht: '個別顯示',
    },
    numberOrder: {
        eng: 'No.',
        cht: '排序',
    },
    total: {
        eng: 'Total',
        cht: '總計',
    },
    last1Day: {
        eng: 'Last 1 day',
        cht: '最近1天',
    },
    last8Hour: {
        eng: 'Last 8 hour',
        cht: '最近8小時',
    },
    last4Hour: {
        eng: 'Last 4 hour',
        cht: '最近4小時',
    },
    last1Hour: {
        eng: 'Last 1 hour',
        cht: '最近1小時',
    },
    showMax5: {
        eng: 'Show max 5 rows',
        cht: '顯示前5筆',
    },
    showAll: {
        eng: 'Show all',
        cht: '顯示全部',
    },

    //bbb 以下尚未使用

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

}


let init = (opt = {}) => {

    //kpLangExt
    let kpLangExt = get(opt, 'kpLangExt')
    if (!iseobj(kpLangExt)) {
        kpLangExt = {}
    }

    //webName
    let webName = get(opt, 'webName')
    if (!iseobj(webName)) {
        webName = {}
    }

    //webDescription
    let webDescription = get(opt, 'webDescription')
    if (!iseobj(webDescription)) {
        webDescription = {}
    }

    //kp
    let kp = {}

    //kpLang
    kp = {
        ...kp,
        ...kpLang,
    }

    //ext kpLangExt
    if (iseobj(kpLangExt)) {
        // console.log('kpLangExt', kpLangExt)
        kp = {
            ...kp,
            ...kpLangExt,
        }
    }

    //webName
    if (iseobj(webName)) {
        // console.log('webName', webName)
        kp = {
            ...kp,
            webName: {
                ...webName,
            },
        }
    }

    //webDescription
    if (iseobj(webDescription)) {
        // console.log('webDescription', webDescription)
        kp = {
            ...kp,
            webDescription: {
                ...webDescription,
            },
        }
    }

    let langs = [
        'eng',
        'cht',
    ]

    let r = {}
    each(langs, (lang) => {

        //kpText
        let kpText = {}
        each(kp, (v, k) => {
            kpText[k] = v[lang]
        })
        // console.log('kpText', kpText)

        //save
        r[lang] = kpText

    })
    // console.log('r', r)

    return r
}


export default init
