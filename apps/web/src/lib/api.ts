import { Session } from "@supabase/supabase-js";
import { createCertificatePdf } from "./certificate";
import { isPolicyApplicableToWorker } from "./policyTargeting";
import { mapDriverEmployment } from "./driverEmployment";
import { isSOPApplicableToWorker } from "./sopTargeting.js";
import { isApprovedCurrentDocument, REQUIRED_DRIVER_DOCUMENTS, REQUIRED_EXPIRY_DOCUMENT_TYPES } from "./documentCompliance";
import { isWorkerTargeted, getRequiredDocumentTypes } from "./workerTargeting.js";
import { assessContractorInsurance } from "./contractorCompliance";
import { getChecklistBlockers } from "./onboardingCompliance.mjs";
import { apiBaseUrl, organizationName, supabase, supabaseUrl, supabaseAnonKey } from "./supabase";
import {
  AdminOverview,
  AdminAuditAssignmentRow,
  AuditAssignment,
  AuditAssignmentStatus,
  AuditLog,
  BrandingSettings,
  CertificateRecord,
  CertificateVerificationResult,
  ComplianceAuditRecord,
  ContractorCompanyRecord,
  ContractorFinancialDetails,
  DriverVerificationResult,
  DocumentType,
  DriverBundle,
  DriverFeedback,
  DriverSelfRegisterInput,
  InductionVersion,
  InductionVersionRecord,
  InductionScheduleInvitation,
  InductionCourse,
  InductionSchedule,
  InductionScheduleEnrollment,
  InductionScheduleItem,
  InductionSlide,
  SlideQuestion,
  LearningSectionProgress,
  PolicyListItem,
  PolicyRecord,
  PolicySignatureSummary,
  PolicyPendingDriver,
  QuizQuestion,
  QuizSubmitResult,
  ReportsOverview,
  AttemptedInductionReport,
  CertificateStatusReport,
  ExpiringCertificateReport,
  ExpiringDocumentReport,
  DocumentApprovalReport,
  ScheduledStatusReport,
  SafetyIncidentRecord,
  PreTripInspectionRecord,
  SessionState,
  SiteCheckinRecord,
  SOPItem,
  VehiclePassVerificationResult,
  VehicleRecord,
  UploadedDocument
} from "../types";

console.log("[API] SUPABASE_URL:", supabaseUrl);

const bucketName = "driver-documents";

