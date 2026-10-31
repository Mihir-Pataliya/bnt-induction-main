const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  page.on('pageerror', err => logs.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  // try to fill login
  await page.fill('input[type="email"]', 'admin@bntlogistics.com.au').catch(()=>{});
  await page.fill('input[type="password"]', 'Param@2001').catch(()=>{});
  await page.click('button[type="submit"]').catch(()=>{});
  await page.waitForTimeout(3000);
  console.log('LOGS:', JSON.stringify(logs));
  await browser.close();
})();