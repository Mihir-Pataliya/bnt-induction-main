import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, ClipboardList, FileCheck2, LayoutDashboard, Presentation, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { api } from "../../lib/api";
import { SessionState } from "../../types";
import { SpeedChecklist, DRIVER_CATEGORIES } from "./SpeedChecklist";
import { SpeedLimiterComplianceCheck } from "./SpeedLimiterComplianceCheck";
import { SpeedAssessmentAdmin } from "./SpeedAssessmentAdmin";

const PRESENTATION_FORM_CODE = "SPEED_PRESENTATION";

export function SpeedAwarenessAdmin({ session }: { session: SessionState }) {
  const [activeTab, setActiveTab] = useState<"overview" | "checklist" | "limiter" | "presentation" | "questions" | "results" | "driverChecklists" | "driverFaults" | "inspectionRepair" | "notifications">("overview");
const [driverFaults, setDriverFaults] = useState<any[]>([]);
const [loadingDriverFaults, setLoadingDriverFaults] = useState(false);
const [driverNames, setDriverNames] = useState<Record<string, string>>({});
const [inspections, setInspections] = useState<any[]>([]);
const [loadingInspections, setLoadingInspections] = useState(false);
const [showInspectionForm, setShowInspectionForm] = useState(false);
const [inspectionForm, setInspectionForm] = useState<any>({ faultReportId: "", vehicle_rego: "", driver_id: "", inspection_date: new Date().toISOString().slice(0, 16), location: "", compliance_result: "", repairer: "", scheduled_repair_date: "", repair_date: "", details: "", documents: "" });
const [driverChecklists, setDriverChecklists] = useState<any[]>([]);
const [loadingDriverChecklists, setLoadingDriverChecklists] = useState(false);
const [reviewStatus, setReviewStatus] = useState("Pending Review");
const [reviewFeedback, setReviewFeedback] = useState("");
const [reviewInternalNotes, setReviewInternalNotes] = useState("");
const [correctiveRequired, setCorrectiveRequired] = useState(false);
const [correctiveTitle, setCorrectiveTitle] = useState("");
const [correctiveStatus, setCorrectiveStatus] = useState("Open");
  const [counts, setCounts] = useState({ checklists: 0, limiters: 0, trained: 0, results: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [presentationUrl, setPresentationUrl] = useState("");
  const [presentationVersion, setPresentationVersion] = useState("Version 8.1, May 2026");
  const [savingPresentation, setSavingPresentation] = useState(false);
  const [uploadingPresentation, setUploadingPresentation] = useState(false);
  const [presentationMessage, setPresentationMessage] = useState("");
  const [presentationLoadError, setPresentationLoadError] = useState("");
  const presentationFileInputRef = useRef<HTMLInputElement>(null);

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      setOverviewError("");
      const [{ count: checklistCount }, { count: limiterCount }, results] = await Promise.all([
        supabase.from("cor_form_submissions").select("id", { count: "exact", head: true }).eq("form_code", "SC"),
        supabase.from("cor_form_submissions").select("id", { count: "exact", head: true }).eq("form_code", "SLC"),
        api.getSpeedAwarenessResults(session)
      ]);
      const trained = new Set(results.filter((r: any) => r.passed).map((r: any) => r.user_id)).size;
      setCounts({
        checklists: checklistCount ?? 0,
        limiters: limiterCount ?? 0,
        trained,
        results: results.length
      });
    } catch (e) {
      setCounts({ checklists: 0, limiters: 0, trained: 0, results: 0 });
      setOverviewError(e instanceof Error ? e.message : "Unable to load Speed Awareness totals.");
    } finally {
      setLoadingCounts(false);
    }
  }, [session]);

  const loadPresentation = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("cor_form_submissions")
        .select("payload")
        .eq("form_code", PRESENTATION_FORM_CODE)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const payload = (data?.payload || {}) as Record<string, unknown>;
      if (payload.url) setPresentationUrl(String(payload.url));
      if (payload.version) setPresentationVersion(String(payload.version));
      setPresentationLoadError("");
    } catch (e) {
      setPresentationLoadError(e instanceof Error ? e.message : "Unable to load presentation details.");
    }
  }, []);

  const loadDriverChecklists = useCallback(async () => {
    setLoadingDriverChecklists(true);
    try {
      const { data, error } = await supabase.from("cor_form_submissions").select("*").eq("form_code", "SC_DRIVER").order("submitted_at", { ascending: false });
      if (error) throw error;
      setDriverChecklists(data ?? []);
    } catch (e) {
      setDriverChecklists([]);
    } finally {
      setLoadingDriverChecklists(false);
    }
  }, []);

  const loadDriverFaults = useCallback(async () => {
    setLoadingDriverFaults(true);
    try {
      const { data, error } = await supabase.from("cor_form_submissions").select("*").eq("form_code", "SLC_DRIVER_FAULT").order("submitted_at", { ascending: false });
      if (error) throw error;
      setDriverFaults(data ?? []);
      const ids = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)));
      if (ids.length) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        const map: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => { map[p.id] = p.full_name || p.email || p.id; });
        setDriverNames(map);
      }
    } catch (e) {
      setDriverFaults([]);
    } finally {
      setLoadingDriverFaults(false);
    }
  }, []);

  const loadInspections = useCallback(async () => {
    setLoadingInspections(true);
    try {
      const { data, error } = await supabase.from("cor_form_submissions").select("*").eq("form_code", "SLC_INSPECTION").order("submitted_at", { ascending: false });
      if (error) throw error;
      setInspections(data ?? []);
    } catch (e) {
      setInspections([]);
    } finally {
      setLoadingInspections(false);
    }
  }, []);

  useEffect(() => { void loadCounts(); void loadPresentation(); void loadDriverChecklists(); void loadDriverFaults(); void loadInspections(); }, [loadCounts, loadPresentation, loadDriverChecklists, loadDriverFaults, loadInspections]);

  const savePresentation = async () => {
    setSavingPresentation(true);
    setPresentationMessage("");
    try {
      const { error } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: PRESENTATION_FORM_CODE,
        form_title: "Speed Awareness Presentation",
        payload: { url: presentationUrl, version: presentationVersion },
        status: "Submitted"
      });
      if (error) throw error;
      setPresentationMessage("Presentation details saved.");
    } catch (e) {
      setPresentationMessage(e instanceof Error ? e.message : "Unable to save presentation details.");
    } finally {
      setSavingPresentation(false);
    }
  };

  const uploadPresentation = async (file: File) => {
    setUploadingPresentation(true);
    setPresentationMessage("");
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${session.user.id}/speed-awareness/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage.from("induction-assets").upload(path, file, {
        contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("induction-assets").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("Unable to get presentation URL.");
      setPresentationUrl(data.publicUrl);
      setPresentationMessage("Presentation uploaded. Click Save Presentation Details to publish.");
    } catch (e) {
      setPresentationMessage(e instanceof Error ? e.message : "Unable to upload presentation.");
    } finally {
      setUploadingPresentation(false);
      if (presentationFileInputRef.current) presentationFileInputRef.current.value = "";
    }
  };

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "checklist", label: "Speed Checklist", icon: ClipboardCheck },
    { id: "limiter", label: "Speed Limiter Compliance", icon: ShieldCheck },
    { id: "presentation", label: "Training Presentation", icon: Presentation },
    { id: "questions", label: "Assessment Questions", icon: ClipboardList },
    { id: "results", label: "Driver Results", icon: FileCheck2 },
    { id: "driverChecklists", label: "Driver Checklist Submissions", icon: ClipboardCheck },
    { id: "driverFaults", label: "Driver Fault Reports", icon: ClipboardCheck },
    { id: "inspectionRepair", label: "Inspection & Repair Records", icon: ClipboardCheck },
    { id: "notifications", label: "Notifications", icon: ClipboardCheck }
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {showInspectionForm && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
          <h3 className="text-lg font-bold text-white">Create Inspection</h3>
          <input value={inspectionForm.vehicle_rego} onChange={(e) => setInspectionForm({ ...inspectionForm, vehicle_rego: e.target.value })} placeholder="Vehicle registration" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input value={inspectionForm.driver_id} onChange={(e) => setInspectionForm({ ...inspectionForm, driver_id: e.target.value })} placeholder="Driver ID" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input type="datetime-local" value={inspectionForm.inspection_date} onChange={(e) => setInspectionForm({ ...inspectionForm, inspection_date: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input value={inspectionForm.location} onChange={(e) => setInspectionForm({ ...inspectionForm, location: e.target.value })} placeholder="Location" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <select value={inspectionForm.compliance_result} onChange={(e) => setInspectionForm({ ...inspectionForm, compliance_result: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
            <option value="">Compliance result</option>
            <option>Compliant</option>
            <option>Non-Compliant</option>
          </select>
          <input value={inspectionForm.repairer} onChange={(e) => setInspectionForm({ ...inspectionForm, repairer: e.target.value })} placeholder="Authorised repairer" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input type="date" value={inspectionForm.scheduled_repair_date} onChange={(e) => setInspectionForm({ ...inspectionForm, scheduled_repair_date: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <input type="date" value={inspectionForm.repair_date} onChange={(e) => setInspectionForm({ ...inspectionForm, repair_date: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <textarea value={inspectionForm.details} onChange={(e) => setInspectionForm({ ...inspectionForm, details: e.target.value })} placeholder="Calibration/repair details" rows={3} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
          <div className="flex gap-2">
            <button type="button" onClick={async () => {
              try {
                const { data: inserted, error } = await supabase.from("cor_form_submissions").insert({ user_id: session.user.id, form_code: "SLC_INSPECTION", form_title: "Speed Limiter Inspection", payload: { ...inspectionForm, faultReportId: inspectionForm.faultReportId }, status: "Submitted" }).select().single();
                if (error) throw error;
                // notify driver via backend
                try {
                  const driverId = inspectionForm.driver_id;
                  if (driverId) {
                    await api.sendFatigueFeedback(session, driverId, {
                      subject: "Speed Limiter Inspection Created",
                      message: `Vehicle: ${inspectionForm.vehicle_rego}\nInspection date: ${inspectionForm.inspection_date}\nLocation: ${inspectionForm.location}\nResult: ${inspectionForm.compliance_result || "Pending"}`,
                      messageType: "Speed Limiter Inspection",
                      requiredAction: inserted.id
                    });
                  }
                } catch (notifyError) {
                  console.error("Notification failed", notifyError);
                }
                setShowInspectionForm(false);
                await loadInspections();
              } catch (e: any) { alert(e?.message ?? "Failed"); }
            }} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save Inspection</button>
            <button type="button" onClick={() => setShowInspectionForm(false)} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {activeTab === "overview" && (
        <div className="space-y-4">
        {overviewError && <p role="alert" className="text-sm text-red-300">{overviewError}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Checklist Records</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.checklists}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Limiter Checks</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.limiters}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Drivers Trained</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.trained}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Assessment Results</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.results}</p>
          </div>
        </div>
        </div>
      )}

      {activeTab === "checklist" && <SpeedChecklist session={session} />}
      {activeTab === "limiter" && <SpeedLimiterComplianceCheck session={session} />}

      {activeTab === "presentation" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-lg font-bold text-white">Training Presentation</h3>
          <p className="text-sm text-slate-300">Approved Speed Awareness presentation. Version 8.1, May 2026.</p>
          {presentationLoadError && <p role="alert" className="text-sm text-red-300">{presentationLoadError}</p>}
          <label className="block text-sm font-semibold text-slate-200">
            Upload PPTX
            <input
              ref={presentationFileInputRef}
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPresentation(file);
              }}
              disabled={uploadingPresentation}
            />
          </label>
          {uploadingPresentation && <p className="text-sm text-slate-400">Uploading presentation...</p>}

          <label className="block text-sm font-semibold text-slate-200">
            Presentation URL
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={presentationUrl} onChange={(e) => setPresentationUrl(e.target.value)} placeholder="https://..." />
          </label>
          <label className="block text-sm font-semibold text-slate-200">
            Version
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={presentationVersion} onChange={(e) => setPresentationVersion(e.target.value)} />
          </label>
          <button type="button" onClick={savePresentation} disabled={savingPresentation} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            {savingPresentation ? "Saving..." : "Save Presentation Details"}
          </button>
          {presentationMessage && <p className="text-sm text-slate-300">{presentationMessage}</p>}
        </div>
      )}
      {activeTab === "questions" && <SpeedAssessmentAdmin session={session} view="questions" />}
      {activeTab === "results" && <SpeedAssessmentAdmin session={session} view="results" />}
      {activeTab === "driverFaults" && (
        <div className="space-y-3">
          {loadingDriverFaults ? <p className="text-sm text-slate-400">Loading…</p> : driverFaults.length === 0 ? <p className="text-sm text-slate-400">No driver fault reports yet.</p> : driverFaults.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white space-y-3">
              {(() => {
                const p = (row.payload || {}) as Record<string, any>;
                return (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><p className="text-xs text-slate-400">Driver ID</p><p className="text-sm text-white">{row.user_id}</p></div>
                      <div><p className="text-xs text-slate-400">Vehicle Registration</p><p className="text-sm text-white">{String(p.vehicle_rego ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Incident Date/Time</p><p className="text-sm text-white">{String(p.incident_date ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Location</p><p className="text-sm text-white">{String(p.location ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Warning Light Showing</p><p className="text-sm text-white">{String(p.warning_light ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Working Normally</p><p className="text-sm text-white">{String(p.working_normally ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Submission Date</p><p className="text-sm text-white">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Draft"}</p></div>
                      <div><p className="text-xs text-slate-400">Status</p><p className="text-sm text-white">{row.status}</p></div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                      <p className="text-xs text-slate-400">Fault Description</p>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap">{String(p.description ?? "-")}</p>
                    </div>
                    {p.photo_url && (
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                        <p className="text-xs text-slate-400">Photo</p>
                        <img src={String(p.photo_url)} alt="Fault" className="mt-2 max-h-48 rounded" />
                      </div>
                    )}
                    <p className="text-xs text-slate-400">Declaration: {p.declaration ? "Yes" : "No"}</p>
                    <button type="button" onClick={() => { setInspectionForm({ faultReportId: row.id, vehicle_rego: p.vehicle_rego || "", driver_id: row.user_id, inspection_date: new Date().toISOString().slice(0, 16), location: p.location || "", compliance_result: "", repairer: "", scheduled_repair_date: "", repair_date: "", details: "", documents: "" }); setShowInspectionForm(true); }} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Create Inspection</button>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
      {activeTab === "inspectionRepair" && (
        <div className="space-y-3">
          {loadingInspections ? <p className="text-sm text-slate-400">Loading…</p> : inspections.length === 0 ? <p className="text-sm text-slate-400">No inspection records yet.</p> : inspections.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
              <p className="font-bold">Record: {row.id}</p>
              <p className="text-xs text-slate-400">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Draft"} · {row.status}</p>
              <button type="button" onClick={() => { const p = row.payload || {}; setInspectionForm({ faultReportId: row.id, vehicle_rego: p.vehicle_rego || "", driver_id: row.user_id, inspection_date: new Date().toISOString().slice(0, 16), location: p.location || "", compliance_result: "", repairer: "", scheduled_repair_date: "", repair_date: "", details: "", documents: "" }); setShowInspectionForm(true); }} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Create Inspection</button>
            </div>
          ))}
        </div>
      )}
      {activeTab === "notifications" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">Unread: {driverFaults.length}</p>
          </div>
          {loadingDriverFaults ? <p className="text-sm text-slate-400">Loading…</p> : driverFaults.length === 0 ? <p className="text-sm text-slate-400">No notifications.</p> : driverFaults.map((row) => {
            const p = (row.payload || {}) as Record<string, any>;
            return (
              <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">New Speed Limiter Fault Report</p>
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">Unread</span>
                </div>
                <p className="mt-1 text-sm text-white">Driver: {driverNames[row.user_id] ?? row.user_id}</p>
                <p className="text-xs text-slate-400">Vehicle: {String(p.vehicle_rego ?? "-")} · {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Draft"}</p>
                <p className="mt-1 text-sm text-slate-200">{String(p.description ?? "")}</p>
                <button type="button" onClick={() => setActiveTab("driverFaults")} className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">View Report</button>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "driverChecklists" && (
        <div className="space-y-3">
          {loadingDriverChecklists ? <p className="text-sm text-slate-400">Loading…</p> : driverChecklists.length === 0 ? <p className="text-sm text-slate-400">No driver checklist submissions yet.</p> : driverChecklists.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white space-y-4">
              {(() => {
                const payload = (row.payload || {}) as Record<string, any>;
                const answers = (payload.answers || {}) as Record<string, string>;
                const notes = (payload.questionNotes || {}) as Record<string, string>;
                const allQs = DRIVER_CATEGORIES.flatMap((c) => c.questions);
                const yes = Object.values(answers).filter((a) => a === "Yes").length;
                const no = Object.values(answers).filter((a) => a === "No").length;
                const na = Object.values(answers).filter((a) => a === "N/A").length;
                return (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><p className="text-xs text-slate-400">Driver ID</p><p className="text-sm text-white">{row.user_id}</p></div>
                      <div><p className="text-xs text-slate-400">Role</p><p className="text-sm text-white">{String(payload.role ?? "Driver")}</p></div>
                      <div><p className="text-xs text-slate-400">Submission Date</p><p className="text-sm text-white">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Draft"}</p></div>
                      <div><p className="text-xs text-slate-400">Completed By</p><p className="text-sm text-white">{String(payload.completedBy ?? "-")}</p></div>
                      <div><p className="text-xs text-slate-400">Status</p><p className="text-sm text-white">{row.status}</p></div>
                      <div><p className="text-xs text-slate-400">Signature</p><p className="text-sm text-white">{String(payload.signature ?? "-")}</p></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-slate-800/60 p-3"><p className="text-xs text-slate-400">Total</p><p className="text-lg font-bold text-white">{allQs.length}</p></div>
                      <div className="rounded-lg bg-slate-800/60 p-3"><p className="text-xs text-slate-400">Yes</p><p className="text-lg font-bold text-emerald-300">{yes}</p></div>
                      <div className="rounded-lg bg-slate-800/60 p-3"><p className="text-xs text-slate-400">No</p><p className="text-lg font-bold text-red-300">{no}</p></div>
                      <div className="rounded-lg bg-slate-800/60 p-3"><p className="text-xs text-slate-400">N/A</p><p className="text-lg font-bold text-slate-300">{na}</p></div>
                    </div>
                    <div className="space-y-2">
                      {allQs.map((q, idx) => {
                        const ans = answers[q.id] ?? "";
                        const color = ans === "Yes" ? "text-emerald-300" : ans === "No" ? "text-red-300" : "text-slate-300";
                        return (
                          <div key={q.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                            <p className="text-sm font-semibold text-white">{idx + 1}. {q.text}</p>
                            <p className={`mt-1 text-sm font-bold ${color}`}>{ans || "Not answered"}</p>
                            {notes[q.id] && <p className="mt-1 text-xs text-slate-400">Note: {notes[q.id]}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {payload.generalNotes && (
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                        <p className="text-xs text-slate-400">Driver Notes</p>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap">{String(payload.generalNotes)}</p>
                      </div>
                    )}
                    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 space-y-2">
                      <p className="text-xs text-slate-400">Admin Review</p>
                      <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                        <option>Pending Review</option>
                        <option>In Progress</option>
                        <option>Reviewed</option>
                      </select>
                      <textarea value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} placeholder="Admin feedback" rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
                      <label className="flex items-center gap-2 text-sm text-slate-200">
                        <input type="checkbox" checked={correctiveRequired} onChange={(e) => setCorrectiveRequired(e.target.checked)} /> Corrective action required
                      </label>
                      {correctiveRequired && (
                        <>
                          <input value={correctiveTitle} onChange={(e) => setCorrectiveTitle(e.target.value)} placeholder="Action title" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
                          <select value={correctiveStatus} onChange={(e) => setCorrectiveStatus(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                            <option>Open</option>
                            <option>In Progress</option>
                            <option>Resolved</option>
                          </select>
                        </>
                      )}
                      <textarea value={reviewInternalNotes} onChange={(e) => setReviewInternalNotes(e.target.value)} placeholder="Internal notes (private)" rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
                      <button type="button" onClick={async () => {
                        try {
                          await api.saveSpeedChecklistReview(session, {
                            submissionId: row.id,
                            driverId: row.user_id,
                            reviewStatus,
                            feedback: reviewFeedback,
                            correctiveActionRequired: correctiveRequired,
                            internalNotes: reviewInternalNotes,
                            correctiveActionTitle: correctiveTitle,
                            correctiveActionStatus: correctiveRequired ? correctiveStatus : undefined
                          });
                          alert("Review saved.");
                        } catch (e: any) { alert(e?.message ?? "Failed"); }
                      }} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save Review</button>
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}