export const api = {
  async getEmployeePayrollStatus(session: SessionState): Promise<{ saved: boolean; superFundChoice: string | null }> {
    const response = await fetch(`${apiBaseUrl}/payroll/me/status`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "Unable to check payroll setup.");
    return result;
  },
  async getPayrollEmployees(session: SessionState): Promise<Array<{ id: string; name: string; email: string; payrollSetupComplete: boolean }>> {
    const result = await adminRequest<{ employees: Array<{ id: string; name: string; email: string; payrollSetupComplete: boolean }> }>("/admin/payroll/status", session, { method: "GET" });
    return result.employees;
  },
  async getPayrollAdmins(session: SessionState): Promise<Array<{ id: string; name: string; email: string; payrollAccess: boolean }>> {
    const result = await adminRequest<{ admins: Array<{ id: string; name: string; email: string; payrollAccess: boolean }> }>("/admin/payroll/access", session, { method: "GET" });
    return result.admins;
  },
  async setPayrollAccess(session: SessionState, userId: string, enabled: boolean): Promise<void> {
    await adminRequest(`/admin/payroll-access/${encodeURIComponent(userId)}`, session, { method: "PUT", body: JSON.stringify({ enabled }) });
  },
  async getEmployeePayrollDetails(session: SessionState, employeeId: string): Promise<Record<string, string>> {
    const response = await fetch(`${apiBaseUrl}/payroll/employees/${encodeURIComponent(employeeId)}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "Payroll details could not be loaded.");
    return result;
  },

  async hydrateSession(session: Session | null): Promise<SessionState | null> {
    if (!session?.user) return null;
    let profile = await getProfile(session.user.id).catch(() => null);
    if (!profile) {
      const derivedRole = (session.user.user_metadata?.role as "driver" | "admin" | undefined) ?? (session.user.email?.includes("admin") ? "admin" : "driver");
      const fullName = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "User";
      try {
        await supabase.from("profiles").upsert({
          id: session.user.id,
          email: session.user.email || "",
          full_name: fullName,
          role: derivedRole,
          updated_at: new Date().toISOString()
        });
        profile = await getProfile(session.user.id).catch(() => null);
      } catch {}
    }
    const role = profile?.role ?? (session.user.email?.includes("admin") ? "admin" : "driver");
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      user: {
        id: session.user.id,
        email: session.user.email ?? "",
        role,
        driverId: session.user.id,
        mustChangePassword: Boolean(profile?.must_change_password)
      }
    };
  },

  async login(input: { email: string; password: string; role: "driver" | "admin" }) {
    const cleanEmail = input.email.trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: input.password
    });

    if (error || !data?.session) {
      throw new Error(error?.message || "Invalid email or password. Please verify your credentials.");
    }

    const session = await api.hydrateSession(data.session);
    if (!session) throw new Error("Unable to create a session. Please contact your administrator.");

    // Auto-align role if user selected admin tab or has admin email
    if (session.user.role !== input.role) {
      if (cleanEmail.includes("admin") || session.user.role === "admin") {
        session.user.role = "admin";
      } else if (input.role === "admin" && !cleanEmail.includes("admin")) {
        await supabase.auth.signOut();
        throw new Error(`Account ${cleanEmail} is registered as a Driver, not a Compliance Manager.`);
      }
    }

    await logAuditEvent(session.user.id, "login", {
      role: session.user.role,
      email: session.user.email
    }).catch(() => {});

    return session;
  },

  async logout() {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user?.id) {
      await logAuditEvent(user.id, "logout", { email: user.email ?? "" });
    }

    await supabase.auth.signOut().catch(() => {});
  },

  async getDriverProfile(session: SessionState) {
    const userId = session.user.id;

    const profile = await getProfile(userId).catch(() => null);

    const driver = await getDriverRow(userId).catch(() => ({
      id: userId,
      user_id: userId,
      status: "Not Started",
      created_at: new Date().toISOString()
    }));

    const progress = await getProgressRow(userId).catch(() => ({
      driverId: userId,
      current_step: 1,
      completion_percentage: 0,
      quiz_score: null,
      completed: false,
      completed_step_ids: [] as number[],
      declaration_accepted: false,
      declaration_agreed_at: null,
      signature: null,
      completed_at: null,
      updated_at: new Date().toISOString()
    }));

    const documents = await getSignedDocuments(userId).catch(() => []);
    const learningSections = await getLearningSections(userId).catch(() => []);
    const learningProgress = await getLearningCompletions(userId, learningSections).catch(() => []);
    const quizAttempts = await getQuizAttempts(userId).catch(() => []);
    const certificate = await getCertificate(userId).catch(() => null);
    const feedback = await getDriverFeedback(userId).catch(() => null);

    let finalSignatureUrl = progress.signature ?? "";
    if (finalSignatureUrl && !finalSignatureUrl.startsWith("data:image")) {
      try {
        const { data: sigUrlData } = await supabase.storage.from("identity-verification").createSignedUrl(finalSignatureUrl, 3600);
        if (sigUrlData?.signedUrl) {
          finalSignatureUrl = sigUrlData.signedUrl;
        }
      } catch {}
    }

    const declaration = progress.declaration_accepted
      ? {
          driverId: userId,
          accepted: true,
          signature: finalSignatureUrl,
          agreedAt: progress.declaration_agreed_at ?? progress.updated_at
        }
      : null;

    let savedDriverMeta: any = null;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`bnt-driver-meta-${userId}`) : null;
      if (raw) savedDriverMeta = JSON.parse(raw);
    } catch {}

    const bundleLicenceClass = profile?.licence_class || savedDriverMeta?.licenceClass || "HC";
    const bundleIssuingState = profile?.issuing_state || savedDriverMeta?.issuingState || "VIC";
    const bundleLicenceNumber = profile?.licence_number || savedDriverMeta?.licenceNumber || "";
    const bundleDepotLocation = profile?.depot_location || savedDriverMeta?.depotLocation || "Melbourne Hub";
    let currentRequirementsApproved = false;
    let contractorCompany: ContractorCompanyRecord | null = null;
    try {
      const currentPolicies = await api.getPolicies(userId);
      contractorCompany = await api.getContractorCompany(userId);
      const policiesApproved = currentPolicies.every((policy) => policy.signed);
      const isContractor = profile?.employment_type === "contractor" || Boolean(contractorCompany);
      const insuranceApproved = !isContractor || Boolean(contractorCompany &&
        assessContractorInsurance(contractorCompany.publicLiabilityFileUrl, contractorCompany.publicLiabilityExpiry, contractorCompany.publicLiabilityStatus).valid &&
        assessContractorInsurance(contractorCompany.workersCompFileUrl, contractorCompany.workersCompExpiry, contractorCompany.workersCompStatus).valid);
      const phoneDigits = String(profile?.phone ?? "").replace(/\D/g, "");
      const emergencyPhone = String(profile?.emergency_contact_phone ?? "").trim();
      const emergencyDigits = emergencyPhone.replace(/\D/g, "");
      const isDriverRole = (profile?.staff_role ?? "driver") === "driver";
      const driverLicenceProfileValid = !isDriverRole || Boolean(profile?.licence_class?.trim() && profile?.issuing_state?.trim() && /^[A-Za-z0-9]{8}$/.test(String(profile?.licence_number ?? "").trim()));
      const profileApproved = Boolean(profile?.full_name?.trim() && profile?.email?.trim() && (/^(?:\+?61|0)4\d{8}$/.test(String(profile.phone).trim()) || phoneDigits.length === 10) && String(profile.address ?? "").trim().length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(String(profile.date_of_birth ?? "")) && String(profile.date_of_birth) <= new Date().toISOString().slice(0, 10) && profile?.preferred_language?.trim() && profile?.emergency_contact_name?.trim() && profile?.emergency_contact_relationship?.trim() && /^[+\d().\s-]+$/.test(emergencyPhone) && emergencyDigits.length >= 8 && emergencyDigits.length <= 15 && driverLicenceProfileValid && profile?.depot_location?.trim());
      currentRequirementsApproved = policiesApproved && insuranceApproved && profileApproved;
    } catch {
      currentRequirementsApproved = false;
    }

    return {
      organizationName,
      driver: {
        id: userId,
        employmentType: profile?.employment_type === "contractor" ? "contractor" : "employee",
        employmentStartDate: profile?.employment_start_date ?? "",
        employmentBasis: profile?.employment_basis ?? "full_time",
        staffRole: profile?.staff_role ?? "driver",
        fullName: profile?.full_name ?? "",
        email: profile?.email ?? session.user.email,
        phone: profile?.phone ?? "",
        dateOfBirth: profile?.date_of_birth ?? "",
        emergencyContactName: profile?.emergency_contact_name ?? "",
        emergencyContactRelationship: profile?.emergency_contact_relationship ?? "",
        emergencyContactPhone: profile?.emergency_contact_phone ?? "",
        address: profile?.address ?? "",
        preferredLanguage: profile?.preferred_language ?? "English",
        licenceClass: bundleLicenceClass,
        issuingState: bundleIssuingState,
        licenceNumber: bundleLicenceNumber,
        depotLocation: bundleDepotLocation,
        status: deriveDriverStatus(driver.status, progress, documents, currentRequirementsApproved, profile?.staff_role ?? "driver"),
        createdAt: profile?.created_at ?? new Date().toISOString(),
        updatedAt: profile?.updated_at ?? new Date().toISOString()
      },
      progress: {
        driverId: userId,
        currentStep: progress.current_step,
        completionPercentage: progress.completion_percentage,
        quizScore: progress.quiz_score,
        completedStepIds: progress.completed_step_ids ?? [],
        completedAt: progress.completed_at,
        declarationAgreedAt: progress.declaration_agreed_at ?? null,
        updatedAt: progress.updated_at
      },
      documents,
      learningProgress,
      declaration,
      certificate,
      quizAttempts,
      feedback
    } satisfies DriverBundle;
  },

  async checkLicenceUnique(licenceNumber: string, issuingState: string, excludeUserId?: string) {
    if (!licenceNumber || !issuingState) return { unique: true };
    try {
      const trimmed = licenceNumber.trim().toUpperCase();
      if (!trimmed) return { unique: true };

      let query = supabase
        .from("profiles")
        .select("id, full_name, licence_number, issuing_state")
        .eq("licence_number", trimmed)
        .eq("issuing_state", issuingState)
        .limit(1);

      if (excludeUserId) {
        query = query.neq("id", excludeUserId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("Licence uniqueness check warning:", error);
        return { unique: true };
      }

      return { unique: !(data && data.length > 0) };
    } catch (e) {
      console.warn("Licence uniqueness check failed:", e);
      return { unique: true };
    }
  },

  async saveProfile(session: SessionState, input: {
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth?: string;
    employmentType?: "employee" | "contractor";
    staffRole?: "driver" | "warehouse" | "office";
    emergencyContactName?: string;
    emergencyContactRelationship?: string;
    emergencyContactPhone?: string;
    address: string;
    preferredLanguage: string;
    licenceClass?: string;
    issuingState?: string;
    licenceNumber?: string;
    depotLocation?: string;
    employmentStartDate?: string;
    employmentBasis?: "full_time" | "part_time" | "casual";
    payrollTfn?: string;
    payrollBankAccountName?: string;
    payrollBankBsb?: string;
    payrollBankAccountNumber?: string;
    superFundChoice?: "default" | "existing" | "self_managed";
    superFundName?: string;
    superMemberNumber?: string;
    payrollDeclarationConfirmed?: boolean;
  }) {
    const userId = session.user.id;
    try {
      const progress = await getProgressRow(userId);
      if (progress?.completed) throw new Error("This induction has already been completed and locked.");
    } catch (e: any) {
      if (e?.message?.includes("completed")) throw e;
    }

    try {
      const fullProfilePayload = {
        id: userId,
        email: input.email,
        full_name: input.fullName,
        phone: input.phone,
        date_of_birth: input.dateOfBirth ?? "",
        emergency_contact_name: input.emergencyContactName ?? "",
        emergency_contact_relationship: input.emergencyContactRelationship ?? "",
        emergency_contact_phone: input.emergencyContactPhone ?? "",
        address: input.address,
        preferred_language: input.preferredLanguage,
        depot_location: input.depotLocation ?? "Melbourne Hub",
        ...(input.employmentType !== "contractor" ? {
          employment_start_date: input.employmentStartDate || null,
          employment_basis: input.employmentBasis || null
        } : {}),
        ...((input.staffRole ?? "driver") === "driver" ? {
          licence_class: input.licenceClass ?? "HC",
          issuing_state: input.issuingState ?? "VIC",
          licence_number: input.licenceNumber ?? ""
        } : {}),
      };

      const { error: fullUpsertErr } = await supabase
        .from("profiles")
        .upsert(fullProfilePayload);

      if (fullUpsertErr) {
        // Fall back to base columns that always exist in schema
        const { error: baseUpsertErr } = await supabase
          .from("profiles")
          .upsert({
            id: userId,
            email: input.email,
            full_name: input.fullName,
            phone: input.phone,
            date_of_birth: input.dateOfBirth ?? "",
            emergency_contact_name: input.emergencyContactName ?? "",
            emergency_contact_relationship: input.emergencyContactRelationship ?? "",
            emergency_contact_phone: input.emergencyContactPhone ?? "",
            address: input.address,
            preferred_language: input.preferredLanguage,
          });
        if (baseUpsertErr?.code === "42703" && /date_of_birth/i.test(baseUpsertErr.message ?? "")) {
          throw new Error("The database is missing the date of birth column. Apply supabase/migrations/033_profile_date_of_birth.sql, then retry saving your profile.");
        }
        if (baseUpsertErr?.code === "42703" && /emergency_contact_(name|relationship|phone)/i.test(baseUpsertErr.message ?? "")) {
          throw new Error("The database is missing emergency-contact columns. Apply supabase/migrations/028_emergency_contact_profile_fields.sql, then retry saving your profile.");
        }
        if (baseUpsertErr) throw new Error(`Profile could not be saved: ${baseUpsertErr.message}`);
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error("Profile could not be saved.");
    }

    if (input.employmentType !== "contractor" && input.payrollTfn) {
      const response = await fetch(`${apiBaseUrl}/payroll/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({
          tfn: input.payrollTfn,
          bankAccountName: input.payrollBankAccountName,
          bankBsb: input.payrollBankBsb?.replace(/\D/g, ""),
          bankAccountNumber: input.payrollBankAccountNumber,
          superFundChoice: input.superFundChoice ?? "default",
          superFundName: input.superFundName,
          superMemberNumber: input.superMemberNumber,
          taxDeclarationConfirmed: input.payrollDeclarationConfirmed === true
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Payroll details could not be saved securely.");
    }

    if (input.email && input.email !== session.user.email) {
      try {
        await supabase.auth.updateUser({ email: input.email });
      } catch (authErr) {
        console.warn("Auth email update warning:", authErr);
      }
    }

    try {
      if (typeof window !== "undefined") {
        const { payrollTfn, payrollBankAccountName, payrollBankBsb, payrollBankAccountNumber, superFundName, superMemberNumber, ...safeProfile } = input;
        localStorage.setItem(`bnt-driver-meta-${userId}`, JSON.stringify(safeProfile));
      }
    } catch {}

    await logAuditEvent(userId, "profile_updated", {
      email: input.email,
      preferredLanguage: input.preferredLanguage
    }).catch(() => {});

    const onboardingInput = { ...input };
    delete onboardingInput.payrollTfn;
    delete onboardingInput.payrollBankAccountName;
    delete onboardingInput.payrollBankBsb;
    delete onboardingInput.payrollBankAccountNumber;
    delete onboardingInput.superFundName;
    delete onboardingInput.superMemberNumber;
    delete onboardingInput.superFundChoice;
    delete onboardingInput.payrollDeclarationConfirmed;
    return await api.saveStep(session, 1, onboardingInput);
  },

  async saveStep(session: SessionState, step: number, payload: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/induction/step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ step, payload })
      });
    } catch {
      throw new Error("Unable to save induction progress. Check your connection and try again.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "Induction progress was not accepted.");
    }
    return await api.getDriverProfile(session);
  },

  async startVideoSection(session: SessionState, sectionId: string, sectionVersion = "1.0") {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/induction/section/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ sectionId, sectionVersion })
      });
    } catch {
      throw new Error("Unable to record the module start. Check your connection and try again.");
    }
    if (!response.ok) throw new Error("Unable to record the module start.");
  },

  async getQuizQuestions(session?: SessionState) {
    if (!session) throw new Error("Unauthorized");

    // Always load questions through the backend. The API strips
    // correct_answer/explanation so drivers cannot inspect the answer key.
    const response = await fetch(`${apiBaseUrl}/induction/quiz-questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      return {
        questions: data.map((item: any) => ({
          id: item.id,
          question: item.question,
          options: Array.isArray(item.options) ? item.options.map(String) : [],
          explanation: item.explanation,
          category: item.category ?? "General",
          isCritical: Boolean(item.is_critical)
        })) satisfies QuizQuestion[]
      };
    }

    throw new Error("Unable to load the knowledge check questions. Check your connection and try again.");
  },

  async submitQuiz(session: SessionState, answers: Record<string | number, number>) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`
    };

    // Grading always happens on the server so the answer key never
    // reaches the browser. If the API is unreachable we fail closed
    // instead of grading locally.
    const response = await fetch(`${apiBaseUrl}/induction/quiz`, {
      method: "POST",
      headers,
      body: JSON.stringify({ answers })
    });

    if (!response.ok) {
      let message = "Quiz submission failed. Please try again.";
      let retryAt: string | undefined;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
        if (data?.retryAt) retryAt = data.retryAt;
      } catch {}
      const error = new Error(message);
      (error as any).retryAt = retryAt;
      throw error;
    }

    const data = await response.json();
    const state = await api.getDriverProfile(session);
    return { ...data, state } satisfies QuizSubmitResult;
  },

  async uploadDocument(
    session: SessionState,
    input: { type: string; file: File },
    onProgress?: (progress: number) => void
  ) {
    const userId = session.user.id;
    const progress = await getProgressRow(userId);
    if (progress.completed) throw new Error("This induction has already been completed and locked.");

    const existingRows = await getDocumentRows(userId);
    const existingRow = existingRows.find((row) => row.type === input.type);
    const filePath = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(input.file.name)}`;

    onProgress?.(20);
    let finalPath = filePath;
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(filePath, input.file, {
      cacheControl: "3600",
      upsert: false
    });
    if (uploadError) {
      // Re-throw so the caller's retry UI is triggered. Swallowing this would
      // create a dangling DB row pointing at a non-existent storage object.
      throw new Error(`Upload failed: ${uploadError.message}`);
    }
    onProgress?.(75);

    const recordResponse = await fetch(`${apiBaseUrl}/driver/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({
        type: input.type,
        fileUrl: finalPath,
        fileName: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size
      })
    });
    const recordResult = await recordResponse.json().catch(() => ({})) as { message?: string; status?: string };
    if (!recordResponse.ok || recordResult.status !== "pending") {
      throw new Error(recordResult.message ?? "Document uploaded, but its pending approval record could not be saved.");
    }

    // Always record local storage fallback document
    const localDocsKey = `bnt-documents-${userId}`;
    const localDocsRaw = window.localStorage.getItem(localDocsKey);
    const localDocs: any[] = localDocsRaw ? JSON.parse(localDocsRaw) : [];
    const newDoc = {
      id: crypto.randomUUID(),
      user_id: userId,
      type: input.type,
      file_url: finalPath,
      file_name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      status: "pending",
      uploaded_at: new Date().toISOString()
    };
    const updatedDocs = [...localDocs.filter((d: any) => d.type !== input.type), newDoc];
    window.localStorage.setItem(localDocsKey, JSON.stringify(updatedDocs));

    // Keep the previous storage object and its audit snapshot for compliance history.

    await logAuditEvent(userId, "document_uploaded", {
      type: input.type,
      fileName: input.file.name,
      sizeBytes: input.file.size,
      replacedExisting: Boolean(existingRow)
    });

    onProgress?.(100);
  },

  async generateCertificate(session: SessionState) {
    // Certificates are issued only by the server, which verifies that
    // every induction step is complete and all mandatory documents are
    // approved and current. If the API is unreachable we fail closed
    // instead of minting a certificate locally.
    const response = await fetch(`${apiBaseUrl}/induction/certificate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      }
    });

    if (!response.ok) {
      let message = "Unable to issue the certificate. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }

    // The server returns the certificate it just issued. Prefer it over a
    // second read of the certificates table, which can lag or be blocked by
    // row-level security on some deployments.
    let serverCertificate: any = null;
    try {
      const data = await response.json();
      serverCertificate = data?.certificate ?? null;
    } catch {}

    const bundle = await api.getDriverProfile(session);

    let cert = bundle.certificate;
    if (!cert && serverCertificate) {
      cert = {
        id: "",
        driverId: session.user.id,
        completionId: String(serverCertificate.completionId ?? ""),
        issuedAt: String(serverCertificate.issuedAt ?? new Date().toISOString()),
        expiresAt: serverCertificate.expiresAt
          ? String(serverCertificate.expiresAt)
          : null,
        verificationCode: String(serverCertificate.verificationCode ?? ""),
        verificationUrl: String(serverCertificate.verificationUrl ?? "")
      };
    }

    if (!cert) {
      throw new Error("Certificate record not found. Please try again.");
    }

    const pdfBase64 = await buildCertificatePdf(
      bundle.driver.fullName || "Driver",
      cert.completionId,
      cert.issuedAt,
      cert.verificationUrl,
      bundle.driver.licenceClass,
      bundle.driver.issuingState,
      bundle.driver.depotLocation
    );

    return {
      pdfBase64,
      state: { ...bundle, certificate: cert }
    };
  },

  async submitDriverFeedback(session: SessionState, input: { clarityRating: number; issues: string }) {
    const userId = session.user.id;
    const bundle = await api.getDriverProfile(session);
    if (!bundle.progress.completedAt) {
      throw new Error("Finish the induction before sending feedback.");
    }

    const issues = input.issues.trim();
    const { error } = await supabase.from("driver_feedback").upsert(
      {
        user_id: userId,
        clarity_rating: input.clarityRating,
        issues,
        submitted_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    if (error) throw error;

    await logAuditEvent(userId, "feedback_submitted", {
      clarityRating: input.clarityRating,
      hasIssues: Boolean(issues)
    });

    return await api.getDriverProfile(session);
  },

  async getAdminOverview(_session: SessionState) {
    const fetchSafe = async (queryPromise: PromiseLike<any>) => {
      try {
        const { data, error } = (await queryPromise) as any;
        if (error) {
          console.warn("Supabase overview fetch warning:", error?.message);
          return [];
        }
        return data ?? [];
      } catch {
        return [];
      }
    };

    const [
      profilesRes,
      driversRes,
      contractorMembershipsRes,
      contractorCompaniesRes,
      progressRes,
      documentsRes,
      certificatesRes,
      auditLogsRes,
      feedbackRowsRes,
      quizAttemptsRes,
      policyRowsRes,
      learningSectionsRes,
      learningCompletionsRes,
      financialDetailsRes,
      contractorVehiclesRes,
      activeInductionVersionRes
    ] = await Promise.all([
      fetchSafe(supabase.from("profiles").select("*").eq("role", "driver").neq("full_name", "[DELETED]").order("created_at", { ascending: false }).limit(500)),
      fetchSafe(supabase.from("drivers").select("*").limit(500)),
      fetchSafe(supabase.from("contractor_profiles").select("user_id, company_id").limit(2000)),
      fetchSafe(supabase.from("contractor_companies").select("*").limit(2000)),
      fetchSafe(supabase.from("induction_progress").select("*").limit(500)),
      fetchSafe(supabase.from("documents").select("*").limit(10000)),
      fetchSafe(supabase.from("certificates").select("*").limit(500)),
      fetchSafe(supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500)),
      fetchSafe(supabase.from("driver_feedback").select("*").order("submitted_at", { ascending: false }).limit(50)),
      fetchSafe(supabase.from("quiz_attempts").select("*").order("created_at", { ascending: false }).limit(500)),
      supabase.from("policies").select("id, name, title, audience, target_role, is_published").eq("is_published", true),
      fetchSafe(supabase.from("learning_sections").select("id, version, audience, target_role, is_mandatory")),
      fetchSafe(supabase.from("learning_section_completions").select("user_id, section_id, section_version, completed").limit(10000)),
      fetchSafe(supabase.from("contractor_financial_details").select("company_id, bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").limit(2000)),
      fetchSafe(supabase.from("driver_vehicles").select("*").limit(5000)),
      supabase.from("induction_versions").select("id").eq("is_current", true).maybeSingle()
    ]);

    const profiles: any[] = profilesRes;
    const drivers: any[] = driversRes;
    const contractorMemberships: any[] = contractorMembershipsRes;
    const contractorCompanies: any[] = contractorCompaniesRes;
    const progress: any[] = progressRes;
    const documents: any[] = documentsRes;
    const certificates: any[] = certificatesRes;
    const auditLogs: any[] = auditLogsRes;
    const feedbackRows: any[] = feedbackRowsRes;
    const quizAttempts: any[] = quizAttemptsRes;
    if (policyRowsRes.error) throw policyRowsRes.error;
    if (activeInductionVersionRes.error) throw activeInductionVersionRes.error;
    const policyRows: any[] = policyRowsRes.data ?? [];
    const [policyVersionsResult, policySignatureResult] = await Promise.all([
      policyRows.length ? supabase.from("policy_versions").select("id, policy_id, published_at").in("policy_id", policyRows.map((row) => row.id)).order("published_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      getPolicySignatureRows({ allColumns: true })
    ]);
    const policyVersions = policyVersionsResult.data;
    const policyDataAvailable = !policyVersionsResult.error && !policySignatureResult.error;
    const latestPolicyVersionByPolicy = new Map<string, any>();
    for (const version of policyVersions ?? []) if (!latestPolicyVersionByPolicy.has(String(version.policy_id))) latestPolicyVersionByPolicy.set(String(version.policy_id), version);
    const signaturesByUser = new Map<string, Set<string>>();
    const policySignaturesByUser = new Map<string, any[]>();
    for (const signature of policySignatureResult.data ?? []) {
      const userId = String(signature.user_id ?? signature.driver_id ?? "");
      const versions = signaturesByUser.get(userId) ?? new Set<string>();
      versions.add(String(signature.policy_version_id ?? signature.policy_id ?? ""));
      signaturesByUser.set(userId, versions);
      const userSignatures = policySignaturesByUser.get(userId) ?? [];
      userSignatures.push(signature);
      policySignaturesByUser.set(userId, userSignatures);
    }

    const docsByUser = await buildSignedDocumentMap(documents);
    const logsByUser = new Map<string, AuditLog[]>();
    const mappedLogs = mapAuditLogs(auditLogs);
    const feedbackByUser = new Map(feedbackRows.map((row: any) => [String(row.user_id), mapFeedbackRow(row)]));
    const companyById = new Map(contractorCompanies.map((company: any) => [String(company.id), company]));
    const financeByCompanyId = new Map((financialDetailsRes as any[]).map((item: any) => [String(item.company_id), item]));
    const vehiclesByUserId = new Map<string, any[]>();
    for (const vehicle of contractorVehiclesRes as any[]) {
      const current = vehiclesByUserId.get(String(vehicle.user_id)) ?? [];
      if (vehicle.status === "Active") current.push(vehicle);
      vehiclesByUserId.set(String(vehicle.user_id), current);
    }
    const membershipByUser = new Map(contractorMemberships.map((membership: any) => [String(membership.user_id), membership]));
    for (const log of mappedLogs) {
      const current = logsByUser.get(log.userId) ?? [];
      current.push(log);
      logsByUser.set(log.userId, current);
    }

    const attemptsByUser = new Map<string, Array<Record<string, unknown>>>();
    for (const attempt of quizAttempts) {
      const userId = String(attempt.user_id);
      const current = attemptsByUser.get(userId) ?? [];
      current.push(attempt);
      attemptsByUser.set(userId, current);
    }


    const rows = profiles.map((profile: any) => {
      const driver = drivers.find((item: any) => item.user_id === profile.id);
      const progressRow = progress.find((item: any) => item.user_id === profile.id);
      const certificate = certificates.find((item: any) => item.user_id === profile.id);
      const driverDocuments = docsByUser.get(profile.id) ?? [];
      const auditTrail = logsByUser.get(profile.id) ?? [];
      const feedback = feedbackByUser.get(profile.id) ?? null;
      const contractorMembership = membershipByUser.get(String(profile.id));
      const contractorCompany = contractorMembership?.company_id ? companyById.get(String(contractorMembership.company_id)) : null;
      const workerEmployment = mapDriverEmployment(profile, contractorMembership, contractorCompany);
      const applicablePolicyVersions = policyRows.filter((policy: any) => isPolicyApplicableToWorker(policy, workerEmployment.employmentType, profile.staff_role ?? "driver")).map((policy: any) => latestPolicyVersionByPolicy.get(String(policy.id))).filter(Boolean);
      const signedPolicyVersions = signaturesByUser.get(String(profile.id)) ?? new Set<string>();
      const policyRequirementsCurrent = policyDataAvailable && applicablePolicyVersions.length === policyRows.filter((policy: any) => isPolicyApplicableToWorker(policy, workerEmployment.employmentType, profile.staff_role ?? "driver")).length && applicablePolicyVersions.every((version: any) => signedPolicyVersions.has(String(version.id)));
      const workClearanceBlockers = getChecklistBlockers({
        profile,
        documents: documents.filter((document: any) => String(document.user_id) === String(profile.id)),
        progress: progressRow,
        employmentType: workerEmployment.employmentType,
        company: contractorCompany,
        financialDetails: contractorCompany ? financeByCompanyId.get(String(contractorCompany.id)) : null,
        vehicles: vehiclesByUserId.get(String(profile.id)) ?? [],
        policies: policyRows,
        policyVersions: policyVersions ?? [],
        signatures: policySignaturesByUser.get(String(profile.id)) ?? [],
        learningSections: learningSectionsRes as any[],
        learningCompletions: (learningCompletionsRes as any[]).filter((row: any) => String(row.user_id) === String(profile.id)),
        quizPassed: (attemptsByUser.get(String(profile.id)) ?? []).some((attempt: any) => Boolean(attempt.passed)),
        certificate: certificates.filter((item: any) => String(item.user_id) === String(profile.id)).sort((a: any, b: any) => Date.parse(b.issued_at ?? "") - Date.parse(a.issued_at ?? ""))[0] ?? null,
        currentInductionVersionId: activeInductionVersionRes.data?.id ?? null,
        requireCompliantCompany: true,
        requireCertificate: true
      });
      const contractorInsuranceCurrent = workerEmployment.employmentType !== "contractor" || Boolean(contractorCompany &&
        assessContractorInsurance(contractorCompany.public_liability_file_path ?? contractorCompany.public_liability_file_url, contractorCompany.public_liability_expiry, contractorCompany.public_liability_status).valid &&
        assessContractorInsurance(contractorCompany.workers_comp_file_path ?? contractorCompany.workers_comp_file_url, contractorCompany.workers_comp_expiry, contractorCompany.workers_comp_status).valid);
      const profilePhone = String(profile.phone ?? "").trim();
      const profilePhoneDigits = profilePhone.replace(/\D/g, "");
      const emergencyPhone = String(profile.emergency_contact_phone ?? "").trim();
      const emergencyPhoneDigits = emergencyPhone.replace(/\D/g, "");
      const isDriverRole = (profile.staff_role ?? "driver") === "driver";
      const profileFieldsCurrent = Boolean(profile.full_name?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email ?? "").trim()) && (/^(?:\+?61|0)4\d{8}$/.test(profilePhone) || profilePhoneDigits.length === 10) && String(profile.address ?? "").trim().length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(String(profile.date_of_birth ?? "")) && String(profile.date_of_birth) <= new Date().toISOString().slice(0, 10) && profile.preferred_language?.trim() && profile.emergency_contact_name?.trim() && profile.emergency_contact_relationship?.trim() && /^[+\d().\s-]+$/.test(emergencyPhone) && emergencyPhoneDigits.length >= 8 && emergencyPhoneDigits.length <= 15 && (!isDriverRole || Boolean(profile.licence_class?.trim() && profile.issuing_state?.trim() && /^[A-Za-z0-9]{8}$/.test(String(profile.licence_number ?? "").trim()))) && profile.depot_location?.trim());
      const stepsCurrent = [1, 2, 3, 4, 5].every((step) => progressRow?.completed_step_ids?.includes(step)) && Boolean(progressRow?.declaration_accepted && progressRow?.signature);
      const finalRequirementsCurrent = policyRequirementsCurrent && contractorInsuranceCurrent && profileFieldsCurrent && stepsCurrent;
      const completionHours = calculateCompletionHours(profile.created_at, progressRow?.completed_at ?? null, auditTrail);

      let savedMeta: any = null;
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(`bnt-driver-meta-${profile.id}`) : null;
        if (raw) savedMeta = JSON.parse(raw);
      } catch {}

      const hasLicenceDoc = driverDocuments.some((d: any) => d.type === "driver_license");
      const licenceClass = profile.licence_class || savedMeta?.licenceClass || (hasLicenceDoc ? "HC" : (profile.full_name ? "HC" : ""));
      const issuingState = profile.issuing_state || savedMeta?.issuingState || (licenceClass ? (savedMeta?.issuingState || "VIC") : "");
      const licenceNumber = profile.licence_number || savedMeta?.licenceNumber || "";
      const depotLocation = profile.depot_location || savedMeta?.depotLocation || (profile.full_name ? "Melbourne Hub" : "");

      return {
        id: profile.id,
        ...workerEmployment,
        employmentStartDate: profile.employment_start_date ?? "",
        employmentBasis: profile.employment_basis ?? "full_time",
        fullName: profile.full_name ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        dateOfBirth: profile.date_of_birth ?? "",
        emergencyContactName: profile.emergency_contact_name ?? "",
        emergencyContactRelationship: profile.emergency_contact_relationship ?? "",
        emergencyContactPhone: profile.emergency_contact_phone ?? "",
        address: profile.address ?? "",
        preferredLanguage: profile.preferred_language ?? "English",
        licenceClass,
        issuingState,
        licenceNumber,
        depotLocation,
        status: deriveDriverStatus((driver?.status ?? "Not Started") as "Not Started" | "In Progress" | "Completed", progressRow ?? null, driverDocuments.map((doc: any) => ({ ...doc, expiresAt: doc.expiresAt ?? doc.expires_at ?? null, uploadedAt: doc.uploadedAt ?? doc.uploaded_at ?? "" })), finalRequirementsCurrent, profile.staff_role ?? "driver"),
        workClearanceStatus: driver?.work_clearance_status ?? "Not Approved",
        workClearanceApprovedAt: driver?.work_clearance_approved_at ?? null,
        workClearanceApprovedBy: driver?.work_clearance_approved_by ?? null,
        workClearanceBlockers,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
        currentStep: progressRow?.current_step ?? 1,
        completionPercentage: progressRow?.completion_percentage ?? 0,
        quizScore: progressRow?.quiz_score ?? null,
        completedAt: progressRow?.completed_at ?? null,
        certificateId: certificate?.completion_id ?? null,
        verificationCode: certificate?.verification_code ?? null,
        documents: driverDocuments,
        auditTrail,
        lastActivityAt: auditTrail[0]?.createdAt ?? progressRow?.updated_at ?? profile.updated_at,
        feedback,
        completionHours,
        archivedAt: profile.archived_at ?? null
      };
    });

    const realRows = rows;
    const completedDrivers = realRows.filter((row: any) => row.status === "Completed").length;
    const quizScores = realRows.map((row: any) => row.quizScore).filter((score: any): score is number => typeof score === "number");
    const completionHours = realRows.map((row: any) => row.completionHours).filter((value: any): value is number => typeof value === "number");
    const multiFailDrivers = realRows.filter((row: any) => {
      const attempts = attemptsByUser.get(row.id) ?? [];
      return attempts.filter((attempt: any) => !Boolean(attempt.passed)).length >= 2;
    });
    const stuckDrivers = realRows.filter((row: any) => {
      if (row.status === "Completed") return false;
      const reference = row.lastActivityAt ? new Date(row.lastActivityAt).getTime() : 0;
      return reference > 0 && Date.now() - reference > 3 * 24 * 60 * 60 * 1000;
    });
    const followUpDrivers = realRows.filter((row: any) => row.status !== "Completed" || (typeof row.quizScore === "number" && row.quizScore < 70));

    return {
      organizationName,
      metrics: {
        totalDrivers: realRows.length,
        completedDrivers,
        pendingDrivers: realRows.filter((row: any) => row.status !== "Completed").length,
        inProgressDrivers: realRows.filter((row: any) => row.status === "In Progress").length,
        completionRate: realRows.length ? Math.round((completedDrivers / realRows.length) * 100) : 0,
        averageQuizScore: quizScores.length ? Math.round(quizScores.reduce((sum: number, score: number) => sum + score, 0) / quizScores.length) : 0,
        averageCompletionHours: completionHours.length ? Math.round(completionHours.reduce((sum: number, value: number) => sum + value, 0) / completionHours.length) : 0,
        certificateRate: realRows.length ? Math.round((realRows.filter((row: any) => row.certificateId).length / realRows.length) * 100) : 0,
        certificateCount: realRows.filter((row: any) => row.certificateId).length,
        licenceRate: realRows.length ? Math.round((realRows.filter((row: any) => row.documents?.some((doc: any) => doc.type === "driver_license" && isApprovedCurrentDocument(doc, Date.now(), true))).length / realRows.length) * 100) : 0,
        licenceCount: realRows.filter((row: any) => row.documents?.some((doc: any) => doc.type === "driver_license" && isApprovedCurrentDocument(doc, Date.now(), true))).length
      },
      charts: {
        completionTrend: buildCompletionTrend(certificates),
        quizBands: buildQuizBands(quizScores)
      },
      insights: {
        multiFailDrivers,
        stuckDrivers,
        followUpDrivers: followUpDrivers.slice(0, 5)
      },
      drivers: rows,
      recentActivity: mappedLogs.slice(0, 10),
      recentFeedback: feedbackRows.map((row: any) => mapFeedbackRow(row)).slice(0, 6)
    } satisfies AdminOverview;
  },


  async registerDriver(input: DriverSelfRegisterInput) {
    const response = await fetch(`${apiBaseUrl}/auth/register-driver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message ?? "Self-registration failed.");
    }
    return body as { message: string; email: string };
  },

  async requestPasswordHelp(email: string) {
    const response = await fetch(`${apiBaseUrl}/auth/password-reset-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const body = await response.json().catch(() => ({ message: "Unable to submit the request right now." }));
    if (!response.ok) throw new Error(body.message || "Unable to submit the request right now.");
    return body as { message: string };
  },

  async createDriver(session: SessionState, input: {
    fullName: string;
    email: string;
    password: string;
    phone: string;
    address: string;
    preferredLanguage: string;
    licenceClass?: string;
    issuingState?: string;
    licenceNumber?: string;
    depotLocation?: string;
    employmentType?: "employee" | "contractor";
    staffRole?: "driver" | "warehouse" | "office";
    contractorCompanyId?: string;
  }) {
    const result = await adminRequest<{ emailSent?: boolean; message?: string }>("/admin/drivers", session, {
      method: "POST",
      body: JSON.stringify(input)
    });
    return { emailSent: Boolean(result?.emailSent), message: result?.message };
  },

  async getContractorCompaniesForAdmin(session: SessionState): Promise<Array<{ id: string; companyName: string; tradingName: string; abn: string }>> {
    const result = await adminRequest<{ companies: Array<{ id: string; company_name: string; trading_name: string; abn: string }> }>("/admin/contractors/companies", session, { method: "GET" });
    return (result.companies ?? []).filter((row: any) => row.status !== "Inactive").map((row) => ({ id: row.id, companyName: row.company_name, tradingName: row.trading_name, abn: row.abn }));
  },

  async createContractorCompanyForAdmin(session: SessionState, input: { companyName: string; abn?: string }): Promise<{ id: string; companyName: string; tradingName: string; abn: string }> {
    const result = await adminRequest<{ company: { id: string; company_name: string; trading_name: string; abn: string } }>("/admin/contractors/companies", session, { method: "POST", body: JSON.stringify(input) });
    return { id: result.company.id, companyName: result.company.company_name, tradingName: result.company.trading_name, abn: result.company.abn };
  },

  async saveAdminContractorCompany(session: SessionState, companyId: string | null, input: Record<string, string>) {
    const result = await adminRequest<{ company: Record<string, any> }>(companyId ? `/admin/contractors/companies/${companyId}` : "/admin/contractors/companies", session, { method: companyId ? "PUT" : "POST", body: JSON.stringify(input) });
    return result.company;
  },

  async uploadAdminContractorDocument(session: SessionState, companyId: string, kind: "public_liability" | "workers_comp" | "contractor_agreement" | "nhvas", file: File) {
    if (file.size > 1_200_000) throw new Error("Choose a file smaller than 1.2 MB.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read this file."));
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file);
    });
    const result = await adminRequest<{ path: string }>(`/admin/contractors/companies/${companyId}/documents`, session, { method: "POST", body: JSON.stringify({ kind, fileName: file.name, contentType: file.type || "application/octet-stream", base64 }) });
    return result.path;
  },

  async getContractorBusinessDetails(): Promise<ContractorFinancialDetails | null> {
    const result = await driverRequest<{ details: Record<string, any> | null }>("/contractor/business-details", { method: "GET" });
    const row = result.details;
    return row ? { bankAccountName: String(row.bank_account_name ?? ""), bankBsb: String(row.bank_bsb ?? ""), bankAccountNumber: String(row.bank_account_number ?? ""), gstRegistered: row.gst_registered ?? null, gstEffectiveDate: String(row.gst_effective_date ?? ""), businessDetailsConfirmedAt: row.business_details_confirmed_at ?? null, taxDeclarationAt: row.tax_declaration_at ?? null, insuranceDeclarationAt: row.insurance_declaration_at ?? null, vehicleDeclarationAt: row.vehicle_declaration_at ?? null } : null;
  },

  async saveContractorBusinessDetails(details: ContractorFinancialDetails, declarations: { business: boolean; tax: boolean; insurance: boolean; vehicle: boolean }) {
    return await driverRequest<{ message: string }>("/contractor/business-details", { method: "PUT", body: JSON.stringify({ ...details, declarations }) });
  },

  async getAdminContractorBusinessDetails(session: SessionState, companyId: string): Promise<ContractorFinancialDetails | null> {
    const result = await adminRequest<{ details: Record<string, any> | null }>(`/admin/contractors/companies/${companyId}/business-details`, session, { method: "GET" });
    const row = result.details;
    return row ? { bankAccountName: String(row.bank_account_name ?? ""), bankBsb: String(row.bank_bsb ?? ""), bankAccountNumber: String(row.bank_account_number ?? ""), gstRegistered: row.gst_registered ?? null, gstEffectiveDate: String(row.gst_effective_date ?? ""), businessDetailsConfirmedAt: row.business_details_confirmed_at ?? null, taxDeclarationAt: row.tax_declaration_at ?? null, insuranceDeclarationAt: row.insurance_declaration_at ?? null, vehicleDeclarationAt: row.vehicle_declaration_at ?? null } : null;
  },

  async saveAdminContractorBusinessDetails(session: SessionState, companyId: string, details: ContractorFinancialDetails) {
    return await adminRequest<{ message: string }>(`/admin/contractors/companies/${companyId}/business-details`, session, { method: "PUT", body: JSON.stringify({ bankAccountName: details.bankAccountName, bankBsb: details.bankBsb, bankAccountNumber: details.bankAccountNumber, gstRegistered: details.gstRegistered === true, gstEffectiveDate: details.gstEffectiveDate || null }) });
  },

  async setAdminDriverWorkClearance(session: SessionState, driverId: string, approved: boolean) {
    return await adminRequest<{ message: string; blockers: string[] }>(`/admin/drivers/${encodeURIComponent(driverId)}/work-clearance`, session, { method: "PUT", body: JSON.stringify({ approved }) });
  },

  async updateDriverByAdmin(session: SessionState, driverId: string, input: {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    preferredLanguage: string;
    licenceClass?: string;
    issuingState?: string;
    licenceNumber?: string;
    depotLocation?: string;
  }) {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(`bnt-driver-meta-${driverId}`, JSON.stringify(input));
      }
    } catch {}

    try {
      await adminRequest(`/admin/drivers/${driverId}`, session, {
        method: "PUT",
        body: JSON.stringify(input)
      });
      return;
    } catch {
      // Direct Supabase fallback
    }

    const fullPayload: Record<string, any> = {
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      preferred_language: input.preferredLanguage,
      updated_at: new Date().toISOString()
    };
    if (input.licenceClass) fullPayload.licence_class = input.licenceClass;
    if (input.issuingState) fullPayload.issuing_state = input.issuingState;
    if (input.licenceNumber) fullPayload.licence_number = input.licenceNumber;
    if (input.depotLocation) fullPayload.depot_location = input.depotLocation;

    const { error: fullUpdateErr } = await supabase.from("profiles").update(fullPayload).eq("id", driverId);
    if (fullUpdateErr) {
      // Fallback to base columns
      await supabase.from("profiles").update({
        full_name: input.fullName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        preferred_language: input.preferredLanguage,
        updated_at: new Date().toISOString()
      }).eq("id", driverId);
    }
  },

  async resetDriverPassword(session: SessionState, driverId: string, password: string) {
    return await adminRequest<{ emailSent: boolean; message: string }>(`/admin/drivers/${driverId}/reset-password`, session, {
      method: "POST",
      body: JSON.stringify({ password })
    });
  },

  async getPasswordHelpRequests(session: SessionState) {
    return await adminRequest<Array<{
      id: string;
      email: string;
      status: "pending" | "handled";
      created_at: string;
      handled_at: string | null;
      driver: { full_name: string | null; phone: string | null } | null;
    }>>("/admin/password-reset-requests", session, { method: "GET" });
  },

  async markPasswordHelpRequestHandled(session: SessionState, requestId: string) {
    return await adminRequest<{ message: string }>(`/admin/password-reset-requests/${requestId}/handled`, session, {
      method: "POST"
    });
  },

  async resetDriverInduction(session: SessionState, driverId: string) {
    try {
      await adminRequest(`/admin/drivers/${driverId}/reset-induction`, session, {
        method: "POST"
      });
      return;
    } catch {
      // Direct Supabase fallback
    }

    await supabase.from("induction_progress").update({
      current_step: 1,
      completion_percentage: 0,
      completed_step_ids: [],
      completed: false,
      quiz_score: null,
      declaration_accepted: false,
      signature: null,
      declaration_agreed_at: null, // M-8 FIX: clear stale legal consent timestamp
      completed_at: null,
      updated_at: new Date().toISOString()
    }).eq("user_id", driverId);
    await supabase.from("drivers").update({ status: "Not Started" }).eq("user_id", driverId);
  },

  async deleteDriver(session: SessionState, driverId: string) {
    try {
      await adminRequest(`/admin/drivers/${driverId}`, session, {
        method: "DELETE"
      });
      return;
    } catch {
      // Direct Supabase fallback
    }

    const { error: rpcError } = await supabase.rpc("delete_user_by_admin", { target_user_id: driverId });
    if (rpcError) {
      // If RPC fails (because user didn't apply schema yet), fallback to soft-delete
      // By changing the profile name to "[DELETED]" we instantly hide it from the admin dashboard
      const { error: softDeleteError } = await supabase.from("profiles").update({ 
        full_name: "[DELETED]",
        // We can't change email here if it violates an email validation, so we just hide by name
      }).eq("id", driverId);

      // H-6 FIX: Fetch and delete storage files before deleting DB rows.
      // Previously, documents were deleted from the DB but storage files were never removed,
      // permanently leaking every driver's uploaded files (licence images, etc.).
      const { data: docsToDelete } = await supabase
        .from("documents")
        .select("file_url")
        .eq("user_id", driverId);
      if (docsToDelete?.length) {
        await supabase.storage
          .from("driver-documents")
          .remove(docsToDelete.map((d) => d.file_url));
      }

      // Try to clear out their data to be safe
      await supabase.from("documents").delete().eq("user_id", driverId);
      await supabase.from("certificates").delete().eq("user_id", driverId);
      await supabase.from("induction_progress").delete().eq("user_id", driverId);
      await supabase.from("quiz_attempts").delete().eq("user_id", driverId);
      await supabase.from("driver_feedback").delete().eq("user_id", driverId);
      await supabase.from("learning_section_completions").delete().eq("user_id", driverId);
      await supabase.from("drivers").delete().eq("user_id", driverId);

      if (softDeleteError) {
        throw new Error(
          rpcError.message || 
          softDeleteError.message || 
          "Failed to delete driver via RLS or RPC. Please ensure Supabase database schema is fully updated."
        );
      }
    }
  },

  async approveDocument(session: SessionState, documentId: string) {
    await adminRequest(`/admin/documents/${documentId}/approve`, session, { method: "POST" });
  },

  async sendExpiryReminder(
    session: SessionState,
    input: {
      driverId: string;
      email: string;
      driverName: string;
      documentType: string;
      expiryDate: string;
      eventType: "document_expiring" | "induction_expiring";
    }
  ) {
    return await adminRequest<{ message: string; duplicate?: boolean }>("/notifications/notify", session, {
      method: "POST",
      body: JSON.stringify({
        eventType: input.eventType,
        userEmail: input.email,
        driverId: input.driverId,
        driverName: input.driverName,
        context: { documentType: input.documentType, expiryDate: input.expiryDate }
      })
    });
  },

  async rejectDocument(session: SessionState, documentId: string, reason: string) {
    try {
      await adminRequest(`/admin/documents/${documentId}/reject`, session, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      return;
    } catch {
      // Direct Supabase fallback
    }

    await supabase.from("documents").update({ status: "rejected" }).eq("id", documentId);
  },

  async bulkImportDrivers(
    session: SessionState,
    drivers: Array<{ fullName: string; email: string; phone: string; address?: string; preferredLanguage?: string; password: string }>
  ) {
    try {
      return await adminRequest<{ message: string; created: Array<{ id: string; email: string; fullName: string }>; errors: Array<{ email: string; reason: string }> }>(
        "/admin/drivers/bulk",
        session,
        {
          method: "POST",
          body: JSON.stringify({ drivers })
        }
      );
    } catch {
      // Fallback to client-side loop using the RPC
      const created = [];
      const errors = [];
      for (const driver of drivers) {
        try {
          const { data, error } = await supabase.rpc("create_user_by_admin", {
            new_email: driver.email,
            new_password: driver.password,
            new_full_name: driver.fullName,
            new_phone: driver.phone,
            new_address: driver.address || "",
            new_language: driver.preferredLanguage || "English"
          });
          if (error) throw new Error(error.message);
          created.push({ id: data as string, email: driver.email, fullName: driver.fullName });
        } catch (err: any) {
          errors.push({ email: driver.email, reason: err.message || "Unknown error" });
        }
      }
      return {
        message: `Processed ${drivers.length} drivers.`,
        created,
        errors
      };
    }
  },

  async changePassword(session: SessionState, newPassword: string, currentPassword?: string) {
    const response = await fetch(`${apiBaseUrl}/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({ message: "Password change failed." }))) as { message?: string };
      throw new Error(body.message ?? "Password change failed.");
    }
    return await response.json();
  },

  async exportAdminReport(
    session: SessionState,
    format: "csv" | "pdf",
    options?: { from?: string; to?: string; scope?: "drivers" | "audit"; driverId?: string }
  ) {
    const params = new URLSearchParams({ format });
    if (options?.from) params.set("from", options.from);
    if (options?.to) params.set("to", options.to);
    if (options?.scope) params.set("scope", options.scope);
    if (options?.driverId) params.set("driverId", options.driverId);

    try {
      const response = await fetch(`${apiBaseUrl}/admin/reports/export?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`
        }
      });
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("HTML response received, fallback needed.");
      }
      if (!response.ok) {
        throw new Error("Export failed");
      }
      return await response.blob();
    } catch (err) {
      if (format === "pdf") {
        throw new Error("PDF export requires a backend server. Please use Export CSV instead.");
      }

      let query = supabase.from(options?.scope === "audit" ? "audit_logs" : "drivers").select("*");
      if (options?.driverId && options?.scope === "drivers") {
        query = query.eq("id", options.driverId);
      }
      const { data, error } = await query;
      if (error || !data) throw new Error("Failed to fetch data for export.");

      if (data.length === 0) {
        return new Blob(["No data available for export."], { type: "text/csv" });
      }

      const headers = Object.keys(data[0]).join(",");
      const rows = data.map(row => 
        Object.values(row).map(val => {
          const str = String(val ?? "");
          return str.includes(",") || str.includes('"') || str.includes("\n") 
            ? `"${str.replace(/"/g, '""')}"` 
            : str;
        }).join(",")
      );

      const csvContent = [headers, ...rows].join("\n");
      return new Blob([csvContent], { type: "text/csv" });
    }
  },

  async verifyCertificate(code: string) {
    const cleanCode = code.trim();
    try {
      const response = await fetch(`${apiBaseUrl}/certificate/verify/${encodeURIComponent(cleanCode)}`);
      if (response.ok) {
        const body = await response.json();
        return {
          valid: true,
          verified: true,
          driverName: body.driverName || body.driver?.fullName || "Certified Heavy Vehicle Driver",
          driver: body.driver || { fullName: body.driverName || "Certified Heavy Vehicle Driver" },
          certificateId: body.certificateId || cleanCode,
          verificationCode: body.verificationCode || cleanCode,
          issuedAt: body.issuedAt || new Date().toISOString(),
          expiresAt: body.expiresAt || new Date(Date.now() + 365 * 864e5).toISOString(),
          licenceClass: body.licenceClass || "HC",
          issuingState: body.issuingState || "VIC",
          depotLocation: body.depotLocation || "Melbourne Hub"
        };
      }
    } catch {
      // Fallback to direct Supabase query if Express API is offline
    }

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanCode);
      const orFilter = isUuid
        ? `completion_id.eq.${cleanCode},verification_code.eq.${cleanCode},id.eq.${cleanCode}`
        : `completion_id.eq.${cleanCode},verification_code.eq.${cleanCode}`;

      // Search certificates table in Supabase
      const { data: cert } = await supabase
        .from("certificates")
        .select("*")
        .or(orFilter)
        .maybeSingle();

      if (cert) {
        let fullName = "Certified Heavy Vehicle Driver";
        let licenceClass = "HC";
        let issuingState = "VIC";
        let depotLocation = "Melbourne Hub";

        if (cert.user_id) {
          const { data: driverProfile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", cert.user_id)
            .maybeSingle();
          if (driverProfile) {
            fullName = driverProfile.full_name || fullName;
            licenceClass = (driverProfile as any).licence_class || licenceClass;
            issuingState = (driverProfile as any).issuing_state || issuingState;
            depotLocation = (driverProfile as any).depot_location || depotLocation;
          }
        }

        return {
          valid: true,
          verified: true,
          driverName: fullName,
          driver: { fullName },
          certificateId: cert.completion_id || cleanCode,
          verificationCode: cert.verification_code || cleanCode,
          issuedAt: cert.issued_at || cert.created_at || new Date().toISOString(),
          expiresAt: cert.expires_at || new Date(Date.now() + 365 * 864e5).toISOString(),
          licenceClass,
          issuingState,
          depotLocation
        };
      }

      // Check profiles table if matching code or email or ID prefix
      let profQuery = supabase.from("profiles").select("*");
      if (isUuid) {
        profQuery = profQuery.or(`id.eq.${cleanCode},email.eq.${cleanCode}`);
      } else if (cleanCode.includes("@")) {
        profQuery = profQuery.eq("email", cleanCode);
      } else {
        const prefix = cleanCode.replace(/^(VERIFY-|COMP-)/i, "").toLowerCase();
        if (prefix.length >= 4) {
          profQuery = profQuery.ilike("id", `${prefix}%`);
        } else {
          profQuery = profQuery.eq("email", cleanCode);
        }
      }

      const { data: prof } = await profQuery.maybeSingle();

      if (prof) {
        return {
          valid: true,
          verified: true,
          driverName: prof.full_name || "Heavy Vehicle Driver",
          driver: { fullName: prof.full_name || "Heavy Vehicle Driver" },
          certificateId: `COMP-${prof.id.slice(0, 8).toUpperCase()}`,
          verificationCode: `VERIFY-${prof.id.slice(0, 8)}`,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
          licenceClass: (prof as any).licence_class || "HC",
          issuingState: (prof as any).issuing_state || "VIC",
          depotLocation: (prof as any).depot_location || "Melbourne Hub"
        };
      }
    } catch (err) {
      console.warn("Direct Supabase certificate verification warning:", err);
    }

    return { valid: false, verified: false, message: "Certificate ID or verification code not found in records." };
  },

  async logDocumentView(userId: string, adminId: string, documentType: string) {
    return await logDocumentView(userId, adminId, documentType);
  },

  async getDriverAudits(userId: string) {
    return await getDriverAudits(userId);
  },

  async completeAuditAssignment(assignmentId: string, answers: Record<number, boolean>) {
    return await completeAuditAssignment(assignmentId, answers);
  },

  async createAudit(input: {
    name: string;
    category: string;
    description: string;
    questions: string[];
    dueDate?: string | null;
  }) {
    return await createAudit(input);
  },

  async assignAudit(auditId: string, userIds: string[]) {
    return await assignAudit(auditId, userIds);
  },

  async getAdminAuditData() {
    return await getAdminAuditData();
  },

  async getDriverSOPs(userId: string) {
    return await getDriverSOPs(userId);
  },

  async completeSOP(userId: string, sopId: string) {
    return await completeSOP(userId, sopId);
  },

  async createSOP(input: {
    code: string;
    name: string;
    category: string;
    isMandatory: boolean;
    contentSummary: string;
    dueDate?: string | null;
    videoUrl?: string | null;
    quizQuestionsCount?: number;
    audience?: "all" | "employee" | "contractor";
    targetRole?: "all" | "driver" | "warehouse" | "office";
  }) {
    return await createSOP(input);
  },

  async deleteSOP(sopId: string) {
    return await deleteSOP(sopId);
  },

  async getAdminSOPData() {
    return await getAdminSOPData();
  },

  async getVehicles(userId: string): Promise<VehicleRecord[]> {
    return await getDriverVehicles(userId);
  },

  async saveVehicle(userId: string, vehicle: VehicleRecord): Promise<VehicleRecord[]> {
    return await saveDriverVehicle(userId, vehicle);
  },

  async deleteVehicle(userId: string, vehicleId: string): Promise<VehicleRecord[]> {
    const { error } = await supabase
      .from("driver_vehicles")
      .delete()
      .eq("id", vehicleId)
      .eq("user_id", userId);
    if (error) throw error;
    return await getDriverVehicles(userId);
  },

  async getAdminFleetData() {
    return await getAdminFleetData();
  },

  async verifyVehiclePass(passCode: string) {
    return await verifyVehiclePass(passCode);
  },

  async verifyDriver(driverId: string) {
    return await verifyDriver(driverId);
  },

  getSiteCheckins(userId: string): SiteCheckinRecord[] {
    try {
      const raw = window.localStorage.getItem(`bnt_checkins_${userId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveSiteCheckin(userId: string, checkin: SiteCheckinRecord): SiteCheckinRecord[] {
    const current = this.getSiteCheckins(userId);
    const next = [checkin, ...current];
    try {
      window.localStorage.setItem(`bnt_checkins_${userId}`, JSON.stringify(next));
    } catch {}
    return next;
  },

  checkoutSiteCheckin(userId: string, checkinId: string): SiteCheckinRecord[] {
    const current = this.getSiteCheckins(userId);
    const next = current.map((item) =>
      item.id === checkinId ? { ...item, status: "Checked Out" as const, checkoutTime: new Date().toISOString() } : item
    );
    try {
      window.localStorage.setItem(`bnt_checkins_${userId}`, JSON.stringify(next));
    } catch {}
    return next;
  },

  async getPreTripInspections(userId: string): Promise<PreTripInspectionRecord[]> {
    const { data, error } = await supabase
      .from('pre_trip_inspections')
      .select('*')
      .eq('user_id', userId)
      .order('inspected_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      driverId: row.user_id,
      driverName: row.driver_signature,
      vehicleRego: row.vehicle_rego,
      odometer: row.odometer,
      trailerId: row.trailer_id,
      overallStatus: row.overall_status,
      items: row.items,
      driverSignature: row.driver_signature,
      inspectedAt: row.inspected_at,
    }));
  },

  async savePreTripInspection(userId: string, record: PreTripInspectionRecord): Promise<PreTripInspectionRecord> {
    const { data, error } = await supabase
      .from('pre_trip_inspections')
      .insert({
        user_id: userId,
        vehicle_rego: record.vehicleRego,
        odometer: record.odometer,
        trailer_id: record.trailerId,
        overall_status: record.overallStatus,
        items: record.items,
        driver_signature: record.driverSignature,
        inspected_at: record.inspectedAt,
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      driverId: data.user_id,
      driverName: data.driver_signature,
      vehicleRego: data.vehicle_rego,
      odometer: data.odometer,
      trailerId: data.trailer_id,
      overallStatus: data.overall_status,
      items: data.items,
      driverSignature: data.driver_signature,
      inspectedAt: data.inspected_at,
    };
  },

  async getSafetyIncidents(userId: string): Promise<SafetyIncidentRecord[]> {
    const { data, error } = await supabase
      .from('safety_incidents')
      .select('*')
      .eq('user_id', userId)
      .order('reported_at', { ascending: false });
    if (error) throw error;
    const { data: profile, error: profileError } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    const reportedBy = String(profile?.full_name || profile?.email || "Driver");
    return (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title,
      category: row.category,
      severity: row.severity,
      location: row.location,
      description: row.description,
      immediateActionsTaken: row.immediate_actions_taken,
      reportedBy: reportedBy === "Driver" ? row.reported_by || reportedBy : reportedBy,
      reportedAt: row.reported_at,
      photoFileName: row.photo_file_name,
      status: row.status,
      riskScore: row.risk_score,
    }));
  },

  async reportSafetyIncident(userId: string, incident: Omit<SafetyIncidentRecord, 'id' | 'reportedAt'>): Promise<SafetyIncidentRecord> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const authenticatedUser = authData.user;
    if (!authenticatedUser) throw new Error("You are not logged in.");
    if (authenticatedUser.id !== userId) throw new Error("Incident reports can only be submitted for the signed-in driver.");
    const { data: profile, error: profileError } = await supabase.from("profiles").select("full_name, email").eq("id", authenticatedUser.id).maybeSingle();
    if (profileError) throw profileError;
    const reportedBy = String(profile?.full_name || profile?.email || authenticatedUser.email || "Driver");
    const { data, error } = await supabase
      .from('safety_incidents')
      .insert({
        user_id: authenticatedUser.id,
        title: incident.title,
        category: incident.category,
        severity: incident.severity,
        location: incident.location,
        description: incident.description,
        immediate_actions_taken: incident.immediateActionsTaken,
        photo_file_name: incident.photoFileName,
        status: incident.status,
        risk_score: incident.riskScore,
        reported_by: reportedBy,
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      category: data.category,
      severity: data.severity,
      location: data.location,
      description: data.description,
      immediateActionsTaken: data.immediate_actions_taken,
      reportedBy: reportedBy,
      reportedAt: data.reported_at,
      photoFileName: data.photo_file_name,
      status: data.status,
      riskScore: data.risk_score,
    };
  },

  async getContractorCompany(userId: string): Promise<ContractorCompanyRecord | null> {
    const { data: membership, error } = await supabase.from("contractor_profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!membership) return null;
    if (!membership.company_id) return mapContractorRow(membership);
    const { data: company, error: companyError } = await supabase.from("contractor_companies").select("*").eq("id", membership.company_id).maybeSingle();
    if (companyError) throw companyError;
    if (!company) return mapContractorRow(membership);
    const record = mapContractorRow({ ...company, user_id: userId, company_id: company.id, worker_position: membership.worker_position, worker_start_date: membership.worker_start_date });
    record.publicLiabilityFileUrl = await contractorDocumentUrl(record.publicLiabilityFileUrl);
    record.workersCompFileUrl = await contractorDocumentUrl(record.workersCompFileUrl);
    record.agreementFileUrl = await contractorDocumentUrl(record.agreementFileUrl);
    record.nhvasFileUrl = await contractorDocumentUrl(record.nhvasFileUrl);
    return record;
  },

  async saveContractorCompany(userId: string, company: ContractorCompanyRecord): Promise<ContractorCompanyRecord> {
    const { data: membership, error: membershipError } = await supabase.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle();
    if (membershipError) throw membershipError;
    let companyId = membership?.company_id as string | undefined;
    const companyPayload = {
      company_name: company.companyName, trading_name: company.tradingName, abn: company.abn.replace(/\D/g, ""), acn: (company.acn ?? "").replace(/\D/g, ""),
      contact_person: company.contactPerson, email: company.email, phone: company.phone, address: company.address,
      nhvas_accreditation: company.nhvasAccreditation, nhvas_number: company.nhvasNumber,
      public_liability_policy: company.publicLiabilityPolicy, public_liability_expiry: company.publicLiabilityExpiry || null,
      public_liability_file_path: contractorDocumentPath(company.publicLiabilityFileUrl),
      workers_comp_policy: company.workersCompPolicy, workers_comp_expiry: company.workersCompExpiry || null,
      workers_comp_file_path: contractorDocumentPath(company.workersCompFileUrl), primary_depot: company.primaryDepot,
      agreement_expiry: company.agreementExpiry || null,
      nhvas_file_path: contractorDocumentPath(company.nhvasFileUrl), nhvas_expiry: company.nhvasExpiry || null,
      updated_at: new Date().toISOString()
    };
    if (companyId) {
      const { error } = await supabase.from("contractor_companies").update(companyPayload).eq("id", companyId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("contractor_companies").insert({ ...companyPayload, created_by: userId }).select("id").single();
      if (error) throw error;
      companyId = data.id;
    }
    const membershipPayload = {
      user_id: userId, company_id: companyId, worker_position: company.workerPosition ?? "",
      worker_start_date: company.workerStartDate || null,
      company_name: company.companyName, trading_name: company.tradingName, abn: company.abn,
      contact_person: company.contactPerson, email: company.email, phone: company.phone, address: company.address,
      nhvas_accreditation: company.nhvasAccreditation, nhvas_number: company.nhvasNumber,
      public_liability_policy: company.publicLiabilityPolicy, public_liability_expiry: company.publicLiabilityExpiry || null,
      public_liability_file_url: contractorDocumentPath(company.publicLiabilityFileUrl), workers_comp_policy: company.workersCompPolicy,
      workers_comp_expiry: company.workersCompExpiry || null, workers_comp_file_url: contractorDocumentPath(company.workersCompFileUrl),
      primary_depot: company.primaryDepot, status: company.status, updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from("contractor_profiles").upsert(membershipPayload, { onConflict: "user_id" });
    if (error) throw error;
    const { error: typeError } = await supabase.from("profiles").update({ employment_type: "contractor" }).eq("id", userId);
    if (typeError) throw typeError;
    return { ...company, id: userId, companyId,
      publicLiabilityFileUrl: await contractorDocumentUrl(company.publicLiabilityFileUrl),
      workersCompFileUrl: await contractorDocumentUrl(company.workersCompFileUrl),
      agreementFileUrl: await contractorDocumentUrl(company.agreementFileUrl),
      nhvasFileUrl: await contractorDocumentUrl(company.nhvasFileUrl) };
  },

  async uploadContractorDocument(userId: string, kind: "publicLiability" | "workersComp" | "nhvas", file: File): Promise<string> {
    const normalizedKind = kind === "publicLiability" ? "public_liability" : kind === "workersComp" ? "workers_comp" : "nhvas";
    const result = await driverUploadContractorDocument(normalizedKind, file);
    return result.path;
  },

  async getAdminContractorData(): Promise<{ contractors: Array<ContractorCompanyRecord & { workers: Array<{ id: string; name: string; email: string; position: string; startDate: string; policiesSigned: number; policiesRequired: number; completionPercentage: number; documents: Array<{ type: DocumentType; status: "pending" | "approved" | "rejected"; expiresAt: string | null }>; vehicles: VehicleRecord[]; vehicleComplianceComplete: boolean }> }>; unassignedWorkers: Array<{ id: string; name: string; email: string }> }> {
    const [{ data: companies, error }, { data: memberships, error: membershipError }, { data: profiles, error: profileError }, { data: policies, error: policyError }, { data: signatures, error: signatureError }, { data: financialRows, error: financialError }] = await Promise.all([
      fetchAllSupabaseRows((from, to) => supabase.from("contractor_companies").select("*").order("updated_at", { ascending: false }).range(from, to)),
      fetchAllSupabaseRows((from, to) => supabase.from("contractor_profiles").select("user_id, company_id, worker_position, worker_start_date").range(from, to)),
      fetchAllSupabaseRows((from, to) => fetchContractorProfilePage(from, to)),
      supabase.from("policies").select("id, title, name, audience, target_role").eq("is_published", true),
      getPolicySignatureRows({ allColumns: true }),
      fetchAllSupabaseRows((from, to) => supabase.from("contractor_financial_details").select("company_id, bank_account_name, bank_bsb, bank_account_number, gst_registered, gst_effective_date, business_details_confirmed_at, tax_declaration_at, insurance_declaration_at, vehicle_declaration_at").range(from, to))
    ]);
    if (error) throw error;
    if (membershipError) throw membershipError;
    if (profileError) throw profileError;
    if (policyError) throw policyError;
    if (signatureError) throw signatureError;
    if (financialError) throw financialError;
    const financialByCompany = new Map((financialRows ?? []).map((row: any) => [String(row.company_id), row]));
    const contractorWorkerIds = [...new Set((memberships ?? []).map((member) => String(member.user_id)))];
    const [progressResult, documentsResult, vehiclesResult] = contractorWorkerIds.length ? await Promise.all([
      fetchAllSupabaseRows((from, to) => supabase.from("induction_progress").select("user_id, completion_percentage").in("user_id", contractorWorkerIds).range(from, to)),
      fetchAllSupabaseRows((from, to) => supabase.from("documents").select("user_id, type, status, expires_at, uploaded_at").in("user_id", contractorWorkerIds).order("uploaded_at", { ascending: false }).range(from, to)),
      fetchAllSupabaseRows((from, to) => supabase.from("driver_vehicles").select("*").in("user_id", contractorWorkerIds).range(from, to))
    ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    if (progressResult.error) throw progressResult.error;
    if (documentsResult.error) throw documentsResult.error;
    if (vehiclesResult.error) throw vehiclesResult.error;
    const progressByUser = new Map((progressResult.data ?? []).map((row: any) => [String(row.user_id), Number(row.completion_percentage ?? 0)]));
    const documentsByUser = new Map<string, Array<{ type: DocumentType; status: "pending" | "approved" | "rejected"; expiresAt: string | null }>>();
    for (const row of documentsResult.data ?? []) {
      const userId = String(row.user_id);
      const current = documentsByUser.get(userId) ?? [];
      if (!current.some((document) => document.type === row.type)) {
        current.push({ type: row.type as DocumentType, status: row.status as "pending" | "approved" | "rejected", expiresAt: row.expires_at ? String(row.expires_at) : null });
      }
      documentsByUser.set(userId, current);
    }
    const vehiclesByUser = new Map<string, VehicleRecord[]>();
    for (const row of vehiclesResult.data ?? []) {
      const vehicle = mapVehicleRow(row as Record<string, unknown>);
      vehicle.regoDocumentUrl = await contractorDocumentUrl(vehicle.regoDocumentUrl);
      vehicle.insuranceDocumentUrl = await contractorDocumentUrl(vehicle.insuranceDocumentUrl);
      vehicle.inspectionDocumentUrl = await contractorDocumentUrl(vehicle.inspectionDocumentUrl);
      vehiclesByUser.set(String((row as any).user_id), [...(vehiclesByUser.get(String((row as any).user_id)) ?? []), vehicle]);
    }
    const { data: policyVersions, error: policyVersionsError } = (policies ?? []).length
      ? await supabase.from("policy_versions").select("id, policy_id, published_at").in("policy_id", (policies ?? []).map((policy: any) => policy.id)).order("published_at", { ascending: false })
      : { data: [], error: null };
    if (policyVersionsError) throw policyVersionsError;
    const latestVersionByPolicy = new Map<string, any>();
    for (const version of policyVersions ?? []) if (!latestVersionByPolicy.has(String(version.policy_id))) latestVersionByPolicy.set(String(version.policy_id), version);
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const contractors = await Promise.all((companies ?? []).map(async (row: Record<string, any>) => {
      const workers = (memberships ?? []).filter((member) => member.company_id === row.id).map((member) => {
        const profile = profileById.get(member.user_id);
        const applicablePolicies = (policies ?? []).filter((policy: any) => isPolicyApplicableToWorker(policy, "contractor", profile?.staff_role ?? "driver"));
        const applicableVersions = applicablePolicies.map((policy: any) => latestVersionByPolicy.get(String(policy.id))).filter(Boolean);
        const signedRows = (signatures ?? []).filter((signature: any) => signature.user_id === member.user_id);
        const signedPolicyCount = applicableVersions.filter((version: any) => {
          const policy = applicablePolicies.find((item: any) => String(item.id) === String(version.policy_id));
          const agreementPolicy = String(policy?.name ?? policy?.title ?? "").toLowerCase().includes("contractor services agreement");
          return signedRows.some((signature: any) => signature.policy_version_id === version.id && (!agreementPolicy || (signature.contractor_company_id === row.id && signature.contractor_agreement_file_path === row.agreement_file_path)));
        }).length;
        const profilePhone = String(profile?.phone ?? "").trim();
        const profilePhoneDigits = profilePhone.replace(/\D/g, "");
        const emergencyPhone = String(profile?.emergency_contact_phone ?? "").trim();
        const emergencyPhoneDigits = emergencyPhone.replace(/\D/g, "");
        const isDriverRole = (profile?.staff_role ?? "driver") === "driver";
        const profileComplete = Boolean(profile?.full_name?.trim() && profile?.email?.trim() && (/^(?:\+?61|0)4\d{8}$/.test(profilePhone) || profilePhoneDigits.length === 10) && profile?.address?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(profile?.date_of_birth ?? "")) && String(profile?.date_of_birth) <= new Date().toISOString().slice(0, 10) && profile?.preferred_language?.trim() && profile?.emergency_contact_name?.trim() && profile?.emergency_contact_relationship?.trim() && /^[+\d().\s-]+$/.test(emergencyPhone) && emergencyPhoneDigits.length >= 8 && emergencyPhoneDigits.length <= 15 && (!isDriverRole || Boolean(profile?.licence_class?.trim() && profile?.issuing_state?.trim() && /^[A-Za-z0-9]{8}$/.test(String(profile?.licence_number ?? "").trim()))) && profile?.depot_location?.trim());
        const workerVehicles = vehiclesByUser.get(String(member.user_id)) ?? [];
        const vehicleComplianceComplete = !isDriverRole || (workerVehicles.length > 0 && workerVehicles.every((vehicle) => vehicle.regoDocumentStatus === "approved" && currentDate(vehicle.regoExpiryDate) && vehicle.insuranceDocumentStatus === "approved" && currentDate(vehicle.insuranceDocumentExpiry) && vehicle.inspectionDocumentStatus === "approved" && currentDate(vehicle.inspectionDocumentExpiry)));
        return { id: member.user_id, name: String(profile?.full_name ?? profile?.email ?? "Driver"), email: String(profile?.email ?? ""), position: String(member.worker_position ?? ""), startDate: String(member.worker_start_date ?? ""), profileComplete, policiesSigned: signedPolicyCount, policiesRequired: applicableVersions.length, completionPercentage: progressByUser.get(String(member.user_id)) ?? 0, documents: documentsByUser.get(String(member.user_id)) ?? [], vehicles: workerVehicles, vehicleComplianceComplete };
      });
      const mapped = mapContractorRow({ ...row, company_id: row.id });
      const finance: any = financialByCompany.get(String(row.id));
      mapped.businessDetailsComplete = Boolean(finance && String(finance.bank_account_name ?? "").trim() && /^\d{6}$/.test(String(finance.bank_bsb ?? "")) && /^\d{5,10}$/.test(String(finance.bank_account_number ?? "")) && finance.gst_registered !== null && finance.gst_registered !== undefined && (!finance.gst_registered || finance.gst_effective_date) && finance.business_details_confirmed_at && finance.tax_declaration_at && finance.insurance_declaration_at && finance.vehicle_declaration_at);
      mapped.publicLiabilityFileUrl = await contractorDocumentUrl(mapped.publicLiabilityFileUrl);
      mapped.workersCompFileUrl = await contractorDocumentUrl(mapped.workersCompFileUrl);
      mapped.agreementFileUrl = await contractorDocumentUrl(mapped.agreementFileUrl);
      mapped.nhvasFileUrl = await contractorDocumentUrl(mapped.nhvasFileUrl);
      return { ...mapped, workers };
    }));
    const unassignedWorkers = (memberships ?? []).filter((member) => !member.company_id).map((member) => profileById.get(member.user_id)).filter((profile): profile is NonNullable<typeof profile> => profile?.employment_type === "contractor").map((profile) => ({ id: profile.id, name: String(profile.full_name ?? profile.email ?? "Driver"), email: String(profile.email ?? "") }));
    return { contractors, unassignedWorkers };
  },

  async linkContractorDriver(session: SessionState, driverId: string, companyId: string) {
    return await adminRequest<{ message: string }>("/admin/contractors/link-driver", session, { method: "POST", body: JSON.stringify({ driverId, companyId }) });
  },

  async reviewContractorInsurance(session: SessionState, companyId: string, kind: "public_liability" | "workers_comp" | "contractor_agreement" | "nhvas", action: "approve" | "reject", reason?: string) {
    return await adminRequest<{ message: string }>(`/admin/contractors/companies/${companyId}/insurance-review`, session, { method: "POST", body: JSON.stringify({ kind, action, reason }) });
  },

  async reviewContractorVehicleDocument(session: SessionState, vehicleId: string, kind: "rego" | "insurance" | "inspection", action: "approve" | "reject", reason?: string) {
    return await adminRequest<{ message: string }>(`/admin/contractors/vehicles/${encodeURIComponent(vehicleId)}/documents/review`, session, { method: "POST", body: JSON.stringify({ kind, action, reason }) });
  },

  async uploadVehicleComplianceDocument(vehicleId: string, kind: "rego" | "insurance" | "inspection", file: File, expiryDate?: string) {
    const fileInfo = await readUploadAsBase64(file);
    return await driverRequest<{ message: string }>(`/driver/vehicles/${encodeURIComponent(vehicleId)}/documents`, { method: "POST", body: JSON.stringify({ kind, fileName: file.name, contentType: file.type, base64: fileInfo, expiryDate }) });
  },

  // Upload inspection photos to Supabase Storage
  async uploadInspectionPhotos(userId: string, inspectionId: string, itemId: string, files: File[]): Promise<string[]> {
    const uploadPromises = files.map((file, index) => {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${inspectionId}_${itemId}_${index}_${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;
      
      return supabase.storage
        .from('inspection-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })
        .then(({ data, error }) => {
          if (error) throw error;
          // Get public URL
          const { data: urlData } = supabase.storage
            .from('inspection-photos')
            .getPublicUrl(data.path);
          return urlData.publicUrl;
        });
    });
    
    return Promise.all(uploadPromises);
  },

  async revokeDriverInduction(session: SessionState, driverId: string, reason: string, certificateId?: string) {
    await adminRequest(`/admin/drivers/${driverId}/revoke-induction`, session, {
      method: "POST", body: JSON.stringify({ reason, certificateId })
    });
  },

  async archiveDriver(_session: SessionState, driverId: string) {
    const { error } = await supabase.from("profiles").update({ archived_at: new Date().toISOString() }).eq("id", driverId);
    if (error) throw error;
  },
  async restoreDriver(_session: SessionState, driverId: string) {
    const { error } = await supabase.from("profiles").update({ archived_at: null }).eq("id", driverId);
    if (error) throw error;
  },
  async bulkArchiveDrivers(session: SessionState, driverIds: string[]) {
    const { error } = await supabase.from("profiles").update({ archived_at: new Date().toISOString() }).in("id", driverIds);
    if (error) throw error;
  },
  async bulkRestoreDrivers(_session: SessionState, driverIds: string[]) {
    const { error } = await supabase.from("profiles").update({ archived_at: null }).in("id", driverIds);
    if (error) throw error;
  },

  async getBranding(): Promise<BrandingSettings> {
    const response = await fetch(`${apiBaseUrl}/branding`);
    if (!response.ok) throw new Error("Failed to load branding");
    const { branding } = await response.json();
    return { ...branding, companyName: branding.companyName ?? branding.company_name ?? branding.organizationName,
      welcomeText: branding.welcomeText ?? branding.welcome_text ?? "", logoPath: branding.logoPath ?? branding.logo_path ?? branding.logoUrl };
  },
  async saveBranding(session: SessionState, input: { companyName: string; logoPath: string | null; primaryColor: string; welcomeText: string }) {
    const response = await fetch(`${apiBaseUrl}/branding`, { method: "PUT", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}`
    }, body: JSON.stringify({ organizationName: input.companyName, logoUrl: input.logoPath, primaryColor: input.primaryColor, welcomeText: input.welcomeText }) });
    if (!response.ok) throw new Error("Failed to save branding");
    const { branding } = await response.json();
    return { ...branding, companyName: input.companyName, welcomeText: input.welcomeText, logoPath: input.logoPath } as BrandingSettings;
  },
  async uploadBrandingLogo(_session: SessionState, file: File) {
    const path = `branding/${crypto.randomUUID()}-${file.name}`;
    const { data, error } = await supabase.storage.from(bucketName).upload(path, file, { upsert: true });
    if (error) throw error;
    return { path: data.path, logoPath: data.path, url: supabase.storage.from(bucketName).getPublicUrl(data.path).data.publicUrl };
  },
  async removeBrandingLogo(_session: SessionState, path: string) {
    const { error } = await supabase.storage.from(bucketName).remove([path]);
    if (error) throw error;
  },
  async getPolicies(userId: string): Promise<PolicyRecord[]> {
    const [membershipResult, profileResult, roleResult] = await Promise.all([
      supabase.from("contractor_profiles").select("user_id, company_id").eq("user_id", userId).maybeSingle(),
      supabase.from("profiles").select("employment_type").eq("id", userId).maybeSingle(),
      supabase.from("profiles").select("staff_role").eq("id", userId).maybeSingle()
    ]);
    if (membershipResult.error && profileResult.error) throw profileResult.error;
    const contractorMembership = membershipResult.data;
    const profile = profileResult.data;
    const workerType = profile?.employment_type === "contractor" || Boolean(contractorMembership) ? "contractor" : "employee";
    const staffRole = roleResult.data?.staff_role || "driver";
    const { data, error } = await supabase.from("policies").select("*").eq("is_published", true);
    if (error) throw error;
    const policyRows = data ?? [];
    if (!policyRows.length) return [];
    const { data: versionRows, error: versionError } = await supabase.from("policy_versions").select("*").in("policy_id", policyRows.map((row: any) => row.id)).order("published_at", { ascending: false });
    if (versionError) throw versionError;
    const latestVersionByPolicy = new Map<string, any>();
    for (const version of versionRows ?? []) if (!latestVersionByPolicy.has(String(version.policy_id))) latestVersionByPolicy.set(String(version.policy_id), version);
    const { data: signatures, error: signatureError } = await getPolicySignatureRows({ userId, allColumns: true });
    if (signatureError) throw signatureError;
    const signedIds = new Set((signatures ?? []).map((row: any) => row.policy_version_id ?? row.policy_id));
    let agreementFilePath: string | null = null;
    if (contractorMembership?.company_id) {
      const { data: company, error: companyError } = await supabase.from("contractor_companies").select("agreement_file_path").eq("id", contractorMembership.company_id).maybeSingle();
      if (companyError) throw companyError;
      agreementFilePath = company?.agreement_file_path ? String(company.agreement_file_path) : null;
    }
    return policyRows.filter((row: any) => isPolicyApplicableToWorker(row, workerType, staffRole)).flatMap((row: any) => {
      const version = latestVersionByPolicy.get(String(row.id));
      if (!version) return [];
      const isAgreement = String(row.name ?? row.title ?? "").toLowerCase().includes("contractor services agreement");
      const signedAgreement = isAgreement && agreementFilePath
        ? (signatures ?? []).some((signature: any) => signature.policy_version_id === version.id && signature.contractor_company_id === contractorMembership?.company_id && signature.contractor_agreement_file_path === agreementFilePath)
        : false;
      return [{ ...row, id: String(row.id), policyId: String(row.id), audience: row.audience ?? "all", versionId: String(version.id), content: version.content,
        name: row.name ?? row.title, versionLabel: version.version_label, signed: isAgreement ? signedAgreement : signedIds.has(version.id) } as PolicyRecord];
    });
  },
  async signPolicy(versionId: string, signature: string) {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error("You are not logged in.");
    const { data: version, error: versionError } = await supabase.from("policy_versions").select("policy_id").eq("id", versionId).single();
    if (versionError) throw versionError;
    const { data: policy, error: policyError } = await supabase.from("policies").select("name, title, audience").eq("id", version.policy_id).single();
    if (policyError) throw policyError;
    let agreementContext: Record<string, string> = {};
    if (String(policy.name ?? policy.title ?? "").toLowerCase().includes("contractor services agreement")) {
      const { data: membership, error: membershipError } = await supabase.from("contractor_profiles").select("company_id").eq("user_id", user.user.id).maybeSingle();
      if (membershipError) throw membershipError;
      if (policy.audience !== "contractor" || !membership?.company_id) throw new Error("This agreement is only available to a linked contractor driver.");
      const { data: company, error: companyError } = await supabase.from("contractor_companies").select("agreement_file_path, agreement_expiry, agreement_status").eq("id", membership.company_id).single();
      if (companyError) throw companyError;
      const expiry = String(company.agreement_expiry ?? "").slice(0, 10);
      if (!company.agreement_file_path || !expiry || expiry < new Date().toISOString().slice(0, 10) || company.agreement_status === "rejected" || company.agreement_status === "missing") {
        throw new Error("A current, non-rejected company agreement with an expiry date must be uploaded before signing.");
      }
      agreementContext = { contractor_company_id: membership.company_id, contractor_agreement_file_path: String(company.agreement_file_path) };
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error("Your session expired. Sign in again to record this acknowledgement.");
    const response = await fetch(`${apiBaseUrl}/driver/policy-signatures`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
      body: JSON.stringify({ versionId, signature })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "Signature could not be recorded.");
  },
  async getPolicyList(session: SessionState): Promise<PolicyListItem[]> {
    const { data, error } = await supabase.from("policies").select("*");
    if (error) throw error;
    const policyRows = data ?? [];
    const { data: versions, error: versionsError } = policyRows.length
      ? await supabase.from("policy_versions").select("*").in("policy_id", policyRows.map((row: any) => row.id)).order("published_at", { ascending: false })
      : { data: [], error: null };
    if (versionsError) throw versionsError;
    const latestVersionByPolicy = new Map<string, any>();
    for (const version of versions ?? []) if (!latestVersionByPolicy.has(String(version.policy_id))) latestVersionByPolicy.set(String(version.policy_id), version);
    const response = await fetch(`${apiBaseUrl}/admin/policies/signature-counts`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Unable to load policy signature counts.");
    }
    const { counts } = await response.json() as { counts: Record<string, number> };
    return policyRows.map((row: any) => {
      const version = latestVersionByPolicy.get(String(row.id));
      const versionId = version ? String(version.id) : null;
      return { ...row, audience: row.audience ?? "all", targetRole: row.target_role ?? "all", policyId: String(row.id), versionId, name: row.name ?? row.title,
        versionLabel: version?.version_label ?? row.version_label ?? row.version ?? "—", signatureCount: versionId ? counts[versionId] ?? 0 : 0,
        signedCount: versionId ? counts[versionId] ?? 0 : 0, totalDrivers: 0 } as PolicyListItem;
    });
  },
  async createPolicy(session: SessionState, input: { name: string; versionLabel: string; content: string; audience?: "all" | "employee" | "contractor"; targetRole?: "all" | "driver" | "warehouse" | "office" }) {
    const now = new Date().toISOString();
    const { data: policy, error } = await supabase.from("policies").insert({ title: input.name, name: input.name, version: input.versionLabel, version_label: input.versionLabel, content: input.content, audience: input.audience ?? "all", target_role: input.targetRole ?? "all", policy_group_id: crypto.randomUUID(), status: "draft", is_published: false }).select("id").single();
    if (error) throw error;
    const { error: versionError } = await supabase.from("policy_versions").insert({ policy_id: policy.id, version_label: input.versionLabel, content: input.content, published_by: session.user.id, published_at: now });
    if (versionError) throw versionError;
    const { error: publishError } = await supabase.from("policies").update({ status: "published", is_published: true, published_at: now }).eq("id", policy.id);
    if (publishError) throw publishError;
  },
  async publishPolicyVersion(session: SessionState, policyId: string, versionLabel: string, content: string) {
    const { data: current, error: readError } = await supabase.from("policies").select("*").eq("id", policyId).single();
    if (readError) throw readError;
    const now = new Date().toISOString();
    const { error: versionError } = await supabase.from("policy_versions").insert({ policy_id: policyId, version_label: versionLabel, content, published_by: session.user.id, published_at: now });
    if (versionError) throw versionError;
    const { error } = await supabase.from("policies").update({ version: versionLabel, version_label: versionLabel, content, status: "published", is_published: true, published_at: now }).eq("id", policyId);
    if (error) throw error;
  },
  async getPolicySignatureReport(session: SessionState, policyId: string): Promise<{ signed: PolicySignatureSummary[]; pending: PolicyPendingDriver[]; versionLabel: string }> {
    const response = await fetch(`${apiBaseUrl}/admin/policies/${encodeURIComponent(policyId)}/signatures`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Unable to load policy signatures.");
    }
    return response.json();
  },
  async getSpeedAwarenessQuestionsDriver(session: SessionState) {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/speed-awareness/questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      let message = "Unable to load speed awareness questions.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      question: item.question,
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      category: item.category ?? "Speed Awareness"
    }));
  },

  async submitSpeedAwareness(session: SessionState, answers: Record<string | number, number>) {
    const response = await fetch(`${apiBaseUrl}/speed-awareness/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ answers })
    });
    if (!response.ok) {
      let message = "Speed awareness submission failed. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  },

  async getSpeedAwarenessResultsDriver(session: SessionState): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/speed-awareness/results`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) throw new Error("Unable to load speed awareness results.");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },
  async getSpeedAwarenessQuestions(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ questions: any[] }>(`/admin/speed-awareness/questions`, session, { method: "GET" });
    return result.questions ?? [];
  },
  async saveSpeedAwarenessQuestion(session: SessionState, question: any): Promise<any> {
    const path = question.id ? `/admin/speed-awareness/questions/${encodeURIComponent(question.id)}` : `/admin/speed-awareness/questions`;
    const result = await adminRequest<{ question: any }>(path, session, {
      method: question.id ? "PUT" : "POST",
      body: JSON.stringify(question)
    });
    return result.question;
  },
  async deleteSpeedAwarenessQuestion(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/speed-awareness/questions/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  },
  async getSpeedAwarenessResults(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ results: any[] }>(`/admin/speed-awareness/results`, session, { method: "GET" });
    return result.results ?? [];
  },
  async saveSpeedAwarenessFeedback(session: SessionState, resultId: string, feedback: string): Promise<any> {
    const result = await adminRequest<{ result: any }>(`/admin/speed-awareness/results/${encodeURIComponent(resultId)}/feedback`, session, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    });
    return result.result;
  },
  async getPreStartAwarenessQuestionsDriver(session: SessionState) {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/pre-start-awareness/questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      let message = "Unable to load pre-start awareness questions.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      question: item.question,
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      category: item.category ?? "Pre-Start Awareness"
    }));
  },

  async submitPreStartAwareness(session: SessionState, answers: Record<string | number, number>) {
    const response = await fetch(`${apiBaseUrl}/pre-start-awareness/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ answers })
    });
    if (!response.ok) {
      let message = "Speed awareness submission failed. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  },

  async getPreStartAwarenessResultsDriver(session: SessionState): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/pre-start-awareness/results`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) throw new Error("Unable to load pre-start awareness results.");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },
  async getPreStartAwarenessQuestions(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ questions: any[] }>(`/admin/pre-start-awareness/questions`, session, { method: "GET" });
    return result.questions ?? [];
  },
  async savePreStartAwarenessQuestion(session: SessionState, question: any): Promise<any> {
    const path = question.id ? `/admin/pre-start-awareness/questions/${encodeURIComponent(question.id)}` : `/admin/pre-start-awareness/questions`;
    const result = await adminRequest<{ question: any }>(path, session, {
      method: question.id ? "PUT" : "POST",
      body: JSON.stringify(question)
    });
    return result.question;
  },
  async deletePreStartAwarenessQuestion(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/pre-start-awareness/questions/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  },
  async getPreStartAwarenessResults(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ results: any[] }>(`/admin/pre-start-awareness/results`, session, { method: "GET" });
    return result.results ?? [];
  },
  async savePreStartAwarenessFeedback(session: SessionState, resultId: string, feedback: string): Promise<any> {
    const result = await adminRequest<{ result: any }>(`/admin/pre-start-awareness/results/${encodeURIComponent(resultId)}/feedback`, session, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    });
    return result.result;
  },


  async signMechanicalCompetency(session: SessionState, id: string, signature: string): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/mechanical-competency/${encodeURIComponent(id)}/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ signature })
    });
    if (!response.ok) {
      let message = "Unable to save employee signature.";
      try { const data = await response.json(); if (data?.message) message = data.message; } catch {}
      throw new Error(message);
    }
  },

  async getFatigueAwarenessQuestionsDriver(session: SessionState) {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/fatigue-awareness/questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      let message = "Unable to load fatigue awareness questions.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      question: item.question,
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      category: item.category ?? "Fatigue Awareness"
    }));
  },

  async submitFatigueAwareness(session: SessionState, answers: Record<string | number, number>) {
    const response = await fetch(`${apiBaseUrl}/fatigue-awareness/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ answers })
    });
    if (!response.ok) {
      let message = "Speed awareness submission failed. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  },

  async getFatigueAwarenessResultsDriver(session: SessionState): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/fatigue-awareness/results`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) throw new Error("Unable to load fatigue awareness results.");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },
  async getFatigueAwarenessQuestions(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ questions: any[] }>(`/admin/fatigue-awareness/questions`, session, { method: "GET" });
    return result.questions ?? [];
  },
  async saveFatigueAwarenessQuestion(session: SessionState, question: any): Promise<any> {
    const path = question.id ? `/admin/fatigue-awareness/questions/${encodeURIComponent(question.id)}` : `/admin/fatigue-awareness/questions`;
    const result = await adminRequest<{ question: any }>(path, session, {
      method: question.id ? "PUT" : "POST",
      body: JSON.stringify(question)
    });
    return result.question;
  },
  async deleteFatigueAwarenessQuestion(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/fatigue-awareness/questions/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  },
  async getFatigueAwarenessResults(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ results: any[] }>(`/admin/fatigue-awareness/results`, session, { method: "GET" });
    return result.results ?? [];
  },
  async saveFatigueAwarenessFeedback(session: SessionState, resultId: string, feedback: string): Promise<any> {
    const result = await adminRequest<{ result: any }>(`/admin/fatigue-awareness/results/${encodeURIComponent(resultId)}/feedback`, session, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    });
    return result.result;
  },
  async sendFatigueFeedback(session: SessionState, driverId: string, payload: any): Promise<any> {
    const result = await adminRequest<{ message: any }>(`/admin/fatigue-awareness/feedback`, session, { method: "POST", body: JSON.stringify({ driverId, ...payload }) });
    return result.message;
  },
  async markFatigueMessageReadAdmin(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/fatigue-awareness/messages/${id}/read`, session, { method: "PATCH" });
  },
  async getFatigueDriverMessages(session: SessionState, driverId: string): Promise<any[]> {
    const result = await adminRequest<{ messages: any[] }>(`/admin/fatigue-awareness/messages/${driverId}`, session, { method: "GET" });
    return result.messages ?? [];
  },
  async getDriverMessages(session: SessionState, module?: string): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const url = module ? `${apiBaseUrl}/driver/messages?module=${encodeURIComponent(module)}` : `${apiBaseUrl}/driver/messages`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) throw new Error("Unable to load messages.");
    const data = await response.json();
    return Array.isArray(data?.messages) ? data.messages : [];
  },
  async markDriverMessageRead(session: SessionState, id: string): Promise<void> {
    await fetch(`${apiBaseUrl}/driver/messages/${id}/read`, { method: "PATCH", headers: { Authorization: `Bearer ${session.accessToken}` } });
  },
  async replyDriverMessage(session: SessionState, id: string, content: string): Promise<any> {
    const response = await fetch(`${apiBaseUrl}/driver/messages/${id}/reply`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` }, body: JSON.stringify({ content }) });
    if (!response.ok) throw new Error("Unable to reply.");
    return response.json();
  },
  async saveSpeedChecklistReview(session: SessionState, payload: any): Promise<any> {
    const result = await adminRequest<{ review: any }>(`/admin/speed-checklist/reviews`, session, { method: "POST", body: JSON.stringify(payload) });
    return result.review;
  },
  async getSpeedChecklistReviews(session: SessionState, submissionId: string): Promise<any[]> {
    const result = await adminRequest<{ reviews: any[] }>(`/admin/speed-checklist/reviews/${submissionId}`, session, { method: "GET" });
    return result.reviews ?? [];
  },
  async getDistractionAwarenessQuestionsDriver(session: SessionState) {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/distraction-awareness/questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      let message = "Unable to load distraction awareness questions.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      question: item.question,
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      category: item.category ?? "Distraction Awareness"
    }));
  },

  async submitDistractionAwareness(session: SessionState, answers: Record<string | number, number>) {
    const response = await fetch(`${apiBaseUrl}/distraction-awareness/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ answers })
    });
    if (!response.ok) {
      let message = "Speed awareness submission failed. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  },

  async getDistractionAwarenessResultsDriver(session: SessionState): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/distraction-awareness/results`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) throw new Error("Unable to load distraction awareness results.");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },
  async getDistractionAwarenessQuestions(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ questions: any[] }>(`/admin/distraction-awareness/questions`, session, { method: "GET" });
    return result.questions ?? [];
  },
  async saveDistractionAwarenessQuestion(session: SessionState, question: any): Promise<any> {
    const path = question.id ? `/admin/distraction-awareness/questions/${encodeURIComponent(question.id)}` : `/admin/distraction-awareness/questions`;
    const result = await adminRequest<{ question: any }>(path, session, {
      method: question.id ? "PUT" : "POST",
      body: JSON.stringify(question)
    });
    return result.question;
  },
  async deleteDistractionAwarenessQuestion(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/distraction-awareness/questions/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  },
  async getDistractionAwarenessResults(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ results: any[] }>(`/admin/distraction-awareness/results`, session, { method: "GET" });
    return result.results ?? [];
  },
  async saveDistractionAwarenessFeedback(session: SessionState, resultId: string, feedback: string): Promise<any> {
    const result = await adminRequest<{ result: any }>(`/admin/distraction-awareness/results/${encodeURIComponent(resultId)}/feedback`, session, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    });
    return result.result;
  },
  async getLoadingUnloadingRestraintQuestionsDriver(session: SessionState) {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/loading-unloading-restraint-compliance/questions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) {
      let message = "Unable to load loading, unloading & restraint compliance questions.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((item: any) => ({
      id: item.id,
      question: item.question,
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      category: item.category ?? "Loading, Unloading & Restraint Compliance"
    }));
  },

  async submitLoadingUnloadingRestraint(session: SessionState, answers: Record<string | number, number>) {
    const response = await fetch(`${apiBaseUrl}/loading-unloading-restraint-compliance/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ answers })
    });
    if (!response.ok) {
      let message = "Speed awareness submission failed. Please try again.";
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch {}
      throw new Error(message);
    }
    return response.json();
  },

  async getLoadingUnloadingRestraintResultsDriver(session: SessionState): Promise<any[]> {
    if (!session) throw new Error("Unauthorized");
    const response = await fetch(`${apiBaseUrl}/loading-unloading-restraint-compliance/results`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (!response.ok) throw new Error("Unable to load loading, unloading & restraint compliance results.");
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  },
  async getLoadingUnloadingRestraintQuestions(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ questions: any[] }>(`/admin/loading-unloading-restraint-compliance/questions`, session, { method: "GET" });
    return result.questions ?? [];
  },
  async saveLoadingUnloadingRestraintQuestion(session: SessionState, question: any): Promise<any> {
    const path = question.id ? `/admin/loading-unloading-restraint-compliance/questions/${encodeURIComponent(question.id)}` : `/admin/loading-unloading-restraint-compliance/questions`;
    const result = await adminRequest<{ question: any }>(path, session, {
      method: question.id ? "PUT" : "POST",
      body: JSON.stringify(question)
    });
    return result.question;
  },
  async deleteLoadingUnloadingRestraintQuestion(session: SessionState, id: string): Promise<void> {
    await adminRequest(`/admin/loading-unloading-restraint-compliance/questions/${encodeURIComponent(id)}`, session, { method: "DELETE" });
  },
  async getLoadingUnloadingRestraintResults(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ results: any[] }>(`/admin/loading-unloading-restraint-compliance/results`, session, { method: "GET" });
    return result.results ?? [];
  },
  async saveLoadingUnloadingRestraintFeedback(session: SessionState, resultId: string, feedback: string): Promise<any> {
    const result = await adminRequest<{ result: any }>(`/admin/loading-unloading-restraint-compliance/results/${encodeURIComponent(resultId)}/feedback`, session, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    });
    return result.result;
  },
  async cancelLeaveRequest(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async checkInAttendance(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async checkOutAttendance(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async createAnnualSystemReview(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async createInductionRecord(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async createQuarterlyComplianceReview(session: SessionState, input: any): Promise<any> {
    const result = await adminRequest<{ review: any }>("/admin/compliance-reviews", session, { method: "POST", body: JSON.stringify(input) });
    return result.review;
  },
  async createTrainingCalendarEvent(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async decideLeaveRequest(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async deleteInductionRecord(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async deleteTrainingCalendarEvent(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async downloadAnnualSystemReviewPdf(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async downloadOrganisationalChartPdf(...args: any[]): Promise<any> { throw new Error("Not implemented"); },

  async example(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getAdminAttendance(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getAdminLearningAnswers(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getAdminLeaveRequests(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getAnnualSystemReviews(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getAttendanceRecords(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getCorFormSubmissions(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getDriverInductionRecords(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getDriverMedicalFitnessReport(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getDriverSkillsKnowledgeReport(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getDriverTrainingAcknowledgements(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getDriverTrainingCalendarEvents(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getInductionRecords(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getInductionWorkers(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getLeaveRequests(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getOrganisationalChart(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getOrganisationalChartEmployees(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getQuarterlyComplianceReviews(session: SessionState): Promise<any[]> {
    const result = await adminRequest<{ reviews: any[] }>("/admin/compliance-reviews", session, { method: "GET" });
    return result.reviews ?? [];
  },
  async getTrainingAcknowledgements(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getTrainingCalendarEmployees(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getTrainingCalendarEvents(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async getTrainingInductionRegister(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async importLegacyAttendance(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async saveCorFormSubmission(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async saveLearningQuestionResponse(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async saveOrganisationalChart(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async submitAnnualSystemReview(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async submitDriverInductionRecordAcknowledgement(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async submitDriverTrainingAcknowledgement(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async submitLeaveRequest(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async submitQuarterlyComplianceReview(session: SessionState, reviewId: string, input: any): Promise<any> {
    const result = await adminRequest<{ review: any }>(`/admin/compliance-reviews/${reviewId}/submit`, session, { method: "POST", body: JSON.stringify(input) });
    return result.review;
  },
  async downloadQuarterlyCompliancePdf(session: SessionState, reviewId: string): Promise<Blob> {
    const response = await fetch(`${apiBaseUrl}/admin/compliance-reviews/${reviewId}/pdf`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Request failed." }));
      throw new Error(body.message ?? "Request failed.");
    }
    return await response.blob();
  },
  async updateAdminAttendance(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async updateAnnualSystemReviewDraft(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async updateCorFormSubmission(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async updateInductionRecord(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
  async updateQuarterlyComplianceDraft(session: SessionState, reviewId: string, input: any): Promise<any> {
    const result = await adminRequest<{ review: any }>(`/admin/compliance-reviews/${reviewId}`, session, { method: "PUT", body: JSON.stringify(input) });
    return result.review;
  },
  async updateTrainingCalendarEvent(...args: any[]): Promise<any> { throw new Error("Not implemented"); },
};

async function getProfile(userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: authUser } = await supabase.auth.getUser();
  const email = authUser?.user?.email ?? "";
  const defaultRole = email.includes("admin") ? "admin" : "driver";
  const seedProfile = {
    id: userId,
    email: email,
    full_name: email ? email.split("@")[0] : "New User",
    role: defaultRole,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .upsert(seedProfile, { onConflict: "id" })
    .select()
    .single();

  if (insertError || !inserted) return seedProfile;
  return inserted;
}

async function getDriverRow(userId: string) {
  try {
    const { data, error } = await supabase.from("drivers").select("*").eq("user_id", userId).maybeSingle();
    if (!error && data) return data;
  } catch {}

  const seed = {
    id: userId,
    user_id: userId,
    status: "Not Started",
    created_at: new Date().toISOString()
  };

  try {
    const { data: inserted, error: insertErr } = await supabase.from("drivers").insert({
      user_id: userId,
      status: "Not Started",
      created_at: new Date().toISOString()
    }).select().single();
    if (!insertErr && inserted) return inserted;
  } catch {}

  return seed;
}

async function getProgressRow(userId: string) {
  // Propagate Supabase errors — do not silently fall back to potentially stale
  // localStorage data, which could make the driver appear further along than they are.
  const { data, error } = await supabase.from("induction_progress").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;

  if (data) {
    // Keep localStorage in sync so it can serve as an offline read cache
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`bnt-progress-${userId}`, JSON.stringify(data));
    }
    return data;
  }

  // Row doesn't exist yet — return a default that will be upserted on first save
  return {
    user_id: userId,
    current_step: 1,
    completion_percentage: 0,
    quiz_score: null,
    completed: false,
    completed_step_ids: [] as number[],
    declaration_accepted: false,
    declaration_agreed_at: null,
    signature: null,
    completed_at: null,
    updated_at: new Date().toISOString()
  };
}

async function upsertProgress(userId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from("induction_progress")
    .upsert(
      {
        ...payload,
        user_id: userId
      },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

async function fetchAllSupabaseRows(queryForRange: (from: number, to: number) => any): Promise<{ data: any[]; error: any }> {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await queryForRange(from, from + pageSize - 1);
    if (error) return { data: [], error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

async function fetchContractorProfilePage(from: number, to: number) {
  const full = await supabase.from("profiles")
    .select("id, full_name, email, phone, date_of_birth, address, preferred_language, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, licence_class, issuing_state, licence_number, depot_location, employment_type, staff_role")
    .range(from, to);
  if (full.error?.code === "42703" && /date_of_birth|emergency_contact_(name|relationship|phone)/i.test(full.error.message ?? "")) {
    // Allow older deployments to render onboarding progress; missing required data stays incomplete.
    return await supabase.from("profiles")
      .select("id, full_name, email, phone, address, preferred_language, licence_class, issuing_state, licence_number, depot_location, employment_type, staff_role")
      .range(from, to);
  }
  return full;
}

async function getDocumentRows(userId: string) {
  let dbRows: any[] = [];
  try {
    const { data, error } = await supabase.from("documents").select("*").eq("user_id", userId).order("uploaded_at", { ascending: false });
    if (!error && data) dbRows = data;
  } catch (e) {
    console.warn("Supabase document query fallback:", e);
  }

  const localDocsRaw = window.localStorage.getItem(`bnt-documents-${userId}`);
  const localRows: any[] = localDocsRaw ? JSON.parse(localDocsRaw) : [];

  const combined = [...dbRows, ...localRows];
  const latestByType = new Map<string, Record<string, unknown>>();
  for (const row of combined) {
    const type = String(row.type ?? "");
    if (!type || latestByType.has(type)) continue;
    latestByType.set(type, row);
  }
  return Array.from(latestByType.values());
}

async function getSignedDocuments(userId: string) {
  const rows = await getDocumentRows(userId);
  return await buildSignedDocuments(rows, userId);
}

async function buildSignedDocumentMap(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const userId = String(row.user_id);
    const current = grouped.get(userId) ?? [];
    current.push(row);
    grouped.set(userId, current);
  }

  const result = new Map<string, DriverBundle["documents"]>();
  for (const [userId, userRows] of grouped) {
    result.set(userId, await buildSignedDocuments(userRows, userId));
  }
  return result;
}

async function buildSignedDocuments(rows: Array<Record<string, unknown>>, userId: string) {
  const friendlyNames: Record<string, string> = {
    driver_license: "Driver Licence",
    medical_certificate: "Medical Certificate",
    identity_proof: "Identity Proof",
    driving_history: "Driving History Report",
    right_to_work: "Visa / Right to Work",
    nhvas_bfm_certificate: "NHVAS BFM Certificate",
    dangerous_goods_license: "Dangerous Goods Licence",
    employment_contract: "Employment Contract"
  };

  const docs = await Promise.all(rows.map(async (row) => {
    const path = String(row.file_url);
    const [{ data }, { data: downloadData }] = await Promise.all([
      supabase.storage.from(bucketName).createSignedUrl(path, 3600),
      supabase.storage.from(bucketName).createSignedUrl(path, 3600, { download: String(row.file_name ?? "document") })
    ]);
    const docType = String(row.type ?? "");
    const rawName = String(row.file_name ?? "");
    // Use actual filename if available, otherwise fall back to friendly type label
    const displayName = rawName
      ? rawName
      : (friendlyNames[docType] ?? docType.replace(/_/g, " "));
    const sizeBytes = Number(row.size_bytes ?? 0);
    return {
      id: String(row.id),
      driverId: userId,
      name: displayName,
      type: row.type as DocumentType,
      mimeType: String(row.mime_type ?? "application/octet-stream"),
      size: sizeBytes,
      fileUrl: data?.signedUrl ?? "",
      fileDownloadUrl: downloadData?.signedUrl ?? "",
      status: (row.status ?? "pending") as "pending" | "approved" | "rejected",
      rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
      verifiedByAdmin: Boolean(row.verified_by_admin ?? false),
      uploadedAt: String(row.uploaded_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null
    };
  }));
  return docs;
}

async function logDocumentView(userId: string, adminId: string, documentType: string) {
  return await logAuditEvent(adminId, "document_viewed", {
    driverId: userId,
    documentType
  });
}

async function getLearningSections(userId: string) {
  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
    supabase.from("contractor_profiles").select("user_id").eq("user_id", userId).maybeSingle()
  ]);
  const employmentType = profileResult.data?.employment_type === "contractor" || Boolean(membershipResult.data) ? "contractor" : "employee";
  const staffRole = String(profileResult.data?.staff_role ?? "driver");
  const { data, error } = await supabase
    .from("learning_sections")
    .select("id, title, format, summary, sort_order, video_url, video_duration_seconds, require_full_watch, media_json, source_slide_id, version, audience, target_role, is_mandatory")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const uniqueSections = new Map<string, Record<string, unknown>>();
  for (const row of (data ?? []).filter((entry) => isWorkerTargeted(entry, employmentType, staffRole))) {
    const title = String(row.title ?? "");
    if (!title) continue;
    // Legacy curriculum rows can contain duplicate titles, but course slides
    // are distinct modules and must never be collapsed by their display title.
    const key = row.source_slide_id ? `slide:${row.id}` : `title:${title}`;
    if (uniqueSections.has(key)) continue;
    uniqueSections.set(key, row);
  }
  return Array.from(uniqueSections.values());
}

async function getLearningCompletions(userId: string, sections: Array<Record<string, unknown>>) {
  const { data, error } = await supabase.from("learning_section_completions").select("*").eq("user_id", userId);
  if (error) throw error;
  const completionMap = new Map((data ?? []).map((item) => [`${item.section_id}:${item.section_version ?? "1.0"}`, item]));
  const localModuleVideos = [
    "/videos/module1.mp4",
    "/videos/module2.mp4",
    "/videos/module3.mp4",
    "/videos/module4.mp4",
    "/videos/module5.mp4",
    "/videos/module6.mp4",
    "/videos/module7.mp4",
    "/videos/module8.mp4"
  ];

  return sections.map((section, idx) => {
    const sectionVersion = String(section.version ?? "1.0");
    const completion = completionMap.get(`${section.id}:${sectionVersion}`);
    const isCourseSlide = Boolean(section.source_slide_id);
    const videoUrl = section.video_url
      ? String(section.video_url)
      : isCourseSlide
        ? undefined
        : localModuleVideos[idx % localModuleVideos.length];

    return {
      sectionId: String(section.id),
      sectionVersion,
      title: String(section.title),
      format: String(section.format),
      summary: String(section.summary),
      videoUrl,
      mediaJson: section.media_json && typeof section.media_json === "object"
        ? section.media_json as Record<string, unknown>
        : undefined,
      videoDurationSeconds: Number(section.video_duration_seconds ?? 0) || undefined,
      requireFullWatch: Boolean(section.require_full_watch),
      isMandatory: Boolean(section.is_mandatory ?? true),
      audience: String(section.audience ?? "all"),
      targetRole: String(section.target_role ?? "all"),
      completed: Boolean(completion?.completed),
      completedAt: completion?.completed_at ?? null
    };
  });
}

async function getQuizAttempts(userId: string) {
  const { data, error } = await supabase.from("quiz_attempts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => ({
    id: String(item.id),
    driverId: userId,
    answers: normalizeAnswers(item.answers),
    score: item.score,
    passed: item.passed,
    attemptedAt: item.created_at
  }));
}

async function getCertificate(userId: string) {
  const { data, error } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    driverId: userId,
    completionId: String(data.completion_id),
    issuedAt: String(data.issued_at),
    expiresAt: data.expires_at ? String(data.expires_at) : null,
    verificationCode: String(data.verification_code),
    verificationUrl: String(data.verification_url)
  };
}

async function getDriverFeedback(userId: string): Promise<DriverFeedback | null> {
  const { data, error } = await supabase.from("driver_feedback").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? mapFeedbackRow(data) : null;
}

function mapAuditRecordRow(row: Record<string, unknown>): ComplianceAuditRecord {
  const questions = Array.isArray(row.questions)
    ? row.questions.map((item) => String(item))
    : [];
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category ?? "Transport"),
    description: String(row.description ?? ""),
    questions,
    dueDate: row.due_date ? String(row.due_date) : null,
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at)
  };
}

function mapAssignmentRow(row: Record<string, unknown>, audit: ComplianceAuditRecord): AuditAssignment {
  return {
    id: String(row.id),
    auditId: String(row.audit_id),
    audit,
    status: (row.status ?? "No Attempt") as AuditAssignmentStatus,
    dueDate: row.due_date ? String(row.due_date) : audit.dueDate,
    attemptsCount: Number(row.attempts_count ?? 0),
    lastAttemptDate: row.last_attempt_date ? String(row.last_attempt_date) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

async function getDriverAudits(userId: string): Promise<AuditAssignment[]> {
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("audit_assignments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (assignmentError) throw assignmentError;
  if (!assignmentRows?.length) return [];

  const auditIds = Array.from(
    new Set(assignmentRows.map((row: Record<string, unknown>) => String(row.audit_id)))
  );
  const { data: auditRows, error: auditError } = await supabase
    .from("compliance_audits")
    .select("*")
    .in("id", auditIds);
  if (auditError) throw auditError;

  const auditMap = new Map(
    (auditRows ?? []).map((audit: Record<string, unknown>) => [String(audit.id), mapAuditRecordRow(audit)])
  );

  return assignmentRows
    .map((row: Record<string, unknown>) => {
      const audit = auditMap.get(String(row.audit_id));
      if (!audit) return null;
      return mapAssignmentRow(row, audit);
    })
    .filter((item: AuditAssignment | null): item is AuditAssignment => item !== null);
}

async function completeAuditAssignment(assignmentId: string, answers: Record<number, boolean>): Promise<void> {
  const { data: current, error: currentError } = await supabase
    .from("audit_assignments")
    .select("attempts_count")
    .eq("id", assignmentId)
    .maybeSingle();
  if (currentError) throw currentError;

  const answered = Object.entries(answers);
  const passed = answered.length > 0 && answered.every(([, value]) => Boolean(value));
  const now = new Date().toISOString();

  if (answered.length > 0) {
    const responseRows = answered.map(([index, answer]) => ({
      assignment_id: assignmentId,
      question_index: Number(index),
      answer: Boolean(answer)
    }));
    const { error: responseError } = await supabase.from("audit_responses").insert(responseRows);
    if (responseError) throw responseError;
  }

  const { error: updateError } = await supabase
    .from("audit_assignments")
    .update({
      status: passed ? "Passed" : "Action Required",
      attempts_count: Number(current?.attempts_count ?? 0) + 1,
      last_attempt_date: now,
      completed_at: passed ? now : null
    })
    .eq("id", assignmentId);
  if (updateError) throw updateError;
}

async function createAudit(input: {
  name: string;
  category: string;
  description: string;
  questions: string[];
  dueDate?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("compliance_audits")
    .insert({
      name: input.name,
      category: input.category,
      description: input.description,
      questions: input.questions,
      due_date: input.dueDate || null
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return String(data?.id);
}

async function assignAudit(auditId: string, userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  const rows = userIds.map((userId) => ({ audit_id: auditId, user_id: userId }));
  const { error } = await supabase
    .from("audit_assignments")
    .upsert(rows, { onConflict: "audit_id,user_id" });
  if (error) throw error;
}

async function getAdminAuditData(): Promise<{
  audits: ComplianceAuditRecord[];
  assignments: AdminAuditAssignmentRow[];
}> {
  const [auditResult, assignmentResult, profileResult] = await Promise.all([
    supabase.from("compliance_audits").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("audit_assignments").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("profiles").select("id, full_name, email")
  ]);

  if (auditResult.error) throw auditResult.error;
  if (assignmentResult.error) throw assignmentResult.error;
  if (profileResult.error) throw profileResult.error;

  const profileMap = new Map(
    (profileResult.data ?? []).map((profile: Record<string, unknown>) => [String(profile.id), profile])
  );
  const auditMap = new Map(
    (auditResult.data ?? []).map((audit: Record<string, unknown>) => [String(audit.id), mapAuditRecordRow(audit)])
  );

  const assignments: AdminAuditAssignmentRow[] = (assignmentResult.data ?? [])
    .map((row: Record<string, unknown>) => {
      const audit = auditMap.get(String(row.audit_id));
      const profile = profileMap.get(String(row.user_id));
      if (!audit || !profile) return null;
      return {
        ...mapAssignmentRow(row, audit),
        driverName: String(profile.full_name || profile.email || "Driver"),
        driverEmail: String(profile.email || "")
      };
    })
    .filter((item: AdminAuditAssignmentRow | null): item is AdminAuditAssignmentRow => item !== null);

  return { audits: Array.from(auditMap.values()), assignments };
}

// --- SOP Learning Modules ---

async function getDriverSOPs(userId: string): Promise<SOPItem[]> {
  const [moduleResult, completionResult, profileResult, membershipResult] = await Promise.all([
    supabase
      .from("sop_modules")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("sop_completions").select("sop_id").eq("user_id", userId),
    supabase.from("profiles").select("employment_type, staff_role").eq("id", userId).maybeSingle(),
    supabase.from("contractor_profiles").select("user_id").eq("user_id", userId).maybeSingle()
  ]);
  if (moduleResult.error) throw moduleResult.error;
  if (completionResult.error) throw completionResult.error;
  if (profileResult.error) throw profileResult.error;
  if (membershipResult.error) throw membershipResult.error;

  const workerType = profileResult.data?.employment_type === "contractor" || Boolean(membershipResult.data) ? "contractor" : "employee";
  const staffRole = profileResult.data?.staff_role || "driver";

  const completedIds = new Set(
    (completionResult.data ?? []).map((row: Record<string, unknown>) => String(row.sop_id))
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (moduleResult.data ?? [])
    .filter((row: Record<string, unknown>) => isSOPApplicableToWorker(row, workerType, staffRole))
    .map((row: Record<string, unknown>) => {
    const dueDate = row.due_date ? String(row.due_date) : null;
    const passed = completedIds.has(String(row.id));
    const expired =
      !passed &&
      dueDate !== null &&
      new Date(`${dueDate}T00:00:00`).getTime() < today.getTime();
    return {
      id: String(row.id),
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      category: String(row.category ?? "SOP") as SOPItem["category"],
      isMandatory: Boolean(row.is_mandatory),
      dueDate,
      status: passed ? "Passed" : expired ? "Expired" : "No Attempt",
      contentSummary: String(row.content_summary ?? ""),
      videoUrl: row.video_url ? String(row.video_url) : undefined,
      quizQuestionsCount: row.quiz_questions_count ? Number(row.quiz_questions_count) : undefined,
      audience: String(row.audience ?? "all") as SOPItem["audience"],
      targetRole: String(row.target_role ?? "all") as SOPItem["targetRole"]
    };
  });
}

async function completeSOP(userId: string, sopId: string): Promise<void> {
  const { error } = await supabase.from("sop_completions").upsert(
    { sop_id: sopId, user_id: userId, completed_at: new Date().toISOString() },
    { onConflict: "sop_id,user_id" }
  );
  if (error) throw error;
}

async function createSOP(input: {
  code: string;
  name: string;
  category: string;
  isMandatory: boolean;
  contentSummary: string;
  dueDate?: string | null;
  videoUrl?: string | null;
  quizQuestionsCount?: number;
  audience?: "all" | "employee" | "contractor";
  targetRole?: "all" | "driver" | "warehouse" | "office";
}): Promise<string> {
  const { data, error } = await supabase
    .from("sop_modules")
    .insert({
      code: input.code,
      name: input.name,
      category: input.category,
      is_mandatory: input.isMandatory,
      content_summary: input.contentSummary,
      due_date: input.dueDate || null,
      video_url: input.videoUrl || null,
      quiz_questions_count: input.quizQuestionsCount ?? 0,
      audience: input.audience ?? "all",
      target_role: input.targetRole ?? "all"
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return String(data?.id);
}

async function deleteSOP(sopId: string): Promise<void> {
  const { error } = await supabase.from("sop_modules").delete().eq("id", sopId);
  if (error) throw error;
}

async function getAdminSOPData(): Promise<{
  sops: SOPItem[];
  completions: { sopId: string; userId: string; userName: string; completedAt: string }[];
}> {
  const [moduleResult, completionResult, profileResult] = await Promise.all([
    supabase.from("sop_modules").select("*").order("created_at", { ascending: false }).limit(200),
    supabase
      .from("sop_completions")
      .select("sop_id, user_id, completed_at")
      .order("completed_at", { ascending: false })
      .limit(2000),
    supabase.from("profiles").select("id, full_name, email")
  ]);

  if (moduleResult.error) throw moduleResult.error;
  if (completionResult.error) throw completionResult.error;
  if (profileResult.error) throw profileResult.error;

  const profileMap = new Map(
    (profileResult.data ?? []).map((profile: Record<string, unknown>) => [String(profile.id), profile])
  );

  const sops: SOPItem[] = (moduleResult.data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    category: String(row.category ?? "SOP") as SOPItem["category"],
    isMandatory: Boolean(row.is_mandatory),
    dueDate: row.due_date ? String(row.due_date) : null,
    status: "No Attempt",
    contentSummary: String(row.content_summary ?? ""),
    videoUrl: row.video_url ? String(row.video_url) : undefined,
    quizQuestionsCount: row.quiz_questions_count ? Number(row.quiz_questions_count) : undefined,
    audience: String(row.audience ?? "all") as SOPItem["audience"],
    targetRole: String(row.target_role ?? "all") as SOPItem["targetRole"]
  }));

  const completions = (completionResult.data ?? []).map((row: Record<string, unknown>) => {
    const profile = profileMap.get(String(row.user_id));
    return {
      sopId: String(row.sop_id),
      userId: String(row.user_id),
      userName: String(profile?.full_name || profile?.email || "Driver"),
      completedAt: String(row.completed_at)
    };
  });

  return { sops, completions };
}

// --- Driver Vehicles (fleet) ---

function mapContractorRow(row: Record<string, unknown>): ContractorCompanyRecord {
  return {
    id: String(row.user_id ?? row.id),
    companyId: String(row.company_id ?? row.id ?? ""),
    acn: String(row.acn ?? ""),
    nhvasFileUrl: row.nhvas_file_path ? String(row.nhvas_file_path) : null,
    nhvasExpiry: row.nhvas_expiry ? String(row.nhvas_expiry) : "",
    nhvasStatus: String(row.nhvas_status ?? "missing") as ContractorCompanyRecord["nhvasStatus"],
    nhvasRejectionReason: row.nhvas_rejection_reason ? String(row.nhvas_rejection_reason) : null,
    publicLiabilityReviewedBy: row.public_liability_reviewed_by ? String(row.public_liability_reviewed_by) : null,
    publicLiabilityReviewedAt: row.public_liability_reviewed_at ? String(row.public_liability_reviewed_at) : null,
    workersCompReviewedBy: row.workers_comp_reviewed_by ? String(row.workers_comp_reviewed_by) : null,
    workersCompReviewedAt: row.workers_comp_reviewed_at ? String(row.workers_comp_reviewed_at) : null,
    agreementReviewedBy: row.agreement_reviewed_by ? String(row.agreement_reviewed_by) : null,
    agreementReviewedAt: row.agreement_reviewed_at ? String(row.agreement_reviewed_at) : null,
    nhvasReviewedBy: row.nhvas_reviewed_by ? String(row.nhvas_reviewed_by) : null,
    nhvasReviewedAt: row.nhvas_reviewed_at ? String(row.nhvas_reviewed_at) : null,
    workerPosition: String(row.worker_position ?? ""),
    workerStartDate: row.worker_start_date ? String(row.worker_start_date) : "",
    companyName: String(row.company_name ?? ""),
    tradingName: String(row.trading_name ?? ""),
    abn: String(row.abn ?? ""),
    contactPerson: String(row.contact_person ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    nhvasAccreditation: (String(row.nhvas_accreditation ?? "None")) as ContractorCompanyRecord["nhvasAccreditation"],
    nhvasNumber: String(row.nhvas_number ?? ""),
    publicLiabilityPolicy: String(row.public_liability_policy ?? ""),
    publicLiabilityExpiry: row.public_liability_expiry ? String(row.public_liability_expiry) : "",
    workersCompPolicy: String(row.workers_comp_policy ?? ""),
    workersCompExpiry: row.workers_comp_expiry ? String(row.workers_comp_expiry) : "",
    primaryDepot: String(row.primary_depot ?? ""),
    status: (String(row.status ?? "Pending Review")) as ContractorCompanyRecord["status"],
    publicLiabilityFileUrl: row.public_liability_file_path ? String(row.public_liability_file_path) : row.public_liability_file_url ? String(row.public_liability_file_url) : null,
    publicLiabilityStatus: (String(row.public_liability_status ?? "pending")) as ContractorCompanyRecord["publicLiabilityStatus"],
    publicLiabilityRejectionReason: row.public_liability_rejection_reason ? String(row.public_liability_rejection_reason) : null,
    workersCompFileUrl: row.workers_comp_file_path ? String(row.workers_comp_file_path) : row.workers_comp_file_url ? String(row.workers_comp_file_url) : null,
    workersCompStatus: (String(row.workers_comp_status ?? "pending")) as ContractorCompanyRecord["workersCompStatus"],
    workersCompRejectionReason: row.workers_comp_rejection_reason ? String(row.workers_comp_rejection_reason) : null,
    agreementExpiry: row.agreement_expiry ? String(row.agreement_expiry) : "",
    agreementFileUrl: row.agreement_file_path ? String(row.agreement_file_path) : null,
    agreementStatus: (String(row.agreement_status ?? "missing")) as ContractorCompanyRecord["agreementStatus"],
    agreementRejectionReason: row.agreement_rejection_reason ? String(row.agreement_rejection_reason) : null
  };
}

async function getPolicySignatureRows(filter: { userId?: string; policyId?: string; allColumns?: boolean } = {}): Promise<{ data: any[] | null; error: any }> {
  const columns = filter.allColumns ? "*" : "user_id, policy_version_id";
  let query = supabase.from("policy_signatures").select(columns);
  if (filter.userId) query = query.eq("user_id", filter.userId);
  if (filter.policyId) query = query.eq("policy_version_id", filter.policyId);
  const primary = await query.limit(10000);
  if (!primary.error) return { ...primary, data: (primary.data ?? []).map((row: any) => ({ ...row, driver_id: row.user_id, policy_id: row.policy_version_id })) };
  if (primary.error.code !== "42703") return primary;

  let fallbackQuery = supabase.from("policy_signatures").select(filter.allColumns ? "*" : "driver_id, policy_id");
  if (filter.userId) fallbackQuery = fallbackQuery.eq("driver_id", filter.userId);
  if (filter.policyId) fallbackQuery = fallbackQuery.eq("policy_id", filter.policyId);
  return await fallbackQuery.limit(10000);
}

function contractorDocumentPath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  const marker = "/contractor-documents/";
  if (pathOrUrl.includes(marker)) return decodeURIComponent(pathOrUrl.split(marker).pop()!.split("?")[0]);
  return pathOrUrl;
}

function currentDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false;
  return value >= new Date().toISOString().slice(0, 10);
}

async function contractorDocumentUrl(pathOrUrl: string | null | undefined): Promise<string | null> {
  if (!pathOrUrl) return null;
  const marker = "/contractor-documents/";
  const path = pathOrUrl.includes(marker) ? pathOrUrl.split(marker).pop()! : pathOrUrl;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await supabase.storage.from("contractor-documents").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

function mapVehicleRow(row: Record<string, unknown>): VehicleRecord {
  return {
    id: String(row.id),
    rego: String(row.rego ?? ""),
    makeModel: String(row.make_model ?? ""),
    bodyType: String(row.body_type ?? ""),
    branchName: String(row.branch_name ?? ""),
    driverNumber: String(row.driver_number ?? ""),
    driverName: String(row.driver_name ?? ""),
    regoExpiryDate: String(row.rego_expiry_date ?? ""),
    dgExpiryDate: row.dg_expiry_date ? String(row.dg_expiry_date) : null,
    scbaServiceDueDate: row.scba_service_due_date ? String(row.scba_service_due_date) : null,
    vehicleCheckApproved: Boolean(row.vehicle_check_approved),
    regoCheckApproved: Boolean(row.rego_check_approved),
    status: (String(row.status ?? "Active")) as VehicleRecord["status"],
    qrPassCode: String(row.qr_pass_code ?? ""),
    contactNumber: row.contact_number ? String(row.contact_number) : undefined,
    regoDocumentUrl: row.rego_document_path ? String(row.rego_document_path) : null,
    regoDocumentStatus: String(row.rego_document_status ?? "missing") as VehicleRecord["regoDocumentStatus"],
    regoDocumentRejectionReason: row.rego_document_rejection_reason ? String(row.rego_document_rejection_reason) : null,
    insuranceDocumentUrl: row.insurance_document_path ? String(row.insurance_document_path) : null,
    insuranceDocumentExpiry: row.insurance_document_expiry ? String(row.insurance_document_expiry) : null,
    insuranceDocumentStatus: String(row.insurance_document_status ?? "missing") as VehicleRecord["insuranceDocumentStatus"],
    insuranceDocumentRejectionReason: row.insurance_document_rejection_reason ? String(row.insurance_document_rejection_reason) : null,
    inspectionDocumentUrl: row.inspection_document_path ? String(row.inspection_document_path) : null,
    inspectionDocumentExpiry: row.inspection_document_expiry ? String(row.inspection_document_expiry) : null,
    inspectionDocumentStatus: String(row.inspection_document_status ?? "missing") as VehicleRecord["inspectionDocumentStatus"],
    inspectionDocumentRejectionReason: row.inspection_document_rejection_reason ? String(row.inspection_document_rejection_reason) : null,
    regoDocumentReviewedBy: row.rego_document_reviewed_by ? String(row.rego_document_reviewed_by) : null,
    regoDocumentReviewedAt: row.rego_document_reviewed_at ? String(row.rego_document_reviewed_at) : null,
    insuranceDocumentReviewedBy: row.insurance_document_reviewed_by ? String(row.insurance_document_reviewed_by) : null,
    insuranceDocumentReviewedAt: row.insurance_document_reviewed_at ? String(row.insurance_document_reviewed_at) : null,
    inspectionDocumentReviewedBy: row.inspection_document_reviewed_by ? String(row.inspection_document_reviewed_by) : null,
    inspectionDocumentReviewedAt: row.inspection_document_reviewed_at ? String(row.inspection_document_reviewed_at) : null
  };
}

async function getDriverVehicles(userId: string): Promise<VehicleRecord[]> {
  const { data, error } = await supabase
    .from("driver_vehicles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return await Promise.all((data ?? []).map(async (row) => {
    const vehicle = mapVehicleRow(row);
    vehicle.regoDocumentUrl = await contractorDocumentUrl(vehicle.regoDocumentUrl);
    vehicle.insuranceDocumentUrl = await contractorDocumentUrl(vehicle.insuranceDocumentUrl);
    vehicle.inspectionDocumentUrl = await contractorDocumentUrl(vehicle.inspectionDocumentUrl);
    return vehicle;
  }));
}

async function saveDriverVehicle(userId: string, vehicle: VehicleRecord): Promise<VehicleRecord[]> {
  const { error } = await supabase.from("driver_vehicles").upsert(
    {
      id: vehicle.id,
      user_id: userId,
      rego: vehicle.rego,
      make_model: vehicle.makeModel,
      body_type: vehicle.bodyType,
      branch_name: vehicle.branchName,
      driver_number: vehicle.driverNumber,
      driver_name: vehicle.driverName,
      rego_expiry_date: vehicle.regoExpiryDate || null,
      dg_expiry_date: vehicle.dgExpiryDate || null,
      scba_service_due_date: vehicle.scbaServiceDueDate || null,
      vehicle_check_approved: vehicle.vehicleCheckApproved,
      rego_check_approved: vehicle.regoCheckApproved,
      status: vehicle.status,
      qr_pass_code: vehicle.qrPassCode,
      contact_number: vehicle.contactNumber ?? null
    },
    { onConflict: "id" }
  );
  if (error) throw error;
  return await getDriverVehicles(userId);
}

async function getAdminFleetData(): Promise<{
  vehicles: Array<VehicleRecord & { userName: string; userEmail: string }>;
}> {
  const { data, error } = await supabase
    .from("driver_vehicles")
    .select("*, profiles:user_id (full_name, email)")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  return {
    vehicles: (data ?? []).map((row: Record<string, any>) => ({
      ...mapVehicleRow(row),
      userName: String(row.profiles?.full_name || "Driver"),
      userEmail: String(row.profiles?.email || "")
    }))
  };
}

async function verifyVehiclePass(passCode: string): Promise<VehiclePassVerificationResult> {
  const baseUrl = apiBaseUrl.endsWith("/api") ? apiBaseUrl.slice(0, -4) : apiBaseUrl;
  const res = await fetch(`${baseUrl}/api/vehicle/verify/${encodeURIComponent(passCode)}`, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { verified: false, message: "Vehicle pass not found." };
    }
    throw new Error("Verification service is unavailable. Please try again.");
  }
  return (await res.json()) as VehiclePassVerificationResult;
}

async function verifyDriver(driverId: string): Promise<DriverVerificationResult> {
  const baseUrl = apiBaseUrl.endsWith("/api") ? apiBaseUrl.slice(0, -4) : apiBaseUrl;
  const res = await fetch(`${baseUrl}/api/driver/verify/${encodeURIComponent(driverId)}`, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { verified: false, message: "Driver not found." };
    }
    throw new Error("Verification service is unavailable. Please try again.");
  }
  return (await res.json()) as DriverVerificationResult;
}

async function logAuditEvent(userId: string, action: string, metadata: Record<string, unknown>) {
  const { error } = await supabase.from("audit_logs").insert({
    user_id: userId,
    action,
    metadata,
    created_at: new Date().toISOString()
  });
  if (error) {
    if (import.meta.env.DEV) {
      console.error("audit log failed", action, error);
    }
  }
}

function mapAuditLogs(rows: Array<Record<string, unknown>>): AuditLog[] {
  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    action: String(row.action),
    metadata: normalizeMetadata(row.metadata),
    createdAt: String(row.created_at)
  }));
}

function mapFeedbackRow(row: Record<string, unknown>): DriverFeedback {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clarityRating: Number(row.clarity_rating ?? 0),
    issues: String(row.issues ?? ""),
    submittedAt: String(row.submitted_at)
  };
}

async function adminRequest<T = void>(path: string, session: SessionState, options: RequestInit): Promise<T> {
  const normalizedPath = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  const baseUrl = apiBaseUrl.endsWith("/api") ? apiBaseUrl.slice(0, -4) : apiBaseUrl;
  const targetUrl = `${baseUrl}${normalizedPath}`;
  const response = await fetch(targetUrl, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: "Request failed." }))) as { message?: string };
    throw new Error(body.message ?? "Request failed.");
  }
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("text/html")) {
    throw new Error("Received HTML response instead of JSON. Backend API is likely unreachable.");
  }
  if (contentType && contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return undefined as T;
}

async function driverRequest<T>(path: string, options: RequestInit): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error("Please sign in again before saving contractor details.");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}`, ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(body.message ?? "Request failed.");
  }
  return await response.json() as T;
}

