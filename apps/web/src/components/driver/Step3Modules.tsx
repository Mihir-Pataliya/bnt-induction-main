import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ArrowRight, Check, Download, PlayCircle, Circle, Clock } from "lucide-react";
import { DriverTrainingAcknowledgement, LearningSectionProgress, SessionState } from "../../types";
import { ModuleExtras } from "./ModuleExtras";
import { buildTranscriptPdf } from "../../lib/transcript";
import { organizationName } from "../../lib/supabase";
import { api } from "../../lib/api";
import { SignaturePad } from "../SignaturePad";

interface Step3ModulesProps {
  modules: LearningSectionProgress[];
  onToggleModule: (module: LearningSectionProgress, completed: boolean) => Promise<void>;
  onStartModule: (module: LearningSectionProgress) => Promise<void>;
  onContinue: () => Promise<void>;
  loading: boolean;
  session: SessionState;
  driverId?: string;
  driverName?: string;
  contentLoadError?: string;
}

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function positionKey(driverId: string, sectionId: string) {
  return `bnt-module-pos-${driverId}-${sectionId}`;
}

export function Step3Modules({ modules, onToggleModule, onStartModule, onContinue, loading, session, driverId, driverName, contentLoadError }: Step3ModulesProps) {
  const { t } = useTranslation();
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const currentModule = modules[activeModuleIndex] || modules[0];
  const [acknowledgements, setAcknowledgements] = useState<DriverTrainingAcknowledgement[]>([]);
  const [acknowledgementsLoading, setAcknowledgementsLoading] = useState(true);
  const [acknowledgementsLoadError, setAcknowledgementsLoadError] = useState("");
  const [acknowledgementReload, setAcknowledgementReload] = useState(0);
  const [acknowledgementConfirmed, setAcknowledgementConfirmed] = useState(false);
  const [signature, setSignature] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [acknowledgementSaving, setAcknowledgementSaving] = useState(false);
  const [acknowledgementError, setAcknowledgementError] = useState("");

  const [activeProgress, setActiveProgress] = useState(0);
  const [activeTime, setActiveTime] = useState(0);
  const [activeDuration, setActiveDuration] = useState(0);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);
  const [proceeding, setProceeding] = useState(false);
  const [proceedError, setProceedError] = useState<string | null>(null);

  const currentSectionId = currentModule?.sectionId;
  const currentSectionVersion = currentModule?.sectionVersion ?? "1.0";
  const savedAcknowledgement = acknowledgements.find((acknowledgement) =>
    acknowledgement.sectionId === currentSectionId && acknowledgement.sectionVersion === currentSectionVersion
  );

  useEffect(() => {
    let active = true;
    setAcknowledgementsLoading(true);
    setAcknowledgementsLoadError("");
    api.getDriverTrainingAcknowledgements(session)
      .then((saved) => { if (active) setAcknowledgements(saved); })
      .catch((cause: unknown) => {
        if (active) setAcknowledgementsLoadError(cause instanceof Error ? cause.message : "Could not load your training acknowledgements.");
      })
      .finally(() => { if (active) setAcknowledgementsLoading(false); });
    return () => { active = false; };
  }, [session, acknowledgementReload]);

  useEffect(() => {
    setAcknowledgementConfirmed(false);
    setSignature("");
    setHasSignature(false);
    setAcknowledgementError("");
  }, [currentSectionId, currentSectionVersion]);

  const submitAcknowledgement = async () => {
    if (!currentModule || !acknowledgementConfirmed || !hasSignature || acknowledgementSaving) return;
    setAcknowledgementSaving(true);
    setAcknowledgementError("");
    try {
      const saved = await api.submitDriverTrainingAcknowledgement(session, {
        sectionId: currentModule.sectionId,
        sectionVersion: currentSectionVersion,
        workerConfirmed: true,
        signature
      });
      setAcknowledgements((current) => [
        saved,
        ...current.filter((item) => !(item.sectionId === saved.sectionId && item.sectionVersion === saved.sectionVersion))
      ]);
      setAcknowledgementConfirmed(false);
      setSignature("");
      setHasSignature(false);
    } catch (cause) {
      setAcknowledgementError(cause instanceof Error ? cause.message : "Your acknowledgement could not be saved.");
    } finally {
      setAcknowledgementSaving(false);
    }
  };

  const savedPosition = useMemo(() => {
    if (!driverId || !currentSectionId) return 0;
    try {
      const raw = window.localStorage.getItem(positionKey(driverId, currentSectionId));
      const parsed = raw ? Number(raw) : 0;
      return parsed && !isNaN(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }, [driverId, currentSectionId]);

  useEffect(() => {
    setActiveProgress(0);
    setActiveTime(0);
    setActiveDuration(0);
    if (savedPosition > 0) {
      setResumeNotice(t("s3_resumed", { time: formatTime(savedPosition) }));
      const timer = setTimeout(() => setResumeNotice(null), 4000);
      return () => clearTimeout(timer);
    }
    setResumeNotice(null);
  }, [currentSectionId, savedPosition]);

  const allCompleted = modules.length > 0 && modules.every((m) => m.completed);
  const allAcknowledged = modules.length > 0 && modules.every((module) =>
    acknowledgements.some((acknowledgement) =>
      acknowledgement.sectionId === module.sectionId &&
      acknowledgement.sectionVersion === (module.sectionVersion ?? "1.0")
    )
  );
  const completedCount = modules.filter((m) => m.completed).length;
  const firstIncompleteMandatoryIndex = modules.findIndex((module) => module.isMandatory !== false && !module.completed);

  const goToModule = (index: number) => {
    if (firstIncompleteMandatoryIndex >= 0 && index > firstIncompleteMandatoryIndex) return;
    setJustCompletedId(null);
    setActiveModuleIndex(Math.max(0, Math.min(modules.length - 1, index)));
  };

  const handleOrderedVideoPositionUpdate = (seconds: number) => {
    setActiveTime(seconds);
    if (activeDuration > 0) {
      setActiveProgress(Math.min(100, Math.round((seconds / activeDuration) * 100)));
    }
  };

  // Auto-advance to the next module shortly after a successful completion.
  useEffect(() => {
    if (!justCompletedId || activeModuleIndex >= modules.length - 1) return;
    const timer = setTimeout(() => {
      setActiveModuleIndex((prev) => {
        if (modules[prev]?.sectionId === justCompletedId) {
          return Math.min(modules.length - 1, prev + 1);
        }
        return prev;
      });
      setJustCompletedId(null);
    }, 1800);
    return () => clearTimeout(timer);
  }, [justCompletedId, activeModuleIndex, modules]);

  const handleProceed = async () => {
    if (proceeding) return;
    setProceeding(true);
    setProceedError(null);
    try {
      await onContinue();
    } catch (err) {
      setProceedError(err instanceof Error ? err.message : t("err_save_module"));
    } finally {
      setProceeding(false);
    }
  };

  const handleModuleCompletionChange = async (module: LearningSectionProgress, completed: boolean) => {
    await onToggleModule(module, completed);
    setJustCompletedId(completed ? module.sectionId : null);
  };

  let parsedContent: { intro?: string; bullets?: string[]; scenario?: string } = {};
  if (currentModule?.summary) {
    try {
      parsedContent = JSON.parse(currentModule.summary);
    } catch {
      parsedContent = { intro: currentModule.summary };
    }
  }
  const contentItems = currentModule?.mediaJson?.contentItems;
  const hasOrderedContent = Array.isArray(contentItems) && contentItems.length > 0;
  const hasSequenceItems = hasOrderedContent && contentItems.length > 0;

  const handleDownloadTranscript = () => {
    if (!currentModule) return;
    try {
      const pdfBase64 = buildTranscriptPdf({
        moduleTitle: currentModule.title,
        driverName: driverName || t("common_driver"),
        date: new Date().toISOString(),
        organizationName,
        intro: parsedContent.intro,
        bullets: parsedContent.bullets,
        scenario: parsedContent.scenario
      });
      const binary = atob(pdfBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `BNT-Module-Transcript-${currentModule.sectionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      alert(t("err_transcript"));
    }
  };

  return (
    <div className="glass" style={{ padding: "28px", borderRadius: "16px", maxWidth: "1060px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 4px" }}>
            {t("s3_title")}
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
            {t("s3_sub")}
          </p>
        </div>
        <div style={{ background: "rgba(30, 58, 95, 0.08)", padding: "6px 14px", borderRadius: "20px", fontWeight: 700, fontSize: "0.85rem", color: "#1e3a5f" }}>
          {t("s3_modules_completed", { done: completedCount, total: modules.length })}
        </div>
      </div>

      {contentLoadError && (
        <div role="alert" style={{ padding: "14px 16px", borderRadius: "10px", border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
          {contentLoadError}
        </div>
      )}
      {!contentLoadError && modules.length === 0 && (
        <div role={loading ? "status" : "alert"} style={{ padding: "18px", borderRadius: "10px", border: "1px solid var(--border, #cbd5e1)", color: "var(--text, #0f172a)" }}>
          {loading ? "Loading training topics…" : "No training topics are currently available. Please contact your administrator."}
        </div>
      )}

      {/* Module Selector Tabs */}
      <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "12px", marginBottom: "24px" }}>
        {modules.map((mod, idx) => {
          const isActive = activeModuleIndex === idx;
          const isDone = mod.completed;
          const isLocked = firstIncompleteMandatoryIndex >= 0 && idx > firstIncompleteMandatoryIndex;

          return (
            <button
              key={mod.sectionId || idx}
              type="button"
              onClick={() => goToModule(idx)}
              disabled={isLocked}
              style={{
                padding: "8px 16px",
                borderRadius: "10px",
                border: isActive
                  ? "2px solid #2563eb"
                  : isDone
                  ? "1.5px solid #16a34a"
                  : "1px solid var(--border, #cbd5e1)",
                background: isActive
                  ? "#2563eb"
                  : isDone
                  ? "rgba(34, 197, 94, 0.12)"
                  : "var(--bg-elevated, #ffffff)",
                color: isActive
                  ? "#ffffff"
                  : isDone
                  ? "#166534"
                  : "#ffffff",
                fontSize: "0.85rem",
                fontWeight: isActive ? 800 : 700,
                whiteSpace: "nowrap",
                cursor: isLocked ? "not-allowed" : "pointer",
                opacity: isLocked ? 0.55 : 1,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: isActive ? "0 6px 16px rgba(37,99,235,0.25)" : "none",
                transition: "all 0.18s ease"
              }}
            >
              <span style={{ color: isActive ? "#ffffff" : isDone ? "#166534" : "#ffffff", fontWeight: 800, display: "inline-flex", alignItems: "center" }}>
                {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" /> : `${idx + 1}.`}
              </span>
              <span style={{ color: isActive ? "#ffffff" : isDone ? "#166534" : "#ffffff", fontWeight: 700 }}>
                {mod.title.length > 24 ? mod.title.slice(0, 24) + "…" : mod.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content Layout: Sidebar + Module */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", alignItems: "start" }}>
        {/* Progress Sidebar */}
        <aside
          style={{
            background: "var(--bg-elevated, #ffffff)",
            border: "1px solid var(--border, #cbd5e1)",
            borderRadius: "14px",
            padding: "16px",
            position: "sticky",
            top: "20px"
          }}
        >
          <div style={{ fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", marginBottom: "12px" }}>
            {t("s3_module_progress")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {modules.map((mod, idx) => {
              const isActive = idx === activeModuleIndex;
              const isDone = mod.completed;
              const isLocked = firstIncompleteMandatoryIndex >= 0 && idx > firstIncompleteMandatoryIndex;
              return (
                <button
                  key={mod.sectionId || idx}
                  type="button"
                  onClick={() => goToModule(idx)}
                  disabled={isLocked}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: isActive ? "1.5px solid #2563eb" : "1px solid transparent",
                    background: isActive ? "rgba(37, 99, 235, 0.08)" : "transparent",
                    cursor: isLocked ? "not-allowed" : "pointer",
                    opacity: isLocked ? 0.55 : 1,
                    textAlign: "left",
                    width: "100%"
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} />
                    ) : isActive ? (
                      <PlayCircle className="w-4 h-4" style={{ color: "#2563eb" }} />
                    ) : (
                      <Circle className="w-4 h-4" style={{ color: "#cbd5e1" }} />
                    )}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: "0.8rem", fontWeight: isActive ? 800 : 600, color: isDone ? "#16a34a" : "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {idx + 1}. {mod.title}
                    </span>
                    <span style={{ display: "block", fontSize: "0.7rem", color: isDone ? "#16a34a" : "#ffffff", fontWeight: 600, marginTop: "2px" }}>
                      {isDone ? t("status_completed") : isActive ? t("s3_watching", { p: activeProgress > 0 ? activeProgress : 0 }) : t("status_not_started")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border, #cbd5e1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>
              <Clock className="w-3.5 h-3.5" />
              <span>
                {activeTime > 0 ? t("s3_time_watched", { cur: formatTime(activeTime), dur: formatTime(activeDuration) }) : t("s3_no_playback")}
              </span>
            </div>
          </div>
        </aside>

        {/* Active Module Display */}
        {currentModule && (
          <div style={{ background: "var(--bg-elevated, #ffffff)", borderRadius: "14px", padding: "28px", border: "1px solid var(--border, #cbd5e1)", boxShadow: "0 10px 30px rgba(0,0,0,0.05)", marginBottom: "24px", color: "var(--text, #0f172a)", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ minWidth: 0 }}>
                <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#3b82f6" }}>
                  {t("s3_module_of", { n: activeModuleIndex + 1, total: modules.length })}
                </span>
                <h4 style={{ fontSize: "1.3rem", fontWeight: 800, margin: "6px 0 0" }}>
                  {currentModule.title}
                </h4>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {resumeNotice && (
                  <span style={{ background: "rgba(37, 99, 235, 0.12)", color: "#2563eb", fontWeight: 700, fontSize: "0.75rem", padding: "4px 10px", borderRadius: "20px", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <PlayCircle className="w-3.5 h-3.5" /> {resumeNotice}
                  </span>
                )}
                {currentModule.completed && (
                  <span style={{ background: "rgba(34, 197, 94, 0.15)", color: "#16a34a", fontWeight: 800, fontSize: "0.82rem", padding: "6px 14px", borderRadius: "20px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                     <Check className="w-4 h-4" /> {t("status_completed")}
                  </span>
                )}
              </div>
            </div>

            <ModuleExtras
              key={currentModule.sectionId}
              module={currentModule}
              disabled={loading}
              driverId={driverId}
              onModuleStart={() => onStartModule(currentModule)}
              onVideoPositionUpdate={handleOrderedVideoPositionUpdate}
              onVideoDurationChange={setActiveDuration}
              onSatisfied={() => handleModuleCompletionChange(currentModule, true)}
            />

            <section style={{ marginTop: "22px", padding: "18px", borderRadius: "12px", border: "1px solid var(--border, #cbd5e1)", background: "var(--bg, #f8fafc)" }}>
              <h5 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>Training Acknowledgement</h5>
              <p style={{ margin: "6px 0 14px", fontSize: "0.88rem", lineHeight: 1.5 }}>
                Confirm and sign that you watched/read and understood this specific safety presentation. This is separate from the general Legal Sign-Off.
              </p>
              {acknowledgementsLoading && <p role="status">Loading your acknowledgement status…</p>}
              {acknowledgementsLoadError && (
                <div role="alert" style={{ color: "#b91c1c" }}>
                  <p>{acknowledgementsLoadError}</p>
                  <button type="button" onClick={() => setAcknowledgementReload((value) => value + 1)} style={{ padding: "6px 10px", border: "1px solid currentColor", borderRadius: "6px", fontWeight: 700 }}>
                    Retry
                  </button>
                </div>
              )}
              {!acknowledgementsLoading && !acknowledgementsLoadError && savedAcknowledgement && (
                <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(34, 197, 94, 0.12)", color: "#166534" }}>
                  <strong> Acknowledgement completed</strong>
                  <p style={{ margin: "6px 0" }}>{savedAcknowledgement.acknowledgementStatement}</p>
                  <p style={{ margin: 0, fontSize: "0.82rem" }}>Signed {new Date(savedAcknowledgement.signedAt).toLocaleString()}</p>
                  {savedAcknowledgement.signature.startsWith("data:image/")
                    ? <img src={savedAcknowledgement.signature} alt="Your saved signature" style={{ marginTop: "10px", maxHeight: "100px", maxWidth: "100%", borderRadius: "6px", background: "#fff", padding: "6px" }} />
                    : <p style={{ margin: "8px 0 0", fontWeight: 700 }}>{savedAcknowledgement.signature}</p>}
                </div>
              )}
              {!acknowledgementsLoading && !savedAcknowledgement && currentModule.completed && (
                <div style={{ display: "grid", gap: "12px" }}>
                  <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700 }}>Pending acknowledgement</p>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "0.9rem", lineHeight: 1.5 }}>
                    <input
                      type="checkbox"
                      checked={acknowledgementConfirmed}
                      onChange={(event) => { setAcknowledgementConfirmed(event.target.checked); setAcknowledgementError(""); }}
                      disabled={acknowledgementSaving}
                      style={{ marginTop: "4px" }}
                    />
                    <span>I confirm that I watched/read and understood this safety presentation: <strong>{currentModule.title}</strong>.</span>
                  </label>
                  <div>
                    <p style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 700 }}>Your signature</p>
                    <SignaturePad
                      key={`ack-signature-${currentSectionId}`}
                      onSignatureChange={(value) => { setSignature(value); setAcknowledgementError(""); }}
                      onSignatureStateChange={setHasSignature}
                    />
                  </div>
                  {acknowledgementError && <p role="alert" style={{ margin: 0, color: "#b91c1c", fontSize: "0.88rem" }}>{acknowledgementError}</p>}
                  <div>
                    <button
                      type="button"
                      onClick={() => void submitAcknowledgement()}
                      disabled={!acknowledgementConfirmed || !hasSignature || acknowledgementSaving || acknowledgementsLoading || Boolean(acknowledgementsLoadError)}
                      style={{ padding: "10px 16px", border: 0, borderRadius: "8px", background: "#1e3a5f", color: "#fff", fontWeight: 700, cursor: "pointer", opacity: !acknowledgementConfirmed || !hasSignature || acknowledgementSaving ? 0.55 : 1 }}
                    >
                      {acknowledgementSaving ? "Saving…" : "Submit acknowledgement"}
                    </button>
                  </div>
                </div>
              )}
              {!acknowledgementsLoading && !savedAcknowledgement && !currentModule.completed && (
                <p style={{ margin: 0, fontSize: "0.88rem" }}>Complete this presentation to submit its acknowledgement.</p>
              )}
            </section>

            <div style={{ marginTop: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <button
                type="button"
                onClick={() => void handleModuleCompletionChange(currentModule, !currentModule.completed)}
                disabled={loading || (hasSequenceItems && !currentModule.completed)}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "1px solid #1e3a5f",
                  background: currentModule.completed ? "transparent" : "#1e3a5f",
                  color: currentModule.completed ? "#1e3a5f" : "#ffffff",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: loading || (hasSequenceItems && !currentModule.completed) ? "not-allowed" : "pointer",
                  opacity: loading || (hasSequenceItems && !currentModule.completed) ? 0.65 : 1
                }}
              >
                {currentModule.completed ? t("s3_mark_incomplete") : t("s3_mark_complete")}
              </button>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleDownloadTranscript}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "1px solid var(--border, #cbd5e1)",
                    background: "transparent",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                   <Download className="w-3.5 h-3.5" /> {t("s3_download_transcript")}
                </button>

                {activeModuleIndex < modules.length - 1 && (
                  <button
                    type="button"
                    onClick={() => goToModule(activeModuleIndex + 1)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: "8px",
                      border: "1px solid var(--border, #cbd5e1)",
                      background: "transparent",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    {t("s3_next_module")} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
        {proceedError && (
          <span style={{ color: "#ef4444", fontSize: "0.82rem", fontWeight: 600 }}>{proceedError}</span>
        )}
        <button
          type="button"
          onClick={handleProceed}
          disabled={!allCompleted || !allAcknowledged || acknowledgementsLoading || Boolean(acknowledgementsLoadError) || loading || proceeding}
          style={{
            padding: "10px 24px",
            borderRadius: "8px",
            border: "none",
            background: allCompleted && allAcknowledged ? "#1e3a5f" : "#94a3b8",
            color: "#ffffff",
            fontWeight: 700,
            cursor: allCompleted && allAcknowledged ? "pointer" : "not-allowed",
            opacity: proceeding ? 0.7 : 1
          }}
        >
          {proceeding
            ? t("s2_saving")
            : !allCompleted
              ? t("s3_complete_all", { n: modules.length })
              : !allAcknowledged
                ? "Complete presentation acknowledgements"
                : t("s3_proceed")}
        </button>
      </div>
    </div>
  );
}
