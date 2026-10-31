import type { SupabaseClient } from "@supabase/supabase-js";

type WorkerRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  employment_type: string | null;
  staff_role: string | null;
};

type SectionRow = {
  id: string;
  title: string | null;
  version: string | null;
  audience: string | null;
  target_role: string | null;
  sort_order: number | null;
  source_slide_id: string | null;
};

type ActivityRow = {
  user_id: string;
  section_id: string;
  section_version: string | null;
  completed: boolean;
  completed_at: string | null;
  section_started_at: string | null;
};

type AcknowledgementRow = {
  id: string;
  worker_id: string;
  section_id: string;
  section_version: string;
  presentation_title: string;
  acknowledgement_statement: string;
  acknowledged_at: string;
  signature: string;
  signed_at: string;
  recorded_by: string | null;
};

export type TrainingAcknowledgementEntry = {
  id: string;
  workerId: string;
  workerName: string;
  workerType: "employee" | "contractor" | "unknown";
  role: string;
  sectionId: string;
  sectionVersion: string;
  presentationTitle: string;
  moduleStatus: "completed" | "in_progress" | "activity_not_found";
  moduleCompletedAt: string | null;
  acknowledgementStatus: "completed" | "pending";
  acknowledgementStatement: string | null;
  acknowledgedAt: string | null;
  signature: string | null;
  signedAt: string | null;
  recordedBy: string | null;
};

async function fetchRows<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(columns).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export function isTrainingModuleAssigned(
  section: Pick<SectionRow, "audience" | "target_role">,
  employmentType: string,
  staffRole: string
) {
  const audience = section.audience ?? "all";
  const targetRole = section.target_role ?? "all";
  return (audience === "all" || audience === employmentType) &&
    (targetRole === "all" || targetRole === staffRole);
}

function toEntry(
  worker: WorkerRow,
  section: Pick<SectionRow, "id" | "title" | "version">,
  activity: ActivityRow | undefined,
  saved: AcknowledgementRow | undefined,
  workerType: TrainingAcknowledgementEntry["workerType"]
): TrainingAcknowledgementEntry {
  return {
    id: `${worker.id}:${section.id}:${section.version ?? "1.0"}`,
    workerId: worker.id,
    workerName: worker.full_name?.trim() || "Name not recorded",
    workerType,
    role: worker.staff_role?.trim() || "Not recorded",
    sectionId: section.id,
    sectionVersion: section.version ?? "1.0",
    presentationTitle: saved?.presentation_title ?? section.title?.trim() ?? "Untitled presentation",
    moduleStatus: !activity ? "activity_not_found" : activity.completed ? "completed" : "in_progress",
    moduleCompletedAt: activity?.completed_at ?? null,
    acknowledgementStatus: saved ? "completed" : "pending",
    acknowledgementStatement: saved?.acknowledgement_statement ?? null,
    acknowledgedAt: saved?.acknowledged_at ?? null,
    signature: saved?.signature ?? null,
    signedAt: saved?.signed_at ?? null,
    recordedBy: saved?.recorded_by ?? null
  };
}

export async function getTrainingAcknowledgementEntries(db: SupabaseClient): Promise<TrainingAcknowledgementEntry[]> {
  const [workers, sections, activities, acknowledgements, contractorMemberships] = await Promise.all([
    fetchRows<WorkerRow>(db, "profiles", "id, full_name, role, employment_type, staff_role"),
    fetchRows<SectionRow>(db, "learning_sections", "id, title, version, audience, target_role, sort_order, source_slide_id"),
    fetchRows<ActivityRow>(db, "learning_section_completions", "user_id, section_id, section_version, completed, completed_at, section_started_at"),
    fetchRows<AcknowledgementRow>(db, "training_acknowledgements", "id, worker_id, section_id, section_version, presentation_title, acknowledgement_statement, acknowledged_at, signature, signed_at, recorded_by"),
    fetchRows<{ user_id: string }>(db, "contractor_profiles", "user_id")
  ]);

  const workersById = new Map(
    workers.filter((worker) => worker.role !== "admin").map((worker) => [worker.id, worker])
  );
  const contractorIds = new Set(contractorMemberships.map((row) => row.user_id));
  const sortedSections = sections
    .filter((section) => section.source_slide_id == null && Boolean(section.title?.trim()))
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
  const seenTitles = new Set<string>();
  const currentSections = sortedSections.filter((section) => {
    const title = section.title!.trim();
    if (seenTitles.has(title)) return false;
    seenTitles.add(title);
    return true;
  });
  const sectionsById = new Map(currentSections.map((section) => [section.id, section]));
  const activityByKey = new Map<string, ActivityRow>();
  for (const activity of activities) {
    if (!activity.completed && !activity.section_started_at) continue;
    const section = sectionsById.get(activity.section_id);
    if (!section || (activity.section_version ?? "1.0") !== (section.version ?? "1.0")) continue;
    activityByKey.set(`${activity.user_id}:${activity.section_id}:${section.version ?? "1.0"}`, activity);
  }

  const acknowledgementsByKey = new Map(
    acknowledgements.map((row) => [`${row.worker_id}:${row.section_id}:${row.section_version}`, row])
  );
  const entriesByKey = new Map<string, TrainingAcknowledgementEntry>();

  for (const activity of activityByKey.values()) {
    const worker = workersById.get(activity.user_id);
    const section = sectionsById.get(activity.section_id);
    if (!worker || !section) continue;
    const employmentType = worker.employment_type === "contractor" || contractorIds.has(worker.id)
      ? "contractor"
      : "employee";
    const staffRole = worker.staff_role ?? "driver";
    if (!isTrainingModuleAssigned(section, employmentType, staffRole)) continue;
    const key = `${worker.id}:${section.id}:${section.version ?? "1.0"}`;
    const workerType = worker.employment_type === "employee" || worker.employment_type === "contractor"
      ? worker.employment_type
      : contractorIds.has(worker.id) ? "contractor" : "unknown";
    entriesByKey.set(key, toEntry(worker, section, activity, acknowledgementsByKey.get(key), workerType));
  }

  for (const saved of acknowledgements) {
    const worker = workersById.get(saved.worker_id);
    if (!worker) continue;
    const key = `${saved.worker_id}:${saved.section_id}:${saved.section_version}`;
    if (entriesByKey.has(key)) continue;
    const activity = activityByKey.get(key);
    entriesByKey.set(key, toEntry(worker, {
      id: saved.section_id,
      title: saved.presentation_title,
      version: saved.section_version
    }, activity, saved, worker.employment_type === "employee" || worker.employment_type === "contractor"
      ? worker.employment_type
      : contractorIds.has(worker.id) ? "contractor" : "unknown"));
  }

  return Array.from(entriesByKey.values()).sort((left, right) =>
    left.workerName.localeCompare(right.workerName) ||
    left.presentationTitle.localeCompare(right.presentationTitle)
  );
}
