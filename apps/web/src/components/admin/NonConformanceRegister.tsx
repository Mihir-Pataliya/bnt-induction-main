import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Plus, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type NcRecord = {
  id: string;
  form_code: "NCR" | "WHSI";
  user_id: string;
  payload: any;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export function NonConformanceRegister({ session, onBack, onCreateReport }: { session: SessionState; onBack: () => void; onCreateReport?: (type: "NCR" | "WHSI") => void }) {
  const [records, setRecords] = useState<NcRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"All" | "NCR" | "WHSI">("All");
  const [filterStatus, setFilterStatus] = useState<"All" | "Open" | "Closed">("All");
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"NCR" | "WHSI">("NCR");
  const [saving, setSaving] = useState(false);
  const [personName, setPersonName] = useState("");
  const [comment, setComment] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("cor_form_submissions")
        .select("*")
        .in("form_code", ["NCR", "WHSI"])
        .order("submitted_at", { ascending: false });
      if (err) throw err;
      setRecords((data || []) as NcRecord[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load non-conformance register.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = records.filter((r) => {
    const num = r.payload?.report_number || "";
    const person = r.payload?.person_name || "";
    const status = r.payload?.closed_at ? "Closed" : "Open";
    const needle = search.trim().toLowerCase();
    const matchesSearch =
      !needle ||
      num.toLowerCase().includes(needle) ||
      person.toLowerCase().includes(needle) ||
      (r.payload?.comment || "").toLowerCase().includes(needle);
    const matchesType = filterType === "All" || r.form_code === filterType;
    const matchesStatus = filterStatus === "All" || status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const generateReportNumber = (code: "NCR" | "WHSI"): string => {
    const prefix = code === "NCR" ? "NCR" : "WHSI-";
    const existing = records
      .filter((r) => r.form_code === code)
      .map((r) => {
        const m = (r.payload?.report_number || "").match(/(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      });
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    return `${prefix}${next}`;
  };

  const createReport = () => {
    if (onCreateReport) {
      onCreateReport(createType);
    }
    setShowCreate(false);
  };

  const closeOut = async (record: NcRecord) => {
    if (record.payload?.closed_at) return;
    if (!window.confirm("Mark this report as closed out?")) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const updatedPayload = { ...record.payload, closed_at: now, status: "Closed" };
      const { error: upErr } = await supabase
        .from("cor_form_submissions")
        .update({ payload: updatedPayload, reviewed_at: now, reviewed_by: session.user.id })
        .eq("id", record.id);
      if (upErr) throw upErr;
      setSuccess(`Report ${record.payload?.report_number} closed out.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to close out report.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading non-conformance register...</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back
          </button>
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <ClipboardList className="h-5 w-5 text-emerald-400" />
            Non-Conformance Register
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> Create Report
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

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report number, person, comment..."
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
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="All">All statuses</option>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No non-conformance records found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Report number</th>
                <th className="px-4 py-3 text-left">NCR Type</th>
                <th className="px-4 py-3 text-left">Date Issued</th>
                <th className="px-4 py-3 text-left">Date Closed Out</th>
                <th className="px-4 py-3 text-left">Person involved</th>
                <th className="px-4 py-3 text-left">Manager Signature</th>
                <th className="px-4 py-3 text-left">Comment</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-semibold">{r.payload?.report_number}</td>
                  <td className="px-4 py-3">{r.form_code === "NCR" ? "NCR" : "WHS"}</td>
                  <td className="px-4 py-3">
                    {r.payload?.date_issued ? new Date(r.payload.date_issued).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.payload?.closed_at ? new Date(r.payload.closed_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">{r.payload?.person_name || "—"}</td>
                  <td className="px-4 py-3">{r.payload?.manager_signature || "—"}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{r.payload?.comment || "—"}</td>
                  <td className="px-4 py-3">
                    {!r.payload?.closed_at && (
                      <button
                        type="button"
                        onClick={() => void closeOut(r)}
                        disabled={saving}
                        className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-60"
                      >
                        Close Out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4">
            <h4 className="text-lg font-bold text-white">Create Report</h4>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCreateType("NCR")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${createType === "NCR" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200"}`}
              >
                Non-Conformance Report (NCR)
              </button>
              <button
                type="button"
                onClick={() => setCreateType("WHSI")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${createType === "WHSI" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200"}`}
              >
                WHS Incident Report
              </button>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createReport()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}