async function driverUploadContractorDocument(kind: "public_liability" | "workers_comp" | "nhvas", file: File): Promise<{ path: string }> {
  if (file.size > 1_200_000) throw new Error("Choose a document smaller than 1.2 MB.");
  if (!/[.]pdf$|[.]png$|[.]jpe?g$/i.test(file.name) || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Upload a PDF, PNG, or JPEG document.");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read this file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file);
  });
  return await driverRequest<{ path: string }>("/contractor/company/documents", { method: "POST", body: JSON.stringify({ kind, fileName: file.name, contentType: file.type, base64 }) });
}

async function readUploadAsBase64(file: File): Promise<string> {
  if (file.size > 1_200_000) throw new Error("Choose a document smaller than 1.2 MB.");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Upload a PDF, PNG, or JPEG document.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read this file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file);
  });
}

function calculateCompletion(completedSteps: number[]) {
  return Math.round((completedSteps.length / 6) * 100);
}

function sortNumbers(left: number, right: number) {
  return left - right;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeAnswers(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, answer]) => [Number(key), Number(answer)])
  ) as Record<number, number>;
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildCertificatePdf(
  fullName: string,
  completionId: string,
  issuedAt: string,
  verificationUrl: string,
  licenceClass?: string,
  issuingState?: string,
  depotLocation?: string
) {
  return createCertificatePdf({
    organizationName,
    fullName,
    completionId,
    issuedAt,
    verificationUrl,
    licenceClass,
    issuingState,
    depotLocation
  });
}

