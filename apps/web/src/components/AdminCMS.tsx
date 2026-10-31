import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Plus, Trash2, GripVertical, Mic, Image, FileText, Video, Layers, ArrowUp, ArrowDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppState } from "../state/AppContext";
import { InductionVersionsPanel } from "./InductionVersionsPanel";
import { QuarterlyComplianceReviews } from "./admin/QuarterlyComplianceReviews";
import { CORAdmin } from "./admin/CORAdmin";
import { supabase } from "../lib/supabase";
import { apiBaseUrl } from "../lib/supabase";
import { uploadInductionAsset } from "../lib/api";
import { CourseContentItem } from "../types";
import { buildLearningContentItems } from "../lib/learningContent";

interface CMSQuizQuestion {
  id: any;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  sort_order: number;
  category?: string;
  is_critical?: boolean;
}

interface LearningSection {
  id: string;
  title: string;
  format: string;
  summary: string;
  video_url: string | null;
  media_json?: Record<string, unknown>;
  video_duration_seconds?: number;
  require_full_watch?: boolean;
  version?: string;
  audience?: "all" | "employee" | "contractor";
  target_role?: "all" | "driver" | "warehouse" | "office";
  is_mandatory?: boolean;
  sort_order: number;
  _contentItems?: CourseContentItem[];
  _isNew?: boolean;
}

const DEFAULT_SECTIONS: LearningSection[] = [
  {
    id: "sec-1",
    title: "1. Workplace Health, Safety & Site Protocols",
    format: "Video + Text",
    summary: "Mandatory site PPE rules, speed limits (10 km/h), pedestrian walkways, and emergency assembly points.",
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    video_duration_seconds: 120,
    require_full_watch: true,
    sort_order: 1
  },
  {
    id: "sec-2",
    title: "2. Heavy Vehicle & Fatigue Management (NHVAS)",
    format: "Interactive Guide",
    summary: "National Heavy Vehicle Regulator standards, work/rest hours, logbook compliance, and fatigue risk management.",
    video_url: null,
    video_duration_seconds: 0,
    require_full_watch: false,
    sort_order: 2
  },
  {
    id: "sec-3",
    title: "3. Safe Loading, Unloading & Load Restraint (NTC)",
    format: "Video Guide",
    summary: "Load Restraint Guide 2018 guidelines, dunnage placement, tie-down angles, and forklift Exclusion Zones.",
    video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    video_duration_seconds: 180,
    require_full_watch: true,
    sort_order: 3
  },
  {
    id: "sec-4",
    title: "4. Emergency Response & Hazard Reporting",
    format: "Standard Operating Procedure",
    summary: "Immediate spill response protocols, reporting near-miss incidents within 1 hour, and UHF Channel 14 site communication.",
    video_url: null,
    video_duration_seconds: 0,
    require_full_watch: false,
    sort_order: 4
  }
];

const DEFAULT_QUESTIONS: CMSQuizQuestion[] = [
  {
    id: "q-1",
    question: "What is the maximum speed limit for heavy vehicles inside BNT Logistics depot yards?",
    options: ["5 km/h", "10 km/h", "15 km/h", "20 km/h"],
    correct_answer: 1,
    explanation: "10 km/h is strictly enforced across all terminal areas to protect pedestrians and ground crew.",
    sort_order: 1,
    category: "Site Rules",
    is_critical: true
  },
  {
    id: "q-2",
    question: "What safety gear is mandatory before exiting your heavy vehicle cab inside the depot?",
    options: ["Hi-vis vest only", "Safety boots only", "Hi-vis vest, steel-cap boots, and hard hat", "No PPE required"],
    correct_answer: 2,
    explanation: "Full PPE (hi-vis vest, steel-cap boots, hard hat) is mandatory in active loading zones.",
    sort_order: 2,
    category: "PPE & WHS",
    is_critical: true
  },
  {
    id: "q-3",
    question: "Within how many hours must a safety hazard or near-miss incident be reported?",
    options: ["1 hour", "12 hours", "24 hours", "End of week"],
    correct_answer: 0,
    explanation: "All site hazards and near-misses must be reported immediately (within 1 hour) via the Safety Incident Reporter.",
    sort_order: 0,
    category: "Incident Reporting",
    is_critical: false
  },
  {
    id: "q-4",
    question: "Under the Chain of Responsibility (CoR), who can be held liable for a heavy vehicle compliance breach?",
    options: ["Only the driver", "Only the transport company", "All parties in the supply chain with control or influence", "Only the vehicle owner"],
    correct_answer: 2,
    explanation: "CoR extends liability to any party with control or influence over road transport, including schedulers, consignors, and employers.",
    sort_order: 4,
    category: "Chain of Responsibility",
    is_critical: true
  },
  {
    id: "q-5",
    question: "How many hours of continuous driving is the maximum allowed under standard fatigue regulations before a rest break is required?",
    options: ["4 hours", "5.5 hours", "8 hours", "10 hours"],
    correct_answer: 1,
    explanation: "Under NHVAS standard hours, a driver must not drive more than 5.5 hours continuously without a rest break of at least 30 minutes.",
    sort_order: 5,
    category: "Fatigue Management",
    is_critical: false
  }
];

