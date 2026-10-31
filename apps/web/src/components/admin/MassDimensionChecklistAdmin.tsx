import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Pencil, Plus, Save, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "MDC";
const FORM_TITLE = "Mass and Dimension Limits Checklist";

type Answer = "Yes" | "No" | "N/A" | "";

interface Question { id: string; text: string; group: string; }

const QUESTIONS: Question[] = [
  { id: "md-1", group: "A. Mass and Dimension Limits Management", text: "Are all policies, procedures, roles, and responsibilities related to Mass and Dimension Limits current and relevant to existing business practices?" },
  { id: "md-2", group: "A. Mass and Dimension Limits Management", text: "Have relevant employees been inducted and trained, including new, casual and Third Parties (Subcontractors)?" },
  { id: "md-3", group: "A. Mass and Dimension Limits Management", text: "Have you investigated current technology for updates or considered updating current processes, e.g. digital weight scales?" },
  { id: "md-4", group: "A. Mass and Dimension Limits Management", text: "Have you, or do you have a date set, to complete the training that was included in this month’s CoR update?" },
  { id: "md-5", group: "A. Mass and Dimension Limits Management", text: "Have you reviewed any mass and/or dimension non-conformance reports to ensure they have been assessed, actioned, and closed out correctly?" },
  { id: "md-6", group: "A. Mass and Dimension Limits Management", text: "Have any mass and/or dimension infringement notices been issued? If yes, have you investigated to ensure your current processes are adequate?" },
  { id: "md-7", group: "A. Mass and Dimension Limits Management", text: "Have you checked your vehicles’ registrations are paid at the correct configuration rate, considering the examples in the source document?" },
  { id: "md-8", group: "A. Mass and Dimension Limits Management", text: "Have you checked contracts with Third Parties are free from incentives or rewards that could encourage drivers to exceed Mass and Dimension Limits?" },
  { id: "md-9", group: "B. Weight Limits", text: "Have you checked your vehicles’ combination capacity to ensure loading is within manufacturer and statutory gross and axle group limits, including GCM?" },
  { id: "md-10", group: "B. Weight Limits", text: "If a vehicle is Oversize and/or Overmass, do you have the appropriate permits in the vehicle, and is it loaded according to permit conditions?" },
  { id: "md-11", group: "B. Weight Limits", text: "Do you have a process to assess load weights prior to departure?" },
  { id: "md-12", group: "B. Weight Limits", text: "Do you calibrate that process to ensure accuracy?" },
  { id: "md-13", group: "B. Weight Limits", text: "Are any combinations PBS certified? If yes, is the correct paperwork available to the driver, and does the driver know how to interpret it?" },
  { id: "md-14", group: "C. Mass Management Accreditation (HVA or NHVAS if applicable)", text: "Are you maintaining a record of all relevant load information?" },
  { id: "md-15", group: "C. Mass Management Accreditation (HVA or NHVAS if applicable)", text: "For loads operating at HML weights, do you ensure the roads used are on the approved network?" },
  { id: "md-16", group: "C. Mass Management Accreditation (HVA or NHVAS if applicable)", text: "Do you require access permits to operate on a non-approved road?" },
  { id: "md-17", group: "C. Mass Management Accreditation (HVA or NHVAS if applicable)", text: "Have you completed your Quarterly Compliance statements and Annual review checklist, as referenced in the source document?" },
  { id: "md-18", group: "C. Mass Management Accreditation (HVA or NHVAS if applicable)", text: "Have you checked vehicle and trailer suspension maintenance is up to date?" }
];

interface ChecklistState {
  answers: Record<string, Answer>;
  comments: Record<string, string>;
  naReasons: Record<string, string>;
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
  const comments: Record<string, string> = {};
  const naReasons: Record<string, string> = {};
  QUESTIONS.forEach((q) => {
    answers[q.id] = "";
    comments[q.id] = "";
    naReasons[q.id] = "";
  });
  return {
    answers,
    comments,
    naReasons,
    completedBy: session.user.email,
    role: "Admin",
    signature: "",
    date: new Date().toISOString().slice(0, 10)
  };
}

