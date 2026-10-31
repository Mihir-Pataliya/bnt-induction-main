import assert from "node:assert/strict";
import test from "node:test";
import { handleDriverSkillsKnowledgeReport } from "./driverSkillsKnowledgeReport.js";

test("report includes driver module and attempt details and separates latest from ever-passed status", async () => {
  const tables: Record<string, unknown[]> = {
    profiles: [
      { id: "driver-1", full_name: "Driver One", role: "driver", employment_type: "employee", staff_role: "driver", depot_location: "North" },
      { id: "warehouse-1", full_name: "Warehouse Worker", role: "driver", employment_type: "employee", staff_role: "warehouse", depot_location: "North" },
      { id: "admin-1", full_name: "Admin", role: "admin", employment_type: "employee", staff_role: "driver", depot_location: "North" }
    ],
    learning_sections: [
      { id: "module-1", title: "Safe Driving", version: "2.0", audience: "all", target_role: "driver", sort_order: 1, source_slide_id: null },
      { id: "module-2", title: "Vehicle Checks", version: "2.0", audience: "all", target_role: "driver", sort_order: 2, source_slide_id: null },
      { id: "module-warehouse", title: "Warehouse Safety", version: "1.0", audience: "all", target_role: "warehouse", sort_order: 3, source_slide_id: null }
    ],
    learning_section_completions: [
      { user_id: "driver-1", section_id: "module-1", section_version: "2.0", completed: true, completed_at: "2026-10-20T12:00:00Z", section_started_at: "2026-10-20T11:00:00Z" },
      { user_id: "driver-1", section_id: "module-2", section_version: "2.0", completed: false, completed_at: null, section_started_at: "2026-10-21T12:00:00Z" }
    ],
    quiz_attempts: [
      { id: "attempt-old", user_id: "driver-1", score: 80, passed: true, created_at: "2026-10-19T12:00:00Z", category_scores: { CoR: 80 }, failed_critical: false, critical_questions_asked: 2 },
      { id: "attempt-latest", user_id: "driver-1", score: 60, passed: false, created_at: "2026-10-22T12:00:00Z", category_scores: { CoR: 60 }, failed_critical: true, critical_questions_asked: 2 }
    ],
    contractor_profiles: []
  };
  const db = {
    from(table: string) {
      return {
        select() {
          return {
            async range(start: number, end: number) {
              const rows = tables[table] ?? [];
              return { data: rows.slice(start, end + 1), error: null };
            }
          };
        }
      };
    }
  };

  const { records } = await handleDriverSkillsKnowledgeReport(db as never);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.workerId, "driver-1");
  assert.equal(record.safetyModulesCompleted, 1);
  assert.equal(record.safetyModulesInProgress, 1);
  assert.deepEqual(record.safetyModuleStatuses.map((module) => module.status), ["completed", "in_progress"]);
  assert.equal(record.quizLatestPassed, false);
  assert.equal(record.quizEverPassed, true);
  assert.equal(record.quizAttempts, 2);
  assert.equal(record.quizAttemptHistory[0]?.id, "attempt-latest");
  assert.equal(record.quizAttemptHistory[0]?.failedCritical, true);
  assert.deepEqual(record.quizAttemptHistory[0]?.categoryScores, { CoR: 60 });
});

test("report does not mark a driver complete when no safety modules are assigned", async () => {
  const tables: Record<string, unknown[]> = {
    profiles: [
      { id: "contractor-1", full_name: "Contractor One", role: "driver", employment_type: "contractor", staff_role: "driver", depot_location: null }
    ],
    learning_sections: [
      { id: "employee-only", title: "Employee Induction", version: "1.0", audience: "employee", target_role: "driver", sort_order: 1, source_slide_id: null }
    ],
    learning_section_completions: [],
    quiz_attempts: [
      { id: "attempt-1", user_id: "contractor-1", score: 90, passed: true, created_at: "2026-10-22T12:00:00Z" }
    ],
    contractor_profiles: [{ user_id: "contractor-1" }]
  };
  const db = {
    from(table: string) {
      return {
        select() {
          return {
            async range(start: number, end: number) {
              const rows = tables[table] ?? [];
              return { data: rows.slice(start, end + 1), error: null };
            }
          };
        }
      };
    }
  };

  const { records } = await handleDriverSkillsKnowledgeReport(db as never);
  assert.equal(records[0]?.safetyModulesAssigned, 0);
  assert.equal(records[0]?.overallStatus, "No modules assigned");
});
