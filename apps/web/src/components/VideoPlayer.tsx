import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Info, Shield, Play, Pause } from "lucide-react";
import { motion } from "framer-motion";
import { getYouTubeVideoId } from "../lib/videoSource.mjs";

interface VideoPlayerProps {
  src: string;
  onComplete: () => Promise<void> | void;
  onStart?: () => void;
  className?: string;
  savedPosition?: number;
  onPositionUpdate?: (seconds: number) => void;
  onDurationChange?: (seconds: number) => void;
  requireFullWatch?: boolean;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export function VideoPlayer({ src, onComplete, onStart, className = "", savedPosition, onPositionUpdate, onDurationChange, requireFullWatch = false }: VideoPlayerProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [completionError, setCompletionError] = useState("");
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState("");
  const [playerAttempt, setPlayerAttempt] = useState(0);

  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const maxWatchedRef = useRef(0);
  const isSeekingRef = useRef(false);
  const lastPositionRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout>();
  const completeFiredRef = useRef(false);
  const lastSavedPosRef = useRef(0);

  const videoId = getYouTubeVideoId(src);

  useEffect(() => {
    setProgress(0);
    setCompleted(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setMediaLoading(true);
    setMediaError("");
    maxWatchedRef.current = 0;
    completeFiredRef.current = false;
    lastPositionRef.current = 0;

    if (!videoId) return;
    let apiTimeout: ReturnType<typeof setTimeout> | undefined;

    const loadYoutubeApi = () => {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => {
          setMediaLoading(false);
          setMediaError("The video player could not be loaded. Check your connection and retry.");
        };
        const firstScriptTag = document.getElementsByTagName("script")[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }

        window.onYouTubeIframeAPIReady = () => {
          if (apiTimeout) clearTimeout(apiTimeout);
          initPlayer(videoId);
        };
        apiTimeout = setTimeout(() => {
          setMediaLoading(false);
          setMediaError("The video player is taking too long to load. Retry to try again.");
        }, 15000);
      } else if (window.YT && window.YT.Player) {
        initPlayer(videoId);
      } else {
        const pollYT = setInterval(() => {
          if (window.YT && window.YT.Player) {
            clearInterval(pollYT);
            if (apiTimeout) clearTimeout(apiTimeout);
            initPlayer(videoId);
          }
        }, 100);
        intervalRef.current = pollYT;
        apiTimeout = setTimeout(() => {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setMediaLoading(false);
          setMediaError("The video player is taking too long to load. Retry to try again.");
        }, 15000);
      }
    };

    const initPlayer = (id: string) => {
      if (!containerRef.current) return;
      try {
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            controls: requireFullWatch ? 0 : 1,
            disablekb: requireFullWatch ? 1 : 0,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1
          },
          events: {
            onReady: () => {
              setMediaLoading(false);
              const playerDuration = playerRef.current?.getDuration?.() ?? 0;
              if (playerDuration > 0) {
                setDuration(playerDuration);
                onDurationChange?.(playerDuration);
                if (savedPosition && savedPosition > 0) {
                  setCurrentTime(savedPosition);
                  setProgress(Math.min(100, (savedPosition / playerDuration) * 100));
                }
              }
              if (savedPosition && savedPosition > 0 && playerRef.current?.seekTo) {
                try {
                  const resumeAt = Math.max(0, savedPosition);
                  playerRef.current.seekTo(resumeAt, true);
                  maxWatchedRef.current = resumeAt;
                  lastPositionRef.current = resumeAt;
                  onPositionUpdate?.(resumeAt);
                  lastSavedPosRef.current = resumeAt;
                } catch {}
              }
            },
            onStateChange: (event: any) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                setIsPlaying(true);
                onStart?.();
                if (intervalRef.current) clearInterval(intervalRef.current);
                intervalRef.current = setInterval(() => {
                  if (playerRef.current?.getCurrentTime) {
                    const curr = playerRef.current.getCurrentTime();
                    const dur = playerRef.current.getDuration();
                    if (dur > 0) {
                      if (requireFullWatch && curr > maxWatchedRef.current + 1.5) {
                        playerRef.current.seekTo(maxWatchedRef.current, true);
                        return;
                      }
                      if (curr > maxWatchedRef.current) maxWatchedRef.current = curr;
                      setCurrentTime(curr);
                      setDuration(dur);
                      onDurationChange?.(dur);
                      const pct = (curr / dur) * 100;
                      setProgress(pct);
                      lastPositionRef.current = curr;
                      if (onPositionUpdate && curr - lastSavedPosRef.current >= 2) {
                        lastSavedPosRef.current = curr;
                        onPositionUpdate(curr);
                      }
                      if (!requireFullWatch) {
                        const completionThreshold = Math.max(90, ((dur - 8) / dur) * 100);
                        if (pct >= completionThreshold) void markCompleted();
                      }
                    }
                  }
                }, requireFullWatch ? 250 : 1000);
              } else {
                if (playerRef.current?.getCurrentTime) {
                  const curr = playerRef.current.getCurrentTime();
                  lastPositionRef.current = curr;
                  persistPosition(curr);
                }
                setIsPlaying(false);
                if (event.data === window.YT.PlayerState.ENDED) {
                  const curr = playerRef.current?.getCurrentTime?.() ?? 0;
                  const dur = playerRef.current?.getDuration?.() ?? 0;
                  if (!requireFullWatch || (dur > 0 && curr >= dur - 0.25 && maxWatchedRef.current >= dur - 0.75)) {
                    void markCompleted();
                  }
                }
              }
            },
            onError: () => {
              setMediaLoading(false);
              setMediaError(t("vid_error_default"));
            }
          }
        });
      } catch {
        setMediaLoading(false);
        setMediaError(t("vid_error_default"));
      }
    };

    loadYoutubeApi();

    return () => {
      if (playerRef.current?.destroy) {
        if (playerRef.current?.getCurrentTime) {
          const curr = playerRef.current.getCurrentTime();
          if (Number.isFinite(curr)) persistPosition(curr);
        }
        try { playerRef.current.destroy(); } catch {}
      }
      if (videoRef.current && Number.isFinite(videoRef.current.currentTime)) {
        persistPosition(videoRef.current.currentTime);
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (apiTimeout) clearTimeout(apiTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playerAttempt]);

  const persistPosition = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const safePosition = requireFullWatch ? Math.min(seconds, maxWatchedRef.current) : seconds;
    lastPositionRef.current = safePosition;
    lastSavedPosRef.current = safePosition;
    onPositionUpdate?.(safePosition);
  };

  const markCompleted = async () => {
    if (completed || completeFiredRef.current) return;

    completeFiredRef.current = true;
    setCompleted(true);
    setProgress(100);
    setCompletionError("");

    try {
      await onComplete();
    } catch (err) {
      completeFiredRef.current = false;
      setCompleted(false);
      setProgress(duration > 0 ? Math.min(99, (currentTime / duration) * 100) : 0);
      const message = err instanceof Error && err.message
        ? err.message
        : t("vid_error_default");
      setCompletionError(message);    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || isSeekingRef.current) return;
    const curr = videoRef.current.currentTime;
    const dur = videoRef.current.duration;

    if (dur > 0) {
      if (requireFullWatch && curr > maxWatchedRef.current + 1.5) {
        isSeekingRef.current = true;
        videoRef.current.currentTime = maxWatchedRef.current;
        setTimeout(() => { isSeekingRef.current = false; }, 300);
        return;
      }
      if (curr > maxWatchedRef.current) {
        maxWatchedRef.current = curr;
      }
      setCurrentTime(curr);
      setDuration(dur);
      const pct = (curr / dur) * 100;
      setProgress(pct);
      if (onPositionUpdate && curr - lastSavedPosRef.current >= 2) {
        persistPosition(curr);
      }
      if (!requireFullWatch) {
        const completionThreshold = Math.max(90, ((dur - 8) / dur) * 100);
        if (pct >= completionThreshold) markCompleted();
      }
    }
  };

  const handleSeeking = () => {
    if (!requireFullWatch || !videoRef.current || isSeekingRef.current) return;
    if (videoRef.current.currentTime > maxWatchedRef.current + 0.5) {
      isSeekingRef.current = true;
      videoRef.current.currentTime = maxWatchedRef.current;
      setTimeout(() => { isSeekingRef.current = false; }, 300);
    }
  };

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!requireFullWatch || (
      video.duration > 0 &&
      video.currentTime >= video.duration - 0.25 &&
      maxWatchedRef.current >= video.duration - 0.75
    )) {
      persistPosition(video.currentTime);
      void markCompleted();
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration;
    if (dur > 0) {
      setDuration(dur);
      onDurationChange?.(dur);
    }
    if (savedPosition && savedPosition > 0 && dur > 0) {
      const target = Math.min(savedPosition, Math.max(0, dur - 1));
      videoRef.current.currentTime = target;
      maxWatchedRef.current = target;
      setCurrentTime(target);
      const pct = (target / dur) * 100;
      setProgress(pct);
      lastPositionRef.current = target;
      persistPosition(target);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const embedUrl = videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&enablejsapi=1`
    : null;

  return (
    <div className={`video-container ${className}`} style={{ marginBottom: "24px" }}>
      <div
        style={{
          borderRadius: "20px",
          overflow: "hidden",
          background: "#090d16",
          border: "1px solid var(--border, #334155)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.3)",
          color: "#ffffff"
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: "16px 20px",
            background: "linear-gradient(90deg, #0f172a, #1e293b)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "10px",
                background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#f8fafc" }}>
                {t("vid_stream")}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                {t("vid_branding")}
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "4px 12px",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 700,
              background: completed ? "rgba(34, 197, 94, 0.2)" : "rgba(37, 99, 235, 0.2)",
              color: completed ? "#4ade80" : "#60a5fa",
              border: `1px solid ${completed ? "rgba(34, 197, 94, 0.4)" : "rgba(37, 99, 235, 0.4)"}`,
              display: "inline-flex",
              alignItems: "center",
              gap: "5px"
            }}
          >
            {completed ? (
              <><CheckCircle2 className="w-3.5 h-3.5" /> {t("vid_completed")}</>
            ) : isPlaying ? (
              <><Play className="w-3.5 h-3.5 fill-current" /> {t("vid_playing")}</>
            ) : (
              <><Pause className="w-3.5 h-3.5 fill-current" /> {t("vid_ready")}</>
            )}
          </div>
          {embedUrl && requireFullWatch && (
            <button
              type="button"
              disabled={mediaLoading || Boolean(mediaError)}
              onClick={() => {
                if (isPlaying) playerRef.current?.pauseVideo?.();
                else playerRef.current?.playVideo?.();
              }}
              style={{ padding: "7px 11px", border: "1px solid #475569", borderRadius: "8px", background: "#1e293b", color: "#fff", cursor: mediaLoading ? "not-allowed" : "pointer", fontWeight: 700 }}
            >
              {isPlaying ? "Pause video" : "Play video"}
            </button>
          )}
        </div>

        {/* Video Player Display */}
        {embedUrl ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingTop: "56.25%",
              background: "#000000"
            }}
          >
            <div ref={containerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
          </div>
        ) : (
          <div style={{ position: "relative", width: "100%", background: "#000000" }}>
            <video
              ref={videoRef}
              src={src}
              controls
              controlsList="nodownload"
              playsInline
              preload="metadata"
              style={{ width: "100%", maxHeight: "420px", display: "block" }}
              onPlay={() => {
                setIsPlaying(true);
                onStart?.();
              }}
              onPause={() => {
                setIsPlaying(false);
                persistPosition(videoRef.current?.currentTime ?? 0);
              }}
              onSeeking={handleSeeking}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={() => {
                setMediaLoading(false);
                setMediaError("");
              }}
              onLoadStart={() => {
                setMediaLoading(true);
                setMediaError("");
              }}
              onError={() => {
                setMediaLoading(false);
                setMediaError("This video could not be loaded. Check the video URL or upload a browser-compatible MP4 or WebM file.");
              }}
              onEnded={handleVideoEnded}
            />
          </div>
        )}
        {mediaLoading && !mediaError && (
          <p role="status" style={{ color: "#cbd5e1", background: "#0f172a", margin: 0, padding: "10px 16px", fontSize: "0.8rem" }}>
            Loading video…
          </p>
        )}
        {mediaError && (
          <div role="alert" style={{ color: "#fecaca", background: "#0f172a", margin: 0, padding: "10px 16px", fontSize: "0.82rem" }}>
            <p style={{ margin: "0 0 8px" }}>{mediaError}</p>
            <button type="button" onClick={() => setPlayerAttempt((attempt) => attempt + 1)} style={{ padding: "5px 10px", borderRadius: "6px", border: "1px solid #64748b", background: "#1e293b", color: "#fff", cursor: "pointer" }}>
              Retry video
            </button>
          </div>
        )}

        {/* Footer Progress & Action Button */}
        <div style={{ padding: "16px 20px", background: "#0f172a" }}>
          {duration > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#94a3b8", marginBottom: "6px", fontWeight: 600 }}>
                <span>{t("vid_progress", { current: formatTime(currentTime), total: formatTime(duration) })}</span>
                <span>{t("vid_watched", { pct: Math.round(progress) })}</span>
              </div>

              <div style={{ height: "6px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "3px", overflow: "hidden" }}>
                <motion.div
                  style={{ height: "100%", background: completed ? "#22c55e" : "#3b82f6", borderRadius: "3px" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            {completed ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4ade80", fontSize: "0.85rem", fontWeight: 700 }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{t("vid_clear")}</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#94a3b8", fontSize: "0.8rem" }}>
                <Info className="w-4 h-4 text-blue-400" />
                <span>{t("vid_instruction")}</span>
              </div>
            )}

          </div>
          {completionError && (
            <p role="alert" style={{ color: "#fca5a5", fontSize: "0.82rem", margin: "12px 0 0" }}>
              {completionError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