export function AdminCMS() {
  const { t } = useTranslation();
  const { session } = useAppState();
  const [activeTab, setActiveTab] = useState<"modules" | "quizzes" | "versions" | "quarterly" | "cor">("modules");
  const [questions, setQuestions] = useState<CMSQuizQuestion[]>(DEFAULT_QUESTIONS);
  const [sections, setSections] = useState<LearningSection[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const [editingQuestion, setEditingQuestion] = useState<CMSQuizQuestion | null>(null);
  const [editingSection, setEditingSection] = useState<LearningSection | null>(null);
  const [contentUploading, setContentUploading] = useState<CourseContentItem["type"] | null>(null);

  const contentItemsFor = (section: LearningSection): CourseContentItem[] => {
    return section._contentItems ?? buildLearningContentItems(
      section.id,
      section.summary,
      section.video_url,
      section.media_json
    );
  };

  const updateContentItems = (section: LearningSection, items: CourseContentItem[]) => {
    setEditingSection((current) => current?.id === section.id
      ? { ...current, _contentItems: items }
      : current);
  };

  const moveContentItem = (section: LearningSection, index: number, offset: number) => {
    const items = contentItemsFor(section);
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    updateContentItems(section, items);
  };

  const uploadContentFiles = async (
    event: React.ChangeEvent<HTMLInputElement>,
    type: Exclude<CourseContentItem["type"], "text">
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    if (!session) {
      showToast("Sign in as an administrator before uploading module media.", "error");
      return;
    }

    setContentUploading(type);
    try {
      for (const file of files) {
        const folder = type === "image" ? "module-images"
          : type === "audio" ? "module-audio"
            : type === "video" ? "module-videos"
              : "module-pdfs";
        const { url } = await uploadInductionAsset(session, file, folder);
        setEditingSection((current) => {
          if (!current) return current;
          const items = contentItemsFor(current);
          const newItem: CourseContentItem = {
            id: crypto.randomUUID(),
            type,
            title: file.name,
            url,
            ...(type === "image" ? { caption: "" } : {}),
            ...(type === "pdf" ? { requireRead: false } : {})
          };
          return { ...current, _contentItems: [...items, newItem] };
        });
      }
      showToast(`${files.length} ${type} file(s) uploaded. Save the module to publish them to drivers.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not upload ${type} media.`, "error");
    } finally {
      setContentUploading(null);
    }
  };

  const replaceContentFile = async (event: React.ChangeEvent<HTMLInputElement>, item: CourseContentItem) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!session) {
      showToast("Sign in as an administrator before uploading module media.", "error");
      return;
    }

    setContentUploading(item.type);
    try {
      const folder = item.type === "image" ? "module-images"
        : item.type === "audio" ? "module-audio"
          : item.type === "video" ? "module-videos"
            : "module-pdfs";
      const { url } = await uploadInductionAsset(session, file, folder);
      setEditingSection((current) => current
        ? {
            ...current,
            _contentItems: contentItemsFor(current).map((contentItem) =>
              contentItem.id === item.id ? { ...contentItem, url } : contentItem
            )
          }
        : current);
      showToast("Media file replaced. Save the module to publish the change to drivers.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not replace the media file.", "error");
    } finally {
      setContentUploading(null);
    }
  };

  const categoryLabels: Record<string, string> = {
    "Chain of Responsibility": t("cms_cat_cor"),
    "Fatigue Management": t("cms_cat_fatigue"),
    "Load Restraint": t("cms_cat_load"),
    "Speed & Compliance": t("cms_cat_speed"),
    "Vehicle Checks & Defects": t("cms_cat_checks"),
    "Site Safety & Loading Zones": t("cms_cat_site"),
    "Incident Reporting": t("cms_cat_incident"),
    "Mass & Dimension": t("cms_cat_mass"),
    "WHS & PPE": t("cms_cat_whs"),
    "Drug & Alcohol": t("cms_cat_drug"),
    "HVNL Law": t("cms_cat_hvnl"),
    General: t("cms_general")
  };

  const token = session?.accessToken;

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(""), 3500);
  };

  const fetchQuestions = useCallback(async () => {
    // Try Supabase direct — silently fall back to defaults on any error
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("*")
        .order("sort_order", { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        setQuestions(data as unknown as CMSQuizQuestion[]);
      } else {
        setQuestions(DEFAULT_QUESTIONS);
      }
    } catch {
      setQuestions(DEFAULT_QUESTIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSections = useCallback(async () => {
    // Try Supabase direct — silently fall back to defaults on any error
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("learning_sections")
        .select("*")
        .order("sort_order", { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        setSections(data as LearningSection[]);
      } else {
        setSections(DEFAULT_SECTIONS);
      }
    } catch {
      setSections(DEFAULT_SECTIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "quizzes") void fetchQuestions();
    else if (activeTab === "modules") void fetchSections();
    // "versions" tab loads its own data inside InductionVersionsPanel
  }, [activeTab, fetchQuestions, fetchSections]);

  async function saveQuestion(q: CMSQuizQuestion) {
    setSaving(String(q.id));
    try {
      const isNew = String(q.id).startsWith("new-");
      const questionId = isNew ? crypto.randomUUID() : q.id;
      // Existing questions use the backend update route. New questions are
      // inserted through the backend create route.
      let saved = false;
      if (token) {
        try {
          const res = await fetch(`${apiBaseUrl}/admin/cms/questions${isNew ? "" : `/${q.id}`}`, {
            method: isNew ? "POST" : "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              ...(isNew ? { id: questionId, sort_order: q.sort_order } : {}),
              question: q.question,
              options: q.options,
              correct_answer: q.correct_answer,
              explanation: q.explanation,
              category: q.category || "General",
              is_critical: Boolean(q.is_critical)
            })
          });
          if (res.ok) saved = true;
        } catch {
          // fall through to Supabase direct
        }
      }

      if (!saved) {
        const { error } = await supabase
          .from("quiz_questions")
          .upsert({
            id: questionId,
            question: q.question,
            options: q.options,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            sort_order: q.sort_order,
            category: q.category || "General",
            is_critical: Boolean(q.is_critical)
          });
        if (error) throw new Error(error.message);
      }

      setEditingQuestion(null);
      showToast(isNew ? "Quiz question added." : t("cms_question_saved"), "success");
      void fetchQuestions();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("cms_err_save_question"), "error");
    } finally {
      setSaving(null);
    }
  }

  async function deleteQuestion(q: CMSQuizQuestion) {
    if (!window.confirm("Delete this quiz question? This cannot be undone.")) return;
    setSaving(String(q.id));
    try {
      if (String(q.id).startsWith("new-")) {
        setQuestions((current) => current.filter((item) => item.id !== q.id));
        if (editingQuestion?.id === q.id) setEditingQuestion(null);
        return;
      }
      let deleted = false;
      if (token) {
        const response = await fetch(`${apiBaseUrl}/admin/cms/questions/${q.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || "Could not delete the quiz question.");
        }
        deleted = true;
      }
      if (!deleted) {
        const { error } = await supabase.from("quiz_questions").delete().eq("id", q.id);
        if (error) throw new Error(error.message);
      }
      setQuestions((current) => current.filter((item) => item.id !== q.id));
      if (editingQuestion?.id === q.id) setEditingQuestion(null);
      showToast("Quiz question deleted.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Could not delete the quiz question.", "error");
    } finally {
      setSaving(null);
    }
  }

  async function saveSection(s: LearningSection) {
    setSaving(s.id);
    try {
      const isNew = Boolean(s._isNew);
      const contentItems = contentItemsFor(s);
      const legacySummaryId = `legacy-summary-${s.id}`;
      const updatedSummary = contentItems.find((item) => item.id === legacySummaryId)?.text ?? "";
      const hasContent = contentItems.some((item) => item.type === "text"
        ? Boolean(item.text?.trim())
        : Boolean(item.url?.trim()));
      const missingMedia = contentItems.find((item) => item.type !== "text" && !item.url?.trim());
      if (missingMedia) {
        throw new Error(`Add a file or URL for "${missingMedia.title}" or remove that content item.`);
      }
      const videoUrl = contentItems.find((item) => item.type === "video" && item.url)?.url ?? null;
      if (isNew && !hasContent) {
        throw new Error("Add a video, image, audio file, or text content before saving this module.");
      }
      const mediaJson = {
        ...(s.media_json ?? {}),
        contentItems,
        images: [],
        documents: [],
        attachments: [],
        voiceover: undefined,
        videoUrl: undefined,
        audioUrl: undefined
      };

      let saved = false;
      const nextVersion = isNew ? (s.version ?? "1.0") : ((Number.parseFloat(s.version ?? "1.0") + 0.1).toFixed(1));
      if (!isNew && token) {
        try {
          const res = await fetch(`${apiBaseUrl}/admin/cms/sections/${s.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              title: s.title,
              summary: updatedSummary,
              format: s.format,
              video_url: videoUrl,
              media_json: mediaJson,
              video_duration_seconds: s.video_duration_seconds ? Number(s.video_duration_seconds) : 0,
              require_full_watch: Boolean(s.require_full_watch),
              audience: s.audience ?? "all", target_role: s.target_role ?? "driver", is_mandatory: s.is_mandatory !== false, version: nextVersion
            })
          });
          if (res.ok) saved = true;
        } catch {
          // fall through to Supabase direct
        }
      }

      if (!saved && isNew && token) {
        const response = await fetch(`${apiBaseUrl}/admin/cms/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            id: s.id,
            title: s.title,
            summary: updatedSummary,
            format: s.format,
            video_url: videoUrl,
            media_json: mediaJson,
            video_duration_seconds: s.video_duration_seconds ? Number(s.video_duration_seconds) : 0,
            require_full_watch: Boolean(s.require_full_watch),
            audience: s.audience ?? "all", target_role: s.target_role ?? "driver", is_mandatory: s.is_mandatory !== false, version: nextVersion,
            sort_order: s.sort_order
          })
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || "Could not add the safety module.");
        }
        saved = true;
      }

      if (!saved) {
        const payload = {
          ...(isNew ? { id: s.id } : {}),
          title: s.title,
          summary: updatedSummary,
          format: s.format,
          video_url: videoUrl,
          media_json: mediaJson,
          video_duration_seconds: s.video_duration_seconds ? Number(s.video_duration_seconds) : 0,
          require_full_watch: Boolean(s.require_full_watch),
          audience: s.audience ?? "all", target_role: s.target_role ?? "driver", is_mandatory: s.is_mandatory !== false, version: nextVersion,
          sort_order: s.sort_order
        };
        const { error } = await supabase.from("learning_sections")[isNew ? "insert" : "upsert"](payload as any);
        if (error) throw new Error(error.message);
      }

      setEditingSection(null);
      showToast(isNew ? "Safety module added." : t("cms_module_saved"), "success");
      void fetchSections();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("cms_err_save_module"), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="glass" style={{ padding: "32px", marginTop: "24px", borderRadius: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h2 style={{ margin: "0 0 6px 0", fontSize: "1.4rem" }}>{t("cms_title")}</h2>
          <p className="muted" style={{ margin: 0 }}>{t("cms_subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "8px", background: "rgba(148,163,184,0.1)", padding: "4px", borderRadius: "12px" }}>
          {(["modules", "quizzes", "versions", "quarterly", "cor"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 18px", border: "none", borderRadius: "9px", cursor: "pointer", fontWeight: 600,
                background: activeTab === tab ? "var(--color-primary, #1e3a5f)" : "transparent",
                color: activeTab === tab ? "#fff" : "var(--color-muted, #666)"
              }}
            >
              {tab === "modules" ? t("cms_tab_modules") : tab === "quizzes" ? t("cms_tab_quizzes") : tab === "versions" ? t("cms_tab_versions") : tab === "quarterly" ? "Quarterly review" : "COR"}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{
              background: toastType === "success" ? "#22c55e" : "#ef4444",
              color: "#fff", padding: "10px 18px", borderRadius: "10px", marginBottom: "16px", fontWeight: 600
            }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && <p className="muted">{t("cms_loading")}</p>}

      {/* Safety Modules Tab */}
      {activeTab === "modules" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => {
              const maxOrder = sections.reduce((max, section) => Math.max(max, Number(section.sort_order) || 0), 0);
              const newModule: LearningSection = {
                id: crypto.randomUUID(), title: "New Safety Module", format: "Video + Text", summary: "",
                video_url: null, video_duration_seconds: 0, require_full_watch: false,
                media_json: {}, _contentItems: [],
                audience: "all", target_role: "driver", is_mandatory: true, version: "1.0",
                sort_order: maxOrder + 1, _isNew: true
              };
              setSections((current) => [newModule, ...current]);
              setEditingSection(newModule);
            }} style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "9px 15px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "9px", cursor: "pointer", fontWeight: 700 }}>
              <Layers className="w-4 h-4" /> Add Safety Module
            </button>
          </div>
          {sections.map((section) => (
            <div key={section.id} className="glass card-hover" style={{ padding: "20px", borderRadius: "16px" }}>
              {editingSection?.id === section.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)" }}>Module title</label>
                  <input value={editingSection.title} onChange={(e) => setEditingSection({ ...editingSection, title: e.target.value })}
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }} />
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)" }}>{t("cms_format")}</label>
                  <input value={editingSection.format} onChange={(e) => setEditingSection({ ...editingSection, format: e.target.value })}
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
                    <label className="muted">Audience<select value={editingSection.audience ?? "all"} onChange={(e) => setEditingSection({ ...editingSection, audience: e.target.value as LearningSection["audience"] })}><option value="all">Employees and contractors</option><option value="employee">Employees</option><option value="contractor">Contractors</option></select></label>
                    <label className="muted">Staff role<select value={editingSection.target_role ?? "driver"} onChange={(e) => setEditingSection({ ...editingSection, target_role: e.target.value as LearningSection["target_role"] })}><option value="all">All roles</option><option value="driver">Driver / Transport</option><option value="warehouse">Warehouse / Operations</option><option value="office">Office / Administration</option></select></label>
                    <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={editingSection.is_mandatory !== false} onChange={(e) => setEditingSection({ ...editingSection, is_mandatory: e.target.checked })} /> Mandatory</label>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", border: "1px solid #cbd5e1", borderRadius: "10px", padding: "14px" }}>
                    <div>
                      <strong style={{ fontSize: "0.9rem" }}>Ordered module content</strong>
                      <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>Add and arrange text, videos, images, PDFs, and voice-over audio in the exact order shown in the driver training box.</p>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button type="button" disabled={contentUploading !== null} onClick={() => updateContentItems(editingSection, [...contentItemsFor(editingSection), { id: crypto.randomUUID(), type: "text", title: "Text", text: "" }])}
                        style={{ padding: "8px 13px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer", fontWeight: 700 }}>Add text</button>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 13px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "8px", cursor: contentUploading ? "wait" : "pointer", fontSize: "0.85rem", fontWeight: 700 }}>
                        <Image className="w-4 h-4" /> Add images
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                          multiple
                          disabled={contentUploading !== null}
                          style={{ display: "none" }}
                          onChange={(event) => void uploadContentFiles(event, "image")}
                        />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 13px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "8px", cursor: contentUploading ? "wait" : "pointer", fontSize: "0.85rem", fontWeight: 700 }}>
                        <Video className="w-4 h-4" /> Add videos
                        <input type="file" accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv" multiple disabled={contentUploading !== null} style={{ display: "none" }} onChange={(event) => void uploadContentFiles(event, "video")} />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 13px", background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", borderRadius: "8px", cursor: contentUploading ? "wait" : "pointer", fontSize: "0.85rem", fontWeight: 700 }}>
                        <FileText className="w-4 h-4" /> Add PDFs
                        <input type="file" accept="application/pdf,.pdf" multiple disabled={contentUploading !== null} style={{ display: "none" }} onChange={(event) => void uploadContentFiles(event, "pdf")} />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 13px", background: "#f5f3ff", color: "#7e22ce", border: "1px solid #ddd6fe", borderRadius: "8px", cursor: contentUploading ? "wait" : "pointer", fontSize: "0.85rem", fontWeight: 700 }}>
                        <Mic className="w-4 h-4" /> Add voice-over audio
                        <input
                          type="file"
                          accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,.mp3,.m4a,.wav,.webm,.ogg"
                          multiple
                          disabled={contentUploading !== null}
                          style={{ display: "none" }}
                          onChange={(event) => void uploadContentFiles(event, "audio")}
                        />
                      </label>
                      {contentUploading && <span className="muted" role="status">Uploading {contentUploading} files…</span>}
                    </div>
                    {contentItemsFor(editingSection).map((item, index, items) => (
                      <div key={item.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: "10px", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <button type="button" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => moveContentItem(editingSection, index, -1)} style={{ padding: "3px", border: "none", background: "transparent", cursor: index === 0 ? "not-allowed" : "pointer" }}><ArrowUp className="w-4 h-4" /></button>
                          <button type="button" aria-label={`Move ${item.title} down`} disabled={index === items.length - 1} onClick={() => moveContentItem(editingSection, index, 1)} style={{ padding: "3px", border: "none", background: "transparent", cursor: index === items.length - 1 ? "not-allowed" : "pointer" }}><ArrowDown className="w-4 h-4" /></button>
                        </div>
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "capitalize" }}>{index + 1}. {item.type}</div>
                          {item.type !== "text" && (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", alignSelf: "flex-start", padding: "5px 8px", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "7px", cursor: contentUploading ? "wait" : "pointer", fontSize: "0.75rem", fontWeight: 700 }}>
                              Replace file
                              <input
                                type="file"
                                accept={item.type === "image" ? "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                                  : item.type === "audio" ? "audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,.mp3,.m4a,.wav,.webm,.ogg"
                                    : item.type === "video" ? "video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv"
                                      : "application/pdf,.pdf"}
                                disabled={contentUploading !== null}
                                style={{ display: "none" }}
                                onChange={(event) => void replaceContentFile(event, item)}
                              />
                            </label>
                          )}
                          <input aria-label={`Title for ${item.title}`} value={item.title} onChange={(event) => {
                            const updated = [...items];
                            updated[index] = { ...item, title: event.target.value };
                            updateContentItems(editingSection, updated);
                          }} style={{ padding: "7px 9px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }} />
                          {item.type === "text" ? (
                            <textarea aria-label={`Text for ${item.title}`} rows={4} value={item.text ?? ""} onChange={(event) => {
                              const updated = [...items];
                              updated[index] = { ...item, text: event.target.value };
                              updateContentItems(editingSection, updated);
                            }} style={{ padding: "7px 9px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "0.85rem", resize: "vertical" }} />
                          ) : (
                            <input aria-label={`URL for ${item.title}`} placeholder="Paste media URL" value={item.url ?? ""} onChange={(event) => {
                              const updated = [...items];
                              updated[index] = { ...item, url: event.target.value };
                              updateContentItems(editingSection, updated);
                            }} style={{ padding: "7px 9px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }} />
                          )}
                          {item.type === "image" && (
                            <input aria-label={`Caption for ${item.title}`} placeholder="Image caption (optional)" value={item.caption ?? ""} onChange={(event) => {
                              const updated = [...items];
                              updated[index] = { ...item, caption: event.target.value };
                              updateContentItems(editingSection, updated);
                            }} style={{ padding: "7px 9px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }} />
                          )}
                          {item.type === "pdf" && (
                            <label style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.8rem", fontWeight: 600 }}>
                              <input type="checkbox" checked={Boolean(item.requireRead)} onChange={(event) => {
                                const updated = [...items];
                                updated[index] = { ...item, requireRead: event.target.checked };
                                updateContentItems(editingSection, updated);
                              }} />
                              Require driver to confirm PDF is read
                            </label>
                          )}
                        </div>
                        <button type="button" aria-label={`Delete ${item.title}`} onClick={() => updateContentItems(editingSection, items.filter((_, itemIndex) => itemIndex !== index))}
                          style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "7px 9px", color: "#b91c1c", background: "transparent", border: "1px solid #fecaca", borderRadius: "7px", cursor: "pointer" }}>
                          <Trash2 className="w-4 h-4" /> Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)", display: "block" }}>{t("cms_duration")}</label>
                      <input type="number" min="0" value={editingSection.video_duration_seconds ?? 0} onChange={(e) => setEditingSection({ ...editingSection, video_duration_seconds: Number(e.target.value) })}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.9rem", width: "100%" }} />
                    </div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px", marginTop: "18px" }}>
                      <input type="checkbox" id="require_full_watch" checked={Boolean(editingSection.require_full_watch)} onChange={(e) => setEditingSection({ ...editingSection, require_full_watch: e.target.checked })} />
                      <label htmlFor="require_full_watch" style={{ fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>{t("cms_antichat")}</label>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => void saveSection(editingSection)} disabled={saving === section.id || contentUploading !== null}
                      style={{ padding: "8px 20px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}>
                      {saving === section.id ? t("cms_saving") : t("cms_save")}
                    </button>
                    <button disabled={contentUploading !== null} onClick={() => {
                      if (section._isNew) setSections((current) => current.filter((item) => item.id !== section.id));
                      setEditingSection(null);
                    }} style={{ padding: "8px 16px", background: "transparent", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer" }}>
                      {t("cms_cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <strong>{section.title}</strong>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
                      {(() => {
                        try {
                          const parsed = JSON.parse(section.summary);
                          return parsed.intro || t("cms_json_expand");
                        } catch {
                          return section.summary;
                        }
                      })()}
                    </p>
                    {section.video_url && <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#3b82f6" }}>{t("cms_video_attached")}</p>}
                  </div>
                  <button onClick={() => {
                    setEditingSection({ ...section, _contentItems: contentItemsFor(section) });
                  }}
                    style={{ padding: "6px 14px", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap", background: "transparent" }}>
                    {t("cms_edit")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quiz Questions Tab */}
      {activeTab === "quizzes" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => {
              const question: CMSQuizQuestion = {
                id: `new-${crypto.randomUUID()}`, question: "", options: ["", "", "", ""],
                correct_answer: 0, explanation: "", sort_order: questions.reduce((max, item) => Math.max(max, item.sort_order || 0), 0) + 1,
                category: "General", is_critical: false
              };
              setQuestions((current) => [question, ...current]);
              setEditingQuestion(question);
            }} style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "9px 15px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "9px", cursor: "pointer", fontWeight: 700 }}>
              <Plus className="w-4 h-4" /> Add Quiz Question
            </button>
          </div>
          {questions.map((q, idx) => (
            <div key={q.id} className="glass card-hover" style={{ padding: "20px", borderRadius: "16px" }}>
              {editingQuestion && editingQuestion.id === q.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)" }}>{t("cms_question_n", { index: idx + 1 })}</label>
                  <textarea rows={2} value={editingQuestion.question} onChange={(e) => setEditingQuestion({ ...editingQuestion, question: e.target.value })}
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.9rem", resize: "vertical" }} />
                  {editingQuestion.options.map((opt, oi) => (
                    <div key={oi} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="radio" checked={editingQuestion.correct_answer === oi} onChange={() => setEditingQuestion({ ...editingQuestion, correct_answer: oi })} />
                      <input value={opt} onChange={(e) => {
                        const opts = [...editingQuestion.options];
                        opts[oi] = e.target.value;
                        setEditingQuestion({ ...editingQuestion, options: opts });
                      }} style={{ flex: 1, padding: "6px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.88rem" }} />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)" }}>{t("cms_category")}</label>
                      <select
                        value={editingQuestion.category || "General"}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, category: e.target.value })}
                        style={{ width: "100%", padding: "6px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.88rem" }}
                      >
                        {["Chain of Responsibility", "Fatigue Management", "Load Restraint", "Speed & Compliance", "Vehicle Checks & Defects", "Site Safety & Loading Zones", "Incident Reporting", "Mass & Dimension", "WHS & PPE", "Drug & Alcohol", "HVNL Law", "General"].map((cat) => (
                          <option key={cat} value={cat}>{categoryLabels[cat] ?? cat}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "18px" }}>
                      <input
                        type="checkbox"
                        id={`critical-${q.id}`}
                        checked={Boolean(editingQuestion.is_critical)}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, is_critical: e.target.checked })}
                      />
                      <label htmlFor={`critical-${q.id}`} style={{ fontSize: "0.85rem", fontWeight: 600, color: "#dc2626", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <AlertTriangle className="w-3.5 h-3.5" /> {t("cms_critical")}
                      </label>
                    </div>
                  </div>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-muted)" }}>{t("cms_explanation")}</label>
                  <textarea rows={2} value={editingQuestion.explanation} onChange={(e) => setEditingQuestion({ ...editingQuestion, explanation: e.target.value })}
                    style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "0.9rem", resize: "vertical" }} />
                  <p style={{ fontSize: "0.78rem", color: "var(--color-muted)", margin: 0 }}>{t("cms_correct_hint")}</p>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => editingQuestion && void saveQuestion(editingQuestion)} disabled={saving === String(q.id)}
                      style={{ padding: "8px 20px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}>
                      {saving === q.id ? t("cms_saving") : t("cms_save_question")}
                    </button>
                    <button onClick={() => {
                      if (String(q.id).startsWith("new-")) setQuestions((current) => current.filter((item) => item.id !== q.id));
                      setEditingQuestion(null);
                    }} style={{ padding: "8px 16px", background: "transparent", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer" }}>
                      {t("cms_cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                      <small className="muted">Q{idx + 1}</small>
                      <span className="badge badge--archived" style={{ fontSize: "0.75rem", padding: "2px 8px" }}>{categoryLabels[q.category || "General"] ?? t("cms_general")}</span>
                      {q.is_critical && (
                        <span className="badge alert--error" style={{ fontSize: "0.75rem", padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <AlertTriangle className="w-3 h-3" /> {t("cms_critical_badge")}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "4px 0 6px", fontWeight: 600 }}>{q.question}</p>
                    <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>{t("cms_correct_prefix")}{q.options[q.correct_answer ?? 0]}</p>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button onClick={() => setEditingQuestion({ ...q })}
                      style={{ padding: "6px 14px", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap", background: "transparent" }}>
                      {t("cms_edit")}
                    </button>
                    <button type="button" onClick={() => void deleteQuestion(q)} disabled={saving === String(q.id)} aria-label="Delete quiz question"
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "7px", color: "#b91c1c", background: "transparent", border: "1px solid #fecaca", borderRadius: "8px", cursor: saving === String(q.id) ? "wait" : "pointer" }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Induction Versions Tab */}
      {activeTab === "versions" && session && (
        <InductionVersionsPanel session={session} />
      )}
      {activeTab === "quarterly" && session && (
        <QuarterlyComplianceReviews session={session} />
      )}
      {activeTab === "cor" && session && <CORAdmin session={session} />}
    </div>
  );
}
