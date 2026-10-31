const CONTENT_TYPES = new Set(["text", "video", "image", "pdf", "audio"]);
const CONTENT_TYPE_ALIASES = {
  document: "pdf",
  voiceover: "audio",
  voice_over: "audio",
  "voice-over": "audio"
};

function createItem(type, title, fields = {}, index = 0) {
  return {
    id: `legacy-${type}-${index + 1}`,
    type,
    title,
    ...fields
  };
}

export function normalizeCourseContentItems(slide) {
  const content = slide?.content_json ?? {};
  const savedItems = content.contentItems ?? content.content_items;
  if (Array.isArray(savedItems) && savedItems.length > 0) {
    return savedItems
      .map((item, index) => {
        const rawType = String(item?.type ?? item?.kind ?? item?.contentType ?? "").toLowerCase();
        const type = CONTENT_TYPE_ALIASES[rawType] ?? rawType;
        const url = item?.url ?? item?.fileUrl ?? item?.file_url ?? item?.videoUrl ?? item?.audioUrl;
        const text = item?.text ?? item?.body ?? item?.content;
        return {
          id: String(item?.id ?? `content-${index + 1}`),
          type,
          title: String(item?.title ?? item?.name ?? ""),
          ...(typeof text === "string" ? { text } : {}),
          ...(typeof url === "string" ? { url } : {}),
          ...(typeof item?.caption === "string" ? { caption: item.caption } : {}),
          ...(item?.requireRead === true || item?.require_read === true ? { requireRead: true } : {})
        };
      })
      .filter((item) => CONTENT_TYPES.has(item.type))
      .filter((item) => item.type !== "text" ? Boolean(item.url) : Boolean(item.text?.trim()));
  }

  const items = [];
  if (typeof content.body === "string" && content.body.trim()) {
    items.push(createItem("text", slide.title ?? "Instructions", { text: content.body }, items.length));
  }
  if (typeof content.scenario === "string" && content.scenario.trim()) {
    items.push(createItem("text", "Scenario", { text: content.scenario }, items.length));
  }
  if (slide.video_url) {
    items.push(createItem("video", "Training video", { url: String(slide.video_url) }, items.length));
  }
  if (content.imageUrl) {
    items.push(createItem("image", content.imageCaption ?? "Training image", {
      url: String(content.imageUrl),
      caption: String(content.imageCaption ?? "")
    }, items.length));
  }
  if (Array.isArray(content.images)) {
    for (const [index, image] of content.images.entries()) {
      if (image?.url) {
        items.push(createItem("image", image.caption || `Training image ${index + 1}`, {
          url: String(image.url),
          caption: String(image.caption ?? "")
        }, items.length));
      }
    }
  }
  if (content.docUrl) {
    items.push(createItem("pdf", content.docName ?? "Training document", {
      url: String(content.docUrl),
      requireRead: Boolean(content.requireRead)
    }, items.length));
  }
  if (Array.isArray(content.documents)) {
    for (const [index, document] of content.documents.entries()) {
      if (document?.url) {
        items.push(createItem("pdf", document.name ?? `Training document ${index + 1}`, {
          url: String(document.url),
          requireRead: Boolean(document.requireRead)
        }, items.length));
      }
    }
  }
  if (slide.audio_url ?? content.audioUrl) {
    items.push(createItem("audio", "Voice-over", { url: String(slide.audio_url ?? content.audioUrl) }, items.length));
  }
  return items;
}
