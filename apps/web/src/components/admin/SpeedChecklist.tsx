"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Pencil, Plus, Save, Send, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const ADMIN_FORM_CODE = "SC";
const DRIVER_FORM_CODE = "SC_DRIVER";
const FORM_TITLE = "Speed Checklist";

type Answer = "Yes" | "No" | "N/A" | "";

interface Question {
  id: string;
  text: string;
}

interface Category {
  title: string;
  questions: Question[];
}

const CATEGORIES: Category[] = [
  {
    title: "Speed Management",
    questions: [
      { id: "sm-1", text: "Speed management policy is documented, current, and communicated to all relevant staff." },
      { id: "sm-2", text: "Posted speed limits and heavy vehicle speed requirements are understood and followed." },
      { id: "sm-3", text: "Drivers are trained in speed management and understand their obligations." },
      { id: "sm-4", text: "Speeding incidents and near misses are recorded and reviewed." },
      { id: "sm-5", text: "Schedules do not encourage or require speeding." }
    ]
  },
  {
    title: "Speed Limiters",
    questions: [
      { id: "sl-1", text: "Heavy vehicles are fitted with compliant speed limiters where required." },
      { id: "sl-2", text: "Speed limiters are checked and maintained at servicing intervals." },
      { id: "sl-3", text: "Speed limiter tampering controls and inspections are in place." },
      { id: "sl-4", text: "Limiter compliance records are retained and available for audit." }
    ]
  },
  {
    title: "Trip Planning",
    questions: [
      { id: "tp-1", text: "Trip plans use realistic average speeds below posted limits." },
      { id: "tp-2", text: "Transit times and delivery windows do not pressure drivers to speed." },
      { id: "tp-3", text: "Route, load, and rest information is provided to drivers." },
      { id: "tp-4", text: "Trip changes are reported and managed safely." }
    ]
  }
];

export const DRIVER_CATEGORIES: Category[] = [
  {
    title: "Speed Awareness",
    questions: [
      { id: "ds-1", text: "I understand the applicable speed limits for my route." },
      { id: "ds-2", text: "I follow posted speed limits at all times." },
      { id: "ds-3", text: "I adjust my speed according to road, weather and traffic conditions." },
      { id: "ds-4", text: "I do not tamper with speed limiters." },
      { id: "ds-5", text: "I report speed limiter faults or warning indicators." },
      { id: "ds-6", text: "I report unsafe schedules or pressure to speed." },
      { id: "ds-7", text: "I understand that speed must be safe and compliant throughout the journey." }
    ]
  }
];

function getCategories(audience: "admin" | "driver"): Category[] {
  return audience === "driver" ? DRIVER_CATEGORIES : CATEGORIES;
}

interface ChecklistState {
  answers: Record<string, Answer>;
  questionNotes: Record<string, string>;
  generalNotes: string;
  completedBy: string;
  role: string;
  signature: string;
  date: string;
}

interface ChecklistRow {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  status: string;
  submitted_at: string | null;
}

function emptyState(session: SessionState, audience: "admin" | "driver"): ChecklistState {
  const answers: Record<string, Answer> = {};
  const questionNotes: Record<string, string> = {};
  const allQuestions = getCategories(audience).flatMap((category) => category.questions);
  allQuestions.forEach((question) => {
    answers[question.id] = "";
    questionNotes[question.id] = "";
  });
  return {
    answers,
    questionNotes,
    generalNotes: "",
    completedBy: session.user.email,
    role: audience === "driver" ? "Driver" : "Admin",
    signature: "",
    date: new Date().toISOString().slice(0, 10)
  };
}

