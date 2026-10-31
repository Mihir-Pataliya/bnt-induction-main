const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', message => console.log('CONSOLE', message.type(), message.text()));
  page.on('pageerror', error => console.log('PAGEERROR', error.message));
  page.on('response', response => { if (response.status() >= 400) console.log('HTTP', response.status(), response.url()); });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Driver Access' }).click();
  await page.locator('input[type=email]').fill('driver@bntlogistics.com.au');
  await page.locator('input[type=password]').fill('Driver@2001');
  await page.getByRole('button', { name: 'Enter Driver Portal' }).click();
  await page.waitForTimeout(12000);
  const bodyText = await page.locator('body').innerText();
  console.log(bodyText.slice(0, 10000));
  const cor = page.getByRole('button', { name: 'COR', exact: true });
  if (await cor.count()) { await cor.click(); await page.waitForTimeout(3000); console.log('COR:', (await page.locator('body').innerText()).slice(0, 10000)); }
  const speedHeading = page.getByText('Speed Awareness', { exact: true }).last();
  if (await speedHeading.count()) { console.log('opens', await page.getByRole('button', { name: 'Open', exact: true }).count()); const card = speedHeading.locator('xpath=ancestor::div[contains(@class,"dashboard-panel")][1]'); await card.getByRole('button', { name: 'Open', exact: true }).click(); await page.waitForTimeout(5000); console.log('SPEED:', (await page.locator('body').innerText()).slice(0, 10000)); console.log('IFRAMES', await page.locator('iframe').count()); }
  if (await page.locator('iframe').count()) { const iframe = page.locator('iframe').first(); console.log('IFRAME SRC', await iframe.getAttribute('src')); console.log('IFRAME BOX', await iframe.boundingBox()); console.log('IFRAME FRAME URL', await iframe.contentFrame().then(frame => frame?.url())); } }
  await page.screenshot({ path: 'speed-driver-login.png', fullPage: true });
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
