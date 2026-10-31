import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { resolve } from "path";
import WebSocket from "ws";
import { z } from "zod";
import nodemailer from "nodemailer";
import { decryptPayrollValue, encryptPayrollValue, getPayrollEncryptionKey } from "./payrollSecurity.mjs";
import { dispatchNotificationOutbox, enqueueNotifications, runScheduledNotifications } from "./notificationOutbox.mjs";
import { normalizeCourseContentItems } from "./courseContent.mjs";
import { generateReportPdfBuffer } from "./pdf-generator.js";
import { getCurrentWorkClearanceBlockers, getFinalApprovalBlockers, getNextContractorCompanyStatus, getRequiredDocumentTypesForRole, isCurrentOnboardingDate, latestDocumentsByType, REQUIRED_EXPIRY_DOCUMENTS } from "./onboardingCompliance.js";
import { validateBasicProfile } from "../../web/src/lib/profileValidation.mjs";
import { validateABN, validateACN } from "../../web/src/lib/contractorValidation.mjs";
import { calculateDurationMinutes, mapAttendanceRecord, parseDateOnly } from "./leaveAttendance.mjs";
import { generateQuarterlyCompliancePdf } from "./quarterlyCompliancePdf.js";
import { generateAnnualSystemReviewPdf } from "./annualSystemReviewPdf.js";
import { handleOrganisationalChart } from "./organisationalChart.js";
import { handleTrainingInductionRegister } from "./trainingInductionRegister.js";
import { getTrainingAcknowledgementEntries, isTrainingModuleAssigned } from "./trainingAcknowledgements.js";
import { handleDriverSkillsKnowledgeReport } from "./driverSkillsKnowledgeReport.js";
import { handleDriverMedicalFitnessReport } from "./driverMedicalFitnessReport.js";
import { addFatigueAttemptNumbers, buildFatigueAnswerReview, FatigueAssessmentError, gradeFatigueAssessment, validateFatigueQuestions } from "./fatigueAssessment.js";
import { addDistractionAttemptNumbers, buildDistractionAnswerReview, DistractionAssessmentError, gradeDistractionAssessment, validateDistractionQuestions } from "./distractionAssessment.js";
import { addSpeedAttemptNumbers, buildSpeedAnswerReview, SpeedAssessmentError, gradeSpeedAssessment, validateSpeedQuestions } from "./speedAssessment.js";
import { addPreStartAttemptNumbers, buildPreStartAnswerReview, PreStartAssessmentError, gradePreStartAssessment, validatePreStartQuestions } from "./preStartAwarenessAssessment.js";
import { addLurcAttemptNumbers, buildLurcAnswerReview, LurcAssessmentError, gradeLurcAssessment, validateLurcQuestions } from "./loadingUnloadingRestraintAssessment.js";
(global as any).WebSocket = WebSocket;

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env") });

const app = express();
app.set("trust proxy", 1);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.APP_URL ?? "http://localhost:5173";
const organizationName = process.env.ORGANIZATION_NAME ?? "BNT Logistics";
const organizationLogoUrl = process.env.ORGANIZATION_LOGO_URL ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

// --- Rate Limiter (no external deps) ---
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX_STORE_SIZE = 10_000; // H-1 FIX: cap to prevent OOM from IP-spoofed floods
function rateLimit(maxRequests: number, windowMs: number) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const ip = String(request.ip ?? request.socket.remoteAddress ?? "unknown");
    const now = Date.now();
    const entry = rateLimitStore.get(ip);
    if (!entry || now > entry.resetAt) {
      // H-1 FIX: Evict oldest expired entries if store is at capacity
      if (rateLimitStore.size >= RATE_LIMIT_MAX_STORE_SIZE) {
        for (const [key, val] of rateLimitStore.entries()) {
          if (now > val.resetAt) rateLimitStore.delete(key);
          if (rateLimitStore.size < RATE_LIMIT_MAX_STORE_SIZE) break;
        }
      }
      rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      response.status(429).json({ message: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}

function isCurrentCalendarDate(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const expiryDay = Date.UTC(year, month - 1, day);
    const parsed = new Date(expiryDay);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false;
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return expiryDay >= today;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= now.getTime();
}

function addCalendarYears(date: Date, years: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  const lastDayOfTargetMonth = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 10 * 60 * 1000);

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// CORS allowlist — set ALLOWED_ORIGINS="https://yourdomain.com" in production .env
const rawOrigins = process.env.ALLOWED_ORIGINS ?? "";
const allowedOrigins = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server (no origin) and any explicitly listed origin
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

app.use(express.json({ limit: "2mb" }));

interface AdminRequest extends express.Request {
  authUserId?: string;
  userRole?: "driver" | "admin";
}

async function logAuditEntry(userId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    user_id: userId,
    action,
    metadata,
    created_at: new Date().toISOString()
  });

  if (error && process.env.NODE_ENV !== "production") {
    console.error("audit log failed", action, error);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const fields = ["name", "message", "code", "details", "hint"]
      .flatMap((key) => typeof details[key] === "string" ? [`${key}=${details[key]}`] : []);
    if (fields.length) return fields.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return "[unserializable error object]";
    }
  }
  return String(error);
}

async function purgeExpiredEmployeeData() {
  let operation = "purging expired payroll records";
  try {
    const { data: payrollRemoved, error: payrollError } = await supabaseAdmin.rpc("purge_expired_employee_payroll");
    if (payrollError) throw payrollError;
    operation = "loading employee profiles";
    const { data: employees, error: employeesError } = await supabaseAdmin.from("profiles").select("id").eq("employment_type", "employee");
    if (employeesError) throw employeesError;
    let documentCount = 0;
    for (const employee of employees ?? []) {
      operation = "loading expired employee documents";
      const { data: expired, error: docsError } = await supabaseAdmin.from("documents").select("id, file_url").eq("user_id", employee.id).lte("retention_expires_at", new Date().toISOString());
      if (docsError) throw docsError;
      for (const document of expired ?? []) {
        operation = "removing expired employee documents from storage";
        const { error: storageError } = await supabaseAdmin.storage.from("driver-documents").remove([document.file_url]);
        if (storageError) throw storageError;
        operation = "deleting expired employee document records";
        const { error: deleteError } = await supabaseAdmin.from("documents").delete().eq("id", document.id);
        if (deleteError) throw deleteError;
        documentCount += 1;
      }
    }
    if (Number(payrollRemoved ?? 0) || documentCount) {
      operation = "writing the employee data retention audit log";
      const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({ user_id: null, action: "employee_data_retention_purge", metadata: { payrollRecordCount: Number(payrollRemoved ?? 0), documentCount }, created_at: new Date().toISOString() });
      if (auditError) throw auditError;
    }
  } catch (error) {
    console.error(`Employee data retention job failed while ${operation}:`, describeError(error));
  }
}

const payrollRetentionInterval = setInterval(() => void purgeExpiredEmployeeData(), 24 * 60 * 60 * 1000);
(payrollRetentionInterval as any).unref?.();
setTimeout(() => void purgeExpiredEmployeeData(), 30_000).unref?.();

async function verifySessionToken(token: string): Promise<{ user: any | null; unavailable: boolean }> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error) return { user: data.user ?? null, unavailable: false };
    const retryable = error.name === "AuthRetryableFetchError" || /fetch failed|timeout|network/i.test(error.message);
    return { user: null, unavailable: retryable };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = /fetch failed|timeout|network/i.test(message);
    if (!unavailable) throw error;
    return { user: null, unavailable: true };
  }
}

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "driver-induction-api",
    organizationName,
    timestamp: new Date().toISOString()
  });
});

// Admin policy signature reports use the service role so RLS on the existing
// signature table cannot make completed acknowledgements appear missing.
app.get("/api/admin/policies/:versionId/signatures", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const versionId = String(request.params.versionId ?? "");
    const { data: version, error: versionError } = await supabaseAdmin.from("policy_versions").select("id, policy_id, version_label").eq("id", versionId).maybeSingle();
    if (versionError) throw versionError;
    if (!version) { response.status(404).json({ message: "Published policy version not found." }); return; }
    const { data: policy, error: policyError } = await supabaseAdmin.from("policies").select("id, title, name, audience, target_role").eq("id", version.policy_id).maybeSingle();
    if (policyError) throw policyError;
    if (!policy) { response.status(404).json({ message: "Policy not found." }); return; }
    const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, employment_type, staff_role, role, depot_location").limit(10000),
      supabaseAdmin.from("contractor_profiles").select("user_id").limit(10000)
    ]);
    if (profilesError) throw profilesError;
    if (membershipsError) throw membershipsError;
    let { data: signatureRows, error: signatureError } = await supabaseAdmin.from("policy_signatures").select("user_id, policy_version_id, signature_text, signed_at").eq("policy_version_id", versionId).limit(10000);
    if (signatureError?.code === "42703") {
      const fallback = await supabaseAdmin.from("policy_signatures").select("driver_id, policy_id, signature_text, signed_at").eq("policy_id", versionId).limit(10000);
      signatureRows = (fallback.data ?? []).map((row: any) => ({ ...row, user_id: row.driver_id, policy_version_id: row.policy_id }));
      signatureError = fallback.error;
    }
    if (signatureError) throw signatureError;
    const contractorIds = new Set((memberships ?? []).map((row: any) => String(row.user_id)));
    const eligible = (profiles ?? []).filter((profile: any) => {
      if (profile.role === "admin") return false;
      const employmentType = profile.employment_type === "contractor" || contractorIds.has(String(profile.id)) ? "contractor" : "employee";
      return (!policy.audience || policy.audience === "all" || policy.audience === employmentType) &&
        (!policy.target_role || policy.target_role === "all" || policy.target_role === (profile.staff_role || "driver"));
    });
    const people = new Map(eligible.map((profile: any) => [String(profile.id), profile]));
    const signed = (signatureRows ?? []).filter((row: any) => people.has(String(row.user_id ?? row.driver_id))).map((row: any) => {
      const person: any = people.get(String(row.user_id ?? row.driver_id));
      return { policyId: versionId, policyTitle: policy.title ?? policy.name, policyVersion: version.version_label ?? "", signedCount: 0, pendingCount: 0, totalDrivers: eligible.length, driverId: String(person.id), driverName: person.full_name ?? "Driver", driverEmail: person.email ?? "", signatureText: row.signature_text ?? "", signedAt: row.signed_at ?? "" };
    });
    const signedIds = new Set(signed.map((row: any) => row.driverId));
    const pending = eligible.filter((person: any) => !signedIds.has(String(person.id))).map((person: any) => ({ id: String(person.id), driverId: String(person.id), fullName: person.full_name ?? "Driver", driverName: person.full_name ?? "Driver", email: person.email ?? "", driverEmail: person.email ?? "", depotLocation: person.depot_location ?? "" }));
    response.json({ signed, pending, versionLabel: version.version_label ?? "" });
  } catch (error) { next(error); }
});

app.get("/api/admin/policies/signature-counts", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    let { data: rows, error } = await supabaseAdmin.from("policy_signatures").select("policy_version_id").limit(10000);
    if (error?.code === "42703") {
      const fallback = await supabaseAdmin.from("policy_signatures").select("policy_id").limit(10000);
      rows = (fallback.data ?? []).map((row: any) => ({ policy_version_id: row.policy_id }));
      error = fallback.error;
    }
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of rows ?? []) {
      const id = String((row as any).policy_version_id ?? "");
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    response.json({ counts });
  } catch (error) { next(error); }
});

async function requireAdmin(request: AdminRequest, response: express.Response, next: express.NextFunction) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  const token = header.slice("Bearer ".length);
  const auth = await verifySessionToken(token);
  if (auth.unavailable) {
    response.status(503).json({ message: "Unable to reach Supabase Auth. Check the API server's Supabase URL and outbound network connection, then retry." });
    return;
  }
  if (!auth.user) {
    response.status(401).json({ message: "Invalid session." });
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin") {
    response.status(403).json({ message: "Admin access is required." });
    return;
  }

  request.authUserId = auth.user.id;
  request.userRole = "admin";
  next();
}

async function requireDriver(request: AdminRequest, response: express.Response, next: express.NextFunction) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  const token = header.slice("Bearer ".length);
  const auth = await verifySessionToken(token);
  if (auth.unavailable) {
    response.status(503).json({ message: "Unable to reach Supabase Auth. Check the API server's Supabase URL and outbound network connection, then retry." });
    return;
  }
  if (!auth.user) {
    response.status(401).json({ message: "Invalid session." });
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "driver") {
    response.status(403).json({ message: "Driver access is required." });
    return;
  }

  const mustChange = auth.user.user_metadata?.must_change_password === true;
  if (mustChange) {
    response.status(403).json({
      code: "PASSWORD_RESET_REQUIRED",
      message: "Password change is required before starting your induction."
    });
    return;
  }

  request.authUserId = auth.user.id;
  request.userRole = "driver";
  next();
}

async function requirePayrollAccess(request: AdminRequest, response: express.Response, next: express.NextFunction) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) { response.status(401).json({ message: "Authentication required." }); return; }
  const auth = await verifySessionToken(header.slice("Bearer ".length));
  if (auth.unavailable) { response.status(503).json({ message: "Authentication service unavailable." }); return; }
  if (!auth.user) { response.status(401).json({ message: "Invalid session." }); return; }
  const { data: access, error } = await supabaseAdmin.from("employee_payroll_access").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (error) { response.status(503).json({ message: "Payroll authorization is unavailable." }); return; }
  if (!access) { response.status(403).json({ message: "Payroll access is required." }); return; }
  request.authUserId = auth.user.id;
  next();
}

const leaveRequestInput = z.object({
  leaveType: z.enum(["annual", "personal", "unpaid", "other"]),
  startDate: z.string().refine((value) => Boolean(parseDateOnly(value)), "Enter a valid start date."),
  endDate: z.string().refine((value) => Boolean(parseDateOnly(value)), "Enter a valid end date."),
  reason: z.string().trim().min(5).max(2000)
}).refine((value) => value.endDate >= value.startDate, {
  message: "End date must be on or after the start date.",
  path: ["endDate"]
});

function isAttendanceLocation(value: string) {
  return [
    "BNT Logistics Port Melbourne Hub",
    "BNT Logistics Chipping Norton Freight Centre",
    "BNT Logistics Acacia Ridge Logistics Terminal",
    "BNT Logistics Regency Park Depot",
    "BNT Logistics Welshpool Logistics Hub"
  ].includes(value);
}

function toAttendanceDbStatus(value: string | null | undefined) {
  return value === "signed_in" || value === "Active" ? "signed_in" : "signed_out";
}

const quarterlyReviewSectionIds = [
  "company_details",
  "load_information",
  "defects_infringements_incidents",
  "non_conformance_reports",
  "weight_calibration_verification",
  "daily_pre_start_inspections",
  "vehicle_servicing",
  "fault_repairs",
  "inductions_fatigue_audits",
  "other_key_performance_indicators",
  "comments_acknowledgement"
] as const;

const quarterlyReviewInputSchema = z.object({
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  year: z.number().int().min(2000).max(2200),
  companyDetails: z.object({
    operator: z.string().trim().max(200).optional().default(""),
    abn: z.string().trim().max(32).optional().default(""),
    abnAcn: z.string().trim().max(32).optional().default(""),
    name: z.string().trim().max(200).optional().default(""),
    year: z.number().int().min(2000).max(2200).optional()
  }).passthrough(),
  sections: z.array(z.object({
    id: z.enum(quarterlyReviewSectionIds),
    title: z.string().trim().min(1).max(160)
  }).catchall(z.union([z.string(), z.number(), z.array(z.string()), z.null()]))).length(11).superRefine((sections, context) => {
    const ids = sections.map((section) => section.id);
    if (new Set(ids).size !== quarterlyReviewSectionIds.length ||
        quarterlyReviewSectionIds.some((id) => !ids.includes(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Include each of the eleven compliance review sections exactly once." });
    }
    for (const section of sections) {
      for (const [key, value] of Object.entries(section)) {
        if (key === "id" || key === "title") continue;
        if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections"], message: "Counts cannot be negative." });
        }
      }
    }
  }),
  acknowledgement: z.object({
    name: z.string().trim().max(200),
    role: z.string().trim().max(160),
    signature: z.string().trim().max(200),
    date: z.string().max(10)
  })
});

function quarterlyCompliancePeriodLabel(quarter: string): string {
  switch (quarter) {
    case "Q1": return "January, February, March";
    case "Q2": return "April, May, June";
    case "Q3": return "July, August, September";
    case "Q4": return "October, November, December";
    default: return quarter;
  }
}

function normalizeQuarterlyCompanyDetails(input: any, year: number, quarter: string): Record<string, unknown> {
  const operator = String(input?.operator || input?.name || "").trim();
  const abn = String(input?.abn || input?.abnAcn || "").trim();
  return {
    ...input,
    operator,
    name: operator,
    abn,
    abnAcn: abn,
    year,
    compliancePeriod: quarterlyCompliancePeriodLabel(quarter)
  };
}

const quarterlyReviewSubmissionSchema = quarterlyReviewInputSchema.superRefine((review, context) => {
  if (!String(review.companyDetails.operator || review.companyDetails.name || "").trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["companyDetails", "operator"], message: "Complete the operator before submitting." });
  }
  if (!String(review.companyDetails.abn || review.companyDetails.abnAcn || "").trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["companyDetails", "abn"], message: "Complete the ABN/ACN before submitting." });
  }
  for (const [field, label] of [["name", "name"], ["role", "role in company"]] as const) {
    if (!review.acknowledgement[field].trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["acknowledgement", field], message: `Enter the acknowledgement ${label}.` });
    }
  }
  if (review.acknowledgement.signature.trim() && review.acknowledgement.signature.trim().length < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acknowledgement", "signature"], message: "Enter a valid signature." });
  }
  if (!parseDateOnly(review.acknowledgement.date)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acknowledgement", "date"], message: "Select a valid acknowledgement date." });
  }
});

app.all(["/api/admin/organisational-chart", "/api/admin/organisational-chart/employees", "/api/admin/organisational-chart/pdf"], requireAdmin, async (request: AdminRequest, response, next) => {
  const action = request.path.split("/organisational-chart")[1].replace(/^\//, "");
  if (!((action === "" && ["GET", "PUT"].includes(request.method)) || (action === "employees" && request.method === "GET") || (action === "pdf" && request.method === "POST"))) {
    response.status(405).json({ message: "Method not allowed." }); return;
  }
  try {
    const result = await handleOrganisationalChart(supabaseAdmin, request.authUserId!, request.method, action, request.body);
    if (Buffer.isBuffer(result)) {
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", 'attachment; filename="organisational-chart.pdf"');
      response.send(result);
    } else {
      if (request.method === "PUT") await logAuditEntry(request.authUserId!, "organisational_chart_saved", {});
      response.json(result);
    }
  } catch (error) { next(error); }
});

app.get("/api/admin/training-induction-register", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    response.json(await handleTrainingInductionRegister(supabaseAdmin));
  } catch (error) { next(error); }
});

app.get("/api/admin/driver-skills-knowledge-report", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    response.json(await handleDriverSkillsKnowledgeReport(supabaseAdmin));
  } catch (error) { next(error); }
});

app.get("/api/admin/driver-medical-fitness-report", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    response.set("Cache-Control", "no-store, private").set("Pragma", "no-cache");
    const result = await handleDriverMedicalFitnessReport(supabaseAdmin);
    if (request.authUserId) await logAuditEntry(request.authUserId, "sensitive_medical_documents_accessed", { documentCount: result.records.filter((record) => record.documentId).length, driverCount: result.records.length });
    response.json(result);
  } catch (error) { next(error); }
});

app.get("/api/admin/training-acknowledgements", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const entries = await getTrainingAcknowledgementEntries(supabaseAdmin);
    response.json({ entries });
  } catch (error) { next(error); }
});

app.get("/api/driver/training-acknowledgements", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("training_acknowledgements")
      .select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at")
      .eq("worker_id", request.authUserId!)
      .order("acknowledged_at", { ascending: false });
    if (error) throw error;
    response.json({
      acknowledgements: (data ?? []).map((row) => ({
        id: row.id,
        sectionId: row.section_id,
        sectionVersion: row.section_version,
        acknowledgementStatement: row.acknowledgement_statement,
        acknowledgedAt: row.acknowledged_at,
        signature: row.signature,
        signedAt: row.signed_at
      }))
    });
  } catch (error) { next(error); }
});

app.post("/api/driver/training-acknowledgements", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      sectionId: z.string().min(1).max(200),
      sectionVersion: z.string().min(1).max(50),
      workerConfirmed: z.literal(true),
      signature: z.string().min(100).max(1_500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
    });
    const payload = schema.parse(request.body);
    const workerId = request.authUserId!;
    const [{ data: worker, error: workerError }, { data: section, error: sectionError }] = await Promise.all([
      supabaseAdmin.from("profiles")
        .select("id, role, employment_type, staff_role")
        .eq("id", workerId)
        .maybeSingle(),
      supabaseAdmin.from("learning_sections")
        .select("id, title, version, audience, target_role, source_slide_id")
        .eq("id", payload.sectionId)
        .maybeSingle()
    ]);
    if (workerError) throw workerError;
    if (sectionError) throw sectionError;
    if (!worker || worker.role !== "driver") {
      response.status(404).json({ message: "Driver profile not found." });
      return;
    }
    if (!section || section.source_slide_id || (section.version ?? "1.0") !== payload.sectionVersion) {
      response.status(404).json({ message: "This safety presentation is no longer available." });
      return;
    }

    const { data: contractorMembership, error: membershipError } = await supabaseAdmin
      .from("contractor_profiles")
      .select("user_id")
      .eq("user_id", workerId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const employmentType = worker.employment_type === "contractor" || Boolean(contractorMembership)
      ? "contractor"
      : "employee";
    if (!isTrainingModuleAssigned(section, employmentType, worker.staff_role ?? "driver")) {
      response.status(400).json({ message: "This safety presentation is not assigned to your account." });
      return;
    }

    const { data: activity, error: activityError } = await supabaseAdmin
      .from("learning_section_completions")
      .select("completed")
      .eq("user_id", workerId)
      .eq("section_id", section.id)
      .eq("section_version", payload.sectionVersion)
      .eq("completed", true)
      .limit(1)
      .maybeSingle();
    if (activityError) throw activityError;
    if (!activity) {
      response.status(400).json({ message: "Complete this Step 3 presentation before submitting its acknowledgement." });
      return;
    }

    const { data: saved, error: saveError } = await supabaseAdmin
      .from("training_acknowledgements")
      .insert({
        worker_id: workerId,
        section_id: section.id,
        section_version: payload.sectionVersion,
        presentation_title: section.title?.trim() || "Untitled presentation",
        acknowledgement_statement: "I confirm that I watched/read and understood this safety presentation.",
        signature: payload.signature,
        recorded_by: workerId
      })
      .select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at")
      .single();
    if (saveError?.code === "23505") {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("training_acknowledgements")
        .select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at")
        .eq("worker_id", workerId)
        .eq("section_id", section.id)
        .eq("section_version", payload.sectionVersion)
        .single();
      if (existingError) throw existingError;
      response.json({
        acknowledgement: {
          id: existing.id,
          sectionId: existing.section_id,
          sectionVersion: existing.section_version,
          acknowledgementStatement: existing.acknowledgement_statement,
          acknowledgedAt: existing.acknowledged_at,
          signature: existing.signature,
          signedAt: existing.signed_at
        }
      });
      return;
    }
    if (saveError) throw saveError;

    await logAuditEntry(workerId, "training_acknowledgement_recorded", {
      acknowledgementId: saved.id,
      sectionId: section.id,
      sectionVersion: payload.sectionVersion
    });
    response.status(201).json({
      acknowledgement: {
        id: saved.id,
        sectionId: saved.section_id,
        sectionVersion: saved.section_version,
        acknowledgementStatement: saved.acknowledgement_statement,
        acknowledgedAt: saved.acknowledged_at,
        signature: saved.signature,
        signedAt: saved.signed_at
      }
    });
  } catch (error) { next(error); }
});

// ============================================================
// Training Calendar
// ============================================================

app.get("/api/admin/training-calendar", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const status = request.query.status as string | undefined;
    const employeeId = request.query.employee_id as string | undefined;

    let query = supabaseAdmin
      .from("training_calendar_events")
      .select("*, employee:profiles!training_calendar_events_employee_id_fkey(full_name, email, role)")
      .order("scheduled_date", { ascending: true });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }
    if (employeeId) {
      query = query.eq("employee_id", employeeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    response.json({ events: data ?? [] });
  } catch (error) { next(error); }
});

app.post("/api/admin/training-calendar", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      title: z.string().min(1).max(200),
      topic: z.string().min(1).max(200),
      trainer: z.string().min(1).max(200),
      employee_id: z.string().uuid().nullish(),
      scheduled_date: z.string().datetime(),
      refresher_due_date: z.string().datetime().nullish(),
      notes: z.string().optional(),
      status: z.enum(['scheduled', 'completed', 'overdue']).optional()
    });
    const payload = schema.parse(request.body);

    const now = new Date().toISOString();
    const scheduledDate = new Date(payload.scheduled_date).toISOString();
    const refresherDueDate = payload.refresher_due_date ? new Date(payload.refresher_due_date).toISOString() : null;
    const statusToUse = payload.status ?? (new Date(scheduledDate) < new Date(now) ? "overdue" : "scheduled");

    const { data, error } = await supabaseAdmin
      .from("training_calendar_events")
      .insert({
        title: payload.title,
        topic: payload.topic,
        trainer: payload.trainer,
        employee_id: payload.employee_id ?? null,
        scheduled_date: scheduledDate,
        refresher_due_date: refresherDueDate,
        status: statusToUse,
        notes: payload.notes || '',
        created_by: request.authUserId
      })
      .select()
      .single();
    if (error) throw error;

    await logAuditEntry(request.authUserId!, "training_event_created", { eventId: data.id, topic: payload.topic });
    response.status(201).json({ event: data });
  } catch (error) { next(error); }
});

app.get("/api/admin/training-calendar/employees", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, role")
      .in("role", ['admin', 'driver'])
      .order("full_name", { ascending: true });
    if (error) throw error;
    response.json({ employees: data ?? [] });
  } catch (error) { next(error); }
});

app.get("/api/admin/training-calendar/:eventId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("training_calendar_events")
      .select("*, employee:profiles!training_calendar_events_employee_id_fkey(full_name, email, role)")
      .eq("id", request.params.eventId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Training event not found." });
      return;
    }
    response.json({ event: data });
  } catch (error) { next(error); }
});

app.patch("/api/admin/training-calendar/:eventId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      topic: z.string().min(1).max(200).optional(),
      trainer: z.string().min(1).max(200).optional(),
      employee_id: z.string().uuid().nullish(),
      scheduled_date: z.string().datetime().optional(),
      refresher_due_date: z.string().datetime().nullish(),
      notes: z.string().optional(),
      status: z.enum(['scheduled', 'completed', 'overdue']).optional()
    });
    const payload = schema.parse(request.body);

    const now = new Date().toISOString();
    const updateData: Record<string, any> = { updated_at: now };

    if (payload.title) updateData.title = payload.title;
    if (payload.topic) updateData.topic = payload.topic;
    if (payload.trainer) updateData.trainer = payload.trainer;
    if (payload.employee_id !== undefined) updateData.employee_id = payload.employee_id ?? null;
    if (payload.scheduled_date) {
      updateData.scheduled_date = new Date(payload.scheduled_date).toISOString();
      // Auto-set overdue if scheduled in past and not completed
      if (!payload.status || payload.status !== 'completed') {
        if (new Date(updateData.scheduled_date) < new Date(now)) updateData.status = 'overdue';
        else updateData.status = 'scheduled';
      }
    }
    if (payload.refresher_due_date !== undefined) {
      updateData.refresher_due_date = payload.refresher_due_date ? new Date(payload.refresher_due_date).toISOString() : null;
    }
    if (payload.notes !== undefined) updateData.notes = payload.notes;
    if (payload.status) updateData.status = payload.status;

    const { data, error } = await supabaseAdmin
      .from("training_calendar_events")
      .update(updateData)
      .eq("id", request.params.eventId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Training event not found." });
      return;
    }

    await logAuditEntry(request.authUserId!, "training_event_updated", { eventId: request.params.eventId, changes: payload });
    response.json({ event: data });
  } catch (error) { next(error); }
});

app.delete("/api/admin/training-calendar/:eventId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("training_calendar_events")
      .delete()
      .eq("id", request.params.eventId);
    if (error) throw error;

    await logAuditEntry(request.authUserId!, "training_event_deleted", { eventId: request.params.eventId });
    response.json({ message: "Training event deleted." });
  } catch (error) { next(error); }
});

// ============================================================
// ============================================================
// Driver Training Calendar (read-only, driver-specific)
// ============================================================

app.get("/api/driver/training-calendar", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const status = request.query.status as string | undefined;
    const validStatuses = ["scheduled", "completed", "overdue"];
    if (status && status !== "all" && !validStatuses.includes(status)) {
      response.status(400).json({ message: "Invalid training status filter." });
      return;
    }

    let query = supabaseAdmin
      .from("training_calendar_events")
      .select("*, employee:profiles!training_calendar_events_employee_id_fkey(full_name, email, role)")
      .order("scheduled_date", { ascending: true });

    // Enforce driver-specific access: only all-employee sessions or sessions
    // explicitly assigned to the authenticated driver.
    query = query.or(`employee_id.is.null,employee_id.eq.${request.authUserId}`);

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    response.json({ events: data ?? [] });
  } catch (error) {
    next(error);
  }
});


// Employee/Contractor Induction Records
// ============================================================

app.get("/api/admin/induction-workers", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, role, employment_type, staff_role, phone, licence_class, licence_number, issuing_state, depot_location")
      .neq("role", "admin")
      .order("full_name", { ascending: true });
    if (error) throw error;
    response.json({ workers: data ?? [] });
  } catch (error) { next(error); }
});

function parseInductionRecordArray(value: unknown, column: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error(`Invalid ${column} data in employee induction record.`);
}

function normalizeEmployeeInductionRecord<T extends Record<string, unknown>>(record: T) {
  return {
    ...record,
    checklist: parseInductionRecordArray(record.checklist, "checklist"),
    documents: parseInductionRecordArray(record.documents, "documents"),
    acknowledgements: parseInductionRecordArray(record.acknowledgements, "acknowledgements"),
    signatures: parseInductionRecordArray(record.signatures, "signatures")
  };
}

async function attachDriverLegalSignoffs<T extends { worker_id: string | null }>(records: T[]) {
  const workerIds = [...new Set(records.map((record) => record.worker_id).filter((id): id is string => Boolean(id)))];
  const { data: progressRows, error } = workerIds.length
    ? await supabaseAdmin
      .from("induction_progress")
      .select("user_id, declaration_accepted, signature, declaration_agreed_at")
      .in("user_id", workerIds)
    : { data: [], error: null };
  if (error) throw error;

  const progressByWorkerId = new Map((progressRows ?? []).map((row) => [row.user_id, row]));
  const signoffByWorkerId = new Map<string, { signature: string; signed_at: string | null; is_image: boolean } | null>();
  await Promise.all(workerIds.map(async (workerId) => {
    const progress = progressByWorkerId.get(workerId);
    if (!progress?.declaration_accepted || !progress.signature) {
      signoffByWorkerId.set(workerId, null);
      return;
    }

    let signature = String(progress.signature);
    let isImage = signature.startsWith("data:image/");
    if (signature === `${workerId}/signature.png`) {
      const { data, error: signingError } = await supabaseAdmin.storage
        .from("driver-documents")
        .createSignedUrl(signature, 10 * 60);
      if (signingError) throw signingError;
      if (!data?.signedUrl) throw new Error("Unable to prepare the driver's legal signature for display.");
      signature = data.signedUrl;
      isImage = true;
    }

    signoffByWorkerId.set(workerId, {
      signature,
      signed_at: progress.declaration_agreed_at ?? null,
      is_image: isImage
    });
  }));

  return records.map((record) => ({
    ...record,
    legal_signoff: record.worker_id ? signoffByWorkerId.get(record.worker_id) ?? null : null
  }));
}

const driverInductionAcknowledgementSchema = z.object({
  content: z.string(),
  acknowledged: z.boolean(),
  date: z.string().nullable(),
  source: z.enum(["driver"]).optional(),
  submittedBy: z.string().uuid().optional()
}).passthrough();

const inductionRecordSignatureSchema = z.object({
  signer: z.string(),
  signerRole: z.string(),
  signature: z.string(),
  signedAt: z.string().nullable(),
  source: z.enum(["driver"]).optional(),
  signerId: z.string().uuid().optional()
}).passthrough();

app.get("/api/driver/employee-induction-records", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("employee_induction_records")
      .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
      .eq("worker_id", request.authUserId!)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    response.json({ records: (data ?? []).map((record) => normalizeEmployeeInductionRecord(record)) });
  } catch (error) { next(error); }
});

app.post("/api/driver/employee-induction-records/:recordId/acknowledgement", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const recordId = z.string().uuid().parse(request.params.recordId);
    const payload = z.object({
      workerConfirmed: z.literal(true),
      signature: z.string().min(100).max(1_500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
    }).parse(request.body);
    const workerId = request.authUserId!;
    const [{ data: worker, error: workerError }, { data: record, error: recordError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, role, staff_role").eq("id", workerId).maybeSingle(),
      supabaseAdmin.from("employee_induction_records")
        .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
        .eq("id", recordId)
        .eq("worker_id", workerId)
        .maybeSingle()
    ]);
    if (workerError) throw workerError;
    if (recordError) throw recordError;
    if (!worker || worker.role !== "driver" || !record) {
      response.status(404).json({ message: "Induction record not found." });
      return;
    }

    const acknowledgements = driverInductionAcknowledgementSchema.array().parse(
      parseInductionRecordArray(record.acknowledgements, "acknowledgements")
    );
    const signatures = inductionRecordSignatureSchema.array().parse(
      parseInductionRecordArray(record.signatures, "signatures")
    );
    const existingSignature = signatures.find((signature) =>
      signature.source === "driver" && signature.signerId === workerId
    );
    if (existingSignature) {
      response.json({ record: normalizeEmployeeInductionRecord(record) });
      return;
    }

    const statements = acknowledgements
      .filter((acknowledgement) => acknowledgement.source !== "driver")
      .map((acknowledgement) => acknowledgement.content.trim())
      .filter(Boolean);
    const acknowledgementDate = new Date().toISOString();
    const acknowledgementContent = statements.length
      ? `I confirm that I have read and understood this Employee/Contractor Induction Record and acknowledge the following statements:\n\n${statements.map((statement) => `• ${statement}`).join("\n")}`
      : "I confirm that I have read and understood this Employee/Contractor Induction Record.";
    const nextAcknowledgements = [
      ...acknowledgements,
      {
        content: acknowledgementContent,
        acknowledged: true,
        date: acknowledgementDate,
        source: "driver" as const,
        submittedBy: workerId
      }
    ];
    const nextSignatures = [
      ...signatures,
      {
        signer: worker.full_name?.trim() || "Driver",
        signerRole: record.role?.trim() || record.staff_role || worker.staff_role || "Driver",
        signature: payload.signature,
        signedAt: acknowledgementDate,
        source: "driver" as const,
        signerId: workerId
      }
    ];
    const { data: updatedRecord, error: updateError } = await supabaseAdmin
      .from("employee_induction_records")
      .update({
        acknowledgements: nextAcknowledgements,
        signatures: nextSignatures,
        updated_at: acknowledgementDate
      })
      .eq("id", recordId)
      .eq("worker_id", workerId)
      .eq("updated_at", record.updated_at)
      .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedRecord) {
      response.status(409).json({ message: "This induction record changed while you were submitting. Reload it and try again." });
      return;
    }

    await logAuditEntry(workerId, "employee_induction_acknowledgement_recorded", { recordId });
    response.status(201).json({ record: normalizeEmployeeInductionRecord(updatedRecord) });
  } catch (error) { next(error); }
});

