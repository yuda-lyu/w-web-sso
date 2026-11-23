//第 389 項負載探測之 mocha 報告器: 每案結束輸出一行 JSON { seq, title, state, ms, err }(err 只取前 300 字), 結尾輸出彙總行
function reporter(runner) {
    let seq = 0
    let nPass = 0
    let nFail = 0
    runner.on('pass', (t) => {
        nPass++
        console.log(JSON.stringify({ seq: ++seq, title: t.fullTitle(), state: 'pass', ms: t.duration }))
    })
    runner.on('fail', (t, err) => {
        nFail++
        console.log(JSON.stringify({ seq: ++seq, title: t.fullTitle(), state: 'fail', ms: t.duration, err: String((err && err.message) || err).replace(/\s+/g, ' ').slice(0, 300) }))
    })
    runner.on('pending', (t) => {
        console.log(JSON.stringify({ seq: ++seq, title: t.fullTitle(), state: 'pending' }))
    })
    runner.on('end', () => {
        console.log(JSON.stringify({ summary: true, pass: nPass, fail: nFail }))
    })
}
module.exports = reporter
