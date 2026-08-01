"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GeneratingLoader } from "./GeneratingLoader";
import {
  Axis,
  AxisId,
  Coordinate,
  InteractionMode,
  SliceAxisIds,
  ImagePoint,
  ViewMode,
} from "@/lib/types";
import { axisValue, normalizeCoord } from "@/lib/space";
import { RadialGizmo } from "./RadialGizmo";

const WORLD = 2.0; // world units per coordinate unit 1
const AXIS_OVERHANG = 1.18; // axis lines extend slightly past ±1
const SPRITE_SIZE = 0.4;
const WALK_DEBOUNCE_MS = 200;
const CLICK_SLOP_PX = 6;

const COLOR_BG = 0x07090c;
const COLOR_AXIS = 0x39424f;
const COLOR_FRAME = 0x161b22;
const COLOR_ACCENT = 0xffffff;
const COLOR_PENDING = 0xffffff;
const COLOR_GENERATING = 0xffb454;
const COLOR_ERROR = 0xff5c5c;

interface ImageSpaceSceneProps {
  axes: Axis[];
  activeAxisIds: SliceAxisIds;
  points: ImagePoint[];
  mode: InteractionMode;
  viewMode: ViewMode;
  visibleAxisIds: AxisId[];
  pendingCoordinate: Coordinate | null;
  selectedPointId: string | null;
  onPlace: (coordinate: Coordinate) => void;
  onWalkSample: (coordinate: Coordinate) => void;
  onSelectPoint: (id: string | null) => void;
  onCursorCoordinate: (coordinate: Coordinate | null) => void;
  onPendingCoordinateChange?: (coordinate: Coordinate) => void;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
}

function coordToWorld(coord: Coordinate, active: AxisId[]): THREE.Vector3 {
  return new THREE.Vector3(
    axisValue(coord, active[0]) * WORLD,
    axisValue(coord, active[1]) * WORLD,
    active.length === 3 ? axisValue(coord, active[2]) * WORLD : 0
  );
}

interface AxisDir {
  id: AxisId;
  dir: THREE.Vector3;
  /** Length multiplier relative to WORLD (oblique axes are foreshortened). */
  scale: number;
}

const ORTHO_DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/** The four distinct cube-diagonal lines, used for oblique (4th+) axes. */
const OBLIQUE_DIRS = [
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, 1, -1),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(1, -1, -1),
].map((v) => v.normalize());

const OBLIQUE_SCALE = 0.55;

// ---- astral view: chained, tumbling sub-cubes -------------------------------

const ASTRAL_CHUNK_SCALE = 0.45; // each cube is this fraction of its parent
const ASTRAL_GAP = 1.9; // center spacing multiplier between tethered cubes

/** Corner directions successive cubes erupt along. */
const ASTRAL_OFFSET_DIRS = [
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, -1, -1),
  new THREE.Vector3(-1, 1, -1),
  new THREE.Vector3(-1, -1, 1),
].map((v) => v.normalize());

/** The 8 unit corners of a cube, in a stable order for connector lines. */
const CUBE_CORNERS = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x, y, z)))
);

interface AstralChunk {
  index: number;
  ids: AxisId[];
  center: THREE.Vector3;
  /** Basis scale relative to WORLD. */
  scale: number;
  /** Half-extent of this chunk's cube in world units. */
  half: number;
}

/** Split visible axes into cubes of three, each erupting from the last. */
function computeAstralChunks(visibleAxisIds: AxisId[]): AstralChunk[] {
  const chunks: AstralChunk[] = [];
  let prevCenter = new THREE.Vector3();
  let prevHalf = WORLD;
  for (let k = 0; k * 3 < visibleAxisIds.length; k++) {
    const ids = visibleAxisIds.slice(k * 3, k * 3 + 3);
    const scale = Math.pow(ASTRAL_CHUNK_SCALE, k);
    const half = WORLD * scale;
    const center =
      k === 0
        ? new THREE.Vector3()
        : prevCenter
            .clone()
            .addScaledVector(
              ASTRAL_OFFSET_DIRS[(k - 1) % ASTRAL_OFFSET_DIRS.length],
              (prevHalf + half) * ASTRAL_GAP
            );
    chunks.push({ index: k, ids, center, scale, half });
    prevCenter = center;
    prevHalf = half;
  }
  return chunks;
}

