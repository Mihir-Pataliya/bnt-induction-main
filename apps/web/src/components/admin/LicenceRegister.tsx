import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { AdminDriverRow, DriverFormInput, SessionState } from "../../types";
import { DriverFormModal } from "./DriverFormModal";

interface LicenceRegisterProps {
  session: SessionState;
}

function licenceDocument(driver: AdminDriverRow) {
  return (driver.documents || []).find((document) => document.type === "driver_license");
}

function formatDate(value?: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not provided";
  return date.toLocaleDateString("en-AU");
}

function expiryStatus(driver: AdminDriverRow) {
  const document = licenceDocument(driver);
  if (!document) return "Missing";
  if (!document.expiresAt) return "No expiry date";
  const expiry = new Date(document.expiresAt);
  const now = new Date();
  if (Number.isNaN(expiry.getTime())) return "No expiry date";
  if (expiry < now) return "Expired";
  if (expiry.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000) return "Expiring";
  return "Current";
}

function verificationStatus(driver: AdminDriverRow) {
  const document = licenceDocument(driver);
  if (!document) return "not uploaded";
  return (document.status || "pending").toLowerCase();
}

function verificationLabel(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "pending") return "Pending";
  return "Not uploaded";
}

function yesNo(value: boolean | undefined) {
  return value ? "Yes" : "No";
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "missing", label: "Missing" },
];

export function LicenceRegister({ session }: LicenceRegisterProps) {
  const [drivers, setDrivers] = useState<AdminDriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [modalDriver, setModalDriver] = useState<AdminDriverRow | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await api.getAdminOverview(session);
      setDrivers(overview.drivers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load licence register.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session]);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  const filteredDrivers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drivers.filter((driver) => {
      if (query) {
        const haystack = [
          driver.fullName,
          driver.email,
          driver.licenceNumber,
          driver.issuingState,
          driver.licenceClass,
          driver.depotLocation,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      const expiry = expiryStatus(driver);
      const verification = verificationStatus(driver);

      switch (filter) {
        case "approved":
          return verification === "approved";
        case "pending":
          return verification === "pending";
        case "rejected":
          return verification === "rejected";
        case "expired":
          return expiry === "Expired";
        case "missing":
          return verification === "not uploaded";
        default:
          return true;
      }
    });
  }, [drivers, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredDrivers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedDrivers = filteredDrivers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const summary = useMemo(() => {
    const total = drivers.length;
    const approved = drivers.filter((d) => verificationStatus(d) === "approved").length;
    const pending = drivers.filter((d) => verificationStatus(d) === "pending").length;
    const expired = drivers.filter((d) => expiryStatus(d) === "Expired").length;
    const missing = drivers.filter((d) => verificationStatus(d) === "not uploaded").length;
    return { total, approved, pending, expired, missing };
  }, [drivers]);

  const handleSave = async (input: DriverFormInput & { password?: string }) => {
    setSaving(true);
    setError(null);
    try {
      if (modalDriver) {
        await api.updateDriverByAdmin(session, modalDriver.id, input);
      }
      await load();
      setIsModalOpen(false);
      setModalDriver(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save licence register record.");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const badgeClass = (tone: "emerald" | "amber" | "rose" | "slate") => {
    if (tone === "emerald") return "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    if (tone === "amber") return "border border-amber-500/30 bg-amber-500/10 text-amber-300";
    if (tone === "rose") return "border border-rose-500/30 bg-rose-500/10 text-rose-300";
    return "border border-slate-600 bg-slate-700 text-slate-300";
  };

  return (
    <div className="space-y-5 text-white">
      <div>
        <h3 className="text-xl font-bold">Licence Register</h3>
        <p className="mt-1 text-sm text-slate-300">
          Dedicated register of driver licence details, expiry, verification, history and departure status.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total Licences", value: summary.total, tone: "slate" as const },
          { label: "Approved", value: summary.approved, tone: "emerald" as const },
          { label: "Pending", value: summary.pending, tone: "amber" as const },
          { label: "Expired", value: summary.expired, tone: "rose" as const },
          { label: "Missing", value: summary.missing, tone: "slate" as const },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, licence number, state, class, depot..."
          className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                filter === item.value
                  ? "border border-emerald-600 bg-emerald-600/20 text-emerald-200"
                  : "border border-slate-600 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-300">Loading licence register...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-800/80 text-left text-slate-300">
              <tr>
                <th className="px-4 py-3">Licence No.</th>
                <th className="px-4 py-3">Driver Name</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Date of Birth</th>
                <th className="px-4 py-3">Licence Expiry</th>
                <th className="px-4 py-3">Licence Type</th>
                <th className="px-4 py-3">History Provided</th>
                <th className="px-4 py-3">Left Business</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3">Expiry Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedDrivers.map((driver) => {
                const document = licenceDocument(driver);
                const expiry = expiryStatus(driver);
                const verification = verificationStatus(driver);
                const verificationTone =
                  verification === "approved" ? "emerald" : verification === "rejected" ? "rose" : verification === "pending" ? "amber" : "slate";
                const expiryTone = expiry === "Expired" ? "rose" : expiry === "Expiring" ? "amber" : expiry === "Current" ? "emerald" : "slate";
                return (
                  <tr key={driver.id} className="border-t border-slate-700 hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono">{driver.licenceNumber || "Not provided"}</td>
                    <td className="px-4 py-3">{driver.fullName || "Not provided"}</td>
                    <td className="px-4 py-3">{driver.issuingState || "Not provided"}</td>
                    <td className="px-4 py-3">{formatDate(driver.dateOfBirth)}</td>
                    <td className="px-4 py-3">{formatDate(document?.expiresAt)}</td>
                    <td className="px-4 py-3">{driver.licenceClass || "Not provided"}</td>
                    <td className="px-4 py-3">{yesNo(driver.licenceHistoryProvided)}</td>
                    <td className="px-4 py-3">{yesNo(driver.leftBusiness)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass(verificationTone)}`}>
                        {verificationLabel(verification)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${badgeClass(expiryTone)}`}>
                        {expiry}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setModalDriver(driver);
                          setIsModalOpen(true);
                        }}
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {pagedDrivers.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-slate-300">
                    No licence register records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filteredDrivers.length > pageSize && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredDrivers.length)} of {filteredDrivers.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {isModalOpen && (
        <DriverFormModal
          driver={modalDriver}
          onSave={handleSave}
          onClose={() => {
            setIsModalOpen(false);
            setModalDriver(null);
          }}
          loading={saving}
        />
      )}
    </div>
  );
}
