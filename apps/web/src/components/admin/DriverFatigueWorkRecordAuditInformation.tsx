"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Save, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type DayStatus = "Not Audited" | "No Breach" | "Breach Found";

interface DayAudit {
  day: number;
  status: DayStatus;
  hoursWorked: string;
  restHours: string;
  notes: string;
}

interface RecordKeeping {
  recordsMaintained: boolean;
  retentionPeriodMonths: string;
  auditFrequency: string;
  correctiveActions: string;
  recordKeeper: string;
}

interface AuditPayload {
  source?: "admin" | "driver";
  driverId: string;
  driverName: string;
  month: string;
  year: string;
  auditDate: string;
  auditor: string;
  comments: string;
  recordKeeping: RecordKeeping;
  dayAudits: DayAudit[];
  reviewSummary?: ReviewSummaryState;
  externalValidations?: ExternalValidationRecord[];
  ncrs?: NcrRecord[];
}

interface ReviewSummaryState {
  requiredDriverDetailsChecked: boolean;
  missingDiaryPages: string;
  workRestCompliance: "Not assessed" | "Compliant" | "Non-compliant";
  auditorDetailsChecked: boolean;
  correctiveActions: string;
}

interface ExternalValidationRecord {
  id: string;
  evidenceType: "GPS" | "Fuel" | "Toll" | "Delivery";
  mismatchFound: boolean;
  mismatchDetails: string;
  investigationNotes: string;
  createdAt: string;
  linkedToReview: boolean;
}

interface NcrRecord {
  id: string;
  issue: string;
  responsiblePerson: string;
  correctiveAction: string;
  status: "Open" | "In Progress" | "Closed";
  dueDate: string;
  createdDate: string;
  linkedFinding?: string;
}

const STATUS_OPTIONS: DayStatus[] = ["Not Audited", "No Breach", "Breach Found"];

function emptyDays(): DayAudit[] {
  return Array.from({ length: 31 }, (_, index) => ({
    day: index + 1,
    status: "Not Audited",
    hoursWorked: "",
    restHours: "",
    notes: ""
  }));
}

function emptyRecordKeeping(): RecordKeeping {
  return {
    recordsMaintained: false,
    retentionPeriodMonths: "",
    auditFrequency: "",
    correctiveActions: "",
    recordKeeper: ""
  };
}

function normalizeDayStatus(value: unknown): DayStatus {
  if (value === "Not Audited" || value === "No Breach" || value === "Breach Found") {
    return value as DayStatus;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "compliant" || text === "no breach") return "No Breach";
  if (text === "non-compliant" || text === "breach found" || text === "breach") return "Breach Found";
  if (text === "not audited" || text === "n/a" || text === "na") return "Not Audited";
  return "Not Audited";
}

