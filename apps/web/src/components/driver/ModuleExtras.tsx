import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Image as ImageIcon,
  FileText,
  Volume2,
  Play,
  Pause,
  Lock,
  Unlock,
  CheckCircle2,
  HelpCircle,
  Paperclip,
  Clock
} from "lucide-react";
import { CourseContentItem, LearningSectionProgress, SlideExtras, SlideQuestion } from "../../types";
import { api } from "../../lib/api";
import { useAppState } from "../../state/AppContext";
import { VideoPlayer } from "../VideoPlayer";

interface ModuleExtrasProps {
  module: LearningSectionProgress;
  onSatisfied: () => Promise<void> | void;
  disabled?: boolean;
  driverId?: string;
  onModuleStart?: () => Promise<void>;
  onVideoPositionUpdate?: (seconds: number) => void;
  onVideoDurationChange?: (seconds: number) => void;
}

const TEXT_SIZE_MAP: Record<string, string> = {
  small: "0.88rem",
  regular: "1rem",
  large: "1.12rem",
  xlarge: "1.35rem",
  headline: "1.6rem"
};

function isQuestionCorrect(q: SlideQuestion, answer: unknown): boolean {
  const type = q.questionType ?? "single_choice";

  if (type === "text_input") {
    const text = typeof answer === "string" ? answer.trim().toLowerCase() : "";
    if (!text) return false;
    const accepted = (q.acceptedAnswers ?? []).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
    if (accepted.length === 0) return true; // no configured answers: any response counts
    return accepted.includes(text);
  }

  if (type === "multiple_choice") {
    const selected = Array.isArray(answer) ? answer : [];
    const expected = (q.correctAnswers ?? []).map(Number);
    if (expected.length === 0) return false;
    if (selected.length !== expected.length) return false;
    const normalised = new Set(selected.map(Number));
    return expected.every((v) => normalised.has(v));
  }

  return Number(answer) === Number(q.correctAnswer ?? 0);
}

/**
 * Renders optional module media and ordered course content through the
 * existing completion channel used by Step 3.
 */