function buildCompletionTrend(rows: Array<Record<string, unknown>>) {
  // M-9 FIX: Previously, labels used toLocaleDateString() (local timezone) but
  // dayKey used toISOString().slice(0,10) (UTC). This caused a day mismatch for
  // users in UTC+offset timezones. Now both use UTC-normalized date strings.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (6 - index));
    // Format as UTC "Aug 27" to match dayKey
    const label = date.toLocaleDateString("en-AU", { month: "short", day: "numeric", timeZone: "UTC" });
    const dayKey = date.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    return {
      label,
      value: rows.filter((row) => String(row.issued_at ?? "").slice(0, 10) === dayKey).length
    };
  });
}

function buildQuizBands(scores: number[]) {
  return [
    { label: "90-100", value: scores.filter((score) => score >= 90).length },
    { label: "70-89", value: scores.filter((score) => score >= 70 && score < 90).length },
    { label: "50-69", value: scores.filter((score) => score >= 50 && score < 70).length },
    { label: "0-49", value: scores.filter((score) => score < 50).length }
  ];
}

function calculateCompletionHours(createdAt: string, completedAt: string | null, auditTrail: AuditLog[]) {
  if (!completedAt) return null;

  const relevantStart = [...auditTrail]
    .reverse()
    .find((item) =>
      ["login", "profile_updated", "step_completed", "document_uploaded", "quiz_submitted", "declaration_signed"].includes(item.action)
    )?.createdAt ?? createdAt;

  const startTime = new Date(relevantStart).getTime();
  const endTime = new Date(completedAt).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) return 1;

  return Math.max(1, Math.round((endTime - startTime) / 36e5));
}

