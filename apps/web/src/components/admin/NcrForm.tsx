import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Plus, Save, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type NcrRecord = {
  id: string;
  user_id: string;
  payload: any;
  status: string;
  submitted_at: string | null;
  updated_at: string;
};

const CATEGORIES = [
  "Fatigue",
  "Speed",
  "Mass and Dimension",
  "Load Restraint",
  "Vehicle Standards",
  "Licensing",
  "Scheduling",
  "Documentation",
  "Communication",
  "Other"
];

const EMPTY_FORM = {
  employee_name: "",
  ncr_category: "",
  date_from: "",
  date_to: "",
  report_number: "",
  what_happened: "",
  regulatory_notice: "",
  responsible_person: "",
  investigation: "",
  actions_taken: "",
  meeting_details: "",
  additional_monitoring: false,
  periodic_review: false,
  verbal_written_warning: "",
  business_improvements: "",
  follow_up: false,
  target_date: "",
  employee_signature: "",
  responsible_signature: "",
  employee_signature_date: "",
  responsible_signature_date: ""
};

export function NcrForm({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<NcrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<NcrRecord | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignDriverId, setAssignDriverId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", "NCR")
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRecords((data || []) as NcrRecord[]);
      // load drivers
      const { data: driverData } = await supabase.from("profiles").select("id, full_name, email").eq("role", "driver");
      setDrivers(driverData || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load NCR records.");
    } finally {
      setLoading(false);
    }
  };

  const assignDriver = async (recordId: string) => {
    if (!assignDriverId) {
      setError("Select a driver first.");
      return;
    }
    const driver = drivers.find((d) => d.id === assignDriverId);
    if (!driver) return;
    setAssigning(true);
    setError("");
    setSuccess("");
    try {
      const { data: rec } = await supabase
        .from("cor_form_submissions")
        .select("payload")
        .eq("id", recordId)
        .single();
      const updatedPayload = {
        ...(rec?.payload || {}),
        assigned_driver_id: driver.id,
        assigned_driver_name: driver.full_name || driver.email,
        assignment_status: "Pending Signature",
        driver_signature: null,
        driver_signature_date: null
      };
      const { error: upErr } = await supabase
        .from("cor_form_submissions")
        .update({ payload: updatedPayload, updated_at: new Date().toISOString() })
        .eq("id", recordId);
      if (upErr) throw upErr;
      setSuccess(`Report assigned to ${driver.full_name || driver.email}.`);
      setAssignDriverId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign report.");
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const generateReportNumber = (): string => {
    const existing = records
      .map((r) => {
        const m = (r.payload?.report_number || "").match(/(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    return `NCR${next}`;
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, report_number: generateReportNumber() });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openEdit = (rec: NcrRecord) => {
    setEditing(rec);
    setForm({ ...EMPTY_FORM, ...(rec.payload || {}) });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const validate = (): string | null => {
    if (!form.employee_name.trim()) return "Employee Name is required.";
    if (!form.ncr_category) return "NCR Category is required.";
    if (!form.date_from) return "Date NCR Occurred is required.";
    if (!form.what_happened.trim()) return "What Is the Non-Conformance is required.";
    if (!form.regulatory_notice) return "Was a regulatory notice issued? is required.";
    if (!form.responsible_person.trim()) return "Responsible Person's Name is required.";
    if (!form.investigation.trim()) return "Investigation details are required.";
    if (!form.actions_taken.trim()) return "Actions taken are required.";
    if (form.employee_signature && form.employee_signature.trim().toLowerCase() !== form.employee_name.trim().toLowerCase()) {
      return "Employee signature must match the printed name.";
    }
    if (form.responsible_signature && form.responsible_signature.trim().toLowerCase() !== form.responsible_person.trim().toLowerCase()) {
      return "Responsible person signature must match the printed name.";
    }
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
      const payload = { ...form, status: submit ? "Submitted" : "Draft" };
      if (editing) {
        const { error: err } = await supabase
          .from("cor_form_submissions")
          .update({
            payload,
            status: submit ? "Submitted" : "Draft",
            updated_at: now,
            submitted_at: submit ? now : editing.submitted_at
          })
          .eq("id", editing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: "NCR",
          form_title: "Non-Conformance Report (NCR)",
          payload,
          status: submit ? "Submitted" : "Draft",
          submitted_at: submit ? now : null
        });
        if (err) throw err;
      }
      setSuccess(submit ? "NCR submitted." : "Draft saved.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save NCR.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading NCR records...</p>;
  }
  if (showForm) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">
            {editing ? "Edit Non-Conformance Report (NCR)" : "New Non-Conformance Report (NCR)"}
          </h3>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setEditing(null);
            }}
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
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            NCR Details
          </h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">
              Employee Name *
              <input
                value={form.employee_name}
                onChange={(e) => setForm((p: any) => ({ ...p, employee_name: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              NCR Category *
              <select
                value={form.ncr_category}
                onChange={(e) => setForm((p: any) => ({ ...p, ncr_category: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200">
              Date NCR Occurred (from) *
              <input
                type="date"
                value={form.date_from}
                onChange={(e) => setForm((p: any) => ({ ...p, date_from: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Date NCR Occurred (to)
              <input
                type="date"
                value={form.date_to}
                onChange={(e) => setForm((p: any) => ({ ...p, date_to: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              NCR Number
              <input
                value={form.report_number}
                readOnly
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-300"
              />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              What Is the Non-Conformance? *
              <textarea
                value={form.what_happened}
                onChange={(e) => setForm((p: any) => ({ ...p, what_happened: e.target.value }))}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="text-xs font-medium text-slate-200">
              Was a regulatory notice issued? *
              <div className="mt-1 flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="regulatory_notice"
                    value="Yes"
                    checked={form.regulatory_notice === "Yes"}
                    onChange={() => setForm((p: any) => ({ ...p, regulatory_notice: "Yes" }))}
                  />
                  Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="regulatory_notice"
                    value="No"
                    checked={form.regulatory_notice === "No"}
                    onChange={() => setForm((p: any) => ({ ...p, regulatory_notice: "No" }))}
                  />
                  No
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            Investigation
          </h4>
          <div className="grid grid-cols-1 gap-4">
            <label className="text-xs font-medium text-slate-200">
              Responsible Person's Name *
              <input
                value={form.responsible_person}
                onChange={(e) => setForm((p: any) => ({ ...p, responsible_person: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              How the incident was investigated and closed out
              <textarea
                value={form.investigation}
                onChange={(e) => setForm((p: any) => ({ ...p, investigation: e.target.value }))}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Actions taken with the employee to fix the issue and prevent recurrence
              <textarea
                value={form.actions_taken}
                onChange={(e) => setForm((p: any) => ({ ...p, actions_taken: e.target.value }))}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Meeting details, dates, discussions, texts, and emails
              <textarea
                value={form.meeting_details}
                onChange={(e) => setForm((p: any) => ({ ...p, meeting_details: e.target.value }))}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            Improvement Implementation
          </h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={!!form.additional_monitoring}
                onChange={(e) => setForm((p: any) => ({ ...p, additional_monitoring: e.target.checked }))}
              />
              Additional monitoring required
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={!!form.periodic_review}
                onChange={(e) => setForm((p: any) => ({ ...p, periodic_review: e.target.checked }))}
              />
              Periodic performance review
            </label>
            <label className="text-xs font-medium text-slate-200">
              Verbal or written warning
              <select
                value={form.verbal_written_warning}
                onChange={(e) => setForm((p: any) => ({ ...p, verbal_written_warning: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">None</option>
                <option value="Verbal">Verbal</option>
                <option value="Written">Written</option>
                <option value="Both">Both</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200">
              Target date for completing improvements
              <input
                type="date"
                value={form.target_date}
                onChange={(e) => setForm((p: any) => ({ ...p, target_date: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-200 md:col-span-2">
              <input
                type="checkbox"
                checked={!!form.follow_up}
                onChange={(e) => setForm((p: any) => ({ ...p, follow_up: e.target.checked }))}
              />
              Follow-up review or action required
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Business improvements (procedures, documentation, communication, training)
              <textarea
                value={form.business_improvements}
                onChange={(e) => setForm((p: any) => ({ ...p, business_improvements: e.target.value }))}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            Close-Out
          </h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">
              Employee Signature (type full name)
              <input
                value={form.employee_signature}
                onChange={(e) => setForm((p: any) => ({ ...p, employee_signature: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Responsible Person's Signature (type full name)
              <input
                value={form.responsible_signature}
                onChange={(e) => setForm((p: any) => ({ ...p, responsible_signature: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Employee Signature Date
              <input
                type="date"
                value={form.employee_signature_date}
                onChange={(e) => setForm((p: any) => ({ ...p, employee_signature_date: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200">
              Responsible Person's Signature Date
              <input
                type="date"
                value={form.responsible_signature_date}
                onChange={(e) => setForm((p: any) => ({ ...p, responsible_signature_date: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>

        {editing && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-3">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
              Assign to Driver
            </h4>
            {editing.payload?.assigned_driver_name && (
              <p className="text-sm text-slate-300">
                Currently assigned to: <span className="font-semibold text-white">{editing.payload.assigned_driver_name}</span> — {editing.payload.assignment_status || "Pending Signature"}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <select
                value={assignDriverId}
                onChange={(e) => setAssignDriverId(e.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Select driver...</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name || d.email}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void assignDriver(editing.id)}
                disabled={assigning || !assignDriverId}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              >
                {assigning && <Loader2 className="h-4 w-4 animate-spin" />}
                Assign to Driver
              </button>
            </div>
          </div>
        )}
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
          Non-Conformance Report (NCR)
        </h3>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> New NCR
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
          No NCR records yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">NCR Number</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.payload?.report_number}</td>
                  <td className="px-4 py-3">{r.payload?.employee_name || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.ncr_category || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.status || r.status}</td>
                  <td className="px-4 py-3">{new Date(r.updated_at).toLocaleString()}</td>
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
    </div>
  );
}