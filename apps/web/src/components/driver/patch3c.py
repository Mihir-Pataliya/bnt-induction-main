file_path = r"C:\Users\Dell\Downloads\bnt-induction-main\bnt-induction-main\apps\web\src\components\driver\SpeedAwarenessDriver.tsx"

with open(file_path, "r", encoding="utf-8", newline='') as f:
    content = f.read()

# The file has mixed line endings: first line after the \n-only section has \r\n
# Use a more flexible approach — find and replace by scanning
import re

# Replace the timeout block (60s error trigger)
old_timeout = (
    '\n    setPresentationLoading(true);\r\n'
    '    setPresentationError("");\r\n'
    '    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n'
    '    presentationLoadTimer.current = window.setTimeout(() => {\r\n'
    '      setPresentationLoading((prev) => {\r\n'
    '        if (prev) {\r\n'
    '          setPresentationError("The presentation could not be loaded. Please try again later.");\r\n'
    '        }\r\n'
    '        return false;\r\n'
    '      });\r\n'
    '    }, 60000);\r\n'
)

new_timeout = (
    '\n    // Show loading overlay; cleared by the iframe onLoad event.\r\n'
    '    setPresentationLoading(true);\r\n'
    '    setPresentationError("");\r\n'
    '    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n'
)

if old_timeout in content:
    content = content.replace(old_timeout, new_timeout)
    with open(file_path, "w", encoding="utf-8", newline='') as f:
        f.write(content)
    print("SUCCESS: timeout block removed")
else:
    print("Trying => variant...")
    old_timeout2 = (
        '\n    setPresentationLoading(true);\r\n'
        '    setPresentationError("");\r\n'
        '    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n'
        '    presentationLoadTimer.current = window.setTimeout(() => {\r\n'
    )
    idx = content.find(old_timeout2)
    if idx >= 0:
        # find end of setTimeout block
        end_marker = '    }, 60000);\r\n'
        end_idx = content.find(end_marker, idx)
        if end_idx >= 0:
            old_block = content[idx:end_idx + len(end_marker)]
            print("Found block:", repr(old_block))
            content = content.replace(old_block, '\n    // Show loading overlay; cleared by the iframe onLoad event.\r\n    setPresentationLoading(true);\r\n    setPresentationError("");\r\n    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n')
            with open(file_path, "w", encoding="utf-8", newline='') as f:
                f.write(content)
            print("SUCCESS via fallback")
        else:
            print("Could not find end_marker")
    else:
        print("Could not find block at all")

