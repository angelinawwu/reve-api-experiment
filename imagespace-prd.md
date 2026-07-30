# N-Dimensional ImageSpace — Product & Build Spec

## 1. Concept, one paragraph

An N-dimensional coordinate space where each axis is a user-defined pair of poles
(e.g. `whimsy ↔ glumness`, `naughty ↔ nice`, `fish ↔ rat`). The user picks a base
subject and any two axes to view as a 2D slice; the tool renders a grid where each
cell is a Reve-generated image at that coordinate, holding all other axes at their
neutral value. Adding an axis increases the dimensionality of the space without
changing the UI — you're always just looking at a 2D projection of it.

This is a real instance of picking a subspace and projecting a point onto it. Treat
the write-up below as literal spec, not just inspiration — the linear-algebra framing
should show up in the data model, not just the pitch deck.

---

## 2. Core data model

```typescript
type AxisId = string;

interface Axis {
  id: AxisId;
  positivePole: string;   // e.g. "whimsy"
  negativePole: string;   // e.g. "glumness"
  createdAt: number;
}

interface ImageSpace {
  id: string;
  subjectPrompt: string;      // text description of the base subject
  baseImageUrl: string;       // Reve Create output, the origin (0,0,0,...)
  axes: Axis[];                // grows any time the user adds one
}

// A coordinate is a sparse map: only include axes that are non-zero.
// Range is -1 (full negative pole) to 1 (full positive pole), 0 = neutral.
type Coordinate = Partial<Record<AxisId, number>>;

interface GridCell {
  coordinate: Coordinate;
  imageUrl: string | null;    // null while generating
  status: "empty" | "generating" | "ready" | "error";
}

interface SliceView {
  xAxisId: AxisId;
  yAxisId: AxisId;
  resolution: number;         // e.g. 5 -> 5x5 grid, values from -1 to 1
  heldConstant: Coordinate;   // fixed values for every axis NOT being viewed
}
```

`SliceView` is the whole trick: it's a projection spec. `xAxisId`/`yAxisId` pick the
2D subspace; `heldConstant` is where every other axis gets frozen (usually all zero).
Switching which two axes you're looking at is just re-instantiating `SliceView` —
no change to `ImageSpace` itself.

---

## 3. User flow

1. **Set the subject.** User types a description ("a golden retriever," "a bedroom").
   Call Reve **Create** once → this becomes `baseImageUrl`, the origin point.
2. **Define axes.** User adds one or more `{positivePole, negativePole}` pairs. No
   generation happens yet — axes are just metadata until a slice is viewed.
3. **Choose a slice.** User picks 2 axes to view (dropdowns or click-two-axes-on-star).
   Resolution defaults to 5×5.
4. **Grid renders.** For each cell not yet cached, fire a Reve **Edit** call against
   `baseImageUrl` (see prompt construction below). Cells fill in as calls resolve —
   don't block the whole grid on the slowest cell.
5. **Switch slice.** User picks two different axes → new `SliceView`, same
   `ImageSpace`. Previously generated cells for other slices stay cached in case the
   user comes back.
6. **Add an axis mid-session.** Appends to `axes[]`. Nothing regenerates until the
   user actually views a slice that includes the new axis.

---

## 4. Prompt construction (coordinate → edit instruction)

Each cell's prompt is generated from its coordinate, not hand-written. Bucket the
magnitude so prompts stay legible instead of asking the model to reason about raw
floats:

```typescript
function intensityWord(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.15) return "";               // effectively neutral, skip this axis
  if (abs < 0.5)  return "slightly";
  if (abs < 0.85) return "noticeably";
  return "extremely";
}

function buildEditPrompt(space: ImageSpace, coord: Coordinate): string {
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
  return `Make this image ${clauses.join(", ")}, while keeping the composition,
  subject, and framing identical.`;
}
```

