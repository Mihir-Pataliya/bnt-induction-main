'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ClipboardCheck, Loader2, Plus, Save, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SessionState } from '../../types';
import { DEFAULT_RISK_CATEGORIES, RiskCategorySeed } from './riskManagementAssessmentData';

type RiskControl = { id: string; text: string; implemented: boolean };
type RiskCategory = {
  id: string;
  name: string;
  description: string;
  originalLikelihood: string;
  originalSeverity: string;
  originalRating: string;
  controls: RiskControl[];
  residualLikelihood: string;
  residualSeverity: string;
  residualRating: string;
  notes: string;
  isCustom: boolean;
};
type ActionItem = { id: string; action: string; responsible: string; dueDate: string; status: string };
type Approval = { companyName: string; acnAbn: string; name: string; role: string; signature: string; date: string; assessmentDate: string; reviewDate: string };
type HistoryEntry = { id: string; approvedAt: string; approvedBy: string; summary: string };
type AssessmentPayload = {
  title: string;
  version: number;
  status: string;
  categories: RiskCategory[];
  actionTimetable: ActionItem[];
  approval: Approval;
  history: HistoryEntry[];
  notes: string;
};
type AssessmentRow = { id: string; user_id: string; payload: AssessmentPayload; status: string; submitted_at: string };

const FORM_CODE = 'RMA';
const FORM_TITLE = 'Risk Management Assessment';

function uid() { return Math.random().toString(36).slice(2, 10); }

function seedCategories(): RiskCategory[] {
  return DEFAULT_RISK_CATEGORIES.map((c: RiskCategorySeed) => ({
    id: uid(),
    name: c.name,
    description: c.description,
    originalLikelihood: c.originalLikelihood,
    originalSeverity: c.originalSeverity,
    originalRating: c.originalRating,
    controls: c.controls.map((t: string) => ({ id: uid(), text: t, implemented: false })),
    residualLikelihood: c.residualLikelihood,
    residualSeverity: c.residualSeverity,
    residualRating: c.residualRating,
    notes: '',
    isCustom: false
  }));
}

function emptyApproval(): Approval {
  return { companyName: '', acnAbn: '', name: '', role: '', signature: '', date: '', assessmentDate: '', reviewDate: '' };
}

function emptyAssessment(): AssessmentPayload {
  return {
    title: FORM_TITLE,
    version: 1,
    status: 'Draft',
    categories: seedCategories(),
    actionTimetable: [],
    approval: emptyApproval(),
    history: [],
    notes: ''
  };
}

function rowToAssessment(row: any): AssessmentRow {
  const payload = { ...emptyAssessment(), ...(row.payload || {}) };
  return { id: row.id, user_id: row.user_id, payload, status: (payload.status ?? row.status ?? 'Draft'), submitted_at: row.submitted_at };
}

function inputClass(disabled = false) {
  return 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none ' + (disabled ? 'opacity-60 cursor-not-allowed' : '');
}

