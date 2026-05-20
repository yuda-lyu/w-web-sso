# 測試任務 T2: e2e-resetpassword 全檔

- **狀態**: pending (依賴 A1 接受 + A4 修完 admin-UI 5-fail)
- **觸發變更**: (1) modifyItemPasswordById 重構 (A1) → admin-UI; (2) submitChangePassword 改動 → user-flow (force-change 共用 PageUser); (3) 我 regen 的 admin-UI baseline 5-fail (A4)
- **指令**: npx mocha test/e2e-resetpassword.test.mjs --timeout 240000 --reporter list
- **預期**: 全 passing (admin-UI E2E-001~004 + user-flow E2E-005~013)
- **接受**: 全綠 → 刪此檔 + 接受 A1/A4; 失敗 → 依 fail 類型派 agent 修或調 baseline
- **註**: 目前已知 admin-UI 5 fail (eng 4 + cht 1), 須先 A4 診斷修
