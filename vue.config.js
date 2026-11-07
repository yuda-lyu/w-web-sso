const http = require('http')

//dev server 之 /api proxy 重用至後端之連線(ss324, R-E2E-PROXY-01): http-proxy 未給 agent 時以 agent:false 每個請求新開一條連線並送 Connection: close,
//後端回應之 connection: close 又被轉回瀏覽器, 使每個 /api 請求於「瀏覽器→dev server」「dev server→後端」兩段各留一個 TIME_WAIT(e2e 大量請求時上萬個)
const proxyAgent = new http.Agent({ keepAlive: true })

module.exports = {
    productionSourceMap: false, //不產出map檔
    lintOnSave: false, //禁止eslint-loader於編譯時檢查語法
    devServer: {
        proxy: {
            '/api': {
                //e2e 多開 (ws302): 臨時實例之後端埠 = 基準埠 + E2E_PORT_OFFSET (shardE2e 設於實例行程, dev server 子行程繼承); 未設時值仍為 11007
                target: 'http://localhost:' + (11007 + Number(process.env.E2E_PORT_OFFSET || 0)),
                agent: proxyAgent,
                pathRewrite: {
                    '^/api': '/api'
                },
            },
        }
    },
    // transpileDependencies: [''],
    publicPath: process.env.NODE_ENV === 'production' ? '/msso/' : '/', //預先編譯至msso子目錄下, 待轉成模板, 並於伺服器啟動後依照設定檔取代
}
