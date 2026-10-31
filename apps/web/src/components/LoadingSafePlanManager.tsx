import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { SessionState } from "../types";

const FORM_CODE = "LURC_SAFE_LOADING_PLAN";
type LocationDetails = {
  siteName: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  gps: string;
};

type Plan = {
  driverId: string;
  driverName: string;
  loadReference: string;
  loadDescription: string;
  cargoWeight: string;
  cargoDimensions: string;
  origin: string;
  destination: string;
  vehicle: string;
  restraintMethod: string;
  inspectionChecks: string;
  loadingInstructions: string;
  risksControls: string;
  loadingLocation: LocationDetails;
  unloadingLocation: LocationDetails;
  driverAcknowledgement: boolean;
  acknowledgedAt: string;
  date: string;
};

const emptyLocation = (): LocationDetails => ({
  siteName: "",
  address: "",
  city: "",
  state: "",
  postcode: "",
  gps: ""
});

const emptyPlan = (driverId = "", driverName = ""): Plan => ({
  driverId,
  driverName,
  loadReference: "",
  loadDescription: "",
  cargoWeight: "",
  cargoDimensions: "",
  origin: "",
  destination: "",
  vehicle: "",
  restraintMethod: "",
  inspectionChecks: "",
  loadingInstructions: "",
  risksControls: "",
  loadingLocation: emptyLocation(),
  unloadingLocation: emptyLocation(),
  driverAcknowledgement: false,
  acknowledgedAt: "",
  date: new Date().toISOString().slice(0, 10)
});

