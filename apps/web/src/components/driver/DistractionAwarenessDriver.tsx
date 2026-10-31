import { useState, useEffect } from "react";
import { ClipboardCheck, ArrowRight, RotateCcw, Download, Bell } from "lucide-react";
import { DriverNotifications } from "./DriverNotifications";
import { api } from "../../lib/api";
import { SessionState } from "../../types";

interface Question {
  id: string;
  question: string;
  options: string[];
  category?: string;
}

interface Result {
  id?: string;
  correct_count: number;
  score: number;
  total_questions: number;
  passed: boolean;
  completed_at: string;
}

export function DistractionAwarenessDriver({ session }: { session: SessionState }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);

  const loadResults = async () => {
    setLoadingResults(true);
    try {
      const data = await api.getDistractionAwarenessResultsDriver(session);
      setResults(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load assessment history.");
    } finally {
      setLoadingResults(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getDistractionAwarenessQuestionsDriver(session)
      .then((qs) => { if (mounted) setQuestions(qs); })
      .catch((e) => { if (mounted) setError(e?.message ?? "Unable to load questions."); })
      .finally(() => { if (mounted) setLoading(false); });
    void loadResults();
    return () => { mounted = false; };
  }, [session]);

  const submit = async () => {
    if (questions.some((q) => answers[q.id] === undefined)) {
      setError("Please answer all questions before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitDistractionAwareness(session, answers);
      const normalized = { ...res, correct_count: Math.round((Number(res.score ?? 0) / 100) * Number(res.total_questions ?? 10)) };
      setResult(normalized);
      await loadResults();
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
  };

  const latest = results.length > 0 ? results[0] : null;
  const percentage = (r: Result | null) => r ? Math.round((r.correct_count / (r.total_questions || 10)) * 100) : 0;

  const nextAnnualDue = () => {
    const now = new Date();
    const year = now.getMonth() >= 2 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, 2, 1); // March 1
  };
  const annualDueDate = nextAnnualDue();
  const daysUntilDue = Math.ceil((annualDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const annualReminder = daysUntilDue <= 30
    ? (daysUntilDue < 0 ? "Annual fatigue training is overdue." : "Annual fatigue training is due soon.")
    : null;

  const downloadCertificate = () => {
    if (!latest || !latest.passed) return;
    const driverName = session?.user?.email ?? "Driver";
    const html = `<!DOCTYPE html><html><head><title>Fatigue Awareness Certificate</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:40px;"><h1>Certificate of Competence</h1><p>Distraction Awareness Assessment</p><p>Driver: ${driverName}</p><p>Score: ${latest.correct_count}/${latest.total_questions} (${percentage(latest)}%)</p><p>Date: ${new Date(latest.completed_at).toLocaleDateString()}</p><p>Certificate ID: DA-${latest.id ?? Date.now()}</p><p>Assessment Version: fatigue_awareness</p></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "distraction-awareness-certificate.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => setShowNotifications((v) => !v)} className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">
        <Bell className="h-4 w-4" /> {showNotifications ? "Hide" : "Show"} Notifications
      </button>
      {showNotifications && session && <DriverNotifications session={session} />}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-emerald-300">Chain of Responsibility</p>
        <h2 className="text-xl font-black text-white">DISTRACTION INTRODUCTION</h2>
        <p className="mt-1 text-sm font-semibold text-slate-200">Distraction Awareness - Updated annually in March,</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">Updated annually in March, this DISTRACTION INTRODUCTION provides the DISTRACTION DEFINITION and the HVNL / Chain of Responsibility (CoR) explanation that applies to every fatigue assessment.</p>
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">DISTRACTION DEFINITION</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Distraction is anything that takes your eyes, hands or mind away from the driving task. It can include mobile phones, in-cab equipment, eating or drinking, conversations, navigation adjustments and external events, and it increases the risk of errors, incidents and injury. Distraction cannot be managed by multitasking or willpower alone.</p>
        </div>
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">HVNL / Chain of Responsibility (CoR)</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">The Heavy Vehicle National Law (HVNL) imposes a primary duty to ensure safe and compliant transport activities. Under CoR, every party in the heavy vehicle supply chain who has control or influence over a transport activity has a duty to ensure its safety, so far as reasonably practicable. Distraction Awareness is therefore reviewed and updated annually in March.</p>
        </div>
      </div>

      {annualReminder && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {annualReminder} Next annual training due: {annualDueDate.toLocaleDateString()}.
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <h3 className="text-lg font-bold text-white mb-3">Assessment Progress</h3>
        {results.length === 0 ? (
          <p className="text-sm text-slate-400">No attempts yet.</p>
        ) : (
          <div className="flex items-end gap-3 h-40 border-b border-slate-700 pb-2">
            {results.slice().reverse().map((r, idx) => (
              <div key={r.id ?? idx} className="flex flex-col items-center gap-1 flex-1">
                <div className="text-[10px] text-slate-300">{percentage(r)}%</div>
                <div className="w-full bg-emerald-500 rounded-t" style={{ height: `${Math.max(4, percentage(r))}%`, minHeight: "4px" }} />
                <span className="text-[10px] text-slate-400">#{idx + 1}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <h3 className="text-lg font-bold text-white mb-3">Learning Tips</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>Get sufficient sleep before shifts.</li>
          <li>Recognise fatigue warning signs early.</li>
          <li>Take required rest breaks.</li>
          <li>Plan journeys properly.</li>
          <li>Report fatigue concerns promptly.</li>
        </ul>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <h3 className="text-lg font-bold text-white mb-3">My Assessment History</h3>
        {loadingResults ? (
          <p className="text-sm text-slate-400">Loading assessment history…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-slate-400">No previous assessment attempts yet.</p>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-900/60 p-3">
                <p className="text-xs text-slate-400">Latest Score</p>
                <p className="text-lg font-bold text-white">{latest ? `${latest.correct_count}/${latest.total_questions}` : "-"}</p>
              </div>
              <div className="rounded-lg bg-slate-900/60 p-3">
                <p className="text-xs text-slate-400">Latest Percentage</p>
                <p className="text-lg font-bold text-white">{latest ? `${percentage(latest)}%` : "-"}</p>
              </div>
              <div className="rounded-lg bg-slate-900/60 p-3">
                <p className="text-xs text-slate-400">Total Attempts</p>
                <p className="text-lg font-bold text-white">{results.length}</p>
              </div>
              <div className="rounded-lg bg-slate-900/60 p-3">
                <p className="text-xs text-slate-400">Latest Result</p>
                <p className={`text-lg font-bold ${latest?.passed ? "text-emerald-300" : "text-amber-300"}`}>{latest ? (latest.passed ? "Competent" : "Not Yet Competent") : "-"}</p>
              </div>
            </div>
            {latest && (
              <p className="mb-3 text-xs text-slate-400">Latest submission: {new Date(latest.completed_at).toLocaleString()}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                    <th className="py-2 pr-3">Attempt</th>
                    <th className="py-2 pr-3">Score</th>
                    <th className="py-2 pr-3">Percentage</th>
                    <th className="py-2 pr-3">Competency Status</th>
                    <th className="py-2 pr-3">Completed Date and Time</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => (
                    <tr key={r.id ?? idx} className="border-b border-slate-700/60">
                      <td className="py-2 pr-3">{results.length - idx}</td>
                      <td className="py-2 pr-3">{r.correct_count}/{r.total_questions}</td>
                      <td className="py-2 pr-3">{percentage(r)}%</td>
                      <td className={`py-2 pr-3 font-semibold ${r.passed ? "text-emerald-300" : "text-amber-300"}`}>{r.passed ? "Competent" : "Not Yet Competent"}</td>
                      <td className="py-2 pr-3">{new Date(r.completed_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {questions.length === 0 && (
        <p className="text-sm text-slate-400">
          No fatigue awareness questions have been configured yet. Please contact your administrator.
        </p>
      )}
      {questions.length > 0 && questions.length !== 10 && (
        <p className="text-sm text-amber-300">
          Showing {questions.length} of 10 approved questions. The assessment can be submitted when all 10 questions are configured.
        </p>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-200">
            Latest result: {result.correct_count}/{result.total_questions} ({percentage(result)}%) — {result.passed ? "Competent" : "Not Yet Competent"}
          </p>
          <p className="mt-1 text-xs text-slate-300">Submitted {new Date(result.completed_at).toLocaleString()}</p>
          <button type="button" onClick={reset} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600">
            <RotateCcw className="h-4 w-4" /> Retake Assessment
          </button>
          {result.passed && (
            <button type="button" onClick={downloadCertificate} className="mt-3 ml-2 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
              <Download className="h-4 w-4" /> Download Certificate
            </button>
          )}
        </div>
      )}

      {!result && questions.length > 0 && (
        <>
          {questions.map((q, qi) => (
            <div key={q.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <p className="mb-3 text-sm font-semibold text-white">{qi + 1}. {q.question}</p>
              <div className="space-y-2">
                {q.options.map((opt, i) => (
                  <label key={i} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name={`DA-${q.id}`}
                      checked={answers[q.id] === i}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                      className="accent-emerald-500"
                    />
                    <span className="text-sm text-slate-200">{String.fromCharCode(65 + i)}. {opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting || questions.length !== 10}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit assessment"} <ArrowRight className="h-4 w-4" />
            </button>
            {questions.length !== 10 && (
              <p className="text-xs text-slate-400">
                Submit becomes available when all 10 approved questions are added. {Math.max(0, 10 - questions.length)} more needed.
              </p>
            )}
          </div>
        </>
      )}

      {results.length > 0 && !result && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
        >
          <RotateCcw className="h-4 w-4" /> Retake Assessment
        </button>
      )}
    </div>
    </div>
  );
}