/** Slow tumble for chunk k at time t; the base cube (k=0) stays fixed. */
function astralRotation(k: number, timeSec: number): THREE.Quaternion {
  if (k === 0) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(timeSec * (0.05 + 0.035 * k), timeSec * (0.11 + 0.05 * k), 0)
  );
}

/** Direction (and length) each axis occupies in the scene for the view. */
function computeAxisDirs(
  viewMode: ViewMode,
  activeAxisIds: SliceAxisIds,
  visibleAxisIds: AxisId[],
  timeSec = 0
): AxisDir[] {
  if (viewMode === "astral") {
    const out: AxisDir[] = [];
    for (const chunk of computeAstralChunks(visibleAxisIds)) {
      const q = astralRotation(chunk.index, timeSec);
      chunk.ids.forEach((id, i) =>
        out.push({
          id,
          dir: ORTHO_DIRS[i].clone().applyQuaternion(q),
          scale: chunk.scale,
        })
      );
    }
    return out;
  }
  if (viewMode === "slice") {
    return activeAxisIds.map((id, i) => ({
      id,
      dir: ORTHO_DIRS[i].clone(),
      scale: 1,
    }));
  }
  if (viewMode === "starburst") {
    // Star coordinates: n bidirectional axes evenly fanned over a half-circle
    // in the XY plane, all crossing at the origin.
    const n = Math.max(visibleAxisIds.length, 1);
    return visibleAxisIds.map((id, i) => {
      const angle = Math.PI / 2 - (i / n) * Math.PI;
      return {
        id,
        dir: new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0),
        scale: 1,
      };
    });
  }
  // Oblique projection: first three axes orthogonal, the rest along diagonals.
  return visibleAxisIds.map((id, i) =>
    i < 3
      ? { id, dir: ORTHO_DIRS[i].clone(), scale: 1 }
      : {
          id,
          dir: OBLIQUE_DIRS[(i - 3) % OBLIQUE_DIRS.length].clone(),
          scale: OBLIQUE_SCALE,
        }
  );
}

/** Position of a coordinate: sum of its per-axis projections. */
function coordToWorldDirs(coord: Coordinate, dirs: AxisDir[]): THREE.Vector3 {
  const out = new THREE.Vector3();
  for (const { id, dir, scale } of dirs) {
    out.addScaledVector(dir, axisValue(coord, id) * WORLD * scale);
  }
  return out;
}

