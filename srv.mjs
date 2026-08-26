import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebSso from './server/WWebSso.mjs'
import getSettings from './g_getSettings.mjs'


//st
let st = getSettings()

let url = st.dbUrl
let db = st.dbName
let pathSettings = process.argv[2] || './settings.json'

//WWebSso
let instWWebSso = WWebSso(WOrm, url, db, pathSettings, st)

instWWebSso.on('error', (err) => {
    console.log(err)
})

//login測試
//http://localhost:8080/ => 登入後轉至指定頁
//http://localhost:8080/?token=sys => 網址給予token但不使用, 登入後轉至指定頁
//http://localhost:8080/?view=backstage => 登入後轉至後台
//http://localhost:8080/?view=backstage&token=sys => 網址給予token但不使用, 登入後轉至後台
//http://localhost:8080/?view=user => 登入後轉至使用者資訊頁
//http://localhost:8080/?view=user&token=sys => 網址給予token但不使用, 登入後轉至使用者資訊頁

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


let t=`

密碼長度需在8~16碼，且須符合以下5項規則：

(1)有0~9的數字

(2)有英文字母(不限大小寫)

(3)有特殊字元(非大小寫字母及數字，例如以下字元： ! @ # $ ^ & * ( ) - + < > ? …等字元)

(4)不可和駭客最常猜測複雜密碼相同，例如1qaz@WSX、P@ssw0rd等

(5)不可包含與自己姓名代號相同之2個以上之連續字元(例如姓名代號123456，密碼不可包含12、23、34、45、56)

(6)不可包含「\」

`