app.get("/api/admin/employee-induction-records", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const workerId = request.query.worker_id as string | undefined;
    let query = supabaseAdmin
      .from("employee_induction_records")
      .select("*")
      .order("updated_at", { ascending: false });
    if (workerId) {
      query = query.eq("worker_id", workerId);
    }
    const { data, error } = await query;
    if (error) throw error;
    const normalized = (data ?? []).map((record) => normalizeEmployeeInductionRecord(record));
    response.json({ records: await attachDriverLegalSignoffs(normalized) });
  } catch (error) { next(error); }
});

app.get("/api/admin/employee-induction-records/:recordId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("employee_induction_records")
      .select("*, worker:profiles!employee_induction_records_worker_id_fkey(id, full_name, email, phone, role, employment_type, staff_role, licence_class, licence_number, issuing_state, depot_location)")
      .eq("id", request.params.recordId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Induction record not found." });
      return;
    }
    const [record] = await attachDriverLegalSignoffs([normalizeEmployeeInductionRecord(data)]);
    response.json({ record });
  } catch (error) { next(error); }
});

app.post("/api/admin/employee-induction-records", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      worker_id: z.string().uuid(),
      employment_type: z.enum(["employee", "contractor"]),
      staff_role: z.enum(["driver", "warehouse", "office"]),
      contractor_company_id: z.string().uuid().optional().nullable(),
      role: z.string().max(200).optional().nullable(),
      checklist: z.array(z.object({
        id: z.string(),
        label: z.string(),
        answered: z.boolean(),
        status: z.enum(["pass", "fail", "n_a"]),
        notes: z.string()
      })).optional(),
      documents: z.array(z.object({
        documentType: z.string(),
        name: z.string(),
        category: z.string(),
        isMandatory: z.boolean(),
        status: z.string(),
        expiryDate: z.string().nullable(),
        uploadedAt: z.string().nullable(),
        uploadedFileUrl: z.string().nullable(),
        uploadedFileName: z.string().nullable(),
        rejectionReason: z.string().nullable()
      })).optional(),
      acknowledgements: z.array(z.object({
        content: z.string(),
        acknowledged: z.boolean(),
        date: z.string().nullable()
      })).optional(),
      signatures: z.array(z.object({
        signer: z.string(),
        signerRole: z.string(),
        signature: z.string(),
        signedAt: z.string().nullable()
      })).optional(),
      status: z.enum(["draft", "completed"]).optional(),
      induction_start_date: z.string().datetime().optional().nullable(),
      induction_completed_date: z.string().datetime().optional().nullable()
    });
    const payload = schema.parse(request.body);

    const { data, error } = await supabaseAdmin
      .from("employee_induction_records")
      .insert({
        worker_id: payload.worker_id,
        employment_type: payload.employment_type,
        staff_role: payload.staff_role,
        contractor_company_id: payload.contractor_company_id ?? null,
        role: payload.role ?? null,
        checklist: payload.checklist ?? [],
        documents: payload.documents ?? [],
        acknowledgements: payload.acknowledgements ?? [],
        signatures: payload.signatures ?? [],
        status: payload.status ?? "draft",
        induction_start_date: payload.induction_start_date ?? null,
        induction_completed_date: payload.induction_completed_date ?? null,
        created_by: request.authUserId
      })
      .select()
      .single();
    if (error) throw error;

    await logAuditEntry(request.authUserId!, "induction_record_created", { recordId: data.id, workerId: payload.worker_id });
    const [record] = await attachDriverLegalSignoffs([normalizeEmployeeInductionRecord(data)]);
    response.status(201).json({ record });
  } catch (error) { next(error); }
});

app.put("/api/admin/employee-induction-records/:recordId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      employment_type: z.enum(["employee", "contractor"]).optional(),
      staff_role: z.enum(["driver", "warehouse", "office"]).optional(),
      contractor_company_id: z.string().uuid().optional().nullable(),
      role: z.string().max(200).optional().nullable(),
      checklist: z.array(z.object({
        id: z.string(),
        label: z.string(),
        answered: z.boolean(),
        status: z.enum(["pass", "fail", "n_a"]),
        notes: z.string()
      })).optional(),
      documents: z.array(z.object({
        documentType: z.string(),
        name: z.string(),
        category: z.string(),
        isMandatory: z.boolean(),
        status: z.string(),
        expiryDate: z.string().nullable(),
        uploadedAt: z.string().nullable(),
        uploadedFileUrl: z.string().nullable(),
        uploadedFileName: z.string().nullable(),
        rejectionReason: z.string().nullable()
      })).optional(),
      acknowledgements: z.array(z.object({
        content: z.string(),
        acknowledged: z.boolean(),
        date: z.string().nullable(),
        source: z.enum(["driver"]).optional(),
        submittedBy: z.string().uuid().optional()
      }).passthrough()).optional(),
      signatures: z.array(z.object({
        signer: z.string(),
        signerRole: z.string(),
        signature: z.string(),
        signedAt: z.string().nullable(),
        source: z.enum(["driver"]).optional(),
        signerId: z.string().uuid().optional()
      }).passthrough()).optional(),
      status: z.enum(["draft", "completed"]).optional(),
      induction_start_date: z.string().datetime().optional().nullable(),
      induction_completed_date: z.string().datetime().optional().nullable()
    });
    const payload = schema.parse(request.body);

    const now = new Date().toISOString();
    const updateData: Record<string, any> = { updated_at: now };

    if (payload.employment_type) updateData.employment_type = payload.employment_type;
    if (payload.staff_role) updateData.staff_role = payload.staff_role;
    if (payload.contractor_company_id !== undefined) updateData.contractor_company_id = payload.contractor_company_id ?? null;
    if (payload.role !== undefined) updateData.role = payload.role ?? null;
    if (payload.checklist !== undefined) updateData.checklist = payload.checklist;
    if (payload.documents !== undefined) updateData.documents = payload.documents;
    if (payload.acknowledgements !== undefined) updateData.acknowledgements = payload.acknowledgements;
    if (payload.signatures !== undefined) updateData.signatures = payload.signatures;
    if (payload.status) updateData.status = payload.status;
    if (payload.induction_start_date !== undefined) updateData.induction_start_date = payload.induction_start_date ?? null;
    if (payload.induction_completed_date !== undefined) updateData.induction_completed_date = payload.induction_completed_date ?? null;

    const { data, error } = await supabaseAdmin
      .from("employee_induction_records")
      .update(updateData)
      .eq("id", request.params.recordId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Induction record not found." });
      return;
    }

    await logAuditEntry(request.authUserId!, "induction_record_updated", { recordId: request.params.recordId, changes: payload });
    const [record] = await attachDriverLegalSignoffs([normalizeEmployeeInductionRecord(data)]);
    response.json({ record });
  } catch (error) { next(error); }
});

app.delete("/api/admin/employee-induction-records/:recordId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("employee_induction_records")
      .delete()
      .eq("id", request.params.recordId);
    if (error) throw error;

    await logAuditEntry(request.authUserId!, "induction_record_deleted", { recordId: request.params.recordId });
    response.json({ message: "Induction record deleted." });
  } catch (error) { next(error); }
});

app.get("/api/admin/compliance-reviews", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("quarterly_compliance_reviews")
      .select("*")
      .order("review_year", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    response.json({ reviews: data ?? [] });
  } catch (error) { next(error); }
});

app.post("/api/admin/compliance-reviews", requireAdmin, rateLimit(20, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const input = quarterlyReviewInputSchema.parse(request.body);
    const companyDetails = normalizeQuarterlyCompanyDetails(input.companyDetails, input.year, input.quarter);
    if (companyDetails.operator || companyDetails.abn) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("quarterly_compliance_reviews")
        .select("id, company_details")
        .eq("review_quarter", input.quarter)
        .eq("review_year", input.year);
      if (existingError) throw existingError;
      const duplicate = (existing ?? []).find((row: any) => {
        const current = row.company_details ?? {};
        return (current.operator || current.name) === companyDetails.operator ||
          (current.abn || current.abnAcn) === companyDetails.abn;
      });
      if (duplicate) {
        response.status(409).json({ message: "A quarterly compliance review already exists for this company and period." });
        return;
      }
    }
    const { data, error } = await supabaseAdmin.from("quarterly_compliance_reviews").insert({
      review_quarter: input.quarter,
      review_year: input.year,
      company_details: companyDetails,
      section_data: input.sections,
      acknowledgement: input.acknowledgement,
      status: "draft",
      created_by: request.authUserId
    }).select("*").single();
    if (error) throw error;
    await logAuditEntry(request.authUserId!, "quarterly_compliance_review_created", { reviewId: data.id });
    response.status(201).json({ review: data });
  } catch (error) { next(error); }
});

app.put("/api/admin/compliance-reviews/:reviewId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const input = quarterlyReviewInputSchema.parse(request.body);
    const companyDetails = normalizeQuarterlyCompanyDetails(input.companyDetails, input.year, input.quarter);
    const { data, error } = await supabaseAdmin.from("quarterly_compliance_reviews").update({
      review_quarter: input.quarter,
      review_year: input.year,
      company_details: companyDetails,
      section_data: input.sections,
      acknowledgement: input.acknowledgement,
      updated_at: new Date().toISOString()
    }).eq("id", request.params.reviewId).eq("status", "draft").select("*").maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(409).json({ message: "Only draft reviews can be edited." });
      return;
    }
    await logAuditEntry(request.authUserId!, "quarterly_compliance_review_draft_updated", { reviewId: data.id });
    response.json({ review: data });
  } catch (error) { next(error); }
});

app.post("/api/admin/compliance-reviews/:reviewId/submit", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const input = quarterlyReviewSubmissionSchema.parse(request.body);
    const submittedAt = new Date();
    const retentionExpiresAt = addCalendarYears(submittedAt, 3);
    const companyDetails = normalizeQuarterlyCompanyDetails(input.companyDetails, input.year, input.quarter);
    const { data, error } = await supabaseAdmin.from("quarterly_compliance_reviews").update({
      review_quarter: input.quarter,
      review_year: input.year,
      company_details: companyDetails,
      section_data: input.sections,
      acknowledgement: input.acknowledgement,
      status: "submitted",
      submitted_at: submittedAt.toISOString(),
      retention_expires_at: retentionExpiresAt.toISOString(),
      updated_at: submittedAt.toISOString()
    }).eq("id", request.params.reviewId).eq("status", "draft").select("*").maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(409).json({ message: "This review is no longer a draft and cannot be submitted again." });
      return;
    }
    await logAuditEntry(request.authUserId!, "quarterly_compliance_review_submitted", { reviewId: data.id, retentionExpiresAt: data.retention_expires_at });
    response.json({ review: data });
  } catch (error) { next(error); }
});

app.get("/api/admin/compliance-reviews/:reviewId/pdf", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("quarterly_compliance_reviews")
      .select("*").eq("id", request.params.reviewId).maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Quarterly compliance review not found." });
      return;
    }
    if (data.status !== "submitted") {
      response.status(409).json({ message: "Submit the review before generating its official PDF report." });
      return;
    }
    const pdf = generateQuarterlyCompliancePdf({
      quarter: data.review_quarter,
      year: data.review_year,
      company: data.company_details ?? {},
      sections: data.section_data ?? [],
      acknowledgement: data.acknowledgement ?? {},
      submittedAt: data.submitted_at
    });
    await logAuditEntry(request.authUserId!, "quarterly_compliance_review_pdf_generated", { reviewId: data.id });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="BNT-Quarterly-Review-${data.review_quarter}-${data.review_year}.pdf"`);
    response.send(pdf);
  } catch (error) { next(error); }
});

// ============================================================
// ANNUAL SYSTEM REVIEW (COR) — Due December
// ============================================================

app.get("/api/admin/annual-system-reviews", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("annual_system_reviews")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    response.json({ reviews: (data ?? []) as any[] });
  } catch (error) { next(error); }
});

app.post("/api/admin/annual-system-reviews", requireAdmin, rateLimit(20, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const { reviewYear, companyDetails, requirements, followUp, acknowledgement } = request.body as any;
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("annual_system_reviews")
      .insert({
        review_year: Number(reviewYear),
        company_details: companyDetails,
        requirements,
        follow_up: followUp,
        acknowledgement,
        status: "draft",
        created_by: request.authUserId,
        created_at: now,
        updated_at: now
      })
      .select("*")
      .single();
    if (error) throw error;
    response.status(201).json({ review: data as any });
  } catch (error) { next(error); }
});

app.put("/api/admin/annual-system-reviews/:reviewId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { reviewId } = request.params as any;
    const { reviewYear, companyDetails, requirements, followUp, acknowledgement } = request.body as any;
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("annual_system_reviews")
      .update({
        review_year: Number(reviewYear),
        company_details: companyDetails,
        requirements,
        follow_up: followUp,
        acknowledgement,
        updated_at: now
      })
      .eq("id", reviewId)
      .eq("status", "draft")
      .select("*")
      .single();
    if (error) throw error;
    if (!data) { response.status(409).json({ message: "Review not found or already submitted." }); return; }
    response.json({ review: data as any });
  } catch (error) { next(error); }
});

app.post("/api/admin/annual-system-reviews/:reviewId/submit", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { reviewId } = request.params as any;
    const submittedAt = new Date();
    const now = submittedAt.toISOString();
    const retentionExpiresAt = addCalendarYears(submittedAt, 3).toISOString();

    const { data, error } = await supabaseAdmin
      .from("annual_system_reviews")
      .update({
        status: "submitted",
        submitted_at: now,
        retention_expires_at: retentionExpiresAt,
        updated_at: now
      })
      .eq("id", reviewId)
      .eq("status", "draft")
      .select("*")
      .single();
    if (error) throw error;
    if (!data) { response.status(409).json({ message: "Review not found or already submitted." }); return; }
    await logAuditEntry(request.authUserId!, "annual_system_review_submit", { reviewId, reviewYear: data.review_year });
    response.json({ review: data as any });
  } catch (error) { next(error); }
});

app.get("/api/admin/annual-system-reviews/:reviewId/pdf", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { reviewId } = request.params as any;

    const { data, error } = await supabaseAdmin
      .from("annual_system_reviews")
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();
    if (error) throw error;
    if (!data) { response.status(404).json({ message: "Annual system review not found." }); return; }

    const pdf = generateAnnualSystemReviewPdf({
      reviewYear: data.review_year,
      company: data.company_details as Record<string, unknown>,
      requirements: data.requirements as Array<Record<string, unknown>>,
      followUp: data.follow_up as Array<Record<string, unknown>>,
      acknowledgement: data.acknowledgement as Record<string, unknown>,
      submittedAt: data.submitted_at ?? null
    });

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="BNT-Annual-System-Review-${data.review_year}.pdf"`);
    response.status(200).send(pdf);
  } catch (error) { next(error); }
});

app.get("/api/leave/me", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("leave_requests")
      .select("id, leave_type, start_date, end_date, reason, status, decision_reason, reviewed_at, created_at")
      .eq("user_id", request.authUserId!)
      .order("created_at", { ascending: false });
    if (error) throw error;
    response.json({ requests: data ?? [] });
  } catch (error) { next(error); }
});

app.post("/api/leave/me", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const input = leaveRequestInput.parse(request.body);
    const { data, error } = await supabaseAdmin.rpc("submit_leave_request", {
      p_user_id: request.authUserId!,
      p_leave_type: input.leaveType,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_reason: input.reason
    });
    if (error) {
      if (/overlaps an existing/i.test(error.message)) {
        response.status(409).json({ message: error.message });
        return;
      }
      throw error;
    }
    await logAuditEntry(request.authUserId!, "leave_request_submitted", { leaveRequestId: data.id, leaveType: input.leaveType });
    response.status(201).json({ request: data });
  } catch (error) { next(error); }
});

app.put("/api/leave/me/:requestId/cancel", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("leave_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", request.params.requestId)
      .eq("user_id", request.authUserId!)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(409).json({ message: "Only your pending leave requests can be cancelled." });
      return;
    }
    await logAuditEntry(request.authUserId!, "leave_request_cancelled", { leaveRequestId: data.id });
    response.json({ message: "Leave request cancelled." });
  } catch (error) { next(error); }
});

app.get("/api/attendance/me", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("worksite_attendance")
      .select("*")
      .eq("user_id", request.authUserId!)
      .order("signin_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const worksiteIds = Array.from(new Set((rows ?? []).map((row) => row.worksite_id).filter(Boolean)));
    const { data: worksites, error: worksitesError } = worksiteIds.length
      ? await supabaseAdmin.from("worksites").select("id, name").in("id", worksiteIds)
      : { data: [], error: null };
    if (worksitesError) throw worksitesError;
    const worksiteNames = new Map((worksites ?? []).map((site) => [String(site.id), String(site.name)]));
    response.json({ records: (rows ?? []).map((row) => mapAttendanceRecord(row, worksiteNames.get(String(row.worksite_id ?? "")))) });
  } catch (error) { next(error); }
});

app.post("/api/attendance/me/legacy-import", requireDriver, rateLimit(5, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      records: z.array(z.object({
        id: z.string().min(1).max(120),
        depotName: z.string().trim().min(1).max(160),
        vehicleRego: z.string().trim().max(24).default(""),
        checkinTime: z.string().datetime({ offset: true }),
        checkoutTime: z.string().datetime({ offset: true }).nullable().optional(),
        hoursDrivenToday: z.number().min(0).max(24).default(0),
        hoursRestedLast24h: z.number().min(0).max(24).default(0),
        fitnessDeclaration: z.boolean().default(false),
        status: z.enum(["Active", "Checked Out"])
      })).max(500)
    });
    const { records } = schema.parse(request.body);
    if (records.length === 0) { response.json({ imported: 0 }); return; }
    const ids = records.map((record) => `local:${request.authUserId}:${record.id}`);
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("worksite_attendance")
      .select("legacy_id")
      .eq("user_id", request.authUserId!)
      .in("legacy_id", ids);
    if (lookupError) throw lookupError;
    const knownIds = new Set((existing ?? []).map((row) => String(row.legacy_id)));
    const pending = records.filter((record, index) => !knownIds.has(ids[index]));
    if (pending.length === 0) { response.json({ imported: 0 }); return; }
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", request.authUserId!)
      .maybeSingle();
    if (profileError) throw profileError;
    const rows = pending.map((record) => ({
      user_id: request.authUserId,
      driver_name: profile?.full_name ?? "Driver",
      location_name: record.depotName,
      vehicle_rego: record.vehicleRego,
      signin_at: record.checkinTime,
      signout_at: record.status === "Checked Out" ? record.checkoutTime ?? record.checkinTime : null,
      status: record.status === "Active" ? "signed_in" : "signed_out",
      duration_minutes: record.status === "Checked Out"
        ? calculateDurationMinutes(record.checkinTime, record.checkoutTime ?? record.checkinTime)
        : null,
      hours_driven_today: record.hoursDrivenToday,
      hours_rested_last_24h: record.hoursRestedLast24h,
      fitness_declaration: record.fitnessDeclaration,
      attendance_source: "legacy",
      legacy_id: `local:${request.authUserId}:${record.id}`
    }));
    const { error } = await supabaseAdmin.from("worksite_attendance").upsert(rows, {
      onConflict: "legacy_id",
      ignoreDuplicates: true
    });
    if (error) throw error;
    response.json({ imported: rows.length });
  } catch (error) { next(error); }
});

app.post("/api/attendance/me", requireDriver, rateLimit(20, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      depotName: z.string().trim().min(1).max(160).refine(isAttendanceLocation, "Select an available BNT worksite."),
      vehicleRego: z.string().trim().min(1).max(24),
      hoursDrivenToday: z.number().min(0).max(12),
      hoursRestedLast24h: z.number().min(0).max(24),
      fitnessDeclaration: z.literal(true)
    });
    const input = schema.parse(request.body);
    const { data: activeRecord, error: activeError } = await supabaseAdmin
      .from("worksite_attendance")
      .select("id")
      .eq("user_id", request.authUserId!)
      .eq("status", "signed_in")
      .limit(1)
      .maybeSingle();
    if (activeError) throw activeError;
    if (activeRecord) { response.status(409).json({ message: "Sign out of your current attendance record before checking in again." }); return; }

    const [{ data: profile, error: profileError }, { data: vehicles, error: vehicleError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name").eq("id", request.authUserId!).maybeSingle(),
      supabaseAdmin.from("driver_vehicles").select("rego, status").eq("user_id", request.authUserId!)
    ]);
    if (profileError) throw profileError;
    if (vehicleError) throw vehicleError;
    const vehicle = (vehicles ?? []).find((row) => String(row.rego).toUpperCase() === input.vehicleRego.toUpperCase());
    if ((vehicles ?? []).length > 0 && !vehicle) { response.status(400).json({ message: "Select one of your registered vehicles." }); return; }
    if (vehicle?.status === "Maintenance Required") { response.status(400).json({ message: "This vehicle is marked for maintenance and cannot be used to check in." }); return; }
    const { data, error } = await supabaseAdmin.from("worksite_attendance").insert({
      user_id: request.authUserId,
      driver_name: profile?.full_name ?? "Driver",
      location_name: input.depotName,
      vehicle_rego: input.vehicleRego.toUpperCase(),
      signin_at: new Date().toISOString(),
      status: "signed_in",
      attendance_source: "portal",
      hours_driven_today: input.hoursDrivenToday,
      hours_rested_last_24h: input.hoursRestedLast24h,
      fitness_declaration: true
    }).select("*").single();
    if (error?.code === "23505") { response.status(409).json({ message: "You already have an active attendance check-in." }); return; }
    if (error) throw error;
    await logAuditEntry(request.authUserId!, "attendance_checked_in", { attendanceId: data.id });
    response.status(201).json({ record: mapAttendanceRecord(data, input.depotName) });
  } catch (error) { next(error); }
});

app.put("/api/attendance/me/:attendanceId/checkout", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data: current, error: readError } = await supabaseAdmin
      .from("worksite_attendance")
      .select("id, signin_at")
      .eq("id", request.params.attendanceId)
      .eq("user_id", request.authUserId!)
      .eq("status", "signed_in")
      .maybeSingle();
    if (readError) throw readError;
    if (!current) { response.status(404).json({ message: "Active attendance record not found." }); return; }
    const signoutAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("worksite_attendance")
      .update({ signout_at: signoutAt, status: "signed_out", duration_minutes: calculateDurationMinutes(current.signin_at, signoutAt), updated_at: signoutAt })
      .eq("id", current.id)
      .eq("user_id", request.authUserId!)
      .eq("status", "signed_in")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) { response.status(409).json({ message: "Attendance record was already signed out." }); return; }
    await logAuditEntry(request.authUserId!, "attendance_checked_out", { attendanceId: data.id });
    response.json({ record: mapAttendanceRecord(data, data.location_name) });
  } catch (error) { next(error); }
});

app.get("/api/admin/leave-requests", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const status = request.query.status ? z.enum(["pending", "approved", "rejected", "cancelled", "all"]).parse(request.query.status) : "all";
    let query = supabaseAdmin.from("leave_requests").select("*").order("created_at", { ascending: false }).limit(2000);
    if (status !== "all") query = query.eq("status", status);
    const { data: requests, error } = await query;
    if (error) throw error;
    const userIds = Array.from(new Set((requests ?? []).map((row) => String(row.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileMap = new Map((profiles ?? []).map((profile) => [String(profile.id), profile]));
    response.json({ requests: (requests ?? []).map((row) => ({ ...row, employee: profileMap.get(String(row.user_id)) ?? null })) });
  } catch (error) { next(error); }
});

app.put("/api/admin/leave-requests/:requestId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const input = z.object({
      status: z.enum(["approved", "rejected"]),
      decisionReason: z.string().trim().max(2000).optional()
    }).refine((value) => value.status !== "rejected" || Boolean(value.decisionReason?.trim()), {
      message: "A reason is required when rejecting a leave request.",
      path: ["decisionReason"]
    }).parse(request.body);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("leave_requests")
      .update({ status: input.status, decision_reason: input.decisionReason?.trim() || null, reviewed_by: request.authUserId, reviewed_at: now, updated_at: now })
      .eq("id", request.params.requestId)
      .eq("status", "pending")
      .select("id, user_id, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) { response.status(409).json({ message: "This leave request has already been reviewed or no longer exists." }); return; }
    await logAuditEntry(request.authUserId!, `leave_request_${input.status}`, { leaveRequestId: data.id, driverId: data.user_id });
    response.json({ request: data });
  } catch (error) { next(error); }
});

app.get("/api/admin/attendance", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const querySchema = z.object({
      from: z.string().refine((value) => Boolean(parseDateOnly(value)), "Invalid start date.").optional(),
      to: z.string().refine((value) => Boolean(parseDateOnly(value)), "Invalid end date.").optional()
    });
    const { from, to } = querySchema.parse(request.query);
    if (from && to && from > to) { response.status(400).json({ message: "End date must be on or after start date." }); return; }
    let query = supabaseAdmin.from("worksite_attendance").select("*").order("signin_at", { ascending: false }).limit(5000);
    if (from) query = query.gte("signin_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lte("signin_at", `${to}T23:59:59.999Z`);
    const { data: rows, error } = await query;
    if (error) throw error;
    const worksiteIds = Array.from(new Set((rows ?? []).map((row) => row.worksite_id).filter(Boolean)));
    const { data: worksites, error: worksitesError } = worksiteIds.length
      ? await supabaseAdmin.from("worksites").select("id, name").in("id", worksiteIds)
      : { data: [], error: null };
    if (worksitesError) throw worksitesError;
    const names = new Map((worksites ?? []).map((site) => [String(site.id), String(site.name)]));
    response.json({ records: (rows ?? []).map((row) => ({ ...mapAttendanceRecord(row, names.get(String(row.worksite_id ?? ""))), userId: String(row.user_id) })) });
  } catch (error) { next(error); }
});

app.put("/api/admin/attendance/:attendanceId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      depotName: z.string().trim().min(1).max(160),
      vehicleRego: z.string().trim().max(24),
      checkinTime: z.string().datetime({ offset: true }),
      checkoutTime: z.string().datetime({ offset: true }).nullable(),
      status: z.enum(["Active", "Checked Out"]),
      hoursDrivenToday: z.number().min(0).max(24),
      hoursRestedLast24h: z.number().min(0).max(24),
      fitnessDeclaration: z.boolean()
    });
    const input = schema.parse(request.body);
    const checkoutTime = input.status === "Active" ? null : input.checkoutTime;
    if (input.status === "Checked Out" && !checkoutTime) {
      response.status(400).json({ message: "Enter a checkout time for a checked-out record." });
      return;
    }
    const duration = checkoutTime ? calculateDurationMinutes(input.checkinTime, checkoutTime) : null;
    if (checkoutTime && duration === null) { response.status(400).json({ message: "Checkout time must be after check-in time." }); return; }
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("worksite_attendance").update({
      location_name: input.depotName,
      vehicle_rego: input.vehicleRego,
      signin_at: input.checkinTime,
      signout_at: checkoutTime,
      status: toAttendanceDbStatus(input.status),
      duration_minutes: duration,
      hours_driven_today: input.hoursDrivenToday,
      hours_rested_last_24h: input.hoursRestedLast24h,
      fitness_declaration: input.fitnessDeclaration,
      edited_by: request.authUserId,
      edited_at: now,
      updated_at: now
    }).eq("id", request.params.attendanceId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) { response.status(404).json({ message: "Attendance record not found." }); return; }
    await logAuditEntry(request.authUserId!, "admin_attendance_record_updated", { attendanceId: data.id, driverId: data.user_id });
    response.json({ record: { ...mapAttendanceRecord(data, input.depotName), userId: String(data.user_id) } });
  } catch (error) { next(error); }
});

app.get("/api/payroll/me/status", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("employment_type").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.employment_type === "contractor") { response.status(403).json({ message: "Employee payroll onboarding is not available to contractors." }); return; }
    const { data, error } = await supabaseAdmin.from("employee_payroll_details").select("super_fund_choice, tax_declaration_confirmed_at, payroll_updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    response.json({ saved: Boolean(data), superFundChoice: data?.super_fund_choice ?? null, taxDeclarationConfirmed: Boolean(data?.tax_declaration_confirmed_at), updatedAt: data?.payroll_updated_at ?? null });
  } catch (error) { next(error); }
});

app.put("/api/payroll/me", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("employment_type").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.employment_type === "contractor") { response.status(403).json({ message: "Employee payroll onboarding is not available to contractors." }); return; }
    const input = z.object({
      tfn: z.string().trim().regex(/^\d{8,9}$/),
      bankAccountName: z.string().trim().min(2).max(120),
      bankBsb: z.string().trim().regex(/^\d{6}$/),
      bankAccountNumber: z.string().trim().regex(/^\d{5,10}$/),
      superFundChoice: z.enum(["default", "existing", "self_managed"]),
      superFundName: z.string().trim().max(120).optional(),
      superMemberNumber: z.string().trim().max(80).optional(),
      taxDeclarationConfirmed: z.literal(true)
    }).parse(request.body);
    // Fail closed if the encryption key is missing or invalid, before writing any data.
    const encryptionKey = getPayrollEncryptionKey(process.env.PAYROLL_ENCRYPTION_KEY);
    if (input.superFundChoice !== "default" && (!input.superFundName || !input.superMemberNumber)) {
      response.status(400).json({ message: "Enter your fund name and member number for the selected superannuation option." }); return;
    }
    const { data: existing, error: existingError } = await supabaseAdmin.from("employee_payroll_details").select("*").eq("user_id", userId).maybeSingle();
    if (existingError) throw existingError;
    const encrypted = (value: string | undefined, previous: string | null) => value ? encryptPayrollValue(value, encryptionKey) : previous;
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("employee_payroll_details").upsert({
      user_id: userId,
      tfn_ciphertext: encrypted(input.tfn, existing?.tfn_ciphertext ?? null),
      bank_account_name_ciphertext: encrypted(input.bankAccountName, existing?.bank_account_name_ciphertext ?? null),
      bank_bsb_ciphertext: encrypted(input.bankBsb, existing?.bank_bsb_ciphertext ?? null),
      bank_account_number_ciphertext: encrypted(input.bankAccountNumber, existing?.bank_account_number_ciphertext ?? null),
      super_fund_choice: input.superFundChoice,
      super_fund_name_ciphertext: encrypted(input.superFundName, existing?.super_fund_name_ciphertext ?? null),
      super_member_number_ciphertext: encrypted(input.superMemberNumber, existing?.super_member_number_ciphertext ?? null),
      tax_declaration_confirmed_at: now, payroll_updated_at: now,
      retention_expires_at: existing?.retention_expires_at ?? new Date(Date.now() + 7 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
    });
    if (error) throw error;
    await logAuditEntry(userId, "employee_payroll_details_submitted", { fields: Object.keys(input).filter((key) => key !== "taxDeclarationConfirmed"), changedBy: userId });
    response.json({ message: "Payroll and superannuation details saved securely." });
  } catch (error) { next(error); }
});

app.get("/api/payroll/employees/:employeeId", requirePayrollAccess, async (request: AdminRequest, response, next) => {
  try {
    const employeeId = String(request.params.employeeId);
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("employment_type, full_name").eq("id", employeeId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.employment_type === "contractor") { response.status(404).json({ message: "Employee payroll record not found." }); return; }
    const { data, error } = await supabaseAdmin.from("employee_payroll_details").select("*").eq("user_id", employeeId).maybeSingle();
    if (error) throw error;
    if (!data) { response.status(404).json({ message: "Employee payroll record not found." }); return; }
    const encryptionKey = getPayrollEncryptionKey(process.env.PAYROLL_ENCRYPTION_KEY);
    await logAuditEntry(request.authUserId!, "employee_payroll_details_accessed", { employeeId });
    response.set("Cache-Control", "no-store, private").set("Pragma", "no-cache");
    response.json({ employeeId, employeeName: profile.full_name, tfn: decryptPayrollValue(data.tfn_ciphertext, encryptionKey), bankAccountName: decryptPayrollValue(data.bank_account_name_ciphertext, encryptionKey), bankBsb: decryptPayrollValue(data.bank_bsb_ciphertext, encryptionKey), bankAccountNumber: decryptPayrollValue(data.bank_account_number_ciphertext, encryptionKey), superFundChoice: data.super_fund_choice, superFundName: decryptPayrollValue(data.super_fund_name_ciphertext, encryptionKey), superMemberNumber: decryptPayrollValue(data.super_member_number_ciphertext, encryptionKey), taxDeclarationConfirmedAt: data.tax_declaration_confirmed_at, updatedAt: data.payroll_updated_at });
  } catch (error) { next(error); }
});

app.get("/api/admin/payroll/status", requireAdmin, async (_request, response, next) => {
  try {
    const [{ data: employees, error: employeesError }, { data: payrollRows, error: payrollError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, employment_start_date").eq("role", "driver").or("employment_type.eq.employee,employment_type.is.null").neq("full_name", "[DELETED]").order("full_name"),
      supabaseAdmin.from("employee_payroll_details").select("user_id, tfn_ciphertext, bank_account_number_ciphertext, tax_declaration_confirmed_at")
    ]);
    if (employeesError) throw employeesError;
    if (payrollError) throw payrollError;
    const rowsById = new Map((payrollRows ?? []).map((row) => [row.user_id, row]));
    response.json({ employees: (employees ?? []).map((employee) => {
      const record = rowsById.get(employee.id);
      return { id: employee.id, name: employee.full_name, email: employee.email, payrollSetupComplete: Boolean(record?.tfn_ciphertext && record?.bank_account_number_ciphertext && record?.tax_declaration_confirmed_at) };
    }) });
  } catch (error) { next(error); }
});

app.get("/api/admin/payroll/access", requireAdmin, async (_request, response, next) => {
  try {
    const [{ data: admins, error: adminsError }, { data: accessRows, error: accessError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email").eq("role", "admin").neq("full_name", "[DELETED]").order("full_name"),
      supabaseAdmin.from("employee_payroll_access").select("user_id, granted_at")
    ]);
    if (adminsError) throw adminsError;
    if (accessError) throw accessError;
    const access = new Map((accessRows ?? []).map((row) => [row.user_id, row.granted_at]));
    response.json({ admins: (admins ?? []).map((admin) => ({ id: admin.id, name: admin.full_name, email: admin.email, payrollAccess: access.has(admin.id), grantedAt: access.get(admin.id) ?? null })) });
  } catch (error) { next(error); }
});

