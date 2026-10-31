p='tests/rma.browser.mjs'
s=open(p).read()
s=s.replace('await page.getByRole("button", { name: "Open Assessment" }).click();','await page.getByRole("button", { name: "Risk Management Assessment" }).click();')
open(p,'w').write(s)
print('done')
