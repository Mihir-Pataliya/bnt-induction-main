import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Save, Send } from "lucide-react";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "MDANSWERS";
const FORM_TITLE = "Mass and Dimension Awareness Assessment Answers";

const EMPTY = { participant_name: "", date_completed: "", answers: "", signature: "" };

export function MassDimensionAssessmentAnswersAdmin({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
      if (err) throw err;
      setRecords(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openNew = () => { setEditing(null); setForm({ ...EMPTY }); setShowForm(true); setError(""); setSuccess(""); };
  const openEdit = (rec: any) => { setEditing(rec); setForm({ ...EMPTY, ...(rec.payload || {}) }); setShowForm(true); setError(""); setSuccess(""); };

  const validate = (): string | null => {
    if (!form.answers.trim()) return "Answers are required.";
    return null;
  };

  const save = async (submit: boolean) => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const payload = { ...form, status: submit ? "Submitted" : "Draft" };
      if (editing) {
        const { error: err } = await supabase.from("cor_form_submissions").update({ payload, status: submit ? "Submitted" : "Draft", updated_at: now, submitted_at: submit ? now : editing.submitted_at }).eq("id", editing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({ user_id: session.user.id, form_code: FORM_CODE, form_title: FORM_TITLE, payload, status: submit ? "Submitted" : "Draft", submitted_at: submit ? now : null });
        if (err) throw err;
      }
      setSuccess(submit ? "Submitted." : "Draft saved.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p role="status" className="text-sm text-slate-300">Loading...</p>;
  if (showForm) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">{editing ? "Edit Assessment Answers" : "New Assessment Answers"}</h3>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Back to list</button>
        </div>
        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">Participant Name
              <input value={form.participant_name} onChange={(e) => setForm((p: any) => ({ ...p, participant_name: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Date Completed
              <input type="date" value={form.date_completed} onChange={(e) => setForm((p: any) => ({ ...p, date_completed: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Assessment Answers
              <textarea value={form.answers} onChange={(e) => setForm((p: any) => ({ ...p, answers: e.target.value }))} rows={8} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Signature
              <input value={form.signature} onChange={(e) => setForm((p: any) => ({ ...p, signature: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void save(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
          </button>
          <button type="button" onClick={() => void save(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <ClipboardList className="h-5 w-5 text-emerald-400" /> Mass and Dimension Awareness Assessment Answers
        </h3>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> New
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}
      {records.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No records yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Participant</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.payload?.participant_name || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.date_completed ? new Date(r.payload.date_completed).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => openEdit(r)} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>
    </div>
  );
}