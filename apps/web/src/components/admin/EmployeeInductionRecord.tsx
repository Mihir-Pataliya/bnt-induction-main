import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, Users } from "lucide-react";
import { api } from "../../lib/api";
import type {
  EmployeeInductionRecord as EmployeeInductionRecordData,
  InductionChecklistItem,
  InductionDocumentItem,
  InductionWorkerSummary,
  NewEmployeeInductionRecord,
  SessionState
} from "../../types";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30";
const labelClass = "block text-sm font-semibold text-slate-200";

const initialChecklist = [
  "Review Chain of Responsibility roles and responsibilities",
  "Review relevant company policies and procedures",
  "Explain incident reporting and escalation requirements",
  "Complete role-specific induction and training"
];

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toDateTime(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function newChecklist(): InductionChecklistItem[] {
  return initialChecklist.map((label, index) => ({
    id: `checklist-${index + 1}`,
    label,
    answered: false,
    status: "n_a",
    notes: ""
  }));
}

function createDraft(worker: InductionWorkerSummary): NewEmployeeInductionRecord {
  return {
    worker_id: worker.id,
    employment_type: worker.employmentType ?? "employee",
    staff_role: worker.staffRole ?? "driver",
    contractor_company_id: null,
    role: worker.role ?? "",
    checklist: newChecklist(),
    documents: [],
    acknowledgements: [],
    signatures: [],
    status: "draft",
    induction_start_date: new Date().toISOString(),
    induction_completed_date: null
  };
}

function fromRecord(record: EmployeeInductionRecordData): NewEmployeeInductionRecord {
  return {
    worker_id: record.worker_id,
    employment_type: record.employment_type,
    staff_role: record.staff_role,
    contractor_company_id: record.contractor_company_id,
    role: record.role,
    checklist: record.checklist ?? [],
    documents: record.documents ?? [],
    acknowledgements: record.acknowledgements ?? [],
    signatures: record.signatures ?? [],
    status: record.status,
    induction_start_date: record.induction_start_date,
    induction_completed_date: record.induction_completed_date
  };
}

export function EmployeeInductionRecord({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [workers, setWorkers] = useState<InductionWorkerSummary[]>([]);
  const [records, setRecords] = useState<EmployeeInductionRecordData[]>([]);
  const [draft, setDraft] = useState<NewEmployeeInductionRecord | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.all([api.getInductionWorkers(session), api.getInductionRecords(session)])
      .then(([workerRows, recordRows]) => {
        if (!active) return;
        setWorkers(workerRows);
        setRecords(recordRows);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load induction records.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === draft?.worker_id),
    [workers, draft?.worker_id]
  );
  const driverAcknowledgement = draft?.acknowledgements?.find((item) =>
    item.source === "driver" && item.submittedBy === draft.worker_id
  );
  const driverSignature = draft?.signatures?.find((item) =>
    item.source === "driver" && item.signerId === draft.worker_id
  );
  const selectedRecord = records.find((record) => record.id === editingId);
  const legalSignoff = selectedRecord?.legal_signoff;
  const driverSubmissionComplete = Boolean(legalSignoff || (driverAcknowledgement && driverSignature));

  function startNew(worker: InductionWorkerSummary) {
    setEditingId(null);
    setDraft(createDraft(worker));
    setError("");
    setMessage("");
  }

  function editRecord(record: EmployeeInductionRecordData) {
    setEditingId(record.id);
    setDraft(fromRecord(record));
    setError("");
    setMessage("");
  }

  function updateDraft(update: Partial<NewEmployeeInductionRecord>) {
    setDraft((current) => current ? { ...current, ...update } : current);
    setError("");
    setMessage("");
  }

  async function saveRecord() {
    if (!draft) return;
    if (!draft.worker_id) {
      setError("Select a worker before saving the induction record.");
      return;
    }
    const payload = {
      ...draft,
      induction_start_date: draft.induction_start_date
        ? new Date(draft.induction_start_date).toISOString()
        : null,
      induction_completed_date: draft.status === "completed"
        ? (draft.induction_completed_date || new Date().toISOString())
        : null
    };

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = editingId
        ? await api.updateInductionRecord(session, editingId, payload)
        : await api.createInductionRecord(session, payload);
      setRecords((current) => [saved, ...current.filter((record) => record.id !== saved.id)]);
      setEditingId(saved.id);
      setDraft(fromRecord(saved));
      setMessage("Induction record saved successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The induction record could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord() {
    if (!editingId || !window.confirm("Delete this induction record? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteInductionRecord(session, editingId);
      setRecords((current) => current.filter((record) => record.id !== editingId));
      setEditingId(null);
      setDraft(null);
      setMessage("Induction record deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The induction record could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  function updateChecklist(index: number, update: Partial<InductionChecklistItem>) {
    updateDraft({
      checklist: (draft?.checklist ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item)
    });
  }

  function updateDocument(index: number, update: Partial<InductionDocumentItem>) {
    updateDraft({
      documents: (draft?.documents ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item)
    });
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Inductions and Training
      </button>

      <header>
        <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
          <Users className="h-4 w-4" aria-hidden="true" />
          COR / Inductions &amp; Training
        </p>
        <h2 className="text-2xl font-black">Employee/Contractor Induction Record</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
          Record induction checklist progress, required documents, acknowledgements, and signatures for each worker.
        </p>
      </header>

      {loadError && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-md border border-rose-300/40 px-3 py-2 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}
      {error && <p className="mt-5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">{error}</p>}
      {message && <p className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200" role="status">{message}</p>}
      {loading && <p className="mt-5 text-sm text-slate-300" role="status">Loading workers and induction records…</p>}

      {!loading && !loadError && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]">
          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <label className={labelClass} htmlFor="induction-worker">Select worker</label>
              <select
                id="induction-worker"
                className={inputClass}
                value={draft?.worker_id ?? ""}
                onChange={(event) => {
                  const worker = workers.find((item) => item.id === event.target.value);
                  if (worker) startNew(worker);
                  else { setDraft(null); setEditingId(null); }
                }}
              >
                <option value="">Choose an employee or contractor</option>
                {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName}</option>)}
              </select>
              {workers.length === 0 && <p className="mt-2 text-sm text-slate-400">No workers are available.</p>}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-100">Saved records</h3>
                {selectedWorker && (
                  <button type="button" onClick={() => startNew(selectedWorker)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {records.filter((record) => !draft || record.worker_id === draft.worker_id).map((record) => {
                  const worker = workers.find((item) => item.id === record.worker_id);
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => editRecord(record)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${editingId === record.id ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-700 bg-slate-900/60 hover:border-slate-500"}`}
                    >
                      <span className="block truncate text-sm font-semibold">{worker?.fullName ?? "Worker record"}</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {record.status === "completed" ? "Completed" : "Draft"} · Updated {new Date(record.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  );
                })}
                {records.filter((record) => !draft || record.worker_id === draft.worker_id).length === 0 && (
                  <p className="text-sm text-slate-400">{draft ? "No saved records for this worker yet." : "Select a worker to view their records."}</p>
                )}
              </div>
            </div>
          </aside>

          {!draft ? (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
              Select a worker to create or view an induction record.
            </div>
          ) : (
            <div className="space-y-5">
              {selectedWorker && (
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                  <h3 className="font-bold">{selectedWorker.fullName}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {[selectedWorker.email, selectedWorker.phone, selectedWorker.depotLocation].filter(Boolean).join(" · ") || "Worker details not recorded"}
                  </p>
                </div>
              )}

              <section className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <h3 className="font-bold">Induction details</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className={labelClass}>Employment type
                    <select className={inputClass} value={draft.employment_type} onChange={(event) => updateDraft({ employment_type: event.target.value as NewEmployeeInductionRecord["employment_type"] })}>
                      <option value="employee">Employee</option><option value="contractor">Contractor</option>
                    </select>
                  </label>
                  <label className={labelClass}>Staff role
                    <select className={inputClass} value={draft.staff_role} onChange={(event) => updateDraft({ staff_role: event.target.value as NewEmployeeInductionRecord["staff_role"] })}>
                      <option value="driver">Driver</option><option value="warehouse">Warehouse</option><option value="office">Office</option>
                    </select>
                  </label>
                  <label className={labelClass}>Position / other role
                    <input className={inputClass} maxLength={200} value={draft.role ?? ""} onChange={(event) => updateDraft({ role: event.target.value })} />
                  </label>
                  <label className={labelClass}>Induction start date
                    <input className={inputClass} type="date" value={toDateInput(draft.induction_start_date ?? null)} onChange={(event) => updateDraft({ induction_start_date: toDateTime(event.target.value) })} />
                  </label>
                  <label className={labelClass}>Record status
                    <select
                      className={inputClass}
                      value={draft.status ?? "draft"}
                      onChange={(event) => updateDraft({
                        status: event.target.value as NewEmployeeInductionRecord["status"],
                        induction_completed_date: event.target.value === "completed" ? new Date().toISOString() : null
                      })}
                    >
                      <option value="draft">Draft / in progress</option><option value="completed">Completed</option>
                    </select>
                  </label>
                  {draft.status === "completed" && (
                    <label className={labelClass}>Completion date
                      <input className={inputClass} type="date" value={toDateInput(draft.induction_completed_date ?? null)} onChange={(event) => updateDraft({ induction_completed_date: toDateTime(event.target.value) })} />
                    </label>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <h3 className="font-bold">Induction checklist</h3>
                <div className="mt-3 space-y-3">
                  {(draft.checklist ?? []).map((item, index) => (
                    <div key={item.id} className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                      <div>
                        <label className="sr-only" htmlFor={`checklist-label-${item.id}`}>Checklist item</label>
                        <input id={`checklist-label-${item.id}`} className={inputClass} value={item.label} onChange={(event) => updateChecklist(index, { label: event.target.value })} />
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                          <input type="checkbox" checked={item.answered} onChange={(event) => updateChecklist(index, { answered: event.target.checked })} />
                          Reviewed with worker
                        </label>
                        <label className="sr-only" htmlFor={`checklist-notes-${item.id}`}>Checklist notes</label>
                        <input id={`checklist-notes-${item.id}`} className={`${inputClass} mt-2`} placeholder="Notes (optional)" value={item.notes} onChange={(event) => updateChecklist(index, { notes: event.target.value })} />
                      </div>
                      <label className={labelClass}>Outcome
                        <select className={inputClass} value={item.status} onChange={(event) => updateChecklist(index, { status: event.target.value as InductionChecklistItem["status"] })}>
                          <option value="n_a">Not assessed</option><option value="pass">Pass</option><option value="fail">Follow-up required</option>
                        </select>
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateDraft({ checklist: [...(draft.checklist ?? []), { id: `checklist-${Date.now()}`, label: "", answered: false, status: "n_a", notes: "" }] })}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add checklist item
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <h3 className="font-bold">Required documents</h3>
                <div className="mt-3 space-y-3">
                  {(draft.documents ?? []).map((document, index) => (
                    <div key={`${document.documentType}-${index}`} className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-2">
                      <label className={labelClass}>Document name
                        <input className={inputClass} value={document.name} onChange={(event) => updateDocument(index, { name: event.target.value, documentType: event.target.value })} />
                      </label>
                      <label className={labelClass}>Status
                        <select className={inputClass} value={document.status} onChange={(event) => updateDocument(index, { status: event.target.value as InductionDocumentItem["status"] })}>
                          {["not_submitted", "pending", "approved", "rejected", "expired", "missing_expiry", "missing"].map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={document.isMandatory} onChange={(event) => updateDocument(index, { isMandatory: event.target.checked })} />
                        Required
                      </label>
                      <button type="button" onClick={() => updateDraft({ documents: (draft.documents ?? []).filter((_, itemIndex) => itemIndex !== index) })} className="inline-flex items-center gap-2 text-sm font-semibold text-rose-300 hover:text-rose-200">
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove document
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => updateDraft({ documents: [...(draft.documents ?? []), { documentType: "", name: "", category: "induction", isMandatory: true, status: "not_submitted", expiryDate: null, uploadedAt: null, uploadedFileUrl: null, uploadedFileName: null, rejectionReason: null }] })}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add document
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold">Worker sign-off evidence</h3>
                      <p className="mt-1 text-sm text-slate-400">The existing Driver Dashboard Legal Sign-Off is reused; no second signature is required.</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${driverSubmissionComplete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
                      {driverSubmissionComplete ? "Completed" : "Pending"}
                    </span>
                  </div>
                  {legalSignoff && (
                    <div className="mt-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Driver Dashboard Legal Sign-Off</p>
                      {legalSignoff.is_image
                        ? <img src={legalSignoff.signature} alt="Driver's saved legal signature" className="mt-2 max-h-32 max-w-full rounded bg-white p-2" />
                        : <p className="mt-2 break-words text-lg font-semibold text-white">{legalSignoff.signature}</p>}
                      <p className="mt-1 text-xs text-slate-400">
                        Signed {legalSignoff.signed_at ? new Date(legalSignoff.signed_at).toLocaleString() : "date not recorded"}
                      </p>
                    </div>
                  )}
                  {driverAcknowledgement && driverSignature ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Acknowledgement</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{driverAcknowledgement.content}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Submitted {driverAcknowledgement.date ? new Date(driverAcknowledgement.date).toLocaleString() : "date not recorded"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          {driverSignature.signer} · {driverSignature.signerRole}
                        </p>
                        {driverSignature.signature.startsWith("data:image/")
                          ? <img src={driverSignature.signature} alt={`${driverSignature.signer}'s saved signature`} className="mt-2 max-h-32 max-w-full rounded bg-white p-2" />
                          : <p className="mt-2 break-words text-lg font-semibold text-white">{driverSignature.signature}</p>}
                        <p className="mt-1 text-xs text-slate-400">
                          Signed {driverSignature.signedAt ? new Date(driverSignature.signedAt).toLocaleString() : "date not recorded"}
                        </p>
                      </div>
                    </div>
                  ) : !legalSignoff ? (
                    <p className="mt-3 text-sm text-slate-300">Waiting for this worker to review the record and submit their acknowledgement and signature.</p>
                  ) : null}
                </div>

                <h3 className="mt-5 font-bold">Acknowledgement statements</h3>
                <div className="mt-3 space-y-3">
                  {(draft.acknowledgements ?? []).map((acknowledgement, index) => (
                    acknowledgement.source === "driver" ? null :
                    <label key={`ack-${index}`} className={labelClass}>
                      Statement for worker to acknowledge
                      <input className={inputClass} aria-label="Acknowledgement statement" value={acknowledgement.content} onChange={(event) => updateDraft({
                        acknowledgements: (draft.acknowledgements ?? [])
                          .map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item)
                          .filter((item) => item.source !== "driver"),
                        signatures: (draft.signatures ?? []).filter((item) => item.source !== "driver")
                      })} />
                    </label>
                  ))}
                  <button type="button" onClick={() => updateDraft({ acknowledgements: [...(draft.acknowledgements ?? []), { content: "", acknowledged: false, date: null }] })} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add acknowledgement
                  </button>
                  <h3 className="pt-2 font-bold">Trainer signatures</h3>
                  {(draft.signatures ?? []).map((signature, index) => (
                    signature.source === "driver" ? null :
                    <div key={`signature-${index}`} className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3 sm:grid-cols-3">
                      <label className={labelClass}>Signer
                        <input className={inputClass} value={signature.signer} onChange={(event) => updateDraft({ signatures: (draft.signatures ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, signer: event.target.value } : item) })} />
                      </label>
                      <label className={labelClass}>Role
                        <input className={inputClass} value={signature.signerRole} onChange={(event) => updateDraft({ signatures: (draft.signatures ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, signerRole: event.target.value } : item) })} />
                      </label>
                      <label className={labelClass}>Signature (type name)
                        <input className={inputClass} value={signature.signature} onChange={(event) => updateDraft({ signatures: (draft.signatures ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, signature: event.target.value, signedAt: event.target.value ? new Date().toISOString() : null } : item) })} />
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => updateDraft({ signatures: [...(draft.signatures ?? []), { signer: "", signerRole: "", signature: "", signedAt: null }] })} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add signature
                  </button>
                </div>
              </section>

              <div className="flex flex-wrap justify-end gap-3">
                {editingId && (
                  <button type="button" disabled={busy} onClick={() => void deleteRecord()} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-4 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete record
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void saveRecord()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-50">
                  <Save className="h-4 w-4" aria-hidden="true" /> {busy ? "Saving…" : "Save induction record"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