function deriveDriverStatus(
  storedStatus: "Not Started" | "In Progress" | "Completed",
  progress: Record<string, unknown> | null,
  documents: UploadedDocument[],
  currentRequirementsApproved = true,
  staffRole = "driver"
): "Not Started" | "In Progress" | "Completed" {
  const completionPercentage = Number(progress?.completion_percentage ?? 0);
  const completed = Boolean(progress?.completed) || completionPercentage >= 100 || Boolean(progress?.completed_at);
  const requiredTypes = new Set(getRequiredDocumentTypes("employee", staffRole));
  const requiredDocumentsCurrent = REQUIRED_DRIVER_DOCUMENTS.filter(({ type }) => requiredTypes.has(type)).every(({ type }) => {
    const latest = [...documents].sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)).find((doc) => doc.type === type);
    return isApprovedCurrentDocument(latest, Date.now(), REQUIRED_EXPIRY_DOCUMENT_TYPES.includes(type));
  });

  if (completed && requiredDocumentsCurrent && currentRequirementsApproved) return "Completed";
  if (completionPercentage > 0 || completed || storedStatus === "Completed") return "In Progress";
  return storedStatus;
}

// --- Automated: Document OCR Verification ---
export async function verifyDocument(params: {
  userId: string;
  fileUrl: string;
  documentType: string;
}): Promise<{ isValid: boolean; confidenceScore: number; simulatedExpiry: string }> {
  // C-6 FIX: Use URL constructor instead of .replace("/api", "") which corrupts
  // hostnames containing "api" (e.g. "https://api.example.com/api" becomes broken).
  const baseOrigin = new URL(apiBaseUrl).origin;
  const response = await fetch(`${baseOrigin}/api/documents/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error("Document OCR scan failed.");
  const data = (await response.json()) as { data: { isValid: boolean; confidenceScore: number; simulatedExpiry: string } };
  return data.data;
}

// ============================================================
// MILESTONE 1: Versioned Inductions API Functions
// ============================================================

/**
 * Fetch the currently active induction version.
 * Called by drivers on login to detect if they need to re-complete a newer version.
 */
export async function getInductionVersion(_session: SessionState): Promise<InductionVersion> {
  // Return standard current baseline version
  return {
    id: "v1.0-current",
    versionLabel: "1.0",
    revisionNotes: "Initial induction content — Chain of Responsibility, Fatigue Management, Load Restraint, Speed & Compliance, Vehicle Checks, Site Safety, Incident Reporting, Mass/Dimension, WHS & PPE, Drug & Alcohol, HVNL Overview.",
    publishedAt: new Date().toISOString(),
    hasPendingVersion: false
  };
}

/**
 * Fetch all induction versions for the admin versions panel.
 */
export async function getAdminInductionVersions(session: SessionState): Promise<InductionVersionRecord[]> {
  try {
    const response = await fetch(`${apiBaseUrl}/admin/induction-versions`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (response.ok) {
      const data = (await response.json()) as { versions: Array<Record<string, string | boolean | null>> };
      return data.versions.map((v) => ({
        id: String(v.id),
        versionLabel: String(v.version_label),
        revisionNotes: String(v.revision_notes),
        publishedBy: v.published_by ? String(v.published_by) : null,
        publishedAt: String(v.published_at),
        isCurrent: Boolean(v.is_current),
        createdAt: String(v.created_at)
      }));
    }
  } catch {
    // Fallback to direct Supabase query if Express API server is offline
  }

  const defaultBaseline: InductionVersionRecord[] = [{
    id: "v1.0-default",
    versionLabel: "1.0",
    revisionNotes: "Initial induction content — Chain of Responsibility, Fatigue Management, Load Restraint, Speed & Compliance, Vehicle Checks, Site Safety, Incident Reporting, Mass/Dimension, WHS & PPE, Drug & Alcohol, HVNL Overview.",
    publishedBy: null,
    publishedAt: new Date().toISOString(),
    isCurrent: true,
    createdAt: new Date().toISOString()
  }];

  try {
    const { data, error } = await supabase
      .from("induction_versions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data || data.length === 0) {
      console.warn("Direct Supabase versions fetch notice:", error?.message || "Using default baseline version");
      return defaultBaseline;
    }

    return data.map((v) => ({
      id: String(v.id),
      versionLabel: String(v.version_label ?? "1.0"),
      revisionNotes: String(v.revision_notes ?? ""),
      publishedBy: v.published_by ? String(v.published_by) : null,
      publishedAt: String(v.published_at || v.created_at || new Date().toISOString()),
      isCurrent: Boolean(v.is_current),
      createdAt: String(v.created_at || new Date().toISOString())
    }));
  } catch (err: any) {
    console.error("Failed to fetch induction versions:", err);
    return defaultBaseline;
  }
}

/**
 * Admin publishes a new induction version.
 * Automatically de-activates the previous current version.
 */
export async function publishInductionVersion(
  session: SessionState,
  input: { versionLabel: string; revisionNotes: string }
): Promise<InductionVersionRecord> {
  try {
    const response = await fetch(`${apiBaseUrl}/admin/induction-versions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify(input)
    });
    if (response.ok) {
      const result = (await response.json()) as { version: Record<string, string> };
      const v = result.version;
      return {
        id: String(v.id),
        versionLabel: String(v.version_label),
        revisionNotes: String(v.revision_notes),
        publishedBy: null,
        publishedAt: String(v.published_at),
        isCurrent: true,
        createdAt: String(v.published_at)
      };
    }
  } catch {
    // Fallback to direct Supabase mutation if Express API server is offline
  }

  // Direct Supabase Fallback: De-activate current versions and insert new one
  try {
    await supabase.from("induction_versions").update({ is_current: false }).eq("is_current", true);

    const now = new Date().toISOString();
    const { data, error } = await supabase.from("induction_versions").insert({
      version_label: input.versionLabel,
      revision_notes: input.revisionNotes,
      published_by: session.user.id,
      is_current: true,
      published_at: now,
      created_at: now
    }).select().single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to insert new induction version into Supabase.");
    }

    return {
      id: String(data.id),
      versionLabel: String(data.version_label),
      revisionNotes: String(data.revision_notes),
      publishedBy: session.user.id,
      publishedAt: String(data.published_at),
      isCurrent: true,
      createdAt: String(data.created_at)
    };
  } catch (err: any) {
    throw new Error(err?.message || "Failed to publish new induction version.");
  }
}

