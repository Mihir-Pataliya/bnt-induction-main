"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FilePlus2, Loader2, Plus, Pencil, Save, Send, ShieldCheck, AlertTriangle, CheckCircle2, Minus } from "lucide-react";
import { api } from "../../lib/api";
import {
  AnnualSystemReview,
  AnnualSystemReviewAcknowledgement,
  AnnualSystemReviewCompanyDetails,
  AnnualSystemReviewFollowUp,
  AnnualSystemReviewRequirement,
  SessionState
} from "../../types";

const RESPONSE_OPTIONS: { value: AnnualSystemReviewRequirement["status"]; label: string; icon: React.ElementType }[] = [
  { value: "yes", label: "Yes", icon: CheckCircle2 },
  { value: "needs_actioning", label: "Needs Actioning", icon: AlertTriangle },
  { value: "not_applicable", label: "Not Applicable", icon: Minus }
] as const;

const REQUIREMENT_TEMPLATES: { id: string; title: string }[] = [
  { id: "req-1", title: "Speed compliance — vehicles operate within legal speed limits at all times." },
  { id: "req-2", title: "Mass and dimension — loads comply with legal mass and dimension limits." },
  { id: "req-3", title: "Fatigue management — drivers adhere to prescribed work and rest hours." },
  { id: "req-4", title: "Vehicle maintenance — vehicles are maintained in safe, roadworthy condition." },
  { id: "req-5", title: "Load restraint — all loads are properly restrained and secured for transport." },
  { id: "req-6", title: "Driver licensing — all drivers hold current, appropriate licences for the vehicle class." },
  { id: "req-7", title: "Drug and alcohol — testing and management program is in place and current." },
  { id: "req-8", title: "Chain of Responsibility policies — current COR policies are documented and communicated." },
  { id: "req-9", title: "Training and competency — staff are trained on their Chain of Responsibility obligations." },
  { id: "req-10", title: "Incident reporting — incidents, hazards and near misses are reported and recorded." },
  { id: "req-11", title: "Corrective actions — identified corrective actions are closed out on time." },
  { id: "req-12", title: "Speed limiting devices — fitted and functional where required." },
  { id: "req-13", title: "Driver work diaries — work diaries are accurately completed and retained." },
  { id: "req-14", title: "Vehicle defects — defects are recorded, reported and repaired in a timely manner." },
  { id: "req-15", title: "Loading and unloading — safe loading/unloading procedures are followed at all sites." },
  { id: "req-16", title: "Contractor management — subcontractors comply with Chain of Responsibility requirements." },
  { id: "req-17", title: "Depot safety — site safety procedures are in place at all depots and facilities." },
  { id: "req-18", title: "Emergency procedures — emergency response plans are current and tested." },
  { id: "req-19", title: "Records management — compliance records are maintained and available for audit." },
  { id: "req-20", title: "Management review — regular management review of the Chain of Responsibility system occurs." }
] as const;

type ReviewInput = {
  reviewYear: number;
  companyDetails: AnnualSystemReviewCompanyDetails;
  requirements: AnnualSystemReviewRequirement[];
  followUp: AnnualSystemReviewFollowUp[];
  acknowledgement: AnnualSystemReviewAcknowledgement;
};

const emptyCompany: AnnualSystemReviewCompanyDetails = {
  companyName: "",
  abn: "",
  address: "",
  contactName: "",
  email: "",
  phone: ""
};

function currentYear(): number {
  return new Date().getFullYear();
}

function newReviewInput(): ReviewInput {
  return {
    reviewYear: currentYear(),
    companyDetails: { ...emptyCompany },
    requirements: REQUIREMENT_TEMPLATES.map((t) => ({
      ...t,
      status: "not_applicable",
      notes: ""
    })),
    followUp: [],
    acknowledgement: { reviewerName: "", companyRole: "", signature: "", reviewDate: "" }
  };
}

function inputFromReview(review: AnnualSystemReview): ReviewInput {
  return {
    reviewYear: review.review_year,
    companyDetails: { ...emptyCompany, ...review.company_details },
    requirements: REQUIREMENT_TEMPLATES.map((template) => {
      const item = review.requirements.find((r) => r.id === template.id);
      return {
        ...template,
        status: item?.status ?? "not_applicable",
        notes: item?.notes ?? ""
      };
    }),
    followUp: review.follow_up ?? [],
    acknowledgement: {
      reviewerName: review.acknowledgement?.reviewerName ?? "",
      companyRole: review.acknowledgement?.companyRole ?? "",
      signature: review.acknowledgement?.signature ?? "",
      reviewDate: review.acknowledgement?.reviewDate ?? ""
    }
  };
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-AU") : "Not submitted";
}

