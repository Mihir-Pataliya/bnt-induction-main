import { useState } from "react";
import { ArrowRight, CalendarDays, ClipboardCheck, ClipboardList, FileText, ShieldCheck, Truck } from "lucide-react";
import { DriverBundle, SessionState } from "../../types";
import { InductionHandout } from "../admin/InductionHandout";
import { TrainingCalendar } from "../admin/TrainingCalendar";
import { FatigueAwarenessDriver } from "./FatigueAwarenessDriver";
import { DistractionAwarenessDriver } from "./DistractionAwarenessDriver";
import { SpeedAwarenessDriver } from "./SpeedAwarenessDriver";
import { LoadingUnloadingRestraintDriver } from "./LoadingUnloadingRestraintDriver";
import { DriverFatigueWorkRecordAudit } from "./DriverFatigueWorkRecordAudit";
import { SafeDrivingPlanManager } from "../admin/SafeDrivingPlanManager";
import { RiskManagementAssessment } from "../admin/RiskManagementAssessment";
import { DriverFatigueChecklist } from "./DriverFatigueChecklist";
import { MyLicence } from "./MyLicence";
import { VehicleStandardsDriver } from "./VehicleStandardsDriver";
import { DriverMassDimensionAwareness } from "./DriverMassDimensionAwareness";
import { DriverMassDimensionAssessment } from "./DriverMassDimensionAssessment";
import { DriverNcrIncidentReport } from "./DriverNcrIncidentReport";
import { DriverMyReports } from "./DriverMyReports";
import { DriverPendingSignatures } from "./DriverPendingSignatures";
import { DriverNotifications } from "./DriverNotifications";