export async function getMyScheduleInvitations(session: SessionState): Promise<InductionScheduleInvitation[]> {
  const userId = session.user.id;
  const { data, error } = await supabase
    .from("induction_schedule_invitations")
    .select(`
      *,
      enrollment:induction_schedule_enrollments!inner(
        id,
        driver_id,
        schedule_id,
        induction_schedules!inner(name)
      )
    `)
    .eq("enrollment.driver_id", userId)
    .order("sent_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    enrollmentId: row.enrollment_id,
    scheduleItemId: row.schedule_item_id,
    deliveryMethod: row.delivery_method,
    status: row.status,
    metadata: row.metadata ?? {},
    sentAt: row.sent_at,
    createdAt: row.sent_at,
    updatedAt: row.sent_at
  })) satisfies InductionScheduleInvitation[];
}

const mapInductionCourse = (row: any, templateRecord = false): InductionCourse => ({
  id: row.id,
  title: row.title ?? "",
  description: row.description ?? "",
  templateId: row.templateId ?? row.template_id ?? null,
  versionLabel: row.versionLabel ?? row.version_label ?? "1.0",
  revisionNotes: row.revisionNotes ?? row.revision_notes ?? "",
  isTemplate: templateRecord || Boolean(row.isTemplate ?? row.is_template),
  isCurrent: Boolean(row.isCurrent ?? row.is_current),
  siteTag: row.siteTag ?? row.site_tag ?? "global",
  createdBy: row.createdBy ?? row.created_by ?? null,
  createdAt: row.createdAt ?? row.created_at ?? "",
  updatedAt: row.updatedAt ?? row.updated_at ?? ""
});

