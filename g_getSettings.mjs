import path from 'path'
import fs from 'fs'


function loadEnv() {
    let envPath = path.resolve('.env')
    if (!fs.existsSync(envPath)) {
        return
    }
    let content = fs.readFileSync(envPath, 'utf8')
    let lines = content.split(/\r?\n/)
    for (let line of lines) {
        line = line.trim()
        if (!line || line.startsWith('#')) {
            continue
        }
        let idx = line.indexOf('=')
        if (idx === -1) {
            continue
        }
        let key = line.slice(0, idx).trim()
        let value = line.slice(idx + 1).trim()
        if (!process.env[key]) {
            process.env[key] = value
        }
    }
}


function getSettings() {

    //loadEnv, 載入 .env 至 process.env
    loadEnv()

    //st
    let st = {
        // 'dbUsername': 'username',
        // 'dbPassword': 'password',
        // 'dbName': 'wsso',
        // 'dbIP': '127.0.0.1',
        // 'dbPort': 27017,
        'dbUrl': './db',
        'dbName': 'wsso',
    }

    //overlay .env (機敏資訊由 .env 提供，覆蓋 settings.json 預設值)
    if (process.env.EM_SRC_EMAIL) {
        st.emSrcEmail = process.env.EM_SRC_EMAIL
    }
    if (process.env.EM_SRC_PW) {
        st.emSrcPW = process.env.EM_SRC_PW
    }
    if (process.env.EM_SRC_HOST) {
        st.emSrcHost = process.env.EM_SRC_HOST
    }
    if (process.env.EM_SRC_PORT) {
        st.emSrcPort = parseInt(process.env.EM_SRC_PORT, 10)
    }
    if (process.env.SALT) {
        st.salt = process.env.SALT //D21: 生產經 SALT env 注入真實 pepper (取代 settings 佔位符)
    }

    return st
}


export default getSettings
