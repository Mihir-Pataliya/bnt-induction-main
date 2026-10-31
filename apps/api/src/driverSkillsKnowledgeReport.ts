import type { SupabaseClient } from "@supabase/supabase-js";
import { isTrainingModuleAssigned } from "./trainingAcknowledgements.js";

type WorkerRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  employment_type: string | null;
  staff_role: string | null;
  depot_location: string | null;
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

type QuizAttemptRow = {
  id: string;
  user_id: string;
  score: number | null;
  passed: boolean | null;
  created_at: string | null;
  category_scores?: Record<string, number> | null;
  failed_critical?: boolean | null;
  critical_questions_asked?: number | null;
};

type ContractorRow = { user_id: string };

export type DriverSkillsKnowledgeReportRecord = {
  id: string;
  workerId: string;
  workerName: string;
  workerType: "employee" | "contractor" | "unknown";
  role: string;
  depotLocation: string | null;
  safetyModulesAssigned: number;
  safetyModulesCompleted: number;
  safetyModulesInProgress: number;
  safetyLastActivityDate: string | null;
  safetyModuleStatuses: Array<{
    sectionId: string;
    title: string;
    status: "completed" | "in_progress" | "not_started";
    completedAt: string | null;
    startedAt: string | null;
  }>;
  quizAttempts: number;
  quizAttemptHistory: Array<{
    id: string;
    score: number | null;
    passed: boolean | null;
    attemptedAt: string | null;
    categoryScores: Record<string, number> | null;
    failedCritical: boolean | null;
    criticalQuestionsAsked: number | null;
  }>;
  quizLatestScore: number | null;
  quizBestScore: number | null;
  quizLatestPassed: boolean | null;
  quizEverPassed: boolean;
  quizLastAttemptDate: string | null;
  practicalAssessmentStatus: "Not assessed";
  medicalAssessmentStatus: "Not assessed";
  overallStatus: "Complete" | "In progress" | "Not started" | "No modules assigned";
  lastAssessmentDate: string | null;
};

async function fetchRows<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(columns).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

async function fetchQuizAttempts(db: SupabaseClient): Promise<QuizAttemptRow[]> {
  try {
    return await fetchRows<QuizAttemptRow>(
      db,
      "quiz_attempts",
      "id, user_id, score, passed, created_at, category_scores, failed_critical, critical_questions_asked"
    );
  } catch (error) {
    const databaseError = error as { code?: string; message?: string };
    const message = (databaseError.message ?? "").toLowerCase();
    const missingColumn = databaseError.code === "42703" || databaseError.code === "PGRST204" ||
      message.includes("does not exist") || message.includes("schema cache");
    if (!missingColumn) throw error;
    return fetchRows<QuizAttemptRow>(db, "quiz_attempts", "id, user_id, score, passed, created_at");
  }
}

