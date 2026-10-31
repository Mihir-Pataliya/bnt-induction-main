import { useCallback, useEffect, useRef, useState } from "react";
import { PPTXViewer } from "pptxviewjs";
import { ArrowRight, BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, History, Maximize2, Minus, Plus, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { decodePresentationUrl, isValidPresentationUrl } from "../../lib/presentationUrl";
import { SessionState } from "../../types";
import { SpeedChecklist } from "../admin/SpeedChecklist";
import { SpeedLimiterComplianceCheck } from "../admin/SpeedLimiterComplianceCheck";
import { DriverSpeedLimiterFaultReport } from "./DriverSpeedLimiterFaultReport";
import { DriverNotifications } from "./DriverNotifications";

interface Question {
  id: string;
  question: string;
  options: string[];
  category?: string;
}

export function SpeedAwarenessDriver({ session }: { session: SessionState }) {
  const [activeTab, setActiveTab] = useState<"learn" | "checklist" | "limiter" | "assessment" | "results" | "attempts" | "notifications">("learn");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [presentationUrl, setPresentationUrl] = useState("");
  const [presentationEmbedUrl, setPresentationEmbedUrl] = useState("");
  const [presentationVersion, setPresentationVersion] = useState("Version 8.1, May 2026");
  const [presentationLoading, setPresentationLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [presentationError, setPresentationError] = useState("");
  const presentationLoadTimer = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [zoom, setZoom] = useState(1);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = await api.getSpeedAwarenessQuestionsDriver(session);
      setQuestions(qs);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load questions.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  const loadPresentation = useCallback(async () => {
    try {
      const { data, error: queryError } = await supabase
        .from("cor_form_submissions")
        .select("payload")
        .eq("form_code", "SPEED_PRESENTATION")
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (queryError) throw queryError;
      const payload = (data?.payload || {}) as Record<string, unknown>;
      const savedUrl = typeof payload.url === "string" ? decodePresentationUrl(payload.url) : "";
      setPresentationUrl(savedUrl);
      setPresentationVersion(typeof payload.version === "string" && payload.version.trim() ? payload.version : "Version 8.1, May 2026");
      if (savedUrl && !isValidPresentationUrl(savedUrl)) {
        setPresentationEmbedUrl("");
        setPresentationError("The saved presentation URL is not a valid web address. Ask an administrator to update it.");
      } else {
        setPresentationEmbedUrl(savedUrl);
        setPresentationError("");
      }
    } catch (e) {
      setPresentationError(e instanceof Error ? e.message : "Unable to load the approved presentation.");
    }
  }, []);

  const loadAttempts = useCallback(async () => {
    try {
      const rows = await api.getSpeedAwarenessResultsDriver(session);
      setAttempts(rows);
      setHistoryError("");
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Unable to load Speed Awareness history.");
    }
  }, [session]);

  useEffect(() => {
    void loadQuestions();
    void loadPresentation();
    void loadAttempts();
  }, [loadQuestions, loadPresentation, loadAttempts]);
  useEffect(() => {
    if (!presentationEmbedUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const viewer = new PPTXViewer({ canvas, autoExposeGlobals: true });
    viewerRef.current = viewer;
    setPresentationLoading(true);
    setPresentationError("");
    setSlideCount(0);
    setCurrentSlide(0);
    viewer.on("loadComplete", ({ slideCount: count }: any) => {
      if (cancelled) return;
      setSlideCount(count || 0);
      setPresentationLoading(false);
      viewer.render(canvas).catch(() => {});
    });
    viewer.on("slideChanged", (index: number) => {
      if (cancelled) return;
      setCurrentSlide(index);
    });
    (async () => {
      try {
        await viewer.loadFromUrl(presentationEmbedUrl);
        if (cancelled) return;
        await viewer.render(canvas);
      } catch (e) {
        if (cancelled) return;
        setPresentationLoading(false);
        setPresentationError(e instanceof Error ? e.message : "Unable to load the presentation.");
      }
    })();
    return () => {
      cancelled = true;
      viewerRef.current = null;
    };
  }, [presentationEmbedUrl]);


  useEffect(() => {
    if (!presentationEmbedUrl) {
      setPresentationLoading(false);
      if (presentationLoadTimer.current) {
        clearTimeout(presentationLoadTimer.current);
        presentationLoadTimer.current = null;
      }
      return;
    }
    // Show loading overlay; cleared by the iframe onLoad event.
    setPresentationLoading(true);
    setPresentationError("");
    if (presentationLoadTimer.current) clearTimeout(presentationLoadTimer.current);
    return () => {
      if (presentationLoadTimer.current) {
        clearTimeout(presentationLoadTimer.current);
        presentationLoadTimer.current = null;
      }
    };
  }, [presentationEmbedUrl]);

  const submit = async () => {
    if (questions.some((q) => answers[q.id] === undefined)) {
      setError("Please answer all questions before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitSpeedAwareness(session, answers);
      setResult(res);
      setActiveTab("results");
      await loadAttempts();
    } catch (e: any) {
      setError(e?.message ?? "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setAnswers({});
    setResult(null);
    setError(null);
    setActiveTab("assessment");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {([
          { id: "learn", label: "Learn", icon: BookOpen },
          { id: "checklist", label: "Speed Checklist", icon: ClipboardList },
          { id: "limiter", label: "Speed Limiter Check", icon: ShieldCheck },
          { id: "assessment", label: "Assessment", icon: ClipboardCheck },
          { id: "results", label: "Results", icon: ClipboardCheck },
          { id: "attempts", label: "Previous Attempts", icon: History },
{ id: "notifications", label: "Notifications", icon: History }
        ] as const).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-green-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "learn" && (
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
                {presentationError ? (
                  <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-300">
                    {presentationError}
                  </div>
                ) : (
                  <canvas
                    ref={canvasRef}
                    className="h-full w-full bg-white"
                    style={{ display: "block" }}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => viewerRef.current?.previousSlide(canvasRef.current)}
                    disabled={currentSlide <= 0}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-slate-300">
                    {slideCount > 0 ? `${currentSlide + 1} of ${slideCount}` : "Loading..."}
                  </span>
                  <button
                    type="button"
                    onClick={() => viewerRef.current?.nextSlide(canvasRef.current)}
                    disabled={slideCount === 0 || currentSlide >= slideCount - 1}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(0.5, zoom - 0.25);
                      setZoom(next);
                      viewerRef.current?.render(canvasRef.current, { scale: next }).catch(() => {});
                    }}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-slate-300">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(3, zoom + 0.25);
                      setZoom(next);
                      viewerRef.current?.render(canvasRef.current, { scale: next }).catch(() => {});
                    }}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => canvasRef.current?.requestFullscreen?.()}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              {presentationError || "Presentation link not configured by administrator."}
            </p>
          )}
        </div>
      )}

      {activeTab === "checklist" && <SpeedChecklist session={session} audience="driver" />}
      {activeTab === "limiter" && <DriverSpeedLimiterFaultReport session={session} />}

      {activeTab === "assessment" && (
        <div className="space-y-6">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {loading && <p className="text-sm text-slate-400">Loading Speed awareness assessment...</p>}
          {!loading && questions.length === 0 && (
            <p className="text-sm text-slate-400">No Speed awareness questions have been configured yet. Please contact your administrator.</p>
          )}
          {!loading && questions.map((q, qi) => (
            <div key={q.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <p className="mb-3 text-sm font-semibold text-white">{qi + 1}. {q.question}</p>
              <div className="space-y-2">
                {q.options.map((opt, i) => (
                  <label key={i} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name={`sa-${q.id}`}
                      checked={answers[q.id] === i}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                      className="accent-green-500"
                    />
                    <span className="text-sm text-slate-200">{String.fromCharCode(65 + i)}. {opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!loading && questions.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={submit}
                disabled={submitting || questions.length !== 10}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit assessment"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "results" && (
        <div className="space-y-4">
          {result ? (
            <div className={`rounded-xl border p-5 ${result.passed ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
              <h3 className="text-lg font-bold text-white">{result.passed ? "Competent" : "Not Competent"}</h3>
              <p className="mt-1 text-sm text-slate-300">
                Score: {result.score}/{result.total_questions}. Competency requires all {result.total_questions} answers correct.
              </p>
              <p className="mt-1 text-xs text-slate-400">Completed: {new Date(result.completed_at).toLocaleString()}</p>
              <p className="mt-3 text-sm font-semibold text-slate-200">Assessor feedback</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{result.assessor_feedback || "No assessor feedback yet."}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No result yet. Complete the assessment to see your score.</p>
          )}
          <button type="button" onClick={reset} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            Retake assessment
          </button>
        </div>
      )}

      {activeTab === "attempts" && (
        <div className="space-y-3">
          {historyError && <p role="alert" className="text-sm text-red-300">{historyError}</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="min-w-full text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="px-3 py-2">Attempt</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Assessor Feedback</th>
                </tr>
              </thead>
              <tbody>
                {attempts.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-slate-400">No previous attempts.</td></tr>
                ) : attempts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-800">
                    <td className="px-3 py-2">{a.attempt_number}</td>
                    <td className="px-3 py-2">{a.score}/{a.total_questions}</td>
                    <td className="px-3 py-2">{a.passed ? "Competent" : "Not Competent"}</td>
                    <td className="px-3 py-2">{new Date(a.completed_at).toLocaleString()}</td>
                    <td className="max-w-sm whitespace-pre-wrap px-3 py-2">{a.assessor_feedback || "No feedback yet."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {activeTab === "notifications" && session && <DriverNotifications session={session} module="speed" />}

    </div>
  );
}