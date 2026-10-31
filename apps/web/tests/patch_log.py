p='tests/rma.browser.mjs'
s=open(p).read()
old='});\n\nlet browser;'
new='});\nconsole.log("created server");\n\nlet browser;'
assert old in s
s=s.replace(old,new,1)
open(p,'w').write(s)
print('done')
