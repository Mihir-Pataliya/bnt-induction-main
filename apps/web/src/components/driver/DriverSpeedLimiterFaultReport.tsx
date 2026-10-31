import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, Plus, Save, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const EMPTY_FORM = {
  vehicle_rego: "",
  incident_date: new Date().toISOString().slice(0, 16),
  location: "",
  warning_light: "",
  working_normally: "",
  description: "",
  photo_url: "",
  declaration: false
};

export function DriverSpeedLimiterFaultReport({ session }: { session: SessionState }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY_FORM });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", "SLC_DRIVER_FAULT")
        .eq("user_id", session.user.id)
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRecords(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fault reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openNew = () => {
    setForm({ ...EMPTY_FORM, incident_date: new Date().toISOString().slice(0, 16) });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const submit = async () => {
    if (!form.vehicle_rego || !form.description) {
      setError("Vehicle registration and description are required.");
      return;
    }
    if (!form.declaration) {
      setError("Driver declaration is required.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = { ...form };
      const { error: err } = await supabase
        .from("cor_form_submissions")
        .insert({ user_id: session.user.id, form_code: "SLC_DRIVER_FAULT", form_title: "Driver Speed Limiter Fault Report", payload, status: "Submitted" });
      if (err) throw err;
      setSuccess("Fault report submitted.");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit fault report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <AlertTriangle className="h-5 w-5 text-emerald-400" />
          Speed Limiter Fault Report
        </h3>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> New Report
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      {showForm && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
          <label className="block text-sm text-slate-200">Vehicle Registration
            <input value={form.vehicle_rego} onChange={(e) => setForm({ ...form, vehicle_rego: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-200">Date and Time
            <input type="datetime-local" value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-200">Current Location
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-200">Speed limiter warning light showing?
            <select value={form.warning_light} onChange={(e) => setForm({ ...form, warning_light: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white">
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
          <label className="block text-sm text-slate-200">Speed limiter working normally?
            <select value={form.working_normally} onChange={(e) => setForm({ ...form, working_normally: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white">
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
              <option>Unsure</option>
            </select>
          </label>
          <label className="block text-sm text-slate-200">Describe the problem
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={form.declaration} onChange={(e) => setForm({ ...form, declaration: e.target.checked })} />
            I declare this information is accurate.
          </label>
          <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Report
          </button>
        </div>
      )}

      {loading ? <p className="text-sm text-slate-400">Loading...</p> : records.length === 0 ? <p className="text-sm text-slate-400">No fault reports yet.</p> : (
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-200">
              <p className="font-semibold">{r.payload?.vehicle_rego} · {r.payload?.incident_date}</p>
              <p className="text-xs text-slate-400">{r.status} · {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "Draft"}</p>
              <p className="mt-1">{r.payload?.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}