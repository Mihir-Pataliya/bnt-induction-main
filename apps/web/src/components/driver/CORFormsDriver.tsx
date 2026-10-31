import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { CorFormSubmission, SessionState } from "../../types";
import { ClipboardList, FileText, ArrowRight, CheckCircle2, X } from "lucide-react";

interface CORFormsDriverProps {
  session: SessionState;
  driverName: string;
  onNavigateTab?: (tab: string) => void;
}

const INDUCTION_CHECKLIST_ITEMS = [
  "Chain of Responsibility responsibilities explained",
  "Fatigue management policy reviewed",
  "Load restraint requirements reviewed",
  "Speed and compliance requirements reviewed",
  "Vehicle pre-start and defect reporting reviewed",
  "Incident and hazard reporting reviewed",
  "Site safety and PPE requirements reviewed",
];

export function CORFormsDriver({ session, driverName, onNavigateTab }: CORFormsDriverProps) {
  const { t } = useTranslation();
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CorFormSubmission[]>([]);
  const [completedItems, setCompletedItems] = useState<string[]>([]);

  useEffect(() => {
    api.getCorFormSubmissions(session.user.id)
      .then(setSubmissions)
      .catch(() => setSubmissions([]));
  }, [session.user.id]);

  const forms = [
    { code: "F-01", title: "Incident Report", description: "Report accidents, injuries and other incidents.", kind: "navigate" as const, tab: "incidents" },
    { code: "F-02", title: "Hazard / Near Miss Report", description: "Report hazards and near misses before they become incidents.", kind: "navigate" as const, tab: "incidents" },
    { code: "F-03", title: "Vehicle Pre-Start Checklist", description: "Complete the daily heavy vehicle walk-around inspection.", kind: "navigate" as const, tab: "pretrip" },
    { code: "F-04", title: "Defect Report & Rectification", description: "Report and track vehicle defects and rectification.", kind: "form" as const },
    { code: "F-05", title: "Take 5 / JSA", description: "Job safety analysis before starting a task.", kind: "form" as const },
    { code: "F-08", title: "Driver Induction Checklist", description: "Confirm induction topics have been covered.", kind: "form" as const },
    { code: "F-09", title: "Fatigue / Fitness Declaration", description: "Declare fitness for duty before commencing work.", kind: "form" as const },
  ];

  const openForm = (code: string) => {
    setActiveForm(code);
    setFormData(code === "F-09" ? { fitForDuty: true } : {});
    setCompletedItems([]);
    setMessage(null);
  };

  const closeForm = () => {
    setActiveForm(null);
    setFormData({});
    setCompletedItems([]);
  };

  const updateField = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeForm) return;
    const form = forms.find((item) => item.code === activeForm);
    if (!form) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const payload = activeForm === "F-08" ? { completedItems, ...formData } : formData;
      const saved = await api.saveCorFormSubmission(session.user.id, {
        formCode: activeForm,
        formTitle: form.title,
        payload,
      });
      setSubmissions((prev) => [saved, ...prev]);
      setMessage("Form submitted successfully.");
      closeForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderFormFields = () => {
    switch (activeForm) {
      case "F-04":
        return (
          <>
            <label className="block text-sm">Vehicle registration<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.vehicleRego || "")} onChange={(e) => updateField("vehicleRego", e.target.value)} required /></label>
            <label className="block text-sm">Defect severity<select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.defectSeverity || "Minor")} onChange={(e) => updateField("defectSeverity", e.target.value)}><option>Critical</option><option>Major</option><option>Minor</option></select></label>
            <label className="block text-sm">Defect description<textarea className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.defectDescription || "")} onChange={(e) => updateField("defectDescription", e.target.value)} required /></label>
            <label className="block text-sm">Immediate action taken<textarea className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.immediateAction || "")} onChange={(e) => updateField("immediateAction", e.target.value)} /></label>
          </>
        );
      case "F-05":
        return (
          <>
            <label className="block text-sm">Task / job<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.task || "")} onChange={(e) => updateField("task", e.target.value)} required /></label>
            <label className="block text-sm">Location<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.location || "")} onChange={(e) => updateField("location", e.target.value)} required /></label>
            <label className="block text-sm">Hazards identified<textarea className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.hazards || "")} onChange={(e) => updateField("hazards", e.target.value)} required /></label>
            <label className="block text-sm">Controls / safe work steps<textarea className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.controls || "")} onChange={(e) => updateField("controls", e.target.value)} required /></label>
            <label className="block text-sm">PPE required<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.ppe || "")} onChange={(e) => updateField("ppe", e.target.value)} /></label>
            <label className="block text-sm">Signature<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.signature || driverName)} onChange={(e) => updateField("signature", e.target.value)} required /></label>
          </>
        );
      case "F-08":
        return (
          <>
            <div className="space-y-2">
              {INDUCTION_CHECKLIST_ITEMS.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={completedItems.includes(item)} onChange={(e) => {
                    setCompletedItems((prev) => e.target.checked ? [...prev, item] : prev.filter((value) => value !== item));
                  }} />
                  {item}
                </label>
              ))}
            </div>
            <label className="block text-sm mt-3">Additional notes<textarea className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.notes || "")} onChange={(e) => updateField("notes", e.target.value)} /></label>
            <label className="block text-sm">Signature<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.signature || driverName)} onChange={(e) => updateField("signature", e.target.value)} required /></label>
          </>
        );
      case "F-09":
        return (
          <>
            <label className="block text-sm">Hours slept in last 24 hours<input type="number" min="0" max="24" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.hoursSlept || "")} onChange={(e) => updateField("hoursSlept", e.target.value)} required /></label>
            <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={Boolean(formData.fitForDuty)} onChange={(e) => updateField("fitForDuty", e.target.checked)} /> I am fit for duty and free from fatigue.</label>
            <label className="block text-sm">Medications / conditions affecting fitness<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.medication || "None")} onChange={(e) => updateField("medication", e.target.value)} /></label>
            <label className="block text-sm">Signature<input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" value={String(formData.signature || driverName)} onChange={(e) => updateField("signature", e.target.value)} required /></label>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <ClipboardList className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-bold text-white">COR Forms</h2>
      </div>
      {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {forms.map((form) => (
          <div key={form.code} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-emerald-300">{form.code}</p>
                <h3 className="text-sm font-bold text-white">{form.title}</h3>
                <p className="mt-1 text-xs text-slate-400">{form.description}</p>
              </div>
              {form.kind === "navigate" ? (
                <button type="button" onClick={() => onNavigateTab?.(form.tab!)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                  Open <ArrowRight className="w-3 h-3" />
                </button>
              ) : (
                <button type="button" onClick={() => openForm(form.code)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                  Complete <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {activeForm && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">{activeForm} - {forms.find((f) => f.code === activeForm)?.title}</h3>
            <button type="button" onClick={closeForm} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {renderFormFields()}
            <button type="submit" disabled={submitting} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h3 className="text-sm font-bold text-white mb-2">Recent submissions</h3>
        {submissions.length === 0 ? (
          <p className="text-xs text-slate-400">No submissions yet.</p>
        ) : (
          <ul className="space-y-2">
            {submissions.slice(0, 10).map((submission) => (
              <li key={submission.id} className="flex items-center justify-between text-xs text-slate-300">
                <span>{submission.formCode} - {submission.formTitle}</span>
                <span className="text-slate-500">{submission.status} - {new Date(submission.submittedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
