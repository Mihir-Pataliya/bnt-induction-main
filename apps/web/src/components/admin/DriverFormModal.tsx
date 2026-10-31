import React, { useState, FormEvent, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { AdminDriverRow, DriverFormInput } from "../../types";
import { api } from "../../lib/api";
import { useAppState } from "../../state/AppContext";

interface DriverFormModalProps {
  driver?: AdminDriverRow | null;
  onSave: (input: DriverFormInput & { password?: string }) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

export function DriverFormModal({ driver, onSave, onClose, loading }: DriverFormModalProps) {
  const { t } = useTranslation();
  const { session } = useAppState();
  const isEditing = !!driver;

  const [formData, setFormData] = useState({
    fullName: driver?.fullName || "",
    email: driver?.email || "",
    phone: driver?.phone || "",
    address: driver?.address || "",
    preferredLanguage: driver?.preferredLanguage || "English",
    licenceClass: driver?.licenceClass || "HC",
    issuingState: driver?.issuingState || "VIC",
    licenceNumber: driver?.licenceNumber || "",
    dateOfBirth: driver?.dateOfBirth || "",
    licenceHistoryProvided: driver?.licenceHistoryProvided ?? false,
    leftBusiness: driver?.leftBusiness ?? false,
    depotLocation: driver?.depotLocation || "Melbourne Hub",
    password: "",
    employmentType: "employee" as "employee" | "contractor",
    staffRole: "driver" as "driver" | "warehouse" | "office",
    contractorCompanyId: "",
    newCompanyName: "",
    newCompanyAbn: ""
  });
  const [contractorCompanies, setContractorCompanies] = useState<Array<{ id: string; companyName: string; tradingName: string; abn: string }>>([]);
  const [companiesError, setCompaniesError] = useState("");

  useEffect(() => {
    if (isEditing || !session) return;
    api.getContractorCompaniesForAdmin(session)
      .then(setContractorCompanies)
      .catch((error) => setCompaniesError(error instanceof Error ? error.message : "Could not load contractor companies."));
  }, [isEditing, session]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requiresDriverLicence = (isEditing ? driver?.staffRole : formData.staffRole) === "driver";

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
      errs.fullName = t("drf_err_name");
    }
    if (!formData.email.trim() || !formData.email.includes("@")) {
      errs.email = t("drf_err_email");
    }
    if (!formData.phone.trim() || formData.phone.trim().length < 5) {
      errs.phone = t("drf_err_phone");
    }
    if (!formData.address.trim() || formData.address.trim().length < 5) {
      errs.address = t("drf_err_address");
    }
    if (requiresDriverLicence && !/^[A-Z0-9]{8}$/.test(formData.licenceNumber.trim().toUpperCase())) {
      errs.licenceNumber = t("reg_err_licence");
    }
    if (!isEditing && (!formData.password || formData.password.length < 8)) {
      errs.password = t("drf_err_password");
    }
    if (!isEditing && formData.employmentType === "contractor" && (formData.contractorCompanyId === "" || (formData.contractorCompanyId === "__new__" && !formData.newCompanyName.trim()))) {
      errs.contractorCompany = "Select a contractor company or enter a new company name.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      let contractorCompanyId = formData.contractorCompanyId;
      if (!isEditing && formData.employmentType === "contractor" && contractorCompanyId === "__new__") {
        if (!session) throw new Error("Your admin session has expired. Please sign in again.");
        const company = await api.createContractorCompanyForAdmin(session, { companyName: formData.newCompanyName.trim(), abn: formData.newCompanyAbn.trim() || undefined });
        contractorCompanyId = company.id;
      }
      await onSave({
      ...formData,
      dateOfBirth: formData.dateOfBirth,
      licenceHistoryProvided: formData.licenceHistoryProvided,
      leftBusiness: formData.leftBusiness,
      contractorCompanyId: formData.employmentType === "contractor" ? contractorCompanyId : undefined
    });
    } catch (err: any) {
      setSubmitError(err?.message || t("drf_err_save"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px"
      }}
    >
      <div
        className="glass"
        style={{
          width: "100%",
          maxWidth: "580px",
          padding: "28px",
          borderRadius: "20px",
          maxHeight: "90vh",
          overflowY: "auto"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>
            {isEditing ? t("drf_edit_title", { name: driver.fullName }) : t("drf_add_title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <X className="w-5 h-5 text-slate-500 hover:text-slate-800" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {submitError && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                padding: "10px 14px",
                borderRadius: "10px",
                marginBottom: "16px",
                fontSize: "0.85rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isEditing && driver && (
            <section aria-label="Employment details" style={{ padding: "14px", marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--border, #cbd5e1)", background: "var(--bg-elevated, rgba(148,163,184,0.06))" }}>
              <strong style={{ display: "block", fontSize: "0.85rem", marginBottom: "10px" }}>Employment Details</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                <div><span className="muted" style={{ display: "block", fontSize: "0.72rem" }}>Employment Type</span><strong style={{ fontSize: "0.85rem" }}>{driver.employmentType === "contractor" ? "Contractor" : "Employee"}</strong></div>
                <div><span className="muted" style={{ display: "block", fontSize: "0.72rem" }}>Staff Role</span><strong style={{ fontSize: "0.85rem" }}>{driver.staffRole === "warehouse" ? "Warehouse" : driver.staffRole === "office" ? "Office" : "Driver"}</strong></div>
                {driver.employmentType === "contractor" && <div><span className="muted" style={{ display: "block", fontSize: "0.72rem" }}>Contractor Company</span><strong style={{ fontSize: "0.85rem" }}>{driver.contractorCompanyName || "Not linked"}</strong></div>}
              </div>
            </section>
          )}

          {!isEditing && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>Employment Type</label>
                <select value={formData.employmentType} onChange={(e) => setFormData({ ...formData, employmentType: e.target.value as "employee" | "contractor", contractorCompanyId: "", newCompanyName: "", newCompanyAbn: "" })} style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}>
                  <option value="employee">Employee</option>
                  <option value="contractor">Contractor</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>Staff Role</label>
                <select value={formData.staffRole} onChange={(e) => setFormData({ ...formData, staffRole: e.target.value as typeof formData.staffRole })} style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}>
                  <option value="driver">Driver</option><option value="warehouse">Warehouse</option><option value="office">Office</option>
                </select>
              </div>
              {formData.employmentType === "contractor" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>Contractor Company</label>
                  <select value={formData.contractorCompanyId} onChange={(e) => setFormData({ ...formData, contractorCompanyId: e.target.value, newCompanyName: "", newCompanyAbn: "" })} style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}>
                    <option value="">Select company</option>
                    {contractorCompanies.map((company) => <option key={company.id} value={company.id}>{company.companyName}{company.abn ? ` · ${company.abn}` : ""}</option>)}
                    <option value="__new__">Add a new company…</option>
                  </select>
                </div>
              )}
              {formData.employmentType === "contractor" && formData.contractorCompanyId === "__new__" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>New Company Name</label>
                    <input value={formData.newCompanyName} onChange={(e) => setFormData({ ...formData, newCompanyName: e.target.value })} className="form-input" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>ABN (optional)</label>
                    <input value={formData.newCompanyAbn} onChange={(e) => setFormData({ ...formData, newCompanyAbn: e.target.value })} className="form-input" style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }} />
                  </div>
                </>
              )}
              {errors.contractorCompany && <span style={{ gridColumn: "1 / -1", color: "#ef4444", fontSize: "0.75rem" }}>{errors.contractorCompany}</span>}
              {companiesError && <span style={{ gridColumn: "1 / -1", color: "#d97706", fontSize: "0.75rem" }}>{companiesError}</span>}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_full_name")}
              </label>
              <input
                type="text"
                placeholder={t("drf_name_ph")}
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className={`form-input ${errors.fullName ? "form-input--error" : ""}`}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              {errors.fullName && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.fullName}</span>}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_email")}
              </label>
              <input
                type="email"
                placeholder="driver@bntlogistics.com.au"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={`form-input ${errors.email ? "form-input--error" : ""}`}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              {errors.email && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.email}</span>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_phone")}
              </label>
              <input
                type="tel"
                placeholder={t("drf_phone_ph")}
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={`form-input ${errors.phone ? "form-input--error" : ""}`}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              {errors.phone && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.phone}</span>}
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_depot")}
              </label>
              <select
                value={formData.depotLocation}
                onChange={(e) => setFormData({ ...formData, depotLocation: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
              >
                <option value="Melbourne Hub">{t("drf_depot_melbourne")}</option>
                <option value="Sydney Hub">{t("drf_depot_sydney")}</option>
                <option value="Brisbane Hub">{t("drf_depot_brisbane")}</option>
                <option value="Adelaide Hub">{t("drf_depot_adelaide")}</option>
                <option value="Perth Hub">{t("drf_depot_perth")}</option>
              </select>
            </div>
          </div>

          {requiresDriverLicence && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_licence_class")}
              </label>
              <select
                value={formData.licenceClass}
                onChange={(e) => setFormData({ ...formData, licenceClass: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
              >
                <option value="MC">{t("drf_lc_mc")}</option>
                <option value="HC">{t("drf_lc_hc")}</option>
                <option value="HR">{t("drf_lc_hr")}</option>
                <option value="MR">{t("drf_lc_mr")}</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_state")}
              </label>
              <select
                value={formData.issuingState}
                onChange={(e) => setFormData({ ...formData, issuingState: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
              >
                <option value="VIC">VIC</option>
                <option value="NSW">NSW</option>
                <option value="QLD">QLD</option>
                <option value="SA">SA</option>
                <option value="WA">WA</option>
                <option value="TAS">TAS</option>
                <option value="NT">NT</option>
                <option value="ACT">ACT</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_licence_number")}
              </label>
              <input
                type="text"
                placeholder={t("drf_licence_ph")}
                maxLength={8}
                minLength={8}
                value={formData.licenceNumber}
                onChange={(e) => setFormData({ ...formData, licenceNumber: e.target.value.toUpperCase() })}
                className={errors.licenceNumber ? "form-input form-input--error" : "form-input"}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              <span style={{ color: "#64748b", fontSize: "0.72rem" }}>Enter exactly 8 letters or numbers.</span>
              {errors.licenceNumber && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.licenceNumber}</span>}
            </div>
          </div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                Date of birth
              </label>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                Licence history provided
              </label>
              <select
                value={formData.licenceHistoryProvided ? "yes" : "no"}
                onChange={(e) => setFormData({ ...formData, licenceHistoryProvided: e.target.value === "yes" })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
              Driver left the business
            </label>
            <select
              value={formData.leftBusiness ? "yes" : "no"}
              onChange={(e) => setFormData({ ...formData, leftBusiness: e.target.value === "yes" })}
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("drf_address")}
            </label>
            <input
              type="text"
              placeholder={t("drf_address_ph")}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className={`form-input ${errors.address ? "form-input--error" : ""}`}
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
            />
            {errors.address && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.address}</span>}
          </div>

          {!isEditing && (
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "4px" }}>
                {t("drf_password")}
              </label>
              <input
                type="password"
                placeholder={t("drf_password_ph")}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={`form-input ${errors.password ? "form-input--error" : ""}`}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
              />
              {errors.password && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.password}</span>}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "transparent", cursor: "pointer" }}
            >
              {t("drf_cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || loading}
              style={{
                padding: "8px 20px",
                borderRadius: "8px",
                border: "none",
                background: "#1e3a5f",
                color: "#fff",
                fontWeight: 700,
                cursor: isSubmitting || loading ? "not-allowed" : "pointer",
                opacity: isSubmitting || loading ? 0.7 : 1
              }}
            >
              {isSubmitting || loading
                ? isEditing
                  ? t("drf_updating")
                  : t("drf_creating")
                : isEditing
                ? t("drf_update")
                : t("drf_create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
