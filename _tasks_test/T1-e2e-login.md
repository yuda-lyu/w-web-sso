# 測試任務 T1: e2e-login 全檔

- **狀態**: running (PID 見 tmp/verify-login.pid)
- **觸發變更**: resendVerify() 補齊統一風格 + (login 結構未動但同檔)
- **指令**: npx mocha test/e2e-login.test.mjs --timeout 240000 --reporter list
- **預期**: 全 passing (resendVerify 保留 showCheckYes + 成功前關 loading → E2E-005 baseline 不變)
- **接受**: 全綠 → 刪此檔; 失敗 → 派 agent 修 resendVerify/login + 重跑
