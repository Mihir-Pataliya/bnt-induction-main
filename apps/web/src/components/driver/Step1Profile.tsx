import { useEffect, useRef, useState, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { DriverProfile, DriverFormInput } from "../../types";
import { useAppState } from "../../state/AppContext";
import { api } from "../../lib/api";
import { validateBasicProfile } from "../../lib/profileValidation.mjs";

interface Step1ProfileProps {
  driver: DriverProfile;
  onSave: (input: DriverFormInput) => Promise<void>;
  loading: boolean;
}

const LICENCE_FORMATS: Record<string, { regex: RegExp; hint: string }> = Object.fromEntries(
  ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"].map((state) => [
    state,
    { regex: /^[A-Z0-9]{8}$/, hint: "Exactly 8 letters or numbers (e.g. 09876543)." }
  ])
);

const AU_PHONE_REGEX = /^(?:\+?61|0)4\d{8}$/;

function formatAustralianPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.startsWith("61") ? `0${digits.slice(3)}` : digits.startsWith("0") ? digits : `0${digits}`;
  if (normalized.length <= 4) return normalized;
  if (normalized.length <= 7) return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
  return `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7, 10)}`;
}

export function Step1Profile({ driver, onSave, loading }: Step1ProfileProps) {
  const { t } = useTranslation();
  const { session } = useAppState();
  const authEmail = session?.user?.email || driver.email || "";

  const [formData, setFormData] = useState<DriverFormInput>({
    employmentType: driver.employmentType || "employee",
    staffRole: driver.staffRole || "driver",
    fullName: driver.fullName || "",
    email: authEmail,
    phone: driver.phone || "",
    emergencyContactName: driver.emergencyContactName || "",
    emergencyContactRelationship: driver.emergencyContactRelationship || "",
    emergencyContactPhone: driver.emergencyContactPhone || "",
    address: driver.address || "",
    dateOfBirth: driver.dateOfBirth || "",
    preferredLanguage: driver.preferredLanguage || "English",
    licenceClass: driver.licenceClass || "HC",
    issuingState: driver.issuingState || "VIC",
    licenceNumber: driver.licenceNumber || "",
    depotLocation: driver.depotLocation || "Melbourne Hub",
    employmentStartDate: driver.employmentStartDate || "",
    employmentBasis: driver.employmentBasis || "full_time",
    payrollTfn: "",
    payrollBankAccountName: "",
    payrollBankBsb: "",
    payrollBankAccountNumber: "",
    superFundChoice: "default",
    superFundName: "",
    superMemberNumber: "",
    payrollDeclarationConfirmed: false
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [licenceChecking, setLicenceChecking] = useState(false);
  const [payrollSaved, setPayrollSaved] = useState(false);
  const [payrollLoadError, setPayrollLoadError] = useState("");
  const [licenceUnique, setLicenceUnique] = useState<boolean | null>(null);
  const licenceCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const licenceCheckAbort = useRef(0);

  useEffect(() => {
    setFormData((prev) => ({ ...prev, email: authEmail }));
  }, [authEmail]);

  useEffect(() => {
    if (driver.employmentType === "contractor" || !session) return;
    api.getEmployeePayrollStatus(session).then((status) => setPayrollSaved(status.saved)).catch((error) => setPayrollLoadError(error.message));
  }, [driver.employmentType, session]);

  const validateLicenceFormat = (licenceNumber: string, issuingState: string): string | null => {
    const trimmed = licenceNumber.trim().toUpperCase();
    if (!trimmed) return t("err_licence_required");
    const format = LICENCE_FORMATS[issuingState || "VIC"];
    if (format && !format.regex.test(trimmed)) {
      return t("err_licence_format", { state: issuingState, hint: format.hint });
    }
    return null;
  };

  const checkLicenceDuplicate = (licenceNumber: string, issuingState: string) => {
    if (licenceCheckTimer.current) {
      clearTimeout(licenceCheckTimer.current);
    }

    const trimmed = licenceNumber.trim().toUpperCase();
    const formatError = validateLicenceFormat(trimmed, issuingState);
    if (formatError || !trimmed) {
      setLicenceUnique(null);
      setLicenceChecking(false);
      return;
    }

    setLicenceChecking(true);
    licenceCheckTimer.current = setTimeout(async () => {
      const checkId = ++licenceCheckAbort.current;
      try {
        const result = await api.checkLicenceUnique(trimmed, issuingState, session?.user?.id);
        if (checkId === licenceCheckAbort.current) {
          setLicenceUnique(result.unique);
        }
      } catch {
        if (checkId === licenceCheckAbort.current) {
          setLicenceUnique(null);
        }
      } finally {
        if (checkId === licenceCheckAbort.current) {
          setLicenceChecking(false);
        }
      }
    }, 500);
  };

  const validate = (): boolean => {
    const isDriver = (driver.staffRole ?? "driver") === "driver";
    const errs = validateBasicProfile(formData, { requiresDriverLicence: isDriver }) as Record<string, string>;
    if (isDriver && formData.licenceNumber) {
      const licenceFormatError = validateLicenceFormat(formData.licenceNumber, formData.issuingState || "VIC");
      if (licenceFormatError) errs.licenceNumber = licenceFormatError;
      else if (licenceUnique === false) errs.licenceNumber = t("err_licence_dup");
    }
    if (driver.employmentType !== "contractor") {
      if (!/^\d{8,9}$/.test(formData.payrollTfn ?? "")) errs.payrollTfn = "Enter an 8 or 9 digit tax file number.";
      if (!String(formData.payrollBankAccountName ?? "").trim()) errs.payrollBankAccountName = "Enter the account name.";
      if (!/^\d{6}$/.test((formData.payrollBankBsb ?? "").replace(/\D/g, ""))) errs.payrollBankBsb = "Enter a 6 digit BSB.";
      if (!/^\d{5,10}$/.test(formData.payrollBankAccountNumber ?? "")) errs.payrollBankAccountNumber = "Enter a valid account number.";
      if (formData.superFundChoice !== "default" && (!formData.superFundName?.trim() || !formData.superMemberNumber?.trim())) errs.superFund = "Enter your super fund name and member number.";
      if (!formData.payrollDeclarationConfirmed) errs.payrollDeclarationConfirmed = "Confirm the payroll declaration to continue.";
      if (!formData.employmentStartDate) errs.employmentStartDate = "Enter your employment start date.";
      if (!formData.employmentBasis) errs.employmentBasis = "Select your employment basis.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const isDriver = (driver.staffRole ?? "driver") === "driver";
    onSave({ ...formData, email: authEmail, ...(isDriver ? {} : { licenceClass: undefined, issuingState: undefined, licenceNumber: undefined }) });
  };

  const formatHint = LICENCE_FORMATS[formData.issuingState || "VIC"]?.hint;

  return (
    <div className="glass" style={{ padding: "28px", borderRadius: "16px", maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "0 0 4px" }}>
          {t("s1_title")}
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          {t("s1_sub")}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ padding: "12px 14px", marginBottom: "14px", borderRadius: "10px", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)", fontSize: "0.84rem" }}>
          <strong>{driver.employmentType === "contractor" ? "Contractor" : "Employee"} | {driver.staffRole === "warehouse" ? "Warehouse" : driver.staffRole === "office" ? "Office" : "Driver"}</strong>
          <div className="muted" style={{ marginTop: 4 }}>
            {driver.employmentType === "contractor"
              ? "Your contractor company, insurance and agreement requirements are managed in the contractor onboarding steps."
              : "Your employee onboarding checklist is assigned for your staff role."}
            {driver.staffRole === "driver" ? " Driver licence details are required for this role." : ` Driver licence details are not required for the ${driver.staffRole === "warehouse" ? "Warehouse" : "Office"} role.`}
          </div>
        </div>
        {driver.employmentType !== "contractor" && <fieldset style={{ border: "1px solid rgba(148, 163, 184, 0.3)", borderRadius: "10px", padding: "14px", margin: "0 0 16px" }}>
          <legend style={{ padding: "0 6px", fontSize: "0.92rem", fontWeight: 700 }}>Employee employment and payroll setup</legend>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>Payroll details are encrypted and stored separately from your profile. Only payroll-authorized staff can view them. Do not enter contractor company banking details here.</p>
          {payrollSaved && <p role="status" style={{ color: "#15803d", fontSize: "0.8rem" }}>Payroll setup is saved. Re-enter the current values only if you need to replace them.</p>}
          {payrollLoadError && <p role="alert" style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{payrollLoadError}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label className="form-label">Employment start date<input type="date" required value={formData.employmentStartDate} onChange={(e) => setFormData({ ...formData, employmentStartDate: e.target.value })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} />{errors.employmentStartDate && <small style={{ color: "#b91c1c" }}>{errors.employmentStartDate}</small>}</label>
            <label className="form-label">Employment basis<select value={formData.employmentBasis} onChange={(e) => setFormData({ ...formData, employmentBasis: e.target.value as DriverFormInput["employmentBasis"] })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="casual">Casual</option></select></label>
            <label className="form-label">Tax file number<input type="password" inputMode="numeric" autoComplete="off" maxLength={9} required value={formData.payrollTfn} onChange={(e) => setFormData({ ...formData, payrollTfn: e.target.value.replace(/\D/g, "") })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} />{errors.payrollTfn && <small style={{ color: "#b91c1c" }}>{errors.payrollTfn}</small>}</label>
            <label className="form-label">Bank account name<input autoComplete="off" required value={formData.payrollBankAccountName} onChange={(e) => setFormData({ ...formData, payrollBankAccountName: e.target.value })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} />{errors.payrollBankAccountName && <small style={{ color: "#b91c1c" }}>{errors.payrollBankAccountName}</small>}</label>
            <label className="form-label">BSB<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} required value={formData.payrollBankBsb} onChange={(e) => setFormData({ ...formData, payrollBankBsb: e.target.value.replace(/\D/g, "") })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} />{errors.payrollBankBsb && <small style={{ color: "#b91c1c" }}>{errors.payrollBankBsb}</small>}</label>
            <label className="form-label">Bank account number<input type="password" inputMode="numeric" autoComplete="off" maxLength={10} required value={formData.payrollBankAccountNumber} onChange={(e) => setFormData({ ...formData, payrollBankAccountNumber: e.target.value.replace(/\D/g, "") })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} />{errors.payrollBankAccountNumber && <small style={{ color: "#b91c1c" }}>{errors.payrollBankAccountNumber}</small>}</label>
            <label className="form-label">Superannuation option<select value={formData.superFundChoice} onChange={(e) => setFormData({ ...formData, superFundChoice: e.target.value as DriverFormInput["superFundChoice"] })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }}><option value="default">Use employer default fund</option><option value="existing">Use my existing fund</option><option value="self_managed">Self-managed super fund</option></select></label>
            {formData.superFundChoice !== "default" && <><label className="form-label">Super fund name<input autoComplete="off" value={formData.superFundName} onChange={(e) => setFormData({ ...formData, superFundName: e.target.value })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} /></label><label className="form-label">Super member number<input autoComplete="off" value={formData.superMemberNumber} onChange={(e) => setFormData({ ...formData, superMemberNumber: e.target.value })} className="form-input" style={{ display: "block", width: "100%", padding: "9px", marginTop: 4 }} /></label></>}
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: "0.78rem" }}><input type="checkbox" checked={formData.payrollDeclarationConfirmed} onChange={(e) => setFormData({ ...formData, payrollDeclarationConfirmed: e.target.checked })} />I confirm these details are mine and authorize BNT Logistics payroll staff to use them for payroll and superannuation administration.</label>
          {errors.payrollDeclarationConfirmed && <small style={{ color: "#b91c1c" }}>{errors.payrollDeclarationConfirmed}</small>}
        </fieldset>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div>
            <label htmlFor="driver-fullName" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              Full legal name
            </label>
            <input
              id="driver-fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className={`form-input ${errors.fullName ? "form-input--error" : ""}`}
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }}
            />
            {errors.fullName && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.fullName}</span>}
          </div>
          <div>
            <label htmlFor="driver-email" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_email")}
            </label>
            <input
              id="driver-email"
              name="email"
              type="email"
              autoComplete="email"
              value={formData.email}
              readOnly
              className="form-input"
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", background: "rgba(148, 163, 184, 0.08)", cursor: "not-allowed" }}
              title={t("s1_email_note")}
            />
            <span style={{ color: "#64748b", fontSize: "0.72rem" }}>
              {t("s1_email_note")}
            </span>
            {errors.email && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.email}</span>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div>
            <label htmlFor="driver-phone" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_phone")}
            </label>
            <input
              id="driver-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="0412 345 678"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: formatAustralianPhone(e.target.value) })}
              className={`form-input ${errors.phone ? "form-input--error" : ""}`}
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }}
            />
            {errors.phone && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.phone}</span>}
          </div>
          <div>
            <label htmlFor="driver-depot" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_depot")}
            </label>
            <select
              id="driver-depot"
              name="depotLocation"
              className="form-input"
              value={formData.depotLocation}
              onChange={(e) => setFormData({ ...formData, depotLocation: e.target.value })}
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", fontSize: "0.88rem" }}
            >
              <option value="Melbourne Hub">Melbourne Hub</option>
              <option value="Sydney Hub">Sydney Hub</option>
              <option value="Brisbane Hub">Brisbane Hub</option>
              <option value="Adelaide Hub">Adelaide Hub</option>
              <option value="Perth Hub">Perth Hub</option>
            </select>
          </div>
        </div>

        {(driver.staffRole ?? "driver") === "driver" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
          <div>
            <label htmlFor="driver-licenceClass" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_licence_class")}
            </label>
            <select
              id="driver-licenceClass"
              name="licenceClass"
              className="form-input"
              value={formData.licenceClass}
              onChange={(e) => setFormData({ ...formData, licenceClass: e.target.value })}
              style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", fontSize: "0.88rem" }}
            >
              <option value="MC">MC - Multi-Combination</option>
              <option value="HC">HC - Heavy Combination</option>
              <option value="HR">HR - Heavy Rigid</option>
              <option value="MR">MR - Medium Rigid</option>
            </select>
          </div>
          <div>
            <label htmlFor="driver-issuingState" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_state")}
            </label>
            <select
              id="driver-issuingState"
              name="issuingState"
              className="form-input"
              value={formData.issuingState}
              onChange={(e) => {
                const newState = e.target.value;
                setFormData({ ...formData, issuingState: newState });
                setLicenceUnique(null);
                if (formData.licenceNumber) {
                  checkLicenceDuplicate(formData.licenceNumber, newState);
                }
              }}              style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", fontSize: "0.88rem" }}
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
            <label htmlFor="driver-licenceNumber" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              {t("s1_licence_number")}
            </label>
            <input
              id="driver-licenceNumber"
              name="licenceNumber"
              type="text"
              autoComplete="off"
              maxLength={8}
              minLength={8}
              placeholder={formatHint || "e.g. 09876543"}
              value={formData.licenceNumber}
              onChange={(e) => {
                const value = e.target.value.toUpperCase();
                setFormData({ ...formData, licenceNumber: value });
                setLicenceUnique(null);
                checkLicenceDuplicate(value, formData.issuingState || "VIC");
              }}
              className={`form-input ${errors.licenceNumber ? "form-input--error" : ""}`}
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", textTransform: "uppercase" }}
            />
            {licenceChecking && (
              <span style={{ color: "#d97706", fontSize: "0.72rem" }}>{t("s1_checking")}</span>
            )}
            {!licenceChecking && licenceUnique === true && !errors.licenceNumber && (
              <span style={{ color: "#16a34a", fontSize: "0.72rem" }}>{t("s1_available")}</span>
            )}
            {!licenceChecking && licenceUnique === false && !errors.licenceNumber && (
              <span style={{ color: "#ef4444", fontSize: "0.72rem" }}>{t("s1_registered")}</span>
            )}
            {formatHint && !errors.licenceNumber && (
              <span style={{ color: "#64748b", fontSize: "0.72rem" }}>{formatHint}</span>
            )}
            {errors.licenceNumber && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.licenceNumber}</span>}
          </div>
        </div>}

        <div style={{ marginBottom: "14px" }}>
          <label htmlFor="driver-date-of-birth" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>Date of birth</label>
          <input id="driver-date-of-birth" name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} className={`form-input ${errors.dateOfBirth ? "form-input--error" : ""}`} style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }} />
          {errors.dateOfBirth && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.dateOfBirth}</span>}
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="driver-address" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>
              Residential address
            </label>
          <input
            id="driver-address"
            name="address"
            type="text"
            autoComplete="street-address"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className={`form-input ${errors.address ? "form-input--error" : ""}`}
            style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }}
          />
          {errors.address && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.address}</span>}
        </div>

        <fieldset style={{ border: "1px solid rgba(148, 163, 184, 0.25)", borderRadius: "10px", padding: "14px", margin: "0 0 20px" }}>
          <legend style={{ padding: "0 6px", fontSize: "0.88rem", fontWeight: 700 }}>Emergency contact</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <label htmlFor="driver-emergency-name" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>Contact name</label>
              <input id="driver-emergency-name" name="emergencyContactName" autoComplete="name" required value={formData.emergencyContactName} onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })} className={`form-input ${errors.emergencyContactName ? "form-input--error" : ""}`} style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }} />
              {errors.emergencyContactName && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.emergencyContactName}</span>}
            </div>
            <div>
              <label htmlFor="driver-emergency-relationship" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>Relationship</label>
              <input id="driver-emergency-relationship" name="emergencyContactRelationship" required value={formData.emergencyContactRelationship} onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })} className={`form-input ${errors.emergencyContactRelationship ? "form-input--error" : ""}`} style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }} />
              {errors.emergencyContactRelationship && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.emergencyContactRelationship}</span>}
            </div>
            <div>
              <label htmlFor="driver-emergency-phone" className="form-label" style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: "4px" }}>Phone number</label>
              <input id="driver-emergency-phone" name="emergencyContactPhone" type="tel" autoComplete="tel" inputMode="tel" required value={formData.emergencyContactPhone} onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })} className={`form-input ${errors.emergencyContactPhone ? "form-input--error" : ""}`} style={{ width: "100%", padding: "9px 12px", borderRadius: "8px" }} />
              {errors.emergencyContactPhone && <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>{errors.emergencyContactPhone}</span>}
            </div>
          </div>
        </fieldset>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={loading || licenceChecking}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              background: loading || licenceChecking ? "#94a3b8" : "#1e3a5f",
              color: "#ffffff",
              fontWeight: 700,
              cursor: loading || licenceChecking ? "not-allowed" : "pointer"
            }}
          >
            {loading ? t("s1_saving") : t("s1_continue")}
          </button>
        </div>
      </form>
    </div>
  );
}
