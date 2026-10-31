import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Eye, FileText, RefreshCw, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { SessionState } from "../../types";

const BUCKET = "induction-assets";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const CANDIDATE_PATHS = [
  "cor/operating-procedure-inductions-and-training.pdf",
  "operating-procedure-inductions-and-training.pdf",
  "cor/operating-procedure-inductions-training.pdf",
  "operating-procedure-inductions-training.pdf"
];

interface ProcedureDocument {
  name: string;
  version: string | null;
  lastUpdated: string | null;
  viewUrl: string;
  downloadUrl: string;
}

function displayName(path: string): string {
  const segment = path.split("/").pop() ?? path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function OperatingProcedureInductionsTraining({
  session,
  onBack
}: {
  session?: SessionState;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<ProcedureDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = session?.user.role === "admin";

  const loadProcedure = async () => {
    setLoading(true);
    for (const path of CANDIDATE_PATHS) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = data.publicUrl;
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (response.ok) {
          const name = displayName(path);
          setDocument({
            name,
            version: null,
            lastUpdated: response.headers.get("last-modified"),
            viewUrl: url,
            downloadUrl: `${url}?download=${encodeURIComponent(name)}`
          });
          setLoading(false);
          return;
        }
      } catch {
        // Treat network/CORS failures as "not available" for this candidate.
      }
    }
    setDocument(null);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadProcedure();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, []);
  const validatePdf = async (file: File) => {
    if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) {
      throw new Error("Only PDF files can be uploaded.");
    }
    if (file.size <= 0) {
      throw new Error("The selected PDF is empty.");
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`PDF files must be ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB or smaller.`);
    }
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...header) !== "%PDF-") {
      throw new Error("The selected file is not a valid PDF.");
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!isAdmin) {
      setUploadError("Only authorised administrators can upload this procedure.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      await validatePdf(file);
      const { error } = await supabase.storage.from(BUCKET).upload(CANDIDATE_PATHS[0], file, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600"
      });
      if (error) throw error;
      await loadProcedure();
      setUploadSuccess("Operating procedure PDF uploaded successfully.");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "PDF upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const formattedLastUpdated = formatDate(document?.lastUpdated ?? null);

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <FileText className="h-4 w-4" aria-hidden="true" />
            COR / Inductions &amp; Training
          </p>
          <h2 className="text-2xl font-black text-white">Operating Procedure – Inductions and Training</h2>
          <p className="mt-1 text-sm text-slate-300">
            View and download the official induction and training procedure PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Inductions and Training
        </button>
      </div>

      {loading && (
        <p className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-300">
          Checking for the approved procedure PDF…
        </p>
      )}

      {!loading && !document && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
          <p className="font-bold">The approved Operating Procedure – Inductions and Training PDF needs to be provided.</p>
          <p className="mt-2 text-sm text-amber-200">
            {isAdmin
              ? "Select the approved PDF from your computer and upload it to secure storage. PDF files only, up to 25 MB."
              : "An authorised administrator must upload the approved PDF to secure storage."}
          </p>
          {isAdmin && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-400 disabled:cursor-wait disabled:opacity-70">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "Uploading PDF…" : "Upload PDF"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => void handleUpload(event.target.files?.[0])}
                />
              </label>
              <span className="text-xs text-amber-200">Replace is available after upload.</span>
            </div>
          )}
          {uploadError && (
            <p role="alert" className="mt-3 text-sm font-semibold text-red-300">{uploadError}</p>
          )}
          {uploadSuccess && (
            <p role="status" className="mt-3 text-sm font-semibold text-emerald-300">{uploadSuccess}</p>
          )}
        </div>
      )}

      {!loading && document && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Document name</dt>
                <dd className="mt-1 font-semibold text-white">{document.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Version</dt>
                <dd className="mt-1 font-semibold text-white">{document.version ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Upload date</dt>
                <dd className="mt-1 font-semibold text-white">{formattedLastUpdated ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={document.viewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                View PDF
              </a>
              <a
                href={document.downloadUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download PDF
              </a>
              {isAdmin && (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800 focus-within:outline-none focus-within:ring-2 focus-within:ring-emerald-400 disabled:cursor-wait disabled:opacity-70">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {uploading ? "Replacing…" : "Replace PDF"}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(event) => void handleUpload(event.target.files?.[0])}
                  />
                </label>
              )}
            </div>
            {uploadError && (
              <p role="alert" className="mt-3 text-sm font-semibold text-red-300">{uploadError}</p>
            )}
            {uploadSuccess && (
              <p role="status" className="mt-3 text-sm font-semibold text-emerald-300">{uploadSuccess}</p>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
            <iframe
              title={document.name}
              src={document.viewUrl}
              className="h-[70vh] w-full border-0 bg-white"
            />
          </div>
        </div>
      )}
    </section>
  );
}

