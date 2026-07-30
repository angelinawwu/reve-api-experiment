"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ControlPanel } from "@/components/ControlPanel";
import { createOriginImage, remixImage } from "@/lib/api";
import {
  buildRemixInstruction,
  findCachedPoint,
  findNearestReference,
  formatCoord,
  hashCoord,
  makeId,
  normalizeCoord,
} from "@/lib/space";
import {
  Axis,
  AxisId,
  Coordinate,
  InteractionMode,
  SliceAxisIds,
  VibePoint,
} from "@/lib/types";

const VibeScene = dynamic(
  () => import("@/components/VibeScene").then((m) => m.VibeScene),
  { ssr: false }
);

const DEFAULT_AXES: Axis[] = [
  { id: "axis-good-evil", positivePole: "good", negativePole: "evil", source: "default" },
  { id: "axis-lawful-chaotic", positivePole: "lawful", negativePole: "chaotic", source: "default" },
];

export default function Home() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [points, setPoints] = useState<VibePoint[]>([]);
  const [activeAxisIds, setActiveAxisIds] = useState<SliceAxisIds | null>(null);
  const [mode, setMode] = useState<InteractionMode>("click");
  const [pendingCoordinate, setPendingCoordinate] = useState<Coordinate | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [cursorCoordinate, setCursorCoordinate] = useState<Coordinate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const pointsRef = useRef<VibePoint[]>(points);
  pointsRef.current = points;
  const axesRef = useRef<Axis[]>(axes);
  axesRef.current = axes;
  const inFlightRef = useRef<Set<string>>(new Set());

  const started = activeAxisIds !== null;

  // ---- startup: origin image + default dimensions ---------------------------
  const handleCreateOrigin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || creating) return;
    setCreating(true);
    setGlobalError(null);
    try {
      const url = await createOriginImage(prompt.trim());
      const origin: VibePoint = {
        id: makeId("pt"),
        coordinate: {},
        imageUrl: url,
        status: "ready",
        isOrigin: true,
      };
      setPoints([origin]);
      setAxes(DEFAULT_AXES);
      setActiveAxisIds([DEFAULT_AXES[0].id, DEFAULT_AXES[1].id]);
      setSelectedPointId(origin.id);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  // ---- point generation -------------------------------------------------------
  const generatePoint = useCallback(async (rawCoord: Coordinate) => {
    const coord = normalizeCoord(rawCoord);
    const hash = hashCoord(coord);
    if (inFlightRef.current.has(hash)) return;

    // First-class cache: reuse any point within epsilon instead of regenerating.
    const cached = findCachedPoint(pointsRef.current, coord);
    if (cached) {
      setSelectedPointId(cached.id);
      return;
    }

    const reference = findNearestReference(pointsRef.current, coord);
    if (!reference?.imageUrl) return;

    const instruction = buildRemixInstruction(
      axesRef.current,
      reference.coordinate,
      coord
    );

    const id = makeId("pt");
    const placeholder: VibePoint = {
      id,
      coordinate: coord,
      imageUrl: null,
      status: "generating",
      isOrigin: false,
    };
    inFlightRef.current.add(hash);
    setPoints((prev) => [...prev, placeholder]);

    try {
      const url = await remixImage(reference.imageUrl, instruction);
      setPoints((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, imageUrl: url, status: "ready" as const } : p
        )
      );
    } catch (err) {
      setPoints((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Remix failed",
              }
            : p
        )
      );
    } finally {
      inFlightRef.current.delete(hash);
    }
  }, []);

  // Click mode: stage a coordinate, wait for confirmation.
  const handlePlace = useCallback((coord: Coordinate) => {
    setPendingCoordinate(coord);
    setSelectedPointId(null);
  }, []);

  // Walk mode: fire directly on drag-stop (already debounced in the scene).
  const handleWalkSample = useCallback(
    (coord: Coordinate) => {
      void generatePoint(coord);
    },
    [generatePoint]
  );

  const confirmPending = () => {
    if (pendingCoordinate) {
      void generatePoint(pendingCoordinate);
      setPendingCoordinate(null);
    }
  };

  // ---- dimension management ----------------------------------------------------
  const handleAddAxis = (positivePole: string, negativePole: string) => {
    const axis: Axis = {
      id: makeId("axis"),
      positivePole,
      negativePole,
      source: "manual",
    };
    setAxes((prev) => [...prev, axis]);
    // If we're on a 2D plane, promote the new axis into the Z slot.
    setActiveAxisIds((prev) =>
      prev && prev.length === 2 ? [prev[0], prev[1], axis.id] : prev
    );
  };

  const handleRenameAxis = (id: AxisId, positivePole: string, negativePole: string) => {
    setAxes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, positivePole, negativePole } : a))
    );
  };

  const handleRemoveAxis = (id: AxisId) => {
    const remaining = axes.filter((a) => a.id !== id);
    if (remaining.length < 2) return;
    setAxes(remaining);
    // Strip the axis from every point's coordinate.
    setPoints((prev) =>
      prev.map((p) => {
        if (!(id in p.coordinate)) return p;
        const coordinate = { ...p.coordinate };
        delete coordinate[id];
        return { ...p, coordinate };
      })
    );
    // Repair the active slice.
    setActiveAxisIds((prev) => {
      if (!prev) return prev;
      const filled = prev.filter((a) => a !== id);
      if (filled.length >= 2) {
        return filled.length === 3
          ? [filled[0], filled[1], filled[2]]
          : [filled[0], filled[1]];
      }
      const substitute = remaining.find((a) => !filled.includes(a.id));
      return substitute ? [filled[0], substitute.id] : prev;
    });
  };

  // ---- point management ----------------------------------------------------------
  const handleRepositionPoint = (pointId: string, axisId: AxisId, value: number) => {
    setPoints((prev) =>
      prev.map((p) =>
        p.id === pointId
          ? {
              ...p,
              coordinate: normalizeCoord({ ...p.coordinate, [axisId]: value }),
            }
          : p
      )
    );
  };

  const handleDeletePoint = (pointId: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== pointId || p.isOrigin));
    setSelectedPointId((prev) => (prev === pointId ? null : prev));
  };

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPointId) ?? null,
    [points, selectedPointId]
  );

  const generatingCount = points.filter((p) => p.status === "generating").length;

  // ---- render ----------------------------------------------------------------------
  if (!started) {
    return (
      <main className="genesis">
        <div className="genesis-frame">
          <p className="genesis-kicker">VIBE SPACE / 3D</p>
          <h1 className="genesis-title">DEFINE THE ORIGIN</h1>
          <p className="genesis-sub">
            One image anchors the space at coordinate zero. Every other point is
            a remix of it, placed along the dimensions you define.
          </p>
          <form className="genesis-form" onSubmit={handleCreateOrigin}>
            <input
              className="field genesis-input"
              placeholder="a taxidermied crow wearing a tiny crown"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              autoFocus
              disabled={creating}
            />
            <button
              className="btn-solid"
              type="submit"
              disabled={creating || !prompt.trim()}
            >
              {creating ? "GENERATING…" : "GENERATE ORIGIN"}
            </button>
          </form>
          {globalError && <p className="error-text">{globalError}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="workspace">
      <ControlPanel
        axes={axes}
        activeAxisIds={activeAxisIds}
        mode={mode}
        points={points}
        selectedPoint={selectedPoint}
        onAddAxis={handleAddAxis}
        onRenameAxis={handleRenameAxis}
        onRemoveAxis={handleRemoveAxis}
        onChangeSlice={setActiveAxisIds}
        onChangeMode={(m) => {
          setMode(m);
          setPendingCoordinate(null);
        }}
        onRepositionPoint={handleRepositionPoint}
        onDeletePoint={handleDeletePoint}
      />

      <div className="viewport">
        <VibeScene
          axes={axes}
          activeAxisIds={activeAxisIds}
          points={points}
          mode={mode}
          pendingCoordinate={pendingCoordinate}
          selectedPointId={selectedPointId}
          onPlace={handlePlace}
          onWalkSample={handleWalkSample}
          onSelectPoint={setSelectedPointId}
          onCursorCoordinate={setCursorCoordinate}
        />

        {/* Coordinate readout */}
        <div className="hud-readout">
          {cursorCoordinate
            ? formatCoord(cursorCoordinate, axes, activeAxisIds)
            : "—"}
        </div>

        {/* Generation status */}
        {generatingCount > 0 && (
          <div className="hud-status">
            GENERATING {generatingCount} POINT{generatingCount > 1 ? "S" : ""}…
          </div>
        )}

        {/* Pending placement confirmation */}
        {pendingCoordinate && (
          <div className="confirm-card">
            <p className="confirm-coord">
              {formatCoord(pendingCoordinate, axes, activeAxisIds)}
            </p>
            <div className="confirm-actions">
              <button className="btn-solid" onClick={confirmPending}>
                GENERATE HERE
              </button>
              <button
                className="btn-ghost"
                onClick={() => setPendingCoordinate(null)}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
