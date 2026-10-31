import { SignaturePad } from "../../components/SignaturePad";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Pencil, Eye } from "lucide-react";
import { api } from "../../lib/api";
import { SessionState } from "../../types";

import { supabase } from "../../lib/supabase";



const FORM_CODE = "VS_MECHANICAL_COMPETENCY";

interface Activity { activity: string; result: "Competent" | "Not Competent" | ""; notes: string; }

function emptyDraft(session: SessionState, audience: "admin" | "driver") {
  return {
    worker_id: "", employeeName: "", position: "", assessmentDate: new Date().toISOString().slice(0,10),
    mechanicalExperience: "", previousEmployers: "",
    truckActivities: [] as Activity[],
    trailerActivities: [] as Activity[],
    nonCompetentActivities: "",
    additionalSkills: "",
    employeeDeclaration: false, employeeSignature: "", employeeDate: new Date().toISOString().slice(0,10),
    managerSignature: "", managerDate: new Date().toISOString().slice(0,10),
    status: "Submitted"
  };
}

export function MechanicalCompetencyAssessment({ session, audience = "admin" }: { session: SessionState; audience?: "admin" | "driver" }) {
  const [workers, setWorkers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<any>(null);
  const [employeeSignatureDraft, setEmployeeSignatureDraft] = useState("");
  const [showEmployeeDeclaration, setShowEmployeeDeclaration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      if (audience === "admin") {
        const w = await api.getInductionWorkers(session);
        setWorkers(w ?? []);
      }
      let q = supabase.from("cor_form_submissions").select("*").eq("form_code", FORM_CODE).order("submitted_at", { ascending: false });
      if (audience === "driver") q = q.eq("user_id", session.user.id);
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e: any) { setError(e?.message ?? "Unable to load assessments."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openNew = () => {
    setEditingId(null); setViewRow(null); setShowEmployeeDeclaration(false);
    setDraft(emptyDraft(session, audience));
    setSuccess(""); setError("");
  };

  const openRow = (row: any, mode: "edit" | "view") => {
    const p = row.payload || {};
    if (mode === "view") { setViewRow(row); setDraft(null); return; }
    setEditingId(row.id);
    setViewRow(null);
    setDraft({
      worker_id: p.worker_id ?? "", employeeName: p.employeeName ?? "", position: p.position ?? "",
      assessmentDate: p.assessmentDate ?? new Date().toISOString().slice(0,10),
      mechanicalExperience: p.mechanicalExperience ?? "", previousEmployers: p.previousEmployers ?? "",
      truckActivities: Array.isArray(p.truckActivities) ? p.truckActivities : [],
      trailerActivities: Array.isArray(p.trailerActivities) ? p.trailerActivities : [],
      nonCompetentActivities: p.nonCompetentActivities ?? "",
      additionalSkills: p.additionalSkills ?? "",
      employeeDeclaration: Boolean(p.employeeDeclaration), employeeSignature: p.employeeSignature ?? "",
      employeeDate: p.employeeDate ?? new Date().toISOString().slice(0,10),
      managerSignature: p.managerSignature ?? "", managerDate: p.managerDate ?? new Date().toISOString().slice(0,10),
      status: row.status ?? "Submitted"
    });
    setSuccess(""); setError("");
  };

  const save = async () => {
    if (!draft) return;
    setError(""); setSuccess("");
    if (audience === "admin" && !draft.worker_id) {
      setError("Select the employee before saving the assessment.");
      return;
    }
    const hasEmployee = Boolean(draft.employeeSignature);
    const hasManager = Boolean(draft.managerSignature);
    const computedStatus = hasEmployee && hasManager ? "Completed" : "Pending Signatures";
    const draftWithStatus = { ...draft, status: computedStatus };
    try {
      const payload = { ...draftWithStatus };
      if (editingId) {
        const { error: upErr } = await supabase.from("cor_form_submissions")
          .update({ user_id: draft.worker_id || session.user.id, payload, status: draftWithStatus.status })
          .eq("id", editingId);
        if (upErr) throw upErr;
        setSuccess("Assessment updated.");
      } else {
        const { error: insErr } = await supabase.from("cor_form_submissions").insert({
          user_id: audience === "admin" ? (draft.worker_id || session.user.id) : session.user.id,
          form_code: FORM_CODE, form_title: "Mechanical Competency Assessment",
          payload, status: draftWithStatus.status
        });
        if (insErr) throw insErr;
        setSuccess("Assessment saved.");
      }
      setDraft(null); setEditingId(null); await load();
    } catch (e: any) { setError(e?.message ?? "Unable to save assessment."); }
  };
  const addActivity = (section: "truck" | "trailer") => {
    const key = section === "truck" ? "truckActivities" : "trailerActivities";
    setDraft((d: any) => ({ ...d, [key]: [...(d[key] ?? []), { activity: "", result: "", notes: "" }] }));
  };
  const removeActivity = (section: "truck" | "trailer", i: number) => {
    const key = section === "truck" ? "truckActivities" : "trailerActivities";
    setDraft((d: any) => ({ ...d, [key]: (d[key] ?? []).filter((_: any, idx: number) => idx !== i) }));
  };
  const updateActivity = (section: "truck" | "trailer", i: number, field: string, value: string) => {
    const key = section === "truck" ? "truckActivities" : "trailerActivities";
    setDraft((d: any) => {
      const next = [...(d[key] ?? [])];
      next[i] = { ...next[i], [field]: value };
      return { ...d, [key]: next };
    });
  };

  const ActivitySection = ({ title, section }: { title: string; section: "truck" | "trailer" }) => {
    const key = section === "truck" ? "truckActivities" : "trailerActivities";
    const list = draft?.[key] ?? [];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">{title}</h3>
          <button type="button" onClick={() => addActivity(section)} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"><Plus className="h-3 w-3" /> Add activity</button>
        </div>
        {list.length === 0 && <p className="text-xs text-slate-400">No activities added. Enter official assessment activities from the supplied form.</p>}
        {list.map((a: Activity, i: number) => (
          <div key={i} className="grid gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 md:grid-cols-4">
            <input className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white md:col-span-2" placeholder="Activity" value={a.activity} onChange={(e) => updateActivity(section, i, "activity", e.target.value)} />
            <select className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" value={a.result} onChange={(e) => updateActivity(section, i, "result", e.target.value)}>
              <option value="">Result</option>
              <option value="Competent">Competent</option>
              <option value="Not Competent">Not Competent</option>
            </select>
            <div className="flex gap-2">
              <input className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" placeholder="Notes" value={a.notes} onChange={(e) => updateActivity(section, i, "notes", e.target.value)} />
              <button type="button" onClick={() => removeActivity(section, i)} className="text-rose-300 hover:text-rose-200"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (viewRow) {
    const p = viewRow.payload || {};
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Mechanical Competency Assessment</h2>
          <button type="button" onClick={() => setViewRow(null)} className="text-sm text-slate-300 hover:text-white">Back</button>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white space-y-2">
          <p><span className="font-bold">Employee:</span> {p.employeeName}</p>
          <p><span className="font-bold">Position:</span> {p.position}</p>
          <p><span className="font-bold">Date:</span> {p.assessmentDate}</p>
          <p><span className="font-bold">Mechanical experience:</span> {p.mechanicalExperience}</p>
          <p><span className="font-bold">Previous employers:</span> {p.previousEmployers}</p>
          <p><span className="font-bold">Additional skills:</span> {p.additionalSkills}</p>
          <p><span className="font-bold">Non-competent activities:</span> {p.nonCompetentActivities}</p>
          <p><span className="font-bold">Employee signature:</span> {p.employeeSignature ? "Signed" : "Pending employee signature"} {p.employeeDate ? `(${p.employeeDate})` : ""}</p>
          {p.employeeSignature && <img src={p.employeeSignature} alt="Employee signature" className="h-16 rounded border border-slate-700 bg-white" />}
          {!p.employeeSignature && audience === "driver" && (
            <div className="space-y-2">
              <SignaturePad onSignatureChange={setEmployeeSignatureDraft} />
              <button type="button" disabled={!employeeSignatureDraft} onClick={async () => {
                try {
                  await api.signMechanicalCompetency(session, viewRow.id, employeeSignatureDraft);
                  setEmployeeSignatureDraft("");
                  await load();
                  setViewRow(null);
                } catch (e: any) { setError(e?.message ?? "Unable to sign."); }
              }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                Sign declaration
              </button>
            </div>
          )}
          {p.employeeSignature && <button type="button" onClick={() => setShowEmployeeDeclaration(true)} className="text-xs text-blue-300 hover:text-blue-200">View signed declaration</button>}
          {showEmployeeDeclaration && p.employeeSignature && (
            <div className="rounded-lg border border-slate-600 bg-slate-950 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">Employee Signed Declaration</h3>
                <button type="button" onClick={() => setShowEmployeeDeclaration(false)} className="text-xs text-slate-300">Close</button>
              </div>
              <p className="text-sm text-slate-300">The employee confirmed the declaration when signing this assessment.</p>
              <img src={p.employeeSignature} alt="Employee signature" className="h-20 rounded border border-slate-600 bg-white p-1" />
              <p className="text-sm"><span className="font-semibold">Employee:</span> {p.employeeName}</p>
              <p className="text-sm"><span className="font-semibold">Signed:</span> {p.employeeDate || "Date not recorded"}</p>
            </div>
          )}
          <p><span className="font-bold">Manager signature:</span> {p.managerSignature ? "Signed" : "Pending"} {p.managerDate ? `(${p.managerDate})` : ""}</p>
        </div>
      </section>
    );
  }

  if (draft) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">{editingId ? "Edit" : "New"} Mechanical Competency Assessment</h2>
          <button type="button" onClick={() => { setDraft(null); setEditingId(null); }} className="text-sm text-slate-300 hover:text-white">Cancel</button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {success && <p className="text-sm text-emerald-300">{success}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {audience === "admin" && (
            <label className="text-sm text-slate-200">Employee
              <select className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.worker_id} onChange={(e) => {
                const w = workers.find((x: any) => x.id === e.target.value);
                setDraft({
                  ...draft,
                  worker_id: e.target.value,
                  employeeName: w?.fullName ?? w?.full_name ?? "",
                  employeeDeclaration: false,
                  employeeSignature: "",
                  employeeDate: ""
                });
              }}>
                <option value="">Select employee</option>
                {workers.map((w: any) => <option key={w.id} value={w.id}>{w.fullName ?? w.full_name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-slate-200">Employee name
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.employeeName} onChange={(e) => setDraft({ ...draft, employeeName: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Position
            <input className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
          </label>
          <label className="text-sm text-slate-200">Assessment date
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.assessmentDate} onChange={(e) => setDraft({ ...draft, assessmentDate: e.target.value })} />
          </label>
        </div>
        <label className="block text-sm text-slate-200">Mechanical experience
          <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={draft.mechanicalExperience} onChange={(e) => setDraft({ ...draft, mechanicalExperience: e.target.value })} />
        </label>
        <label className="block text-sm text-slate-200">Previous mechanical employers
          <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={draft.previousEmployers} onChange={(e) => setDraft({ ...draft, previousEmployers: e.target.value })} />
        </label>
        <ActivitySection title="Heavy Vehicle (Truck)" section="truck" />
        <ActivitySection title="Heavy Vehicle (Trailer)" section="trailer" />

        <label className="block text-sm text-slate-200">Additional non-competent activities
          <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={draft.nonCompetentActivities} onChange={(e) => setDraft({ ...draft, nonCompetentActivities: e.target.value })} />
        </label>
        <label className="block text-sm text-slate-200">Additional skills
          <textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" rows={3} value={draft.additionalSkills} onChange={(e) => setDraft({ ...draft, additionalSkills: e.target.value })} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="text-sm text-slate-200">
            <p className="font-semibold">Employee signature status</p>
            {draft.employeeSignature ? (
              <div className="mt-2 space-y-2">
                <p className="text-emerald-300 font-bold">Signed</p>
                <p className="text-xs text-slate-400">Signed date: {draft.employeeDate}</p>
                <img src={draft.employeeSignature} alt="Employee signature" className="h-16 rounded border border-slate-700 bg-white" />
                <button type="button" onClick={() => setShowEmployeeDeclaration(true)} className="text-xs text-blue-300 hover:text-blue-200">View signed declaration</button>
                {showEmployeeDeclaration && (
                  <div className="rounded-lg border border-slate-600 bg-slate-950 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-white">Employee Signed Declaration</p>
                      <button type="button" onClick={() => setShowEmployeeDeclaration(false)} className="text-xs text-slate-300">Close</button>
                    </div>
                    <p className="text-xs text-slate-300">The employee confirmed the declaration when signing this assessment.</p>
                    <p className="text-xs text-slate-300">Employee: {draft.employeeName}</p>
                    <p className="text-xs text-slate-300">Signed date: {draft.employeeDate || "Date not recorded"}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-amber-300">Pending employee signature</p>
            )}
          </div>
          <div className="text-sm text-slate-200">
            <p className="font-semibold mb-1">Manager/operator review signature</p>
            <SignaturePad initialSignature={draft.managerSignature} onSignatureChange={(sig) => setDraft({ ...draft, managerSignature: sig, managerDate: sig ? new Date().toISOString().slice(0,10) : draft.managerDate })} />
          </div>
          <label className="text-sm text-slate-200">Manager/operator review date
            <input type="date" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" value={draft.managerDate} onChange={(e) => setDraft({ ...draft, managerDate: e.target.value })} />
          </label>
        </div>
        <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
          <Save className="h-4 w-4" /> Save assessment
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Mechanical Competency Assessments</h2>
        {audience === "admin" && (
          <button type="button" onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
            <Plus className="h-4 w-4" /> New assessment
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {success && <p className="text-sm text-emerald-300">{success}</p>}
      {loading ? <p className="text-sm text-slate-400">Loading...</p> : rows.length === 0 ? <p className="text-sm text-slate-400">No assessments yet.</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full text-sm text-slate-200">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-800">
                  <td className="px-3 py-2">{r.payload?.employeeName || r.id}</td>
                  <td className="px-3 py-2">{r.payload?.assessmentDate}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openRow(r, "view")} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"><Eye className="h-3 w-3" /> View</button>
                      {audience === "admin" && <button type="button" onClick={() => openRow(r, "edit")} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"><Pencil className="h-3 w-3" /> Edit</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
