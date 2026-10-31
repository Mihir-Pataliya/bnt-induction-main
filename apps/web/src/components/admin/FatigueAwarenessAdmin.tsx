import { Fragment, useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../lib/api";

interface FatigueAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

interface FatigueQuestion {
  id?: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation?: string;
  category?: string;
  sort_order?: number;
}

interface FatigueResult {
  id: string;
  user_id: string;
  driver_name: string;
  attempt_number: number;
  score: number;
  total_questions: number;
  completed_at: string;
  passed: boolean;
  answers: FatigueAnswerReview[];
}

export function FatigueAwarenessAdmin({ session }: { session: any }) {
  const [questions, setQuestions] = useState<FatigueQuestion[]>([]);
  const [results, setResults] = useState<FatigueResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<FatigueQuestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedAttempts, setExpandedAttempts] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "competent" | "not_competent">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [feedbackDriverId, setFeedbackDriverId] = useState<string | null>(null);
  const [feedbackSubject, setFeedbackSubject] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackType, setFeedbackType] = useState("Assessment Feedback");
  const [feedbackAction, setFeedbackAction] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [driverMessages, setDriverMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [adminReplyText, setAdminReplyText] = useState("");
  const [newReplyIds, setNewReplyIds] = useState<Set<string>>(new Set());

  const latestByDriver = new Map<string, FatigueResult>();
  for (const r of results) if (!latestByDriver.has(r.user_id)) latestByDriver.set(r.user_id, r);
  const competentCount = [...latestByDriver.values()].filter((r) => r.passed).length;
  const notCompetentCount = latestByDriver.size - competentCount;

  interface SmartAlert {
    id: string;
    type: string;
    driverName: string;
    details: string;
    severity: "High" | "Medium" | "Informational";
    resultId?: string;
  }

  const alerts: SmartAlert[] = [];
  const alertKeys = new Set<string>();
  const latestByDriverMap = latestByDriver;

  // Repeated unsuccessful attempts: only if latest attempt is not competent
  const failedCounts = new Map<string, number>();
  for (const r of results) if (!r.passed) failedCounts.set(r.user_id, (failedCounts.get(r.user_id) ?? 0) + 1);
  for (const [userId, count] of failedCounts) {
    const latest = latestByDriverMap.get(userId);
    if (!latest || latest.passed) continue;
    if (count >= 2) {
      const key = `failures:${userId}`;
      if (!alertKeys.has(key)) {
        alertKeys.add(key);
        alerts.push({ id: key, type: "Repeated unsuccessful attempts", driverName: latest.driver_name, details: `${count} failed attempts; latest score ${latest.score}%`, severity: "High", resultId: latest.id });
      }
    }
  }

  // Overdue annual training: latest attempt older than 12 months
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  for (const [userId, latest] of latestByDriverMap) {
    if (new Date(latest.completed_at) < oneYearAgo) {
      const key = `overdue:${userId}`;
      if (!alertKeys.has(key)) {
        alertKeys.add(key);
        alerts.push({ id: key, type: "Annual training overdue", driverName: latest.driver_name, details: `Last assessment ${new Date(latest.completed_at).toLocaleDateString()}`, severity: "Medium", resultId: latest.id });
      }
    }
  }

  // Missing assessment result: no attempts at all cannot be detected without driver list; skip.

  const filteredResults = results.filter((r) => {
    if (search && !r.driver_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === "competent" && !r.passed) return false;
    if (statusFilter === "not_competent" && r.passed) return false;
    if (dateFrom && new Date(r.completed_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(r.completed_at) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  const exportCsv = () => {
    const rows = filteredResults.map((r) => [r.driver_name, r.attempt_number, r.score, r.passed ? "Competent" : "Not Yet Competent", r.completed_at].join(","));
    const csv = ["Driver,Attempt,Score,Status,Date", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fatigue-assessment-report.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, r] = await Promise.all([
        api.getFatigueAwarenessQuestions(session),
        api.getFatigueAwarenessResults(session)
      ]);
      setQuestions(q);
      setResults(r);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load fatigue awareness data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!feedbackDriverId) { setDriverMessages([]); return; }
    setLoadingMessages(true);
    let cancelled = false;
    const loadMessages = async () => {
      try {
        const m = await api.getFatigueDriverMessages(session, feedbackDriverId);
        if (cancelled) return;
        const unreadDriver = m.filter((msg: any) => msg.sender_id !== session?.user?.id && msg.status === "Unread").map((msg: any) => msg.id);
        setNewReplyIds(new Set(unreadDriver));
        setDriverMessages(m);
        for (const msg of m) {
          if (msg.sender_id !== session?.user?.id && msg.status === "Unread") {
            try { await api.markFatigueMessageReadAdmin(session, msg.id); } catch {}
          }
        }
        const refreshed = await api.getFatigueDriverMessages(session, feedbackDriverId);
        if (!cancelled) setDriverMessages(refreshed);
      } catch { if (!cancelled) setDriverMessages([]); }
      finally { if (!cancelled) setLoadingMessages(false); }
    };
    void loadMessages();
    const interval = setInterval(() => { void loadMessages(); }, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [feedbackDriverId, session]);

  const startNew = () => {
    setDraft({
      question: "",
      options: ["", "", "", ""],
      correct_answer: 0,
      explanation: "",
      category: "Fatigue Awareness",
      sort_order: questions.length + 1
    });
  };

  const startEdit = (q: FatigueQuestion) => {
    setDraft({ ...q, options: [...(q.options ?? ["", "", "", ""])] });
  };

  const cancel = () => setDraft(null);

  const toggleAttempt = (attemptId: string) => {
    setExpandedAttempts((current) => {
      const next = new Set(current);
      if (next.has(attemptId)) next.delete(attemptId);
      else next.add(attemptId);
      return next;
    });
  };

  const updateOption = (index: number, value: string) => {
    if (!draft) return;
    const next = [...draft.options];
    next[index] = value;
    setDraft({ ...draft, options: next });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.question.trim()) { setError("Question text is required."); return; }
    if (draft.options.some((o) => !o.trim())) { setError("All four options are required."); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveFatigueAwarenessQuestion(session, draft);
      setQuestions((prev) => {
        const idx = prev.findIndex((q) => q.id === saved.id);
        if (idx >= 0) {
          const next = [...prev]; next[idx] = saved; return next;
        }
        return [...prev, saved];
      });
      setDraft(null);
    } catch (e: any) {
      setError(e?.message ?? "Unable to save question.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id?: string) => {
    if (!id) return;
    if (!window.confirm("Delete this fatigue awareness question?")) return;
    try {
      await api.deleteFatigueAwarenessQuestion(session, id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Unable to delete question.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          Chain of Responsibility
        </p>
        <h2 className="text-xl font-black text-white">FATIGUE INTRODUCTION</h2>
        <p className="mt-1 text-sm font-semibold text-slate-200">Fatigue Awareness - Updated annually in March,</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Updated annually in March, this FATIGUE introduction provides the fatigue definition and the HVNL / Chain of Responsibility (CoR) explanation that applies to every fatigue assessment.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">FATIGUE DEFINITION</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Fatigue is a state of mental and/or physical exhaustion that reduces a person&apos;s ability to perform work safely and effectively. It can be caused by inadequate sleep, long hours of work, disrupted body clocks, demanding tasks, or illness, and it increases the risk of errors, incidents and injury. Fatigue cannot be overcome by willpower, caffeine or determination alone.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">HVNL / Chain of Responsibility (CoR)</h3>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              The Heavy Vehicle National Law (HVNL) imposes a primary duty to ensure safe and compliant transport activities (sections 26C and 26D). Businesses that use heavy vehicles are required to develop, implement and document operating policies and procedures, and to ensure that all parties across the business understand their specific duties and obligations under the Chain of Responsibility (CoR) law.
            </p>
            <p>
              Under CoR, every party in the heavy vehicle supply chain who has control or influence over a transport activity has a duty to ensure its safety, so far as reasonably practicable. This includes fatigue risks: no person within BNT Logistics may request, require or encourage a driver to breach fatigue limits or skip rest breaks, or agree to a schedule that could only be met by breaching the HVNL.
            </p>
            <p>
              All employees must understand that it is unacceptable to directly or indirectly cause or encourage a driver or another party in the supply chain to breach the HVNL. Fatigue Awareness is therefore reviewed and updated annually in March.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Fatigue Awareness Assessment</h3>
            <p className="text-sm text-slate-300">Manage the 10 approved fatigue assessment questions. Answers are stored server-side and never shown to drivers.</p>
          </div>
          <button type="button" onClick={startNew} disabled={questions.length >= 10} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            Add Question
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {!loading && questions.length !== 10 && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            The driver assessment is unavailable until exactly 10 approved questions are configured. Currently configured: {questions.length}.
          </p>
        )}
        {loading ? <p className="mt-4 text-sm text-slate-400">Loading…</p> : (
          <div className="mt-4 space-y-3">
            {questions.map((q, index) => (
              <div key={q.id ?? index} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{index + 1}. {q.question}</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-300">
                      {q.options.map((opt, i) => (
                        <li key={i} className={i === q.correct_answer ? "text-emerald-300 font-semibold" : ""}>
                          {String.fromCharCode(65 + i)}. {opt} {i === q.correct_answer ? "✓" : ""}
                        </li>
                      ))}
                    </ul>
                    {q.explanation && <p className="mt-2 text-xs text-slate-400">{q.explanation}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => startEdit(q)} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700">Edit</button>
                    <button type="button" onClick={() => remove(q.id)} className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10">Delete</button>
                  </div>
                </div>
              </div>
            ))}
            {questions.length === 0 && <p className="text-sm text-slate-400">No questions configured yet.</p>}
          </div>
        )}
      </div>
      {draft && (
        <div className="rounded-xl border border-emerald-500/40 bg-slate-800/50 p-5 space-y-4">
          <h3 className="text-lg font-bold text-white">{draft.id ? "Edit Question" : "New Question"}</h3>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-200">Question</label>
            <textarea className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-200">Options</label>
            {draft.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-3">
                <input type="radio" name="correct" checked={draft.correct_answer === i} onChange={() => setDraft({ ...draft, correct_answer: i })} />
                <span className="w-6 text-slate-300">{String.fromCharCode(65 + i)}.</span>
                <input className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={opt} onChange={(e) => updateOption(i, e.target.value)} />
              </div>
            ))}
            <p className="text-xs text-slate-400">Select the radio button next to the correct answer.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-200">Explanation (optional)</label>
            <textarea className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={2} value={draft.explanation ?? ""} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? "Saving…" : "Save Question"}
            </button>
            <button type="button" onClick={cancel} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-5 mb-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs text-slate-400">Total Drivers (with attempts)</p>
          <p className="text-xl font-bold text-white">{latestByDriver.size}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs text-slate-400">Competent</p>
          <p className="text-xl font-bold text-emerald-300">{competentCount}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs text-slate-400">Not Yet Competent</p>
          <p className="text-xl font-bold text-amber-300">{notCompetentCount}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs text-slate-400">No Results</p>
          <p className="text-xl font-bold text-slate-300">0</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs text-slate-400">Overdue</p>
          <p className="text-xl font-bold text-red-300">0</p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <h4 className="text-sm font-bold text-amber-200 mb-2">Fatigue Awareness – Smart Alerts</h4>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900/60 p-3">
                <div>
                  <p className="text-sm font-semibold text-white">{a.type} — {a.driverName}</p>
                  <p className="text-xs text-slate-300">{a.details}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${a.severity === "High" ? "bg-red-500/20 text-red-300" : a.severity === "Medium" ? "bg-amber-500/20 text-amber-300" : "bg-slate-600 text-slate-200"}`}>{a.severity}</span>
                  {a.resultId && (
                    <button type="button" onClick={() => setExpandedAttempts((prev) => { const next = new Set(prev); next.add(a.resultId!); return next; })} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">View Driver</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver name" className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
          <option value="all">All statuses</option>
          <option value="competent">Competent</option>
          <option value="not_competent">Not Yet Competent</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
        <button type="button" onClick={exportCsv} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Export CSV</button>
      </div>

      {feedbackDriverId && (
        <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-white">Communication History</h3>
            <button type="button" onClick={() => setShowCompose((v) => !v)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">{showCompose ? "Cancel" : "+ Compose New Feedback"}</button>
          </div>
          <div className="mb-4">
            <h4 className="text-sm font-bold text-slate-200 mb-2">Communication History</h4>
            {loadingMessages ? <p className="text-sm text-slate-400">Loading…</p> : driverMessages.length === 0 ? <p className="text-sm text-slate-400">No messages yet.</p> : (
              <div className="space-y-2">
                {driverMessages.map((m) => (
                  <div key={m.id} className={`rounded-lg border p-3 ${m.sender_id === session?.user?.id ? "border-emerald-500/30 bg-emerald-500/10" : "border-slate-700 bg-slate-900/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{m.sender_id === session?.user?.id ? "Admin" : "Driver"} — {m.subject} {newReplyIds.has(m.id) && <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">New Reply</span>}</p>
                      <span className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">{m.message}</p>
                    {m.sender_id !== session?.user?.id && m.status !== "Read" && (
                      <button type="button" onClick={async () => { await api.markFatigueMessageReadAdmin(session, m.id); setDriverMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, status: "Read" } : x)); }} className="mt-2 rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Mark Read</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <textarea value={adminReplyText} onChange={(e) => setAdminReplyText(e.target.value)} placeholder="Reply to driver..." rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              <button type="button" onClick={async () => {
                if (!adminReplyText.trim()) return;
                try {
                  await api.sendFatigueFeedback(session, feedbackDriverId, { subject: "Re: " + (driverMessages[0]?.subject ?? "Feedback"), message: adminReplyText, messageType: "Assessment Feedback", requiredAction: "" });
                  setAdminReplyText("");
                  const m = await api.getFatigueDriverMessages(session, feedbackDriverId);
                  setDriverMessages(m);
                } catch (e: any) { alert(e?.message ?? "Failed"); }
              }} className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Send Reply</button>
            </div>
          </div>
          {showCompose && (
          <div className="space-y-2">
            <input value={feedbackSubject} onChange={(e) => setFeedbackSubject(e.target.value)} placeholder="Subject" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            <select value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
              <option>Additional Training Required</option>
              <option>Assessment Feedback</option>
              <option>Training Reminder</option>
              <option>General Feedback</option>
            </select>
            <textarea value={feedbackMessage} onChange={(e) => setFeedbackMessage(e.target.value)} placeholder="Message" rows={3} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            <input value={feedbackAction} onChange={(e) => setFeedbackAction(e.target.value)} placeholder="Required action (optional)" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            <div className="flex gap-2">
              <button type="button" disabled={sendingFeedback} onClick={async () => {
                if (!feedbackSubject.trim() || !feedbackMessage.trim()) return;
                setSendingFeedback(true);
                try {
                  await api.sendFatigueFeedback(session, feedbackDriverId, { subject: feedbackSubject, message: feedbackMessage, messageType: feedbackType, requiredAction: feedbackAction });
                  setFeedbackSubject(""); setFeedbackMessage(""); setFeedbackAction(""); setFeedbackDriverId(null);
                } catch (e: any) { alert(e?.message ?? "Failed"); }
                finally { setSendingFeedback(false); }
              }} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Send</button>
              <button type="button" onClick={() => setFeedbackDriverId(null)} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
            </div>
          </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="text-lg font-bold text-white">Driver Results</h3>
        <p className="text-sm text-slate-300">Every submission is retained as an attempt. Competency is achieved only when all 10 answers are correct.</p>
        {loading ? <p className="mt-4 text-sm text-slate-400">Loading…</p> : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Attempt</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Competency</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Answers</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-slate-800">
                      <td className="px-3 py-2">{r.driver_name}</td>
                      <td className="px-3 py-2">{r.attempt_number}</td>
                      <td className="px-3 py-2">{r.score}%</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.passed ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                          {r.passed ? "Competent" : "Not yet competent"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleAttempt(r.id)}
                          aria-expanded={expandedAttempts.has(r.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          {expandedAttempts.has(r.id) ? "Hide" : "View"}
                          {expandedAttempts.has(r.id)
                            ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                            : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => setFeedbackDriverId(r.user_id)} className="ml-2 inline-flex items-center rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Send Feedback</button>
                      </td>
                    </tr>
                    {expandedAttempts.has(r.id) && (
                      <tr key={`${r.id}-answers`} className="border-b border-slate-800 bg-slate-900/70">
                        <td colSpan={6} className="px-3 py-4">
                          <div className="space-y-3">
                            {r.answers?.map((answer, index) => (
                              <div key={`${r.id}-${answer.question_id}`} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                                <p className="text-sm font-semibold text-white">{index + 1}. {answer.question}</p>
                                <p className="mt-2 text-sm text-slate-300">
                                  Driver&apos;s answer: <span className={answer.is_correct ? "text-emerald-300" : "text-red-300"}>{answer.selected_answer}</span>
                                </p>
                                <p className="mt-1 text-sm text-slate-300">
                                  Correct answer: <span className="text-emerald-300">{answer.correct_answer}</span>
                                  <span className="ml-2 text-xs font-semibold">{answer.is_correct ? "Correct" : "Incorrect"}</span>
                                </p>
                              </div>
                            ))}
                            {!r.answers?.length && <p className="text-sm text-slate-400">Answer details are unavailable for this attempt.</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {results.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No driver results yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}