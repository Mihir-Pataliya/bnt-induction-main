import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Eye, FileText, Loader2, Save, Upload, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const CONFIG_CODE = "MDPRESCONFIG";
const ASSIGN_CODE = "MDPRESASSIGN";
const BUCKET = "induction-assets";

type ResourceConfig = {
  title: string;
  description: string;
  resource_url: string;
  resource_path?: string;
  version: string;
  updated_at: string;
};

export function MassDimensionPresentationAdmin({
  session,
  onBack,
  onOpenAssessment
}: {
  session: SessionState;
  onBack: () => void;
  onOpenAssessment: () => void;
}) {
  const [tab, setTab] = useState<"resource" | "assign" | "status">("resource");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [config, setConfig] = useState<ResourceConfig | null>(null);
  const [title, setTitle] = useState("Mass and Dimension Awareness Presentation");
  const [description, setDescription] = useState("Awareness presentation covering mass and dimension compliance.");
  const [manualUrl, setManualUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [employees, setEmployees] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assigning, setAssigning] = useState(false);

  const loadConfig = async () => {
    const { data, error: err } = await supabase
      .from("cor_form_submissions")
      .select("*")
      .eq("form_code", CONFIG_CODE)
      .order("submitted_at", { ascending: false })
      .limit(1);
    if (err) throw err;
    const row = data?.[0];
    if (row?.payload) {
      setConfig(row.payload as ResourceConfig);
      setTitle(row.payload.title || title);
      setDescription(row.payload.description || description);
      setManualUrl(row.payload.resource_url || "");
    }
  };

  const loadEmployees = async () => {
    const { data, error: err } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, staff_role, employment_type")
      .neq("role", "admin")
      .order("full_name");
    if (err) throw err;
    setEmployees(data || []);
  };
  const loadAssignments = async () => {
    const { data, error: err } = await supabase
      .from("cor_form_submissions")
      .select("*")
      .eq("form_code", ASSIGN_CODE)
      .order("submitted_at", { ascending: false });
    if (err) throw err;
    setAssignments(data || []);
  };

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadConfig(), loadEmployees(), loadAssignments()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load presentation data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const saveConfig = async (resourceUrl: string, resourcePath?: string) => {
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const version = now;
      const payload: ResourceConfig = {
        title: title.trim() || "Mass and Dimension Awareness Presentation",
        description: description.trim(),
        resource_url: resourceUrl,
        resource_path: resourcePath,
        version,
        updated_at: now
      };
      const { error: err } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: CONFIG_CODE,
        form_title: "Mass and Dimension Awareness Presentation Config",
        payload,
        status: "Submitted",
        submitted_at: now
      });
      if (err) throw err;
      setConfig(payload);
      setSuccess("Presentation resource saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save presentation resource.");
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setError("Only PDF files can be uploaded.");
      return;
    }
    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const path = `cor/mass-dimension-awareness-presentation-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      await saveConfig(data.publicUrl, path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload presentation.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveUrl = async () => {
    if (!manualUrl.trim()) {
      setError("Presentation URL is required.");
      return;
    }
    await saveConfig(manualUrl.trim());
  };

  const handleAssign = async () => {
    if (!config?.resource_url) {
      setError("Configure a presentation resource before assigning.");
      return;
    }
    if (selected.length === 0) {
      setError("Select at least one employee.");
      return;
    }
    setAssigning(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const existingKeys = new Set(
        assignments.map((a: any) => `${a.payload.employee_id}::${a.payload.version}`)
      );
      let created = 0;
      for (const empId of selected) {
        const emp = employees.find((e) => e.id === empId);
        if (!emp) continue;
        const key = `${empId}::${config.version}`;
        if (existingKeys.has(key)) continue;
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: ASSIGN_CODE,
          form_title: "Mass and Dimension Awareness Presentation Assignment",
          payload: {
            employee_id: empId,
            employee_name: emp.full_name || emp.email,
            resource_url: config.resource_url,
            version: config.version,
            assigned_by: session.user.id,
            assigned_at: now,
            status: "Assigned",
            completed_at: null
          },
          status: "Submitted",
          submitted_at: now
        });
        if (err) throw err;
        created += 1;
      }
      setSuccess(`Assigned to ${created} employee(s).`);
      setSelected([]);
      await loadAssignments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign training.");
    } finally {
      setAssigning(false);
    }
  };

  const updateStatus = async (assignment: any, status: string) => {
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const payload = {
        ...assignment.payload,
        status,
        completed_at: status === "Completed" ? now : assignment.payload.completed_at
      };
      const { error: err } = await supabase
        .from("cor_form_submissions")
        .update({ payload, status: "Submitted", updated_at: now })
        .eq("id", assignment.id);
      if (err) throw err;
      setSuccess("Status updated.");
      await loadAssignments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update status.");
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading presentation training...</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <FileText className="h-5 w-5 text-emerald-400" />
          Mass and Dimension Awareness Presentation and Training
        </h3>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("resource")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "resource" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
        >
          Resource
        </button>
        <button
          type="button"
          onClick={() => setTab("assign")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "assign" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
        >
          Assign Training
        </button>
        <button
          type="button"
          onClick={() => setTab("status")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "status" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
        >
          Training Status
        </button>
      </div>
      {tab === "resource" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Presentation Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs font-medium text-slate-200 md:col-span-2">
              Presentation URL (optional)
              <input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSaveUrl()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Save className="h-4 w-4" /> Save URL
            </button>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer">
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Upload PDF"}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void handleUpload(e.target.files?.[0])}
              />
            </label>
          </div>

          {config?.resource_url ? (
            <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
              <p className="text-sm font-semibold text-white">{config.title}</p>
              <p className="text-xs text-slate-400">{config.description}</p>
              <p className="text-xs text-slate-500">Version: {config.version} · Updated: {new Date(config.updated_at).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={config.resource_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  <Eye className="h-4 w-4" /> View
                </a>
                <a
                  href={`${config.resource_url}?download=${encodeURIComponent(config.title || "presentation.pdf")}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Download className="h-4 w-4" /> Download
                </a>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                <iframe title={config.title} src={config.resource_url} className="h-[60vh] w-full border-0 bg-white" />
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
              No presentation resource configured. Upload a PDF or configure a URL. Do not invent a presentation URL.
            </p>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <p className="text-sm text-slate-300">
              Employees should complete the{" "}
              <button type="button" onClick={onOpenAssessment} className="font-semibold text-emerald-300 hover:underline">
                Mass and Dimension Awareness Assessment/Acknowledgement
              </button>{" "}
              after viewing the presentation.
            </p>
          </div>
        </div>
      )}
      {tab === "assign" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
          {!config?.resource_url && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Configure a presentation resource first.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Select employees to assign the current presentation version. Duplicate active assignments are skipped.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            {employees.length === 0 ? (
              <p className="text-sm text-slate-400">No employees found.</p>
            ) : (
              <div className="space-y-2">
                {employees.map((emp) => (
                  <label key={emp.id} className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={selected.includes(emp.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelected((prev) => [...prev, emp.id]);
                        else setSelected((prev) => prev.filter((id) => id !== emp.id));
                      }}
                    />
                    {emp.full_name || emp.email}{" "}
                    <span className="text-xs text-slate-500">({emp.role || emp.staff_role || "employee"})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleAssign()}
            disabled={assigning || selected.length === 0 || !config?.resource_url}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Assign Selected
          </button>
        </div>
      )}

      {tab === "status" && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
          {assignments.length === 0 ? (
            <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
              No training assignments yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
                <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Version</th>
                    <th className="px-4 py-3 text-left">Assigned</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Completed</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-900/40">
                  {assignments.map((a: any) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3 font-semibold">{a.payload?.employee_name || "—"}</td>
                      <td className="px-4 py-3">{a.payload?.version || "—"}</td>
                      <td className="px-4 py-3">
                        {a.payload?.assigned_at ? new Date(a.payload.assigned_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">{a.payload?.status || "—"}</td>
                      <td className="px-4 py-3">
                        {a.payload?.completed_at ? new Date(a.payload.completed_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void updateStatus(a, "In Progress")}
                            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                          >
                            In Progress
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateStatus(a, "Completed")}
                            className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                          >
                            Completed
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}