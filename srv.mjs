import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebSso from './server/WWebSso.mjs'
import getSettings from './g.getSettings.mjs'


//st
let st = getSettings()

let url = st.dbUrl
let db = st.dbName
let pathSettings = './settings.json'

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
let instWWebSso = WWebSso(WOrm, url, db, getUserByToken, verifyBrowserUser, verifyAppUser, pathSettings)

instWWebSso.on('error', (err) => {
    console.log(err)
})

//測試
//http://localhost:8080/ => 登入後轉至指定頁
//http://localhost:8080/?token=sys => 網址給予token但不使用, 登入後轉至指定頁
//http://localhost:8080/?view=backstage => 登入後轉至後台
//http://localhost:8080/?view=backstage&token=sys => 網址給予token但不使用, 登入後轉至後台

//node srv.mjs
