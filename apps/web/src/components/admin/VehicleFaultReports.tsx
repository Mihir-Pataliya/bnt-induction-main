import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "VS_FAULT_REPORT";

export function VehicleFaultReports({ session, audience = "driver" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true); setError("");
    try {
      let q = supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
      if (audience === "driver") q = q.eq("user_id", session.user.id);
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e: any) { setError(e?.message ?? "Unable to load fault reports."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openNew = () => {
    setDraft({ vehicleRego: "", faultDescription: "", dateTime: new Date().toISOString().slice(0,16), severity: "Minor", filePath: "", fileName: "" });
    setSuccess(""); setError("");
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const path = `vehicle-faults/${session.user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("driver-documents").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      setDraft((d: any) => ({ ...d, filePath: path, fileName: file.name }));
    } catch (e: any) { setError(e?.message ?? "Upload failed."); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!draft) return;
    setError(""); setSuccess("");
    try {
      const { error: insErr } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id, form_code: FORM_CODE, form_title: "Vehicle Fault Report",
        payload: draft, status: "Submitted"
      });
      if (insErr) throw insErr;
      setSuccess("Fault report submitted.");
      setDraft(null); await load();
    } catch (e: any) { setError(e?.message ?? "Unable to submit report."); }
  };

  const updateStatus = async (row: any, status: string) => {
    try {
      const { error: upErr } = await supabase.from("cor_form_submissions").update({
        status, reviewed_at: new Date().toISOString(), reviewed_by: session.user.id,
        review_notes: reviewNotes[row.id] ?? row.review_notes
      }).eq("id", row.id);
      if (upErr) throw upErr;
      await load();
    } catch (e: any) { setError(e?.message ?? "Unable to update report."); }
  };
  if (draft) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Report Vehicle Fault</h2>
          <button type="button" onClick={() => setDraft(null)} className="text-sm text-slate-300 hover:text-white">Cancel</button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {success && <p className="text-sm text-emerald-300">{success}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-200">Vehicle registration
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.vehicleRego} onChange={(e) => setDraft({ ...draft, vehicleRego: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Date/time
            <input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.dateTime} onChange={(e) => setDraft({ ...draft, dateTime: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Severity
            <select className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
              <option>Minor</option><option>Major</option><option>Critical</option>
            </select>
          </label>
          <label className="text-sm text-slate-200">Evidence
            <input type="file" className="mt-1 w-full text-sm text-slate-300" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
            {uploading && <p className="text-xs text-slate-400">Uploading...</p>}
            {draft.fileName && <p className="text-xs text-emerald-300">{draft.fileName}</p>}
          </label>
        </div>
        <label className="block text-sm text-slate-200">Fault description
          <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={4} value={draft.faultDescription} onChange={(e) => setDraft({ ...draft, faultDescription: e.target.value })} />
        </label>
        <button type="button" onClick={save} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          <Save className="h-4 w-4" /> Submit report
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">{audience === "admin" ? "Vehicle Fault Reports" : "My Vehicle Fault Reports"}</h2>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> New report
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {success && <p className="text-sm text-emerald-300">{success}</p>}
      {loading ? <p className="text-sm text-slate-400">Loading...</p> : rows.length === 0 ? <p className="text-sm text-slate-400">No reports yet.</p> : (
        <div className="space-y-2">
          {rows.map((r: any) => {
            const p = r.payload || {};
            return (
              <div key={r.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">{p.vehicleRego} · {p.severity}</p>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold">{r.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{p.dateTime}</p>
                <p className="mt-2 text-sm text-slate-300">{p.faultDescription}</p>
                {audience === "admin" && (
                  <div className="mt-3 space-y-2">
                    <textarea className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" rows={2} placeholder="Review notes" value={reviewNotes[r.id] ?? r.review_notes ?? ""} onChange={(e) => setReviewNotes({ ...reviewNotes, [r.id]: e.target.value })} />
                    <div className="flex gap-2">
                      {r.status !== "Under Review" && <button type="button" onClick={() => updateStatus(r, "Under Review")} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">Mark Under Review</button>}
                      {r.status !== "Resolved" && <button type="button" onClick={() => updateStatus(r, "Resolved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Close/Resolve</button>}
                    </div>
                  </div>
                )}
                {r.review_notes && <p className="mt-2 text-xs text-slate-400">Review: {r.review_notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