export function MassDimensionChecklistAdmin({ session }: { session: SessionState }) {
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ChecklistRow | null>(null);
  const [state, setState] = useState<ChecklistState>(emptyState(session));
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
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
      setError(e instanceof Error ? e.message : "Unable to load checklist records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setState(emptyState(session));
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openEdit = (row: ChecklistRow) => {
    setEditing(row);
    const payload = (row.payload || {}) as any;
    setState({
      answers: payload.answers || {},
      comments: payload.comments || {},
      naReasons: payload.naReasons || {},
      completedBy: payload.completedBy || session.user.email,
      role: payload.role || "Admin",
      signature: payload.signature || "",
      date: payload.date || new Date().toISOString().slice(0, 10)
    });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const validate = (): string | null => {
    const unanswered = QUESTIONS.filter((q) => !state.answers[q.id]);
    if (unanswered.length) return "Please answer all questions (Yes, No, or N/A).";
    for (const q of QUESTIONS) {
      if (state.answers[q.id] === "N/A" && !state.naReasons[q.id]?.trim()) {
        return `Please provide an N/A explanation for question ${q.id}.`;
      }
    }
    if (!state.completedBy.trim()) return "Completed by name is required.";
    if (!state.role.trim()) return "Role is required.";
    if (!state.signature.trim()) return "Signature is required.";
    if (state.signature.trim().toLowerCase() !== state.completedBy.trim().toLowerCase()) {
      return "Signature must match the completed by name.";
    }
    if (!state.date) return "Date is required.";
    return null;
  };

  const save = async (submit: boolean) => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const payload = { ...state, status: submit ? "Completed" : "Draft" };
      if (editing) {
        const { error: err } = await supabase
          .from("cor_form_submissions")
          .update({ payload, status: submit ? "Submitted" : "Draft", updated_at: now, submitted_at: submit ? now : editing.submitted_at })
          .eq("id", editing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: FORM_CODE,
          form_title: FORM_TITLE,
          payload,
          status: submit ? "Submitted" : "Draft",
          submitted_at: submit ? now : null
        });
        if (err) throw err;
      }
      setSuccess(submit ? "Checklist submitted." : "Draft saved.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save checklist.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading checklist records...</p>;
  }
  if (showForm) {
    const groups = Array.from(new Set(QUESTIONS.map((q) => q.group)));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">
            {editing ? "Edit Mass and Dimension Limits Checklist" : "New Mass and Dimension Limits Checklist"}
          </h3>
          <button
            type="button"
            onClick={() => { setShowForm(false); setEditing(null); }}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back to list
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </div>
        )}

        {groups.map((group) => (
          <div key={group} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
              {group}
            </h4>
            {QUESTIONS.filter((q) => q.group === group).map((q) => (
              <div key={q.id} className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
                <p className="text-sm font-semibold text-white">{q.id.toUpperCase().replace("MD-", "")}. {q.text}</p>
                <div className="flex flex-wrap gap-4 text-sm text-slate-200">
                  {(["Yes", "No", "N/A"] as Answer[]).map((opt) => (
                    <label key={opt} className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        checked={state.answers[q.id] === opt}
                        onChange={() => setState((prev) => ({ ...prev, answers: { ...prev.answers, [q.id]: opt } }))}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
                {state.answers[q.id] === "N/A" && (
                  <input
                    value={state.naReasons[q.id] || ""}
                    onChange={(e) =>
                      setState((prev) => ({ ...prev, naReasons: { ...prev.naReasons, [q.id]: e.target.value } }))
                    }
                    placeholder="N/A explanation..."
                    className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                )}
                <textarea
                  value={state.comments[q.id] || ""}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, comments: { ...prev.comments, [q.id]: e.target.value } }))
                  }
                  placeholder="Comments / corrective action..."
                  rows={2}
                  className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>
            ))}
          </div>
        ))}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            Completion Details
          </h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">
              Completed by — Name *
              <input
                value={state.completedBy}
                onChange={(e) => setState((prev) => ({ ...prev, completedBy: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Role *
              <input
                value={state.role}
                onChange={(e) => setState((prev) => ({ ...prev, role: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Signature (type full name) *
              <input
                value={state.signature}
                onChange={(e) => setState((prev) => ({ ...prev, signature: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Date *
              <input
                type="date"
                value={state.date}
                onChange={(e) => setState((prev) => ({ ...prev, date: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <ClipboardCheck className="h-5 w-5 text-emerald-400" />
          Mass and Dimension Limits Checklist
        </h3>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> New Checklist
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No checklist records yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.payload || {}) as Record<string, unknown>;
            return (
              <article
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white"
              >
                <div>
                  <h3 className="font-bold">
                    Mass and Dimension Limits Checklist
                    {payload.completedBy ? ` — ${String(payload.completedBy)}` : ""}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {payload.date ? `Date ${String(payload.date)}` : `Updated ${row.submitted_at}`}
                    {" — "}
                    {row.status === "Submitted" ? "Submitted" : "Draft"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-3 py-1 text-xs font-bold bg-slate-700 text-slate-200">
                    {row.status.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
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
    </div>
  );
}