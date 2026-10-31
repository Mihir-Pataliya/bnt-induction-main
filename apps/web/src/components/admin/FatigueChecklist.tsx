"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Pencil, Plus, Save, Send, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "FC";
const FORM_TITLE = "Fatigue Checklist";

type Answer = "Yes" | "No" | "N/A" | "";

interface Question {
  id: string;
  text: string;
}

interface Category {
  title: string;
  questions: Question[];
}

const CATEGORIES: Category[] = [  {
    title: "Fatigue Management",
    questions: [
      { id: "fm-1", text: "Fatigue management policy is documented, current, and communicated to all relevant staff." },
      { id: "fm-2", text: "Work and rest hours are monitored and managed in accordance with HVNL requirements." },
      { id: "fm-3", text: "Drivers are trained in fatigue management and understand their obligations." },
      { id: "fm-4", text: "Schedules allow sufficient time for rest and recovery." },
      { id: "fm-5", text: "Fatigue-related incidents and near misses are recorded and reviewed." },
      { id: "fm-6", text: "Rest facilities are adequate and accessible." }
    ]
  },
  {
    title: "Third Parties (Subcontractors)",
    questions: [
      { id: "tp-1", text: "Subcontractors are assessed for fatigue/Chain of Responsibility compliance before engagement." },
      { id: "tp-2", text: "Contracts with subcontractors include fatigue management obligations." },
      { id: "tp-3", text: "Subcontractor fatigue records are reviewed and retained." },
      { id: "tp-4", text: "Subcontractor drivers are inducted into fatigue policies and procedures." }
    ]
  },  {
    title: "Fitness to Drive",
    questions: [
      { id: "fd-1", text: "Current medical assessments are held for all drivers." },
      { id: "fd-2", text: "Drivers complete fitness-for-duty checks before commencing shifts." },
      { id: "fd-3", text: "Medications or medical conditions affecting driving are reported and managed." },
      { id: "fd-4", text: "Drivers are free from impairment (drugs/alcohol) before driving." },
      { id: "fd-5", text: "Return-to-work after leave or medical absence is managed appropriately." }
    ]
  },
  {
    title: "Driver Fatigue Records",
    questions: [
      { id: "dr-1", text: "Work diaries/EWD records are maintained and available for audit." },
      { id: "dr-2", text: "Fatigue records are retained for the required period." },
      { id: "dr-3", text: "Records are audited for compliance at defined intervals." },
      { id: "dr-4", text: "Corrective actions from audits are tracked to closure." }
    ]
  },
  {
    title: "Trip Plans/Schedules",
    questions: [
      { id: "tp-s-1", text: "Trip plans are reviewed to ensure compliance with work/rest limits." },
      { id: "tp-s-2", text: "Transit times are realistic and do not incentivise speeding or fatigue." },
      { id: "tp-s-3", text: "Trip changes are reported and managed." },
      { id: "tp-s-4", text: "Drivers receive adequate route, load, and rest information." },
      { id: "tp-s-5", text: "Delivery windows do not pressure drivers to exceed limits." }
    ]
  },  {
    title: "Non-Conformances",
    questions: [
      { id: "nc-1", text: "A non-conformance register is maintained for fatigue breaches and near misses." },
      { id: "nc-2", text: "Corrective actions are assigned, tracked, and closed out." },
      { id: "nc-3", text: "Trends in non-conformances are reviewed by management." },
      { id: "nc-4", text: "Lessons learned are communicated to relevant staff." }
    ]
  },
  {
    title: "Fatigue Accreditation",
    questions: [
      { id: "fa-1", text: "Organisation holds current fatigue management accreditation (e.g. NHVAS) where applicable." },
      { id: "fa-2", text: "Accreditation evidence and records are maintained." },
      { id: "fa-3", text: "Internal audits are conducted to maintain accreditation." },
      { id: "fa-4", text: "Changes to accreditation requirements are monitored and implemented." }
    ]
  }
];

const ALL_QUESTIONS = CATEGORIES.flatMap((category) => category.questions);

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

