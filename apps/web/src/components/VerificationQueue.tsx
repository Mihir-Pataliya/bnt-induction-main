import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileCheck, CheckCircle2, Clock, Check, X, Eye, ExternalLink } from "lucide-react";
import { useAppState } from "../state/AppContext";
import { apiBaseUrl, supabase } from "../lib/supabase";
import { REQUIRED_EXPIRY_DOCUMENT_TYPES } from "../lib/documentCompliance";
import { showToast } from "./ui/Toast";

interface PendingDocument {
  id: string;
  user_id: string;
  type: string;
  file_name: string | null;
  mime_type: string | null;
  status: "pending" | "approved" | "rejected";
  uploaded_at: string;
  expires_at: string | null;
  preview_url?: string | null;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

export function VerificationQueue() {
  const { t } = useTranslation();
  const { session } = useAppState();
  const TYPE_LABELS: Record<string, string> = {
    driver_license: t("vq_type_licence"),
    medical_certificate: t("vq_type_medical"),
    right_to_work: "Right to work",
    identity_proof: t("vq_type_identity")
  };
  const NODE_LABELS: Record<string, string> = {
    "[PROFILE & UPLOAD]": t("vq_node_1"),
    "[PENDING VERIFICATION]": t("vq_node_2"),
    "[APPROVE]": t("vq_node_3"),
    "[TRAINING UNLOCKED]": t("vq_node_4")
  };
  const [docs, setDocs] = useState<PendingDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expiryByDocument, setExpiryByDocument] = useState<Record<string, string>>({});
  const [workRightsConfirmed, setWorkRightsConfirmed] = useState<Record<string, boolean>>({});
  const [workRightsMethod, setWorkRightsMethod] = useState<Record<string, "manual" | "vevo">>({});
  const [previewDocument, setPreviewDocument] = useState<PendingDocument | null>(null);
  const [rejectingDocument, setRejectingDocument] = useState<PendingDocument | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setQueueError(null);
    try {
      // Prefer the authenticated admin endpoint. Supabase RLS can return an
      // empty result without an error for direct client queries, which would
      // otherwise hide documents that the admin endpoint can read.
      if (session?.accessToken && apiBaseUrl) {
        const res = await fetch(`${apiBaseUrl}/admin/verification-queue`, {
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });

        const data = await res.json().catch(() => null) as { documents?: PendingDocument[]; message?: string } | null;
        if (!res.ok) {
          throw new Error(data?.message ?? `Verification queue request failed (${res.status}).`);
        }
        if (!Array.isArray(data?.documents)) {
          throw new Error("Verification queue returned an invalid response.");
        }

        setDocs(data.documents);
        return;
      }

      // Fall back to a direct Supabase query for deployments without the API.
      const { data: supaDocs, error } = await supabase
        .from("documents")
        .select("*")
        .eq("status", "pending")
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      const userIds = [...new Set((supaDocs ?? []).map((document: any) => document.user_id))];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
        : { data: [] };
      const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const withPreviews = await Promise.all((supaDocs ?? []).map(async (document: any) => {
        const { data: signedFile } = await supabase.storage.from("driver-documents").createSignedUrl(document.file_url, 10 * 60);
        return { ...document, preview_url: signedFile?.signedUrl ?? null, profiles: profilesById.get(document.user_id) ?? null };
      }));
      setDocs(withPreviews as PendingDocument[]);
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : t("vq_fail"));
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken, t]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  async function handleAction(docId: string, action: "approve" | "reject", reason = ""): Promise<boolean> {
    setProcessing(docId + action);
    try {
      let msg = action === "approve" ? t("vq_approved") : t("vq_rejected");
      if (!session?.accessToken) throw new Error("Admin authentication is required.");
      const res = await fetch(`${apiBaseUrl}/admin/documents/${docId}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({
          action,
          ...(action === "reject" ? { reason: reason.trim() } : {}),
          ...(action === "approve" && expiryByDocument[docId]
            ? { expiresAt: new Date(`${expiryByDocument[docId]}T00:00:00.000Z`).toISOString() }
            : {}),
          ...(action === "approve" && docs.find((doc) => doc.id === docId)?.type === "right_to_work"
            ? { workRightsCheck: workRightsConfirmed[docId] === true, workRightsMethod: workRightsMethod[docId] ?? "manual" }
            : {})
        })
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? `Document verification failed (${res.status}).`);
      msg = data.message ?? msg;

      showToast(msg, "success");
      void fetchQueue();
      return true;
    } catch (error) {
      console.error("Document verification failed:", error);
      showToast(error instanceof Error ? error.message : t("vq_fail"), "error");
      return false;
    } finally {
      setProcessing(null);
    }
  }

  async function submitRejection(event: FormEvent) {
    event.preventDefault();
    if (!rejectingDocument || rejectionReason.trim().length < 3) return;
    const saved = await handleAction(rejectingDocument.id, "reject", rejectionReason);
    if (saved) {
      setRejectingDocument(null);
      setRejectionReason("");
    }
  }

  const groupedByDriver = docs.reduce<Record<string, PendingDocument[]>>((acc, doc) => {
    const key = doc.user_id;
    acc[key] = acc[key] ? [...acc[key], doc] : [doc];
    return acc;
  }, {});

  return (
    <div className="glass" style={{ padding: "32px", marginTop: "24px", borderRadius: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.4rem" }}>{t("vq_title")}</h2>
          <p className="muted" style={{ margin: 0 }}>{t("vq_subtitle")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {docs.length > 0 && (
            <span style={{
              background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: "0.78rem",
              padding: "4px 10px", borderRadius: "999px"
            }}>{t(docs.length === 1 ? "vq_pending_one" : "vq_pending_other", { count: docs.length })}</span>
          )}
          <button onClick={() => void fetchQueue()}
            style={{ padding: "8px 16px", border: "1px solid var(--border)", borderRadius: "10px", cursor: "pointer", background: "transparent", fontWeight: 600 }}>
            {t("vq_refresh")}
          </button>
        </div>
      </div>

      {/* Status machine badge */}
      <div style={{
        display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "24px", padding: "14px 18px",
        background: "rgba(37,99,235,0.07)", borderRadius: "14px", border: "1px solid rgba(37,99,235,0.15)"
      }}>
        {["[PROFILE & UPLOAD]", "→", "[PENDING VERIFICATION]", "→", "[APPROVE]", "→", "[TRAINING UNLOCKED]"].map((node, i) => (
          <span key={i} style={{
            fontWeight: node.startsWith("[") ? 700 : 400,
            color: node === "[PENDING VERIFICATION]" ? "#d97706" : node === "[APPROVE]" ? "#16a34a" : "inherit",
            fontSize: "0.8rem", opacity: node === "→" ? 0.5 : 1
          }}>{NODE_LABELS[node] ?? node}</span>
        ))}
      </div>

      {loading && <p className="muted">{t("vq_loading")}</p>}

      {!loading && queueError && (
        <p role="alert" style={{ color: "#dc2626" }}>
          {queueError}
        </p>
      )}

      {!loading && !queueError && docs.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", opacity: 0.5 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          </div>
          <p style={{ fontWeight: 600, margin: 0 }}>{t("vq_empty_title")}</p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>{t("vq_empty_sub")}</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {Object.entries(groupedByDriver).map(([driverId, driverDocs]) => {
          const profile = driverDocs[0]?.profiles;
          return (
            <div key={driverId} className="glass card-hover" style={{ borderRadius: "18px", padding: "20px", border: "1px solid rgba(217,119,6,0.25)", background: "rgba(255,251,235,0.04)" }}>
              {/* Driver row */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#f59e0b,#d97706)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.9rem", flexShrink: 0 }}>
                  {(profile?.full_name ?? "?")[0].toUpperCase()}
                </div>
                <div>
                  <strong style={{ fontSize: "0.95rem" }}>{profile?.full_name ?? t("vq_unknown_driver")}</strong>
                  <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>{profile?.email ?? driverId}</p>
                </div>
                <span style={{
                  marginLeft: "auto", padding: "4px 12px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 700,
                  background: "rgba(217,119,6,0.15)", color: "#d97706", display: "inline-flex", alignItems: "center", gap: "5px"
                }}>
                  <Clock className="w-3.5 h-3.5" /> {t("vq_awaiting")}
                </span>
              </div>

              {/* Documents */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {driverDocs.map((doc) => (
                  <div key={doc.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                    padding: "12px 16px", borderRadius: "12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", flexWrap: "wrap"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <FileCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                      <div>
                        <strong style={{ fontSize: "0.88rem" }}>{TYPE_LABELS[doc.type] ?? doc.type}</strong>
                        <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
                          {doc.file_name ?? t("vq_uploaded_doc")} • {new Date(doc.uploaded_at).toLocaleDateString("en-AU")}
                        </p>
                      </div>
                    </div>
                    <label htmlFor={`doc-expiry-${doc.id}`} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem" }}>
                      {t("vq_expiry_label")}{REQUIRED_EXPIRY_DOCUMENT_TYPES.includes(doc.type as any) ? " (required)" : ""}
                      <input
                        id={`doc-expiry-${doc.id}`}
                        name={`expiry_${doc.id}`}
                        type="date"
                        value={expiryByDocument[doc.id] ?? doc.expires_at?.slice(0, 10) ?? ""}
                        onChange={(event) => setExpiryByDocument((current) => ({ ...current, [doc.id]: event.target.value }))}
                        disabled={processing?.startsWith(doc.id)}
                        autoComplete="off"
                      />
                    </label>
                    {doc.type === "right_to_work" && <div style={{ display: "flex", alignItems: "center", gap: 8, flexBasis: "100%", fontSize: "0.78rem" }}>
                      <label><input type="checkbox" checked={workRightsConfirmed[doc.id] ?? false} onChange={(event) => setWorkRightsConfirmed((value) => ({ ...value, [doc.id]: event.target.checked }))} /> I checked the worker's work rights</label>
                      <select aria-label="Work rights check method" value={workRightsMethod[doc.id] ?? "manual"} onChange={(event) => setWorkRightsMethod((value) => ({ ...value, [doc.id]: event.target.value as "manual" | "vevo" }))}>
                        <option value="manual">Manual evidence check</option><option value="vevo">VEVO check</option>
                      </select>
                    </div>}
                    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => setPreviewDocument(doc)}
                        disabled={!doc.preview_url}
                        title={doc.preview_url ? "Preview uploaded document" : "Preview is unavailable"}
                        style={{ padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--border)", cursor: doc.preview_url ? "pointer" : "not-allowed", background: "transparent", color: "var(--color-text)", fontWeight: 700, fontSize: "0.85rem", opacity: doc.preview_url ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <Eye className="w-4 h-4" /> Preview
                      </button>
                      <button
                        onClick={() => void handleAction(doc.id, "approve")}
                        disabled={processing?.startsWith(doc.id) || (REQUIRED_EXPIRY_DOCUMENT_TYPES.includes(doc.type as any) && !(expiryByDocument[doc.id] ?? doc.expires_at)) || (doc.type === "right_to_work" && !workRightsConfirmed[doc.id])}
                        style={{
                          padding: "7px 18px", borderRadius: "9px", border: "none", cursor: "pointer",
                          background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: "0.85rem",
                          opacity: processing?.startsWith(doc.id) ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: "4px"
                        }}>
                        {processing === doc.id + "approve" ? "..." : <><Check className="w-4 h-4" /> {t("vq_approve")}</>}
                      </button>
                      <button
                        onClick={() => { setRejectingDocument(doc); setRejectionReason(""); }}
                        disabled={processing?.startsWith(doc.id)}
                        style={{
                          padding: "7px 18px", borderRadius: "9px", border: "1px solid #ef4444", cursor: "pointer",
                          background: "transparent", color: "#ef4444", fontWeight: 700, fontSize: "0.85rem",
                          opacity: processing?.startsWith(doc.id) ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: "4px"
                        }}>
                        {processing === doc.id + "reject" ? "..." : <><X className="w-4 h-4" /> {t("vq_reject")}</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {previewDocument && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewDocument(null); }} style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(2,6,23,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <section role="dialog" aria-modal="true" aria-label={`Preview ${previewDocument.file_name ?? previewDocument.type}`} style={{ background: "var(--bg-elevated, #0f172a)", border: "1px solid var(--border)", borderRadius: "16px", width: "min(1000px, 96vw)", height: "min(820px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <strong>{previewDocument.file_name ?? TYPE_LABELS[previewDocument.type] ?? previewDocument.type}</strong>
              <div style={{ display: "flex", gap: "8px" }}>
                {previewDocument.preview_url && <a href={previewDocument.preview_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "8px", color: "inherit", textDecoration: "none", fontSize: "0.82rem" }}><ExternalLink className="w-4 h-4" /> Open file</a>}
                <button type="button" onClick={() => setPreviewDocument(null)} aria-label="Close preview" style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "8px", background: "transparent", color: "inherit", cursor: "pointer" }}><X className="w-4 h-4" /></button>
              </div>
            </header>
            <div style={{ flex: 1, minHeight: 0, background: "#0b1120", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {previewDocument.preview_url && previewDocument.mime_type?.startsWith("image/") ? <img src={previewDocument.preview_url} alt={previewDocument.file_name ?? previewDocument.type} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                : previewDocument.preview_url && previewDocument.mime_type === "application/pdf" ? <iframe title={previewDocument.file_name ?? "Document preview"} src={previewDocument.preview_url} style={{ width: "100%", height: "100%", border: 0, background: "white" }} />
                : <p className="muted">This file type cannot be previewed here. Use “Open file” to view it.</p>}
            </div>
          </section>
        </div>
      )}
      {rejectingDocument && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRejectingDocument(null); }} style={{ position: "fixed", inset: 0, zIndex: 151, background: "rgba(2,6,23,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <form onSubmit={submitRejection} role="dialog" aria-modal="true" aria-labelledby="reject-document-title" style={{ background: "var(--bg-elevated, #0f172a)", border: "1px solid var(--border)", borderRadius: "16px", width: "min(520px, 96vw)", padding: "22px" }}>
            <h3 id="reject-document-title" style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>Reject {TYPE_LABELS[rejectingDocument.type] ?? rejectingDocument.type}</h3>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: "0.86rem" }}>Give the driver a reason so they know what to correct before uploading again.</p>
            <label htmlFor="document-rejection-reason" style={{ display: "block", fontSize: "0.84rem", fontWeight: 600, marginBottom: "6px" }}>Rejection reason</label>
            <textarea id="document-rejection-reason" required minLength={3} maxLength={1000} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={4} autoFocus style={{ boxSizing: "border-box", width: "100%", resize: "vertical", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "inherit" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button type="button" onClick={() => setRejectingDocument(null)} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "inherit", cursor: "pointer" }}>Cancel</button>
              <button type="submit" disabled={processing !== null || rejectionReason.trim().length < 3} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "#dc2626", color: "white", fontWeight: 700, cursor: "pointer", opacity: processing !== null || rejectionReason.trim().length < 3 ? 0.55 : 1 }}>Confirm rejection</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
