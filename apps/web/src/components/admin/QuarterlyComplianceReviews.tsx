import { useCallback, useEffect, useState } from "react";
import { Download, FilePlus2, Loader2, Pencil, Save, Send, ShieldCheck, Upload, X } from "lucide-react";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import {
  QuarterlyComplianceReview,
  QuarterlyReviewAcknowledgement,
  QuarterlyReviewCompanyDetails,
  QuarterlyReviewSection,
  SessionState
} from "../../types";

const QUARTER_OPTIONS: { value: QuarterlyComplianceReview["review_quarter"]; label: string }[] = [
  { value: "Q1", label: "January, February, March" },
  { value: "Q2", label: "April, May, June" },
  { value: "Q3", label: "July, August, September" },
  { value: "Q4", label: "October, November, December" }
];

const SECTION_TEMPLATES: Array<{ id: string; title: string; fields: Record<string, any> }> = [
  { id: "company_details", title: "Company Details", fields: { operator: "", abn: "", year: new Date().getFullYear(), compliancePeriod: "Q1" } },
  { id: "load_information", title: "Load Information", fields: { vehiclesInFleet: 0, totalTrips: 0, overweightTrips: 0, offRouteTrips: 0, onTimeTrips: 0 } },
  { id: "defects_infringements_incidents", title: "Defects, Infringements and Incidents", fields: { defects: 0, infringements: 0, onRoadIncidents: 0 } },
  { id: "non_conformance_reports", title: "Non-Conformance Reports", fields: { totalNcrs: 0, attachments: [] as string[] } },
  { id: "weight_calibration_verification", title: "Weight Calibration / Verification", fields: { calibrationCompleted: 0, calibrationNotCompleted: 0 } },
  { id: "daily_pre_start_inspections", title: "Daily Pre-Start Inspections", fields: { dailyChecksCompleted: 0, dailyChecksMissed: 0 } },
  { id: "vehicle_servicing", title: "Vehicle Servicing", fields: { scheduledServicesCompleted: 0, scheduledServicesNotCompleted: 0 } },
  { id: "fault_repairs", title: "Fault Repairs", fields: { totalFaultReports: 0, faultRepairsNotCompleted: 0 } },
  { id: "inductions_fatigue_audits", title: "Inductions and Fatigue Audits", fields: { totalEmployees: 0, newInductions: 0, workDiaryPagesChecked: 0, nonCompliantWorkRestHours: 0, medicalsOnTime: 0 } },
  { id: "other_key_performance_indicators", title: "Other Key Performance Indicators", fields: { speedBreaches: 0, drugAlcoholTests: 0, compliments: 0, complaints: 0, recurringClients: 0 } },
  { id: "comments_acknowledgement", title: "Comments and Acknowledgement", fields: { comments: "" } }
];

type ReviewInput = {
  quarter: QuarterlyComplianceReview["review_quarter"];
  year: number;
  companyDetails: QuarterlyReviewCompanyDetails;
  sections: QuarterlyReviewSection[];
  acknowledgement: QuarterlyReviewAcknowledgement;
};

const emptyCompany: QuarterlyReviewCompanyDetails = { operator: "", abn: "" };

function currentQuarter(): QuarterlyComplianceReview["review_quarter"] {
  return `Q${Math.floor(new Date().getMonth() / 3) + 1}` as QuarterlyComplianceReview["review_quarter"];
}

function newSections(): QuarterlyReviewSection[] {
  return SECTION_TEMPLATES.map((template) => ({
    id: template.id,
    title: template.title,
    ...template.fields
  }));
}

function newReviewInput(): ReviewInput {
  return {
    quarter: currentQuarter(),
    year: new Date().getFullYear(),
    companyDetails: { ...emptyCompany },
    sections: newSections(),
    acknowledgement: { name: "", role: "", signature: "", date: "" }
  };
}

function sectionById(sections: QuarterlyReviewSection[], id: string): QuarterlyReviewSection | undefined {
  return sections.find((section) => section.id === id);
}

