import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, Plus, Save, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const EMPTY_FORM = {
  employee_name: "",
  date_incident: "",
  incident_location: "",
  report_number: "",
  vehicle_rego: "",
  incident_category: "",
  incident_description: "",
  contributing_factors: "",
  regulatory_notice: "",
  injuries: "",
  injury_details: "",
  property_damage: "",
  property_damage_details: "",
  emergency_services: "",
  emergency_service_type: "",
  witness_details: "",
  additional_comments: ""
};

export function DriverNcrIncidentReport({ session }: { session: SessionState }) {
  const [records, setRecords] = useState<any[]>([]);
  const [assignedRecords, setAssignedRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });
  const [editing, setEditing] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", "WHSI")
        .eq("user_id", session.user.id)
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRecords(data || []);

      const { data: assigned } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .in("form_code", ["NCR", "WHSI"])
        .filter("payload->>assigned_driver_id", "eq", session.user.id);
      setAssignedRecords(assigned || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your incident reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const generateReportNumber = (): string => {
    return `WHSI-${Date.now().toString().slice(-6)}`;
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, employee_name: session.user.email, report_number: generateReportNumber() });
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

  const signReport = async (record: any) => {
    const sig = window.prompt("Type your full name to sign:");
    if (!sig) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const updatedPayload = {
        ...(record.payload || {}),
        driver_signature: sig,
        driver_signature_date: now,
        assignment_status: "Signed"
      };
      const { error: upErr } = await supabase
        .from("cor_form_submissions")
        .update({ payload: updatedPayload, updated_at: now })
        .eq("id", record.id);
      if (upErr) throw upErr;
      setSuccess("Signature submitted.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit signature.");
    } finally {
      setSaving(false);
    }
  };

  const validate = (): string | null => {
    if (!form.employee_name.trim()) return "Employee Name is required.";
    if (!form.date_incident) return "Incident Date and Time is required.";
    if (!form.incident_location.trim()) return "Incident Location is required.";
    if (!form.incident_category) return "Incident Category is required.";
    if (!form.incident_description.trim()) return "Incident Description is required.";
    if (!form.regulatory_notice) return "Was a Regulatory Notice Issued? is required.";
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
          .update({ payload, status: submit ? "Submitted" : "Draft", updated_at: now, submitted_at: submit ? now : editing.submitted_at })
          .eq("id", editing.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: "WHSI",
          form_title: "WHS Incident Report",
          payload,
          status: submit ? "Submitted" : "Draft",
          submitted_at: submit ? now : null
        });
        if (err) throw err;
      }
      setSuccess(submit ? `Report submitted. Your report number is ${form.report_number}.` : "Draft saved.");
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save report.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading your incident reports...</p>;
  }
  if (showForm) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">
            {editing ? "Edit Incident Report" : "Report an Incident"}
          </h3>
          <button
            type="button"
            onClick={() => { setShowForm(false); setEditing(null); }}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200">Employee/Driver Name *
              <input value={form.employee_name} onChange={(e) => setForm((p: any) => ({ ...p, employee_name: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Incident Date and Time *
              <input type="datetime-local" value={form.date_incident} onChange={(e) => setForm((p: any) => ({ ...p, date_incident: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Incident Location *
              <input value={form.incident_location} onChange={(e) => setForm((p: any) => ({ ...p, incident_location: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Report Number
              <input value={form.report_number} readOnly className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-300" />
            </label>
            <label className="text-xs font-medium text-slate-200">Vehicle Registration Number
              <input value={form.vehicle_rego} onChange={(e) => setForm((p: any) => ({ ...p, vehicle_rego: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200">Incident Category *
              <select value={form.incident_category} onChange={(e) => setForm((p: any) => ({ ...p, incident_category: e.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value="">Select category...</option>
                <option value="Accident">Accident</option>
                <option value="Complaint">Complaint</option>
                <option value="Near Miss">Near Miss</option>
                <option value="Hazard">Hazard</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">Incident Description *
              <textarea value={form.incident_description} onChange={(e) => setForm((p: any) => ({ ...p, incident_description: e.target.value }))} rows={3} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">Contributing Factors
              <textarea value={form.contributing_factors} onChange={(e) => setForm((p: any) => ({ ...p, contributing_factors: e.target.value }))} rows={2} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <div className="text-xs font-medium text-slate-200">
              Was a Regulatory Notice Issued? *
              <div className="mt-1 flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="regulatory_notice" value="Yes" checked={form.regulatory_notice === "Yes"} onChange={() => setForm((p: any) => ({ ...p, regulatory_notice: "Yes" }))} /> Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="regulatory_notice" value="No" checked={form.regulatory_notice === "No"} onChange={() => setForm((p: any) => ({ ...p, regulatory_notice: "No" }))} /> No
                </label>
              </div>
            </div>
            <div className="text-xs font-medium text-slate-200">
              Were There Any Injuries?
              <div className="mt-1 flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="injuries" value="Yes" checked={form.injuries === "Yes"} onChange={() => setForm((p: any) => ({ ...p, injuries: "Yes" }))} /> Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="injuries" value="No" checked={form.injuries === "No"} onChange={() => setForm((p: any) => ({ ...p, injuries: "No" }))} /> No
                </label>
              </div>
              {form.injuries === "Yes" && (
                <textarea value={form.injury_details} onChange={(e) => setForm((p: any) => ({ ...p, injury_details: e.target.value }))} placeholder="Injury details" rows={2} className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              )}
            </div>
            <div className="text-xs font-medium text-slate-200">
              Was There Property Damage?
              <div className="mt-1 flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="property_damage" value="Yes" checked={form.property_damage === "Yes"} onChange={() => setForm((p: any) => ({ ...p, property_damage: "Yes" }))} /> Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="property_damage" value="No" checked={form.property_damage === "No"} onChange={() => setForm((p: any) => ({ ...p, property_damage: "No" }))} /> No
                </label>
              </div>
              {form.property_damage === "Yes" && (
                <textarea value={form.property_damage_details} onChange={(e) => setForm((p: any) => ({ ...p, property_damage_details: e.target.value }))} placeholder="Property damage details" rows={2} className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              )}
            </div>
            <div className="text-xs font-medium text-slate-200">
              Were Emergency Services Required?
              <div className="mt-1 flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="emergency_services" value="Yes" checked={form.emergency_services === "Yes"} onChange={() => setForm((p: any) => ({ ...p, emergency_services: "Yes" }))} /> Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="emergency_services" value="No" checked={form.emergency_services === "No"} onChange={() => setForm((p: any) => ({ ...p, emergency_services: "No" }))} /> No
                </label>
              </div>
              {form.emergency_services === "Yes" && (
                <textarea value={form.emergency_service_type} onChange={(e) => setForm((p: any) => ({ ...p, emergency_service_type: e.target.value }))} placeholder="Emergency service details" rows={2} className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              )}
            </div>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Witness Details
              <textarea value={form.witness_details} onChange={(e) => setForm((p: any) => ({ ...p, witness_details: e.target.value }))} rows={2} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Additional Comments
              <textarea value={form.additional_comments} onChange={(e) => setForm((p: any) => ({ ...p, additional_comments: e.target.value }))} rows={3} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void save(false)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
          </button>
          <button type="button" onClick={() => void save(true)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Report
          </button>
        </div>
      </div>
    );
  }
  const pendingSignatures = assignedRecords.filter((r) => !r.payload?.driver_signature);

  return (
    <div className="space-y-4">
      {pendingSignatures.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-3">
          <h3 className="text-lg font-bold text-white">Pending Signatures</h3>
          {pendingSignatures.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
              <div className="text-sm text-slate-200">
                <span className="font-semibold">{r.payload?.report_number}</span> — {r.payload?.assigned_driver_name} ({r.form_code})
              </div>
              <button
                type="button"
                onClick={() => void signReport(r)}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                Sign
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <ClipboardList className="h-5 w-5 text-emerald-400" />
          Report an Incident
        </h3>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> New Report
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      {records.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No incident reports yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Report Number</th>
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
                  <td className="px-4 py-3">{r.payload?.incident_category || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.status || r.status}</td>
                  <td className="px-4 py-3">{new Date(r.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => openEdit(r)} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
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