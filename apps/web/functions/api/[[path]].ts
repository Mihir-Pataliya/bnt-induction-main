import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_URL?: string;
  ORGANIZATION_NAME?: string;
  ORGANIZATION_LOGO_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

const DEFAULT_BRANDING = {
  id: "default",
  company_name: "BNT Logistics",
  logo_path: null as string | null,
  primary_color: "#1e3a5f",
  welcome_text: "Welcome to the driver induction portal",
  updated_at: null as string | null
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const rawPath = (params.path as string[])?.join("/") || "";
  const cleanPath = rawPath.replace(/^api\//, "");
  const method = request.method;

  // Simple Router
  try {
    // Health Check
    if ((cleanPath === "health" || rawPath === "health") && method === "GET") {
      return jsonResponse({
        status: "ok",
        service: "driver-induction-api-functions",
        organizationName: env.ORGANIZATION_NAME,
        timestamp: new Date().toISOString()
      });
    }

    // --- Branding (public read, admin update) ---
    if (cleanPath === "branding" && method === "GET") {
      return handleGetBranding(env);
    }
    if (cleanPath === "branding" && method === "PUT") {
      const adminId = await requireAdmin(request, env);
      if (!adminId) return errorResponse("Admin access required.", 401);
      return handleUpdateBranding(request, env, adminId);
    }

    // --- Public Registration Route ---
    if (cleanPath === "auth/register-driver" && method === "POST") {
      if ((env as Record<string, string | undefined>).ALLOW_SELF_REGISTRATION !== "true") {
        return errorResponse("Self-registration is disabled. Ask your administrator to create your induction account.", 403);
      }
      return handleSelfRegisterDriver(request, env);
    }

    if (cleanPath === "driver/documents" && method === "POST") {
      const driverId = await requireDriver(request, env);
      if (!driverId) return errorResponse("Driver access required.", 401);
      return handleSaveDriverDocument(request, env, driverId);
    }

    if (cleanPath === "driver/training-acknowledgements") {
      const driverId = await requireDriver(request, env);
      if (!driverId) return errorResponse("Driver access required.", 401);
      if (method === "GET") return handleGetDriverTrainingAcknowledgements(env, driverId);
      if (method === "POST") return handleSubmitDriverTrainingAcknowledgement(request, env, driverId);
    }

    if (cleanPath === "driver/employee-induction-records" && method === "GET") {
      const driverId = await requireDriver(request, env);
      if (!driverId) return errorResponse("Driver access required.", 401);
      return handleGetDriverInductionRecords(env, driverId);
    }
    const driverInductionAcknowledgementMatch = cleanPath.match(/^driver\/employee-induction-records\/([^/]+)\/acknowledgement$/);
    if (driverInductionAcknowledgementMatch && method === "POST") {
      const driverId = await requireDriver(request, env);
      if (!driverId) return errorResponse("Driver access required.", 401);
      return handleSubmitDriverInductionRecordAcknowledgement(request, env, driverId, driverInductionAcknowledgementMatch[1]);
    }

    if (cleanPath === "driver/training-calendar" && method === "GET") {
      const driverId = await requireDriver(request, env);
      if (!driverId) return errorResponse("Driver access required.", 401);
      return handleGetDriverTrainingCalendar(url, env, driverId);
    }

    // --- Admin Routes ---
    if (cleanPath.startsWith("admin/")) {
      const adminId = await requireAdmin(request, env);
      if (!adminId) return errorResponse("Admin access required.", 401);

      if (cleanPath === "admin/driver-skills-knowledge-report" && method === "GET") {
        return handleDriverSkillsKnowledgeReport(env);
      }

      // Create Driver
      if (cleanPath === "admin/drivers" && method === "POST") {
        return handleCreateDriver(request, env, adminId);
      }

      // Update Driver
      const driverMatch = cleanPath.match(/^admin\/drivers\/([^/]+)$/);
      if (driverMatch && method === "PUT") {
        return handleUpdateDriver(request, env, adminId, driverMatch[1]);
      }

      // Reset Password
      const pwResetMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/reset-password$/);
      if (pwResetMatch && method === "POST") {
        return handleResetPassword(request, env, adminId, pwResetMatch[1]);
      }

      // Reset Induction
      const inductionResetMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/reset-induction$/);
      if (inductionResetMatch && method === "POST") {
        return handleResetInduction(request, env, adminId, inductionResetMatch[1]);
      }

      // Archive Driver
      const archiveMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/archive$/);
      if (archiveMatch && method === "POST") {
        return handleArchiveDriver(request, env, adminId, archiveMatch[1]);
      }

      // Restore Driver
      const restoreMatch = cleanPath.match(/^admin\/drivers\/([^/]+)\/restore$/);
      if (restoreMatch && method === "POST") {
        return handleRestoreDriver(request, env, adminId, restoreMatch[1]);
      }

      // Delete Driver
      if (driverMatch && method === "DELETE") {
        return handleDeleteDriver(request, env, adminId, driverMatch[1]);
      }

      // Export Reports
      if (cleanPath === "admin/reports/export" && method === "GET") {
        return handleExportReports(url, env, adminId);
      }

      // Verification Queue — GET all pending documents
      if (cleanPath === "admin/verification-queue" && method === "GET") {
        return handleGetVerificationQueue(env, adminId);
      }

      // Approve / Reject a document
      const docVerifyMatch = cleanPath.match(/^admin\/documents\/([^/]+)\/verify$/);
      if (docVerifyMatch && method === "POST") {
        return handleVerifyDocument(request, env, adminId, docVerifyMatch[1]);
      }

      // --- Induction Schedules ---
      // List schedules
      if (cleanPath === "admin/schedules" && method === "GET") {
        return handleGetSchedules(env, adminId);
      }

      // Create schedule
      if (cleanPath === "admin/schedules" && method === "POST") {
        return handleCreateSchedule(request, env, adminId);
      }

      // Get single schedule
      const scheduleMatch = cleanPath.match(/^admin\/schedules\/([^/]+)$/);
      if (scheduleMatch && method === "GET") {
        return handleGetSchedule(env, adminId, scheduleMatch[1]);
      }

      // Update schedule
      if (scheduleMatch && method === "PATCH") {
        return handleUpdateSchedule(request, env, adminId, scheduleMatch[1]);
      }

      // Delete schedule
      if (scheduleMatch && method === "DELETE") {
        return handleDeleteSchedule(env, adminId, scheduleMatch[1]);
      }

      // Get schedule items
      const scheduleItemsMatch = cleanPath.match(/^admin\/schedules\/([^/]+)\/items$/);
      if (scheduleItemsMatch && method === "GET") {
        return handleGetScheduleItems(env, adminId, scheduleItemsMatch[1]);
      }

      // Add schedule item
      if (scheduleItemsMatch && method === "POST") {
        return handleAddScheduleItem(request, env, adminId, scheduleItemsMatch[1]);
      }

      // Update schedule item
      const scheduleItemMatch = cleanPath.match(/^admin\/schedules\/([^/]+)\/items\/([^/]+)$/);
      if (scheduleItemMatch && method === "PATCH") {
        return handleUpdateScheduleItem(request, env, adminId, scheduleItemMatch[1], scheduleItemMatch[2]);
      }

      // Delete schedule item
      if (scheduleItemMatch && method === "DELETE") {
        return handleDeleteScheduleItem(env, adminId, scheduleItemMatch[1], scheduleItemMatch[2]);
      }

      // Reorder schedule items
      const scheduleReorderMatch = cleanPath.match(/^admin\/schedules\/([^/]+)\/items\/reorder$/);
      if (scheduleReorderMatch && method === "POST") {
        return handleReorderScheduleItems(request, env, adminId, scheduleReorderMatch[1]);
      }

      // Get schedule enrollments
      if (cleanPath === "admin/schedules/enrollments" && method === "GET") {
        return handleGetScheduleEnrollments(url, env, adminId);
      }

      // Enroll driver in schedule
      const scheduleEnrollMatch = cleanPath.match(/^admin\/schedules\/([^/]+)\/enroll$/);
      if (scheduleEnrollMatch && method === "POST") {
        return handleEnrollDriverInSchedule(request, env, adminId, scheduleEnrollMatch[1]);
      }

      // Unenroll driver from schedule
      const scheduleUnenrollMatch = cleanPath.match(/^admin\/schedules\/([^/]+)\/enroll\/([^/]+)$/);
      if (scheduleUnenrollMatch && method === "DELETE") {
        return handleUnenrollDriverFromSchedule(env, adminId, scheduleUnenrollMatch[1], scheduleUnenrollMatch[2]);
      }

      // Process schedule invitations (cron job)
      if (cleanPath === "admin/schedules/process-invitations" && method === "POST") {
        return handleProcessScheduleInvitations(env, adminId);
      }

      // --- Training Calendar ---
      // List training events
      if (cleanPath === "admin/training-calendar" && method === "GET") {
        return handleGetTrainingCalendar(url, env, adminId);
      }

      // Create training event
      if (cleanPath === "admin/training-calendar" && method === "POST") {
        return handleCreateTrainingEvent(request, env, adminId);
      }

      // Get single training event
      const trainingEventMatch = cleanPath.match(/^admin\/training-calendar\/([^/]+)$/);
      if (trainingEventMatch && method === "GET") {
        return handleGetTrainingEvent(env, adminId, trainingEventMatch[1]);
      }

      // Update training event
      if (trainingEventMatch && method === "PATCH") {
        return handleUpdateTrainingEvent(request, env, adminId, trainingEventMatch[1]);
      }

      // Delete training event
      if (trainingEventMatch && method === "DELETE") {
        return handleDeleteTrainingEvent(env, adminId, trainingEventMatch[1]);
      }

      // Get employees for dropdown
      if (cleanPath === "admin/training-calendar/employees" && method === "GET") {
        return handleGetTrainingCalendarEmployees(env, adminId);
      }

      if (cleanPath === "admin/training-acknowledgements" && method === "GET") {
        return handleGetTrainingAcknowledgements(env);
      }

      // --- Employee/Contractor Induction Records ---
      // List available workers
      if (cleanPath === "admin/induction-workers" && method === "GET") {
        return handleGetInductionWorkers(env, adminId);
      }

      // List induction records
      if (cleanPath === "admin/employee-induction-records" && method === "GET") {
        return handleGetInductionRecords(url, env, adminId);
      }

      // Create induction record
      if (cleanPath === "admin/employee-induction-records" && method === "POST") {
        return handleCreateInductionRecord(request, env, adminId);
      }

      // CRUD for a specific record
      const inductionRecordMatch = cleanPath.match(/^admin\/employee-induction-records\/([^/]+)$/);
      if (inductionRecordMatch && method === "GET") {
        return handleGetInductionRecord(env, adminId, inductionRecordMatch[1]);
      }
      if (inductionRecordMatch && method === "PUT") {
        return handleUpdateInductionRecord(request, env, adminId, inductionRecordMatch[1]);
      }
      if (inductionRecordMatch && method === "DELETE") {
        return handleDeleteInductionRecord(env, adminId, inductionRecordMatch[1]);
      }
    }

    // --- Public Routes ---

    // Verify Certificate
    const verifyMatch = cleanPath.match(/^certificate\/verify\/([^/]+)$/);
    if (verifyMatch && method === "GET") {
      return handleVerifyCertificate(verifyMatch[1], env, request);
    }

    // Verify Driver ID
    const driverVerifyMatch = cleanPath.match(/^driver\/verify\/([^/]+)$/);
    if (driverVerifyMatch && method === "GET") {
      return handleVerifyDriver(driverVerifyMatch[1], env);
    }

    // Verify Vehicle Pass
    const vehicleVerifyMatch = cleanPath.match(/^vehicle\/verify\/([^/]+)$/);
    if (vehicleVerifyMatch && method === "GET") {
      return handleVerifyVehiclePass(vehicleVerifyMatch[1], env);
    }

    // OCR is deliberately not exposed as a public service-role endpoint. Document
    // approval and expiry decisions must be made by an authorised compliance user.
    if ((cleanPath === "documents/verify" || rawPath === "api/documents/verify") && method === "POST") {
      return errorResponse("Document verification is performed by authorised compliance staff.", 403);
    }

    // Notifications can dispatch third-party email and therefore require admin auth.
    if ((cleanPath === "notifications/notify" || rawPath === "api/notifications/notify") && method === "POST") {
      const adminId = await requireAdmin(request, env);
      if (!adminId) return errorResponse("Admin access required.", 401);
      return handleNotify(request, env);
    }

    return errorResponse("Route not found: " + rawPath, 404);
  } catch (err: any) {
    console.error("API Error:", err);
    if (err?.code === "PGRST205" && /training_acknowledgements/i.test(err?.message ?? "")) {
      return errorResponse("The database is missing the training acknowledgements table. Run supabase/migrations/045_training_acknowledgements.sql in the Supabase SQL Editor, then retry.", 503);
    }
    if (err?.code === "PGRST205" && /employee_induction_records/i.test(err?.message ?? "")) {
      return errorResponse("The database is missing the employee induction records table. Run supabase/migrations/044_employee_induction_records.sql in the Supabase SQL Editor, then retry.", 503);
    }
    return errorResponse(err.message || "Internal Server Error", 500);
  }
};

