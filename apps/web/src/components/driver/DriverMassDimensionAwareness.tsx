import { useEffect, useState } from "react";
import { ClipboardCheck, FileText, Loader2, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const CONFIG_CODE = "MDPRESCONFIG";
const ASSIGN_CODE = "MDPRESASSIGN";
const ACK_CODE = "MDACK";

export function DriverMassDimensionAwareness({ session }: { session: SessionState }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [config, setConfig] = useState<any | null>(null);
  const [assignment, setAssignment] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackForm, setAckForm] = useState({ confirmation: false, signature: "" });
  const [savingAck, setSavingAck] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [cfgRes, assignRes, profileRes, ackRes] = await Promise.all([
        supabase.from("cor_form_submissions").select("*").eq("form_code", CONFIG_CODE).order("submitted_at", { ascending: false }).limit(1),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ASSIGN_CODE).order("submitted_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email").eq("id", session.user.id).maybeSingle(),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ACK_CODE).order("submitted_at", { ascending: false })
      ]);
      if (cfgRes.error) throw cfgRes.error;
      if (assignRes.error) throw assignRes.error;
      if (profileRes.error) throw profileRes.error;
      if (ackRes.error) throw ackRes.error;

      setConfig(cfgRes.data?.[0]?.payload || null);
      const mine = (assignRes.data || []).find((r: any) => r.payload?.employee_id === session.user.id);
      setAssignment(mine || null);
      setProfile(profileRes.data || null);

      const myAck = (ackRes.data || []).find((r: any) => r.payload?.employee_name === (profileRes.data?.full_name || profileRes.data?.email));
      if (myAck) {
        setAckForm({ confirmation: !!myAck.payload?.confirmation, signature: myAck.payload?.signature || "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load training data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const status = assignment ? (assignment.payload?.status || "Assigned") : "Not Started";

  const submitAck = async () => {
    if (!ackForm.confirmation) {
      setError("Acknowledgement confirmation is required.");
      return;
    }
    if (!ackForm.signature.trim()) {
      setError("Signature is required.");
      return;
    }
    setSavingAck(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const { error: err } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: ACK_CODE,
        form_title: "Mass and Dimension Awareness Acknowledgement",
        payload: {
          employee_name: profile?.full_name || profile?.email || session.user.id,
          confirmation: ackForm.confirmation,
          signature: ackForm.signature,
          date: now.slice(0, 10),
          status: "Submitted"
        },
        status: "Submitted",
        submitted_at: now
      });
      if (err) throw err;
      setSuccess("Acknowledgement submitted.");
      setAcknowledging(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit acknowledgement.");
    } finally {
      setSavingAck(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading Mass and Dimension awareness training...</p>;
  }
  return (
    <div className="space-y-4">
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

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
        <h3 className="text-lg font-bold text-white">Mass and Dimension Awareness Training</h3>
        <p className="text-sm text-slate-300">
          Status: <span className="font-semibold text-emerald-300">{status}</span>
        </p>

        {config?.resource_url ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-white">{config.title}</p>
            <p className="text-xs text-slate-400">{config.description}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={config.resource_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                <FileText className="h-4 w-4" /> Open Presentation
              </a>
            </div>
            <p className="text-xs text-slate-500">
              Opening the presentation does not mark it as completed. Complete the required assessment/acknowledgement.
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-400">
            The presentation has not been uploaded or configured by Admin yet.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Assessment</h4>
        <p className="text-sm text-slate-300">
          The Mass and Dimension Awareness Assessment is administered by your assessor. Results and acknowledgement status are recorded against your employee record.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Acknowledgement</h4>
        {!acknowledging ? (
          <button
            type="button"
            onClick={() => setAcknowledging(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <ClipboardCheck className="h-4 w-4" /> Submit Acknowledgement
          </button>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={ackForm.confirmation}
                onChange={(e) => setAckForm((p) => ({ ...p, confirmation: e.target.checked }))}
              />
              I acknowledge that I have completed the Mass and Dimension Awareness presentation and assessment requirements.
            </label>
            <label className="block text-xs font-medium text-slate-200">
              Signature *
              <input
                value={ackForm.signature}
                onChange={(e) => setAckForm((p) => ({ ...p, signature: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void submitAck()}
                disabled={savingAck}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {savingAck ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
              </button>
              <button
                type="button"
                onClick={() => setAcknowledging(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}