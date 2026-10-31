import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Loader2, Save, Send } from "lucide-react";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const ASSESS_CODE = "MDASSESS";
const ACK_CODE = "MDACK";
const KEY_CODE = "MDASSESSKEY";

const QUESTIONS = [
  "1. Which of the following are mass limit allowance schemes?",
  "2. How can you typically gain access to CML and HML weights?",
  "3. Name one requirement (out of the four listed in the official source) for a vehicle to be eligible for the 0.5-tonne steer exemption.",
  "4. What is the typical maximum mass limit of a B-Double operating under Mass Management Accreditation, excluding the 7.1-tonne steer allowance?",
  "5. How often should a calibration be undertaken on a weighing method?",
  "6. True or False: PBS stands for Performance Based Standards.",
  "7. Generally, the maximum width allowed is:",
  "8. The height limit for a truck is 4.3 metres unless it is a vehicle built to carry cattle, horses, pigs or sheep, or a vehicle built with at least two decks for carrying vehicles.",
  "9. What is the general maximum length for a road train?",
  "10. A large indivisible item is an item that:"
];

export function MassDimensionAssessmentAdmin({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const isAdmin = session.user.role === "admin";
  const [tab, setTab] = useState<"assessment" | "acknowledgement" | "key">("assessment");

  const [assessRecords, setAssessRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingAssess, setEditingAssess] = useState<any | null>(null);
  const [showAssessForm, setShowAssessForm] = useState(false);
  const [assessForm, setAssessForm] = useState<any>({
    candidate_name: "",
    assessment_date: "",
    method: "Written",
    answers: QUESTIONS.map(() => ({ answer: "", correct: false })),
    outcome: "Not Competent",
    assessor_name: "",
    assessor_signature: "",
    completion_date: "",
    notes: ""
  });

  const [ackRecords, setAckRecords] = useState<any[]>([]);
  const [showAckForm, setShowAckForm] = useState(false);
  const [editingAck, setEditingAck] = useState<any | null>(null);
  const [ackForm, setAckForm] = useState<any>({
    employee_name: "",
    confirmation: false,
    signature: "",
    date: ""
  });

  const [keyItems, setKeyItems] = useState<any[]>(
    QUESTIONS.map((q) => ({ q, answer: "", explanation: "" }))
  );
  const [savingKey, setSavingKey] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [a, k, ack] = await Promise.all([
        supabase.from("cor_form_submissions").select("*").eq("form_code", ASSESS_CODE).order("submitted_at", { ascending: false }),
        supabase.from("cor_form_submissions").select("*").eq("form_code", KEY_CODE).order("submitted_at", { ascending: false }).limit(1),
        supabase.from("cor_form_submissions").select("*").eq("form_code", ACK_CODE).order("submitted_at", { ascending: false })
      ]);
      if (a.error) throw a.error;
      if (k.error) throw k.error;
      if (ack.error) throw ack.error;
      setAssessRecords(a.data || []);
      setAckRecords(ack.data || []);
      const kr = k.data?.[0];
      if (kr?.payload?.items) {
        setKeyItems(kr.payload.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load assessment data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);
  const openNewAssess = () => {
    setEditingAssess(null);
    setAssessForm({
      candidate_name: "",
      assessment_date: "",
      method: "Written",
      answers: QUESTIONS.map(() => ({ answer: "", correct: false })),
      outcome: "Not Competent",
      assessor_name: "",
      assessor_signature: "",
      completion_date: "",
      notes: ""
    });
    setShowAssessForm(true);
    setError("");
    setSuccess("");
  };

  const openEditAssess = (rec: any) => {
    setEditingAssess(rec);
    setAssessForm({ ...rec.payload });
    setShowAssessForm(true);
    setError("");
    setSuccess("");
  };

  const validateAssess = (): string | null => {
    if (!assessForm.candidate_name.trim()) return "Candidate name is required.";
    if (!assessForm.assessment_date) return "Assessment date is required.";
    if (!assessForm.assessor_name.trim()) return "Assessor name is required.";
    if (!assessForm.assessor_signature.trim()) return "Assessor signature is required.";
    if (!assessForm.completion_date) return "Completion date is required.";
    return null;
  };

  const saveAssess = async (submit: boolean) => {
    const v = validateAssess();
    if (v) { setError(v); return; }
    const allCorrect = assessForm.answers.every((a: any) => a.correct);
    const outcome = allCorrect ? "Competent" : "Not Competent";
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const payload = { ...assessForm, outcome, status: submit ? "Submitted" : "Draft" };
      if (editingAssess) {
        const { error: err } = await supabase
          .from("cor_form_submissions")
          .update({ payload, status: submit ? "Submitted" : "Draft", updated_at: now, submitted_at: submit ? now : editingAssess.submitted_at })
          .eq("id", editingAssess.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: ASSESS_CODE,
          form_title: "Mass and Dimension Awareness Assessment",
          payload,
          status: submit ? "Submitted" : "Draft",
          submitted_at: submit ? now : null
        });
        if (err) throw err;
      }
      setSuccess(submit ? "Assessment submitted." : "Draft saved.");
      setShowAssessForm(false);
      setEditingAssess(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save assessment.");
    } finally {
      setSaving(false);
    }
  };
  // Acknowledgement
  const openNewAck = () => {
    setEditingAck(null);
    setAckForm({ employee_name: "", confirmation: false, signature: "", date: "" });
    setShowAckForm(true);
    setError("");
    setSuccess("");
  };

  const openEditAck = (rec: any) => {
    setEditingAck(rec);
    setAckForm({ ...rec.payload });
    setShowAckForm(true);
    setError("");
    setSuccess("");
  };

  const validateAck = (): string | null => {
    if (!ackForm.employee_name.trim()) return "Employee name is required.";
    if (!ackForm.confirmation) return "Acknowledgement confirmation is required.";
    if (!ackForm.signature.trim()) return "Signature is required.";
    if (!ackForm.date) return "Date is required.";
    return null;
  };

  const saveAck = async (submit: boolean) => {
    const v = validateAck();
    if (v) { setError(v); return; }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const payload = { ...ackForm, status: submit ? "Submitted" : "Draft" };
      if (editingAck) {
        const { error: err } = await supabase
          .from("cor_form_submissions")
          .update({ payload, status: submit ? "Submitted" : "Draft", updated_at: now, submitted_at: submit ? now : editingAck.submitted_at })
          .eq("id", editingAck.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("cor_form_submissions").insert({
          user_id: session.user.id,
          form_code: ACK_CODE,
          form_title: "Mass and Dimension Awareness Acknowledgement",
          payload,
          status: submit ? "Submitted" : "Draft",
          submitted_at: submit ? now : null
        });
        if (err) throw err;
      }
      setSuccess(submit ? "Acknowledgement submitted." : "Draft saved.");
      setShowAckForm(false);
      setEditingAck(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save acknowledgement.");
    } finally {
      setSaving(false);
    }
  };

  // Answer key (admin only)
  const saveKey = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const { error: err } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: KEY_CODE,
        form_title: "Mass and Dimension Awareness Answer Reference",
        payload: { items: keyItems, updated_at: now },
        status: "Submitted",
        submitted_at: now
      });
      if (err) throw err;
      setSuccess("Answer reference saved.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save answer reference.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading assessment data...</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <ClipboardList className="h-5 w-5 text-emerald-400" />
          Mass and Dimension Awareness Assessment/Acknowledgement
        </h3>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("assessment")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "assessment" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
        >
          Assessment
        </button>
        <button
          type="button"
          onClick={() => setTab("acknowledgement")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "acknowledgement" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
        >
          Acknowledgement
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab("key")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "key" ? "bg-emerald-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
          >
            Answer Reference
          </button>
        )}
      </div>
      {tab === "assessment" && (
        <div className="space-y-4">
          {!showAssessForm && (
            <button
              type="button"
              onClick={openNewAssess}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" /> New Assessment
            </button>
          )}

          {showAssessForm && (
            <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-xs font-medium text-slate-200">
                  Candidate Name *
                  <input
                    value={assessForm.candidate_name}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, candidate_name: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Assessment Date *
                  <input
                    type="date"
                    value={assessForm.assessment_date}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, assessment_date: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Method
                  <select
                    value={assessForm.method}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, method: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <option value="Written">Written</option>
                    <option value="Verbal">Verbal (literacy impaired)</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Assessor Name *
                  <input
                    value={assessForm.assessor_name}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, assessor_name: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Assessor Signature *
                  <input
                    value={assessForm.assessor_signature}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, assessor_signature: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Completion Date *
                  <input
                    type="date"
                    value={assessForm.completion_date}
                    onChange={(e) => setAssessForm((p: any) => ({ ...p, completion_date: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
              <div className="space-y-3">
                {QUESTIONS.map((q, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-sm font-semibold text-white">{q}</p>
                    <textarea
                      value={assessForm.answers[idx].answer}
                      onChange={(e) => {
                        const next = [...assessForm.answers];
                        next[idx] = { ...next[idx], answer: e.target.value };
                        setAssessForm((p: any) => ({ ...p, answers: next }));
                      }}
                      rows={2}
                      className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                      placeholder="Answer"
                    />
                    <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={assessForm.answers[idx].correct}
                        onChange={(e) => {
                          const next = [...assessForm.answers];
                          next[idx] = { ...next[idx], correct: e.target.checked };
                          setAssessForm((p: any) => ({ ...p, answers: next }));
                        }}
                      />
                      Mark correct
                    </label>
                  </div>
                ))}
              </div>
              <label className="text-xs font-medium text-slate-200">
                Notes
                <textarea
                  value={assessForm.notes}
                  onChange={(e) => setAssessForm((p: any) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>

              <p className="text-sm text-slate-300">
                Outcome:{" "}
                <span className="font-semibold text-emerald-300">
                  {assessForm.answers.every((a: any) => a.correct) ? "Competent" : "Not Competent"}
                </span>{" "}
                (all questions must be correct to be competent)
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveAssess(false)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => void saveAssess(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAssessForm(false); setEditingAssess(null); }}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showAssessForm && (
            assessRecords.length === 0 ? (
              <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No assessment records yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
                  <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left">Candidate</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Method</th>
                      <th className="px-4 py-3 text-left">Outcome</th>
                      <th className="px-4 py-3 text-left">Assessor</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700 bg-slate-900/40">
                    {assessRecords.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.payload?.candidate_name || "—"}</td>
                        <td className="px-4 py-3">{r.payload?.assessment_date ? new Date(r.payload.assessment_date).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-3">{r.payload?.method || "—"}</td>
                        <td className="px-4 py-3">{r.payload?.outcome || "—"}</td>
                        <td className="px-4 py-3">{r.payload?.assessor_name || "—"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openEditAssess(r)}
                            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
      {tab === "acknowledgement" && (
        <div className="space-y-4">
          {!showAckForm && (
            <button
              type="button"
              onClick={openNewAck}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" /> New Acknowledgement
            </button>
          )}

          {showAckForm && (
            <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-xs font-medium text-slate-200">
                  Employee Name *
                  <input
                    value={ackForm.employee_name}
                    onChange={(e) => setAckForm((p: any) => ({ ...p, employee_name: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200">
                  Date *
                  <input
                    type="date"
                    value={ackForm.date}
                    onChange={(e) => setAckForm((p: any) => ({ ...p, date: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs font-medium text-slate-200 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={ackForm.confirmation}
                    onChange={(e) => setAckForm((p: any) => ({ ...p, confirmation: e.target.checked }))}
                    className="mr-2"
                  />
                  I acknowledge that I have completed the Mass and Dimension Awareness presentation and assessment requirements.
                </label>
                <label className="text-xs font-medium text-slate-200 md:col-span-2">
                  Signature *
                  <input
                    value={ackForm.signature}
                    onChange={(e) => setAckForm((p: any) => ({ ...p, signature: e.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveAck(false)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => void saveAck(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAckForm(false); setEditingAck(null); }}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showAckForm && (
            ackRecords.length === 0 ? (
              <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">No acknowledgement records yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
                  <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
                    <tr>
                      <th className="px-4 py-3 text-left">Employee</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Acknowledged</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700 bg-slate-900/40">
                    {ackRecords.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-semibold">{r.payload?.employee_name || "—"}</td>
                        <td className="px-4 py-3">{r.payload?.date ? new Date(r.payload.date).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-3">{r.payload?.confirmation ? "Yes" : "No"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openEditAck(r)}
                            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
      {tab === "key" && isAdmin && (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
          <p className="text-xs text-slate-400">
            Assessor-only answer reference. Do not expose to drivers during active assessment.
          </p>
          <div className="space-y-3">
            {keyItems.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-white">{QUESTIONS[idx]}</p>
                <label className="mt-2 block text-xs font-medium text-slate-200">
                  Answer
                  <textarea
                    value={item.answer}
                    onChange={(e) => {
                      const next = [...keyItems];
                      next[idx] = { ...next[idx], answer: e.target.value };
                      setKeyItems(next);
                    }}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="mt-2 block text-xs font-medium text-slate-200">
                  Explanation
                  <textarea
                    value={item.explanation}
                    onChange={(e) => {
                      const next = [...keyItems];
                      next[idx] = { ...next[idx], explanation: e.target.value };
                      setKeyItems(next);
                    }}
                    rows={2}
                    className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void saveKey()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Answer Reference
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>
    </div>
  );
}