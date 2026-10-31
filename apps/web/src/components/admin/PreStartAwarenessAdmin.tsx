import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, FileCheck2, LayoutDashboard, Presentation } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { api } from "../../lib/api";
import { SessionState } from "../../types";
import { PreStartAssessmentAdmin } from "./PreStartAssessmentAdmin";

const PRESENTATION_FORM_CODE = "PRESTART_PRESENTATION";

export function PreStartAwarenessAdmin({ session }: { session: SessionState }) {
  const [activeTab, setActiveTab] = useState<"overview" | "presentation" | "questions" | "results">("overview");
  const [counts, setCounts] = useState({ trained: 0, results: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [presentationUrl, setPresentationUrl] = useState("");
  const [presentationVersion, setPresentationVersion] = useState("Version 1.0");
  const [savingPresentation, setSavingPresentation] = useState(false);
  const [presentationMessage, setPresentationMessage] = useState("");
  const [presentationLoadError, setPresentationLoadError] = useState("");

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      setOverviewError("");
      const results = await api.getPreStartAwarenessResults(session);
      const trained = new Set(results.filter((r: any) => r.passed).map((r: any) => r.user_id)).size;
      setCounts({ trained, results: results.length });
    } catch (e) {
      setCounts({ trained: 0, results: 0 });
      setOverviewError(e instanceof Error ? e.message : "Unable to load Pre-Start Awareness totals.");
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
        form_title: "Pre-Start & Fault Reporting Awareness Presentation",
        payload: { url: presentationUrl, version: presentationVersion }
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
    { id: "presentation", label: "Presentation", icon: Presentation },
    { id: "questions", label: "Questions", icon: ClipboardCheck },
    { id: "results", label: "Results", icon: FileCheck2 }
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === tab.id ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}>
              <Icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Drivers Trained</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.trained}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Assessment Results</p>
            <p className="mt-2 text-3xl font-black text-white">{loadingCounts ? "..." : counts.results}</p>
          </div>
          {overviewError && <p role="alert" className="text-sm text-red-300 md:col-span-2">{overviewError}</p>}
        </div>
      )}
      {activeTab === "presentation" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-lg font-bold text-white">Training Presentation</h3>
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
      {activeTab === "questions" && <PreStartAssessmentAdmin session={session} view="questions" />}
      {activeTab === "results" && <PreStartAssessmentAdmin session={session} view="results" />}
    </div>
  );
}
