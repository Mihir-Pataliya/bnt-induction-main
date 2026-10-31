import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const FORM_CODE = "VS_MAINTENANCE_PROVIDER";

function statusOf(expiry: string) {
  const d = new Date(expiry); const now = new Date();
  const days = (d.getTime() - now.getTime()) / 86400000;
  if (days < 0) return "Expired";
  if (days <= 30) return "Expiring";
  return "Active";
}

export function MaintenanceProviderAgreement({ session, audience = "admin" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const { data, error: qErr } = await supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e: any) { setError(e?.message ?? "Unable to load agreements."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openNew = () => {
    const start = new Date().toISOString().slice(0,10);
    const expiry = new Date(Date.now() + 365*86400000).toISOString().slice(0,10);
    setDraft({ providerCompany: "", representative: "", position: "", signature: "", date: start, vehicleRegos: "", startDate: start, expiryDate: expiry, filePath: "", fileName: "" });
    setSuccess(""); setError("");
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const path = `maintenance-provider/${session.user.id}/${Date.now()}-${file.name}`;
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
        user_id: session.user.id, form_code: FORM_CODE, form_title: "Maintenance Provider Agreement",
        payload: draft, status: "Submitted"
      });
      if (insErr) throw insErr;
      setSuccess("Agreement saved.");
      setDraft(null); await load();
    } catch (e: any) { setError(e?.message ?? "Unable to save agreement."); }
  };

  const openFile = async (path: string) => {
    const { data } = await supabase.storage.from("driver-documents").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  if (draft) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Maintenance Provider Agreement</h2>
          <button type="button" onClick={() => setDraft(null)} className="text-sm text-slate-300 hover:text-white">Cancel</button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {success && <p className="text-sm text-emerald-300">{success}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-200">Provider company name
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.providerCompany} onChange={(e) => setDraft({ ...draft, providerCompany: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Representative
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.representative} onChange={(e) => setDraft({ ...draft, representative: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Position
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Signature (type name)
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.signature} onChange={(e) => setDraft({ ...draft, signature: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Date
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Vehicle registration numbers (comma separated)
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.vehicleRegos} onChange={(e) => setDraft({ ...draft, vehicleRegos: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Start date
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Expiry date (one year)
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.expiryDate} onChange={(e) => setDraft({ ...draft, expiryDate: e.target.value })} />
          </label>
        </div>
        <label className="block text-sm text-slate-200">Signed agreement
          <input type="file" className="mt-1 w-full text-sm text-slate-300" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
          {uploading && <p className="text-xs text-slate-400">Uploading...</p>}
          {draft.fileName && <p className="text-xs text-emerald-300">{draft.fileName}</p>}
        </label>
        <button type="button" onClick={save} disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          <Save className="h-4 w-4" /> Save agreement
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Maintenance Provider Agreements</h2>
        <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> New agreement
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {loading ? <p className="text-sm text-slate-400">Loading...</p> : rows.length === 0 ? <p className="text-sm text-slate-400">No agreements yet.</p> : (
        <div className="space-y-2">
          {rows.map((r: any) => {
            const p = r.payload || {};
            const st = statusOf(p.expiryDate);
            const cls = st === "Expired" ? "bg-rose-500/10 text-rose-400" : st === "Expiring" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400";
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div>
                  <p className="font-bold">{p.providerCompany}</p>
                  <p className="text-xs text-slate-400">{p.representative} · {p.vehicleRegos} · expires {p.expiryDate}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{st}</span>
                  {p.filePath && <button type="button" onClick={() => openFile(p.filePath)} className="text-xs text-blue-300 hover:text-blue-200">View/Download</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

