import { Fragment, useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../lib/api";
import { SessionState } from "../../types";

interface SpeedAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

interface PreStartQuestion {
  id?: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation?: string;
  category?: string;
  sort_order?: number;
}

interface PreStartResult {
  id: string;
  user_id: string;
  driver_name: string;
  attempt_number: number;
  score: number;
  total_questions: number;
  completed_at: string;
  passed: boolean;
  answers: SpeedAnswerReview[];
  assessor_feedback: string | null;
  reviewed_at: string | null;
}

export function PreStartAssessmentAdmin({ session, view = "all" }: { session: SessionState; view?: "all" | "questions" | "results" }) {
  const [questions, setQuestions] = useState<PreStartQuestion[]>([]);
  const [results, setResults] = useState<PreStartResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PreStartQuestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedAttempts, setExpandedAttempts] = useState<Set<string>>(new Set());
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [savingFeedbackId, setSavingFeedbackId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, r] = await Promise.all([
        api.getPreStartAwarenessQuestions(session),
        api.getPreStartAwarenessResults(session)
      ]);
      setQuestions(q);
      setResults(r);
      setFeedbackDrafts(Object.fromEntries(r.map((result: PreStartResult) => [result.id, result.assessor_feedback ?? ""])));
    } catch (e: any) {
      setError(e?.message ?? "Unable to load Speed awareness data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startNew = () => {
    setDraft({
      question: "",
      options: ["", "", "", ""],
      correct_answer: 0,
      explanation: "",
      category: "Pre-Start Awareness",
      sort_order: questions.length + 1
    });
  };

  const startEdit = (q: PreStartQuestion) => {
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
      const saved = await api.savePreStartAwarenessQuestion(session, draft);
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
    if (!window.confirm("Delete this Speed awareness question?")) return;
    try {
      await api.deletePreStartAwarenessQuestion(session, id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Unable to delete question.");
    }
  };

  const saveFeedback = async (resultId: string) => {
    setSavingFeedbackId(resultId);
    setError(null);
    try {
      const result = await api.savePreStartAwarenessFeedback(session, resultId, feedbackDrafts[resultId] ?? "");
      setResults((current) => current.map((item) => item.id === resultId
        ? { ...item, assessor_feedback: result.assessor_feedback, reviewed_at: result.reviewed_at }
        : item));
    } catch (e: any) {
      setError(e?.message ?? "Unable to save assessor feedback.");
    } finally {
      setSavingFeedbackId(null);
    }
  };

  return (
    <div className="space-y-6">
      {view !== "results" && (
        <>
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          Chain of Responsibility
        </p>
        <h2 className="text-xl font-black text-white">Speed INTRODUCTION</h2>
        <p className="mt-1 text-sm font-semibold text-slate-200">Pre-Start Awareness - Updated annually in March,</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Review the approved Pre-Start Awareness presentation for the learning content before completing the assessment.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Approved Learning Content</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Review the approved Pre-Start Awareness presentation for the learning content and definitions before completing the assessment.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">HVNL / Chain of Responsibility (CoR)</h3>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              The Heavy Vehicle National Law (HVNL) imposes a primary duty to ensure safe and compliant transport activities (sections 26C and 26D). Businesses that use heavy vehicles are required to develop, implement and document operating policies and procedures, and to ensure that all parties across the business understand their specific duties and obligations under the Chain of Responsibility (CoR) law.
            </p>
            <p>
              Under CoR, every party in the heavy vehicle supply chain who has control or influence over a transport activity has a duty to ensure its safety, so far as reasonably practicable. This includes Speed risks: no person within BNT Logistics may request, require or encourage a driver to breach Speed limits or skip rest breaks, or agree to a schedule that could only be met by breaching the HVNL.
            </p>
            <p>
              All employees must understand that it is unacceptable to directly or indirectly cause or encourage a driver or another party in the supply chain to breach the HVNL. Pre-Start Awareness is therefore reviewed and updated annually in March.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Pre-Start Awareness Assessment</h3>
            <p className="text-sm text-slate-300">Manage the 10 approved Speed assessment questions. Answers are stored server-side and never shown to drivers.</p>
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
        </>
      )}

      {view !== "questions" && (
        <>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
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
                {results.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-slate-800">
                      <td className="px-3 py-2">{r.driver_name}</td>
                      <td className="px-3 py-2">{r.attempt_number}</td>
                      <td className="px-3 py-2">{r.score}%</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.passed ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                          {r.passed ? "Competent" : "Not Competent"}
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
                            <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                              <label htmlFor={`speed-feedback-${r.id}`} className="block text-sm font-semibold text-white">Assessor feedback</label>
                              <textarea
                                id={`speed-feedback-${r.id}`}
                                rows={3}
                                maxLength={4000}
                                value={feedbackDrafts[r.id] ?? ""}
                                onChange={(event) => setFeedbackDrafts((current) => ({ ...current, [r.id]: event.target.value }))}
                                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                                placeholder="Feedback for this assessment attempt"
                              />
                              {r.reviewed_at && <p className="mt-1 text-xs text-slate-400">Last reviewed: {new Date(r.reviewed_at).toLocaleString()}</p>}
                              <button
                                type="button"
                                onClick={() => void saveFeedback(r.id)}
                                disabled={savingFeedbackId === r.id}
                                className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                              >
                                {savingFeedbackId === r.id ? "Saving..." : "Save Feedback"}
                              </button>
                            </div>
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
        </>
      )}
    </div>
  );
}
