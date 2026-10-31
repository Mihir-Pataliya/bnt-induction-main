import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Eye, RotateCw, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import type { SessionState, TrainingAcknowledgementEntry } from "../../types";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30";
const labelClass = "block text-sm font-semibold text-slate-200";

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function displayWorkerType(type: TrainingAcknowledgementEntry["workerType"]) {
  if (type === "contractor") return "Contractor";
  if (type === "employee") return "Employee";
  return "Worker";
}

export function TrainingAcknowledgements({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [entries, setEntries] = useState<TrainingAcknowledgementEntry[]>([]);
  const [selected, setSelected] = useState<TrainingAcknowledgementEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.getTrainingAcknowledgements(session)
      .then((result) => {
        if (active) {
          setEntries(result);
          setSelected((current) => current ? result.find((entry: any) => entry.id === current.id) ?? null : null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load training acknowledgements.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.workerName, displayWorkerType(entry.workerType), entry.role, entry.presentationTitle, entry.acknowledgementStatus]
        .some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [entries, query]);

  function viewEntry(entry: TrainingAcknowledgementEntry) {
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
          <h2 className="text-2xl font-black">Training Acknowledgement</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Review each driver’s acknowledgement and signature for a specific Step 3 safety presentation. Drivers submit these themselves;
            this page is read-only and separate from the general Legal Sign-Off.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-wait disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Refresh
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
          Search acknowledgements
          <span className="relative mt-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              className={`${inputClass} pl-9`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Worker, role, presentation, status…"
            />
          </span>
        </label>
        <p className="text-sm text-slate-400" aria-live="polite">
          {loading ? "Loading records…" : `${filteredEntries.length} ${filteredEntries.length === 1 ? "record" : "records"}${query ? " found" : ""}`}
        </p>
      </div>

      {loading && <p className="mt-5 text-sm text-slate-300" role="status">Loading Step 3 activity and saved acknowledgements…</p>}
      {!loading && !loadError && filteredEntries.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 p-8 text-center">
          <p className="font-semibold text-slate-200">No safety presentation activity found</p>
          <p className="mt-1 text-sm text-slate-400">
            A worker/presentation row appears after the worker has a real Step 3 start or completion record.
          </p>
        </div>
      )}
      {!loading && !loadError && filteredEntries.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead className="bg-slate-800 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 font-bold">Worker</th>
                <th className="px-4 py-3 font-bold">Safety presentation</th>
                <th className="px-4 py-3 font-bold">Acknowledgement</th>
                <th className="px-4 py-3 font-bold">Acknowledgement date</th>
                <th className="px-4 py-3 font-bold">Signature</th>
                <th className="px-4 py-3 text-right font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredEntries.map((entry: any) => {
                const complete = entry.acknowledgementStatus === "completed";
                return (
                  <tr key={entry.id} className="bg-slate-900/50 hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-white">{entry.workerName}</span>
                      <span className="mt-1 block text-xs text-slate-400">{displayWorkerType(entry.workerType)} · {entry.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-slate-100">{entry.presentationTitle}</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {entry.moduleStatus === "completed" ? "Step 3 completed" : entry.moduleStatus === "in_progress" ? "Step 3 in progress" : "Step 3 activity unavailable"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${complete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
                        {complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
                        {complete ? "Completed" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{displayDate(entry.acknowledgedAt)}</td>
                    <td className="px-4 py-3">
                      {entry.signature && entry.signedAt
                        ? <span className="font-semibold text-emerald-200">Signed</span>
                        : <span className="text-slate-400">Not signed</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => viewEntry(entry)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        Pending means Step 3 activity exists but the driver has not submitted an acknowledgement. The driver must complete the acknowledgement in Driver Dashboard → Induction → Step 3.
      </p>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-ack-title"
            className="my-auto w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Training Acknowledgement</p>
                <h3 id="training-ack-title" className="mt-1 text-xl font-black">{selected.workerName}</h3>
                <p className="mt-1 text-sm text-slate-300">{selected.presentationTitle}</p>
              </div>
              <button type="button" aria-label="Close acknowledgement" onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Step 3 activity</p>
              <p className="mt-1 font-semibold text-slate-100">
                {selected.moduleStatus === "completed" ? "Presentation completed" : selected.moduleStatus === "in_progress" ? "Presentation started; completion not recorded" : "No current Step 3 activity record"}
              </p>
              {selected.moduleCompletedAt && <p className="mt-1 text-sm text-slate-400">Completed {displayDate(selected.moduleCompletedAt)}</p>}
            </div>

            {selected.acknowledgementStatus === "completed" ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Saved acknowledgement</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-100">{selected.acknowledgementStatement}</p>
                  <p className="mt-2 text-sm text-slate-300">Acknowledged {displayDate(selected.acknowledgedAt)}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Associated worker signature</p>
                  {selected.signature?.startsWith("data:image/")
                    ? <img src={selected.signature} alt={`${selected.workerName}’s signature`} className="mt-3 max-h-40 max-w-full rounded bg-white p-2" />
                    : <p className="mt-2 break-words text-lg font-semibold text-white">{selected.signature}</p>}
                  <p className="mt-1 text-sm text-slate-400">
                    {selected.signedAt ? `Signed ${displayDate(selected.signedAt)}` : "Signature date not recorded"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">No acknowledgement has been recorded.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
