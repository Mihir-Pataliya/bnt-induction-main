import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Building2, CheckCircle2, FileText, RefreshCw, Search, UserPlus, Plus, Pencil, Power } from "lucide-react";
import { api } from "../../lib/api";
import { getDriverDocumentStatus, REQUIRED_DRIVER_DOCUMENTS } from "../../lib/documentCompliance";
import { assessContractorInsurance, getContractorWorkerProgress } from "../../lib/contractorCompliance";
import { ContractorCompanyRecord, DocumentType, SessionState } from "../../types";
import { validateABN, validateACN } from "../../lib/contractorUtils";
import type { ContractorFinancialDetails } from "../../types";

type Worker = { id: string; name: string; email: string; position: string; startDate: string; profileComplete?: boolean; policiesSigned: number; policiesRequired: number; completionPercentage: number; documents: Array<{ type: DocumentType; status: "pending" | "approved" | "rejected"; expiresAt: string | null }>; vehicles: import("../../types").VehicleRecord[]; vehicleComplianceComplete: boolean };
type ContractorRow = ContractorCompanyRecord & { workers: Worker[] };
type WorkerOption = { id: string; name: string; email: string };
const REQUIRED_DOCUMENTS = REQUIRED_DRIVER_DOCUMENTS.map(({ type, name }) => [type, name] as const);

interface ContractorsAdminProps {
  session: SessionState;
}