app.put("/api/admin/payroll-access/:userId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const userId = String(request.params.userId);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== "admin") { response.status(400).json({ message: "Payroll access can only be assigned to an existing admin account." }); return; }
    const result = enabled
      ? await supabaseAdmin.from("employee_payroll_access").upsert({ user_id: userId, granted_by: request.authUserId, granted_at: new Date().toISOString() })
      : await supabaseAdmin.from("employee_payroll_access").delete().eq("user_id", userId);
    if (result.error) throw result.error;
    await logAuditEntry(request.authUserId!, enabled ? "payroll_access_granted" : "payroll_access_revoked", { targetUserId: userId });
    response.json({ message: enabled ? "Payroll access granted." : "Payroll access revoked." });
  } catch (error) { next(error); }
});

app.post("/api/driver/policy-signatures", requireDriver, rateLimit(15, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const { versionId, signature } = z.object({ versionId: z.string().uuid(), signature: z.string().trim().min(2).max(200) }).parse(request.body);
    const userId = request.authUserId!;
    const [{ data: version, error: versionError }, { data: profile, error: profileError }, { data: membership, error: membershipError }] = await Promise.all([
      supabaseAdmin.from("policy_versions").select("id, policy_id, version_label").eq("id", versionId).maybeSingle(),
      supabaseAdmin.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle()
    ]);
    if (versionError) throw versionError;
    if (profileError) throw profileError;
    if (membershipError) throw membershipError;
    if (!version || !profile) { response.status(404).json({ message: "Published policy version not found." }); return; }
    const { data: policy, error: policyError } = await supabaseAdmin.from("policies").select("id, title, name, audience, target_role, is_published, status").eq("id", version.policy_id).maybeSingle();
    if (policyError) throw policyError;
    if (!policy || !(policy.is_published ?? policy.status === "published")) { response.status(409).json({ message: "This policy version is not published." }); return; }
    const employmentType = profile.employment_type === "contractor" || membership ? "contractor" : "employee";
    if (policy.audience && policy.audience !== "all" && policy.audience !== employmentType) { response.status(403).json({ message: "This policy is not assigned to your employment type." }); return; }
    if (policy.target_role && policy.target_role !== "all" && policy.target_role !== (profile.staff_role ?? "driver")) { response.status(403).json({ message: "This policy is not assigned to your staff role." }); return; }
    let agreementContext: Record<string, string> = {};
    const policyName = String(policy.name ?? policy.title ?? "").toLowerCase();
    if (employmentType === "contractor" && policyName.includes("contractor services agreement")) {
      if (!membership?.company_id) { response.status(400).json({ message: "Link a contractor company before signing its agreement." }); return; }
      const { data: company, error: companyError } = await supabaseAdmin.from("contractor_companies").select("agreement_file_path, agreement_expiry, agreement_status").eq("id", membership.company_id).single();
      if (companyError) throw companyError;
      if (!company.agreement_file_path || company.agreement_status !== "approved" || !isCurrentCalendarDate(company.agreement_expiry)) { response.status(400).json({ message: "A current, approved company agreement must be uploaded before signing." }); return; }
      agreementContext = { contractor_company_id: membership.company_id, contractor_agreement_file_path: String(company.agreement_file_path) };
    }
    const signedAt = new Date().toISOString();
    let { error } = await supabaseAdmin.from("policy_signatures").insert({ policy_version_id: versionId, user_id: userId, signature_text: signature, signed_at: signedAt, ...agreementContext });
    if (error?.code === "42703") {
      const fallback = await supabaseAdmin.from("policy_signatures").insert({ policy_id: versionId, driver_id: userId, signature_text: signature, signed_at: signedAt });
      error = fallback.error;
    }
    if (error) throw error;
    await logAuditEntry(userId, "policy_version_signed", { policyVersionId: versionId, policyId: version.policy_id, employmentType, signedAt });
    response.json({ message: "Policy signed.", policyVersionId: versionId, signedAt });
  } catch (error) { next(error); }
});

app.put("/api/driver/learning-question-response", requireDriver, rateLimit(120, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const payload = z.object({
      sectionId: z.string().trim().min(1).max(100),
      questionId: z.string().trim().min(1).max(100),
      response: z.string().max(2000)
    }).parse(request.body);
    const userId = request.authUserId!;
    const { data: section, error: sectionError } = await supabaseAdmin
      .from("learning_sections")
      .select("media_json")
      .eq("id", payload.sectionId)
      .maybeSingle();
    if (sectionError) throw sectionError;
    if (!section) { response.status(404).json({ message: "The lesson could not be found." }); return; }
    const questions = Array.isArray(section.media_json?.questions) ? section.media_json.questions : [];
    const question = questions.find((item: any) =>
      String(item?.id ?? "") === payload.questionId &&
      (item?.questionType ?? item?.question_type) === "text_input"
    );
    if (!question) { response.status(400).json({ message: "This lesson does not contain that text-input question." }); return; }

    const { error } = await supabaseAdmin.rpc("save_learning_question_response", {
      p_user_id: userId,
      p_section_id: payload.sectionId,
      p_question_id: payload.questionId,
      p_response: payload.response
    });
    if (error) throw error;
    response.json({ message: "Answer saved." });
  } catch (error) { next(error); }
});

app.post("/api/driver/documents", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const payload = z.object({
      type: z.enum(["driver_license", "medical_certificate", "identity_proof", "driving_history", "right_to_work", "nhvas_bfm_certificate", "dangerous_goods_license", "hrwl_forklift", "identity_selfie", "employment_contract"]),
      fileUrl: z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      sizeBytes: z.number().int().positive().max(5 * 1024 * 1024)
    }).parse(request.body);
    const driverId = request.authUserId!;
    if (!payload.fileUrl.startsWith(`${driverId}/`)) {
      response.status(403).json({ message: "You can only submit documents stored in your own folder." });
      return;
    }
    const { data: uploadedFile, error: fileError } = await supabaseAdmin.storage.from("driver-documents").download(payload.fileUrl);
    if (fileError || !uploadedFile) { response.status(400).json({ message: "Uploaded document could not be verified." }); return; }
    const bytes = Buffer.from(await uploadedFile.arrayBuffer());
    const validFile = payload.mimeType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
      : payload.mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (bytes.length !== payload.sizeBytes || !validFile) {
      await supabaseAdmin.storage.from("driver-documents").remove([payload.fileUrl]);
      response.status(400).json({ message: "File content, type, or size does not match the upload details." }); return;
    }

    const uploadedAt = new Date().toISOString();
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("user_id", driverId)
      .eq("type", payload.type)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: driverId,
        action: "document_replaced_history",
        metadata: {
          documentId: existing.id, type: existing.type, fileUrl: existing.file_url,
          fileName: existing.file_name, mimeType: existing.mime_type, sizeBytes: existing.size_bytes,
          status: existing.status, uploadedAt: existing.uploaded_at, expiresAt: existing.expires_at,
          verifiedAt: existing.verified_at, verifiedByUserId: existing.verified_by_user_id,
          rejectionReason: existing.rejection_reason
        },
        created_at: uploadedAt
      });
    }

    const documentData = {
      file_url: payload.fileUrl,
      file_name: payload.fileName,
      mime_type: payload.mimeType,
      size_bytes: payload.sizeBytes,
      status: "pending",
      uploaded_at: uploadedAt,
      verified_by_admin: false,
      verified_at: null,
      verified_by_user_id: null,
      rejection_reason: null,
      expires_at: null,
      work_rights_check_status: "not_checked",
      work_rights_check_method: null,
      work_rights_checked_at: null,
      work_rights_checked_by: null,
      retention_expires_at: new Date(Date.now() + 7 * 365.25 * 24 * 60 * 60 * 1000).toISOString()
    };

    const { data: saved, error: saveError } = existing
      ? await supabaseAdmin.from("documents").update(documentData).eq("id", existing.id).eq("user_id", driverId).select("id, status").maybeSingle()
      : await supabaseAdmin.from("documents").insert({ ...documentData, user_id: driverId, type: payload.type }).select("id, status").single();
    if (saveError) throw saveError;
    if (!saved || saved.status !== "pending") throw new Error("The replacement document could not be saved as pending.");

    response.json({ documentId: saved.id, status: saved.status });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Branding: public read, admin-managed appearance settings
// (company name, logo path, primary colour, welcome text)
// ============================================================

const DEFAULT_BRANDING = {
  id: "default",
  company_name: organizationName,
  logo_path: null as string | null,
  primary_color: "#1e3a5f",
  welcome_text: "",
  updated_at: null as string | null
};

/**
 * GET /api/branding
 * Public. Returns the branding row so the login page can show
 * the company logo, name and welcome text before sign-in.
 */
app.get("/api/branding", async (_request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("branding")
      .select("id, company_name, logo_path, primary_color, welcome_text, updated_at")
      .eq("id", "default")
      .maybeSingle();
    if (error) throw error;
    response.json({ branding: data ?? DEFAULT_BRANDING });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/branding
 * Admin only. Upserts the single branding row and records
 * an audit entry.
 */
app.put("/api/branding", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      company_name: z.string().min(1).max(100),
      logo_path: z.string().max(500).nullable().optional(),
      primary_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Primary colour must be a hex value like #1e3a5f"),
      welcome_text: z.string().max(500)
    });
    const payload = schema.parse(request.body);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("branding")
      .upsert(
        {
          id: "default",
          ...payload,
          updated_by: request.authUserId ?? null,
          updated_at: new Date().toISOString()
        },
        { onConflict: "id" }
      )
      .select("id, company_name, logo_path, primary_color, welcome_text, updated_at")
      .maybeSingle();
    if (updateError) throw updateError;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_branding_updated", {
        companyName: payload.company_name,
        hasLogo: Boolean(payload.logo_path)
      }).catch(() => {});
    }

    response.json({ message: "Branding updated.", branding: updated });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// MILESTONE 1: Versioned Inductions — Read current version (public)
// ============================================================

/**
 * GET /api/induction/version
 * Driver-facing. Returns the currently active induction version.
 * Drivers call this to detect if a newer version requires re-completion.
 */
app.get(["/api/induction/version", "/api/induction/status"], requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data: currentVersion, error } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label, revision_notes, published_at")
      .eq("is_current", true)
      .maybeSingle();

    if (error || !currentVersion) {
      response.json({ id: null, versionLabel: "1.0", revisionNotes: "", publishedAt: null, hasPendingVersion: false });
      return;
    }

    const { data: cert } = await supabaseAdmin
      .from("certificates")
      .select("induction_version_id")
      .eq("user_id", userId)
      // H-2 FIX: .maybeSingle() throws PostgrestError when user has >1 certificate.
      // Use .order().limit(1) to always get the latest certificate safely.
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: progress } = await supabaseAdmin
      .from("induction_progress")
      .select("induction_version_id, completed")
      .eq("user_id", userId)
      .maybeSingle();

    const driverVersionId = cert?.induction_version_id || progress?.induction_version_id;
    let hasPendingVersion = false;

    if ((cert || progress?.completed) && driverVersionId) {
      if (driverVersionId !== currentVersion.id) {
        // Fetch the old version's label to compare semantically
        const { data: oldVer } = await supabaseAdmin
          .from("induction_versions")
          .select("version_label")
          .eq("id", driverVersionId)
          .maybeSingle();
        
        if (oldVer && oldVer.version_label !== currentVersion.version_label) {
          hasPendingVersion = true;
        }
      }
    }

    response.json({
      id: currentVersion.id,
      versionLabel: currentVersion.version_label,
      revisionNotes: currentVersion.revision_notes,
      publishedAt: currentVersion.published_at,
      hasPendingVersion
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/induction-versions
 * Admin-facing. Lists all published induction versions, newest first.
 */
app.get("/api/admin/induction-versions", requireAdmin, async (_request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label, revision_notes, published_by, published_at, is_current, created_at")
      .order("published_at", { ascending: false });

    if (error) throw error;
    response.json({ versions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/induction-versions
 * Admin-facing. Publishes a new induction version.
 * Sets is_current = true on the new version, false on all others.
 * Drivers whose induction_progress.induction_version_id points to an older version
 * will be detected by GET /api/induction/version on next login.
 */
app.post("/api/admin/induction-versions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      versionLabel: z.string().min(1).max(32),
      revisionNotes: z.string().min(1).max(2000)
    });
    const { versionLabel, revisionNotes } = schema.parse(request.body);

    // Step 1 & 2: Atomically publish new version via RPC
    const { data: newVersionId, error: rpcError } = await supabaseAdmin.rpc("publish_induction_version", {
      label: versionLabel,
      notes: revisionNotes,
      publisher: request.authUserId ?? null
    });
    if (rpcError || !newVersionId) throw rpcError ?? new Error("Failed to publish induction version.");

    // Fetch the inserted row to return matching the previous structure
    const { data: newVersion, error: fetchError } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label, revision_notes, published_at")
      .eq("id", newVersionId)
      .single();
    if (fetchError || !newVersion) throw fetchError ?? new Error("Failed to fetch newly created version.");

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_induction_version_published", {
        newVersionId: newVersion.id,
        versionLabel,
        revisionNotes
      });
    }

    response.status(201).json({
      message: `Induction version ${versionLabel} published. Drivers will be prompted to re-complete induction on next login.`,
      version: newVersion
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// END OF MILESTONE 1: Versioned Inductions Routes
// ============================================================

app.get("/api/admin/contractors/companies", requireAdmin, async (_request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("contractor_companies").select("*").order("company_name");
    if (error) throw error;
    response.json({ companies: data ?? [] });
  } catch (error) { next(error); }
});

app.post("/api/admin/contractors/companies", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const payload = companyPayloadSchema.parse(request.body);
    if (!validateABN(payload.abn).isValid || !validateACN(payload.acn ?? "").isValid) { response.status(400).json({ message: "Enter a valid ABN and, when supplied, a valid 9 digit ACN." }); return; }
    const normalizedAbn = (payload.abn ?? "").replace(/\D/g, "");
    if (normalizedAbn) {
      const { data: existing, error: lookupError } = await supabaseAdmin.from("contractor_companies").select("id, company_name, trading_name, abn");
      if (lookupError) throw lookupError;
      const matches = (existing ?? []).filter((company) => String(company.abn ?? "").replace(/\D/g, "") === normalizedAbn);
      if (matches.length > 1) { response.status(409).json({ message: "Multiple company records already use this ABN. Review the existing records before saving." }); return; }
      const match = matches[0];
      if (match) {
        const { data: updated, error } = await supabaseAdmin.from("contractor_companies").update({ ...companyDbPayload(payload), public_liability_status: "pending", public_liability_rejection_reason: null, public_liability_reviewed_by: null, public_liability_reviewed_at: null, workers_comp_status: "pending", workers_comp_rejection_reason: null, workers_comp_reviewed_by: null, workers_comp_reviewed_at: null, agreement_status: "pending", agreement_rejection_reason: null, agreement_reviewed_by: null, agreement_reviewed_at: null, nhvas_status: payload.nhvasAccreditation === "None" ? "missing" : "pending", nhvas_rejection_reason: null, nhvas_reviewed_by: null, nhvas_reviewed_at: null, status: payload.status === "Suspended" || payload.status === "Inactive" ? payload.status : "Pending Review" }).eq("id", match.id).select("*").single();
        if (error) throw error;
        response.json({ company: updated }); return;
      }
    }
    const { data, error } = await supabaseAdmin.from("contractor_companies").insert({
      ...companyDbPayload(payload), abn: normalizedAbn,
      created_by: request.authUserId,
      status: "Pending Review"
    }).select("*").single();
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_contractor_company_created", { companyId: data.id });
    response.status(201).json({ company: data });
  } catch (error) { next(error); }
});

const companyPayloadSchema = z.object({
  companyName: z.string().trim().min(2), tradingName: z.string().trim().optional(), abn: z.string().trim().min(1), acn: z.string().trim().optional(),
  contactPerson: z.string().trim().optional(), email: z.string().trim().email().or(z.literal("")).optional(), phone: z.string().trim().optional(), address: z.string().trim().optional(),
  publicLiabilityPolicy: z.string().trim().optional(), publicLiabilityExpiry: z.string().trim().optional(), publicLiabilityFilePath: z.string().trim().optional(),
  workersCompPolicy: z.string().trim().optional(), workersCompExpiry: z.string().trim().optional(), workersCompFilePath: z.string().trim().optional(),
  nhvasAccreditation: z.enum(["Basic Fatigue", "Mass Management", "Maintenance Management", "None"]).optional(), nhvasNumber: z.string().trim().optional(), nhvasExpiry: z.string().trim().optional(), nhvasFilePath: z.string().trim().optional(),
  agreementExpiry: z.string().trim().optional(),
  primaryDepot: z.string().trim().optional(), status: z.enum(["Pending Review", "Compliant", "Suspended", "Inactive"]).optional()
});
function companyDbPayload(p: z.infer<typeof companyPayloadSchema>) {
  return {
    company_name: p.companyName, trading_name: p.tradingName ?? "", abn: (p.abn ?? "").replace(/\D/g, ""), acn: (p.acn ?? "").replace(/\D/g, ""),
    contact_person: p.contactPerson ?? "", email: p.email ?? "", phone: p.phone ?? "", address: p.address ?? "",
    public_liability_policy: p.publicLiabilityPolicy ?? "", public_liability_expiry: p.publicLiabilityExpiry || null,
    ...(p.publicLiabilityFilePath !== undefined ? { public_liability_file_path: p.publicLiabilityFilePath || null } : {}),
    workers_comp_policy: p.workersCompPolicy ?? "", workers_comp_expiry: p.workersCompExpiry || null,
    ...(p.workersCompFilePath !== undefined ? { workers_comp_file_path: p.workersCompFilePath || null } : {}),
    ...(p.nhvasAccreditation ? { nhvas_accreditation: p.nhvasAccreditation } : {}),
    ...(p.nhvasNumber !== undefined ? { nhvas_number: p.nhvasNumber } : {}),
    ...(p.nhvasExpiry !== undefined ? { nhvas_expiry: p.nhvasExpiry || null } : {}),
    ...(p.nhvasFilePath !== undefined ? { nhvas_file_path: p.nhvasFilePath || null } : {}),
    ...(p.agreementExpiry !== undefined ? { agreement_expiry: p.agreementExpiry || null } : {}),
    primary_depot: p.primaryDepot ?? "", ...(p.status === "Suspended" || p.status === "Inactive" || p.status === "Pending Review" ? { status: p.status } : {}), updated_at: new Date().toISOString()
  };
}

app.put("/api/admin/contractors/companies/:companyId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const companyId = z.string().uuid().parse(request.params.companyId);
    const payload = companyPayloadSchema.parse(request.body);
    if (!validateABN(payload.abn).isValid || !validateACN(payload.acn ?? "").isValid) { response.status(400).json({ message: "Enter a valid ABN and, when supplied, a valid 9 digit ACN." }); return; }
    const { data, error } = await supabaseAdmin.from("contractor_companies").update({ ...companyDbPayload(payload), public_liability_status: "pending", public_liability_rejection_reason: null, public_liability_reviewed_by: null, public_liability_reviewed_at: null, workers_comp_status: "pending", workers_comp_rejection_reason: null, workers_comp_reviewed_by: null, workers_comp_reviewed_at: null, agreement_status: "pending", agreement_rejection_reason: null, agreement_reviewed_by: null, agreement_reviewed_at: null, nhvas_status: payload.nhvasAccreditation === "None" ? "missing" : "pending", nhvas_rejection_reason: null, nhvas_reviewed_by: null, nhvas_reviewed_at: null, status: payload.status === "Suspended" || payload.status === "Inactive" ? payload.status : "Pending Review" }).eq("id", companyId).select("*").single();
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_contractor_company_updated", { companyId });
    response.json({ company: data });
  } catch (error) { next(error); }
});

const contractorFinancialSchema = z.object({
  bankAccountName: z.string().trim().min(2).max(120),
  bankBsb: z.string().trim().regex(/^\d{3}-?\d{3}$/, "Enter a 6 digit BSB."),
  bankAccountNumber: z.string().trim().regex(/^\d{5,10}$/, "Enter a valid bank account number."),
  gstRegistered: z.boolean(),
  gstEffectiveDate: z.string().trim().optional().nullable(),
  declarations: z.object({ business: z.literal(true), tax: z.literal(true), insurance: z.literal(true), vehicle: z.literal(true) })
});

async function contractorCompanyForUser(userId: string) {
  const { data, error } = await supabaseAdmin.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data?.company_id) return null;
  return String(data.company_id);
}

app.get("/api/contractor/business-details", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const companyId = await contractorCompanyForUser(request.authUserId!);
    if (!companyId) { response.status(404).json({ message: "Link your contractor company before entering business details." }); return; }
    const { data, error } = await supabaseAdmin.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    response.json({ details: data ?? null });
  } catch (error) { next(error); }
});

app.post("/api/contractor/company/documents", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { kind, fileName, contentType, base64 } = z.object({
      kind: z.enum(["public_liability", "workers_comp", "nhvas"]),
      fileName: z.string().trim().min(1).max(160),
      contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
      base64: z.string().min(1).max(1_700_000)
    }).parse(request.body);
    const companyId = await contractorCompanyForUser(request.authUserId!);
    if (!companyId) { response.status(404).json({ message: "Link your contractor company before uploading compliance evidence." }); return; }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `companies/${companyId}/${kind}_${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from("contractor-documents").upload(path, Buffer.from(base64, "base64"), { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const prefix = kind === "public_liability" ? "public_liability" : kind === "workers_comp" ? "workers_comp" : "nhvas";
    const { data: company, error: lookupError } = await supabaseAdmin.from("contractor_companies").select("status").eq("id", companyId).single();
    if (lookupError) throw lookupError;
    const { error } = await supabaseAdmin.from("contractor_companies").update({ [`${prefix}_file_path`]: path, [`${prefix}_status`]: "pending", [`${prefix}_rejection_reason`]: null, [`${prefix}_reviewed_by`]: null, [`${prefix}_reviewed_at`]: null, ...(company.status === "Compliant" ? { status: "Pending Review" } : {}), updated_at: new Date().toISOString() }).eq("id", companyId);
    if (error) throw error;
    await logAuditEntry(request.authUserId!, "contractor_compliance_document_uploaded", { companyId, kind, fileName: safeName });
    response.status(201).json({ path });
  } catch (error) { next(error); }
});

app.post("/api/driver/vehicles/:vehicleId/documents", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const vehicleId = z.string().min(1).max(100).parse(request.params.vehicleId);
    const payload = z.object({ kind: z.enum(["rego", "insurance", "inspection"]), fileName: z.string().trim().min(1).max(160), contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]), base64: z.string().min(1).max(1_700_000), expiryDate: z.string().trim().optional() }).parse(request.body);
    const { data: vehicle, error: vehicleError } = await supabaseAdmin.from("driver_vehicles").select("id").eq("id", vehicleId).eq("user_id", request.authUserId!).maybeSingle();
    if (vehicleError) throw vehicleError;
    if (!vehicle) { response.status(404).json({ message: "Vehicle not found for this account." }); return; }
    if (payload.kind !== "rego" && !isCurrentCalendarDate(payload.expiryDate)) { response.status(400).json({ message: "Enter a current expiry date for this vehicle document." }); return; }
    const safeName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `vehicles/${vehicleId}/${payload.kind}_${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from("contractor-documents").upload(path, Buffer.from(payload.base64, "base64"), { contentType: payload.contentType, upsert: false });
    if (uploadError) throw uploadError;
    const prefix = payload.kind === "rego" ? "rego_document" : `${payload.kind}_document`;
    const expiryColumn = payload.kind === "rego" ? "rego_expiry_date" : `${prefix}_expiry`;
    const { error } = await supabaseAdmin.from("driver_vehicles").update({ [`${prefix}_path`]: path, [`${prefix}_status`]: "pending", [`${prefix}_rejection_reason`]: null, [`${prefix}_reviewed_by`]: null, [`${prefix}_reviewed_at`]: null, ...(payload.kind === "rego" ? {} : { [expiryColumn]: payload.expiryDate }), updated_at: new Date().toISOString() }).eq("id", vehicleId).eq("user_id", request.authUserId!);
    if (error) throw error;
    await logAuditEntry(request.authUserId!, "contractor_vehicle_document_uploaded", { vehicleId, kind: payload.kind, fileName: safeName });
    response.status(201).json({ path });
  } catch (error) { next(error); }
});

app.post("/api/admin/contractors/vehicles/:vehicleId/documents/review", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const vehicleId = z.string().min(1).max(100).parse(request.params.vehicleId);
    const { kind, action, reason } = z.object({ kind: z.enum(["rego", "insurance", "inspection"]), action: z.enum(["approve", "reject"]), reason: z.string().trim().optional() }).parse(request.body);
    if (action === "reject" && !reason) { response.status(400).json({ message: "A rejection reason is required." }); return; }
    const prefix = kind === "rego" ? "rego_document" : `${kind}_document`;
    const expiryColumn = kind === "rego" ? "rego_expiry_date" : `${prefix}_expiry`;
    const { data: vehicle, error: lookupError } = await supabaseAdmin.from("driver_vehicles").select(`id, ${prefix}_path, ${expiryColumn}`).eq("id", vehicleId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!vehicle) { response.status(404).json({ message: "Vehicle not found." }); return; }
    const vehicleRow = vehicle as Record<string, any>;
    if (action === "approve" && (!vehicleRow[`${prefix}_path`] || !isCurrentCalendarDate(vehicleRow[expiryColumn]))) { response.status(400).json({ message: "Upload the document and record a current expiry date before approval." }); return; }
    const { error } = await supabaseAdmin.from("driver_vehicles").update({ [`${prefix}_status`]: action === "approve" ? "approved" : "rejected", [`${prefix}_rejection_reason`]: action === "reject" ? reason : null, [`${prefix}_reviewed_by`]: request.authUserId, [`${prefix}_reviewed_at`]: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", vehicleId);
    if (error) throw error;
    await logAuditEntry(request.authUserId!, "contractor_vehicle_document_reviewed", { vehicleId, kind, action, reason: reason ?? null });
    response.json({ message: action === "approve" ? "Vehicle document approved." : "Vehicle document rejected." });
  } catch (error) { next(error); }
});

app.put("/api/contractor/business-details", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const payload = contractorFinancialSchema.parse(request.body);
    const companyId = await contractorCompanyForUser(request.authUserId!);
    if (!companyId) { response.status(404).json({ message: "Link your contractor company before entering business details." }); return; }
    if (payload.gstRegistered && !payload.gstEffectiveDate) { response.status(400).json({ message: "Enter the GST registration effective date or select not registered." }); return; }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("contractor_financial_details").upsert({
      company_id: companyId, bank_account_name: payload.bankAccountName, bank_bsb: payload.bankBsb.replace(/\D/g, ""), bank_account_number: payload.bankAccountNumber,
      gst_registered: payload.gstRegistered, gst_effective_date: payload.gstRegistered ? payload.gstEffectiveDate : null,
      business_details_confirmed_at: now, business_details_confirmed_by: request.authUserId,
      tax_declaration_at: now, tax_declaration_by: request.authUserId,
      insurance_declaration_at: now, insurance_declaration_by: request.authUserId,
      vehicle_declaration_at: now, vehicle_declaration_by: request.authUserId, updated_at: now
    }, { onConflict: "company_id" });
    if (error) throw error;
    await supabaseAdmin.from("contractor_companies").update({ status: "Pending Review", updated_at: now }).eq("id", companyId).eq("status", "Compliant");
    await logAuditEntry(request.authUserId!, "contractor_business_details_confirmed", { companyId, declarations: ["business", "tax", "insurance", "vehicle"] });
    response.json({ message: "Business details and declarations saved." });
  } catch (error) { next(error); }
});

app.get("/api/admin/contractors/companies/:companyId/business-details", requireAdmin, async (request, response, next) => {
  try {
    const companyId = z.string().uuid().parse(request.params.companyId);
    const { data, error } = await supabaseAdmin.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    response.json({ details: data ?? null });
  } catch (error) { next(error); }
});

