import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from './src/schema/index.mjs'
import getSettings from './g_getSettings.mjs'


//getSettings
let st = getSettings()

//url, db
let url = st.dbUrl
let db = st.dbName

//WServOrm, 不傳 opt: w-serv-orm 1.1.9 起無設定鍵(R-ORM-02, ADR-085)
let r = WServOrm(ds, WOrm, url, db)
let { woItems, procOrm } = r


export { woItems, procOrm }