export function ContractorsAdmin({ session }: ContractorsAdminProps) {
  const [companies, setCompanies] = useState<ContractorRow[]>([]);
  const [unassigned, setUnassigned] = useState<WorkerOption[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ContractorRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [financialDetails, setFinancialDetails] = useState<ContractorFinancialDetails | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getAdminContractorData();
      setCompanies(result.contractors);
      setUnassigned(result.unassignedWorkers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load contractor onboarding data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const duplicateCompanyIds = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const company of companies) {
      const abn = (company.abn ?? "").replace(/\D/g, "");
      if (abn) groups.set(`abn:${abn}`, [...(groups.get(`abn:${abn}`) ?? []), company.id]);
    }
    return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
  }, [companies]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return companies.filter((company) => !needle || [company.companyName, company.tradingName, company.abn, ...company.workers.flatMap((worker) => [worker.name, worker.email])].join(" ").toLowerCase().includes(needle));
  }, [companies, query]);

  const linkWorker = async (company: ContractorRow) => {
    const workerId = selectedWorker[company.id];
    if (!workerId) return;
    setBusy(`${company.id}:link`);
    try {
      await api.linkContractorDriver(session, workerId, company.companyId || company.id);
      setSelectedWorker((current) => ({ ...current, [company.id]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link this driver.");
    } finally { setBusy(null); }
  };

  const reviewInsurance = async (company: ContractorRow, kind: "public_liability" | "workers_comp" | "contractor_agreement" | "nhvas", action: "approve" | "reject") => {
    const reason = action === "reject" ? window.prompt("Reason for rejection:") : undefined;
    if (action === "reject" && !reason?.trim()) return;
    setBusy(`${company.id}:${kind}`);
    try {
      await api.reviewContractorInsurance(session, company.companyId || company.id, kind, action, reason?.trim());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the insurance review.");
    } finally { setBusy(null); }
  };

  const reviewVehicleDocument = async (vehicleId: string, kind: "rego" | "insurance" | "inspection", action: "approve" | "reject") => {
    const reason = action === "reject" ? window.prompt("Reason for rejection:") : undefined;
    if (action === "reject" && !reason?.trim()) return;
    setBusy(`${vehicleId}:${kind}`);
    try { await api.reviewContractorVehicleDocument(session, vehicleId, kind, action, reason?.trim()); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not review the vehicle document."); }
    finally { setBusy(null); }
  };

  const reviewButtons = (company: ContractorRow, kind: "public_liability" | "workers_comp" | "contractor_agreement" | "nhvas") => {
    const document = kind === "public_liability" ? company.publicLiabilityFileUrl : kind === "workers_comp" ? company.workersCompFileUrl : kind === "contractor_agreement" ? company.agreementFileUrl : company.nhvasFileUrl;
    const expiry = kind === "public_liability" ? company.publicLiabilityExpiry : kind === "workers_comp" ? company.workersCompExpiry : kind === "contractor_agreement" ? company.agreementExpiry : company.nhvasExpiry;
    const status = kind === "public_liability" ? company.publicLiabilityStatus : kind === "workers_comp" ? company.workersCompStatus : kind === "contractor_agreement" ? company.agreementStatus : company.nhvasStatus;
    const rejectionReason = kind === "public_liability" ? company.publicLiabilityRejectionReason : kind === "workers_comp" ? company.workersCompRejectionReason : kind === "contractor_agreement" ? company.agreementRejectionReason : company.nhvasRejectionReason;
    const reviewerId = kind === "public_liability" ? company.publicLiabilityReviewedBy : kind === "workers_comp" ? company.workersCompReviewedBy : kind === "contractor_agreement" ? company.agreementReviewedBy : company.nhvasReviewedBy;
    const reviewedAt = kind === "public_liability" ? company.publicLiabilityReviewedAt : kind === "workers_comp" ? company.workersCompReviewedAt : kind === "contractor_agreement" ? company.agreementReviewedAt : company.nhvasReviewedAt;
    const assessment = assessContractorInsurance(document, expiry, status === "missing" ? undefined : status);
    const statusLabel: Record<typeof assessment.status, string> = {
      missing_information: "Missing Information", expired: "Expired", expiring_soon: "Expiring Soon",
      valid: "Valid", pending: "Pending Review", rejected: "Rejected"
    };
    const statusClass = assessment.status === "valid" ? "bg-emerald-500/15 text-emerald-400" : assessment.status === "expiring_soon" || assessment.status === "pending" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
    const busyKey = `${company.id}:${kind}`;
    return <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {document ? <a href={document} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400"><FileText className="h-3 w-3" />View file</a> : <button type="button" onClick={() => openForm(company)} className="text-xs text-rose-300 underline">Upload missing file</button>}
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>{statusLabel[assessment.status]}</span>
        {document && expiry && (assessment.status === "pending" || assessment.status === "rejected") && <button disabled={busy === busyKey} onClick={() => void reviewInsurance(company, kind, "approve")} className="rounded border border-emerald-500/30 px-2 py-1 text-[10px] text-emerald-400 disabled:opacity-50">Approve</button>}
        {document && (assessment.status === "expired" || assessment.status === "missing_information" || assessment.status === "expiring_soon") && <button onClick={() => openForm(company)} className="text-[10px] text-amber-300 underline">Update renewal</button>}
        {document && <button disabled={busy === busyKey} onClick={() => void reviewInsurance(company, kind, "reject")} className="rounded border border-rose-500/30 px-2 py-1 text-[10px] text-rose-400 disabled:opacity-50">Reject</button>}
      </div>
      <div className={`text-[11px] ${assessment.daysRemaining !== null && assessment.daysRemaining <= 30 ? "text-amber-300" : "text-slate-400"}`}>
        Expiry: {expiry || "not recorded"} Â· {assessment.renewalStatus}
      </div>
      {reviewedAt && <div className="text-[10px] text-slate-500">Reviewed by {reviewerId || "admin"} at {new Date(reviewedAt).toLocaleString()}</div>}
      {rejectionReason && assessment.status === "rejected" && <div className="text-[11px] text-rose-300">Reason: {rejectionReason}</div>}
    </div>;
  };

  const openForm = (company?: ContractorRow) => {
    setFinancialDetails(null);
    setFinancialLoading(Boolean(company));
    if (company) void api.getAdminContractorBusinessDetails(session, company.companyId || company.id).then((details) => setFinancialDetails(details ?? { bankAccountName: "", bankBsb: "", bankAccountNumber: "", gstRegistered: null, gstEffectiveDate: "" })).catch(() => setError("Could not load secure business payment details.")).finally(() => setFinancialLoading(false));
    setEditing(company ?? null);
    setForm(company ? {
      companyName: company.companyName, tradingName: company.tradingName, abn: company.abn, acn: company.acn ?? "", contactPerson: company.contactPerson,
      email: company.email, phone: company.phone, address: company.address, publicLiabilityPolicy: company.publicLiabilityPolicy,
      publicLiabilityExpiry: company.publicLiabilityExpiry, workersCompPolicy: company.workersCompPolicy, workersCompExpiry: company.workersCompExpiry,
      agreementExpiry: company.agreementExpiry ?? "", nhvasAccreditation: company.nhvasAccreditation, nhvasNumber: company.nhvasNumber, nhvasExpiry: company.nhvasExpiry ?? "",
      primaryDepot: company.primaryDepot, status: company.status
    } : { companyName: "", tradingName: "", abn: "", acn: "", contactPerson: "", email: "", phone: "", address: "", publicLiabilityPolicy: "", publicLiabilityExpiry: "", workersCompPolicy: "", workersCompExpiry: "", agreementExpiry: "", nhvasAccreditation: "None", nhvasNumber: "", nhvasExpiry: "", primaryDepot: "", status: "Pending Review" });
  };

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (!validateABN(form.abn ?? "").isValid || !validateACN(form.acn ?? "").isValid) throw new Error("Enter a valid 11 digit ABN and, when supplied, a valid 9 digit ACN.");
      const company = await api.saveAdminContractorCompany(session, editing?.companyId || null, form);
      const companyId = String(company.id);
      if (editing && financialDetails) await api.saveAdminContractorBusinessDetails(session, companyId, financialDetails);
      const companyName = form.companyName;
      for (const [kind, key] of [["public_liability", "publicLiabilityFile"], ["workers_comp", "workersCompFile"], ["nhvas", "nhvasFile"]] as const) {
        const input = document.getElementById(key) as HTMLInputElement | null;
        if (input?.files?.[0]) await api.uploadAdminContractorDocument(session, companyId, kind, input.files[0]);
      }
      const agreementInput = document.getElementById("contractorAgreementFile") as HTMLInputElement | null;
      if (agreementInput?.files?.[0]) await api.uploadAdminContractorDocument(session, companyId, "contractor_agreement", agreementInput.files[0]);
      setEditing(null); await load();
      if (!companyName) setError("Company saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save this company."); }
    finally { setSaving(false); }
  };

  const deactivateCompany = async (company: ContractorRow) => {
    if (!window.confirm(`Deactivate ${company.companyName}? Linked drivers and company history will be retained.`)) return;
    setBusy(`${company.id}:deactivate`);
    try { await api.saveAdminContractorCompany(session, company.companyId || company.id, { companyName: company.companyName, tradingName: company.tradingName, abn: company.abn, acn: company.acn ?? "", contactPerson: company.contactPerson, email: company.email, phone: company.phone, address: company.address, publicLiabilityPolicy: company.publicLiabilityPolicy, publicLiabilityExpiry: company.publicLiabilityExpiry, workersCompPolicy: company.workersCompPolicy, workersCompExpiry: company.workersCompExpiry, primaryDepot: company.primaryDepot, status: "Inactive" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not deactivate company."); }
    finally { setBusy(null); }
  };

  return <div className="glass" style={{ padding: "28px", borderRadius: "20px" }}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="m-0 mb-1 flex items-center gap-2 text-xl font-bold"><Building2 className="h-5 w-5" />Contractor companies & onboarding</h3><p className="muted m-0 text-sm">Review linked workers, insurance, documents, policies, and induction in the existing contractor portal.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => openForm()} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Add company</button><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button></div>
    </div>

    <label className="relative mb-4 block max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, ABN, driver name or email" className="w-full rounded-lg border border-[var(--border)] bg-transparent py-2 pl-9 pr-3 text-sm" /></label>
    {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
    {!loading && unassigned.length > 0 && <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm"><strong className="text-amber-300">Contractor drivers without a company</strong><span className="ml-2 text-slate-400">{unassigned.length} need linking below.</span></div>}

    {loading ? <div className="p-10 text-center text-slate-400">Loading contractor companiesâ€¦</div> : filtered.length === 0 ? <div className="p-10 text-center text-slate-400">{companies.length ? "No companies match this search." : "No contractor companies are registered yet."}</div> : (
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
          <thead className="bg-slate-500/10 text-xs uppercase text-slate-400"><tr>{["Company", "Location", "Linked drivers", "Onboarding", "Insurance", "Actions"].map((title) => <th key={title} className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead>
          <tbody>{filtered.map((company) => {
            const workerStates = company.workers.map((worker) => {
              const progress = getContractorWorkerProgress({
                ...worker,
                businessDetailsComplete: company.businessDetailsComplete,
                companyAgreementComplete: assessContractorInsurance(company.agreementFileUrl, company.agreementExpiry, company.agreementStatus === "missing" ? undefined : company.agreementStatus).valid,
                driver: { documents: worker.documents, completionPercentage: worker.completionPercentage }
              });
              return { worker, ...progress, docCount: progress.approvedDocuments };
            });
            const completedWorkers = workerStates.filter((item) => item.complete).length;
            const aggregateDone = workerStates.reduce((sum, item) => sum + item.done, 0);
            const aggregateTotal = workerStates.reduce((sum, item) => sum + item.total, 0);
            const insuranceAssessments = [
              assessContractorInsurance(company.publicLiabilityFileUrl, company.publicLiabilityExpiry, company.publicLiabilityStatus),
              assessContractorInsurance(company.workersCompFileUrl, company.workersCompExpiry, company.workersCompStatus),
              assessContractorInsurance(company.agreementFileUrl, company.agreementExpiry, company.agreementStatus === "missing" ? "pending" : company.agreementStatus),
              ...(company.nhvasAccreditation !== "None" ? [assessContractorInsurance(company.nhvasFileUrl, company.nhvasExpiry, company.nhvasStatus === "missing" ? undefined : company.nhvasStatus)] : [])
            ];
            const insuranceIssues = insuranceAssessments.filter((assessment) => !assessment.valid).length; const vehicleIssues = workerStates.filter((item) => !item.worker.vehicleComplianceComplete).length; const companyIssues = insuranceIssues + Number(!company.businessDetailsComplete) + vehicleIssues;
            const expiringSoonCount = insuranceAssessments.filter((assessment) => assessment.status === "expiring_soon").length;
            return <tr key={company.id} className="border-t border-[var(--border)] align-top">
              <td className="px-4 py-4"><strong>{company.companyName || "Company name missing"}</strong><div className="text-xs text-slate-400">{company.tradingName}</div><div className="mt-1 text-xs text-slate-400">ABN {company.abn || "not provided"}{company.acn ? ` Â· ACN ${company.acn}` : ""}</div>{duplicateCompanyIds.has(company.id) && <div className="mt-1 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Possible duplicate ABN â€” review records</div>}</td>
              <td className="px-4 py-4">{company.primaryDepot || "â€”"}</td>
              <td className="px-4 py-4"><strong>{company.workers.length}</strong>{workerStates.map(({ worker, docCount, done, total, complete, missingTasks }) => <div key={worker.id} className="mt-2 rounded-lg bg-slate-500/5 p-2"><div className="font-medium">{worker.name}</div><div className="text-xs text-slate-400">{worker.email}{worker.position ? ` Â· ${worker.position}` : ""}</div><div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400"><span>Docs {docCount}/3</span><span>Policies {worker.policiesSigned}/{worker.policiesRequired}</span><span>Training {worker.completionPercentage}%</span><span>Tasks {done}/{total}</span></div><div className="mt-1 flex flex-wrap gap-2 text-[10px]">{REQUIRED_DOCUMENTS.map(([type, label]) => { const doc = worker.documents.find((item) => item.type === type); const status = getDriverDocumentStatus(doc); return <span key={type} className={status === "approved" ? "text-emerald-400" : status === "pending" ? "text-amber-400" : "text-rose-400"}>{label}: {status}</span>; })}</div><div className="mt-1 text-[10px]">{complete ? <span className="text-emerald-400">Onboarding complete</span> : <span className="text-rose-300">Incomplete: {missingTasks.join(", ")}</span>}</div>{worker.vehicles.map((vehicle) => <div key={vehicle.id} className="mt-2 rounded border border-slate-700 p-2 text-[10px]"><strong>{vehicle.rego}</strong>{(["rego", "insurance", "inspection"] as const).map((kind) => { const url = kind === "rego" ? vehicle.regoDocumentUrl : kind === "insurance" ? vehicle.insuranceDocumentUrl : vehicle.inspectionDocumentUrl; const status = kind === "rego" ? vehicle.regoDocumentStatus : kind === "insurance" ? vehicle.insuranceDocumentStatus : vehicle.inspectionDocumentStatus; const reviewedAt = kind === "rego" ? vehicle.regoDocumentReviewedAt : kind === "insurance" ? vehicle.insuranceDocumentReviewedAt : vehicle.inspectionDocumentReviewedAt; const reviewedBy = kind === "rego" ? vehicle.regoDocumentReviewedBy : kind === "insurance" ? vehicle.insuranceDocumentReviewedBy : vehicle.inspectionDocumentReviewedBy; return <div key={kind} className="mt-1 flex flex-wrap items-center gap-2"><span>{kind}: {status ?? "missing"}</span>{reviewedAt && <span className="text-slate-500">Reviewed by {reviewedBy || "admin"} · {new Date(reviewedAt).toLocaleString()}</span>}{url && <a href={url} target="_blank" rel="noreferrer" className="text-blue-300 underline">Preview</a>}{url && (status === "pending" || status === "rejected") && <button disabled={busy === `${vehicle.id}:${kind}`} onClick={() => void reviewVehicleDocument(vehicle.id, kind, "approve")} className="text-emerald-300">Approve</button>}{url && <button disabled={busy === `${vehicle.id}:${kind}`} onClick={() => void reviewVehicleDocument(vehicle.id, kind, "reject")} className="text-rose-300">Reject</button>}</div>; })}</div>)}</div>)}
                {unassigned.length > 0 && <div className="mt-3 flex gap-2"><select aria-label={`Link driver to ${company.companyName}`} value={selectedWorker[company.id] ?? ""} onChange={(e) => setSelectedWorker((current) => ({ ...current, [company.id]: e.target.value }))} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"><option value="">Link contractor driverâ€¦</option>{unassigned.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} ({worker.email})</option>)}</select><button type="button" disabled={!selectedWorker[company.id] || busy === `${company.id}:link`} onClick={() => void linkWorker(company)} aria-label="Link contractor driver" className="rounded border border-[var(--border)] px-2 text-indigo-300 disabled:opacity-40"><UserPlus className="h-4 w-4" /></button></div>}
              </td>
              <td className="px-4 py-4">{workerStates.length ? <><div className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${completedWorkers === workerStates.length ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}><CheckCircle2 className="h-3 w-3" />{completedWorkers}/{workerStates.length} drivers complete</div><div className="mt-2 h-1.5 min-w-28 overflow-hidden rounded bg-slate-700"><div className={`h-full ${completedWorkers === workerStates.length ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${aggregateTotal ? Math.round((aggregateDone / aggregateTotal) * 100) : 0}%` }} /></div><div className="mt-1 text-[10px] text-slate-400">{aggregateDone}/{aggregateTotal} onboarding tasks</div>{workerStates.filter((item) => !item.complete).length > 0 && <div className="mt-1 text-[10px] text-rose-300">{workerStates.filter((item) => !item.complete).map((item) => item.worker.name).join(", ")} need follow-up</div>}</> : <span className="text-xs text-slate-400">No workers linked</span>}</td>
              <td className="px-4 py-4"><div className="mb-3 text-xs">Public liability Â· {reviewButtons(company, "public_liability")}</div><div className="mb-3 text-xs">Workers compensation Â· {reviewButtons(company, "workers_comp")}</div><div className="text-xs">Contractor agreement Â· {reviewButtons(company, "contractor_agreement")}</div>{company.nhvasAccreditation !== "None" && <div className="text-xs">NHVAS evidence · {reviewButtons(company, "nhvas")}</div>}</td>
              <td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${company.status === "Inactive" ? "bg-slate-500/15 text-slate-400" : company.status === "Suspended" ? "bg-rose-500/15 text-rose-400" : companyIssues === 0 && expiringSoonCount === 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>{company.status === "Inactive" || company.status === "Suspended" ? company.status : companyIssues ? `${companyIssues} compliance item${insuranceIssues === 1 ? "" : "s"} need${insuranceIssues === 1 ? "s" : ""} attention` : expiringSoonCount ? `${expiringSoonCount} renewal${expiringSoonCount === 1 ? "" : "s"} due soon` : "Company documents and declarations compliant"}</span>{!company.businessDetailsComplete && <div className="mt-1 text-[10px] text-amber-300">Bank/GST details, declarations, or linked-driver vehicles incomplete</div>}<div className="mt-3 flex gap-2"><button type="button" onClick={() => openForm(company)} title="Edit company" className="rounded border border-[var(--border)] p-2"><Pencil className="h-3.5 w-3.5" /></button>{company.status !== "Inactive" && <button type="button" disabled={busy === `${company.id}:deactivate`} onClick={() => void deactivateCompany(company)} title="Deactivate company" className="rounded border border-rose-500/30 p-2 text-rose-400"><Power className="h-3.5 w-3.5" /></button>}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    )}
    {editing !== null || Object.keys(form).length > 0 ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditing(null); setForm({}); } }}><form onSubmit={saveCompany} className="glass my-6 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="m-0 text-xl font-bold">{editing ? "Edit contractor company" : "Add contractor company"}</h3><p className="muted m-0 mt-1 text-sm">Manage business details, insurance policies, and compliance files.</p></div><button type="button" onClick={() => { setEditing(null); setForm({}); }} className="rounded border border-[var(--border)] px-3 py-2">Close</button></div>{editing && <section className="mb-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"><strong className="text-sm">Confidential bank and tax details (admin only)</strong>{financialLoading ? <p className="mb-0 mt-2 text-xs text-slate-400">Loading secure business details…</p> : financialDetails ? <><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Bank account name<input required minLength={2} maxLength={120} value={financialDetails.bankAccountName} onChange={(event) => setFinancialDetails({ ...financialDetails, bankAccountName: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm" /></label><label className="text-xs font-medium">BSB<input required pattern="\d{3}-?\d{3}" title="Enter six digits, optionally with a hyphen" value={financialDetails.bankBsb} onChange={(event) => setFinancialDetails({ ...financialDetails, bankBsb: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm" /></label><label className="text-xs font-medium">Bank account number<input required pattern="\d{5,10}" title="Enter 5 to 10 digits" value={financialDetails.bankAccountNumber} onChange={(event) => setFinancialDetails({ ...financialDetails, bankAccountNumber: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm" /></label><label className="text-xs font-medium">GST registration<select required value={financialDetails.gstRegistered === null ? "" : String(financialDetails.gstRegistered)} onChange={(event) => setFinancialDetails({ ...financialDetails, gstRegistered: event.target.value === "" ? null : event.target.value === "true", gstEffectiveDate: event.target.value === "false" ? "" : financialDetails.gstEffectiveDate })} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"><option value="">Select registration status</option><option value="true">Registered</option><option value="false">Not registered</option></select></label>{financialDetails.gstRegistered && <label className="text-xs font-medium">GST effective date<input required type="date" value={financialDetails.gstEffectiveDate} onChange={(event) => setFinancialDetails({ ...financialDetails, gstEffectiveDate: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm" /></label>}</div><div className="mt-3 text-[11px] text-slate-400">Declarations saved: business {financialDetails.businessDetailsConfirmedAt ? "yes" : "no"}, tax {financialDetails.taxDeclarationAt ? "yes" : "no"}, insurance {financialDetails.insuranceDeclarationAt ? "yes" : "no"}, vehicles {financialDetails.vehicleDeclarationAt ? "yes" : "no"}</div></> : null}</section>}<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{([["companyName", "Legal name", true], ["tradingName", "Trading name", false], ["abn", "ABN", true], ["acn", "ACN (optional)", false], ["email", "Email", false], ["phone", "Phone", false], ["address", "Business address", false], ["contactPerson", "Contact person", false], ["publicLiabilityPolicy", "Public liability policy number", false], ["publicLiabilityExpiry", "Public liability expiry", false], ["workersCompPolicy", "Workers compensation policy number", false], ["workersCompExpiry", "Workers compensation expiry", false], ["agreementExpiry", "Contractor agreement expiry", false], ["nhvasAccreditation", "NHVAS accreditation", false], ["nhvasNumber", "NHVAS number", false], ["nhvasExpiry", "NHVAS evidence expiry", false]] as const).map(([key, label, required]) => <label key={key} className="text-sm font-medium">{label}<input required={required} type={key.endsWith("Expiry") ? "date" : key === "email" ? "email" : "text"} value={form[key] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" /></label>)}<label className="text-sm font-medium">Business/depot location<input value={form.primaryDepot ?? ""} onChange={(event) => setForm((current) => ({ ...current, primaryDepot: event.target.value }))} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" /></label><label className="text-sm font-medium">Compliance status<select value={form.status ?? "Pending Review"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"><option>Pending Review</option><option>Suspended</option><option>Inactive</option></select></label><label className="text-sm font-medium">Public liability document<input id="publicLiabilityFile" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-xs" />{editing?.publicLiabilityFileUrl && <a className="mt-1 inline-block text-xs text-blue-400" href={editing.publicLiabilityFileUrl} target="_blank" rel="noreferrer">View current file</a>}</label><label className="text-sm font-medium">Workers compensation document<input id="workersCompFile" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-xs" />{editing?.workersCompFileUrl && <a className="mt-1 inline-block text-xs text-blue-400" href={editing.workersCompFileUrl} target="_blank" rel="noreferrer">View current file</a>}</label><label className="text-sm font-medium">Contractor agreement document<input id="contractorAgreementFile" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-xs" />{editing?.agreementFileUrl && <a className="mt-1 inline-block text-xs text-blue-400" href={editing.agreementFileUrl} target="_blank" rel="noreferrer">View current file</a>}</label><label className="text-sm font-medium">NHVAS evidence<input id="nhvasFile" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mt-1 block w-full text-xs" />{editing?.nhvasFileUrl && <a className="mt-1 inline-block text-xs text-blue-400" href={editing.nhvasFileUrl} target="_blank" rel="noreferrer">View current file</a>}</label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setForm({}); }} className="rounded-lg border border-[var(--border)] px-4 py-2">Cancel</button><button disabled={saving || Boolean(editing && (financialLoading || !financialDetails))} className="rounded-lg bg-blue-700 px-5 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Savingâ€¦" : "Save company"}</button></div></form></div>, document.body) : null}
  </div>;
}