function validateReviewForSubmission(form: ReviewInput): string[] {
  const issues: string[] = [];

  const missingCompanyFields: [keyof AnnualSystemReviewCompanyDetails, string][] = [
    ["companyName", "company name"],
    ["abn", "ABN / registration number"],
    ["address", "business address"],
    ["contactName", "primary contact name"],
    ["email", "contact email"],
    ["phone", "contact phone"]
  ];
  for (const [field, label] of missingCompanyFields) {
    if (!String(form.companyDetails[field]).trim()) {
      issues.push(`Enter the ${label}.`);
    }
  }

  const unanswered = form.requirements.filter((r) => !r.status);
  if (unanswered.length > 0) {
    issues.push(`Please respond to all ${unanswered.length} requirement(s) before submitting.`);
  }

  const hasActioning = form.requirements.some((r) => r.status === "needs_actioning");
  if (hasActioning && form.followUp.length === 0) {
    issues.push("At least one requirement is marked 'Needs Actioning' — add a follow-up corrective action.");
  }

  const missingAck: [keyof AnnualSystemReviewAcknowledgement, string][] = [
    ["reviewerName", "reviewer name"],
    ["companyRole", "company role"],
    ["signature", "signature"],
    ["reviewDate", "review date"]
  ];
  for (const [field, label] of missingAck) {
    if (!String(form.acknowledgement[field]).trim()) {
      issues.push(`Enter the ${label} in the Review Completed section.`);
    }
  }

  return issues;
}

