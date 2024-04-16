import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM, 使用Mongodb測試
import WWebSso from './server/WWebSso.mjs'
import getSettings from './g.getSettings.mjs'


//st
let st = getSettings()

let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}` //使用Mongodb測試
let db = st.dbName
let opt = {

    bCheckUser: false,
    getUserById: null,
    bExcludeWhenNotAdmin: false,

    serverPort: 11007,
    subfolder: '', //msso

    webName: {
        'eng': 'Single Sign-On System',
        'cht': '使用者單一登入系統',
    },
    webDescription: {
        'eng': 'A web service package for Single Sign-On.',
        'cht': 'A web service package for Single Sign-On.',
    },
    webLogo: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiA/PjxzdmcgaWQ9Ikljb25zIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPjxkZWZzPjxzdHlsZT4uY2xzLTF7ZmlsbDp1cmwoI2xpbmVhci1ncmFkaWVudCk7fS5jbHMtMntmaWxsOnVybCgjbGluZWFyLWdyYWRpZW50LTIpO30uY2xzLTN7ZmlsbDojM2QzYzQ0O30uY2xzLTR7ZmlsbDp1cmwoI2xpbmVhci1ncmFkaWVudC0zKTt9PC9zdHlsZT48bGluZWFyR3JhZGllbnQgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIxMiIgeDI9IjEyIiB5MT0iMC4xOTEiIHkyPSI4Ljk4NCI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjNWQ1YzY2Ii8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNDg0NzRmIi8+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJsaW5lYXItZ3JhZGllbnQtMiIgeDE9IjEyIiB4Mj0iMTIiIHkxPSI5LjA4NSIgeTI9IjIzLjAwMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmNjUwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZhYjE3Ii8+PC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImxpbmVhci1ncmFkaWVudC0zIiB4Mj0iMTIiIHhsaW5rOmhyZWY9IiNsaW5lYXItZ3JhZGllbnQiIHkxPSIxMi45MTUiIHkyPSIxNy4wOTYiLz48L2RlZnM+PHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMTcsMTBhMSwxLDAsMCwxLTEtMVY2QTQsNCwwLDAsMCw4LDZWOUExLDEsMCwwLDEsNiw5VjZBNiw2LDAsMCwxLDE4LDZWOUExLDEsMCwwLDEsMTcsMTBaIi8+PHJlY3QgY2xhc3M9ImNscy0yIiBoZWlnaHQ9IjE0IiByeD0iMyIgd2lkdGg9IjE4IiB4PSIzIiB5PSI5Ii8+PHBhdGggY2xhc3M9ImNscy0zIiBkPSJNMTIsMjBhMSwxLDAsMCwxLTEtMVYxNmExLDEsMCwwLDEsMiwwdjNBMSwxLDAsMCwxLDEyLDIwWiIvPjxjaXJjbGUgY2xhc3M9ImNscy00IiBjeD0iMTIiIGN5PSIxNSIgcj0iMiIvPjwvc3ZnPg==',
    webBackgoundGradientColors: ['#FFE0B2', '#FFCC80', '#FFF59D', 'rgba(255, 224, 178, 0.5)', 'rgba(240, 220, 190, 0.7)'],
    webKey: 'ksso',

    salt: '{salt}',

    timeExpired: 30, //min

}

let getUserByToken = async (token) => {
    // return {} //測試無法登入
    if (token === '{token-for-application}') { //提供外部應用系統作為存取使用者
        return {
            id: 'id-for-application',
            name: 'application',
            email: 'application@example.com',
            isAdmin: 'y',
        }
    }
    if (token === 'sys') { //開發階段w-ui-loginout自動給予browser使用者(且位於localhost)的token為sys
        return {
            id: 'id-for-admin',
            name: 'tester',
            email: 'admin@example.com', //mappingBy為email, 開發階段時會使用email找到所建置之使用者資料
            isAdmin: 'y',
        }
    }
    console.log('invalid token', token)
    console.log('於生產環境時得加入驗證token機制')
    return {}
}

let verifyBrowserUser = (user, caller) => {
    console.log('verifyBrowserUser/user', user)
    // return false //測試無法登入
    console.log('於生產環境時得加入限制瀏覽器使用者身份機制')
    return user.isAdmin === 'y' //測試僅系統管理者使用
}

let verifyAppUser = (user, caller) => {
    console.log('verifyAppUser/user', user)
    // return false //測試無法登入
    console.log('於生產環境時得加入限制應用程式使用者身份機制')
    return user.isAdmin === 'y' //測試僅系統管理者使用
}

//WWebSso
let instWWebSso = WWebSso(WOrm, url, db, getUserByToken, verifyBrowserUser, verifyAppUser, opt)

instWWebSso.on('error', (err) => {
    console.log(err)
})


//node --experimental-modules srv.mjs
