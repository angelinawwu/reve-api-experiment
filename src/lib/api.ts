import { VibeSpace, Coordinate } from "./types";

export async function createBaseImage(subjectPrompt: string): Promise<string> {
  const res = await fetch("/api/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: subjectPrompt }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create base image: ${res.statusText}`);
  }

  const data = await res.json();
  return data.url;
}

export function intensityWord(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.15) return "";
  if (abs < 0.5) return "slightly";
  if (abs < 0.85) return "noticeably";
  return "extremely";
}

export function buildEditPrompt(space: VibeSpace, coord: Coordinate): string {
  const clauses = space.axes
    .map(axis => {
      const v = coord[axis.id] ?? 0;
      const word = intensityWord(v);
      if (!word) return null;
      const pole = v > 0 ? axis.positivePole : axis.negativePole;
      return `${word} more ${pole}`;
    })
    .filter(Boolean);

  if (clauses.length === 0) return "no change, keep as is";
  return `Make this image ${clauses.join(", ")}, while keeping the composition, subject, and framing identical.`;
}

export async function generateCell(baseImageUrl: string, prompt: string): Promise<string> {
  const res = await fetch("/api/edit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt, image_url: baseImageUrl }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to generate cell: ${res.statusText}`);
  }

  const data = await res.json();
  return data.url;
}
