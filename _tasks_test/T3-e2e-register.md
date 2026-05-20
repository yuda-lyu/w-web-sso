# 測試任務 T3: e2e-register 全檔

- **狀態**: pending (依賴 A2 register code + A3 e2e rework 完成)
- **觸發變更**: register() alert→$alert + core+loading+inline regError (A2); e2e rework (A3)
- **指令**: npx mocha test/e2e-register.test.mjs --timeout 240000 --reporter list
- **預期**: 全 passing; E2E-014/015/016 升級為 inline 紅字 + 有 baseline
- **接受**: 全綠 → 刪此檔 + 接受 A2/A3; 失敗 → 派 agent 修
- **註**: 目前 register e2e 因 alert→$alert 已 BROKEN (E2E-005/014/015/016 用 page.on('dialog')), 必須 A2+A3 完成才會綠