export function CORPage({ driverBundle, session, onNavigateTab, onRefreshDriverBundle }: { driverBundle?: DriverBundle | null; session?: SessionState | null; onNavigateTab?: (tab: string) => void; onRefreshDriverBundle?: () => void | Promise<void> }) {
  const [showInductionHandout, setShowInductionHandout] = useState(false);
  const [showTrainingCalendar, setShowTrainingCalendar] = useState(false);
  const [showFatigue, setShowFatigue] = useState(false);
  const [showFatigueChecklist, setShowFatigueChecklist] = useState(false);
  const [showDistraction, setShowDistraction] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showLoadingUnloadingRestraint, setShowLoadingUnloadingRestraint] = useState(false);
  const [showWorkRecordAudit, setShowWorkRecordAudit] = useState(false);
  const [showMyTrips, setShowMyTrips] = useState(false);
  const [showMyLicence, setShowMyLicence] = useState(false);
  const [showRiskManagement, setShowRiskManagement] = useState(false);
  const [showVehicleStandards, setShowVehicleStandards] = useState(false);
  const [showMassDimension, setShowMassDimension] = useState(false);
  const [showMassDimensionAssessment, setShowMassDimensionAssessment] = useState(false);

  const [ncrView, setNcrView] = useState<"incident" | "reports" | "pending">("incident");
  const role =
    driverBundle?.driver?.staffRole === "warehouse" ? "Loader/Unloader" : "Driver";

  const panel = (title: string, desc: string, icon: any, show: boolean, setShow: (v: boolean) => void, children: any) => (
    <div className="dashboard-panel bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div className="p-5 bg-slate-800/60 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">{icon}</div>
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="text-xs text-slate-400">{desc}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition-all shadow-lg flex items-center gap-1.5"
        >
          <span>{show ? "Hide" : "Open"}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
      {show && <div className="p-5">{children}</div>}
    </div>
  );
  return (
    <section className="glass card-hover p-6 md:p-8 rounded-2xl border border-slate-800 space-y-6">
      <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight font-heading">
        COR - Chain of Responsibility
      </h1>

      {panel("Induction Handout", "Role responsibilities, Chain of Responsibility duties, forms and supporting documents.", <FileText className="w-5 h-5" />, showInductionHandout, setShowInductionHandout, session ? <InductionHandout session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Training Calendar", "Employee/contractor training calendar.", <CalendarDays className="w-5 h-5" />, showTrainingCalendar, setShowTrainingCalendar, session ? <TrainingCalendar session={session} onBack={() => {}} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Fatigue Awareness", "Fatigue management awareness assessment.", <ShieldCheck className="w-5 h-5" />, showFatigue, setShowFatigue, session ? <FatigueAwarenessDriver session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Distraction Awareness", "Distraction awareness assessment.", <ShieldCheck className="w-5 h-5" />, showDistraction, setShowDistraction, session ? <DistractionAwarenessDriver session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Speed Awareness", "Speed awareness assessment.", <ShieldCheck className="w-5 h-5" />, showSpeed, setShowSpeed, session ? <SpeedAwarenessDriver session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Loading/Unloading Restraint", "Loading and unloading restraint assessment.", <ClipboardCheck className="w-5 h-5" />, showLoadingUnloadingRestraint, setShowLoadingUnloadingRestraint, session ? <LoadingUnloadingRestraintDriver session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Driver Fatigue Work Record Audit", "Driver fatigue work record audit.", <FileText className="w-5 h-5" />, showWorkRecordAudit, setShowWorkRecordAudit, session ? <DriverFatigueWorkRecordAudit session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Mass and Dimension Awareness", "Mass and dimension awareness training.", <FileText className="w-5 h-5" />, showMassDimension, setShowMassDimension, session ? <DriverMassDimensionAwareness session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Mass and Dimension Awareness Assessment", "Mass and dimension awareness assessment.", <ClipboardCheck className="w-5 h-5" />, showMassDimensionAssessment, setShowMassDimensionAssessment, session ? <DriverMassDimensionAssessment session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Safe Driving Plans", "Safe driving plans.", <FileText className="w-5 h-5" />, showMyTrips, setShowMyTrips, session ? <SafeDrivingPlanManager session={session} mode="driver" /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Risk Management Assessment", "Risk management assessment.", <ShieldCheck className="w-5 h-5" />, showRiskManagement, setShowRiskManagement, session ? <RiskManagementAssessment session={session} mode="driver" /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Fatigue Checklist", "Pre-trip fatigue checklist.", <ClipboardCheck className="w-5 h-5" />, showFatigueChecklist, setShowFatigueChecklist, session ? <DriverFatigueChecklist session={session} driverBundle={driverBundle} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("My Licence", "Manage your licence details.", <FileText className="w-5 h-5" />, showMyLicence, setShowMyLicence, session ? <MyLicence session={session} driverBundle={driverBundle} onRefresh={onRefreshDriverBundle} /> : <p className="text-slate-300">Please sign in again.</p>)}

      {panel("Vehicle Standards", "Vehicle standards information.", <Truck className="w-5 h-5" />, showVehicleStandards, setShowVehicleStandards, session ? <VehicleStandardsDriver session={session} /> : <p className="text-slate-300">Please sign in again.</p>)}

      <div className="dashboard-panel bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-5 bg-slate-800/60 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">NCR</h2>
              <p className="text-xs text-slate-400">Report an incident, view your reports, and sign assigned reports.</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setNcrView("incident")} className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all " + (ncrView === "incident" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white")}>Report an Incident</button>
            <button type="button" onClick={() => setNcrView("reports")} className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all " + (ncrView === "reports" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white")}>My Reports</button>
            <button type="button" onClick={() => setNcrView("pending")} className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all " + (ncrView === "pending" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:text-white")}>Pending Signatures</button>
          </div>
        </div>
        <div className="p-5">
          {session ? (
            ncrView === "incident" ? <DriverNcrIncidentReport session={session} /> :
            ncrView === "reports" ? <DriverMyReports session={session} /> :
            <DriverPendingSignatures session={session} />
          ) : <p className="text-slate-300">Please sign in again.</p>}
        </div>
      </div>

    </section>
  );
}