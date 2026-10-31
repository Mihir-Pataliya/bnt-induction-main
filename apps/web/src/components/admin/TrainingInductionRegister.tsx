import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, RotateCw, Search, Users } from "lucide-react";
import { api } from "../../lib/api";
import type { SessionState, TrainingInductionRegisterRecord } from "../../types";

const fieldClass = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30";
const labelClass = "block text-sm font-semibold text-slate-200";

function displayWorkerType(type: TrainingInductionRegisterRecord["workerType"]) {
  if (type === "employee") return "Employee";
  if (type === "subcontractor") return "Subcontractor";
  return "Worker type not recorded";
}

function displayRole(role: string) {
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayDate(value: string) {
  if (!value) return "Not completed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function TrainingInductionRegister({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [records, setRecords] = useState<TrainingInductionRegisterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.getTrainingInductionRegister(session)
      .then((result) => { if (active) setRecords(result); })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load existing training records.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [record.workerName, displayWorkerType(record.workerType), record.role, record.trainingTitle, record.completionDate, record.status]
        .some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [query, records]);

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Inductions and Training
          </button>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <Users className="h-4 w-4" aria-hidden="true" />
            COR / Inductions &amp; Training
          </p>
          <h2 className="text-2xl font-black">Employee/Subcontractor Register – Training and Induction</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Existing Safety Modules activity is shown here. Completed modules and started modules are read from the current training records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-wait disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-md border border-rose-300/40 px-3 py-2 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className={`${labelClass} sm:max-w-xl`}>
          Search register
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className={fieldClass} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, worker type, role, module, date, status…" />
          </span>
        </label>
        <p className="text-sm text-slate-400" aria-live="polite">
          {loading ? "Loading records…" : `${filteredRecords.length} ${filteredRecords.length === 1 ? "record" : "records"}${query ? " found" : ""}`}
        </p>
      </div>

      {loading && <p className="mt-5 text-sm text-slate-300" role="status">Loading existing training records…</p>}
      {!loading && !loadError && filteredRecords.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 p-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <p className="mt-3 font-semibold text-slate-200">{records.length ? "No matching records" : "No started or completed training modules"}</p>
          <p className="mt-1 text-sm text-slate-400">{records.length ? "Try another search." : "Safety Modules activity will appear here when an existing module is started or completed."}</p>
        </div>
      )}
      {!loading && filteredRecords.length > 0 && (
        <div className="mt-5 space-y-3">
          {filteredRecords.map((record) => {
            const expanded = viewingId === record.id;
            return (
              <article key={record.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-white">{record.workerName}</h3>
                      <span className="rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300">
                        {displayWorkerType(record.workerType)}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${record.status === "completed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
                        {record.status === "completed" ? "Completed" : "In progress"}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold text-slate-200">{record.trainingTitle}</p>
                    <p className="mt-1 text-sm text-slate-400">{displayRole(record.role)} <span aria-hidden="true">·</span> {displayDate(record.completionDate)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewingId(expanded ? null : record.id)}
                    aria-expanded={expanded}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    {expanded ? "Hide details" : "View"}
                  </button>
                </div>
                {expanded && (
                  <dl className="mt-4 grid gap-3 border-t border-slate-700 pt-4 text-sm sm:grid-cols-2">
                    <div><dt className="font-semibold text-slate-400">Name</dt><dd className="mt-1 text-slate-200">{record.workerName}</dd></div>
                    <div><dt className="font-semibold text-slate-400">Worker type</dt><dd className="mt-1 text-slate-200">{displayWorkerType(record.workerType)}</dd></div>
                    <div><dt className="font-semibold text-slate-400">Role</dt><dd className="mt-1 text-slate-200">{displayRole(record.role)}</dd></div>
                    <div><dt className="font-semibold text-slate-400">Module / training</dt><dd className="mt-1 text-slate-200">{record.trainingTitle}</dd></div>
                    <div><dt className="font-semibold text-slate-400">Completion date</dt><dd className="mt-1 text-slate-200">{displayDate(record.completionDate)}</dd></div>
                    <div><dt className="font-semibold text-slate-400">Status</dt><dd className="mt-1 text-slate-200">{record.status === "completed" ? "Completed" : "In progress"}</dd></div>
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
