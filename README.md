# imagespace

`imagespace` is a continuous, N-dimensional image-generation explorer powered by the **Reve API** and built with **Next.js** and **Three.js**. It allows users to anchor a generative space with a single "origin" image and explore remixes of that image in 2D or 3D slices by traversing custom descriptive axes (dimensions).

---

## Key Features

- **N-Dimensional Exploration**: Define and explore semantic axes (e.g., `good ↔ evil`, `lawful ↔ chaotic`). Traverse these axes dynamically in a 2D/3D viewport.
- **Continuous Generation via Remixing**: Start with a single parent image at coordinate `0`. Every new coordinate you visit translates the relative distance from the nearest generated point into a precise edit instruction (e.g., *"slightly more lawful, strongly more good"*) using the Reve API.
- **Affordable Continuous Sampling (Caching)**: Incorporates an epsilon-distance cache (`CACHE_EPSILON = 0.03`). If you navigate to coordinates close to an already generated image, the system reuses that image rather than initiating a new API generation.
- **Two Interaction Modes**:
  - **CLICK Mode**: Inspect the coordinate plane, position a target coordinate indicator, and confirm to generate the point.
  - **WALK Mode**: Automatically samples and generates new points at your cursor position as you hover/drag through the scene.
- **Radial Axis Gizmo**: A custom polar control widget to inspect, edit, and delete coordinates or adjust active dimension slices directly from the 3D scene.

---

## Technical Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Client-Side 3D Canvas)
- **Viewport rendering**: [Three.js](https://threejs.org/) (WebGL 3D coordinate plotting, camera controls, custom sprite label rendering)
- **Icons**: [@phosphor-icons/react](https://github.com/phosphor-icons/homepage)
- **Styling**: Modern, premium dark-themed CSS (glassmorphism, subtle glow transitions, clean typography)
- **Font**: IBM Plex Mono (loaded via `next/font`)

---

## Getting Started

### 1. Setup API Keys
Create a `.env.local` file in the root directory:
```bash
REVE_API_KEY=your_reve_api_key_here
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to start exploring your image space.

---

## How It Works

### The Remix Pipeline
1. **Define the Origin**: Provide a starting text prompt (e.g., *"a taxidermied crow wearing a tiny crown"*). This generates the base image at `(0, 0, ...)`.
2. **Move in Space**: Click or drag to set a new coordinate.
3. **Instruction Translation**: The application automatically calculates the difference between the nearest available generated image and the target coordinate. It maps differences along each axis to qualitative weights:
   - `mag >= 0.85`: *extremely*
   - `mag >= 0.60`: *strongly*
   - `mag >= 0.35`: *moderately*
   - `mag < 0.35`: *slightly*
4. **Reve API Execution**: The translation is sent as an edit instruction to the `/api/edit` endpoint, maintaining visual context and continuity while shifting semantic qualities.
