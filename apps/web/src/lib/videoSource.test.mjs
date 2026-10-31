import test from "node:test";
import assert from "node:assert/strict";
import { getYouTubeVideoId } from "./videoSource.mjs";

test("extracts YouTube IDs from watch, short, embed, and shorts URLs", () => {
  const videoId = "abcDEF_1234";
  assert.equal(getYouTubeVideoId(`https://www.youtube.com/watch?v=${videoId}&t=10`), videoId);
  assert.equal(getYouTubeVideoId(`https://youtu.be/${videoId}?si=share`), videoId);
  assert.equal(getYouTubeVideoId(`https://youtube-nocookie.com/embed/${videoId}`), videoId);
  assert.equal(getYouTubeVideoId(`https://m.youtube.com/shorts/${videoId}`), videoId);
});

test("does not treat ordinary file URLs or malformed IDs as YouTube embeds", () => {
  assert.equal(getYouTubeVideoId("https://storage.example.test/training.mp4?token=abc"), "");
  assert.equal(getYouTubeVideoId("https://www.youtube.com/watch?v=short"), "");
  assert.equal(getYouTubeVideoId("not a URL"), "");
});
