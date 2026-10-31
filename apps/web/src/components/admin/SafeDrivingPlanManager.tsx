"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardCheck, Loader2, Plus, Save, Send, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type Stop = {
  from: string;
  to: string;
  estimatedStart: string;
  workingTime: string;
  restTime: string;
  restArea: string;
  totalTime: string;
};

type PlanPayload = {
  planName: string;
  assignedDriverId: string;
  assignedDriverName: string;
  createdBy: string;
  createdByName: string;
  status: string;
  version: number;
  history: { version: number; amendedAt: string; amendedBy: string; summary: string; snapshot: Record<string, unknown> }[];
  tripDetails: { tripPlanName: string; deliveryLocations: string; addresses: string; contacts: string; routeMap: string };
  driverVehicle: { tripDateStart: string; tripDateEnd: string; vehicleCombination: string; driverName: string; regos: string; drivingScheme: string; templateNumber: string; pbsCombination: string; permits: string };
  proposedTrip: Stop[];
  fitness: { resetRest14Days: string; recentWorkPattern: string; requiredContinuousRest: string; remainingWorkHours: string; returnFromLeaveOrMedical: string; requiredRestBreaks: string };
  risk: { vehicleIssues: string; speedRouteRestrictions: string; loadingDelays: string; loadType: string; weather: string; otherRisks: string; notes: string };
  specialInstructions: { fatigueInstructions: string; ifTripChanges: string };
  declarations: { driver: { acknowledged: boolean; signature: string; date: string; notes: string }; scheduler: { acknowledged: boolean; signature: string; date: string; notes: string } };
  review: { reviewerName: string; dateCompleted: string; reviewDate: string; reminders: string };
  driverChecklist: { fitForDuty: string; hoursAvailable: string; restTaken: string; medicationsOrConditions: string; notes: string };
  tripChangeReport: string;
};

type PlanRow = { id: string; user_id: string; payload: PlanPayload; status: string; submitted_at: string; reviewed_at?: string | null; reviewed_by?: string | null; review_notes?: string | null };
type DriverOption = { id: string; fullName: string; email: string };

const FORM_CODE = "SDP";
const FORM_TITLE = "Safe Driving Plan";

function emptyStop(): Stop { return { from: "", to: "", estimatedStart: "", workingTime: "", restTime: "", restArea: "", totalTime: "" }; }

function emptyPlan(driverId = "", driverName = "", createdByName = ""): PlanPayload {
  return {
    planName: "", assignedDriverId: driverId, assignedDriverName: driverName, createdBy: "", createdByName, status: "Draft", version: 1, history: [],
    tripDetails: { tripPlanName: "", deliveryLocations: "", addresses: "", contacts: "", routeMap: "" },
    driverVehicle: { tripDateStart: "", tripDateEnd: "", vehicleCombination: "", driverName: driverName, regos: "", drivingScheme: "Standard", templateNumber: "", pbsCombination: "", permits: "" },
    proposedTrip: [emptyStop()],
    fitness: { resetRest14Days: "", recentWorkPattern: "", requiredContinuousRest: "", remainingWorkHours: "", returnFromLeaveOrMedical: "", requiredRestBreaks: "" },
    risk: { vehicleIssues: "No", speedRouteRestrictions: "No", loadingDelays: "No", loadType: "", weather: "No", otherRisks: "No", notes: "" },
    specialInstructions: { fatigueInstructions: "", ifTripChanges: "" },
    declarations: { driver: { acknowledged: false, signature: "", date: "", notes: "" }, scheduler: { acknowledged: false, signature: "", date: "", notes: "" } },
    review: { reviewerName: "", dateCompleted: "", reviewDate: "", reminders: "" },
    driverChecklist: { fitForDuty: "", hoursAvailable: "", restTaken: "", medicationsOrConditions: "", notes: "" },
    tripChangeReport: ""
  };
}

function rowToPlan(row: any): PlanRow {
  return { id: row.id, user_id: row.user_id, payload: { ...emptyPlan(), ...(row.payload || {}) }, status: row.status || (row.payload?.status ?? "Draft"), submitted_at: row.submitted_at, reviewed_at: row.reviewed_at, reviewed_by: row.reviewed_by, review_notes: row.review_notes };
}

function inputClass(disabled = false) { return `w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none ${disabled ? "opacity-60 cursor-not-allowed" : ""}`; }

