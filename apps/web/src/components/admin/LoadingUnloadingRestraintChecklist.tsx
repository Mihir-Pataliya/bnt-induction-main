"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Pencil, Plus, Save, Send, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "LURC_CHECKLIST";
const FORM_TITLE = "Loading, Unloading & Restraint Checklist";

type Answer = "Yes" | "No" | "N/A" | "";

interface Question {
  id: string;
  text: string;
  roles?: Array<"All" | "Driver" | "Loader">;
}

interface Category {
  title: string;
  questions: Question[];
}

const CATEGORIES: Category[] = [
  {
    title: "Load Restraint",
    questions: [
      { id: "lr-1", text: "All loads are restrained in accordance with the NTC Load Restraint Guide performance standards." },
      { id: "lr-2", text: "Drivers inspect restraint equipment (straps, chains, gates, curtains and dunnage) at pre-start; damaged equipment is tagged out and replaced.", roles: ["Driver"] },
      { id: "lr-3", text: "Drivers check load security before departure, after the first 10–20 km and at each rest stop, and after any change in load.", roles: ["Driver"] }
    ]
  },
  {
    title: "Loading, Unloading & Customer Sites",
    questions: [
      { id: "lu-1", text: "Drivers complete a Take 5 on arrival and follow the customer's site rules and induction.", roles: ["Driver"] },
      { id: "lu-2", text: "Drivers remain in a designated safe zone while forklifts load or unload, unless directed otherwise by the site.", roles: ["Driver"] },
      { id: "lu-3", text: "Unsafe sites, including sites without traffic management, unsafe docks or poor lighting, are reported as hazards; the site risk assessment is updated and the customer is consulted.", roles: ["All"] }
    ]
  },
  {
    title: "Yard Safety",
    questions: [
      { id: "ys-1", text: "Vehicle movements in yards are controlled by speed limits, one-way systems, spotters for reversing where required, and hi-vis clothing.", roles: ["All"] },
      { id: "ys-2", text: "Only workers with a current High Risk Work Licence (LF) operate forklifts.", roles: ["Loader"] },
      { id: "ys-3", text: "Forklifts receive a daily pre-use check.", roles: ["Loader"] },
      { id: "ys-4", text: "Controls include speed limits, pedestrian exclusion zones, reversing alarms and lights, and mandatory hi-vis.", roles: ["All"] }
    ]
  },
  {
    title: "Manual Handling, PPE & Work Position",
    questions: [
      { id: "mh-1", text: "Mechanical aids (pallet jacks, trolleys and tail-lifts) are used wherever possible.", roles: ["All"] },
      { id: "mh-2", text: "Safe lifting techniques are used; twisting, overreaching and repetitive heavy lifting are avoided.", roles: ["Loader"] },
      { id: "mh-3", text: "Team lifts are used for heavy or awkward loads; tasks that cannot be done safely are reported as hazards.", roles: ["Loader"] },
      { id: "mh-4", text: "Three points of contact are used when getting in and out of cabs and onto trailers.", roles: ["Driver"] },
      { id: "ppe-1", text: "Hi-vis clothing and safety footwear are worn in operational areas and customer sites.", roles: ["All"] },
      { id: "ppe-2", text: "Safety gloves are worn when handling sharp objects or rough materials; a harness is worn when the site requires work at height.", roles: ["Loader"] }
    ]
  }
];

const ALL_QUESTIONS = CATEGORIES.flatMap((category) => category.questions);

function questionsForRole(role: string) {
  const normalized = role.toLowerCase();
  const workerRole = normalized.includes("loader") || normalized.includes("yard") ? "Loader" : "Driver";
  return ALL_QUESTIONS.filter((question) => !question.roles || question.roles.includes("All") || question.roles.includes(workerRole));
}

interface ChecklistState {
  answers: Record<string, Answer>;
  questionNotes: Record<string, string>;
  generalNotes: string;
  completedBy: string;
  role: string;
  signature: string;
  date: string;
  safetyIssues: string;
  adminFeedback: string;
  followUpActions: string;
  followUpOwner: string;
  followUpDueDate: string;
}

interface ChecklistRow {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  status: string;
  submitted_at: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
}