export function ModuleExtras({
  module,
  onSatisfied,
  disabled = false,
  driverId,
  onModuleStart,
  onVideoPositionUpdate,
  onVideoDurationChange
}: ModuleExtrasProps) {
  const { t } = useTranslation();
  const { session } = useAppState();
  const media = (module.mediaJson ?? null) as SlideExtras | null;
  const contentItems = media?.contentItems ?? [];
  const hasOrderedContent = Array.isArray(media?.contentItems) && media.contentItems.length > 0;

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [readDocs, setReadDocs] = useState<Record<string, boolean>>({});
  const [contentIndex, setContentIndex] = useState(0);
  const [viewedContent, setViewedContent] = useState<Record<string, boolean>>({});
  const [assetStatus, setAssetStatus] = useState<{ key: string; status: "loading" | "loaded" | "error" }>({ key: "", status: "loading" });
  const [assetRetry, setAssetRetry] = useState(0);
  const [moduleStarted, setModuleStarted] = useState(!hasOrderedContent || contentItems.length === 0 || module.completed || !onModuleStart);
  const [moduleStartError, setModuleStartError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [savedTextAnswers, setSavedTextAnswers] = useState<Record<string, string>>({});
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [answerSaveError, setAnswerSaveError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const moduleStartRef = useRef(onModuleStart);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const firedRef = useRef(false);

  const waitSeconds = Number(media?.forcedWaitSeconds ?? 0) || 0;
  const documents = media?.documents ?? [];
  const requiredDocs = documents.filter((d) => d.requireRead);
  const questions = media?.questions ?? [];
  const inlineQuestions = questions.filter((q) => q.placement !== "separate_page");
  const separatePageQuestions = questions.filter((q) => q.placement === "separate_page");
  const textQuestions = questions.filter((q) => (q.questionType ?? q.question_type) === "text_input");
  const [separateQuestionIndex, setSeparateQuestionIndex] = useState(0);
  const images = media?.images ?? [];
  const attachments = media?.attachments ?? [];
  const currentContentItem = contentItems[contentIndex];
  const requiredContentPdfs = contentItems.filter((item) => item.type === "pdf" && item.requireRead);
  const currentAssetKey = currentContentItem ? `${currentContentItem.id}:${currentContentItem.url ?? ""}` : "";
  const currentAssetStatus = currentContentItem?.type === "text"
    ? "loaded"
    : assetStatus.key === currentAssetKey
      ? assetStatus.status
      : "loading";

  // Only auto-complete when this slide actually imposes a requirement.
  const shouldGate = waitSeconds > 0 || requiredDocs.length > 0 || requiredContentPdfs.length > 0 || questions.length > 0 || (hasOrderedContent && contentItems.length > 0);

  const dwellDone = waitSeconds === 0 || secondsLeft <= 0;
  const docsDone = requiredDocs.every((d, i) => readDocs[`${d.url}-${i}`]);
  const questionsDone = questions.length === 0
    ? true
    : questions.every((q) =>
      q.id in answers &&
      isQuestionCorrect(q, answers[q.id]) &&
      ((q.questionType ?? q.question_type) !== "text_input" || savedTextAnswers[q.id] === String(answers[q.id] ?? ""))
    );

  const contentPdfsDone = requiredContentPdfs.every((item) => readDocs[`content-${item.id}`]);
  const contentDone = !hasOrderedContent || contentItems.every((item) => viewedContent[item.id]);
  const satisfied = dwellDone && docsDone && contentPdfsDone && questionsDone && contentDone;

  useEffect(() => {
    moduleStartRef.current = onModuleStart;
  }, [onModuleStart]);

  const startOrderedModule = async () => {
    try {
      await moduleStartRef.current?.();
      setModuleStarted(true);
      setModuleStartError(null);
    } catch (error) {
      setModuleStarted(false);
      setModuleStartError(error instanceof Error ? error.message : "Could not start this training topic.");
    }
  };

  // Reset per-module state when the driver switches slides.
  useEffect(() => {
    firedRef.current = false;
    setSecondsLeft(waitSeconds);
    setReadDocs({});
    setContentIndex(0);
    setViewedContent({});
    setAssetStatus({ key: "", status: "loading" });
    setAssetRetry(0);
    setModuleStarted(!hasOrderedContent || contentItems.length === 0 || module.completed || !moduleStartRef.current);
    setModuleStartError(null);
    const initialTextAnswers = module.savedTextAnswers ?? {};
    setAnswers(initialTextAnswers);
    setSavedTextAnswers(initialTextAnswers);
    setSeparateQuestionIndex(0);
    setAnswerSaveError(null);
    setSavingAnswer(false);
    setIsPlaying(false);
    audioRef.current?.pause();
    if (hasOrderedContent && contentItems.length > 0 && !module.completed && moduleStartRef.current) {
      setModuleStarted(false);
      void startOrderedModule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.sectionId, hasOrderedContent, contentItems.length]);

  const saveTextAnswer = async (questionId: string, response: string) => {
    setSavingAnswer(true);
    setAnswerSaveError(null);
    try {
      await api.saveLearningQuestionResponse(session, module.sectionId, questionId, response);
      setSavedTextAnswers((previous) => ({ ...previous, [questionId]: response }));
    } catch (error) {
      setAnswerSaveError(error instanceof Error ? error.message : "Your answer could not be saved.");
    } finally {
      setSavingAnswer(false);
    }
  };

  // Countdown for the forced-wait lock.
  useEffect(() => {
    if (waitSeconds <= 0 || secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds, secondsLeft]);

  // Fire completion exactly once, through the same channel the video uses.
  useEffect(() => {
    if (!shouldGate || !satisfied || module.completed || disabled) return;
    if (firedRef.current) return;
    firedRef.current = true;
    void Promise.resolve(onSatisfied()).catch(() => {
      firedRef.current = false;
    });
  }, [shouldGate, satisfied, module.completed, disabled, onSatisfied]);

  const toggleAudio = () => {
    if (!audioRef.current && media?.voiceover?.url) {
      audioRef.current = new Audio(media.voiceover.url);
      audioRef.current.ontimeupdate = () => {
        if (!audioRef.current) return;
        setAudioProgress(audioRef.current.currentTime);
      };
      audioRef.current.onended = () => setIsPlaying(false);
      setAudioDuration(audioRef.current.duration || 0);
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const isCurrentContentReady = () => {
    if (!currentContentItem || secondsLeft > 0 || !moduleStarted) return false;
    if (currentContentItem.type === "video" && !viewedContent[currentContentItem.id]) return false;
    if (currentContentItem.type === "pdf" && currentContentItem.requireRead && !readDocs[`content-${currentContentItem.id}`]) return false;
    return true;
  };

  const handleContentNext = () => {
    if (!currentContentItem || !isCurrentContentReady()) return;
    setViewedContent((previous) => ({ ...previous, [currentContentItem.id]: true }));
    setContentIndex((index) => Math.min(contentItems.length - 1, index + 1));
  };

  const contentPositionKey = (item: CourseContentItem) =>
    `bnt-module-pos-${driverId ?? "driver"}-${module.sectionId}-${item.id}`;

  const savedContentPosition = (item: CourseContentItem) => {
    if (!driverId || typeof window === "undefined") return 0;
    try {
      const currentPosition = window.localStorage.getItem(contentPositionKey(item));
      const isSectionVideo = item.type === "video" && (item.id === `legacy-video-${module.sectionId}` || item.id === `section-video-${module.sectionId}`);
      const legacyVideoPosition = isSectionVideo
        ? window.localStorage.getItem(`bnt-module-pos-${driverId}-${module.sectionId}`)
        : null;
      const previousSequencePosition = isSectionVideo
        ? window.localStorage.getItem(`bnt-module-pos-${driverId}-${module.sectionId}-section-video-${module.sectionId}`)
        : null;
      const position = Number(currentPosition || legacyVideoPosition || previousSequencePosition);
      return Number.isFinite(position) && position > 0 ? position : 0;
    } catch {
      return 0;
    }
  };

  const setCurrentAssetStatus = (status: "loading" | "loaded" | "error") => {
    setAssetStatus({ key: currentAssetKey, status });
  };

  const hasAnyContent =
    Boolean(media?.warning) ||
    contentItems.length > 0 ||
    images.length > 0 ||
    documents.length > 0 ||
    Boolean(media?.voiceover?.url) ||
    questions.length > 0 ||
    waitSeconds > 0 ||
    attachments.length > 0;

  const textSize = media?.textSize ? TEXT_SIZE_MAP[media.textSize] : undefined;

  if (!media || !hasAnyContent) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
      {/* Warning callout */}
      {media.warning && (
        <div
          style={{
            background: "rgba(239,68,68,.09)",
            border: "1px solid rgba(239,68,68,.4)",
            borderLeft: "4px solid #ef4444",
            borderRadius: "11px",
            padding: "13px 16px",
            display: "flex",
            gap: "10px",
            alignItems: "flex-start"
          }}
        >
          <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
          <strong style={{ fontSize: textSize ?? "0.88rem", fontWeight: 700, color: "#fca5a5", lineHeight: 1.5 }}>
            {media.warning}
          </strong>
        </div>
      )}

      {/* Forced-wait lock */}
      {waitSeconds > 0 && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "9px",
            alignSelf: "flex-start",
            padding: "7px 13px",
            borderRadius: "999px",
            fontSize: "0.76rem",
            fontWeight: 800,
            background: secondsLeft > 0 ? "rgba(249,115,22,.13)" : "rgba(22,163,74,.13)",
            border: `1px solid ${secondsLeft > 0 ? "rgba(249,115,22,.35)" : "rgba(22,163,74,.4)"}`,
            color: secondsLeft > 0 ? "#fdba74" : "#6ee7b7"
          }}
        >
          {secondsLeft > 0 ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          {secondsLeft > 0
            ? t("mx_locked", { seconds: secondsLeft })
            : t("mx_unlocked")}
        </div>
      )}

      {hasOrderedContent && currentContentItem && (
        <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div>
              <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Topic content {contentIndex + 1} of {contentItems.length}
              </div>
              <h5 style={{ margin: "4px 0 0", fontSize: "1rem", fontWeight: 800 }}>
                {currentContentItem.title || currentContentItem.type}
              </h5>
            </div>
            <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#2563eb", textTransform: "capitalize" }}>
              {currentContentItem.type === "pdf" ? "PDF document" : currentContentItem.type === "audio" ? "Voice-over" : currentContentItem.type}
            </span>
          </div>

          {currentContentItem.type === "text" && (
            <div style={{ whiteSpace: "pre-wrap", fontSize: textSize ?? "1rem", lineHeight: 1.65, fontWeight: 600 }}>
              {currentContentItem.text}
            </div>
          )}
          {currentContentItem.type === "video" && currentContentItem.url && (
            <VideoPlayer
              key={currentContentItem.id}
              src={currentContentItem.url}
              savedPosition={savedContentPosition(currentContentItem)}
              requireFullWatch={module.isMandatory !== false || Boolean(module.requireFullWatch)}
              onStart={() => void startOrderedModule()}
              onComplete={() => setViewedContent((previous) => ({ ...previous, [currentContentItem.id]: true }))}
              onPositionUpdate={(seconds) => {
                if (driverId && typeof window !== "undefined") {
                  try {
                    window.localStorage.setItem(contentPositionKey(currentContentItem), String(Math.floor(seconds)));
                  } catch {}
                }
                onVideoPositionUpdate?.(seconds);
              }}
              onDurationChange={onVideoDurationChange}
            />
          )}
          {currentContentItem.type === "image" && currentContentItem.url && (
            <>
              {currentAssetStatus === "loading" && <p role="status" className="muted">Loading image…</p>}
              {currentAssetStatus === "error" && <p role="alert" style={{ color: "#dc2626", fontWeight: 700 }}>This image could not be loaded. Check the uploaded file or URL.</p>}
              {currentAssetStatus === "error" && (
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <a href={currentContentItem.url} target="_blank" rel="noopener noreferrer">Open image</a>
                  <button type="button" onClick={() => { setCurrentAssetStatus("loading"); setAssetRetry((retry) => retry + 1); }}>Retry image</button>
                </div>
              )}
              <figure style={{ margin: 0, display: currentAssetStatus === "error" ? "none" : undefined }}>
                <img
                  key={`${currentAssetKey}:${assetRetry}`}
                  src={currentContentItem.url}
                  alt={currentContentItem.title || currentContentItem.caption || "Training image"}
                  onLoad={() => setCurrentAssetStatus("loaded")}
                  onError={() => setCurrentAssetStatus("error")}
                  style={{ display: "block", maxWidth: "100%", maxHeight: "520px", margin: "0 auto", objectFit: "contain", borderRadius: "8px" }}
                />
                {currentContentItem.caption && <figcaption className="muted" style={{ paddingTop: "8px", fontSize: "0.8rem" }}>{currentContentItem.caption}</figcaption>}
              </figure>
            </>
          )}
          {currentContentItem.type === "pdf" && currentContentItem.url && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {currentAssetStatus === "loading" && <p role="status" className="muted">Loading PDF preview…</p>}
              {currentAssetStatus === "error" && <p role="alert" style={{ color: "#dc2626", fontWeight: 700 }}>The PDF preview could not be loaded. Open or download the file below to view it.</p>}
              <iframe
                key={`${currentAssetKey}:${assetRetry}`}
                src={currentContentItem.url}
                title={currentContentItem.title || "Training PDF"}
                onLoad={() => setCurrentAssetStatus("loaded")}
                onError={() => setCurrentAssetStatus("error")}
                style={{ width: "100%", height: "min(65vh, 620px)", border: "none", borderRadius: "8px", background: "#fff", display: currentAssetStatus === "error" ? "none" : undefined }}
              />
              <a href={currentContentItem.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start", color: "#2563eb", fontWeight: 700, fontSize: "0.8rem" }}>
                Open or download PDF
              </a>
              {currentAssetStatus === "error" && <button type="button" onClick={() => { setCurrentAssetStatus("loading"); setAssetRetry((retry) => retry + 1); }}>Retry PDF preview</button>}
              {currentContentItem.requireRead && (
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(readDocs[`content-${currentContentItem.id}`])}
                    onChange={(event) => setReadDocs((previous) => ({ ...previous, [`content-${currentContentItem.id}`]: event.target.checked }))}
                  />
                  I have read this document
                </label>
              )}
            </div>
          )}
          {currentContentItem.type === "audio" && currentContentItem.url && (
            <>
              {currentAssetStatus === "loading" && <p role="status" className="muted">Loading audio…</p>}
              {currentAssetStatus === "error" && <p role="alert" style={{ color: "#dc2626", fontWeight: 700 }}>This audio could not be loaded. Check the uploaded file or URL.</p>}
              <audio
                key={`${currentAssetKey}:${assetRetry}`}
                src={currentContentItem.url}
                controls
                preload="metadata"
                onCanPlay={() => setCurrentAssetStatus("loaded")}
                onError={() => setCurrentAssetStatus("error")}
                style={{ width: "100%" }}
              >
                Your browser does not support audio playback.
              </audio>
              {currentAssetStatus === "error" && <button type="button" onClick={() => { setCurrentAssetStatus("loading"); setAssetRetry((retry) => retry + 1); }}>Retry audio</button>}
            </>
          )}
          {currentContentItem.type !== "text" && !currentContentItem.url && (
            <p role="alert" style={{ color: "#dc2626", fontWeight: 700 }}>
              This {currentContentItem.type === "pdf" ? "PDF" : currentContentItem.type} is missing its file URL. Contact your administrator to repair this topic.
            </p>
          )}
          {moduleStartError && (
            <div role="alert" style={{ color: "#dc2626", fontSize: "0.8rem", fontWeight: 700 }}>
              {moduleStartError} <button type="button" onClick={() => void startOrderedModule()}>Retry</button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
            <button type="button" disabled={contentIndex === 0} onClick={() => setContentIndex((index) => Math.max(0, index - 1))}>
              Previous
            </button>
            <button type="button" disabled={disabled || !isCurrentContentReady()} onClick={handleContentNext}>
              {contentIndex === contentItems.length - 1 ? "Finish topic" : "Next"}
            </button>
          </div>
        </section>
      )}

      {/* Audio voiceover */}
      {!hasOrderedContent && media.voiceover?.url && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "13px",
            background: "rgba(168,85,247,.09)",
            border: "1px solid rgba(168,85,247,.32)",
            borderRadius: "11px",
            padding: "12px 15px"
          }}
        >
          <button
            type="button"
            onClick={toggleAudio}
            aria-label="Play voiceover"
            style={{
              width: "36px", height: "36px", borderRadius: "50%", border: "none",
              background: "#9333ea", color: "#fff", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.8rem", fontWeight: 700, marginBottom: "6px" }}>
              <Volume2 className="w-3.5 h-3.5" style={{ color: "#c084fc" }} />
              {t("mx_voiceover")}
            </div>
            <div style={{ height: "5px", borderRadius: "99px", background: "rgba(148,163,184,.25)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  background: "#9333ea",
                  width: audioDuration > 0 ? `${Math.min(100, (audioProgress / audioDuration) * 100)}%` : "0%",
                  transition: "width .25s linear"
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Images */}
      {!hasOrderedContent && images.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.76rem", fontWeight: 800, color: "var(--color-muted)", marginBottom: "9px" }}>
            <ImageIcon className="w-3.5 h-3.5" /> {t("mx_images")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
            {images.map((img, i) => (
              <figure key={`${img.url}-${i}`} style={{ margin: 0, borderRadius: "11px", overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg-elevated, rgba(255,255,255,.03))" }}>
                <img
                  src={img.url}
                  alt={img.alt || img.caption || "Slide image"}
                  style={{ width: "100%", height: "130px", objectFit: "cover", display: "block" }}
                />
                {img.caption && (
                  <figcaption className="muted" style={{ padding: "8px 10px", fontSize: "0.73rem" }}>{img.caption}</figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      {!hasOrderedContent && documents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {documents.map((doc, i) => {
            const key = `${doc.url}-${i}`;
            const acked = Boolean(readDocs[key]);
            return (
              <div key={key} style={{ border: "1px solid var(--border)", borderRadius: "11px", overflow: "hidden", background: "var(--bg-elevated, rgba(255,255,255,.03))" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", fontWeight: 700, minWidth: 0 }}>
                    <FileText className="w-3.5 h-3.5" style={{ color: "#fdba74", flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name ?? t("mx_document")}</span>
                  </div>
                  {doc.pages ? <span className="muted" style={{ fontSize: "0.73rem", whiteSpace: "nowrap" }}>{t("mx_pages", { pages: doc.pages })}</span> : null}
                </div>
                <iframe
                  src={doc.url}
                  title={doc.name ?? "Document"}
                  style={{ width: "100%", height: "220px", border: "none", display: "block", background: "#fff" }}
                />
                {doc.requireRead && (
                  <label style={{ display: "flex", alignItems: "center", gap: "9px", padding: "11px 14px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={acked}
                      onChange={(e) => setReadDocs((prev) => ({ ...prev, [key]: e.target.checked }))}
                      style={{ width: "17px", height: "17px", accentColor: "#16a34a" }}
                    />
                    {t("mx_read_ack")}
                    {acked ? <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} /> : null}
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Inline knowledge checks */}
      {inlineQuestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.76rem", fontWeight: 800, color: "var(--color-muted)" }}>
            <HelpCircle className="w-3.5 h-3.5" /> {t("mx_checks")}
          </div>
          {inlineQuestions.map((q) => (
            <InlineQuestion
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(val) => {
                setAnswers((prev) => ({ ...prev, [q.id]: val }));
                setAnswerSaveError(null);
              }}
              onSaveTextAnswer={textQuestions.some((item) => item.id === q.id)
                ? (value) => void saveTextAnswer(q.id, value)
                : undefined}
            />
          ))}
        </div>
      )}

      {separatePageQuestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", border: "1px solid rgba(37,99,235,.25)", borderRadius: "12px", padding: "16px", background: "rgba(37,99,235,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "0.82rem", fontWeight: 800, color: "#2563eb" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}><HelpCircle className="w-4 h-4" /> Lesson question page</span>
            <span>{separateQuestionIndex + 1} / {separatePageQuestions.length}</span>
          </div>
          {(() => {
            const q = separatePageQuestions[separateQuestionIndex];
            if (!q) return null;
            return (
              <InlineQuestion
                question={q}
                value={answers[q.id]}
                onChange={(val) => {
                  setAnswers((prev) => ({ ...prev, [q.id]: val }));
                  setAnswerSaveError(null);
                }}
                onSaveTextAnswer={(q.questionType ?? q.question_type) === "text_input"
                  ? (value) => void saveTextAnswer(q.id, value)
                  : undefined}
              />
            );
          })()}
          {separatePageQuestions.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button type="button" disabled={separateQuestionIndex === 0} onClick={() => setSeparateQuestionIndex((index) => Math.max(0, index - 1))}>Previous question</button>
              <button type="button" disabled={separateQuestionIndex >= separatePageQuestions.length - 1} onClick={() => setSeparateQuestionIndex((index) => Math.min(separatePageQuestions.length - 1, index + 1))}>Next question</button>
            </div>
          )}
        </div>
      )}

      {textQuestions.length > 0 && (
        <p role={answerSaveError ? "alert" : "status"} style={{ margin: 0, fontSize: "0.78rem", color: answerSaveError ? "#dc2626" : "#64748b" }}>
          {answerSaveError ?? (savingAnswer ? "Saving answer…" : "Text answers are saved to your driver profile when you leave the answer field.")}
        </p>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {attachments.map((file, i) => (
            <a
              key={`${file.url}-${i}`}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "7px",
                padding: "8px 13px", borderRadius: "9px", fontSize: "0.78rem", fontWeight: 700,
                border: "1px solid var(--border)", color: "var(--text)", textDecoration: "none"
              }}
            >
              <Paperclip className="w-3.5 h-3.5" /> {file.name ?? t("mx_attachment")}
            </a>
          ))}
        </div>
      )}

      {/* Progress hint while gated */}
      {shouldGate && !module.completed && (
        <div className="muted" style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "0.75rem", fontWeight: 700 }}>
          <Clock className="w-3.5 h-3.5" />
          {satisfied ? t("mx_requirements_met") : t("mx_requirements_pending")}
        </div>
      )}
    </div>
  );
}

interface InlineQuestionProps {
  question: SlideQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onSaveTextAnswer?: (value: string) => void;
}

function InlineQuestion({ question, value, onChange, onSaveTextAnswer }: InlineQuestionProps) {
  const { t } = useTranslation();
  const type = question.questionType ?? "single_choice";
  const options = question.options ?? [];

  const answered =
    value === undefined || value === null
      ? false
      : type === "text_input"
        ? String(value).trim().length > 0
        : type === "multiple_choice"
          ? Array.isArray(value) && value.length > 0
          : true;

  const isCorrect = answered && isQuestionCorrect(question, value);
  const attempted = answered && !isCorrect;

  const selectedList = Array.isArray(value) ? (value as number[]) : [];
  const expected = (question.correctAnswers ?? []).map(Number);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "11px", padding: "15px", background: "var(--bg-elevated, rgba(255,255,255,.03))" }}>
      <strong style={{ display: "block", fontSize: "0.88rem", marginBottom: "11px" }}>{question.prompt || question.question}</strong>

      {type === "text_input" ? (
        <>
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => onSaveTextAnswer?.(e.currentTarget.value)}
            placeholder={t("mx_type_answer")}
            style={{
              width: "100%", padding: "10px 13px", borderRadius: "9px",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--text)", fontSize: "0.86rem"
            }}
          />
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {options.map((opt, idx) => {
            const isSelected = type === "multiple_choice" ? selectedList.includes(idx) : Number(value) === idx;
            const isExpected = type === "multiple_choice" ? expected.includes(idx) : Number(question.correctAnswer ?? 0) === idx;
            const reveal = attempted || isCorrect;

            let style: React.CSSProperties = {
              display: "flex", alignItems: "center", gap: "9px",
              padding: "8px 11px", borderRadius: "9px", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 600,
              border: "1px solid transparent", background: "transparent"
            };
            if (isSelected) style = { ...style, background: "rgba(37,99,235,.1)", borderColor: "rgba(37,99,235,.4)" };
            if (reveal && isExpected) style = { ...style, background: "rgba(22,163,74,.13)", borderColor: "rgba(22,163,74,.4)", color: "#86efac" };
            if (reveal && isSelected && !isExpected) style = { ...style, background: "rgba(239,68,68,.13)", borderColor: "rgba(239,68,68,.4)", color: "#fca5a5" };

            return (
              <label key={idx} style={style}>
                <input
                  type={type === "multiple_choice" ? "checkbox" : "radio"}
                  name={`mx-q-${question.id}`}
                  checked={isSelected}
                  onChange={() => {
                    if (type === "multiple_choice") {
                      const next = selectedList.includes(idx)
                        ? selectedList.filter((v) => v !== idx)
                        : [...selectedList, idx];
                      onChange(next);
                    } else {
                      onChange(idx);
                    }
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      )}

      {attempted && question.explanation && (
        <div
          style={{
            marginTop: "11px", padding: "10px 13px", borderRadius: "9px",
            fontSize: "0.79rem", fontWeight: 600,
            background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)", color: "#fbbf24"
          }}
        >
          {question.explanation}
        </div>
      )}

      {attempted && !question.explanation && (
        <div className="muted" style={{ marginTop: "11px", fontSize: "0.78rem", fontWeight: 600 }}>
          {t("mx_try_again")}
        </div>
      )}
    </div>
  );
}

export default ModuleExtras;