export function SafeDrivingPlanManager({ session, mode = "admin" }: { session: SessionState; mode?: "admin" | "driver" }) {
  const isAdmin = mode === "admin" && session.user.role === "admin";
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driversError, setDriversError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanPayload>(emptyPlan("", "", session.user.email));
  const [showForm, setShowForm] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let query = supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
      if (!isAdmin) query = query.eq("user_id", session.user.id);
      const { data, error: err } = await query;
      if (err) throw err;
      setPlans((data || []).map(rowToPlan));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load safe driving plans.");
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, session.user.id]);

  const loadDrivers = useCallback(async () => {
    if (!isAdmin) return;
    setDriversError("");
    try {
      const { data, error: err } = await supabase.from("profiles").select("id, full_name, email, role").eq("role", "driver");
      if (err) throw err;
      setDrivers((data || []).map((r: any) => ({ id: r.id, fullName: r.full_name || r.email || r.id, email: r.email || "" })));
    } catch (e) {
      setDrivers([]);
      setDriversError(e instanceof Error ? e.message : "Unable to load drivers.");
    }
  }, [isAdmin]);

  useEffect(() => { void loadPlans(); void loadDrivers(); }, [loadPlans, loadDrivers]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedId) || null, [plans, selectedId]);

  const openNew = () => {
    setSelectedId(null);
    setPlan(emptyPlan("", "", session.user.email));
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const openPlan = (row: PlanRow) => {
    setSelectedId(row.id);
    setPlan({ ...emptyPlan(), ...row.payload, status: row.status || row.payload.status });
    setShowForm(true);
    setError("");
    setSuccess("");
  };

  const backToList = () => {
    setShowForm(false);
    setSelectedId(null);
    void loadPlans();
  };

  const updateNested = (section: keyof PlanPayload, field: string, value: any) => {
    setPlan((prev) => ({ ...prev, [section]: typeof prev[section] === "object" && !Array.isArray(prev[section]) ? { ...(prev[section] as any), [field]: value } : value }));
  };

  const addStop = () => setPlan((prev) => ({ ...prev, proposedTrip: [...prev.proposedTrip, emptyStop()] }));
  const removeStop = (index: number) => setPlan((prev) => ({ ...prev, proposedTrip: prev.proposedTrip.filter((_, i) => i !== index) }));
  const updateStop = (index: number, field: keyof Stop, value: string) => setPlan((prev) => ({ ...prev, proposedTrip: prev.proposedTrip.map((s, i) => i === index ? { ...s, [field]: value } : s) }));

  const savePlan = async (nextStatus?: string, sourcePlan: PlanPayload = plan) => {
    setError("");
    setSuccess("");
    if (!sourcePlan.planName.trim()) { setError("Plan name is required."); return; }
    if (isAdmin && nextStatus && nextStatus !== "Draft" && !sourcePlan.assignedDriverId) { setError("Select a driver before assigning."); return; }
    setSaving(true);
    try {
      const status = nextStatus || sourcePlan.status || "Draft";
      const now = new Date().toISOString();
      const payload: PlanPayload = { ...sourcePlan, status, createdBy: sourcePlan.createdBy || session.user.id, createdByName: sourcePlan.createdByName || session.user.email };
      if (isAdmin && payload.assignedDriverId) {
        const drv = drivers.find((d) => d.id === payload.assignedDriverId);
        if (drv) payload.assignedDriverName = drv.fullName;
      }
      if (isAdmin && payload.declarations.scheduler.acknowledged && !payload.declarations.scheduler.date) payload.declarations.scheduler.date = now.slice(0, 10);
      if (!isAdmin && payload.declarations.driver.acknowledged && !payload.declarations.driver.date) payload.declarations.driver.date = now.slice(0, 10);

      if (isAdmin) {
        let history = [...(payload.history || [])];
        if (selectedId) {
          const previous = selectedPlan?.payload;
          if (previous) {
            history = [{ version: previous.version || payload.version, amendedAt: now, amendedBy: session.user.email, summary: `Amended to version ${(previous.version || 1) + 1}`, snapshot: previous as any }, ...history];
            payload.version = (previous.version || 1) + 1;
            payload.history = history;
          }
        } else {
          payload.version = 1;
          payload.history = [];
        }
      }

      const userId = payload.assignedDriverId || session.user.id;
      if (selectedId) {
        const { error: err } = await supabase.from("cor_form_submissions").update({ user_id: userId, payload, status }).eq("id", selectedId);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.from("cor_form_submissions").insert({ user_id: userId, form_code: FORM_CODE, form_title: FORM_TITLE, payload, status }).select().single();
        if (err) throw err;
        setSelectedId(data.id);
      }
      setSuccess("Safe Driving Plan saved.");
      setPlan(payload);
      await loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save plan.");
    } finally {
      setSaving(false);
    }
  };

  const submitDriverAcknowledgement = async () => {
    if (!plan.declarations.driver.signature.trim()) { setError("Driver signature is required."); return; }
    const now = new Date().toISOString().slice(0, 10);
    const updatedPlan: PlanPayload = {
      ...plan,
      declarations: { ...plan.declarations, driver: { ...plan.declarations.driver, acknowledged: true, date: plan.declarations.driver.date || now } },
      status: "Acknowledged"
    };
    setPlan(updatedPlan);
    await savePlan("Acknowledged", updatedPlan);
  };

  const submitSchedulerAcknowledgement = async () => {
    if (!plan.declarations.driver.acknowledged) { setError("Driver acknowledgement is required before scheduler approval."); return; }
    if (!plan.declarations.scheduler.signature.trim()) { setError("Scheduler signature is required."); return; }
    const now = new Date().toISOString().slice(0, 10);
    const updatedPlan: PlanPayload = {
      ...plan,
      declarations: { ...plan.declarations, scheduler: { ...plan.declarations.scheduler, acknowledged: true, date: plan.declarations.scheduler.date || now } },
      status: "Completed"
    };
    setPlan(updatedPlan);
    await savePlan("Completed", updatedPlan);
  };

  const reportTripChange = async () => {
    if (!plan.tripChangeReport.trim()) { setError("Enter trip change details."); return; }
    await savePlan("Trip Change Reported");
  };

  if (loading) return <div className="flex items-center gap-2 text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading safe driving plans...</div>;

  if (!showForm) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Chain of Responsibility</p>
            <h2 className="text-xl font-black text-white">{isAdmin ? "Safe Driving Plans" : "My Safe Driving Plans"}</h2>
          </div>
          {isAdmin && <button onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"><Plus className="h-4 w-4" /> New Plan</button>}
        </div>
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
        {driversError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">Unable to load drivers: {driversError}</div>}
        {success && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</div>}
        {plans.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center text-slate-300">No safe driving plans assigned.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="min-w-full text-sm text-white">
              <thead className="bg-slate-800 text-xs uppercase text-slate-400">
                <tr><th className="px-3 py-2 text-left">Plan</th><th className="px-3 py-2 text-left">Driver</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-left">Created</th><th className="px-3 py-2 text-left">Action</th></tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-slate-700">
                    <td className="px-3 py-2 font-medium">{p.payload.planName || "Untitled"}</td>
                    <td className="px-3 py-2">{p.payload.assignedDriverName || "—"}</td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2">{p.payload.version}</td>
                    <td className="px-3 py-2">{new Date(p.submitted_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><button onClick={() => openPlan(p)} className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  const disabledForDriver = !isAdmin;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={backToList} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"><ArrowLeft className="h-4 w-4" /> Back</button>
        <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-bold text-slate-200">{plan.status}</span>
      </div>
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {driversError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">Unable to load drivers: {driversError}</div>}
      {success && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{success}</div>}

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">1. Trip Details</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="text-xs text-slate-400">Plan name</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.planName} onChange={(e) => setPlan((p) => ({ ...p, planName: e.target.value }))} /></div>
          <div><label className="text-xs text-slate-400">Trip plan name</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.tripDetails.tripPlanName} onChange={(e) => updateNested("tripDetails", "tripPlanName", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Delivery locations</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.tripDetails.deliveryLocations} onChange={(e) => updateNested("tripDetails", "deliveryLocations", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Addresses</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.tripDetails.addresses} onChange={(e) => updateNested("tripDetails", "addresses", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Contact names/numbers</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.tripDetails.contacts} onChange={(e) => updateNested("tripDetails", "contacts", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Route map (URL)</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.tripDetails.routeMap} onChange={(e) => updateNested("tripDetails", "routeMap", e.target.value)} /></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">2. Driver/Vehicle Details</h3>
        {isAdmin && (
          <div><label className="text-xs text-slate-400">Assigned driver</label>
            <select className={inputClass(false)} value={plan.assignedDriverId} onChange={(e) => { const d = drivers.find((x) => x.id === e.target.value); setPlan((p) => ({ ...p, assignedDriverId: e.target.value, assignedDriverName: d?.fullName || p.assignedDriverName, driverVehicle: { ...p.driverVehicle, driverName: d?.fullName || p.driverVehicle.driverName } })); }}>
              <option value="">Select driver</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="text-xs text-slate-400">Trip date start</label><input type="date" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.tripDateStart} onChange={(e) => updateNested("driverVehicle", "tripDateStart", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Trip date end</label><input type="date" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.tripDateEnd} onChange={(e) => updateNested("driverVehicle", "tripDateEnd", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Vehicle combination</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.vehicleCombination} onChange={(e) => updateNested("driverVehicle", "vehicleCombination", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Registration numbers</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.regos} onChange={(e) => updateNested("driverVehicle", "regos", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Driving-hours scheme</label>
            <select className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.drivingScheme} onChange={(e) => updateNested("driverVehicle", "drivingScheme", e.target.value)}>
              <option>Standard</option><option>BFM</option><option>FACA</option><option>Other</option>
            </select>
          </div>
          <div><label className="text-xs text-slate-400">Template number</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.templateNumber} onChange={(e) => updateNested("driverVehicle", "templateNumber", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">PBS combination</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.pbsCombination} onChange={(e) => updateNested("driverVehicle", "pbsCombination", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Supporting permits/documents</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.driverVehicle.permits} onChange={(e) => updateNested("driverVehicle", "permits", e.target.value)} /></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">3. Proposed Trip Plan</h3>
          {!disabledForDriver && <button onClick={addStop} className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800">Add stop</button>}
        </div>
        <div className="space-y-3">
          {plan.proposedTrip.map((stop, index) => (
            <div key={index} className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">Stop {index + 1}</span>
                {!disabledForDriver && plan.proposedTrip.length > 1 && <button onClick={() => removeStop(index)} className="text-xs text-rose-300 hover:text-rose-200">Remove</button>}
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <input placeholder="From" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.from} onChange={(e) => updateStop(index, "from", e.target.value)} />
                <input placeholder="To" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.to} onChange={(e) => updateStop(index, "to", e.target.value)} />
                <input placeholder="Est. start" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.estimatedStart} onChange={(e) => updateStop(index, "estimatedStart", e.target.value)} />
                <input placeholder="Working time" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.workingTime} onChange={(e) => updateStop(index, "workingTime", e.target.value)} />
                <input placeholder="Rest time" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.restTime} onChange={(e) => updateStop(index, "restTime", e.target.value)} />
                <input placeholder="Rest area" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.restArea} onChange={(e) => updateStop(index, "restArea", e.target.value)} />
                <input placeholder="Total time" className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={stop.totalTime} onChange={(e) => updateStop(index, "totalTime", e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">4. Fitness for Duty / Fatigue Checklist</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="text-xs text-slate-400">Previous 14-day reset rest</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.resetRest14Days} onChange={(e) => updateNested("fitness", "resetRest14Days", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Recent work pattern</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.recentWorkPattern} onChange={(e) => updateNested("fitness", "recentWorkPattern", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Required continuous rest</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.requiredContinuousRest} onChange={(e) => updateNested("fitness", "requiredContinuousRest", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Remaining permitted work hours</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.remainingWorkHours} onChange={(e) => updateNested("fitness", "remainingWorkHours", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Return from leave/medical/other conditions</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.returnFromLeaveOrMedical} onChange={(e) => updateNested("fitness", "returnFromLeaveOrMedical", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Required rest breaks</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.fitness.requiredRestBreaks} onChange={(e) => updateNested("fitness", "requiredRestBreaks", e.target.value)} /></div>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
          <p className="text-xs font-bold text-slate-300">Driver checklist</p>
          <div className="grid gap-2 md:grid-cols-2">
            <input placeholder="Fit for duty" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.driverChecklist.fitForDuty} onChange={(e) => updateNested("driverChecklist", "fitForDuty", e.target.value)} />
            <input placeholder="Hours available" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.driverChecklist.hoursAvailable} onChange={(e) => updateNested("driverChecklist", "hoursAvailable", e.target.value)} />
            <input placeholder="Rest taken" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.driverChecklist.restTaken} onChange={(e) => updateNested("driverChecklist", "restTaken", e.target.value)} />
            <input placeholder="Medications/conditions" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.driverChecklist.medicationsOrConditions} onChange={(e) => updateNested("driverChecklist", "medicationsOrConditions", e.target.value)} />
            <textarea placeholder="Notes" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.driverChecklist.notes} onChange={(e) => updateNested("driverChecklist", "notes", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">5. General Risk Assessment</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {(["vehicleIssues", "speedRouteRestrictions", "loadingDelays", "weather", "otherRisks"] as const).map((field) => (
            <div key={field}><label className="text-xs text-slate-400">{field}</label>
              <select className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={(plan.risk as any)[field]} onChange={(e) => updateNested("risk", field, e.target.value)}>
                <option>No</option><option>Yes</option>
              </select>
            </div>
          ))}
          <div><label className="text-xs text-slate-400">Load type</label><input className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.risk.loadType} onChange={(e) => updateNested("risk", "loadType", e.target.value)} /></div>
          <div className="md:col-span-2"><label className="text-xs text-slate-400">Notes</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.risk.notes} onChange={(e) => updateNested("risk", "notes", e.target.value)} /></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">6. Special Instructions / Contingencies</h3>
        <div className="grid gap-3">
          <div><label className="text-xs text-slate-400">Fatigue-management instructions</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.specialInstructions.fatigueInstructions} onChange={(e) => updateNested("specialInstructions", "fatigueInstructions", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">If trip or route changes</label><textarea className={inputClass(disabledForDriver)} disabled={disabledForDriver} value={plan.specialInstructions.ifTripChanges} onChange={(e) => updateNested("specialInstructions", "ifTripChanges", e.target.value)} /></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">7. Declarations</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-300">Driver acknowledgement</p>
            <p className="text-xs text-slate-400">I have read and understood this Safe Driving Plan and will comply with its requirements.</p>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={plan.declarations.driver.acknowledged} disabled={isAdmin} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, driver: { ...p.declarations.driver, acknowledged: e.target.checked } } }))} /> Acknowledged</label>
            <input placeholder="Driver signature" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.declarations.driver.signature} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, driver: { ...p.declarations.driver, signature: e.target.value } } }))} />
            <input type="date" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.declarations.driver.date} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, driver: { ...p.declarations.driver, date: e.target.value } } }))} />
            <textarea placeholder="Driver notes" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.declarations.driver.notes} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, driver: { ...p.declarations.driver, notes: e.target.value } } }))} />
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-300">Scheduler acknowledgement</p>
            <p className="text-xs text-slate-400">I have reviewed and approved this Safe Driving Plan for allocation.</p>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={plan.declarations.scheduler.acknowledged} disabled={!isAdmin} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, scheduler: { ...p.declarations.scheduler, acknowledged: e.target.checked } } }))} /> Acknowledged</label>
            <input placeholder="Scheduler signature" className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.declarations.scheduler.signature} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, scheduler: { ...p.declarations.scheduler, signature: e.target.value } } }))} />
            <input type="date" className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.declarations.scheduler.date} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, scheduler: { ...p.declarations.scheduler, date: e.target.value } } }))} />
            <textarea placeholder="Scheduler notes" className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.declarations.scheduler.notes} onChange={(e) => setPlan((p) => ({ ...p, declarations: { ...p.declarations, scheduler: { ...p.declarations.scheduler, notes: e.target.value } } }))} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">8. Trip Plan Review</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="text-xs text-slate-400">Reviewer name</label><input className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.review.reviewerName} onChange={(e) => updateNested("review", "reviewerName", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Date completed</label><input type="date" className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.review.dateCompleted} onChange={(e) => updateNested("review", "dateCompleted", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Review date</label><input type="date" className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.review.reviewDate} onChange={(e) => updateNested("review", "reviewDate", e.target.value)} /></div>
          <div><label className="text-xs text-slate-400">Review reminders</label><textarea className={inputClass(!isAdmin)} disabled={!isAdmin} value={plan.review.reminders} onChange={(e) => updateNested("review", "reminders", e.target.value)} /></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Trip Change Report</h3>
        <textarea placeholder="Report trip or route changes to scheduler" className={inputClass(isAdmin)} disabled={isAdmin} value={plan.tripChangeReport} onChange={(e) => setPlan((p) => ({ ...p, tripChangeReport: e.target.value }))} />
        {!isAdmin && <button onClick={() => void reportTripChange()} disabled={saving} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60">Report Change</button>}
      </div>

      <div className="flex flex-wrap gap-2">
        {isAdmin && <button onClick={() => void savePlan("Draft")} disabled={saving} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">Save Draft</button>}
        {isAdmin && <button onClick={() => void savePlan("Assigned")} disabled={saving} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">Assign / Update</button>}
        {!isAdmin && <button onClick={() => void submitDriverAcknowledgement()} disabled={saving} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">Acknowledge as Driver</button>}
        {isAdmin && <button onClick={() => void submitSchedulerAcknowledgement()} disabled={saving} className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-60">Scheduler Acknowledge</button>}
      </div>

      {plan.history?.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-2">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">Amendment History</h3>
          <ul className="space-y-2 text-xs text-slate-300">
            {plan.history.map((h, i) => (
              <li key={i} className="rounded-lg border border-slate-700 bg-slate-900 p-2">
                <span className="font-semibold">v{h.version}</span> — {h.amendedAt} by {h.amendedBy}: {h.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}


export const SafeDrivingPlan = SafeDrivingPlanManager;
export const SafeDrivingPlanAdmin = SafeDrivingPlanManager;
export const SafeDrivingPlanDriver = SafeDrivingPlanManager;