export function RiskManagementAssessment({ session, mode = 'admin' }: { session: SessionState; mode?: 'admin' | 'driver' }) {
  const isAdmin = mode === 'admin' && session.user.role === 'admin';
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<AssessmentPayload>(emptyAssessment());
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState('overview');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});

  const loadAssessments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase.from('cor_form_submissions').select('*').eq('form_code', FORM_CODE).order('submitted_at', { ascending: false });
      if (err) throw err;
      setAssessments((data || []).map(rowToAssessment));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load risk assessments.');
      setAssessments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAssessments(); }, [loadAssessments]);

  const selectedAssessment = useMemo(() => assessments.find((a) => a.id === selectedId) || null, [assessments, selectedId]);

  const openNew = () => {
    setSelectedId(null);
    setAssessment(emptyAssessment());
    setShowForm(true);
    setError('');
    setSuccess('');
  };

  const openExisting = (row: AssessmentRow) => {
    setSelectedId(row.id);
    setAssessment({ ...emptyAssessment(), ...row.payload, categories: row.payload.categories?.length ? row.payload.categories : seedCategories() });
    setShowForm(true);
    setError('');
    setSuccess('');
  };

  const updateCategory = (catId: string, patch: Partial<RiskCategory>) => {
    setAssessment((prev) => ({ ...prev, categories: prev.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c)) }));
  };

  const toggleControl = (catId: string, controlId: string) => {
    setAssessment((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === catId ? { ...c, controls: c.controls.map((ct) => (ct.id === controlId ? { ...ct, implemented: !ct.implemented } : ct)) } : c
      )
    }));
  };

  const addCustomRisk = () => {
    setAssessment((prev) => ({
      ...prev,
      categories: [...prev.categories, { id: uid(), name: 'Custom Risk', description: '', originalLikelihood: 'Major', originalSeverity: 'Likely', originalRating: 'Serious', controls: [], residualLikelihood: 'Major', residualSeverity: 'Unlikely', residualRating: 'Medium', notes: '', isCustom: true }]
    }));
  };

  const removeCategory = (catId: string) => {
    setAssessment((prev) => ({ ...prev, categories: prev.categories.filter((c) => c.id !== catId) }));
  };

  const addAction = () => {
    setAssessment((prev) => ({ ...prev, actionTimetable: [...prev.actionTimetable, { id: uid(), action: '', responsible: '', dueDate: '', status: 'Open' }] }));
  };

  const updateAction = (id: string, patch: Partial<ActionItem>) => {
    setAssessment((prev) => ({ ...prev, actionTimetable: prev.actionTimetable.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  };

  const removeAction = (id: string) => {
    setAssessment((prev) => ({ ...prev, actionTimetable: prev.actionTimetable.filter((a) => a.id !== id) }));
  };

  const save = async (newStatus?: string, nextAssessment?: AssessmentPayload) => {
    if (!isAdmin) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const base = nextAssessment || assessment;
      const desiredStatus = newStatus || base.status;
      const payload: AssessmentPayload = { ...base, status: desiredStatus, version: base.version || 1 };
      const dbStatus = desiredStatus === 'Approved' ? 'Submitted' : desiredStatus;
      if (selectedId) {
        const { data, error: err } = await supabase.from('cor_form_submissions').update({ payload, status: dbStatus }).eq('id', selectedId).select().single();
        if (err) throw err;
        const updated = rowToAssessment(data);
        setAssessments((prev) => prev.map((a) => (a.id === selectedId ? updated : a)));
        setAssessment(updated.payload);
        setSuccess('Risk Management Assessment saved.');
      } else {
        const { data, error: err } = await supabase.from('cor_form_submissions').insert({ user_id: session.user.id, form_code: FORM_CODE, form_title: FORM_TITLE, payload, status: dbStatus }).select().single();
        if (err) throw err;
        const created = rowToAssessment(data);
        setSelectedId(created.id);
        setAssessments((prev) => [created, ...prev]);
        setAssessment(created.payload);
        setSuccess('Risk Management Assessment saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save risk assessment.');
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!isAdmin) return;
    const updatedHistory: HistoryEntry[] = [...(assessment.history || []), { id: uid(), approvedAt: new Date().toISOString(), approvedBy: session.user.email, summary: 'Approved version ' + (assessment.version || 1) }];
    const next: AssessmentPayload = { ...assessment, status: 'Approved', history: updatedHistory, approval: { ...assessment.approval, date: assessment.approval.date || new Date().toISOString().slice(0, 10) } };
    setAssessment(next);
    await save('Approved', next);
  };

  const driverViewAssessment = useMemo(() => {
    const approved = assessments.find((a) => (a.status === 'Approved') || (a.payload.status === 'Approved'));
    return approved || null;
  }, [assessments]);

  const implementedCount = useMemo(() => assessment.categories.reduce((acc, c) => acc + c.controls.filter((ct) => ct.implemented).length, 0), [assessment.categories]);
  const totalControls = useMemo(() => assessment.categories.reduce((acc, c) => acc + c.controls.length, 0), [assessment.categories]);
  const openActions = useMemo(() => assessment.actionTimetable.filter((a) => a.status !== 'Closed').length, [assessment.actionTimetable]);

  if (!isAdmin && !showForm) {
    // driver read-only view
  }

  const renderReadOnly = (a: AssessmentRow | null) => {
    if (!a) return <p className='text-slate-300'>No risk management assessment available.</p>;
    const p = a.payload;
    return (
      <div className='space-y-4'>
        <div className='rounded-xl border border-slate-700 bg-slate-800/40 p-4'>
          <p className='text-sm text-slate-300'>Status: <span className='font-semibold text-white'>{p.status}</span></p>
          <p className='text-sm text-slate-300'>Version: {p.version}</p>
          <p className='text-sm text-slate-300'>Assessment date: {p.approval.assessmentDate || '-'}</p>
          <p className='text-sm text-slate-300'>Review date: {p.approval.reviewDate || '-'}</p>
        </div>
        <div className='space-y-3'>
          {p.categories.map((c) => (
            <div key={c.id} className='rounded-xl border border-slate-700 bg-slate-800/40 p-4'>
              <h3 className='text-base font-bold text-white'>{c.name}</h3>
              <p className='text-xs text-slate-400 mt-1'>{c.description}</p>
              <p className='text-xs text-slate-300 mt-2'>Original risk: {c.originalLikelihood} x {c.originalSeverity} = {c.originalRating}</p>
              <p className='text-xs text-slate-300'>Residual risk: {c.residualLikelihood} x {c.residualSeverity} = {c.residualRating}</p>
              <ul className='mt-2 space-y-1'>
                {c.controls.map((ct) => (
                  <li key={ct.id} className='text-xs text-slate-300'>
                    <span className={ct.implemented ? 'text-emerald-300' : 'text-slate-400'}>{ct.implemented ? '[x]' : '[ ]'} {ct.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {p.actionTimetable.length > 0 && (
          <div className='rounded-xl border border-slate-700 bg-slate-800/40 p-4'>
            <h3 className='text-base font-bold text-white'>Action Timetable</h3>
            <div className='mt-2 space-y-2'>
              {p.actionTimetable.map((a) => (
                <div key={a.id} className='text-xs text-slate-300'>
                  {a.action} - {a.responsible} - Due {a.dueDate || '-'} - {a.status}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isAdmin) {
    return (
      <section className='rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6'>
        <div className='flex items-center gap-2'>
          <ShieldCheck className='h-5 w-5 text-emerald-400' aria-hidden='true' />
          <h2 className='text-2xl font-black'>Risk Management Assessment</h2>
        </div>
        {loading ? <p className='text-slate-300'>Loading...</p> : renderReadOnly(driverViewAssessment)}
        {error && <p className='text-sm text-red-400'>{error}</p>}
      </section>
    );
  }

  return (
    <section className='rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex items-center gap-2'>
          <ShieldCheck className='h-5 w-5 text-emerald-400' aria-hidden='true' />
          <h2 className='text-2xl font-black'>Risk Management Assessment</h2>
        </div>
        <button type='button' onClick={openNew} className='inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/30'>
          <Plus className='h-4 w-4' aria-hidden='true' />
          New Assessment
        </button>
      </div>

      {!showForm && (
        <div className='space-y-3'>
          {loading && <p className='text-slate-300'>Loading...</p>}
          {error && <p className='text-sm text-red-400'>{error}</p>}
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='text-left text-slate-400'>
                  <th className='py-2'>Version</th>
                  <th className='py-2'>Status</th>
                  <th className='py-2'>Submitted</th>
                  <th className='py-2'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((a) => (
                  <tr key={a.id} className='border-t border-slate-700'>
                    <td className='py-2'>{a.payload.version}</td>
                    <td className='py-2'>{a.status}</td>
                    <td className='py-2'>{new Date(a.submitted_at).toLocaleString()}</td>
                    <td className='py-2'>
                      <button type='button' onClick={() => openExisting(a)} className='rounded-lg border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800'>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {assessments.length === 0 && !loading && <p className='text-slate-300'>No assessments yet.</p>}
        </div>
      )}

      {showForm && (
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <button type='button' onClick={() => setShowForm(false)} className='inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800'>
              <ArrowLeft className='h-4 w-4' aria-hidden='true' />
              Back to list
            </button>
            <div className='flex gap-2 ml-auto'>
              <button type='button' onClick={() => void save()} disabled={saving} className='inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60'>
                {saving ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' /> : <Save className='h-4 w-4' aria-hidden='true' />}
                Save
              </button>
              <button type='button' onClick={() => void approve()} disabled={saving} className='inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600/20 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/30 disabled:opacity-60'>
                <Send className='h-4 w-4' aria-hidden='true' />
                Approve
              </button>
            </div>
          </div>

          {error && <p className='text-sm text-red-400'>{error}</p>}
          {success && <p className='text-sm text-emerald-400'>{success}</p>}

          <div className='rounded-xl border border-slate-700 bg-slate-800/40 p-4'>
            <p className='text-sm text-slate-300'>Status: <span className='font-semibold text-white'>{assessment.status}</span> | Version: {assessment.version} | Controls implemented: {implementedCount}/{totalControls} | Open actions: {openActions}</p>
          </div>

          <div className='flex flex-wrap gap-2'>
            {['overview', 'categories', 'timetable', 'approval', 'history'].map((t) => (
              <button key={t} type='button' onClick={() => setTab(t)} className={'rounded-lg px-3 py-2 text-sm font-semibold transition-colors ' + (tab === t ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-600' : 'border border-slate-600 text-slate-200 hover:bg-slate-800')}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className='space-y-3'>
              <label className='block text-sm font-semibold text-slate-200'>Notes</label>
              <textarea className={inputClass()} rows={4} value={assessment.notes} onChange={(e) => setAssessment((p) => ({ ...p, notes: e.target.value }))} />
              <p className='text-xs text-slate-400'>Assessment date and review date are set in Approval tab.</p>
            </div>
          )}

          {tab === 'categories' && (
            <div className='space-y-3'>
              <div className='flex justify-end'>
                <button type='button' onClick={addCustomRisk} className='inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800'>
                  <Plus className='h-4 w-4' aria-hidden='true' />
                  Add Risk
                </button>
              </div>
              {assessment.categories.map((c) => (
                <div key={c.id} className='rounded-xl border border-slate-700 bg-slate-800/40'>
                  <button type='button' onClick={() => setExpandedCats((prev) => ({ ...prev, [c.id]: !prev[c.id] }))} className='flex w-full items-center justify-between px-4 py-3 text-left'>
                    <span className='font-bold text-white'>{c.name}</span>
                    <ChevronDown className={'h-5 w-5 text-emerald-300 transition-transform ' + (expandedCats[c.id] ? 'rotate-180' : '')} aria-hidden='true' />
                  </button>
                  {expandedCats[c.id] && (
                    <div className='space-y-3 border-t border-slate-700 px-4 py-4'>
                      {c.isCustom && (
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Risk name</label>
                          <input className={inputClass()} value={c.name} onChange={(e) => updateCategory(c.id, { name: e.target.value })} />
                        </div>
                      )}
                      <div>
                        <label className='block text-xs font-semibold text-slate-300'>Description</label>
                        <textarea className={inputClass()} rows={2} value={c.description} onChange={(e) => updateCategory(c.id, { description: e.target.value })} />
                      </div>
                      <div className='grid gap-3 md:grid-cols-3'>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Original likelihood</label>
                          <input className={inputClass()} value={c.originalLikelihood} onChange={(e) => updateCategory(c.id, { originalLikelihood: e.target.value })} />
                        </div>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Original severity</label>
                          <input className={inputClass()} value={c.originalSeverity} onChange={(e) => updateCategory(c.id, { originalSeverity: e.target.value })} />
                        </div>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Original rating</label>
                          <input className={inputClass()} value={c.originalRating} onChange={(e) => updateCategory(c.id, { originalRating: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <p className='text-xs font-semibold text-slate-300 mb-1'>Controls (tick implemented)</p>
                        <div className='space-y-1'>
                          {c.controls.map((ct) => (
                            <label key={ct.id} className='flex items-center gap-2 text-sm text-slate-200'>
                              <input type='checkbox' checked={ct.implemented} onChange={() => toggleControl(c.id, ct.id)} className='h-4 w-4' />
                              <span>{ct.text}</span>
                            </label>
                          ))}
                        </div>
                        {c.isCustom && (
                          <button type='button' onClick={() => { const text = prompt('New control'); if (text) updateCategory(c.id, { controls: [...c.controls, { id: uid(), text, implemented: false }] }); }} className='mt-2 text-xs text-emerald-300 hover:underline'>Add control</button>
                        )}
                      </div>
                      <div className='grid gap-3 md:grid-cols-3'>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Residual likelihood</label>
                          <input className={inputClass()} value={c.residualLikelihood} onChange={(e) => updateCategory(c.id, { residualLikelihood: e.target.value })} />
                        </div>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Residual severity</label>
                          <input className={inputClass()} value={c.residualSeverity} onChange={(e) => updateCategory(c.id, { residualSeverity: e.target.value })} />
                        </div>
                        <div>
                          <label className='block text-xs font-semibold text-slate-300'>Residual rating</label>
                          <input className={inputClass()} value={c.residualRating} onChange={(e) => updateCategory(c.id, { residualRating: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <label className='block text-xs font-semibold text-slate-300'>Notes</label>
                        <textarea className={inputClass()} rows={2} value={c.notes} onChange={(e) => updateCategory(c.id, { notes: e.target.value })} />
                      </div>
                      {c.isCustom && (
                        <button type='button' onClick={() => removeCategory(c.id)} className='inline-flex items-center gap-2 text-xs text-red-400 hover:underline'>
                          <Trash2 className='h-3 w-3' aria-hidden='true' />
                          Remove risk
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'timetable' && (
            <div className='space-y-3'>
              <div className='flex justify-end'>
                <button type='button' onClick={addAction} className='inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800'>
                  <Plus className='h-4 w-4' aria-hidden='true' />
                  Add Action
                </button>
              </div>
              {assessment.actionTimetable.map((a) => (
                <div key={a.id} className='grid gap-3 rounded-xl border border-slate-700 bg-slate-800/40 p-4 md:grid-cols-4'>
                  <div className='md:col-span-2'>
                    <label className='block text-xs font-semibold text-slate-300'>Required control / action</label>
                    <textarea className={inputClass()} rows={2} value={a.action} onChange={(e) => updateAction(a.id, { action: e.target.value })} />
                  </div>
                  <div>
                    <label className='block text-xs font-semibold text-slate-300'>Responsible person</label>
                    <input className={inputClass()} value={a.responsible} onChange={(e) => updateAction(a.id, { responsible: e.target.value })} />
                  </div>
                  <div>
                    <label className='block text-xs font-semibold text-slate-300'>Due date</label>
                    <input type='date' className={inputClass()} value={a.dueDate} onChange={(e) => updateAction(a.id, { dueDate: e.target.value })} />
                  </div>
                  <div>
                    <label className='block text-xs font-semibold text-slate-300'>Status</label>
                    <select className={inputClass()} value={a.status} onChange={(e) => updateAction(a.id, { status: e.target.value })}>
                      <option value='Open'>Open</option>
                      <option value='In Progress'>In Progress</option>
                      <option value='Closed'>Closed</option>
                    </select>
                  </div>
                  <div className='md:col-span-4 flex justify-end'>
                    <button type='button' onClick={() => removeAction(a.id)} className='text-xs text-red-400 hover:underline'>Remove</button>
                  </div>
                </div>
              ))}
              {assessment.actionTimetable.length === 0 && <p className='text-slate-300'>No actions yet.</p>}
            </div>
          )}

          {tab === 'approval' && (
            <div className='space-y-3'>
              <div className='grid gap-3 md:grid-cols-2'>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Company name</label>
                  <input className={inputClass()} value={assessment.approval.companyName} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, companyName: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>ACN/ABN</label>
                  <input className={inputClass()} value={assessment.approval.acnAbn} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, acnAbn: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Name</label>
                  <input className={inputClass()} value={assessment.approval.name} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, name: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Role</label>
                  <input className={inputClass()} value={assessment.approval.role} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, role: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Signature</label>
                  <input className={inputClass()} placeholder='Signature' value={assessment.approval.signature} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, signature: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Date</label>
                  <input type='date' className={inputClass()} value={assessment.approval.date} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, date: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Assessment date</label>
                  <input type='date' className={inputClass()} value={assessment.approval.assessmentDate} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, assessmentDate: e.target.value } }))} />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-slate-300'>Review date</label>
                  <input type='date' className={inputClass()} value={assessment.approval.reviewDate} onChange={(e) => setAssessment((p) => ({ ...p, approval: { ...p.approval, reviewDate: e.target.value } }))} />
                </div>
              </div>
              <p className='text-xs text-slate-400'>Approved by: Company Director or equivalent.</p>
            </div>
          )}

          {tab === 'history' && (
            <div className='space-y-2'>
              <h3 className='text-base font-bold text-white'>Assessment History</h3>
              {assessments.map((a) => (
                <div key={a.id} className='rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-sm text-slate-300'>
                  v{a.payload.version} - {a.status} - {new Date(a.submitted_at).toLocaleString()}
                </div>
              ))}
              <h4 className='text-sm font-bold text-white mt-4'>Approval History</h4>
              {(assessment.history || []).map((h) => (
                <div key={h.id} className='rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-sm text-slate-300'>
                  {h.summary} - {new Date(h.approvedAt).toLocaleString()} - {h.approvedBy}
                </div>
              ))}
              {(assessment.history || []).length === 0 && <p className='text-slate-300'>No approvals yet.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
