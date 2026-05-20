# 測試任務 T4/T5/T6: e2e-adduser / e2e-deleteuser / e2e-modifyuser

- **狀態**: deferred (僅在 A5 saveUsers 改動後才需; A5 deferred)
- **觸發變更**: 若 A5 (saveUsers #1 loading 位置) 改動 → 這 3 個後台 e2e 走 saveUsers save 流程
- **指令**:
  - npx mocha test/e2e-adduser.test.mjs --timeout 240000 --reporter list
  - npx mocha test/e2e-deleteuser.test.mjs --timeout 240000 --reporter list
  - npx mocha test/e2e-modifyuser.test.mjs --timeout 240000 --reporter list
- **預期**: 全 passing (loading 時序變, baseline 應不變因截 settled 態)
- **接受**: 三檔皆綠 → 刪此檔 + 接受 A5; 失敗 → 派 agent 修
- **註**: 此前 (base-seed 重構後) 三檔已各自驗綠 (adduser 31 / deleteuser 10 / modifyuser 30); 僅 A5 動了才需重驗
