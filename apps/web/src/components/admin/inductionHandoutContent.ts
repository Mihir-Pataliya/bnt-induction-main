export interface HandoutTopic {
  title: string;
  items: string[];
}

export interface HandoutRole {
  name: string;
  sourceRole: string;
  description: string | null;
  responsibilities: HandoutTopic[];
  forms: string[];
  formsPending?: boolean;
  resources: string[];
}

export const inductionHandoutRoles: HandoutRole[] = [
  {
    name: "Manager/Operator",
    sourceRole: "Director (Executive Officer) and Operations / Compliance Manager",
    description:
      "The source manual defines the Director (Executive Officer) and Operations / Compliance Manager as separate roles, not a combined Manager/Operator role. Where one person holds more than one role (which is common in a business of BNT's size), that person is accountable for all of the responsibilities of each role held.",
    responsibilities: [
      {
        title: "Director (Executive Officer)",
        items: [
          "Exercise due diligence: know transport and WHS risks, ensure resources and processes are in place and used.",
          "Approve and sign this manual and policies.",
          "Chair monthly safety review and annual management review.",
          "Receive and act on monthly safety performance reports.",
          "Ensure commercial arrangements and schedules do not encourage breaches.",
          "Approve significant changes (Section 20)."
        ]
      },
      {
        title: "Operations / Compliance Manager",
        items: [
          "Day-to-day implementation of this manual.",
          "Maintain risk register, Gearbox records and corrective action register.",
          "Coordinate incident investigations and regulator notifications.",
          "Conduct inspections, internal audits and compliance checks.",
          "Prepare monthly safety performance report.",
          "Manage driver induction, training and licence verification."
        ]
      }
    ],
    forms: [
      "Maintain the risk register, Gearbox records and corrective action register.",
      "Prepare the monthly safety performance report.",
      "Coordinate incident investigations and regulator notifications.",
      "The manual does not name a combined Manager/Operator form; confirm any additional role-specific forms before issue."
    ],
    resources: [
      "WHS and Chain of Responsibility Management System Manual (this source manual).",
      "WHS & CoR Policy and the supporting Fatigue Management, Speed Management, Drug and Alcohol, Vehicle Standards and Maintenance, Mass, Dimension and Loading, and Load Restraint policies (Section 5).",
      "Risk Register, Gearbox records, corrective action register, monthly safety performance reports and management review records."
    ]
  },
  {
    name: "Administrator",
    sourceRole: "No Administrator role is defined in the source manual.",
    description: null,
    responsibilities: [],
    forms: [],
    formsPending: true,
    resources: [
      "The source manual and WHS & CoR Policy are provided at induction to all new workers.",
      "Policies, procedures and SWMS are available in Gearbox and at the depot."
    ]
  },
  {
    name: "Scheduler",
    sourceRole: "Scheduler / Allocator",
    description: null,
    responsibilities: [
      {
        title: "Trip planning and work allocation",
        items: [
          "Plan trips that allow compliance with fatigue, speed and rest requirements.",
          "Check driver hours available before allocation.",
          "Ensure loads are within mass and dimension limits and suitable vehicles are allocated.",
          "Escalate customer requests that would require unsafe or non-compliant work."
        ]
      },
      {
        title: "Fatigue management",
        items: [
          "Schedulers check available hours before allocating work and plan trips that allow for required rest breaks, traffic and loading delays."
        ]
      },
      {
        title: "Weather, journey and environmental hazards",
        items: [
          "Schedulers and drivers monitor weather and road conditions; trips may be delayed or rerouted."
        ]
      }
    ],
    forms: [],
    formsPending: true,
    resources: [
      "Fatigue Management, Speed Management, and Mass, Dimension and Loading policies (Section 5).",
      "Trip schedules and driver work/rest information used to check available hours before allocation.",
      "Customer work instructions; customer requests that may result in a breach are declined and escalated to the Director."
    ]
  },
  {
    name: "Workshop Manager",
    sourceRole: "Workshop / Maintenance Provider",
    description: null,
    responsibilities: [
      {
        title: "Vehicle servicing and maintenance",
        items: [
          "Service vehicles to the maintenance schedule.",
          "Rectify reported defects before the vehicle returns to service.",
          "Record all maintenance and repairs in Gearbox."
        ]
      },
      {
        title: "Vehicle defect controls",
        items: [
          "Critical defects: vehicle must not operate — tag out.",
          "Major defects: rectify before next trip.",
          "Minor defects: rectify at next service.",
          "A vehicle with a Critical or Major defect is not returned to service until the repair is completed and signed off in Gearbox."
        ]
      }
    ],
    forms: [
      "Record all maintenance and repairs in Gearbox.",
      "Gearbox includes the Defect Report and Rectification (F-04); the source does not specify a separate Workshop Manager form."
    ],
    resources: [
      "Vehicle Standards and Maintenance policy (Section 5).",
      "Vehicle maintenance schedules managed in Gearbox.",
      "Gearbox app (pre-start, defect, incident) training is listed for drivers and workshop personnel (Section 14.2)."
    ]
  },
  {
    name: "Loader/Unloader",
    sourceRole: "Loaders / Forklift Operators / Yard Workers",
    description: null,
    responsibilities: [
      {
        title: "Licences and equipment",
        items: [
          "Hold required licences (e.g. HRWL forklift).",
          "Only workers with a current High Risk Work Licence (LF) operate forklifts.",
          "Forklifts receive a daily pre-use check."
        ]
      },
      {
        title: "Loading and yard safety",
        items: [
          "Follow yard traffic management and exclusion zones.",
          "Load vehicles evenly and within limits.",
          "Controls include speed limits, pedestrian exclusion zones, reversing alarms and lights, and mandatory hi-vis."
        ]
      },
      {
        title: "Training",
        items: [
          "Load restraint training: drivers, loaders; on commencement and every 2 years.",
          "Mass management (NHVAS) training: drivers, schedulers, loaders; on commencement and on change.",
          "Forklift (HRWL LF): licence held; verify every 5 years."
        ]
      }
    ],
    forms: [],
    formsPending: true,
    resources: [
      "Mass, Dimension and Loading and Load Restraint policies (Section 5).",
      "NTC Load Restraint Guide performance standards.",
      "Yard traffic management and exclusion-zone controls.",
      "Forklift daily pre-use check."
    ]
  },
  {
    name: "Driver",
    sourceRole: "Drivers (employees and subcontractors)",
    description: null,
    responsibilities: [
      {
        title: "Vehicle readiness and defects",
        items: [
          "Complete daily pre-start check in Gearbox before operating.",
          "Drivers complete a Gearbox pre-start checklist each shift covering tyres, wheels, brakes, lights and indicators, mirrors, windscreen and wipers, fluid leaks, coupling and turntable, air lines, load restraint and safety equipment (fire extinguisher, first aid kit, triangles).",
          "Any failed item creates a defect in Gearbox. Critical defects must be tagged out; Major defects must be rectified before next trip; Minor defects must be rectified at next service."
        ]
      },
      {
        title: "Transport and Chain of Responsibility",
        items: [
          "Comply with HVNL, road rules, fatigue, speed, mass and load restraint requirements.",
          "Drivers operate under Standard Hours / BFM and must not exceed work or fall below rest limits.",
          "Maintain accurate work diary records.",
          "Drivers of fatigue-regulated heavy vehicles maintain accurate work diaries (written or approved EWD).",
          "Drivers must be fit for duty and declare fitness at pre-start. Drivers must stop and rest if they experience fatigue signs.",
          "Drivers inspect restraint equipment at pre-start; check load security before departure, after the first 10–20 km, at each rest stop, and after any change in load."
        ]
      },
      {
        title: "Sites, reporting and safe work",
        items: [
          "Report hazards, defects, incidents and fatigue immediately.",
          "Follow customer site rules and wear required PPE.",
          "Stop work if unsafe.",
          "Drivers complete a Take 5 on arrival and follow the customer's site rules and induction.",
          "Drivers remain in a designated safe zone while forklifts load or unload, unless directed otherwise by the site.",
          "Drivers must not use hand-held mobile phones while driving."
        ]
      }
    ],
    forms: [
      "Vehicle Pre-Start Checklist (F-03, Gearbox app): complete before operating / each shift.",
      "Defect Report and Rectification (F-04, Gearbox): report failed pre-start items and defects.",
      "Driver Induction Checklist (F-08, Gearbox).",
      "Fatigue / Fitness for Duty Declaration (F-09, Gearbox / work diary): declare fitness at pre-start.",
      "Take 5 / JSA (F-05, Gearbox / paper): complete a Take 5 on arrival.",
      "Work diary (written or approved EWD): maintain accurate records when driving fatigue-regulated heavy vehicles.",
      "Incident Report (F-01) and Hazard / Near Miss Report (F-02): report incidents, hazards and near misses."
    ],
    resources: [
      "WHS & CoR Policy, Fatigue Management, Speed Management, Drug and Alcohol, Vehicle Standards and Maintenance, Mass, Dimension and Loading, and Load Restraint policies (Section 5).",
      "Load Restraint Guide (NTC) performance standards.",
      "Emergency procedures, PPE and first aid information; carry emergency contact details, water and communication devices.",
      "Site-specific and customer-specific requirements, including the customer's site rules and induction."
    ]
  }
];

