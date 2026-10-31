import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDriverEmployment } from "./driverEmployment.js";

test("maps saved contractor, staff role, and company values for admin display", () => {
  assert.deepEqual(mapDriverEmployment(
    { employment_type: "contractor", staff_role: "warehouse" },
    { company_id: "company-1" },
    { company_name: "Grow More Pty Ltd", trading_name: "Grow More" }
  ), {
    employmentType: "contractor",
    staffRole: "warehouse",
    contractorCompanyId: "company-1",
    contractorCompanyName: "Grow More Pty Ltd"
  });
});

test("uses linked membership as contractor fallback and defaults missing role to driver", () => {
  assert.deepEqual(mapDriverEmployment(
    { employment_type: "employee" },
    { company_id: "company-2" },
    { trading_name: "North Haulage" }
  ), {
    employmentType: "contractor",
    staffRole: "driver",
    contractorCompanyId: "company-2",
    contractorCompanyName: "North Haulage"
  });
});
