import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { SessionState } from "../../types";
import { MassDimensionChecklistAdmin } from "./MassDimensionChecklistAdmin";
import { MassDimensionProcedureAdmin } from "./MassDimensionProcedureAdmin";
import { MassDimensionCalibrationAdmin } from "./MassDimensionCalibrationAdmin";
import { MassDimensionPresentationAdmin } from "./MassDimensionPresentationAdmin";
import { MassDimensionAssessmentAdmin } from "./MassDimensionAssessmentAdmin";
import { MassDimensionAssessmentAnswersAdmin } from "./MassDimensionAssessmentAnswersAdmin";
import { MassDimensionComplianceStatusAdmin } from "./MassDimensionComplianceStatusAdmin";

export function MassAndDimensionAdmin({ session }: { session: SessionState }) {
  const [view, setView] = useState<"overview" | "checklist" | "procedure" | "calibration" | "presentation" | "assessment" | "answers" | "compliance">("overview");

  if (view === "checklist") {
    return <MassDimensionChecklistAdmin session={session} />;
  }
  if (view === "procedure") {
    return <MassDimensionProcedureAdmin session={session} onBack={() => setView("overview")} />;
  }
  if (view === "calibration") {
    return <MassDimensionCalibrationAdmin session={session} onBack={() => setView("overview")} />;
  }
  if (view === "presentation") {
    return <MassDimensionPresentationAdmin session={session} onBack={() => setView("overview")} onOpenAssessment={() => setView("assessment")} />;
  }
  if (view === "assessment") {
    return <MassDimensionAssessmentAdmin session={session} onBack={() => setView("overview")} />;
  }
  if (view === "compliance") {
    return <MassDimensionComplianceStatusAdmin session={session} onBack={() => setView("overview")} />;
  }
  if (view === "answers") {
    return <MassDimensionAssessmentAnswersAdmin session={session} onBack={() => setView("overview")} />;
  }

  const items = [
    { title: "Mass and Dimension Limits Checklist", description: "Checklist to verify mass and dimension limits are understood and applied.", action: () => setView("checklist") },
    { title: "Operating Procedure — Mass and Dimension Limits", description: "Operating procedure for managing mass and dimension limits.", action: () => setView("procedure") },
    { title: "Axle and Gross Weight Calibration Procedure and Record", description: "Procedure and record for axle and gross weight calibration.", action: () => setView("calibration") },
    { title: "Mass and Dimension Awareness Presentation", description: "Awareness presentation covering mass and dimension compliance.", action: () => setView("presentation") },
    { title: "Mass and Dimension Awareness Assessment/Acknowledgement", description: "Assessment and acknowledgement of mass and dimension awareness.", action: () => setView("assessment") },
    { title: "Mass and Dimension Awareness Assessment Answers", description: "Answers for the mass and dimension awareness assessment.", action: () => setView("answers") },
    { title: "Driver Training & Compliance Status", description: "Driver training, assessment, acknowledgement, and overall compliance status.", action: () => setView("compliance") }
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
            MASS AND DIMENSION
          </h3>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
            UPDATED ANNUALLY IN NOVEMBER
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          A person who drives or permits another person to drive a heavy vehicle is
          responsible for ensuring that the vehicle is loaded to the correct vehicle and
          axle weights in accordance with the Heavy Vehicle (Mass, Dimension and Loading)
          National Regulation before commencing the journey.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          This document will guide you through the process to ensure you comply with the
          Heavy Vehicle National Law (HVNL) Chain of Responsibility (CoR).
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          If you have Mass Management Accreditation (HVA or NHVAS) and are meeting all of
          your compliance requirements, you may not need to complete this section.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, idx) => (
          <button
            key={item.title}
            type="button"
            onClick={item.action}
            disabled={false}
            className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800"
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-400" />
              <h4 className="font-bold text-white">
                {idx + 1}. {item.title}
              </h4>
            </div>
            <p className="mt-2 text-sm text-slate-300">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}