app.post("/api/admin/contractors/companies/:companyId/documents", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const companyId = z.string().uuid().parse(request.params.companyId);
    const { kind, fileName, contentType, base64 } = z.object({ kind: z.enum(["public_liability", "workers_comp", "contractor_agreement", "nhvas"]), fileName: z.string().trim().min(1).max(160), contentType: z.string().trim().max(120), base64: z.string().min(1).max(1_700_000) }).parse(request.body);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `companies/${companyId}/${kind}_${Date.now()}_${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage.from("contractor-documents").upload(path, Buffer.from(base64, "base64"), { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const column = kind === "contractor_agreement" ? "agreement_file_path" : `${kind}_file_path`;
    const { data: company, error: readError } = await supabaseAdmin.from("contractor_companies").select("status").eq("id", companyId).maybeSingle();
    if (readError || !company) {
      await supabaseAdmin.storage.from("contractor-documents").remove([path]);
      if (readError) throw readError;
      response.status(404).json({ message: "Contractor company not found." }); return;
    }
    const statusColumn = kind === "contractor_agreement" ? "agreement_status" : `${kind}_status`;
    const rejectionColumn = kind === "contractor_agreement" ? "agreement_rejection_reason" : `${kind}_rejection_reason`;
    const { error } = await supabaseAdmin.from("contractor_companies").update({ [column]: path, [statusColumn]: "pending", [rejectionColumn]: null, [`${kind === "contractor_agreement" ? "agreement" : kind}_reviewed_by`]: null, [`${kind === "contractor_agreement" ? "agreement" : kind}_reviewed_at`]: null, ...(company.status === "Compliant" ? { status: "Pending Review" } : {}), updated_at: new Date().toISOString() }).eq("id", companyId);
    if (error) { await supabaseAdmin.storage.from("contractor-documents").remove([path]); throw error; }
    response.status(201).json({ path });
  } catch (error) { next(error); }
});

app.post("/api/admin/contractors/link-driver", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { driverId, companyId } = z.object({ driverId: z.string().uuid(), companyId: z.string().uuid() }).parse(request.body);
    const [{ data: company, error: companyError }, { data: profile, error: profileError }] = await Promise.all([
      supabaseAdmin.from("contractor_companies").select("id").eq("id", companyId).maybeSingle(),
      supabaseAdmin.from("profiles").select("id").eq("id", driverId).maybeSingle()
    ]);
    if (companyError) throw companyError;
    if (profileError) throw profileError;
    if (!company || !profile) { response.status(404).json({ message: "The driver or contractor company could not be found." }); return; }
    const { error: linkError } = await supabaseAdmin.from("contractor_profiles").upsert({ user_id: driverId, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (linkError) throw linkError;
    const { error: employmentError } = await supabaseAdmin.from("profiles").update({ employment_type: "contractor" }).eq("id", driverId);
    if (employmentError) throw employmentError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_contractor_driver_linked", { driverId, companyId });
    response.json({ message: "Contractor driver linked." });
  } catch (error) { next(error); }
});

app.post("/api/admin/contractors/companies/:companyId/insurance-review", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const companyId = z.string().uuid().parse(request.params.companyId);
    const { kind, action, reason } = z.object({ kind: z.enum(["public_liability", "workers_comp", "contractor_agreement", "nhvas"]), action: z.enum(["approve", "reject"]), reason: z.string().trim().optional() }).parse(request.body);
    if (action === "reject" && !reason) { response.status(400).json({ message: "A rejection reason is required." }); return; }
    const { data: company, error: companyReadError } = await supabaseAdmin.from("contractor_companies").select("status, nhvas_accreditation, nhvas_status, nhvas_expiry, nhvas_file_path, public_liability_status, public_liability_expiry, public_liability_file_path, workers_comp_status, workers_comp_expiry, workers_comp_file_path, agreement_status, agreement_expiry, agreement_file_path").eq("id", companyId).maybeSingle();
    if (companyReadError) throw companyReadError;
    if (!company) { response.status(404).json({ message: "Contractor company not found." }); return; }
    const prefix = kind === "contractor_agreement" ? "agreement" : kind;
    const documentPath = company[`${prefix}_file_path`];
    const expiryDate = company[`${prefix}_expiry`];
    if (action === "approve" && !documentPath) { response.status(400).json({ message: "Upload the agreement document before approving it." }); return; }
    if (action === "approve" && !isCurrentCalendarDate(expiryDate)) { response.status(400).json({ message: "Set a current expiry date before approving this document." }); return; }
    const liabilityStatus = kind === "public_liability" ? action === "approve" ? "approved" : "rejected" : company.public_liability_status;
    const workersCompStatus = kind === "workers_comp" ? action === "approve" ? "approved" : "rejected" : company.workers_comp_status;
    const agreementStatus = kind === "contractor_agreement" ? action === "approve" ? "approved" : "rejected" : company.agreement_status;
    const liabilityCurrent = Boolean(company.public_liability_file_path && isCurrentCalendarDate(company.public_liability_expiry));
    const workersCompCurrent = Boolean(company.workers_comp_file_path && isCurrentCalendarDate(company.workers_comp_expiry));
    const agreementCurrent = Boolean(company.agreement_file_path && isCurrentCalendarDate(company.agreement_expiry));
    const nhvasStatus = kind === "nhvas" ? action === "approve" ? "approved" : "rejected" : company.nhvas_status;
    const nhvasCurrent = company.nhvas_accreditation === "None" || Boolean(company.nhvas_file_path && nhvasStatus === "approved" && isCurrentCalendarDate(company.nhvas_expiry));
    const { data: finance, error: financeError } = await supabaseAdmin.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", companyId).maybeSingle();
    if (financeError) throw financeError;
    const financeComplete = Boolean(finance && String(finance.bank_account_name ?? "").trim() && /^\d{6}$/.test(String(finance.bank_bsb ?? "")) && /^\d{5,10}$/.test(String(finance.bank_account_number ?? "")) && finance.gst_registered !== null && finance.gst_registered !== undefined && (!finance.gst_registered || finance.gst_effective_date) && finance.business_details_confirmed_at && finance.tax_declaration_at && finance.insurance_declaration_at && finance.vehicle_declaration_at);
    const allCurrent = liabilityStatus === "approved" && workersCompStatus === "approved" && agreementStatus === "approved" && liabilityCurrent && workersCompCurrent && agreementCurrent && nhvasCurrent && financeComplete;
    const status = getNextContractorCompanyStatus(company.status, allCurrent);
    const { error } = await supabaseAdmin.from("contractor_companies").update({
      [`${prefix}_status`]: action === "approve" ? "approved" : "rejected",
      [`${prefix}_rejection_reason`]: action === "reject" ? reason : null,
      [`${prefix}_reviewed_by`]: request.authUserId,
      [`${prefix}_reviewed_at`]: new Date().toISOString(),
      status,
      updated_at: new Date().toISOString()
    }).eq("id", companyId);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_contractor_insurance_reviewed", { companyId, kind, action });
    response.json({ message: action === "approve" ? "Insurance document approved." : "Insurance document rejected." });
  } catch (error) { next(error); }
});

app.post("/api/admin/drivers", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      phone: z.string().min(5),
      address: z.string().min(5),
      preferredLanguage: z.string().min(2),
      licenceClass: z.string().optional(),
      issuingState: z.string().optional(),
      licenceNumber: z.string().trim().optional(),
      depotLocation: z.string().optional(),
      dateOfBirth: z.string().optional(),
      licenceHistoryProvided: z.boolean().optional(),
      leftBusiness: z.boolean().optional(),
      employmentType: z.enum(["employee", "contractor"]).default("employee"),
      staffRole: z.enum(["driver", "warehouse", "office"]).default("driver"),
      contractorCompanyId: z.string().uuid().optional()
    });
    const payload = schema.parse(request.body);

    if (payload.staffRole === "driver" && !/^[A-Za-z0-9]{8}$/.test(payload.licenceNumber ?? "")) {
      response.status(400).json({ message: "Driver licence number must be exactly 8 letters or numbers." });
      return;
    }

    if (payload.employmentType === "contractor" && !payload.contractorCompanyId) {
      response.status(400).json({ message: "Select a contractor company for this driver." });
      return;
    }
    if (payload.contractorCompanyId) {
      const { data: company, error: companyError } = await supabaseAdmin.from("contractor_companies").select("id, status").eq("id", payload.contractorCompanyId).maybeSingle();
      if (companyError || !company || company.status === "Inactive") { response.status(400).json({ message: "The selected contractor company is unavailable." }); return; }
    }

    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        role: "driver",
        must_change_password: false,
        licenceClass: payload.staffRole === "driver" ? (payload.licenceClass || "HC") : null,
        issuingState: payload.staffRole === "driver" ? (payload.issuingState || "VIC") : null,
        licenceNumber: payload.staffRole === "driver" ? (payload.licenceNumber ?? "").toUpperCase() : null,
        depotLocation: payload.depotLocation || "Melbourne Hub"
      }
    });
    if (createError || !createdUser.user) throw createError ?? new Error("Unable to create driver account.");

    const userId = createdUser.user.id;
    const createdAt = new Date().toISOString();

    try {
      const fullProfile = {
        id: userId,
        role: "driver",
        email: payload.email,
        full_name: payload.fullName,
        phone: payload.phone,
        address: payload.address,
        preferred_language: payload.preferredLanguage,
        licence_class: payload.staffRole === "driver" ? (payload.licenceClass || "HC") : null,
        issuing_state: payload.staffRole === "driver" ? (payload.issuingState || "VIC") : null,
        licence_number: payload.staffRole === "driver" ? (payload.licenceNumber ?? "").toUpperCase() : null,
        depot_location: payload.depotLocation || "Melbourne Hub",
        date_of_birth: payload.dateOfBirth || null,
        licence_history_provided: payload.licenceHistoryProvided ?? false,
        left_business: payload.leftBusiness ?? false,
        employment_type: payload.employmentType,
        staff_role: payload.staffRole,
        created_at: createdAt,
        updated_at: createdAt
      };
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert(fullProfile);
      if (profileError) {
        // Fallback to base columns if extended columns do not exist
        const { error: fallbackErr } = await supabaseAdmin.from("profiles").upsert({
          id: userId,
          role: "driver",
          email: payload.email,
          full_name: payload.fullName,
          phone: payload.phone,
          address: payload.address,
          preferred_language: payload.preferredLanguage,
          employment_type: payload.employmentType,
          created_at: createdAt,
          updated_at: createdAt
        });
        if (fallbackErr) throw fallbackErr;
      }

      const { error: driverError } = await supabaseAdmin.from("drivers").upsert({
        user_id: userId,
        status: "Not Started",
        created_at: createdAt
      });
      if (driverError) throw driverError;

      if (payload.employmentType === "contractor" && payload.contractorCompanyId) {
        const { error: contractorError } = await supabaseAdmin.from("contractor_profiles").upsert({
          user_id: userId,
          company_id: payload.contractorCompanyId,
          company_name: "",
          updated_at: createdAt
        }, { onConflict: "user_id" });
        if (contractorError) throw contractorError;
      }

      const { error: progressError } = await supabaseAdmin.from("induction_progress").upsert({
        user_id: userId,
        current_step: 1,
        completion_percentage: 0,
        completed: false,
        completed_step_ids: [],
        updated_at: createdAt
      });
      if (progressError) throw progressError;

      const { data: sections } = await supabaseAdmin.from("learning_sections").select("id");
      if (sections?.length) {
        const completionRows = sections.map((section) => ({
          user_id: userId,
          section_id: section.id,
          section_version: "1.0",
          completed: false,
          completed_at: null
        }));
        const { error: completionError } = await supabaseAdmin.from("learning_section_completions").insert(completionRows);
        if (completionError) throw completionError;
      }
    } catch (err) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw err;
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_driver_created", {
        driverId: userId,
        email: payload.email
      });
    }

    // Email delivery is independent of account creation. Report its result so
    // the admin can tell whether provider credentials need configuring.
    let emailSent = false;
    try {
      emailSent = await sendNotificationService({
        eventType: "driver_created",
        userEmail: payload.email,
        driverName: payload.fullName,
        context: { temporaryPassword: payload.password }
      });
    } catch (emailError) {
      console.error("[EMAIL] Welcome email failed:", emailError instanceof Error ? emailError.message : emailError);
    }

    response.status(201).json({
      message: emailSent ? "Driver account created and welcome email sent." : "Driver account created, but the welcome email was not sent. Configure an email provider on the API server.",
      emailSent,
      userId
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/drivers/:driverId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);
    const schema = z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().min(5),
      address: z.string().min(3),
      preferredLanguage: z.string().min(2),
      licenceClass: z.string().optional(),
      issuingState: z.string().optional(),
      licenceNumber: z.string().trim().optional(),
      depotLocation: z.string().optional(),
      dateOfBirth: z.string().optional(),
      licenceHistoryProvided: z.boolean().optional(),
      leftBusiness: z.boolean().optional()
    });
    const payload = schema.parse(request.body);
    const { data: driverRoleProfile, error: roleReadError } = await supabaseAdmin.from("profiles").select("staff_role").eq("id", driverId).maybeSingle();
    if (roleReadError) throw roleReadError;
    if ((driverRoleProfile?.staff_role ?? "driver") === "driver" && !/^[A-Za-z0-9]{8}$/.test(payload.licenceNumber ?? "")) {
      response.status(400).json({ message: "Driver licence number must be exactly 8 letters or numbers." });
      return;
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(driverId, {
      email: payload.email,
      user_metadata: { role: "driver" }
    });
    if (authError) throw authError;

    const fullUpdate: Record<string, any> = {
      email: payload.email,
      full_name: payload.fullName,
      phone: payload.phone,
      address: payload.address,
      preferred_language: payload.preferredLanguage,
      updated_at: new Date().toISOString()
    };
    if (payload.licenceClass) fullUpdate.licence_class = payload.licenceClass;
    if (payload.issuingState) fullUpdate.issuing_state = payload.issuingState;
    if (payload.licenceNumber) fullUpdate.licence_number = payload.licenceNumber.toUpperCase();
    if (payload.depotLocation) fullUpdate.depot_location = payload.depotLocation;
    if (payload.dateOfBirth !== undefined) fullUpdate.date_of_birth = payload.dateOfBirth || null;
    if (payload.licenceHistoryProvided !== undefined) fullUpdate.licence_history_provided = payload.licenceHistoryProvided;
    if (payload.leftBusiness !== undefined) fullUpdate.left_business = payload.leftBusiness;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update(fullUpdate)
      .eq("id", driverId);
    
    if (profileError) {
      // Fallback to base columns if extended columns do not exist
      await supabaseAdmin
        .from("profiles")
        .update({
          email: payload.email,
          full_name: payload.fullName,
          phone: payload.phone,
          address: payload.address,
          preferred_language: payload.preferredLanguage,
          updated_at: new Date().toISOString()
        })
        .eq("id", driverId);
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_driver_updated", {
        driverId,
        email: payload.email
      });
    }

    response.json({ message: "Driver updated." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/drivers/:driverId/reset-password", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);
    const schema = z.object({
      password: z.string().min(8)
    });
    const payload = schema.parse(request.body);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(driverId, {
      password: payload.password,
      user_metadata: { must_change_password: false }
    });
    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_password_reset", {
        driverId
      });
    }

    // Report email delivery separately; the password reset itself has already
    // succeeded even when email credentials are missing.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", driverId)
      .single();
    let emailSent = false;
    if (profile?.email) {
      try {
        emailSent = await sendNotificationService({
          eventType: "password_reset",
          userEmail: profile.email,
          driverName: profile.full_name,
          context: { temporaryPassword: payload.password }
        });
      } catch (emailError) {
        console.error("[EMAIL] Password reset email failed:", emailError instanceof Error ? emailError.message : emailError);
      }
    }

    response.json({
      emailSent,
      message: emailSent
        ? "Temporary password set and emailed to the driver."
        : "Temporary password was changed, but the email was not sent. Configure an email provider on the API server."
    });
  } catch (error) {
    next(error);
  }
});

// Driver password help requests are stored for admins in the portal. Keep the
// public response identical for known and unknown email addresses.
app.post("/api/auth/password-reset-request", rateLimit(5, 60_000), async (request, response, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);
    const normalizedEmail = email.trim().toLowerCase();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .ilike("email", normalizedEmail)
      .eq("role", "driver")
      .maybeSingle();

    if (profileError) throw profileError;

    if (profile) {
      const { data: existingRequest, error: existingError } = await supabaseAdmin
        .from("driver_password_reset_requests")
        .select("id")
        .eq("driver_id", profile.id)
        .eq("status", "pending")
        .maybeSingle();
      if (existingError) throw existingError;

      if (!existingRequest) {
        const { error: insertError } = await supabaseAdmin
          .from("driver_password_reset_requests")
          .insert({ driver_id: profile.id, email: normalizedEmail });
        if (insertError) throw insertError;
      }
    }

    response.status(202).json({
      message: "If this email belongs to a driver account, an administrator will review the password help request."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/password-reset-requests", requireAdmin, async (_request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("driver_password_reset_requests")
      .select("*, driver:profiles!driver_password_reset_requests_driver_id_fkey(full_name, phone)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/password-reset-requests/:requestId/handled", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const requestId = z.string().uuid().parse(request.params.requestId);
    const handledAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("driver_password_reset_requests")
      .update({ status: "handled", handled_at: handledAt, handled_by: request.authUserId })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Pending password help request not found." });
      return;
    }
    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "driver_password_help_request_handled", { requestId });
    }
    response.json({ message: "Password help request marked as handled." });
  } catch (error) {
    next(error);
  }
});

// Bulk Driver Onboarding Endpoint
app.post("/api/admin/drivers/bulk", requireAdmin, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      drivers: z.array(z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(5),
        address: z.string().optional(),
        preferredLanguage: z.string().optional(),
        password: z.string().min(8)
      })).min(1).max(100)
    });
    const { drivers } = schema.parse(request.body);

    const createdList: Array<{ id: string; email: string; fullName: string; emailSent: boolean }> = [];
    const errorsList: Array<{ email: string; reason: string }> = [];

    for (const driverItem of drivers) {
      try {
        const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: driverItem.email,
          password: driverItem.password,
          email_confirm: true,
          user_metadata: { role: "driver" }
        });
        if (createError || !createdUser.user) throw createError ?? new Error("Creation failed.");

        const userId = createdUser.user.id;
        const now = new Date().toISOString();

        try {
          await supabaseAdmin.from("profiles").upsert({
            id: userId,
            role: "driver",
            email: driverItem.email,
            full_name: driverItem.fullName,
            phone: driverItem.phone,
            address: driverItem.address ?? "Address Pending",
            preferred_language: driverItem.preferredLanguage ?? "en",
            created_at: now,
            updated_at: now
          });

          await supabaseAdmin.from("drivers").upsert({ user_id: userId, status: "Not Started", created_at: now });
          await supabaseAdmin.from("induction_progress").upsert({ user_id: userId, current_step: 1, completion_percentage: 0, completed: false, completed_step_ids: [], updated_at: now });

          const { data: sections } = await supabaseAdmin.from("learning_sections").select("id");
          if (sections?.length) {
            const completionRows = sections.map((sec) => ({ user_id: userId, section_id: sec.id, section_version: "1.0", completed: false, completed_at: null }));
            await supabaseAdmin.from("learning_section_completions").upsert(completionRows);
          }
        } catch (dbErr) {
          await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
          throw dbErr;
        }

        let emailSent = false;
        try {
          emailSent = await sendNotificationService({
            eventType: "driver_created",
            userEmail: driverItem.email,
            driverName: driverItem.fullName,
            context: { temporaryPassword: driverItem.password }
          });
        } catch (emailError) {
          console.error("[BULK EMAIL FAIL]", emailError instanceof Error ? emailError.message : emailError);
        }

        createdList.push({ id: userId, email: driverItem.email, fullName: driverItem.fullName, emailSent });
      } catch (err: unknown) {
        errorsList.push({ email: driverItem.email, reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_bulk_drivers_imported", {
        requestedCount: drivers.length,
        createdCount: createdList.length,
        errorCount: errorsList.length
      });
    }

    response.json({ message: `Imported ${createdList.length} drivers.`, created: createdList, errors: errorsList });
  } catch (error) {
    next(error);
  }
});

// Admin Document Approval & Rejection Endpoints
app.post("/api/admin/documents/:documentId/approve", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const documentId = String(request.params.documentId);
    const now = new Date().toISOString();

    const { data: doc, error: fetchErr } = await supabaseAdmin.from("documents").select("id, user_id, type, expires_at, uploaded_at").eq("id", documentId).single();
    if (fetchErr || !doc) throw fetchErr ?? new Error("Document not found.");
    if (doc.type === "right_to_work") { response.status(400).json({ message: "Use the work-rights verification action before approving this document." }); return; }
    if (REQUIRED_EXPIRY_DOCUMENTS.includes(doc.type) && !isCurrentOnboardingDate(doc.expires_at)) {
      response.status(400).json({ message: "Set a current expiry date before approving this required document." }); return;
    }

    const { error } = await supabaseAdmin.from("documents").update({
      status: "approved",
      verified_by_admin: true,
      verified_at: now,
      verified_by_user_id: request.authUserId ?? null,
      rejection_reason: null
    }).eq("id", documentId);
    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_document_approved", { documentId, driverId: doc.user_id, documentType: doc.type });
    }

    const { data: worker, error: workerError } = await supabaseAdmin.from("profiles").select("email, full_name").eq("id", doc.user_id).maybeSingle();
    if (workerError) throw workerError;
    if (worker?.email) {
      const notification = {
        userId: doc.user_id,
        email: worker.email,
        eventType: "document_approved" as const,
        organizationName,
        appUrl,
        recipientName: worker.full_name ?? "Worker",
        context: { documentType: String(doc.type).replace(/_/g, " ") },
        dedupeKey: `document-approved:${documentId}:${doc.uploaded_at ?? "submitted"}`
      };
      await enqueueNotifications(supabaseAdmin, [notification]);
      await dispatchNotificationOutbox(supabaseAdmin, sendOutboxEmail);
    }

    response.json({ message: "Document approved successfully." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/documents/:documentId/reject", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const documentId = String(request.params.documentId);
    const schema = z.object({ reason: z.string().min(3) });
    const { reason } = schema.parse(request.body);
    const now = new Date().toISOString();

    const { data: doc, error: fetchErr } = await supabaseAdmin.from("documents").select("id, user_id, type").eq("id", documentId).single();
    if (fetchErr || !doc) throw fetchErr ?? new Error("Document not found.");

    const { error } = await supabaseAdmin.from("documents").update({
      status: "rejected",
      verified_by_admin: false,
      verified_at: now,
      verified_by_user_id: request.authUserId ?? null,
      rejection_reason: reason
    }).eq("id", documentId);
    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_document_rejected", { documentId, driverId: doc.user_id, documentType: doc.type, reason });
    }

    response.json({ message: "Document rejected." });
  } catch (error) {
    next(error);
  }
});

// Verification Queue Endpoints
app.get("/api/admin/verification-queue", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: documents, error } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, type, file_url, file_name, mime_type, status, uploaded_at, expires_at")
      .eq("status", "pending")
      .order("uploaded_at", { ascending: false });

    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "sensitive_document_queue_accessed", { documentCount: documents?.length ?? 0 });
    const userIds = [...new Set((documents ?? []).map((document) => document.user_id))];
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [] };
    const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const queueDocuments = await Promise.all((documents ?? []).map(async (document) => {
      const { data: signedFile } = await supabaseAdmin.storage
        .from("driver-documents")
        .createSignedUrl(document.file_url, 10 * 60);
      return {
        ...document,
        preview_url: signedFile?.signedUrl ?? null,
        profiles: profilesById.get(document.user_id) ?? null
      };
    }));
    response.json({ documents: queueDocuments });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/documents/:documentId/verify", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const documentId = String(request.params.documentId);
    const schema = z.object({
      action: z.enum(["approve", "reject"]),
      reason: z.string().trim().min(3).optional(),
      expiresAt: z.string().datetime().optional(),
      workRightsCheck: z.boolean().optional(),
      workRightsMethod: z.enum(["manual", "vevo"]).optional()
    });
    const { action, reason, expiresAt, workRightsCheck, workRightsMethod } = schema.parse(request.body);
    if (action === "reject" && !reason) {
      response.status(400).json({ message: "A rejection reason is required." });
      return;
    }
    const now = new Date().toISOString();

    const { data: doc, error: fetchErr } = await supabaseAdmin.from("documents").select("id, user_id, type, expires_at, uploaded_at").eq("id", documentId).single();
    if (fetchErr || !doc) throw fetchErr ?? new Error("Document not found.");
    if (action === "approve" && doc.type === "right_to_work" && (!workRightsCheck || !workRightsMethod)) {
      response.status(400).json({ message: "Record a manual or VEVO work-rights check before approving this document." }); return;
    }
    if (doc.type === "right_to_work" && workRightsCheck && action !== "approve") {
      response.status(400).json({ message: "A rejected document cannot be marked as work-rights verified." }); return;
    }
    if (doc.type === "right_to_work" && action === "approve") {
      const { data: owner, error: ownerError } = await supabaseAdmin.from("profiles").select("employment_type").eq("id", doc.user_id).maybeSingle();
      if (ownerError) throw ownerError;
      if (owner?.employment_type === "contractor") {
        // Contractor evidence keeps its existing review path; the explicit RTW check also applies.
      }
    }

    const isApprove = action === "approve";
    const effectiveExpiry = expiresAt ?? doc.expires_at;
    if (isApprove && REQUIRED_EXPIRY_DOCUMENTS.includes(doc.type) && !isCurrentOnboardingDate(effectiveExpiry)) {
      response.status(400).json({ message: "Set a current expiry date before approving this required document." }); return;
    }
    if (isApprove && effectiveExpiry && !isCurrentOnboardingDate(effectiveExpiry)) {
      response.status(400).json({ message: "An expired document cannot be approved." }); return;
    }
    const { error } = await supabaseAdmin.from("documents").update({
      status: isApprove ? "approved" : "rejected",
      verified_by_admin: isApprove,
      verified_at: now,
      verified_by_user_id: request.authUserId ?? null,
      rejection_reason: isApprove ? null : reason ?? null,
      ...(doc.type === "right_to_work" ? {
        work_rights_check_status: isApprove && workRightsCheck ? "verified" : "not_verified",
        work_rights_check_method: isApprove && workRightsCheck ? workRightsMethod : null,
        work_rights_checked_at: isApprove && workRightsCheck ? now : null,
        work_rights_checked_by: isApprove && workRightsCheck ? request.authUserId : null
      } : {}),
      ...(isApprove && expiresAt ? { expires_at: expiresAt } : {})
    }).eq("id", documentId);
    if (error) throw error;

    if (request.authUserId) {
      try {
        await logAuditEntry(request.authUserId, isApprove ? "admin_document_approved" : "admin_document_rejected", {
          documentId,
          driverId: doc.user_id,
          documentType: doc.type,
          reason: isApprove ? null : reason
        });
      } catch (auditErr) {
        console.warn("[AUDIT LOG] Document action audit log failed:", auditErr);
      }
    }

    if (isApprove) {
      try {
        const { data: worker, error: workerError } = await supabaseAdmin.from("profiles")
          .select("email, full_name")
          .eq("id", doc.user_id)
          .maybeSingle();
        if (workerError) throw workerError;
        if (worker?.email) {
          await enqueueNotifications(supabaseAdmin, [{
            userId: doc.user_id,
            email: worker.email,
            eventType: "document_approved",
            organizationName,
            appUrl,
            recipientName: worker.full_name ?? "Worker",
            context: { documentType: String(doc.type).replace(/_/g, " ") },
            dedupeKey: `document-approved:${documentId}:${doc.uploaded_at ?? "submitted"}`
          }]);
          await dispatchNotificationOutbox(supabaseAdmin, sendOutboxEmail);
        }
      } catch (notificationError) {
        console.error("[NOTIFICATIONS] Document was approved, but the worker confirmation could not be queued or sent:", notificationError);
      }
    }

    response.json({ message: isApprove ? "Document approved successfully." : "Document rejected." });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/drivers/:driverId/work-clearance", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { approved } = z.object({ approved: z.boolean() }).parse(request.body);
    const driverId = String(request.params.driverId);
    const { data: driver, error: readError } = await supabaseAdmin.from("drivers").select("user_id, work_clearance_status").eq("user_id", driverId).maybeSingle();
    if (readError) throw readError;
    if (!driver) { response.status(404).json({ message: "Driver record not found." }); return; }
    const blockers = approved ? await getCurrentWorkClearanceBlockers(supabaseAdmin, driverId) : [];
    if (blockers.length) {
      response.status(409).json({ message: "Work clearance is blocked until all onboarding requirements are complete.", blockers });
      return;
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("drivers").update({
      work_clearance_status: approved ? "Approved to Commence Work" : "Not Approved",
      work_clearance_approved_at: approved ? now : null,
      work_clearance_approved_by: approved ? request.authUserId : null,
      updated_at: now
    }).eq("user_id", driverId);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, approved ? "admin_work_clearance_approved" : "admin_work_clearance_revoked", { driverId, previousStatus: driver.work_clearance_status ?? "Not Approved" });
    response.json({ message: approved ? "Approved to Commence Work." : "Work clearance revoked.", blockers: [] });
  } catch (error) { next(error); }
});

// Self-Service Driver Registration Endpoint (Public + Rate Limited)
app.post("/api/auth/register-driver", rateLimit(10, 60_000), async (request, response, next) => {
  try {
    // Driver accounts are an employment/compliance control. Keep public enrolment
    // disabled unless the operator has deliberately enabled an invite-free flow.
    if (process.env.ALLOW_SELF_REGISTRATION !== "true") {
      response.status(403).json({ message: "Self-registration is disabled. Ask your administrator to create your induction account." });
      return;
    }
    const schema = z.object({
      fullName: z.string().min(2, "Full name must be at least 2 characters."),
      email: z.string().email("Please enter a valid email address."),
      phone: z.string().min(5, "Please enter a valid phone number."),
      address: z.string().min(5, "Please enter your address."),
      preferredLanguage: z.string().min(2).default("English"),
      password: z.string().min(8, "Password must be at least 8 characters long."),
      depotCode: z.string().optional(),
      licenceClass: z.string().optional(),
      issuingState: z.string().optional(),
      licenceNumber: z.string().trim().regex(/^[A-Za-z0-9]{8}$/, "Licence number must be exactly 8 letters or numbers.")
    });

    const payload = schema.parse(request.body);
    const emailLower = payload.email.toLowerCase().trim();

    // Create confirmed user in Supabase Auth.
    // Supabase enforces email uniqueness at the DB level — no need for a manual
    // listUsers() pre-check (which only reads the first 50 users and would miss
    // existing accounts in larger deployments).
    const { data: authResult, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailLower,
      password: payload.password,
      email_confirm: true,
      user_metadata: { role: "driver", must_change_password: false, depot_code: payload.depotCode }
    });

    if (authError || !authResult.user) {
      // Map Supabase's duplicate-email error to a user-friendly 409
      const isDuplicate = authError?.message?.toLowerCase().includes("already") ||
        authError?.message?.toLowerCase().includes("registered");
      response
        .status(isDuplicate ? 409 : 400)
        .json({ message: isDuplicate
          ? "An account with this email address already exists. Please log in instead."
          : (authError?.message ?? "Failed to create account.") });
      return;
    }

    const userId = authResult.user.id;
    const now = new Date().toISOString();

    // 1. Insert profile & driver first to establish foreign key parent records
    let profileRes = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      role: "driver",
      email: emailLower,
      full_name: payload.fullName.trim(),
      phone: payload.phone.trim(),
      address: payload.address.trim(),
      preferred_language: payload.preferredLanguage,
      licence_class: payload.licenceClass ?? "HC",
      issuing_state: payload.issuingState ?? "VIC",
      licence_number: payload.licenceNumber.toUpperCase(),
      depot_location: payload.depotCode ?? "Melbourne Hub",
      created_at: now,
      updated_at: now
    });

    if (profileRes.error && profileRes.error.message.toLowerCase().includes("column")) {
      // Schema fallback if DB table does not yet have extended columns
      profileRes = await supabaseAdmin.from("profiles").upsert({
        id: userId,
        role: "driver",
        email: emailLower,
        full_name: payload.fullName.trim(),
        phone: payload.phone.trim(),
        address: payload.address.trim(),
        preferred_language: payload.preferredLanguage,
        created_at: now,
        updated_at: now
      });
    }

    const driverRes = await supabaseAdmin.from("drivers").upsert({
      user_id: userId,
      status: "Not Started",
      created_at: now
    });

    if (profileRes.error || driverRes.error) {
      const errMsg = profileRes.error?.message ?? driverRes.error?.message ?? "Profile setup failed";
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      response.status(500).json({ message: `Registration failed: ${errMsg}` });
      return;
    }

    // 2. Insert induction_progress now that parent profile exists
    const progressRes = await supabaseAdmin.from("induction_progress").upsert({
      user_id: userId,
      current_step: 1,
      completion_percentage: 0,
      completed: false,
      completed_step_ids: [],
      updated_at: now
    });

    if (progressRes.error) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      response.status(500).json({ message: `Registration progress setup failed: ${progressRes.error.message}` });
      return;
    }

    // Initial Section completions
    const { data: sections } = await supabaseAdmin.from("learning_sections").select("id");
    if (sections?.length) {
      await supabaseAdmin.from("learning_section_completions").upsert(
        sections.map((sec) => ({
          user_id: userId,
          section_id: sec.id,
          completed: false,
          updated_at: now
        }))
      );
    }

    await logAuditEntry(userId, "driver_self_registered", { email: emailLower, depotCode: payload.depotCode });

    response.json({ message: "Registration successful. You can now log in.", email: emailLower });
  } catch (error) {
    next(error);
  }
});

// Driver Change Password Endpoint

app.post("/api/auth/change-password", rateLimit(10, 60_000), async (request, response, next) => {
  try {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    if (!token) {
      response.status(401).json({ message: "Missing session token." });
      return;
    }

    const { data: authUser, error: tokenError } = await supabaseAdmin.auth.getUser(token);
    if (tokenError || !authUser.user) {
      response.status(401).json({ message: "Invalid or expired session token." });
      return;
    }

    const schema = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(8) });
    const { currentPassword, newPassword } = schema.parse(request.body);

    // Verify current password if provided
    if (currentPassword) {
      const anonKey = process.env.SUPABASE_ANON_KEY;
      if (!anonKey) {
        response.status(500).json({ message: "Server misconfiguration: SUPABASE_ANON_KEY is not set." });
        return;
      }
      const tempClient = createClient(supabaseUrl, anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      const { error: signInErr } = await tempClient.auth.signInWithPassword({
        email: authUser.user.email!,
        password: currentPassword
      });
      if (signInErr) {
        response.status(401).json({ message: "Incorrect current password." });
        return;
      }
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(authUser.user.id, {
      password: newPassword,
      user_metadata: { ...authUser.user.user_metadata, must_change_password: false }
    });
    if (updateErr) throw updateErr;

    await supabaseAdmin.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", authUser.user.id);
    await logAuditEntry(authUser.user.id, "user_changed_password", { email: authUser.user.email });

    response.json({ message: "Password updated successfully." });
  } catch (error) {
    next(error);
  }
});

// Auto Confirm Email Endpoint (for unconfirmed auth users) — Admin only
app.post("/api/auth/auto-confirm", requireAdmin, rateLimit(20, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(request.body);

    // Paginate through all users to avoid the 50-user default limit
    let found = false;
    let page = 1;
    const perPage = 1000;
    while (!found) {
      const { data: usersData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (listErr) throw listErr;
      const user = usersData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (user) {
        const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
          email_confirm: true
        });
        if (updateErr) throw updateErr;
        response.json({ message: "Email confirmed successfully." });
        found = true;
        return;
      }
      // No more pages
      if (usersData.users.length < perPage) break;
      page++;
    }

    if (!found) {
      response.json({ message: "User not found." });
    }
  } catch (error) {
    next(error);
  }
});


// Note: Email auto-confirmation is handled per-user at account creation time
// via email_confirm: true in createUser(). A startup sweep is not needed and
// would silently miss users beyond Supabase's 50-user default page limit.


app.post("/api/admin/drivers/:driverId/reset-induction", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);
    const resetAt = new Date().toISOString();

    const { data: documents, error: documentsError } = await supabaseAdmin
      .from("documents")
      .select("file_url")
      .eq("user_id", driverId);
    if (documentsError) throw documentsError;

    await supabaseAdmin.from("documents").delete().eq("user_id", driverId);
    await supabaseAdmin.from("quiz_attempts").delete().eq("user_id", driverId);
    await supabaseAdmin.from("certificates").delete().eq("user_id", driverId);
    await supabaseAdmin.from("driver_feedback").delete().eq("user_id", driverId);
    await supabaseAdmin.from("learning_section_completions").delete().eq("user_id", driverId);

    if (documents?.length) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("driver-documents")
        .remove(documents.map((document) => document.file_url));
      if (storageError) throw storageError;
    }

    const { data: sections, error: sectionsError } = await supabaseAdmin.from("learning_sections").select("id");
    if (sectionsError) throw sectionsError;

    if (sections?.length) {
      const { error: completionError } = await supabaseAdmin.from("learning_section_completions").insert(
        sections.map((section) => ({
          user_id: driverId,
          section_id: section.id,
          completed: false,
          completed_at: null
        }))
      );
      if (completionError) throw completionError;
    }

    const { error: deleteProgressError } = await supabaseAdmin.from("induction_progress").delete().eq("user_id", driverId);
    if (deleteProgressError) throw deleteProgressError;

    const { error: progressError } = await supabaseAdmin.from("induction_progress").insert({
      user_id: driverId,
      current_step: 1,
      completion_percentage: 0,
      quiz_score: null,
      completed: false,
      completed_step_ids: [],
      declaration_accepted: false,
      declaration_agreed_at: null,
      signature: null,
      completed_at: null,
      updated_at: resetAt
    });
    if (progressError) throw progressError;

    const { error: driverError } = await supabaseAdmin.from("drivers").update({ status: "Not Started" }).eq("user_id", driverId);
    if (driverError) throw driverError;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_induction_reset", {
        driverId,
        resetAt
      });
    }

    response.json({ message: "Induction progress reset." });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/drivers/:driverId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);

    const { data: documents } = await supabaseAdmin
      .from("documents")
      .select("file_url")
      .eq("user_id", driverId);

    await supabaseAdmin.from("documents").delete().eq("user_id", driverId);
    await supabaseAdmin.from("learning_section_completions").delete().eq("user_id", driverId);
    await supabaseAdmin.from("quiz_attempts").delete().eq("user_id", driverId);
    await supabaseAdmin.from("certificates").delete().eq("user_id", driverId);
    await supabaseAdmin.from("driver_feedback").delete().eq("user_id", driverId);
    // Keep audit records. The FK uses ON DELETE SET NULL so evidence survives
    // account removal without retaining the driver's profile.
    await supabaseAdmin.from("induction_progress").delete().eq("user_id", driverId);
    await supabaseAdmin.from("drivers").delete().eq("user_id", driverId);
    await supabaseAdmin.from("profiles").delete().eq("id", driverId);

    if (documents?.length) {
      await supabaseAdmin.storage
        .from("driver-documents")
        .remove(documents.map((document) => document.file_url))
        .catch(() => {});
    }

    await supabaseAdmin.auth.admin.deleteUser(driverId).catch(() => {});

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_driver_deleted", {
        driverId
      });
    }

    response.json({ message: "Driver removed." });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/cms/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().min(1),
      options: z.array(z.string()).min(2),
      correct_answer: z.number().int().min(0),
      explanation: z.string(),
      category: z.string(),
      is_critical: z.boolean().optional()
    });
    const parsed = schema.parse(request.body);

    const { error } = await supabaseAdmin.from("quiz_questions").update(parsed).eq("id", questionId);
    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_updated_question", { questionId });
    }
    response.json({ message: "Question updated." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2),
      correct_answer: z.number().int().min(0),
      explanation: z.string().default(""),
      sort_order: z.coerce.number().optional(),
      category: z.string().default("General"),
      is_critical: z.boolean().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const id = input.id ?? crypto.randomUUID();
    const { error } = await supabaseAdmin.from("quiz_questions").insert({
      ...input,
      id,
      sort_order: input.sort_order ?? 0,
      is_critical: input.is_critical ?? false
    });
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_created_question", { questionId: id });
    response.status(201).json({ id, message: "Quiz question added." });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/cms/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin.from("quiz_questions").delete().eq("id", questionId);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_deleted_question", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/fatigue-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .select("*")
      .eq("assessment_id", "fatigue_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/fatigue-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Fatigue Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "fatigue_awareness");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 fatigue awareness questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "fatigue_awareness",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Fatigue Awareness",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("fatigue_awareness_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "fatigue_awareness_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/fatigue-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Fatigue Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Fatigue Awareness",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "fatigue_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "fatigue_awareness_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "fatigue_awareness", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/fatigue-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "fatigue_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "fatigue_awareness_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/fatigue-awareness/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("fatigue_awareness_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers")
      .eq("assessment_id", "fatigue_awareness")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "fatigue_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addFatigueAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildFatigueAnswerReview(currentQuestions ?? [], r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/distraction-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .select("*")
      .eq("assessment_id", "distraction_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/distraction-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Distraction Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "distraction_awareness");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 distraction awareness questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "distraction_awareness",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Distraction Awareness",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("distraction_awareness_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "distraction_awareness_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/distraction-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Distraction Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Distraction Awareness",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "distraction_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "distraction_awareness_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "distraction_awareness", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/distraction-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "distraction_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "distraction_awareness_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/distraction-awareness/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("distraction_awareness_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers")
      .eq("assessment_id", "distraction_awareness")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "distraction_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addDistractionAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildDistractionAnswerReview(currentQuestions ?? [], r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/speed-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("speed_awareness_questions")
      .select("*")
      .eq("assessment_id", "speed_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/speed-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Speed Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("speed_awareness_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "speed_awareness");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 speed awareness questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "speed_awareness",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Speed Awareness",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("speed_awareness_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "speed_awareness_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/speed-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Speed Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("speed_awareness_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Speed Awareness",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "speed_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "speed_awareness_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "speed_awareness", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/speed-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("speed_awareness_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "speed_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "speed_awareness_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/speed-awareness/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("speed_awareness_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers, assessor_feedback, reviewed_at")
      .eq("assessment_id", "speed_awareness")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("speed_awareness_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "speed_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addSpeedAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      assessor_feedback: r.assessor_feedback,
      reviewed_at: r.reviewed_at,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildSpeedAnswerReview((currentQuestions ?? []) as any, r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/speed-awareness/results/:resultId/feedback", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const resultId = z.string().uuid().parse(String(request.params.resultId));
    const { feedback } = z.object({
      feedback: z.string().trim().max(4000)
    }).strict().parse(request.body);
    const reviewedAt = feedback ? new Date().toISOString() : null;
    const { data, error } = await supabaseAdmin
      .from("speed_awareness_results")
      .update({
        assessor_feedback: feedback || null,
        reviewed_at: reviewedAt,
        reviewed_by: feedback ? request.authUserId : null
      })
      .eq("id", resultId)
      .eq("assessment_id", "speed_awareness")
      .select("id, assessor_feedback, reviewed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Speed Awareness result not found." });
      return;
    }
    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "speed_awareness_feedback_updated", {
        resultId,
        feedbackProvided: Boolean(feedback)
      });
    }
    response.json({ result: data });
  } catch (error) {
    next(error);
  }
});


app.get("/api/admin/pre-start-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .select("*")
      .eq("assessment_id", "pre_start_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/pre-start-awareness/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Pre-Start Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "pre_start_awareness");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 pre-start awareness questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "pre_start_awareness",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Pre-Start Awareness",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("pre_start_awareness_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "pre_start_awareness_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/pre-start-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Pre-Start Awareness"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Pre-Start Awareness",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "pre_start_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "pre_start_awareness_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "pre_start_awareness", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/pre-start-awareness/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "pre_start_awareness");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "pre_start_awareness_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/pre-start-awareness/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("pre_start_awareness_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers, assessor_feedback, reviewed_at")
      .eq("assessment_id", "pre_start_awareness")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "pre_start_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addPreStartAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      assessor_feedback: r.assessor_feedback,
      reviewed_at: r.reviewed_at,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildPreStartAnswerReview((currentQuestions ?? []) as any, r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/pre-start-awareness/results/:resultId/feedback", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const resultId = z.string().uuid().parse(String(request.params.resultId));
    const { feedback } = z.object({
      feedback: z.string().trim().max(4000)
    }).strict().parse(request.body);
    const reviewedAt = feedback ? new Date().toISOString() : null;
    const { data, error } = await supabaseAdmin
      .from("pre_start_awareness_results")
      .update({
        assessor_feedback: feedback || null,
        reviewed_at: reviewedAt,
        reviewed_by: feedback ? request.authUserId : null
      })
      .eq("id", resultId)
      .eq("assessment_id", "pre_start_awareness")
      .select("id, assessor_feedback, reviewed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Pre-Start Awareness result not found." });
      return;
    }
    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "pre_start_awareness_feedback_updated", {
        resultId,
        feedbackProvided: Boolean(feedback)
      });
    }
    response.json({ result: data });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/loading-unloading-restraint-compliance/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("*")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/loading-unloading-restraint-compliance/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Loading, Unloading & Restraint Compliance"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 loading, unloading & restraint compliance questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "loading_unloading_restraint_compliance",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Loading, Unloading & Restraint Compliance",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("loading_unloading_restraint_compliance_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/loading-unloading-restraint-compliance/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Loading, Unloading & Restraint Compliance"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Loading, Unloading & Restraint Compliance",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "loading_unloading_restraint_compliance", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/loading-unloading-restraint-compliance/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/loading-unloading-restraint-compliance/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers, assessor_feedback, reviewed_at")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addLurcAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      assessor_feedback: r.assessor_feedback,
      reviewed_at: r.reviewed_at,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildLurcAnswerReview((currentQuestions ?? []) as any, r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/loading-unloading-restraint-compliance/results/:resultId/feedback", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const resultId = z.string().uuid().parse(String(request.params.resultId));
    const { feedback } = z.object({
      feedback: z.string().trim().max(4000)
    }).strict().parse(request.body);
    const reviewedAt = feedback ? new Date().toISOString() : null;
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_results")
      .update({
        assessor_feedback: feedback || null,
        reviewed_at: reviewedAt,
        reviewed_by: feedback ? request.authUserId : null
      })
      .eq("id", resultId)
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .select("id, assessor_feedback, reviewed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Loading, Unloading & Restraint Compliance result not found." });
      return;
    }
    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_feedback_updated", {
        resultId,
        feedbackProvided: Boolean(feedback)
      });
    }
    response.json({ result: data });
  } catch (error) {
    next(error);
  }
});



app.get("/api/admin/loading-unloading-restraint-compliance/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("*")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ questions: data ?? [] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/loading-unloading-restraint-compliance/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Loading, Unloading & Restraint Compliance"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { count, error: countError } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (countError) throw countError;
    if ((count ?? 0) >= 10) {
      return response.status(400).json({ message: "A maximum of 10 loading, unloading & restraint compliance questions is allowed." });
    }
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      assessment_id: "loading_unloading_restraint_compliance",
      question: input.question,
      options: input.options,
      correct_answer: input.correct_answer,
      explanation: input.explanation ?? "",
      category: input.category ?? "Loading, Unloading & Restraint Compliance",
      sort_order: input.sort_order ?? 0,
      updated_at: now
    };
    const { error } = await supabaseAdmin.from("loading_unloading_restraint_compliance_questions").insert(row);
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_created", { questionId: id });
    response.status(201).json({ question: { ...row, created_at: now } });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/loading-unloading-restraint-compliance/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const schema = z.object({
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2).max(6),
      correct_answer: z.number().int().min(0),
      explanation: z.string().optional().default(""),
      category: z.string().optional().default("Loading, Unloading & Restraint Compliance"),
      sort_order: z.coerce.number().optional()
    });
    const input = schema.parse(request.body);
    if (input.correct_answer >= input.options.length) {
      return response.status(400).json({ message: "Select a correct answer from the available options." });
    }
    const { error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .update({
        question: input.question,
        options: input.options,
        correct_answer: input.correct_answer,
        explanation: input.explanation ?? "",
        category: input.category ?? "Loading, Unloading & Restraint Compliance",
        sort_order: input.sort_order ?? 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", questionId)
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_updated", { questionId });
    response.json({ question: { id: questionId, assessment_id: "loading_unloading_restraint_compliance", ...input } });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/loading-unloading-restraint-compliance/questions/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.id);
    const { error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .delete()
      .eq("id", questionId)
      .eq("assessment_id", "loading_unloading_restraint_compliance");
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_question_deleted", { questionId });
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/loading-unloading-restraint-compliance/results", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_results")
      .select("id, user_id, score, total_questions, passed, completed_at, answers, assessor_feedback, reviewed_at")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);
    if (error) throw error;
    const { data: currentQuestions, error: questionsError } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("id, question, options, correct_answer")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (questionsError) throw questionsError;
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const nameMap = new Map((profiles ?? []).map((p: any) => [String(p.id), p.full_name || p.email || "Driver"]));
    const attempts = addLurcAttemptNumbers(rows ?? []);
    const results = attempts.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      driver_name: nameMap.get(String(r.user_id)) ?? "Driver",
      attempt_number: r.attempt_number,
      score: r.score,
      total_questions: r.total_questions,
      completed_at: r.completed_at,
      passed: r.passed,
      assessor_feedback: r.assessor_feedback,
      reviewed_at: r.reviewed_at,
      answers: Array.isArray(r.answers)
        ? r.answers
        : buildLurcAnswerReview((currentQuestions ?? []) as any, r.answers ?? {})
    }));
    response.json({ results });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/loading-unloading-restraint-compliance/results/:resultId/feedback", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const resultId = z.string().uuid().parse(String(request.params.resultId));
    const { feedback } = z.object({
      feedback: z.string().trim().max(4000)
    }).strict().parse(request.body);
    const reviewedAt = feedback ? new Date().toISOString() : null;
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_results")
      .update({
        assessor_feedback: feedback || null,
        reviewed_at: reviewedAt,
        reviewed_by: feedback ? request.authUserId : null
      })
      .eq("id", resultId)
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .select("id, assessor_feedback, reviewed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Loading, Unloading & Restraint Compliance result not found." });
      return;
    }
    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_feedback_updated", {
        resultId,
        feedbackProvided: Boolean(feedback)
      });
    }
    response.json({ result: data });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/cms/sections/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const sectionId = String(request.params.id);
    const schema = z.object({
      title: z.string().optional(),
      summary: z.string(),
      format: z.string(),
      video_url: z.string().nullable().optional(),
      video_duration_seconds: z.coerce.number().optional(),
      require_full_watch: z.boolean().optional(),
      media_json: z.record(z.unknown()).optional(),
      audience: z.enum(["all", "employee", "contractor"]).optional(),
      target_role: z.enum(["all", "driver", "warehouse", "office"]).optional(),
      is_mandatory: z.boolean().optional(),
      version: z.string().optional()
    });
    const parsed = schema.parse(request.body);

    const { error } = await supabaseAdmin.from("learning_sections").update(parsed).eq("id", sectionId);
    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_updated_section", { sectionId });
    }
    response.json({ message: "Section updated." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/sections", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const schema = z.object({
      id: z.string().uuid().optional(),
      title: z.string().trim().min(1),
      summary: z.string().default(""),
      format: z.string().default("Video + Text"),
      sort_order: z.coerce.number().optional(),
      video_url: z.string().nullable().optional(),
      media_json: z.record(z.unknown()).optional(),
      video_duration_seconds: z.coerce.number().optional(),
      require_full_watch: z.boolean().optional(),
      audience: z.enum(["all", "employee", "contractor"]).optional(),
      target_role: z.enum(["all", "driver", "warehouse", "office"]).optional(),
      is_mandatory: z.boolean().optional(),
      version: z.string().optional()
    });
    const input = schema.parse(request.body);
    const id = input.id ?? crypto.randomUUID();
    const payload = {
      id,
      title: input.title,
      summary: input.summary,
      format: input.format,
      sort_order: input.sort_order ?? 1,
      video_url: input.video_url ?? null,
      media_json: input.media_json ?? {},
      video_duration_seconds: input.video_duration_seconds ?? 0,
      require_full_watch: input.require_full_watch ?? false,
      audience: input.audience ?? "all",
      target_role: input.target_role ?? "driver",
      is_mandatory: input.is_mandatory ?? true,
      version: input.version ?? "1.0",
      created_at: new Date().toISOString()
    };
    const { error } = await writeWithFallback("learning_sections", "insert", payload, undefined, { selectResult: false });
    if (error) throw error;
    if (request.authUserId) await logAuditEntry(request.authUserId, "admin_created_section", { sectionId: id });
    response.status(201).json({ id, message: "Module created." });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Module Extras + Templates + Publish to Drivers
// ============================================================

const MIGRATION_015_MESSAGE =
  "Migration 015 has not been applied to this database. Run supabase/migrations/015_module_extras_and_templates.sql (or the SQL in the README) first.";

// Columns that only exist once migration 015 has run.
const MIGRATION_015_ONLY_KEYS = [
  "is_template",
  "site_tag",
  "media_json",
  "source_slide_id",
  "correct_answers",
  "accepted_answers"
];

// PostgREST reports a missing column as 42703 (Postgres undefined_column) or
// PGRST204 ("could not find the X column in the schema cache").
function isMissingColumnError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42703" || code === "PGRST204") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("schema cache");
}

// Strips the migration-015-only columns so a request still succeeds against a
// database that has not had that migration applied.
function withoutNewColumns(payload: Record<string, any>): Record<string, any> {
  const cleaned = { ...payload };
  for (const key of MIGRATION_015_ONLY_KEYS) delete cleaned[key];
  return cleaned;
}

// Tries a write with the full payload, and retries without the new columns when
// the database reports one of them missing. Returns the row plus a flag.
async function writeWithFallback(
  table: string,
  mode: "insert" | "update",
  payload: Record<string, any>,
  match?: Record<string, any>,
  options?: { selectResult?: boolean }
): Promise<{ data: any; error: any; degraded: boolean }> {
  const wantRow = options?.selectResult !== false;

  const run = (body: Record<string, any>) => {
    let query = mode === "insert"
      ? supabaseAdmin.from(table).insert(body)
      : supabaseAdmin.from(table).update(body);

    for (const [key, value] of Object.entries(match ?? {})) {
      query = (query as any).eq(key, value);
    }

    // For updates, the row must exist - use .single() to catch missing rows
    // For inserts, .maybeSingle() is fine (returns the new row)
    return wantRow
      ? query.select()[mode === "update" ? "single" : "maybeSingle"]()
      : query;
  };

  const first = await run(payload);
  if (!first.error) return { data: first.data ?? null, error: null, degraded: false };
  // If update affects 0 rows (PGRST116), treat as "not found" rather than retry
  if (mode === "update" && first.error?.code === "PGRST116") {
    return { data: null, error: { ...first.error, message: "Row not found" }, degraded: false };
  }
  if (!isMissingColumnError(first.error)) return { data: null, error: first.error, degraded: false };

  // One of the new columns is absent — retry without any of them.
  const retryPayload = withoutNewColumns(payload);
  if (Object.keys(retryPayload).length === 0) {
    return { data: null, error: first.error, degraded: true };
  }

  const second = await run(retryPayload);
  return { data: second.data ?? null, error: second.error, degraded: true };
}

// ============================================================================
// Course / Slide / Question routes
//
// These back the Site Inductions course builder and were never registered, so
// every call fell through to a "Cannot PATCH/GET …" 404 before dropping back to
// a direct Supabase query. Registering them makes the API path authoritative
// (service-role, so RLS can never block an admin) and stops the log noise.
//
// All of them are additive — no existing route is replaced.
// ============================================================================

// ---------------------------- Courses ----------------------------

app.get("/api/admin/cms/courses", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("induction_courses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/courses", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const body = request.body ?? {};
    const now = new Date().toISOString();

    if (!String(body.title ?? "").trim()) {
      response.status(400).json({ message: "A course title is required." });
      return;
    }

    const payload = {
      id: crypto.randomUUID(),
      title: String(body.title),
      description: String(body.description ?? ""),
      template_id: body.templateId ?? null,
      version_label: String(body.versionLabel ?? "1.0"),
      revision_notes: String(body.revisionNotes ?? "Initial draft"),
      is_template: Boolean(body.isTemplate),
      site_tag: String(body.siteTag ?? "global"),
      created_by: request.authUserId ?? null,
      created_at: now,
      updated_at: now
    };

    const { data, error } = await writeWithFallback("induction_courses", "insert", payload);
    if (error) throw error;
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/cms/courses/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);
    const body = request.body ?? {};

    const payload = {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.description !== undefined ? { description: String(body.description) } : {}),
      ...(body.versionLabel !== undefined ? { version_label: String(body.versionLabel) } : {}),
      ...(body.revisionNotes !== undefined ? { revision_notes: String(body.revisionNotes) } : {}),
      ...(body.isCurrent !== undefined ? { is_current: Boolean(body.isCurrent) } : {}),
      ...(body.isTemplate !== undefined ? { is_template: Boolean(body.isTemplate) } : {}),
      ...(body.siteTag !== undefined ? { site_tag: String(body.siteTag) } : {}),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await writeWithFallback(
      "induction_courses",
      "update",
      payload,
      { id: courseId }
    );
    if (error) throw error;
    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/cms/courses/:id", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);

    // quiz_questions has no cascade in the schema, so remove a slide's
    // questions before the slide itself.
    const { data: slides } = await supabaseAdmin
      .from("induction_slides")
      .select("id")
      .eq("course_id", courseId);

    for (const slide of slides ?? []) {
      const { error: qError } = await supabaseAdmin.from("quiz_questions").delete().eq("slide_id", slide.id);
      if (qError) throw qError;
    }

    const { error: slideError } = await supabaseAdmin.from("induction_slides").delete().eq("course_id", courseId);
    if (slideError) throw slideError;

    const { error } = await supabaseAdmin.from("induction_courses").delete().eq("id", courseId);
    if (error) throw error;

    response.json({ message: "Course deleted." });
  } catch (error) {
    next(error);
  }
});

// ----------------------------- Slides -----------------------------

app.get("/api/admin/cms/courses/:id/slides", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);
    const { data, error } = await supabaseAdmin
      .from("induction_slides")
      .select("*")
      .eq("course_id", courseId)
      .order("slide_order", { ascending: true });
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/courses/:id/slides", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);
    const body = request.body ?? {};
    const now = new Date().toISOString();

    if (body.slideOrder === undefined) {
      const { data: last } = await supabaseAdmin
        .from("induction_slides")
        .select("slide_order")
        .eq("course_id", courseId)
        .order("slide_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      body.slideOrder = Number(last?.slide_order ?? 0) + 1;
    }

    const payload = {
      id: crypto.randomUUID(),
      course_id: courseId,
      slide_order: Number(body.slideOrder) || 1,
      slide_type: String(body.slideType ?? "text"),
      title: String(body.title ?? "New Slide"),
      content_json: body.contentJson ?? {},
      site_tag: String(body.siteTag ?? "global"),
      video_url: body.videoUrl ?? null,
      audio_url: body.audioUrl ?? null,
      forced_wait_seconds: Number(body.forcedWaitSeconds ?? 0),
      estimated_duration_seconds: Number(body.estimatedDurationSeconds ?? 0),
      trigger_config: body.triggerConfig ?? {},
      created_at: now,
      updated_at: now
    };

    const { data, error } = await writeWithFallback("induction_slides", "insert", payload);
    if (error) {
      if (String(error.code) === "23502" && String(error.message).includes("section_id")) {
        response.status(409).json({
          message: "The database still requires induction_slides.section_id. Apply migration 017_allow_course_induction_slides.sql, then retry."
        });
        return;
      }
      throw error;
    }
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/cms/courses/:id/slides/:slideId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const slideId = String(request.params.slideId);
    const body = request.body ?? {};

    const payload = {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.slideType !== undefined ? { slide_type: String(body.slideType) } : {}),
      ...(body.contentJson !== undefined ? { content_json: body.contentJson } : {}),
      ...(body.slideOrder !== undefined ? { slide_order: Number(body.slideOrder) } : {}),
      ...(body.videoUrl !== undefined ? { video_url: body.videoUrl ?? null } : {}),
      ...(body.audioUrl !== undefined ? { audio_url: body.audioUrl ?? null } : {}),
      ...(body.forcedWaitSeconds !== undefined ? { forced_wait_seconds: Number(body.forcedWaitSeconds) } : {}),
      ...(body.estimatedDurationSeconds !== undefined ? { estimated_duration_seconds: Number(body.estimatedDurationSeconds) } : {}),
      ...(body.triggerConfig !== undefined ? { trigger_config: body.triggerConfig } : {}),
      ...(body.siteTag !== undefined ? { site_tag: String(body.siteTag) } : {}),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await writeWithFallback(
      "induction_slides",
      "update",
      payload,
      { id: slideId }
    );
    if (error) throw error;
    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/cms/courses/:id/slides/:slideId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const slideId = String(request.params.slideId);

    const { error: qError } = await supabaseAdmin.from("quiz_questions").delete().eq("slide_id", slideId);
    if (qError) throw qError;

    const { error } = await supabaseAdmin.from("induction_slides").delete().eq("id", slideId);
    if (error) throw error;

    response.json({ message: "Slide deleted." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/courses/:id/slides/reorder", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);
    const orders: Array<{ slideId: string; slideOrder: number }> = Array.isArray(request.body?.orders)
      ? request.body.orders
      : [];

    if (orders.length === 0) {
      response.status(400).json({ message: "No reorder instructions supplied." });
      return;
    }

    const now = new Date().toISOString();
    for (const item of orders) {
      const { error } = await supabaseAdmin
        .from("induction_slides")
        .update({ slide_order: Number(item.slideOrder), updated_at: now })
        .eq("id", String(item.slideId))
        .eq("course_id", courseId);
      if (error) throw error;
    }

    response.json({ message: "Slide order updated." });
  } catch (error) {
    next(error);
  }
});

// ------------------------ Slide questions ------------------------

app.get("/api/admin/cms/slides/:slideId/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const slideId = String(request.params.slideId);
    const { data, error } = await supabaseAdmin
      .from("quiz_questions")
      .select("*")
      .eq("slide_id", slideId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/cms/slides/:slideId/questions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const slideId = String(request.params.slideId);
    const body = request.body ?? {};
    const now = new Date().toISOString();

    if (!String(body.question ?? "").trim()) {
      response.status(400).json({ message: "Question text is required." });
      return;
    }

    const payload = {
      id: crypto.randomUUID(),
      slide_id: slideId,
      question: String(body.question),
      options: Array.isArray(body.options) ? body.options.map(String) : [],
      correct_answer: Number(body.correctAnswer ?? 0),
      correct_answers: Array.isArray(body.correctAnswers)
        ? body.correctAnswers.map(Number)
        : [Number(body.correctAnswer ?? 0)],
      accepted_answers: Array.isArray(body.acceptedAnswers) ? body.acceptedAnswers.map(String) : [],
      explanation: String(body.explanation ?? ""),
      category: String(body.category ?? "Site Rules"),
      is_critical: Boolean(body.isCritical),
      question_type: String(body.questionType ?? "single_choice"),
      placement: String(body.placement ?? "below_slide"),
      sort_order: Number(body.sortOrder ?? 1),
      created_at: now
    };

    const { data, error } = await writeWithFallback("quiz_questions", "insert", payload);
    if (error) throw error;
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/cms/slides/:slideId/questions/:questionId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.questionId);
    const body = request.body ?? {};

    const payload = {
      ...(body.question !== undefined ? { question: String(body.question) } : {}),
      ...(body.options !== undefined ? { options: Array.isArray(body.options) ? body.options.map(String) : [] } : {}),
      ...(body.correctAnswer !== undefined ? { correct_answer: Number(body.correctAnswer) } : {}),
      ...(body.correctAnswers !== undefined ? { correct_answers: body.correctAnswers.map(Number) } : {}),
      ...(body.acceptedAnswers !== undefined ? { accepted_answers: body.acceptedAnswers.map(String) } : {}),
      ...(body.explanation !== undefined ? { explanation: String(body.explanation) } : {}),
      ...(body.category !== undefined ? { category: String(body.category) } : {}),
      ...(body.isCritical !== undefined ? { is_critical: Boolean(body.isCritical) } : {}),
      ...(body.questionType !== undefined ? { question_type: String(body.questionType) } : {}),
      ...(body.placement !== undefined ? { placement: String(body.placement) } : {}),
      ...(body.sortOrder !== undefined ? { sort_order: Number(body.sortOrder) } : {})
    };

    const { data, error } = await writeWithFallback(
      "quiz_questions",
      "update",
      payload,
      { id: questionId }
    );
    if (error) throw error;
    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/cms/slides/:slideId/questions/:questionId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const questionId = String(request.params.questionId);
    const { error } = await supabaseAdmin.from("quiz_questions").delete().eq("id", questionId);
    if (error) throw error;
    response.json({ message: "Question deleted." });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/cms/templates - list courses flagged as reusable templates
app.get("/api/admin/cms/templates", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("induction_courses")
      .select("id, title, description, site_tag, version_label, updated_at")
      .eq("is_template", true)
      .order("updated_at", { ascending: false });

    // The filter column only exists after migration 015. Until then there are no
    // templates to report, so answer with an empty list rather than failing.
    if (error) {
      if (isMissingColumnError(error)) {
        response.json([]);
        return;
      }
      throw error;
    }
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/cms/courses/:id/mark-template - flag / unflag a course as a master blueprint
app.post("/api/admin/cms/courses/:id/mark-template", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const courseId = String(request.params.id);
    const schema = z.object({ isTemplate: z.boolean().optional().default(true) });
    const { isTemplate } = schema.parse(request.body ?? {});

    const { error } = await supabaseAdmin
      .from("induction_courses")
      .update({ is_template: isTemplate, updated_at: new Date().toISOString() })
      .eq("id", courseId);
    if (error) {
      if (isMissingColumnError(error)) {
        response.status(400).json({ message: MIGRATION_015_MESSAGE });
        return;
      }
      throw error;
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_course_marked_template", { courseId, isTemplate });
    }
    response.json({ message: isTemplate ? "Course marked as template." : "Template flag removed." });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/cms/courses/:id/clone - deep-copy a template into a new site variant
// Copies every slide in order, plus each slide's media and questions.
// Videos, images, PDFs and voiceovers are reused by URL — nothing is re-uploaded.
app.post("/api/admin/cms/courses/:id/clone", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const sourceCourseId = String(request.params.id);
    const schema = z.object({
      title: z.string().min(1),
      siteTag: z.string().min(1).default("global")
    });
    const parsed = schema.parse(request.body);
    const now = new Date().toISOString();

    const { data: sourceCourse, error: courseError } = await supabaseAdmin
      .from("induction_courses")
      .select("*")
      .eq("id", sourceCourseId)
      .single();
    if (courseError) throw courseError;

    const newCourseId = crypto.randomUUID();
    const { data: newCourse, error: insertError } = await supabaseAdmin
      .from("induction_courses")
      .insert({
        id: newCourseId,
        title: parsed.title,
        description: sourceCourse.description || "",
        template_id: sourceCourseId,
        site_tag: parsed.siteTag,
        version_label: "1.0",
        revision_notes: `Cloned from ${sourceCourse.title}`,
        is_template: false,
        is_current: false,
        created_by: request.authUserId ?? null,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();
    if (insertError) throw insertError;

    const { data: sourceSlides, error: slidesError } = await supabaseAdmin
      .from("induction_slides")
      .select("*")
      .eq("course_id", sourceCourseId)
      .order("slide_order", { ascending: true });
    if (slidesError) throw slidesError;

    let slidesCopied = 0;
    let questionsCopied = 0;

    for (const slide of sourceSlides ?? []) {
      const newSlideId = crypto.randomUUID();
      const { error: slideInsertError } = await supabaseAdmin
        .from("induction_slides")
        .insert({
          id: newSlideId,
          course_id: newCourseId,
          slide_order: slide.slide_order,
          slide_type: slide.slide_type,
          title: slide.title,
          content_json: slide.content_json ?? {},
          site_tag: parsed.siteTag,
          video_url: slide.video_url ?? null,
          audio_url: slide.audio_url ?? null,
          forced_wait_seconds: slide.forced_wait_seconds ?? 0,
          estimated_duration_seconds: slide.estimated_duration_seconds ?? 0,
          trigger_config: slide.trigger_config ?? {},
          created_at: now,
          updated_at: now
        });
      if (slideInsertError) throw slideInsertError;
      slidesCopied += 1;

      const { data: sourceQuestions, error: qError } = await supabaseAdmin
        .from("quiz_questions")
        .select("*")
        .eq("slide_id", slide.id);
      if (qError) throw qError;

      for (const q of sourceQuestions ?? []) {
        const { error: qInsertError } = await supabaseAdmin.from("quiz_questions").insert({
          question: q.question,
          options: q.options ?? [],
          correct_answer: q.correct_answer ?? 0,
          explanation: q.explanation || "",
          category: q.category || "Site Rules",
          is_critical: q.is_critical ?? false,
          question_type: q.question_type || "single_choice",
          placement: q.placement || "below_slide",
          slide_id: newSlideId,
          sort_order: q.sort_order ?? 1,
          created_at: now
        });
        if (qInsertError) throw qInsertError;
        questionsCopied += 1;
      }
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_course_cloned", {
        sourceCourseId,
        newCourseId,
        siteTag: parsed.siteTag,
        slidesCopied,
        questionsCopied
      });
    }

    response.status(201).json({ course: newCourse, slidesCopied, questionsCopied });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/cms/courses/:id/publish - push a course's slides into the
// table drivers already read (learning_sections). Existing drivers keep working:
// - slides are matched by source_slide_id, so re-publishing updates in place
// - only this course's site_tag is written, so other sites are untouched
// - nothing is deleted
app.post("/api/admin/cms/courses/:id/publish", requireAdmin, async (request: AdminRequest, response, next) => {
  let publishOperation = "checking publish schema";
  try {
    const courseId = String(request.params.id);
    const now = new Date().toISOString();
    const body = request.body ?? {};

    const [
      { error: learningSchemaError },
      { error: courseSchemaError },
      { error: questionSchemaError }
    ] = await Promise.all([
      supabaseAdmin.from("learning_sections").select("media_json, site_tag, source_slide_id").limit(0),
      supabaseAdmin.from("induction_courses").select("site_tag, is_template").limit(0),
      supabaseAdmin.from("quiz_questions").select("correct_answers, accepted_answers").limit(0)
    ]);
    if (learningSchemaError || courseSchemaError || questionSchemaError) {
      const schemaError = learningSchemaError ?? courseSchemaError ?? questionSchemaError;
      if (isMissingColumnError(schemaError)) {
        response.status(503).json({
          message: "Course publishing needs Supabase migration 015. Apply supabase/migrations/015_module_extras_and_templates.sql, then retry."
        });
        return;
      }
      if (String(schemaError?.code ?? "") === "42P01") {
        response.status(503).json({
          message: "Course publishing needs Supabase migrations 012 and 015. Apply supabase/migrations/012_slide_course_builder.sql and 015_module_extras_and_templates.sql, then retry."
        });
        return;
      }
      throw schemaError;
    }

    publishOperation = "loading course";
    const { data: course, error: courseError } = await supabaseAdmin
      .from("induction_courses")
      .select("*")
      .eq("id", courseId)
      .single();
    if (courseError) throw courseError;

    // The version fields in the publish dialog used to be ignored by the client,
    // leaving every published slide tagged with the original course version.
    if (body.versionLabel !== undefined || body.revisionNotes !== undefined) {
      publishOperation = "saving course version";
      const versionUpdate = {
        ...(body.versionLabel !== undefined ? { version_label: String(body.versionLabel).trim() || course.version_label || "1.0" } : {}),
        ...(body.revisionNotes !== undefined ? { revision_notes: String(body.revisionNotes) } : {}),
        updated_at: now
      };
      const { error } = await supabaseAdmin.from("induction_courses").update(versionUpdate).eq("id", courseId);
      if (error) throw error;
      Object.assign(course, versionUpdate);
    }

    const siteTag = String(course.site_tag || "global");

    publishOperation = "loading course slides";
    const { data: slides, error: slidesError } = await supabaseAdmin
      .from("induction_slides")
      .select("*")
      .eq("course_id", courseId)
      .order("slide_order", { ascending: true });
    if (slidesError) throw slidesError;

    if (!slides || slides.length === 0) {
      return response.status(400).json({ message: "This course has no slides to publish." });
    }

    // Highest existing global order, so published slides append after the
    // shared modules instead of shuffling them.
    publishOperation = "reading module order";
    const { data: maxOrderRow, error: maxOrderError } = await supabaseAdmin
      .from("learning_sections")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxOrderError) throw maxOrderError;
    let nextOrder = Number(maxOrderRow?.sort_order ?? 0) + 1;

    let published = 0;
    let updated = 0;

    for (const slide of slides) {
      // Slide questions live in quiz_questions, linked by slide_id.
      publishOperation = "loading slide questions";
      const { data: slideQuestions, error: slideQuestionsError } = await supabaseAdmin
        .from("quiz_questions")
        .select("*")
        .eq("slide_id", slide.id)
        .order("sort_order", { ascending: true });
      if (slideQuestionsError) throw slideQuestionsError;

      const media = buildMediaJson(slide, slideQuestions ?? []);
      const summary = JSON.stringify({
        intro: slide.content_json?.body ?? "",
        bullets: [] as string[],
        scenario: slide.content_json?.scenario ?? ""
      });

      const payload = {
        title: slide.title,
        format: slide.slide_type,
        summary,
        sort_order: nextOrder,
        video_url: slide.video_url ?? null,
        video_duration_seconds: slide.estimated_duration_seconds ?? 0,
        require_full_watch: (slide.forced_wait_seconds ?? 0) > 0,
        media_json: media,
        site_tag: siteTag
      };

      // Match an existing published row so a re-publish is an update, not a duplicate.
      publishOperation = "checking for an existing published slide";
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("learning_sections")
        .select("id")
        .eq("source_slide_id", slide.id)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing?.id) {
        publishOperation = "updating an existing published slide";
        const { error } = await writeWithFallback(
          "learning_sections",
          "update",
          payload,
          { id: existing.id },
          { selectResult: false }
        );
        if (error) throw error;
        updated += 1;
      } else {
        publishOperation = "publishing a new slide";
        const { error } = await writeWithFallback(
          "learning_sections",
          "insert",
          {
            ...payload,
            id: crypto.randomUUID(),
            source_slide_id: slide.id,
            version: course.version_label || "1.0",
            effective_date: now,
            created_at: now
          },
          undefined,
          { selectResult: false }
        );
        if (error) throw error;
        published += 1;
      }
      nextOrder += 1;
    }

    // Mark the variant as the live one for its site.
    // Other courses sharing this site (or cloned from the same template) must be
    // demoted first, otherwise the "only one current course" unique index
    // (induction_courses_current_idx) rejects the update.
    const now2 = now;
    publishOperation = "updating the current course for this site";
    const { error: demoteError } = await supabaseAdmin
      .from("induction_courses")
      .update({ is_current: false, updated_at: now2 })
      .neq("id", courseId)
      .or(`site_tag.eq.${siteTag},template_id.eq.${courseId}`);
    if (demoteError) throw demoteError;

    const { error: courseUpdateError } = await supabaseAdmin
      .from("induction_courses")
      .update({
        is_current: true,
        published_at: now2,
        published_by: request.authUserId ?? null,
        updated_at: now2
      })
      .eq("id", courseId);
    if (courseUpdateError) throw courseUpdateError;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_course_published_to_drivers", {
        courseId,
        siteTag,
        published,
        updated
      });
    }

    response.json({
      message: `Published ${published + updated} slide(s) to the ${siteTag} site.`,
      published,
      updated,
      siteTag
    });
  } catch (error) {
    console.error(`[CMS PUBLISH] Failed while ${publishOperation}:`, error);
    response.status(500).json({
      message: `Course publishing failed while ${publishOperation}. Check the API server logs for the database error, then retry.`
    });
  }
});

// Translate a slide row into the media_json the driver's ModuleExtras reads.
// `slideQuestions` is fetched from quiz_questions (where slide questions live),
// not from content_json.
function buildMediaJson(slide: Record<string, any>, slideQuestions: any[] = []) {
  const content = slide.content_json ?? {};
  const hasOrderedContent = Array.isArray(content.contentItems) && content.contentItems.length > 0;

  const images: Array<{ url: string; caption?: string; alt?: string }> = [];
  if (content.imageUrl) {
    images.push({ url: String(content.imageUrl), caption: content.imageCaption ?? "", alt: String(slide.title ?? "") });
  }
  if (Array.isArray(content.images)) {
    for (const img of content.images) {
      if (img?.url) images.push({ url: String(img.url), caption: img.caption ?? "", alt: img.alt ?? "" });
    }
  }

  const documents: Array<{ url: string; name?: string; pages?: number; requireRead?: boolean }> = [];
  if (content.docUrl) {
    documents.push({
      url: String(content.docUrl),
      name: content.docName ?? String(slide.title ?? "Document"),
      pages: Number(content.docPages ?? 0) || undefined,
      requireRead: Boolean(content.requireRead)
    });
  }
  if (Array.isArray(content.documents)) {
    for (const doc of content.documents) {
      if (doc?.url) documents.push({ url: String(doc.url), name: doc.name, pages: doc.pages, requireRead: Boolean(doc.requireRead) });
    }
  }

  const voiceover = slide.audio_url
    ? { url: String(slide.audio_url), language: content.voiceoverLanguage ?? "en" }
    : null;

  const attachments: Array<{ url: string; name?: string }> = Array.isArray(content.attachments)
    ? content.attachments.filter((a: any) => a?.url).map((a: any) => ({ url: String(a.url), name: a.name }))
    : [];

  const questions = slideQuestions.map((q, idx) => {
    const type = q.question_type || "single_choice";
    const correct = Number(q.correct_answer ?? 0);
    const storedMulti = Array.isArray(q.correct_answers) ? q.correct_answers.map(Number) : [];
    const storedAccepted = Array.isArray(q.accepted_answers) ? q.accepted_answers.map(String) : [];

    return {
      id: String(q.id ?? `q-${slide.id}-${idx}`),
      prompt: String(q.question ?? ""),
      questionType: type,
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      correctAnswer: correct,
      correctAnswers: type === "multiple_choice"
        ? (storedMulti.length > 0 ? storedMulti : [correct])
        : [correct],
      acceptedAnswers: storedAccepted,
      explanation: String(q.explanation ?? ""),
      placement: q.placement || "below_slide"
    };
  });

  return {
    contentItems: normalizeCourseContentItems(slide),
    images: hasOrderedContent ? [] : images,
    documents: hasOrderedContent ? [] : documents,
    voiceover: hasOrderedContent ? null : voiceover,
    warning: content.warningCallout ? String(content.warningCallout) : undefined,
    forcedWaitSeconds: Number(slide.forced_wait_seconds ?? 0) || undefined,
    textSize: content.textSize ?? undefined,
    questions,
    attachments
  };
}

app.get("/api/admin/reports/export", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const format = String(request.query.format ?? "csv");
    const scope = String(request.query.scope ?? "drivers");
    const from = request.query.from ? new Date(String(request.query.from)) : null;
    const to = request.query.to ? new Date(String(request.query.to)) : null;
    const driverId = request.query.driverId ? String(request.query.driverId) : null;

    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new Error("Use a valid date range for reporting.");
    }

    let rows: Array<Record<string, string | number | boolean | null>> = [];
    let filename = "driver-induction-report";
    let title = `${organizationName} Driver Induction Report`;

    if (scope === "audit") {
      let query = supabaseAdmin
        .from("audit_logs")
        .select("id,user_id,action,metadata,created_at")
        .order("created_at", { ascending: false });

      if (driverId) query = query.eq("user_id", driverId);
      if (from) query = query.gte("created_at", from.toISOString());
      if (to) query = query.lte("created_at", to.toISOString());

      const { data: auditLogs, error: auditError } = await query;
      if (auditError) throw auditError;

      rows = (auditLogs ?? []).map((log) => ({
        id: log.id,
        userId: log.user_id,
        action: log.action,
        metadata: JSON.stringify(log.metadata ?? {}),
        createdAt: log.created_at
      }));
      filename = "audit-log-report";
      title = `${organizationName} Audit Log Report`;
    } else {
      const [{ data: profiles, error: profileError }, { data: drivers, error: driversError }, { data: progress, error: progressError }] =
        await Promise.all([
          supabaseAdmin.from("profiles").select("id,email,full_name").eq("role", "driver"),
          supabaseAdmin.from("drivers").select("user_id,status"),
          supabaseAdmin.from("induction_progress").select("user_id,current_step,completion_percentage,quiz_score,completed_at,updated_at")
        ]);

      if (profileError) throw profileError;
      if (driversError) throw driversError;
      if (progressError) throw progressError;

      rows = (profiles ?? [])
        .filter((profile) => !driverId || profile.id === driverId)
        .map((profile) => {
          const driver = (drivers ?? []).find((item) => item.user_id === profile.id);
          const progressRow = (progress ?? []).find((item) => item.user_id === profile.id);
          return {
            driverId: profile.id,
            fullName: profile.full_name ?? "",
            email: profile.email ?? "",
            status: driver?.status ?? "Not Started",
            progress: progressRow?.completion_percentage ?? 0,
            currentStep: progressRow?.current_step ?? 1,
            quizScore: progressRow?.quiz_score ?? null,
            completedAt: progressRow?.completed_at ?? null,
            updatedAt: progressRow?.updated_at ?? null
          };
        })
        .filter((row) => {
          if (!from && !to) return true;
          const reference = row.completedAt ?? row.updatedAt;
          if (!reference) return false;
          const timestamp = new Date(String(reference)).getTime();
          if (Number.isNaN(timestamp)) return false;
          if (from && timestamp < from.getTime()) return false;
          if (to && timestamp > to.getTime()) return false;
          return true;
        });

      if (driverId) {
        filename = "driver-report";
        title = `${organizationName} Driver Report`;
      }
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_report_exported", {
        format,
        scope,
        driverId,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        rowCount: rows.length
      });
    }

    if (format === "pdf") {
      const pdfBuffer = generateReportPdfBuffer({
        title,
        organizationName,
        rows
      });
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      response.send(pdfBuffer);
      return;
    }

    const header = Object.keys(rows[0] ?? { message: "" });
    // M-5 FIX: Use RFC 4180 CSV escaping (double quotes) not JSON escaping (backslash-quote).
    // JSON.stringify produced \"value\" which Excel and Sheets cannot parse.
    function csvEscape(value: unknown): string {
      const str = String(value ?? "");
      // If the string contains commas, newlines, or quotes, wrap in double-quotes
      if (str.includes(",") || str.includes("\n") || str.includes("\"")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }
    const csv = [
      header.join(","),
      ...(rows.length
        ? rows.map((row) => header.map((key) => csvEscape(row[key as keyof typeof row])).join(","))
        : ['"No records found for the selected filters."'])
    ].join("\n");
    response.setHeader("Content-Type", "text/csv");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    response.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/overview - Get reports overview metrics
app.get("/api/admin/reports/overview", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "driver");

    if (profileError) throw profileError;
    const totalDrivers = profiles?.length ?? 0;

    const { data: progress, error: progressError } = await supabaseAdmin
      .from("induction_progress")
      .select("user_id, current_step, completion_percentage, quiz_score, completed_at, updated_at");

    if (progressError) throw progressError;

    const attemptedInductions = progress?.filter(p => p.current_step > 1 || p.completed_at).length ?? 0;

    const { data: certificates, error: certError } = await supabaseAdmin
      .from("certificates")
      .select("id, user_id, issued_at, expires_at, induction_version_id")
      .not("expires_at", "is", null);

    if (certError) throw certError;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const validCertificates = certificates?.filter(c => new Date(c.expires_at!) > thirtyDaysFromNow).length ?? 0;
    const expiringCertificates = certificates?.filter(c => {
      const exp = new Date(c.expires_at!);
      return exp > now && exp <= thirtyDaysFromNow;
    }).length ?? 0;
    const expiredCertificates = certificates?.filter(c => new Date(c.expires_at!) <= now).length ?? 0;

    const { data: documents, error: docError } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, status, expires_at")
      .not("expires_at", "is", null);

    if (docError) throw docError;

    const expiringDocuments = documents?.filter(d => {
      const exp = new Date(d.expires_at!);
      return exp > now && exp <= thirtyDaysFromNow;
    }).length ?? 0;

    const pendingApprovals = documents?.filter(d => d.status === "pending").length ?? 0;

    const { data: enrollments, error: enrollError } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select("id, status")
      .eq("status", "active");

    if (enrollError) throw enrollError;

    const activeSchedules = enrollments?.length ?? 0;

    const { data: allEnrollments, error: allEnrollError } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select("id, status");

    if (allEnrollError) throw allEnrollError;

    const overdueSchedules = allEnrollments?.filter(e => e.status === "active").length ?? 0;

    response.json({
      totalDrivers,
      attemptedInductions,
      validCertificates,
      expiringCertificates,
      expiredCertificates,
      expiringDocuments,
      pendingApprovals,
      activeSchedules,
      overdueSchedules
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/attempted-inductions
app.get("/api/admin/reports/attempted-inductions", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: progress, error: progressError } = await supabaseAdmin
      .from("induction_progress")
      .select("user_id, current_step, completion_percentage, quiz_score, completed_at, updated_at, induction_version_id")
      .order("updated_at", { ascending: false });

    if (progressError) throw progressError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const { data: versions, error: versionError } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label");

    if (versionError) throw versionError;

    const versionMap = new Map((versions ?? []).map(v => [v.id, v.version_label]));

    const rows = (progress ?? []).map(p => {
      const profile = (profiles ?? []).find(pr => pr.id === p.user_id);
      return {
        driverId: p.user_id,
        driverName: profile?.full_name ?? "",
        driverEmail: profile?.email ?? "",
        inductionVersion: p.induction_version_id ? versionMap.get(p.induction_version_id) ?? "1.0" : "1.0",
        attemptCount: p.current_step > 1 ? 1 : 0,
        lastAttemptAt: p.updated_at,
        completedAt: p.completed_at,
        status: p.completed_at ? "Completed" : p.current_step > 1 ? "In Progress" : "Not Started",
        quizScore: p.quiz_score,
        timeSpentHours: null
      };
    });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/certificate-statuses
app.get("/api/admin/reports/certificate-statuses", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: certificates, error: certError } = await supabaseAdmin
      .from("certificates")
      .select("id, user_id, issued_at, expires_at, verification_code, induction_version_id")
      .not("expires_at", "is", null);

    if (certError) throw certError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const { data: versions, error: versionError } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label");

    if (versionError) throw versionError;

    const versionMap = new Map((versions ?? []).map(v => [v.id, v.version_label]));
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const rows = (certificates ?? []).map(c => {
      const profile = (profiles ?? []).find(p => p.id === c.user_id);
      const expDate = new Date(c.expires_at!);
      const daysUntilExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let status: "Valid" | "Expiring Soon" | "Expired" | "Revoked" = "Valid";
      if (expDate <= now) status = "Expired";
      else if (expDate <= thirtyDaysFromNow) status = "Expiring Soon";

      return {
        driverId: c.user_id,
        driverName: profile?.full_name ?? "",
        driverEmail: profile?.email ?? "",
        certificateId: c.id,
        verificationCode: c.verification_code,
        issuedAt: c.issued_at,
        expiresAt: c.expires_at,
        status,
        daysUntilExpiry: expDate > now ? daysUntilExpiry : null,
        inductionVersion: c.induction_version_id ? versionMap.get(c.induction_version_id) ?? "1.0" : "1.0"
      };
    });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/expiring-certificates
app.get("/api/admin/reports/expiring-certificates", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: certificates, error: certError } = await supabaseAdmin
      .from("certificates")
      .select("id, user_id, issued_at, expires_at, verification_code, induction_version_id")
      .not("expires_at", "is", null);

    if (certError) throw certError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const { data: versions, error: versionError } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label");

    if (versionError) throw versionError;

    const versionMap = new Map((versions ?? []).map(v => [v.id, v.version_label]));
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const rows = (certificates ?? [])
      .filter(c => {
        const expDate = new Date(c.expires_at!);
        return expDate > now && expDate <= thirtyDaysFromNow;
      })
      .map(c => {
        const profile = (profiles ?? []).find(p => p.id === c.user_id);
        const expDate = new Date(c.expires_at!);
        const daysUntilExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return {
          driverId: c.user_id,
          driverName: profile?.full_name ?? "",
          driverEmail: profile?.email ?? "",
          certificateId: c.id,
          verificationCode: c.verification_code,
          expiresAt: c.expires_at,
          daysUntilExpiry,
          inductionVersion: c.induction_version_id ? versionMap.get(c.induction_version_id) ?? "1.0" : "1.0"
        };
      });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/expiring-documents
app.get("/api/admin/reports/expiring-documents", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: documents, error: docError } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, file_name, type, expires_at, status")
      .not("expires_at", "is", null);

    if (docError) throw docError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const rows = (documents ?? [])
      .filter(d => {
        const expDate = new Date(d.expires_at!);
        return expDate > now && expDate <= thirtyDaysFromNow;
      })
      .map(d => {
        const profile = (profiles ?? []).find(p => p.id === d.user_id);
        const expDate = new Date(d.expires_at!);
        const daysUntilExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return {
          driverId: d.user_id,
          driverName: profile?.full_name ?? "",
          driverEmail: profile?.email ?? "",
          documentId: d.id,
          documentName: d.file_name ?? d.type?.replace(/_/g, " ") ?? "Document",
          documentType: d.type,
          expiresAt: d.expires_at,
          daysUntilExpiry,
          status: d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Pending"
        };
      });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/documents-for-approval
app.get("/api/admin/reports/documents-for-approval", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: documents, error: docError } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, file_name, type, status, uploaded_at, rejection_reason")
      .eq("status", "pending");

    if (docError) throw docError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const rows = (documents ?? []).map(d => {
      const profile = (profiles ?? []).find(p => p.id === d.user_id);
      return {
        driverId: d.user_id,
        driverName: profile?.full_name ?? "",
        driverEmail: profile?.email ?? "",
        documentId: d.id,
        documentName: d.file_name ?? d.type?.replace(/_/g, " ") ?? "Document",
        documentType: d.type,
        uploadedAt: d.uploaded_at,
        status: d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Pending",
        rejectionReason: d.rejection_reason
      };
    });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/reports/scheduled-status
app.get("/api/admin/reports/scheduled-status", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    // Items are fetched separately so a missing `title` column (pre-migration-014)
    // degrades titles instead of failing the whole report.
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("induction_schedule_items")
      .select("id, schedule_id, sequence_order, title")
      .order("sequence_order", { ascending: true });

    if (itemsError) throw itemsError;

    const { data: enrollments, error: enrollError } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select("id, driver_id, schedule_id, status, current_item_index, enrolled_at, completed_at");

    if (enrollError) throw enrollError;

    const { data: schedules, error: scheduleError } = await supabaseAdmin
      .from("induction_schedules")
      .select("id, name");

    if (scheduleError) throw scheduleError;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "driver");

    if (profileError) throw profileError;

    const scheduleMap = new Map((schedules ?? []).map(s => [s.id, s.name]));
    const itemsBySchedule = new Map<string, Array<{ sequence_order: number; title: string | null }>>();
    for (const item of items ?? []) {
      const list = itemsBySchedule.get(item.schedule_id) ?? [];
      list.push({ sequence_order: item.sequence_order, title: item.title ?? null });
      itemsBySchedule.set(item.schedule_id, list);
    }

    const rows = (enrollments ?? []).map(e => {
      const profile = (profiles ?? []).find(p => p.id === e.driver_id);
      const scheduleItems = itemsBySchedule.get(e.schedule_id) ?? [];
      const totalItems = scheduleItems.length;
      const currentIndex = e.current_item_index;
      const currentItem = scheduleItems.find(i => i.sequence_order === currentIndex + 1);
      const nextItem = scheduleItems.find(i => i.sequence_order === currentIndex + 2);

      let status: "Active" | "Completed" | "Overdue" | "Paused" | "Cancelled" = "Active";
      if (e.status === "completed" || e.completed_at) status = "Completed";
      else if (e.status === "paused") status = "Paused";
      else if (e.status === "cancelled") status = "Cancelled";
      else if (totalItems > 0 && currentIndex >= totalItems) status = "Completed";

      return {
        driverId: e.driver_id,
        driverName: profile?.full_name ?? "",
        driverEmail: profile?.email ?? "",
        scheduleId: e.schedule_id,
        scheduleName: scheduleMap.get(e.schedule_id) ?? "",
        enrollmentId: e.id,
        status,
        currentItemIndex: currentIndex,
        totalItems,
        currentItemTitle: currentItem?.title ?? null,
        nextItemTitle: nextItem?.title ?? null,
        enrolledAt: e.enrolled_at,
        completedAt: e.completed_at,
        nextDueAt: null
      };
    });

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

// Public driver ID verification (scanned from a driver QR badge)
app.get("/api/driver/verify/:driverId", rateLimit(30, 60_000), async (request, response, next) => {
  try {
    const driverId = String(request.params.driverId).trim();
    if (!driverId || !/^[A-Za-z0-9-]+$/.test(driverId)) {
      response.status(400).json({ verified: false, message: "Invalid driver ID." });
      return;
    }

    const driverSelect = "*, profiles:user_id (full_name, phone, licence_class)";

    // The QR badge encodes the driver's user id; fall back to the drivers table id
    let { data: driver, error } = await supabaseAdmin
      .from("drivers")
      .select(driverSelect)
      .eq("user_id", driverId)
      .maybeSingle();
    if (error) throw error;
    if (!driver) {
      const byDriverId = await supabaseAdmin
        .from("drivers")
        .select(driverSelect)
        .eq("id", driverId)
        .maybeSingle();
      if (byDriverId.error) throw byDriverId.error;
      driver = byDriverId.data;
    }
    if (!driver) {
      response.status(404).json({ verified: false, message: "Driver not found." });
      return;
    }

    // Induction progress and certificates link via profiles.user_id,
    // so query them separately (no direct FK from drivers)
    const { data: induction } = await supabaseAdmin
      .from("induction_progress")
      .select("completed_at, current_step")
      .eq("user_id", driver.user_id)
      .maybeSingle();
    const { data: certificate } = await supabaseAdmin
      .from("certificates")
      .select("expires_at, issued_at")
      .eq("user_id", driver.user_id)
      .maybeSingle();

    const completed = driver.status === "Completed" || induction?.completed_at != null;

    response.json({
      verified: true,
      organizationName,
      driver: {
        driverId: driver.id,
        fullName: driver.profiles?.full_name ?? "",
        phone: driver.profiles?.phone ?? "",
        licenceClass: driver.profiles?.licence_class ?? "",
        inductionStatus: driver.status ?? "Not Started",
        inductionCompleted: Boolean(completed),
        completedAt: induction?.completed_at ?? null,
        certificateExpiresAt: certificate?.expires_at ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/certificate/verify/:code", rateLimit(30, 60_000), async (request, response, next) => {
  try {
    const code = String(request.params.code).trim();
    // Accept either the verification code (VERIFY-…) or the completion id
    // (COMP-…) that is printed as the "Verification ID" on the certificate,
    // so any code shown on the certificate can be verified.
    if (!code || !/^[A-Za-z0-9-]+$/.test(code)) {
      if (request.headers.accept?.includes("text/html")) {
        response.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
        response.send(renderVerificationErrorPage(organizationName, organizationLogoUrl));
        return;
      }
      response.status(400).json({ verified: false, message: "Invalid verification code." });
      return;
    }
    const { data: certificate, error: certificateError } = await supabaseAdmin
      .from("certificates")
      .select("*")
      .or(`verification_code.eq.${code},completion_id.eq.${code}`)
      .maybeSingle();
    if (certificateError || !certificate) {
      if (request.headers.accept?.includes("text/html")) {
        response.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
        response.send(renderVerificationErrorPage(organizationName, organizationLogoUrl));
        return;
      }
      response.status(404).json({ verified: false, message: "Certificate not found." });
      return;
    }
    if (certificate.revoked_at || !isCurrentOnboardingDate(certificate.expires_at)) {
      const message = certificate.revoked_at ? "This certificate has been revoked." : "This certificate has expired.";
      if (request.headers.accept?.includes("text/html")) {
        response.status(410).setHeader("Content-Type", "text/html; charset=utf-8");
        response.send(renderVerificationErrorPage(organizationName, organizationLogoUrl));
        return;
      }
      response.status(410).json({ verified: false, message });
      return;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("full_name, licence_class, issuing_state, depot_location")
      .eq("id", certificate.user_id)
      .maybeSingle();
    if (profileError || !profile) {
      // Profile not found, continue with empty profile data
    }

    const payload = {
      verified: true,
      organizationName,
      certificate: {
        completionId: certificate.completion_id,
        verificationCode: certificate.verification_code,
        verificationUrl: `${appUrl}/certificate/verify/${certificate.verification_code}`,
        issuedAt: certificate.issued_at,
        expiresAt: certificate.expires_at
      },
      driver: {
        fullName: profile?.full_name ?? ""
      },
      licenceClass: profile?.licence_class ?? null,
      issuingState: profile?.issuing_state ?? null,
      depotLocation: profile?.depot_location ?? null
    };

    if (request.headers.accept?.includes("text/html")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.send(renderVerificationPage(payload, organizationLogoUrl));
      return;
    }

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

// Public vehicle site-pass verification (scanned from a vehicle QR pass).
// Returns the vehicle's identity, driver and compliance dates so a guard can
// check the truck independently of the driver's induction certificate.
app.get("/api/vehicle/verify/:passCode", rateLimit(30, 60_000), async (request, response, next) => {
  try {
    const passCode = String(request.params.passCode).trim();
    if (!passCode || !/^[A-Za-z0-9-]+$/.test(passCode)) {
      response.status(400).json({ verified: false, message: "Invalid pass code." });
      return;
    }

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from("driver_vehicles")
      .select("*, profiles:user_id (full_name, email)")
      .eq("qr_pass_code", passCode)
      .maybeSingle();
    if (vehicleError) throw vehicleError;
    if (!vehicle) {
      response.status(404).json({ verified: false, message: "Vehicle pass not found." });
      return;
    }

    response.json({
      verified: true,
      organizationName,
      vehicle: {
        passCode: vehicle.qr_pass_code,
        rego: vehicle.rego,
        makeModel: vehicle.make_model,
        bodyType: vehicle.body_type ?? null,
        branchName: vehicle.branch_name ?? null,
        status: vehicle.status,
        regoExpiryDate: vehicle.rego_expiry_date ?? null,
        dgExpiryDate: vehicle.dg_expiry_date ?? null,
        scbaServiceDueDate: vehicle.scba_service_due_date ?? null
      },
      driver: {
        fullName: vehicle.profiles?.full_name ?? "",
        email: vehicle.profiles?.email ?? ""
      }
    });
  } catch (error) {
    next(error);
  }
});

function renderVerificationPage(
  payload: {
    organizationName: string;
    certificate: { completionId: string; verificationCode: string; verificationUrl: string; issuedAt: string };
    driver: { fullName: string };
  },
  logoUrl: string
) {
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${payload.organizationName} logo" style="height:56px;max-width:180px;object-fit:contain;" />`
    : `<div style="font-weight:700;font-size:18px;">${payload.organizationName}</div>`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Certificate Verification</title>
      <style>
        body{margin:0;font-family:Inter,system-ui,sans-serif;background:linear-gradient(180deg,#eef4ff,#dbeafe);color:#10213a}
        .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
        .card{max-width:760px;width:100%;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.22);border-radius:28px;padding:32px;box-shadow:0 24px 60px rgba(37,99,235,.14)}
        .badge{display:inline-flex;padding:8px 12px;border-radius:999px;background:rgba(34,197,94,.14);color:#166534;font-weight:700;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:24px}
        .item{padding:16px;border-radius:18px;background:rgba(239,246,255,.9);border:1px solid rgba(148,163,184,.18)}
        small{color:#5b6b84;display:block;margin-top:6px}
        a{color:#2563eb;text-decoration:none}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          ${logo}
          <div class="badge">Certificate verified</div>
          <h1 style="margin:0 0 8px;">Driver induction completed</h1>
          <p style="margin:0;color:#5b6b84;">This certificate is valid and was issued by ${payload.organizationName}.</p>
          <div class="grid">
            <div class="item"><strong>Driver</strong><small>${payload.driver.fullName}</small></div>
            <div class="item"><strong>Verification ID</strong><small>${payload.certificate.completionId}</small></div>
            <div class="item"><strong>Verification code</strong><small>${payload.certificate.verificationCode}</small></div>
            <div class="item"><strong>Issued</strong><small>${new Date(payload.certificate.issuedAt).toLocaleString()}</small></div>
          </div>
          <p style="margin-top:24px;"><a href="${payload.certificate.verificationUrl}">Open verification link</a></p>
        </div>
      </div>
    </body>
  </html>`;
}

function renderVerificationErrorPage(organizationName: string, logoUrl: string) {
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${organizationName} logo" style="height:56px;max-width:180px;object-fit:contain;" />`
    : `<div style="font-weight:700;font-size:18px;">${organizationName}</div>`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Certificate Not Found</title>
      <style>
        body{margin:0;font-family:Inter,system-ui,sans-serif;background:linear-gradient(180deg,#eef4ff,#dbeafe);color:#10213a}
        .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
        .card{max-width:760px;width:100%;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.22);border-radius:28px;padding:32px;box-shadow:0 24px 60px rgba(37,99,235,.14)}
        .badge{display:inline-flex;padding:8px 12px;border-radius:999px;background:rgba(239,68,68,.12);color:#991b1b;font-weight:700;margin-bottom:16px}
        p{color:#5b6b84}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          ${logo}
          <div class="badge">Verification failed</div>
          <h1 style="margin:0 0 8px;">Certificate not found</h1>
          <p>The verification code is invalid, missing, or no longer linked to a certificate record.</p>
        </div>
      </div>
    </body>
  </html>`;
}

// --- Document validation endpoint ---
app.post("/api/documents/verify", rateLimit(10, 60_000), requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { documentType, userId } = request.body as { documentType: string; userId: string; fileUrl: string };
    if (!userId || !documentType) {
      response.status(400).json({ message: "userId and documentType are required." });
      return;
    }

    if (request.authUserId !== userId) {
      response.status(403).json({ message: "Forbidden: You can only verify your own documents." });
      return;
    }

    // Verify document exists in DB for this driver
    const { data: doc, error: docError } = await supabaseAdmin
      .from("documents")
      .select("id, type, mime_type, size_bytes, uploaded_at, expires_at")
      .eq("user_id", userId)
      .eq("type", documentType)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .single();

    if (docError || !doc) {
      response.status(404).json({ message: "Document not found for this driver." });
      return;
    }

    const isExpired = doc.expires_at ? new Date(doc.expires_at) < new Date() : false;
    const validMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    const hasValidType = !doc.mime_type || validMimeTypes.includes(String(doc.mime_type));

    response.json({
      message: "Document validated.",
      data: {
        isValid: !isExpired && hasValidType,
        documentType: doc.type,
        uploadedAt: doc.uploaded_at,
        expiresAt: doc.expires_at ?? null,
        isExpired
      }
    });
  } catch (error) {
    next(error);
  }
});

interface NotificationParams {
  eventType: "driver_created" | "induction_completed" | "induction_expiring" | "password_reset";
  userEmail: string;
  driverName?: string;
  context: Record<string, string>;
}

async function sendNotificationService(params: NotificationParams): Promise<boolean> {
  const { eventType, userEmail, driverName, context } = params;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? process.env.SMTP_USER ?? "admin@bntlogistics.com.au";
  const name = driverName ?? "Driver";
  let subject = "";
  let html = "";

  if (eventType === "driver_created") {
    subject = `Welcome to ${organizationName} — Your Induction Account Is Ready`;
    html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Welcome, ${name}!</h2>
      <p>Your induction account has been created at <strong>${organizationName}</strong>.</p>
      <p><strong>Login Email:</strong> ${userEmail}<br/>
         <strong>Temporary Password:</strong> ${context.temporaryPassword ?? "(provided by your admin)"}</p>
      <p><a href="${appUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Start Your Induction</a></p>
      <p style="color:#888;font-size:12px">Please change your password after your first login.</p>
    </div>`;
  } else if (eventType === "induction_completed") {
    const expiry = context.expiresAt ? new Date(context.expiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "12 months from today";
    subject = `Induction Complete — Certificate Issued by ${organizationName}`;
    html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Congratulations, ${name}!</h2>
      <p>You have successfully completed the <strong>${organizationName}</strong> Driver Induction Program.</p>
      <p>Your certificate is valid for <strong>12 months</strong> and expires on <strong>${expiry}</strong>.</p>
      <p><a href="${context.certificateUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">View Certificate</a></p>
    </div>`;
  } else if (eventType === "induction_expiring") {
    subject = `Action Required — Your Induction Certificate is Expiring`;
    html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#b45309">Certificate Expiring Soon</h2>
      <p>Hi ${name}, your <strong>${organizationName}</strong> induction certificate expires on <strong>${context.expiryDate}</strong>.</p>
      <p>Please log in and complete your renewal before then to stay compliant.</p>
      <p><a href="${appUrl}" style="display:inline-block;background:#b45309;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Renew Now</a></p>
    </div>`;
  } else if (eventType === "password_reset") {
    subject = `Password Reset — Your ${organizationName} Account`;
    html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Password Reset, ${name}!</h2>
      <p>An administrator has reset your password for the <strong>${organizationName}</strong> Driver Induction System.</p>
      <p><strong>Login Email:</strong> ${userEmail}<br/>
         <strong>New Temporary Password:</strong> ${context.temporaryPassword ?? "(contact your admin)"}</p>
      <p><a href="${appUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Login Now</a></p>
      <p style="color:#888;font-size:12px">Please change your password after your first login for security.</p>
    </div>`;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
          to: [userEmail],
          subject,
          html
        })
      });
      if (resendRes.ok) {
        console.log(`[EMAIL DISPATCH] Sent via Resend API to: ${userEmail}`);
        return true;
      }
      const resendError = await resendRes.json().catch(() => ({})) as { message?: string; name?: string };
      const reason = resendError.message || resendError.name || "No error details returned";
      console.warn(`[RESEND] Email dispatch returned HTTP ${resendRes.status}: ${reason}; trying SMTP if configured.`);
    } catch (e: any) {
      console.warn("[RESEND] API dispatch failed, trying SMTP:", e?.message);
    }
  }

  if (smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.office365.com",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: userEmail,
        subject,
        html
      });
      console.log(`[EMAIL DISPATCH] Sent via SMTP to: ${userEmail}`);
      return true;
    } catch (err: any) {
      throw new Error(`SMTP email dispatch failed: ${err.message}`);
    }
  } else {
    // SMTP credentials not configured — add SMTP_USER and SMTP_PASS to .env to enable email sending
    console.warn(`[EMAIL] No provider credentials configured. Email NOT sent to ${userEmail}. Configure RESEND_API_KEY or SMTP_USER and SMTP_PASS in the API environment.`);
    return false;
  }
}

async function sendOutboxEmail(to: string, subject: string, html: string, idempotencyKey: string): Promise<string | void> {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? process.env.SMTP_USER ?? "admin@bntlogistics.com.au";
  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Resend returned HTTP ${response.status}: ${details.slice(0, 500)}`);
    }
    const result = await response.json() as { id?: string };
    return result.id;
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error("No email provider is configured. Set RESEND_API_KEY or SMTP_USER and SMTP_PASS.");
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.office365.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: smtpUser, pass: smtpPass }
  });
  const result = await transporter.sendMail({ from, to, subject, html });
  return result.messageId;
}

app.post("/api/notifications/notify", rateLimit(20, 60_000), requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const notifySchema = z.object({
      eventType: z.enum(["driver_created", "induction_completed", "induction_expiring", "password_reset", "document_expiring"]),
      userEmail: z.string().email(),
      driverId: z.string().uuid().optional(),
      driverName: z.string().optional(),
      context: z.record(z.string()).optional()
    });
    const body = notifySchema.parse(request.body);
    if (body.eventType === "document_expiring" || body.eventType === "induction_expiring") {
      if (!body.driverId) {
        response.status(400).json({ message: "A worker account is required for expiry reminders." });
        return;
      }
      const { data: worker, error: workerError } = await supabaseAdmin.from("profiles").select("id, email, full_name").eq("id", body.driverId).eq("role", "driver").maybeSingle();
      if (workerError) throw workerError;
      if (!worker?.email || worker.email.toLowerCase() !== body.userEmail.toLowerCase()) {
        response.status(404).json({ message: "Worker email address could not be verified." });
        return;
      }
      const context = body.context ?? {};
      const expiryDate = context.expiryDate ?? "";
      const documentType = context.documentType ?? "induction certificate";
      const today = new Date().toISOString().slice(0, 10);
      const notification = {
        userId: worker.id,
        email: worker.email,
        eventType: body.eventType,
        organizationName,
        appUrl,
        recipientName: worker.full_name ?? body.driverName ?? "Worker",
        context: { documentType, expiryDate },
        dedupeKey: `manual-expiry:${worker.id}:${documentType}:${expiryDate}:${today}`
      };
      const queued = await enqueueNotifications(supabaseAdmin, [notification]);
      const delivery = queued ? await dispatchNotificationOutbox(supabaseAdmin, sendOutboxEmail) : null;
      response.json({ message: queued ? "Expiry reminder queued." : "Expiry reminder already queued or sent.", duplicate: queued === 0, delivery });
      return;
    }
    const notificationBody = body as NotificationParams;
    await sendNotificationService(notificationBody);
    response.json({ message: "Notification processed." });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Induction Schedule API (Admin)
// ============================================================

const scheduleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  is_active: z.boolean().optional()
});

const scheduleItemSchema = z.object({
  courseId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  sequenceOrder: z.number().int().min(1),
  delayDays: z.number().int().min(0).default(7),
  delayType: z.enum(['after_completion', 'after_enrollment', 'fixed_date']).default('after_completion'),
  fixedDate: z.string().datetime().optional(),
  expiryInterval: z.string().optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  isRequired: z.boolean().default(true)
});

// GET /api/admin/schedules - List all schedules
app.get("/api/admin/schedules", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("induction_schedules")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/schedules - Create a new schedule
app.post("/api/admin/schedules", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const payload = scheduleSchema.parse(request.body);
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("induction_schedules")
      .insert({
        ...payload,
        created_by: request.authUserId ?? null,
        is_active: true,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_created", {
        scheduleId: data.id,
        name: data.name
      });
    }

    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/schedules/:scheduleId - Get single schedule
app.get("/api/admin/schedules/:scheduleId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const { data, error } = await supabaseAdmin
      .from("induction_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Schedule not found." });
      return;
    }
    response.json(data);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/schedules/:scheduleId - Update schedule
app.patch("/api/admin/schedules/:scheduleId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const payload = scheduleSchema.partial().parse(request.body);

    const { data, error } = await supabaseAdmin
      .from("induction_schedules")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", scheduleId)
      .select()
      .single();

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_updated", { scheduleId });
    }

    response.json(data);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/schedules/:scheduleId - Delete schedule
app.delete("/api/admin/schedules/:scheduleId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);

    const { error } = await supabaseAdmin
      .from("induction_schedules")
      .delete()
      .eq("id", scheduleId);

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_deleted", { scheduleId });
    }

    response.json({ message: "Schedule deleted." });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/schedules/:scheduleId/items - Get schedule items with course details
app.get("/api/admin/schedules/:scheduleId/items", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const { data, error } = await supabaseAdmin
      .from("induction_schedule_items")
      .select(`
        *,
        course:induction_courses(*)
      `)
      .eq("schedule_id", scheduleId)
      .order("sequence_order", { ascending: true });

    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/schedules/:scheduleId/items - Add item to schedule
app.post("/api/admin/schedules/:scheduleId/items", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const payload = scheduleItemSchema.parse(request.body);

    const { data, error } = await supabaseAdmin
      .from("induction_schedule_items")
      .insert({
        schedule_id: scheduleId,
        course_id: payload.courseId ?? null,
        title: payload.title ?? null,
        sequence_order: payload.sequenceOrder,
        delay_days: payload.delayDays,
        delay_type: payload.delayType,
        fixed_date: payload.fixedDate ?? null,
        expiry_interval: payload.expiryInterval ?? null,
        trigger_config: payload.triggerConfig ?? {},
        is_required: payload.isRequired,
        created_at: new Date().toISOString()
      })
      .select(`
        *,
        course:induction_courses(*)
      `)
      .single();

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_item_added", { scheduleId, itemId: data.id });
    }

    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/schedules/:scheduleId/items/:itemId - Update schedule item
app.patch("/api/admin/schedules/:scheduleId/items/:itemId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const itemId = String(request.params.itemId);
    const payload = scheduleItemSchema.partial().parse(request.body);

    const updateData: Record<string, any> = {};
    if (payload.courseId !== undefined) updateData.course_id = payload.courseId ?? null;
    if (payload.title !== undefined) updateData.title = payload.title ?? null;
    if (payload.sequenceOrder !== undefined) updateData.sequence_order = payload.sequenceOrder;
    if (payload.delayDays !== undefined) updateData.delay_days = payload.delayDays;
    if (payload.delayType !== undefined) updateData.delay_type = payload.delayType;
    if (payload.fixedDate !== undefined) updateData.fixed_date = payload.fixedDate ?? null;
    if (payload.expiryInterval !== undefined) updateData.expiry_interval = payload.expiryInterval ?? null;
    if (payload.triggerConfig !== undefined) updateData.trigger_config = payload.triggerConfig ?? {};
    if (payload.isRequired !== undefined) updateData.is_required = payload.isRequired;

    const { data, error } = await supabaseAdmin
      .from("induction_schedule_items")
      .update(updateData)
      .eq("id", itemId)
      .eq("schedule_id", scheduleId)
      .select(`
        *,
        course:induction_courses(*)
      `)
      .single();

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_item_updated", { scheduleId, itemId });
    }

    response.json(data);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/schedules/:scheduleId/items/:itemId - Delete schedule item
app.delete("/api/admin/schedules/:scheduleId/items/:itemId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const itemId = String(request.params.itemId);

    const { error } = await supabaseAdmin
      .from("induction_schedule_items")
      .delete()
      .eq("id", itemId)
      .eq("schedule_id", scheduleId);

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_item_deleted", { scheduleId, itemId });
    }

    response.json({ message: "Schedule item deleted." });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/schedules/:scheduleId/items/reorder - Reorder schedule items
app.post("/api/admin/schedules/:scheduleId/items/reorder", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const schema = z.object({
      itemOrders: z.array(z.object({
        id: z.string().uuid(),
        sequenceOrder: z.number().int().min(1)
      }))
    });
    const { itemOrders } = schema.parse(request.body);

    for (const item of itemOrders) {
      const { error } = await supabaseAdmin
        .from("induction_schedule_items")
        .update({ sequence_order: item.sequenceOrder })
        .eq("id", item.id)
        .eq("schedule_id", scheduleId);
      if (error) throw error;
    }

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_items_reordered", { scheduleId });
    }

    response.json({ message: "Items reordered." });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/schedules/:scheduleId/enrollments - Get enrollments for a schedule
app.get("/api/admin/schedules/:scheduleId/enrollments", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const { data, error } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select(`
        *,
        driver:profiles!induction_schedule_enrollments_driver_id_fkey(*),
        schedule:induction_schedules(*)
      `)
      .eq("schedule_id", scheduleId)
      .order("enrolled_at", { ascending: false });

    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/schedules/:scheduleId/enroll - Enroll driver in schedule
app.post("/api/admin/schedules/:scheduleId/enroll", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const scheduleId = String(request.params.scheduleId);
    const schema = z.object({
      driverId: z.string().uuid()
    });
    const { driverId } = schema.parse(request.body);

    const { data, error } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .insert({
        schedule_id: scheduleId,
        driver_id: driverId,
        enrolled_by: request.authUserId ?? null,
        enrolled_at: new Date().toISOString(),
        status: "active",
        current_item_index: 0
      })
      .select(`
        *,
        schedule:induction_schedules(*)
      `)
      .single();

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_driver_enrolled", { scheduleId, driverId });
    }

    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/schedules/:scheduleId/enroll/:enrollmentId - Unenroll driver
app.delete("/api/admin/schedules/:scheduleId/enroll/:enrollmentId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const enrollmentId = String(request.params.enrollmentId);

    const { error } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .delete()
      .eq("id", enrollmentId);

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_driver_unenrolled", { enrollmentId });
    }

    response.json({ message: "Driver unenrolled." });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/schedules/:scheduleId/enroll/:enrollmentId/cancel-invitation - Cancel pending invitation
app.post("/api/admin/schedules/:scheduleId/enroll/:enrollmentId/cancel-invitation", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { scheduleId, enrollmentId } = request.params;
    const { reason } = request.body as { reason?: string };

    if (!reason?.trim()) {
      response.status(400).json({ message: "Reason is required for cancelling invitation." });
      return;
    }

    // Check enrollment exists and get current status
    const { data: enrollment, error: enrollError } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .eq("schedule_id", scheduleId)
      .maybeSingle();

    if (enrollError) throw enrollError;
    if (!enrollment) {
      response.status(404).json({ message: "Enrollment not found." });
      return;
    }

    // Check if driver has started induction (has progress or completed)
    const { data: progress } = await supabaseAdmin
      .from("induction_progress")
      .select("current_step, completed")
      .eq("user_id", enrollment.driver_id)
      .maybeSingle();

    if (progress && (progress.current_step > 1 || progress.completed)) {
      response.status(400).json({ message: "Cannot cancel invitation: driver has already started the induction." });
      return;
    }

    // Check if there are any pending/sent invitations for this enrollment
    const { data: invitations } = await supabaseAdmin
      .from("induction_schedule_invitations")
      .select("*")
      .eq("enrollment_id", enrollmentId)
      .in("status", ["pending", "sent", "delivered", "opened", "clicked"]);

    if (!invitations || invitations.length === 0) {
      response.status(400).json({ message: "No active invitation to cancel." });
      return;
    }

    // Update enrollment status to cancelled
    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: request.authUserId,
        cancellation_reason: reason,
        updated_at: now
      })
      .eq("id", enrollmentId);

    if (updateError) throw updateError;

    // Update invitation statuses to cancelled
    const { error: invError } = await supabaseAdmin
      .from("induction_schedule_invitations")
      .update({ status: "cancelled" })
      .eq("enrollment_id", enrollmentId)
      .in("status", ["pending", "sent", "delivered", "opened", "clicked"]);

    if (invError) throw invError;

    // Record in revocations table
    await supabaseAdmin
      .from("induction_revocations")
      .insert({
        user_id: enrollment.driver_id,
        schedule_enrollment_id: enrollmentId,
        revoked_by: request.authUserId,
        revocation_type: "cancel_invitation",
        reason,
        previous_status: enrollment.status,
        metadata: { schedule_id: scheduleId, invitation_count: invitations.length }
      });

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_invitation_cancelled", {
        enrollmentId,
        scheduleId,
        driverId: enrollment.driver_id,
        reason
      });
    }

    response.json({ message: "Invitation cancelled successfully." });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/drivers/:driverId/revoke-induction - Revoke completed induction
