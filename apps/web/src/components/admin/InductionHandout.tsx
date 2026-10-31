import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ClipboardList, Download, FileText, Printer, ShieldAlert, ShieldCheck, X, LayoutGrid, CheckCircle2, Clock, Users, FileCheck, AlertTriangle, Wrench, MapPin, Truck, BookOpen, Layers, CalendarDays } from "lucide-react";
import {
  generalCoRInformation,
  inductionHandoutRoles,
  inductionHandoutSource
} from "./inductionHandoutContent";
import { SessionState, SessionUser, CorFormSubmission } from "../../types";
import { api } from "../../lib/api";
import { CORFormsDriver } from "../driver/CORFormsDriver";
import { CORFormsAdmin } from "./CORFormsAdmin";
import { SafetyIncidentAdmin } from "../SafetyIncidentAdmin";
import { PreTripInspectionAdmin } from "../PreTripInspectionAdmin";
import "./inductionHandout.css";

const pendingApproval =
  "Pending approval — the source manual does not specify this role-specific content.";

interface HandoutApproval {
  status: "approved";
  approvedBy: string;
  approvedByEmail: string;
  approvedAt: string;
}

interface InductionHandoutProps {

  onBack?: () => void;
  role?: string;
  readOnly?: boolean;
  session?: SessionState;
  user?: SessionUser;
  isAdmin?: boolean;
  approverEmail?: string;
  approverId?: string;
  driverName?: string;
  onNavigateTab?: (tab: string) => void;
}

const APPROVAL_STORAGE_KEY = "bnt-induction-handout-approvals";

function loadApprovals(): Record<string, HandoutApproval> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(APPROVAL_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveApprovals(approvals: Record<string, HandoutApproval>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(approvals));
}

function isPendingContent(handout: { description: string | null; responsibilities: unknown[]; formsPending?: boolean } | undefined) {
  if (!handout) return true;
  return handout.description === null || handout.responsibilities.length === 0 || handout.formsPending === true;
}

const DRIVER_FORMS = [
  { code: "F-01", title: "Incident Report", icon: AlertTriangle },
  { code: "F-02", title: "Hazard / Near Miss Report", icon: AlertTriangle },
  { code: "F-03", title: "Vehicle Pre-Start Checklist", icon: Truck },
  { code: "F-04", title: "Defect Report & Rectification", icon: Wrench },
  { code: "F-05", title: "Take 5 / JSA", icon: ShieldCheck },
  { code: "F-08", title: "Driver Induction Checklist", icon: ClipboardList },
  { code: "F-09", title: "Fatigue / Fitness Declaration", icon: Clock },
];

