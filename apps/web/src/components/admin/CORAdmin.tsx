import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,

  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FileText,
  GraduationCap,
  HeartPulse,
  Network,
  ShieldCheck,
  UserRoundCheck,
  type LucideIcon
} from "lucide-react";
import { AnnualSystemReviewForm } from "./AnnualSystemReviewForm";
import { QuarterlyComplianceReviews } from "./QuarterlyComplianceReviews";
import { InductionHandout } from "./InductionHandout";
import { OrganisationalChartForm } from "./OrganisationalChartForm";
import { TrainingInductionRegister } from "./TrainingInductionRegister";
import { TrainingCalendar } from "./TrainingCalendar";
import { EmployeeInductionRecord } from "./EmployeeInductionRecord";
import { TrainingAcknowledgements } from "./TrainingAcknowledgements";
import { DriverSkillsKnowledgeReport } from "./DriverSkillsKnowledgeReport";
import { DriverMedicalFitnessReport } from "./DriverMedicalFitnessReport";
import { OperatingProcedureInductionsTraining } from "./OperatingProcedureInductionsTraining";
import { FatigueAwarenessAdmin } from "./FatigueAwarenessAdmin";
import { DistractionAwarenessAdmin } from "./DistractionAwarenessAdmin";
import { SpeedAwarenessAdmin } from "./SpeedAwarenessAdmin";
import { LoadingUnloadingRestraintAdmin } from "./LoadingUnloadingRestraintAdmin";
import { LicenceRegister } from "./LicenceRegister";
import { DriverFatigueWorkRecordAuditInformation } from "./DriverFatigueWorkRecordAuditInformation";
import { SafeDrivingPlanManager } from "./SafeDrivingPlanManager";
import { RiskManagementAssessment } from "./RiskManagementAssessment";
import { FatigueChecklist } from "./FatigueChecklist";
import { VehicleStandardsAdmin } from "./VehicleStandardsAdmin";
import { ThirdPartiesSubcontractorsAdmin } from "./ThirdPartiesSubcontractorsAdmin";
import { NonConformanceAdmin } from "./NonConformanceAdmin";
import { MassAndDimensionAdmin } from "./MassAndDimensionAdmin";

import { CORFormsAdmin } from "./CORFormsAdmin";


import { SessionState } from "../../types";
const trainingResources: {
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    title: "Organisational Chart",
    description: "Complete this chart to document your company structure.",
    icon: Network
  },
  {
    title: "Induction Handout",
    description:
      "Provide the specific job role handout to all employees to assist in inducting your employee into your Chain of Responsibility program. This document outlines their minimum roles and responsibilities under Chain of Responsibility, what forms to complete and what resources or documents to provide them.",
    icon: FileText
  },
  {
    title: "Employee/Contractor Induction Record",
    description:
      "View and complete induction records for employees and subcontractors, including checklist progress, required documents, acknowledgements and signatures.",
    icon: UserRoundCheck
  },
  {
    title: "Employee/Subcontractor Training Calendar",
    description:
      "Complete this document any time you complete training with your employees. For the ones already documented just tick the box when it’s completed. For any other internal training completed, ensure to write it on the register.",
    icon: CalendarDays
  },
  {
    title: "Employee/Contractor Induction Record",
    description:
      "Complete this record with all employees or contractors who require to be inducted into your Chain of Responsibility Policies and Procedures. Ensure the relevant sections are completed and any documentation is attached and retained.",
    icon: UserRoundCheck
  },
  {
    title: "Training Acknowledgement",
    description:
      "Complete this document in lieu of the individual training assessment. This form is used to confirm the employee has watched/read an awareness presentation.",
    icon: FileCheck2
  },
  {
    title: "Driver Skills and Knowledge Assessment Report",
    description:
      "The Driver Skills and Knowledge Assessment Report documents Driver’s ability to complete activities such as completing pre-drives and ensure they can operate a heavy vehicle safely. This report should be completed when a Driver is first employed.",
    icon: ClipboardCheck
  },
  {
    title: "Assessing Fitness to Drive (Driver Medical)",
    description:
      "The Assessing Fitness to Drive (Medical) is the industry recognised medical. This medical should be utilised if you wish to obtain medical from Drivers, as a pre-employment requirement, if there has been a medical episode or if you have concerns about a Driver’s health.",
    icon: HeartPulse
  },
  {
    title: "Operating Procedure – Inductions and Training",
    description:
      "Our documented procedure detailing our Induction and Training requirements.",
    icon: GraduationCap
  }
];

type CORView = "overview" | "annual-review" | "induction-handout" | "training-induction-register" | "training-calendar" | "induction-record" | "training-acknowledgements" | "driver-skills-knowledge-report" | "driver-medical-fitness-report" | "operating-procedure-inductions-training" | "cor-forms" | number;