The trailing "keep composition/framing identical" clause is doing real work — it's
what makes Edit hold structure while only the target quality moves. Worth testing
whether Edit or Remix gives more stable results for your specific subjects; Edit is
described as preserving composition more tightly, Remix leans more reinterpretive.

---

## 5. Reve API integration

Reve's API is single-endpoint-flavored: Create for text→image, Edit for
instruction-guided changes to an existing image, Remix for freer image-to-image
reinterpretation. Exact param names vary slightly by how you're accessing the
API (direct console vs. gateway), so **verify against your actual Reve console
docs before wiring this up** — the shape below is the common pattern across
Reve's ecosystem, not a guaranteed-exact schema:

```typescript
// Step 1 — origin image, called once per ImageSpace
async function createBaseImage(subjectPrompt: string): Promise<string> {
  const res = await fetch("https://api.reve.com/v1/image/create", {
    method: "POST",
    headers: { "Authorization": `Bearer ${REVE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: subjectPrompt, aspect_ratio: "1:1" }),
  });
  const data = await res.json();
  return data.url; // confirm actual response field name in console docs
}

// Step 2 — one call per grid cell
async function generateCell(baseImageUrl: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.reve.com/v1/image/edit", {
    method: "POST",
    headers: { "Authorization": `Bearer ${REVE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_url: baseImageUrl }),
  });
  const data = await res.json();
  return data.url;
}
```

**Concurrency and caching:**
- Cache by a hash of `(baseImageUrl, sorted coordinate entries)` — same coordinate
  should never regenerate.
- Fire cell requests in parallel batches (e.g. 5 at a time) rather than one giant
  Promise.all — gives you a visible fill-in effect and won't overrun rate limits.
- Since resolution² calls happen per slice (25 for a 5×5 grid), a "regenerate at
  lower res first, then refine" pattern (start at 3×3, subdivide on demand) will
  keep costs down while you're iterating on the concept.

---

## 6. Frontend components

```
<ImageSpaceApp>
  <SubjectPicker />              // sets subjectPrompt, triggers Create
  <AxisManager axes={axes} />    // add/remove/rename axes
  <SlicePicker                   // choose xAxisId, yAxisId, resolution
    axes={axes}
    onChange={setSliceView}
  />
  <ImageSpaceGrid
    slice={{ x: "axis-good-evil", y: "axis-lawful-chaotic" }}
    axes={axes}
    points={points}
  >
    <GridCell status="ready|generating|empty" imageUrl={...} />
  </ImageSpaceGrid>
</ImageSpaceApp>
```

`ImageSpaceGrid` should compute the full set of coordinates for the current slice up
front (deterministic from `resolution` + `heldConstant`), diff against the cache,
and only issue Edit calls for the missing cells.

---

## 7. Scope

**v1 (build this first)**
- One subject, 2 fixed axes, 5×5 grid, Edit calls, no caching persistence beyond
  the session.

**v2**
- Add-axis UI, slice picker for any 2 of N axes, coordinate-hash caching so
  switching slices back and forth doesn't regenerate.

**v3 (stretch, fun not required)**
- Diagonal "walk" mode: drag continuously across the grid and interpolate a
  linear combination of the two axes in real time via a single Remix call per
  drag-stop, instead of snapping to discrete cells.
- 3-axis view (small multiples of 2D grids, one per value of the third axis, i.e.
  literally stacking 2D slices to approximate a 3D cube).

---

## 8. Things to verify before building

- Exact Reve endpoint paths, auth header format, and response field names —
  pull straight from your console at api.reve.com/console/docs since I could
  only see the marketing/landing copy, not the interactive reference.
- Edit vs. Remix: run a same-subject, same-prompt test on both and compare which
  holds composition steadier for your specific subjects (portraits vs. objects
  vs. scenes may behave differently).
- Rate limits / cost per call — this determines whether 5×5 (25 calls) is your
  real-time default or something you should pre-generate and cache instead.