export const generalCoRInformation = [
  {
    title: "Chain of Responsibility",
    text: "The HVNL principle that every party in the heavy vehicle supply chain who has control or influence over a transport activity has a duty to ensure its safety, so far as reasonably practicable."
  },
  {
    title: "BNT Logistics' CoR commitment",
    text: "BNT Logistics recognises that it is a party in the chain of responsibility as an employer, prime contractor, operator, scheduler, loader and consignor/consignee (as applicable)."
  },
  {
    title: "Applies to everyone",
    text: "No person within BNT Logistics may request, require or encourage a driver to speed, breach fatigue limits or skip rest breaks; agree to a delivery time or schedule that could only be met by breaching the HVNL; load or allow a vehicle to be overloaded, over-dimension or loaded unsafely; allow a defective or unroadworthy vehicle to operate; or apply pressure, incentives or penalties that encourage unsafe behaviour."
  },
  {
    title: "Worker duty",
    text: "All workers have a duty to take reasonable care for their own health and safety and that of others, comply with this policy and the procedures in this manual, and report hazards, incidents and any pressure to work unsafely. Every worker has the authority and is expected to stop work if they believe it is unsafe."
  }
];

export const inductionHandoutSource =
  "BNT Logistics (Baba Nanak Transport Pty Ltd), Work Health & Safety and Chain of Responsibility Management System Manual, Version 2.0 (08/01/2026)";
