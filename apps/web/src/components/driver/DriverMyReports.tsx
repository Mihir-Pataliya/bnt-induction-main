import { useEffect, useState } from "react";
import { ClipboardList, Loader2, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type Report = {
  id: string;
  form_code: "NCR" | "WHSI";
  user_id: string;
  payload: any;
  status: string;
  submitted_at: string | null;
  updated_at: string;
};

export function DriverMyReports({ session }: { session: SessionState }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"All" | "NCR" | "WHSI">("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [viewing, setViewing] = useState<Report | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: own, error: e1 } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .in("form_code", ["NCR", "WHSI"])
        .eq("user_id", session.user.id);
      if (e1) throw e1;

      const { data: assigned } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .in("form_code", ["NCR", "WHSI"])
        .filter("payload->>assigned_driver_id", "eq", session.user.id);

      const map = new Map<string, Report>();
      (own || []).forEach((r: any) => map.set(r.id, r));
      (assigned || []).forEach((r: any) => map.set(r.id, r));
      setReports(Array.from(map.values()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = reports.filter((r) => {
    const num = r.payload?.report_number || "";
    const status = r.payload?.status || r.status || "";
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || num.toLowerCase().includes(needle);
    const matchesType = filterType === "All" || r.form_code === filterType;
    const matchesStatus = filterStatus === "All" || status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading your reports...</p>;
  }

  if (viewing) {
    const p = viewing.payload || {};
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">Report Details</h3>
          <button
            type="button"
            onClick={() => setViewing(null)}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back to list
          </button>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-3 text-sm text-slate-200">
          <div><span className="text-slate-400">Report Number:</span> {p.report_number || "—"}</div>
          <div><span className="text-slate-400">Report Type:</span> {viewing.form_code === "NCR" ? "NCR" : "WHS"}</div>
          <div><span className="text-slate-400">Incident/Report Date:</span> {p.date_incident || p.date_from || "—"}</div>
          <div><span className="text-slate-400">Submission Date:</span> {viewing.submitted_at ? new Date(viewing.submitted_at).toLocaleString() : "—"}</div>
          <div><span className="text-slate-400">Status:</span> {p.status || viewing.status}</div>
          {p.employee_name && <div><span className="text-slate-400">Employee:</span> {p.employee_name}</div>}
          {p.incident_location && <div><span className="text-slate-400">Location:</span> {p.incident_location}</div>}
          {p.incident_description && <div><span className="text-slate-400">Description:</span> {p.incident_description}</div>}
          {p.what_happened && <div><span className="text-slate-400">Non-Conformance:</span> {p.what_happened}</div>}
          {p.assigned_driver_name && <div><span className="text-slate-400">Assigned Driver:</span> {p.assigned_driver_name}</div>}
          {p.assignment_status && <div><span className="text-slate-400">Assignment Status:</span> {p.assignment_status}</div>}
          {p.driver_signature && <div><span className="text-slate-400">Driver Signature:</span> {p.driver_signature} ({p.driver_signature_date})</div>}
          {p.comment && <div><span className="text-slate-400">Comment:</span> {p.comment}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <ClipboardList className="h-5 w-5 text-emerald-400" />
          NCR - My Reports
        </h3>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report number..."
            className="rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="All">All types</option>
          <option value="NCR">NCR</option>
          <option value="WHSI">WHS</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="All">All statuses</option>
          <option value="Draft">Draft</option>
          <option value="Submitted">Submitted</option>
          <option value="Accepted">Accepted</option>
          <option value="Rejected">Rejected</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          You have no reports yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Report Number</th>
                <th className="px-4 py-3 text-left">Report Type</th>
                <th className="px-4 py-3 text-left">Incident/Report Date</th>
                <th className="px-4 py-3 text-left">Submission Date</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.payload?.report_number || "—"}</td>
                  <td className="px-4 py-3">{r.form_code === "NCR" ? "NCR" : "WHS"}</td>
                  <td className="px-4 py-3">{r.payload?.date_incident || r.payload?.date_from || "—"}</td>
                  <td className="px-4 py-3">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3">{r.payload?.status || r.status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setViewing(r)}
                      className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}