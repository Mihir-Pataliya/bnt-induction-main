import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Send, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { DriverBundle, SessionState } from "../../types";

const FORM_CODE = "FC";
const FORM_TITLE = "Fatigue Checklist";

type Answer = "Yes" | "No" | "";

interface ChecklistRow {
  id: string;
  status: string;
  submitted_at: string;
  payload: Record<string, unknown>;
}

const QUESTIONS = [
  "Did you get at least 7 hours of sleep in the last 24 hours?",
  "Do you feel alert and fit to drive?",
  "Have you completed all required rest breaks?",
  "Are you free from fatigue, illness or medication effects?",
  "Do you feel safe to complete this shift?",
];

export function DriverFatigueChecklist({ session, driverBundle }: { session: SessionState; driverBundle?: DriverBundle | null }) {
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [comments, setComments] = useState("");
  const [declared, setDeclared] = useState(false);

  const driverName = driverBundle?.driver?.fullName || session.user.email;

  const loadRows = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", FORM_CODE)
        .eq("user_id", session.user.id)
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRows((data || []) as ChecklistRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fatigue checklists.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, [session.user.id]);

  const submit = async () => {
    setError("");
    setSuccess("");
    if (QUESTIONS.some((_, idx) => !answers[idx])) {
      setError("Answer every fatigue question before submitting.");
      return;
    }
    if (!declared) {
      setError("You must submit the fatigue declaration.");
      return;
    }
    const fatigueConcern = QUESTIONS.some((_, idx) => answers[idx] === "No");
    setSaving(true);
    try {
      const payload = {
        completedBy: driverName,
        role: "Driver",
        date: new Date().toISOString().slice(0, 10),
        answers: QUESTIONS.map((q, idx) => ({ question: q, answer: answers[idx] })),
        comments,
        declared,
        fatigueConcern,
        status: "Submitted",
      };
      const { error: err } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: FORM_CODE,
        form_title: FORM_TITLE,
        payload,
        status: "Submitted",
      });
      if (err) throw err;
      setAnswers({});
      setComments("");
      setDeclared(false);
      setSuccess(fatigueConcern ? "Fatigue concern submitted. Admin will review." : "Fatigue checklist submitted.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit fatigue checklist.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 text-white">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-emerald-400" />
        <h2 className="text-xl font-black">Driver Fatigue Checklist</h2>
      </div>
      <p className="text-sm text-slate-300">Complete your pre-trip fatigue assessment. Submitted checklists cannot be edited.</p>

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-2 text-sm">
        <p><span className="text-slate-400">Driver:</span> <span className="font-semibold">{driverName}</span></p>
        <p><span className="text-slate-400">Depot:</span> <span className="font-semibold">{driverBundle?.driver?.depotLocation || "Not provided"}</span></p>
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {success && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{success}</p>}

      <div className="space-y-3">
        {QUESTIONS.map((q, idx) => (
          <div key={idx} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-2">
            <p className="text-sm font-medium">{q}</p>
            <div className="flex gap-2">
              {(["Yes", "No"] as Answer[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [idx]: opt }))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${answers[idx] === opt ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Comments</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          rows={3}
          placeholder="Add any fatigue-related comments..."
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
        I declare that the information provided is true and I am fit to perform my duties.
      </label>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Submit Checklist
      </button>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white">Previous submissions</h3>
        {loading ? (
          <p className="text-sm text-slate-300">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-400">No previous submissions.</p>
        ) : (
          rows.map((row) => {
            const payload = (row.payload || {}) as Record<string, unknown>;
            return (
              <article key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm">
                <p className="font-bold">Submitted {new Date(row.submitted_at).toLocaleString()}</p>
                <p className="text-slate-400">Status: {row.status}</p>
                {payload.fatigueConcern ? <p className="text-amber-300">Fatigue concern reported</p> : <p className="text-emerald-300">No fatigue concern reported</p>}
                {payload.comments ? <p className="text-slate-300">Comments: {String(payload.comments)}</p> : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
