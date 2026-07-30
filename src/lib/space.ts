import { Axis, AxisId, Coordinate, ImagePoint } from "./types";

/** Cache-hit tolerance across the full coordinate vector. */
export const CACHE_EPSILON = 0.03;

/** Value on an axis, treating missing entries as 0. */
export function axisValue(coord: Coordinate, axisId: AxisId): number {
  return coord[axisId] ?? 0;
}

/** Euclidean distance across the union of axes present in either coordinate. */
export function coordDistance(a: Coordinate, b: Coordinate): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Drop near-zero entries and round for stable identity. */
export function normalizeCoord(coord: Coordinate): Coordinate {
  const out: Coordinate = {};
  for (const [k, v] of Object.entries(coord)) {
    if (v !== undefined && Math.abs(v) > 1e-6) {
      out[k] = Math.round(v * 1000) / 1000;
    }
  }
  return out;
}

/** Deterministic hash of a full coordinate vector. */
export function hashCoord(coord: Coordinate): string {
  const entries = Object.entries(normalizeCoord(coord)).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(entries);
}

/**
 * Cached-point lookup: nearest ready point within CACHE_EPSILON of the target,
 * or null. This is what makes continuous placement affordable.
 */
export function findCachedPoint(
  points: ImagePoint[],
  target: Coordinate,
  epsilon: number = CACHE_EPSILON
): ImagePoint | null {
  let best: ImagePoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (p.status !== "ready" || !p.imageUrl) continue;
    const d = coordDistance(p.coordinate, target);
    if (d <= epsilon && d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Nearest ready point to use as the remix reference — falls back to the
 * origin if nothing else is closer.
 */
export function findNearestReference(
  points: ImagePoint[],
  target: Coordinate
): ImagePoint | null {
  let best: ImagePoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    if (p.status !== "ready" || !p.imageUrl) continue;
    const d = coordDistance(p.coordinate, target);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

function intensityWord(mag: number): string {
  if (mag >= 0.85) return "extremely";
  if (mag >= 0.6) return "strongly";
  if (mag >= 0.35) return "moderately";
  return "slightly";
}

/**
 * Build the Reve edit instruction describing the move from the reference
 * point's coordinate to the target coordinate, across ALL axes (not just the
 * visible slice).
 */
export function buildRemixInstruction(
  axes: Axis[],
  referenceCoord: Coordinate,
  targetCoord: Coordinate
): string {
  const clauses: string[] = [];
  for (const axis of axes) {
    const from = axisValue(referenceCoord, axis.id);
    const to = axisValue(targetCoord, axis.id);
    if (Math.abs(to - from) < 1e-6) continue;
    const pole = to >= from ? axis.positivePole : axis.negativePole;
    const mag = Math.abs(to - from);
    clauses.push(`${intensityWord(mag)} more ${pole}`);
  }
  if (clauses.length === 0) {
    return "Reproduce this image faithfully with no changes.";
  }
  return `Transform this image so the subject and overall mood become ${clauses.join(
    ", "
  )}. Keep the same subject, composition and framing; change only the qualities described.`;
}

/** Short human-readable coordinate label for the active slice. */
export function formatCoord(
  coord: Coordinate,
  axes: Axis[],
  activeAxisIds: AxisId[]
): string {
  return activeAxisIds
    .map((id) => {
      const axis = axes.find((a) => a.id === id);
      const v = axisValue(coord, id);
      const label = axis
        ? v >= 0
          ? axis.positivePole
          : axis.negativePole
        : id;
      return `${label} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
    })
    .join(" / ");
}

let counter = 0;
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
