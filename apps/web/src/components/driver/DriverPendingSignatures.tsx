import { useEffect, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

export function DriverPendingSignatures({ session }: { session: SessionState }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .in("form_code", ["NCR", "WHSI"])
        .filter("payload->>assigned_driver_id", "eq", session.user.id);
      setRecords((data || []).filter((r: any) => !r.payload?.driver_signature));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load pending signatures.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const sign = async (record: any) => {
    const sig = window.prompt("Type your full name to sign:");
    if (!sig) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const updatedPayload = { ...(record.payload || {}), driver_signature: sig, driver_signature_date: now, assignment_status: "Signed" };
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

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading pending signatures...</p>;
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-bold text-white">
        <ClipboardList className="h-5 w-5 text-emerald-400" />
        Pending Signatures
      </h3>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}
      {records.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No pending signatures.</p>
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
              <div className="text-sm text-slate-200">
                <span className="font-semibold">{r.payload?.report_number}</span> — {r.payload?.assigned_driver_name} ({r.form_code})
              </div>
              <button
                type="button"
                onClick={() => void sign(r)}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}