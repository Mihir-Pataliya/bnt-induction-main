// Vercel serverless API for the Driver Induction System.
// Web Standard handler (Node.js 18+ runtime). Mirrors the routes in apps/api/src/app.ts.
// Routes are matched against the path after "/api/".
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { handleOrganisationalChart } from "../apps/api/src/organisationalChart.js";
import { addFatigueAttemptNumbers, buildFatigueAnswerReview, FatigueAssessmentError, gradeFatigueAssessment, validateFatigueQuestions } from "../apps/api/src/fatigueAssessment.js";
import { addDistractionAttemptNumbers, buildDistractionAnswerReview, DistractionAssessmentError, gradeDistractionAssessment, validateDistractionQuestions } from "../apps/api/src/distractionAssessment.js";
import { addSpeedAttemptNumbers, buildSpeedAnswerReview, SpeedAssessmentError, gradeSpeedAssessment, validateSpeedQuestions } from "../apps/api/src/speedAssessment.js";
import { validateBasicProfile } from "../apps/web/src/lib/profileValidation.mjs";
import { validateABN, validateACN } from "../apps/web/src/lib/contractorValidation.mjs";
import { buildDocumentReviewUpdate, getCurrentWorkClearanceBlockers, getNextContractorCompanyStatus, getRequiredDocumentTypesForRole, isCurrentOnboardingDate, latestDocumentsByType, REQUIRED_EXPIRY_DOCUMENTS } from "../apps/web/src/lib/onboardingCompliance.mjs";
import { dispatchNotificationOutbox, enqueueNotifications, runScheduledNotifications } from "../apps/api/src/notificationOutbox.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const APP_URL = process.env.APP_URL ?? "";
const ORGANIZATION_NAME = process.env.ORGANIZATION_NAME ?? "BNT Logistics";
const ORGANIZATION_LOGO_URL = process.env.ORGANIZATION_LOGO_URL ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "";
const ALLOW_SELF_REGISTRATION = process.env.ALLOW_SELF_REGISTRATION === "true";

const DEFAULT_BRANDING = {
  id: "default",
  company_name: "BNT Logistics",
  logo_path: null as string | null,
  primary_color: "#1e3a5f",
  welcome_text: "Welcome to the driver induction portal",
  updated_at: null as string | null
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ message }, status);
}

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function getSupabaseAnon() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function requireConfig(): Response | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse("Server misconfiguration: Supabase credentials are not set.", 500);
  }
  return null;
}

async function logAuditEntry(userId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await getSupabaseAdmin()
    .from("audit_logs")
    .insert({ user_id: userId, action, metadata, created_at: new Date().toISOString() });
  if (error) {
    console.error("[AUDIT] Failed to write audit log:", action, error.message);
  }
}

// --- Rate limiter (in-memory; the quiz attempt limit is enforced in the DB) ---
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX_STORE_SIZE = 10_000;

function rateLimitCheck(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    if (rateLimitStore.size >= RATE_LIMIT_MAX_STORE_SIZE) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (now > v.resetAt) rateLimitStore.delete(k);
        if (rateLimitStore.size < RATE_LIMIT_MAX_STORE_SIZE) break;
      }
    }
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= maxRequests;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// --- Auth guards ---

async function requireDriver(request: Request): Promise<{ userId: string } | { response: Response }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { response: errorResponse("Authentication required.", 401) };
  }
  const token = header.slice("Bearer ".length);
  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { response: errorResponse("Invalid session.", 401) };
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  if (profileError || profile?.role !== "driver") {
    return { response: errorResponse("Driver access is required.", 403) };
  }
  const mustChange = (authData.user.user_metadata as Record<string, unknown> | null)?.must_change_password === true;
  if (mustChange) {
    return {
      response: jsonResponse(
        { code: "PASSWORD_RESET_REQUIRED", message: "Password change is required before starting your induction." },
        403
      )
    };
  }
  return { userId: authData.user.id };
}

async function requireAdmin(request: Request): Promise<{ adminId: string } | { response: Response }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { response: errorResponse("Admin access required.", 401) };
  }
  const token = header.slice("Bearer ".length);
  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { response: errorResponse("Admin access required.", 401) };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  if (profile?.role !== "admin") {
    return { response: errorResponse("Admin access required.", 401) };
  }
  return { adminId: authData.user.id };
}

// --- Misc helpers ---

function uuidV4(): string {
  const g = globalThis.crypto;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sendEmailViaResend(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn(`[EMAIL] RESEND_API_KEY not set. Email NOT sent to ${to}.`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL || "onboarding@resend.dev",
        to,
        subject,
        html
      })
    });
    if (!res.ok) {
      console.error("[EMAIL] Resend dispatch failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err: any) {
    console.error("[EMAIL] Resend dispatch error:", err?.message);
  }
}