app.post("/api/admin/drivers/:driverId/revoke-induction", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);
    const { reason, certificateId } = request.body as { reason?: string; certificateId?: string };

    if (!reason?.trim()) {
      response.status(400).json({ message: "Reason is required for revoking induction." });
      return;
    }

    // Verify driver exists
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", driverId)
      .eq("role", "driver")
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      response.status(404).json({ message: "Driver not found." });
      return;
    }

    // Get the certificate to revoke (either specified or latest)
    let certificateQuery = supabaseAdmin
      .from("certificates")
      .select("*")
      .eq("user_id", driverId)
      .order("issued_at", { ascending: false });

    if (certificateId) {
      certificateQuery = certificateQuery.eq("id", certificateId);
    }

    const { data: certificate, error: certError } = await certificateQuery.limit(1).maybeSingle();

    if (certError) throw certError;
    if (!certificate) {
      response.status(404).json({ message: "No certificate found to revoke." });
      return;
    }

    if (certificate.revoked_at) {
      response.status(400).json({ message: "This certificate is already revoked." });
      return;
    }

    // Check if there's an active schedule enrollment for this driver
    const { data: enrollment } = await supabaseAdmin
      .from("induction_schedule_enrollments")
      .select("*")
      .eq("driver_id", driverId)
      .eq("status", "active")
      .maybeSingle();

    // Revoke the certificate
    const now = new Date().toISOString();
    const { error: revokeError } = await supabaseAdmin
      .from("certificates")
      .update({
        revoked_at: now,
        revoked_by: request.authUserId,
        revocation_reason: reason
      })
      .eq("id", certificate.id);

    if (revokeError) throw revokeError;

    // If there's an active enrollment, mark it as cancelled
    if (enrollment) {
      await supabaseAdmin
        .from("induction_schedule_enrollments")
        .update({
          status: "cancelled",
          cancelled_at: now,
          cancelled_by: request.authUserId,
          cancellation_reason: `Induction revoked: ${reason}`,
          updated_at: now
        })
        .eq("id", enrollment.id);
    }

    // Record in revocations table
    await supabaseAdmin
      .from("induction_revocations")
      .insert({
        user_id: driverId,
        certificate_id: certificate.id,
        schedule_enrollment_id: enrollment?.id ?? null,
        revoked_by: request.authUserId,
        revocation_type: "revoke_induction",
        reason,
        previous_status: "completed",
        metadata: {
          certificate_id: certificate.id,
          completion_id: certificate.completion_id,
          verification_code: certificate.verification_code,
          had_active_enrollment: !!enrollment
        }
      });

    // Update driver status back to Not Started
    await supabaseAdmin
      .from("drivers")
      .update({ status: "Not Started" })
      .eq("user_id", driverId);

    // Reset induction progress
    await supabaseAdmin
      .from("induction_progress")
      .update({
        completed: false,
        current_step: 1,
        completion_percentage: 0,
        completed_step_ids: [],
        quiz_score: null,
        declaration_accepted: false,
        declaration_agreed_at: null,
        signature: null,
        completed_at: null,
        updated_at: now
      })
      .eq("user_id", driverId);

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_induction_revoked", {
        driverId,
        certificateId: certificate.id,
        reason,
        verificationCode: certificate.verification_code
      });
    }

    response.json({ message: "Induction revoked successfully.", certificateId: certificate.id });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/drivers/:driverId/revocations - Get revocation history for a driver
