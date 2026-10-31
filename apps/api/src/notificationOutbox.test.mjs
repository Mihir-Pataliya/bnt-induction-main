import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectScheduledNotifications,
  createNotificationEmail,
  dispatchNotificationOutbox,
  enqueueNotifications,
  getExpiryReminderStage
} from "./notificationOutbox.mjs";

test("expiry notifications select the nearest reminder window", () => {
  assert.equal(getExpiryReminderStage(30), 30);
  assert.equal(getExpiryReminderStage(15), 30);
  assert.equal(getExpiryReminderStage(14), 14);
  assert.equal(getExpiryReminderStage(8), 14);
  assert.equal(getExpiryReminderStage(7), 7);
  assert.equal(getExpiryReminderStage(2), 7);
  assert.equal(getExpiryReminderStage(1), 1);
  assert.equal(getExpiryReminderStage(-30), 1);
  assert.equal(getExpiryReminderStage(31), null);
  assert.equal(getExpiryReminderStage(-31), null);
});

test("notification email escapes user-supplied content and retains six-step wording", () => {
  const email = createNotificationEmail({
    eventType: "onboarding_incomplete",
    recipientName: "<Worker>",
    context: { nextStep: 6 },
    appUrl: "https://example.test"
  });
  assert.match(email.html, /&lt;Worker&gt;/);
  assert.match(email.html, /step <strong>6 of 6<\/strong>/);
  assert.doesNotMatch(email.html, /<Worker>/);
});

test("outbox uses a stable idempotency key and records delivery results", async () => {
  const updates = [];
  let claimed = false;
  const supabase = {
    rpc: async (name) => {
      assert.equal(name, "claim_pending_notifications");
      return {
        data: claimed ? [] : [{
          id: "notification-1",
          recipient_email: "worker@example.test",
          subject: "Reminder",
          html: "<p>Reminder</p>",
          attempt_count: 1
        }],
        error: null
      };
    },
    from: (table) => {
      assert.equal(table, "notification_logs");
      return {
        update: (payload) => ({
          eq: (_column, id) => ({
            eq: async () => {
              updates.push({ payload, id });
              claimed = true;
              return { error: null };
            }
          })
        })
      };
    }
  };
  const delivered = [];
  const result = await dispatchNotificationOutbox(supabase, async (...args) => {
    delivered.push(args);
    return "provider-id";
  });
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(delivered[0][3], "notification-1");
  assert.equal(updates[0].id, "notification-1");
  assert.equal(updates[0].payload.status, "sent");
  assert.equal(updates[0].payload.provider_message_id, "provider-id");
});

test("enqueue ignores a previously recorded deduplication key", async () => {
  let alreadyQueued = false;
  let upsertOptions;
  const supabase = {
    from: () => ({
      upsert: (_rows, options) => {
        upsertOptions = options;
        return {
          select: async () => {
            if (alreadyQueued) return { data: [], error: null };
            alreadyQueued = true;
            return { data: [{ id: "notification-1" }], error: null };
          }
        };
      }
    })
  };
  const notification = {
    userId: "worker-1",
    email: "worker@example.test",
    eventType: "document_expiring",
    context: { documentType: "licence", expiryDate: "2026-10-28T00:00:00.000Z" },
    dedupeKey: "document-expiry:doc-1:2026-10-28:7"
  };
  assert.equal(await enqueueNotifications(supabase, [notification]), 1);
  assert.equal(await enqueueNotifications(supabase, [notification]), 0);
  assert.deepEqual(upsertOptions, { onConflict: "dedupe_key", ignoreDuplicates: true });
});

test("scheduled discovery includes incomplete progress, expiring documents and approval requests", async () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const profiles = [
    { id: "worker-1", email: "worker@example.test", full_name: "Worker", role: "driver" },
    { id: "worker-2", email: "complete@example.test", full_name: "Complete", role: "driver" },
    { id: "admin-1", email: "admin@example.test", full_name: "Admin", role: "admin" }
  ];
  const expiryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const dataByTable = {
    profiles,
    induction_progress: [{ user_id: "worker-1", current_step: 2, completed: false, completed_step_ids: [1] }],
    drivers: [
      { user_id: "worker-1", status: "In Progress" },
      { user_id: "worker-2", status: "Completed" }
    ],
    certificates: [{
      id: "certificate-1",
      user_id: "worker-1",
      expires_at: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString()
    }]
  };
  const pendingDocument = {
    id: "pending-doc",
    user_id: "worker-1",
    type: "medical_certificate",
    uploaded_at: "2026-10-20T10:00:00.000Z",
    status: "pending"
  };
  const expiringDocument = {
    id: "expiry-doc",
    user_id: "worker-1",
    type: "driver_license",
    expires_at: expiryDate,
    uploaded_at: "2026-01-01T00:00:00.000Z",
    status: "approved"
  };
  const supabase = {
    from(table) {
      const filters = {};
      const query = {
        select() { return this; },
        in() { return this; },
        neq() { return this; },
        not() { return this; },
        gte() { return this; },
        lte() { return this; },
        limit() { return this; },
        eq(column, value) { filters[column] = value; return this; },
        then(resolve) {
          const data = table === "documents"
            ? filters.status === "pending" ? [pendingDocument] : [expiringDocument]
            : dataByTable[table] ?? [];
          return Promise.resolve(resolve({ data, error: null }));
        }
      };
      return query;
    }
  };

  const notifications = await collectScheduledNotifications(supabase, {
    now,
    appUrl: "https://bnt.example.test",
    organizationName: "BNT Logistics"
  });
  assert.equal(notifications.length, 4);
  assert.ok(notifications.some((item) => item.eventType === "onboarding_incomplete" && item.context.nextStep === 2));
  assert.ok(notifications.some((item) => item.eventType === "document_expiring" && item.dedupeKey.endsWith(":7")));
  assert.ok(notifications.some((item) => item.eventType === "induction_expiring"));
  assert.ok(notifications.some((item) => item.eventType === "admin_approval_required"));
  assert.ok(notifications.every((item) => item.userId !== "worker-2"));
});

test("failed email delivery is returned to the retry queue with an error log", async () => {
  let update;
  const supabase = {
    rpc: async () => ({
      data: [{
        id: "retry-notification",
        recipient_email: "worker@example.test",
        subject: "Reminder",
        html: "<p>Reminder</p>",
        attempt_count: 2
      }],
      error: null
    }),
    from: () => ({
      update: (payload) => ({
        eq: () => ({
          eq: async () => {
            update = payload;
            return { error: null };
          }
        })
      })
    })
  };
  const result = await dispatchNotificationOutbox(supabase, async () => {
    throw new Error("temporary provider failure");
  });
  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.equal(update.status, "pending");
  assert.match(update.last_error, /temporary provider failure/);
  assert.ok(Date.parse(update.next_attempt_at) > Date.now());
});