async function sendOutboxEmailViaResend(to: string, subject: string, html: string, idempotencyKey: string): Promise<string> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is required to deliver automated notifications.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL || "onboarding@resend.dev",
      to: [to],
      subject,
      html
    })
  });
  if (!response.ok) {
    throw new Error(`Resend returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Resend accepted the request without returning an email ID.");
  return result.id;
}

function renderVerificationPage(payload: {
  organizationName: string;
  certificate: { completionId: string; verificationCode: string; verificationUrl: string; issuedAt: string };
  driver: { fullName: string };
}, logoUrl: string): string {
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

function renderVerificationErrorPage(organizationName: string, logoUrl: string): string {
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

// --- Route handlers ---

async function handleHealth(): Promise<Response> {
  return jsonResponse({
    status: "ok",
    service: "driver-induction-api-vercel",
    organizationName: ORGANIZATION_NAME,
    timestamp: new Date().toISOString()
  });
}

// --- Branding (public read, admin update) ---

async function handleGetBranding(): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("branding")
    .select("id, company_name, logo_path, primary_color, welcome_text, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return jsonResponse({ branding: data ?? DEFAULT_BRANDING });
}

async function handleUpdateBranding(request: Request, adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({
    company_name: z.string().min(1).max(100),
    logo_path: z.string().max(500).nullable().optional(),
    primary_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Primary colour must be a hex value like #1e3a5f"),
    welcome_text: z.string().max(500)
  });
  const payload = schema.parse(await request.json());

  const { data: updated, error: updateError } = await supabase
    .from("branding")
    .upsert(
      {
        id: "default",
        ...payload,
        updated_by: adminId,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    )
    .select("id, company_name, logo_path, primary_color, welcome_text, updated_at")
    .maybeSingle();
  if (updateError) throw updateError;

  await logAuditEntry(adminId, "admin_branding_updated", {
    companyName: payload.company_name,
    hasLogo: Boolean(payload.logo_path)
  });

  return jsonResponse({ message: "Branding updated.", branding: updated });
}

async function handleSelfRegisterDriver(request: Request): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const registerSchema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(5),
    address: z.string().min(5),
    preferredLanguage: z.string().min(2).default("English"),
    password: z.string().min(8),
    depotCode: z.string().optional()
  });

  const payload = registerSchema.parse(await request.json());
  const emailLower = payload.email.toLowerCase().trim();

  const { data: createdUser, error: authErr } = await supabase.auth.admin.createUser({
    email: emailLower,
    password: payload.password,
    email_confirm: true,
    user_metadata: { role: "driver", must_change_password: false, depot_code: payload.depotCode }
  });

  if (authErr || !createdUser.user) {
    return errorResponse(authErr?.message ?? "Registration failed", 400);
  }

  const userId = createdUser.user.id;
  const now = new Date().toISOString();

  const [profileRes, driverRes, progressRes] = await Promise.allSettled([
    supabase.from("profiles").insert({
      id: userId, role: "driver", email: emailLower, full_name: payload.fullName,
      phone: payload.phone, address: payload.address, preferred_language: payload.preferredLanguage,
      created_at: now, updated_at: now
    }),
    supabase.from("drivers").insert({ user_id: userId, status: "Not Started", created_at: now }),
    supabase.from("induction_progress").insert({
      user_id: userId, current_step: 1, completion_percentage: 0, completed: false,
      completed_step_ids: [], updated_at: now
    })
  ]);

  const insertErrors: string[] = [];
  for (const res of [profileRes, driverRes, progressRes]) {
    if (res.status === "rejected") {
      insertErrors.push(res.reason?.message ?? "unknown");
    } else if (res.value && typeof res.value === "object" && "error" in res.value) {
      const err = (res.value as { error?: { message?: string } }).error;
      if (err) insertErrors.push(err.message ?? "unknown");
    }
  }

  if (insertErrors.length > 0) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return errorResponse(`Registration failed: ${insertErrors.join("; ")}`, 500);
  }

  const { data: sections } = await supabase.from("learning_sections").select("id");
  if (sections?.length) {
    await supabase.from("learning_section_completions").insert(
      sections.map((sec: any) => ({ user_id: userId, section_id: sec.id, completed: false, updated_at: now }))
    );
  }

  await logAuditEntry(userId, "driver_self_registered", { email: emailLower, depotCode: payload.depotCode });
  return jsonResponse({ message: "Registration successful. You can now log in.", email: emailLower });
}

async function handleChangePassword(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    return errorResponse("Missing session token.", 401);
  }

  const supabase = getSupabaseAdmin();
  const { data: authUser, error: tokenError } = await supabase.auth.getUser(token);
  if (tokenError || !authUser.user) {
    return errorResponse("Invalid or expired session token.", 401);
  }

  const schema = z.object({ currentPassword: z.string().optional(), newPassword: z.string().min(8) });
  const { currentPassword, newPassword } = schema.parse(await request.json());

  if (currentPassword) {
    if (!SUPABASE_ANON_KEY) {
      return errorResponse("Server misconfiguration: SUPABASE_ANON_KEY is not set.", 500);
    }
    const tempClient = getSupabaseAnon();
    const { error: signInErr } = await tempClient.auth.signInWithPassword({
      email: authUser.user.email!,
      password: currentPassword
    });
    if (signInErr) {
      return errorResponse("Incorrect current password.", 401);
    }
  }

  const { error: updateErr } = await supabase.auth.admin.updateUserById(authUser.user.id, {
    password: newPassword,
    user_metadata: { ...(authUser.user.user_metadata as object), must_change_password: false }
  });
  if (updateErr) throw updateErr;

  await supabase.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", authUser.user.id);
  await logAuditEntry(authUser.user.id, "user_changed_password", { email: authUser.user.email });

  return jsonResponse({ message: "Password updated successfully." });
}

async function handleGetQuizQuestions(userId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("quiz_questions").select("*");
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

  return jsonResponse(mapped);
}

async function handleStartSection(userId: string, request: Request): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({ sectionId: z.string(), sectionVersion: z.string().optional() });
  const { sectionId, sectionVersion } = schema.parse(await request.json());
  const [{ data: section, error: sectionError }, { data: profile }, { data: membership }] = await Promise.all([
    supabase.from("learning_sections").select("id, version, audience, target_role, is_mandatory").eq("id", sectionId).maybeSingle(),
    supabase.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
    supabase.from("contractor_profiles").select("user_id").eq("user_id", userId).maybeSingle()
  ]);
  if (sectionError) throw sectionError;
  if (!section) return errorResponse("Learning module not found.", 404);
  const engagement = profile?.employment_type === "contractor" || Boolean(membership) ? "contractor" : "employee";
  const role = profile?.staff_role ?? "driver";
  if ((section.audience && section.audience !== "all" && section.audience !== engagement) || (section.target_role && section.target_role !== "all" && section.target_role !== role)) {
    return errorResponse("This learning module is not assigned to your role.", 403);
  }
  const currentVersion = String(section.version ?? "1.0");
  if (sectionVersion && sectionVersion !== currentVersion) return errorResponse("This training content has been updated. Refresh your checklist and complete the current version.", 409);

  const { data: existing, error: existingError } = await supabase
    .from("learning_section_completions")
    .select("section_started_at")
    .eq("user_id", userId)
    .eq("section_id", sectionId)
    .eq("section_version", currentVersion)
    .maybeSingle();
  if (existingError) throw existingError;

  // Playback events fire more than once (for example after a pause). Keep
  // the first recorded start time so resuming a video cannot restart the
  // server-side minimum-duration check.
  if (existing?.section_started_at) {
    return jsonResponse({ message: "Section already started." });
  }

  const { error } = existing
    ? await supabase
        .from("learning_section_completions")
        .update({ section_started_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("section_id", sectionId)
        .eq("section_version", currentVersion)
    : await supabase
        .from("learning_section_completions")
        .insert({
          user_id: userId,
          section_id: sectionId,
          section_version: currentVersion,
          section_started_at: new Date().toISOString()
        });

  if (error) throw error;
  return jsonResponse({ message: "Section started." });
}

async function handleSaveStep(userId: string, request: Request): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({
    step: z.number().int().min(1).max(6),
    payload: z.record(z.string(), z.unknown())
  });
  const { step, payload } = schema.parse(await request.json());

  if (step === 1) {
    const supabase = getSupabaseAdmin();
    const { data: profileTarget, error: profileReadError } = await supabase.from("profiles").select("staff_role").eq("id", userId).maybeSingle();
    if (profileReadError) throw profileReadError;
    const requiresDriverLicence = (profileTarget?.staff_role ?? "driver") === "driver";
    const requiredFields: Record<string, string> = {
      fullName: "Full name", email: "Email", phone: "Mobile number", address: "Residential address",
      dateOfBirth: "Date of birth", preferredLanguage: "Preferred language", emergencyContactName: "Emergency contact name",
      emergencyContactRelationship: "Emergency contact relationship", emergencyContactPhone: "Emergency contact phone", depotLocation: "Depot location"
    };
    if (requiresDriverLicence) {
      requiredFields.licenceClass = "Licence class";
      requiredFields.issuingState = "Issuing state";
    }
    const missing = Object.entries(requiredFields).filter(([key]) => !String(payload[key] ?? "").trim()).map(([, label]) => label);
    const errors = validateBasicProfile(payload, { requiresDriverLicence });
    if (missing.length || Object.keys(errors).length) {
      return errorResponse(`Complete all required profile fields before continuing.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${Object.keys(errors).length ? ` Check: ${Object.values(errors).join(" ")}` : ""}`, 400);
    }
  }

  const { data: current, error: progressError } = await supabase
    .from("induction_progress")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (progressError) throw progressError;

  const { data: activeVersion } = await supabase
    .from("induction_versions")
    .select("id, version_label")
    .eq("is_current", true)
    .maybeSingle();

  const activeVersionId = activeVersion?.id ?? null;
  let isNewVersionReinduction = false;

  if (activeVersionId && current.induction_version_id && current.induction_version_id !== activeVersionId) {
    const { data: oldVer } = await supabase
      .from("induction_versions")
      .select("version_label")
      .eq("id", current.induction_version_id)
      .maybeSingle();
    if (oldVer && oldVer.version_label !== activeVersion?.version_label) {
      isNewVersionReinduction = true;
    }
  }

  if (current.completed && !isNewVersionReinduction) {
    return errorResponse("Induction is already completed.", 400);
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
        const { error: fullUpdateErr } = await supabase
          .from("profiles")
          .update(updateData)
          .eq("id", userId);

        if (fullUpdateErr) {
          const { error: baseErr } = await supabase
            .from("profiles")
            .update(baseProfileData)
            .eq("id", userId);
          if (baseErr) throw baseErr;
        }
      }
    }

    if (isNewVersionReinduction || !current.induction_version_id) {
      if (activeVersionId) {
        await supabase
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
    return errorResponse(`Complete all preceding steps before continuing. Missing step(s): ${missingSteps.join(", ")}.`, 400);
  }

  if (step === 2) {
    const [{ data: docs, error: docsError }, { data: profile }, { data: membership }] = await Promise.all([supabase
      .from("documents")
      .select("type, status, expires_at, uploaded_at")
      .eq("user_id", userId),
      supabase.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
      supabase.from("contractor_profiles").select("user_id").eq("user_id", userId).maybeSingle()]);
    if (docsError) throw docsError;
    const required = getRequiredDocumentTypesForRole(profile?.staff_role ?? "driver");
    const latestDocs = latestDocumentsByType(docs ?? []);
    const incomplete = required.filter((type) => {
      const doc = latestDocs.get(type);
      return !doc || doc.status !== "approved" || (doc.expires_at ? !isCurrentOnboardingDate(doc.expires_at) : REQUIRED_EXPIRY_DOCUMENTS.includes(type));
    });
    if (incomplete.length > 0) {
      return errorResponse(`All required documents must be approved and current before continuing. Outstanding: ${incomplete.join(", ")}.`, 400);
    }
  }

  if (step === 3) {
    const sectionsPayload = (payload.sections as Array<{ sectionId: string; sectionVersion?: string; completed: boolean }> | undefined) ?? [];
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
      supabase.from("contractor_profiles").select("user_id").eq("user_id", userId).maybeSingle()
    ]);
    const engagement = profile?.employment_type === "contractor" || Boolean(membership) ? "contractor" : "employee";
    const role = profile?.staff_role ?? "driver";
    const { data: allSections } = await supabase.from("learning_sections").select("id, version, audience, target_role, is_mandatory, video_duration_seconds, require_full_watch");
    const dbSections = (allSections ?? []).filter((section: any) =>
      (section.audience ?? "all") === "all" || section.audience === engagement
    ).filter((section: any) => (section.target_role ?? "all") === "all" || section.target_role === role);

    // Upsert completions securely from backend
    for (const sec of sectionsPayload) {
      const sectionDef = dbSections?.find((section: any) => section.id === sec.sectionId);
      if (!sectionDef) return errorResponse("This learning module is not assigned to your role.", 403);
      const sectionVersion = String(sectionDef.version ?? "1.0");
      if (sec.sectionVersion && sec.sectionVersion !== sectionVersion) return errorResponse("This training content has been updated. Refresh the checklist and complete the current version.", 409);
      if (sec.completed) {
        const { data: dbComp } = await supabase.from("learning_section_completions")
          .select("section_started_at, completed")
          .eq("user_id", userId)
          .eq("section_id", sec.sectionId)
          .eq("section_version", sectionVersion)
          .maybeSingle();

        if (!dbComp?.completed) {
          if (!dbComp?.section_started_at) {
            return errorResponse("Video section was not started properly.", 400);
          }
          const isRequiredWatch = Boolean(sectionDef.require_full_watch);
          const videoDurationMs = (sectionDef.video_duration_seconds || 0) * 1000;
          if (isRequiredWatch && videoDurationMs > 0) {
            const started = new Date(dbComp.section_started_at).getTime();
            const now = Date.now();
            const minDurationMs = Math.max(0, videoDurationMs - 10000); // 10s buffer for network latency
            if (now - started < minDurationMs) {
              return errorResponse("Video was marked complete too quickly.", 400);
            }
          }
        }
      }

      await supabase
        .from("learning_section_completions")
        .upsert({
          user_id: userId,
          section_id: sec.sectionId,
          section_version: sectionVersion,
          completed: sec.completed,
          completed_at: sec.completed ? new Date().toISOString() : null
        }, { onConflict: "user_id,section_id,section_version" });
    }

    if (payload.allowPartial) {
      // Just return early with a success response, we don't mark step 3 complete yet
      return jsonResponse({ message: "Partial progress saved." });
    }

    const { data: completions } = await supabase.from("learning_section_completions").select("section_id, section_version, completed").eq("user_id", userId);

    const allCompleted = dbSections?.filter((sec: any) => sec.is_mandatory !== false).every((sec: any) =>
      completions?.some(comp => comp.section_id === sec.id && comp.section_version === String(sec.version ?? "1.0") && comp.completed)
    );
    if (!allCompleted) {
      return errorResponse("All required learning modules must be completed.", 400);
    }
  }

  if (step === 4) {
    return errorResponse("Step 4 is completed via quiz submission.", 400);
  }

  completed.add(step);

  let nextStep = step >= 5 ? 6 : Math.max(current.current_step, step + 1);
  let completionPercentage = Math.round((completed.size / 6) * 100);

  if (step === 5) {
    const accepted = payload.accepted !== undefined ? Boolean(payload.accepted) : true;
    const rawSignature = String(payload.signature ?? "").trim();
    const PLACEHOLDER_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    if (rawSignature.length < 2 || rawSignature === PLACEHOLDER_SIGNATURE) {
      return errorResponse("Please draw your signature before submitting the declaration.", 400);
    }
    if (!accepted) {
      return errorResponse("Please accept the declaration.", 400);
    }

    let signaturePath = rawSignature;
    if (rawSignature.startsWith("data:image/png;base64,")) {
      const base64Data = rawSignature.replace(/^data:image\/png;base64,/, "");
      const bytes = base64ToBytes(base64Data);
      const fileName = `${userId}/signature.png`;
      const { error: uploadError } = await supabaseAdminStorageUpload(supabase, fileName, bytes);
      if (uploadError) console.warn("Signature upload storage warning:", uploadError.message);
      signaturePath = fileName;
    }

    nextStep = 6;
    completionPercentage = Math.round((completed.size / 6) * 100);
    await supabase.from("induction_progress").update({
      declaration_accepted: true,
      declaration_agreed_at: new Date().toISOString(),
      signature: signaturePath
    }).eq("user_id", userId);
  }

  const completedArray = Array.from(completed).sort((a, b) => a - b);
  const { error: updateError } = await supabase.from("induction_progress").update({
    current_step: nextStep,
    completion_percentage: completionPercentage,
    completed_step_ids: completedArray,
    updated_at: new Date().toISOString()
  }).eq("user_id", userId);

  if (updateError) throw updateError;

  await logAuditEntry(userId, "step_completed", { step, completionPercentage, currentStep: nextStep });
  return jsonResponse({ message: "Step saved." });
}

async function supabaseAdminStorageUpload(supabase: any, fileName: string, bytes: Uint8Array) {
  return supabase.storage
    .from("driver-documents")
    .upload(fileName, bytes, { contentType: "image/png", upsert: true });
}

async function handleSubmitQuiz(userId: string, request: Request): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({
    answers: z.record(z.string(), z.coerce.number())
  });
  const { answers } = schema.parse(await request.json());

  const { data: current, error: progressError } = await supabase
    .from("induction_progress")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (progressError || current.completed) {
    return errorResponse("Induction is locked.", 400);
  }

  // Attempt limit: at most QUIZ_MAX_ATTEMPTS attempts within a rolling
  // QUIZ_WINDOW_HOURS window. Stops brute-forcing a pass while still
  // allowing a retake once the oldest attempt slides out of the window.
  const QUIZ_MAX_ATTEMPTS = Number(process.env.QUIZ_MAX_ATTEMPTS || 3);
  const QUIZ_WINDOW_MS = Number(process.env.QUIZ_WINDOW_HOURS || 24) * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - QUIZ_WINDOW_MS).toISOString();
  const { data: recentAttempts } = await supabase
    .from("quiz_attempts")
    .select("created_at")
    .eq("user_id", userId)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true });
  if ((recentAttempts?.length ?? 0) >= QUIZ_MAX_ATTEMPTS) {
    const oldest = new Date(recentAttempts![0].created_at).getTime();
    const retryAt = new Date(oldest + QUIZ_WINDOW_MS);
    return jsonResponse(
      {
        message: `Maximum quiz attempts reached. Please try again after ${retryAt.toLocaleString("en-AU")}.`,
        retryAt: retryAt.toISOString()
      },
      429
    );
  }

  const { data: questions, error } = await supabase
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

  // Pass threshold is >= 70% AND zero critical question failures
  const passed = score >= 70 && !failedCritical;

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

  const { data: attempts } = await supabase.from("quiz_attempts").select("id").eq("user_id", userId);
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
  const { error: attemptErr } = await supabase.from("quiz_attempts").insert(fullAttempt);
  if (attemptErr) {
    // Fallback to base columns
    await supabase.from("quiz_attempts").insert({
      user_id: userId,
      score,
      passed,
      answers
    });
  }

  const completed = new Set<number>(current.completed_step_ids ?? []);
  if (passed) completed.add(4);

  await supabase.from("induction_progress").update({
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

  return jsonResponse({
    score,
    passed,
    categoryScores,
    failedCritical,
    failedCriticalReason,
    results
  });
}

async function handleIssueCertificate(userId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  const { data: progress } = await supabase
    .from("induction_progress")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!progress || ![1, 2, 3, 4, 5].every(step => progress.completed_step_ids?.includes(step))) {
    const missing = [1, 2, 3, 4, 5].filter(s => !progress?.completed_step_ids?.includes(s));
    return errorResponse(`Complete all steps first. Missing step(s): ${missing.join(", ")}.`, 400);
  }

  // Fail closed at issuance as well as at each wizard step. The final check
  // evaluates the current version and targeting rules from the persisted rows.
  const [{ data: profile, error: profileError }, { data: membership, error: membershipError }, { data: docs, error: docsError }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, phone, address, preferred_language, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, licence_class, issuing_state, licence_number, depot_location, employment_type, staff_role").eq("id", userId).maybeSingle(),
    supabase.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle(),
    supabase.from("documents").select("type, status, expires_at, uploaded_at").eq("user_id", userId).order("uploaded_at", { ascending: false })
  ]);
  if (profileError) throw profileError;
  if (membershipError) throw membershipError;
  if (docsError) throw docsError;
  const engagement = profile?.employment_type === "contractor" || Boolean(membership) ? "contractor" : "employee";
  const staffRole = profile?.staff_role ?? "driver";
  const latestDocs = new Map<string, any>();
  for (const doc of docs ?? []) if (!latestDocs.has(String(doc.type))) latestDocs.set(String(doc.type), doc);
  const required = staffRole === "driver" ? ["driver_license", "medical_certificate", "right_to_work"] : ["right_to_work"];
  const blockers: string[] = [];
  if (!profile || !String(profile.full_name ?? "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email ?? "")) || !String(profile.phone ?? "").trim() || !String(profile.address ?? "").trim() || !String(profile.preferred_language ?? "").trim() || !String(profile.emergency_contact_name ?? "").trim() || !String(profile.emergency_contact_relationship ?? "").trim() || !String(profile.emergency_contact_phone ?? "").trim() || !String(profile.depot_location ?? "").trim()) blockers.push("Required profile details");
  const driverPhoneDigits = String(profile?.phone ?? "").replace(/\D/g, "");
  if (!/^(?:\+?61|0)4\d{8}$/.test(String(profile?.phone ?? "").trim()) && driverPhoneDigits.length !== 10) blockers.push("Valid phone number");
  if (staffRole === "driver" && (!String(profile?.licence_class ?? "").trim() || !String(profile?.issuing_state ?? "").trim() || !/^[A-Za-z0-9]{8}$/.test(String(profile?.licence_number ?? "").trim()))) blockers.push("Driver licence profile details");
  const emergencyDigits = String(profile?.emergency_contact_phone ?? "").replace(/\D/g, "");
  if (emergencyDigits.length < 8 || emergencyDigits.length > 15) blockers.push("Valid emergency contact phone");
  if (Number(progress.quiz_score ?? 0) < 70) blockers.push("Passing safety quiz result");
  if (!progress.declaration_accepted || !String(progress.signature ?? "").trim()) blockers.push("Signed declaration");
  for (const type of required) {
    const doc = latestDocs.get(type);
    const expiry = doc?.expires_at ? new Date(`${String(doc.expires_at).slice(0, 10)}T23:59:59.999Z`).getTime() : null;
    if (!doc || doc.status !== "approved" || ((type === "driver_license" || type === "medical_certificate") && expiry === null) || (expiry !== null && expiry < Date.now())) blockers.push(type);
  }

  const [{ data: policies, error: policiesError }, { data: signatures, error: signaturesError }, { data: sections, error: sectionsError }, { data: completions, error: completionsError }] = await Promise.all([
    supabase.from("policies").select("id, name, title, audience, target_role, is_published, status").eq("is_published", true),
    supabase.from("policy_signatures").select("policy_version_id, policy_id, contractor_company_id, contractor_agreement_file_path").eq("user_id", userId),
    supabase.from("learning_sections").select("id, title, version, audience, target_role, is_mandatory"),
    supabase.from("learning_section_completions").select("section_id, section_version, completed").eq("user_id", userId)
  ]);
  if (policiesError) throw policiesError;
  if (signaturesError) throw signaturesError;
  if (sectionsError) throw sectionsError;
  if (completionsError) throw completionsError;
  const applicablePolicies = (policies ?? []).filter((policy: any) =>
    (!policy.audience || policy.audience === "all" || policy.audience === engagement) &&
    (!policy.target_role || policy.target_role === "all" || policy.target_role === staffRole)
  );
  const policyIds = applicablePolicies.map((policy: any) => policy.id);
  const { data: versions, error: versionsError } = policyIds.length
    ? await supabase.from("policy_versions").select("id, policy_id, published_at").in("policy_id", policyIds).order("published_at", { ascending: false })
    : { data: [], error: null };
  if (versionsError) throw versionsError;
  const currentPolicyVersions = new Map<string, string>();
  for (const version of versions ?? []) if (!currentPolicyVersions.has(String(version.policy_id))) currentPolicyVersions.set(String(version.policy_id), String(version.id));
  const signedVersionIds = new Set((signatures ?? []).map((row: any) => String(row.policy_version_id ?? row.policy_id ?? "")));
  for (const policy of applicablePolicies) {
    const versionId = currentPolicyVersions.get(String(policy.id));
    if (!versionId || !signedVersionIds.has(versionId)) blockers.push(`Policy acknowledgement: ${policy.name ?? policy.title ?? "policy"}`);
  }
  const mandatorySections = (sections ?? []).filter((section: any) => section.is_mandatory !== false &&
    (!section.audience || section.audience === "all" || section.audience === engagement) &&
    (!section.target_role || section.target_role === "all" || section.target_role === staffRole));
  for (const section of mandatorySections) {
    const currentVersion = String(section.version ?? "1.0");
    if (!(completions ?? []).some((row: any) => row.section_id === section.id && String(row.section_version ?? "1.0") === currentVersion && row.completed)) blockers.push(`Training: ${section.title}`);
  }

  let contractorCompany: any = null;
  if (engagement === "contractor") {
    if (!membership?.company_id) blockers.push("Linked contractor company");
    else {
      const { data, error } = await supabase.from("contractor_companies").select("id, nhvas_accreditation, nhvas_file_path, nhvas_status, nhvas_expiry, public_liability_file_path, public_liability_status, public_liability_expiry, workers_comp_file_path, workers_comp_status, workers_comp_expiry, agreement_file_path, agreement_status, agreement_expiry").eq("id", membership.company_id).maybeSingle();
      if (error) throw error;
      contractorCompany = data;
      const [{ data: finance, error: financeError }, { data: contractorVehicles, error: vehicleError }] = await Promise.all([
        supabase.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", membership.company_id).maybeSingle(),
        staffRole === "driver" ? supabase.from("driver_vehicles").select("id, rego, rego_expiry_date, rego_document_path, rego_document_status, insurance_document_path, insurance_document_expiry, insurance_document_status, inspection_document_path, inspection_document_expiry, inspection_document_status").eq("user_id", userId).eq("status", "Active") : Promise.resolve({ data: [], error: null })
      ]);
      if (financeError) throw financeError;
      if (vehicleError) throw vehicleError;
      if (!finance || !String(finance.bank_account_name ?? "").trim() || !/^\d{6}$/.test(String(finance.bank_bsb ?? "")) || !/^\d{5,10}$/.test(String(finance.bank_account_number ?? "")) || finance.gst_registered === null || finance.gst_registered === undefined || (finance.gst_registered && !finance.gst_effective_date)) blockers.push("Contractor bank and GST details");
      if (!finance?.business_details_confirmed_at || !finance?.tax_declaration_at || !finance?.insurance_declaration_at || !finance?.vehicle_declaration_at) blockers.push("Contractor business, tax, insurance and vehicle declarations");
      for (const [kind, label] of [["public_liability", "Public liability insurance"], ["workers_comp", "Workers compensation insurance"]]) {
        const expiry = contractorCompany?.[`${kind}_expiry`] ? new Date(`${String(contractorCompany[`${kind}_expiry`]).slice(0, 10)}T23:59:59.999Z`).getTime() : 0;
        if (!contractorCompany?.[`${kind}_file_path`] || contractorCompany[`${kind}_status`] !== "approved" || expiry < Date.now()) blockers.push(label);
      }
      const agreementExpiry = contractorCompany?.agreement_expiry ? new Date(`${String(contractorCompany.agreement_expiry).slice(0, 10)}T23:59:59.999Z`).getTime() : 0;
      if (!contractorCompany?.agreement_file_path || contractorCompany.agreement_status !== "approved" || agreementExpiry < Date.now()) blockers.push("Current approved contractor agreement");
      if (contractorCompany?.nhvas_accreditation && contractorCompany.nhvas_accreditation !== "None") {
        if (!contractorCompany.nhvas_file_path || contractorCompany.nhvas_status !== "approved" || !isCurrentOnboardingDate(contractorCompany.nhvas_expiry)) blockers.push("Current approved NHVAS evidence");
      }
      if (staffRole === "driver") {
        if (!(contractorVehicles ?? []).length) blockers.push("At least one registered contractor vehicle");
        for (const vehicle of contractorVehicles ?? []) {
          if (!vehicle.rego_document_path || vehicle.rego_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.rego_expiry_date)) blockers.push(`Current approved registration document for ${vehicle.rego || "vehicle"}`);
          if (!vehicle.insurance_document_path || vehicle.insurance_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.insurance_document_expiry)) blockers.push(`Current approved insurance document for ${vehicle.rego || "vehicle"}`);
          if (!vehicle.inspection_document_path || vehicle.inspection_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.inspection_document_expiry)) blockers.push(`Current approved inspection document for ${vehicle.rego || "vehicle"}`);
        }
      }
      const agreementPolicy = applicablePolicies.find((policy: any) => String(policy.name ?? policy.title ?? "").toLowerCase().includes("contractor services agreement"));
      const agreementVersion = agreementPolicy ? currentPolicyVersions.get(String(agreementPolicy.id)) : undefined;
      if (!agreementPolicy || !agreementVersion) blockers.push("Current contractor agreement policy version");
      else if (!((signatures ?? []).some((row: any) => String(row.policy_version_id ?? "") === agreementVersion && String(row.contractor_company_id ?? "") === String(contractorCompany?.id) && String(row.contractor_agreement_file_path ?? "") === String(contractorCompany?.agreement_file_path ?? "")))) blockers.push("Contractor agreement signature for current company document");
    }
  }
  if (blockers.length) {
    return errorResponse(`Current onboarding requirements are incomplete. Outstanding: ${blockers.join(", ")}.`, 400);
  }

  const currentVersionId = progress.induction_version_id ?? null;
  let existingQuery = supabase.from("certificates").select("*").eq("user_id", userId);
  if (currentVersionId) {
    existingQuery = existingQuery.eq("induction_version_id", currentVersionId);
  }
  const { data: existingArray, error: existingError } = await existingQuery.order("issued_at", { ascending: false }).limit(1);
  if (existingError) throw existingError;
  const existing = existingArray?.[0] ?? null;

  if (existing) {
    return jsonResponse({
      message: "Certificate already generated for this version.",
      certificate: {
        completionId: existing.completion_id,
        verificationCode: existing.verification_code,
        verificationUrl: existing.verification_url,
        issuedAt: existing.issued_at,
        expiresAt: existing.expires_at
      }
    });
  }

  const verificationCode = `VERIFY-${userId.slice(0, 8)}-${uuidV4().slice(0, 6)}`;
  const completionId = `COMP-${userId.slice(0, 8).toUpperCase()}-${uuidV4().slice(0, 6).toUpperCase()}`;
  const verificationUrl = `${APP_URL}/certificate/verify/${verificationCode}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const { error: insertError } = await supabase
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
  await supabase.from("induction_progress").update({
    current_step: 6,
    completion_percentage: 100,
    completed: true,
    completed_step_ids: Array.from(completed).sort((a, b) => a - b),
    completed_at: issuedAt,
    updated_at: issuedAt
  }).eq("user_id", userId);

  await supabase.from("drivers").update({ status: "Completed" }).eq("user_id", userId);
  await logAuditEntry(userId, "certificate_generated", { completionId, verificationCode, issuedAt });

  // Dispatch completion email to driver (non-blocking)
  const { data: driverProfile } = await supabase.from("profiles").select("email, full_name").eq("id", userId).single();
  if (driverProfile?.email) {
    const expiry = expiresAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Congratulations, ${driverProfile.full_name ?? "Driver"}!</h2>
      <p>You have successfully completed the <strong>${ORGANIZATION_NAME}</strong> Driver Induction Program.</p>
      <p>Your certificate is valid for <strong>12 months</strong> and expires on <strong>${expiry}</strong>.</p>
      <p><a href="${verificationUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">View Certificate</a></p>
    </div>`;
    void sendEmailViaResend(driverProfile.email, `Induction Complete — Certificate Issued by ${ORGANIZATION_NAME}`, html);
  }

  return jsonResponse({
    message: "Certificate generated.",
    certificate: {
      completionId,
      verificationCode,
      verificationUrl,
      issuedAt,
      expiresAt: expiresAt.toISOString()
    }
  });
}

async function handleVerifyCertificate(code: string, request: Request): Promise<Response> {
  const supabase = getSupabaseAdmin();

  // Accept either the verification code (VERIFY-…) or the completion id
  // (COMP-…) that is printed as the "Verification ID" on the certificate.
  if (!code || !/^[A-Za-z0-9-]+$/.test(code)) {
    if (request.headers.get("accept")?.includes("text/html")) {
      return htmlResponse(renderVerificationErrorPage(ORGANIZATION_NAME, ORGANIZATION_LOGO_URL), 404);
    }
    return errorResponse("Invalid verification code.", 400);
  }

  const { data: certificate, error: certificateError } = await supabase
    .from("certificates")
    .select("*")
    .or(`verification_code.eq.${code},completion_id.eq.${code}`)
    .maybeSingle();
  if (certificateError || !certificate) {
    if (request.headers.get("accept")?.includes("text/html")) {
      return htmlResponse(renderVerificationErrorPage(ORGANIZATION_NAME, ORGANIZATION_LOGO_URL), 404);
    }
    return errorResponse("Certificate not found.", 404);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, licence_class, issuing_state, depot_location")
    .eq("id", certificate.user_id)
    .single();
  if (profileError) throw profileError;

  const payload = {
    verified: true,
    organizationName: ORGANIZATION_NAME,
    certificate: {
      completionId: certificate.completion_id,
      verificationCode: certificate.verification_code,
      verificationUrl: `${APP_URL}/certificate/verify/${certificate.verification_code}`,
      issuedAt: certificate.issued_at,
      expiresAt: certificate.expires_at
    },
    driver: {
      fullName: profile.full_name ?? ""
    },
    licenceClass: profile.licence_class ?? null,
    issuingState: profile.issuing_state ?? null,
    depotLocation: profile.depot_location ?? null
  };

  if (request.headers.get("accept")?.includes("text/html")) {
    return htmlResponse(
      renderVerificationPage(
        {
          organizationName: ORGANIZATION_NAME,
          certificate: {
            completionId: certificate.completion_id,
            verificationCode: certificate.verification_code,
            verificationUrl: `${APP_URL}/certificate/verify/${certificate.verification_code}`,
            issuedAt: certificate.issued_at
          },
          driver: { fullName: profile.full_name ?? "" }
        },
        ORGANIZATION_LOGO_URL
      ),
      200
    );
  }

  return jsonResponse(payload);
}

async function handleVerifyVehiclePass(passCode: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  if (!passCode || !/^[A-Za-z0-9-]+$/.test(passCode)) {
    return errorResponse("Invalid pass code.", 400);
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from("driver_vehicles")
    .select("*, profiles:user_id (full_name, email)")
    .eq("qr_pass_code", passCode)
    .maybeSingle();
  if (vehicleError) throw vehicleError;
  if (!vehicle) {
    return errorResponse("Vehicle pass not found.", 404);
  }

  return jsonResponse({
    verified: true,
    organizationName: ORGANIZATION_NAME,
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
}

async function handleVerifyDriver(driverId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  if (!driverId || !/^[A-Za-z0-9-]+$/.test(driverId)) {
    return errorResponse("Invalid driver ID.", 400);
  }

  const driverSelect = "*, profiles:user_id (full_name, phone, licence_class)";

  // The QR badge encodes the driver's user id; fall back to the drivers table id
  let { data: driver, error } = await supabase
    .from("drivers")
    .select(driverSelect)
    .eq("user_id", driverId)
    .maybeSingle();
  if (error) throw error;
  if (!driver) {
    const byDriverId = await supabase
      .from("drivers")
      .select(driverSelect)
      .eq("id", driverId)
      .maybeSingle();
    if (byDriverId.error) throw byDriverId.error;
    driver = byDriverId.data;
  }
  if (!driver) {
    return errorResponse("Driver not found.", 404);
  }

  // Induction progress and certificates link via profiles.user_id,
  // so query them separately (no direct FK from drivers)
  const { data: induction } = await supabase
    .from("induction_progress")
    .select("completed_at, current_step")
    .eq("user_id", driver.user_id)
    .maybeSingle();
  const { data: certificate } = await supabase
    .from("certificates")
    .select("expires_at, issued_at")
    .eq("user_id", driver.user_id)
    .maybeSingle();

  const profile = driver.profiles ?? {};
  const completed = driver.status === "Completed" || induction?.completed_at != null;

  return jsonResponse({
    verified: true,
    organizationName: ORGANIZATION_NAME,
    driver: {
      driverId: driver.id,
      fullName: profile.full_name ?? "",
      phone: profile.phone ?? "",
      licenceClass: profile.licence_class ?? "",
      inductionStatus: driver.status ?? "Not Started",
      inductionCompleted: Boolean(completed),
      completedAt: induction?.completed_at ?? null,
      certificateExpiresAt: certificate?.expires_at ?? null
    }
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
  });
}

async function handleGetInductionVersions(): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("induction_versions")
    .select("id, version_label, revision_notes, published_by, published_at, is_current, created_at")
    .order("published_at", { ascending: false });
  if (error) throw error;
  return jsonResponse({ versions: data ?? [] });
}

async function handleCreateInductionVersion(request: Request, adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({
    versionLabel: z.string().min(1).max(32),
    revisionNotes: z.string().min(1).max(2000)
  });
  const { versionLabel, revisionNotes } = schema.parse(await request.json());

  // Atomically publish new version via RPC
  const { data: newVersionId, error: rpcError } = await supabase.rpc("publish_induction_version", {
    label: versionLabel,
    notes: revisionNotes,
    publisher: adminId
  });
  if (rpcError || !newVersionId) throw rpcError ?? new Error("Failed to publish induction version.");

  const { data: newVersion, error: fetchError } = await supabase
    .from("induction_versions")
    .select("id, version_label, revision_notes, published_at")
    .eq("id", newVersionId)
    .single();
  if (fetchError || !newVersion) throw fetchError ?? new Error("Failed to fetch newly created version.");

  await logAuditEntry(adminId, "admin_induction_version_published", {
    newVersionId: newVersion.id,
    versionLabel,
    revisionNotes
  });

  return jsonResponse(
    {
      message: `Induction version ${versionLabel} published. Drivers will be prompted to re-complete induction on next login.`,
      version: newVersion
    },
    201
  );
}

async function handleCreateDriver(request: Request, adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const schema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    phone: z.string().min(5),
    address: z.string().min(5),
    preferredLanguage: z.string().min(2)
  });
  const payload = schema.parse(await request.json());

  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { role: "driver" }
  });
  if (createError || !createdUser.user) throw createError ?? new Error("Account creation failed");

  const userId = createdUser.user.id;
  const now = new Date().toISOString();

  const [profileRes, driverRes, progressRes] = await Promise.allSettled([
    supabase.from("profiles").insert({
      id: userId, role: "driver", email: payload.email, full_name: payload.fullName,
      phone: payload.phone, address: payload.address, preferred_language: payload.preferredLanguage,
      created_at: now, updated_at: now
    }),
    supabase.from("drivers").insert({ user_id: userId, status: "Not Started", created_at: now }),
    supabase.from("induction_progress").insert({
      user_id: userId, current_step: 1, completion_percentage: 0, completed: false,
      completed_step_ids: [], updated_at: now
    })
  ]);

  const insertErrors: string[] = [];
  for (const res of [profileRes, driverRes, progressRes]) {
    if (res.status === "rejected") {
      insertErrors.push(res.reason?.message ?? "unknown error");
    } else if (res.value && typeof res.value === "object" && "error" in res.value) {
      const err = (res.value as { error?: { message?: string } }).error;
      if (err) insertErrors.push(err.message ?? "unknown");
    }
  }

  if (insertErrors.length > 0) {
    await supabase.auth.admin.deleteUser(userId).catch((e: any) =>
      console.error("[ROLLBACK] Failed to delete orphaned auth user:", e.message)
    );
    throw new Error(`Driver creation failed — DB inserts failed: ${insertErrors.join("; ")}`);
  }

  const { data: sections } = await supabase.from("learning_sections").select("id");
  if (sections?.length) {
    await supabase.from("learning_section_completions").insert(
      sections.map(s => ({ user_id: userId, section_id: s.id, completed: false }))
    );
  }

  await logAuditEntry(adminId, "admin_driver_created", { driverId: userId, email: payload.email });

  return jsonResponse({ message: "Driver account created.", userId }, 201);
}

async function handleUpdateDriver(request: Request, adminId: string, driverId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  const updateSchema = z.object({
    email: z.string().email().optional(),
    fullName: z.string().min(2).optional(),
    phone: z.string().min(5).optional(),
    address: z.string().min(3).optional(),
    preferredLanguage: z.string().min(2).optional()
  });
  const payload = updateSchema.parse(await request.json());

  if (payload.email) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(driverId, { email: payload.email });
    if (authErr) throw new Error(`Auth update failed: ${authErr.message}`);
  }

  const { error: profileErr } = await supabase.from("profiles").update({
    ...(payload.email && { email: payload.email }),
    ...(payload.fullName && { full_name: payload.fullName }),
    ...(payload.phone && { phone: payload.phone }),
    ...(payload.address && { address: payload.address }),
    ...(payload.preferredLanguage && { preferred_language: payload.preferredLanguage }),
    updated_at: new Date().toISOString()
  }).eq("id", driverId);
  if (profileErr) throw new Error(`Profile update failed: ${profileErr.message}`);

  await logAuditEntry(adminId, "admin_driver_updated", { driverId, email: payload.email });
  return jsonResponse({ message: "Driver updated" });
}

async function handleResetPassword(request: Request, adminId: string, driverId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const { password } = await request.json() as { password: string };
  await supabase.auth.admin.updateUserById(driverId, { password });
  await logAuditEntry(adminId, "admin_password_reset", { driverId });
  return jsonResponse({ message: "Password reset" });
}

async function handleResetInduction(_request: Request, adminId: string, driverId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Clear documents from storage
  const { data: docs } = await supabase.from("documents").select("file_url").eq("user_id", driverId);
  if (docs?.length) {
    await supabase.storage.from("driver-documents").remove(docs.map(d => d.file_url));
  }

  await Promise.all([
    supabase.from("documents").delete().eq("user_id", driverId),
    supabase.from("quiz_attempts").delete().eq("user_id", driverId),
    supabase.from("certificates").delete().eq("user_id", driverId),
    supabase.from("induction_progress").delete().eq("user_id", driverId)
  ]);

  await supabase.from("induction_progress").insert({
    user_id: driverId, current_step: 1, completion_percentage: 0, completed: false,
    completed_step_ids: [], updated_at: now
  });

  await logAuditEntry(adminId, "admin_induction_reset", { driverId });
  return jsonResponse({ message: "Induction reset complete" });
}

async function handleDeleteDriver(_request: Request, adminId: string, driverId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  const { data: docs } = await supabase.from("documents").select("file_url").eq("user_id", driverId);
  if (docs?.length) {
    await supabase.storage.from("driver-documents").remove(docs.map(d => d.file_url));
  }

  await Promise.all([
    supabase.from("documents").delete().eq("user_id", driverId),
    supabase.from("induction_progress").delete().eq("user_id", driverId),
    supabase.from("drivers").delete().eq("user_id", driverId),
    supabase.from("profiles").delete().eq("id", driverId),
    supabase.auth.admin.deleteUser(driverId)
  ]);

  await logAuditEntry(adminId, "admin_driver_deleted", { driverId });
  return jsonResponse({ message: "Driver deleted" });
}

async function handleExportReports(url: URL, adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const scope = url.searchParams.get("scope") || "drivers";
  const format = url.searchParams.get("format") || "csv";

  let data: any[] = [];
  if (scope === "drivers") {
    const { data: profiles } = await supabase.from("profiles").select("id,email,full_name").eq("role", "driver");
    data = profiles || [];
  } else {
    const { data: logs } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false });
    data = logs || [];
  }

  await logAuditEntry(adminId, "admin_report_exported", { scope, format });

  const headers = Object.keys(data[0] || {});

  if (format === "pdf") {
    const htmlReport = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${ORGANIZATION_NAME} ${scope.toUpperCase()} Report</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; color: #1e293b; }
    h1 { color: #0f172a; margin-bottom: 4px; }
    p.meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #f1f5f9; text-align: left; padding: 10px; font-size: 12px; border-bottom: 2px solid #cbd5e1; }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${ORGANIZATION_NAME} — ${scope.toUpperCase()} Report</h1>
  <p class="meta">Generated: ${new Date().toLocaleString()} | Total Records: ${data.length}</p>
  <table>
    <thead>
      <tr>${headers.map(h => `<th>${h.toUpperCase()}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${data.map(row => `<tr>${headers.map(h => `<td>${String(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}
    </tbody>
  </table>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    return new Response(htmlReport, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename=report-${scope}.html`
      }
    });
  }

  const csv = [
    headers.join(","),
    ...data.map(row => headers.map(h => JSON.stringify(row[h] || "")).join(","))
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=report-${scope}.csv`
    }
  });
}

async function handleGetVerificationQueue(adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("documents")
    .select(`
      id,
      user_id,
      type,
      file_name,
      mime_type,
      status,
      verified_by_admin,
      uploaded_at,
      expires_at,
      profiles!inner(full_name, email)
    `)
    .eq("status", "pending")
    .order("uploaded_at", { ascending: true });

  if (error) throw error;

  return jsonResponse({ documents: data ?? [] });
}

async function handleSubmitDocument(request: Request, driverId: string): Promise<Response> {
  const schema = z.object({
    type: z.string().min(1),
    fileUrl: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative()
  });
  const payload = schema.parse(await request.json());
  if (!payload.fileUrl.startsWith(`${driverId}/`)) {
    return errorResponse("You can only submit documents stored in your own folder.", 403);
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", driverId)
    .eq("type", payload.type)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    await logAuditEntry(driverId, "document_replaced_history", {
      documentId: existing.id,
      type: existing.type,
      fileUrl: existing.file_url,
      fileName: existing.file_name,
      mimeType: existing.mime_type,
      sizeBytes: existing.size_bytes,
      status: existing.status,
      uploadedAt: existing.uploaded_at,
      expiresAt: existing.expires_at,
      verifiedAt: existing.verified_at,
      verifiedByUserId: existing.verified_by_user_id,
      rejectionReason: existing.rejection_reason
    });
  }

  const documentData = {
    file_url: payload.fileUrl,
    file_name: payload.fileName,
    mime_type: payload.mimeType,
    size_bytes: payload.sizeBytes,
    status: "pending",
    uploaded_at: new Date().toISOString(),
    verified_by_admin: false,
    verified_at: null,
    verified_by_user_id: null,
    rejection_reason: null,
    expires_at: null
  };

  const { data: saved, error: saveError } = existing
    ? await supabase
        .from("documents")
        .update(documentData)
        .eq("id", existing.id)
        .eq("user_id", driverId)
        .select("id, status")
        .maybeSingle()
    : await supabase
        .from("documents")
        .insert({ ...documentData, user_id: driverId, type: payload.type })
        .select("id, status")
        .single();
  if (saveError) throw saveError;
  if (!saved || saved.status !== "pending") {
    throw new Error("The document could not be saved as pending.");
  }

  return jsonResponse({ documentId: saved.id, status: saved.status });
}

async function handleVerifyDocument(request: Request, adminId: string, docId: string): Promise<Response> {
  const supabase = getSupabaseAdmin();
  const { action, reason, expiresAt, workRightsCheck, workRightsMethod } = z.object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(3).optional(),
    expiresAt: z.string().datetime().optional(),
    workRightsCheck: z.boolean().optional(),
    workRightsMethod: z.enum(["manual", "vevo"]).optional()
  }).parse(await request.json());
  if (action === "reject" && !reason) return errorResponse("A rejection reason is required.", 400);

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("user_id, type, expires_at, uploaded_at")
    .eq("id", docId)
    .single();
  if (docError || !doc) return errorResponse("Document not found.", 404);
  if (action === "approve" && doc.type === "right_to_work" && (!workRightsCheck || !workRightsMethod)) {
    return errorResponse("Record a manual or VEVO work-rights check before approving this document.", 400);
  }

  const driverId = doc.user_id;
  const reviewUpdate = buildDocumentReviewUpdate({
    action,
    reason,
    expiresAt,
    existingExpiry: doc.expires_at,
    documentType: doc.type,
    adminId
  });
  const { error: updateError } = await supabase
    .from("documents")
    .update({
      ...reviewUpdate,
      ...(doc.type === "right_to_work" ? {
        work_rights_check_status: action === "approve" && workRightsCheck ? "verified" : "not_verified",
        work_rights_check_method: action === "approve" && workRightsCheck ? workRightsMethod : null,
        work_rights_checked_at: action === "approve" && workRightsCheck ? new Date().toISOString() : null,
        work_rights_checked_by: action === "approve" && workRightsCheck ? adminId : null
      } : {})
    })
    .eq("id", docId);
  if (updateError) throw updateError;

  if (action === "approve") {
    const { data: driverDocs, error: driverDocsError } = await supabase
      .from("documents")
      .select("type, status, expires_at, uploaded_at")
      .eq("user_id", driverId);
    if (driverDocsError) throw driverDocsError;

    const { data: profile, error: profileError } = await supabase.from("profiles").select("staff_role").eq("id", driverId).maybeSingle();
    if (profileError) throw profileError;
    const requiredTypes = getRequiredDocumentTypesForRole(profile?.staff_role ?? "driver");
    const allApproved = requiredTypes.every((type) =>
      (driverDocs ?? []).some((d: any) => d.type === type && d.status === "approved" && (!REQUIRED_EXPIRY_DOCUMENTS.includes(type) || isCurrentOnboardingDate(d.expires_at)))
    );

    if (allApproved) {
      const { data: progress } = await supabase
        .from("induction_progress")
        .select("completed_step_ids, current_step")
        .eq("user_id", driverId)
        .single();

      const completedSteps: number[] = progress?.completed_step_ids ?? [];
      if (!completedSteps.includes(1)) completedSteps.push(1);

      const { error: progressErr } = await supabase.from("induction_progress").update({
        current_step: Math.max(progress?.current_step ?? 1, 2),
        completed_step_ids: completedSteps.sort((a, b) => a - b),
        updated_at: new Date().toISOString()
      }).eq("user_id", driverId);
      if (progressErr) throw new Error(`Failed to advance driver progress: ${progressErr.message}`);

      const { error: statusErr } = await supabase.from("drivers").update({ status: "In Progress" }).eq("user_id", driverId);
      if (statusErr) throw new Error(`Failed to update driver status: ${statusErr.message}`);
    }
  }

  await logAuditEntry(adminId, `admin_document_${action}d`, {
    docId,
    driverId,
    documentType: doc.type
  });

  if (action === "approve") {
    try {
      const { data: worker, error: workerError } = await supabase.from("profiles")
        .select("email, full_name")
        .eq("id", driverId)
        .maybeSingle();
      if (workerError) throw workerError;
      if (worker?.email) {
        await enqueueNotifications(supabase, [{
          userId: driverId,
          email: worker.email,
          eventType: "document_approved",
          organizationName: ORGANIZATION_NAME,
          appUrl: APP_URL,
          recipientName: worker.full_name ?? "Worker",
          context: { documentType: String(doc.type).replace(/_/g, " ") },
          dedupeKey: `document-approved:${docId}:${doc.uploaded_at ?? "submitted"}`
        }]);
        await dispatchNotificationOutbox(supabase, sendOutboxEmailViaResend);
      }
    } catch (notificationError) {
      console.error("[NOTIFICATIONS] Document was approved, but the worker confirmation could not be queued or sent:", notificationError);
    }
  }

  return jsonResponse({
    message: `Document ${action === "approve" ? "approved" : "rejected"} successfully.`
  });
}

async function handleNotify(request: Request, adminId: string): Promise<Response> {
  const notifySchema = z.object({
    eventType: z.string().min(1),
    userEmail: z.string().email(),
    driverId: z.string().uuid().optional(),
    driverName: z.string().optional(),
    context: z.record(z.string(), z.string()).optional()
  });
  const body = notifySchema.parse(await request.json());

  const { eventType, userEmail, driverName, context } = body;
  console.log(`[NOTIFICATION] ${eventType} for ${userEmail}`);

  if (eventType === "document_expiring" || eventType === "induction_expiring") {
    if (!body.driverId) return errorResponse("A worker account is required for expiry reminders.", 400);
    const supabase = getSupabaseAdmin();
    const { data: worker, error } = await supabase.from("profiles")
      .select("id, email, full_name")
      .eq("id", body.driverId)
      .eq("role", "driver")
      .maybeSingle();
    if (error) throw error;
    if (!worker?.email || worker.email.toLowerCase() !== userEmail.toLowerCase()) {
      return errorResponse("Worker email address could not be verified.", 404);
    }
    const notificationContext = context ?? {};
    const expiryDate = notificationContext.expiryDate ?? "";
    const documentType = notificationContext.documentType ?? "induction certificate";
    const today = new Date().toISOString().slice(0, 10);
    const queued = await enqueueNotifications(supabase, [{
      userId: worker.id,
      email: worker.email,
      eventType,
      organizationName: ORGANIZATION_NAME,
      appUrl: APP_URL,
      recipientName: worker.full_name ?? driverName ?? "Worker",
      context: { documentType, expiryDate },
      dedupeKey: `manual-expiry:${worker.id}:${documentType}:${expiryDate}:${today}`
    }]);
    const delivery = queued ? await dispatchNotificationOutbox(supabase, sendOutboxEmailViaResend) : null;
    return jsonResponse({
      message: queued ? "Expiry reminder queued." : "Expiry reminder already queued or sent.",
      duplicate: queued === 0,
      delivery
    });
  }

  if (eventType === "induction_completed" && context?.expiresAt && context?.certificateUrl) {
    const expiry = new Date(context.expiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Congratulations, ${driverName ?? "Driver"}!</h2>
      <p>You have successfully completed the <strong>${ORGANIZATION_NAME}</strong> Driver Induction Program.</p>
      <p>Your certificate is valid for <strong>12 months</strong> and expires on <strong>${expiry}</strong>.</p>
      <p><a href="${context.certificateUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">View Certificate</a></p>
    </div>`;
    await sendEmailViaResend(userEmail, `Induction Complete — Certificate Issued by ${ORGANIZATION_NAME}`, html);
  } else {
    const html = `<p>Hello ${driverName || "Driver"},</p><p>Event: <strong>${eventType}</strong></p><p>${JSON.stringify(context ?? {})}</p>`;
    await sendEmailViaResend(userEmail, `${ORGANIZATION_NAME} Notification: ${eventType}`, html);
  }

  return jsonResponse({ message: "Notification dispatched" });
}

// --- Main entry point (Vercel Web Standard function) ---

async function handleContractorDocumentUpload(request: Request, companyId: string, adminUpload: boolean, actorId: string): Promise<Response> {
  const body = z.object({ kind: z.enum(adminUpload ? ["public_liability", "workers_comp", "contractor_agreement", "nhvas"] : ["public_liability", "workers_comp", "nhvas"]), fileName: z.string().trim().min(1).max(160), contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]), base64: z.string().min(1).max(1_700_000) }).parse(await request.json());
  const supabase = getSupabaseAdmin();
  const kind = body.kind;
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `companies/${companyId}/${kind}_${Date.now()}_${safeName}`;
  const { error: uploadError } = await supabase.storage.from("contractor-documents").upload(path, base64ToBytes(body.base64), { contentType: body.contentType, upsert: false });
  if (uploadError) throw uploadError;
  const prefix = kind === "contractor_agreement" ? "agreement" : kind;
  const column = `${prefix}_file_path`;
  const { data: company, error: readError } = await supabase.from("contractor_companies").select("status").eq("id", companyId).maybeSingle();
  if (readError || !company) { await supabase.storage.from("contractor-documents").remove([path]); if (readError) throw readError; return errorResponse("Contractor company not found.", 404); }
  const { error } = await supabase.from("contractor_companies").update({ [column]: path, [`${prefix}_status`]: "pending", [`${prefix}_rejection_reason`]: null, [`${prefix}_reviewed_by`]: null, [`${prefix}_reviewed_at`]: null, ...(company.status === "Compliant" ? { status: "Pending Review" } : {}), updated_at: new Date().toISOString() }).eq("id", companyId);
  if (error) { await supabase.storage.from("contractor-documents").remove([path]); throw error; }
  await logAuditEntry(actorId, "contractor_compliance_document_uploaded", { companyId, kind, fileName: safeName });
  return jsonResponse({ path }, 201);
}

async function handleContractorInsuranceReview(request: Request, companyId: string, adminId: string): Promise<Response> {
  const { kind, action, reason } = z.object({ kind: z.enum(["public_liability", "workers_comp", "contractor_agreement", "nhvas"]), action: z.enum(["approve", "reject"]), reason: z.string().trim().optional() }).parse(await request.json());
  if (action === "reject" && !reason) return errorResponse("A rejection reason is required.");
  const supabase = getSupabaseAdmin();
  const { data: company, error: readError } = await supabase.from("contractor_companies").select("*").eq("id", companyId).maybeSingle();
  if (readError) throw readError;
  if (!company) return errorResponse("Contractor company not found.", 404);
  const prefix = kind === "contractor_agreement" ? "agreement" : kind;
  const expiry = kind === "nhvas" ? company.nhvas_expiry : company[`${prefix}_expiry`];
  if (action === "approve" && (!company[`${prefix}_file_path`] || !isCurrentOnboardingDate(expiry))) return errorResponse("Upload the document and record a current expiry date before approval.");
  const nextStatuses = { public_liability: kind === "public_liability" ? action === "approve" ? "approved" : "rejected" : company.public_liability_status, workers_comp: kind === "workers_comp" ? action === "approve" ? "approved" : "rejected" : company.workers_comp_status, agreement: kind === "contractor_agreement" ? action === "approve" ? "approved" : "rejected" : company.agreement_status, nhvas: kind === "nhvas" ? action === "approve" ? "approved" : "rejected" : company.nhvas_status };
  const current = (file: string, date: string, status: string) => Boolean(file && isCurrentOnboardingDate(date) && status === "approved");
  const { data: finance, error: financeError } = await supabase.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", companyId).maybeSingle();
  if (financeError) throw financeError;
  const financeComplete = Boolean(finance && String(finance.bank_account_name ?? "").trim() && /^\d{6}$/.test(String(finance.bank_bsb ?? "")) && /^\d{5,10}$/.test(String(finance.bank_account_number ?? "")) && finance.gst_registered !== null && finance.gst_registered !== undefined && (!finance.gst_registered || finance.gst_effective_date) && finance.business_details_confirmed_at && finance.tax_declaration_at && finance.insurance_declaration_at && finance.vehicle_declaration_at);
  const allCurrent = current(company.public_liability_file_path, company.public_liability_expiry, nextStatuses.public_liability) && current(company.workers_comp_file_path, company.workers_comp_expiry, nextStatuses.workers_comp) && current(company.agreement_file_path, company.agreement_expiry, nextStatuses.agreement) && (company.nhvas_accreditation === "None" || current(company.nhvas_file_path, company.nhvas_expiry, nextStatuses.nhvas)) && financeComplete;
  const reviewedAt = new Date().toISOString();
  const nextCompanyStatus = getNextContractorCompanyStatus(company.status, allCurrent);
  const { error } = await supabase.from("contractor_companies").update({ [`${prefix}_status`]: action === "approve" ? "approved" : "rejected", [`${prefix}_rejection_reason`]: action === "reject" ? reason : null, [`${prefix}_reviewed_by`]: adminId, [`${prefix}_reviewed_at`]: reviewedAt, status: nextCompanyStatus, updated_at: reviewedAt }).eq("id", companyId);
  if (error) throw error;
  await logAuditEntry(adminId, "admin_contractor_document_reviewed", { companyId, kind, action, reason: reason ?? null, reviewedAt });
  return jsonResponse({ message: action === "approve" ? "Contractor document approved." : "Contractor document rejected." });
}

async function handleContractorVehicleUpload(request: Request, userId: string, vehicleId: string): Promise<Response> {
  const body = z.object({ kind: z.enum(["rego", "insurance", "inspection"]), fileName: z.string().trim().min(1).max(160), contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]), base64: z.string().min(1).max(1_700_000), expiryDate: z.string().trim().optional() }).parse(await request.json());
  const supabase = getSupabaseAdmin();
  const { data: vehicle, error: readError } = await supabase.from("driver_vehicles").select("id").eq("id", vehicleId).eq("user_id", userId).maybeSingle();
  if (readError) throw readError;
  if (!vehicle) return errorResponse("Vehicle not found for this account.", 404);
  if (body.kind !== "rego" && !isCurrentOnboardingDate(body.expiryDate)) return errorResponse("Enter a current expiry date for this vehicle document.");
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `vehicles/${vehicleId}/${body.kind}_${Date.now()}_${safeName}`;
  const { error: uploadError } = await supabase.storage.from("contractor-documents").upload(path, base64ToBytes(body.base64), { contentType: body.contentType, upsert: false });
  if (uploadError) throw uploadError;
  const prefix = body.kind === "rego" ? "rego_document" : `${body.kind}_document`;
  const expiryColumn = body.kind === "rego" ? "rego_expiry_date" : `${prefix}_expiry`;
  const { error } = await supabase.from("driver_vehicles").update({ [`${prefix}_path`]: path, [`${prefix}_status`]: "pending", [`${prefix}_rejection_reason`]: null, [`${prefix}_reviewed_by`]: null, [`${prefix}_reviewed_at`]: null, ...(body.kind === "rego" ? {} : { [expiryColumn]: body.expiryDate }), updated_at: new Date().toISOString() }).eq("id", vehicleId).eq("user_id", userId);
  if (error) throw error;
  await logAuditEntry(userId, "contractor_vehicle_document_uploaded", { vehicleId, kind: body.kind });
  return jsonResponse({ path }, 201);
}

async function handleContractorVehicleReview(request: Request, vehicleId: string, adminId: string): Promise<Response> {
  const { kind, action, reason } = z.object({ kind: z.enum(["rego", "insurance", "inspection"]), action: z.enum(["approve", "reject"]), reason: z.string().trim().optional() }).parse(await request.json());
  if (action === "reject" && !reason) return errorResponse("A rejection reason is required.");
  const supabase = getSupabaseAdmin();
  const prefix = kind === "rego" ? "rego_document" : `${kind}_document`;
  const expiryColumn = kind === "rego" ? "rego_expiry_date" : `${prefix}_expiry`;
  const { data: vehicle, error: readError } = await supabase.from("driver_vehicles").select(`id, ${prefix}_path, ${expiryColumn}`).eq("id", vehicleId).maybeSingle();
  if (readError) throw readError;
  if (!vehicle) return errorResponse("Vehicle not found.", 404);
  if (action === "approve" && (!vehicle[`${prefix}_path`] || !isCurrentOnboardingDate(vehicle[expiryColumn]))) return errorResponse("Upload the document and record a current expiry date before approval.");
  const reviewedAt = new Date().toISOString();
  const { error } = await supabase.from("driver_vehicles").update({ [`${prefix}_status`]: action === "approve" ? "approved" : "rejected", [`${prefix}_rejection_reason`]: action === "reject" ? reason : null, [`${prefix}_reviewed_by`]: adminId, [`${prefix}_reviewed_at`]: reviewedAt, updated_at: reviewedAt }).eq("id", vehicleId);
  if (error) throw error;
  await logAuditEntry(adminId, "contractor_vehicle_document_reviewed", { vehicleId, kind, action, reason: reason ?? null, reviewedAt });
  return jsonResponse({ message: action === "approve" ? "Vehicle document approved." : "Vehicle document rejected." });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const configError = requireConfig();
  if (configError) return configError;

  const url = new URL(request.url);
  const rawPath = url.pathname.replace(/^\/+/, ""); // e.g. "api/induction/step"
  const cleanPath = rawPath.replace(/^api\//, "").replace(/\/+$/, "");
  const method = request.method;

  try {
    // Health Check
    if ((cleanPath === "health" || rawPath === "health") && method === "GET") {
      return await handleHealth();
    }

    // Branding — public read
    if (cleanPath === "branding" && method === "GET") {
      return await handleGetBranding();
    }

    // Branding — admin update
    if (cleanPath === "branding" && method === "PUT") {
      const admin = await requireAdmin(request);
      if ("response" in admin) return admin.response;
      return await handleUpdateBranding(request, admin.adminId);
    }

    // --- Public Registration Route ---
    if (cleanPath === "auth/register-driver" && method === "POST") {
      if (!ALLOW_SELF_REGISTRATION) {
        return errorResponse("Self-registration is disabled. Ask your administrator to create your induction account.", 403);
      }
      return await handleSelfRegisterDriver(request);
    }

    // --- Change Password (any authenticated user) ---
    if (cleanPath === "auth/change-password" && method === "POST") {
      if (!rateLimitCheck(`changepw:${clientIp(request)}`, 10, 60_000)) {
        return errorResponse("Too many requests. Please slow down and try again shortly.", 429);
      }
      return await handleChangePassword(request);
    }

    // --- Admin Routes ---
    if (cleanPath.startsWith("admin/")) {
      const admin = await requireAdmin(request);
      if ("response" in admin) return admin.response;
      const adminId = admin.adminId;

      if (["admin/organisational-chart", "admin/organisational-chart/employees", "admin/organisational-chart/pdf"].includes(cleanPath)) {
        const action = cleanPath.split("organisational-chart")[1].replace(/^\//, "");
        if (!((action === "" && ["GET", "PUT"].includes(method)) || (action === "employees" && method === "GET") || (action === "pdf" && method === "POST"))) return errorResponse("Method not allowed.", 405);
        try {
          const result = await handleOrganisationalChart(getSupabaseAdmin(), adminId, method, action, method === "GET" ? undefined : await request.json());
          if (Buffer.isBuffer(result)) return new Response(new Uint8Array(result), { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="organisational-chart.pdf"' } });
          if (method === "PUT") await logAuditEntry(adminId, "organisational_chart_saved", {});
          return jsonResponse(result);
        } catch (error) {
          if (error instanceof z.ZodError) return errorResponse(error.issues.map((issue) => issue.message).join(" "), 400);
          throw error;
        }
      }

      const lessonAnswersMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/lesson-answers$/);
      if (lessonAnswersMatch && method === "GET") {
        const driverId = decodeURIComponent(lessonAnswersMatch[1]);
        const supabase = getSupabaseAdmin();
        const [{ data: profile, error: profileError }, { data: sections, error: sectionsError }] = await Promise.all([
          supabase.from("profiles").select("learning_question_responses").eq("id", driverId).maybeSingle(),
          supabase.from("learning_sections").select("id, title, media_json")
        ]);
        if (profileError) throw profileError;
        if (sectionsError) throw sectionsError;
        if (!profile) return errorResponse("Driver profile not found.", 404);
        const savedResponses = profile.learning_question_responses && typeof profile.learning_question_responses === "object"
          ? profile.learning_question_responses as Record<string, Record<string, unknown>>
          : {};
        const responses = (sections ?? []).flatMap((section: any) => {
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
        return jsonResponse({ responses });
      }

      if (cleanPath === "admin/contractors/companies" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.from("contractor_companies").select("*").order("company_name");
        if (error) throw error;
        return jsonResponse({ companies: data ?? [] });
      }
      const contractorCompanyMatch = cleanPath.match(/^admin\/contractors\/companies\/([^/]+)$/);
      if ((cleanPath === "admin/contractors/companies" && method === "POST") || (contractorCompanyMatch && method === "PUT")) {
        const body: any = await request.json();
        const payload = z.object({ companyName: z.string().trim().min(2), tradingName: z.string().trim().optional(), abn: z.string().trim().min(1), acn: z.string().trim().optional(), contactPerson: z.string().trim().optional(), email: z.string().trim().email().or(z.literal("")).optional(), phone: z.string().trim().optional(), address: z.string().trim().optional(), publicLiabilityPolicy: z.string().trim().optional(), publicLiabilityExpiry: z.string().trim().optional(), workersCompPolicy: z.string().trim().optional(), workersCompExpiry: z.string().trim().optional(), agreementExpiry: z.string().trim().optional(), nhvasAccreditation: z.enum(["Basic Fatigue", "Mass Management", "Maintenance Management", "None"]).optional(), nhvasNumber: z.string().trim().optional(), nhvasExpiry: z.string().trim().optional(), primaryDepot: z.string().trim().optional(), status: z.enum(["Pending Review", "Compliant", "Suspended", "Inactive"]).optional() }).parse(body);
        if (!validateABN(payload.abn).isValid || !validateACN(payload.acn ?? "").isValid) return errorResponse("Enter a valid ABN and, when supplied, a valid 9 digit ACN.");
        const data = { company_name: payload.companyName, trading_name: payload.tradingName ?? "", abn: payload.abn.replace(/\D/g, ""), acn: (payload.acn ?? "").replace(/\D/g, ""), contact_person: payload.contactPerson ?? "", email: payload.email ?? "", phone: payload.phone ?? "", address: payload.address ?? "", public_liability_policy: payload.publicLiabilityPolicy ?? "", public_liability_expiry: payload.publicLiabilityExpiry || null, workers_comp_policy: payload.workersCompPolicy ?? "", workers_comp_expiry: payload.workersCompExpiry || null, agreement_expiry: payload.agreementExpiry || null, nhvas_accreditation: payload.nhvasAccreditation ?? "None", nhvas_number: payload.nhvasNumber ?? "", nhvas_expiry: payload.nhvasExpiry || null, primary_depot: payload.primaryDepot ?? "", updated_at: new Date().toISOString() };
        const supabase = getSupabaseAdmin();
        if (contractorCompanyMatch) {
          const { data: updated, error } = await supabase.from("contractor_companies").update({ ...data, public_liability_status: "pending", public_liability_rejection_reason: null, public_liability_reviewed_by: null, public_liability_reviewed_at: null, workers_comp_status: "pending", workers_comp_rejection_reason: null, workers_comp_reviewed_by: null, workers_comp_reviewed_at: null, agreement_status: "pending", agreement_rejection_reason: null, agreement_reviewed_by: null, agreement_reviewed_at: null, nhvas_status: payload.nhvasAccreditation === "None" ? "missing" : "pending", nhvas_rejection_reason: null, nhvas_reviewed_by: null, nhvas_reviewed_at: null, status: payload.status === "Suspended" || payload.status === "Inactive" ? payload.status : "Pending Review" }).eq("id", contractorCompanyMatch[1]).select("*").single();
          if (error) throw error;
          return jsonResponse({ company: updated });
        }
        const { data: existingCompanies, error: existingError } = await supabase.from("contractor_companies").select("id, abn");
        if (existingError) throw existingError;
        const matching = (existingCompanies ?? []).filter((company: any) => String(company.abn ?? "").replace(/\D/g, "") === data.abn);
        if (matching.length > 1) return errorResponse("Multiple company records already use this ABN. Review the existing records before saving.", 409);
        if (matching.length === 1) {
          const { data: updated, error } = await supabase.from("contractor_companies").update({ ...data, public_liability_status: "pending", public_liability_rejection_reason: null, public_liability_reviewed_by: null, public_liability_reviewed_at: null, workers_comp_status: "pending", workers_comp_rejection_reason: null, workers_comp_reviewed_by: null, workers_comp_reviewed_at: null, agreement_status: "pending", agreement_rejection_reason: null, agreement_reviewed_by: null, agreement_reviewed_at: null, nhvas_status: payload.nhvasAccreditation === "None" ? "missing" : "pending", nhvas_rejection_reason: null, nhvas_reviewed_by: null, nhvas_reviewed_at: null, status: "Pending Review" }).eq("id", matching[0].id).select("*").single();
          if (error) throw error;
          return jsonResponse({ company: updated });
        }
        const { data: created, error } = await supabase.from("contractor_companies").insert({ ...data, created_by: adminId, status: "Pending Review" }).select("*").single();
        if (error) throw error;
        return jsonResponse({ company: created }, 201);
      }
      const companyFinanceMatch = cleanPath.match(/^admin\/contractors\/companies\/([^/]+)\/business-details$/);
      if (companyFinanceMatch && (method === "GET" || method === "PUT")) {
        const supabase = getSupabaseAdmin();
        if (method === "PUT") {
          const body = z.object({ bankAccountName: z.string().trim().min(2).max(120), bankBsb: z.string().trim().regex(/^\d{3}-?\d{3}$/), bankAccountNumber: z.string().trim().regex(/^\d{5,10}$/), gstRegistered: z.boolean(), gstEffectiveDate: z.string().trim().optional().nullable() }).parse(await request.json());
          if (body.gstRegistered && !body.gstEffectiveDate) return errorResponse("Enter the GST registration effective date or select not registered.");
          const now = new Date().toISOString();
          const { error } = await supabase.from("contractor_financial_details").upsert({ company_id: companyFinanceMatch[1], bank_account_name: body.bankAccountName, bank_bsb: body.bankBsb.replace(/\D/g, ""), bank_account_number: body.bankAccountNumber, gst_registered: body.gstRegistered, gst_effective_date: body.gstRegistered ? body.gstEffectiveDate : null, updated_at: now }, { onConflict: "company_id" });
          if (error) throw error;
          await logAuditEntry(adminId, "admin_contractor_business_details_updated", { companyId: companyFinanceMatch[1] });
          return jsonResponse({ message: "Contractor business details saved." });
        }
        const { data, error } = await supabase.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", companyFinanceMatch[1]).maybeSingle();
        if (error) throw error;
        return jsonResponse({ details: data ?? null });
      }
      const workClearanceMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/work-clearance$/);
      if (workClearanceMatch && method === "PUT") {
        const { approved } = z.object({ approved: z.boolean() }).parse(await request.json());
        const driverId = decodeURIComponent(workClearanceMatch[1]);
        const supabase = getSupabaseAdmin();
        const { data: driver, error: driverError } = await supabase.from("drivers").select("user_id, work_clearance_status").eq("user_id", driverId).maybeSingle();
        if (driverError) throw driverError;
        if (!driver) return errorResponse("Driver record not found.", 404);
        let blockers: string[] = [];
        if (approved) blockers = await getCurrentWorkClearanceBlockers(supabase, driverId);
        if (blockers.length) return jsonResponse({ message: "Work clearance is blocked until all onboarding requirements are complete.", blockers }, 409);
        const now = new Date().toISOString();
        const { error } = await supabase.from("drivers").update({ work_clearance_status: approved ? "Approved to Commence Work" : "Not Approved", work_clearance_approved_at: approved ? now : null, work_clearance_approved_by: approved ? adminId : null, updated_at: now }).eq("user_id", driverId);
        if (error) throw error;
        await logAuditEntry(adminId, approved ? "admin_work_clearance_approved" : "admin_work_clearance_revoked", { driverId, previousStatus: driver.work_clearance_status ?? "Not Approved" });
        return jsonResponse({ message: approved ? "Approved to Commence Work." : "Work clearance revoked.", blockers: [] });
      }
      const companyDocMatch = cleanPath.match(/^admin\/contractors\/companies\/([^/]+)\/documents$/);
      if (companyDocMatch && method === "POST") return await handleContractorDocumentUpload(request, companyDocMatch[1], true, adminId);
      const insuranceReviewMatch = cleanPath.match(/^admin\/contractors\/companies\/([^/]+)\/insurance-review$/);
      if (insuranceReviewMatch && method === "POST") return await handleContractorInsuranceReview(request, insuranceReviewMatch[1], adminId);
      const vehicleReviewMatch = cleanPath.match(/^admin\/contractors\/vehicles\/([^/]+)\/documents\/review$/);
      if (vehicleReviewMatch && method === "POST") return await handleContractorVehicleReview(request, vehicleReviewMatch[1], adminId);
      if (cleanPath === "admin/contractors/link-driver" && method === "POST") {
        const body = z.object({ driverId: z.string().uuid(), companyId: z.string().uuid() }).parse(await request.json());
        const supabase = getSupabaseAdmin();
        const [{ data: company }, { data: profile }] = await Promise.all([supabase.from("contractor_companies").select("id").eq("id", body.companyId).maybeSingle(), supabase.from("profiles").select("id").eq("id", body.driverId).maybeSingle()]);
        if (!company || !profile) return errorResponse("The driver or contractor company could not be found.", 404);
        const { error: linkError } = await supabase.from("contractor_profiles").upsert({ user_id: body.driverId, company_id: body.companyId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (linkError) throw linkError;
        const { error } = await supabase.from("profiles").update({ employment_type: "contractor" }).eq("id", body.driverId);
        if (error) throw error;
        return jsonResponse({ message: "Contractor driver linked." });
      }

      // Induction Versions
      if (cleanPath === "admin/induction-versions" && method === "GET") {
        return await handleGetInductionVersions();
      }
      if (cleanPath === "admin/induction-versions" && method === "POST") {
        return await handleCreateInductionVersion(request, adminId);
      }

      // Create Driver
      if (cleanPath === "admin/drivers" && method === "POST") {
        return await handleCreateDriver(request, adminId);
      }

      const driverMatch = cleanPath.match(/^admin\/drivers\/([^/]+)$/);
      if (driverMatch && method === "PUT") {
        return await handleUpdateDriver(request, adminId, driverMatch[1]);
      }

      const pwResetMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/reset-password$/);
      if (pwResetMatch && method === "POST") {
        return await handleResetPassword(request, adminId, pwResetMatch[1]);
      }

      const inductionResetMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/reset-induction$/);
      if (inductionResetMatch && method === "POST") {
        return await handleResetInduction(request, adminId, inductionResetMatch[1]);
      }

      if (driverMatch && method === "DELETE") {
        return await handleDeleteDriver(request, adminId, driverMatch[1]);
      }

      // Export Reports
      if (cleanPath === "admin/reports/export" && method === "GET") {
        return await handleExportReports(url, adminId);
      }

      // Policy signature reports are queried with the service role so admin
      // reporting is consistent with the existing Policies Admin view.
      if (cleanPath === "admin/policies/signature-counts" && method === "GET") {
        const supabase = getSupabaseAdmin();
        let { data: rows, error } = await supabase.from("policy_signatures").select("policy_version_id").limit(10000);
        if (error?.code === "42703") {
          const fallback = await supabase.from("policy_signatures").select("policy_id").limit(10000);
          rows = (fallback.data ?? []).map((row: any) => ({ policy_version_id: row.policy_id }));
          error = fallback.error;
        }
        if (error) throw error;
        const counts: Record<string, number> = {};
        for (const row of rows ?? []) {
          const id = String((row as any).policy_version_id ?? "");
          if (id) counts[id] = (counts[id] ?? 0) + 1;
        }
        return jsonResponse({ counts });
      }
      const signatureReportMatch = cleanPath.match(/^admin\/policies\/([^/]+)\/signatures$/);
      if (signatureReportMatch && method === "GET") {
        const supabase = getSupabaseAdmin();
        const versionId = decodeURIComponent(signatureReportMatch[1]);
        const { data: version, error: versionError } = await supabase.from("policy_versions")
          .select("id, policy_id, version_label").eq("id", versionId).maybeSingle();
        if (versionError) throw versionError;
        if (!version) return errorResponse("Published policy version not found.", 404);
        const { data: policy, error: policyError } = await supabase.from("policies")
          .select("id, title, name, audience, target_role").eq("id", version.policy_id).maybeSingle();
        if (policyError) throw policyError;
        if (!policy) return errorResponse("Policy not found.", 404);
        const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
          supabase.from("profiles").select("id, full_name, email, employment_type, staff_role, role, depot_location").limit(10000),
          supabase.from("contractor_profiles").select("user_id").limit(10000)
        ]);
        if (profilesError) throw profilesError;
        if (membershipsError) throw membershipsError;
        let { data: signatures, error: signatureError } = await supabase.from("policy_signatures")
          .select("user_id, policy_version_id, signature_text, signed_at").eq("policy_version_id", versionId).limit(10000);
        if (signatureError?.code === "42703") {
          const fallback = await supabase.from("policy_signatures").select("driver_id, policy_id, signature_text, signed_at").eq("policy_id", versionId).limit(10000);
          signatures = (fallback.data ?? []).map((row: any) => ({ ...row, user_id: row.driver_id }));
          signatureError = fallback.error;
        }
        if (signatureError) throw signatureError;
        const contractorIds = new Set((memberships ?? []).map((row: any) => String(row.user_id)));
        const eligible = (profiles ?? []).filter((person: any) => {
          if (person.role === "admin") return false;
          const engagement = person.employment_type === "contractor" || contractorIds.has(String(person.id)) ? "contractor" : "employee";
          return (!policy.audience || policy.audience === "all" || policy.audience === engagement) &&
            (!policy.target_role || policy.target_role === "all" || policy.target_role === (person.staff_role || "driver"));
        });
        const eligibleIds = new Set(eligible.map((person: any) => String(person.id)));
        const signed = (signatures ?? []).filter((row: any) => eligibleIds.has(String(row.user_id ?? row.driver_id))).map((row: any) => {
          const person: any = eligible.find((item: any) => String(item.id) === String(row.user_id ?? row.driver_id));
          return { policyId: versionId, policyTitle: policy.title ?? policy.name, policyVersion: version.version_label ?? "", signedCount: 0, pendingCount: 0, totalDrivers: eligible.length, driverId: String(person.id), driverName: person.full_name ?? "Driver", driverEmail: person.email ?? "", signatureText: row.signature_text ?? "", signedAt: row.signed_at ?? "" };
        });
        const signedIds = new Set(signed.map((row: any) => row.driverId));
        const pending = eligible.filter((person: any) => !signedIds.has(String(person.id))).map((person: any) => ({ id: String(person.id), driverId: String(person.id), fullName: person.full_name ?? "Driver", driverName: person.full_name ?? "Driver", email: person.email ?? "", driverEmail: person.email ?? "", depotLocation: person.depot_location ?? "" }));
        return jsonResponse({ signed, pending, versionLabel: version.version_label ?? "" });
      }

      // Verification Queue — GET all pending documents
      if (cleanPath === "admin/verification-queue" && method === "GET") {
        return await handleGetVerificationQueue(adminId);
      }

      // Approve / Reject a document
      const docVerifyMatch = cleanPath.match(/^admin\/documents\/([^/]+)\/verify$/);
      if (docVerifyMatch && method === "POST") {
        return await handleVerifyDocument(request, adminId, docVerifyMatch[1]);
      }
      const documentActionMatch = cleanPath.match(/^admin\/documents\/([^/]+)\/(approve|reject)$/);
      if (documentActionMatch && method === "POST") {
        const payload = documentActionMatch[2] === "approve" ? {} : await request.json().catch(() => ({}));
        const reviewRequest = new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, action: documentActionMatch[2] })
        });
        return await handleVerifyDocument(reviewRequest, adminId, documentActionMatch[1]);
      }
      if (cleanPath === "admin/fatigue-awareness/questions" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("fatigue_awareness_questions")
          .select("*")
          .eq("assessment_id", "fatigue_awareness")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw error;
        return jsonResponse({ questions: data ?? [] });
      }
      if (cleanPath === "admin/fatigue-awareness/questions" && method === "POST") {
        const supabase = getSupabaseAdmin();
        const body = z.object({
          id: z.string().uuid().optional(),
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Fatigue Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { count, error: countError } = await supabase
          .from("fatigue_awareness_questions")
          .select("id", { count: "exact", head: true })
          .eq("assessment_id", "fatigue_awareness");
        if (countError) throw countError;
        if ((count ?? 0) >= 10) {
          return errorResponse("A maximum of 10 fatigue awareness questions is allowed.", 400);
        }
        const id = body.id ?? uuidV4();
        const now = new Date().toISOString();
        const row = {
          id,
          assessment_id: "fatigue_awareness",
          question: body.question,
          options: body.options,
          correct_answer: body.correct_answer,
          explanation: body.explanation ?? "",
          category: body.category ?? "Fatigue Awareness",
          sort_order: body.sort_order ?? 0,
          updated_at: now
        };
        const { error } = await supabase.from("fatigue_awareness_questions").insert(row);
        if (error) throw error;
        await logAuditEntry(adminId, "fatigue_awareness_question_created", { questionId: id });
        return jsonResponse({ question: { ...row, created_at: now } }, 201);
      }

      const fatigueQuestionMatch = cleanPath.match(/^admin\/fatigue-awareness\/questions\/([^/]+)$/);
      if (fatigueQuestionMatch && method === "PUT") {
        const questionId = decodeURIComponent(fatigueQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const body = z.object({
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Fatigue Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { error } = await supabase
          .from("fatigue_awareness_questions")
          .update({
            question: body.question,
            options: body.options,
            correct_answer: body.correct_answer,
            explanation: body.explanation ?? "",
            category: body.category ?? "Fatigue Awareness",
            sort_order: body.sort_order ?? 0,
            updated_at: new Date().toISOString()
          })
          .eq("id", questionId)
          .eq("assessment_id", "fatigue_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "fatigue_awareness_question_updated", { questionId });
        return jsonResponse({ question: { id: questionId, assessment_id: "fatigue_awareness", ...body } });
      }
      if (fatigueQuestionMatch && method === "DELETE") {
        const questionId = decodeURIComponent(fatigueQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("fatigue_awareness_questions")
          .delete()
          .eq("id", questionId)
          .eq("assessment_id", "fatigue_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "fatigue_awareness_question_deleted", { questionId });
        return jsonResponse({ message: "Question deleted." });
      }
      if (cleanPath === "admin/fatigue-awareness/results" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data: rows, error } = await supabase
          .from("fatigue_awareness_results")
          .select("id, user_id, score, total_questions, passed, completed_at, answers")
          .eq("assessment_id", "fatigue_awareness")
          .order("completed_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(10000);
        if (error) throw error;
          const { data: currentQuestions, error: questionsError } = await supabase
            .from("fatigue_awareness_questions")
            .select("id, question, options, correct_answer")
            .eq("assessment_id", "fatigue_awareness")
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });
          if (questionsError) throw questionsError;
          const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
        const { data: profiles, error: profilesError } = userIds.length
          ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
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
        return jsonResponse({ results });
      }

      if (cleanPath === "admin/speed-awareness/questions" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("speed_awareness_questions")
          .select("*")
          .eq("assessment_id", "speed_awareness")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw error;
        return jsonResponse({ questions: data ?? [] });
      }
      if (cleanPath === "admin/speed-awareness/questions" && method === "POST") {
        const supabase = getSupabaseAdmin();
        const body = z.object({
          id: z.string().uuid().optional(),
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Speed Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { count, error: countError } = await supabase
          .from("speed_awareness_questions")
          .select("id", { count: "exact", head: true })
          .eq("assessment_id", "speed_awareness");
        if (countError) throw countError;
        if ((count ?? 0) >= 10) {
          return errorResponse("A maximum of 10 speed awareness questions is allowed.", 400);
        }
        const id = body.id ?? uuidV4();
        const now = new Date().toISOString();
        const row = {
          id,
          assessment_id: "speed_awareness",
          question: body.question,
          options: body.options,
          correct_answer: body.correct_answer,
          explanation: body.explanation ?? "",
          category: body.category ?? "Speed Awareness",
          sort_order: body.sort_order ?? 0,
          updated_at: now
        };
        const { error } = await supabase.from("speed_awareness_questions").insert(row);
        if (error) throw error;
        await logAuditEntry(adminId, "speed_awareness_question_created", { questionId: id });
        return jsonResponse({ question: { ...row, created_at: now } }, 201);
      }

      const speedQuestionMatch = cleanPath.match(/^admin\/speed-awareness\/questions\/([^/]+)$/);
      if (speedQuestionMatch && method === "PUT") {
        const questionId = decodeURIComponent(speedQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const body = z.object({
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Speed Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { error } = await supabase
          .from("speed_awareness_questions")
          .update({
            question: body.question,
            options: body.options,
            correct_answer: body.correct_answer,
            explanation: body.explanation ?? "",
            category: body.category ?? "Speed Awareness",
            sort_order: body.sort_order ?? 0,
            updated_at: new Date().toISOString()
          })
          .eq("id", questionId)
          .eq("assessment_id", "speed_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "speed_awareness_question_updated", { questionId });
        return jsonResponse(
          { question: { id: questionId, assessment_id: "speed_awareness", ...body } }
        );
      }
      if (speedQuestionMatch && method === "DELETE") {
        const questionId = decodeURIComponent(speedQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("speed_awareness_questions")
          .delete()
          .eq("id", questionId)
          .eq("assessment_id", "speed_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "speed_awareness_question_deleted", { questionId });
        return jsonResponse({ message: "Question deleted." });
      }
      if (cleanPath === "admin/speed-awareness/results" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data: rows, error } = await supabase
          .from("speed_awareness_results")
          .select("id, user_id, score, total_questions, passed, completed_at, answers")
          .eq("assessment_id", "speed_awareness")
          .order("completed_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(10000);
        if (error) throw error;
        const { data: currentQuestions, error: questionsError } = await supabase
          .from("speed_awareness_questions")
          .select("id, question, options, correct_answer")
          .eq("assessment_id", "speed_awareness")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (questionsError) throw questionsError;
        const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
        const { data: profiles, error: profilesError } = userIds.length
          ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
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
          answers: Array.isArray(r.answers)
            ? r.answers
            : buildSpeedAnswerReview(currentQuestions ?? [], r.answers ?? {})
        }));
        return jsonResponse({ results });
      }

    }

    // --- Secure Driver Routes ---

    if (cleanPath === "driver/learning-question-response" && method === "PUT") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`learning-answer:${driver.userId}`, 120, 60_000)) {
        return errorResponse("Too many answer saves. Please wait a moment and try again.", 429);
      }
      const payload = z.object({
        sectionId: z.string().trim().min(1).max(100),
        questionId: z.string().trim().min(1).max(100),
        response: z.string().max(2000)
      }).parse(await request.json());
      const supabase = getSupabaseAdmin();
      const { data: section, error: sectionError } = await supabase
        .from("learning_sections")
        .select("media_json")
        .eq("id", payload.sectionId)
        .maybeSingle();
      if (sectionError) throw sectionError;
      if (!section) return errorResponse("The lesson could not be found.", 404);
      const questions = Array.isArray(section.media_json?.questions) ? section.media_json.questions : [];
      const question = questions.find((item: any) =>
        String(item?.id ?? "") === payload.questionId &&
        (item?.questionType ?? item?.question_type) === "text_input"
      );
      if (!question) return errorResponse("This lesson does not contain that text-input question.");
      const { error } = await supabase.rpc("save_learning_question_response", {
        p_user_id: driver.userId,
        p_section_id: payload.sectionId,
        p_question_id: payload.questionId,
        p_response: payload.response
      });
      if (error) throw error;
      return jsonResponse({ message: "Answer saved." });
    }

    if ((cleanPath === "contractor/business-details" && (method === "GET" || method === "PUT")) || cleanPath === "contractor/company/documents" && method === "POST" || /^driver\/vehicles\/[^/]+\/documents$/.test(cleanPath) && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data: membership, error: membershipError } = await supabase.from("contractor_profiles").select("company_id").eq("user_id", driver.userId).maybeSingle();
      if (membershipError) throw membershipError;
      if (cleanPath === "contractor/business-details") {
        if (!membership?.company_id) return errorResponse("Link your contractor company before entering business details.", 404);
        if (method === "GET") {
          const { data, error } = await supabase.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", membership.company_id).maybeSingle();
          if (error) throw error;
          return jsonResponse({ details: data ?? null });
        }
        const body = z.object({ bankAccountName: z.string().trim().min(2).max(120), bankBsb: z.string().trim().regex(/^\d{3}-?\d{3}$/), bankAccountNumber: z.string().trim().regex(/^\d{5,10}$/), gstRegistered: z.boolean(), gstEffectiveDate: z.string().trim().optional().nullable(), declarations: z.object({ business: z.literal(true), tax: z.literal(true), insurance: z.literal(true), vehicle: z.literal(true) }) }).parse(await request.json());
        if (body.gstRegistered && !body.gstEffectiveDate) return errorResponse("Enter the GST registration effective date or select not registered.");
        const now = new Date().toISOString();
        const { error } = await supabase.from("contractor_financial_details").upsert({ company_id: membership.company_id, bank_account_name: body.bankAccountName, bank_bsb: body.bankBsb.replace(/\D/g, ""), bank_account_number: body.bankAccountNumber, gst_registered: body.gstRegistered, gst_effective_date: body.gstRegistered ? body.gstEffectiveDate : null, business_details_confirmed_at: now, business_details_confirmed_by: driver.userId, tax_declaration_at: now, tax_declaration_by: driver.userId, insurance_declaration_at: now, insurance_declaration_by: driver.userId, vehicle_declaration_at: now, vehicle_declaration_by: driver.userId, updated_at: now }, { onConflict: "company_id" });
        if (error) throw error;
        await supabase.from("contractor_companies").update({ status: "Pending Review", updated_at: now }).eq("id", membership.company_id).eq("status", "Compliant");
        await logAuditEntry(driver.userId, "contractor_business_details_confirmed", { companyId: membership.company_id });
        return jsonResponse({ message: "Business details and declarations saved." });
      }
      const vehicleUploadMatch = cleanPath.match(/^driver\/vehicles\/([^/]+)\/documents$/);
      if (vehicleUploadMatch) return await handleContractorVehicleUpload(request, driver.userId, decodeURIComponent(vehicleUploadMatch[1]));
      if (!membership?.company_id) return errorResponse("Link your contractor company before uploading compliance evidence.", 404);
      return await handleContractorDocumentUpload(request, membership.company_id, false, driver.userId);
    }

    if (cleanPath === "driver/documents" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleSubmitDocument(request, driver.userId);
    }

    // Quiz Questions
    if (cleanPath === "induction/quiz-questions" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleGetQuizQuestions(driver.userId);
    }

    // Start Video Section
    if (cleanPath === "induction/section/start" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleStartSection(driver.userId, request);
    }

    // Save Step Progress
    if (cleanPath === "induction/step" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleSaveStep(driver.userId, request);
    }

    // Submit Quiz
    if (cleanPath === "induction/quiz" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`quiz:${clientIp(request)}`, 10, 60_000)) {
        return errorResponse("Too many requests. Please slow down and try again shortly.", 429);
      }
      return await handleSubmitQuiz(driver.userId, request);
    }

    if (cleanPath === "admin/distraction-awareness/questions" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("distraction_awareness_questions")
          .select("*")
          .eq("assessment_id", "distraction_awareness")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw error;
        return jsonResponse({ questions: data ?? [] });
      }
      if (cleanPath === "admin/distraction-awareness/questions" && method === "POST") {
        const supabase = getSupabaseAdmin();
        const body = z.object({
          id: z.string().uuid().optional(),
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Distraction Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { count, error: countError } = await supabase
          .from("distraction_awareness_questions")
          .select("id", { count: "exact", head: true })
          .eq("assessment_id", "distraction_awareness");
        if (countError) throw countError;
        if ((count ?? 0) >= 10) {
          return errorResponse("A maximum of 10 distraction awareness questions is allowed.", 400);
        }
        const id = body.id ?? uuidV4();
        const now = new Date().toISOString();
        const row = {
          id,
          assessment_id: "distraction_awareness",
          question: body.question,
          options: body.options,
          correct_answer: body.correct_answer,
          explanation: body.explanation ?? "",
          category: body.category ?? "Distraction Awareness",
          sort_order: body.sort_order ?? 0,
          updated_at: now
        };
        const { error } = await supabase.from("distraction_awareness_questions").insert(row);
        if (error) throw error;
        await logAuditEntry(adminId, "distraction_awareness_question_created", { questionId: id });
        return jsonResponse({ question: { ...row, created_at: now } }, 201);
      }

      const distractionQuestionMatch = cleanPath.match(/^admin\/distraction-awareness\/questions\/([^/]+)$/);
      if (distractionQuestionMatch && method === "PUT") {
        const questionId = decodeURIComponent(distractionQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const body = z.object({
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(6),
          correct_answer: z.number().int().min(0),
          explanation: z.string().optional().default(""),
          category: z.string().optional().default("Distraction Awareness"),
          sort_order: z.coerce.number().optional()
        }).parse(await request.json().catch(() => ({})));
        if (body.correct_answer >= body.options.length) {
          return errorResponse("Select a correct answer from the available options.", 400);
        }
        const { error } = await supabase
          .from("distraction_awareness_questions")
          .update({
            question: body.question,
            options: body.options,
            correct_answer: body.correct_answer,
            explanation: body.explanation ?? "",
            category: body.category ?? "Distraction Awareness",
            sort_order: body.sort_order ?? 0,
            updated_at: new Date().toISOString()
          })
          .eq("id", questionId)
          .eq("assessment_id", "distraction_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "distraction_awareness_question_updated", { questionId });
        return jsonResponse(
          { question: { id: questionId, assessment_id: "distraction_awareness", ...body } }
        );
      }
      if (distractionQuestionMatch && method === "DELETE") {
        const questionId = decodeURIComponent(distractionQuestionMatch[1]);
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("distraction_awareness_questions")
          .delete()
          .eq("id", questionId)
          .eq("assessment_id", "distraction_awareness");
        if (error) throw error;
        await logAuditEntry(adminId, "distraction_awareness_question_deleted", { questionId });
        return jsonResponse({ message: "Question deleted." });
      }
      if (cleanPath === "admin/distraction-awareness/results" && method === "GET") {
        const supabase = getSupabaseAdmin();
        const { data: rows, error } = await supabase
          .from("distraction_awareness_results")
          .select("id, user_id, score, total_questions, passed, completed_at, answers")
          .eq("assessment_id", "distraction_awareness")
          .order("completed_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(10000);
        if (error) throw error;
        const { data: currentQuestions, error: questionsError } = await supabase
          .from("distraction_awareness_questions")
          .select("id, question, options, correct_answer")
          .eq("assessment_id", "distraction_awareness")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (questionsError) throw questionsError;
        const userIds = Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id))));
        const { data: profiles, error: profilesError } = userIds.length
          ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
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
        return jsonResponse({ results });
      }

    }

    // --- Secure Driver Routes ---

    if (cleanPath === "driver/learning-question-response" && method === "PUT") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`learning-answer:${driver.userId}`, 120, 60_000)) {
        return errorResponse("Too many answer saves. Please wait a moment and try again.", 429);
      }
      const payload = z.object({
        sectionId: z.string().trim().min(1).max(100),
        questionId: z.string().trim().min(1).max(100),
        response: z.string().max(2000)
      }).parse(await request.json());
      const supabase = getSupabaseAdmin();
      const { data: section, error: sectionError } = await supabase
        .from("learning_sections")
        .select("media_json")
        .eq("id", payload.sectionId)
        .maybeSingle();
      if (sectionError) throw sectionError;
      if (!section) return errorResponse("The lesson could not be found.", 404);
      const questions = Array.isArray(section.media_json?.questions) ? section.media_json.questions : [];
      const question = questions.find((item: any) =>
        String(item?.id ?? "") === payload.questionId &&
        (item?.questionType ?? item?.question_type) === "text_input"
      );
      if (!question) return errorResponse("This lesson does not contain that text-input question.");
      const { error } = await supabase.rpc("save_learning_question_response", {
        p_user_id: driver.userId,
        p_section_id: payload.sectionId,
        p_question_id: payload.questionId,
        p_response: payload.response
      });
      if (error) throw error;
      return jsonResponse({ message: "Answer saved." });
    }

    if ((cleanPath === "contractor/business-details" && (method === "GET" || method === "PUT")) || cleanPath === "contractor/company/documents" && method === "POST" || /^driver\/vehicles\/[^/]+\/documents$/.test(cleanPath) && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data: membership, error: membershipError } = await supabase.from("contractor_profiles").select("company_id").eq("user_id", driver.userId).maybeSingle();
      if (membershipError) throw membershipError;
      if (cleanPath === "contractor/business-details") {
        if (!membership?.company_id) return errorResponse("Link your contractor company before entering business details.", 404);
        if (method === "GET") {
          const { data, error } = await supabase.from("contractor_financial_details").select("bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").eq("company_id", membership.company_id).maybeSingle();
          if (error) throw error;
          return jsonResponse({ details: data ?? null });
        }
        const body = z.object({ bankAccountName: z.string().trim().min(2).max(120), bankBsb: z.string().trim().regex(/^\d{3}-?\d{3}$/), bankAccountNumber: z.string().trim().regex(/^\d{5,10}$/), gstRegistered: z.boolean(), gstEffectiveDate: z.string().trim().optional().nullable(), declarations: z.object({ business: z.literal(true), tax: z.literal(true), insurance: z.literal(true), vehicle: z.literal(true) }) }).parse(await request.json());
        if (body.gstRegistered && !body.gstEffectiveDate) return errorResponse("Enter the GST registration effective date or select not registered.");
        const now = new Date().toISOString();
        const { error } = await supabase.from("contractor_financial_details").upsert({ company_id: membership.company_id, bank_account_name: body.bankAccountName, bank_bsb: body.bankBsb.replace(/\D/g, ""), bank_account_number: body.bankAccountNumber, gst_registered: body.gstRegistered, gst_effective_date: body.gstRegistered ? body.gstEffectiveDate : null, business_details_confirmed_at: now, business_details_confirmed_by: driver.userId, tax_declaration_at: now, tax_declaration_by: driver.userId, insurance_declaration_at: now, insurance_declaration_by: driver.userId, vehicle_declaration_at: now, vehicle_declaration_by: driver.userId, updated_at: now }, { onConflict: "company_id" });
        if (error) throw error;
        await supabase.from("contractor_companies").update({ status: "Pending Review", updated_at: now }).eq("id", membership.company_id).eq("status", "Compliant");
        await logAuditEntry(driver.userId, "contractor_business_details_confirmed", { companyId: membership.company_id });
        return jsonResponse({ message: "Business details and declarations saved." });
      }
      const vehicleUploadMatch = cleanPath.match(/^driver\/vehicles\/([^/]+)\/documents$/);
      if (vehicleUploadMatch) return await handleContractorVehicleUpload(request, driver.userId, decodeURIComponent(vehicleUploadMatch[1]));
      if (!membership?.company_id) return errorResponse("Link your contractor company before uploading compliance evidence.", 404);
      return await handleContractorDocumentUpload(request, membership.company_id, false, driver.userId);
    }

    if (cleanPath === "driver/documents" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleSubmitDocument(request, driver.userId);
    }

    // Quiz Questions
    if (cleanPath === "induction/quiz-questions" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleGetQuizQuestions(driver.userId);
    }

    // Start Video Section
    if (cleanPath === "induction/section/start" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleStartSection(driver.userId, request);
    }

    // Save Step Progress
    if (cleanPath === "induction/step" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleSaveStep(driver.userId, request);
    }

    // Submit Quiz
    if (cleanPath === "induction/quiz" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`quiz:${clientIp(request)}`, 10, 60_000)) {
        return errorResponse("Too many requests. Please slow down and try again shortly.", 429);
      }
      return await handleSubmitQuiz(driver.userId, request);
    }

    // Speed Awareness Assessment (driver) — distinct from induction quiz
    if (cleanPath === "speed-awareness/questions" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("speed_awareness_questions")
        .select("id, question, options, correct_answer, sort_order, category")
        .eq("assessment_id", "speed_awareness")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      try {
        validateSpeedQuestions(data ?? []);
      } catch (validationError) {
        if (validationError instanceof SpeedAssessmentError && validationError.kind === "configuration") {
          return errorResponse(validationError.message, 503);
        }
        throw validationError;
      }
      return jsonResponse((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
    }
    if (cleanPath === "speed-awareness/results" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("speed_awareness_results")
        .select("id, score, total_questions, passed, completed_at, answers")
        .eq("user_id", driver.userId)
        .eq("assessment_id", "speed_awareness")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return jsonResponse(addSpeedAttemptNumbers(data ?? []));
    }
    if (cleanPath === "speed-awareness/submit" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`speed-awareness:${driver.userId}`, 10, 60_000)) {
        return errorResponse("Too many assessment submissions. Please wait a moment and try again.", 429);
      }
      const supabase = getSupabaseAdmin();
      const bodyResult = z.object({
        answers: z.record(z.string(), z.number().int().min(0).max(5))
      }).strict().safeParse(await request.json().catch(() => ({})));
      if (!bodyResult.success) return errorResponse("Submit one valid answer for each assessment question.", 400);
      const { data: questions, error } = await supabase
        .from("speed_awareness_questions")
        .select("*")
        .eq("assessment_id", "speed_awareness")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      let grade: ReturnType<typeof gradeSpeedAssessment>;
      try {
        grade = gradeSpeedAssessment(questions ?? [], bodyResult.data.answers);
      } catch (validationError) {
        if (validationError instanceof SpeedAssessmentError) {
          return errorResponse(
            validationError.message,
            validationError.kind === "configuration" ? 503 : 400
          );
        }
        throw validationError;
      }
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("speed_awareness_results").insert({
        user_id: driver.userId,
        assessment_id: "speed_awareness",
        score: grade.score,
        total_questions: grade.total_questions,
        passed: grade.passed,
        answers: buildSpeedAnswerReview(questions ?? [], bodyResult.data.answers),
        completed_at: now
      });
      if (insertError) throw insertError;
      await logAuditEntry(driver.userId, "speed_awareness_submitted", {
        score: grade.score,
        passed: grade.passed,
        total: grade.total_questions
      });
      return jsonResponse({ ...grade, completed_at: now }, 201);
    }

// Distraction Awareness Assessment (driver) — distinct from induction quiz
    if (cleanPath === "distraction-awareness/questions" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
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
          return errorResponse(validationError.message, 503);
        }
        throw validationError;
      }
      return jsonResponse((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
    }
    if (cleanPath === "distraction-awareness/submit" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`distraction-awareness:${driver.userId}`, 10, 60_000)) {
        return errorResponse("Too many assessment submissions. Please wait a moment and try again.", 429);
      }
      const supabase = getSupabaseAdmin();
      const bodyResult = z.object({
        answers: z.record(z.string(), z.number().int().min(0).max(5))
      }).strict().safeParse(await request.json().catch(() => ({})));
      if (!bodyResult.success) return errorResponse("Submit one valid answer for each assessment question.", 400);
      const { data: questions, error } = await supabase
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
          return errorResponse(
            validationError.message,
            validationError.kind === "configuration" ? 503 : 400
          );
        }
        throw validationError;
      }
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("distraction_awareness_results").insert({
        user_id: driver.userId,
        assessment_id: "distraction_awareness",
        score: grade.score,
        total_questions: grade.total_questions,
        passed: grade.passed,
        answers: buildDistractionAnswerReview(questions ?? [], bodyResult.data.answers),
        completed_at: now
      });
      if (insertError) throw insertError;
      await logAuditEntry(driver.userId, "distraction_awareness_submitted", {
        score: grade.score,
        passed: grade.passed,
        total: grade.total_questions
      });
      return jsonResponse({ ...grade, completed_at: now }, 201);
    }

    // Fatigue Awareness Assessment (driver) — distinct from induction quiz
    if (cleanPath === "fatigue-awareness/questions" && method === "GET") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
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
          return errorResponse(validationError.message, 503);
        }
        throw validationError;
      }
      return jsonResponse((data ?? []).map(({ correct_answer: _correctAnswer, ...question }: any) => question));
    }
    if (cleanPath === "fatigue-awareness/submit" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      if (!rateLimitCheck(`fatigue-awareness:${driver.userId}`, 10, 60_000)) {
        return errorResponse("Too many assessment submissions. Please wait a moment and try again.", 429);
      }
      const supabase = getSupabaseAdmin();
      const bodyResult = z.object({
        answers: z.record(z.string(), z.number().int().min(0).max(5))
      }).strict().safeParse(await request.json().catch(() => ({})));
      if (!bodyResult.success) return errorResponse("Submit one valid answer for each assessment question.", 400);
      const { data: questions, error } = await supabase
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
          return errorResponse(
            validationError.message,
            validationError.kind === "configuration" ? 503 : 400
          );
        }
        throw validationError;
      }
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("fatigue_awareness_results").insert({
        user_id: driver.userId,
        assessment_id: "fatigue_awareness",
        score: grade.score,
        total_questions: grade.total_questions,
        passed: grade.passed,
        answers: buildFatigueAnswerReview(questions ?? [], bodyResult.data.answers),
        completed_at: now
      });
      if (insertError) throw insertError;
      await logAuditEntry(driver.userId, "fatigue_awareness_submitted", {
        score: grade.score,
        passed: grade.passed,
        total: grade.total_questions
      });
      return jsonResponse({ ...grade, completed_at: now }, 201);
    }

    // Issue Certificate
    if (cleanPath === "induction/certificate" && method === "POST") {
      const driver = await requireDriver(request);
      if ("response" in driver) return driver.response;
      return await handleIssueCertificate(driver.userId);
    }

    // --- Public Routes ---

    // Verify Certificate
    const verifyMatch = cleanPath.match(/^certificate\/verify\/([^/]+)$/);
    if (verifyMatch && method === "GET") {
      return await handleVerifyCertificate(verifyMatch[1], request);
    }

    // Verify Driver ID
    const driverVerifyMatch = cleanPath.match(/^driver\/verify\/([^/]+)$/);
    if (driverVerifyMatch && method === "GET") {
      return await handleVerifyDriver(driverVerifyMatch[1]);
    }

    // Verify Vehicle Pass
    const vehicleVerifyMatch = cleanPath.match(/^vehicle\/verify\/([^/]+)$/);
    if (vehicleVerifyMatch && method === "GET") {
      return await handleVerifyVehiclePass(vehicleVerifyMatch[1]);
    }

    // OCR is deliberately not exposed as a public service-role endpoint. Document
    // approval and expiry decisions must be made by authorised compliance staff.
    if (cleanPath === "documents/verify" && method === "POST") {
      return errorResponse("Document verification is performed by authorised compliance staff.", 403);
    }

    // Notifications can dispatch third-party email and therefore require admin auth.
    if (cleanPath === "notifications/notify" && method === "POST") {
      const admin = await requireAdmin(request);
      if ("response" in admin) return admin.response;
      return await handleNotify(request, admin.adminId);
    }

    if (cleanPath === "notifications/cron" && method === "GET") {
      const cronSecret = process.env.CRON_SECRET ?? "";
      if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
        return errorResponse("Unauthorized scheduled notification request.", 401);
      }
      const supabase = getSupabaseAdmin();
      let inductionReset: { succeeded: boolean; error?: string } = { succeeded: true };
      try {
        const { error } = await supabase.rpc("reset_expired_inductions");
        if (error) {
          inductionReset = { succeeded: false, error: error.message };
          console.error("[CRON] reset_expired_inductions RPC failed:", error);
        }
      } catch (error) {
        inductionReset = { succeeded: false, error: error instanceof Error ? error.message : String(error) };
        console.error("[CRON] reset_expired_inductions RPC failed:", error);
      }
      const notifications = await runScheduledNotifications(supabase, sendOutboxEmailViaResend, {
        organizationName: ORGANIZATION_NAME,
        appUrl: APP_URL
      });
      const result = { inductionReset, notifications };
      console.log("[CRON] Scheduled jobs finished:", result);
      return jsonResponse(result);
    }

    return errorResponse("Route not found: " + rawPath, 404);
  } catch (err: any) {
    console.error("API Error:", err);
    return errorResponse(err?.message || "Internal Server Error", 500);
  }
}
