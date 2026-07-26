"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import {
  PlayIcon,
  PauseIcon,
  Volume2Icon,
  VolumeXIcon,
  Maximize2Icon,
  DownloadIcon,
  LockIcon,
  UnlockIcon,
  MessageSquareIcon,
  ReplyIcon,
  FileDownIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  FilmIcon,
} from "@/components/icons";

/* ── Types ──────────────────────────────────────────────── */
export type RevisionComment = {
  id: string;
  timestamp: number; // seconds
  author: string;
  role: "CLIENT" | "EDITOR";
  message: string;
  replies: { id: string; author: string; role: "CLIENT" | "EDITOR"; message: string }[];
};

export type VideoReviewPlayerProps = {
  invoiceId: string;
  clientName: string;
  projectTitle: string;
  amount: number;
  currency?: string;
  /** Actual video src (can be empty string for demo/preview mode) */
  videoSrc: string;
  /** "unpaid" shows watermark + pay bar; "paid" shows unlock banner */
  paymentStatus: "unpaid" | "paid";
  initialComments?: RevisionComment[];
  /** If true, renders the "Export to Premiere/DaVinci" button for the editor */
  isEditor?: boolean;
  onPayClick?: () => void;
};

/* ── Helpers ─────────────────────────────────────────────── */
function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function generateXML(comments: RevisionComment[], projectTitle: string): string {
  const markers = comments
    .map(
      (c, i) => `    <marker>
      <name>Rev ${i + 1}: ${c.author}</name>
      <comment>${c.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</comment>
      <in>${Math.round(c.timestamp * 25)}</in>
      <out>${Math.round(c.timestamp * 25) + 25}</out>
    </marker>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- CiteFlow Revision Export — ${projectTitle} -->
<!-- Compatible with Adobe Premiere Pro & DaVinci Resolve -->
<xmeml version="4">
  <sequence>
    <name>${projectTitle}</name>
    <markers>
${markers}
    </markers>
  </sequence>
</xmeml>`;
}

const INITIAL_DEMO_COMMENTS: RevisionComment[] = [
  {
    id: "c1",
    timestamp: 14,
    author: "Priya Sharma",
    role: "CLIENT",
    message: "The title card here feels a bit slow — can we tighten the cut by about 8 frames?",
    replies: [
      { id: "r1", author: "You (Editor)", role: "EDITOR", message: "Got it, will tighten the dissolve. Will push a rev tonight." },
    ],
  },
  {
    id: "c2",
    timestamp: 37,
    author: "Priya Sharma",
    role: "CLIENT",
    message: "Color on this shot is inconsistent with the previous scene — slight magenta push?",
    replies: [],
  },
];

/* ── Main component ──────────────────────────────────────── */
export function VideoReviewPlayer({
  invoiceId,
  clientName,
  projectTitle,
  amount,
  currency = "USD",
  videoSrc,
  paymentStatus: initialPaymentStatus,
  initialComments = INITIAL_DEMO_COMMENTS,
  isEditor = false,
  onPayClick,
}: VideoReviewPlayerProps) {
  /* ── Player state ── */
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Payment state ── */
  const [paymentStatus, setPaymentStatus] = useState(initialPaymentStatus);

  /* ── Revision / comment state ── */
  const [comments, setComments] = useState<RevisionComment[]>(initialComments);
  const [pendingTimestamp, setPendingTimestamp] = useState<number | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [exportingXML, setExportingXML] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const isPaid = paymentStatus === "paid";

  /* ── Controls auto-hide ── */
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setShowControls(true);
    if (isPlaying) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 2800);
    }
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, []);

  /* ── Video event handlers ── */
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || isDraggingProgress) return;
    setCurrentTime(v.currentTime);
  }, [isDraggingProgress]);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 300); // fallback 5 min for demo
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleWaiting = useCallback(() => setIsBuffering(true), []);
  const handleCanPlay = useCallback(() => setIsBuffering(false), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => null);
    } else {
      v.pause();
    }
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    setVolume(val);
    setIsMuted(val === 0);
    v.muted = val === 0;
  }, []);

  const handleFullscreen = useCallback(() => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => null);
    } else {
      el.requestFullscreen().catch(() => null);
    }
  }, []);

  /* ── Scrub bar interactions ── */
  const seekToRatio = useCallback((ratio: number) => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration || duration;
    if (!d) return;
    v.currentTime = ratio * d;
    setCurrentTime(v.currentTime);
  }, [duration]);

  const getProgressRatio = useCallback((clientX: number): number => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const ratio = getProgressRatio(e.clientX);
    const d = videoRef.current?.duration || duration;
    const ts = ratio * d;
    seekToRatio(ratio);
    // Capture timestamp for revision comment
    setPendingTimestamp(ts);
    setNewComment("");
    setTimeout(() => commentInputRef.current?.focus(), 60);
    resetHideTimer();
  }, [getProgressRatio, duration, seekToRatio, resetHideTimer]);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingProgress(true);
    seekToRatio(getProgressRatio(e.clientX));
  }, [getProgressRatio, seekToRatio]);

  useEffect(() => {
    if (!isDraggingProgress) return;
    const onMove = (e: MouseEvent) => seekToRatio(getProgressRatio(e.clientX));
    const onUp = () => setIsDraggingProgress(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingProgress, getProgressRatio, seekToRatio]);

  /* ── Comment actions ── */
  const submitComment = useCallback(() => {
    if (!newComment.trim() || pendingTimestamp === null) return;
    const c: RevisionComment = {
      id: `cmt-${Date.now()}`,
      timestamp: pendingTimestamp,
      author: isEditor ? "You (Editor)" : clientName,
      role: isEditor ? "EDITOR" : "CLIENT",
      message: newComment.trim(),
      replies: [],
    };
    setComments((prev) => [...prev].sort((a, b) => a.timestamp - b.timestamp).concat(c).sort((a, b) => a.timestamp - b.timestamp));
    setNewComment("");
    setPendingTimestamp(null);
  }, [newComment, pendingTimestamp, isEditor, clientName]);

  const submitReply = useCallback((commentId: string) => {
    if (!replyText.trim()) return;
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              replies: [
                ...c.replies,
                {
                  id: `rep-${Date.now()}`,
                  author: isEditor ? "You (Editor)" : clientName,
                  role: isEditor ? "EDITOR" : "CLIENT",
                  message: replyText.trim(),
                },
              ],
            }
          : c,
      ),
    );
    setReplyText("");
    setReplyingTo(null);
  }, [replyText, isEditor, clientName]);

  const jumpToTimestamp = useCallback((ts: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ts;
    setCurrentTime(ts);
    v.pause();
  }, []);

  /* ── XML export ── */
  const exportXML = useCallback(() => {
    setExportingXML(true);
    const xml = generateXML(comments, projectTitle);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectTitle.replace(/\s+/g, "_")}_revisions.xml`;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setExportingXML(false), 800);
  }, [comments, projectTitle]);

  /* ── Demo: simulate payment success for testing ── */
  const simulatePaid = useCallback(() => {
    setPaymentStatus("paid");
  }, []);

  /* ── Derived ── */
  const progressPct = duration ? (currentTime / duration) * 100 : 0;
  const commentMarkers = comments.map((c) => ({ id: c.id, pct: duration ? (c.timestamp / duration) * 100 : 0 }));

  const amountDisplay = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);

  return (
    <div className="flex flex-col gap-0 font-sans">
      {/* ── UNLOCKED BANNER ─────────────────────────────── */}
      {isPaid && (
        <div className="animate-unlock-pop mb-3 flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success/20 text-success">
              <UnlockIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-success">UNLOCKED: High-Resolution Deliverable Ready</p>
              <p className="text-xs text-success/70">Full 4K export is now available for download.</p>
            </div>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 rounded-lg bg-success px-4 py-2 text-xs font-semibold text-success-foreground shadow transition hover:brightness-110 active:brightness-90"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Download 4K Export
          </button>
        </div>
      )}

      {/* ── VIDEO PLAYER WRAPPER ─────────────────────────── */}
      <div
        className="group relative overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: "16/9" }}
        onMouseMove={resetHideTimer}
        onClick={togglePlay}
      >
        {/* Actual video element */}
        <video
          ref={videoRef}
          src={videoSrc || undefined}
          className="h-full w-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onContextMenu={(e) => e.preventDefault()}
          playsInline
          preload="metadata"
        />

        {/* Demo poster when no src */}
        {!videoSrc && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Fake timeline grid */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(0,229,255,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,229,255,0.08) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
            <FilmIcon className="h-12 w-12 text-slate-500" />
            <p className="text-sm font-medium text-slate-400">{projectTitle}</p>
            <p className="text-xs text-slate-600">Preview Mode — no video source attached</p>
          </div>
        )}

        {/* ── WATERMARK OVERLAY (unpaid only) ── */}
        {!isPaid && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none overflow-hidden"
          >
            {/* Animated diagonal repeating text */}
            <div
              className="animate-wm-scroll absolute inset-[-60%] opacity-[0.18]"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  -45deg,
                  transparent,
                  transparent 120px,
                  rgba(255,255,255,0.06) 120px,
                  rgba(255,255,255,0.06) 122px
                )`,
              }}
            />
            <div
              className="animate-wm-scroll absolute inset-0 flex origin-center -rotate-[30deg] flex-col items-center justify-center gap-8"
              style={{
                backgroundRepeat: "repeat",
                backgroundSize: "420px 120px",
                backgroundImage: "none",
              }}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <p
                  key={i}
                  className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.3em] text-white/25"
                  style={{ transform: `translateX(${(i % 2 === 0 ? -1 : 1) * 40}px)` }}
                >
                  UNPAID PREVIEW &mdash; PRODUCED FOR {clientName} &mdash; PAY TO UNLOCK FULL RESOLUTION
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Buffering spinner */}
        {isBuffering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2Icon className="h-10 w-10 animate-spin text-white/60" />
          </div>
        )}

        {/* Big center play/pause hit zone */}
        {!isPlaying && !isBuffering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-black/50 ring-2 ring-white/20 backdrop-blur-sm">
              <PlayIcon className="h-7 w-7 translate-x-0.5 text-white" />
            </div>
          </div>
        )}

        {/* ── CUSTOM CONTROLS BAR ── */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-3 pt-8 transition-opacity duration-300",
            showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Scrub / progress bar */}
          <div
            ref={progressRef}
            role="slider"
            aria-label="Video progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
            tabIndex={0}
            className="group/bar relative mb-2.5 h-1.5 w-full cursor-pointer rounded-full bg-white/20 hover:h-2.5 transition-all"
            onClick={handleProgressClick}
            onMouseDown={handleProgressMouseDown}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              const v = videoRef.current;
              if (!v) return;
              if (e.key === "ArrowRight") { v.currentTime = Math.min(v.duration, v.currentTime + 5); }
              if (e.key === "ArrowLeft")  { v.currentTime = Math.max(0, v.currentTime - 5); }
            }}
          >
            {/* Buffered / filled */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/70 transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
            {/* Playhead thumb */}
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary shadow opacity-0 transition-opacity group-hover/bar:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
            {/* Comment marker pins */}
            {commentMarkers.map((m) => (
              <div
                key={m.id}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30 bg-amber-400 shadow"
                style={{ left: `${m.pct}%` }}
                title="Revision comment"
              />
            ))}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              type="button"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={togglePlay}
              className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/80 transition hover:text-white"
            >
              {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            </button>

            {/* Time */}
            <span className="min-w-[72px] text-xs tabular-nums text-white/70">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
            <button
              type="button"
              aria-label={isMuted ? "Unmute" : "Mute"}
              onClick={toggleMute}
              className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/70 transition hover:text-white"
            >
              {isMuted ? <VolumeXIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              aria-label="Volume"
              className="h-1 w-16 cursor-pointer accent-primary"
            />

            {/* Fullscreen */}
            <button
              type="button"
              aria-label="Fullscreen"
              onClick={handleFullscreen}
              className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded text-white/70 transition hover:text-white"
            >
              <Maximize2Icon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── PAY TO UNLOCK BAR (unpaid only) ──────────────── */}
      {!isPaid && (
        <div className="animate-paybar-glow mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-400/20 text-amber-300">
              <LockIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-amber-200">
                Pay {amountDisplay} to Download Original 4K File
              </p>
              <p className="text-xs text-amber-400/70">
                This is a watermarked preview. Payment unlocks the full-resolution export.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onPayClick ?? simulatePaid}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-amber-950 shadow-md transition hover:bg-amber-300 active:bg-amber-500"
          >
            <LockIcon className="h-3.5 w-3.5" />
            Pay &amp; Unlock
          </button>
        </div>
      )}

      {/* ── TIMELINE REVISION PANEL ──────────────────────── */}
      <div className="mt-4 rounded-xl border border-border bg-card text-card-foreground shadow-card-dark">
        {/* Panel header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Timeline Revisions</h3>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {comments.length}
            </span>
          </div>
          {isEditor && (
            <button
              type="button"
              onClick={exportXML}
              disabled={exportingXML || comments.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {exportingXML ? (
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDownIcon className="h-3.5 w-3.5 text-primary" />
              )}
              Export to Premiere / DaVinci (.XML)
            </button>
          )}
        </div>

        {/* Add comment form */}
        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-xs text-muted-foreground">
            {pendingTimestamp !== null ? (
              <span className="font-medium text-primary">
                Adding comment at <span className="tabular-nums">{fmtTime(pendingTimestamp)}</span>
                {" "}—{" "}
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => { setPendingTimestamp(null); setNewComment(""); }}
                >
                  cancel
                </button>
              </span>
            ) : (
              "Click anywhere on the scrub bar above to pin a revision comment at that timestamp."
            )}
          </p>
          <div className="flex gap-2">
            <textarea
              ref={commentInputRef}
              rows={2}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={
                pendingTimestamp !== null
                  ? `Add revision comment at ${fmtTime(pendingTimestamp)}...`
                  : "Click the timeline to pick a timestamp first..."
              }
              disabled={pendingTimestamp === null}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitComment();
                }
              }}
              className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submitComment}
              disabled={!newComment.trim() || pendingTimestamp === null}
              className="flex items-center gap-1.5 self-end rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow transition hover:brightness-110 disabled:opacity-50"
            >
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>

        {/* Comment list */}
        <div className="max-h-72 divide-y divide-border overflow-y-auto">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <MessageSquareIcon className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No revision comments yet.</p>
              <p className="text-xs text-muted-foreground/60">Click the timeline above to add the first one.</p>
            </div>
          ) : (
            [...comments]
              .sort((a, b) => a.timestamp - b.timestamp)
              .map((comment) => (
                <div key={comment.id} className="px-4 py-3">
                  {/* Comment row */}
                  <div className="flex items-start gap-2.5">
                    {/* Avatar */}
                    <div
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                        comment.role === "EDITOR"
                          ? "bg-primary/15 text-primary"
                          : "bg-violet-500/15 text-violet-400",
                      )}
                    >
                      {comment.author.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground">{comment.author}</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            comment.role === "EDITOR"
                              ? "bg-primary/10 text-primary"
                              : "bg-violet-500/10 text-violet-400",
                          )}
                        >
                          {comment.role === "EDITOR" ? "Editor" : "Client"}
                        </span>
                        <button
                          type="button"
                          onClick={() => jumpToTimestamp(comment.timestamp)}
                          className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          title="Jump to this timestamp"
                        >
                          <Clock3Icon className="h-3 w-3" />
                          {fmtTime(comment.timestamp)}
                        </button>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{comment.message}</p>
                    </div>
                  </div>

                  {/* Replies */}
                  {comment.replies.length > 0 && (
                    <div className="ml-9 mt-2 space-y-2 border-l-2 border-border pl-3">
                      {comment.replies.map((reply) => (
                        <div key={reply.id} className="flex items-start gap-2">
                          <div
                            className={cn(
                              "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                              reply.role === "EDITOR"
                                ? "bg-primary/15 text-primary"
                                : "bg-violet-500/15 text-violet-400",
                            )}
                          >
                            {reply.author.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="text-[11px] font-semibold text-muted-foreground">{reply.author}</span>
                            <p className="text-xs leading-relaxed text-foreground/80">{reply.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply form */}
                  {replyingTo === comment.id ? (
                    <div className="ml-9 mt-2 flex gap-2">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            submitReply(comment.id);
                          }
                          if (e.key === "Escape") { setReplyingTo(null); setReplyText(""); }
                        }}
                        className="flex-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                      <button
                        type="button"
                        onClick={() => submitReply(comment.id)}
                        disabled={!replyText.trim()}
                        className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => { setReplyingTo(null); setReplyText(""); }}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setReplyingTo(comment.id); setReplyText(""); }}
                      className="ml-9 mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                    >
                      <ReplyIcon className="h-3 w-3" />
                      Reply
                    </button>
                  )}
                </div>
              ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">
            Invoice <span className="font-mono text-foreground/70">{invoiceId.slice(0, 8)}&hellip;</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {comments.reduce((n, c) => n + 1 + c.replies.length, 0)} total thread entries
          </p>
        </div>
      </div>
    </div>
  );
}
