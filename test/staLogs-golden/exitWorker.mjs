//測試用 worker: 載入後未送任何訊息即結束 (模擬 worker 內 process.exit), 供 WORKER-002 驗證 callWorker 之 exit 路徑必 reject
process.exit(0)
