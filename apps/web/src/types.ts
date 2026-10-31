export type UserRole = "driver" | "admin";
export type ThemeMode = "light" | "dark";
export type DriverStatus = "Not Started" | "In Progress" | "Completed";
export type DocumentType =
  | "driver_license"
  | "medical_certificate"
  | "identity_proof"
  | "driving_history"
  | "right_to_work"
  | "nhvas_bfm_certificate"
  | "dangerous_goods_license"
  | "hrwl_forklift"
  | "identity_selfie"
  | "employment_contract";

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  driverId: string | null;
  mustChangePassword?: boolean;
}

export interface SessionState {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export interface DriverSelfRegisterInput {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  preferredLanguage: string;
  password: string;
  depotCode?: string;
  licenceClass?: string;
  issuingState?: string;
  licenceNumber?: string;
}

export interface DriverFormInput {
  fullName: string;
  email: string;
  phone: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  address: string;
  dateOfBirth?: string;
  preferredLanguage: string;
  licenceClass?: string;
  issuingState?: string;
  licenceNumber?: string;
  depotLocation?: string;
  licenceHistoryProvided?: boolean;
  leftBusiness?: boolean;
  employmentType?: "employee" | "contractor";
  staffRole?: "driver" | "warehouse" | "office";
  contractorCompanyId?: string;
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
}

export interface DriverProfile {
  id: string;
  employmentType?: "employee" | "contractor";
  staffRole?: "driver" | "warehouse" | "office";
  contractorCompanyId?: string | null;
  contractorCompanyName?: string | null;
  employmentStartDate?: string;
  employmentBasis?: "full_time" | "part_time" | "casual";
  fullName: string;
  email: string;
  phone: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  address: string;
  dateOfBirth?: string;
  preferredLanguage: string;
  licenceClass?: string;
  issuingState?: string;
  licenceNumber?: string;
  depotLocation?: string;
  licenceHistoryProvided?: boolean;
  leftBusiness?: boolean;
  status: DriverStatus;
  workClearanceStatus?: "Not Approved" | "Approved to Commence Work";
  workClearanceApprovedAt?: string | null;
  workClearanceApprovedBy?: string | null;
  workClearanceBlockers?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UploadedDocument {
  id: string;
  driverId: string;
  name: string;
  type: DocumentType;
  mimeType: string;
  size: number;
  fileUrl: string;
  fileDownloadUrl?: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string | null;
  verifiedByAdmin: boolean;
  uploadedAt: string;
  expiresAt: string | null;
}

export interface LearningSectionProgress {
  sectionId: string;
  sectionVersion?: string;
  title: string;
  format: string;
  summary: string;
  videoUrl?: string;
  savedTextAnswers?: Record<string, string>;
  completed: boolean;
  completedAt: string | null;
  mediaJson?: Record<string, unknown>;
  videoDurationSeconds?: number;
  requireFullWatch?: boolean;
  isMandatory?: boolean;
  audience?: string;
  targetRole?: string;
}

export interface ProgressState {
  driverId: string;
  currentStep: number;
  completionPercentage: number;
  quizScore: number | null;
  completedStepIds: number[];
  completedAt: string | null;
  declarationAgreedAt?: string | null;
  updatedAt: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  explanation: string;
  category?: string;
  isCritical?: boolean;
  correctAnswer?: number;
  correct_answer?: number;
  correctAnswers?: number[];
  questionType?: string;
  question_type?: string;
  placement?: string;
  sortOrder?: number;
  sort_order?: number;
  acceptedAnswers?: number[];
}

export interface QuizAttempt {
  id: string;
  driverId: string;
  answers: Record<number, number>;
  score: number;
  passed: boolean;
  attemptedAt: string;
  categoryScores?: Record<string, number>;
  failedCritical?: boolean;
  criticalQuestionsAsked?: number;
}

export interface DeclarationRecord {
  driverId: string;
  accepted: boolean;
  signature: string;
  agreedAt: string;
}

export interface CertificateRecord {
  id: string;
  driverId: string;
  completionId: string;
  issuedAt: string;
  expiresAt: string | null;
  verificationCode: string;
  verificationUrl: string;
}

export interface DriverFeedback {
  id: string;
  userId: string;
  clarityRating: number;
  issues: string;
  submittedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DriverBundle {
  organizationName: string;
  driver: DriverProfile;
  progress: ProgressState;
  documents: UploadedDocument[];
  learningProgress: LearningSectionProgress[];
  learningLoadError?: string;
  declaration: DeclarationRecord | null;
  certificate: CertificateRecord | null;
  quizAttempts: QuizAttempt[];
  feedback: DriverFeedback | null;
}

export interface AdminDriverRow extends DriverProfile {
  currentStep: number;
  completionPercentage: number;
  quizScore: number | null;
  completedAt: string | null;
  certificateId: string | null;
  verificationCode: string | null;
  documents: UploadedDocument[];
  auditTrail: AuditLog[];
  lastActivityAt: string | null;
  feedback: DriverFeedback | null;
  completionHours: number | null;
  archivedAt: string | null;
}

export interface AdminOverview {
  organizationName: string;
  metrics: {
    totalDrivers: number;
    completedDrivers: number;
    pendingDrivers: number;
    inProgressDrivers: number;
    completionRate: number;
    averageQuizScore: number;
    averageCompletionHours: number;
    certificateRate: number;
    certificateCount: number;
    licenceRate: number;
    licenceCount: number;
  };
  charts: {
    completionTrend: Array<{ label: string; value: number }>;
    quizBands: Array<{ label: string; value: number }>;
  };
  insights: {
    multiFailDrivers: AdminDriverRow[];
    stuckDrivers: AdminDriverRow[];
    followUpDrivers: AdminDriverRow[];
  };
  drivers: AdminDriverRow[];
  recentActivity: AuditLog[];
  recentFeedback: DriverFeedback[];
}

export interface OrganisationalChartRole {
  id: string;
  title: string;
  employeeId: string | null;
  notApplicable: boolean;
}

export interface OrganisationalChart {
  companyName: string;
  dateCompleted: string;
  roles: OrganisationalChartRole[];
  updatedAt: string;
}

export interface TrainingInductionRegisterRecord {
  id: string;
  workerName: string;
  workerType: "employee" | "subcontractor" | "unknown";
  role: string;
  trainingTitle: string;
  completionDate: string;
  status: "completed" | "in_progress";
}

export interface DriverSkillsKnowledgeReportRecord {
  id: string;
  workerId: string;
  workerName: string;
  workerType: "employee" | "contractor" | "unknown";
  role: string;
  depotLocation: string | null;
  safetyModulesAssigned: number;
  safetyModulesCompleted: number;
  safetyModulesInProgress: number;
  safetyLastActivityDate: string | null;
  safetyModuleStatuses: Array<{
    sectionId: string;
    title: string;
    status: "completed" | "in_progress" | "not_started";
    completedAt: string | null;
    startedAt: string | null;
  }>;
  quizAttempts: number;
  quizAttemptHistory: Array<{
    id: string;
    score: number | null;
    passed: boolean | null;
    attemptedAt: string | null;
    categoryScores: Record<string, number> | null;
    failedCritical: boolean | null;
    criticalQuestionsAsked: number | null;
  }>;
  quizLatestScore: number | null;
  quizBestScore: number | null;
  quizLatestPassed: boolean | null;
  quizEverPassed: boolean;
  quizLastAttemptDate: string | null;
  practicalAssessmentStatus: "Not assessed";
  medicalAssessmentStatus: "Not assessed";
  overallStatus: "Complete" | "In progress" | "Not started" | "No modules assigned";
  lastAssessmentDate: string | null;
}

export interface DriverMedicalFitnessReportRecord {
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
}

export interface TrainingAcknowledgementEntry {
  id: string;
  workerId: string;
  workerName: string;
  workerType: "employee" | "contractor" | "unknown";
  role: string;
  sectionId: string;
  sectionVersion: string;
  presentationTitle: string;
  moduleStatus: "completed" | "in_progress" | "activity_not_found";
  moduleCompletedAt: string | null;
  acknowledgementStatus: "completed" | "pending";
  acknowledgementStatement: string | null;
  acknowledgedAt: string | null;
  signature: string | null;
  signedAt: string | null;
  recordedBy: string | null;
}

export interface DriverTrainingAcknowledgement {
  id: string;
  sectionId: string;
  sectionVersion: string;
  acknowledgementStatement: string;
  acknowledgedAt: string;
  signature: string;
  signedAt: string;
}

export interface CertificateVerificationResult {
  verified: boolean;
  valid?: boolean;
  organizationName?: string;
  message?: string;
  driverName?: string;
  certificateId?: string;
  verificationCode?: string;
  issuedAt?: string;
  expiresAt?: string | null;
  licenceClass?: string | null;
  issuingState?: string | null;
  depotLocation?: string | null;
  certificate?: {
    completionId: string;
    verificationCode: string;
    verificationUrl: string;
    issuedAt: string;
    expiresAt?: string | null;
  };
  driver?: {
    fullName: string;
  };
}

export interface QuizQuestionResult {
  id: number;
  category?: string;
  isCritical?: boolean;
  correct: boolean;
  // Only populated when the attempt passed, so a failed attempt
  // never reveals the correct answer to the driver.
  correctAnswer?: number;
  explanation?: string;
}

export interface QuizSubmitResult {
  score: number;
  passed: boolean;
  attempt?: QuizAttempt;
  questions?: Array<{ id: number; explanation: string; correctAnswer: number }>;
  results?: QuizQuestionResult[];
  retryAt?: string;
  state?: DriverBundle;
  categoryScores?: Record<string, number>;
  failedCritical?: boolean;
  failedCriticalReason?: string;
}

// ============================================================
// MILESTONE 1: Versioned Inductions
// ============================================================

export interface InductionVersion {
  id: string | null;
  versionLabel: string;
  revisionNotes: string;
  publishedAt: string | null;
  hasPendingVersion: boolean;
}

export interface InductionVersionRecord {
  id: string;
  versionLabel: string;
  revisionNotes: string;
  publishedBy: string | null;
  publishedAt: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface InductionCourse {
  id: string;
  title: string;
  description: string;
  templateId: string | null;
  versionLabel: string;
  revisionNotes: string;
  isTemplate: boolean;
  isCurrent: boolean;
  siteTag: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// BNT LOGISTICS COMPLIANCE & FLEET MANAGEMENT TYPES
// ============================================================

export type AuditCategory = "Transport" | "Work Health & Safety" | "Operational Risk" | "Fleet Compliance";
export type AuditStatus = "Passed" | "In Progress" | "No Attempt" | "Action Required";

export interface ComplianceAudit {
  id: string;
  name: string;
  category: AuditCategory;
  assignedModule: string;
  status: AuditStatus;
  attemptsCount: number;
  description: string;
  lastAttemptDate?: string | null;
}

export type SOPCategory = "SOP" | "Policy & Procedure" | "Licensing" | "Product Inductions";
export type SOPStatus = "Passed" | "In Progress" | "No Attempt" | "Expired";

export interface SOPItem {
  id: string;
  code: string;
  name: string;
  category: SOPCategory;
  isMandatory: boolean;
  dueDate?: string | null;
  status: SOPStatus;
  contentSummary: string;
  videoUrl?: string;
  quizQuestionsCount?: number;
  audience?: "all" | "employee" | "contractor";
  targetRole?: "all" | "driver" | "warehouse" | "office";
}

// ============================================================
// COMPLIANCE AUDITS (admin-assigned safety audits)
// ============================================================

export type ComplianceAuditCategory =
  | "Transport"
  | "Work Health & Safety"
  | "Operational Risk"
  | "Fleet Compliance";

export type AuditAssignmentStatus = "No Attempt" | "In Progress" | "Passed" | "Action Required";

export interface ComplianceAuditRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  questions: string[];
  dueDate: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AuditAssignment {
  id: string;
  auditId: string;
  audit: ComplianceAuditRecord;
  status: AuditAssignmentStatus;
  dueDate: string | null;
  attemptsCount: number;
  lastAttemptDate: string | null;
  completedAt: string | null;
}

export interface AdminAuditAssignmentRow extends AuditAssignment {
  driverName: string;
  driverEmail: string;
}

export type ComplianceDocCategory = "Licence" | "Insurance" | "Certificates" | "SLA / Contract";
export type ComplianceDocStatus = "Approved" | "Pending" | "Rejected" | "Expired" | "Action Required" | "Not Submitted";

export interface ComplianceDocumentRequirement {
  id: string;
  name: string;
  category: ComplianceDocCategory;
  isMandatory: boolean;
  expiryDate: string | null;
  status: ComplianceDocStatus;
  historyStatus: string;
  uploadedFileUrl?: string | null;
  uploadedFileDownloadUrl?: string | null;
  uploadedFileName?: string | null;
  uploadedAt?: string | null;
  rejectionReason?: string | null;
  documentType?: string | null;
}

export interface VehicleRecord {
  id: string;
  rego: string;
  makeModel: string;
  bodyType: string;
  branchName: string;
  driverNumber: string;
  driverName: string;
  regoExpiryDate: string;
  dgExpiryDate?: string | null;
  scbaServiceDueDate?: string | null;
  vehicleCheckApproved: boolean;
  regoCheckApproved: boolean;
  status: "Active" | "Inactive" | "Maintenance Required";
  qrPassCode: string;
  contactNumber?: string;
  regoDocumentUrl?: string | null;
  regoDocumentStatus?: "missing" | "pending" | "approved" | "rejected";
  regoDocumentRejectionReason?: string | null;
  insuranceDocumentUrl?: string | null;
  insuranceDocumentExpiry?: string | null;
  insuranceDocumentStatus?: "missing" | "pending" | "approved" | "rejected";
  insuranceDocumentRejectionReason?: string | null;
  inspectionDocumentUrl?: string | null;
  inspectionDocumentExpiry?: string | null;
  inspectionDocumentStatus?: "missing" | "pending" | "approved" | "rejected";
  inspectionDocumentRejectionReason?: string | null;
  regoDocumentReviewedBy?: string | null;
  regoDocumentReviewedAt?: string | null;
  insuranceDocumentReviewedBy?: string | null;
  insuranceDocumentReviewedAt?: string | null;
  inspectionDocumentReviewedBy?: string | null;
  inspectionDocumentReviewedAt?: string | null;
}

export interface VehiclePassVerificationResult {
  verified: boolean;
  message?: string;
  organizationName?: string;
  vehicle?: {
    passCode: string;
    rego: string;
    makeModel: string;
    bodyType?: string | null;
    branchName?: string | null;
    status: string;
    regoExpiryDate?: string | null;
    dgExpiryDate?: string | null;
    scbaServiceDueDate?: string | null;
  };
  driver?: {
    fullName: string;
    email: string;
  };
}

export interface DriverVerificationResult {
  verified: boolean;
  message?: string;
  organizationName?: string;
  driver?: {
    driverId: string;
    fullName: string;
    phone?: string;
    licenceClass?: string;
    inductionStatus: string;
    inductionCompleted: boolean;
    completedAt?: string | null;
    certificateExpiresAt?: string | null;
  };
}

export interface ComplianceOverview {
  complianceScore: number;
  auditsCount: { total: number; completed: number; pending: number };
  sopsCount: { total: number; completed: number; pending: number };
  documentsCount: { total: number; approved: number; expiringSoon: number; actionRequired: number };
  vehiclesCount: { total: number; active: number };
}

export interface ContractorCompanyRecord {
  id: string;
  companyId?: string;
  workerPosition?: string;
  workerStartDate?: string;
  companyName: string;
  tradingName: string;
  abn: string;
  acn?: string;
  businessDetailsComplete?: boolean;
  vehicleComplianceComplete?: boolean;
  nhvasFileUrl?: string | null;
  nhvasExpiry?: string;
  nhvasStatus?: "missing" | "pending" | "approved" | "rejected";
  nhvasRejectionReason?: string | null;
  publicLiabilityReviewedBy?: string | null;
  publicLiabilityReviewedAt?: string | null;
  workersCompReviewedBy?: string | null;
  workersCompReviewedAt?: string | null;
  agreementReviewedBy?: string | null;
  agreementReviewedAt?: string | null;
  nhvasReviewedBy?: string | null;
  nhvasReviewedAt?: string | null;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  nhvasAccreditation: "Basic Fatigue" | "Mass Management" | "Maintenance Management" | "None";
  nhvasNumber: string;
  publicLiabilityPolicy: string;
  publicLiabilityExpiry: string;
  publicLiabilityFileUrl?: string | null;
  publicLiabilityStatus?: "pending" | "approved" | "rejected";
  publicLiabilityRejectionReason?: string | null;
  workersCompPolicy: string;
  workersCompExpiry: string;
  workersCompFileUrl?: string | null;
  workersCompStatus?: "pending" | "approved" | "rejected";
  workersCompRejectionReason?: string | null;
  agreementExpiry?: string;
  agreementFileUrl?: string | null;
  agreementStatus?: "missing" | "pending" | "approved" | "rejected";
  agreementRejectionReason?: string | null;
  primaryDepot: string;
  status: "Compliant" | "Pending Review" | "Suspended" | "Inactive";
}

export interface ContractorFinancialDetails {
  bankAccountName: string;
  bankBsb: string;
  bankAccountNumber: string;
  gstRegistered: boolean | null;
  gstEffectiveDate: string;
  businessDetailsConfirmedAt?: string | null;
  taxDeclarationAt?: string | null;
  insuranceDeclarationAt?: string | null;
  vehicleDeclarationAt?: string | null;
}

export type IncidentCategory = "Near Miss" | "Accident" | "Damaged Goods" | "Vehicle Defect" | "Spill / Leak" | "Safety Hazard" | "Injury / Illness";
export type IncidentSeverity = "Low" | "Medium" | "High" | "Critical";

export interface SafetyIncidentRecord {
  id: string;
  userId?: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  location: string;
  description: string;
  immediateActionsTaken: string;
  reportedBy: string;
  reportedAt: string;
  photoFileName?: string;
  status: "Open" | "Under Review" | "Resolved";
  riskScore: number;
}

export type CorFormCode = "F-04" | "F-05" | "F-08" | "F-09" | "F-10";

export interface CorFormSubmission {
  id: string;
  userId: string;
  formCode: CorFormCode | string;
  formTitle: string;
  payload: Record<string, unknown>;
  status: "Draft" | "Assigned" | "Awaiting Driver Acknowledgement" | "Awaiting Scheduler Acknowledgement" | "Trip Change Reported" | "Acknowledged" | "Submitted" | "Under Review" | "Resolved";
  submittedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
}

export interface SiteCheckinRecord {
  id: string;
  depotName: string;
  driverName: string;
  vehicleRego: string;
  checkinTime: string;
  checkoutTime?: string | null;
  hoursDrivenToday: number;
  hoursRestedLast24h: number;
  fitnessDeclaration: boolean;
  status: "Active" | "Checked Out";
}

export type LeaveType = "annual" | "personal" | "unpaid" | "other";
export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveRequestStatus;
  decision_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AdminLeaveRequest extends LeaveRequest {
  user_id: string;
  employee: { id: string; full_name: string | null; email: string | null } | null;
}

export interface AdminAttendanceRecord extends SiteCheckinRecord {
  userId: string;
}

export interface QuarterlyReviewCompanyDetails {
  operator: string;
  abn: string;
  abnAcn?: string;
  name?: string;
  year?: number;
  compliancePeriod?: string;
}

export interface QuarterlyReviewSection {
  id: string;
  title: string;
  [key: string]: string | number | string[] | null;
}

export interface QuarterlyReviewAcknowledgement {
  name: string;
  role: string;
  signature: string;
  date: string;
}

export interface QuarterlyComplianceReview {
  id: string;
  review_quarter: "Q1" | "Q2" | "Q3" | "Q4";
  review_year: number;
  company_details: QuarterlyReviewCompanyDetails;
  section_data: QuarterlyReviewSection[];
  acknowledgement: QuarterlyReviewAcknowledgement;
  status: "draft" | "submitted";
  created_by: string;
  submitted_at: string | null;
  retention_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnualSystemReviewCompanyDetails {
  companyName: string;
  abn: string;
  address: string;
  contactName: string;
  email: string;
  phone: string;
}

export interface AnnualSystemReviewRequirement {
  id: string;
  title: string;
  status: "yes" | "needs_actioning" | "not_applicable";
  notes: string;
}

export interface AnnualSystemReviewFollowUp {
  id: string;
  requirementId: string;
  correctiveAction: string;
  responsiblePerson: string;
  dueDate: string;
  status: "open" | "in_progress" | "completed";
}

export interface AnnualSystemReviewAcknowledgement {
  reviewerName: string;
  companyRole: string;
  signature: string;
  reviewDate: string;
}

export interface AnnualSystemReview {
  id: string;
  review_year: number;
  company_details: AnnualSystemReviewCompanyDetails;
  requirements: AnnualSystemReviewRequirement[];
  follow_up: AnnualSystemReviewFollowUp[];
  acknowledgement: AnnualSystemReviewAcknowledgement;
  status: "draft" | "submitted";
  created_by: string;
  submitted_at: string | null;
  retention_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreTripCheckItem {
  id: string;
  category: string;
  label: string;
  status: "Pass" | "Defect";
  notes?: string;
  photos?: string[];
}

export interface PreTripInspectionRecord {
  id: string;
  driverId: string;
  driverName: string;
  vehicleRego: string;
  odometer: string;
  trailerId?: string;
  inspectedAt: string;
  overallStatus: "Fit for Duty" | "Minor Defect" | "Out of Service";
  items: PreTripCheckItem[];
  driverSignature: string;
}

// --- Worksite Management ---
export interface WorksiteRecord {
  id: string;
  name: string;
  address: string;
  siteCode: string;
  qrToken: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorksiteAttendanceRecord {
  id: string;
  worksiteId: string;
  worksiteName: string;
  userId: string;
  driverName: string;
  signinPhotoUrl: string;
  signinAt: string;
  signoutAt: string | null;
  signoutPhotoUrl: string | null;
  status: string;
  durationMinutes: number | null;
}

export interface WorksiteAttendanceReport {
  driverId: string;
  driverName: string;
  worksiteId: string;
  worksiteName: string;
  verificationCode: string;
  signinAt: string;
  signoutAt: string | null;
  status: string;
  durationMinutes: number | null;
  signinPhotoUrl: string | null;
  signoutPhotoUrl: string | null;
}

export interface InductionScheduleInvitation {
  id: string;
  enrollmentId: string;
  scheduleItemId: string;
  deliveryMethod: string;
  status: "pending" | "sent" | "delivered" | "opened" | "clicked" | "failed" | "bounced";
  metadata: {
    driver_email: string;
    driver_name: string;
    item_title: string;
    schedule_name: string;
    due_date?: string;
    expiry_interval?: string;
  };
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// INDUCTION SCHEDULES
// ============================================================

export interface InductionSchedule {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InductionScheduleItem {
  id: string;
  scheduleId: string;
  courseId: string | null;
  title: string;
  sequenceOrder: number;
  delayType: "after_completion" | "after_enrollment" | "fixed_date";
  delayDays: number;
  fixedDate: string | null;
  expiryInterval: string | null;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
  course?: InductionCourse;
}

export interface InductionScheduleEnrollment {
  id: string;
  scheduleId: string;
  driverId: string;
  enrolledAt: string;
  enrolledBy: string | null;
  status: "active" | "completed" | "cancelled" | "paused";
  currentItemIndex: number;
  completedAt: string | null;
  driver?: DriverProfile;
  schedule?: InductionSchedule;
  enrolledByProfile?: { id: string; email: string; fullName: string };
}

// ============================================================
// SITE INDUCTION COURSES - SLIDES & QUESTIONS
// ============================================================

export interface InductionSlide {
  id: string;
  courseId: string;
  slideOrder: number;
  slideType: string;
  title: string;
  contentJson: Record<string, any>;
  siteTag: string;
  videoUrl: string | null;
  audioUrl: string | null;
  forcedWaitSeconds: number;
  estimatedDurationSeconds: number;
  triggerConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CourseContentItem {
  id: string;
  type: "text" | "video" | "image" | "pdf" | "audio";
  title: string;
  text?: string;
  url?: string;
  caption?: string;
  requireRead?: boolean;
}

export interface SlideExtras {
  mediaJson?: Record<string, unknown>;
  contentItems?: CourseContentItem[];
  documents?: Array<{ url: string; title?: string; name?: string; requireRead?: boolean; pages?: number }>;
  questions?: SlideQuestion[];
  images?: Array<{ url: string; caption?: string; alt?: string }>;
  attachments?: Array<{ url: string; name?: string }>;
  voiceover?: { url: string };
  warning?: string;
  textSize?: string;
  videoUrl?: string;
  audioUrl?: string;
  forcedWaitSeconds?: number;
  estimatedDurationSeconds?: number;
  triggerConfig?: Record<string, unknown>;
}

export interface SlideQuestion {
  id: string;
  question: string;
  prompt?: string;
  options: string[];
  correctAnswer: number;
  correct_answer?: number;
  correctAnswers?: number[];
  explanation: string;
  category: string;
  isCritical: boolean;
  is_critical?: boolean;
  questionType: "single_choice" | "text_input" | "multiple_choice";
  question_type?: string;
  placement: "separate_page" | "below_slide";
  sortOrder: number;
  sort_order?: number;
  acceptedAnswers?: string[];
}

export interface LearningQuestionResponse {
  sectionId: string;
  sectionTitle: string;
  questionId: string;
  question: string;
  answer: string | null;
}

// ============================================================
// BRANDING & POLICIES
// ============================================================

export interface BrandingSettings {
  id: string;
  organizationName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  customCss: string;
  createdAt: string;
  updatedAt: string;
  companyName?: string;
  welcomeText?: string;
  logoPath?: string | null;
}

export interface PolicyRecord {
  id: string;
  title: string;
  description: string;
  version: string;
  status: "draft" | "published" | "archived";
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  versionId: string;
  policyId?: string;
  name: string;
  versionLabel: string;
  signed: boolean;
  audience?: "all" | "employee" | "contractor";
  targetRole?: "all" | "driver" | "warehouse" | "office";
}

export interface PolicyListItem {
  id: string;
  title: string;
  version: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  signatureCount: number;
  totalDrivers: number;
  policyId: string;
  versionId: string | null;
  name: string;
  versionLabel: string;
  signedCount: number;
  audience?: "all" | "employee" | "contractor";
  targetRole?: "all" | "driver" | "warehouse" | "office";
}

export interface PolicySignatureSummary {
  policyId: string;
  policyTitle: string;
  policyVersion: string;
  signedCount: number;
  pendingCount: number;
  totalDrivers: number;
  driverId?: string;
  signedAt: string;
  driverName: string;
  driverEmail: string;
  signatureText: string;
}

export interface PolicyPendingDriver {
  id: string;
  fullName: string;
  email: string;
  depotLocation: string;
  driverId?: string;
  driverName?: string;
  driverEmail?: string;
}

// ============================================================
// REPORTS
// ============================================================

export interface ReportsOverview {
  totalDrivers: number;
  completedInductions: number;
  pendingInductions: number;
  certificatesIssued: number;
  documentsPending: number;
  expiringSoon: number;
  attemptedInductions?: number;
  validCertificates?: number;
  expiringCertificates?: number;
  expiredCertificates?: number;
  expiringDocuments?: number;
  pendingApprovals?: number;
  activeSchedules?: number;
  overdueSchedules?: number;
}

export interface AttemptedInductionReport {
  driverId: string;
  driverName: string;
  email: string;
  inductionTitle: string;
  attemptDate: string;
  score: number;
  passed: boolean;
  status: string;
}

export interface CertificateStatusReport {
  driverId: string;
  driverName: string;
  email: string;
  certificateId: string;
  issuedAt: string;
  expiresAt: string | null;
  status: "valid" | "expiring" | "expired";
  verificationCode: string;
}

export interface ExpiringCertificateReport {
  driverId: string;
  driverName: string;
  email: string;
  certificateId: string;
  expiresAt: string;
  daysUntilExpiry: number;
}

export interface ExpiringDocumentReport {
  driverId: string;
  driverName: string;
  email: string;
  documentType: string;
  documentName: string;
  expiresAt: string;
  daysUntilExpiry: number;
}

export interface DocumentApprovalReport {
  driverId: string;
  driverName: string;
  email: string;
  documentType: string;
  documentName: string;
  uploadedAt: string;
  status: "pending" | "approved" | "rejected";
}

export interface ScheduledStatusReport {
  driverId: string;
  driverName: string;
  email: string;
  scheduleName: string;
  currentItem: string;
  status: "active" | "completed" | "cancelled" | "paused";
  enrolledAt: string;
  completedAt: string | null;
}

export interface TrainingCalendarEmployee {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
}

export interface TrainingCalendarEvent {
  id: string;
  title: string;
  topic: string;
  trainer: string;
  employee_id: string | null;
  target_group?: string | null;
  role?: string | null;
  scheduled_date: string;
  start_time?: string | null;
  end_time?: string | null;
  refresher_due_date: string | null;
  status: "scheduled" | "completed" | "overdue";
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  employee?: TrainingCalendarEmployee;
}

export interface NewTrainingCalendarEvent {
  title: string;
  topic: string;
  trainer: string;
  employee_id?: string | null;
  target_group?: string | null;
  role?: string | null;
  scheduled_date: string;
  start_time?: string | null;
  end_time?: string | null;
  refresher_due_date?: string | null;
  notes?: string;
  status?: "scheduled" | "completed" | "overdue";
}

export type InductionRecordStatus = "draft" | "completed";
export type WorkerRole = "driver" | "warehouse" | "office";
export type EmploymentType = "employee" | "contractor";

export interface InductionChecklistItem {
  id: string;
  label: string;
  answered: boolean;
  status: "pass" | "fail" | "n_a";
  notes: string;
}

export interface InductionDocumentItem {
  documentType: string;
  name: string;
  category: string;
  isMandatory: boolean;
  status: "approved" | "expired" | "missing" | "missing_expiry" | "pending" | "rejected" | "not_submitted";
  expiryDate: string | null;
  uploadedAt: string | null;
  uploadedFileUrl: string | null;
  uploadedFileName: string | null;
  rejectionReason: string | null;
}

export interface InductionAcknowledgement {
  content: string;
  acknowledged: boolean;
  date: string | null;
  source?: "driver";
  submittedBy?: string;
}

export interface InductionSignature {
  signer: string;
  signerRole: string;
  signature: string;
  signedAt: string | null;
  source?: "driver";
  signerId?: string;
}

export interface InductionWorkerSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  employmentType: EmploymentType | null;
  staffRole: WorkerRole | null;
  role: string | null;
  contractorCompanyName: string | null;
  licenceClass: string | null;
  licenceNumber: string | null;
  issuingState: string | null;
  depotLocation: string | null;
}

export interface EmployeeInductionRecord {
  id: string;
  worker_id: string;
  employment_type: EmploymentType;
  staff_role: WorkerRole;
  contractor_company_id: string | null;
  role: string | null;
  checklist: InductionChecklistItem[];
  documents: InductionDocumentItem[];
  acknowledgements: InductionAcknowledgement[];
  signatures: InductionSignature[];
  status: InductionRecordStatus;
  induction_start_date: string | null;
  induction_completed_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  worker?: InductionWorkerSummary;
  legal_signoff?: {
    signature: string;
    signed_at: string | null;
    is_image: boolean;
  } | null;
}

export interface NewEmployeeInductionRecord {
  worker_id: string;
  employment_type: EmploymentType;
  staff_role: WorkerRole;
  contractor_company_id?: string | null;
  role?: string | null;
  checklist?: InductionChecklistItem[];
  documents?: InductionDocumentItem[];
  acknowledgements?: InductionAcknowledgement[];
  signatures?: InductionSignature[];
  status?: InductionRecordStatus;
  induction_start_date?: string | null;
  induction_completed_date?: string | null;
}
