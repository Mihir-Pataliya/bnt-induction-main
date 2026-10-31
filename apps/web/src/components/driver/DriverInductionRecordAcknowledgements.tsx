import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, RotateCw } from "lucide-react";
import { api } from "../../lib/api";
import type { DeclarationRecord, EmployeeInductionRecord, SessionState } from "../../types";
import { SignaturePad } from "../SignaturePad";

const inputClass = "rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function DriverInductionRecordCard({
  record,
  session,
  declaration,
  onSaved
}: {
  record: EmployeeInductionRecord;
  session: SessionState;
  declaration: DeclarationRecord | null;
  onSaved: (record: EmployeeInductionRecord) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [signature, setSignature] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const acknowledgement = record.acknowledgements?.find((item) =>
    item.source === "driver" && item.submittedBy === record.worker_id
  );
  const savedSignature = record.signatures?.find((item) =>
    item.source === "driver" && item.signerId === record.worker_id
  );
  const legalSignoff = record.worker_id === session.user.id && declaration?.accepted && declaration.signature
    ? declaration
    : null;
  const statements = (record.acknowledgements ?? [])
    .filter((item) => item.source !== "driver" && item.content.trim())
    .map((item) => item.content.trim());

  async function submit() {
    if (!confirmed || !hasSignature || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.submitDriverInductionRecordAcknowledgement(session, record.id, {
        workerConfirmed: true,
        signature
      });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your acknowledgement could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">{record.role?.trim() || "Employee/Contractor Induction Record"}</h3>
          <p className="mt-1 text-xs text-slate-400">
            {record.employment_type === "contractor" ? "Contractor" : "Employee"}
            {record.induction_start_date ? ` · Started ${displayDate(record.induction_start_date)}` : ""}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${legalSignoff || (acknowledgement && savedSignature) ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
          {legalSignoff || (acknowledgement && savedSignature)
            ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Completed</>
            : <><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Pending</>}
        </span>
      </div>

      {acknowledgement && savedSignature ? (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Your submitted acknowledgement</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{acknowledgement.content}</p>
          <p className="mt-2 text-xs text-slate-400">Submitted {displayDate(acknowledgement.date)}</p>
          <img src={savedSignature.signature} alt="Your saved signature" className="mt-3 max-h-32 max-w-full rounded bg-white p-2" />
        </div>
      ) : legalSignoff ? (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Your existing Legal Sign-Off is on file</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-100">This signature is linked to your induction record. You do not need to sign again.</p>
          <p className="mt-2 text-xs text-slate-400">Signed {displayDate(legalSignoff.agreedAt)}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {record.checklist.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Induction topics</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-200">
                {record.checklist.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    {item.notes && <span className="ml-2 text-slate-400">— {item.notes}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {record.documents.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Required documents</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-200">
                {record.documents.map((item, index) => (
                  <li key={`${record.id}-document-${index}`}>
                    {item.name} <span className="text-slate-400">({item.status.replace(/_/g, " ")})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Please read before signing</p>
            {statements.length ? (
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-200">
                {statements.map((statement, index) => <li key={`${record.id}-statement-${index}`}>{statement}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-slate-200">
                I confirm that I have read and understood this Employee/Contractor Induction Record.
              </p>
            )}
          </div>
          <label className="flex items-start gap-3 text-sm leading-relaxed text-slate-200">
            <input
              className="mt-1"
              type="checkbox"
              checked={confirmed}
              disabled={saving}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I have read and understood this induction record and its acknowledgement statements.</span>
          </label>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-200">Your signature</p>
            <SignaturePad
              key={record.id}
              onSignatureChange={setSignature}
              onSignatureStateChange={setHasSignature}
            />
          </div>
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          <button
            type="button"
            className={`${inputClass} border-0 bg-emerald-500 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!confirmed || !hasSignature || saving}
            onClick={() => void submit()}
          >
            {saving ? "Submitting…" : "Submit acknowledgement and signature"}
          </button>
        </div>
      )}
    </article>
  );
}

export function DriverInductionRecordAcknowledgements({
  session,
  declaration
}: {
  session: SessionState;
  declaration: DeclarationRecord | null;
}) {
  const [records, setRecords] = useState<EmployeeInductionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.getDriverInductionRecords(session)
      .then((result) => { if (active) setRecords(result); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load your induction records.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Employee/Contractor Induction Record</h2>
          <p className="mt-1 text-sm text-slate-300">Review your assigned induction record. Your existing Legal Sign-Off is reused when available.</p>
        </div>
        <button
          type="button"
          aria-label="Refresh induction records"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>
      {loading && <p role="status" className="text-sm text-slate-300">Loading your induction records…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!loading && !error && records.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-600 p-4 text-sm text-slate-300">
          No induction record has been assigned to your account yet. Please contact your administrator.
        </p>
      )}
      {!loading && !error && records.map((record) => (
        <DriverInductionRecordCard
          key={record.id}
          record={record}
          session={session}
          declaration={declaration}
          onSaved={(saved) => setRecords((current) => current.map((item) => item.id === saved.id ? saved : item))}
        />
      ))}
    </section>
  );
}
