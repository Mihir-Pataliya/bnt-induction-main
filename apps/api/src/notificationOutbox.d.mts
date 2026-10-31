export interface ScheduledNotificationOptions {
  now?: Date;
  organizationName?: string;
  appUrl?: string;
}

export interface OutboxNotification {
  userId?: string;
  email: string;
  eventType: "document_expiring" | "induction_expiring" | "onboarding_incomplete" | "admin_approval_required" | "document_approved";
  organizationName?: string;
  appUrl?: string;
  recipientName?: string;
  context?: Record<string, string | number>;
  dedupeKey: string;
}

export function getExpiryReminderStage(daysRemaining: number): number | null;
export function createNotificationEmail(input: Omit<OutboxNotification, "email" | "userId" | "dedupeKey">): { subject: string; html: string };
export function enqueueNotifications(supabase: any, notifications: OutboxNotification[]): Promise<number>;
export function dispatchNotificationOutbox(
  supabase: any,
  sendEmail: (to: string, subject: string, html: string, idempotencyKey: string) => Promise<string | void>,
  batchSize?: number
): Promise<{ claimed: number; sent: number; failed: number }>;
export function collectScheduledNotifications(supabase: any, options?: ScheduledNotificationOptions): Promise<OutboxNotification[]>;
export function runScheduledNotifications(
  supabase: any,
  sendEmail: (to: string, subject: string, html: string, idempotencyKey: string) => Promise<string | void>,
  options?: ScheduledNotificationOptions
): Promise<{ discovered: number; queued: number; claimed: number; sent: number; failed: number }>;
