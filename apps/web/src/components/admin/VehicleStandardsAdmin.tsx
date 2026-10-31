import { useState } from "react";
import { ClipboardCheck, ClipboardList, FileText, LayoutDashboard, ShieldCheck, Truck, Wrench } from "lucide-react";
import { SessionState } from "../../types";
import { VehicleStandardsChecklist } from "./VehicleStandardsChecklist";

import { FleetAdmin } from "./FleetAdmin";


import { MechanicalCompetencyAssessment } from "./MechanicalCompetencyAssessment";
import { MaintenanceProviderAgreement } from "./MaintenanceProviderAgreement";
import { PreStartAwarenessAdmin } from "./PreStartAwarenessAdmin";
import { VehicleFaultReports } from "./VehicleFaultReports";




export function VehicleStandardsAdmin({ session }: { session: SessionState }) {
  const [tab, setTab] = useState<"overview" | "checklist" | "register" | "mechanical" | "maintenance" | "prestart" | "results">("overview");
  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "checklist", label: "Checklist", icon: ClipboardCheck },
    { id: "register", label: "Vehicle Register", icon: Truck },
    { id: "mechanical", label: "Mechanical Competency", icon: Wrench },
    { id: "maintenance", label: "Maintenance Provider", icon: FileText },
    { id: "prestart", label: "Pre-Start Training", icon: ShieldCheck },
    { id: "results", label: "Results & Faults", icon: ClipboardList }
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.id ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tabs.filter((t) => t.id !== "overview").map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 text-left hover:bg-slate-800">
                <Icon className="mb-3 h-6 w-6 text-blue-400" />
                <p className="font-bold text-white">{t.label}</p>
                <p className="mt-1 text-xs text-slate-400">Open {t.label.toLowerCase()}.</p>
              </button>
            );
          })}
        </div>
      )}
      {tab === "checklist" && <VehicleStandardsChecklist session={session} audience="admin" />}
      {tab === "register" && <FleetAdmin />}
      {tab === "mechanical" && <MechanicalCompetencyAssessment session={session} audience="admin" />}
      {tab === "maintenance" && <MaintenanceProviderAgreement session={session} audience="admin" />}
      {tab === "prestart" && <PreStartAwarenessAdmin session={session} />}
      {tab === "results" && <VehicleFaultReports session={session} audience="admin" />}
    </div>
  );
}
