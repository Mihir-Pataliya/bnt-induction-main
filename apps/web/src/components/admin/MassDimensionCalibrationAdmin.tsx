import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Paperclip, Plus, Save, Send, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "MDCAL";
const FORM_TITLE = "Axle and Gross Weight Calibration Procedure and Record";

const EMPTY_FORM = {
  truck_rego: "",
  trailer_rego: "",
  weighing_method: "",
  equipment_id: "",
  verification_date: "",
  performed_by: "",
  gross_weight: "",
  axle_weights: "",
  reference_weight: "",
  difference: "",
  result: "",
  comments: "",
  corrective_action: "",
  recalibration_performed: "",
  adjustment_date: "",
  personnel_notified: "",
  supporting_notes: "",
  evidence_files: [] as string[],
  next_due_date: "",
  interval_months: "6"
};

function dueStatus(nextDue: string | undefined): string {
  if (!nextDue) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Overdue";
  if (diffDays <= 30) return "Due soon";
  return "OK";
}
export function MassDimensionCalibrationAdmin({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      setRecords(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load calibration records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openEdit = (rec: any) => {
    setEditing(rec);
    setForm({ ...EMPTY_FORM, ...(rec.payload || {}) });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const validate = (): string | null => {
    if (!form.truck_rego.trim()) return "Truck registration number is required.";
    if (!form.weighing_method.trim()) return "Weighing method used is required.";
    if (!form.verification_date) return "Verification/calibration date is required.";
    if (!form.performed_by.trim()) return "Person who performed the check is required.";
    if (!form.result) return "Result is required.";
    return null;
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const path = `mass-dimension-calibration/${Date.now()}/${file.name}`;
      const { error: upErr } = await supabase.storage.from("contractor-documents").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      setForm((prev: any) => ({ ...prev, evidence_files: [...(prev.evidence_files || []), path] }));
      setSuccess("Evidence uploaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload evidence.");
    } finally {
      setUploading(false);
    }
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
      let nextDue = form.next_due_date;
      if (!nextDue && form.verification_date) {
        const d = new Date(form.verification_date);
        d.setMonth(d.getMonth() + Number(form.interval_months || 6));
        nextDue = d.toISOString().slice(0, 10);
      }
      const payload = { ...form, next_due_date: nextDue, status: submit ? "Submitted" : "Draft" };
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
      setSuccess(submit ? "Record submitted." : "Draft saved.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading calibration records...</p>;
  }
  if (showForm) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">
            {editing ? "Edit Calibration Record" : "New Calibration Record"}
          </h3>
          <button
            type="button"
            onClick={() => { setShowForm(false); setEditing(null); }}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back to list
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Vehicle and Method</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">Truck Registration Number *
              <input value={form.truck_rego} onChange={(e) => setForm((p: any) => ({ ...p, truck_rego: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Trailer Registration Number(s)
              <input value={form.trailer_rego} onChange={(e) => setForm((p: any) => ({ ...p, trailer_rego: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Weighing Method Used *
              <input value={form.weighing_method} onChange={(e) => setForm((p: any) => ({ ...p, weighing_method: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Equipment or Scale Identifier
              <input value={form.equipment_id} onChange={(e) => setForm((p: any) => ({ ...p, equipment_id: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Verification/Calibration Date *
              <input type="date" value={form.verification_date} onChange={(e) => setForm((p: any) => ({ ...p, verification_date: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Person Who Performed the Check *
              <input value={form.performed_by} onChange={(e) => setForm((p: any) => ({ ...p, performed_by: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Weight Verification</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">Recorded Gross Weight
              <input type="number" value={form.gross_weight} onChange={(e) => setForm((p: any) => ({ ...p, gross_weight: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Relevant Axle or Axle-Group Weights
              <input value={form.axle_weights} onChange={(e) => setForm((p: any) => ({ ...p, axle_weights: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Reference Weight or Comparison Result
              <input value={form.reference_weight} onChange={(e) => setForm((p: any) => ({ ...p, reference_weight: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Difference (measured vs reference)
              <input value={form.difference} onChange={(e) => setForm((p: any) => ({ ...p, difference: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Result *
              <select value={form.result} onChange={(e) => setForm((p: any) => ({ ...p, result: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value="">Select result...</option>
                <option value="Accurate">Accurate</option>
                <option value="Adjustment Required">Adjustment Required</option>
                <option value="Unable to Verify">Unable to Verify</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Comments or Findings
              <textarea value={form.comments} onChange={(e) => setForm((p: any) => ({ ...p, comments: e.target.value }))} rows={3} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Corrective Action</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Action taken if the weighing method was inaccurate
              <textarea value={form.corrective_action} onChange={(e) => setForm((p: any) => ({ ...p, corrective_action: e.target.value }))} rows={2} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Recalibration or adjustment performed?
              <select value={form.recalibration_performed} onChange={(e) => setForm((p: any) => ({ ...p, recalibration_performed: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value="">Select...</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200">
              Date of adjustment / verification after adjustment
              <input type="date" value={form.adjustment_date} onChange={(e) => setForm((p: any) => ({ ...p, adjustment_date: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Personnel notified
              <input value={form.personnel_notified} onChange={(e) => setForm((p: any) => ({ ...p, personnel_notified: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Supporting notes
              <textarea value={form.supporting_notes} onChange={(e) => setForm((p: any) => ({ ...p, supporting_notes: e.target.value }))} rows={2} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Calibration Schedule</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">
              Check interval (months)
              <select value={form.interval_months} onChange={(e) => setForm((p: any) => ({ ...p, interval_months: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value="3">3 months (Mass Management Accreditation)</option>
                <option value="6">6 months</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200">
              Next due date
              <input type="date" value={form.next_due_date} onChange={(e) => setForm((p: any) => ({ ...p, next_due_date: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Evidence</h4>
          <p className="text-xs text-slate-400">
            Attach supporting evidence (weight reports, weighbridge dockets, scale printouts, etc.).
          </p>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading..." : "Attach Evidence"}
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
          {form.evidence_files?.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {form.evidence_files.map((f: string, i: number) => (
                <li key={i} className="flex items-center gap-2">
                  <Paperclip className="h-3 w-3" /> {f.split("/").pop()}
                </li>
              ))}
            </ul>
          )}
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
          <ClipboardList className="h-5 w-5 text-emerald-400" />
          Axle and Gross Weight Calibration Procedure and Record
        </h3>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> New Record
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

      {records.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No calibration records yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Truck Rego</th>
                <th className="px-4 py-3 text-left">Weighing Method</th>
                <th className="px-4 py-3 text-left">Verification Date</th>
                <th className="px-4 py-3 text-left">Result</th>
                <th className="px-4 py-3 text-left">Performed By</th>
                <th className="px-4 py-3 text-left">Due Status</th>
                <th className="px-4 py-3 text-left">Evidence</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.payload?.truck_rego || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.weighing_method || "—"}</td>
                  <td className="px-4 py-3">
                    {r.payload?.verification_date ? new Date(r.payload.verification_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">{r.payload?.result || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.performed_by || "—"}</td>
                  <td className="px-4 py-3">{dueStatus(r.payload?.next_due_date)}</td>
                  <td className="px-4 py-3">{r.payload?.evidence_files?.length || 0} file(s)</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>
    </div>
  );
}