"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Save, Send, Upload, X } from "lucide-react";
import { api } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { CorFormSubmission, SessionState } from "../../types";

interface DayRecord {
  day: number;
  hoursWorked: string;
  restHours: string;
}

interface UploadedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  uploadedAt: string;
}

function emptyDays(): DayRecord[] {
  return Array.from({ length: 31 }, (_, index) => ({
    day: index + 1,
    hoursWorked: "",
    restHours: ""
  }));
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function monthName(month: string) {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return names[Number(month) - 1] || month;
}

function sameAuditPeriod(payload: Record<string, unknown>, month: string, year: string) {
  const payloadMonth = Number(payload.month);
  const payloadYear = Number(payload.year);
  return (
    Number.isFinite(payloadMonth) &&
    Number.isFinite(payloadYear) &&
    payloadMonth === Number(month) &&
    payloadYear === Number(year)
  );
}

export function DriverFatigueWorkRecordAudit({ session }: { session: SessionState }) {
  const currentYear = new Date().getFullYear();
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(currentYear));
  const [days, setDays] = useState<DayRecord[]>(emptyDays());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submissions, setSubmissions] = useState<CorFormSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adminAudit, setAdminAudit] = useState<any | null>(null);
  const [adminAudits, setAdminAudits] = useState<any[]>([]);
  const [adminAuditLoading, setAdminAuditLoading] = useState(false);
  const [adminAuditError, setAdminAuditError] = useState("");
  const [amending, setAmending] = useState(false);
  const [feedbackResponse, setFeedbackResponse] = useState("");
  const [requestedFiles, setRequestedFiles] = useState<UploadedFile[]>([]);
  const [uploadingRequested, setUploadingRequested] = useState(false);

  const loadSubmissions = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const rows = await api.getCorFormSubmissions(session.user.id);
      setSubmissions(
        rows.filter((row: any) => row.formCode === "F-10" && (row.payload as Record<string, unknown>)?.source === "driver")
      );
    } catch {
      setSubmissions([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [session.user.id]);

  const loadAdminAudit = useCallback(async () => {
    setAdminAuditLoading(true);
    setAdminAuditError("");
    try {
      const { data, error } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .eq("form_code", "F-10")
        .eq("user_id", session.user.id)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      const adminRows = (data ?? []).filter((row: any) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return payload.source === "admin" &&
          String(payload.driverId ?? "").trim().toLowerCase() === session.user.id.trim().toLowerCase();
      });
      setAdminAudits(adminRows);
      const match = adminRows.find((row: any) => {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        return sameAuditPeriod(payload, month, year);
      });
      setAdminAudit(match ?? null);
    } catch (err) {
      setAdminAuditError(err instanceof Error ? err.message : "Unable to load admin audit results.");
      setAdminAudit(null);
    } finally {
      setAdminAuditLoading(false);
    }
  }, [month, year, session.user.id]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  useEffect(() => {
    void loadAdminAudit();
  }, [loadAdminAudit]);

  const currentSubmission = useMemo(() => {
    return submissions.find((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return String(payload.month) === String(month) && String(payload.year) === String(year);
    });
  }, [submissions, month, year]);

  useEffect(() => {
    if (!currentSubmission) {
      setDraftId(null);
      setStatus(null);
      setAmending(false);
      setDays(emptyDays());
      setUploadedFiles([]);
      setNotes("");
      setFeedbackResponse("");
      setRequestedFiles([]);
      return;
    }
    const payload = (currentSubmission.payload ?? {}) as Record<string, unknown>;
    setDraftId(currentSubmission.id);
    setStatus(currentSubmission.status);
    if (Array.isArray(payload.days) && payload.days.length) {
      const mapped = emptyDays().map((day) => {
        const found = (payload.days as Array<Record<string, unknown>>).find((item) => Number(item.day) === day.day);
        return found
          ? {
              day: day.day,
              hoursWorked: String(found.hoursWorked ?? ""),
              restHours: String(found.restHours ?? "")
            }
          : day;
      });
      setDays(mapped);
    } else {
      setDays(emptyDays());
    }
    setUploadedFiles(Array.isArray(payload.uploadedFiles) ? (payload.uploadedFiles as UploadedFile[]) : []);
    setNotes(String(payload.notes ?? ""));
    setFeedbackResponse(
      String(payload.driverResponse ?? payload.adminFeedbackResponse ?? payload.feedbackResponse ?? "")
    );
    setRequestedFiles(
      Array.isArray(payload.requestedFiles)
        ? (payload.requestedFiles as UploadedFile[])
        : Array.isArray(payload.requestedDocuments)
          ? (payload.requestedDocuments as UploadedFile[])
          : []
    );
  }, [currentSubmission, month, year]);

  const isReadOnly = status === "Submitted" || status === "Under Review" || status === "Resolved";
  const canEdit = !isReadOnly || amending;

  const hasRecords = days.some((day) => day.hoursWorked.trim() !== "" || day.restHours.trim() !== "");

  const validate = () => {
    if (!month || !year) return "Select a month and year.";
    if (!hasRecords && uploadedFiles.length === 0) {
      return "Enter at least one day of work/rest records or upload an approved work diary/EWD file.";
    }
    return "";
  };

  const buildPayload = () => ({
    source: "driver",
    recordType: "Driver Fatigue Work Record",
    month,
    year,
    days,
    uploadedFiles,
    notes: notes.trim(),
    driverName: session.user.email ?? "",
    driverResponse: feedbackResponse.trim(),
    adminFeedbackResponse: feedbackResponse.trim(),
    requestedFiles,
    requestedDocuments: requestedFiles
  });

  const handleSaveDraft = async () => {
    setError("");
    setSuccess("");
    if (isReadOnly && !amending) {
      setError("Submitted records cannot be edited.");
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (draftId && status === "Draft") {
        await api.updateCorFormSubmission(draftId, { payload, status: "Draft" });
      } else if (!draftId) {
        const saved = await api.saveCorFormSubmission(session.user.id, {
          formCode: "F-10",
          formTitle: "Driver Fatigue Work Record Audit",
          payload,
          status: "Draft"
        });
        setDraftId(saved.id);
        setStatus("Draft");
      } else {
        setError("A submitted record already exists for this month. Select another month to create a new record.");
        setSaving(false);
        return;
      }
      await loadSubmissions();
      setSuccess("Draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setSuccess("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (isReadOnly && !amending) {
      setError("Submitted records cannot be edited.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...buildPayload(), submittedAt: new Date().toISOString() };
      if (amending) payload.amendedAt = new Date().toISOString();
      if (amending && draftId) {
        await api.updateCorFormSubmission(draftId, { payload, status: "Submitted" });
      } else if (draftId && status === "Draft") {
        await api.updateCorFormSubmission(draftId, { payload, status: "Submitted" });
      } else if (!draftId) {
        const saved = await api.saveCorFormSubmission(session.user.id, {
          formCode: "F-10",
          formTitle: "Driver Fatigue Work Record Audit",
          payload,
          status: "Submitted"
        });
        setDraftId(saved.id);
      } else {
        setError("A submitted record already exists for this month. Select another month to create a new record.");
        setSaving(false);
        return;
      }
      setStatus("Submitted");
      setAmending(false);
      await loadSubmissions();
      setSuccess(amending ? "Amended work record resubmitted for admin review." : "Work record submitted for admin review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit work record.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const newFiles: UploadedFile[] = [];
      for (const file of files) {
        const path = `${session.user.id}/fatigue-work-records/${year}/${month}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("driver-documents").upload(path, file, {
          cacheControl: "3600",
          upsert: false
        });
        if (uploadError) throw new Error(uploadError.message);
        newFiles.push({
          name: file.name,
          path,
          size: file.size,
          type: file.type || "application/octet-stream",
          uploadedAt: new Date().toISOString()
        });
      }
      setUploadedFiles((current) => [...current, ...newFiles]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const removeFile = async (path: string) => {
    try {
      await supabase.storage.from("driver-documents").remove([path]);
    } catch {
      // Keep the UI responsive even if storage cleanup fails.
    }
    setUploadedFiles((current) => current.filter((file) => file.path !== path));
  };

  const openFile = async (path: string) => {
    const { data } = await supabase.storage.from("driver-documents").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const handleRequestedUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingRequested(true);
    setError("");
    try {
      const newFiles: UploadedFile[] = [];
      for (const file of files) {
        const path = `${session.user.id}/fatigue-work-records/${year}/${month}/requested/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("driver-documents").upload(path, file, {
          cacheControl: "3600",
          upsert: false
        });
        if (uploadError) throw new Error(uploadError.message);
        newFiles.push({
          name: file.name,
          path,
          size: file.size,
          type: file.type || "application/octet-stream",
          uploadedAt: new Date().toISOString()
        });
      }
      setRequestedFiles((current) => [...current, ...newFiles]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setUploadingRequested(false);
      event.target.value = "";
    }
  };

  const removeRequestedFile = async (path: string) => {
    try {
      await supabase.storage.from("driver-documents").remove([path]);
    } catch {
      // Keep the UI responsive even if storage cleanup fails.
    }
    setRequestedFiles((current) => current.filter((file) => file.path !== path));
  };
  const updateDay = (day: number, patch: Partial<DayRecord>) => {
    setDays((current) => current.map((item) => (item.day === day ? { ...item, ...patch } : item)));
  };

  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Driver Fatigue Work Record Audit</h2>
        <p className="mt-1 text-sm text-slate-400">
          Submit your monthly work/rest records or approved work diary/EWD files for admin review. Save a draft at any time and submit when complete.
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {success && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{success}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1 text-sm text-slate-300">
          <span className="font-medium">Month</span>
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={String(index + 1)}>
                {monthName(String(index + 1))}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm text-slate-300">
          <span className="font-medium">Year</span>
          <select
            value={year}
            onChange={(event) => setYear(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            {years.map((item) => (
              <option key={item} value={String(item)}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Current record status:</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${isReadOnly ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
            {status}
          </span>
        </div>
      )}

      {isReadOnly && !amending && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setAmending(true);
              setError("");
              setSuccess("You can now amend this record. Submit to resubmit it for admin review.");
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Amend & Resubmit
          </button>
        </div>
      )}

      {amending && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || uploading}
            onClick={() => {
              setAmending(false);
              setError("");
              setSuccess("");
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            Cancel amend
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-bold text-white">Daily work/rest records</h3>
          <p className="text-xs text-slate-400">
            Enter recorded work and rest hours from your actual records. Leave days blank if you did not work. Do not estimate.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full text-sm text-white">
            <thead className="bg-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Day</th>
                <th className="px-3 py-2 text-left">Hours worked</th>
                <th className="px-3 py-2 text-left">Rest hours</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day} className="border-t border-slate-700">
                  <td className="px-3 py-2 font-medium">{day.day}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={day.hoursWorked}
                      disabled={!canEdit}
                      onChange={(event) => updateDay(day.day, { hoursWorked: event.target.value })}
                      className="w-28 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                      placeholder="e.g. 8.5"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={day.restHours}
                      disabled={!canEdit}
                      onChange={(event) => updateDay(day.day, { restHours: event.target.value })}
                      className="w-28 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                      placeholder="e.g. 10"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-bold text-white">Approved work diary / EWD files</h3>
          <p className="text-xs text-slate-400">
            Upload approved written work diary pages or EWD exports as supporting evidence.
          </p>
        </div>
        {canEdit && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading..." : "Upload files"}
            <input
              type="file"
              multiple
              accept=".pdf,image/*"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        )}
        {uploadedFiles.length > 0 && (
          <ul className="space-y-2">
            {uploadedFiles.map((file) => (
              <li key={file.path} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
                <button type="button" onClick={() => void openFile(file.path)} className="truncate text-left text-indigo-300 hover:underline">
                  {file.name}
                </button>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{Math.round(file.size / 1024)} KB</span>
                  {canEdit && (
                    <button type="button" onClick={() => void removeFile(file.path)} className="text-slate-400 hover:text-red-300">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block space-y-1 text-sm text-slate-300">
        <span className="font-medium">Notes (optional)</span>
        <textarea
          value={notes}
          disabled={!canEdit}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
          placeholder="Optional notes for the administrator reviewing your records."
        />
      </label>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          {!isReadOnly && !amending && (
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void handleSaveDraft()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save draft
            </button>
          )}
          <button
            type="button"
            disabled={saving || uploading}
            onClick={() => void handleSubmit()}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit for review
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Submission history</h3>
          <button
            type="button"
            disabled={loadingHistory}
            onClick={() => void loadSubmissions()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Refresh
          </button>
        </div>
        {loadingHistory ? (
          <p role="status" className="text-sm text-slate-300">Loading submissions…</p>
        ) : submissions.length === 0 ? (
          <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No work records have been submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map((submission) => {
              const payload = (submission.payload ?? {}) as Record<string, unknown>;
              const files = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];
              const recordedDays = Array.isArray(payload.days)
                ? (payload.days as Array<Record<string, unknown>>).filter((day) => String(day.hoursWorked ?? "").trim() !== "" || String(day.restHours ?? "").trim() !== "").length
                : 0;
              return (
                <article key={submission.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                  <div>
                    <h4 className="font-bold">
                      {monthName(String(payload.month))} {String(payload.year)}
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      {recordedDays} recorded day{recordedDays === 1 ? "" : "s"} · {files.length} file{files.length === 1 ? "" : "s"} · Saved {new Date(submission.submittedAt).toLocaleString()}
                    </p>
                    {payload.notes ? <p className="mt-1 text-xs text-slate-500">{String(payload.notes)}</p> : null}
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${submission.status === "Submitted" || submission.status === "Resolved" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
                    {submission.status}
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-white">Admin audit results</h3>
          <button
            type="button"
            disabled={adminAuditLoading}
            onClick={() => void loadAdminAudit()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Refresh
          </button>
        </div>
        {adminAuditLoading ? (
          <p role="status" className="text-sm text-slate-300">Loading audit results…</p>
        ) : adminAuditError ? (
          <p role="alert" className="text-sm text-rose-300">{adminAuditError}</p>
        ) : !adminAudit ? (
          <div className="space-y-3 rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
            <p>Awaiting Admin Review.</p>
            {adminAudits.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Admin feedback is available for these reviewed months:</p>
                <div className="flex flex-wrap gap-2">
                  {adminAudits.map((audit) => {
                    const payload = (audit.payload ?? {}) as Record<string, any>;
                    return (
                      <button
                        key={audit.id}
                        type="button"
                        onClick={() => {
                          setMonth(String(payload.month ?? month));
                          setYear(String(payload.year ?? year));
                        }}
                        className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        {monthName(String(payload.month))} {String(payload.year)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (() => {
          const auditPayload = (adminAudit.payload ?? {}) as Record<string, any>;
          const auditDays = Array.isArray(auditPayload.dayAudits) ? auditPayload.dayAudits : [];
          const reviewDate = auditPayload.auditDate || adminAudit.submitted_at || adminAudit.submittedAt;
          const reviewSummary = (auditPayload.reviewSummary ?? {}) as Record<string, any>;
          const recordKeeping = (auditPayload.recordKeeping ?? {}) as Record<string, any>;
          const externalValidations = Array.isArray(auditPayload.externalValidations) ? auditPayload.externalValidations : [];
          const ncrs = Array.isArray(auditPayload.ncrs) ? auditPayload.ncrs : [];
          const evidenceRequests = externalValidations.filter((item: any) => Boolean(item?.mismatchFound));
          const missingDiaryPages = String(reviewSummary.missingDiaryPages ?? "").trim();
          const complianceResult = String(reviewSummary.workRestCompliance ?? "Not assessed").trim() || "Not assessed";
          const correctiveActions = [String(reviewSummary.correctiveActions ?? "").trim(), String(recordKeeping.correctiveActions ?? "").trim()]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-900 p-3">
                  <p className="text-xs uppercase text-slate-400">Review status</p>
                  <p className="mt-1 font-semibold text-white">
                    {adminAudit.status === "Resolved" ? "Reviewed" : String(adminAudit.status ?? "Reviewed")}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-900 p-3">
                  <p className="text-xs uppercase text-slate-400">Review date</p>
                  <p className="mt-1 font-semibold text-white">
                    {reviewDate ? new Date(reviewDate).toLocaleString() : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-900 p-3">
                  <p className="text-xs uppercase text-slate-400">Reviewer</p>
                  <p className="mt-1 font-semibold text-white">{String(auditPayload.auditor || adminAudit.reviewedBy || "—")}</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h4 className="font-semibold text-white">My Review & Feedback</h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-950/60 p-3">
                    <p className="mt-1 text-sm font-semibold text-white">
                      Review status: {adminAudit.status === "Resolved" ? "Reviewed" : String(adminAudit.status ?? "Reviewed")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-950/60 p-3">
                    <p className="text-xs uppercase text-slate-400">Compliance result</p>
                    <p className="mt-1 text-sm font-semibold text-white">{complianceResult}</p>
                  </div>
                  <div className="rounded-lg bg-slate-950/60 p-3 sm:col-span-2">
                    <p className="text-xs uppercase text-slate-400">Missing diary pages</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                      {missingDiaryPages || "None recorded."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-xs uppercase text-slate-400">Overall audit comments</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                      {String(auditPayload.comments ?? "").trim() || "No overall comments provided."}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase text-slate-400">Corrective actions</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                      {correctiveActions || "No corrective actions recorded."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h4 className="font-semibold text-white">Evidence Requests</h4>
                <p className="mt-1 text-xs text-slate-400">
                  GPS, fuel, toll or delivery issues that need a driver response.
                </p>
                {evidenceRequests.length ? (
                  <div className="mt-3 space-y-3">
                    {evidenceRequests.map((item: any, index: number) => (
                      <div key={item.id ?? index} className="rounded-lg border border-amber-500/20 bg-slate-950/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{String(item.evidenceType ?? "Evidence")} request</p>
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-300">
                            Response required
                          </span>
                        </div>
                        {item.mismatchDetails ? (
                          <p className="mt-2 text-sm text-slate-300">{String(item.mismatchDetails)}</p>
                        ) : null}
                        {item.investigationNotes ? (
                          <p className="mt-1 text-xs text-slate-400">{String(item.investigationNotes)}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">No evidence requests requiring a response.</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h4 className="font-semibold text-white">My NCRs / Corrective Actions</h4>
                {ncrs.length ? (
                  <div className="mt-3 space-y-3">
                    {ncrs.map((ncr: any, index: number) => (
                      <div key={ncr.id ?? index} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{String(ncr.issue ?? "Assigned issue")}</p>
                          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">
                            {String(ncr.status ?? "Open")}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-300">
                          Required action: {String(ncr.correctiveAction ?? "Not recorded")}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Due {ncr.dueDate ? new Date(ncr.dueDate).toLocaleDateString() : "—"} · Responsible: {String(ncr.responsiblePerson || "Not assigned")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">No NCRs or corrective actions assigned.</p>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="min-w-full text-sm text-white">
                  <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Day</th>
                      <th className="px-3 py-2 text-left">Audit result</th>
                      <th className="px-3 py-2 text-left">Admin notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                      const found = auditDays.find((item: any) => Number(item.day) === day);
                      const result = String(found?.status ?? "Not Audited");
                      const notes = String(found?.notes ?? "").trim();
                      return (
                        <tr key={day} className="border-t border-slate-700">
                          <td className="px-3 py-2 font-medium">{day}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                result === "Breach Found"
                                  ? "bg-rose-500/15 text-rose-300"
                                  : result === "No Breach"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-slate-700 text-slate-300"
                              }`}
                            >
                              {result}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{notes || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h4 className="font-semibold text-white">Driver response to Admin feedback</h4>
                <p className="mt-1 text-xs text-slate-400">
                  Upload requested documents, add your response, then use Amend & Resubmit to send it for review.
                </p>
                {canEdit && (
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
                    <Upload className="h-4 w-4" />
                    {uploadingRequested ? "Uploading..." : "Upload requested documents"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,image/*"
                      onChange={handleRequestedUpload}
                      disabled={uploadingRequested}
                      className="hidden"
                    />
                  </label>
                )}
                {requestedFiles.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {requestedFiles.map((file) => (
                      <li key={file.path} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white">
                        <button type="button" onClick={() => void openFile(file.path)} className="truncate text-left text-indigo-300 hover:text-indigo-200">
                          {file.name}
                        </button>
                        {canEdit ? (
                          <button type="button" onClick={() => void removeRequestedFile(file.path)} className="text-slate-400 hover:text-red-300">
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <textarea
                  value={feedbackResponse}
                  onChange={(event) => setFeedbackResponse(event.target.value)}
                  disabled={!canEdit}
                  rows={4}
                  placeholder="Add your response to the Admin feedback..."
                  className="mt-3 w-full rounded-xl border border-slate-600 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}

export const DriverFatigueWorkRecordAuditDriver = DriverFatigueWorkRecordAudit;