export function AnnualSystemReviewForm({ session }: { session: SessionState }) {
  const [reviews, setReviews] = useState<AnnualSystemReview[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      setReviews(await api.getAnnualSystemReviews(session));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load annual system reviews.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadReviews();
  }, [session, loadReviews]);

  const beginNew = useCallback(() => {
    setError("");
    setMessage("");
    setValidationErrors([]);
    setEditingId(null);
    setForm(newReviewInput());
  }, []);

  const beginEdit = (review: AnnualSystemReview) => {
    setError("");
    setMessage("");
    setValidationErrors([]);
    setEditingId(review.id);
    setForm(inputFromReview(review));
  };

  const setCompany = (field: keyof AnnualSystemReviewCompanyDetails, value: string) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({ ...form, companyDetails: { ...form.companyDetails, [field]: value } });
  };

  const setReviewYear = (value: number) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({ ...form, reviewYear: value });
  };

  const setRequirement = (id: string, field: keyof AnnualSystemReviewRequirement, value: string | undefined) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({
      ...form,
      requirements: form.requirements.map((r) =>
        r.id === id ? { ...r, [field]: value } : r
      )
    });
  };

  const addFollowUp = () => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({
      ...form,
      followUp: [...form.followUp, { id: crypto.randomUUID(), requirementId: "", correctiveAction: "", responsiblePerson: "", dueDate: "", status: "open" }]
    });
  };

  const setFollowUp = (index: number, field: keyof AnnualSystemReviewFollowUp, value: string) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    const next = [...form.followUp];
    next[index] = { ...next[index], [field]: value };
    setForm({ ...form, followUp: next });
  };

  const removeFollowUp = (index: number) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    const next = [...form.followUp];
    next.splice(index, 1);
    setForm({ ...form, followUp: next });
  };

  const setAcknowledgement = (field: keyof AnnualSystemReviewAcknowledgement, value: string) => {
    if (!form) return;
    setError("");
    setValidationErrors([]);
    setForm({ ...form, acknowledgement: { ...form.acknowledgement, [field]: value } });
  };

  const saveDraft = async (input = form) => {
    if (!input) return;
    setSaving(true);
    setError("");
    try {
      const result = editingId
        ? await api.updateAnnualSystemReviewDraft(session, editingId, input)
        : await api.createAnnualSystemReview(session, input);
      setMessage(editingId ? "Draft updated." : "Draft saved.");
      setEditingId(result.id);
      setForm(inputFromReview(result));
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!form) return;
    const issues = validateReviewForSubmission(form);
    if (issues.length > 0) {
      setValidationErrors(issues);
      setError(issues.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await api.submitAnnualSystemReview(session, editingId!, form);
      setMessage("Annual system review submitted and retained for audit.");
      setEditingId(result.id);
      setForm(inputFromReview(result));
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review.");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (review: AnnualSystemReview) => {
    setDownloading(review.id);
    try {
      const blob = await api.downloadAnnualSystemReviewPdf(session, review.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BNT-Annual-System-Review-${review.review_year}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage("PDF report downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF.");
    } finally {
      setDownloading(null);
    }
  };

  if (!form) {
    return (
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white">
        <h2 className="flex items-center gap-2 text-xl font-black">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          Chain of Responsibility (COR)
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          Annual System Review — Due December. Select an action below to begin.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={beginNew}
            className={`rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <FilePlus2 className="h-4 w-4 mr-2" /> New review draft
          </button>
        </div>
      </section>
    );
  }

  const actionClass = "rounded-xl px-3 py-1.5 text-xs font-semibold transition";

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Annual System Review — Due December
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Chain of Responsibility annual compliance review. All 20 requirements,
            follow-up actions and reviewer sign-off.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editingId ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDraft()}
                className={`${actionClass} bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-60`}
              >
                <Save className="h-4 w-4" /> Save draft
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSubmit}
                className={`${actionClass} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60`}
              >
                <Send className="h-4 w-4" /> Complete review
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={beginNew}
              className={`${actionClass} border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700`}
            >
              <FilePlus2 className="h-4 w-4" /> New draft
            </button>
          )}
          {error && (
            <span className="rounded-xl border border-red-900/50 bg-red-900/20 px-3 py-1.5 text-xs text-red-300">
              {error}
            </span>
          )}
          {message && (
            <span className="rounded-xl border border-emerald-900/50 bg-emerald-900/20 px-3 py-1.5 text-xs text-emerald-300">
              {message}
            </span>
          )}
        </div>
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <fieldset className="rounded-xl border border-slate-700 p-4">
          <legend className="px-2 text-sm font-bold text-slate-200">Company details</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Company name</label>
              <input
                value={form.companyDetails.companyName}
                onChange={(e) => setCompany("companyName", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">ABN / registration</label>
              <input
                value={form.companyDetails.abn}
                onChange={(e) => setCompany("abn", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Address</label>
              <input
                value={form.companyDetails.address}
                onChange={(e) => setCompany("address", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Contact name</label>
              <input
                value={form.companyDetails.contactName}
                onChange={(e) => setCompany("contactName", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Email</label>
              <input
                type="email"
                value={form.companyDetails.email}
                onChange={(e) => setCompany("email", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Phone</label>
              <input
                type="tel"
                value={form.companyDetails.phone}
                onChange={(e) => setCompany("phone", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Review year</label>
              <input
                type="number"
                min="2000"
                max="2200"
                value={form.reviewYear}
                onChange={(e) => setReviewYear(Number(e.target.value) || currentYear())}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-700 p-4">
          <legend className="px-2 text-sm font-bold text-slate-200">
            Annual System Review requirements (1–20)
          </legend>
          <div className="overflow-x-auto border border-slate-700 rounded-lg mt-3">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-600 bg-slate-800">
                  <th className="p-3 font-semibold text-slate-300">#</th>
                  <th className="p-3 font-semibold text-slate-300">Requirement</th>
                  <th className="p-3 font-semibold text-slate-300">Response</th>
                  <th className="p-3 font-semibold text-slate-300">Notes</th>
                </tr>
              </thead>
              <tbody>
                {form.requirements.map((req, index) => (
                  <tr key={req.id} className="border-b border-slate-700">
                    <td className="p-3 text-slate-400 font-mono">{index + 1}</td>
                    <td className="p-3 text-slate-200">{req.title}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {RESPONSE_OPTIONS.map((opt) => {
                          const selected = req.status === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setRequirement(req.id, "status", opt.value)}
                              className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                                selected
                                  ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                                  : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              <opt.icon className={`h-3.5 w-3.5 mr-1 ${selected ? "text-emerald-300" : "text-slate-400"}`} />
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="p-3">
                      <input
                        value={req.notes ?? ""}
                        onChange={(e) => setRequirement(req.id, "notes", e.target.value)}
                        placeholder="Notes…"
                        className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none w-full"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Mark each requirement as <span className="text-emerald-300">Yes</span>,
            <span className="text-amber-300">Needs Actioning</span> or
            <span className="text-slate-400">Not Applicable</span>. Items marked
            "Needs Actioning" require a follow-up corrective action below.
          </p>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-700 p-4">
          <legend className="px-2 text-sm font-bold text-slate-200">
            Follow Up — Corrective actions
          </legend>
          <div className="space-y-3 mt-3">
            {form.followUp.map((action, index) => (
              <div key={action.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block">Corrective action</label>
                    <input
                      value={action.correctiveAction}
                      onChange={(e) => setFollowUp(index, "correctiveAction", e.target.value)}
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block">Responsible person</label>
                    <input
                      value={action.responsiblePerson}
                      onChange={(e) => setFollowUp(index, "responsiblePerson", e.target.value)}
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block">Due date</label>
                    <input
                      type="date"
                      value={action.dueDate}
                      onChange={(e) => setFollowUp(index, "dueDate", e.target.value)}
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 block">Status</label>
                    <select
                      value={action.status}
                      onChange={(e) => setFollowUp(index, "status", e.target.value as any)}
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFollowUp(index)}
                  className="text-xs text-red-400 hover:text-red-300 underline"
                >
                  Remove action
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addFollowUp}
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add follow-up action
            </button>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-700 p-4">
          <legend className="px-2 text-sm font-bold text-slate-200">Review Completed</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Reviewer name</label>
              <input
                value={form.acknowledgement.reviewerName}
                onChange={(e) => setAcknowledgement("reviewerName", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Company role</label>
              <input
                value={form.acknowledgement.companyRole}
                onChange={(e) => setAcknowledgement("companyRole", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Signature</label>
              <input
                value={form.acknowledgement.signature}
                onChange={(e) => setAcknowledgement("signature", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-serif italic text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">Review date</label>
              <input
                type="date"
                value={form.acknowledgement.reviewDate}
                onChange={(e) => setAcknowledgement("reviewDate", e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            By completing, the named reviewer confirms this annual system review is
            accurate to the best of their knowledge.
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-3 border-t border-slate-700 pt-4">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveDraft()}
            className={`${actionClass} bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-60`}
          >
            <Save className="h-4 w-4" /> Save draft
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className={`${actionClass} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60`}
          >
            <Send className="h-4 w-4" /> Complete review
          </button>
          {saving && (
            <span role="status" className="self-center text-sm text-slate-400">
              <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Saving…
            </span>
          )}
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Saved annual system reviews</h3>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadReviews()}
            className={`${actionClass} border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-60`}
          >
            <Download className="h-4 w-4" /> Refresh
          </button>
        </div>
        {loading ? (
          <p role="status" className="text-sm text-slate-300">Loading reviews…</p>
        ) : reviews.length === 0 ? (
          <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
            No annual system reviews have been created yet.
          </p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <article key={review.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div>
                  <h4 className="font-bold">
                    {review.review_year} Annual System Review
                    &middot;
                    {review.company_details?.companyName || "Company details not entered"}
                  </h4>
                  <p className="mt-1 text-xs text-slate-400">
                    Updated {dateLabel(review.updated_at)}
                    {review.status === "submitted" ? ` · Submitted ${dateLabel(review.submitted_at)}` : " · Draft"}
                  </p>
                  {review.retention_expires_at && (
                    <p className="mt-1 text-xs text-slate-500">
                      Retained until at least {dateLabel(review.retention_expires_at)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      review.status === "submitted"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-200"
                    }`}
                  >
                    {review.status.toUpperCase()}
                  </span>
                  {review.status === "draft" ? (
                    <button
                      type="button"
                      onClick={() => beginEdit(review)}
                      className={`${actionClass} border border-slate-600 text-slate-200 hover:bg-slate-800`}
                    >
                      <Pencil className="h-4 w-4" /> Edit draft
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={downloading === review.id}
                      onClick={() => downloadPdf(review)}
                      className={`${actionClass} bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60`}
                    >
                      <Download className="h-4 w-4" /> PDF report
                    </button>
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