export function isSOPApplicableToWorker(
  module: { audience?: string | null; target_role?: string | null; targetRole?: string | null },
  employmentType: string,
  staffRole?: string
): boolean;
