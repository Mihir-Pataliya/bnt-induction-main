file_path = r"C:\Users\Dell\Downloads\bnt-induction-main\bnt-induction-main\apps\web\src\components\driver\SpeedAwarenessDriver.tsx"

with open(file_path, "r", encoding="utf-8", newline='') as f:
    content = f.read()

print("Line endings:", repr(content[100:110]))

# Check what separators are there
idx = content.find("setPresentationLoading(true)")
snippet = content[idx-5:idx+300]
print("Snippet:", repr(snippet))