function inputFromReview(review: QuarterlyComplianceReview): ReviewInput {
  const sections = SECTION_TEMPLATES.map((template) => {
    const section = review.section_data.find((item) => item.id === template.id);
    return {
      id: template.id,
      title: template.title,
      ...template.fields,
      ...(section ?? {})
    };
  });
  const companySection = sectionById(sections, "company_details");
  return {
    quarter: review.review_quarter,
    year: review.review_year,
    companyDetails: {
      operator: String(review.company_details?.operator || review.company_details?.name || companySection?.operator || ""),
      abn: String(review.company_details?.abn || review.company_details?.abnAcn || companySection?.abn || "")
    },
    sections,
    acknowledgement: {
      name: review.acknowledgement?.name ?? "",
      role: review.acknowledgement?.role ?? "",
      signature: review.acknowledgement?.signature ?? "",
      date: review.acknowledgement?.date ?? ""
    }
  };
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-AU") : "Not submitted";
}

function validateReviewForSubmission(form: ReviewInput): string[] {
  const issues: string[] = [];
  if (!form.companyDetails.operator.trim()) issues.push("Enter the operator.");
  if (!form.companyDetails.abn.trim()) issues.push("Enter the ABN/ACN.");
  const ack = form.acknowledgement;
  if (!ack.name.trim()) issues.push("Enter the acknowledging person's name.");
  if (!ack.role.trim()) issues.push("Enter the role in company.");
  if (!ack.date.trim()) issues.push("Select the acknowledgement date.");
  return issues;
}

function updateSection(form: ReviewInput, id: string, patch: Record<string, any>): ReviewInput {
  return {
    ...form,
    sections: form.sections.map((section) => (section.id === id ? { ...section, ...patch } : section))
  };
}

const numberInputClass = "w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none";
const inputClass = "w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none";
const labelClass = "space-y-1 text-sm font-semibold text-slate-200";
const actionClass = "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60";