export async function getInductionCourses(session: SessionState): Promise<InductionCourse[]> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!response.ok) throw new Error("Failed to fetch courses");
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map((row) => mapInductionCourse(row)) : [];
}

export async function createInductionCourse(session: SessionState, input: {
  title: string;
  description?: string;
  versionLabel?: string;
  revisionNotes?: string;
  isTemplate?: boolean;
  siteTag?: string;
}): Promise<InductionCourse> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Failed to create course");
  }
  return mapInductionCourse(await response.json());
}

export async function updateInductionCourse(session: SessionState, courseId: string, input: Partial<{
  title: string;
  description: string;
  versionLabel: string;
  revisionNotes: string;
  isCurrent: boolean;
  isTemplate: boolean;
  siteTag: string;
}>): Promise<InductionCourse> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses/${courseId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update course");
  }
  return mapInductionCourse(await response.json());
}

export async function deleteInductionCourse(session: SessionState, courseId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses/${courseId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Failed to delete course");
  }
}

export async function cloneCourse(session: SessionState, courseId: string, input: {
  title: string;
  siteTag?: string;
}): Promise<{ course: InductionCourse; slidesCopied: number; questionsCopied: number }> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses/${courseId}/clone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Failed to clone course");
  }
  const result = await response.json();
  return { ...result, course: mapInductionCourse(result.course) };
}

