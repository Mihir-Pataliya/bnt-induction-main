const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export function getYouTubeVideoId(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    let id = "";

    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (YOUTUBE_HOSTS.has(host)) {
      const segments = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
      else if (["embed", "shorts", "live", "v"].includes(segments[0])) id = segments[1] ?? "";
    }

    return /^[\w-]{11}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}
