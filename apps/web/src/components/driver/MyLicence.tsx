import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileText, ShieldCheck, Upload, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { DriverBundle, SessionState } from "../../types";

interface MyLicenceProps {
  session?: SessionState | null;
  driverBundle?: DriverBundle | null;
  onRefresh?: () => void | Promise<void>;
}

function formatExpiry(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU");
}

function expiryStatus(value?: string | null) {
  if (!value) return "No expiry date";
  const expiry = new Date(value);
  const now = new Date();
  if (Number.isNaN(expiry.getTime())) return "No expiry date";
  if (expiry < now) return "Expired";
  if (expiry.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000) return "Expiring Soon";
  return "Valid";
}

function verificationLabel(status?: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "pending") return "Pending";
  return "Not uploaded";
}

export function MyLicence({ session, driverBundle, onRefresh }: MyLicenceProps) {
  const [bundle, setBundle] = useState<DriverBundle | null>(driverBundle ?? null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setBundle(driverBundle ?? null);
  }, [driverBundle]);

  const driver = bundle?.driver;
  const document = (bundle?.documents ?? []).find((item) => item.type === "driver_license");
  const verification = verificationLabel(document?.status);
  const expiry = expiryStatus(document?.expiresAt);
  const rejectionReason = document?.rejectionReason;

  const acceptedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) {
      setError("Please sign in again.");
      return;
    }
    if (!selectedFile) {
      setError("Select a licence document to upload.");
      return;
    }
    if (!acceptedMimeTypes.includes(selectedFile.type)) {
      setError("Upload a PDF, JPG, or PNG file.");
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("File size must be 5 MB or less.");
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);
    setProgress(0);

    try {
      await api.uploadDocument(session, { type: "driver_license", file: selectedFile }, (value) => setProgress(value));
      const updated = await api.getDriverProfile(session);
      setBundle(updated);
      setSelectedFile(null);
      setMessage("Licence document uploaded for verification.");
      await onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload the licence document.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  if (!session) {
    return <p className="text-slate-300">Please sign in again.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">My Licence</p>
        <h3 className="mt-1 text-lg font-black text-white">Driver licence details</h3>
        <p className="mt-1 text-sm text-slate-300">
          Your licence profile, document verification status, and expiry information. Uploads are sent to the existing verification workflow.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {message}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Licence number</p>
          <p className="mt-1 font-mono text-white">{driver?.licenceNumber || "Not recorded"}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Licence type</p>
          <p className="mt-1 text-white">{driver?.licenceClass || "Not recorded"}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Issuing state</p>
          <p className="mt-1 text-white">{driver?.issuingState || "Not recorded"}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Date of birth</p>
          <p className="mt-1 text-white">{driver?.dateOfBirth ? formatExpiry(driver.dateOfBirth) : "Not recorded"}</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Expiry date</p>
          <p className="mt-1 text-white">{formatExpiry(document?.expiresAt)}</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Verification status</p>
          <p className="mt-1">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                verification === "Approved"
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  : verification === "Rejected"
                    ? "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                    : "bg-amber-500/10 text-amber-300 border border-amber-500/30"
              }`}
            >
              {verification}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Expiry status</p>
          <p className="mt-1">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                expiry === "Valid"
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                  : expiry === "Expiring Soon"
                    ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                    : expiry === "Expired"
                      ? "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                      : "bg-slate-700 text-slate-300 border border-slate-600"
              }`}
            >
              {expiry}
            </span>
          </p>
        </div>
      </div>

      {rejectionReason && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-300" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-300">Rejection reason</p>
              <p className="mt-1 text-sm text-rose-100">{rejectionReason}</p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleUpload} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-emerald-300" />
          <h4 className="text-sm font-bold text-white">Upload or replace licence document</h4>
        </div>
        <p className="text-xs text-slate-400">
          Accepted formats: PDF, JPG, PNG. Maximum size 5 MB. Replacing a document keeps the previous audit history.
        </p>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-emerald-500"
        />
        {selectedFile && (
          <p className="text-xs text-emerald-300">{selectedFile.name}</p>
        )}
        {uploading && (
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        <button
          type="submit"
          disabled={uploading || !selectedFile}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload for verification"}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </form>

      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Approved</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-amber-400" /> Pending</span>
        <span className="inline-flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-rose-400" /> Rejected</span>
        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Valid</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Expiring Soon</span>
        <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-rose-400" /> Expired</span>
      </div>
    </div>
  );
}

