p='tests/rma.browser.mjs'
s=open(p).read()
s=s.replace('  await page.getByText("Approved", { exact: false }).waitFor();','  await page.getByText("Approved", { exact: true }).waitFor();')
open(p,'w').write(s)
print('done')
