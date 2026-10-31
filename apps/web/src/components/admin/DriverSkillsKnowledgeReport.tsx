import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Printer, RotateCw, Search, Users, X } from "lucide-react";
import { api } from "../../lib/api";
import type { DriverSkillsKnowledgeReportRecord, SessionState } from "../../types";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30";
const labelClass = "block text-sm font-semibold text-slate-200";

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function displayDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayWorkerType(type: DriverSkillsKnowledgeReportRecord["workerType"]) {
  if (type === "contractor") return "Contractor";
  if (type === "employee") return "Employee";
  return "Worker";
}

function displayRole(role: string) {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function DriverSkillsKnowledgeReport({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<DriverSkillsKnowledgeReportRecord[]>([]);
  const [selected, setSelected] = useState<DriverSkillsKnowledgeReportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.getDriverSkillsKnowledgeReport(session)
      .then((result) => {
        if (active) {
          setRecords(result);
          setSelected((current) => (current ? result.find((entry: any) => entry.id === current.id) ?? null : null));
        }
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load driver skills and knowledge report.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (statusFilter !== "all" && record.overallStatus !== statusFilter) return false;
      if (!needle) return true;
      return [
        record.workerName,
        displayWorkerType(record.workerType),
        record.role,
        record.depotLocation ?? "",
        record.overallStatus,
        String(record.safetyModulesCompleted),
        String(record.quizLatestScore ?? "")
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [records, query, statusFilter]);

  const summary = useMemo(() => {
    const total = records.length;
    const complete = records.filter((r) => r.overallStatus === "Complete").length;
    const inProgress = records.filter((r) => r.overallStatus === "In progress").length;
    const notStarted = records.filter((r) => r.overallStatus === "Not started").length;
    const quizPassed = records.filter((r) => r.quizEverPassed).length;
    const quizAttempted = records.filter((r) => r.quizAttempts > 0).length;
    const safetyComplete = records.filter((r) => r.safetyModulesAssigned > 0 && r.safetyModulesCompleted === r.safetyModulesAssigned).length;
    const noModules = records.filter((r) => r.overallStatus === "No modules assigned").length;
    return { total, complete, inProgress, notStarted, quizPassed, quizAttempted, safetyComplete, noModules };
  }, [records]);

  function viewEntry(entry: DriverSkillsKnowledgeReportRecord) {
    setSelected(entry);
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Inductions and Training
          </button>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-emerald-300">COR / Inductions &amp; Training</p>
          <h2 className="text-2xl font-black">Driver Skills and Knowledge Assessment Report</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Review each driver’s safety module activity, knowledge quiz results, and assessment status. Practical and medical assessment data are not stored in the system and are shown as “Not assessed”.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print / PDF
          </button>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-wait disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>
      </div>
      {loadError && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-md border border-rose-300/40 px-3 py-2 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Drivers</p>
          <p className="mt-2 text-2xl font-black text-white">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Complete</p>
          <p className="mt-2 text-2xl font-black text-emerald-200">{summary.complete}</p>
        </div>
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">In progress</p>
          <p className="mt-2 text-2xl font-black text-amber-200">{summary.inProgress}</p>
        </div>
        <div className="rounded-xl border border-slate-600 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Not started</p>
          <p className="mt-2 text-2xl font-black text-slate-200">{summary.notStarted}</p>
        </div>
        <div className="rounded-xl border border-slate-600 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">No modules assigned</p>
          <p className="mt-2 text-2xl font-black text-slate-200">{summary.noModules}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quiz passed</p>
          <p className="mt-2 text-2xl font-black text-white">{summary.quizPassed}<span className="text-sm font-semibold text-slate-400"> / {summary.quizAttempted} attempted</span></p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Safety modules complete</p>
          <p className="mt-2 text-2xl font-black text-white">{summary.safetyComplete}<span className="text-sm font-semibold text-slate-400"> / {summary.total}</span></p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className={`${labelClass} sm:max-w-xl`}>
          Search report
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              className={`${inputClass} pl-9`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Driver, role, depot, status…"
            />
          </span>
        </label>
        <label className={`${labelClass} sm:w-56`}>
          Overall status
          <select
            className={inputClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="Complete">Complete</option>
            <option value="In progress">In progress</option>
            <option value="Not started">Not started</option>
            <option value="No modules assigned">No modules assigned</option>
          </select>
        </label>
      </div>

      <p className="mt-3 text-sm text-slate-400" aria-live="polite">
        {loading ? "Loading records…" : `${filteredRecords.length} ${filteredRecords.length === 1 ? "record" : "records"}${query || statusFilter !== "all" ? " found" : ""}`}
      </p>

      {loading && (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
          <RotateCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading driver report…
        </div>
      )}

      {!loading && !loadError && filteredRecords.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-slate-600 bg-slate-800/40 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-semibold text-slate-200">{records.length ? "No matching records" : "No driver records found"}</p>
          <p className="mt-1 text-sm text-slate-400">{records.length ? "Try another search or filter." : "Driver records will appear here once profiles exist."}</p>
        </div>
      )}
      {!loading && filteredRecords.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-700 text-sm">
            <thead className="bg-slate-800/80 text-left text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 font-bold">Driver</th>
                <th className="px-4 py-3 font-bold">Depot</th>
                <th className="px-4 py-3 font-bold">Safety modules</th>
                <th className="px-4 py-3 font-bold">Knowledge quiz</th>
                <th className="px-4 py-3 font-bold">Practical</th>
                <th className="px-4 py-3 font-bold">Medical</th>
                <th className="px-4 py-3 font-bold">Overall</th>
                <th className="px-4 py-3 text-right font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredRecords.map((record) => {
                const complete = record.overallStatus === "Complete";
                return (
                  <tr key={record.id} className="bg-slate-900/50 hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-white">{record.workerName}</span>
                      <span className="mt-1 block text-xs text-slate-400">{displayWorkerType(record.workerType)} · {displayRole(record.role)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{record.depotLocation ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {record.safetyModulesAssigned === 0
                        ? <span className="block font-medium text-amber-200">No modules assigned</span>
                        : <>
                            <span className="block font-medium text-slate-100">{record.safetyModulesCompleted}/{record.safetyModulesAssigned}</span>
                            <span className="mt-1 block text-xs text-slate-400">Last {displayDate(record.safetyLastActivityDate)}</span>
                          </>}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="block font-medium text-slate-100">
                        {record.quizLatestScore == null ? "Not attempted" : `${record.quizLatestScore}%`}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        Latest: {record.quizLatestPassed === true ? "Passed" : record.quizLatestPassed === false ? "Failed" : "—"} · Ever passed: {record.quizEverPassed ? "Yes" : "No"} · {record.quizAttempts} attempt{record.quizAttempts === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{record.practicalAssessmentStatus}</td>
                    <td className="px-4 py-3 text-slate-400">{record.medicalAssessmentStatus}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${complete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : record.overallStatus === "In progress" || record.overallStatus === "No modules assigned" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-slate-600 bg-slate-900 text-slate-300"}`}>
                        {complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
                        {record.overallStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => viewEntry(record)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="skills-report-title"
            className="my-auto w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Driver Skills and Knowledge Assessment Report</p>
                <h3 id="skills-report-title" className="mt-1 text-xl font-black">{selected.workerName}</h3>
                <p className="mt-1 text-sm text-slate-300">{displayWorkerType(selected.workerType)} · {displayRole(selected.role)} · {selected.depotLocation ?? "Depot not recorded"}</p>
              </div>
              <button type="button" aria-label="Close report" onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Safety modules</p>
                <p className="mt-2 text-lg font-bold text-white">{selected.safetyModulesCompleted} of {selected.safetyModulesAssigned} completed</p>
                <p className="mt-1 text-sm text-slate-400">
                  {selected.safetyModulesAssigned === 0
                    ? "No safety modules are currently assigned to this driver."
                    : `${selected.safetyModulesInProgress} in progress · Last activity ${displayDate(selected.safetyLastActivityDate)}`}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Knowledge quiz</p>
                <p className="mt-2 text-lg font-bold text-white">{selected.quizLatestScore == null ? "Not attempted" : `${selected.quizLatestScore}% latest`}</p>
                <p className="mt-1 text-sm text-slate-400">
                  Best {selected.quizBestScore == null ? "—" : `${selected.quizBestScore}%`} · {selected.quizAttempts} attempt{selected.quizAttempts === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Latest attempt: {selected.quizLatestPassed === true ? "Passed" : selected.quizLatestPassed === false ? "Failed" : "No result"} · Ever passed: {selected.quizEverPassed ? "Yes" : "No"}
                </p>
                <p className="mt-1 text-sm text-slate-400">Last attempt {displayDate(selected.quizLastAttemptDate)}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Practical skills assessment</p>
                <p className="mt-2 text-lg font-bold text-slate-300">{selected.practicalAssessmentStatus}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Medical / fitness to drive</p>
                <p className="mt-2 text-lg font-bold text-slate-300">{selected.medicalAssessmentStatus}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Overall status</p>
              <p className="mt-2 text-lg font-bold text-white">{selected.overallStatus}</p>
              <p className="mt-1 text-sm text-slate-400">Last assessment activity {displayDate(selected.lastAssessmentDate)}</p>
            </div>
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Safety module status</p>
              {selected.safetyModuleStatuses.length ? (
                <ul className="mt-3 space-y-2">
                  {selected.safetyModuleStatuses.map((module) => (
                    <li key={module.sectionId} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-2 text-sm last:border-0 last:pb-0">
                      <span className="text-slate-100">{module.title}</span>
                      <span className={module.status === "completed" ? "text-emerald-300" : module.status === "in_progress" ? "text-amber-200" : "text-slate-400"}>
                        {module.status.replace("_", " ")}
                        {module.completedAt ? ` · ${displayDate(module.completedAt)}` : module.startedAt ? ` · Started ${displayDate(module.startedAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-amber-200">No modules assigned.</p>}
            </div>
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quiz attempt history</p>
              {selected.quizAttemptHistory.length ? (
                <ol className="mt-3 space-y-3">
                  {selected.quizAttemptHistory.map((attempt, index) => (
                    <li key={attempt.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="font-semibold text-slate-100">
                          Attempt {selected.quizAttemptHistory.length - index} · {attempt.score == null ? "Score unavailable" : `${attempt.score}%`}
                        </span>
                        <span className={attempt.passed === true ? "text-emerald-300" : attempt.passed === false ? "text-rose-300" : "text-slate-400"}>
                          {attempt.passed === true ? "Passed" : attempt.passed === false ? "Failed" : "Result unavailable"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{displayDateTime(attempt.attemptedAt)}</p>
                      {(attempt.failedCritical != null || attempt.criticalQuestionsAsked != null) && (
                        <p className="mt-2 text-xs text-slate-400">
                          Critical questions: {attempt.criticalQuestionsAsked ?? "—"} · Critical error: {attempt.failedCritical == null ? "—" : attempt.failedCritical ? "Yes" : "No"}
                        </p>
                      )}
                      {attempt.categoryScores && Object.keys(attempt.categoryScores).length > 0 && (
                        <ul className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                          {Object.entries(attempt.categoryScores).map(([category, score]) => (
                            <li key={category}>{category}: {score}%</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-2 text-sm text-slate-400">No quiz attempts recorded.</p>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}