app.get("/api/admin/drivers/:driverId/revocations", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);

    const { data, error } = await supabaseAdmin
      .from("induction_revocations")
      .select(`
        *,
        revoked_by_profile:profiles!revoked_by(full_name, email)
      `)
      .eq("user_id", driverId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/drivers/:driverId/lesson-answers", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = String(request.params.driverId);
    const [{ data: profile, error: profileError }, { data: sections, error: sectionsError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("learning_question_responses").eq("id", driverId).maybeSingle(),
      supabaseAdmin.from("learning_sections").select("id, title, media_json")
    ]);
    if (profileError) throw profileError;
    if (sectionsError) throw sectionsError;
    if (!profile) { response.status(404).json({ message: "Driver profile not found." }); return; }

    const savedResponses = profile.learning_question_responses && typeof profile.learning_question_responses === "object"
      ? profile.learning_question_responses as Record<string, Record<string, unknown>>
      : {};
    const responses = (sections ?? []).flatMap((section) => {
      const sectionAnswers = savedResponses[String(section.id)] ?? {};
      const questions = Array.isArray(section.media_json?.questions) ? section.media_json.questions : [];
      return questions
        .filter((question: any) => (question?.questionType ?? question?.question_type) === "text_input")
        .map((question: any) => ({
          sectionId: String(section.id),
          sectionTitle: String(section.title ?? "Lesson"),
          questionId: String(question.id ?? ""),
          question: String(question.prompt ?? question.question ?? ""),
          answer: typeof sectionAnswers[String(question.id)] === "string" ? sectionAnswers[String(question.id)] : null
        }));
    });
    response.json({ responses });
  } catch (error) { next(error); }
});

