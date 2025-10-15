// src/util/edgeToEvents.ts
export type EdgePoint = { x: number; y: number; mag?: number; theta?: number };

type MapOpts = {
  lanes: number;
  spanSeconds: number;
  scaleRootMidi: number;
  scaleIntervals: number[];
  thinCell?: number;
  velMin?: number;
  velMax?: number;
  yUpIsHigher?: boolean;   // top = higher pitch (default true)
  pitchCurve?: number;     // >1 biases toward lower pitches (default 1.3)
  octaveShift?: number;    // transpose in octaves (default -1 for darker)
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const midiToName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

export function mapEdgesToEvents(
  pts: EdgePoint[],
  imgW: number,
  imgH: number,
  opts: MapOpts
): { note: string; onset: number; velocity: number; x: number; y: number }[] {
  const {
    lanes,
    spanSeconds,
    scaleRootMidi,
    scaleIntervals,
    thinCell = 4,
    velMin = 0.5,
    velMax = 0.95,
    yUpIsHigher = true,
    pitchCurve = 1.3,   // <- bias toward lower notes
    octaveShift = -1,   // <- drop an octave by default
  } = opts;

  if (!pts.length || imgW <= 0 || imgH <= 0) return [];

  // 1) Thin horizontally (one point per thinCell column)
  const taken = new Set<number>();
  const filtered = pts.filter(p => {
    const gx = Math.floor(p.x / thinCell);
    if (taken.has(gx)) return false;
    taken.add(gx);
    return true;
  });
  if (!filtered.length) return [];

  // 2) Lane sizing and local mag normalization
  const laneH = Math.max(1, Math.floor(imgH / lanes));
  let maxMag = 1e-6;
  for (const p of filtered) maxMag = Math.max(maxMag, p.mag ?? 0);

  // 3) Map each point
  const events = filtered.map(p => {
    // y → lane index (0..lanes-1)
    let laneIdx = clamp(Math.floor(p.y / laneH), 0, lanes - 1);
    if (yUpIsHigher) laneIdx = (lanes - 1) - laneIdx; // top = higher

    // Apply curve to favor lower lanes: lane01^pitchCurve
    const lane01   = lanes > 1 ? laneIdx / (lanes - 1) : 0;
    const lane01c  = Math.pow(lane01, pitchCurve);
    const curvedIx = Math.round(lane01c * (lanes - 1));

    // Walk scale across octaves, then apply global octaveShift
    const degreeIdx = curvedIx % scaleIntervals.length;
    const octave    = Math.floor(curvedIx / scaleIntervals.length) + octaveShift;
    const midi      = scaleRootMidi + scaleIntervals[degreeIdx] + octave * 12;
    const note      = midiToName(midi);

    // x → onset within band span
    const onset = (p.x / imgW) * spanSeconds;

    // mag → velocity (normalized)
    const mag = p.mag ?? 0.5;
    const velocity = clamp(velMin + (velMax - velMin) * (mag / maxMag), velMin, velMax);

    return { note, onset, velocity, x: p.x, y: p.y };
  });

  return events.sort((a, b) => a.onset - b.onset);
}