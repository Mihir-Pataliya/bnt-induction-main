file_path = r"C:\Users\Dell\Downloads\bnt-induction-main\bnt-induction-main\apps\web\src\components\driver\SpeedAwarenessDriver.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix the useEffect timeout — remove the 60s hard error, just let iframe's onLoad handle it
old_effect = (
    "    setPresentationLoading(true);\r\n"
    "    setPresentationError(\"\");\r\n"
    "    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n"
    "    presentationLoadTimer.current = window.setTimeout(() => {\r\n"
    "      setPresentationLoading((prev) => {\r\n"
    "        if (prev) {\r\n"
    "          setPresentationError(\"The presentation could not be loaded. Please try again later.\");\r\n"
    "        }\r\n"
    "        return false;\r\n"
    "      });\r\n"
    "    }, 60000);\r\n"
)

new_effect = (
    "    // Show loading overlay; the iframe's onLoad event will clear it.\r\n"
    "    // Do NOT use display:none/block on the iframe — Office Online won't render if hidden.\r\n"
    "    setPresentationLoading(true);\r\n"
    "    setPresentationError(\"\");\r\n"
    "    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);\r\n"
)

if old_effect in content:
    content = content.replace(old_effect, new_effect)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("SUCCESS: useEffect timeout removed")
else:
    print("ERROR: old_effect not found")
    idx = content.find("setPresentationLoading(true)")
    print(f"Found setPresentationLoading at: {idx}")
    print(repr(content[idx-5:idx+200]))

