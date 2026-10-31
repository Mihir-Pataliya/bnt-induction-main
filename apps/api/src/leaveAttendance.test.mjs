import test from "node:test";
import assert from "node:assert/strict";
import { calculateDurationMinutes, mapAttendanceRecord, parseDateOnly } from "./leaveAttendance.mjs";

test("validates calendar dates without accepting overflow dates", () => {
  assert.equal(parseDateOnly("2026-02-28")?.toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("26-02-28"), null);
});

test("calculates attendance duration and rejects invalid time ranges", () => {
  assert.equal(calculateDurationMinutes("2026-10-01T09:00:00Z", "2026-10-01T17:30:00Z"), 510);
  assert.equal(calculateDurationMinutes("not a date", "2026-10-01T17:30:00Z"), null);
  assert.equal(calculateDurationMinutes("2026-10-01T17:30:00Z", "2026-10-01T09:00:00Z"), null);
});

test("maps existing database attendance rows without losing worksite names", () => {
  const row = mapAttendanceRecord({
    id: "attendance-1",
    location_name: null,
    driver_name: "Driver One",
    vehicle_rego: "ABC123",
    signin_at: "2026-10-01T09:00:00Z",
    signout_at: null,
    hours_driven_today: 4.5,
    hours_rested_last_24h: 10,
    fitness_declaration: true,
    status: "signed_in"
  }, "Port Melbourne");
  assert.equal(row.depotName, "Port Melbourne");
  assert.equal(row.status, "Active");
  assert.equal(row.fitnessDeclaration, true);
});
