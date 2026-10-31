import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardCheck, Search, ShieldCheck, User } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const ASSIGN_CODE = "MDPRESASSIGN";
const ASSESS_CODE = "MDASSESS";
const ACK_CODE = "MDACK";
const KEY_CODE = "MDASSESSKEY";

type DriverRow = {
  id: string;
  name: string; 
  email: string;
  assignment: any | null;
  assessment: any | null;
  acknowledgement: any | null;
};

function normalizeName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function assessmentScore(record: any | null) {
  const answers = Array.isArray(record?.payload?.answers) ? record.payload.answers : [];
  if (!answers.length) return null;
  if (!answers.some((answer: any) => typeof answer?.correct === "boolean")) return null;
  return answers.filter((answer: any) => answer?.correct === true).length;
}

function assessmentStatus(record: any | null, keyConfigured: boolean) {
  if (!record) return "Not Submitted";
  const outcome = String(record.payload?.outcome ?? "").trim();
  const score = assessmentScore(record);
  if (outcome === "Competent" || score === 10) {
    return `Competent${score !== null ? ` (${score}/10)` : ""}`;
  }
  if (outcome === "Not Competent") {
    return `Not Competent${score !== null ? ` (${score}/10)` : ""}`;
  }
  if (!keyConfigured) return "Pending Assessment Configuration";
  return "Pending Review";
}

function acknowledgementStatus(record: any | null) {
  if (!record) return "Not Submitted";
  const payload = record.payload || {};
  if (payload.confirmation && String(payload.signature ?? "").trim()) return "Submitted";
  return "Incomplete";
}

function presentationStatus(record: any | null) {
  if (!record) return "Not Assigned";
  return String(record.payload?.status || "Assigned");
}

