import { useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { SessionState } from "../../types";

export function MassDimensionProcedureAdmin({ session: _session, onBack }: { session: SessionState; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-white">Operating Procedure — Mass and Dimension Limits</h3>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Mass and Dimension
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          Section 1: Weighing Methods
        </h4>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-200">
          <li>Pressure gauges or digital scales for air suspensions.</li>
          <li>Load Position Indicators for fixed loads.</li>
          <li>Safe Loading Plans for known-weight loads.</li>
          <li>Tanker loading methods.</li>
          <li>Container weight declarations and load distribution.</li>
        </ul>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          Section 2: Method for Loading Control
        </h4>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-200">
          <li>Driver supervision of loading.</li>
          <li>Checking weights and dimensions before departure.</li>
          <li>Communicating limits to third parties.</li>
          <li>Considering variations in loaded products.</li>
          <li>Recording accurate load information.</li>
        </ol>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          Section 3: Method of Loading Control During a Journey
        </h4>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-200">
          <li>Ongoing weight checks during the journey.</li>
          <li>Variations in commodity weights, including the listed precautions.</li>
        </ol>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          Section 4: Incorrect Weight
        </h4>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-200">
          <li>Incorrect weighing methods.</li>
          <li>Excess weight discovered before departure.</li>
          <li>Excess weight discovered after departure.</li>
        </ol>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6 space-y-4">
        <h4 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          Section 5: Verification and Calibration of Weighing Method
        </h4>
        <p className="text-sm text-slate-300">
          Verification and calibration explanation, acceptable calibration evidence,
          correcting inaccurate weighing methods, and documenting adjustments.
        </p>
      </div>
    </div>
  );
}