function rowToState(row: ChecklistRow, session: SessionState, audience: "admin" | "driver"): ChecklistState {
  const base = emptyState(session, audience);
  const payload = (row.payload || {}) as Record<string, unknown>;
  const answers = { ...base.answers, ...((payload.answers as Record<string, Answer>) || {}) };
  const questionNotes = { ...base.questionNotes, ...((payload.questionNotes as Record<string, string>) || {}) };
  return {
    answers,
    questionNotes,
    generalNotes: String(payload.generalNotes ?? payload.notes ?? ""),
    completedBy: String(payload.completedBy ?? session.user.email),
    role: String(payload.role ?? "Admin"),
    signature: String(payload.signature ?? ""),
    date: String(payload.date ?? (row.submitted_at ? row.submitted_at.slice(0, 10) : new Date().toISOString().slice(0, 10)))
  };
}

function stateToPayload(state: ChecklistState, status: string): Record<string, unknown> {
  return {
    answers: state.answers,
    questionNotes: state.questionNotes,
    generalNotes: state.generalNotes,
    notes: state.generalNotes,
    completedBy: state.completedBy,
    role: state.role,
    signature: state.signature,
    date: state.date,
    status
  };
}

function inputClass(disabled = false): string {
  return `w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}export function SpeedChecklist({ session, audience = "admin" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const categories = getCategories(audience);
  const allQuestions = categories.flatMap((category) => category.questions);
  const formCode = audience === "driver" ? DRIVER_FORM_CODE : ADMIN_FORM_CODE;
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("Draft");
  const [state, setState] = useState<ChecklistState>(() => emptyState(session, audience));
  const [showForm, setShowForm] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const baseQuery = supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", formCode);
      const scopedQuery = audience === "driver" ? baseQuery.eq("user_id", session.user.id) : baseQuery;
      const { data, error: err } = await scopedQuery.order("submitted_at", { ascending: false });
      if (err) throw err;
      setRows((data || []) as ChecklistRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Speed Checklists.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [audience, session.user.id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const openNew = () => {
    setSelectedId(null);
    setStatus("Draft");
    setState(emptyState(session, audience));
    setReadOnly(false);
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openRow = (row: ChecklistRow) => {
    setSelectedId(row.id);
    setStatus(row.status || "Draft");
    setState(rowToState(row, session, audience));
    setReadOnly((row.status || "").toLowerCase() === "submitted");
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const backToList = () => {
    setShowForm(false);
    setSelectedId(null);
    setReadOnly(false);
    void loadRows();
  };

  const updateAnswer = (questionId: string, value: Answer) => {
    setState((prev) => ({ ...prev, answers: { ...prev.answers, [questionId]: value } }));
  };

  const updateQuestionNote = (questionId: string, value: string) => {
    setState((prev) => ({ ...prev, questionNotes: { ...prev.questionNotes, [questionId]: value } }));
  };

  const validateForSubmit = (): string | null => {
    if (!state.completedBy.trim()) return "Completed By is required.";
    if (!state.date.trim()) return "Date is required.";
    const unanswered = allQuestions.find((question) => !state.answers[question.id]);
    if (unanswered) return "Answer every checklist question before submitting.";
    const missingNote = allQuestions.find((question) => state.answers[question.id] === "No" && !state.questionNotes[question.id]?.trim());
    if (missingNote) return "Notes/Actions are required when a question is answered No.";
    return null;
  };

  const save = async (nextStatus: string) => {
    setError("");
    setSuccess("");
    if (nextStatus === "Submitted") {
      const validationError = validateForSubmit();
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = stateToPayload(state, nextStatus);
      if (selectedId) {
        const { error: err } = await supabase
          .from("cor_form_submissions")
          .update({ payload, status: nextStatus })
          .eq("id", selectedId);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from("cor_form_submissions")
          .insert({
            user_id: session.user.id,
            form_code: formCode,
            form_title: FORM_TITLE,
            payload,
            status: nextStatus
          })
          .select()
          .single();
        if (err) throw err;
        setSelectedId(data.id);
      }
      setStatus(nextStatus);
      setReadOnly(nextStatus === "Submitted");
      setSuccess(nextStatus === "Submitted" ? "Speed Checklist submitted." : "Speed Checklist saved as draft.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save Speed Checklist.");
    } finally {
      setSaving(false);
    }
  };

  const statusBadgeClass = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === "submitted") return "bg-emerald-500/15 text-emerald-300";
    if (normalized === "draft") return "bg-amber-500/15 text-amber-200";
    return "bg-slate-500/15 text-slate-300";
  };  if (showForm) {
    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black text-white">
              <ClipboardCheck className="h-5 w-5 text-emerald-400" />
              Speed Checklist
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {readOnly ? "Review the saved Speed Checklist." : "Complete the Speed Checklist and save as draft or submit."}
            </p>
          </div>
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Back to list
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <div className="space-y-5">
          {categories.map((category) => (
            <div key={category.title} className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">{category.title}</h3>
              {category.questions.map((question) => (
                <div key={question.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                  <p className="text-sm font-medium text-slate-100">{question.text}</p>
                  <div className="flex flex-wrap gap-3">
                    {(["Yes", "No", "N/A"] as const).map((option) => (
                      <label key={option} className="inline-flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="radio"
                          name={question.id}
                          value={option}
                          checked={state.answers[question.id] === option}
                          disabled={readOnly}
                          onChange={() => updateAnswer(question.id, option)}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <label className="block space-y-1 text-sm text-slate-300">
                    <span className="font-medium">Notes / Actions {state.answers[question.id] === "No" ? "(required)" : ""}</span>
                    <textarea
                      className={inputClass(readOnly)}
                      disabled={readOnly}
                      rows={2}
                      value={state.questionNotes[question.id] || ""}
                      onChange={(e) => updateQuestionNote(question.id, e.target.value)}
                      placeholder="Notes or actions required"
                    />
                  </label>
                </div>
              ))}
            </div>
          ))}

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Checklist Details</h3>
            <label className="block space-y-1 text-sm text-slate-300">
              <span className="font-medium">Notes</span>
              <textarea
                className={inputClass(readOnly)}
                disabled={readOnly}
                rows={3}
                value={state.generalNotes}
                onChange={(e) => setState((prev) => ({ ...prev, generalNotes: e.target.value }))}
                placeholder="Overall notes"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Completed By</span>
                <input
                  className={inputClass(readOnly)}
                  disabled={readOnly}
                  value={state.completedBy}
                  onChange={(e) => setState((prev) => ({ ...prev, completedBy: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Role</span>
                <input
                  className={inputClass(readOnly)}
                  disabled={readOnly}
                  value={state.role}
                  onChange={(e) => setState((prev) => ({ ...prev, role: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Signature</span>
                <input
                  className={inputClass(readOnly)}
                  disabled={readOnly}
                  value={state.signature}
                  onChange={(e) => setState((prev) => ({ ...prev, signature: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Date</span>
                <input
                  type="date"
                  className={inputClass(readOnly)}
                  disabled={readOnly}
                  value={state.date}
                  onChange={(e) => setState((prev) => ({ ...prev, date: e.target.value }))}
                />
              </label>
            </div>
          </div>
        </div>        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save("Draft")}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save as Draft
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save("Submitted")}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Checklist
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Speed Checklist
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            {audience === "driver" ? "Your Speed Checklist records with completion status and date." : "Speed Checklist records with completion status and date."}
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          New Checklist
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      {loading ? (
        <p role="status" className="text-sm text-slate-300">Loading Speed Checklists</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No Speed Checklists have been created yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.payload || {}) as Record<string, unknown>;
            return (
              <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div>
                  <h3 className="font-bold">
                    Speed Checklist
                    {payload.completedBy ? ` · ${String(payload.completedBy)}` : ""}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {payload.date ? `Date ${String(payload.date)}` : `Updated ${dateLabel(row.submitted_at)}`}
                    {" · "}
                    {row.status === "Submitted" ? `Submitted ${dateLabel(row.submitted_at)}` : "Draft"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadgeClass(row.status)}`}>
                    {row.status.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Pencil className="h-4 w-4" />
                    {row.status.toLowerCase() === "draft" ? "Edit draft" : "View"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
