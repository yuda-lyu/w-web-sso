module.exports = {
    productionSourceMap: false, //不產出map檔
    lintOnSave: false, //禁止eslint-loader於編譯時檢查語法
    devServer: {
        proxy: {
            '/api': {
                //e2e 多開 (ws302): 臨時實例之後端埠 = 基準埠 + E2E_PORT_OFFSET (shardE2e 設於實例行程, dev server 子行程繼承); 未設時值仍為 11007
                target: 'http://localhost:' + (11007 + Number(process.env.E2E_PORT_OFFSET || 0)),
                pathRewrite: {
                    '^/api': '/api'
                },
            },
        }
    },
    // transpileDependencies: [''],
    publicPath: process.env.NODE_ENV === 'production' ? '/msso/' : '/', //預先編譯至msso子目錄下, 待轉成模板, 並於伺服器啟動後依照設定檔取代
}
