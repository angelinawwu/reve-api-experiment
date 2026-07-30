# ImageSpace — Final Version Build Prompt

I'm using the Reve API to generate images along abstract qualitative axes (e.g.
`whimsy ↔ glumness`, `fish ↔ cat`, `hot ↔ stupid`). I have a working v1 (discrete
grid). This is the final version — a single-page, continuous, 3D-navigable version.

## Core interaction model

**Point** = an image generated at a specific coordinate in the imagespace.
**Dimension (axis)** = a named pair of poles (e.g. `naughty ↔ nice`) that defines
one scale points can be placed on. Adding a dimension never generates an image —
it just adds a new coordinate that all existing and future points can be positioned
on.

- **New point**: user specifies a coordinate on the currently active axes and
  triggers a Reve **Remix** call against the origin image (or nearest cached
  neighbor — see below) to generate it there.
- **New dimension**: user defines `{positivePole, negativePole}`. No generation.
  Every existing point implicitly sits at `0` on this axis until someone
  repositions it.

## Startup flow (single page, no navigation)

1. User types one prompt and generates the **origin image** (Reve Create). This
   is the first point, at the all-zero coordinate.
2. **Immediately after**, the app auto-populates 2 default dimensions, no
   generation or external call involved: `good ↔ evil` and `lawful ↔ chaotic`.
   The user can rename, delete, or reposition on these right away — they're a
   starting point, not a suggestion tied to the prompt's content.
3. From here the user can, without ever leaving the page: place new points, add
   more dimensions manually, or reposition existing points.

## The 3D view — resolved decision

Rather than true dimensionality reduction (PCA-style collapse of all N axes into
3 composite ones — mathematically valid but a much bigger build, and it would mean
the 3D axes no longer correspond to any single named dimension), **use a slice
model**: exactly 3 axes are "active" in the 3D view at any time — by default the
first 3 dimensions created. A picker lets the user swap which 3 (or 2, for a flat
plane view) are active. Every other dimension is held at 0 and simply isn't shown.
This is a straightforward generalization of "pick axes, hold the rest constant" —
not a projection in the linear-algebra sense, and that's intentional: it's far
simpler to build and keeps every visible axis directly meaningful.

## Continuous placement, not discrete cells

No fixed grid. Axes are continuous coordinate lines the user can place a point
anywhere along (effectively 50-100+ addressable positions per axis, not a fixed
set of cells). Two ways to place a point:

- **Click-to-place**: click any location along an axis line (2D plane view) or in
  the open 3D volume (3D view) to define a coordinate, then confirm generation.
- **Drag-to-explore ("walk")**: click and drag continuously through the space;
  on drag-*stop* (debounced ~150-250ms after motion ends, never on every
  mousemove), read the coordinate under the cursor and fire one Remix call for
  that exact point.

**Caching**: hash every generated point by its full coordinate vector (all axes,
not just the 3 currently visible). Before firing a Remix call, check for a cached
point within a small epsilon (e.g. 0.03) of the target coordinate and reuse it
instead of regenerating. This is what keeps continuous placement affordable —
flag it as a first-class requirement, not an optimization to add later.

## Visual / rendering

- Dark mode, sharp corners throughout — no border-radius anywhere. Use the
  frontend-design skill for type/spacing/component choices within those
  constraints.
- Restrained sci-fi: precise lines, mono or geometric type for axis labels and
  coordinates, minimal chrome — comprehension over spectacle. This should read
  as a serious analytical tool that happens to look sharp, not a dashboard cosplay.
- 3D rendering via Three.js: axes as thin lines through a shared origin, points
  as billboarded image sprites (or small planes) positioned at their coordinates,
  origin visually distinguished from generated points.
- Click-and-drag anywhere in the empty 3D space rotates the camera around the
  origin (orbit controls). Dragging *on* an axis or in click-to-place mode places
  a point instead — these two drag behaviors need a clear visual/cursor
  distinction so they don't fight each other.
- Axis labels render at both ends of each line (positive pole / negative pole),
  always facing the camera.

## Data model sketch

```typescript
interface Axis {
  id: string;
  positivePole: string;
  negativePole: string;
  source: "default" | "manual"; // "default" = the good/evil, lawful/chaotic starter pair
}

interface Point {
  id: string;
  coordinate: Partial<Record<string, number>>; // axisId -> value, -1 to 1, sparse (missing = 0)
  imageUrl: string;
}

interface ViewState {
  activeAxisIds: [string, string] | [string, string, string]; // 2D or 3D slice
  mode: "click" | "walk";
}
```

## Explicitly out of scope for this version

- True PCA/dimensionality-reduction projection of all axes at once — deferred,
  see 3D view decision above.
- Multi-page navigation of any kind — everything happens on one screen.
- Discrete grid cells — continuous placement only.
- Any LLM/Claude API call — axis suggestion is hardcoded (`good ↔ evil`,
  `lawful ↔ chaotic` on startup), not generated. No Anthropic API key needed
  anywhere in this build; only the Reve API key is required.
