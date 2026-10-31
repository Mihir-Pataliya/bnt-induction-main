import { useState } from "react";
import { ArrowLeft, ClipboardList, FileText, ShieldCheck } from "lucide-react";
import { SessionState } from "../../types";
import { NonConformanceRegister } from "./NonConformanceRegister";
import { NcrForm } from "./NcrForm";
import { WhsIncidentForm } from "./WhsIncidentForm";

export function NonConformanceAdmin({ session }: { session: SessionState }) {
  const [view, setView] = useState<"overview" | "register" | "ncr" | "whs">("overview");

  if (view === "register") {
    return <NonConformanceRegister session={session} onBack={() => setView("overview")} onCreateReport={(type) => { setView(type === "NCR" ? "ncr" : "whs"); }} />;
  }
  if (view === "ncr") {
    return <NcrForm session={session} onBack={() => setView("overview")} />;
  }
  if (view === "whs") {
    return <WhsIncidentForm session={session} onBack={() => setView("overview")} />;
  }

  const items = [
    {
      title: "Non-Conformance Register",
      description:
        "A register of all identified non-conformances, including the date raised, description, responsible person, corrective action, and close-out status.",
      action: () => setView("register")
    },
    {
      title: "Non-Conformance Report (NCR)",
      description:
        "A formal report used to document a non-conformance, its root cause, immediate actions taken, and the corrective action plan.",
      action: () => setView("ncr")
    },
    {
      title: "WHS Incident Report",
      description:
        "A report used to record work health and safety incidents, hazards, and near misses, including details of the event, injuries, and follow-up actions.",
      action: () => setView("whs")
    }
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            Non-Conformance
          </h3>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
            UPDATED ANNUALLY IN OCTOBER
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          <strong>Definition:</strong> A non-conformance is any deviation from, or failure to
          meet, the requirements of the BNT Logistics Work Health &amp; Safety and Chain of
          Responsibility Management System, applicable procedures, or legislative
          obligations. Non-conformances are recorded, investigated, and managed through
          corrective action.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={item.action}
            disabled={item.action === undefined}
            className={`rounded-xl border border-slate-700 bg-slate-800/50 p-5 text-left transition-colors ${item.action !== undefined ? "hover:border-emerald-500/50 hover:bg-slate-800" : "opacity-80 cursor-default"}`}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-400" />
              <h4 className="font-bold text-white">{item.title}</h4>
            </div>
            <p className="mt-2 text-sm text-slate-300">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}