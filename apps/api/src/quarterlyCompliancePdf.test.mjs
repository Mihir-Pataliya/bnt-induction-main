import test from "node:test";
import assert from "node:assert/strict";
import { generateQuarterlyCompliancePdf } from "../build/quarterlyCompliancePdf.js";

const sections = Array.from({ length: 9 }, (_, index) => ({
  id: `section-${index + 1}`,
  title: `Compliance section ${index + 1}`,
  itemsReviewed: 12,
  findings: 1,
  comments: index === 0 ? "Text with (parentheses) and a long comment.".repeat(25) : ""
}));

test("generates a multi-page PDF containing the quarterly review and acknowledgement", () => {
  const pdf = generateQuarterlyCompliancePdf({
    quarter: "Q2",
    year: 2026,
    company: { name: "BNT Logistics", abn: "12345678901" },
    sections,
    acknowledgement: { name: "Alex Admin", role: "Compliance Manager", signature: "Alex Admin", date: "2026-06-30" },
    submittedAt: "2026-06-30T12:00:00.000Z"
  });
  const text = pdf.toString("ascii");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /Quarterly Compliance Review/);
  assert.match(text, /BNT Logistics/);
  assert.match(text, /Compliance section 9/);
  assert.match(text, /Alex Admin/);
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length >= 2);
  assert.match(text, /parentheses/);
});
