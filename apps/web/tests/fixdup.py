p='tests/rma.browser.mjs'
lines=open(p).read().splitlines()
out=[]
skip=False
for i,line in enumerate(lines):
    if line.strip()=='browser = await chromium.launch({ channel: "chrome",' and i+1 < len(lines) and lines[i+1].strip()=='headless: true });':
        # skip this and next line if previous kept duplicate? We'll keep first occurrence only
        if out and out[-1].strip()=='browser = await chromium.launch({ channel: "chrome", headless: true });':
            skip=True
            continue
    if skip:
        skip=False
        continue
    out.append(line)
open(p,'w').write('\n'.join(out)+'\n')
print('done')
