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
      pointEntriesRef.current.forEach((entry) => sprites.push(entry.sprite));
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
    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      controls.update();
      
      const propsNow = propsRef.current;
      const marker = pendingMarkerRef.current;
      if (marker) {
        if (propsNow.pendingCoordinate) {
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
          const worldPos = coordToWorld(targetCoord, propsNow.activeAxisIds);
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
    const is3D = props.activeAxisIds.length === 3;
    controls.enableRotate = props.mode === "click" && is3D;
    renderer.domElement.style.cursor =
      props.mode === "walk" ? "crosshair" : is3D ? "grab" : "crosshair";
  }, [props.mode, props.activeAxisIds]);

  // ---- camera reset when dimensionality changes ------------------------------
  const dimCount = props.activeAxisIds.length;
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (dimCount === 2) {
      camera.position.set(0, 0, 6.2);
    } else {
      camera.position.set(3.4, 2.5, 4.2);
    }
    controls.target.set(0, 0, 0);
    controls.update();
    const scene = sceneRef.current;
    const frame = scene?.getObjectByName("volume-frame");
    if (frame) frame.visible = dimCount === 3;
  }, [dimCount]);

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
    const dirs = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    props.activeAxisIds.forEach((axisId, i) => {
      const axis = props.axes.find((a) => a.id === axisId);
      if (!axis) return;
      const dir = dirs[i];
      const ext = WORLD * AXIS_OVERHANG;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-ext),
        dir.clone().multiplyScalar(ext),
      ]);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: COLOR_AXIS })
      );
      group.add(line);

      // Unit tick marks at ±1.
      for (const s of [-1, 1]) {
        const tickGeo = new THREE.BufferGeometry().setFromPoints([
          dir.clone().multiplyScalar(s * WORLD),
          dir
            .clone()
            .multiplyScalar(s * WORLD)
            .add(new THREE.Vector3(0.05, 0.05, 0.05)),
        ]);
        group.add(
          new THREE.Line(
            tickGeo,
            new THREE.LineBasicMaterial({ color: COLOR_AXIS })
          )
        );
      }

      const posLabel = makeLabelSprite(axis.positivePole);
      posLabel.position.copy(dir.clone().multiplyScalar(ext + 0.32));
      group.add(posLabel);
      const negLabel = makeLabelSprite(axis.negativePole, { dim: true });
      negLabel.position.copy(dir.clone().multiplyScalar(-(ext + 0.32)));
      group.add(negLabel);
    });
    scene.add(group);
    axesGroupRef.current = group;
  }, [props.axes, props.activeAxisIds]);

  // ---- points -----------------------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const entries = pointEntriesRef.current;
    const seen = new Set<string>();

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
        entries.set(point.id, { group, sprite, key });
      }

      entries
        .get(point.id)!
        .group.position.copy(
          coordToWorld(point.coordinate, props.activeAxisIds)
        );
    }

    // Remove stale entries.
    entries.forEach((entry, id) => {
      if (!seen.has(id)) {
        scene.remove(entry.group);
        entries.delete(id);
      }
    });
  }, [props.points, props.activeAxisIds, props.selectedPointId]);



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
          <div className={`selected-point-tooltip${showGizmoOffset ? " has-gizmo" : ""}`}>
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
