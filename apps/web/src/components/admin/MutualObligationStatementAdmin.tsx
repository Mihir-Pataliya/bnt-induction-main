import { useEffect, useState } from "react";
import { FileText, Loader2, Save, Send, ShieldCheck, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type RegisterRow = {
  id: string;
  user_id: string;
  business_name: string;
  trading_name: string;
  acn: string | null;
  postal_address: string;
  contact_person: string;
  position: string;
  mobile: string;
  email: string;
  business_activity: string;
  mutual_obligation_status: "Not Issued" | "Pending Signatures" | "Signed by Both Parties";
};

type ApplicationRow = {
  id: string;
  register_id: string;
  user_id: string;
  status: string;
  payload: any;
};

type StatementRow = {
  id: string;
  user_id: string;
  payload: any;
  submitted_at: string | null;
  status: string;
};

const DECLARATIONS = [
  "BNT Logistics (Baba Nanak Transport Pty Ltd) and the Subcontractor acknowledge that each party has a duty under the Heavy Vehicle National Law (HVNL) and Work Health & Safety laws to ensure, so far as is reasonably practicable, the safety of their transport activities.",
  "Both parties agree that safety duties cannot be transferred or contracted out, and that they must cooperate, consult and coordinate activities to control, eliminate or minimise transport risks.",
  "The Subcontractor confirms that it will not request, require or contract BNT Logistics to breach the HVNL, work health and safety laws, or any fatigue, mass, dimension, speed, loading, vehicle standards or licensing requirement.",
  "BNT Logistics confirms that it will not request, require or contract the Subcontractor to breach the HVNL, work health and safety laws, or any fatigue, mass, dimension, speed, loading, vehicle standards or licensing requirement.",
  "Both parties agree to share relevant safety information, including site rules, loading and unloading requirements, access permits, weights, dimensions and timeframes, and to notify each other of hazards, incidents and non-conformances.",
  "Both parties agree to ensure that drivers are fit for duty, appropriately licensed, trained and inducted, and that work and rest hours, scheduling and trip planning comply with legal requirements.",
  "Both parties agree to maintain accurate records (including pre-starts, work diaries, load restraint and maintenance records) and to make them available for audit or investigation on request.",
  "Both parties agree to review performance, address non-conformances and take corrective action, and to communicate any changes that may affect the safe performance of transport activities.",
];
export function MutualObligationStatementAdmin({ session }: { session: SessionState }) {
  const [registers, setRegisters] = useState<RegisterRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewMode, setReviewMode] = useState(false);

  const [acceptedDeclarations, setAcceptedDeclarations] = useState(false);
  const [bntSignerName, setBntSignerName] = useState(session.user.email);
  const [bntSignerPosition, setBntSignerPosition] = useState("Director / Compliance Manager");
  const [bntSignature, setBntSignature] = useState("");
  const [bntDate, setBntDate] = useState(new Date().toISOString().slice(0, 10));
  const [subSignerName, setSubSignerName] = useState("");
  const [subSignerPosition, setSubSignerPosition] = useState("");
  const [subSignature, setSubSignature] = useState("");
  const [subDate, setSubDate] = useState(new Date().toISOString().slice(0, 10));
  const [additionalNotes, setAdditionalNotes] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [regRes, appRes, stmtRes] = await Promise.all([
        supabase.from("third_party_register").select("*").order("updated_at", { ascending: false }),
        supabase.from("third_party_engagement_applications").select("*").order("updated_at", { ascending: false }),
        supabase.from("cor_form_submissions").select("*").eq("form_code", "MOS").order("submitted_at", { ascending: false }),
      ]);
      if (regRes.error) throw regRes.error;
      if (appRes.error) throw appRes.error;
      if (stmtRes.error) throw stmtRes.error;
      setRegisters((regRes.data || []) as RegisterRow[]);
      setApplications((appRes.data || []) as ApplicationRow[]);
      setStatements((stmtRes.data || []) as StatementRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Mutual Obligation Statement data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedRegister = registers.find((r) => r.id === selectedRegisterId) || null;
  const acceptedApplication = applications.find(
    (a) => a.register_id === selectedRegisterId && a.status === "Accepted"
  );
  const existingStatement = statements.find((s) => s.payload?.register_id === selectedRegisterId);

  const businessDetails = acceptedApplication?.payload || selectedRegister || null;

  const resetForm = () => {
    setAcceptedDeclarations(false);
    setBntSignerName(session.user.email);
    setBntSignerPosition("Director / Compliance Manager");
    setBntSignature("");
    setBntDate(new Date().toISOString().slice(0, 10));
    setSubSignature("");
    setSubDate(new Date().toISOString().slice(0, 10));
    setAdditionalNotes("");
    setReviewMode(false);
  };

  useEffect(() => {
    if (selectedRegister) {
      setSubSignerName(selectedRegister.contact_person || "");
      setSubSignerPosition(selectedRegister.position || "");
    }
  }, [selectedRegisterId]);

  const validate = (): string | null => {
    if (!selectedRegisterId) return "Select a registered subcontractor first.";
    if (!acceptedApplication) return "The subcontractor's Engagement Application must be Accepted before a Mutual Obligation Statement can be issued.";
    if (!acceptedDeclarations) return "You must confirm all declarations before signing.";
    if (!subSignerName.trim()) return "Subcontractor printed name is required.";
    if (!subSignerPosition.trim()) return "Subcontractor position is required.";
    if (!subSignature.trim()) return "Subcontractor signature is required.";
    if (!subDate) return "Subcontractor date is required.";
    if (!bntSignerName.trim()) return "BNT signer printed name is required.";
    if (!bntSignerPosition.trim()) return "BNT signer position is required.";
    if (!bntSignature.trim()) return "BNT signature is required.";
    if (!bntDate) return "BNT date is required.";
    if (subSignature.trim().toLowerCase() !== subSignerName.trim().toLowerCase()) {
      return "Subcontractor signature must match the printed name.";
    }
    if (bntSignature.trim().toLowerCase() !== bntSignerName.trim().toLowerCase()) {
      return "BNT signature must match the printed name.";
    }
    return null;
  };
  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      const payload = {
        register_id: selectedRegisterId,
        application_id: acceptedApplication!.id,
        business_name: businessDetails?.business_name || "",
        trading_name: businessDetails?.trading_name || "",
        acn: businessDetails?.acn || null,
        postal_address: businessDetails?.postal_address || "",
        business_activity: businessDetails?.business_activity || "",
        declarations: DECLARATIONS,
        declarations_accepted: acceptedDeclarations,
        subcontractor_signer: {
          name: subSignerName.trim(),
          position: subSignerPosition.trim(),
          signature: subSignature.trim(),
          date: subDate,
          user_id: selectedRegister?.user_id || null,
        },
        bnt_signer: {
          name: bntSignerName.trim(),
          position: bntSignerPosition.trim(),
          signature: bntSignature.trim(),
          date: bntDate,
          user_id: session.user.id,
        },
        additional_notes: additionalNotes.trim(),
        signed_at: now,
        status: "Completed",
      };
      const { error: insErr } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: "MOS",
        form_title: "Mutual Obligation Statement",
        payload,
        status: "Submitted",
        submitted_at: now,
      });
      if (insErr) throw insErr;
      const { error: upErr } = await supabase
        .from("third_party_register")
        .update({ mutual_obligation_status: "Signed by Both Parties", updated_at: now })
        .eq("id", selectedRegisterId);
      if (upErr) throw upErr;
      setSuccess("Mutual Obligation Statement submitted and signed by both parties.");
      await load();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit statement.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading Mutual Obligation Statement...</p>;
  }
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Mutual Obligation Statement
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Issue and record a Mutual Obligation Statement for an accepted subcontractor.
          </p>
        </div>
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

      <div className="flex flex-wrap gap-3">
        <select
          value={selectedRegisterId}
          onChange={(e) => {
            setSelectedRegisterId(e.target.value);
            setSuccess("");
            setError("");
            resetForm();
          }}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="">Select registered subcontractor...</option>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>{r.business_name}</option>
          ))}
        </select>
      </div>

      {!selectedRegisterId && (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          Select a registered subcontractor to view or create a Mutual Obligation Statement.
        </p>
      )}

      {selectedRegisterId && !acceptedApplication && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The subcontractor's Engagement Application must be Accepted before a Mutual Obligation Statement can be issued.
          Current application status: {applications.find((a) => a.register_id === selectedRegisterId)?.status || "Not Started"}.
        </div>
      )}
      {selectedRegisterId && acceptedApplication && (
        <div className="space-y-6">
          {existingStatement && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Completed statement found (submitted {existingStatement.submitted_at ? new Date(existingStatement.submitted_at).toLocaleString() : "—"}).
              </div>
              <p className="mt-1 text-xs text-emerald-100/80">
                Subcontractor: {existingStatement.payload?.subcontractor_signer?.name} ({existingStatement.payload?.subcontractor_signer?.date}) |
                BNT: {existingStatement.payload?.bnt_signer?.name} ({existingStatement.payload?.bnt_signer?.date})
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-3">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Business details (from accepted application)</h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm text-slate-200">
              <div><span className="text-slate-400">Business name:</span> {businessDetails?.business_name || "—"}</div>
              <div><span className="text-slate-400">Trading name:</span> {businessDetails?.trading_name || "—"}</div>
              <div><span className="text-slate-400">ACN:</span> {businessDetails?.acn || "—"}</div>
              <div><span className="text-slate-400">Postal address:</span> {businessDetails?.postal_address || "—"}</div>
              <div><span className="text-slate-400">Business activity:</span> {businessDetails?.business_activity || "—"}</div>
              <div><span className="text-slate-400">Contact person:</span> {businessDetails?.contact_person || selectedRegister?.contact_person || "—"}</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Mutual Obligation Statement</h4>
            <p className="text-sm text-slate-300">
              The following mutual obligations apply to both BNT Logistics and the Subcontractor in relation to Chain of Responsibility and work health and safety for heavy vehicle transport activities.
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-200">
              {DECLARATIONS.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
            <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={acceptedDeclarations}
                onChange={(e) => setAcceptedDeclarations(e.target.checked)}
              />
              I confirm that both parties have read and accept the mutual obligations listed above.
            </label>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Subcontractor representative</h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-200">
                Printed name *
                <input value={subSignerName} onChange={(e) => setSubSignerName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Position *
                <input value={subSignerPosition} onChange={(e) => setSubSignerPosition(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Signature (type full name) *
                <input value={subSignature} onChange={(e) => setSubSignature(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Date *
                <input type="date" value={subDate} onChange={(e) => setSubDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">BNT Logistics representative</h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-200">
                Printed name *
                <input value={bntSignerName} onChange={(e) => setBntSignerName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Position *
                <input value={bntSignerPosition} onChange={(e) => setBntSignerPosition(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Signature (type full name) *
                <input value={bntSignature} onChange={(e) => setBntSignature(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Date *
                <input type="date" value={bntDate} onChange={(e) => setBntDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
            </div>
            <label className="text-xs font-medium text-slate-200">
              Additional notes
              <textarea value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" rows={2} />
            </label>
          </div>

          {!reviewMode ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const v = validate();
                  if (v) { setError(v); return; }
                  setError("");
                  setReviewMode(true);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Review Statement
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-5 space-y-3">
              <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Review before signing</h4>
              <p className="text-sm text-slate-200">
                Please review the complete statement above. By submitting, both parties confirm the mutual obligations and signatures recorded.
              </p>
              <div className="text-sm text-slate-300 space-y-1">
                <div>Subcontractor: {subSignerName} — {subSignerPosition} (signed {subDate})</div>
                <div>BNT Logistics: {bntSignerName} — {bntSignerPosition} (signed {bntDate})</div>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setReviewMode(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                  Back to edit
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Sign & Submit
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
