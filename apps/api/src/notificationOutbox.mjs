const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value ?? "soon")
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function getExpiryReminderStage(daysRemaining) {
  if (!Number.isFinite(daysRemaining) || daysRemaining > 30 || daysRemaining < -30) return null;
  if (daysRemaining > 14) return 30;
  if (daysRemaining > 7) return 14;
  if (daysRemaining > 1) return 7;
  return 1;
}

export function createNotificationEmail({
  eventType,
  organizationName = "BNT Logistics",
  appUrl = "",
  recipientName = "Worker",
  context = {}
}) {
  const name = escapeHtml(recipientName);
  const organization = escapeHtml(organizationName);
  const link = escapeHtml(appUrl);
  const wrap = (heading, body, color = "#1e3a5f") => ({
    subject: heading,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:32px"><h2 style="color:${color}">${heading}</h2><p>Hi ${name},</p>${body}<p><a href="${link}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Open ${organization} Induction</a></p></div>`
  });

  if (eventType === "document_expiring") {
    const documentType = escapeHtml(context.documentType ?? "compliance document");
    const expiryDate = escapeHtml(formatDate(context.expiryDate));
    return wrap("Action required: document expiry", `<p>Your <strong>${documentType}</strong> is due to expire on <strong>${expiryDate}</strong>. Please upload a current replacement or contact your administrator.</p>`, "#b45309");
  }
  if (eventType === "induction_expiring") {
    const expiryDate = escapeHtml(formatDate(context.expiryDate));
    return wrap("Action required: induction renewal", `<p>Your ${organization} induction certificate expires on <strong>${expiryDate}</strong>. Please log in and complete your renewal before then.</p>`, "#b45309");
  }
  if (eventType === "onboarding_incomplete") {
    const step = Math.min(6, Math.max(1, Number(context.nextStep) || 1));
    return wrap("Reminder: complete your induction", `<p>Your induction is not complete yet. Please continue from onboarding step <strong>${step} of 6</strong> to finish the required induction steps.</p>`);
  }
  if (eventType === "admin_approval_required") {
    const worker = escapeHtml(context.workerName ?? "A worker");
    const documentType = escapeHtml(context.documentType ?? "a document");
    return wrap("Worker document needs approval", `<p>${worker} has submitted <strong>${documentType}</strong> for review. Please open the admin portal to review the submission.</p>`);
  }
  if (eventType === "document_approved") {
    const documentType = escapeHtml(context.documentType ?? "document");
    return wrap("Your document has been approved", `<p>Your <strong>${documentType}</strong> has been approved. You can review your compliance status in the induction portal.</p>`);
  }
  throw new Error(`Unsupported notification event type: ${eventType}`);
}

function buildOutboxRow(input) {
  const email = createNotificationEmail(input);
  return {
    user_id: input.userId ?? null,
    recipient_email: input.email,
    event_type: input.eventType,
    subject: email.subject,
    html: email.html,
    context: input.context ?? {},
    dedupe_key: input.dedupeKey
  };
}

export async function enqueueNotifications(supabase, notifications) {
  if (!notifications.length) return 0;
  const rows = notifications.map(buildOutboxRow);
  const { data, error } = await supabase
    .from("notification_logs")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function dispatchNotificationOutbox(supabase, sendEmail, batchSize = 25) {
  const { data: notifications, error: claimError } = await supabase.rpc("claim_pending_notifications", {
    batch_size: batchSize
  });
  if (claimError) throw claimError;

  let sent = 0;
  let failed = 0;
  for (const notification of notifications ?? []) {
    try {
      const providerMessageId = await sendEmail(
        notification.recipient_email,
        notification.subject,
        notification.html,
        notification.id
      );
      const { error } = await supabase.from("notification_logs").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: providerMessageId ?? null,
        locked_at: null,
        last_error: null,
        updated_at: new Date().toISOString()
      }).eq("id", notification.id).eq("status", "processing");
      if (error) throw error;
      sent += 1;
    } catch (error) {
      const attempts = Number(notification.attempt_count) || 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const retryMinutes = Math.min(60, 5 * (2 ** Math.max(0, attempts - 1)));
      const { error: updateError } = await supabase.from("notification_logs").update({
        status: exhausted ? "failed" : "pending",
        next_attempt_at: new Date(Date.now() + retryMinutes * 60 * 1000).toISOString(),
        locked_at: null,
        last_error: String(error instanceof Error ? error.message : error).slice(0, 2000),
        updated_at: new Date().toISOString()
      }).eq("id", notification.id).eq("status", "processing");
      if (updateError) throw updateError;
      failed += 1;
      console.error(`[NOTIFICATIONS] Delivery failed for log ${notification.id} (attempt ${attempts}/${MAX_ATTEMPTS}):`, error);
    }
  }
  return { claimed: notifications?.length ?? 0, sent, failed };
}

function isoWeek(value) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function documentLabel(type) {
  return String(type ?? "compliance document").replace(/_/g, " ");
}

function checked(result) {
  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function collectScheduledNotifications(supabase, {
  now = new Date(),
  organizationName = "BNT Logistics",
  appUrl = ""
} = {}) {
  const profiles = checked(await supabase.from("profiles")
    .select("id, email, full_name, role")
    .in("role", ["driver", "admin"])
    .neq("full_name", "[DELETED]")
    .limit(10000));
  const workers = profiles.filter((profile) => profile.role === "driver" && profile.email);
  const admins = profiles.filter((profile) => profile.role === "admin" && profile.email);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const notifications = [];
  const week = isoWeek(now);

  if (workers.length) {
    const [progressRows, driverRows] = await Promise.all([
      supabase.from("induction_progress")
        .select("user_id, current_step, completed, completed_step_ids")
        .in("user_id", workers.map((worker) => worker.id))
        .limit(10000),
      supabase.from("drivers")
        .select("user_id, status")
        .in("user_id", workers.map((worker) => worker.id))
        .limit(10000)
    ]);
    const progress = checked(progressRows);
    const driverStatuses = checked(driverRows);
    const progressByUser = new Map(progress.map((row) => [row.user_id, row]));
    const completedWorkers = new Set(driverStatuses
      .filter((row) => String(row.status).toLowerCase() === "completed")
      .map((row) => row.user_id));
    for (const worker of workers) {
      const workerProgress = progressByUser.get(worker.id);
      if (workerProgress?.completed || completedWorkers.has(worker.id)) continue;
      const completedSteps = new Set(Array.isArray(workerProgress?.completed_step_ids)
        ? workerProgress.completed_step_ids.map(Number)
        : []);
      let nextStep = 1;
      while (nextStep < 6 && completedSteps.has(nextStep)) nextStep += 1;
      if (!completedSteps.size && Number(workerProgress?.current_step) > 1) {
        nextStep = Math.min(6, Number(workerProgress.current_step));
      }
      notifications.push({
        userId: worker.id,
        email: worker.email,
        eventType: "onboarding_incomplete",
        organizationName,
        appUrl,
        recipientName: worker.full_name || "Worker",
        context: { nextStep },
        dedupeKey: `onboarding:${worker.id}:${week}:step${nextStep}`
      });
    }
  }

  const expiryUpper = new Date(now.getTime() + 30 * DAY_MS).toISOString();
  const expiryLower = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const [documents, certificates] = await Promise.all([
    checked(await supabase.from("documents")
      .select("id, user_id, type, expires_at, uploaded_at, status")
      .not("expires_at", "is", null)
      .gte("expires_at", expiryLower)
      .lte("expires_at", expiryUpper)
      .limit(10000)),
    checked(await supabase.from("certificates")
      .select("id, user_id, expires_at")
      .gte("expires_at", expiryLower)
      .lte("expires_at", expiryUpper)
      .limit(10000))
  ]);

  for (const document of documents) {
    const worker = profileById.get(document.user_id);
    if (!worker?.email) continue;
    const daysRemaining = Math.ceil((new Date(document.expires_at).getTime() - now.getTime()) / DAY_MS);
    const stage = getExpiryReminderStage(daysRemaining);
    if (!stage) continue;
    const type = documentLabel(document.type);
    notifications.push({
      userId: worker.id,
      email: worker.email,
      eventType: "document_expiring",
      organizationName,
      appUrl,
      recipientName: worker.full_name || "Worker",
      context: { documentType: type, expiryDate: document.expires_at },
      dedupeKey: `document-expiry:${document.id}:${document.expires_at}:${stage}`
    });
  }

  for (const certificate of certificates) {
    const worker = profileById.get(certificate.user_id);
    if (!worker?.email) continue;
    const daysRemaining = Math.ceil((new Date(certificate.expires_at).getTime() - now.getTime()) / DAY_MS);
    const stage = getExpiryReminderStage(daysRemaining);
    if (!stage) continue;
    notifications.push({
      userId: worker.id,
      email: worker.email,
      eventType: "induction_expiring",
      organizationName,
      appUrl,
      recipientName: worker.full_name || "Worker",
      context: { expiryDate: certificate.expires_at },
      dedupeKey: `certificate-expiry:${certificate.id}:${certificate.expires_at}:${stage}`
    });
  }

  if (admins.length) {
    const pendingDocuments = checked(await supabase.from("documents")
      .select("id, user_id, type, uploaded_at")
      .eq("status", "pending")
      .limit(10000));
    for (const document of pendingDocuments) {
      const worker = profileById.get(document.user_id);
      for (const admin of admins) {
        notifications.push({
          userId: admin.id,
          email: admin.email,
          eventType: "admin_approval_required",
          organizationName,
          appUrl,
          recipientName: admin.full_name || "Administrator",
          context: { workerName: worker?.full_name || "A worker", documentType: documentLabel(document.type) },
          dedupeKey: `approval-needed:${document.id}:${document.uploaded_at ?? "submitted"}:${admin.id}`
        });
      }
    }
  }

  return notifications;
}

export async function runScheduledNotifications(supabase, sendEmail, options = {}) {
  const notifications = await collectScheduledNotifications(supabase, options);
  const queued = await enqueueNotifications(supabase, notifications);
  const delivery = await dispatchNotificationOutbox(supabase, sendEmail);
  return { discovered: notifications.length, queued, ...delivery };
}
