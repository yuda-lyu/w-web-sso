//最小重現(2026-09-29; 當時轉交業主之 建議w-component-vue修正.md 已於 w-component-vue 2.5.24 採納「pe」修法並由業主刪除, 見 spec/設計要點與取捨.md ADR-077):
//游標下之子節點被移除(按鈕圖示換成載入圖示)後出現全頁遮罩, 移開游標時外層是否仍收到 mouseleave.
//與本系統無關之獨立頁面, 只依賴 playwright(1.62.1 之預設啟動參數停用 BoundaryEventDispatchTracksNodeRemoval). 跑法(專案根): node spec/evidence/2026-09-29-tooltip-mouseleave-repro.mjs
//2026-09-29 實測輸出: none=enter,leave; swap=enter,enter,leave; overlay=enter,leave; swap+overlay=enter(無 leave);
//swap+overlay+pe=enter,leave; vshow+overlay=enter,leave; swap+swap2+overlay=enter(無 leave). 2026-09-30 重跑結果相同.
import { chromium } from 'playwright'

let html = `
<div id="wrap" style="display:inline-block; padding:10px; background:#eee; margin:100px;">
  <div id="btn" style="width:40px; height:40px; background:#f99;"><span id="icon" style="display:block; width:40px; height:40px; background:#9f9;"></span><span id="spin2" style="display:none; width:40px; height:40px; background:#99f;"></span></div>
</div>
<div id="overlay" style="display:none; position:fixed; left:0; top:0; right:0; bottom:0; background:rgba(0,0,0,0.3);"></div>
<script>
window.log = []
wrap.addEventListener('mouseenter', () => log.push('enter'))
wrap.addEventListener('mouseleave', () => log.push('leave'))
window.mode = ''
btn.addEventListener('click', () => {
  if (mode.includes('swap')) {
    let icon = document.getElementById('icon')
    icon.remove()
    let s = document.createElement('span')
    s.id = 'spin'
    s.style.cssText = 'display:block; width:40px; height:40px; background:#99f;' + (mode.includes('pe') ? ' pointer-events:none;' : '')
    btn.appendChild(s)
  }
  if (mode.includes('swap2')) {
    //模擬 handler 第一行 pm.resolve: 圖示換成載入圖示後, 同一輪 microtask 內再換回新的圖示節點
    Promise.resolve().then(() => {
      let sp = document.getElementById('spin')
      if (sp) sp.remove()
      let n = document.createElement('span')
      n.id = 'icon2'
      n.style.cssText = 'display:block; width:40px; height:40px; background:#9f9;'
      btn.appendChild(n)
    })
  }
  if (mode.includes('vshow')) {
    document.getElementById('icon').style.display = 'none'
    document.getElementById('spin2').style.display = 'block'
  }
  if (mode.includes('overlay')) {
    overlay.style.display = 'block'
  }
})
</script>`

let browser = await chromium.launch()
let out = {}
for (let mode of ['none', 'swap', 'overlay', 'swap+overlay', 'swap+overlay+pe', 'vshow+overlay', 'swap+swap2+overlay']) {
    let page = await browser.newPage()
    await page.setContent(html)
    await page.evaluate((m) => {
        window.mode = m
        //pe: 圖示層不接收指標事件(命中恆為外層按鈕容器)
        if (m.includes('pe')) {
            document.getElementById('icon').style.pointerEvents = 'none'
        }
    }, mode)
    let b = await page.locator('#icon').boundingBox()
    await page.mouse.move(b.x + 20, b.y + 20)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(100)
    await page.mouse.move(0, 0)
    await page.waitForTimeout(100)
    out[mode] = await page.evaluate(() => window.log.join(','))
    await page.close()
}
await browser.close()
console.log(JSON.stringify(out))
