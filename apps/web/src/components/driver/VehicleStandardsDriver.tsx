import { MechanicalCompetencyAssessment } from "../admin/MechanicalCompetencyAssessment";
import { supabase } from "../../lib/supabase";

import { useEffect, useState } from "react";


import { Truck } from "lucide-react";

import { SessionState } from "../../types";


import { PreStartAwarenessDriver } from "./PreStartAwarenessDriver";





import { VehicleFaultReports } from "../admin/VehicleFaultReports";








export function VehicleStandardsDriver({ session }: { session: SessionState }) {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTraining, setShowTraining] = useState(false);
  const [showMechanical, setShowMechanical] = useState(false);
  const [showFaults, setShowFaults] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.from("driver_vehicles").select("*").eq("user_id", session.user.id);
        if (active) setVehicles(data ?? []);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [session.user.id]);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-extrabold text-white">Vehicle Standards</h1>
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Truck className="h-5 w-5 text-blue-400" /> My Vehicle Information</h2>
        {loading ? <p className="text-sm text-slate-400">Loading...</p> : vehicles.length === 0 ? <p className="text-sm text-slate-400">No assigned vehicles.</p> : (
          <div className="mt-3 space-y-2">
            {vehicles.map((v: any) => (
              <div key={v.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-white">
                <p className="font-bold">{v.rego} · {v.make_model || v.makeModel}</p>
                <p className="text-xs text-slate-400">Expiry: {v.rego_expiry_date || v.regoExpiryDate || "—"} · Status: {v.status || "Active"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <button type="button" onClick={() => setShowTraining((v) => !v)} className="text-lg font-bold text-white">Pre-Start & Fault Reporting Training</button>
        {showTraining && <div className="mt-4"><PreStartAwarenessDriver session={session} /></div>}
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <button type="button" onClick={() => setShowMechanical((v) => !v)} className="text-lg font-bold text-white">Mechanical Competency</button>
        {showMechanical && <div className="mt-4"><MechanicalCompetencyAssessment session={session} audience="driver" /></div>}
      </div>
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
        <button type="button" onClick={() => setShowFaults((v) => !v)} className="text-lg font-bold text-white">Fault Reporting</button>
        {showFaults && <div className="mt-4"><VehicleFaultReports session={session} audience="driver" /></div>}
      </div>
    </section>
  );
}
