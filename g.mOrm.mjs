import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from './src/schema/index.mjs'
import getSettings from './g.getSettings.mjs'


//getSettings
let st = getSettings()

//url, db
let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
let db = st.dbName

//WServOrm
let opt = {
    getUserById: null,
    bCheckUser: false,
    bExcludeWhenNotAdmin: false,
}
let r = WServOrm(ds, WOrm, url, db, opt)
let { woItems, procOrm } = r


export { woItems, procOrm }
