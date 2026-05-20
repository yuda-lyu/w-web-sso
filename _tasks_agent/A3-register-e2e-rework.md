# Agent 任務 A3: e2e-register rework (對應 A2 production 改動)

- **狀態**: pending (A2 完成且我接受後才派)
- **檔案**: test/e2e-register.test.mjs, spec/流程_使用者創建帳密.md
- **目標**:
  1. E2E-005-success: 原走 page.on('dialog') 接原生 alert → 現為 $alert DOM 模態, 改用 DOM modal 偵測; baseline 可能變 → 重產
  2. E2E-014/015/016: 原 it-only (page.on('dialog') 抓 dialog.message) → 現為 inline regError 紅字 (DOM); 改成 DOM 文字斷言 + **新增 baseline (升級為 full E2E)**
  3. spec: 014/015/016 由 `(it-only)` 改為有 baseline 的 E2E
- **約束**: act 走真實 UI (typeIntoInput 等); 語意斷言 + pixel baseline 雙軌
- **驗收**: T3 (e2e-register 全檔綠)
