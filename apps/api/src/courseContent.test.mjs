import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCourseContentItems } from "./courseContent.mjs";

test("keeps explicitly authored topic content in its saved order", () => {
  const contentItems = [
    { id: "intro", type: "text", title: "Briefing", text: "Read the site rules." },
    { id: "video", type: "video", title: "Safety video", url: "https://cdn.test/video.mp4?token=abc" },
    { id: "map", type: "image", title: "Yard map", url: "https://files.test/map.png" },
    { id: "policy", type: "pdf", title: "Policy", url: "https://files.test/policy.pdf", requireRead: true },
    { id: "audio", type: "audio", title: "Narration", url: "https://files.test/narration.mp3" }
  ];
  const slide = { content_json: { contentItems } };

  assert.deepEqual(normalizeCourseContentItems(slide), contentItems);
});

test("normalizes alternate saved field names and legacy content item types", () => {
  const slide = {
    content_json: {
      content_items: [
        { id: "voice", kind: "voice-over", name: "Narration", file_url: "https://files.test/voice.mp3" },
        { id: "doc", type: "document", title: "Policy", fileUrl: "https://files.test/policy.pdf", require_read: true },
        { id: "text", type: "text", body: "Read the route briefing." }
      ]
    }
  };

  assert.deepEqual(
    normalizeCourseContentItems(slide).map(({ id, type, url, text, requireRead }) => ({ id, type, url, text, requireRead })),
    [
      { id: "voice", type: "audio", url: "https://files.test/voice.mp3", text: undefined, requireRead: undefined },
      { id: "doc", type: "pdf", url: "https://files.test/policy.pdf", text: undefined, requireRead: true },
      { id: "text", type: "text", url: undefined, text: "Read the route briefing.", requireRead: undefined }
    ]
  );
});

test("falls back to legacy slide fields when a saved sequence is empty", () => {
  const slide = {
    title: "Site safety",
    video_url: "https://cdn.test/safety.mp4?download=1",
    content_json: { contentItems: [], body: "Check in before entering." }
  };

  assert.deepEqual(
    normalizeCourseContentItems(slide).map(({ type, url, text }) => ({ type, url, text })),
    [
      { type: "text", url: undefined, text: "Check in before entering." },
      { type: "video", url: "https://cdn.test/safety.mp4?download=1", text: undefined }
    ]
  );
});

test("converts existing slide fields to an ordered topic without losing media", () => {
  const slide = {
    title: "Site safety",
    video_url: "https://files.test/safety.mp4",
    audio_url: "https://files.test/narration.mp3",
    content_json: {
      body: "Check in before entering.",
      scenario: "A vehicle is blocking the marked route.",
      imageUrl: "https://files.test/yard.png",
      imageCaption: "Yard map",
      docUrl: "https://files.test/policy.pdf",
      docName: "Site policy"
    }
  };

  assert.deepEqual(
    normalizeCourseContentItems(slide).map(({ type, title }) => [type, title]),
    [
      ["text", "Site safety"],
      ["text", "Scenario"],
      ["video", "Training video"],
      ["image", "Yard map"],
      ["pdf", "Site policy"],
      ["audio", "Voice-over"]
    ]
  );
});

test("ignores invalid or empty authored items", () => {
  const slide = {
    content_json: {
      contentItems: [
        { id: "empty-text", type: "text", text: "   " },
        { id: "empty-video", type: "video", url: "" },
        { id: "valid", type: "audio", url: "https://files.test/audio.mp3" },
        { id: "invalid-type", type: "quiz", url: "https://files.test/quiz" }
      ]
    }
  };

  assert.deepEqual(
    normalizeCourseContentItems(slide).map((item) => item.id),
    ["valid"]
  );
});
