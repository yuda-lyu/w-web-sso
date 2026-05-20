# Agent 任務 A4: resetpassword admin-UI 5-fail 診斷與修

- **狀態**: pending-diagnosis (需先 DB 空檔做 D1 diff 找成因, 再決定是 code 或 baseline 問題)
- **背景**: 我先前 regen resetpassword admin-UI (E2E-001/002/003/006 ×2) 後, mocha verify 5 個 fail (eng 4 + cht 1)。屬我造成的 red。
- **D1 (我做)**: 加 tmp dump → 跑 admin-UI describe → diff baseline vs verify capture → 依全域 §6.3 5 類成因 (DB內容/動畫/延遲特效/hover/async未settle) 定位, 不歸 warm-state
- **可能成因**: admin-UI 4 case 共用同一 admin session (interdependency); 或 modifyItemPasswordById 改動後 $alert 時序; 或 hover/動畫
- **修**: 若 code → 派 agent; 若 baseline/timing → 我調 regen 或 captureStable
- **驗收**: T2 (e2e-resetpassword 全檔綠, 含 admin-UI + user-flow)
