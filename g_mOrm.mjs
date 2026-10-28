import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from './src/schema/index.mjs'
import getSettings from './g_getSettings.mjs'


//getSettings
let st = getSettings()

//url, db
let url = st.dbUrl
let db = st.dbName

//WServOrm, 不傳 opt: w-serv-orm 1.1.9 起無設定鍵(R-ORM-02, ADR-085); 開發腳本與測試用之單例, 無 srLog, 診斷輸出依 w-serv-orm 1.1.20 預設(console 只列標籤與不含個資之摘要), 刻意不接 funLog(R-ORM-04)
let r = WServOrm(ds, WOrm, url, db)
let { woItems, procOrm } = r


export { woItems, procOrm }