function overallStatus(row: DriverRow, keyConfigured: boolean) {
  const training = presentationStatus(row.assignment);
  const assessment = assessmentStatus(row.assessment, keyConfigured);
  const ack = acknowledgementStatus(row.acknowledgement);

  if (!row.assignment && !row.assessment && !row.acknowledgement) return "Not Started";
  if (training === "Completed" && assessment.startsWith("Competent") && ack === "Submitted") return "Completed";
  if (assessment === "Not Competent" || ack === "Incomplete") return "Action Required";
  if (!keyConfigured && row.assessment) return "In Progress";
  return "In Progress";
}
export function MassDimensionComplianceStatusAdmin({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<any[]>([]);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState<DriverRow | null>(null);

  const isAdmin = session.user.role === "admin";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeRes, assignmentRes, assessmentRes, ackRes, keyRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, role, staff_role").neq("role", "admin").order("full_name", { ascending: true }),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ASSIGN_CODE).order("submitted_at", { ascending: false }),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ASSESS_CODE).order("submitted_at", { ascending: false }),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ACK_CODE).order("submitted_at", { ascending: false }),
        supabase.from("cor_form_submissions").select("payload").eq("form_code", KEY_CODE).order("submitted_at", { ascending: false }).limit(1)
      ]);
      if (employeeRes.error) throw employeeRes.error;
      if (assignmentRes.error) throw assignmentRes.error;
      if (assessmentRes.error) throw assessmentRes.error;
      if (ackRes.error) throw ackRes.error;
      if (keyRes.error) throw keyRes.error;

      setEmployees(employeeRes.data || []);
      setAssignments(assignmentRes.data || []);
      setAssessments(assessmentRes.data || []);
      setAcknowledgements(ackRes.data || []);
      const keyItems = keyRes.data?.[0]?.payload?.items;
      setKeyConfigured(Array.isArray(keyItems) && keyItems.length > 0 && keyItems.every((item: any) => String(item?.answer ?? "").trim() !== ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load compliance status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo<DriverRow[]>(() => {
    return employees.map((employee) => {
      const assignment = assignments.find((record: any) => String(record?.payload?.employee_id ?? "") === String(employee.id)) || null;
      const assessment = assessments.find((record: any) =>
        String(record?.payload?.candidate_user_id ?? "") === String(employee.id) ||
        normalizeName(record?.payload?.candidate_name) === normalizeName(employee.full_name || employee.email)
      ) || null;
      const acknowledgement = acknowledgements.find((record: any) =>
        normalizeName(record?.payload?.employee_name) === normalizeName(employee.full_name || employee.email)
      ) || null;
      return {
        id: employee.id,
        name: employee.full_name || employee.email || employee.id,
        email: employee.email || "",
        assignment,
        assessment,
        acknowledgement
      };
    });
  }, [employees, assignments, assessments, acknowledgements]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !term || row.name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term);
      const status = overallStatus(row, keyConfigured);
      const matchesStatus = statusFilter === "All" || status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter, keyConfigured]);

  const statusCounts = useMemo(() => {
    const counts = { "Not Started": 0, "In Progress": 0, "Completed": 0, "Action Required": 0 };
    rows.forEach((row) => {
      const status = overallStatus(row, keyConfigured);
      if (counts[status as keyof typeof counts] !== undefined) counts[status as keyof typeof counts] += 1;
    });
    return counts;
  }, [rows, keyConfigured]);

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading driver compliance status...</p>;
  }

  if (!isAdmin) {
    return <p role="alert" className="text-sm text-red-300">Admin access is required to view compliance status.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white">Driver Training & Compliance Status</h3>
          <p className="text-sm text-slate-300">Mass and Dimension awareness progress based on saved training, assessment, and acknowledgement records.</p>
        </div>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      {!keyConfigured && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Official assessment answers are not fully configured. Assessment competency is shown as Pending Assessment Configuration until the approved answer key is confirmed.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(statusCounts).map(([label, count]) => (
          <div key={label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-black text-white">{count}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search driver name or email"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-10 pr-3 text-sm text-white"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
        >
          <option value="All">All statuses</option>
          <option value="Not Started">Not Started</option>
          <option value="In Progress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Action Required">Action Required</option>
        </select>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
          Refresh
        </button>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No driver compliance records match the current filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Driver</th>
                <th className="px-4 py-3 text-left">Presentation / Training</th>
                <th className="px-4 py-3 text-left">Assessment</th>
                <th className="px-4 py-3 text-left">Acknowledgement</th>
                <th className="px-4 py-3 text-left">Overall</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {filteredRows.map((row) => {
                const training = presentationStatus(row.assignment);
                const assessment = assessmentStatus(row.assessment, keyConfigured);
                const ack = acknowledgementStatus(row.acknowledgement);
                const status = overallStatus(row, keyConfigured);
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{row.name}</div>
                      <div className="text-xs text-slate-400">{row.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{training}</div>
                      {row.assignment?.payload?.completed_at && (
                        <div className="text-xs text-slate-400">{new Date(row.assignment.payload.completed_at).toLocaleDateString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{assessment}</div>
                      {row.assessment?.payload?.outcome && (
                        <div className="text-xs text-slate-400">Outcome: {row.assessment.payload.outcome}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{ack}</div>
                      {row.acknowledgement?.payload?.date && (
                        <div className="text-xs text-slate-400">{new Date(row.acknowledgement.payload.date).toLocaleDateString()}</div>
                      )}
                      {row.acknowledgement?.payload?.signature && (
                        <div className="text-xs text-slate-400">Signed</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        status === "Completed" ? "bg-emerald-500/10 text-emerald-300" :
                        status === "Action Required" ? "bg-red-500/10 text-red-300" :
                        status === "Not Started" ? "bg-slate-700 text-slate-300" :
                        "bg-amber-500/10 text-amber-300"
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        View Records
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-white">{selected.name}</h4>
                <p className="text-sm text-slate-400">{selected.email}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Close</button>
            </div>

            <div className="space-y-4">
              <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h5 className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-emerald-300"><User className="h-4 w-4" /> Presentation / Training</h5>
                {selected.assignment ? (
                  <pre className="whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(selected.assignment.payload || {}, null, 2)}</pre>
                ) : (
                  <p className="text-sm text-slate-400">No training assignment record.</p>
                )}
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h5 className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-emerald-300"><ClipboardCheck className="h-4 w-4" /> Assessment</h5>
                {selected.assessment ? (
                  <pre className="whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(selected.assessment.payload || {}, null, 2)}</pre>
                ) : (
                  <p className="text-sm text-slate-400">No assessment submission.</p>
                )}
              </section>

              <section className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h5 className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-emerald-300"><ShieldCheck className="h-4 w-4" /> Acknowledgement</h5>
                {selected.acknowledgement ? (
                  <pre className="whitespace-pre-wrap text-xs text-slate-300">{JSON.stringify(selected.acknowledgement.payload || {}, null, 2)}</pre>
                ) : (
                  <p className="text-sm text-slate-400">No acknowledgement record.</p>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

