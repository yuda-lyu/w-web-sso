import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebSso from './server/WWebSso.mjs'
import getSettings from './g.getSettings.mjs'


//st
let st = getSettings()

let url = st.dbUrl
let db = st.dbName
let pathSettings = './settings.json'

//WWebSso
let instWWebSso = WWebSso(WOrm, url, db, pathSettings)

instWWebSso.on('error', (err) => {
    console.log(err)
})

//login測試
//http://localhost:8080/ => 登入後轉至指定頁
//http://localhost:8080/?token=sys => 網址給予token但不使用, 登入後轉至指定頁
//http://localhost:8080/?view=backstage => 登入後轉至後台
//http://localhost:8080/?view=backstage&token=sys => 網址給予token但不使用, 登入後轉至後台

//autoLogin測試
//http://localhost:8080/ => 無token須轉至登入頁
//http://localhost:8080/?token=sys => 雖網址有token但cache無token, 須轉至登入頁
//http://localhost:8080/?view=backstage => 無token須轉至登入頁
//http://localhost:8080/?view=backstage&token=sys => 雖網址有token但cache無token, 須轉至登入頁
//http://localhost:8080/, with cache token => 有cache內token可至指定頁
//http://localhost:8080/?view=backstage, with cache token => 有cache內token可至後台
//http://localhost:8080/?view=backstage&token=sys, with cache token => 雖網址有token但須以cache內token為主, 有cache內token可至後台

//api測試
//http://localhost:11007/api/checkToken?token=token-for-viewer&key=token => true
//http://localhost:11007/api/checkToken?token=token-for-app&key=token => true
//http://localhost:11007/api/getSsoUserInfor?token=token-for-viewer&key=name&value=viewer => 要能查到使用者id-for-viewer的資訊
//http://localhost:11007/api/getSsoUserInfor?token=token-for-app&key=name&value=viewer => 要能查到使用者id-for-viewer的資訊
//http://localhost:11007/api/getSsoUserInfor?token=token-for-viewer&key=token&value=token-for-viewer => 無使用者id-for-viewer, 要能取得虛擬使用者資訊
//http://localhost:11007/api/getSsoUserInfor?token=token-for-app&key=token&value=token-for-app => 無使用者id-for-app, 要能取得虛擬使用者資訊

//node srv.mjs