export function LoadingSafePlanManager({ session, mode }: { session: SessionState; mode: "admin" | "driver" }) {
  const isAdmin = mode === "admin";
  const [rows, setRows] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [plan, setPlan] = useState<Plan>(emptyPlan(session.user.id));
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [reviewNotes, setReviewNotes] = useState("");
  const [responseChecks, setResponseChecks] = useState<Array<{ item: string; status: string; comment: string }>>([]);
  const [responseEvidence, setResponseEvidence] = useState<string[]>([]);
  const [issueType, setIssueType] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [driverNotes, setDriverNotes] = useState("");
  const [responseMessage, setResponseMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    let query = supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
    if (!isAdmin) query = query.eq("user_id", session.user.id);
    const { data, error } = await query;
    if (error) { setMessage(error.message); return; }
    setRows(data || []);
  }, [isAdmin, session.user.id]);
  useEffect(() => { void load(); if (isAdmin) void supabase.from("profiles").select("id, full_name, email").eq("role", "driver").then(({ data }) => setDrivers(data || [])); }, [load, isAdmin]);
  useEffect(() => {
    if (!viewing || isAdmin) return;
    const payload = viewing.payload || {};
    const checks = String(payload.inspectionChecks || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((item) => {
        const existing = (payload.safetyChecks || []).find((check: any) => check.item === item);
        return { item, status: existing?.status || "Not Completed", comment: existing?.comment || "" };
      });
    setResponseChecks(checks);
    setResponseEvidence(Array.isArray(payload.evidenceUrls) ? payload.evidenceUrls : []);
    setIssueType(payload.issueReport?.type || "");
    setIssueDescription(payload.issueReport?.description || "");
    setDriverNotes(payload.driverNotes || "");
    setResponseMessage("");
  }, [viewing, isAdmin]);
  const updateDriverResponse = async (status?: string) => {
    if (!viewing) return;
    setResponseMessage("");
    try {
      const existingPayload = viewing.payload || {};
      const newPayload = {
        ...existingPayload,
        driverAcknowledgement: responseChecks.length ? true : existingPayload.driverAcknowledgement,
        acknowledgedAt: responseChecks.length ? new Date().toISOString() : existingPayload.acknowledgedAt,
        safetyChecks: responseChecks,
        evidenceUrls: responseEvidence,
        issueReport: issueDescription.trim() ? { type: issueType, description: issueDescription, reportedAt: new Date().toISOString() } : existingPayload.issueReport,
        driverNotes,
        driverSubmittedAt: status === "Submitted" ? new Date().toISOString() : existingPayload.driverSubmittedAt
      };
      const { error } = await supabase
        .from("cor_form_submissions")
        .update({ payload: newPayload, status: status || viewing.status })
        .eq("id", viewing.id);
      if (error) throw error;
      setResponseMessage(status === "Submitted" ? "Plan submitted for Admin review." : "Progress saved.");
      await load();
      const updated = (await supabase.from("cor_form_submissions").select("*").eq("id", viewing.id).maybeSingle()).data;
      if (updated) setViewing(updated);
    } catch (error: any) {
      setResponseMessage(error?.message || "Unable to save plan response.");
    }
  };

  const uploadEvidence = async (file: File) => {
    if (!viewing) return;
    setUploading(true);
    setResponseMessage("");
    try {
      const path = `${session.user.id}/safe-loading-plan/${viewing.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("driver-documents").upload(path, file, { upsert: false });
      if (error) throw error;
      setResponseEvidence((prev) => [...prev, path]);
      setResponseMessage("Photo uploaded.");
    } catch (error: any) {
      setResponseMessage(error?.message || "Unable to upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const acknowledgePlan = async () => {
    if (!viewing) return;
    try {
      const existingPayload = viewing.payload || {};
      const { error } = await supabase
        .from("cor_form_submissions")
        .update({ payload: { ...existingPayload, driverAcknowledgement: true, acknowledgedAt: new Date().toISOString() }, status: "Acknowledged" })
        .eq("id", viewing.id);
      if (error) throw error;
      setResponseMessage("Plan acknowledged.");
      await load();
      const updated = (await supabase.from("cor_form_submissions").select("*").eq("id", viewing.id).maybeSingle()).data;
      if (updated) setViewing(updated);
    } catch (error: any) {
      setResponseMessage(error?.message || "Unable to acknowledge plan.");
    }
  };

  const save = async (status: string) => {
    const selectedDriver = drivers.find((driver) => driver.id === plan.driverId);
    const payload = {
      ...plan,
      driverName: selectedDriver?.full_name || selectedDriver?.email || plan.driverName
    };
    if (isAdmin && !plan.driverId && !editingId) {
      setMessage("Select a driver before publishing or saving this plan.");
      return;
    }
    const targetUserId = (isAdmin ? plan.driverId : session.user.id) || session.user.id;
    if (editingId) {
      const { error } = await supabase
        .from("cor_form_submissions")
        .update({ payload, status })
        .eq("id", editingId);
      if (error) { setMessage(error.message); return; }
    } else {
      const { error } = await supabase.from("cor_form_submissions").insert({
        user_id: targetUserId,
        form_code: FORM_CODE,
        form_title: "Safe Loading Plan",
        payload,
        status
      });
      if (error) { setMessage(error.message); return; }
    }
    setMessage(status === "Submitted" || status === "Assigned" ? "Safe Loading Plan submitted." : "Safe Loading Plan saved as draft.");
    setEditing(false);
    setEditingId(null);
    setPlan(emptyPlan(isAdmin ? "" : session.user.id));
    await load();
  };
  return <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-white">Safe Loading Plan</h3><p className="text-sm text-slate-400">Record load details, restraints and safety controls.</p></div>{isAdmin && !editing && !viewing && <button type="button" onClick={() => { setEditingId(null); setPlan(emptyPlan("")); setEditing(true); }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">New plan</button>}</div>
    {editing ? <div className="grid gap-3 md:grid-cols-2">
      {isAdmin && <select value={plan.driverId} onChange={(e) => setPlan({ ...plan, driverId: e.target.value })} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white md:col-span-2"><option value="">Select driver</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email}</option>)}</select>}
      {isAdmin && <>
        <label className="text-sm font-semibold text-slate-200">Load reference<input value={plan.loadReference} onChange={(e) => setPlan({ ...plan, loadReference: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm font-semibold text-slate-200">Cargo weight<input value={plan.cargoWeight} onChange={(e) => setPlan({ ...plan, cargoWeight: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm font-semibold text-slate-200">Cargo dimensions<input value={plan.cargoDimensions} onChange={(e) => setPlan({ ...plan, cargoDimensions: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
        <label className="text-sm font-semibold text-slate-200 md:col-span-2">Loading instructions<textarea value={plan.loadingInstructions} onChange={(e) => setPlan({ ...plan, loadingInstructions: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
      </>}
      {([ ["loadDescription", "Load description"], ["origin", "Loading origin"], ["destination", "Destination"], ["vehicle", "Vehicle / combination"], ["restraintMethod", "Restraint method"], ["inspectionChecks", "Pre-departure inspection checks"] ] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold text-slate-200">{label}<input value={plan[key]} onChange={(e) => setPlan({ ...plan, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>)}
{isAdmin && <>
        <div className="md:col-span-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-3">
          <h4 className="text-sm font-bold text-white">Loading Location</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-200">Site / company name<input value={plan.loadingLocation.siteName} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, siteName: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">Street address<input value={plan.loadingLocation.address} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, address: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">City<input value={plan.loadingLocation.city} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, city: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">State<input value={plan.loadingLocation.state} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, state: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">Postcode<input value={plan.loadingLocation.postcode} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, postcode: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">GPS coordinates<input value={plan.loadingLocation.gps} onChange={(e) => setPlan({ ...plan, loadingLocation: { ...plan.loadingLocation, gps: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
          </div>
        </div>
        <div className="md:col-span-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-3">
          <h4 className="text-sm font-bold text-white">Unloading Location</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-200">Site / company name<input value={plan.unloadingLocation.siteName} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, siteName: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">Street address<input value={plan.unloadingLocation.address} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, address: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">City<input value={plan.unloadingLocation.city} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, city: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">State<input value={plan.unloadingLocation.state} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, state: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">Postcode<input value={plan.unloadingLocation.postcode} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, postcode: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-sm font-semibold text-slate-200">GPS coordinates<input value={plan.unloadingLocation.gps} onChange={(e) => setPlan({ ...plan, unloadingLocation: { ...plan.unloadingLocation, gps: e.target.value } })} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
          </div>
        </div>
      </>}
      <label className="text-sm font-semibold text-slate-200 md:col-span-2">Risks and controls<textarea value={plan.risksControls} onChange={(e) => setPlan({ ...plan, risksControls: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" /></label>
      {!isAdmin && <label className="flex items-center gap-2 text-sm text-slate-200 md:col-span-2"><input type="checkbox" checked={plan.driverAcknowledgement} onChange={(e) => setPlan({ ...plan, driverAcknowledgement: e.target.checked })} /> I acknowledge the loading arrangement and restraints.</label>}
      <div className="flex gap-2 md:col-span-2"><button type="button" onClick={() => save("Draft")} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-white">Save draft</button><button type="button" onClick={() => save(isAdmin ? "Assigned" : "Submitted")} disabled={!plan.loadDescription || (isAdmin && !plan.driverId) || (!isAdmin && !plan.driverAcknowledgement)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isAdmin ? "Publish and assign" : "Submit"}</button><button type="button" onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-sm text-slate-300">Cancel</button></div>
    </div> : <div className="overflow-x-auto"><table className="min-w-full text-sm text-slate-200"><thead><tr className="text-left text-slate-400"><th className="px-3 py-2">Load</th><th className="px-3 py-2">Origin</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Loading Location</th><th className="px-3 py-2">Unloading Location</th><th className="px-3 py-2">Assigned Driver</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead><tbody>{rows.map((row) => {
            const payload = row.payload || {};
            const loadingLocation = payload.loadingLocation || {};
            const unloadingLocation = payload.unloadingLocation || {};
            return (
              <tr key={row.id} className="border-t border-slate-700">
                <td className="px-3 py-2">{payload.loadReference || payload.loadDescription || "-"}</td>
                <td className="px-3 py-2">{payload.origin || "-"}</td>
                <td className="px-3 py-2">{payload.destination || "-"}</td>
                <td className="px-3 py-2">{loadingLocation.siteName || loadingLocation.city || "-"}</td>
                <td className="px-3 py-2">{unloadingLocation.siteName || unloadingLocation.city || "-"}</td>
                <td className="px-3 py-2">{payload.driverName || "-"}</td>
                <td className="px-3 py-2">{payload.vehicle || "-"}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setViewing(row)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200">View Details</button>
                    {isAdmin && row.status === "Draft" && <button type="button" onClick={() => { setEditingId(row.id); setPlan({ ...emptyPlan(row.payload?.driverId || ""), ...(row.payload || {}) }); setEditing(true); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Edit</button>}
                  </div>
                </td>
              </tr>
            );
          })}</tbody></table></div>}
{viewing && (
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2 text-sm text-slate-200">
        <div className="flex items-center justify-between"><h4 className="text-base font-bold text-white">Plan Details</h4><button type="button" onClick={() => setViewing(null)} className="text-slate-400 hover:text-white">Close</button></div>
        <p><strong>Load:</strong> {viewing.payload?.loadReference || viewing.payload?.loadDescription || "-"}</p>
        <p><strong>Origin:</strong> {viewing.payload?.origin || "-"}</p>
        <p><strong>Destination:</strong> {viewing.payload?.destination || "-"}</p>
        <p><strong>Loading Location:</strong> {viewing.payload?.loadingLocation?.siteName || "-"} {viewing.payload?.loadingLocation?.address ? `· ${viewing.payload.loadingLocation.address}` : ""}</p>
        <p><strong>Unloading Location:</strong> {viewing.payload?.unloadingLocation?.siteName || "-"} {viewing.payload?.unloadingLocation?.address ? `· ${viewing.payload.unloadingLocation.address}` : ""}</p>
        <p><strong>Assigned Driver:</strong> {viewing.payload?.driverName || "-"}</p>
        <p><strong>Vehicle:</strong> {viewing.payload?.vehicle || "-"}</p>
        <p><strong>Status:</strong> {viewing.status}</p>
        {!isAdmin && (
          <div className="space-y-4 border-t border-slate-700 pt-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={acknowledgePlan} disabled={viewing.status === "Acknowledged" || viewing.status === "Submitted" || viewing.status === "Under Review" || viewing.status === "Resolved" || viewing.status === "Completed"} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Acknowledge Plan</button>
            </div>
            {responseChecks.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-bold text-white">Driver Safety Checklist</h5>
                {responseChecks.map((check, index) => (
                  <div key={`${check.item}-${index}`} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-2">
                    <p className="text-slate-100">{check.item}</p>
                    <select value={check.status} onChange={(e) => setResponseChecks((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, status: e.target.value } : item))} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white">
                      <option>Completed</option>
                      <option>Not Completed</option>
                      <option>Issue Found</option>
                    </select>
                    <textarea value={check.comment} onChange={(e) => setResponseChecks((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, comment: e.target.value } : item))} placeholder="Comments" className="min-h-16 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <h5 className="font-bold text-white">Photo Evidence</h5>
              <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadEvidence(file); e.target.value = ""; }} className="text-sm text-slate-200" disabled={uploading} />
              {uploading && <p className="text-sm text-slate-400">Uploading...</p>}
              {responseEvidence.length > 0 && <ul className="list-disc pl-5 text-slate-300">{responseEvidence.map((path) => <li key={path}>{path}</li>)}</ul>}
            </div>
            <div className="space-y-2">
              <h5 className="font-bold text-white">Report an Issue</h5>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white">
                <option value="">Select issue type</option>
                <option>Damaged restraint equipment</option>
                <option>Unsafe cargo arrangement</option>
                <option>Incorrect cargo information</option>
                <option>Other loading or unloading safety issue</option>
              </select>
              <textarea value={issueDescription} onChange={(e) => setIssueDescription(e.target.value)} placeholder="Describe the issue" className="min-h-20 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
            </div>
            <label className="block space-y-1">
              <span className="font-medium text-slate-200">Driver notes</span>
              <textarea value={driverNotes} onChange={(e) => setDriverNotes(e.target.value)} className="min-h-20 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => updateDriverResponse()} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-white">Save Progress</button>
              <button type="button" onClick={() => updateDriverResponse("Submitted")} disabled={viewing.status === "Submitted" || viewing.status === "Under Review" || viewing.status === "Resolved" || viewing.status === "Completed"} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit Confirmation</button>
            </div>
            {responseMessage && <p className="text-sm text-slate-300">{responseMessage}</p>}
          </div>
        )}
      </div>
    )}
    {message && <p className="text-sm text-slate-300">{message}</p>}
  </div>;
}
