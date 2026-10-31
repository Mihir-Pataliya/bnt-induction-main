import { CourseContentItem } from "../types";

type LegacyLearningMedia = {
  contentItems?: unknown;
  images?: Array<{ url: string; caption?: string; alt?: string }>;
  documents?: Array<{ url: string; title?: string; name?: string; requireRead?: boolean }>;
  attachments?: Array<{ url: string; name?: string }>;
  voiceover?: { url: string };
  videoUrl?: string;
  audioUrl?: string;
  [key: string]: unknown;
};

function isContentItem(value: unknown): value is CourseContentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CourseContentItem>;
  return typeof item.id === "string" &&
    typeof item.title === "string" &&
    ["text", "video", "image", "pdf", "audio"].includes(item.type ?? "");
}

function summaryText(summary: string): string {
  if (!summary) return "";
  try {
    const parsed = JSON.parse(summary) as { intro?: unknown; bullets?: unknown; scenario?: unknown };
    const sections = [
      typeof parsed.intro === "string" ? parsed.intro.trim() : "",
      Array.isArray(parsed.bullets) ? parsed.bullets.filter((bullet): bullet is string => typeof bullet === "string").map((bullet) => `- ${bullet}`).join("\n") : "",
      typeof parsed.scenario === "string" && parsed.scenario.trim() ? `Scenario: ${parsed.scenario.trim()}` : ""
    ].filter(Boolean);
    return sections.join("\n\n");
  } catch {
    return summary.trim();
  }
}

export function buildLearningContentItems(
  sectionId: string,
  summary: string,
  videoUrl: string | null | undefined,
  mediaValue: unknown,
  fallbackVideoUrl?: string
): CourseContentItem[] {
  const media = mediaValue && typeof mediaValue === "object" && !Array.isArray(mediaValue)
    ? mediaValue as LegacyLearningMedia
    : {};
  const contentItems = Array.isArray(media.contentItems) ? media.contentItems.filter(isContentItem) : [];
  const items: CourseContentItem[] = [...contentItems];
  const text = summaryText(summary);
  const summaryId = `legacy-summary-${sectionId}`;
  if (text && !items.some((item) => item.id === summaryId)) {
    items.unshift({ id: summaryId, type: "text", title: "Module text", text });
  }

  const resolvedVideoUrl = videoUrl || media.videoUrl || (!items.some((item) => item.type === "video") ? fallbackVideoUrl : undefined);
  if (resolvedVideoUrl && !items.some((item) => item.type === "video" && item.url === resolvedVideoUrl)) {
    items.splice(text ? 1 : 0, 0, {
      id: `legacy-video-${sectionId}`,
      type: "video",
      title: "Training video",
      url: resolvedVideoUrl
    });
  }

  for (const [index, image] of (Array.isArray(media.images) ? media.images : []).entries()) {
    if (!image?.url || items.some((item) => item.type === "image" && item.url === image.url)) continue;
    items.push({
      id: `legacy-image-${sectionId}-${index}`,
      type: "image",
      title: image.alt || image.caption || `Training image ${index + 1}`,
      url: image.url,
      caption: image.caption
    });
  }

  for (const [index, document] of (Array.isArray(media.documents) ? media.documents : []).entries()) {
    if (!document?.url || items.some((item) => item.type === "pdf" && item.url === document.url)) continue;
    items.push({
      id: `legacy-pdf-${sectionId}-${index}`,
      type: "pdf",
      title: document.title || document.name || `Training PDF ${index + 1}`,
      url: document.url,
      requireRead: Boolean(document.requireRead)
    });
  }

  for (const [index, attachment] of (Array.isArray(media.attachments) ? media.attachments : []).entries()) {
    if (!attachment?.url || items.some((item) => item.url === attachment.url)) continue;
    items.push({
      id: `legacy-attachment-${sectionId}-${index}`,
      type: "pdf",
      title: attachment.name || `Training document ${index + 1}`,
      url: attachment.url
    });
  }

  const audioUrl = media.voiceover?.url || media.audioUrl;
  if (audioUrl && !items.some((item) => item.type === "audio" && item.url === audioUrl)) {
    items.push({
      id: `legacy-audio-${sectionId}`,
      type: "audio",
      title: "Voice-over",
      url: audioUrl
    });
  }

  return items;
}
