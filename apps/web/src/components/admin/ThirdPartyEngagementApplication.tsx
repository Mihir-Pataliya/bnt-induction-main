import { useEffect, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type ApplicationRow = {
  id: string;
  register_id: string;
  user_id: string;
  status: "Draft" | "Submitted" | "Under Review" | "Accepted" | "Rejected" | "More Information Required";
  payload: any;
  review_comments: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

type RegisterRow = {
  id: string;
  business_name: string;
  trading_name: string;
  acn: string | null;
  postal_address: string;
  contact_person: string;
  position: string;
  mobile: string;
  email: string;
  business_activity: string;
  accreditation_type: string;
  accreditation_number: string;
  accreditation_expiry: string | null;
};

const STANDARD_QUESTIONS = [
  { id: "1.1", text: "Is your business responsible for or does it have the capacity to influence and control driver licensing?" },
  { id: "1.2", text: "Is your business responsible for or does it have the capacity to influence and control vehicle registrations?" },
  { id: "1.3", text: "Is your business responsible for or does it have the capacity to influence and control vehicle maintenance?" },
  { id: "1.4", text: "Is your business responsible for or does it have the capacity to influence and control the requirement for heavy vehicle gazette notices and permits including the requirement to train drivers in the notice and permit conditions?" },
  { id: "1.5", text: "Is your business responsible for or does it have the capacity to influence and control the location a heavy vehicle can travel too or routes a heavy vehicle can travel on? (For example: B-double and road train routes, specific access permit to your site.)" },
  { id: "2.1", text: "Is your business responsible for or does it have the capacity to influence and control mass and dimension?" },
  { id: "2.2", text: "Is your business responsible for or does it have the capacity to influence and control container weight declarations?" },
  { id: "2.3", text: "Is your business responsible for or does it have the capacity to influence and control loading and unloading safely?" },
  { id: "2.4", text: "Is your business responsible for or does it have the capacity to influence and control loading and unloading delays?" },
  { id: "2.5", text: "Is your business responsible for or does it have the capacity to influence and control load restraint?" },
  { id: "3.1", text: "Is your business responsible for or does it have the capacity to influence and control vehicle speed?" },
  { id: "3.2", text: "Is your business responsible for or does it have the capacity to influence and control speed limiters?" },
  { id: "4.1", text: "Is your business responsible for or does it have the capacity to influence and control scheduling and rostering?" },
  { id: "4.2", text: "Is your business responsible for or does it have the capacity to influence and control trip planning?" },
  { id: "4.3", text: "Is your business responsible for or does it have the capacity to influence and control fitness for duty?" },
  { id: "4.4", text: "Is your business responsible for or does it have the capacity to influence and control driving hours?" },
  { id: "5.1", text: "Is your business responsible for or does it have the capacity to influence and control site inductions?" },
  { id: "5.2", text: "Is your business responsible for or does it have the capacity to influence and control safety management system training?" },
  { id: "6.1", text: "Is your business responsible for or does it have the capacity to influence and control employing drivers?" },
  { id: "6.2", text: "Does your business engage in drivers who are not Australian Citizens?" },
  { id: "7.1", text: "Is your business responsible for or does it have the capacity to influence and control driver distraction?" }
];

const SUPPORTING_DOCS = [
  "Business registration certificate",
  "Public liability insurance",
  "Workers compensation (WorkCover) insurance",
  "Business accreditation/certification certificate/s",
  "If answered YES to 2.6 – Mass Management Sub-Contractors Agreement form",
  "Other relevant documentation (Audit report, Safety Policy, etc.)"
];
export function ThirdPartyEngagementApplication({ session }: { session: SessionState }) {
  const [registers, setRegisters] = useState<RegisterRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState("");
  const [activeApplication, setActiveApplication] = useState<ApplicationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewComments, setReviewComments] = useState("");
  const [isNew, setIsNew] = useState(false);

  const [form, setForm] = useState<any>({
    answers: {},
    responses: {},
    q26: "",
    docs: {},
    docChecked: {}
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const registerResult = await supabase
        .from("third_party_register")
        .select("*")
        .order("business_name", { ascending: true });
      if (registerResult.error) throw registerResult.error;
      setRegisters((registerResult.data || []) as RegisterRow[]);

      const applicationResult = await supabase
        .from("third_party_engagement_applications")
        .select("*")
        .order("updated_at", { ascending: false });
      if (applicationResult.error) throw applicationResult.error;
      const apps = (applicationResult.data || []) as ApplicationRow[];
      setApplications(apps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load engagement applications.");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createApplication = async () => {
    if (!selectedRegisterId) {
      setError("Select a registered subcontractor first.");
  useEffect(() => {
    if (!loading && applications.length > 0 && !activeApplication && !isNew) {
      setActiveApplication(applications[0]);
      setForm(applications[0].payload || {});
      setReviewComments(applications[0].review_comments || "");
    }
  }, [loading, applications, activeApplication, isNew]);
      return;
    }
    setError("");
    setSuccess("");
    try {
      const reg = registers.find((r) => r.id === selectedRegisterId);
      if (!reg) {
        setError("The selected registered subcontractor is no longer available. Refresh and try again.");
        return;
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Your session has expired. Sign in again and retry.");

      const payload = {
        register_id: selectedRegisterId,
        business_name: reg?.business_name || "",
        trading_name: reg?.trading_name || "",
        acn: reg?.acn || "",
        postal_address: reg?.postal_address || "",
        contact_person: reg?.contact_person || "",
        position: reg?.position || "",
        mobile: reg?.mobile || "",
        email: reg?.email || "",
        business_activity: reg?.business_activity || "",
        accreditation_type: reg?.accreditation_type || "",
        accreditation_number: reg?.accreditation_number || "",
        accreditation_expiry: reg?.accreditation_expiry || "",
        answers: {},
        responses: {},
        q26: "",
        docs: {},
        docChecked: {}
      };
      const { data, error: err } = await supabase
        .from("third_party_engagement_applications")
        .insert({
          register_id: selectedRegisterId,
          user_id: userData.user.id,
          status: "Draft",
          payload
        })
        .select()
        .single();
      if (err) throw err;
      setApplications((prev) => [data as ApplicationRow, ...prev]);
      setActiveApplication(data as ApplicationRow);
      setForm(payload);
      setSuccess("Application request created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create application.");
    }
  };
  const startNewApplication = () => {
    if (!selectedRegisterId) {
      setError("Select a registered subcontractor first.");
      return;
    }
    const reg = registers.find((r) => r.id === selectedRegisterId);
    if (!reg) {
      setError("The selected registered subcontractor is no longer available. Refresh and try again.");
      return;
    }
    const payload = {
      register_id: selectedRegisterId,
      business_name: reg?.business_name || "",
      trading_name: reg?.trading_name || "",
      acn: reg?.acn || "",
      postal_address: reg?.postal_address || "",
      contact_person: reg?.contact_person || "",
      position: reg?.position || "",
      mobile: reg?.mobile || "",
      email: reg?.email || "",
      business_activity: reg?.business_activity || "",
      accreditation_type: reg?.accreditation_type || "",
      accreditation_number: reg?.accreditation_number || "",
      accreditation_expiry: reg?.accreditation_expiry || "",
      answers: {},
      responses: {},
      q26: "",
      docs: {},
      docChecked: {}
    };
    setActiveApplication(null);
    setIsNew(true);
    setForm(payload);
    setReviewComments("");
    setError("");
    setSuccess("");
  };

  const ensureApplication = async (): Promise<ApplicationRow | null> => {
    if (activeApplication) return activeApplication;
    if (!selectedRegisterId) {
      setError("Select a registered subcontractor first.");
      return null;
    }
    const reg = registers.find((r) => r.id === selectedRegisterId);
    if (!reg) {
      setError("The selected registered subcontractor is no longer available. Refresh and try again.");
      return null;
    }
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError || new Error("Your session has expired. Sign in again and retry.");
      const payload = {
        register_id: selectedRegisterId,
        business_name: reg?.business_name || "",
        trading_name: reg?.trading_name || "",
        acn: reg?.acn || "",
        postal_address: reg?.postal_address || "",
        contact_person: reg?.contact_person || "",
        position: reg?.position || "",
        mobile: reg?.mobile || "",
        email: reg?.email || "",
        business_activity: reg?.business_activity || "",
        accreditation_type: reg?.accreditation_type || "",
        accreditation_number: reg?.accreditation_number || "",
        accreditation_expiry: reg?.accreditation_expiry || "",
        answers: form?.answers || {},
        responses: form?.responses || {},
        q26: form?.q26 || "",
        docs: form?.docs || {},
        docChecked: form?.docChecked || {}
      };
      const { data, error: err } = await supabase
        .from("third_party_engagement_applications")
        .insert({ register_id: selectedRegisterId, user_id: userData.user.id, status: "Draft", payload })
        .select()
        .single();
      if (err) throw err;
      const app = data as ApplicationRow;
      setActiveApplication(app);
      setIsNew(false);
      setApplications((prev) => [app, ...prev]);
      setForm(payload);
      return app;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create application.");
      return null;
    }
  };

  const openApplication = (app: ApplicationRow) => {
    setActiveApplication(app);
    setForm(app.payload || {});
    setReviewComments(app.review_comments || "");
  };

  const saveDraft = async () => {
    let app = activeApplication;
    if (!app) {
      app = await ensureApplication();
      if (!app) return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: err } = await supabase
        .from("third_party_engagement_applications")
        .update({ status: "Draft", payload: form, updated_at: new Date().toISOString() })
        .eq("id", app.id);
      if (err) throw err;
      setSuccess("Draft saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save draft.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    let app = activeApplication;
    if (!app) {
      app = await ensureApplication();
      if (!app) return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: err } = await supabase
        .from("third_party_engagement_applications")
        .update({ status: "Submitted", payload: form, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", app.id);
      if (err) throw err;
      await supabase
        .from("third_party_register")
        .update({ engagement_application_status: "Submitted", updated_at: new Date().toISOString() })
        .eq("id", app.register_id);
      setSuccess("Application submitted.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit application.");
    } finally {
      setSaving(false);
    }
  };

  const review = async (decision: "Accepted" | "Rejected" | "More Information Required") => {
    if (!activeApplication) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: err } = await supabase
        .from("third_party_engagement_applications")
        .update({
          status: decision,
          review_comments: reviewComments,
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", activeApplication.id);
      if (err) throw err;
      const regStatus = decision === "Accepted" ? "Accepted" : decision === "Rejected" ? "Rejected" : "Under Review";
      await supabase
        .from("third_party_register")
        .update({ engagement_application_status: regStatus, updated_at: new Date().toISOString() })
        .eq("id", activeApplication.register_id);
      setSuccess(`Application ${decision}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record review.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (docKey: string, file: File) => {
    let app = activeApplication;
    if (!app) {
      app = await ensureApplication();
      if (!app) return;
    }
    setError("");
    setSuccess("");
    try {
      const path = `third-party-engagement/${app.id}/${docKey}/${file.name}`;
      const { error: upErr } = await supabase.storage.from("contractor-documents").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      setForm((prev: any) => ({
        ...prev,
        docs: { ...(prev.docs || {}), [docKey]: path },
        docChecked: { ...(prev.docChecked || {}), [docKey]: true }
      }));
      setSuccess("Document uploaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload document.");
    }
  };
  const setAnswer = (id: string, value: string) => {
    setForm((prev: any) => ({
      ...prev,
      answers: { ...(prev.answers || {}), [id]: value }
    }));
  };

  const setResponse = (id: string, value: string) => {
    setForm((prev: any) => ({
      ...prev,
      responses: { ...(prev.responses || {}), [id]: value }
    }));
  };

  if (loading) {
    return <p className="text-sm text-slate-300">Loading engagement applications...</p>;
  }

  if (activeApplication || isNew) {
    const reg = registers.find((r) => r.id === (activeApplication?.register_id || selectedRegisterId));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Third Party Engagement Application</h3>
            <p className="mt-1 text-sm text-slate-300">
              {reg?.business_name || "Registered subcontractor"} - status: {activeApplication?.status || "Draft (not saved)"}
            </p>
          </div>
            <button type="button" onClick={() => { setActiveApplication(null); setIsNew(false); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Back to list
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Section 1 – Business details</h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm text-slate-200">
            <div><span className="text-slate-400">Business/Owner name:</span> {form.business_name}</div>
            <div><span className="text-slate-400">ACN:</span> {form.acn}</div>
            <div><span className="text-slate-400">Trading name:</span> {form.trading_name}</div>
            <div><span className="text-slate-400">Postal address:</span> {form.postal_address}</div>
            <div><span className="text-slate-400">Contact person:</span> {form.contact_person}</div>
            <div><span className="text-slate-400">Position:</span> {form.position}</div>
            <div><span className="text-slate-400">Mobile:</span> {form.mobile}</div>
            <div><span className="text-slate-400">Email:</span> {form.email}</div>
            <div className="md:col-span-2"><span className="text-slate-400">Business/transport activities:</span> {form.business_activity}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Section 2 – Business accreditation/certification details</h4>
          <div className="text-sm text-slate-200">
            <div><span className="text-slate-400">Accreditation:</span> {form.accreditation_type} {form.accreditation_number}</div>
            <div><span className="text-slate-400">Expiry:</span> {form.accreditation_expiry}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Section 3 – Transport activities</h4>
          {STANDARD_QUESTIONS.map((q) => (
            <div key={q.id} className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-sm font-semibold text-white">{q.id} {q.text}</p>
              <div className="flex gap-4 text-sm text-slate-200">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name={q.id} value="No" checked={form.answers?.[q.id] === "No"} onChange={() => setAnswer(q.id, "No")} />
                  No
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name={q.id} value="Yes" checked={form.answers?.[q.id] === "Yes"} onChange={() => setAnswer(q.id, "Yes")} />
                  Yes
                </label>
              </div>
              {form.answers?.[q.id] === "Yes" && (
                <textarea
                  value={form.responses?.[q.id] || ""}
                  onChange={(e) => setResponse(q.id, e.target.value)}
                  placeholder="Response:"
                  className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  rows={3}
                />
              )}
            </div>
          ))}

          <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
            <p className="text-sm font-semibold text-white">2.6 If this Prime Contractor has Mass Management accreditation (HVA or NHVAS), do you require your vehicle/s to be added to their accreditation in order to operate at CML and/or HML weights?</p>
            <div className="flex flex-wrap gap-4 text-sm text-slate-200">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="q26" value="N/A" checked={form.q26 === "N/A"} onChange={() => setForm((p: any) => ({ ...p, q26: "N/A" }))} />
                N/A
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="q26" value="No" checked={form.q26 === "No"} onChange={() => setForm((p: any) => ({ ...p, q26: "No" }))} />
                No
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="q26" value="Yes" checked={form.q26 === "Yes"} onChange={() => setForm((p: any) => ({ ...p, q26: "Yes" }))} />
                Yes
              </label>
            </div>
            {form.q26 === "Yes" && (
              <p className="mt-2 text-xs text-amber-300">
                By ticking YES I agree that if my vehicles are added to this Contractors accreditation, I cannot utilise the CML and/or HML weight allowance outside of operating for this Contractor. If I engage in any other work outside of this Contractor, I MUST only operate at GML weights. Subcontractors agreement form required to be completed.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Section 4 – Supporting documents</h4>
          {SUPPORTING_DOCS.map((doc) => (
            <div key={doc} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={!!form.docChecked?.[doc]}
                  onChange={(e) => setForm((p: any) => ({ ...p, docChecked: { ...(p.docChecked || {}), [doc]: e.target.checked } }))}
                />
                {doc}
              </label>
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(doc, file);
                }}
                className="text-xs text-slate-300"
              />
              {form.docs?.[doc] && <span className="text-xs text-emerald-300">Uploaded</span>}
            </div>
          ))}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Admin review</h4>
          <textarea
            value={reviewComments}
            onChange={(e) => setReviewComments(e.target.value)}
            placeholder="Admin comments..."
            className="block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
            rows={3}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => review("Accepted")} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
              Accept
            </button>
            <button type="button" onClick={() => review("Rejected")} disabled={saving} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60">
              Reject
            </button>
            <button type="button" onClick={() => review("More Information Required")} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60">
              More Information Required
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={saveDraft} disabled={saving} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">
            Save Draft
          </button>
          <button type="button" onClick={submit} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
            Submit Application
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <FileText className="h-5 w-5 text-emerald-400" />
            Third Party Engagement Application
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            Select a registered subcontractor to create or review an application.
          </p>
        </div>
      </div>

      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        <span>{error}</span>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-red-300/40 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/20">
          Retry
        </button>
      </div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      <div className="flex flex-wrap gap-3">
        <select
          value={selectedRegisterId}
          onChange={(e) => setSelectedRegisterId(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="">Select registered subcontractor...</option>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>{r.business_name}</option>
          ))}
        </select>
        <button type="button" onClick={startNewApplication} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          Create Application
        </button>
      </div>

      {applications.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No engagement applications yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {applications.map((app) => {
                const reg = registers.find((r) => r.id === app.register_id);
                return (
                  <tr key={app.id}>
                    <td className="px-4 py-3">{reg?.business_name || app.register_id}</td>
                    <td className="px-4 py-3">{app.status}</td>
                    <td className="px-4 py-3">{new Date(app.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => openApplication(app)} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
      </div>
  );

}
}