export async function handleDriverSkillsKnowledgeReport(db: SupabaseClient): Promise<{ records: DriverSkillsKnowledgeReportRecord[] }> {
  const [workers, sections, activities, quizAttempts, contractorMemberships] = await Promise.all([
    fetchRows<WorkerRow>(db, "profiles", "id, full_name, role, employment_type, staff_role, depot_location"),
    fetchRows<SectionRow>(db, "learning_sections", "id, title, version, audience, target_role, sort_order, source_slide_id"),
    fetchRows<ActivityRow>(db, "learning_section_completions", "user_id, section_id, section_version, completed, completed_at, section_started_at"),
    fetchQuizAttempts(db),
    fetchRows<ContractorRow>(db, "contractor_profiles", "user_id")
  ]);

  const contractorIds = new Set(contractorMemberships.map((row) => row.user_id));
  const workersById = new Map(workers
    .filter((worker) => worker.role !== "admin" && (worker.staff_role ?? "driver") === "driver")
    .map((worker) => [worker.id, worker]));

  const seenTitles = new Set<string>();
  const currentSections = sections
    .filter((section) => section.source_slide_id == null && Boolean(section.title?.trim()))
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .filter((section) => {
      const title = section.title!.trim();
      if (seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    });

  const activityByKey = new Map<string, ActivityRow>();
  for (const activity of activities) {
    if (!activity.completed && !activity.section_started_at) continue;
    const section = currentSections.find((item) => item.id === activity.section_id);
    if (!section) continue;
    if ((activity.section_version ?? "1.0") !== (section.version ?? "1.0")) continue;
    activityByKey.set(`${activity.user_id}:${activity.section_id}:${section.version ?? "1.0"}`, activity);
  }

  const attemptsByUser = new Map<string, QuizAttemptRow[]>();
  for (const attempt of quizAttempts) {
    const list = attemptsByUser.get(attempt.user_id) ?? [];
    list.push(attempt);
    attemptsByUser.set(attempt.user_id, list);
  }

  const records: DriverSkillsKnowledgeReportRecord[] = [];

  for (const worker of workersById.values()) {
    const employmentTypeRaw = (worker.employment_type ?? "").toLowerCase();
    const employmentType = employmentTypeRaw === "contractor" || contractorIds.has(worker.id) ? "contractor" : "employee";
    const staffRole = worker.staff_role ?? "driver";

    const assignedSections = currentSections.filter((section) =>
      isTrainingModuleAssigned(section, employmentType, staffRole)
    );

    let completedCount = 0;
    let inProgressCount = 0;
    let safetyLastDate: string | null = null;
    const safetyModuleStatuses: DriverSkillsKnowledgeReportRecord["safetyModuleStatuses"] = [];
    for (const section of assignedSections) {
      const activity = activityByKey.get(`${worker.id}:${section.id}:${section.version ?? "1.0"}`);
      const status = activity?.completed ? "completed" : activity?.section_started_at ? "in_progress" : "not_started";
      if (status === "completed") {
        completedCount += 1;
      } else if (status === "in_progress") {
        inProgressCount += 1;
      }
      safetyModuleStatuses.push({
        sectionId: section.id,
        title: section.title!.trim(),
        status,
        completedAt: activity?.completed_at ?? null,
        startedAt: activity?.section_started_at ?? null
      });
      const candidate = activity?.completed_at ?? activity?.section_started_at ?? null;
      if (candidate && (!safetyLastDate || candidate > safetyLastDate)) safetyLastDate = candidate;
    }

    const attempts = (attemptsByUser.get(worker.id) ?? []).slice().sort((left, right) =>
      (right.created_at ?? "").localeCompare(left.created_at ?? "")
    );
    const latestAttempt = attempts[0] ?? null;
    const quizEverPassed = attempts.some((attempt) => attempt.passed === true);
    const quizBestScore = attempts.length ? Math.max(...attempts.map((attempt) => attempt.score ?? 0)) : null;
    const quizLastDate = latestAttempt?.created_at ?? null;

    const workerType: DriverSkillsKnowledgeReportRecord["workerType"] =
      worker.employment_type === "employee" || worker.employment_type === "contractor"
        ? worker.employment_type
        : contractorIds.has(worker.id)
          ? "contractor"
          : "unknown";

    const allSafetyComplete = assignedSections.length > 0 && completedCount === assignedSections.length;
    const hasActivity = completedCount > 0 || inProgressCount > 0 || attempts.length > 0;
    const overallStatus: DriverSkillsKnowledgeReportRecord["overallStatus"] =
      assignedSections.length === 0
        ? "No modules assigned"
        : quizEverPassed && allSafetyComplete
        ? "Complete"
        : hasActivity
          ? "In progress"
          : "Not started";

    const candidates = [safetyLastDate, quizLastDate].filter((value): value is string => Boolean(value));
    const lastAssessmentDate = candidates.length ? candidates.reduce((latest, value) => (value > latest ? value : latest)) : null;

    records.push({
      id: worker.id,
      workerId: worker.id,
      workerName: worker.full_name?.trim() || "Name not recorded",
      workerType,
      role: worker.staff_role?.trim() || "Not recorded",
      depotLocation: worker.depot_location,
      safetyModulesAssigned: assignedSections.length,
      safetyModulesCompleted: completedCount,
      safetyModulesInProgress: inProgressCount,
      safetyLastActivityDate: safetyLastDate,
      safetyModuleStatuses,
      quizAttempts: attempts.length,
      quizAttemptHistory: attempts.map((attempt) => ({
        id: attempt.id,
        score: attempt.score,
        passed: attempt.passed,
        attemptedAt: attempt.created_at,
        categoryScores: attempt.category_scores ?? null,
        failedCritical: attempt.failed_critical ?? null,
        criticalQuestionsAsked: attempt.critical_questions_asked ?? null
      })),
      quizLatestScore: latestAttempt?.score ?? null,
      quizBestScore,
      quizLatestPassed: latestAttempt?.passed ?? null,
      quizEverPassed,
      quizLastAttemptDate: quizLastDate,
      practicalAssessmentStatus: "Not assessed",
      medicalAssessmentStatus: "Not assessed",
      overallStatus,
      lastAssessmentDate
    });
  }

  records.sort((left, right) => left.workerName.localeCompare(right.workerName));
  return { records };
}