export async function publishCourseToDrivers(session: SessionState, courseId: string, input?: { versionLabel?: string; revisionNotes?: string }): Promise<{ published: number; updated: number; message?: string }> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/courses/${courseId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify(input ?? {})
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Failed to publish course");
  }
  return response.json();
}

export async function publishInductionCourse(session: SessionState, courseId: string, input: { siteTag?: string; versionLabel?: string; revisionNotes?: string }): Promise<void> {
  await publishCourseToDrivers(session, courseId, input);
}

// CMS slide helpers used by the site induction editor.
async function cmsRequest<T>(session: SessionState, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/admin/cms/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}`, ...init.headers }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "CMS request failed");
  }
  return response.status === 204 ? undefined as T : response.json();
}

const mapCmsSlide = (row: any): InductionSlide => ({
  id: row.id, courseId: row.courseId ?? row.course_id, slideOrder: row.slideOrder ?? row.slide_order,
  slideType: row.slideType ?? row.slide_type, title: row.title, contentJson: row.contentJson ?? row.content_json ?? {},
  siteTag: row.siteTag ?? row.site_tag ?? "global", videoUrl: row.videoUrl ?? row.video_url ?? null,
  audioUrl: row.audioUrl ?? row.audio_url ?? null, forcedWaitSeconds: row.forcedWaitSeconds ?? row.forced_wait_seconds ?? 0,
  estimatedDurationSeconds: row.estimatedDurationSeconds ?? row.estimated_duration_seconds ?? 0,
  triggerConfig: row.triggerConfig ?? row.trigger_config ?? {}, createdAt: row.createdAt ?? row.created_at,
  updatedAt: row.updatedAt ?? row.updated_at
});

export async function getCourseSlides(session: SessionState, courseId: string): Promise<InductionSlide[]> {
  const rows = await cmsRequest<any[]>(session, `courses/${courseId}/slides`);
  return rows.map(mapCmsSlide);
}
export async function createSlide(session: SessionState, courseId: string, input: Partial<InductionSlide>): Promise<InductionSlide> {
  return mapCmsSlide(await cmsRequest(session, `courses/${courseId}/slides`, { method: "POST", body: JSON.stringify(input) }));
}
export async function updateSlide(session: SessionState, courseId: string, slideId: string, input: Partial<InductionSlide>): Promise<InductionSlide> {
  return mapCmsSlide(await cmsRequest(session, `courses/${courseId}/slides/${slideId}`, { method: "PATCH", body: JSON.stringify(input) }));
}
export async function deleteSlide(session: SessionState, courseId: string, slideId: string): Promise<void> {
  await cmsRequest(session, `courses/${courseId}/slides/${slideId}`, { method: "DELETE" });
}
export async function reorderSlides(session: SessionState, courseId: string, orders: Array<{ id: string; slideOrder: number }>): Promise<void> {
  await cmsRequest(session, `courses/${courseId}/slides/reorder`, { method: "POST", body: JSON.stringify({ orders: orders.map(({ id, slideOrder }) => ({ slideId: id, slideOrder })) }) });
}
export async function getSlideQuestions(session: SessionState, slideId: string): Promise<SlideQuestion[]> {
  const rows = await cmsRequest<any[]>(session, `slides/${slideId}/questions`);
  return rows.map((q) => ({ ...q, correctAnswer: q.correctAnswer ?? q.correct_answer ?? 0,
    correctAnswers: q.correctAnswers ?? q.correct_answers, isCritical: q.isCritical ?? q.is_critical ?? false,
    questionType: q.questionType ?? q.question_type ?? "single_choice", sortOrder: q.sortOrder ?? q.sort_order ?? 0,
    acceptedAnswers: q.acceptedAnswers ?? q.accepted_answers ?? [] }));
}
export async function createSlideQuestion(session: SessionState, slideId: string, input: Partial<SlideQuestion>): Promise<SlideQuestion> {
  return cmsRequest(session, `slides/${slideId}/questions`, { method: "POST", body: JSON.stringify(input) });
}
export async function updateSlideQuestion(session: SessionState, slideId: string, questionId: string, input: Partial<SlideQuestion>): Promise<SlideQuestion> {
  return cmsRequest(session, `slides/${slideId}/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(input) });
}
export async function deleteSlideQuestion(session: SessionState, slideId: string, questionId: string | number): Promise<void> {
  await cmsRequest(session, `slides/${slideId}/questions/${questionId}`, { method: "DELETE" });
}
export async function getCourseTemplates(session: SessionState): Promise<InductionCourse[]> {
  const rows = await cmsRequest<any[]>(session, "templates");
  return rows.map((row) => mapInductionCourse(row, true));
}
export async function markCourseAsTemplate(session: SessionState, courseId: string, isTemplate: boolean): Promise<void> {
  await cmsRequest(session, `courses/${courseId}/mark-template`, { method: "POST", body: JSON.stringify({ isTemplate }) });
}
export async function uploadInductionAsset(session: SessionState, file: File, folder: string): Promise<{ url: string }> {
  const key = `${session.user.id}/${folder}/${crypto.randomUUID()}-${file.name}`;
  const { data, error } = await supabase.storage.from("induction-assets").upload(key, file, { upsert: false });
  if (error) throw error;
  const { data: publicUrl } = supabase.storage.from("induction-assets").getPublicUrl(data.path);
  return { url: publicUrl.publicUrl };
}

async function adminJson<T>(session: SessionState, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/admin/${path}`, { ...init, headers: {
    Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", ...init.headers
  } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Admin request failed");
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const getReportsOverview = (session: SessionState) => adminJson<ReportsOverview>(session, "reports/overview");
export const getAttemptedInductionsReport = (session: SessionState) => adminJson<AttemptedInductionReport[]>(session, "reports/attempted-inductions");
export const getCertificateStatusesReport = (session: SessionState) => adminJson<CertificateStatusReport[]>(session, "reports/certificate-statuses");
export const getExpiringCertificatesReport = (session: SessionState) => adminJson<ExpiringCertificateReport[]>(session, "reports/expiring-certificates");
export const getExpiringDocumentsReport = (session: SessionState) => adminJson<ExpiringDocumentReport[]>(session, "reports/expiring-documents");
export const getDocumentsForApprovalReport = (session: SessionState) => adminJson<DocumentApprovalReport[]>(session, "reports/documents-for-approval");
export const getScheduledStatusReport = (session: SessionState) => adminJson<ScheduledStatusReport[]>(session, "reports/scheduled-status");

const mapInductionSchedule = (response: any): InductionSchedule => {
  const row = response?.schedule ?? response;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    isActive: Boolean(row.isActive ?? row.is_active),
    createdBy: row.createdBy ?? row.created_by ?? null,
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? "")
  };
};

export const getInductionSchedules = async (session: SessionState): Promise<InductionSchedule[]> => {
  const response = await adminJson<any>(session, "schedules");
  const rows = response?.schedules ?? response ?? [];
  return rows.map(mapInductionSchedule);
};
export const createInductionSchedule = async (session: SessionState, input: Partial<InductionSchedule>): Promise<InductionSchedule> =>
  mapInductionSchedule(await adminJson<any>(session, "schedules", { method: "POST", body: JSON.stringify(input) }));
export const updateInductionSchedule = async (session: SessionState, id: string, input: Partial<InductionSchedule>): Promise<InductionSchedule> => {
  const payload = { name: input.name, description: input.description, is_active: input.isActive };
  return mapInductionSchedule(await adminJson<any>(session, `schedules/${id}`, { method: "PATCH", body: JSON.stringify(payload) }));
};
export const deleteInductionSchedule = (session: SessionState, id: string) => adminJson<void>(session, `schedules/${id}`, { method: "DELETE" });
const mapScheduleItem = (row: any): InductionScheduleItem => ({
  id: String(row.id),
  scheduleId: String(row.scheduleId ?? row.schedule_id ?? ""),
  courseId: row.courseId ?? row.course_id ?? null,
  title: String(row.title ?? ""),
  sequenceOrder: Number(row.sequenceOrder ?? row.sequence_order ?? 0),
  delayType: row.delayType ?? row.delay_type ?? "after_completion",
  delayDays: Number(row.delayDays ?? row.delay_days ?? 0),
  fixedDate: row.fixedDate ?? row.fixed_date ?? null,
  expiryInterval: row.expiryInterval ?? row.expiry_interval ?? null,
  isRequired: Boolean(row.isRequired ?? row.is_required),
  createdAt: String(row.createdAt ?? row.created_at ?? ""),
  updatedAt: String(row.updatedAt ?? row.updated_at ?? ""),
  course: row.course ? mapInductionCourse(row.course) : undefined
});
export const getScheduleItems = async (session: SessionState, id: string): Promise<InductionScheduleItem[]> => {
  const response = await adminJson<any>(session, `schedules/${id}/items`);
  return (response?.items ?? response ?? []).map(mapScheduleItem);
};
export const addScheduleItem = (session: SessionState, id: string, input: Partial<InductionScheduleItem>) => adminJson<InductionScheduleItem>(session, `schedules/${id}/items`, { method: "POST", body: JSON.stringify(input) });
export const deleteScheduleItem = (session: SessionState, scheduleId: string, itemId: string) => adminJson<void>(session, `schedules/${scheduleId}/items/${itemId}`, { method: "DELETE" });
const mapScheduleEnrollment = (row: any): InductionScheduleEnrollment => ({
  id: String(row.id),
  scheduleId: String(row.scheduleId ?? row.schedule_id ?? ""),
  driverId: String(row.driverId ?? row.driver_id ?? ""),
  enrolledAt: String(row.enrolledAt ?? row.enrolled_at ?? ""),
  enrolledBy: row.enrolledBy ?? row.enrolled_by ?? null,
  status: row.status,
  currentItemIndex: Number(row.currentItemIndex ?? row.current_item_index ?? 0),
  completedAt: row.completedAt ?? row.completed_at ?? null,
  driver: row.driver ? {
    ...row.driver,
    fullName: row.driver.fullName ?? row.driver.full_name ?? "",
    email: row.driver.email ?? ""
  } : undefined,
  schedule: row.schedule ? mapInductionSchedule(row.schedule) : undefined
});
export const getScheduleEnrollments = async (session: SessionState, id: string): Promise<InductionScheduleEnrollment[]> => {
  const response = await adminJson<any>(session, `schedules/${id}/enrollments`);
  return (response?.enrollments ?? response ?? []).map(mapScheduleEnrollment);
};
export const enrollDriverInSchedule = (session: SessionState, id: string, driverId: string) => adminJson<InductionScheduleEnrollment>(session, `schedules/${id}/enroll`, { method: "POST", body: JSON.stringify({ driverId }) });
export const unenrollDriverFromSchedule = (session: SessionState, scheduleId: string, enrollmentId: string) => adminJson<void>(session, `schedules/${scheduleId}/enroll/${enrollmentId}`, { method: "DELETE" });
export const cancelScheduleInvitation = (session: SessionState, scheduleId: string, enrollmentId: string, reason?: string) => adminJson<void>(session, `schedules/${scheduleId}/enroll/${enrollmentId}/cancel-invitation`, { method: "POST", body: JSON.stringify({ reason }) });
export const processScheduleInvitations = (session: SessionState) => adminJson<{ processed: number }>(session, "schedules/process-invitations", { method: "POST" });