function emptyState(session: SessionState): ChecklistState {
  const answers: Record<string, Answer> = {};
  const questionNotes: Record<string, string> = {};
  ALL_QUESTIONS.forEach((question) => {
    answers[question.id] = "";
    questionNotes[question.id] = "";
  });
  return {
    answers,
    questionNotes,
    generalNotes: "",
    completedBy: session.user.email,
    role: "Admin",
    signature: "",
    date: new Date().toISOString().slice(0, 10)
  };
}

function rowToState(row: ChecklistRow, session: SessionState): ChecklistState {
  const base = emptyState(session);
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
  if (!value) return "ï¿½";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}export function FatigueChecklist({ session }: { session: SessionState }) {
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("Draft");
  const [state, setState] = useState<ChecklistState>(() => emptyState(session));
  const [showForm, setShowForm] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", FORM_CODE)
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRows((data || []) as ChecklistRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fatigue checklists.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const openNew = () => {
    setSelectedId(null);
    setStatus("Draft");
    setState(emptyState(session));
    setReadOnly(false);
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openRow = (row: ChecklistRow) => {
    setSelectedId(row.id);
    setStatus(row.status || "Draft");
    setState(rowToState(row, session));
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
  const printChecklist = () => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    const answersHtml = ALL_QUESTIONS.map((q) => {
      const answer = state.answers[q.id] || "Not answered";
      const note = state.questionNotes[q.id] || "";
      return `<tr><td style="padding:8px;border:1px solid #ccc;">${q.text}</td><td style="padding:8px;border:1px solid #ccc;">${answer}</td><td style="padding:8px;border:1px solid #ccc;">${note || "-"}</td></tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>Fatigue Checklist</title></head><body style="font-family:Arial,sans-serif;padding:24px;">
      <h1>Fatigue Checklist</h1>
      <p><strong>Completed By:</strong> ${state.completedBy || "Not provided"}</p>
      <p><strong>Role:</strong> ${state.role || "Not provided"}</p>
      <p><strong>Signature:</strong> ${state.signature || "Not provided"}</p>
      <p><strong>Date:</strong> ${state.date || "Not provided"}</p>
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>General Notes:</strong> ${state.generalNotes || "Not provided"}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead><tr><th style="padding:8px;border:1px solid #ccc;text-align:left;">Question</th><th style="padding:8px;border:1px solid #ccc;text-align:left;">Answer</th><th style="padding:8px;border:1px solid #ccc;text-align:left;">Notes / Actions</th></tr></thead>
        <tbody>${answersHtml}</tbody>
      </table>
      <script>window.onload=function(){window.print();};</script>
    </body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
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
    const unanswered = ALL_QUESTIONS.find((question) => !state.answers[question.id]);
    if (unanswered) return "Answer every checklist question before submitting.";
    const missingNote = ALL_QUESTIONS.find((question) => state.answers[question.id] === "No" && !state.questionNotes[question.id]?.trim());
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
            form_code: FORM_CODE,
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
      setSuccess(nextStatus === "Submitted" ? "Fatigue checklist submitted." : "Fatigue checklist saved as draft.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save fatigue checklist.");
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
              Fatigue Checklist
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {readOnly ? "Review the saved fatigue checklist." : "Complete the fatigue checklist and save as draft or submit."}
            </p>
          </div>
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Back to list
          </button>
          <button
            type="button"
            onClick={printChecklist}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Print / Save as PDF
          </button>

        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <div className="space-y-5">
          {CATEGORIES.map((category) => (
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
            Fatigue Checklist
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Admin fatigue checklist records with completion status and date.
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
        <p role="status" className="text-sm text-slate-300">Loading fatigue checklists...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No fatigue checklists have been created yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.payload || {}) as Record<string, unknown>;
            return (
              <article key={row.id} className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-bold">
                    Fatigue Checklist
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">Submitted By: {String(payload.completedBy || "Not provided")}</p>
                  <p className="mt-1 text-xs text-slate-400">Submission Date/Time: {dateLabel(row.submitted_at)}</p>
                  <p className="mt-1 text-xs text-slate-400">Status: {row.status === "Submitted" ? "Submitted" : "Draft"}</p>
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



