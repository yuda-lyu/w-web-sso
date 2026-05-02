import { spawn, execSync } from 'child_process'

//
// e2e 測試自動啟動／關閉前後端 server
//
// 行為：
// - 第一次呼叫 startServersOnce()：spawn 後端 (port 11007) 與前端 (port 8080)，
//   poll 直到回 HTTP 200 才 resolve；首次 vue-cli-service 編譯約 15~30 秒
// - 後續呼叫：只認 started 旗標，立即 return（多個 e2e 檔共用同一份 server）
// - 偵測到該 port 已有 server 在跑（開發者手動啟動）：直接重用，不 spawn 也不 kill
// - 進程結束（mocha 跑完或被中斷）：process.on('exit') / SIGINT / SIGTERM 觸發 cleanup，
//   只 kill 我們自己 spawn 出來的，不會誤殺手動啟動的
//

let backendProc = null
let frontendProc = null
let started = false


async function isPortUp(port) {
    try {
        let ctrl = new AbortController()
        let timer = setTimeout(() => ctrl.abort(), 1500)
        await fetch(`http://localhost:${port}/`, { signal: ctrl.signal })
        clearTimeout(timer)
        return true
    }
    catch (err) {
        return false
    }
}


async function waitForPort(port, timeoutMs) {
    let start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (await isPortUp(port)) {
            return
        }
        await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`server not ready on port ${port} after ${timeoutMs / 1000}s`)
}


function killProc(proc) {
    if (!proc || proc.killed) {
        return
    }
    if (process.platform === 'win32') {
        // Windows: 殺整個 process tree（npm.cmd → node → vue-cli-service 等子孫）
        try {
            execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' })
        }
        catch (err) {
            // already dead or pid invalid, ignore
        }
    }
    else {
        try {
            proc.kill('SIGKILL')
        }
        catch (err) {
            // ignore
        }
    }
}


async function startServersOnce() {
    if (started) {
        return
    }
    started = true

    // backend (port 11007)
    if (await isPortUp(11007)) {
        console.log('[e2e-setup] backend already running on 11007, reusing')
    }
    else {
        console.log('[e2e-setup] starting backend (port 11007)...')
        backendProc = spawn('node', ['srv.mjs'], { stdio: 'ignore' })
        await waitForPort(11007, 30000)
        console.log('[e2e-setup] backend ready')
    }

    // frontend (port 8080) — vue-cli-service serve 首次編譯約 15~30 秒
    if (await isPortUp(8080)) {
        console.log('[e2e-setup] frontend already running on 8080, reusing')
    }
    else {
        console.log('[e2e-setup] starting frontend (port 8080), first compile ~15-30s...')
        frontendProc = spawn('npm', ['run', 'serve'], { stdio: 'ignore', shell: true })
        await waitForPort(8080, 90000)
        console.log('[e2e-setup] frontend ready')
    }
}


// 進程結束時 cleanup（只殺自己 spawn 的）
function cleanup() {
    if (frontendProc) {
        killProc(frontendProc)
        frontendProc = null
    }
    if (backendProc) {
        killProc(backendProc)
        backendProc = null
    }
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
    cleanup()
    process.exit(130)
})
process.on('SIGTERM', () => {
    cleanup()
    process.exit(143)
})


export { startServersOnce }
