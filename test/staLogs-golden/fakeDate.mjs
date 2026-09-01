//以 --import 預載: 把 global Date 之「現在」釘在 FIXED, 使舊實作(以 ot() 取 now)可產出固定 expected
//用法: node --import ./test/staLogs-golden/fakeDate.mjs test/staLogs-golden/gen-expected.mjs expected
let FIXED = process.env.FAKE_NOW ? Number(process.env.FAKE_NOW) : 1788150896789 //預設 2026-08-31 12:34:56.789 (+08:00); 可由 FAKE_NOW 覆寫
let RealDate = Date

class FakeDate extends RealDate {
    constructor(...args) {
        if (args.length === 0) {
            super(FIXED)
        }
        else {
            super(...args)
        }
    }

    static now() {
        return FIXED
    }
}

globalThis.Date = FakeDate
