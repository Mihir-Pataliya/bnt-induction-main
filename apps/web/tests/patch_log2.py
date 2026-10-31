p='tests/rma.browser.mjs'
s=open(p).read()
s=s.replace('  await server.listen();','  await server.listen();\n  console.log("server listened");')
s=s.replace('  browser = await chromium.launch({ channel: "chrome", headless: true });','  console.log("launching browser");\n  browser = await chromium.launch({ channel: "chrome", headless: true });\n  console.log("browser launched");')
open(p,'w').write(s)
print('done')