// --- Helper Functions ---

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type"
    }
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ message }, status);
}

const getSupabaseAdmin = (env: Env) => {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
};

async function requireAdmin(request: Request, env: Env) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length);
  const supabase = getSupabaseAdmin(env);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();

  return profile?.role === "admin" ? authData.user.id : null;
}

async function requireDriver(request: Request, env: Env) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const supabase = getSupabaseAdmin(env);
  const { data: authData, error } = await supabase.auth.getUser(header.slice("Bearer ".length));
  if (error || !authData.user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  return profile?.role === "driver" ? authData.user.id : null;
}

async function handleSaveDriverDocument(request: Request, env: Env, driverId: string) {
  const payload = z.object({
    type: z.string().min(1),
    fileUrl: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative()
  }).parse(await request.json());
  if (!payload.fileUrl.startsWith(`${driverId}/`)) {
    return errorResponse("You can only submit documents stored in your own folder.", 403);
  }

  const supabase = getSupabaseAdmin(env);
  const { data: existing, error: lookupError } = await supabase
    .from("documents")
    .select("id")
    .eq("user_id", driverId)
    .eq("type", payload.type)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;

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
    ? await supabase.from("documents").update(documentData).eq("id", existing.id).eq("user_id", driverId).select("id, status").maybeSingle()
    : await supabase.from("documents").insert({ ...documentData, user_id: driverId, type: payload.type }).select("id, status").single();
  if (saveError) throw saveError;
  if (!saved || saved.status !== "pending") throw new Error("The replacement document could not be saved as pending.");
  return jsonResponse({ documentId: saved.id, status: saved.status });
}