/** World position of a coordinate inside one astral sub-cube. */
function astralChunkPosition(
  coord: Coordinate,
  chunk: AstralChunk,
  q: THREE.Quaternion
): THREE.Vector3 {
  const local = new THREE.Vector3();
  for (let i = 0; i < chunk.ids.length; i++) {
    local.addScaledVector(
      ORTHO_DIRS[i].clone().applyQuaternion(q),
      axisValue(coord, chunk.ids[i]) * WORLD * chunk.scale
    );
  }
  return local.add(chunk.center);
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function worldToCoord(pos: THREE.Vector3, active: AxisId[]): Coordinate {
  const coord: Coordinate = {
    [active[0]]: clamp(pos.x / WORLD),
    [active[1]]: clamp(pos.y / WORLD),
  };
  if (active.length === 3) coord[active[2]] = clamp(pos.z / WORLD);
  return normalizeCoord(coord);
}

/** Canvas-rendered mono text as an always-camera-facing sprite. */
function makeLabelSprite(text: string, opts?: { dim?: boolean }): THREE.Sprite {
  const font = "400 24px 'IBM Plex Mono', 'SFMono-Regular', monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 24;
  const h = 36;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts?.dim ? "rgba(140,152,168,0.9)" : "rgba(214,222,232,0.95)";
  ctx.fillText(text.toUpperCase(), 12, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = 0.0042;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Image drawn into a square canvas with a sharp 1-px-style frame. */
function makeImageTexture(
  imageUrl: string,
  onReady: (texture: THREE.Texture) => void
) {
  const img = new Image();
  img.onload = () => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    onReady(texture);
  };
  img.src = imageUrl;
}

interface PointEntry {
  group: THREE.Group;
  sprite: THREE.Sprite;
  projections: THREE.Sprite[];
  key: string;
}

export function ImageSpaceScene(props: ImageSpaceSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const axesGroupRef = useRef<THREE.Group | null>(null);
  const pointEntriesRef = useRef<Map<string, PointEntry>>(new Map());
  const pendingMarkerRef = useRef<THREE.Group | null>(null);
  const walkCursorRef = useRef<THREE.Group | null>(null);
  
  const originMarkerRef = useRef<THREE.Group | null>(null);
  const cursorCoordRef = useRef<Coordinate | null>(null);
  const hoveredPointIdRef = useRef<string | null>(null);
  const gizmoOverlayRef = useRef<HTMLDivElement>(null);
  const selectedPointOverlayRef = useRef<HTMLDivElement>(null);
  const generatingOverlaysRef = useRef<HTMLDivElement>(null);

  // ---- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_BG);
    scene.fog = new THREE.Fog(COLOR_BG, 9, 18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(3.4, 2.5, 4.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 14;
    controlsRef.current = controls;

    // Bounding frame of the addressable volume.
    const frameGeo = new THREE.BoxGeometry(WORLD * 2, WORLD * 2, WORLD * 2);
    const frameEdges = new THREE.EdgesGeometry(frameGeo);
    const frame = new THREE.LineSegments(
      frameEdges,
      new THREE.LineBasicMaterial({ color: COLOR_FRAME })
    );
    frame.name = "volume-frame";
    scene.add(frame);

    // Pending-placement marker (click mode).
    const pendingGroup = new THREE.Group();
    pendingGroup.visible = false;
    const tickMat = new THREE.LineBasicMaterial({
      color: COLOR_PENDING,
      depthTest: false,
    });
    const t = 0.16;
    for (const dir of [
      [new THREE.Vector3(-t, 0, 0), new THREE.Vector3(t, 0, 0)],
      [new THREE.Vector3(0, -t, 0), new THREE.Vector3(0, t, 0)],
      [new THREE.Vector3(0, 0, -t), new THREE.Vector3(0, 0, t)],
    ]) {
      const geo = new THREE.BufferGeometry().setFromPoints(dir);
      const line = new THREE.Line(geo, tickMat);
      line.renderOrder = 11;
      pendingGroup.add(line);
    }
    scene.add(pendingGroup);
    pendingMarkerRef.current = pendingGroup;

    // Walk-mode live cursor.
    const walkGroup = new THREE.Group();
    walkGroup.visible = false;
    const walkRing = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.085, 4),
      new THREE.MeshBasicMaterial({
        color: COLOR_ACCENT,
        side: THREE.DoubleSide,
        depthTest: false,
      })
    );
    walkRing.renderOrder = 11;
    walkGroup.add(walkRing);
    scene.add(walkGroup);
    walkCursorRef.current = walkGroup;

    // Glowing origin point for initial prompt.
    const originMarkerGroup = new THREE.Group();
    
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.08, "rgba(255, 255, 255, 0.9)");
    gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.35)");
    gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.08)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);

    const glowMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.set(0.4, 0.4, 1);
    originMarkerGroup.add(glowSprite);

    const coreMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0.95 });
    const coreSprite = new THREE.Sprite(coreMat);
    coreSprite.scale.set(0.12, 0.12, 1);
    originMarkerGroup.add(coreSprite);

    scene.add(originMarkerGroup);
    originMarkerRef.current = originMarkerGroup;

    // ---- pointer interaction ----
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos: { x: number; y: number } | null = null;
    let walking = false;
    let walkTimer: ReturnType<typeof setTimeout> | null = null;
    let lastWalkCoord: Coordinate | null = null;

    function ndcFromEvent(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    /** Intersect the placement plane; returns clamped coordinate or null. */
    function pickCoordinate(e: PointerEvent): Coordinate | null {
      // Placement only makes sense in the slice view, where the mapping from
      // screen space back to coordinates is unambiguous.
      if (propsRef.current.viewMode !== "slice") return null;
      ndcFromEvent(e);
      raycaster.setFromCamera(ndc, camera);
      const active = propsRef.current.activeAxisIds;
      const plane =
        active.length === 3
          ? new THREE.Plane(
              camera.getWorldDirection(new THREE.Vector3()).negate(),
              0
            )
          : new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      // Reject picks far outside the addressable volume.
      const limit = WORLD * 1.35;
      if (
        Math.abs(hit.x) > limit ||
        Math.abs(hit.y) > limit ||
        Math.abs(hit.z) > limit
      ) {
        return null;
      }
      return worldToCoord(hit, active);
    }

    function pickPoint(e: PointerEvent): string | null {
      ndcFromEvent(e);
      raycaster.setFromCamera(ndc, camera);
      const sprites: THREE.Object3D[] = [];
      pointEntriesRef.current.forEach((entry) => {
        sprites.push(entry.sprite);
        if (entry.projections) {
          sprites.push(...entry.projections);
        }
      });
      const hits = raycaster.intersectObjects(sprites, false);
      if (hits.length === 0) return null;
      return (hits[0].object.userData.pointId as string) ?? null;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      downPos = { x: e.clientX, y: e.clientY };
      if (propsRef.current.mode === "walk") {
        walking = true;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }

    function scheduleWalkFire(coord: Coordinate) {
      lastWalkCoord = coord;
      if (walkTimer) clearTimeout(walkTimer);
      walkTimer = setTimeout(() => {
        if (lastWalkCoord) propsRef.current.onWalkSample(lastWalkCoord);
      }, WALK_DEBOUNCE_MS);
    }

    function onPointerMove(e: PointerEvent) {
      const coord = pickCoordinate(e);
      propsRef.current.onCursorCoordinate(coord);
      cursorCoordRef.current = coord;
      hoveredPointIdRef.current = pickPoint(e);

      const walkCursor = walkCursorRef.current;
      if (walking && coord) {
        if (walkCursor) {
          walkCursor.visible = true;
          walkCursor.position.copy(
            coordToWorld(coord, propsRef.current.activeAxisIds)
          );
        }
        scheduleWalkFire(coord);
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (e.button !== 0) return;
      const wasWalking = walking;
      walking = false;
      if (walkCursorRef.current) walkCursorRef.current.visible = false;

      if (wasWalking) {
        if (walkTimer) clearTimeout(walkTimer);
        const coord = pickCoordinate(e);
        if (coord) propsRef.current.onWalkSample(coord);
        lastWalkCoord = null;
        downPos = null;
        return;
      }

      // Click (not drag) in click mode: select a point or place a coordinate.
      if (
        downPos &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < CLICK_SLOP_PX
      ) {
        const hitPoint = pickPoint(e);
        if (hitPoint) {
          propsRef.current.onSelectPoint(hitPoint);
        } else if (propsRef.current.mode === "click") {
          const coord = pickCoordinate(e);
          if (coord) {
            propsRef.current.onPlace(coord);
          } else {
            propsRef.current.onSelectPoint(null);
          }
        } else {
          propsRef.current.onSelectPoint(null);
        }
      }
      downPos = null;
    }

    function onPointerLeave() {
      propsRef.current.onCursorCoordinate(null);
      cursorCoordRef.current = null;
      hoveredPointIdRef.current = null;
    }

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);

    // ---- render loop ----
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      controls.update();
      
      const propsNow = propsRef.current;
      const timeSec = reduceMotion ? 0 : performance.now() / 1000;
      const dirsNow = computeAxisDirs(
        propsNow.viewMode,
        propsNow.activeAxisIds,
        propsNow.visibleAxisIds,
        timeSec
      );

      // Astral: tumble the sub-cubes, re-tether the corner connectors and
      // keep points in sync with the rotating bases.
      if (propsNow.viewMode === "astral") {
        const chunks = computeAstralChunks(propsNow.visibleAxisIds);
        const rots = chunks.map((c) => astralRotation(c.index, timeSec));
        chunks.forEach((chunk, k) => {
          const chunkGroup = axesGroupRef.current?.getObjectByName(
            `astral-chunk-${k}`
          );
          if (chunkGroup) chunkGroup.quaternion.copy(rots[k]);
          if (k === 0) return;
          const conn = axesGroupRef.current?.getObjectByName(
            `astral-connectors-${k}`
          ) as THREE.LineSegments | undefined;
          if (!conn) return;
          const posAttr = conn.geometry.getAttribute(
            "position"
          ) as THREE.BufferAttribute;
          const prev = chunks[k - 1];
          CUBE_CORNERS.forEach((corner, ci) => {
            const a = corner
              .clone()
              .multiplyScalar(prev.half)
              .applyQuaternion(rots[k - 1])
              .add(prev.center);
            const b = corner
              .clone()
              .multiplyScalar(chunk.half)
              .applyQuaternion(rots[k])
              .add(chunk.center);
            posAttr.setXYZ(ci * 2, a.x, a.y, a.z);
            posAttr.setXYZ(ci * 2 + 1, b.x, b.y, b.z);
          });
          posAttr.needsUpdate = true;
          (conn.material as THREE.LineBasicMaterial).opacity =
            0.16 + 0.08 * Math.sin(timeSec * 1.4 + k * 1.7);
        });
        // Points ride the rotating bases.
        for (const point of propsNow.points) {
          const entry = pointEntriesRef.current.get(point.id);
          if (entry && entry.projections) {
            const positions = chunks.map((chunk, k) =>
              astralChunkPosition(point.coordinate, chunk, rots[k])
            );
            entry.group.position.copy(positions[0]);
            entry.sprite.position.set(0, 0, 0);
            entry.projections.forEach((proj, k) => {
              proj.position.copy(positions[k + 1].clone().sub(positions[0]));
            });
          } else if (entry) {
            entry.group.position.copy(coordToWorldDirs(point.coordinate, dirsNow));
          }
        }
      }
      const marker = pendingMarkerRef.current;
      if (marker) {
        if (propsNow.viewMode !== "slice") {
          marker.visible = false;
        } else if (propsNow.pendingCoordinate) {
          marker.visible = true;
          marker.position.copy(coordToWorld(propsNow.pendingCoordinate, propsNow.activeAxisIds));
        } else if (cursorCoordRef.current && propsNow.mode === "click") {
          marker.visible = true;
          marker.position.copy(coordToWorld(cursorCoordRef.current, propsNow.activeAxisIds));
        } else {
          marker.visible = false;
        }
      }

      if (gizmoOverlayRef.current && container) {
        if (propsNow.pendingCoordinate && propsNow.mode === "click") {
          gizmoOverlayRef.current.style.display = "block";
          const worldPos = coordToWorld(propsNow.pendingCoordinate, propsNow.activeAxisIds);
          // Project the 3D position to screen space
          worldPos.project(camera);
          const w = container.clientWidth;
          const h = container.clientHeight;
          const x = (worldPos.x * 0.5 + 0.5) * w;
          const y = (-(worldPos.y * 0.5) + 0.5) * h;
          gizmoOverlayRef.current.style.transform = `translate(${x}px, ${y}px)`;
        } else {
          gizmoOverlayRef.current.style.display = "none";
        }
      }

      const selectedOverlay = selectedPointOverlayRef.current;
      if (selectedOverlay && container) {
        const selectedPoint = propsNow.points.find(p => p.id === propsNow.selectedPointId);
        const targetCoord = propsNow.pendingCoordinate || selectedPoint?.coordinate;
        if (targetCoord) {
          selectedOverlay.style.display = "block";
          const worldPos = coordToWorldDirs(targetCoord, dirsNow);
          // Project the 3D position to screen space
          worldPos.project(camera);
          const w = container.clientWidth;
          const h = container.clientHeight;
          const x = (worldPos.x * 0.5 + 0.5) * w;
          const y = (-(worldPos.y * 0.5) + 0.5) * h;
          selectedOverlay.style.transform = `translate(${x}px, ${y}px)`;
        } else {
          selectedOverlay.style.display = "none";
        }
      }

      if (originMarkerRef.current) {
        const hasPoints = propsNow.points.length > 0;
        originMarkerRef.current.visible = !hasPoints;
        if (!hasPoints) {
          const t = Date.now() / 800;
          const pulseScale = 0.4 + Math.sin(t) * 0.06;
          originMarkerRef.current.children[0].scale.setScalar(pulseScale);
        }
      }

      // Dynamic spring-based scaling for points
      const entries = pointEntriesRef.current;
      const hoveredId = hoveredPointIdRef.current;
      const selectedId = propsNow.selectedPointId;

      entries.forEach((entry, id) => {
        let targetScale = SPRITE_SIZE;
        const point = propsNow.points.find(p => p.id === id);
        const isOrigin = point?.isOrigin;
        const baseSize = isOrigin ? SPRITE_SIZE * 1.25 : SPRITE_SIZE;

        if (id === selectedId) {
          targetScale = baseSize * 2.5; // Significantly larger
        } else if (id === hoveredId) {
          targetScale = baseSize * 1.8; // Enlarged on hover
        } else {
          targetScale = baseSize;
        }

        // Apply smooth lerp for the "spring-like" easing effect (emil-design-eng)
        const currentScale = entry.sprite.scale.x;
        const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.15);
        entry.sprite.scale.set(nextScale, nextScale, 1);
        if (entry.projections) {
          entry.projections.forEach((proj) =>
            proj.scale.set(nextScale, nextScale, 1)
          );
        }

        // Smoothly fade out non-selected points
        let targetOpacity = 1.0;
        if (point?.status === "generating") {
          targetOpacity = 0.0; // Hide the sprite, handled by DOM overlay
        } else if (point?.status !== "ready") {
          targetOpacity = 0.35;
        } else if (selectedId && id !== selectedId) {
          targetOpacity = 0.4;
        }
        
        entry.sprite.material.opacity = THREE.MathUtils.lerp(
          entry.sprite.material.opacity,
          targetOpacity,
          0.15
        );

        // Update DOM overlay for generating points
        if (generatingOverlaysRef.current && point?.status === "generating") {
          const overlay = generatingOverlaysRef.current.querySelector(
            `[data-generating-id="${id}"]`
          ) as HTMLElement;
          if (overlay && container) {
            const worldPos = entry.group.position.clone();
            const distance = camera.position.distanceTo(worldPos);
            worldPos.project(camera);
            const w = container.clientWidth;
            const h = container.clientHeight;
            const x = (worldPos.x * 0.5 + 0.5) * w;
            const y = (-(worldPos.y * 0.5) + 0.5) * h;
            
            const vFov = 2 * Math.tan((camera.fov * Math.PI) / 360);
            const screenHeight = (nextScale * h) / (distance * vFov);
            const cssScale = screenHeight / 128;
            
            overlay.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${cssScale})`;
          }
        }
      });

      renderer.render(scene, camera);
    }
    tick();

    const resize = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resize.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- mode: orbit vs walk drag behavior ------------------------------------
  useEffect(() => {
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    if (!controls || !renderer) return;
    if (props.viewMode !== "slice") {
      // Read-only views: starburst is planar; projection/astral orbit freely.
      const orbitable =
        props.viewMode === "projection" || props.viewMode === "astral";
      controls.enableRotate = orbitable;
      renderer.domElement.style.cursor = orbitable ? "grab" : "default";
      return;
    }
    const is3D = props.activeAxisIds.length === 3;
    controls.enableRotate = props.mode === "click" && is3D;
    renderer.domElement.style.cursor =
      props.mode === "walk" ? "crosshair" : is3D ? "grab" : "crosshair";
  }, [props.mode, props.activeAxisIds, props.viewMode]);

  // ---- camera reset when dimensionality or view changes -----------------------
  const dimCount = props.activeAxisIds.length;
  const viewMode = props.viewMode;
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (viewMode === "starburst") {
      camera.position.set(0, 0, 7.2);
    } else if (viewMode === "projection") {
      camera.position.set(4.2, 3.1, 5.2);
    } else if (viewMode === "astral") {
      camera.position.set(5.6, 4.2, 6.8);
    } else if (dimCount === 2) {
      camera.position.set(0, 0, 6.2);
    } else {
      camera.position.set(3.4, 2.5, 4.2);
    }
    controls.target.set(0, 0, 0);
    controls.update();
    const scene = sceneRef.current;
    const frame = scene?.getObjectByName("volume-frame");
    if (frame)
      frame.visible =
        viewMode === "projection" || (viewMode === "slice" && dimCount === 3);
  }, [dimCount, viewMode]);

  // ---- axes lines + pole labels ----------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (axesGroupRef.current) {
      scene.remove(axesGroupRef.current);
      axesGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Line) obj.geometry.dispose();
        if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
    }

    const group = new THREE.Group();

    /** One bidirectional axis line with ticks and pole labels. */
    const buildAxis = (
      parent: THREE.Object3D,
      axisId: AxisId,
      dir: THREE.Vector3,
      scale: number,
      labelScale = 1
    ) => {
      const axis = props.axes.find((a) => a.id === axisId);
      if (!axis) return;
      const ext = WORLD * AXIS_OVERHANG * scale;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-ext),
        dir.clone().multiplyScalar(ext),
      ]);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: COLOR_AXIS })
      );
      parent.add(line);

      // Unit tick marks at ±1.
      for (const s of [-1, 1]) {
        const tickGeo = new THREE.BufferGeometry().setFromPoints([
          dir.clone().multiplyScalar(s * WORLD * scale),
          dir
            .clone()
            .multiplyScalar(s * WORLD * scale)
            .add(new THREE.Vector3(0.05, 0.05, 0.05)),
        ]);
        parent.add(
          new THREE.Line(
            tickGeo,
            new THREE.LineBasicMaterial({ color: COLOR_AXIS })
          )
        );
      }

      const posLabel = makeLabelSprite(axis.positivePole);
      posLabel.position.copy(dir.clone().multiplyScalar(ext + 0.32 * labelScale));
      posLabel.scale.multiplyScalar(labelScale);
      parent.add(posLabel);
      const negLabel = makeLabelSprite(axis.negativePole, { dim: true });
      negLabel.position.copy(
        dir.clone().multiplyScalar(-(ext + 0.32 * labelScale))
      );
      negLabel.scale.multiplyScalar(labelScale);
      parent.add(negLabel);
    };

    if (props.viewMode === "astral") {
      const chunks = computeAstralChunks(props.visibleAxisIds);
      chunks.forEach((chunk) => {
        // Tumbling sub-cube: wireframe + its own three axes, in local space.
        const chunkGroup = new THREE.Group();
        chunkGroup.name = `astral-chunk-${chunk.index}`;
        chunkGroup.position.copy(chunk.center);

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(
            new THREE.BoxGeometry(chunk.half * 2, chunk.half * 2, chunk.half * 2)
          ),
          new THREE.LineBasicMaterial({ color: COLOR_FRAME })
        );
        chunkGroup.add(edges);

        const labelScale = chunk.index === 0 ? 1 : Math.max(chunk.scale, 0.6);
        chunk.ids.forEach((id, i) =>
          buildAxis(chunkGroup, id, ORTHO_DIRS[i].clone(), chunk.scale, labelScale)
        );
        group.add(chunkGroup);

        if (chunk.index === 0) return;

        // Tesseract-style tethers: parent corners to child corners, positions
        // are rewritten every frame in the render loop.
        const connGeo = new THREE.BufferGeometry();
        connGeo.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(CUBE_CORNERS.length * 2 * 3), 3)
        );
        const conn = new THREE.LineSegments(
          connGeo,
          new THREE.LineBasicMaterial({
            color: COLOR_AXIS,
            transparent: true,
            opacity: 0.2,
          })
        );
        conn.name = `astral-connectors-${chunk.index}`;
        conn.frustumCulled = false;
        group.add(conn);

        // Caret between the cubes, pointing at the erupting child.
        const prev = chunks[chunk.index - 1];
        const offsetDir = chunk.center.clone().sub(prev.center).normalize();
        const caret = new THREE.Mesh(
          new THREE.ConeGeometry(0.07, 0.18, 4),
          new THREE.MeshBasicMaterial({
            color: 0x8c98a8,
            transparent: true,
            opacity: 0.9,
          })
        );
        caret.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          offsetDir
        );
        caret.position
          .copy(prev.center)
          .add(chunk.center)
          .multiplyScalar(0.5);
        group.add(caret);
      });
    } else {
      const axisDirs = computeAxisDirs(
        props.viewMode,
        props.activeAxisIds,
        props.visibleAxisIds
      );
      axisDirs.forEach(({ id, dir, scale }) => buildAxis(group, id, dir, scale));
    }

    scene.add(group);
    axesGroupRef.current = group;
  }, [props.axes, props.activeAxisIds, props.viewMode, props.visibleAxisIds]);

  // ---- points -----------------------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const entries = pointEntriesRef.current;
    const seen = new Set<string>();
    const pointDirs = computeAxisDirs(
      props.viewMode,
      props.activeAxisIds,
      props.visibleAxisIds
    );

    for (const point of props.points) {
      seen.add(point.id);
      const isSelected = point.id === props.selectedPointId;
      const key = `${point.status}|${point.imageUrl ? "img" : "none"}|${point.isOrigin ? "origin" : ""}`;
      let entry = entries.get(point.id);

      if (entry && entry.key !== key) {
        scene.remove(entry.group);
        entries.delete(point.id);
        entry = undefined;
      }

      const desiredProjections =
        props.viewMode === "astral"
          ? Math.max(0, computeAstralChunks(props.visibleAxisIds).length - 1)
          : 0;

      if (!entry) {
        const group = new THREE.Group();
        const material = new THREE.SpriteMaterial({
          color:
            point.status === "generating"
              ? COLOR_GENERATING
              : point.status === "error"
              ? COLOR_ERROR
              : 0xffffff,
          opacity: point.status === "ready" ? 1 : 0.35,
          transparent: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.userData.pointId = point.id;
        group.add(sprite);

        if (point.status === "ready" && point.imageUrl) {
          makeImageTexture(point.imageUrl, (texture) => {
            material.map = texture;
            material.color.set(0xffffff);
            material.needsUpdate = true;
          });
        }

        // Drop line to the visible plane/floor for spatial grounding (3D only).
        scene.add(group);
        entry = { group, sprite, projections: [], key };
        entries.set(point.id, entry);
      }

      // Sync astral projection copies to the number of sub-cubes.
      const projections = entry!.projections;
      if (projections.length < desiredProjections) {
        const material = entry!.sprite.material as THREE.SpriteMaterial;
        for (let k = projections.length; k < desiredProjections; k++) {
          const proj = new THREE.Sprite(material);
          proj.userData.pointId = point.id;
          projections.push(proj);
          entry!.group.add(proj);
        }
      } else if (projections.length > desiredProjections) {
        const removed = projections.splice(desiredProjections);
        removed.forEach((proj) => entry!.group.remove(proj));
      }

      const pointEntry = entry!;
      if (props.viewMode === "astral") {
        const astralChunks = computeAstralChunks(props.visibleAxisIds);
        const rots = astralChunks.map((c) => astralRotation(c.index, 0));
        const positions = astralChunks.map((chunk, k) =>
          astralChunkPosition(point.coordinate, chunk, rots[k])
        );
        pointEntry.group.position.copy(positions[0]);
        pointEntry.sprite.position.set(0, 0, 0);
        pointEntry.projections.forEach((proj, k) => {
          proj.position.copy(positions[k + 1].clone().sub(positions[0]));
        });
      } else {
        pointEntry.group.position.copy(coordToWorldDirs(point.coordinate, pointDirs));
      }
    }

    // Remove stale entries.
    entries.forEach((entry, id) => {
      if (!seen.has(id)) {
        scene.remove(entry.group);
        entries.delete(id);
      }
    });
  }, [
    props.points,
    props.activeAxisIds,
    props.selectedPointId,
    props.viewMode,
    props.visibleAxisIds,
  ]);



  const selectedPoint = props.points.find((p) => p.id === props.selectedPointId);
  const targetCoord = props.pendingCoordinate || selectedPoint?.coordinate;
  let tooltipTitle = "SELECTED";
  if (props.pendingCoordinate) {
    tooltipTitle = "NEW POINT";
  } else if (selectedPoint?.isOrigin) {
    tooltipTitle = "ORIGIN";
  }
  const inactiveAxes = props.axes.filter((a) => !props.activeAxisIds.includes(a.id));
  const hasGizmo = inactiveAxes.length > 0;
  const showGizmoOffset = props.pendingCoordinate && hasGizmo;

  return (
    <>
      <div ref={containerRef} className="scene-container" />
      <div
        ref={gizmoOverlayRef}
        className="gizmo-overlay"
        style={{ display: "none" }}
      >
        {props.pendingCoordinate && props.mode === "click" && (
          <RadialGizmo
            axes={props.axes}
            activeAxisIds={props.activeAxisIds}
            coordinate={props.pendingCoordinate}
            onChange={props.onPendingCoordinateChange!}
            onConfirm={props.onConfirmPending!}
            onCancel={props.onCancelPending!}
          />
        )}
      </div>
      <div
        ref={generatingOverlaysRef}
        className="generating-overlays-container"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {props.points
          .filter((p) => p.status === "generating")
          .map((p) => (
            <div
              key={p.id}
              data-generating-id={p.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 128,
                height: 128,
                transformOrigin: "center center",
                willChange: "transform",
                pointerEvents: "auto",
                cursor: "pointer",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (props.onSelectPoint) props.onSelectPoint(p.id);
              }}
            >
              <GeneratingLoader />
            </div>
          ))}
      </div>
      <div
        ref={selectedPointOverlayRef}
        className="selected-point-overlay"
        style={{ display: "none" }}
      >
        {targetCoord && (
          <div className={`selected-point-tooltip${showGizmoOffset ? " has-gizmo" : ""}${props.points.find(p => p.id === props.selectedPointId)?.status === "generating" ? " is-generating" : ""}`}>
            <div className="tooltip-title">
              {tooltipTitle}
            </div>
            <div className="tooltip-coords">
              {props.axes.map((axis) => {
                const v = axisValue(targetCoord, axis.id);
                const isActive = props.activeAxisIds.includes(axis.id);
                let poleLabel = "";
                if (v > 0) {
                  poleLabel = axis.positivePole;
                } else if (v < 0) {
                  poleLabel = axis.negativePole;
                } else {
                  poleLabel = `${axis.negativePole}/${axis.positivePole}`;
                }
                return (
                  <div
                    key={axis.id}
                    className={`tooltip-row ${isActive ? "active" : ""}`}
                  >
                    <span className="tooltip-pole">{poleLabel}</span>
                    <span className="tooltip-value">
                      {v > 0 ? "+" : ""}
                      {v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