export function CORAdmin({ session }: { session: SessionState }) {
  const [currentView, setCurrentView] = useState<CORView>("overview");
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const [fatigueExpanded, setFatigueExpanded] = useState(false);
  const [distractionExpanded, setDistractionExpanded] = useState(false);
  const [speedExpanded, setSpeedExpanded] = useState(false);
  const [vehicleStandardsExpanded, setVehicleStandardsExpanded] = useState(false);
  const [thirdPartiesExpanded, setThirdPartiesExpanded] = useState(false);
const [nonConformanceExpanded, setNonConformanceExpanded] = useState(false);
const [massAndDimensionExpanded, setMassAndDimensionExpanded] = useState(false);
  const [loadingUnloadingRestraintExpanded, setLoadingUnloadingRestraintExpanded] = useState(false);
const [licenceRegisterExpanded, setLicenceRegisterExpanded] = useState(false);
  const [workRecordAuditExpanded, setWorkRecordAuditExpanded] = useState(false);
  const [safeDrivingPlansExpanded, setSafeDrivingPlansExpanded] = useState(false);
  const [riskManagementExpanded, setRiskManagementExpanded] = useState(false);
  const [fatigueChecklistExpanded, setFatigueChecklistExpanded] = useState(false);
  const [annualReviewExpanded, setAnnualReviewExpanded] = useState(false);
  const [quarterlyReviewExpanded, setQuarterlyReviewExpanded] = useState(false);

  if (currentView === 0) {
    return <OrganisationalChartForm session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "annual-review") {
    return (
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black">
              <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
              Chain of Responsibility
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Annual System Review — Due December. Complete your COR compliance review below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView("overview")}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Inductions and Training
          </button>
        </div>
        <AnnualSystemReviewForm session={session} />
      </section>
    );
  }

  if (currentView === "induction-handout") {
    return <InductionHandout session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "training-induction-register") {
    return <TrainingInductionRegister session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "training-calendar") {
    return <TrainingCalendar session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "induction-record") {
    return <EmployeeInductionRecord session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "training-acknowledgements") {
    return <TrainingAcknowledgements session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "driver-skills-knowledge-report") {
    return <DriverSkillsKnowledgeReport session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "driver-medical-fitness-report") {
    return <DriverMedicalFitnessReport session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "operating-procedure-inductions-training") {
    return <OperatingProcedureInductionsTraining session={session} onBack={() => setCurrentView("overview")} />;
  }

  if (currentView === "cor-forms") {
    return (
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-black">COR Form Submissions</h2>
          <button type="button" onClick={() => setCurrentView("overview")} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800">
            Back to Inductions and Training
          </button>
        </div>
        <CORFormsAdmin session={session} />
      </section>
    );
  }


  if (typeof currentView === "number") {
    const resource = trainingResources[currentView];
    const ResourceIcon = resource.icon;

    return (
      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
        <button
          type="button"
          onClick={() => setCurrentView("overview")}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Inductions and Training
        </button>
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 md:p-8">
          <ResourceIcon
            className="mb-4 h-8 w-8 text-emerald-400"
            aria-hidden="true"
          />
          <h2 className="text-xl font-bold text-white">{resource.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            {resource.description}
          </p>
          <span className="mt-6 inline-flex rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
            Coming Soon
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Chain of Responsibility
          </p>
          <h2 className="text-xl font-black text-white">
            Inductions and Training — Updated Annually in February
          </h2>
        </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setCurrentView("cor-forms")}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          COR Form Submissions
        </button>
      </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
          DEFINITION
        </h3>
        <div className="mt-3 space-y-4 text-sm leading-relaxed text-slate-300">
          <p>
            The Heavy Vehicle National Law (HVNL) imposes a primary duty to ensure safe and compliant transport activities (sections 26C and 26D). Businesses that use heavy vehicles are required to develop, implement and document operating policies and procedures. They must also ensure that all parties across the business understands their specific duties and obligations under the Chain of Responsibility (CoR) law.
          </p>
          <p>
            You are required to complete training across the business as this demonstrates all relevant employees have the knowledge and skills to complete their allocated tasks safely and within the law.
          </p>
          <p>
            All employees must understand that it is unacceptable to directly or indirectly cause or encourage, a driver or another party in the supply chain to breach the HVNL.
          </p>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setTopicsExpanded((expanded) => !expanded)}
          aria-expanded={topicsExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Inductions &amp; Training</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${topicsExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {topicsExpanded && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {trainingResources.map((resource, index) => {
              const ResourceIcon = resource.icon;

              return (
                <button
                  key={`${resource.title}-${index}`}
                  type="button"
                  onClick={() => setCurrentView(index === 1 ? "induction-handout" : index === 2 ? "training-induction-register" : index === 3 ? "training-calendar" : index === 4 ? "induction-record" : index === 5 ? "training-acknowledgements" : index === 6 ? "driver-skills-knowledge-report" : index === 7 ? "driver-medical-fitness-report" : index === 8 ? "operating-procedure-inductions-training" : index)}
                  aria-label={index <= 9 ? resource.title : `${resource.title} — Coming Soon`}
                  className="group flex h-full min-h-52 flex-col rounded-xl border border-slate-700 bg-slate-800/50 p-5 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
                    <ResourceIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-base font-bold leading-snug text-white">
                    {index + 1}. {resource.title}
                  </span>
                  <span className="mt-2 flex-1 text-sm leading-relaxed text-slate-300">
                    {resource.description}
                  </span>
                  <span className="mt-4 inline-flex w-fit rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                    {index === 0 ? "Open Chart" : index === 1 ? "Open Handout" : index === 2 ? "Open Register" : index === 3 ? "Open Calendar" : index === 4 ? "Open Record" : index === 5 ? "Open Acknowledgements" : index === 6 ? "Open Report" : index === 7 ? "Open Report" : index === 8 ? "Open PDF" : "Coming Soon"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setFatigueExpanded((expanded) => !expanded)}
          aria-expanded={fatigueExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Fatigue Awareness</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${fatigueExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {fatigueExpanded && <FatigueAwarenessAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setDistractionExpanded((expanded) => !expanded)}
          aria-expanded={distractionExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Distraction Awareness</span>
          <ChevronDown
            className={"h-5 w-5 text-emerald-300 transition-transform " + (distractionExpanded ? "rotate-180" : "")}
            aria-hidden="true"
          />
        </button>
        {distractionExpanded && <DistractionAwarenessAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setSpeedExpanded((expanded) => !expanded)}
          aria-expanded={speedExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Speed Awareness</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${speedExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {speedExpanded && <SpeedAwarenessAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setLoadingUnloadingRestraintExpanded((expanded) => !expanded)}
          aria-expanded={loadingUnloadingRestraintExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Loading, Unloading & Restraint Compliance</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${loadingUnloadingRestraintExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {loadingUnloadingRestraintExpanded && <LoadingUnloadingRestraintAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setWorkRecordAuditExpanded((expanded) => !expanded)}
          aria-expanded={workRecordAuditExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Driver Fatigue Work Record Audit Information</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${workRecordAuditExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {workRecordAuditExpanded && <DriverFatigueWorkRecordAuditInformation session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setSafeDrivingPlansExpanded((expanded) => !expanded)}
          aria-expanded={safeDrivingPlansExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Safe Driving Plans</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${safeDrivingPlansExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {safeDrivingPlansExpanded && <SafeDrivingPlanManager session={session} mode="admin" />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setRiskManagementExpanded((expanded) => !expanded)}
          aria-expanded={riskManagementExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Risk Management Assessment</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${riskManagementExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {riskManagementExpanded && <RiskManagementAssessment session={session} mode="admin" />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setLicenceRegisterExpanded((expanded) => !expanded)}
          aria-expanded={licenceRegisterExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Licence Register</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${licenceRegisterExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {licenceRegisterExpanded && <LicenceRegister session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setFatigueChecklistExpanded((expanded) => !expanded)}
          aria-expanded={fatigueChecklistExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Fatigue Checklist</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${fatigueChecklistExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {fatigueChecklistExpanded && <FatigueChecklist session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setVehicleStandardsExpanded((expanded) => !expanded)}
          aria-expanded={vehicleStandardsExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Vehicle Standards</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${vehicleStandardsExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {vehicleStandardsExpanded && <VehicleStandardsAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setThirdPartiesExpanded((expanded) => !expanded)}
          aria-expanded={thirdPartiesExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Third Parties/Subcontractors</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${thirdPartiesExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {thirdPartiesExpanded && <ThirdPartiesSubcontractorsAdmin session={session} />}
      </div>
      <div>
        <button
          type="button"
          onClick={() => setNonConformanceExpanded((expanded) => !expanded)}
          aria-expanded={nonConformanceExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Non-Conformance</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${nonConformanceExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {nonConformanceExpanded && <NonConformanceAdmin session={session} />}
      </div>
      <div>
        <button
          type="button"
          onClick={() => setMassAndDimensionExpanded((expanded) => !expanded)}
          aria-expanded={massAndDimensionExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Mass and Dimension</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${massAndDimensionExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {massAndDimensionExpanded && <MassAndDimensionAdmin session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setQuarterlyReviewExpanded((expanded) => !expanded)}
          aria-expanded={quarterlyReviewExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Quarterly Compliance Review</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${quarterlyReviewExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {quarterlyReviewExpanded && <QuarterlyComplianceReviews session={session} />}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAnnualReviewExpanded((expanded) => !expanded)}
          aria-expanded={annualReviewExpanded}
          className="mb-4 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="text-2xl font-black text-white">Annual System Review</span>
          <ChevronDown
            className={`h-5 w-5 text-emerald-300 transition-transform ${annualReviewExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {annualReviewExpanded && <AnnualSystemReviewForm session={session} />}
      </div>
    </section>
  );
}