async function logAuditEntry(supabase: any, userId: string, action: string, metadata: any) {
  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action,
    metadata,
    created_at: new Date().toISOString()
  });
  // M-13 fix: log failures instead of silently swallowing them
  if (error) {
    console.error("[AUDIT] Failed to write audit log:", action, error.message);
  }
}

async function handleSelfRegisterDriver(request: Request, env: Env) {
  const supabase = getSupabaseAdmin(env);
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
  for (const [label, res] of [["profiles", profileRes], ["drivers", driverRes], ["induction_progress", progressRes]] as [string, PromiseSettledResult<any>][]) {
    if (res.status === "rejected") {
      insertErrors.push(`${label}: ${res.reason?.message ?? "unknown"}`);
    } else if (res.value?.error) {
      insertErrors.push(`${label}: ${res.value.error.message}`);
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

  await logAuditEntry(supabase, userId, "driver_self_registered", { email: emailLower, depotCode: payload.depotCode });
  return jsonResponse({ message: "Registration successful. You can now log in.", email: emailLower });
}

// --- Branding (public read, admin update) ---

async function handleGetBranding(env: Env): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("branding")
    .select("id, company_name, logo_path, primary_color, welcome_text, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return jsonResponse({ branding: data ?? DEFAULT_BRANDING });
}

async function handleUpdateBranding(request: Request, env: Env, adminId: string): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
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

  await logAuditEntry(supabase, adminId, "admin_branding_updated", {
    companyName: payload.company_name,
    hasLogo: Boolean(payload.logo_path)
  });

  return jsonResponse({ message: "Branding updated.", branding: updated });
}

// --- Route Handlers ---


async function handleCreateDriver(request: Request, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
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

  if (createError || !createdUser.user) throw createError || new Error("Account creation failed");

  const userId = createdUser.user.id;
  const now = new Date().toISOString();

  // C-5 FIX: Check errors from all Supabase inserts individually.
  // Supabase JS never throws — errors are returned as { data, error }.
  // An unchecked failure creates an orphaned auth user with no profile.
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

  // Collect any insert errors and roll back the auth user if any failed
  const insertErrors: string[] = [];
  for (const [label, res] of [["profiles", profileRes], ["drivers", driverRes], ["induction_progress", progressRes]] as [string, PromiseSettledResult<any>][]) {
    if (res.status === "rejected") {
      insertErrors.push(`${label}: ${res.reason?.message ?? "unknown error"}`);
    } else if (res.value?.error) {
      insertErrors.push(`${label}: ${res.value.error.message}`);
    }
  }

  if (insertErrors.length > 0) {
    // Roll back: delete the auth user to avoid orphaned account
    await supabase.auth.admin.deleteUser(userId).catch((e: any) =>
      console.error("[ROLLBACK] Failed to delete orphaned auth user:", e.message)
    );
    throw new Error(`Driver creation failed — DB inserts failed: ${insertErrors.join("; ")}`);
  }

  // Initial Sections
  const { data: sections } = await supabase.from("learning_sections").select("id");
  if (sections?.length) {
    await supabase.from("learning_section_completions").insert(
      sections.map(s => ({ user_id: userId, section_id: s.id, completed: false }))
    );
  }

  await logAuditEntry(supabase, adminId, "admin_driver_created", { driverId: userId, email: payload.email });

  let emailSent = false;
  let emailMessage = "";
  if (!env.RESEND_API_KEY) {
    emailMessage = "Driver created, but the welcome email was not sent. Configure RESEND_API_KEY on the web API environment.";
    console.warn(`[EMAIL] RESEND_API_KEY is not configured; welcome email not sent to ${payload.email}.`);
  } else {
    const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, (char) => {
      switch (char) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case "\"": return "&quot;";
        default: return "&#39;";
      }
    });
    const organizationName = env.ORGANIZATION_NAME || "BNT Logistics";
    const loginUrl = env.APP_URL || request.headers.get("origin") || "https://example.com";
    const from = env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#172033">
      <h2 style="color:#1e3a5f">Welcome, ${escapeHtml(payload.fullName)}!</h2>
      <p>Your driver account has been created for <strong>${escapeHtml(organizationName)}</strong>.</p>
      <p><strong>Login email:</strong> ${escapeHtml(payload.email)}<br/><strong>Temporary password:</strong> ${escapeHtml(payload.password)}</p>
      <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Open Driver Portal</a></p>
      <p>Please change your password after your first login.</p>
    </div>`;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [payload.email],
          subject: `Welcome to ${organizationName} — Your Driver Account Is Ready`,
          html
        })
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(details.message || `Resend returned HTTP ${response.status}`);
      }
      emailSent = true;
      emailMessage = "Driver created and welcome email sent.";
      console.log(`[EMAIL] Welcome email sent to ${payload.email}.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Email provider request failed";
      emailMessage = `Driver created, but the welcome email was not sent: ${reason}`;
      console.error(`[EMAIL] Welcome email failed for ${payload.email}: ${reason}`);
    }
  }

  return jsonResponse({ message: emailMessage, emailSent, userId }, 201);
}

async function handleUpdateDriver(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);

  // H-11 FIX: Validate input with Zod — raw unvalidated JSON was passed to admin APIs
  const updateSchema = z.object({
    email: z.string().email().optional(),
    fullName: z.string().min(2).optional(),
    phone: z.string().min(5).optional(),
    address: z.string().min(5).optional(),
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

  await logAuditEntry(supabase, adminId, "admin_driver_updated", { driverId, email: payload.email });
  return jsonResponse({ message: "Driver updated" });
}

async function handleResetPassword(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const { password } = await request.json() as any;
  await supabase.auth.admin.updateUserById(driverId, { password });
  await logAuditEntry(supabase, adminId, "admin_password_reset", { driverId });
  return jsonResponse({ message: "Password reset" });
}

async function handleResetInduction(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);
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

  await logAuditEntry(supabase, adminId, "admin_induction_reset", { driverId });
  return jsonResponse({ message: "Induction reset complete" });
}

async function handleDeleteDriver(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);

  // Cleanup
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

  await logAuditEntry(supabase, adminId, "admin_driver_deleted", { driverId });
  return jsonResponse({ message: "Driver deleted" });
}

async function handleArchiveDriver(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.rpc("archive_user_by_admin", { target_user_id: driverId });
  if (error) throw error;
  await logAuditEntry(supabase, adminId, "admin_driver_archived", { driverId });
  return jsonResponse({ message: "Driver archived" });
}

async function handleRestoreDriver(request: Request, env: Env, adminId: string, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.rpc("restore_user_by_admin", { target_user_id: driverId });
  if (error) throw error;
  await logAuditEntry(supabase, adminId, "admin_driver_restored", { driverId });
  return jsonResponse({ message: "Driver restored" });
}

