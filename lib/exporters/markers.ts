/**
 * Timeline marker exporter.
 *
 * Takes an array of timestamped review comments (the kind the Draft Preview
 * player collects — `{ timeSec, label, note, color }`) and serialises them to
 * a valid Premiere Pro / DaVinci Resolve XML timeline marker document.
 *
 * The emitted document targets the shared Final Cut Pro XML interchange
 * format (FCPXML `xmeml` form), which both Adobe Premiere Pro and DaVinci
 * Resolve import as a sequence with markers attached to it. We pick this
 * interchange format instead of proprietary `.fcpxml` / `.drp` binaries
 * because it is plain XML, fully transparent, and round-trips into either
 * NLE without a native plugin.
 *
 * Reference used:
 *   • FCPXML 1.x — `<xmeml version="5"><sequence>...<marker>...</marker></xmeml>`
 *   • Premiere Pro import path: File → Import → select .xml
 *   • DaVinci Resolve import path: Timeline → Import XML
 *
 * Marker model (per xmeml):
 *   <marker>
 *     <name>label</name>
 *     <comment>note</comment>
 *     <in>-1</in><out>-1</out>
 *     <start>frameCount</start>
 *     <duration>1</duration>            // single-frame pin
 *     <commenting>TRUE</commenting>
 *     <color>editorial</color>          // color token resolved to palette name
 *   </marker>
 *
 * Times in the input are seconds (float). We convert to integer frame counts
 * using a configurable `fps` (default 24 — the cinematic default for the kind
 * of 4K renders CiteFlow targets).
 */

export type MarkerColorToken =
  /** Editorial / blue (default). */
  | "editorial"
  /** Red — high priority. */
  | "red"
  /** Orange — review note. */
  | "orange"
  /** Yellow — question / open thread. */
  | "yellow"
  /** Green — approved. */
  | "green"
  /** Purple — creative direction. */
  | "purple";

export type TimelineMarker = {
  /** Cue point in seconds (float). */
  timeSec: number;
  /** Short (≤ 64 char) marker label. Falls back to "Marker N". */
  label?: string;
  /** Free-text note attached to the marker. */
  note?: string;
  /** Optional color token; maps to an NLE palette name. */
  color?: MarkerColorToken;
};

/**
 * Map our internal color tokens onto the xmeml palette names that both
 * Premiere Pro and DaVinci Resolve recognise. Anything unknown falls back
 * to `editorial`.
 */
const COLOR_NAME: Record<MarkerColorToken, string> = {
  editorial: "editorial",
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  purple: "purple",
};

/** Escape a string for safe inclusion inside an XML text node. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&#38;") // &  (must run first)
    .replace(/</g, "&#60;") // <
    .replace(/>/g, "&#62;") // >
    .replace(/"/g, "&#34;") // "
    .replace(/'/g, "'"); // '
}

/** Format a seconds value into a frame count at the given fps. */
function framesFromSeconds(timeSec: number, fps: number): number {
  const safe = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  return Math.round(safe * fps);
}

/** Round fps to a tidy string suitable for the xmeml `<rate>` element. */
function fpsRateString(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3);
}

/**
 * Serialise an array of timeline markers into a self-contained FCPXML
 * `xmeml` document string — one `<sequence>` holding one `<marker>` per
 * input comment, sorted by ascending cue point.
 *
 * The returned document imports cleanly into both Premiere Pro and DaVinci
 * Resolve (which both accept the legacy xmeml interchange form).
 */
export function exportTimelineMarkersXml(
  markers: TimelineMarker[],
  opts: {
    /** Output frame rate for frame-count conversion. Default 24. */
    fps?: number;
    /** Sequence width in pixels (cosmetic — NLEs ignore on import). Default 3840. */
    width?: number;
    /** Sequence height in pixels. Default 2160. */
    height?: number;
    /** Optional sequence label embedded in the xmeml. Default "CiteFlow Markers". */
    sequenceName?: string;
  } = {},
): string {
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 24;
  const width = opts.width ?? 3840;
  const height = opts.height ?? 2160;
  const sequenceName = opts.sequenceName ?? "CiteFlow Markers";

  // Sort by cue point so the NLE timeline reads left-to-right naturally.
  const ordered = [...markers]
    .filter((m) => Number.isFinite(m.timeSec))
    .sort((a, b) => a.timeSec - b.timeSec);

  // Resolve the latest frame so the sequence duration comfortably contains
  // every marker (default to 24 frames past the last cue if there are none).
  const lastFrame = ordered.length > 0 ? framesFromSeconds(ordered[ordered.length - 1].timeSec, fps) : 0;
  const totalFrames = Math.max(1, lastFrame + 24);

  const markerXml = ordered
    .map((m, idx) => {
      const startFrame = framesFromSeconds(m.timeSec, fps);
      const label = m.label && m.label.trim() !== "" ? m.label : `Marker ${idx + 1}`;
      const note = m.note ?? "";
      const color = COLOR_NAME[m.color ?? "editorial"];

      return [
        `      <marker>`,
        `        <name>${escapeXml(label)}</name>`,
        `        <comment>${escapeXml(note)}</comment>`,
        `        <in>-1</in>`,
        `        <out>-1</out>`,
        `        <start>${startFrame}</start>`,
        `        <duration>1</duration>`,
        `        <commenting>TRUE</commenting>`,
        `        <color>${color}</color>`,
        `      </marker>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="5">`,
    `  <sequence>`,
    `    <name>${escapeXml(sequenceName)}</name>`,
    `    <rate>`,
    `      <timebase>${fpsRateString(fps)}</timebase>`,
    `      <ntsc>FALSE</ntsc>`,
    `    </rate>`,
    `    <media>`,
    `      <video>`,
    `        <format>`,
    `          <samplecharacteristics>`,
    `            <rate>`,
    `              <timebase>${fpsRateString(fps)}</timebase>`,
    `              <ntsc>FALSE</ntsc>`,
    `            </rate>`,
    `            <width>${width}</width>`,
    `            <height>${height}</height>`,
    `          </samplecharacteristics>`,
    `        </format>`,
    `        <track>`,
    `          <duration>${totalFrames}</duration>`,
    `        </track>`,
    `      </video>`,
    `    </media>`,
    `    <markers>`,
    markerXml || `      <!-- no markers -->`,
    `    </markers>`,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}

/** Default export keeps the hot path ergonomic for `new Blob([exportTimelineMarkersXml(...)])`. */
export default exportTimelineMarkersXml;
