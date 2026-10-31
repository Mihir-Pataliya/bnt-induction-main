import type { SupabaseClient } from "@supabase/supabase-js";

type CompletionRow = {
  user_id: string;
  section_id: string;
  section_version: string | null;
  completed: boolean;
  completed_at: string | null;
  section_started_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  staff_role: string | null;
  employment_type: string | null;
};

type SectionRow = {
  id: string;
  title: string | null;
};

type TrainingInductionRecord = {
  id: string;
  workerName: string;
  workerType: "employee" | "subcontractor" | "unknown";
  role: string;
  trainingTitle: string;
  completionDate: string;
  status: "completed" | "in_progress";
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

async function fetchByIds<T>(db: SupabaseClient, table: string, columns: string, ids: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await db.from(table).select(columns).in("id", ids.slice(offset, offset + 200));
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
  }
  return rows;
}

export async function handleTrainingInductionRegister(db: SupabaseClient) {
  const completionRows = (await fetchRows<CompletionRow>(
    db,
    "learning_section_completions",
    "user_id, section_id, section_version, completed, completed_at, section_started_at"
  )).filter((row) => row.completed || Boolean(row.section_started_at));

  const profileIds = [...new Set(completionRows.map((row) => row.user_id))];
  const sectionIds = [...new Set(completionRows.map((row) => row.section_id))];
  const [profiles, sections] = await Promise.all([
    fetchByIds<ProfileRow>(db, "profiles", "id, full_name, staff_role, employment_type", profileIds),
    fetchByIds<SectionRow>(db, "learning_sections", "id, title", sectionIds)
  ]);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const sectionsById = new Map(sections.map((section) => [section.id, section]));

  const records: TrainingInductionRecord[] = completionRows.map((row) => {
    const profile = profilesById.get(row.user_id);
    const section = sectionsById.get(row.section_id);
    const employmentType = profile?.employment_type?.toLowerCase();
    return {
      id: `${row.user_id}:${row.section_id}:${row.section_version ?? ""}`,
      workerName: profile?.full_name?.trim() || "Not recorded",
      workerType: employmentType === "contractor" || employmentType === "subcontractor"
        ? "subcontractor"
        : employmentType === "employee" ? "employee" : "unknown",
      role: profile?.staff_role?.trim() || "Not recorded",
      trainingTitle: section?.title?.trim() || "Not recorded",
      completionDate: row.completed_at ?? "",
      status: row.completed ? "completed" : "in_progress"
    };
  });
  records.sort((left, right) => (right.completionDate || "").localeCompare(left.completionDate || ""));
  return { records };
}