function SummaryCard({ label, value, hint, icon: Icon, accent }: { label: string; value: string | number; hint?: string; icon: any; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

function CollapsibleCard({ id, title, icon: Icon, children, defaultOpen = true, badge }: { id?: string; title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <span className="flex items-center gap-2 text-base font-bold text-white">
          <Icon className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          {title}
          {badge}
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-emerald-300 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div className={`ih-collapsible-content px-5 pb-5 ${open ? "block" : "hidden"}`}>{children}</div>
    </section>
  );
}

export function InductionHandout({ onBack, role, readOnly = false, session, user, isAdmin, approverEmail, approverId, driverName, onNavigateTab }: InductionHandoutProps) {
  const [selectedRole, setSelectedRole] = useState(role ?? "");
  const [approvals, setApprovals] = useState<Record<string, HandoutApproval>>(loadApprovals);
  const [selectedAdminCorForm, setSelectedAdminCorForm] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CorFormSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const handout = inductionHandoutRoles.find((item) => item.name === selectedRole);
  const currentUser = session?.user ?? user;
  const approval = selectedRole ? approvals[selectedRole] : undefined;
  const pendingContent = isPendingContent(handout);
  const isApproved = Boolean(approval) || !pendingContent;
  const canApprove = currentUser?.role === "admin" || isAdmin === true;

  useEffect(() => {
    const handler = () => setApprovals(loadApprovals());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (readOnly || !session) return;
    let active = true;
    setLoadingSubmissions(true);
    api.getCorFormSubmissions()
      .then((rows) => { if (active) setSubmissions(rows); })
      .catch(() => { if (active) setSubmissions([]); })
      .finally(() => { if (active) setLoadingSubmissions(false); });
    return () => { active = false; };
  }, [readOnly, session]);

  const printHandout = () => window.print();

  const approveHandout = () => {
    if (!selectedRole || !canApprove) return;
    const confirmed = window.confirm(`Approve the ${selectedRole} induction handout? This will make it available to drivers as official guidance.`);
    if (!confirmed) return;
    const next = {
      ...approvals,
      [selectedRole]: {
        status: "approved" as const,
        approvedBy: currentUser?.id ?? approverId ?? "admin",
        approvedByEmail: currentUser?.email ?? approverEmail ?? "admin",
        approvedAt: new Date().toISOString()
      }
    };
    setApprovals(next);
    saveApprovals(next);
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const formStats = (code: string) => submissions.filter((item) => item.formCode === code);
  const contentSectionCount = handout
    ? Number(Boolean(handout.description)) + handout.responsibilities.length + Number(handout.forms.length > 0) + Number(handout.resources.length > 0)
    : generalCoRInformation.length + 1;
  const acknowledgementStatus = isApproved ? "Approved" : selectedRole ? "Pending" : "Select role";
  const lastUpdatedValue = approval?.approvedAt ? new Date(approval.approvedAt).toLocaleDateString() : "Source v2.0";

  if (readOnly) {
    return (
      <section className="induction-handout-page induction-handout-print-root rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white">
        {onBack && (
          <div className="ih-noprint">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Inductions and Training
            </button>
          </div>
        )}

        <header className="ih-header">
          <div>
            <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              COR / Inductions &amp; Training
            </p>
            <h2 className="flex items-center gap-2 text-2xl font-black text-white">
              <FileText className="h-6 w-6 text-emerald-400" aria-hidden="true" />
              Induction Handout
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Role responsibilities, Chain of Responsibility duties, forms and supporting documents.
            </p>
          </div>
          <div className="ih-noprint flex flex-wrap gap-2">
            <button
              type="button"
              onClick={printHandout}
              disabled={!handout || !isApproved}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </button>
            <button
              type="button"
              onClick={printHandout}
              disabled={!handout || !isApproved}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export PDF
            </button>
          </div>
        </header>

        {isApproved && (
          <section className="ih-general rounded-xl border border-slate-700 bg-slate-800/50 p-5" aria-labelledby="ih-general-title">
            <h3 id="ih-general-title" className="text-lg font-bold text-white">
              Introduction and general CoR information
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              BNT Logistics is committed to ensuring the health and safety of its workers, subcontractors,
              customers, other road users and the public. Safety will never be compromised to meet a
              delivery time, a customer demand or a commercial outcome.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {generalCoRInformation.map((item) => (
                <section key={item.title} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                  <h4 className="font-bold text-emerald-200">{item.title}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
                </section>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h4 className="font-bold text-emerald-200">Induction before starting work</h4>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                All new workers, subcontract drivers and labour hire workers complete induction before
                starting work. Induction covers this manual and the WHS &amp; CoR Policy; CoR obligations
                and the right to refuse unsafe work; fatigue, speed, drug and alcohol, mass and load
                restraint policies; Gearbox use for pre-start, defects, hazard and incident reporting;
                emergency procedures, PPE and first aid; and site-specific and customer-specific
                requirements.
              </p>
            </div>
          </section>
        )}

        {handout && isApproved && (
          <article className="ih-handout mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-7">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Employee induction handout</p>
            <h3 className="mt-2 text-xl font-bold text-white">{handout.name}</h3>
            <p className="mt-1 text-sm text-slate-400">Source role: {handout.sourceRole}</p>

            <section className="ih-pending-section mt-5 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h4 className="font-bold text-slate-100">Role description</h4>
              <p className={`mt-2 text-sm leading-relaxed ${handout.description ? "text-slate-300" : "text-amber-200"}`}>
                {handout.description ?? pendingApproval}
              </p>
            </section>

            <section className="mt-4">
              <h4 className="mb-3 font-bold text-slate-100">Responsibilities by topic</h4>
              {handout.responsibilities.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {handout.responsibilities.map((topic) => (
                    <section key={topic.title} className="ih-pending-section rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                      <h5 className="font-bold text-emerald-200">{topic.title}</h5>
                      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                        {topic.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-amber-200">
                  {pendingApproval}
                </p>
              )}
            </section>

            <section className="ih-pending-section mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h4 className="font-bold text-slate-100">Forms and records to be completed</h4>
              {handout.forms.length > 0 ? (
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                  {handout.forms.map((form) => <li key={form}>{form}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-amber-200">{pendingApproval}</p>
              )}
              {handout.formsPending && handout.forms.length > 0 && (
                <p className="mt-3 text-sm text-amber-200">{pendingApproval}</p>
              )}
            </section>

            <section className="ih-pending-section mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h4 className="font-bold text-slate-100">Resources and documents to review</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                {handout.resources.map((resource) => <li key={resource}>{resource}</li>)}
              </ul>
            </section>

            <p className="mt-5 border-t border-slate-700 pt-3 text-xs leading-relaxed text-slate-400">
              Source: {inductionHandoutSource}. Where a role-specific section is marked pending approval,
              the source manual does not define that content; confirm it before issuing a role handout.
            </p>
          </article>
        )}

        {handout && readOnly && !isApproved && (
          <section className="ih-handout mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-amber-100">
            <h3 className="text-lg font-bold">Pending Approval</h3>
            <p className="mt-2 text-sm leading-relaxed">
              This handout has not been approved and is not official guidance. Please check back once it has been approved.
            </p>
          </section>
        )}

        {readOnly && session && (
          <div className="ih-noprint mt-6">
            <CORFormsDriver session={session} driverName={driverName || session.user.email || "Driver"} onNavigateTab={onNavigateTab} />
          </div>
        )}

        <p className="ih-noprint mt-4 text-xs text-slate-400">
          To export a PDF, choose “Save as PDF” in the browser print dialog.
        </p>
      </section>
    );
  }

  return (
    <section className="induction-handout-page induction-handout-print-root rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white">
      {onBack && (
        <div className="ih-noprint">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Inductions and Training
          </button>
        </div>
      )}

      <header className="ih-header">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            COR / Inductions &amp; Training
          </p>
          <h2 className="flex items-center gap-2 text-2xl font-black text-white">
            <FileText className="h-6 w-6 text-emerald-400" aria-hidden="true" />
            Induction Handout
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Role responsibilities, Chain of Responsibility duties, forms and supporting documents.
          </p>
        </div>
        <div className="ih-noprint flex flex-wrap gap-2">
          {canApprove && selectedRole && !isApproved && pendingContent && (
            <button
              type="button"
              onClick={approveHandout}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Approve Handout
            </button>
          )}
          <button
            type="button"
            onClick={printHandout}
            disabled={!handout}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </button>
          <button
            type="button"
            onClick={printHandout}
            disabled={!handout}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export PDF
          </button>
        </div>
      </header>

      <div className="ih-noprint mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Handout Sections" value={contentSectionCount} hint={selectedRole ? `${selectedRole} content blocks` : "General CoR information"} icon={Layers} accent="bg-emerald-500/10 text-emerald-300" />
        <SummaryCard label="Driver Forms" value={DRIVER_FORMS.length} hint="F-01, F-02, F-03, F-04, F-05, F-08, F-09" icon={ClipboardList} accent="bg-teal-500/10 text-teal-300" />
        <SummaryCard label="Acknowledgement" value={acknowledgementStatus} hint={approval ? `By ${approval.approvedByEmail}` : "Handout approval status"} icon={CheckCircle2} accent="bg-sky-500/10 text-sky-300" />
        <SummaryCard label="Last Updated" value={lastUpdatedValue} hint="Source manual v2.0 (08/01/2026)" icon={CalendarDays} accent="bg-amber-500/10 text-amber-300" />
      </div>

      <div className="ih-noprint mt-6 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Quick navigation</p>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "general-cor", label: "General CoR", icon: ShieldAlert },
            { id: "role-selector", label: "Role Selection", icon: Users },
            { id: "role-description", label: "Role Description", icon: BookOpen },
            { id: "responsibilities", label: "Responsibilities", icon: Layers },
            { id: "forms-records", label: "Forms & Records", icon: FileText },
            { id: "resources", label: "Resources", icon: FileCheck },
            { id: "driver-forms", label: "Driver Forms", icon: ClipboardList },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Icon className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <div id="role-selector" className="ih-noprint mt-6 max-w-xl">
        <label htmlFor="induction-handout-role" className="mb-2 block text-sm font-semibold text-slate-200">
          Employee job role
        </label>
        <select
          id="induction-handout-role"
          value={selectedRole}
          onChange={(event) => setSelectedRole(event.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <option value="">Select a role</option>
          {inductionHandoutRoles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </div>

      {!handout && (
        <p className="ih-noprint mt-5 text-sm text-slate-400">
          Choose a role to view its handout.
        </p>
      )}

      {handout && (
        <div className="ih-noprint mt-4 flex flex-wrap items-center gap-3 text-sm">
          {isApproved ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-300">
              Approved
              {approval ? ` by ${approval.approvedByEmail} on ${new Date(approval.approvedAt).toLocaleString()}` : ""}
            </span>
          ) : (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-semibold text-amber-200">
              Pending Approval
            </span>
          )}
        </div>
      )}

      <CollapsibleCard id="general-cor" title="General CoR Information" icon={ShieldAlert} defaultOpen>
        <p className="text-sm leading-relaxed text-slate-300">
          BNT Logistics is committed to ensuring the health and safety of its workers, subcontractors,
          customers, other road users and the public. Safety will never be compromised to meet a
          delivery time, a customer demand or a commercial outcome.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {generalCoRInformation.map((item, index) => (
            <section key={item.title} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
              <h4 className="flex items-center gap-2 font-bold text-emerald-200">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-black text-emerald-300">{index + 1}</span>
                {item.title}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
            </section>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
          <h4 className="font-bold text-emerald-200">Induction before starting work</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            All new workers, subcontract drivers and labour hire workers complete induction before
            starting work. Induction covers this manual and the WHS &amp; CoR Policy; CoR obligations
            and the right to refuse unsafe work; fatigue, speed, drug and alcohol, mass and load
            restraint policies; Gearbox use for pre-start, defects, hazard and incident reporting;
            emergency procedures, PPE and first aid; and site-specific and customer-specific
            requirements.
          </p>
        </div>
      </CollapsibleCard>
      {handout && (
        <article className="ih-handout mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-7">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Employee induction handout</p>
          <h3 className="mt-2 text-xl font-bold text-white">{handout.name}</h3>
          <p className="mt-1 text-sm text-slate-400">Source role: {handout.sourceRole}</p>

          <div className="mt-5 space-y-4">
            <CollapsibleCard id="role-description" title="Role Description" icon={BookOpen} defaultOpen badge={!handout.description ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-200">Pending</span> : undefined}>
              <p className={`text-sm leading-relaxed ${handout.description ? "text-slate-300" : "text-amber-200"}`}>
                {handout.description ?? pendingApproval}
              </p>
            </CollapsibleCard>

            <CollapsibleCard id="responsibilities" title="Responsibilities by Topic" icon={Layers} defaultOpen>
              {handout.responsibilities.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {handout.responsibilities.map((topic) => (
                    <section key={topic.title} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                      <h5 className="font-bold text-emerald-200">{topic.title}</h5>
                      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                        {topic.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-amber-200">
                  {pendingApproval}
                </p>
              )}
            </CollapsibleCard>

            <CollapsibleCard id="forms-records" title="Forms and Records to be Completed" icon={FileText} defaultOpen>
              {handout.forms.length > 0 ? (
                <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                  {handout.forms.map((form) => <li key={form}>{form}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-amber-200">{pendingApproval}</p>
              )}
              {handout.formsPending && handout.forms.length > 0 && (
                <p className="mt-3 text-sm text-amber-200">{pendingApproval}</p>
              )}
            </CollapsibleCard>

            <CollapsibleCard id="resources" title="Resources and Documents to Review" icon={FileCheck} defaultOpen>
              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                {handout.resources.map((resource) => <li key={resource}>{resource}</li>)}
              </ul>
            </CollapsibleCard>
          </div>

          <p className="mt-5 border-t border-slate-700 pt-3 text-xs leading-relaxed text-slate-400">
            Source: {inductionHandoutSource}. Where a role-specific section is marked pending approval,
            the source manual does not define that content; confirm it before issuing a role handout.
          </p>
        </article>
      )}

      <section id="driver-forms" className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">Driver Forms &amp; Records</h3>
            <p className="mt-1 text-sm text-slate-400">Manage the seven induction and safety forms used by drivers. Counts and statuses are loaded from the database.</p>
          </div>
          {loadingSubmissions && <span className="text-xs text-slate-400">Loading submissions…</span>}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {DRIVER_FORMS.map((form) => {
            const Icon = form.icon;
            const rows = formStats(form.code);
            const pending = rows.filter((row) => row.status !== "Resolved").length;
            const latest = rows[0]?.submittedAt ? new Date(rows[0].submittedAt).toLocaleDateString() : "No submissions";
            return (
              <article key={form.code} className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-bold text-emerald-200">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {form.code}
                  </span>
                  <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-300">{rows.length} total</span>
                </div>
                <h4 className="mt-2 text-sm font-semibold text-white">{form.title}</h4>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div className="rounded-md bg-slate-950/60 p-2">
                    <p className="font-semibold text-amber-200">{pending}</p>
                    <p>Pending</p>
                  </div>
                  <div className="rounded-md bg-slate-950/60 p-2">
                    <p className="font-semibold text-emerald-300">{rows.length - pending}</p>
                    <p>Resolved</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">Latest: {latest}</p>
                <button
                  type="button"
                  onClick={() => setSelectedAdminCorForm(form.code)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  Review {form.code}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {selectedAdminCorForm && (
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Reviewing {selectedAdminCorForm}</h3>
            <button
              type="button"
              onClick={() => setSelectedAdminCorForm(null)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Close
            </button>
          </div>
          {selectedAdminCorForm === "F-01" && <SafetyIncidentAdmin session={session!} />}
          {selectedAdminCorForm === "F-02" && <CORFormsAdmin defaultFormCode="F-02" session={session!} />}
          {selectedAdminCorForm === "F-03" && <PreTripInspectionAdmin session={session!} />}
          {selectedAdminCorForm === "F-04" && <CORFormsAdmin defaultFormCode="F-04" session={session!} />}
          {selectedAdminCorForm === "F-05" && <CORFormsAdmin defaultFormCode="F-05" session={session!} />}
          {selectedAdminCorForm === "F-08" && <CORFormsAdmin defaultFormCode="F-08" session={session!} />}
          {selectedAdminCorForm === "F-09" && <CORFormsAdmin defaultFormCode="F-09" session={session!} />}
        </div>
      )}

      <p className="ih-noprint mt-4 text-xs text-slate-400">
        To export a PDF, choose “Save as PDF” in the browser print dialog.
      </p>
    </section>
  );
}
