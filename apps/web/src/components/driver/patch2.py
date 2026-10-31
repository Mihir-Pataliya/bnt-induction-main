import re

file_path = r"C:\Users\Dell\Downloads\bnt-induction-main\bnt-induction-main\apps\web\src\components\driver\SpeedAwarenessDriver.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# ---------------------------------------------------------------
# 1. Remove presentationLoading state and its useEffect entirely
# ---------------------------------------------------------------

# Remove state declaration
old_state = '  const [presentationLoading, setPresentationLoading] = useState(false);\n'
new_state = '  const [presentationLoading, setPresentationLoading] = useState(true);\n'
# keep it but we'll change the useEffect

# ---------------------------------------------------------------
# 2. Replace the entire learn tab block with the clean version
# ---------------------------------------------------------------
old_learn = """      {activeTab === "learn" && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-4">
          <h3 className="text-lg font-bold text-white">Approved Speed Awareness Presentation</h3>
          <p className="text-sm text-slate-300">{presentationVersion}</p>
          {presentationEmbedUrl ? (
            <div className="space-y-3">
              <div
                className="w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
                style={{ height: "600px" }}
              >
                {presentationLoading && (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading presentation\u2026
                  </div>
                )}
                {presentationError && !presentationLoading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                    <p className="text-sm text-red-300">{presentationError}</p>
                    <a
                      href={presentationEmbedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                    >
                      Open Presentation in New Tab
                    </a>
                  </div>
                ) : (
                  <iframe
                    title={`Speed Awareness Presentation - ${presentationVersion}`}
                    src={presentationEmbedUrl}
                    width="100%"
                    height="100%"
                    style={{ border: "none", display: presentationLoading ? "none" : "block" }}
                    allow="fullscreen; autoplay; clipboard-write; encrypted-media"
                    onLoad={() => {
                      if (presentationLoadTimer.current) {
                        clearTimeout(presentationLoadTimer.current);
                        presentationLoadTimer.current = null;
                      }
                      setPresentationLoading(false);
                      setPresentationError("");
                    }}
                    onError={() => {
                      if (presentationLoadTimer.current) {
                        clearTimeout(presentationLoadTimer.current);
                        presentationLoadTimer.current = null;
                      }
                      setPresentationLoading(false);
                      setPresentationError("Unable to load the presentation. Please try again later.");
                    }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">Use the slide controls at the bottom to navigate.</p>
                <a
                  href={presentationEmbedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Open in full screen \u2197
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Presentation link not configured by administrator.</p>
          )}
          {presentationError && <p role="alert" className="text-sm text-red-300">{presentationError}</p>}
        </div>
      )}"""

new_learn = """      {activeTab === "learn" && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-4">
          <h3 className="text-lg font-bold text-white">Approved Speed Awareness Presentation</h3>
          <p className="text-sm text-slate-300">{presentationVersion}</p>
          {presentationEmbedUrl ? (
            <div className="space-y-3">
              {/* Outer container: fixed 600px height, no overflow-hidden so Office Online renders fully */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "600px",
                  borderRadius: "12px",
                  border: "1px solid #334155",
                  overflow: "hidden",
                  background: "#020617"
                }}
              >
                {/* Loading overlay — sits ON TOP of the iframe, fades away on load */}
                {presentationLoading && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#020617",
                      color: "#94a3b8",
                      fontSize: "0.875rem"
                    }}
                  >
                    Loading presentation…
                  </div>
                )}
                {/* iframe is ALWAYS rendered and ALWAYS visible — never display:none */}
                <iframe
                  title={`Speed Awareness Presentation - ${presentationVersion}`}
                  src={presentationEmbedUrl}
                  frameBorder={0}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none"
                  }}
                  allow="fullscreen; autoplay; clipboard-write; encrypted-media"
                  onLoad={() => {
                    if (presentationLoadTimer.current) {
                      clearTimeout(presentationLoadTimer.current);
                      presentationLoadTimer.current = null;
                    }
                    setPresentationLoading(false);
                  }}
                />
              </div>
              {presentationError && (
                <p role="alert" className="text-sm text-red-300">{presentationError}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">Use the slide controls at the bottom of the presentation to navigate.</p>
                <a
                  href={presentationEmbedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Open in full screen \u2197
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              {presentationError || "Presentation link not configured by administrator."}
            </p>
          )}
        </div>
      )}"""

if old_learn in content:
    content = content.replace(old_learn, new_learn)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("SUCCESS: Learn tab patched")
else:
    print("ERROR: Could not find old learn block")
    idx = content.find('activeTab === "learn"')
    print(f"Found at index: {idx}")
    print(repr(content[idx:idx+100]))

