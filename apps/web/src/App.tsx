import { Component, ErrorInfo, ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setAppLanguage } from "./i18n";
import { useAppState } from "./state/AppContext";
import { api } from "./lib/api";
import { toComplianceDocumentRequirements } from "./lib/documentCompliance";
import bntLogo from "./assets/bnt-logistics-logo.png";
import {
  ThemeMode,
  ComplianceAudit,
  AuditAssignment,
  SOPItem,
  ComplianceDocumentRequirement,
  VehicleRecord,
  ContractorCompanyRecord,
  SafetyIncidentRecord,
  SiteCheckinRecord,
  BrandingSettings,
  PolicyRecord,
  LearningSectionProgress,
} from "./types";
import { LoginForm } from "./components/auth/LoginForm";
import { DriverWizard } from "./components/driver/DriverWizard";
import { DriverScheduleInvitations } from "./components/driver/DriverScheduleInvitations";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { ComplianceDashboardView } from "./components/driver/ComplianceDashboardView";
import { DocumentComplianceVault } from "./components/driver/DocumentComplianceVault";
import { AuditAndSOPManager } from "./components/driver/AuditAndSOPManager";
import { VehicleManagementHub } from "./components/driver/VehicleManagementHub";
import { ContractorCompanyHub } from "./components/driver/ContractorCompanyHub";
import { SafetyIncidentReporter } from "./components/driver/SafetyIncidentReporter";
import { DepotCheckinFatigueHub } from "./components/driver/DepotCheckinFatigueHub";
import { LeaveManagement } from "./components/driver/LeaveManagement";
import { CORPage } from "./components/driver/CORPage";
import { LeaveAttendanceAdmin } from "./components/admin/LeaveAttendanceAdmin";
import { PreTripInspectionHub } from "./components/driver/PreTripInspectionHub";
import { DepotGatePassModal } from "./components/driver/DepotGatePassModal";
import { PolicySignModal } from "./components/driver/PolicySignModal";
import { ToastHost, showToast } from "./components/ui/Toast";
import {
  LayoutDashboard,
  GraduationCap,
  FileText,
  ClipboardCheck,
  QrCode,
  Truck,
  Building2,
  AlertTriangle,
  MapPin,
  Sun,
  Moon,
  Menu,
  X,
  RefreshCw,
  LogOut,
  CalendarClock,
  Link2
} from "lucide-react";

import {
  INITIAL_SOPS,
  INITIAL_DOCUMENTS,
  INITIAL_VEHICLES,
  INITIAL_CONTRACTOR_COMPANY,
  INITIAL_INCIDENTS,
  INITIAL_SITE_CHECKINS,
} from "./state/complianceData";

function usePersistentTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem("induction-theme");
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("induction-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return [theme, toggleTheme] as const;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("App render error", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell" style={{ padding: "40px 20px", textAlign: "center" }}>
          <div className="glass card-hover" style={{ maxWidth: "500px", margin: "0 auto", padding: "32px", borderRadius: "20px" }}>
            <h2 style={{ fontSize: "1.4rem", margin: "0 0 8px" }}>Something Went Wrong</h2>
            <p className="muted" style={{ margin: "0 0 16px" }}>
              We hit an unexpected issue. Please refresh the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "#1e3a5f", color: "#fff", fontWeight: 700, cursor: "pointer" }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { t, i18n } = useTranslation();
  const [theme, toggleTheme] = usePersistentTheme();
  const [driverStep, setDriverStep] = useState(1);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "induction" | "schedule" | "documents" | "audits" | "learning" | "vehicles" | "contractor" | "incidents" | "checkin" | "pretrip" | "leave" | "cor"
  >("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [gatePassOpen, setGatePassOpen] = useState(false);
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [driverPolicies, setDriverPolicies] = useState<PolicyRecord[]>([]);
  const [driverPolicyLoadError, setDriverPolicyLoadError] = useState("");
  const [signPolicyOpen, setSignPolicyOpen] = useState<PolicyRecord | null>(null);
  const [showLoginArrival, setShowLoginArrival] = useState(false);
  const [showLogoutDeparture, setShowLogoutDeparture] = useState(false);

  // Load portal branding (company name, logo, colour, welcome text)
  useEffect(() => {
    api.getBranding()
      .then((settings) => {
        setBranding(settings);
        if (settings.primaryColor) {
          document.documentElement.style.setProperty("--brand-color", settings.primaryColor);
        }
      })
      .catch(() => {});
  }, []);

  const handleBrandingUpdated = (next: BrandingSettings) => {
    setBranding(next);
    if (next.primaryColor) {
      document.documentElement.style.setProperty("--brand-color", next.primaryColor);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setShowLogoutDeparture(true);
    window.setTimeout(() => setShowLogoutDeparture(false), 1250);
  };

  // Compliance state
  const [audits, setAudits] = useState<AuditAssignment[]>([]);
  const [sops, setSops] = useState<SOPItem[]>(INITIAL_SOPS);
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDocumentRequirement[]>(INITIAL_DOCUMENTS);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(INITIAL_VEHICLES);
  const [contractor, setContractor] = useState<ContractorCompanyRecord>(INITIAL_CONTRACTOR_COMPANY);
  const [incidents, setIncidents] = useState<SafetyIncidentRecord[]>(INITIAL_INCIDENTS);
  const [checkins, setCheckins] = useState<SiteCheckinRecord[]>(INITIAL_SITE_CHECKINS);
  const [attendanceLoadError, setAttendanceLoadError] = useState("");
  const [preTripInspections, setPreTripInspections] = useState<any[]>([]);

  const {
    session,
    driverBundle,
    adminOverview,
    quizQuestions,
    loading,
    authLoading,
    authError,
    login,
    logout,
    refreshDriverBundle,
    refreshAdminOverview,
    saveProfile,
    uploadDocument,
    saveStep,
    startVideoSection,
    submitQuiz,
    submitDriverFeedback,
    generateCertificate,
    createDriver,
    updateDriverByAdmin,
    resetDriverPassword,
    resetDriverInduction,
    revokeDriverInduction,
    archiveDriver,
    restoreDriver,
    bulkArchiveDrivers,
    bulkRestoreDrivers,
    deleteDriver,
    exportAdminReport,
    verifyCertificate
  } = useAppState();

  // Load pending policy signatures for the signed-in driver
  useEffect(() => {
    if (session?.user?.id && session.user.role === "driver") {
      api.getPolicies(session.user.id)
        .then((policies) => { setDriverPolicies(policies); setDriverPolicyLoadError(""); })
        .catch((error) => { console.error("Unable to load applicable policies", error); setDriverPolicies([]); setDriverPolicyLoadError(error?.message || "Could not load applicable policies."); });
    } else {
      setDriverPolicies([]);
      setDriverPolicyLoadError("");
    }
  }, [session?.user?.id, session?.user?.role]);

  const handlePolicySigned = async () => {
    setSignPolicyOpen(null);
    if (session?.user?.id) {
      try {
        const refreshed = await api.getPolicies(session.user.id);
        setDriverPolicies(refreshed);
      } catch {
        setDriverPolicies((prev) =>
          prev.map((p) =>
            p.versionId === signPolicyOpen?.versionId ? { ...p, signed: true } : p
          )
        );
      }
    }
  };

  // Load real user-scoped records upon authentication
  useEffect(() => {
    if (session?.user?.id) {
      const uid = session.user.id;
      api.getSafetyIncidents(uid).then(setIncidents).catch(() => setIncidents([]));
      if (session.user.role === "driver") {
        void (async () => {
          const legacyRecords = api.getSiteCheckins(uid);
          if (legacyRecords.length) await api.importLegacyAttendance(session, legacyRecords);
          setCheckins(await api.getAttendanceRecords(session));
          setAttendanceLoadError("");
        })().catch((error) => {
          console.error("Unable to load attendance history", error);
          setCheckins([]);
          setAttendanceLoadError("Attendance history could not be loaded. Refresh the page or contact an administrator.");
        });
      } else {
        setCheckins([]);
        setAttendanceLoadError("");
      }
      api.getPreTripInspections(uid).then(setPreTripInspections).catch(() => setPreTripInspections([]));
      api.getDriverAudits(uid).then(setAudits).catch(() => setAudits([]));
      api.getDriverSOPs(uid).then(setSops).catch(() => setSops([]));
      api.getVehicles(uid).then((rows) => {
        setVehicles(rows);
        if (rows.length === 0) {
          // One-time move of old browser-only vehicles into the shared database
          try {
            const raw = window.localStorage.getItem(`bnt_vehicles_${uid}`);
            const legacy = raw ? (JSON.parse(raw) as VehicleRecord[]) : [];
            if (legacy.length) {
              Promise.all(legacy.map((v) => api.saveVehicle(uid, v)))
                .then((final) => setVehicles(final[final.length - 1] ?? []))
                .catch(() => {});
            }
          } catch {}
        }
      }).catch(() => setVehicles([]));
      api.getContractorCompany(uid)
        .then((savedCompany) => {
          if (savedCompany) {
            setContractor(savedCompany);
          } else {
            // One-time move of the old browser-only contractor profile
            // into the shared database.
            try {
              const raw = window.localStorage.getItem(`bnt_contractor_${uid}`);
              if (raw) {
                const legacy = JSON.parse(raw) as ContractorCompanyRecord;
                if (legacy && (legacy.companyName || legacy.abn)) {
                  api
                    .saveContractorCompany(uid, { ...legacy, id: uid })
                    .then(setContractor)
                    .catch(() => {});
                }
              }
            } catch {}
          }
        })
        .catch(() => {});
    } else {
      setVehicles([]);
      setIncidents([]);
      setCheckins([]);
      setAttendanceLoadError("");
      setPreTripInspections([]);
      setAudits([]);
      setSops([]);
      setContractor(INITIAL_CONTRACTOR_COMPANY);
    }
  }, [session?.user?.id]);

  // Sync induction wizard step with driver progress
  useEffect(() => {
    if (driverBundle?.progress?.currentStep) {
      setDriverStep(driverBundle.progress.currentStep);
    }
  }, [driverBundle?.progress?.currentStep]);

  // Sync the Vault with the driver's real documents stored in the database
  useEffect(() => {
    if (!driverBundle) return;
    setComplianceDocs(toComplianceDocumentRequirements(driverBundle.documents ?? [], driverBundle.driver.employmentType, driverBundle.driver.staffRole));
  }, [driverBundle?.documents]);

  const handleToggleModule = async (moduleItem: LearningSectionProgress, completed: boolean) => {
    if (!driverBundle) return;
    const updated = driverBundle.learningProgress.map((m) =>
      m.sectionId === moduleItem.sectionId ? { ...m, completed } : m
    );
    await saveStep(3, {
      allowPartial: true,
      sections: updated.map((m) => ({ sectionId: m.sectionId, sectionVersion: m.sectionVersion ?? "1.0", completed: m.completed }))
    });
  };

  const handleStartModule = async (moduleItem: any) => {
    await startVideoSection(moduleItem.sectionId, moduleItem.sectionVersion ?? "1.0");
  };

  const handleSaveDeclaration = async (accepted: boolean, signature: string) => {
    await saveStep(5, { accepted, signature });
  };

  const handleCompleteAudit = async (assignment: AuditAssignment, answers: Record<number, boolean>) => {
    await api.completeAuditAssignment(assignment.id, answers);
    if (session?.user?.id) {
      const refreshed = await api.getDriverAudits(session.user.id);
      setAudits(refreshed);
    }
  };

  const handleCompleteSOP = async (sopId: string) => {
    if (!session?.user?.id) return;
    const previous = sops.find((s) => s.id === sopId)?.status ?? "No Attempt";
    setSops((prev) =>
      prev.map((s) => (s.id === sopId ? { ...s, status: "Passed" } : s))
    );
    try {
      await api.completeSOP(session.user.id, sopId);
    } catch {
      setSops((prev) =>
        prev.map((s) => (s.id === sopId ? { ...s, status: previous } : s))
      );
    }
  };

  const handleUploadComplianceDoc = async (
    docId: string,
    fileName: string,
    file: File | null,
    _expiryDate: string | null
  ) => {
    const target = complianceDocs.find((d) => d.id === docId);
    if (!target) return;

    // Persist the replacement through the real document API.
    if (session && target.documentType && file) {
      await uploadDocument({ type: target.documentType, file });
    }

    setComplianceDocs((prev) =>
      prev.map((d) =>
        d.id === docId
          ? {
              ...d,
              status: "Pending",
              historyStatus: "Pending Review",
              uploadedFileName: fileName,
              expiryDate: null,
              uploadedAt: new Date().toISOString().split("T")[0],
            }
          : d
      )
    );
  };

  const handleAddVehicle = async (newVeh: VehicleRecord) => {
    if (session?.user?.id) {
      setVehicles((prev) => [newVeh, ...prev]);
      try {
        const updated = await api.saveVehicle(session.user.id, newVeh);
        setVehicles(updated);
        showToast(t("veh_saved"));
      } catch {
        // keep the optimistic copy if the save fails
      }
    } else {
      setVehicles((prev) => [newVeh, ...prev]);
    }
  };

  const handleUpdateVehicle = async (updatedVehicle: VehicleRecord) => {
    if (!session?.user?.id) return;
    try {
      const nextVehicles = await api.saveVehicle(session.user.id, updatedVehicle);
      setVehicles(nextVehicles);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Vehicle document updated, but the list could not refresh.");
    }
  };

  const handleReportIncident = async (newInc: SafetyIncidentRecord) => {
    if (session?.user?.id) {
      const saved = await api.reportSafetyIncident(session.user.id, newInc);
      setIncidents((prev) => [saved, ...prev]);
    } else {
      setIncidents((prev) => [newInc, ...prev]);
    }
  };

  const handleSiteCheckin = (newCheckin: SiteCheckinRecord) => {
    if (!session) return Promise.reject(new Error("Please sign in again before checking in."));
    return api.checkInAttendance(session, {
      depotName: newCheckin.depotName,
      vehicleRego: newCheckin.vehicleRego,
      hoursDrivenToday: newCheckin.hoursDrivenToday,
      hoursRestedLast24h: newCheckin.hoursRestedLast24h,
      fitnessDeclaration: newCheckin.fitnessDeclaration
    }).then((saved) => setCheckins((previous) => [saved, ...previous]));
  };

  const handleSavePreTripInspection = async (record: any) => {
    if (session?.user?.id) {
      const savedRecord = await api.savePreTripInspection(session.user.id, record);
      setPreTripInspections((prev) => [savedRecord, ...prev]);

      // If inspection detected a defect, automatically ground the vehicle
      if (record.overallStatus && record.overallStatus !== "Fit for Duty") {
        const vehicleRego = (record.vehicleRego || "").toUpperCase().trim();
        const existing = vehicles.find((v) => v.rego.toUpperCase().trim() === vehicleRego);
        if (existing) {
          const updatedVeh: VehicleRecord = {
            ...existing,
            status: "Maintenance Required"
          };
          setVehicles((prev) =>
            prev.map((v) => (v.id === existing.id ? updatedVeh : v))
          );
          try {
            const nextVehicles = await api.saveVehicle(session.user.id, updatedVeh);
            setVehicles(nextVehicles);
            showToast(t("veh_saved"));
          } catch {
            // keep the optimistic grounding if the save fails
          }
        }
      }
    } else {
      setPreTripInspections((prev) => [record, ...prev]);
      if (record.overallStatus && record.overallStatus !== "Fit for Duty") {
        const vehicleRego = (record.vehicleRego || "").toUpperCase().trim();
        setVehicles((prev) =>
          prev.map((v) =>
            v.rego.toUpperCase().trim() === vehicleRego ? { ...v, status: "Maintenance Required" } : v
          )
        );
      }
    }
  };

  const handleSiteCheckout = (checkinId: string) => {
    if (!session) return Promise.reject(new Error("Please sign in again before checking out."));
    return api.checkOutAttendance(session, checkinId).then((updated) => {
      setCheckins((previous) => previous.map((record) => record.id === updated.id ? updated : record));
    });
  };

  const handleUpdateContractor = async (updatedCompany: ContractorCompanyRecord) => {
    if (session?.user?.id) {
      try {
        const saved = await api.saveContractorCompany(session.user.id, updatedCompany);
        setContractor(saved);
      } catch {
        // Keep the update in the UI even if the database save fails,
        // so the driver is never blocked by a network hiccup.
        setContractor(updatedCompany);
      }
    } else {
      setContractor(updatedCompany);
    }
  };

  return (
    <div className="app-shell flex flex-col min-h-screen">
      <ToastHost />
      {showLoginArrival && (
        <div className="login-arrival" role="status" aria-label="Welcome. Your portal is opening.">
          <div className="login-arrival-road" />
          <Truck className="login-arrival-truck" aria-hidden="true" />
          <span className="login-arrival-message">{t("login_success")}</span>
        </div>
      )}
      {showLogoutDeparture && (
        <div className="logout-departure" role="status" aria-label={t("sign_out")}>
          <div className="logout-departure-road" />
          <Truck className="logout-departure-truck" aria-hidden="true" />
          <span className="logout-departure-message">{t("sign_out")}</span>
        </div>
      )}
      {/* Global Modern Top Header & Navigation */}
      <header className="app-header sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/60 px-4 md:px-8 py-3 transition-all">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo & Platform Name */}
          <div className="flex items-center gap-3">
            <img src={branding?.logoUrl || bntLogo} alt={branding?.companyName || "BNT Logistics"} className="h-9 w-auto object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-white tracking-tight">{branding?.companyName || "BNT LOGISTICS"}</span>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider">
                  {t("compliance_portal")}
                </span>
              </div>
              <span className="text-xs text-slate-400 block font-medium">{t("platform_subtitle")}</span>
            </div>
          </div>

          {/* User Controls & Mobile Toggle */}
          <div className="flex items-center gap-3">
            {session && session.user.role === "driver" && (
              <button
                type="button"
                onClick={() => setGatePassOpen(true)}
                className="hidden sm:flex px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold transition-colors items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" /> {t("gate_pass")}
              </button>
            )}
            {/* Language Switcher — English / ਪੰਜਾਬੀ */}
            <div className="flex items-center rounded-lg bg-slate-800 border border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setAppLanguage("en")}
                className={`px-2.5 py-1.5 text-[11px] font-black transition-colors ${
                  i18n.language === "en" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setAppLanguage("pa")}
                className={`px-2.5 py-1.5 text-[11px] font-black transition-colors ${
                  i18n.language === "pa" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                ਪੰਜਾਬੀ
              </button>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors flex items-center gap-1.5"
            >
              {theme === "light" ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
              <span>{theme === "light" ? t("dark") : t("light")}</span>
            </button>

            {session && (
              <div className="flex items-center gap-3">
                <div className="hidden md:block text-right">
                  <span className="text-xs font-bold text-white block">{driverBundle?.driver?.fullName || session.user.email}</span>
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider block">
                    {session.user.role === "admin" ? t("admin_role") : t("driver_role")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors shadow-md flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t("sign_out")}</span>
                </button>
              </div>
            )}

            {/* Mobile Hamburger Toggle */}
            {session && session.user.role === "driver" && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-lg bg-slate-800 text-slate-200 hover:text-white border border-slate-700"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Secondary Navigation Row — full tab bar below the brand row */}
        {session && session.user.role === "driver" && (
          <div className="max-w-7xl mx-auto mt-4">
            <nav className="hidden md:flex items-center justify-center gap-1 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 shadow-inner overflow-x-auto">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "dashboard" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" /> {t("nav_dashboard")}
              </button>
              <button
                onClick={() => setActiveTab("schedule")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "schedule" ? "bg-amber-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" /> {t("nav_schedule")}
              </button>
              <button
                onClick={() => setActiveTab("induction")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "induction" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5" /> {t("nav_induction")}
              </button>
              <button
                onClick={() => setActiveTab("documents")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "documents" ? "bg-purple-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> {t("nav_vault")} ({complianceDocs.length})
              </button>
              <button
                onClick={() => setActiveTab("audits")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "audits" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <ClipboardCheck className="w-3.5 h-3.5" /> {t("nav_audits")}
              </button>
              <button
                onClick={() => setActiveTab("vehicles")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "vehicles" ? "bg-amber-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Truck className="w-3.5 h-3.5" /> {t("nav_fleet")}
              </button>
              <button
                onClick={() => setActiveTab("contractor")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "contractor" ? "bg-indigo-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Building2 className="w-3.5 h-3.5" /> {t("nav_contractor")}
              </button>
              <button
                onClick={() => setActiveTab("incidents")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "incidents" ? "bg-rose-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> {t("nav_hazards")} ({incidents.filter(i => i.status !== "Resolved").length})
              </button>
              <button
                onClick={() => setActiveTab("checkin")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "checkin" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <MapPin className="w-3.5 h-3.5" /> {t("nav_checkin")}
              </button>
              <button
                onClick={() => setActiveTab("leave")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "leave" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" /> Leave
              </button>
              <button
                onClick={() => setActiveTab("cor")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === "cor" ? "bg-emerald-600 text-white shadow-md" : "text-slate-300 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Link2 className="w-3.5 h-3.5" /> COR
              </button>
            </nav>
          </div>
        )}

        {/* Mobile Navigation Drawer */}
        {session && session.user.role === "driver" && mobileMenuOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-fadeIn">
            <button
              onClick={() => { setActiveTab("dashboard"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "dashboard" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <LayoutDashboard className="w-4 h-4" /> {t("nav_dashboard")}
            </button>
            <button
              onClick={() => { setActiveTab("schedule"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "schedule" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <CalendarClock className="w-4 h-4" /> {t("nav_schedule")}
            </button>
            <button
              onClick={() => { setActiveTab("induction"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "induction" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <GraduationCap className="w-4 h-4" /> {t("nav_induction")}
            </button>
            <button
              onClick={() => { setActiveTab("documents"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "documents" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <FileText className="w-4 h-4" /> {t("nav_vault")} ({complianceDocs.length})
            </button>
            <button
              onClick={() => { setActiveTab("audits"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "audits" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <ClipboardCheck className="w-4 h-4" /> {t("nav_audits")}
            </button>
            <button
              onClick={() => { setActiveTab("vehicles"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "vehicles" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <Truck className="w-4 h-4" /> {t("nav_fleet")}
            </button>
            <button
              onClick={() => { setActiveTab("contractor"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "contractor" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <Building2 className="w-4 h-4" /> {t("nav_contractor")}
            </button>
            <button
              onClick={() => { setActiveTab("incidents"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "incidents" ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <AlertTriangle className="w-4 h-4" /> {t("nav_hazards")}
            </button>
            <button
              onClick={() => { setActiveTab("checkin"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "checkin" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <MapPin className="w-4 h-4" /> {t("nav_checkin")}
            </button>
            <button
              onClick={() => { setActiveTab("leave"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "leave" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <CalendarClock className="w-4 h-4" /> Leave
            </button>
            <button
              onClick={() => { setActiveTab("cor"); setMobileMenuOpen(false); }}
              className={`p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 ${activeTab === "cor" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
            >
              <Link2 className="w-4 h-4" /> COR
            </button>
            <button
              onClick={() => { setGatePassOpen(true); setMobileMenuOpen(false); }}
              className="p-2.5 rounded-lg text-xs font-bold text-left flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
            >
              <QrCode className="w-4 h-4" /> {t("view_gate_pass")}
            </button>
          </div>
        )}
      </header>

      {/* Main Container View */}
      {loading ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6">
          <div className="text-center py-20 flex flex-col items-center justify-center">
            <div className="app-loading-road" aria-hidden="true">
              <Truck className="app-loading-truck" />
            </div>
            <p className="text-slate-400 text-sm font-medium">{t("initializing")}</p>
          </div>
        </main>
      ) : !session ? (
        <LoginForm branding={branding} onRequestPasswordHelp={async (email) => {
          await api.requestPasswordHelp(email);
        }} onLogin={async (email, pass, role) => {
          await login({ email, password: pass, role });
          setShowLoginArrival(true);
          window.setTimeout(() => setShowLoginArrival(false), 1550);
          showToast(t("login_success"));
        }} loading={authLoading} error={authError} />
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6">
          {session.user.role === "driver" && driverBundle ? (
            <>
              {activeTab === "dashboard" && (
                <ComplianceDashboardView
                  driverBundle={driverBundle}
                  audits={audits}
                  sops={sops}
                  documents={complianceDocs}
                  vehicles={vehicles}
                  policies={driverPolicies}
                  policyLoadError={driverPolicyLoadError}
                  onNavigateTab={(tab) => setActiveTab(tab as any)}
                  onStartAudit={() => setActiveTab("audits")}
                  onStartSOP={() => setActiveTab("learning")}
                  onUploadDoc={() => setActiveTab("documents")}
                  onOpenGatePass={() => setGatePassOpen(true)}
                  onSignPolicy={(policy) => setSignPolicyOpen(policy)}
                   session={session}
                />
              )}
              {activeTab === "leave" && <LeaveManagement session={session} />}
              {activeTab === "cor" && <CORPage driverBundle={driverBundle} session={session} onNavigateTab={(tab) => setActiveTab(tab as any)} onRefreshDriverBundle={refreshDriverBundle} />}

            {activeTab === "induction" && (
              <DriverWizard
                session={session}
                bundle={driverBundle}
                currentStep={driverStep}
                onSetStep={setDriverStep}
                onSaveProfile={saveProfile}
                onUploadDocument={(type, file, onProgress) => uploadDocument({ type, file }, onProgress)}
                onCompleteStep2={async () => {
                  await saveStep(2, {});
                }}
                onCompleteStep3={async () => {
                  const sections = driverBundle.learningProgress.map((m) => ({
                    sectionId: m.sectionId,
                    sectionVersion: m.sectionVersion ?? "1.0",
                    completed: m.completed
                  }));
                  await saveStep(3, { sections });
                }}
                onToggleModule={handleToggleModule}
                onStartModule={handleStartModule}
                onSubmitQuiz={submitQuiz}
                onSaveDeclaration={handleSaveDeclaration}
                onGenerateCertificate={generateCertificate}
                onSubmitFeedback={submitDriverFeedback}
                quizQuestions={quizQuestions}
                loading={loading}
              />
            )}

            {activeTab === "schedule" && (
              <DriverScheduleInvitations
                session={session}
                onStartInduction={(scheduleItemId, itemTitle) => {
                  sessionStorage.setItem("pendingScheduleItemId", scheduleItemId);
                  sessionStorage.setItem("pendingScheduleItemTitle", itemTitle);
                  setActiveTab("induction");
                }}
              />
            )}

            {activeTab === "documents" && (
              <DocumentComplianceVault
                documents={complianceDocs}
                onUploadDocument={handleUploadComplianceDoc}
              />
            )}

            {(activeTab === "audits" || activeTab === "learning") && (
              <AuditAndSOPManager
                audits={audits}
                sops={sops}
                activeTab={activeTab === "learning" ? "learning" : "audits"}
                onCompleteAudit={handleCompleteAudit}
                onCompleteSOP={handleCompleteSOP}
              />
            )}

              {activeTab === "vehicles" && (
                <VehicleManagementHub
                  vehicles={vehicles}
                  onAddVehicle={handleAddVehicle}
                  onUpdateVehicle={handleUpdateVehicle}
                  userId={session.user.id}
                  driverName={driverBundle.driver.fullName}
                  driverNumber={driverBundle.driver.licenceNumber}
                  contactNumber={driverBundle.driver.phone}
                />
              )}

            {activeTab === "contractor" && (
              <ContractorCompanyHub
                contractor={contractor}
                onUpdateContractor={handleUpdateContractor}
                userId={session.user.id}
                documents={complianceDocs}
                policies={driverPolicies}
                trainingCompletion={driverBundle?.progress.completionPercentage ?? 0}
                vehicles={vehicles}
              />
            )}

            {activeTab === "incidents" && (
              <SafetyIncidentReporter
                incidents={incidents}
                driverName={driverBundle?.driver?.fullName || session?.user?.email || "Driver"}
                onReportIncident={handleReportIncident}
              />
            )}

            {activeTab === "pretrip" && (
              <PreTripInspectionHub
                inspections={preTripInspections}
                onSaveInspection={handleSavePreTripInspection}
                driverName={driverBundle.driver.fullName}
                driverId={driverBundle.driver.id}
              />
            )}

            {activeTab === "checkin" && (
              <DepotCheckinFatigueHub
                checkins={checkins}
                vehicles={vehicles}
                driverName={driverBundle.driver.fullName}
                attendanceLoadError={attendanceLoadError}
                onCheckin={handleSiteCheckin}
                onCheckout={handleSiteCheckout}
              />
            )}
          </>
        ) : session.user.role === "admin" ? (
          <AdminDashboard
            overview={adminOverview}
            onRefresh={refreshAdminOverview}
            onCreateDriver={createDriver}
            onUpdateDriver={updateDriverByAdmin}
            onResetPassword={resetDriverPassword}
            onResetInduction={resetDriverInduction}
            onDeleteDriver={deleteDriver}
            onArchiveDriver={archiveDriver}
            onRestoreDriver={restoreDriver}
            onBulkArchiveDrivers={bulkArchiveDrivers}
            onBulkRestoreDrivers={bulkRestoreDrivers}
            onExportReport={exportAdminReport}
            onVerifyCertificate={verifyCertificate}
            onRevokeInduction={revokeDriverInduction}
            loading={loading}
            session={session}
            branding={branding}
            onBrandingUpdated={handleBrandingUpdated}
          />
        ) : (
          <div className="text-center py-20">
            <p className="text-slate-400">Initializing Session...</p>
          </div>
        )}
      </main>
      )}

      {/* Depot Gate Pass Modal */}
      {session?.user.role === "driver" && driverBundle && (
        <DepotGatePassModal
          isOpen={gatePassOpen}
          onClose={() => setGatePassOpen(false)}
          driverBundle={driverBundle}
        />
      )}

      {/* Policy E-Sign Modal */}
      {session?.user.role === "driver" && signPolicyOpen && (
        <PolicySignModal
          policy={signPolicyOpen}
          session={session}
          onClose={() => setSignPolicyOpen(null)}
          onSigned={handlePolicySigned}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
