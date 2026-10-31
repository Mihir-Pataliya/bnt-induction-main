p='tests/rma.browser.mjs'
s=open(p).read()
s=s.replace('  const page = await browser.newPage();','  console.log("new page");\n  const page = await browser.newPage();\n  console.log("page created");')
open(p,'w').write(s)
print('done')