function emptyState(session: SessionState, audience: "admin" | "driver"): ChecklistState {
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
    role: audience === "driver" ? "Driver" : "Admin",
    signature: "",
    date: new Date().toISOString().slice(0, 10),
    safetyIssues: "",
    adminFeedback: "",
    followUpActions: "",
    followUpOwner: "",
    followUpDueDate: ""
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
    safetyIssues: String(payload.safetyIssues ?? ""),
    adminFeedback: String(payload.adminFeedback ?? row.review_notes ?? ""),
    followUpActions: String(payload.followUpActions ?? ""),
    followUpOwner: String(payload.followUpOwner ?? ""),
    followUpDueDate: String(payload.followUpDueDate ?? ""),
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
    safetyIssues: state.safetyIssues,
    adminFeedback: state.adminFeedback,
    followUpActions: state.followUpActions,
    followUpOwner: state.followUpOwner,
    followUpDueDate: state.followUpDueDate,
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
}export function LoadingUnloadingRestraintChecklist({ session, audience = "admin" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
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
        .eq("form_code", FORM_CODE);
      const scopedQuery = audience === "driver" ? baseQuery.eq("user_id", session.user.id) : baseQuery;
      const { data, error: err } = await scopedQuery.order("submitted_at", { ascending: false });
      if (err) throw err;
      setRows((data || []) as ChecklistRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Loading, Unloading & Restraint Checklists.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [audience, session.user.id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (audience !== "driver") return;
    let cancelled = false;
    api.getDriverMessages(session, "loading")
      .then((data) => { if (!cancelled) setNotifications(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setNotifications([]); });
    return () => { cancelled = true; };
  }, [audience, session]);

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
    setReadOnly(audience === "driver"
      ? (row.status || "").toLowerCase() !== "draft"
      : row.status?.toLowerCase() !== "draft");
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openNotificationChecklist = async (checklistId: string) => {
    if (!checklistId) return;
    const { data } = await supabase.from("cor_form_submissions").select("*").eq("id", checklistId).maybeSingle();
    if (data) openRow(data as ChecklistRow);
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
    const applicableQuestions = questionsForRole(state.role);
    const unanswered = applicableQuestions.find((question) => !state.answers[question.id]);
    if (unanswered) return "Answer every checklist question that applies to your role before submitting.";
    const missingNote = applicableQuestions.find((question) => state.answers[question.id] === "No" && !state.questionNotes[question.id]?.trim());
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
      setSuccess(nextStatus === "Submitted" ? "Loading, Unloading & Restraint Checklist submitted." : "Loading, Unloading & Restraint Checklist saved as draft.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save Loading, Unloading & Restraint Checklist.");
    } finally {
      setSaving(false);
    }
  };

  const review = async (nextStatus: "Under Review" | "Resolved") => {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    try {
      const safetyIssueCount = Object.values(state.answers).filter((answer) => answer === "No").length;
      if (nextStatus === "Resolved" && (safetyIssueCount > 0 || state.followUpActions.trim()) && (!state.followUpOwner.trim() || !state.followUpDueDate.trim())) {
        throw new Error("Assign a follow-up owner and due date before resolving safety actions.");
      }
      const payload = stateToPayload(state, nextStatus);
      const { error: err } = await supabase.from("cor_form_submissions").update({
        payload,
        status: nextStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.user.id,
        review_notes: state.adminFeedback || state.safetyIssues
      }).eq("id", selectedId);
      if (err) throw err;
      setStatus(nextStatus);
      // Notify the driver about the review/resolution.
      try {
        const driverId = rows.find((row) => row.id === selectedId)?.user_id;
        if (driverId) {
          await api.sendFatigueFeedback(session, driverId, {
            subject: "Loading, Unloading & Restraint Checklist Review",
            message: `${state.adminFeedback || state.safetyIssues || `Your checklist has been marked ${nextStatus}.`}\n\nRequired corrective actions: ${state.followUpActions || "None"}\nAction owner: ${state.followUpOwner || "Not assigned"}\nFollow-up due: ${state.followUpDueDate || "Not set"}`,
            messageType: nextStatus === "Resolved" ? "Checklist Resolved" : "Checklist Under Review",
            requiredAction: `OPEN_CHECKLIST:${selectedId}`,
            module: "loading"
          });
        }
      } catch (notificationError) {
        console.error("Unable to send checklist notification", notificationError);
      }
      setSuccess(nextStatus === "Resolved" ? "Checklist resolved and follow-up actions recorded." : "Checklist marked as under review.");
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to review checklist.");
    } finally {
      setSaving(false);
    }
  };

  const statusBadgeClass = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized === "submitted") return "bg-emerald-500/15 text-emerald-300";
    if (normalized === "draft") return "bg-amber-500/15 text-amber-200";
    if (normalized === "under review") return "bg-blue-500/15 text-blue-300";
    if (normalized === "resolved") return "bg-violet-500/15 text-violet-300";
    return "bg-slate-500/15 text-slate-300";
  };  if (showForm) {
    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black text-white">
              <ClipboardCheck className="h-5 w-5 text-emerald-400" />
              Loading, Unloading & Restraint Checklist
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              {readOnly ? "Review the saved Loading, Unloading & Restraint Checklist." : "Complete the Loading, Unloading & Restraint Checklist and save as draft or submit."}
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
          {CATEGORIES.map((category) => {
            const applicableQuestions = category.questions.filter((question) => !question.roles || question.roles.includes("All") || question.roles.includes(state.role.toLowerCase().includes("loader") || state.role.toLowerCase().includes("yard") ? "Loader" : "Driver"));
            return applicableQuestions.length > 0 ? (
            <div key={category.title} className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">{category.title}</h3>
              {applicableQuestions.map((question) => (
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
            ) : null;
          })}

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
              {audience === "driver" ? (
                <label className="space-y-1 text-sm text-slate-300">
                  <span className="font-medium">Role</span>
                  <select
                    className={inputClass(readOnly)}
                    disabled={readOnly}
                    value={state.role === "Loader" ? "Loader" : "Driver"}
                    onChange={(e) => setState((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="Driver">Driver</option>
                    <option value="Loader">Loader / Yard worker</option>
                  </select>
                </label>
              ) : (
                <label className="space-y-1 text-sm text-slate-300">
                  <span className="font-medium">Role</span>
                  <input className={inputClass(true)} disabled value={state.role || "Driver"} readOnly />
                </label>
              )}
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
        </div>
        {audience === "admin" && status !== "Draft" && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-300">Admin Review & Follow-up</h3>
            <label className="block text-sm text-slate-300">Admin feedback<textarea className={inputClass()} rows={3} value={state.adminFeedback} onChange={(e) => setState((prev) => ({ ...prev, adminFeedback: e.target.value }))} /></label>
            <label className="block text-sm text-slate-300">Safety issues<textarea className={inputClass()} rows={3} value={state.safetyIssues} onChange={(e) => setState((prev) => ({ ...prev, safetyIssues: e.target.value }))} /></label>
            <label className="block text-sm text-slate-300">Required actions<textarea className={inputClass()} rows={3} value={state.followUpActions} onChange={(e) => setState((prev) => ({ ...prev, followUpActions: e.target.value }))} /></label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-300">Action owner<input className={inputClass()} value={state.followUpOwner} onChange={(e) => setState((prev) => ({ ...prev, followUpOwner: e.target.value }))} /></label>
              <label className="text-sm text-slate-300">Follow-up due date<input type="date" className={inputClass()} value={state.followUpDueDate} onChange={(e) => setState((prev) => ({ ...prev, followUpDueDate: e.target.value }))} /></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={() => void review("Under Review")} className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-200">Mark Under Review</button>
              <button type="button" disabled={saving} onClick={() => void review("Resolved")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Resolve Checklist</button>
            </div>
          </div>
        )}
        {status !== "Draft" && (state.adminFeedback || state.safetyIssues || state.followUpActions || state.followUpOwner || state.followUpDueDate) && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-2 text-sm text-slate-200">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-300">Admin Review & Follow-up</h3>
            {(state.adminFeedback || state.safetyIssues) && <p><strong>Admin feedback:</strong> {state.adminFeedback || state.safetyIssues}</p>}
            {state.safetyIssues && state.adminFeedback && <p><strong>Safety issues:</strong> {state.safetyIssues}</p>}
            {state.followUpActions && <p><strong>Required corrective actions:</strong> {state.followUpActions}</p>}
            {state.followUpOwner && <p><strong>Action owner:</strong> {state.followUpOwner}</p>}
            {state.followUpDueDate && <p><strong>Follow-up due date:</strong> {state.followUpDueDate}</p>}
          </div>
        )}
        {!readOnly && audience === "driver" && (
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
            Loading, Unloading & Restraint Checklist
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            {audience === "driver" ? "Your Loading, Unloading & Restraint Checklist records with completion status and date." : "Loading, Unloading & Restraint Checklist records with completion status and date."}
          </p>
        </div>
        {audience === "driver" && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            New Checklist
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      {audience === "driver" && notifications.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-300">Notifications</h3>
          {notifications.map((notification) => {
            const checklistId = String(notification.required_action || "").replace("OPEN_CHECKLIST:", "").trim();
            return (
              <div key={notification.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-white">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{notification.subject ?? "Checklist update"}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${notification.status === "Unread" ? "bg-amber-500/20 text-amber-300" : "bg-slate-600 text-slate-200"}`}>{notification.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{notification.message_type} · {new Date(notification.created_at).toLocaleString()}</p>
                <p className="mt-2 text-sm text-slate-200 whitespace-pre-wrap">{notification.message}</p>
                {checklistId && (
                  <button type="button" onClick={() => void openNotificationChecklist(checklistId)} className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">View checklist</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <p role="status" className="text-sm text-slate-300">Loading Loading, Unloading & Restraint Checklists</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No Loading, Unloading & Restraint Checklists have been created yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const payload = (row.payload || {}) as Record<string, unknown>;
            return (
              <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div>
                  <h3 className="font-bold">
                    Loading, Unloading & Restraint Checklist
                    {payload.completedBy ? ` · ${String(payload.completedBy)}` : ""}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {payload.date ? `Date ${String(payload.date)}` : `Updated ${dateLabel(row.submitted_at)}`}
                    {" · "}
                    {row.status === "Draft" ? "Draft" : `Submitted ${dateLabel(row.submitted_at)}`}
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
                    {row.status.toLowerCase() === "draft" ? "Edit draft" : "View Details"}
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