async function handleExportReports(url: URL, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
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

  await logAuditEntry(supabase, adminId, "admin_report_exported", { scope, format });

  const headers = Object.keys(data[0] || {});

  if (format === "pdf") {
    // Generate styled printable HTML report for PDF export in Cloudflare Worker environment
    const htmlReport = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${env.ORGANIZATION_NAME || "BNT Logistics"} ${scope.toUpperCase()} Report</title>
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
  <h1>${env.ORGANIZATION_NAME || "BNT Logistics"} — ${scope.toUpperCase()} Report</h1>
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

  // CSV export fallback
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

async function handleVerifyCertificate(code: string, env: Env, request: Request) {
  const supabase = getSupabaseAdmin(env);
  const { data: cert, error } = await supabase.from("certificates").select("*").eq("verification_code", code).single();

  if (error || !cert) {
    return errorResponse("Certificate not found", 404);
  }

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", cert.user_id).single();

  return jsonResponse({
    verified: true,
    organizationName: env.ORGANIZATION_NAME,
    certificate: {
      completionId: cert.completion_id,
      verificationCode: cert.verification_code,
      issuedAt: cert.issued_at
    },
    driver: { fullName: profile?.full_name || "Unknown" }
  });
}

async function handleVerifyVehiclePass(passCode: string, env: Env) {
  const supabase = getSupabaseAdmin(env);

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
    organizationName: env.ORGANIZATION_NAME,
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

async function handleVerifyDriver(driverId: string, env: Env) {
  const supabase = getSupabaseAdmin(env);

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
    organizationName: env.ORGANIZATION_NAME,
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

async function handleOCRVerify(request: Request, env: Env) {
  const { fileUrl, documentType, userId } = await request.json() as any;
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  const supabase = getSupabaseAdmin(env);
  if (userId && fileUrl) {
    await supabase.from("documents").update({ expires_at: expiryDate.toISOString() })
      .eq("user_id", userId).eq("file_url", fileUrl);
  }

  return jsonResponse({
    message: "OCR processing mock success",
    data: { isValid: true, confidenceScore: 0.99, simulatedExpiry: expiryDate.toISOString() }
  });
}

async function handleNotify(request: Request, env: Env) {
  const payload = await request.json() as any;
  const { eventType, userEmail, driverName, context } = payload;

  console.log(`[NOTIFICATION] ${eventType} for ${userEmail}`);

  if (env.RESEND_API_KEY && userEmail) {
     try {
       await fetch("https://api.resend.com/emails", {
         method: "POST",
         headers: {
           "Authorization": `Bearer ${env.RESEND_API_KEY}`,
           "Content-Type": "application/json"
         },
         body: JSON.stringify({
           from: env.RESEND_FROM_EMAIL || "notifications@resend.dev",
           to: userEmail,
           subject: `${env.ORGANIZATION_NAME || "BNT Logistics"} Notification: ${eventType}`,
           html: `<p>Hello ${driverName || "Driver"},</p><p>Event: <strong>${eventType}</strong></p><p>${context || ""}</p>`
         })
       });
       console.log(`[NOTIFICATION] Resend email dispatched to ${userEmail}`);
     } catch (e) {
       console.error("[NOTIFICATION] Resend dispatch error:", e);
     }
  }

  return jsonResponse({ message: "Notification dispatched" });
}

// --- Verification Queue Handlers ---

async function handleGetVerificationQueue(env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);

  // Fetch all pending documents with driver profile info
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
      expires_at
    `)
    .eq("status", "pending")
    .order("uploaded_at", { ascending: true });

  if (error) throw error;

  const userIds = [...new Set((data ?? []).map((document: any) => document.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profilesById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  return jsonResponse({ documents: (data ?? []).map((document: any) => ({
    ...document,
    profiles: profilesById.get(document.user_id) ?? null
  })) });
}

async function handleVerifyDocument(request: Request, env: Env, adminId: string, docId: string) {
  const supabase = getSupabaseAdmin(env);
  const { action } = await request.json() as { action: "approve" | "reject" };

  if (action !== "approve" && action !== "reject") {
    return errorResponse("Action must be 'approve' or 'reject'.", 400);
  }

  // Fetch the document to get the driver's user_id
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("user_id, type")
    .eq("id", docId)
    .single();
  if (docError || !doc) return errorResponse("Document not found.", 404);

  const driverId = doc.user_id;

  // Update document status
  const { error: updateError } = await supabase
    .from("documents")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      verified_by_admin: action === "approve"
    })
    .eq("id", docId);
  if (updateError) throw updateError;

  // If approved: check if ALL documents for this driver are now approved
  if (action === "approve") {
    const { data: allDocs } = await supabase
      .from("documents")
      .select("status")
      .eq("user_id", driverId);

    const requiredTypes = ["driver_license", "medical_certificate", "identity_proof"];
    const { data: driverDocs } = await supabase
      .from("documents")
      .select("type, status")
      .eq("user_id", driverId);

    const allApproved =
      requiredTypes.every((type) =>
        (driverDocs ?? []).some((d: any) => d.type === type && d.status === "approved")
      );

    if (allApproved) {
      // Advance driver to step 2 — TRAINING UNLOCKED
      const { data: progress } = await supabase
        .from("induction_progress")
        .select("completed_step_ids, current_step")
        .eq("user_id", driverId)
        .single();

      const completedSteps: number[] = progress?.completed_step_ids ?? [];
      if (!completedSteps.includes(1)) completedSteps.push(1);

      // H-12 FIX: Check errors from progress advance DB calls — silent failures
      // leave the driver perpetually stuck in the system with no way to progress.
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

  await logAuditEntry(supabase, adminId, `admin_document_${action}d`, {
    docId,
    driverId,
    documentType: doc.type
  });

  return jsonResponse({
    message: `Document ${action === "approve" ? "approved" : "rejected"} successfully.`
  });
}

// ============================================================
// Induction Schedule Handlers
// ============================================================

async function handleGetSchedules(env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("induction_schedules")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return jsonResponse({ schedules: data ?? [] });
}

async function handleCreateSchedule(request: Request, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional()
  });
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase
    .from("induction_schedules")
    .insert({
      name: payload.name,
      description: payload.description || '',
      created_by: adminId
    })
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_created", { scheduleId: data.id, name: payload.name });
  return jsonResponse({ schedule: data }, 201);
}

async function handleGetSchedule(env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("induction_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();
  if (error) return errorResponse("Schedule not found.", 404);
  return jsonResponse({ schedule: data });
}

async function handleUpdateSchedule(request: Request, env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    is_active: z.boolean().optional()
  });
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase
    .from("induction_schedules")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_updated", { scheduleId, changes: payload });
  return jsonResponse({ schedule: data });
}

async function handleDeleteSchedule(env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.from("induction_schedules").delete().eq("id", scheduleId);
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_deleted", { scheduleId });
  return jsonResponse({ message: "Schedule deleted." });
}

async function handleGetScheduleItems(env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("induction_schedule_items")
    .select(`
      *,
      course:induction_courses(*)
    `)
    .eq("schedule_id", scheduleId)
    .order("sequence_order", { ascending: true });
  if (error) throw error;
  return jsonResponse({ items: data ?? [] });
}

async function handleAddScheduleItem(request: Request, env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    courseId: z.string().uuid(),
    sequenceOrder: z.number().int().positive(),
    delayDays: z.number().int().min(0).default(7),
    delayType: z.enum(['after_completion', 'after_enrollment', 'fixed_date']).default('after_completion'),
    fixedDate: z.string().datetime().optional().nullable(),
    isRequired: z.boolean().default(true)
  });
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase
    .from("induction_schedule_items")
    .insert({
      schedule_id: scheduleId,
      course_id: payload.courseId,
      sequence_order: payload.sequenceOrder,
      delay_days: payload.delayDays,
      delay_type: payload.delayType,
      fixed_date: payload.fixedDate,
      is_required: payload.isRequired
    })
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_item_added", { scheduleId, itemId: data.id, courseId: payload.courseId });
  return jsonResponse({ item: data }, 201);
}

async function handleUpdateScheduleItem(request: Request, env: Env, adminId: string, scheduleId: string, itemId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    sequenceOrder: z.number().int().positive().optional(),
    delayDays: z.number().int().min(0).optional(),
    delayType: z.enum(['after_completion', 'after_enrollment', 'fixed_date']).optional(),
    fixedDate: z.string().datetime().optional().nullable(),
    isRequired: z.boolean().optional()
  });
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase
    .from("induction_schedule_items")
    .update(payload)
    .eq("id", itemId)
    .eq("schedule_id", scheduleId)
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_item_updated", { scheduleId, itemId, changes: payload });
  return jsonResponse({ item: data });
}

async function handleDeleteScheduleItem(env: Env, adminId: string, scheduleId: string, itemId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase
    .from("induction_schedule_items")
    .delete()
    .eq("id", itemId)
    .eq("schedule_id", scheduleId);
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_item_deleted", { scheduleId, itemId });
  return jsonResponse({ message: "Schedule item deleted." });
}

async function handleReorderScheduleItems(request: Request, env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    itemOrders: z.array(z.object({ id: z.string().uuid(), sequenceOrder: z.number().int().positive() }))
  });
  const payload = schema.parse(await request.json());

  for (const item of payload.itemOrders) {
    const { error } = await supabase
      .from("induction_schedule_items")
      .update({ sequence_order: item.sequenceOrder })
      .eq("id", item.id)
      .eq("schedule_id", scheduleId);
    if (error) throw error;
  }

  await logAuditEntry(supabase, adminId, "schedule_items_reordered", { scheduleId });
  return jsonResponse({ message: "Schedule items reordered." });
}

async function handleGetScheduleEnrollments(url: URL, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const scheduleId = url.searchParams.get("schedule_id");

  let query = supabase
    .from("induction_schedule_enrollments")
    .select(`
      *,
      driver:profiles(*),
      schedule:induction_schedules(*)
    `)
    .order("enrolled_at", { ascending: false });

  if (scheduleId) {
    query = query.eq("schedule_id", scheduleId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return jsonResponse({ enrollments: data ?? [] });
}

async function handleEnrollDriverInSchedule(request: Request, env: Env, adminId: string, scheduleId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({ driverId: z.string().uuid() });
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase.rpc("enroll_driver_in_schedule", {
    p_schedule_id: scheduleId,
    p_driver_id: payload.driverId,
    p_enrolled_by: adminId
  });
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "driver_enrolled_in_schedule", { scheduleId, driverId: payload.driverId });
  return jsonResponse({ enrollment: data }, 201);
}

async function handleUnenrollDriverFromSchedule(env: Env, adminId: string, scheduleId: string, enrollmentId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase
    .from("induction_schedule_enrollments")
    .delete()
    .eq("id", enrollmentId)
    .eq("schedule_id", scheduleId);
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "driver_unenrolled_from_schedule", { scheduleId, enrollmentId });
  return jsonResponse({ message: "Driver unenrolled from schedule." });
}

async function handleProcessScheduleInvitations(env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);

  // Call the database function to process invitations
  const { data: processed, error } = await supabase.rpc("process_induction_schedule_invitations");
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "schedule_invitations_processed", {});
  return jsonResponse({ processed: Number(processed ?? 0) });
}

// ============================================================
// Training Calendar Handlers
// ============================================================

async function handleGetTrainingCalendar(url: URL, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const status = url.searchParams.get("status");
  const employeeId = url.searchParams.get("employee_id");

  let query = supabase
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
  return jsonResponse({ events: data ?? [] });
}

async function handleGetDriverTrainingCalendar(url: URL, env: Env, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const status = url.searchParams.get("status");
  const validStatuses = ["scheduled", "completed", "overdue"];
  if (status && status !== "all" && !validStatuses.includes(status)) {
    return errorResponse("Invalid training status filter.", 400);
  }

  let query = supabase
    .from("training_calendar_events")
    .select("*, employee:profiles!training_calendar_events_employee_id_fkey(full_name, email, role)")
    .or(`employee_id.is.null,employee_id.eq.${driverId}`)
    .order("scheduled_date", { ascending: true });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return jsonResponse({ events: data ?? [] });
}


async function handleGetTrainingEvent(env: Env, adminId: string, eventId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("training_calendar_events")
    .select("*, employee:profiles!training_calendar_events_employee_id_fkey(full_name, email, role)")
    .eq("id", eventId)
    .single();
  if (error) return errorResponse("Training event not found.", 404);
  return jsonResponse({ event: data });
}

async function handleCreateTrainingEvent(request: Request, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    title: z.string().min(1).max(200),
    topic: z.string().min(1).max(200),
    trainer: z.string().min(1).max(200),
    employee_id: z.string().uuid(),
    scheduled_date: z.string().datetime(),
    refresher_due_date: z.string().datetime().optional().nullable(),
    notes: z.string().optional()
  });
  const payload = schema.parse(await request.json());

  // Validate employee exists and is active
  const { data: employee, error: empError } = await supabase
    .from("profiles")
    .select("id, full_name, role, email")
    .eq("id", payload.employee_id)
    .maybeSingle();
  if (empError || !employee) return errorResponse("Employee not found.", 404);

  const now = new Date().toISOString();
  const scheduledDate = new Date(payload.scheduled_date).toISOString();
  const refresherDueDate = payload.refresher_due_date ? new Date(payload.refresher_due_date).toISOString() : null;

  // Auto-determine status: overdue if scheduled_date is in past and not completed
  let status = "scheduled";
  if (new Date(scheduledDate) < new Date(now)) status = "overdue";

  const { data, error } = await supabase
    .from("training_calendar_events")
    .insert({
      title: payload.title,
      topic: payload.topic,
      trainer: payload.trainer,
      employee_id: payload.employee_id,
      scheduled_date: scheduledDate,
      refresher_due_date: refresherDueDate,
      status,
      notes: payload.notes || '',
      created_by: adminId
    })
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "training_event_created", { eventId: data.id, topic: payload.topic });
  return jsonResponse({ event: data }, 201);
}

async function handleUpdateTrainingEvent(request: Request, env: Env, adminId: string, eventId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    title: z.string().min(1).max(200).optional(),
    topic: z.string().min(1).max(200).optional(),
    trainer: z.string().min(1).max(200).optional(),
    employee_id: z.string().uuid().optional(),
    scheduled_date: z.string().datetime().optional(),
    refresher_due_date: z.string().datetime().optional().nullable(),
    notes: z.string().optional(),
    status: z.enum(['scheduled', 'completed', 'overdue']).optional()
  });
  const payload = schema.parse(await request.json());

  const now = new Date().toISOString();
  const updateData: Record<string, any> = { updated_at: now };

  if (payload.title) updateData.title = payload.title;
  if (payload.topic) updateData.topic = payload.topic;
  if (payload.trainer) updateData.trainer = payload.trainer;
  if (payload.employee_id) updateData.employee_id = payload.employee_id;
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

  const { data, error } = await supabase
    .from("training_calendar_events")
    .update(updateData)
    .eq("id", eventId)
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "training_event_updated", { eventId, changes: payload });
  return jsonResponse({ event: data });
}

async function handleDeleteTrainingEvent(env: Env, adminId: string, eventId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.from("training_calendar_events").delete().eq("id", eventId);
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "training_event_deleted", { eventId });
  return jsonResponse({ message: "Training event deleted." });
}

async function handleGetTrainingCalendarEmployees(env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ['admin', 'driver'])
    .order("full_name", { ascending: true });
  if (error) throw error;
  return jsonResponse({ employees: data ?? [] });
}

async function handleGetInductionWorkers(env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, employment_type, staff_role, phone, licence_class, licence_number, issuing_state, depot_location")
    .neq("role", "admin")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return jsonResponse({ workers: data ?? [] });
}

async function fetchReportRows(supabase: ReturnType<typeof getSupabaseAdmin>, table: string, columns: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

function isMissingReportColumn(error: { code?: string; message?: string }) {
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42703" || error.code === "PGRST204" ||
    message.includes("does not exist") || message.includes("schema cache");
}

async function handleDriverSkillsKnowledgeReport(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const quizColumns = "id, user_id, score, passed, created_at, category_scores, failed_critical, critical_questions_asked";
  const [workers, sections, activities, contractorMemberships, quizAttempts] = await Promise.all([
    fetchReportRows(supabase, "profiles", "id, full_name, role, employment_type, staff_role, depot_location"),
    fetchReportRows(supabase, "learning_sections", "id, title, version, audience, target_role, sort_order, source_slide_id"),
    fetchReportRows(supabase, "learning_section_completions", "user_id, section_id, section_version, completed, completed_at, section_started_at"),
    fetchReportRows(supabase, "contractor_profiles", "user_id"),
    (async () => {
      try {
        return await fetchReportRows(supabase, "quiz_attempts", quizColumns);
      } catch (error) {
        if (!isMissingReportColumn(error as { code?: string; message?: string })) throw error;
        return fetchReportRows(supabase, "quiz_attempts", "id, user_id, score, passed, created_at");
      }
    })()
  ]);

  const contractorIds = new Set(contractorMemberships.map((row: any) => row.user_id));
  const drivers = workers.filter((worker: any) =>
    worker.role !== "admin" && (worker.staff_role ?? "driver") === "driver"
  );
  const seenTitles = new Set<string>();
  const currentSections = sections
    .filter((section: any) => section.source_slide_id == null && Boolean(section.title?.trim()))
    .sort((left: any, right: any) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .filter((section: any) => {
      const title = section.title.trim();
      if (seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    });

  const activityByKey = new Map<string, any>();
  for (const activity of activities) {
    if (!activity.completed && !activity.section_started_at) continue;
    const section = currentSections.find((item: any) => item.id === activity.section_id);
    if (!section || (activity.section_version ?? "1.0") !== (section.version ?? "1.0")) continue;
    activityByKey.set(`${activity.user_id}:${activity.section_id}:${section.version ?? "1.0"}`, activity);
  }
  const attemptsByUser = new Map<string, any[]>();
  for (const attempt of quizAttempts) {
    const attempts = attemptsByUser.get(attempt.user_id) ?? [];
    attempts.push(attempt);
    attemptsByUser.set(attempt.user_id, attempts);
  }

  const records = drivers.map((worker: any) => {
    const employmentType = worker.employment_type === "contractor" || contractorIds.has(worker.id) ? "contractor" : "employee";
    const staffRole = worker.staff_role ?? "driver";
    const assignedSections = currentSections.filter((section: any) =>
      (section.audience == null || section.audience === "all" || section.audience === employmentType) &&
      (section.target_role == null || section.target_role === "all" || section.target_role === staffRole)
    );
    let safetyLastActivityDate: string | null = null;
    let safetyModulesCompleted = 0;
    let safetyModulesInProgress = 0;
    const safetyModuleStatuses = assignedSections.map((section: any) => {
      const activity = activityByKey.get(`${worker.id}:${section.id}:${section.version ?? "1.0"}`);
      const status = activity?.completed ? "completed" : activity?.section_started_at ? "in_progress" : "not_started";
      if (status === "completed") safetyModulesCompleted += 1;
      if (status === "in_progress") safetyModulesInProgress += 1;
      const activityDate = activity?.completed_at ?? activity?.section_started_at ?? null;
      if (activityDate && (!safetyLastActivityDate || activityDate > safetyLastActivityDate)) {
        safetyLastActivityDate = activityDate;
      }
      return {
        sectionId: section.id,
        title: section.title.trim(),
        status,
        completedAt: activity?.completed_at ?? null,
        startedAt: activity?.section_started_at ?? null
      };
    });
    const attempts = (attemptsByUser.get(worker.id) ?? []).slice().sort((left, right) =>
      (right.created_at ?? "").localeCompare(left.created_at ?? "")
    );
    const latestAttempt = attempts[0] ?? null;
    const quizEverPassed = attempts.some((attempt) => attempt.passed === true);
    const quizBestScore = attempts.length
      ? Math.max(...attempts.map((attempt) => attempt.score ?? 0))
      : null;
    const quizLastAttemptDate = latestAttempt?.created_at ?? null;
    const hasActivity = safetyModulesCompleted > 0 || safetyModulesInProgress > 0 || attempts.length > 0;
    const overallStatus = assignedSections.length === 0
      ? "No modules assigned"
      : quizEverPassed && safetyModulesCompleted === assignedSections.length
        ? "Complete"
        : hasActivity ? "In progress" : "Not started";
    const assessmentDates = [safetyLastActivityDate, quizLastAttemptDate].filter((value): value is string => Boolean(value));

    return {
      id: worker.id,
      workerId: worker.id,
      workerName: worker.full_name?.trim() || "Name not recorded",
      workerType: worker.employment_type === "employee" || worker.employment_type === "contractor"
        ? worker.employment_type
        : contractorIds.has(worker.id) ? "contractor" : "unknown",
      role: worker.staff_role?.trim() || "Not recorded",
      depotLocation: worker.depot_location,
      safetyModulesAssigned: assignedSections.length,
      safetyModulesCompleted,
      safetyModulesInProgress,
      safetyLastActivityDate,
      safetyModuleStatuses,
      quizAttempts: attempts.length,
      quizAttemptHistory: attempts.map((attempt) => ({
        id: attempt.id,
        score: attempt.score ?? null,
        passed: attempt.passed ?? null,
        attemptedAt: attempt.created_at ?? null,
        categoryScores: attempt.category_scores ?? null,
        failedCritical: attempt.failed_critical ?? null,
        criticalQuestionsAsked: attempt.critical_questions_asked ?? null
      })),
      quizLatestScore: latestAttempt?.score ?? null,
      quizBestScore,
      quizLatestPassed: latestAttempt?.passed ?? null,
      quizEverPassed,
      quizLastAttemptDate,
      practicalAssessmentStatus: "Not assessed",
      medicalAssessmentStatus: "Not assessed",
      overallStatus,
      lastAssessmentDate: assessmentDates.length
        ? assessmentDates.reduce((latest, value) => value > latest ? value : latest)
        : null
    };
  });

  records.sort((left: any, right: any) => left.workerName.localeCompare(right.workerName));
  return jsonResponse({ records });
}

async function handleGetTrainingAcknowledgements(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const [workersResult, sectionsResult, activitiesResult, acknowledgementsResult, contractorResult] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, employment_type, staff_role").neq("role", "admin"),
    supabase.from("learning_sections").select("id, title, version, audience, target_role, sort_order, source_slide_id").is("source_slide_id", null).order("sort_order", { ascending: true }),
    supabase.from("learning_section_completions").select("user_id, section_id, section_version, completed, completed_at, section_started_at"),
    supabase.from("training_acknowledgements").select("id, worker_id, section_id, section_version, presentation_title, acknowledgement_statement, acknowledged_at, signature, signed_at, recorded_by"),
    supabase.from("contractor_profiles").select("user_id")
  ]);
  for (const result of [workersResult, sectionsResult, activitiesResult, acknowledgementsResult, contractorResult]) {
    if (result.error) throw result.error;
  }

  const workers = workersResult.data ?? [];
  const seenTitles = new Set<string>();
  const sections = (sectionsResult.data ?? []).filter((section: any) => {
    const title = section.title?.trim();
    if (!title || seenTitles.has(title)) return false;
    seenTitles.add(title);
    return true;
  });
  const workerById = new Map(workers.map((worker: any) => [worker.id, worker]));
  const sectionById = new Map(sections.map((section: any) => [section.id, section]));
  const contractorIds = new Set((contractorResult.data ?? []).map((row: any) => row.user_id));
  const activityByKey = new Map<string, any>();
  for (const activity of activitiesResult.data ?? []) {
    if (!activity.completed && !activity.section_started_at) continue;
    const section: any = sectionById.get(activity.section_id);
    if (!section || (activity.section_version ?? "1.0") !== (section.version ?? "1.0")) continue;
    activityByKey.set(`${activity.user_id}:${activity.section_id}:${section.version ?? "1.0"}`, activity);
  }

  const acknowledgementRows = acknowledgementsResult.data ?? [];
  const acknowledgementsByKey = new Map(acknowledgementRows.map((row: any) => [
    `${row.worker_id}:${row.section_id}:${row.section_version}`,
    row
  ]));
  const entries = new Map<string, any>();
  const assigned = (section: any, worker: any) => {
    const employmentType = worker.employment_type === "contractor" || contractorIds.has(worker.id) ? "contractor" : "employee";
    const staffRole = worker.staff_role ?? "driver";
    return (section.audience == null || section.audience === "all" || section.audience === employmentType) &&
      (section.target_role == null || section.target_role === "all" || section.target_role === staffRole);
  };
  const makeEntry = (worker: any, section: any, activity: any, saved: any) => ({
    id: `${worker.id}:${section.id}:${section.version ?? "1.0"}`,
    workerId: worker.id,
    workerName: worker.full_name?.trim() || "Name not recorded",
    workerType: worker.employment_type === "employee" || worker.employment_type === "contractor"
      ? worker.employment_type
      : contractorIds.has(worker.id) ? "contractor" : "unknown",
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
  });

  for (const activity of activityByKey.values()) {
    const worker: any = workerById.get(activity.user_id);
    const section: any = sectionById.get(activity.section_id);
    if (!worker || !section || !assigned(section, worker)) continue;
    const key = `${worker.id}:${section.id}:${section.version ?? "1.0"}`;
    entries.set(key, makeEntry(worker, section, activity, acknowledgementsByKey.get(key)));
  }

  for (const saved of acknowledgementRows) {
    const worker: any = workerById.get(saved.worker_id);
    if (!worker) continue;
    const key = `${saved.worker_id}:${saved.section_id}:${saved.section_version}`;
    if (entries.has(key)) continue;
    entries.set(key, makeEntry(worker, {
      id: saved.section_id,
      title: saved.presentation_title,
      version: saved.section_version
    }, activityByKey.get(key), saved));
  }

  return jsonResponse({
    entries: Array.from(entries.values()).sort((left, right) =>
      left.workerName.localeCompare(right.workerName) ||
      left.presentationTitle.localeCompare(right.presentationTitle)
    )
  });
}

async function handleGetDriverTrainingAcknowledgements(env: Env, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("training_acknowledgements")
    .select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at")
    .eq("worker_id", driverId)
    .order("acknowledged_at", { ascending: false });
  if (error) throw error;
  return jsonResponse({
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
}

async function handleSubmitDriverTrainingAcknowledgement(request: Request, env: Env, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const schema = z.object({
    sectionId: z.string().min(1).max(200),
    sectionVersion: z.string().min(1).max(50),
    workerConfirmed: z.literal(true),
    signature: z.string().min(100).max(1_500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  });
  const payload = schema.parse(await request.json());
  const [{ data: worker, error: workerError }, { data: section, error: sectionError }] = await Promise.all([
    supabase.from("profiles").select("id, role, employment_type, staff_role").eq("id", driverId).maybeSingle(),
    supabase.from("learning_sections").select("id, title, version, audience, target_role, source_slide_id").eq("id", payload.sectionId).maybeSingle()
  ]);
  if (workerError) throw workerError;
  if (sectionError) throw sectionError;
  if (!worker || worker.role !== "driver") return errorResponse("Driver profile not found.", 404);
  if (!section || section.source_slide_id || (section.version ?? "1.0") !== payload.sectionVersion) {
    return errorResponse("This safety presentation is no longer available.", 404);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("contractor_profiles")
    .select("user_id")
    .eq("user_id", driverId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  const employmentType = worker.employment_type === "contractor" || Boolean(membership) ? "contractor" : "employee";
  const staffRole = worker.staff_role ?? "driver";
  if ((section.audience && section.audience !== "all" && section.audience !== employmentType) ||
      (section.target_role && section.target_role !== "all" && section.target_role !== staffRole)) {
    return errorResponse("This safety presentation is not assigned to your account.", 400);
  }

  const { data: activity, error: activityError } = await supabase
    .from("learning_section_completions")
    .select("completed")
    .eq("user_id", driverId)
    .eq("section_id", section.id)
    .eq("section_version", payload.sectionVersion)
    .eq("completed", true)
    .limit(1)
    .maybeSingle();
  if (activityError) throw activityError;
  if (!activity) {
    return errorResponse("Complete this Step 3 presentation before submitting its acknowledgement.", 400);
  }

  const { data: acknowledgement, error } = await supabase.from("training_acknowledgements").insert({
    worker_id: driverId,
    section_id: section.id,
    section_version: payload.sectionVersion,
    presentation_title: section.title?.trim() || "Untitled presentation",
    acknowledgement_statement: "I confirm that I watched/read and understood this safety presentation.",
    signature: payload.signature,
    recorded_by: driverId
  }).select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at").single();
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("training_acknowledgements")
      .select("id, section_id, section_version, acknowledgement_statement, acknowledged_at, signature, signed_at")
      .eq("worker_id", driverId)
      .eq("section_id", section.id)
      .eq("section_version", payload.sectionVersion)
      .single();
    if (existingError) throw existingError;
    return jsonResponse({
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
  }
  if (error) throw error;

  await logAuditEntry(supabase, driverId, "training_acknowledgement_recorded", {
    acknowledgementId: acknowledgement.id,
    sectionId: section.id,
    sectionVersion: payload.sectionVersion
  });
  return jsonResponse({
    acknowledgement: {
      id: acknowledgement.id,
      sectionId: acknowledgement.section_id,
      sectionVersion: acknowledgement.section_version,
      acknowledgementStatement: acknowledgement.acknowledgement_statement,
      acknowledgedAt: acknowledgement.acknowledged_at,
      signature: acknowledgement.signature,
      signedAt: acknowledgement.signed_at
    }
  }, 201);
}

async function handleGetInductionRecords(url: URL, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
  const workerId = url.searchParams.get("worker_id");

  let query = supabase
    .from("employee_induction_records")
    .select("*, worker:profiles!employee_induction_records_worker_id_fkey(id, full_name, email, phone, role, employment_type, staff_role, licence_class, licence_number, issuing_state, depot_location)")
    .order("updated_at", { ascending: false });

  if (workerId) {
    query = query.eq("worker_id", workerId);
  }

  const { data, error } = await query;
  if (error) throw error;
  const normalized = (data ?? []).map(normalizeEmployeeInductionRecord);
  return jsonResponse({ records: await attachDriverLegalSignoffs(supabase, normalized) });
}

function parseInductionRecordArray(value: unknown, column: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error(`Invalid ${column} data in employee induction record.`);
}

function normalizeEmployeeInductionRecord(record: Record<string, unknown>) {
  return {
    ...record,
    checklist: parseInductionRecordArray(record.checklist, "checklist"),
    documents: parseInductionRecordArray(record.documents, "documents"),
    acknowledgements: parseInductionRecordArray(record.acknowledgements, "acknowledgements"),
    signatures: parseInductionRecordArray(record.signatures, "signatures")
  };
}

async function attachDriverLegalSignoffs<T extends Record<string, unknown>>(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  records: T[]
) {
  const workerIds = [...new Set(records
    .map((record) => record.worker_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id)))];
  const { data: progressRows, error } = workerIds.length
    ? await supabase
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
      const { data, error: signingError } = await supabase.storage
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
    legal_signoff: typeof record.worker_id === "string" ? signoffByWorkerId.get(record.worker_id) ?? null : null
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

async function handleGetDriverInductionRecords(env: Env, driverId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("employee_induction_records")
    .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
    .eq("worker_id", driverId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return jsonResponse({ records: (data ?? []).map(normalizeEmployeeInductionRecord) });
}

async function handleSubmitDriverInductionRecordAcknowledgement(
  request: Request,
  env: Env,
  driverId: string,
  rawRecordId: string
) {
  const recordId = z.string().uuid().parse(rawRecordId);
  const payload = z.object({
    workerConfirmed: z.literal(true),
    signature: z.string().min(100).max(1_500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  }).parse(await request.json());
  const supabase = getSupabaseAdmin(env);
  const [{ data: worker, error: workerError }, { data: record, error: recordError }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, staff_role").eq("id", driverId).maybeSingle(),
    supabase.from("employee_induction_records")
      .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
      .eq("id", recordId)
      .eq("worker_id", driverId)
      .maybeSingle()
  ]);
  if (workerError) throw workerError;
  if (recordError) throw recordError;
  if (!worker || worker.role !== "driver" || !record) return errorResponse("Induction record not found.", 404);

  const acknowledgements = driverInductionAcknowledgementSchema.array().parse(
    parseInductionRecordArray(record.acknowledgements, "acknowledgements")
  );
  const signatures = inductionRecordSignatureSchema.array().parse(
    parseInductionRecordArray(record.signatures, "signatures")
  );
  const existingSignature = signatures.find((signature) =>
    signature.source === "driver" && signature.signerId === driverId
  );
  if (existingSignature) {
    return jsonResponse({ record: normalizeEmployeeInductionRecord(record) });
  }

  const statements = acknowledgements
    .filter((acknowledgement) => acknowledgement.source !== "driver")
    .map((acknowledgement) => acknowledgement.content.trim())
    .filter(Boolean);
  const submittedAt = new Date().toISOString();
  const acknowledgementContent = statements.length
    ? `I confirm that I have read and understood this Employee/Contractor Induction Record and acknowledge the following statements:\n\n${statements.map((statement) => `• ${statement}`).join("\n")}`
    : "I confirm that I have read and understood this Employee/Contractor Induction Record.";
  const nextAcknowledgements = [
    ...acknowledgements,
    {
      content: acknowledgementContent,
      acknowledged: true,
      date: submittedAt,
      source: "driver" as const,
      submittedBy: driverId
    }
  ];
  const nextSignatures = [
    ...signatures,
    {
      signer: worker.full_name?.trim() || "Driver",
      signerRole: record.role?.trim() || record.staff_role || worker.staff_role || "Driver",
      signature: payload.signature,
      signedAt: submittedAt,
      source: "driver" as const,
      signerId: driverId
    }
  ];
  const { data: updatedRecord, error: updateError } = await supabase
    .from("employee_induction_records")
    .update({ acknowledgements: nextAcknowledgements, signatures: nextSignatures, updated_at: submittedAt })
    .eq("id", recordId)
    .eq("worker_id", driverId)
    .eq("updated_at", record.updated_at)
    .select("id, worker_id, employment_type, staff_role, role, checklist, documents, acknowledgements, signatures, status, induction_start_date, induction_completed_date, created_by, created_at, updated_at")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updatedRecord) return errorResponse("This induction record changed while you were submitting. Reload it and try again.", 409);

  await logAuditEntry(supabase, driverId, "employee_induction_acknowledgement_recorded", { recordId });
  return jsonResponse({ record: normalizeEmployeeInductionRecord(updatedRecord) }, 201);
}

async function handleGetInductionRecord(env: Env, adminId: string, recordId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("employee_induction_records")
    .select("*, worker:profiles!employee_induction_records_worker_id_fkey(id, full_name, email, phone, role, employment_type, staff_role, licence_class, licence_number, issuing_state, depot_location)")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return errorResponse("Induction record not found.", 404);
  const [record] = await attachDriverLegalSignoffs(supabase, [normalizeEmployeeInductionRecord(data)]);
  return jsonResponse({ record });
}

async function handleCreateInductionRecord(request: Request, env: Env, adminId: string) {
  const supabase = getSupabaseAdmin(env);
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
  const payload = schema.parse(await request.json());

  const { data, error } = await supabase
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
      created_by: adminId
    })
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "induction_record_created", { recordId: data.id, workerId: payload.worker_id });
  const [record] = await attachDriverLegalSignoffs(supabase, [normalizeEmployeeInductionRecord(data)]);
  return jsonResponse({ record }, 201);
}

async function handleUpdateInductionRecord(request: Request, env: Env, adminId: string, recordId: string) {
  const supabase = getSupabaseAdmin(env);
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
  const payload = schema.parse(await request.json());

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

  const { data, error } = await supabase
    .from("employee_induction_records")
    .update(updateData)
    .eq("id", recordId)
    .select()
    .single();
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "induction_record_updated", { recordId, changes: payload });
  const [record] = await attachDriverLegalSignoffs(supabase, [normalizeEmployeeInductionRecord(data)]);
  return jsonResponse({ record });
}

async function handleDeleteInductionRecord(env: Env, adminId: string, recordId: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.from("employee_induction_records").delete().eq("id", recordId);
  if (error) throw error;

  await logAuditEntry(supabase, adminId, "induction_record_deleted", { recordId });
  return jsonResponse({ message: "Induction record deleted." });
}
