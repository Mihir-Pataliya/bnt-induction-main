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
  if (!document) return "Not uploaded";
  return document.status;
}

function yesNo(value: boolean | undefined) {
  return value ? "Yes" : "No";
}
export function LicenceRegister({ session }: LicenceRegisterProps) {
  const [drivers, setDrivers] = useState<AdminDriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
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

  const filteredDrivers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drivers.filter((driver) => {
      if (query) {
        const haystack = [
          driver.fullName,
          driver.licenceNumber,
          driver.issuingState,
          driver.licenceClass
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      const left = Boolean(driver.leftBusiness);
      const expiry = expiryStatus(driver);
      const verification = verificationStatus(driver);

      switch (filter) {
        case "left":
          return left;
        case "active":
          return !left;
        case "expired":
          return expiry === "Expired";
        case "expiring":
          return expiry === "Expiring";
        case "verified":
          return verification === "approved";
        case "pending":
          return verification === "pending";
        default:
          return true;
      }
    });
  }, [drivers, search, filter]);

  const handleSave = async (input: DriverFormInput & { password?: string }) => {
    setSaving(true);
    setError(null);
    try {
      if (modalDriver) {
        await api.updateDriverByAdmin(session, modalDriver.id, input);
      } else {
        const result = (await api.createDriver(session, { ...input, password: input.password ?? "" })) as { userId?: string };
        if (result?.userId) {
          await api.updateDriverByAdmin(session, result.userId, input);
        }
      }
      setIsModalOpen(false);
      setModalDriver(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save licence register record.");
      throw err;
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="glass card-hover" style={{ padding: "24px", borderRadius: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Licence Register</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            Dedicated register of driver licence details, expiry, verification, history and departure status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalDriver(null);
            setIsModalOpen(true);
          }}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#1e3a5f", color: "#fff", fontWeight: 700, cursor: "pointer" }}
        >
          Add record
        </button>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
        <input
          type="search"
          placeholder="Search driver, licence number, state or type"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 260px", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
        >
          <option value="all">All records</option>
          <option value="active">Not left business</option>
          <option value="left">Left business</option>
          <option value="expired">Expired</option>
          <option value="expiring">Expiring soon</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending verification</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "transparent", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: "12px", color: "#ef4444", fontSize: "0.85rem" }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: "24px", textAlign: "center" }}>Loading licence register...</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                <th style={{ padding: "8px" }}>Licence No.</th>
                <th style={{ padding: "8px" }}>Driver Name</th>
                <th style={{ padding: "8px" }}>State</th>
                <th style={{ padding: "8px" }}>Date of Birth</th>
                <th style={{ padding: "8px" }}>Licence Expiry Date</th>
                <th style={{ padding: "8px" }}>Licence Type</th>
                <th style={{ padding: "8px" }}>Licence History Provided</th>
                <th style={{ padding: "8px" }}>Driver Left the Business</th>
                <th style={{ padding: "8px" }}>Verification Status</th>
                <th style={{ padding: "8px" }}>Expiry Status</th>
                <th style={{ padding: "8px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => {
                const document = licenceDocument(driver);
                const expiry = expiryStatus(driver);
                const verification = verificationStatus(driver);
                return (
                  <tr key={driver.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{driver.licenceNumber || "�"}</td>
                    <td style={{ padding: "8px" }}>{driver.fullName || "�"}</td>
                    <td style={{ padding: "8px" }}>{driver.issuingState || "�"}</td>
                    <td style={{ padding: "8px" }}>{driver.dateOfBirth || "�"}</td>
                    <td style={{ padding: "8px" }}>{document?.expiresAt ? new Date(document.expiresAt).toLocaleDateString("en-AU") : "�"}</td>
                    <td style={{ padding: "8px" }}>{driver.licenceClass || "�"}</td>
                    <td style={{ padding: "8px" }}>{yesNo(driver.licenceHistoryProvided)}</td>
                    <td style={{ padding: "8px" }}>{yesNo(driver.leftBusiness)}</td>
                    <td style={{ padding: "8px" }}>{verification}</td>
                    <td style={{ padding: "8px" }}>{expiry}</td>
                    <td style={{ padding: "8px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setModalDriver(driver);
                          setIsModalOpen(true);
                        }}
                        style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "transparent", cursor: "pointer" }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredDrivers.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "16px", textAlign: "center" }}>No licence register records found.</td>
                </tr>
              )}
            </tbody>
          </table>
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

