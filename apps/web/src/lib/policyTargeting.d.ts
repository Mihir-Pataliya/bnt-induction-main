export function isPolicyApplicableToWorker(
  policy: { audience?: string | null; target_role?: string | null },
  employmentType: string | null | undefined,
  staffRole: string | null | undefined
): boolean;