export function QuarterlyComplianceReviews({ session }: { session: SessionState }): any {
  const [reviews, setReviews] = useState<QuarterlyComplianceReview[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReviews(await api.getQuarterlyComplianceReviews(session));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load quarterly reviews.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadReviews();
  }, [session, loadReviews]);

  const beginNew = useCallback(() => {
    setError("");
    setMessage("");
    setValidationErrors([]);
    setEditingId(null);
    setForm(newReviewInput());
  }, []);

  const beginEdit = (review: QuarterlyComplianceReview) => {
    setError("");
    setMessage("");
    setValidationErrors([]);
    setEditingId(review.id);
    setForm(inputFromReview(review));
  };

  const setCompany = (field: keyof QuarterlyReviewCompanyDetails, value: string) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    const next = { ...form, companyDetails: { ...form.companyDetails, [field]: value } };
    const cs = sectionById(next.sections, "company_details");
    if (cs) {
      if (field === "operator") cs.operator = value;
      if (field === "abn") cs.abn = value;
    }
    setForm(next);
  };

  const setQuarter = (value: QuarterlyComplianceReview["review_quarter"]) => {
    if (!form) return;
    setForm({ ...form, quarter: value });
    const cs = sectionById(form.sections, "company_details");
    if (cs) cs.compliancePeriod = value;
  };

  const setYear = (value: number) => {
    if (!form) return;
    setForm({ ...form, year: value });
    const cs = sectionById(form.sections, "company_details");
    if (cs) cs.year = value;
  };

  const setAcknowledgement = (field: keyof QuarterlyReviewAcknowledgement, value: string) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({ ...form, acknowledgement: { ...form.acknowledgement, [field]: value } });
  };

  const setField = (sectionId: string, field: string, value: any) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm(updateSection(form, sectionId, { [field]: value }));
    if (sectionId === "company_details") {
      if (field === "operator") setForm((current) => current ? { ...current, companyDetails: { ...current.companyDetails, operator: value } } : current);
      if (field === "abn") setForm((current) => current ? { ...current, companyDetails: { ...current.companyDetails, abn: value } } : current);
    }
  };

  const uploadAttachment = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const path = `quarterly-reviews/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("driver-documents").upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;
      const section = sectionById(form!.sections, "non_conformance_reports");
      const current = Array.isArray(section?.attachments) ? section.attachments : [];
      setForm((currentForm) => currentForm ? updateSection(currentForm, "non_conformance_reports", { attachments: [...current, path] }) : currentForm);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachment.");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (path: string) => {
    if (!form) return;
    const section = sectionById(form.sections, "non_conformance_reports");
    const current = Array.isArray(section?.attachments) ? section.attachments : [];
    setForm(updateSection(form, "non_conformance_reports", { attachments: current.filter((item) => item !== path) }));
  };

  const saveDraft = async (input: ReviewInput) => {
    if (!input) throw new Error("Start a review before saving.");
    const payload = {
      quarter: input.quarter,
      year: input.year,
      companyDetails: { operator: input.companyDetails.operator, abn: input.companyDetails.abn, abnAcn: input.companyDetails.abn, name: input.companyDetails.operator, year: input.year, compliancePeriod: QUARTER_OPTIONS.find((q) => q.value === input.quarter)?.label },
      sections: input.sections,
      acknowledgement: input.acknowledgement
    };
    return editingId
      ? await api.updateQuarterlyComplianceDraft(session, editingId, payload)
      : await api.createQuarterlyComplianceReview(session, payload);
  };

  const handleSaveDraft = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    setMessage("");
    setValidationErrors([]);
    try {
      const saved = await saveDraft(form);
      setEditingId(saved.id);
      setReviews((current) => [saved, ...current.filter((review) => review.id !== saved.id)]);
      setMessage("Draft saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the review.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!form) return;
    const issues = validateReviewForSubmission(form);
    if (issues.length > 0) {
      setValidationErrors(issues);
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setValidationErrors([]);
    try {
      const draft = await saveDraft(form);
      const submitted = await api.submitQuarterlyComplianceReview(session, draft.id, {
        quarter: form.quarter,
        year: form.year,
        companyDetails: { operator: form.companyDetails.operator, abn: form.companyDetails.abn, abnAcn: form.companyDetails.abn, name: form.companyDetails.operator, year: form.year, compliancePeriod: QUARTER_OPTIONS.find((q) => q.value === form.quarter)?.label },
        sections: form.sections,
        acknowledgement: form.acknowledgement
      });
      setReviews((current) => [submitted, ...current.filter((review) => review.id !== submitted.id)]);
      setEditingId(null);
      setForm(null);
      setMessage("Quarterly compliance review submitted and locked.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit the review.");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (review: QuarterlyComplianceReview) => {
    setSaving(true);
    setError("");
    try {
      const blob = await api.downloadQuarterlyCompliancePdf(session, review.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `BNT-Quarterly-Review-${review.review_quarter}-${review.review_year}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download the PDF.");
    } finally {
      setSaving(false);
    }
  };

  const renderNumberField = (sectionId: string, field: string, label: string) => {
    const section = sectionById(form!.sections, sectionId)!;
    return (
      <label className={labelClass} key={field}>
        {label}
        <input
          type="number"
          min={0}
          value={Number(section[field] ?? 0)}
          onChange={(event) => setField(sectionId, field, event.target.value === "" ? 0 : Number(event.target.value))}
          className={numberInputClass}
        />
      </label>
    );
  };

  if (!form) {
    return (
      <section className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black"><ShieldCheck className="h-5 w-5 text-emerald-400" /> Quarterly Compliance Review</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">Complete the quarterly company review. Drafts remain editable; submitted reviews are locked and retained for at least three years.</p>
          </div>
          <button type="button" onClick={beginNew} className={`${actionClass} bg-emerald-600 text-white hover:bg-emerald-500`}><FilePlus2 className="h-4 w-4" /> New review</button>
        </header>
        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-white">Saved reviews</h3><button type="button" disabled={loading} onClick={() => void loadReviews()} className={`${actionClass} border border-slate-600 text-slate-200 hover:bg-slate-800`}>Refresh</button></div>
          {loading ? <p role="status" className="text-sm text-slate-300">Loading reviews…</p> : reviews.length === 0 ? <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No quarterly reviews have been created yet.</p> : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <article key={review.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                  <div>
                    <h4 className="font-bold">{review.review_quarter} {review.review_year} · {review.company_details?.operator || review.company_details?.name || "Company details not entered"}</h4>
                    <p className="mt-1 text-xs text-slate-400">Updated {dateLabel(review.updated_at)}{review.status === "submitted" ? ` · Submitted ${dateLabel(review.submitted_at)}` : " · Draft"}</p>
                    {review.retention_expires_at && <p className="mt-1 text-xs text-slate-500">Retained until at least {dateLabel(review.retention_expires_at)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${review.status === "submitted" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>{review.status.toUpperCase()}</span>
                    {review.status === "draft" ? (
                      <button type="button" onClick={() => beginEdit(review)} className={`${actionClass} border border-slate-600 text-slate-200 hover:bg-slate-800`}><Pencil className="h-4 w-4" /> Edit draft</button>
                    ) : (
                      <button type="button" disabled={saving} onClick={() => void downloadPdf(review)} className={`${actionClass} bg-indigo-600 text-white hover:bg-indigo-500`}><Download className="h-4 w-4" /> PDF report</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    );
  }

  const companySection = sectionById(form.sections, "company_details")!;
  const loadSection = sectionById(form.sections, "load_information")!;
  const defectsSection = sectionById(form.sections, "defects_infringements_incidents")!;
  const ncrSection = sectionById(form.sections, "non_conformance_reports")!;
  const weightSection = sectionById(form.sections, "weight_calibration_verification")!;
  const dailySection = sectionById(form.sections, "daily_pre_start_inspections")!;
  const servicingSection = sectionById(form.sections, "vehicle_servicing")!;
  const faultSection = sectionById(form.sections, "fault_repairs")!;
  const inductionSection = sectionById(form.sections, "inductions_fatigue_audits")!;
  const otherSection = sectionById(form.sections, "other_key_performance_indicators")!;
  const commentsSection = sectionById(form.sections, "comments_acknowledgement")!;
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black"><ShieldCheck className="h-5 w-5 text-emerald-400" /> Quarterly Compliance Review</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">Complete the quarterly company review. Drafts remain editable; submitted reviews are locked and retained for at least three years.</p>
        </div>
      </header>
      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {validationErrors.length > 0 && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"><ul className="list-disc space-y-1 pl-5">{validationErrors.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}

      <div className="space-y-6">
        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">1. Company Details</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClass}>Operator
              <input value={form.companyDetails.operator} onChange={(e) => setCompany("operator", e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>ABN/ACN
              <input value={form.companyDetails.abn} onChange={(e) => setCompany("abn", e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>Year
              <input type="number" min={2000} max={2200} value={form.year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass} />
            </label>
            <label className={labelClass}>Compliance Period
              <select value={form.quarter} onChange={(e) => setQuarter(e.target.value as any)} className={inputClass}>
                {QUARTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">2. Load Information</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("load_information", "vehiclesInFleet", "Number of vehicles in fleet, including trailers and subcontractors' vehicles")}
            {renderNumberField("load_information", "totalTrips", "Total trips completed")}
            {renderNumberField("load_information", "overweightTrips", "Total trips overweight to relevant mass limits")}
            {renderNumberField("load_information", "offRouteTrips", "Total trips detected off route")}
            {renderNumberField("load_information", "onTimeTrips", "Total trips delivered on time")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">3. Defects, Infringements and Incidents</legend>
          <div className="grid gap-4 md:grid-cols-3">
            {renderNumberField("defects_infringements_incidents", "defects", "Number of defects")}
            {renderNumberField("defects_infringements_incidents", "infringements", "Number of infringements")}
            {renderNumberField("defects_infringements_incidents", "onRoadIncidents", "Number of on-road incidents")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">4. Non-Conformance Reports</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("non_conformance_reports", "totalNcrs", "Total number of Non-Conformance Reports completed for incidents, near misses, breaches, etc.")}
            <div className="space-y-2">
              <span className="text-sm font-semibold text-slate-200">Attach relevant reports where available</span>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">
                <Upload className="h-4 w-4" /> Upload report
                <input type="file" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAttachment(file); e.currentTarget.value = ""; }} />
              </label>
              {uploading && <p className="text-xs text-slate-400">Uploading…</p>}
              {Array.isArray(ncrSection.attachments) && ncrSection.attachments.length > 0 && (
                <ul className="space-y-1 text-sm text-slate-300">
                  {ncrSection.attachments.map((path: string) => (
                    <li key={path} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 px-3 py-2">
                      <span className="truncate">{String(path).split("/").pop()}</span>
                      <button type="button" onClick={() => removeAttachment(path)} className="text-slate-400 hover:text-red-300"><X className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">5. Weight Calibration / Verification</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("weight_calibration_verification", "calibrationCompleted", "Number of weight calibration/verification reports completed")}
            {renderNumberField("weight_calibration_verification", "calibrationNotCompleted", "Number not completed")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">6. Daily Pre-Start Inspections</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("daily_pre_start_inspections", "dailyChecksCompleted", "Total daily checks completed")}
            {renderNumberField("daily_pre_start_inspections", "dailyChecksMissed", "Total daily checks not completed (missed pre-starts)")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">7. Vehicle Servicing</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("vehicle_servicing", "scheduledServicesCompleted", "Total scheduled vehicle services completed")}
            {renderNumberField("vehicle_servicing", "scheduledServicesNotCompleted", "Total scheduled vehicle services not completed")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">8. Fault Repairs</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("fault_repairs", "totalFaultReports", "Total fault reports")}
            {renderNumberField("fault_repairs", "faultRepairsNotCompleted", "Total fault repairs not completed, excluding correctly deferred repairs")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">9. Inductions and Fatigue Audits</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("inductions_fatigue_audits", "totalEmployees", "Total company employees, including drivers")}
            {renderNumberField("inductions_fatigue_audits", "newInductions", "Total new company inductions completed")}
            {renderNumberField("inductions_fatigue_audits", "workDiaryPagesChecked", "Total work diary pages/local work records checked")}
            {renderNumberField("inductions_fatigue_audits", "nonCompliantWorkRestHours", "Total non-compliant work and rest hours")}
            {renderNumberField("inductions_fatigue_audits", "medicalsOnTime", "Number of driver medicals provided on time")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">10. Other Key Performance Indicators</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {renderNumberField("other_key_performance_indicators", "speedBreaches", "Number of speed breaches detected")}
            {renderNumberField("other_key_performance_indicators", "drugAlcoholTests", "Number of drug and alcohol tests completed")}
            {renderNumberField("other_key_performance_indicators", "compliments", "Number of customer/client/community compliments")}
            {renderNumberField("other_key_performance_indicators", "complaints", "Number of customer/client/community complaints")}
            {renderNumberField("other_key_performance_indicators", "recurringClients", "Total number of recurring clients/customers")}
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <legend className="px-2 text-lg font-bold">11. Comments and Acknowledgement</legend>
          <label className={labelClass}>Comments
            <textarea value={String(commentsSection.comments ?? "")} onChange={(e) => setField("comments_acknowledgement", "comments", e.target.value)} className={inputClass} rows={4} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClass}>Acknowledging person's name
              <input value={form.acknowledgement.name} onChange={(e) => setAcknowledgement("name", e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>Role in company
              <input value={form.acknowledgement.role} onChange={(e) => setAcknowledgement("role", e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>Signature
              <input value={form.acknowledgement.signature} onChange={(e) => setAcknowledgement("signature", e.target.value)} className={`${inputClass} font-serif italic`} maxLength={200} placeholder="Type full name only if provided" />
            </label>
            <label className={labelClass}>Date
              <input type="date" value={form.acknowledgement.date} onChange={(e) => setAcknowledgement("date", e.target.value)} className={inputClass} />
            </label>
          </div>
          <p className="text-xs text-slate-400">Signature is stored only when actually provided. No signature is generated automatically.</p>
        </fieldset>

        <div className="flex flex-wrap gap-3 border-t border-slate-700 pt-4">
          <button type="button" disabled={saving} onClick={() => void handleSaveDraft()} className={`${actionClass} bg-slate-700 text-white hover:bg-slate-600`}><Save className="h-4 w-4" /> Save draft</button>
          <button type="button" disabled={saving} onClick={() => void handleSubmit()} className={`${actionClass} bg-emerald-600 text-white hover:bg-emerald-500`}><Send className="h-4 w-4" /> Submit review</button>
          {saving && <span role="status" className="self-center text-sm text-slate-400"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Saving…</span>}
        </div>
      </div>
    </section>
  );
}