import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { CorFormSubmission, SessionState } from "../../types";
import { ClipboardList, Filter, CheckCircle2, Clock, User, Truck, AlertTriangle, ShieldCheck, Brain, FileCheck, MapPin, Wrench, Circle } from "lucide-react";

const INDUCTION_CHECKLIST_ITEMS = [
  "Chain of Responsibility responsibilities explained",
  "Fatigue management policy reviewed",
  "Load restraint requirements reviewed",
  "Speed and compliance requirements reviewed",
  "Vehicle pre-start and defect reporting reviewed",
  "Incident and hazard reporting reviewed",
  "Site safety and PPE requirements reviewed",
];

interface CORFormsAdminProps {
  session: SessionState;
  defaultFormCode?: string;
}

function statusColor(status: string) {
  switch (status) {
    case "Resolved":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "Under Review":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    default:
      return "bg-slate-800 text-slate-300 border-slate-600";
  }
}

function severityColor(severity: unknown) {
  switch (String(severity)) {
    case "Critical":
      return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    case "Major":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    default:
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  }
}

function InfoField({ label, value, icon: Icon, fullWidth = false }: { label: string; value: unknown; icon?: any; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">{label}</span>
      <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 px-3 py-2 text-sm text-slate-200 flex items-start gap-2">
        {Icon && <Icon className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
        <span className="break-words whitespace-pre-wrap">{value == null || value === "" ? "—" : String(value)}</span>
      </div>
    </div>
  );
}

function renderPayload(row: any) {
  const p = (row?.payload || {}) as Record<string, any>;
  switch (row?.formCode) {
    case "F-04":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoField label="Vehicle registration" value={p.vehicleRego} icon={Truck} />
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Defect severity</span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${severityColor(p.defectSeverity)}`}>{p.defectSeverity || "—"}</span>
          </div>
          <InfoField label="Defect description" value={p.defectDescription} icon={AlertTriangle} fullWidth />
          <InfoField label="Immediate action taken" value={p.immediateAction} icon={Wrench} fullWidth />
        </div>
      );
    case "F-05":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoField label="Task / job" value={p.task} icon={FileCheck} />
          <InfoField label="Location" value={p.location} icon={MapPin} />
          <InfoField label="Hazards identified" value={p.hazards} icon={AlertTriangle} fullWidth />
          <InfoField label="Controls / safe work steps" value={p.controls} icon={ShieldCheck} fullWidth />
          <InfoField label="PPE required" value={p.ppe} />
          <InfoField label="Signature" value={p.signature} icon={User} />
        </div>
      );
    case "F-08": {
      const completed = Array.isArray(p.completedItems) ? p.completedItems : [];
      const total = INDUCTION_CHECKLIST_ITEMS.length;
      const percent = total ? Math.round((completed.length / total) * 100) : 0;
      return (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Induction progress</span>
              <span className="font-bold text-emerald-300">{completed.length}/{total}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {INDUCTION_CHECKLIST_ITEMS.map((item) => {
              const done = completed.includes(item);
              return (
                <div key={item} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-800/40 text-slate-400"}`}>
                  {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <Circle className="w-4 h-4 text-slate-500 shrink-0" />}
                  <span>{item}</span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoField label="Additional notes" value={p.notes} fullWidth />
            <InfoField label="Signature" value={p.signature} icon={User} />
          </div>
        </div>
      );
    }
    case "F-09":
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoField label="Hours slept (last 24h)" value={p.hoursSlept} icon={Clock} />
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Fit for duty</span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${p.fitForDuty ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
              {p.fitForDuty ? "Yes" : "No"}
            </span>
          </div>
          <InfoField label="Medications / conditions" value={p.medication} icon={Brain} fullWidth />
          <InfoField label="Signature" value={p.signature} icon={User} />
        </div>
      );
    default:
      return (
        <div className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(p, null, 2)}</pre>
        </div>
      );
  }
}


export function CORFormsAdmin({ session, defaultFormCode }: CORFormsAdminProps) {
  const { t } = useTranslation();
  const [submissions, setSubmissions] = useState<CorFormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterForm, setFilterForm] = useState<string>(defaultFormCode || "All");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [names, setNames] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const rows = await api.getCorFormSubmissions();
      setSubmissions(rows);
      const ids = [...new Set(rows.map((row: any) => row.userId).filter(Boolean))];
      if (ids.length) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        const map: Record<string, string> = {};
        (profiles || []).forEach((profile: any) => {
          map[String(profile.id)] = String(profile.full_name || profile.email || "Driver");
        });
        setNames(map);
      }
    } catch (error) {
      console.error("Failed to load COR form submissions", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (defaultFormCode) setFilterForm(defaultFormCode);
  }, [defaultFormCode]);

  const filtered = submissions.filter((row) => {
    if (filterForm !== "All" && row.formCode !== filterForm) return false;
    if (filterStatus !== "All" && row.status !== filterStatus) return false;
    return true;
  });

  const handleStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    try {
      await api.updateCorFormSubmission(id, { status });
      setSubmissions((prev) => prev.map((row) => row.id === id ? { ...row, status: status as CorFormSubmission["status"], reviewedAt: new Date().toISOString(), reviewedBy: session.user.id } : row));
    } catch (error) {
      console.error("Failed to update COR form submission", error);
    } finally {
      setUpdatingId(null);
    }
  };

  const formCodes = ["All", ...Array.from(new Set(["F-04", "F-05", "F-08", "F-09", ...submissions.map((row) => row.formCode)]))];
  const statuses = ["All", "Submitted", "Under Review", "Resolved"];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <ClipboardList className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-bold text-white">COR Form Submissions</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" value={filterForm} onChange={(e) => setFilterForm(e.target.value)}>
          {formCodes.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="button" onClick={load} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">Refresh</button>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No submissions found.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-300">{row.formCode}</span>
                    <h3 className="text-base font-bold text-white">{row.formTitle}</h3>
                  </div>
                  <p className="text-[11px] text-slate-500">Form ID: <span className="font-mono text-slate-300">{row.id}</span></p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {names[row.userId] || row.userId}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {new Date(row.submittedAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusColor(row.status)}`}>{row.status}</span>
                  {row.status !== "Resolved" && (
                    <button type="button" disabled={updatingId === row.id} onClick={() => handleStatus(row.id, row.status === "Submitted" ? "Under Review" : "Resolved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                      {updatingId === row.id ? "Updating..." : row.status === "Submitted" ? "Mark Under Review" : "Mark Resolved"}
                    </button>
                  )}
                </div>
              </div>
              {renderPayload(row)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