function inputClass(disabled = false): string {
  return `w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none ${disabled ? "opacity-60" : ""}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function sameAuditPeriod(payload: Partial<AuditPayload>, month: string, year: string) {
  const payloadMonth = Number(payload.month);
  const payloadYear = Number(payload.year);
  return (
    Number.isFinite(payloadMonth) &&
    Number.isFinite(payloadYear) &&
    payloadMonth === Number(month) &&
    payloadYear === Number(year)
  );
}

export function DriverFatigueWorkRecordAuditInformation({ session }: { session: SessionState }) {
  const [drivers, setDrivers] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [auditDate, setAuditDate] = useState(new Date().toISOString().slice(0, 10));
  const [auditor, setAuditor] = useState(session.user.email);
  const [comments, setComments] = useState("");
  const [recordKeeping, setRecordKeeping] = useState<RecordKeeping>(emptyRecordKeeping());
  const [days, setDays] = useState<DayAudit[]>(emptyDays());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [audits, setAudits] = useState<any[]>([]);
  const [driverSubmissions, setDriverSubmissions] = useState<any[]>([]);
  const [driverSubmissionNames, setDriverSubmissionNames] = useState<Record<string, string>>({});
  const [driverSubmissionsLoading, setDriverSubmissionsLoading] = useState(false);
  const [driverSubmissionsError, setDriverSubmissionsError] = useState("");
  const [selectedDriverSubmission, setSelectedDriverSubmission] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"daily" | "review" | "weekly" | "external" | "ncr">("daily");
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryState>({
    requiredDriverDetailsChecked: false,
    missingDiaryPages: "",
    workRestCompliance: "Not assessed",
    auditorDetailsChecked: false,
    correctiveActions: ""
  });
  const [externalValidations, setExternalValidations] = useState<ExternalValidationRecord[]>([]);
  const [evForm, setEvForm] = useState({
    evidenceType: "GPS" as "GPS" | "Fuel" | "Toll" | "Delivery",
    mismatchFound: false,
    mismatchDetails: "",
    investigationNotes: ""
  });
  const [ncrs, setNcrs] = useState<NcrRecord[]>([]);
  const [ncrForm, setNcrForm] = useState({
    issue: "",
    responsiblePerson: "",
    correctiveAction: "",
    status: "Open" as "Open" | "In Progress" | "Closed",
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    linkedFinding: ""
  });

  const loadDrivers = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name", { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    const list = (data ?? [])
      .filter((row: any) => row.full_name && !String(row.full_name).startsWith("[DELETED]"))
      .map((row: any) => ({ id: String(row.id), fullName: String(row.full_name) }));
    setDrivers(list);
    if (list.length && !selectedDriverId) setSelectedDriverId(list[0].id);
  }, [selectedDriverId]);

  const loadAudits = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cor_form_submissions")
      .select("*")
      .eq("form_code", "F-10")
      .order("submitted_at", { ascending: false });
    if (error) setError(error.message);
    else setAudits((data ?? []).filter((row: any) => (row.payload as Record<string, unknown>)?.source !== "driver"));
    setLoading(false);
  }, []);

  const loadDriverSubmissions = useCallback(async () => {
    setDriverSubmissionsLoading(true);
    setDriverSubmissionsError("");
    try {
      const { data, error } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", "F-10")
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).filter((row: any) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return payload.source === "driver" && row.status !== "Draft";
      });
      setDriverSubmissions(rows);
      const ids = [...new Set(rows.map((row: any) => String(row.user_id)).filter(Boolean))];
      if (ids.length) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        const map: Record<string, string> = {};
        (profiles || []).forEach((profile: any) => {
          map[String(profile.id)] = String(profile.full_name || profile.email || "Driver");
        });
        setDriverSubmissionNames(map);
      } else {
        setDriverSubmissionNames({});
      }
    } catch (err) {
      setDriverSubmissionsError(err instanceof Error ? err.message : "Failed to load driver work record submissions.");
    } finally {
      setDriverSubmissionsLoading(false);
    }
  }, []);

  const openDriverSubmissionFile = async (path: string) => {
    try {
      const { data } = await supabase.storage.from("driver-documents").createSignedUrl(path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch {
      // Ignore; file list remains visible.
    }
  };

  useEffect(() => {
    void loadDrivers();
    void loadAudits();
    void loadDriverSubmissions();
  }, [loadDrivers, loadAudits, loadDriverSubmissions]);

  useEffect(() => {
    const existing = audits.find((audit) => {
      const payload = (audit.payload ?? {}) as Partial<AuditPayload>;
      if (payload.source === "driver") return false;
      return (
        String(payload.driverId ?? "").trim().toLowerCase() === selectedDriverId.trim().toLowerCase() &&
        sameAuditPeriod(payload, month, year)
      );
    });
    if (!existing) {
      setComments("");
      setRecordKeeping(emptyRecordKeeping());
      setDays(emptyDays());
      setAuditDate(new Date().toISOString().slice(0, 10));
      setReviewSummary({
        requiredDriverDetailsChecked: false,
        missingDiaryPages: "",
        workRestCompliance: "Not assessed",
        auditorDetailsChecked: false,
        correctiveActions: ""
      });
      setExternalValidations([]);
      setNcrs([]);
      return;
    }
    const payload = (existing.payload ?? {}) as Partial<AuditPayload>;
    if (payload.source === "driver") {
      setComments("");
      setRecordKeeping(emptyRecordKeeping());
      setDays(emptyDays());
      setAuditDate(new Date().toISOString().slice(0, 10));
      setReviewSummary({
        requiredDriverDetailsChecked: false,
        missingDiaryPages: "",
        workRestCompliance: "Not assessed",
        auditorDetailsChecked: false,
        correctiveActions: ""
      });
      setExternalValidations([]);
      setNcrs([]);
      return;
    }
    setComments(String(payload.comments ?? ""));
    setRecordKeeping({ ...emptyRecordKeeping(), ...(payload.recordKeeping ?? {}) });
    if (Array.isArray(payload.dayAudits) && payload.dayAudits.length) {
      const mapped = emptyDays().map((day) => {
        const found = payload.dayAudits?.find((item: any) => Number(item.day) === day.day);
        return found
          ? {
              day: day.day,
              status: normalizeDayStatus(found.status),
              hoursWorked: String(found.hoursWorked ?? ""),
              restHours: String(found.restHours ?? ""),
              notes: String(found.notes ?? "")
            }
          : day;
      });
      setDays(mapped);
    } else {
      setDays(emptyDays());
    }
    if (payload.auditDate) setAuditDate(String(payload.auditDate));
    if (payload.auditor) setAuditor(String(payload.auditor));
    if (payload.reviewSummary) setReviewSummary({ ...reviewSummary, ...payload.reviewSummary } as ReviewSummaryState);
    setExternalValidations(Array.isArray(payload.externalValidations) ? payload.externalValidations : []);
    setNcrs(Array.isArray(payload.ncrs) ? payload.ncrs : []);
  }, [audits, selectedDriverId, month, year]);

  const addExternalValidation = () => {
    if (!evForm.mismatchDetails.trim() && !evForm.investigationNotes.trim()) {
      setError("Enter mismatch details or investigation notes before recording external validation.");
      return;
    }
    const record: ExternalValidationRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      evidenceType: evForm.evidenceType,
      mismatchFound: evForm.mismatchFound,
      mismatchDetails: evForm.mismatchDetails.trim(),
      investigationNotes: evForm.investigationNotes.trim(),
      createdAt: new Date().toISOString(),
      linkedToReview: false
    };
    setExternalValidations((current) => [record, ...current]);
    setEvForm({ evidenceType: "GPS", mismatchFound: false, mismatchDetails: "", investigationNotes: "" });
    setSuccess("External validation recorded. Save audit to persist.");
  };

  const linkExternalValidationToReview = (id: string) => {
    setExternalValidations((current) =>
      current.map((item) => (item.id === id ? { ...item, linkedToReview: true } : item))
    );
    const record = externalValidations.find((item) => item.id === id);
    setReviewSummary((current) => ({
      ...current,
      correctiveActions: current.correctiveActions
        ? `${current.correctiveActions}\n${record?.evidenceType ?? "Evidence"} mismatch: ${record?.mismatchDetails || record?.investigationNotes}`
        : `${record?.evidenceType ?? "Evidence"} mismatch: ${record?.mismatchDetails || record?.investigationNotes}`
    }));
    setSuccess("Mismatch linked to Review Summary.");
  };

  const createNcrFromFinding = (finding: string) => {
    setNcrForm((current) => ({
      ...current,
      issue: finding,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    }));
    setActiveTab("ncr");
  };

  const addNcr = () => {
    if (!ncrForm.issue.trim()) {
      setError("Enter an issue before creating an NCR.");
      return;
    }
    const record: NcrRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      issue: ncrForm.issue.trim(),
      responsiblePerson: ncrForm.responsiblePerson.trim(),
      correctiveAction: ncrForm.correctiveAction.trim(),
      status: ncrForm.status,
      dueDate: ncrForm.dueDate,
      createdDate: new Date().toISOString(),
      linkedFinding: ncrForm.linkedFinding || undefined
    };
    setNcrs((current) => [record, ...current]);
    setNcrForm({
      issue: "",
      responsiblePerson: "",
      correctiveAction: "",
      status: "Open",
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      linkedFinding: ""
    });
    setSuccess("NCR created. Save audit to persist.");
  };

  const updateDay = (day: number, patch: Partial<DayAudit>) => {
    setDays((current) => current.map((item) => (item.day === day ? { ...item, ...patch } : item)));
  };

  const allNcrs = audits.flatMap((audit) => {
    const payload = (audit.payload ?? {}) as Partial<AuditPayload>;
    const list = Array.isArray(payload.ncrs) ? payload.ncrs : [];
    return list.map((ncr: any) => ({
      ...ncr,
      driverId: String(payload.driverId ?? audit.user_id ?? ""),
      driverName: String(payload.driverName ?? ""),
      auditId: String(audit.id)
    }));
  });

  const totalDrivers = drivers.length;
  const weeklyTarget = Math.max(1, Math.ceil(totalDrivers * 0.1));
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const completedThisWeek = audits.filter((audit) => {
    const payload = (audit.payload ?? {}) as Partial<AuditPayload>;
    if (payload.source === "driver") return false;
    const auditDateValue = payload.auditDate || audit.submitted_at || audit.reviewed_at;
    const date = auditDateValue ? new Date(auditDateValue) : null;
    return !!date && !Number.isNaN(date.getTime()) && date >= weekStart;
  }).length;
  const pendingAudits = Math.max(0, weeklyTarget - completedThisWeek);
  const highRiskDrivers = audits.filter((audit) => {
    const payload = (audit.payload ?? {}) as Partial<AuditPayload>;
    if (payload.source === "driver") return false;
    const breach = (payload.dayAudits ?? []).some((day: any) => String(day.status) === "Breach Found");
    const ncrOpen = (payload.ncrs ?? []).some((ncr: any) => ncr.status !== "Closed");
    const mismatch = (payload.externalValidations ?? []).some((item: any) => item.mismatchFound);
    return breach || ncrOpen || mismatch;
  }).length;

  const persistAudit = async () => {
    if (!selectedDriverId) {
      setError("Select a driver before saving.");
      return;
    }
    const driver = drivers.find((item) => item.id === selectedDriverId);
    setSaving(true);
    setError("");
    setSuccess("");
    const payload: AuditPayload = {
      source: "admin",
      driverId: selectedDriverId,
      driverName: driver?.fullName ?? "",
      month,
      year,
      auditDate,
      auditor,
      comments,
      recordKeeping,
      dayAudits: days,
      reviewSummary,
      externalValidations,
      ncrs
    };
    const existingAudit = audits.find((audit) => {
      const savedPayload = (audit.payload ?? {}) as Partial<AuditPayload>;
      return (
        savedPayload.source === "admin" &&
        String(savedPayload.driverId ?? "").trim().toLowerCase() === selectedDriverId.trim().toLowerCase() &&
        sameAuditPeriod(savedPayload, month, year)
      );
    });
    const submission = {
      user_id: selectedDriverId,
      form_code: "F-10",
      form_title: "Driver Fatigue Work Record Audit Information",
      payload,
      status: "Resolved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.user.id
    };
    const { error } = existingAudit
      ? await supabase.from("cor_form_submissions").update(submission).eq("id", existingAudit.id)
      : await supabase.from("cor_form_submissions").insert(submission);
    if (error) {
      setError(error.message);
    } else {
      setSuccess("Audit record saved successfully.");
      await loadAudits();
    }
    setSaving(false);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    await persistAudit();
  };

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);

  return (

    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Driver Fatigue Work Record Audit Information</h2>
          <p className="mt-1 text-sm text-slate-400">
            Admin completes this audit from the driver's actual work/rest records and audit evidence. Enter only recorded information for each day; do not estimate or create records.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-indigo-400" />
          Admin audit
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">{success}</div>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-700 bg-slate-900/60 p-2">
        {[
          { id: "daily", label: "Daily Audit" },
          { id: "review", label: "Review Summary" },
          { id: "weekly", label: "Weekly Audit Tracking" },
          { id: "external", label: "External Validation" },
          { id: "ncr", label: "NCRs" }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "daily" ? (
      <form onSubmit={handleSave} className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Driver</span>
            <select
              value={selectedDriverId}
              onChange={(event) => setSelectedDriverId(event.target.value)}
              className={inputClass()}
            >
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Month</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass()}>
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={String(index + 1)}>
                  {new Date(2020, index, 1).toLocaleString(undefined, { month: "long" })}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Year</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className={inputClass()}
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Audit date</span>
            <input
              type="date"
              value={auditDate}
              onChange={(event) => setAuditDate(event.target.value)}
              className={inputClass()}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Auditor</span>
            <input value={auditor} onChange={(event) => setAuditor(event.target.value)} className={inputClass()} />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Record keeper</span>
            <span className="block text-xs font-normal text-slate-500">Person responsible for retaining the audited records.</span>
            <input
              value={recordKeeping.recordKeeper}
              onChange={(event) =>
                setRecordKeeping((current) => ({ ...current, recordKeeper: event.target.value }))
              }
              className={inputClass()}
            />
          </label>
        </div>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-white">Days 1–31 audit</h3>
          <p className="text-xs text-slate-400">
            Audit Result: No Breach = recorded work/rest complies; Breach Found = an issue was identified; Not Audited = the day was not reviewed. Enter work and rest hours exactly as shown in the driver's actual records, and use Notes for audit evidence or comments.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="min-w-full text-sm text-slate-200">
              <thead className="bg-slate-900 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-left">Audit Result</th>
                  <th className="px-3 py-2 text-left">Work hours recorded</th>
                  <th className="px-3 py-2 text-left">Rest hours recorded</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {days.map((day) => (
                  <tr key={day.day}>
                    <td className="px-3 py-2 font-semibold">{day.day}</td>
                    <td className="px-3 py-2">
                      <select
                        value={day.status}
                        onChange={(event) => updateDay(day.day, { status: event.target.value as DayStatus })}
                        className={inputClass()}
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={day.hoursWorked}
                        onChange={(event) => updateDay(day.day, { hoursWorked: event.target.value })}
                        className={inputClass()}
                        placeholder="e.g. 8.5"
                        aria-label={`Day ${day.day} work hours recorded`}
                        title="Enter work hours from the driver's record"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={day.restHours}
                        onChange={(event) => updateDay(day.day, { restHours: event.target.value })}
                        className={inputClass()}
                        placeholder="e.g. 10.0"
                        aria-label={`Day ${day.day} rest hours recorded`}
                        title="Enter rest hours from the driver's record"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={day.notes}
                        onChange={(event) => updateDay(day.day, { notes: event.target.value })}
                        className={inputClass()}
                        placeholder="Audit note/evidence"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Records maintained</span>
            <span className="block text-xs font-normal text-slate-500">Whether driver work/rest records are maintained for the audited month.</span>
            <select
              value={recordKeeping.recordsMaintained ? "yes" : "no"}
              onChange={(event) =>
                setRecordKeeping((current) => ({ ...current, recordsMaintained: event.target.value === "yes" }))
              }
              className={inputClass()}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Retention period (months)</span>
            <span className="block text-xs font-normal text-slate-500">Enter only the retention period required by approved company policy or law. Leave blank if not confirmed; do not guess.</span>
            <input
              value={recordKeeping.retentionPeriodMonths}
              onChange={(event) =>
                setRecordKeeping((current) => ({ ...current, retentionPeriodMonths: event.target.value }))
              }
              className={inputClass()}
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Audit frequency</span>
            <span className="block text-xs font-normal text-slate-500">How often this audit is completed, as required by approved company policy.</span>
            <input
              value={recordKeeping.auditFrequency}
              onChange={(event) =>
                setRecordKeeping((current) => ({ ...current, auditFrequency: event.target.value }))
              }
              className={inputClass()}
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Corrective actions</span>
            <span className="block text-xs font-normal text-slate-500">Actions required to address any breach found during this audit.</span>
            <input
              value={recordKeeping.correctiveActions}
              onChange={(event) =>
                setRecordKeeping((current) => ({ ...current, correctiveActions: event.target.value }))
              }
              className={inputClass()}
            />
          </label>
        </section>

        <label className="block space-y-1 text-sm text-slate-300">
          <span className="font-medium">Comments</span>
          <span className="block text-xs font-normal text-slate-500">Overall audit comments and references to audit evidence.</span>
          <textarea
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            rows={4}
            className={inputClass()}
            placeholder="Audit comments"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {selectedDriver ? `Auditing ${selectedDriver.fullName}` : "No driver selected"}
          </p>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save audit
          </button>
        </div>
      </form>
      ) : null}

      {activeTab === "review" ? (
        <div className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white">Review Summary</h3>
              <p className="mt-1 text-sm text-slate-400">
                Review required driver details, missing diary pages, work/rest compliance, auditor details and corrective actions.
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void persistAudit()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save review
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={reviewSummary.requiredDriverDetailsChecked}
                onChange={(event) =>
                  setReviewSummary((current) => ({ ...current, requiredDriverDetailsChecked: event.target.checked }))
                }
              />
              Required driver details checked
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={reviewSummary.auditorDetailsChecked}
                onChange={(event) =>
                  setReviewSummary((current) => ({ ...current, auditorDetailsChecked: event.target.checked }))
                }
              />
              Auditor details checked
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Missing diary pages</span>
              <input
                value={reviewSummary.missingDiaryPages}
                onChange={(event) => setReviewSummary((current) => ({ ...current, missingDiaryPages: event.target.value }))}
                className={inputClass()}
                placeholder="e.g. 3, 7, 12"
              />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Work/rest compliance</span>
              <select
                value={reviewSummary.workRestCompliance}
                onChange={(event) =>
                  setReviewSummary((current) => ({ ...current, workRestCompliance: event.target.value as any }))
                }
                className={inputClass()}
              >
                <option>Not assessed</option>
                <option>Compliant</option>
                <option>Non-compliant</option>
              </select>
            </label>
          </div>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Corrective actions</span>
            <textarea
              value={reviewSummary.correctiveActions}
              onChange={(event) => setReviewSummary((current) => ({ ...current, correctiveActions: event.target.value }))}
              className={inputClass()}
              rows={4}
              placeholder="Corrective actions and follow-up requirements"
            />
          </label>
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <h4 className="text-sm font-semibold text-white">Breach days identified</h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {days.filter((day) => day.status === "Breach Found").length ? (
                days
                  .filter((day) => day.status === "Breach Found")
                  .map((day) => (
                    <li key={day.day} className="flex items-center justify-between gap-2">
                      <span>Day {day.day}: {day.notes || "Breach found"}</span>
                      <button
                        type="button"
                        onClick={() => createNcrFromFinding(`Day ${day.day} breach: ${day.notes || "Breach found"}`)}
                        className="text-xs text-amber-300 hover:text-amber-200"
                      >
                        Create NCR
                      </button>
                    </li>
                  ))
              ) : (
                <li>No breach days recorded.</li>
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {activeTab === "weekly" ? (
        <div className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <div>
            <h3 className="text-lg font-bold text-white">Weekly Audit Tracking</h3>
            <p className="mt-1 text-sm text-slate-400">
              Minimum 10% of drivers must be audited each week. Tracking is derived from existing audit records.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400">Total drivers</p>
              <p className="mt-1 text-2xl font-black text-white">{totalDrivers}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400">Weekly target (10%)</p>
              <p className="mt-1 text-2xl font-black text-white">{weeklyTarget}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400">Completed this week</p>
              <p className="mt-1 text-2xl font-black text-white">{completedThisWeek}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-400">Pending audits</p>
              <p className="mt-1 text-2xl font-black text-white">{pendingAudits}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-sm text-slate-300">
              High-risk drivers identified: <span className="font-bold text-amber-300">{highRiskDrivers}</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              High-risk means a breach found, open NCR, or external validation mismatch in an existing audit record.
            </p>
          </div>
        </div>
      ) : null}

      {activeTab === "external" ? (
        <div className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <div>
            <h3 className="text-lg font-bold text-white">External Validation</h3>
            <p className="mt-1 text-sm text-slate-400">
              Compare driver records with GPS, fuel, toll and delivery evidence. Record mismatches and investigation notes.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Evidence type</span>
              <select
                value={evForm.evidenceType}
                onChange={(event) => setEvForm((current) => ({ ...current, evidenceType: event.target.value as any }))}
                className={inputClass()}
              >
                <option value="GPS">GPS</option>
                <option value="Fuel">Fuel</option>
                <option value="Toll">Toll</option>
                <option value="Delivery">Delivery</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={evForm.mismatchFound}
                onChange={(event) => setEvForm((current) => ({ ...current, mismatchFound: event.target.checked }))}
              />
              Mismatch found
            </label>
          </div>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Mismatch details</span>
            <textarea
              value={evForm.mismatchDetails}
              onChange={(event) => setEvForm((current) => ({ ...current, mismatchDetails: event.target.value }))}
              className={inputClass()}
              rows={3}
              placeholder="Describe the mismatch identified"
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span className="font-medium">Investigation notes</span>
            <textarea
              value={evForm.investigationNotes}
              onChange={(event) => setEvForm((current) => ({ ...current, investigationNotes: event.target.value }))}
              className={inputClass()}
              rows={3}
              placeholder="Investigation notes and evidence references"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addExternalValidation}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Record validation
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void persistAudit()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save audit
            </button>
          </div>
          <div className="space-y-3">
            {externalValidations.length ? (
              externalValidations.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {item.evidenceType} {item.mismatchFound ? "(Mismatch found)" : "(No mismatch)"}
                    </p>
                    <div className="flex gap-2">
                      {!item.linkedToReview ? (
                        <button
                          type="button"
                          onClick={() => linkExternalValidationToReview(item.id)}
                          className="text-xs text-indigo-300 hover:text-indigo-200"
                        >
                          Link to Review Summary
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-300">Linked to review</span>
                      )}
                      {item.mismatchFound ? (
                        <button
                          type="button"
                          onClick={() =>
                            createNcrFromFinding(`${item.evidenceType} mismatch: ${item.mismatchDetails || item.investigationNotes}`)
                          }
                          className="text-xs text-amber-300 hover:text-amber-200"
                        >
                          Create NCR
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {item.mismatchDetails ? <p className="mt-2 text-sm text-slate-300">{item.mismatchDetails}</p> : null}
                  {item.investigationNotes ? <p className="mt-1 text-xs text-slate-400">{item.investigationNotes}</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No external validations recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "ncr" ? (
        <div className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <div>
            <h3 className="text-lg font-bold text-white">Non-Conformance Reports (NCRs)</h3>
            <p className="mt-1 text-sm text-slate-400">
              Create and track NCRs. Closure period is 14 days. Status tracking is retained with existing audit records.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Issue</span>
              <textarea
                value={ncrForm.issue}
                onChange={(event) => setNcrForm((current) => ({ ...current, issue: event.target.value }))}
                className={inputClass()}
                rows={3}
                placeholder="Describe the non-conformance"
              />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Responsible person</span>
              <input
                value={ncrForm.responsiblePerson}
                onChange={(event) => setNcrForm((current) => ({ ...current, responsiblePerson: event.target.value }))}
                className={inputClass()}
                placeholder="Responsible person"
              />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span className="font-medium">Corrective action</span>
              <textarea
                value={ncrForm.correctiveAction}
                onChange={(event) => setNcrForm((current) => ({ ...current, correctiveAction: event.target.value }))}
                className={inputClass()}
                rows={3}
                placeholder="Corrective action required"
              />
            </label>
            <div className="space-y-3">
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Status</span>
                <select
                  value={ncrForm.status}
                  onChange={(event) => setNcrForm((current) => ({ ...current, status: event.target.value as any }))}
                  className={inputClass()}
                >
                  <option>Open</option>
                  <option>In Progress</option>
                  <option>Closed</option>
                </select>
              </label>
              <label className="space-y-1 text-sm text-slate-300">
                <span className="font-medium">Due date (14-day closure)</span>
                <input
                  type="date"
                  value={ncrForm.dueDate}
                  onChange={(event) => setNcrForm((current) => ({ ...current, dueDate: event.target.value }))}
                  className={inputClass()}
                />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addNcr}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Create NCR
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void persistAudit()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save audit
            </button>
          </div>
          <div className="space-y-3">
            {ncrs.length ? (
              ncrs.map((ncr) => {
                const overdue = ncr.status !== "Closed" && new Date(ncr.dueDate) < new Date();
                return (
                  <div key={ncr.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{ncr.issue}</p>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          ncr.status === "Closed"
                            ? "bg-emerald-900/60 text-emerald-200"
                            : overdue
                            ? "bg-red-900/60 text-red-200"
                            : "bg-amber-900/60 text-amber-200"
                        }`}
                      >
                        {ncr.status}
                        {overdue ? " (Overdue)" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">Responsible: {ncr.responsiblePerson || "Not assigned"}</p>
                    <p className="mt-1 text-sm text-slate-300">Corrective action: {ncr.correctiveAction || "Not recorded"}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Due {new Date(ncr.dueDate).toLocaleDateString()} | Created {new Date(ncr.createdDate).toLocaleDateString()}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {ncr.status !== "Closed" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setNcrs((current) =>
                              current.map((item) => (item.id === ncr.id ? { ...item, status: "Closed" } : item))
                            )
                          }
                          className="text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          Mark closed
                        </button>
                      ) : null}
                      {ncr.status === "Open" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setNcrs((current) =>
                              current.map((item) => (item.id === ncr.id ? { ...item, status: "In Progress" } : item))
                            )
                          }
                          className="text-xs text-indigo-300 hover:text-indigo-200"
                        >
                          Start
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-slate-400">No NCRs recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Driver work record submissions</h3>
          <button
            type="button"
            disabled={driverSubmissionsLoading}
            onClick={() => void loadDriverSubmissions()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Refresh
          </button>
        </div>
        {driverSubmissionsError ? (
          <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{driverSubmissionsError}</p>
        ) : driverSubmissionsLoading ? (
          <p role="status" className="text-sm text-slate-300">Loading driver submissions…</p>
        ) : driverSubmissions.length === 0 ? (
          <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No driver work records have been submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {driverSubmissions.map((submission) => {
              const payload = (submission.payload ?? {}) as Record<string, any>;
              const files = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];
              const recordedDays = Array.isArray(payload.days)
                ? payload.days.filter((day: any) => String(day.hoursWorked ?? "").trim() !== "" || String(day.restHours ?? "").trim() !== "").length
                : 0;
              const driverName = driverSubmissionNames[String(submission.user_id)] || String(payload.driverName || submission.user_id);
              return (
                <article key={submission.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                  <div>
                    <h4 className="font-bold">{driverName} · {String(payload.month)}/{String(payload.year)}</h4>
                    <p className="mt-1 text-xs text-slate-400">
                      {recordedDays} recorded day{recordedDays === 1 ? "" : "s"} · {files.length} file{files.length === 1 ? "" : "s"} · Submitted {new Date(submission.submitted_at).toLocaleString()}
                    </p>
                    {payload.notes ? <p className="mt-1 text-xs text-slate-500">{String(payload.notes)}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${submission.status === "Submitted" ? "bg-emerald-500/15 text-emerald-300" : submission.status === "Resolved" ? "bg-slate-700 text-slate-200" : "bg-amber-500/15 text-amber-200"}`}>
                      {submission.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedDriverSubmission(submission)}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                    >
                      View details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Saved audit records</h3>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAudits()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Refresh
          </button>
        </div>
        {loading ? (
          <p role="status" className="text-sm text-slate-300">Loading audits…</p>
        ) : audits.length === 0 ? (
          <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No audit records have been saved yet.</p>
        ) : (
          <div className="space-y-3">
            {audits.map((audit) => {
              const payload = (audit.payload ?? {}) as Partial<AuditPayload>;
              return (
                <article
                  key={audit.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white"
                >
                  <div>
                    <h4 className="font-bold">
                      {payload.driverName || "Unknown driver"} · {payload.month}/{payload.year}
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      Audited {dateLabel(payload.auditDate)} · Saved {dateLabel(audit.submitted_at)}
                    </p>
                  </div>
                  <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-bold text-indigo-300">
                    {payload.dayAudits?.filter((day: any) => day.status === "Breach Found" || day.status === "Non-compliant").length ?? 0} breaches found
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedDriverSubmission ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 text-white">
            {(() => {
              const submission = selectedDriverSubmission;
              const payload = (submission.payload ?? {}) as Record<string, any>;
              const files = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];
              const response = String(payload.driverResponse ?? payload.adminFeedbackResponse ?? payload.feedbackResponse ?? "").trim();
              const requestedFiles = Array.isArray(payload.requestedFiles)
                ? payload.requestedFiles
                : Array.isArray(payload.requestedDocuments)
                  ? payload.requestedDocuments
                  : [];
              const days = Array.isArray(payload.days) ? payload.days : [];
              const driverName = driverSubmissionNames[String(submission.user_id)] || String(payload.driverName || submission.user_id);
              return (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold">Driver work record submission</h3>
                      <p className="mt-1 text-sm text-slate-400">{driverName} · {String(payload.month)}/{String(payload.year)}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedDriverSubmission(null)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">Close</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-900 p-3">
                      <p className="text-xs uppercase text-slate-400">Status</p>
                      <p className="mt-1 font-semibold">{submission.status}</p>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <p className="text-xs uppercase text-slate-400">Submitted</p>
                      <p className="mt-1 font-semibold">{new Date(submission.submitted_at).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <p className="text-xs uppercase text-slate-400">Recorded days</p>
                      <p className="mt-1 font-semibold">{days.filter((day: any) => String(day.hoursWorked ?? "").trim() !== "" || String(day.restHours ?? "").trim() !== "").length}</p>
                    </div>
                  </div>
                  {payload.notes ? (
                    <div>
                      <h4 className="font-semibold">Notes</h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{String(payload.notes)}</p>
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-indigo-500/20 bg-slate-900 p-4">
                    <h4 className="font-semibold">Driver response to Admin feedback</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
                      {response || "No response submitted."}
                    </p>
                    <h5 className="mt-4 text-sm font-semibold">Requested documents</h5>
                    {requestedFiles.length ? (
                      <ul className="mt-2 space-y-2">
                        {requestedFiles.map((file: any, index: number) => (
                          <li key={file.path ?? index}>
                            <button
                              type="button"
                              onClick={() => void openDriverSubmissionFile(String(file.path))}
                              className="text-sm text-indigo-300 hover:underline"
                            >
                              {String(file.name || "Requested document")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">No requested documents uploaded.</p>
                    )}
                  </div>
                  <div>
                    <h4 className="font-semibold">Daily work/rest records</h4>
                    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-700">
                      <table className="min-w-full text-sm text-white">
                        <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-left">Day</th>
                            <th className="px-3 py-2 text-left">Hours worked</th>
                            <th className="px-3 py-2 text-left">Rest hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {days.length ? days.map((day: any) => (
                            <tr key={day.day} className="border-t border-slate-700">
                              <td className="px-3 py-2 font-medium">{day.day}</td>
                              <td className="px-3 py-2">{day.hoursWorked === "" || day.hoursWorked == null ? "—" : day.hoursWorked}</td>
                              <td className="px-3 py-2">{day.restHours === "" || day.restHours == null ? "—" : day.restHours}</td>
                            </tr>
                          )) : (
                            <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400">No daily records submitted.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold">Uploaded files</h4>
                    {files.length === 0 ? (
                      <p className="mt-1 text-sm text-slate-400">No files uploaded.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {files.map((file: any) => (
                          <li key={file.path} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
                            <button type="button" onClick={() => void openDriverSubmissionFile(String(file.path))} className="truncate text-left text-indigo-300 hover:underline">
                              {String(file.name)}
                            </button>
                            <span className="text-xs text-slate-500">{Math.round(Number(file.size || 0) / 1024)} KB</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export const DriverFatigueWorkRecordAudit = DriverFatigueWorkRecordAuditInformation;
export const DriverFatigueWorkRecordAuditAdmin = DriverFatigueWorkRecordAuditInformation;
export const DriverFatigueWorkRecordAuditInformationAdmin = DriverFatigueWorkRecordAuditInformation;