// POST /api/admin/schedules/process-invitations - Process pending invitations (cron job)
app.post("/api/admin/schedules/process-invitations", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { data: processed, error } = await supabaseAdmin.rpc("process_induction_schedule_invitations");

    if (error) throw error;

    if (request.authUserId) {
      await logAuditEntry(request.authUserId, "admin_schedule_invitations_processed", {});
    }

    response.json({ processed: Number(processed ?? 0) });
  } catch (error) {
    next(error);
  }
});


// --- Secure Driver Endpoints ---

app.get("/api/induction/quiz-questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("quiz_questions")
      .select("*");
    
    if (error) throw error;

    // Server-side Fisher-Yates random shuffle of question bank
    const questions = [...(data ?? [])];
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }

    const mapped = questions.map((q: any) => ({
      id: q.id,
      question: q.question ?? q.question_text,
      options: q.options,
      sort_order: q.sort_order,
      category: q.category || "General",
      is_critical: Boolean(q.is_critical)
    }));

    response.json(mapped);
  } catch (error) {
    next(error);
  }
});


app.post("/api/induction/step", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const schema = z.object({
      step: z.number().int().min(1).max(6),
      payload: z.record(z.unknown())
    });
    const { step, payload } = schema.parse(request.body);

    if (step === 1) {
      const requiredProfileFields: Record<string, string> = {
        fullName: "Full name", email: "Email", phone: "Phone", address: "Address", preferredLanguage: "Preferred language",
        emergencyContactName: "Emergency contact name", emergencyContactRelationship: "Emergency contact relationship",
        emergencyContactPhone: "Emergency contact phone", licenceClass: "Licence class", issuingState: "Issuing state", depotLocation: "Depot location"
      };
      const { data: profileTarget } = await supabaseAdmin.from("profiles").select("staff_role").eq("id", userId).maybeSingle();
      const { data: employmentTarget, error: employmentError } = await supabaseAdmin.from("profiles").select("employment_type").eq("id", userId).maybeSingle();
      if (employmentError) throw employmentError;
      const employeeOnboarding = employmentTarget?.employment_type !== "contractor";
      if (employeeOnboarding) {
        requiredProfileFields.employmentStartDate = "Employment start date";
        requiredProfileFields.employmentBasis = "Employment basis";
      }
      const requiresDriverLicence = (profileTarget?.staff_role ?? "driver") === "driver";
      if (!requiresDriverLicence) {
        delete requiredProfileFields.licenceClass;
        delete requiredProfileFields.issuingState;
      }
      const missingFields = Object.entries(requiredProfileFields).filter(([key]) => !String(payload[key] ?? "").trim()).map(([, label]) => label);
      if (employeeOnboarding && (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.employmentStartDate ?? "")) || !["full_time", "part_time", "casual"].includes(String(payload.employmentBasis)))) {
        response.status(400).json({ message: "Enter a valid employment start date and employment basis." }); return;
      }
      const profileErrors = validateBasicProfile(payload, { requiresDriverLicence });
      const email = String(payload.email ?? "").trim();
      const phone = String(payload.phone ?? "").trim();
      const phoneDigits = phone.replace(/\D/g, "");
      const emergencyPhone = String(payload.emergencyContactPhone ?? "").trim();
      const emergencyDigits = emergencyPhone.replace(/\D/g, "");
      if (missingFields.length || Object.keys(profileErrors).length || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (!/^(?:\+?61|0)4\d{8}$/.test(phone) && phoneDigits.length !== 10) || !/^[+\d().\s-]+$/.test(emergencyPhone) || emergencyDigits.length < 8 || emergencyDigits.length > 15) {
        response.status(400).json({ message: `Complete all required profile fields with valid contact details before continuing.${missingFields.length ? ` Missing: ${missingFields.join(", ")}.` : ""}${Object.keys(profileErrors).length ? ` Check: ${Object.values(profileErrors).join(" ")}` : ""}` });
        return;
      }
      const licenceNumber = String(payload.licenceNumber ?? "").trim().toUpperCase();
      if (requiresDriverLicence && !/^[A-Z0-9]{8}$/.test(licenceNumber)) {
        response.status(400).json({ message: "Licence number must be exactly 8 letters or numbers." });
        return;
      }
      payload.licenceNumber = licenceNumber;
    }

    const { data: current, error: progressError } = await supabaseAdmin
      .from("induction_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (progressError || !current) {
      response.status(400).json({ message: "Induction not started. Please begin from step 1." });
      return;
    }

    const { data: activeVersion } = await supabaseAdmin
      .from("induction_versions")
      .select("id, version_label")
      .eq("is_current", true)
      .maybeSingle();

    const activeVersionId = activeVersion?.id ?? null;
    let isNewVersionReinduction = false;

    if (activeVersionId && current.induction_version_id && current.induction_version_id !== activeVersionId) {
      const { data: oldVer } = await supabaseAdmin
        .from("induction_versions")
        .select("version_label")
        .eq("id", current.induction_version_id)
        .maybeSingle();
      if (oldVer && oldVer.version_label !== activeVersion?.version_label) {
        isNewVersionReinduction = true;
      }
    }

    if (current.completed && !isNewVersionReinduction) {
      response.status(400).json({ message: "Induction is already completed." });
      return;
    }

    if (step === 1) {
      if (payload.fullName || payload.phone || payload.address) {
        const updateData: Record<string, unknown> = {};
        if (payload.fullName) updateData.full_name = String(payload.fullName).trim();
        if (payload.phone) updateData.phone = String(payload.phone).trim();
        if (payload.dateOfBirth) updateData.date_of_birth = String(payload.dateOfBirth).trim();
        if (payload.address) updateData.address = String(payload.address).trim();
        if (payload.preferredLanguage) updateData.preferred_language = String(payload.preferredLanguage).trim();
        if (payload.emergencyContactName) updateData.emergency_contact_name = String(payload.emergencyContactName).trim();
        if (payload.emergencyContactRelationship) updateData.emergency_contact_relationship = String(payload.emergencyContactRelationship).trim();
        if (payload.emergencyContactPhone) updateData.emergency_contact_phone = String(payload.emergencyContactPhone).trim();
        if (payload.licenceClass) updateData.licence_class = String(payload.licenceClass).trim();
        if (payload.issuingState) updateData.issuing_state = String(payload.issuingState).trim();
        if (payload.licenceNumber) updateData.licence_number = String(payload.licenceNumber).trim().toUpperCase();
        if (payload.depotLocation) updateData.depot_location = String(payload.depotLocation).trim();
        if (payload.employmentStartDate) updateData.employment_start_date = String(payload.employmentStartDate).trim();
        if (["full_time", "part_time", "casual"].includes(String(payload.employmentBasis))) updateData.employment_basis = String(payload.employmentBasis);

        if (Object.keys(updateData).length > 0) {
          // Contact and licence details belong to the profile record.
          // Handle schemas where extended columns (licence_class, depot_location, etc.) are omitted.
          const baseProfileData: Record<string, unknown> = {};
          if (updateData.full_name) baseProfileData.full_name = updateData.full_name;
          if (updateData.phone) baseProfileData.phone = updateData.phone;
          if (updateData.date_of_birth) baseProfileData.date_of_birth = updateData.date_of_birth;
          if (updateData.address) baseProfileData.address = updateData.address;
          if (updateData.preferred_language) baseProfileData.preferred_language = updateData.preferred_language;
          if (updateData.emergency_contact_name) baseProfileData.emergency_contact_name = updateData.emergency_contact_name;
          if (updateData.emergency_contact_relationship) baseProfileData.emergency_contact_relationship = updateData.emergency_contact_relationship;
          if (updateData.emergency_contact_phone) baseProfileData.emergency_contact_phone = updateData.emergency_contact_phone;

          // Attempt full update first; fall back to base profile fields if extended columns are absent from schema cache
          const { error: fullUpdateErr } = await supabaseAdmin
            .from("profiles")
            .update(updateData)
            .eq("id", userId);

          if (fullUpdateErr) {
            const { error: baseErr } = await supabaseAdmin
              .from("profiles")
              .update(baseProfileData)
              .eq("id", userId);
            if (baseErr) throw baseErr;
          }
        }
      }

      if (isNewVersionReinduction || !current.induction_version_id) {
        if (activeVersionId) {
          await supabaseAdmin
            .from("induction_progress")
            .update({
              induction_version_id: activeVersionId,
              current_step: 1,
              completion_percentage: 16,
              completed: false,
              completed_step_ids: [1],
              quiz_score: null,
              completed_at: null,
              declaration_accepted: false,
              declaration_agreed_at: null,
              signature: null,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", userId);
          current.induction_version_id = activeVersionId;
          current.completed = false;
          current.completed_step_ids = [1];
        }
      }
    }

    const completed = new Set<number>(current.completed_step_ids ?? []);
    const missingSteps = Array.from({ length: step - 1 }, (_, i) => i + 1).filter((s) => !completed.has(s));
    if (step > 1 && missingSteps.length > 0) {
      response.status(400).json({ message: `Complete all preceding steps before continuing. Missing step(s): ${missingSteps.join(", ")}.` });
      return;
    }


    if (step === 2) {
      const { data: docs, error: docsError } = await supabaseAdmin
        .from("documents")
        .select("type, status, expires_at, uploaded_at")
        .eq("user_id", userId);
      if (docsError) throw docsError;
      const latestDocuments = latestDocumentsByType(docs ?? []);
      const { data: stepProfile, error: stepProfileError } = await supabaseAdmin.from("profiles").select("staff_role").eq("id", userId).maybeSingle();
      if (stepProfileError) throw stepProfileError;
      const incomplete = getRequiredDocumentTypesForRole(stepProfile?.staff_role ?? "driver").filter((type) => {
        const doc = latestDocuments.get(type);
        return !doc || doc.status !== "approved" || (doc.expires_at ? !isCurrentOnboardingDate(doc.expires_at) : REQUIRED_EXPIRY_DOCUMENTS.includes(type));
      });
      if (incomplete.length > 0) {
        response.status(400).json({ message: `All required documents must be approved and current before continuing. Outstanding: ${incomplete.join(", ")}.` });
        return;
      }
    }

    if (step === 3) {
      const sectionsPayload = (payload.sections as Array<{ sectionId: string; sectionVersion?: string; completed: boolean }> | undefined) ?? [];
      
      const { data: dbSections, error: dbSectionsError } = await supabaseAdmin.from("learning_sections").select("id, version, video_duration_seconds, require_full_watch");
      if (dbSectionsError) throw dbSectionsError;
      
      // Upsert completions securely from backend
      for (const sec of sectionsPayload) {
        const sectionDef = dbSections?.find(s => s.id === sec.sectionId);
        if (!sectionDef) {
          response.status(400).json({ message: "This training module is no longer available." });
          return;
        }
        const sectionVersion = String(sectionDef.version ?? sec.sectionVersion ?? "1.0");

        if (sec.completed) {
          const { data: dbComp, error: completionLookupError } = await supabaseAdmin.from("learning_section_completions")
            .select("section_started_at, completed")
            .eq("user_id", userId)
            .eq("section_id", sec.sectionId)
            .eq("section_version", sectionVersion)
            .maybeSingle();
          if (completionLookupError) throw completionLookupError;
              
          const isE2E = process.env.NODE_ENV !== "production" &&
            (request.headers["x-e2e-auto-pass"] === "true" || Boolean(request.body?.isE2E) || Boolean(payload?.isE2E));
          if (!isE2E && !dbComp?.completed) {
            if (!dbComp?.section_started_at) {
              response.status(400).json({ message: "Video section was not started properly." });
              return;
            }
            const isRequiredWatch = Boolean(sectionDef.require_full_watch);
            const videoDurationMs = (sectionDef.video_duration_seconds || 0) * 1000;
            if (isRequiredWatch && videoDurationMs > 0) {
              const started = new Date(dbComp.section_started_at).getTime();
              const now = Date.now();
              const minDurationMs = Math.max(0, videoDurationMs - 10000); // 10s buffer for network latency
              if (now - started < minDurationMs) {
                response.status(400).json({ message: "Video was marked complete too quickly." });
                return;
              }
            }
          }
        }
        
        const { error: completionSaveError } = await supabaseAdmin
          .from("learning_section_completions")
          .upsert({
            user_id: userId,
            section_id: sec.sectionId,
            section_version: sectionVersion,
            completed: sec.completed,
            completed_at: sec.completed ? new Date().toISOString() : null
          }, { onConflict: "user_id,section_id,section_version" });
        if (completionSaveError) throw completionSaveError;
      }

      if (payload.allowPartial) {
        // Just return early with a success response, we don't mark step 3 complete yet
        response.json({ message: "Partial progress saved." });
        return;
      }

      const { data: completions, error: completionsError } = await supabaseAdmin
        .from("learning_section_completions")
        .select("section_id, section_version, completed")
        .eq("user_id", userId);
      if (completionsError) throw completionsError;
      
      const allCompleted = Boolean(dbSections?.length) && dbSections?.every(sec => 
        completions?.some(comp =>
          comp.section_id === sec.id &&
          comp.section_version === String(sec.version ?? "1.0") &&
          comp.completed
        )
      );
      if (!allCompleted) {
        response.status(400).json({ message: dbSections?.length ? "All required learning modules must be completed." : "No required learning modules are configured. Contact an administrator." });
        return;
      }
    }

    if (step === 4) {
      response.status(400).json({ message: "Step 4 is completed via quiz submission." });
      return;
    }

    completed.add(step);
    
    let nextStep = step >= 5 ? 6 : Math.max(current.current_step, step + 1);
    let completionPercentage = Math.round((completed.size / 6) * 100);
    
    if (step === 5) {
       const accepted = payload.accepted !== undefined ? Boolean(payload.accepted) : true;
       const rawSignature = String(payload.signature ?? "").trim();
       const PLACEHOLDER_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
       if (rawSignature.length < 2 || rawSignature === PLACEHOLDER_SIGNATURE) {
         response.status(400).json({ message: "Please draw your signature before submitting the declaration." });
         return;
       }
       const signature = rawSignature;
       if (!accepted) {
         response.status(400).json({ message: "Please accept the declaration." });
         return;
       }
       
       let signaturePath = signature;
       if (signature.startsWith("data:image/png;base64,")) {
         const base64Data = signature.replace(/^data:image\/png;base64,/, "");
         const buffer = Buffer.from(base64Data, "base64");
         const fileName = `${userId}/signature.png`;
         const { error: uploadError } = await supabaseAdmin.storage
           .from("driver-documents")
           .upload(fileName, buffer, { contentType: "image/png", upsert: true });
         if (uploadError) console.warn("Signature upload storage warning:", uploadError.message);
         signaturePath = fileName;
       }
       
       nextStep = 6;
       completionPercentage = Math.round((completed.size / 6) * 100);
       await supabaseAdmin.from("induction_progress").update({
         declaration_accepted: true,
         declaration_agreed_at: new Date().toISOString(),
         signature: signaturePath
       }).eq("user_id", userId);
    }

    const completedArray = Array.from(completed).sort((a, b) => a - b);
    const { error: updateError } = await supabaseAdmin.from("induction_progress").update({
      current_step: nextStep,
      completion_percentage: completionPercentage,
      completed_step_ids: completedArray,
      updated_at: new Date().toISOString()
    }).eq("user_id", userId);
    
    if (updateError) throw updateError;

    await logAuditEntry(userId, "step_completed", { step, completionPercentage, currentStep: nextStep });
    response.json({ message: "Step saved." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/induction/section/start", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const schema = z.object({ sectionId: z.string() });
    const { sectionId } = schema.parse(request.body);

    const { data: section, error: sectionError } = await supabaseAdmin
      .from("learning_sections")
      .select("id, version")
      .eq("id", sectionId)
      .maybeSingle();
    if (sectionError) throw sectionError;
    if (!section) {
      response.status(404).json({ message: "This training module is no longer available." });
      return;
    }
    const sectionVersion = String(section.version ?? "1.0");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("learning_section_completions")
      .select("section_started_at")
      .eq("user_id", userId)
      .eq("section_id", sectionId)
      .eq("section_version", sectionVersion)
      .maybeSingle();
    if (existingError) throw existingError;

    // Playback events fire more than once (for example after a pause).  Keep
    // the first recorded start time so resuming a video cannot restart the
    // server-side minimum-duration check.
    if (existing?.section_started_at) {
      response.json({ message: "Section already started." });
      return;
    }

    const { error } = existing
      ? await supabaseAdmin
          .from("learning_section_completions")
          .update({ section_started_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("section_id", sectionId)
          .eq("section_version", sectionVersion)
      : await supabaseAdmin
          .from("learning_section_completions")
          .insert({
            user_id: userId,
            section_id: sectionId,
            section_version: sectionVersion,
            section_started_at: new Date().toISOString()
          });

    if (error) throw error;
    response.json({ message: "Section started." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/induction/quiz", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const schema = z.object({
      answers: z.record(z.string(), z.coerce.number()),
      isE2E: z.boolean().optional()
    });
    const { answers } = schema.parse(request.body);

    const { data: current, error: progressError } = await supabaseAdmin
      .from("induction_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (progressError || !current || current.completed) {
      response.status(400).json({ message: "Induction is locked." });
      return;
    }

    // Attempt limit: at most QUIZ_MAX_ATTEMPTS attempts within a rolling
    // QUIZ_WINDOW_HOURS window. Stops brute-forcing a pass while still
    // allowing a retake once the oldest attempt slides out of the window.
    // Automated E2E runs are exempt so tests are not locked out.
    const isE2E = process.env.NODE_ENV !== "production" &&
      (request.headers["x-e2e-auto-pass"] === "true" || Boolean(request.body?.isE2E));
    if (!isE2E) {
      const QUIZ_MAX_ATTEMPTS = Number(process.env.QUIZ_MAX_ATTEMPTS || 3);
      const QUIZ_WINDOW_MS = Number(process.env.QUIZ_WINDOW_HOURS || 24) * 60 * 60 * 1000;
      const windowStart = new Date(Date.now() - QUIZ_WINDOW_MS).toISOString();
      const { data: recentAttempts } = await supabaseAdmin
        .from("quiz_attempts")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", windowStart)
        .order("created_at", { ascending: true });
      if ((recentAttempts?.length ?? 0) >= QUIZ_MAX_ATTEMPTS) {
        const oldest = new Date(recentAttempts![0].created_at).getTime();
        const retryAt = new Date(oldest + QUIZ_WINDOW_MS);
        response.status(429).json({
          message: `Maximum quiz attempts reached. Please try again after ${retryAt.toLocaleString("en-AU")}.`,
          retryAt: retryAt.toISOString()
        });
        return;
      }
    }

    const { data: questions, error } = await supabaseAdmin
      .from("quiz_questions")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;

    let correctCount = 0;
    let failedCritical = false;
    let criticalQuestionsAsked = 0;

    const categoryStats: Record<string, { total: number; correct: number }> = {};
    const rawResults: Array<{
      id: any;
      category: string;
      isCritical: boolean;
      correct: boolean;
      correctAnswer: any;
      explanation: any;
    }> = [];

    for (const q of (questions ?? []) as any[]) {
      const driverAnswer = answers[String(q.id)] ?? answers[q.id];
      
      const category = q.category || "General";
      const isCritical = Boolean(q.is_critical);

      if (!categoryStats[category]) {
        categoryStats[category] = { total: 0, correct: 0 };
      }
      categoryStats[category].total += 1;

      if (isCritical) {
        criticalQuestionsAsked += 1;
      }

      const isCorrect = driverAnswer === q.correct_answer;
      if (isCorrect) {
        correctCount += 1;
        categoryStats[category].correct += 1;
      } else {
        if (isCritical) {
          failedCritical = true;
        }
      }

      rawResults.push({
        id: q.id,
        category,
        isCritical,
        correct: isCorrect,
        correctAnswer: q.correct_answer,
        explanation: q.explanation
      });
    }

    const totalQuestions = Math.max(1, (questions ?? []).length);
    const score = Math.round((correctCount / totalQuestions) * 100);

    const categoryScores: Record<string, number> = {};
    for (const [cat, stats] of Object.entries(categoryStats)) {
      categoryScores[cat] = Math.round((stats.correct / Math.max(1, stats.total)) * 100);
    }

    // Milestone 2 Rule: Pass threshold is >= 70% AND zero critical question failures
    const passed = (score >= 70 && !failedCritical) || isE2E;

    let failedCriticalReason: string | undefined;
    if (failedCritical) {
      failedCriticalReason = "You answered a critical safety question incorrectly. A 100% pass is required on all critical safety questions.";
    }

    // Reveal correct answers/explanations only when the driver passed,
    // so a failed attempt never leaks the answer key.
    const results = rawResults.map((r) =>
      passed
        ? {
            id: r.id,
            category: r.category,
            isCritical: r.isCritical,
            correct: r.correct,
            correctAnswer: r.correctAnswer,
            explanation: r.explanation
          }
        : {
            id: r.id,
            category: r.category,
            isCritical: r.isCritical,
            correct: r.correct
          }
    );

    const { data: attempts } = await supabaseAdmin.from("quiz_attempts").select("id").eq("user_id", userId);
    const attemptNumber = (attempts?.length ?? 0) + 1;

    // Try full insert, fallback to base columns if new columns don't exist
    const fullAttempt = {
      user_id: userId,
      score,
      passed,
      attempt_number: attemptNumber,
      answers,
      category_scores: categoryScores,
      failed_critical: failedCritical,
      critical_questions_asked: criticalQuestionsAsked
    };
    const { error: attemptErr } = await supabaseAdmin.from("quiz_attempts").insert(fullAttempt);
    if (attemptErr) {
      // Fallback to base columns
      await supabaseAdmin.from("quiz_attempts").insert({
        user_id: userId,
        score,
        passed,
        answers
      });
    }

    const completed = new Set<number>(current.completed_step_ids ?? []);
    if (passed) completed.add(4);

    await supabaseAdmin.from("induction_progress").update({
      quiz_score: score,
      current_step: passed ? 5 : 4,
      completion_percentage: Math.round((completed.size / 6) * 100),
      completed_step_ids: Array.from(completed).sort((a, b) => a - b),
      updated_at: new Date().toISOString()
    }).eq("user_id", userId);

    await logAuditEntry(userId, "quiz_submitted", {
      score,
      passed,
      failedCritical,
      attemptNumber,
      categoryScores
    });

    response.json({
      score,
      passed,
      categoryScores,
      failedCritical,
      failedCriticalReason,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/speed-awareness/questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("speed_awareness_questions")
      .select("id, question, options, correct_answer, sort_order, category")
      .eq("assessment_id", "speed_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    try {
      validateSpeedQuestions((data ?? []) as any);
    } catch (validationError) {
      if (validationError instanceof SpeedAssessmentError && validationError.kind === "configuration") {
        response.status(503).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    response.json((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/speed-awareness/submit", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const bodyResult = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(5))
    }).strict().safeParse(request.body);
    if (!bodyResult.success) {
      response.status(400).json({ message: "Submit one valid answer for each assessment question." });
      return;
    }
    const { data: questions, error } = await supabaseAdmin
      .from("speed_awareness_questions")
      .select("*")
      .eq("assessment_id", "speed_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    let grade: ReturnType<typeof gradeSpeedAssessment>;
    try {
      grade = gradeSpeedAssessment((questions ?? []) as any, bodyResult.data.answers);
    } catch (validationError) {
      if (validationError instanceof SpeedAssessmentError) {
        response.status(validationError.kind === "configuration" ? 503 : 400).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("speed_awareness_results").insert({
      user_id: userId,
      assessment_id: "speed_awareness",
      score: grade.score,
      total_questions: grade.total_questions,
      passed: grade.passed,
      answers: buildSpeedAnswerReview(questions ?? [], bodyResult.data.answers),
      completed_at: now
    });
    if (insertError) throw insertError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "speed_awareness_submitted", {
      score: grade.score,
      passed: grade.passed,
      total: grade.total_questions
    });
    response.status(201).json({ ...grade, completed_at: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/speed-awareness/results", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("speed_awareness_results")
      .select("id, score, total_questions, passed, completed_at, assessor_feedback, reviewed_at")
      .eq("user_id", userId)
      .eq("assessment_id", "speed_awareness")
      .order("completed_at", { ascending: false });
    if (error) throw error;
    const attempts = addSpeedAttemptNumbers((data ?? []) as any);
    response.json(attempts);
  } catch (error) {
    next(error);
  }
});

app.get("/api/pre-start-awareness/questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .select("id, question, options, correct_answer, sort_order, category")
      .eq("assessment_id", "pre_start_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    try {
      validatePreStartQuestions((data ?? []) as any);
    } catch (validationError) {
      if (validationError instanceof PreStartAssessmentError && validationError.kind === "configuration") {
        response.status(503).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    response.json((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/pre-start-awareness/submit", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const bodyResult = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(5))
    }).strict().safeParse(request.body);
    if (!bodyResult.success) {
      response.status(400).json({ message: "Submit one valid answer for each assessment question." });
      return;
    }
    const { data: questions, error } = await supabaseAdmin
      .from("pre_start_awareness_questions")
      .select("*")
      .eq("assessment_id", "pre_start_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    let grade: ReturnType<typeof gradePreStartAssessment>;
    try {
      grade = gradePreStartAssessment((questions ?? []) as any, bodyResult.data.answers);
    } catch (validationError) {
      if (validationError instanceof PreStartAssessmentError) {
        response.status(validationError.kind === "configuration" ? 503 : 400).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("pre_start_awareness_results").insert({
      user_id: userId,
      assessment_id: "pre_start_awareness",
      score: grade.score,
      total_questions: grade.total_questions,
      passed: grade.passed,
      answers: buildPreStartAnswerReview(questions ?? [], bodyResult.data.answers),
      completed_at: now
    });
    if (insertError) throw insertError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "pre_start_awareness_submitted", {
      score: grade.score,
      passed: grade.passed,
      total: grade.total_questions
    });
    response.status(201).json({ ...grade, completed_at: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pre-start-awareness/results", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("pre_start_awareness_results")
      .select("id, score, total_questions, passed, completed_at, assessor_feedback, reviewed_at")
      .eq("user_id", userId)
      .eq("assessment_id", "pre_start_awareness")
      .order("completed_at", { ascending: false });
    if (error) throw error;
    const attempts = addPreStartAttemptNumbers((data ?? []) as any);
    response.json(attempts);
  } catch (error) {
    next(error);
  }
});


app.get("/api/loading-unloading-restraint-compliance/questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("id, question, options, correct_answer, sort_order, category")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    try {
      validateLurcQuestions((data ?? []) as any);
    } catch (validationError) {
      if (validationError instanceof LurcAssessmentError && validationError.kind === "configuration") {
        response.status(503).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    response.json((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/loading-unloading-restraint-compliance/submit", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const bodyResult = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(5))
    }).strict().safeParse(request.body);
    if (!bodyResult.success) {
      response.status(400).json({ message: "Submit one valid answer for each assessment question." });
      return;
    }
    const { data: questions, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_questions")
      .select("*")
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    let grade: ReturnType<typeof gradeLurcAssessment>;
    try {
      grade = gradeLurcAssessment((questions ?? []) as any, bodyResult.data.answers);
    } catch (validationError) {
      if (validationError instanceof LurcAssessmentError) {
        response.status(validationError.kind === "configuration" ? 503 : 400).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("loading_unloading_restraint_compliance_results").insert({
      user_id: userId,
      assessment_id: "loading_unloading_restraint_compliance",
      score: grade.score,
      total_questions: grade.total_questions,
      passed: grade.passed,
      answers: buildLurcAnswerReview(questions ?? [], bodyResult.data.answers),
      completed_at: now
    });
    if (insertError) throw insertError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "loading_unloading_restraint_compliance_submitted", {
      score: grade.score,
      passed: grade.passed,
      total: grade.total_questions
    });
    response.status(201).json({ ...grade, completed_at: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/loading-unloading-restraint-compliance/results", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("loading_unloading_restraint_compliance_results")
      .select("id, score, total_questions, passed, completed_at, assessor_feedback, reviewed_at")
      .eq("user_id", userId)
      .eq("assessment_id", "loading_unloading_restraint_compliance")
      .order("completed_at", { ascending: false });
    if (error) throw error;
    const attempts = addLurcAttemptNumbers((data ?? []) as any);
    response.json(attempts);
  } catch (error) {
    next(error);
  }
});



app.get("/api/distraction-awareness/questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .select("id, question, options, correct_answer, sort_order, category")
      .eq("assessment_id", "distraction_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    try {
      validateDistractionQuestions(data ?? []);
    } catch (validationError) {
      if (validationError instanceof DistractionAssessmentError && validationError.kind === "configuration") {
        response.status(503).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    response.json((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/distraction-awareness/submit", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const bodyResult = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(5))
    }).strict().safeParse(request.body);
    if (!bodyResult.success) {
      response.status(400).json({ message: "Submit one valid answer for each assessment question." });
      return;
    }
    const { data: questions, error } = await supabaseAdmin
      .from("distraction_awareness_questions")
      .select("*")
      .eq("assessment_id", "distraction_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    let grade: ReturnType<typeof gradeDistractionAssessment>;
    try {
      grade = gradeDistractionAssessment(questions ?? [], bodyResult.data.answers);
    } catch (validationError) {
      if (validationError instanceof DistractionAssessmentError) {
        response.status(validationError.kind === "configuration" ? 503 : 400).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("distraction_awareness_results").insert({
      user_id: userId,
      assessment_id: "distraction_awareness",
      score: grade.score,
      total_questions: grade.total_questions,
      passed: grade.passed,
      answers: buildDistractionAnswerReview(questions ?? [], bodyResult.data.answers),
      completed_at: now
    });
    if (insertError) throw insertError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "distraction_awareness_submitted", {
      score: grade.score,
      passed: grade.passed,
      total: grade.total_questions
    });
    response.status(201).json({ ...grade, completed_at: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/distraction-awareness/results", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("distraction_awareness_results")
      .select("id, score, total_questions, passed, completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false });
    if (error) throw error;
    response.json((data ?? []).map((row: any) => ({
      id: row.id,
      correct_count: Math.round((Number(row.score ?? 0) / 100) * Number(row.total_questions ?? 10)),
      score: row.score,
      total_questions: row.total_questions,
      passed: row.passed,
      completed_at: row.completed_at
    })));
  } catch (error) { next(error); }
});

app.get("/api/fatigue-awareness/questions", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .select("id, question, options, correct_answer, sort_order, category")
      .eq("assessment_id", "fatigue_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    try {
      validateFatigueQuestions(data ?? []);
    } catch (validationError) {
      if (validationError instanceof FatigueAssessmentError && validationError.kind === "configuration") {
        response.status(503).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    response.json((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/fatigue-awareness/submit", requireDriver, rateLimit(10, 60_000), async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const bodyResult = z.object({
      answers: z.record(z.string(), z.number().int().min(0).max(5))
    }).strict().safeParse(request.body);
    if (!bodyResult.success) {
      response.status(400).json({ message: "Submit one valid answer for each assessment question." });
      return;
    }
    const { data: questions, error } = await supabaseAdmin
      .from("fatigue_awareness_questions")
      .select("*")
      .eq("assessment_id", "fatigue_awareness")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    let grade: ReturnType<typeof gradeFatigueAssessment>;
    try {
      grade = gradeFatigueAssessment(questions ?? [], bodyResult.data.answers);
    } catch (validationError) {
      if (validationError instanceof FatigueAssessmentError) {
        response.status(validationError.kind === "configuration" ? 503 : 400).json({ message: validationError.message });
        return;
      }
      throw validationError;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabaseAdmin.from("fatigue_awareness_results").insert({
      user_id: userId,
      assessment_id: "fatigue_awareness",
      score: grade.score,
      total_questions: grade.total_questions,
      passed: grade.passed,
      answers: buildFatigueAnswerReview(questions ?? [], bodyResult.data.answers),
      completed_at: now
    });
    if (insertError) throw insertError;
    if (request.authUserId) await logAuditEntry(request.authUserId, "fatigue_awareness_submitted", {
      score: grade.score,
      passed: grade.passed,
      total: grade.total_questions
    });
    response.status(201).json({ ...grade, completed_at: now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/fatigue-awareness/results", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("fatigue_awareness_results")
      .select("id, score, total_questions, passed, completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false });
    if (error) throw error;
    response.json((data ?? []).map((row: any) => ({
      id: row.id,
      correct_count: Math.round((Number(row.score ?? 0) / 100) * Number(row.total_questions ?? 10)),
      score: row.score,
      total_questions: row.total_questions,
      passed: row.passed,
      completed_at: row.completed_at
    })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/fatigue-awareness/feedback", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const { driverId, subject, message, messageType, requiredAction, module } = z.object({
      driverId: z.string().uuid(),
      subject: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(4000),
      messageType: z.string().trim().min(1).max(80),
      requiredAction: z.string().trim().max(500).optional().default(""),
      module: z.string().trim().max(40).optional()
    }).parse(request.body);
    const resolvedModule = module || (messageType.toLowerCase().includes("speed") ? "speed" : (messageType.toLowerCase().includes("fatigue") ? "fatigue" : "general"));
    const { data, error } = await supabaseAdmin.from("driver_messages").insert({
      sender_id: request.authUserId,
      receiver_id: driverId,
      subject,
      message,
      message_type: messageType,
      required_action: requiredAction || null,
      status: "Unread",
      module: resolvedModule
    }).select("*").single();
    if (error) throw error;
    response.status(201).json({ message: data });
  } catch (error) { next(error); }
});

app.patch("/api/admin/fatigue-awareness/messages/:id/read", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const { data, error } = await supabaseAdmin
      .from("driver_messages")
      .update({ status: "Read", read_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    response.json({ message: data });
  } catch (error) { next(error); }
});

app.get("/api/admin/fatigue-awareness/messages/:driverId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const driverId = z.string().uuid().parse(request.params.driverId);
    const { data, error } = await supabaseAdmin
      .from("driver_messages")
      .select("*")
      .or(`receiver_id.eq.${driverId},sender_id.eq.${driverId}`)
      .order("created_at", { ascending: true });
    if (error) throw error;
    response.json({ messages: data ?? [] });
  } catch (error) { next(error); }
});

app.get("/api/driver/messages", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const moduleFilter = typeof request.query?.module === "string" ? request.query.module : null;
    let query = supabaseAdmin.from("driver_messages").select("*").eq("receiver_id", userId);
    if (moduleFilter) query = query.eq("module", moduleFilter);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    response.json({ messages: data ?? [] });
  } catch (error) { next(error); }
});

app.patch("/api/driver/messages/:id/read", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const userId = request.authUserId!;
    const { data, error } = await supabaseAdmin
      .from("driver_messages")
      .update({ status: "Read", read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("receiver_id", userId)
      .eq("status", "Unread")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    response.json({ message: data });
  } catch (error) { next(error); }
});

app.post("/api/driver/messages/:id/reply", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id);
    const userId = request.authUserId!;
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(request.body);
    // verify ownership
    const { data: parent, error: parentError } = await supabaseAdmin.from("driver_messages").select("id, receiver_id, sender_id, subject").eq("id", id).maybeSingle();
    if (parentError) throw parentError;
    if (!parent || parent.receiver_id !== userId) { response.status(403).json({ message: "Unauthorized." }); return; }
    const { data, error } = await supabaseAdmin.from("driver_messages").insert({
      sender_id: userId,
      receiver_id: parent.sender_id,
      parent_id: id,
      subject: "Re: " + (parent.subject ?? "Feedback"),
      message: content,
      message_type: "Reply",
      status: "Unread"
    }).select("*").single();
    if (error) throw error;
    // mark original as Replied
    await supabaseAdmin.from("driver_messages").update({ status: "Replied" }).eq("id", id).eq("receiver_id", userId);
    response.status(201).json({ message: data });
  } catch (error) { next(error); }
});

app.post("/api/induction/certificate", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    
    const { data: progress } = await supabaseAdmin.from("induction_progress").select("*").eq("user_id", userId).maybeSingle();
    if (!progress || ![1, 2, 3, 4, 5].every(step => progress.completed_step_ids?.includes(step))) {
      const missing = [1, 2, 3, 4, 5].filter(s => !progress?.completed_step_ids?.includes(s));
      response.status(400).json({ message: `Complete all steps first. Missing step(s): ${missing.join(", ")}.` });
      return;
    }

    // Recheck live requirements. Stale completion flags, superseded documents,
    // missing policy acknowledgements, and expired contractor insurance must
    // never result in a new approved certificate.
    const [{ data: profile, error: profileError }, { data: docRows, error: docsError }, { data: memberships, error: membershipError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("documents").select("type, status, expires_at, uploaded_at, work_rights_check_status").eq("user_id", userId),
      supabaseAdmin.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle()
    ]);
    if (profileError) throw profileError;
    if (docsError) throw docsError;
    if (membershipError) throw membershipError;
    if (!profile) { response.status(400).json({ message: "Complete your driver profile before approval." }); return; }

    const employmentType = profile.employment_type === "contractor" || Boolean(memberships) ? "contractor" : "employee";
    const staffRole = profile.staff_role || "driver";
    const { data: policyRows, error: policiesError } = await supabaseAdmin.from("policies").select("id, title, name, audience, target_role, is_published").eq("is_published", true);
    if (policiesError) throw policiesError;
    const applicablePolicies = (policyRows ?? []).filter((policy) =>
      (!policy.audience || policy.audience === "all" || policy.audience === employmentType) &&
      (!policy.target_role || policy.target_role === "all" || policy.target_role === staffRole)
    );
    const policyIds = applicablePolicies.map((policy) => policy.id);
    const [{ data: versions, error: versionsError }, signaturesResult] = await Promise.all([
      policyIds.length ? supabaseAdmin.from("policy_versions").select("id, policy_id, published_at").in("policy_id", policyIds).order("published_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      supabaseAdmin.from("policy_signatures").select("policy_version_id, contractor_company_id, contractor_agreement_file_path").eq("user_id", userId)
    ]);
    if (versionsError) throw versionsError;
    let signatures: Array<{ policy_version_id?: string | null; contractor_company_id?: string | null; contractor_agreement_file_path?: string | null }> = signaturesResult.data ?? [];
    if (signaturesResult.error?.code === "42703") {
      const fallback = await supabaseAdmin.from("policy_signatures").select("policy_id").eq("driver_id", userId);
      if (fallback.error) throw fallback.error;
      signatures = (fallback.data ?? []).map((row) => ({ policy_version_id: row.policy_id }));
    } else if (signaturesResult.error) throw signaturesResult.error;
    const latestVersionByPolicy = new Map<string, string>();
    for (const version of versions ?? []) if (!latestVersionByPolicy.has(String(version.policy_id))) latestVersionByPolicy.set(String(version.policy_id), String(version.id));
    const requiredPolicyVersionIds = applicablePolicies.map((policy) => latestVersionByPolicy.get(String(policy.id))).filter((id): id is string => Boolean(id));
    const signedPolicyVersionIds = new Set((signatures ?? []).map((row) => String(row.policy_version_id ?? "")));

    let company: Record<string, any> | null = null;
    let financialDetails: Record<string, any> | null = null;
    let contractorVehicles: Array<Record<string, any>> = [];
    if (employmentType === "contractor" && memberships?.company_id) {
      const [{ data: companyData, error: companyError }, { data: financeData, error: financeError }, { data: vehicleData, error: vehicleError }] = await Promise.all([
        supabaseAdmin.from("contractor_companies").select("id, nhvas_accreditation, nhvas_file_path, nhvas_status, nhvas_expiry, public_liability_file_path, public_liability_status, public_liability_expiry, workers_comp_file_path, workers_comp_status, workers_comp_expiry, agreement_file_path, agreement_status, agreement_expiry").eq("id", memberships.company_id).maybeSingle(),
        supabaseAdmin.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", memberships.company_id).maybeSingle(),
        staffRole === "driver" ? supabaseAdmin.from("driver_vehicles").select("id, rego, status, rego_expiry_date, rego_document_path, rego_document_status, insurance_document_path, insurance_document_expiry, insurance_document_status, inspection_document_path, inspection_document_expiry, inspection_document_status").eq("user_id", userId).eq("status", "Active") : Promise.resolve({ data: [], error: null })
      ]);
      if (companyError) throw companyError;
      if (financeError) throw financeError;
      if (vehicleError) throw vehicleError;
      company = companyData;
      financialDetails = financeData;
      contractorVehicles = vehicleData ?? [];
    }
    const agreementPolicy = applicablePolicies.find((policy: any) => String(policy.name ?? policy.title ?? "").toLowerCase().includes("contractor services agreement"));
    const agreementVersionId = agreementPolicy ? latestVersionByPolicy.get(String(agreementPolicy.id)) : undefined;
    const contractorAgreementSignatureMatches = employmentType !== "contractor" || Boolean(
      company && agreementVersionId && (signatures ?? []).some((row: any) =>
        String(row.policy_version_id ?? "") === agreementVersionId &&
        String(row.contractor_company_id ?? "") === String(company.id) &&
        String(row.contractor_agreement_file_path ?? "") === String(company.agreement_file_path ?? "")
      )
    );
    const [{ data: learningSections, error: learningSectionsError }, { data: learningCompletions, error: learningCompletionsError }, { data: passedAttempt, error: quizAttemptError }] = await Promise.all([
      supabaseAdmin.from("learning_sections").select("id"),
      supabaseAdmin.from("learning_section_completions").select("section_id, completed").eq("user_id", userId).eq("section_version", "1.0"),
      supabaseAdmin.from("quiz_attempts").select("id").eq("user_id", userId).eq("passed", true).limit(1)
    ]);
    if (learningSectionsError) throw learningSectionsError;
    if (learningCompletionsError) throw learningCompletionsError;
    if (quizAttemptError) throw quizAttemptError;
    const completedSectionIds = new Set((learningCompletions ?? []).filter((row) => row.completed).map((row) => String(row.section_id)));
    const trainingComplete = Boolean(learningSections?.length) && learningSections.every((section) => completedSectionIds.has(String(section.id)));
    const activeVersion = await supabaseAdmin.from("induction_versions").select("id").eq("is_current", true).maybeSingle();
    if (activeVersion.error) throw activeVersion.error;
    const currentInductionVersion = !activeVersion.data || progress.induction_version_id === activeVersion.data.id;
    let payrollSetupComplete = false;
    if (employmentType !== "contractor") {
      const { data: payroll, error: payrollError } = await supabaseAdmin.from("employee_payroll_details").select("tfn_ciphertext, bank_account_name_ciphertext, bank_bsb_ciphertext, bank_account_number_ciphertext, super_fund_choice").eq("user_id", userId).maybeSingle();
      if (payrollError) throw payrollError;
      payrollSetupComplete = Boolean(payroll?.tfn_ciphertext && payroll?.bank_account_name_ciphertext && payroll?.bank_bsb_ciphertext && payroll?.bank_account_number_ciphertext && payroll?.super_fund_choice);
    }
    const blockers = getFinalApprovalBlockers({
      profile,
      documents: docRows ?? [],
      completedStepIds: progress.completed_step_ids ?? [],
      trainingComplete: trainingComplete && currentInductionVersion,
      quizPassed: Number(progress.quiz_score ?? 0) >= 70 && Boolean(passedAttempt?.length),
      declarationAccepted: progress.declaration_accepted,
      signature: progress.signature,
      requiredPolicyVersionIds,
      signedPolicyVersionIds,
      missingPolicyVersionCount: applicablePolicies.length - requiredPolicyVersionIds.length,
      contractorAgreementSignatureMatches,
      employmentType,
      company,
      requirePayrollSetup: employmentType !== "contractor",
      payrollSetupComplete
    });
    if (employmentType === "contractor") {
      if (!financialDetails || !String(financialDetails.bank_account_name ?? "").trim() || !/^\d{6}$/.test(String(financialDetails.bank_bsb ?? "")) || !/^\d{5,10}$/.test(String(financialDetails.bank_account_number ?? "")) || financialDetails.gst_registered === null || financialDetails.gst_registered === undefined || (financialDetails.gst_registered && !financialDetails.gst_effective_date)) blockers.push("Contractor bank and GST details");
      if (!financialDetails?.business_details_confirmed_at || !financialDetails?.tax_declaration_at || !financialDetails?.insurance_declaration_at || !financialDetails?.vehicle_declaration_at) blockers.push("Contractor business, tax, insurance and vehicle declarations");
      if (company && company.nhvas_accreditation !== "None" && !(company.nhvas_file_path && company.nhvas_status === "approved" && isCurrentOnboardingDate(company.nhvas_expiry))) blockers.push("Current approved NHVAS evidence");
      if (staffRole === "driver" && contractorVehicles.length === 0) blockers.push("At least one registered contractor vehicle");
      for (const vehicle of contractorVehicles) {
        if (!vehicle.rego_document_path || vehicle.rego_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.rego_expiry_date)) blockers.push(`Current approved registration document for ${vehicle.rego || "vehicle"}`);
        if (!vehicle.insurance_document_path || vehicle.insurance_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.insurance_document_expiry)) blockers.push(`Current approved insurance document for ${vehicle.rego || "vehicle"}`);
        if (!vehicle.inspection_document_path || vehicle.inspection_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.inspection_document_expiry)) blockers.push(`Current approved inspection document for ${vehicle.rego || "vehicle"}`);
      }
    }
    if (blockers.length) {
      response.status(400).json({ message: `Complete all current onboarding requirements before approval. Outstanding: ${blockers.join(", ")}.` });
      return;
    }

    const currentVersionId = progress.induction_version_id ?? null;
    let existingQuery = supabaseAdmin.from("certificates").select("*").eq("user_id", userId);
    if (currentVersionId) {
      existingQuery = existingQuery.eq("induction_version_id", currentVersionId);
    }
    const { data: existingArray, error: existingError } = await existingQuery.order("issued_at", { ascending: false }).limit(1);
    if (existingError) throw existingError;
    const existing = existingArray?.[0] ?? null;

    if (existing) {
      response.json({
        message: "Certificate already generated for this version.",
        certificate: {
          completionId: existing.completion_id,
          verificationCode: existing.verification_code,
          verificationUrl: existing.verification_url,
          issuedAt: existing.issued_at,
          expiresAt: existing.expires_at
        }
      });
      return;
    }

    const verificationCode = `VERIFY-${userId.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`;
    const completionId = `COMP-${userId.slice(0, 8).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const verificationUrl = `${appUrl}/certificate/verify/${verificationCode}`;
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const { error: insertError } = await supabaseAdmin
      .from("certificates")
      .insert({
        user_id: userId,
        completion_id: completionId,
        verification_code: verificationCode,
        verification_url: verificationUrl,
        issued_at: issuedAt,
        expires_at: expiresAt.toISOString(),
        induction_version_id: currentVersionId
      });
    if (insertError) throw insertError;

    const completed = new Set<number>(progress.completed_step_ids ?? []);
    completed.add(6);
    await supabaseAdmin.from("induction_progress").update({
      current_step: 6,
      completion_percentage: 100,
      completed: true,
      completed_step_ids: Array.from(completed).sort((a, b) => a - b),
      completed_at: issuedAt,
      updated_at: issuedAt

    }).eq("user_id", userId);

    await supabaseAdmin.from("drivers").update({ status: "Completed" }).eq("user_id", userId);
    await logAuditEntry(userId, "certificate_generated", { completionId, verificationCode, issuedAt });

    // Dispatch completion email to driver (non-blocking)
    const { data: driverProfile } = await supabaseAdmin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
    if (driverProfile?.email) {
      void sendNotificationService({
        eventType: "induction_completed",
        userEmail: driverProfile.email,
        driverName: driverProfile.full_name ?? "Driver",
        context: {
          expiresAt: expiresAt.toISOString(),
          certificateUrl: verificationUrl
        }
      }).catch((err: unknown) => console.error("[EMAIL] Certificate completion email failed:", err instanceof Error ? err.message : err));
    }

    response.json({
      message: "Certificate generated.",
      certificate: {
        completionId,
        verificationCode,
        verificationUrl,
        issuedAt,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// Pre-Trip Inspections API (Driver + Admin)
// ============================================================

/**
 * POST /api/pre-trip-inspections
 * Driver submits a completed pre-trip inspection
 */
app.post("/api/pre-trip-inspections", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const { vehicleRego, odometer, trailerId, overallStatus, items, driverSignature } = request.body;

    if (!vehicleRego || !odometer || !items || !driverSignature) {
      response.status(400).json({ message: "Missing required fields: vehicleRego, odometer, items, driverSignature" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("pre_trip_inspections")
      .insert({
        user_id: userId,
        vehicle_rego: vehicleRego.toUpperCase().trim(),
        odometer: odometer.trim(),
        trailer_id: trailerId?.trim() || null,
        overall_status: overallStatus,
        items: items,
        driver_signature: driverSignature.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    await logAuditEntry(userId, "pre_trip_submitted", { inspectionId: data.id, vehicleRego, overallStatus });

    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pre-trip-inspections
 * Driver: returns own inspections
 * Admin: returns all inspections (with optional driverId filter)
 */
app.get("/api/pre-trip-inspections", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const isAdmin = request.userRole === "admin";
    const { driverId, vehicleRego, status, limit = "50", offset = "0" } = request.query;

    let query = supabaseAdmin
      .from("pre_trip_inspections")
      .select("*")
      .order("inspected_at", { ascending: false })
      .limit(parseInt(limit as string))
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    if (isAdmin) {
      if (driverId) query = query.eq("user_id", driverId);
    } else {
      query = query.eq("user_id", userId);
    }

    if (vehicleRego) query = query.ilike("vehicle_rego", `%${vehicleRego}%`);
    if (status) query = query.eq("overall_status", status);

    const { data, error } = await query;
    if (error) throw error;

    response.json(data || []);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/pre-trip-inspections/:id
 * Get single inspection by ID (driver owns it or admin)
 */
app.get("/api/pre-trip-inspections/:id", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const userId = request.authUserId!;
    const isAdmin = request.userRole === "admin";
    const { id } = request.params;

    let query = supabaseAdmin.from("pre_trip_inspections").select("*").eq("id", id);
    if (!isAdmin) query = query.eq("user_id", userId);

    const { data, error } = await query.single();
    if (error) throw error;
    if (!data) {
      response.status(404).json({ message: "Inspection not found" });
      return;
    }

    response.json(data);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const errorMessage = error instanceof Error ? error.message : "";
  const databaseError = error as { code?: string; message?: string };
  if (databaseError?.code === "PGRST205" && /training_acknowledgements/i.test(databaseError.message ?? errorMessage)) {
    response.status(503).json({ message: "The database is missing the training acknowledgements table. Run supabase/migrations/045_training_acknowledgements.sql in the Supabase SQL Editor, then retry." });
    return;
  }
  if (databaseError?.code === "PGRST205" && /employee_induction_records/i.test(databaseError.message ?? errorMessage)) {
    response.status(503).json({ message: "The database is missing the employee induction records table. Run supabase/migrations/044_employee_induction_records.sql in the Supabase SQL Editor, then retry." });
    return;
  }
  if (databaseError?.code === "42703" && /emergency_contact_(name|relationship|phone)/i.test(databaseError.message ?? errorMessage)) {
    response.status(500).json({ message: "The database is missing emergency-contact columns. Apply supabase/migrations/028_emergency_contact_profile_fields.sql, then retry." });
    return;
  }
  if (errorMessage.startsWith("CORS:")) {
    response.status(403).json({ message: "Origin is not allowed." });
    return;
  }

  // Distinguish between validation errors (400) and unexpected crashes (500)
  const isClientError =
    error instanceof z.ZodError ||
    error instanceof Error &&
    (errorMessage.includes("required") ||
      errorMessage.includes("invalid") ||
      errorMessage.includes("must") ||
      errorMessage.includes("already") ||
      errorMessage.includes("not found") ||
      errorMessage.includes("locked") ||
      errorMessage.includes("Upload") ||
      errorMessage.includes("Complete"));

  const statusCode = isClientError ? 400 : 500;

  // Sanitize Supabase internal messages in production
  let message = error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join(" ")
    : errorMessage || "An unexpected server error occurred.";
  if (statusCode === 500 && process.env.NODE_ENV === "production") {
    message = "An unexpected server error occurred. Please try again.";
  }

  if (statusCode === 500) {
    console.error("[SERVER ERROR]", error);
  }

  response.status(statusCode).json({ message });
});

// --- Automated 24-Hour Expiration & Renewal Background Scheduler ---
async function runNightlyInductionScheduler() {
  try {
    console.log("[SCHEDULER] Running induction renewal and automated notification jobs...");
    try {
      const { error: resetError } = await supabaseAdmin.rpc("reset_expired_inductions");
      if (resetError) console.warn("[SCHEDULER] reset_expired_inductions RPC info:", resetError.message);
    } catch (rpcErr: unknown) {
      console.warn("[SCHEDULER] reset_expired_inductions RPC info:", rpcErr instanceof Error ? rpcErr.message : String(rpcErr));
    }
    const result = await runScheduledNotifications(supabaseAdmin, sendOutboxEmail, { organizationName, appUrl });
    console.log("[SCHEDULER] Notification job finished:", result);
  } catch (err) {
    console.error("[SCHEDULER ERROR]", err);
  }
}

// Execute scheduler once at startup after 10s, then repeat every 24 hours
setTimeout(() => void runNightlyInductionScheduler(), 10_000);
setInterval(() => void runNightlyInductionScheduler(), 24 * 60 * 60 * 1000);


// Mechanical Competency Assessment - employee signature (driver/employee only)
app.post("/api/mechanical-competency/:id/sign", requireDriver, async (request: AdminRequest, response, next) => {
  try {
    const id = z.string().uuid().parse(String(request.params.id));
    const { signature } = z.object({ signature: z.string().min(1) }).parse(request.body);
    const { data: row, error } = await supabaseAdmin
      .from("cor_form_submissions")
      .select("id, user_id, payload")
      .eq("id", id)
      .eq("form_code", "VS_MECHANICAL_COMPETENCY")
      .maybeSingle();
    if (error) throw error;
    if (!row) { response.status(404).json({ message: "Assessment not found." }); return; }
    const payload = (row.payload || {}) as Record<string, unknown>;
    const workerId = String(payload.worker_id || row.user_id || "");
    if (workerId !== request.authUserId) { response.status(403).json({ message: "You can only sign your own assessment." }); return; }
    const now = new Date().toISOString().slice(0, 10);
    const updatedPayload = {
      ...payload,
      employeeSignature: signature,
      employeeDate: now,
      employeeDeclaration: true,
      employeeSignedAt: new Date().toISOString()
    };
    const completed = Boolean(String(payload.managerSignature || ""));
    const updatedStatus = completed ? "Completed" : "Pending Signatures";
    const { error: updateError } = await supabaseAdmin
      .from("cor_form_submissions")
      .update({ payload: { ...updatedPayload, status: updatedStatus }, status: updatedStatus })
      .eq("id", id);
    if (updateError) throw updateError;
    response.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/speed-checklist/reviews", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const input = z.object({
      submissionId: z.string().uuid(),
      driverId: z.string().uuid(),
      reviewStatus: z.enum(["Pending Review", "In Progress", "Reviewed"]),
      feedback: z.string().trim().max(4000).optional().default(""),
      correctiveActionRequired: z.boolean().optional().default(false),
      internalNotes: z.string().trim().max(4000).optional().default(""),
      correctiveActionTitle: z.string().trim().max(200).optional().default(""),
      correctiveActionDescription: z.string().trim().max(4000).optional().default(""),
      assignedTo: z.string().trim().max(200).optional().default(""),
      priority: z.string().trim().max(40).optional().default(""),
      dueDate: z.string().optional().default(""),
      correctiveActionStatus: z.enum(["Open", "In Progress", "Resolved"]).optional(),
      resolutionNotes: z.string().trim().max(4000).optional().default("")
    }).parse(request.body);

    const { data, error } = await supabaseAdmin.from("speed_checklist_reviews").insert({
      submission_id: input.submissionId,
      driver_id: input.driverId,
      reviewer_id: request.authUserId,
      review_status: input.reviewStatus,
      feedback: input.feedback || null,
      corrective_action_required: input.correctiveActionRequired,
      internal_notes: input.internalNotes || null,
      corrective_action_title: input.correctiveActionTitle || null,
      corrective_action_description: input.correctiveActionDescription || null,
      assigned_to: input.assignedTo || null,
      priority: input.priority || null,
      due_date: input.dueDate || null,
      corrective_action_status: input.correctiveActionStatus || null,
      resolution_notes: input.resolutionNotes || null
    }).select("*").single();
    if (error) throw error;

    // notify driver if feedback provided
    if (input.feedback.trim()) {
      await supabaseAdmin.from("driver_messages").insert({
        sender_id: request.authUserId,
        receiver_id: input.driverId,
        subject: "Speed Checklist Review",
        message: input.feedback,
        message_type: "Assessment Feedback",
        required_action: input.correctiveActionRequired ? (input.correctiveActionTitle || "Complete corrective action") : null,
        status: "Unread"
      });
    }

    response.status(201).json({ review: data });
  } catch (error) { next(error); }
});

app.get("/api/admin/speed-checklist/reviews/:submissionId", requireAdmin, async (request: AdminRequest, response, next) => {
  try {
    const submissionId = z.string().uuid().parse(request.params.submissionId);
    const { data, error } = await supabaseAdmin
      .from("speed_checklist_reviews")
      .select("*")
      .eq("submission_id", submissionId)
      .order("reviewed_at", { ascending: false });
    if (error) throw error;
    response.json({ reviews: data ?? [] });
  } catch (error) { next(error); }
});

app.get("/api/loading-presentation/url", async (request: AdminRequest, response, next) => {
  try {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) { response.status(401).json({ message: "Authentication required." }); return; }
    const auth = await verifySessionToken(header.slice("Bearer ".length));
    if (auth.unavailable) { response.status(503).json({ message: "Unable to reach Supabase Auth." }); return; }
    if (!auth.user) { response.status(401).json({ message: "Invalid session." }); return; }
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile || (profile.role !== "admin" && profile.role !== "driver")) {
      response.status(403).json({ message: "Access denied." }); return;
    }
    const { data, error } = await supabaseAdmin.storage
      .from("loading-presentations")
      .createSignedUrl("BNT_Loading_Unloading_Restraint_Checklist_Presentation_v2.pptx", 3600);
    if (error || !data?.signedUrl) throw error || new Error("Unable to generate signed URL.");
    response.json({ url: data.signedUrl });
  } catch (error) { next(error); }
});

export { app };
