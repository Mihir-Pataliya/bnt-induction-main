"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "SLC";
const FORM_TITLE = "Speed Limiter Compliance Check";

interface LimiterRow {
  id: string;
  user_id: string;
  payload: Record<string, unknown>;
  status: string;
  submitted_at: string | null;
}

interface LimiterState {
  registrationNumber: string;
  driverName: string;
  dateTime: string;
  location: string;
  compliant: "Compliant" | "Not Compliant" | "";
  calibrationRepairDetails: string;
  authorisedRepairer: string;
  scheduledRepairDate: string;
  repairDate: string;
  documentPath: string;
  documentName: string;
}

function emptyState(): LimiterState {
  return {
    registrationNumber: "",
    driverName: "",
    dateTime: new Date().toISOString().slice(0, 16),
    location: "",
    compliant: "",
    calibrationRepairDetails: "",
    authorisedRepairer: "",
    scheduledRepairDate: "",
    repairDate: "",
    documentPath: "",
    documentName: ""
  };
}

function rowToState(row: LimiterRow): LimiterState {
  const base = emptyState();
  const payload = (row.payload || {}) as Record<string, unknown>;
  return {
    registrationNumber: String(payload.registrationNumber ?? ""),
    driverName: String(payload.driverName ?? ""),
    dateTime: String(payload.dateTime ?? base.dateTime),
    location: String(payload.location ?? ""),
    compliant: (payload.compliant as LimiterState["compliant"]) ?? "",
    calibrationRepairDetails: String(payload.calibrationRepairDetails ?? ""),
    authorisedRepairer: String(payload.authorisedRepairer ?? ""),
    scheduledRepairDate: String(payload.scheduledRepairDate ?? ""),
    repairDate: String(payload.repairDate ?? ""),
    documentPath: String(payload.documentPath ?? ""),
    documentName: String(payload.documentName ?? "")
  };
}

function stateToPayload(state: LimiterState): Record<string, unknown> {
  return { ...state };
}

export function SpeedLimiterComplianceCheck({ session, audience = "admin" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const [rows, setRows] = useState<LimiterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<LimiterState>(() => emptyState());
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      setRows((data || []) as LimiterRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load limiter checks.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [audience, session.user.id]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const openNew = () => {
    setState(emptyState());
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const key = `${session.user.id}/speed-limiter/${crypto.randomUUID()}-${file.name}`;
      const { data, error: uploadError } = await supabase.storage.from("induction-assets").upload(key, file, { upsert: false });
      if (uploadError) throw uploadError;
      setState((prev) => ({ ...prev, documentPath: data.path, documentName: file.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const validate = (): string | null => {
    if (!state.registrationNumber.trim()) return "Registration number is required.";
    if (!state.driverName.trim()) return "Driver name is required.";
    if (!state.dateTime.trim()) return "Date/time is required.";
    if (!state.location.trim()) return "Location is required.";
    if (!state.compliant) return "Compliance result is required.";
    return null;
  };

  const save = async () => {
    setError("");
    setSuccess("");
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    try {
      const payload = stateToPayload(state);
      const { error: err } = await supabase
        .from("cor_form_submissions")
        .insert({
          user_id: session.user.id,
          form_code: FORM_CODE,
          form_title: FORM_TITLE,
          payload,
          status: "Submitted"
        });
      if (err) throw err;
      setSuccess("Speed limiter compliance check saved.");
      setShowForm(false);
      setState(emptyState());
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save limiter check.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Speed Limiter Compliance Check</h3>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
          New Check
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {success && <p className="text-sm text-emerald-300">{success}</p>}

      {showForm && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-200">
              Registration Number
              <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.registrationNumber} onChange={(e) => setState((p) => ({ ...p, registrationNumber: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Driver Name
              <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.driverName} onChange={(e) => setState((p) => ({ ...p, driverName: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Date/Time
              <input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.dateTime} onChange={(e) => setState((p) => ({ ...p, dateTime: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Location
              <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.location} onChange={(e) => setState((p) => ({ ...p, location: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Compliance Result
              <select className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.compliant} onChange={(e) => setState((p) => ({ ...p, compliant: e.target.value as LimiterState["compliant"] }))}>
                <option value="">Select</option>
                <option value="Compliant">Compliant</option>
                <option value="Not Compliant">Not Compliant</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Authorised Repairer/Dealership
              <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.authorisedRepairer} onChange={(e) => setState((p) => ({ ...p, authorisedRepairer: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Scheduled Repair Date
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.scheduledRepairDate} onChange={(e) => setState((p) => ({ ...p, scheduledRepairDate: e.target.value }))} />
            </label>
            <label className="block text-sm font-semibold text-slate-200">
              Repair Date
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={state.repairDate} onChange={(e) => setState((p) => ({ ...p, repairDate: e.target.value }))} />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-200">
            Calibration/Repair Details
            <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={state.calibrationRepairDetails} onChange={(e) => setState((p) => ({ ...p, calibrationRepairDetails: e.target.value }))} />
          </label>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Supporting Document</label>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
            {uploading && <span className="ml-2 text-xs text-slate-400">Uploading...</span>}
            {state.documentName && <p className="mt-1 text-xs text-emerald-300">{state.documentName}</p>}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              {saving ? "Saving..." : "Save Check"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-full text-sm text-slate-200">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-400">
              <th className="px-3 py-2">Registration</th>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Date/Time</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-slate-400">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-slate-400">No limiter checks recorded.</td></tr>
            ) : rows.map((row) => {
              const p = row.payload || {};
              return (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="px-3 py-2">{String(p.registrationNumber ?? "")}</td>
                  <td className="px-3 py-2">{String(p.driverName ?? "")}</td>
                  <td className="px-3 py-2">{String(p.dateTime ?? "")}</td>
                  <td className="px-3 py-2">{String(p.location ?? "")}</td>
                  <td className="px-3 py-2">{String(p.compliant ?? "")}</td>
                  <td className="px-3 py-2">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}