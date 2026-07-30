/** Client-side wrappers for the Reve proxy routes. */

export async function createOriginImage(prompt: string): Promise<string> {
  const res = await fetch("/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Create failed");
  return data.url as string;
}

export async function remixImage(
  referenceImageUrl: string,
  instruction: string
): Promise<string> {
  const res = await fetch("/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: instruction, image_url: referenceImageUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Remix failed");
  return data.url as string;
}
