//unit-sysfuncs-premise.test.mjs — 「公開 [sys:polling]」之前提與設定之靜態守護 (ADR-096; R-SYS-01 規則 2~4)
//
// 為何需要: `[sys:polling]` 對匿名者公開, 其正當性只在於「本套件無同步表、不使用廣播(恆回空陣列)」且「getUserIdByToken 恆回空字串、不拋錯」;
//   這些是原始碼層之前提, 行為測試(api-sysfuncs)只能在「沒有人廣播」的取樣瞬間驗證, 無法擋住日後新增廣播或同步表, 故以靜態盤點守護(比照 unit-writeContract WC-09 / WC-10)。
// 範圍: server/ 與 src/ 之原始碼(去除註解後判斷); 另驗已安裝之框架版本足以理解 sysFuncsPublic(版本過舊的 w-serv-webdata 會靜默忽略該選項而退回全公開)。

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


//專案根(本檔位於 test/); 場景 B: 讀套件自身之原始碼, 以本檔位置為準
let root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8')
}

//去註解(行註解與區塊註解; 註解可提及名稱)。簡化處理: 不處理字串內含 // 之情形——本檔只用於比對識別字與選項字面
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function walk(dir, exts, out = []) {
    for (let f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        let rel = `${dir}/${f.name}`
        if (f.isDirectory()) {
            if (f.name === 'template' || f.name === 'node_modules') continue
            walk(rel, exts, out)
        }
        else if (exts.some((e) => f.name.endsWith(e))) {
            out.push(rel)
        }
    }
    return out
}

function verOf(pkg) {
    let v = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version
    return v.split('.').map((x) => parseInt(x, 10))
}

function gte(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i]
    }
    return true
}


describe('「公開 [sys:polling]」之前提與設定 (ADR-096 / R-SYS-01)', function() {

    it('SP-01 server/ 不呼叫 broadcast(含經回傳實體 getInstWConverServer().broadcast): 否則匿名輪詢者會收到其內容(src/ 為前端, 其 broadcast 為無關之 Vue 輔助函數, 不在範圍)', function() {
        let files = walk('server', ['.mjs'])
        assert.ok(files.length > 15, `盤點到的原始碼檔數 ${files.length} 異常偏少`)
        let hits = []
        for (let rel of files) {
            let src = stripComments(read(rel))
            if (/\.\s*broadcast\s*\(|\bbroadcast\s*\(/.test(src)) {
                hits.push(rel)
            }
        }
        assert.deepStrictEqual(hits, [], `以下檔案出現 broadcast( 呼叫, 須重新評估 [sys:polling] 公開之前提(R-SYS-01 規則 2): ${hits.join(', ')}`)
    })

    it('SP-02 server/WWebSso.mjs: tableNamesSync 為空陣列、useDbOrm 為 false(無同步表, 不開資料通道)', function() {
        let src = stripComments(read('server/WWebSso.mjs'))
        assert.ok(/\btableNamesSync\s*:\s*\[\s*\]/.test(src), 'tableNamesSync: [] ')
        assert.ok(/\buseDbOrm\s*:\s*false\b/.test(src), 'useDbOrm: false')
        assert.ok(/\btableNamesExec\s*:\s*\[\s*\]/.test(src), 'tableNamesExec: []')
    })

    it('SP-03 getUserIdByToken 恆回空字串且不拋錯 / 不 reject(拋錯或 reject 會使所有函數含公開者被拒; 回真實 id 則輪詢綁定匿名 → 登入之切換被拒)', function() {
        let src = stripComments(read('server/WWebSso.mjs'))
        let m = src.match(/\bgetUserIdByToken\s*:\s*async\s*\(\s*token\s*\)\s*=>\s*\{([\s\S]*?)\n\s{8}\}/)
        assert.ok(m, '找不到 getUserIdByToken 之實作(形狀: getUserIdByToken: async (token) => { ... })')
        let body = m[1].trim()
        assert.strictEqual(body, "return ''", `getUserIdByToken 本體須恆為 return '', 實得: ${body.slice(0, 120)}`)
    })

    it('SP-04 sysFuncsPublic 於 server/WWebSso.mjs 恰一處顯式設定, 且恰為 [sys:getFuncList] 與 [sys:polling](不依賴框架預設)', function() {
        let src = stripComments(read('server/WWebSso.mjs'))
        let ms = [...src.matchAll(/\bsysFuncsPublic\s*:\s*\[((?:\s*'[^']*'\s*,?)*)\s*\]/g)]
        assert.strictEqual(ms.length, 1, `sysFuncsPublic 設定處數 ${ms.length}`)
        let names = ms[0][1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort()
        assert.deepStrictEqual(names, ['[sys:getFuncList]', '[sys:polling]'], `sysFuncsPublic 內容 ${JSON.stringify(names)}`)
        //前端沒有對應選項(框架用戶端無此設定; 傳播靠升級框架並重建), 避免誤以為前端也要設
        for (let rel of walk('src', ['.mjs', '.js', '.vue'])) {
            assert.ok(!/sysFuncsPublic/.test(stripComments(read(rel))), `${rel}: 前端不應出現 sysFuncsPublic`)
        }
    })

    it('SP-05 已安裝之 w-serv-hapi >= 1.1.8、w-serv-webdata >= 1.1.16、w-serv-broadcast >= 1.1.12(較舊版忽略 sysFuncsPublic 而靜默退回全公開), 且 package.json 範圍不低於 ^1.1.8', function() {
        assert.ok(gte(verOf('w-serv-hapi'), [1, 1, 8]), 'w-serv-hapi 已安裝版本')
        assert.ok(gte(verOf('w-serv-webdata'), [1, 1, 16]), 'w-serv-webdata 已安裝版本')
        assert.ok(gte(verOf('w-serv-broadcast'), [1, 1, 12]), 'w-serv-broadcast 已安裝版本')
        let rng = JSON.parse(read('package.json')).dependencies['w-serv-hapi']
        let m = String(rng).match(/^[\^~]?(\d+)\.(\d+)\.(\d+)$/)
        assert.ok(m, `w-serv-hapi 範圍格式 ${rng}`)
        assert.ok(gte([+m[1], +m[2], +m[3]], [1, 1, 8]), `package.json w-serv-hapi 範圍 ${rng} 須 >= 1.1.8`)
    })

})
