import type { SupabaseClient } from "@supabase/supabase-js";

type DriverRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  employment_type: string | null;
  staff_role: string | null;
  depot_location: string | null;
};

type ContractorRow = { user_id: string };

type DocumentRow = {
  id: string;
  user_id: string;
  type: string;
  file_url: string;
  file_name: string | null;
  mime_type: string | null;
  status: string | null;
  uploaded_at: string | null;
  expires_at: string | null;
  verified_at: string | null;
  verified_by_user_id: string | null;
  rejection_reason: string | null;
};

export type DriverMedicalFitnessReportRecord = {
  id: string;
  driverId: string;
  driverName: string;
  workerType: "employee" | "contractor" | "unknown";
  role: string;
  depotLocation: string | null;
  documentId: string | null;
  documentStatus: "missing" | "pending" | "approved" | "rejected";
  reviewStatus: "not_submitted" | "pending_review" | "reviewed" | "correction_required";
  assessmentDate: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  expiresAt: string | null;
  fileName: string | null;
  mimeType: string | null;
  previewUrl: string | null;
};

async function fetchRows<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(columns).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export async function handleDriverMedicalFitnessReport(
  db: SupabaseClient
): Promise<{ records: DriverMedicalFitnessReportRecord[] }> {
  const [profiles, contractorMemberships, documents] = await Promise.all([
    fetchRows<DriverRow>(db, "profiles", "id, full_name, role, employment_type, staff_role, depot_location"),
    fetchRows<ContractorRow>(db, "contractor_profiles", "user_id"),
    fetchRows<DocumentRow>(
      db,
      "documents",
      "id, user_id, type, file_url, file_name, mime_type, status, uploaded_at, expires_at, verified_at, verified_by_user_id, rejection_reason"
    )
  ]);

  const contractorIds = new Set(contractorMemberships.map((row) => row.user_id));
  const drivers = profiles
    .filter((profile) => profile.role !== "admin" && (profile.staff_role ?? "driver") === "driver")
    .sort((left, right) => String(left.full_name ?? "").localeCompare(String(right.full_name ?? "")));

  const latestMedicalByDriver = new Map<string, DocumentRow>();
  for (const document of documents) {
    if (document.type !== "medical_certificate") continue;
    const current = latestMedicalByDriver.get(document.user_id);
    if (!current || String(document.uploaded_at ?? "") > String(current.uploaded_at ?? "")) {
      latestMedicalByDriver.set(document.user_id, document);
    }
  }

  const records = await Promise.all(
    drivers.map(async (driver) => {
      const document = latestMedicalByDriver.get(driver.id) ?? null;
      let previewUrl: string | null = null;
      if (document?.file_url) {
        const { data: signedFile } = await db.storage.from("driver-documents").createSignedUrl(document.file_url, 10 * 60);
        previewUrl = signedFile?.signedUrl ?? null;
      }

      const workerType: DriverMedicalFitnessReportRecord["workerType"] =
        driver.employment_type === "employee" || driver.employment_type === "contractor"
          ? driver.employment_type
          : contractorIds.has(driver.id)
            ? "contractor"
            : "unknown";

      const rawStatus = String(document?.status ?? "missing").toLowerCase();
      const documentStatus: DriverMedicalFitnessReportRecord["documentStatus"] =
        rawStatus === "approved" || rawStatus === "pending" || rawStatus === "rejected"
          ? (rawStatus as "approved" | "pending" | "rejected")
          : "missing";

      const reviewStatus: DriverMedicalFitnessReportRecord["reviewStatus"] = !document
        ? "not_submitted"
        : document.status === "approved"
          ? "reviewed"
          : document.status === "rejected"
            ? "correction_required"
            : "pending_review";

      return {
        id: document?.id ?? driver.id,
        driverId: driver.id,
        driverName: driver.full_name?.trim() || "Name not recorded",
        workerType,
        role: driver.staff_role?.trim() || "Driver",
        depotLocation: driver.depot_location,
        documentId: document?.id ?? null,
        documentStatus,
        reviewStatus,
        assessmentDate: document?.uploaded_at ?? null,
        reviewedAt: document?.verified_at ?? null,
        reviewedBy: document?.verified_by_user_id ?? null,
        rejectionReason: document?.rejection_reason ?? null,
        expiresAt: document?.expires_at ?? null,
        fileName: document?.file_name ?? null,
        mimeType: document?.mime_type ?? null,
        previewUrl
      };
    })
  );

  return { records };
}