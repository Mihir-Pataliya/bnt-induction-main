import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

interface FcRow {
  id: string;
  user_id: string;
  status: string;
  submitted_at: string;
  payload: Record<string, unknown>;
}

interface DriverInfo {
  id: string;
  name: string;
  email: string;
  vehicle: string;
}

export function AdminFatigueMonitoring({ session }: { session: SessionState }) {
  const [rows, setRows] = useState<FcRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [selected, setSelected] = useState<FcRow | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [{ data: fcData, error: fcError }, { data: profileData, error: profileError }, { data: vehicleData, error: vehicleError }] = await Promise.all([
        supabase.from("cor_form_submissions").select("*").eq("form_code", "FC").order("submitted_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email, role").eq("role", "driver"),
        supabase.from("driver_vehicles").select("user_id, rego, status").eq("status", "Active"),
      ]);
      if (fcError) throw fcError;
      if (profileError) throw profileError;
      if (vehicleError) throw vehicleError;
      setRows((fcData || []) as FcRow[]);
      const vehicleByUser = new Map<string, string>();
      (vehicleData || []).forEach((v: any) => {
        if (!vehicleByUser.has(v.user_id)) vehicleByUser.set(v.user_id, v.rego || "Not provided");
      });
      setDrivers((profileData || []).map((p: any) => ({
        id: p.id,
        name: p.full_name || p.email || "Unknown",
        email: p.email || "",
        vehicle: vehicleByUser.get(p.id) || "Not provided",
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fatigue monitoring data.");
      setRows([]);
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const latestByDriver = useMemo(() => {
    const map = new Map<string, FcRow>();
    rows.forEach((row) => {
      if (!map.has(row.user_id)) map.set(row.user_id, row);
    });
    return map;
  }, [rows]);

  const stats = useMemo(() => {
    const totalDrivers = drivers.length;
    const completed = latestByDriver.size;
    const pending = Math.max(0, totalDrivers - completed);
    const concerns = rows.filter((r) => Boolean((r.payload || {}).fatigueConcern)).length;
    return { totalDrivers, completed, pending, concerns };
  }, [drivers, latestByDriver, rows]);

  const filteredDrivers = useMemo(() => {
    return drivers.filter((driver) => {
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = `${driver.name} ${driver.email} ${driver.id}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const row = latestByDriver.get(driver.id);
      if (dateFilter) {
        if (!row || !row.submitted_at.startsWith(dateFilter)) return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "completed" && !row) return false;
        if (statusFilter === "pending" && row) return false;
        if (statusFilter === "concern" && !(row && (row.payload || {}).fatigueConcern)) return false;
      }
      return true;
    });
  }, [drivers, latestByDriver, search, dateFilter, statusFilter]);

  const historyForSelected = useMemo(() => {
    if (!selected) return [];
    return rows.filter((r) => r.user_id === selected.user_id);
  }, [rows, selected]);

  return (
    <section className="space-y-6 text-white">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-black">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          Driver Fatigue Monitoring
        </h2>
        <p className="mt-1 text-sm text-slate-300">Monitor driver fatigue checklist submissions, concerns and history.</p>
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Drivers", value: stats.totalDrivers },
          { label: "Completed Checks", value: stats.completed },
          { label: "Pending Checks", value: stats.pending },
          { label: "Fatigue Concerns", value: stats.concerns },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-black">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search driver name, email or ID..."
          className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
        />
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="concern">Fatigue concern</option>
        </select>
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-300">Loading fatigue monitoring data...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-800/80 text-left text-slate-300">
              <tr>
                <th className="px-4 py-3">Driver Name</th>
                <th className="px-4 py-3">Driver ID</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Last Submission</th>
                <th className="px-4 py-3">Submission Status</th>
                <th className="px-4 py-3">Fatigue Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => {
                const row = latestByDriver.get(driver.id);
                const payload = (row?.payload || {}) as Record<string, unknown>;
                const fatigueConcern = Boolean(payload.fatigueConcern);
                return (
                  <tr key={driver.id} className="border-t border-slate-700 hover:bg-slate-800/40">
                    <td className="px-4 py-3">{driver.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{driver.id}</td>
                    <td className="px-4 py-3">{driver.vehicle}</td>
                    <td className="px-4 py-3">{row ? new Date(row.submitted_at).toLocaleString() : "Not submitted"}</td>
                    <td className="px-4 py-3">{row ? row.status : "Pending"}</td>
                    <td className="px-4 py-3">
                      {row ? (
                        fatigueConcern ? <span className="text-amber-300 font-semibold">Concern reported</span> : <span className="text-emerald-300 font-semibold">No concern</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row ? (
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Details
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">No submission</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredDrivers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-300">No driver fatigue records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Driver Fatigue Submission Details</h3>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">Close</button>
            </div>
            <div className="space-y-3 text-sm">
              <p><span className="text-slate-400">Driver:</span> {driverById.get(selected.user_id)?.name || selected.user_id}</p>
              <p><span className="text-slate-400">Submitted:</span> {new Date(selected.submitted_at).toLocaleString()}</p>
              <p><span className="text-slate-400">Status:</span> {selected.status}</p>
              {Array.isArray((selected.payload || {}).answers) && (
                <div>
                  <p className="mb-2 font-semibold">Answers</p>
                  <ul className="space-y-1">
                    {((selected.payload as any).answers as Array<{ question: string; answer: string }>).map((a, idx) => (
                      <li key={idx} className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
                        <span className="text-slate-300">{a.question}</span>: <span className="font-semibold">{a.answer || "Not answered"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(selected.payload || {}).comments ? <p><span className="text-slate-400">Comments:</span> {String((selected.payload || {}).comments)}</p> : null}
              <p><span className="text-slate-400">Declaration:</span> {(selected.payload || {}).declared ? "Submitted" : "Not submitted"}</p>
              {Boolean((selected.payload || {}).fatigueConcern) && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">Fatigue concern reported. Requires safety review.</p>
              )}
            </div>

            <div className="mt-5">
              <h4 className="mb-2 text-sm font-bold">Submission history</h4>
              <div className="space-y-2">
                {historyForSelected.map((h) => (
                  <div key={h.id} className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-300">
                    {new Date(h.submitted_at).toLocaleString()} - {h.status} {Boolean((h.payload || {}).fatigueConcern) ? "(concern)" : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
