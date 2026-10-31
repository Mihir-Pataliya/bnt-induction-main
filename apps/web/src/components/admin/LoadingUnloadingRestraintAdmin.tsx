import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, ClipboardList, FileCheck2, LayoutDashboard, Presentation, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { api } from "../../lib/api";
import { SessionState } from "../../types";
import { LoadingUnloadingRestraintChecklist } from "./LoadingUnloadingRestraintChecklist";
import { LoadingSafePlanManager } from "../LoadingSafePlanManager";
import { LoadingUnloadingRestraintAssessmentAdmin } from "./LoadingUnloadingRestraintAssessmentAdmin";

const PRESENTATION_FORM_CODE = "LURC_PRESENTATION";
const DOCUMENTS_FORM_CODE = "LURC_DOCUMENTS";
const ASSIGNMENTS_FORM_CODE = "LURC_ASSIGNMENTS";

function LurcDocumentsAdmin({ session }: { session: SessionState }) {
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("cor_form_submissions").select("payload").eq("form_code", DOCUMENTS_FORM_CODE).order("submitted_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const payload = (data?.payload || {}) as { documents?: Array<{ id: string; name: string; url: string }> };
        setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      });
  }, []);

  const publish = async () => {
    const next = [...documents, { id: crypto.randomUUID(), name: name.trim(), url: url.trim() }];
    if (!name.trim() || !/^https?:\/\//i.test(url.trim())) { setMessage("Enter a document name and a valid web URL."); return; }
    setSaving(true);
    const { error } = await supabase.from("cor_form_submissions").insert({ user_id: session.user.id, form_code: DOCUMENTS_FORM_CODE, form_title: "Loading, Unloading & Restraint Documents", payload: { documents: next }, status: "Published" });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setDocuments(next); setName(""); setUrl(""); setMessage("Document published for drivers.");
  };

  const remove = async (id: string) => {
    const next = documents.filter((document) => document.id !== id);
    const { error } = await supabase.from("cor_form_submissions").insert({ user_id: session.user.id, form_code: DOCUMENTS_FORM_CODE, form_title: "Loading, Unloading & Restraint Documents", payload: { documents: next }, status: "Published" });
    if (!error) setDocuments(next);
  };

  return <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
    <h3 className="text-lg font-bold text-white">Relevant Document Links</h3>
    <p className="text-sm text-slate-300">Publish approved source documents for assigned drivers. URLs must point to the supplied document.</p>
    <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
      <input aria-label="Document name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name" className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      <input aria-label="Document URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      <button type="button" onClick={publish} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Publish</button>
    </div>
    {message && <p className="text-sm text-slate-300">{message}</p>}
    {documents.map((document) => <div key={document.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3"><a href={document.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold text-sky-300">{document.name}</a><button type="button" onClick={() => void remove(document.id)} className="text-sm text-red-300">Remove</button></div>)}
  </div>;
}

function LurcAssignmentsAdmin({ session }: { session: SessionState }) {
  const [drivers, setDrivers] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [driverId, setDriverId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [{ data: profileData }, { data: assignmentData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").eq("role", "driver").order("full_name"),
      supabase.from("cor_form_submissions").select("id, user_id, payload, submitted_at").eq("form_code", ASSIGNMENTS_FORM_CODE).order("submitted_at", { ascending: false })
    ]);
    setDrivers((profileData || []) as any[]);
    setAssignments((assignmentData || []).map((row: any) => ({ id: row.id, ...row.payload })));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const assign = async () => {
    if (!driverId || !dueDate) { setMessage("Select a driver and due date."); return; }
    const driver = drivers.find((item) => item.id === driverId);
    const { error } = await supabase.from("cor_form_submissions").insert({ user_id: driverId, form_code: ASSIGNMENTS_FORM_CODE, form_title: "Loading, Unloading & Restraint Training Assignment", payload: { driverId, driverName: driver?.full_name || driver?.email || "Driver", dueDate, assignedBy: session.user.id, assignedAt: new Date().toISOString() }, status: "Assigned" });
    if (error) { setMessage(error.message); return; }
    setMessage("Training assigned."); setDueDate(""); await load();
  };

  return <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
    <h3 className="text-lg font-bold text-white">Training Assignments</h3>
    <div className="grid gap-3 md:grid-cols-3">
      <select aria-label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"><option value="">Select driver</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name || driver.email}</option>)}</select>
      <input aria-label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      <button type="button" onClick={assign} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">Assign training</button>
    </div>
    {message && <p className="text-sm text-slate-300">{message}</p>}
    <div className="overflow-x-auto"><table className="min-w-full text-sm text-slate-200"><thead><tr className="text-left text-slate-400"><th className="px-3 py-2">Driver</th><th className="px-3 py-2">Due</th></tr></thead><tbody>{assignments.map((assignment, index) => <tr key={assignment.id || index} className="border-t border-slate-700"><td className="px-3 py-2">{assignment.driverName}</td><td className="px-3 py-2">{assignment.dueDate}</td></tr>)}</tbody></table></div>
  </div>;
}

export function LoadingUnloadingRestraintAdmin({ session }: { session: SessionState }) {
  const [activeTab, setActiveTab] = useState<"overview" | "checklist" | "plan" | "presentation" | "documents" | "assignments" | "questions" | "results">("overview");
  const [counts, setCounts] = useState({ checklists: 0, limiters: 0, trained: 0, results: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [presentationUrl, setPresentationUrl] = useState("");
  const [presentationVersion, setPresentationVersion] = useState("Version 8.1, May 2026");
  const [savingPresentation, setSavingPresentation] = useState(false);
  const [presentationMessage, setPresentationMessage] = useState("");
  const [presentationLoadError, setPresentationLoadError] = useState("");

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      setOverviewError("");
      const [{ count: checklistCount }, { count: planCount }, results] = await Promise.all([
        supabase.from("cor_form_submissions").select("id", { count: "exact", head: true }).eq("form_code", "LURC_CHECKLIST"),
        supabase.from("cor_form_submissions").select("id", { count: "exact", head: true }).eq("form_code", "SDP"),
        api.getLoadingUnloadingRestraintResults(session)
      ]);
      const trained = new Set(results.filter((r: any) => r.passed).map((r: any) => r.user_id)).size;
      setCounts({
        checklists: checklistCount ?? 0,
        limiters: planCount ?? 0,
        trained,
        results: results.length
      });
    } catch (e) {
      setCounts({ checklists: 0, limiters: 0, trained: 0, results: 0 });
      setOverviewError(e instanceof Error ? e.message : "Unable to load Loading, Unloading & Restraint Compliance totals.");
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

  useEffect(() => { void loadCounts(); void loadPresentation(); }, [loadCounts, loadPresentation]);

  const savePresentation = async () => {
    setSavingPresentation(true);
    setPresentationMessage("");
    try {
      const { error } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: PRESENTATION_FORM_CODE,
        form_title: "Loading, Unloading & Restraint Compliance Presentation",
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

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "checklist", label: "Loading, Unloading & Restraint Checklist", icon: ClipboardCheck },
    { id: "plan", label: "Safe Loading Plan", icon: ShieldCheck },
    { id: "presentation", label: "Training Presentation", icon: Presentation },
    { id: "questions", label: "Assessment Questions", icon: ClipboardList },
    { id: "results", label: "Driver Results", icon: FileCheck2 }
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

      {activeTab === "overview" && (
        <div className="space-y-4">
        {overviewError && <p role="alert" className="text-sm text-red-300">{overviewError}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Checklist Records</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.checklists}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Safe Loading Plans</p>
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

      {activeTab === "checklist" && <LoadingUnloadingRestraintChecklist session={session} />}
      {activeTab === "plan" && <LoadingSafePlanManager session={session} mode="admin" />}
      {activeTab === "documents" && <LurcDocumentsAdmin session={session} />}
      {activeTab === "assignments" && <LurcAssignmentsAdmin session={session} />}

      {activeTab === "presentation" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-lg font-bold text-white">Training Presentation</h3>
          <p className="text-sm text-slate-300">Approved Loading, Unloading & Restraint Compliance presentation. Version 8.1, May 2026.</p>
          {presentationLoadError && <p role="alert" className="text-sm text-red-300">{presentationLoadError}</p>}
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
      {activeTab === "questions" && <LoadingUnloadingRestraintAssessmentAdmin session={session} view="questions" />}
      {activeTab === "results" && <LoadingUnloadingRestraintAssessmentAdmin session={session} view="results" />}
    </div>
  );
}