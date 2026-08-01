"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ControlPanel } from "@/components/ControlPanel";
import { GeneratingLoader } from "@/components/GeneratingLoader";
import { ViewSwitcher } from "@/components/ViewSwitcher";
import { createOriginImage, remixImage } from "@/lib/api";
import {
  buildRemixInstruction,
  findCachedPoint,
  findNearestReference,
  formatCoord,
  hashCoord,
  makeId,
  axisValue,
  normalizeCoord,
} from "@/lib/space";
import {
  Axis,
  AxisId,
  Coordinate,
  InteractionMode,
  SliceAxisIds,
  ImagePoint,
  ViewMode,
} from "@/lib/types";

const ImageSpaceScene = dynamic(
  () => import("@/components/ImageSpaceScene").then((m) => m.ImageSpaceScene),
  { ssr: false }
);

const DEFAULT_AXES: Axis[] = [
  { id: "axis-good-evil", positivePole: "good", negativePole: "evil", source: "default" },
  { id: "axis-lawful-chaotic", positivePole: "lawful", negativePole: "chaotic", source: "default" },
];

export default function Home() {
  const [axes, setAxes] = useState<Axis[]>(DEFAULT_AXES);
  const [points, setPoints] = useState<ImagePoint[]>([]);
  const [activeAxisIds, setActiveAxisIds] = useState<SliceAxisIds | null>([DEFAULT_AXES[0].id, DEFAULT_AXES[1].id]);
  const [mode, setMode] = useState<InteractionMode>("click");
  const [viewMode, setViewMode] = useState<ViewMode>("slice");
  const [hiddenAxisIds, setHiddenAxisIds] = useState<AxisId[]>([]);
  const [pendingCoordinate, setPendingCoordinate] = useState<Coordinate | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [cursorCoordinate, setCursorCoordinate] = useState<Coordinate | null>(null);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const pointsRef = useRef<ImagePoint[]>(points);
  pointsRef.current = points;
  const axesRef = useRef<Axis[]>(axes);
  axesRef.current = axes;
  const inFlightRef = useRef<Set<string>>(new Set());

  const handleCreateOrigin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || creating) return;
    setCreating(true);
    setGlobalError(null);
    try {
      const url = await createOriginImage(prompt.trim());
      const origin: ImagePoint = {
        id: makeId("pt"),
        coordinate: {},
        imageUrl: url,
        status: "ready",
        isOrigin: true,
      };
      setPoints([origin]);
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
    const placeholder: ImagePoint = {
      id,
      coordinate: coord,
      imageUrl: null,
      status: "generating",
      isOrigin: false,
    };
    inFlightRef.current.add(hash);
    setPoints((prev) => [...prev, placeholder]);
    setSelectedPointId(id);

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
    setHiddenAxisIds((prev) => prev.filter((a) => a !== id));
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

  const visibleAxisIds = useMemo(
    () => axes.filter((a) => !hiddenAxisIds.includes(a.id)).map((a) => a.id),
    [axes, hiddenAxisIds]
  );

  const handleChangeViewMode = (m: ViewMode) => {
    setViewMode(m);
    setPendingCoordinate(null);
  };

  const handleToggleAxisVisibility = (id: AxisId) => {
    setHiddenAxisIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  // ---- render ----------------------------------------------------------------------


  return (
    <main className="workspace">
      <ControlPanel
        axes={axes}
        activeAxisIds={activeAxisIds!}
        mode={mode}
        points={points}
        onAddAxis={handleAddAxis}
        onRenameAxis={handleRenameAxis}
        onRemoveAxis={handleRemoveAxis}
        onChangeSlice={setActiveAxisIds}
        onChangeMode={(m) => {
          setMode(m);
          setPendingCoordinate(null);
        }}
      />

      <div className="viewport">
        <ImageSpaceScene
          axes={axes}
          activeAxisIds={activeAxisIds!}
          points={points}
          mode={mode}
          viewMode={viewMode}
          visibleAxisIds={visibleAxisIds}
          pendingCoordinate={pendingCoordinate}
          selectedPointId={selectedPointId}
          onPlace={handlePlace}
          onWalkSample={handleWalkSample}
          onSelectPoint={setSelectedPointId}
          onCursorCoordinate={setCursorCoordinate}
          onPendingCoordinateChange={setPendingCoordinate}
          onConfirmPending={confirmPending}
          onCancelPending={() => setPendingCoordinate(null)}
        />

        {points.length === 0 && (
          <div className="origin-prompt-card animate-[prompt-enter_0.6s_cubic-bezier(0.19,1,0.22,1)_both]">
            <h2>DEFINE THE ORIGIN</h2>
            <p>
              One image anchors the space at coordinate zero. Every other point is a remix of it.
            </p>
            <form onSubmit={handleCreateOrigin}>
              <input
                className="field bg-[#0a0a0a]"
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
            {globalError && <p className="mt-4 text-xs text-red-500">{globalError}</p>}
          </div>
        )}

        {/* Coordinate readout */}
        <div className="hud-readout">
          {cursorCoordinate
            ? formatCoord(cursorCoordinate, axes, activeAxisIds!)
            : "—"}
        </div>

        <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
          <ViewSwitcher
            viewMode={viewMode}
            axes={axes}
            hiddenAxisIds={hiddenAxisIds}
            onChangeViewMode={handleChangeViewMode}
            onToggleAxisVisibility={handleToggleAxisVisibility}
          />
        </div>

        {selectedPoint && (
          <div className="selected-point-floating">
            <h2 className="section-label">
              {selectedPoint.isOrigin ? "ORIGIN POINT" : "POINT"}
            </h2>
            <div className="relative">
              {selectedPoint.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="inspector-image"
                  src={selectedPoint.imageUrl}
                  alt="Selected point"
                />
              ) : (
                <div className="inspector-image relative">
                  {selectedPoint.status === "generating" && (
                    <GeneratingLoader />
                  )}
                </div>
              )}
            </div>
            <div className="inspector-coords">
              {axes.map((axis) => {
                const v = axisValue(selectedPoint.coordinate, axis.id);
                return (
                  <div className="coord-row" key={axis.id}>
                    <span className="coord-pole coord-pole-left">
                      {axis.negativePole}
                    </span>
                    <input
                      type="range"
                      className="coord-slider"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={v}
                      disabled={selectedPoint.isOrigin}
                      onChange={(e) =>
                        handleRepositionPoint(
                          selectedPoint.id,
                          axis.id,
                          parseFloat(e.target.value)
                        )
                      }
                    />
                    <span className="coord-pole coord-pole-right">
                      {axis.positivePole}
                    </span>
                    <span className="coord-value">
                      {v >= 0 ? "+" : ""}
                      {v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            {selectedPoint.isOrigin ? (
              <p className="hint">The origin is fixed at the zero coordinate.</p>
            ) : (
              <>
                <p className="hint">
                  Repositioning calibrates metadata only. The point is not regenerated.
                </p>
                <button
                  className="btn-ghost btn-danger"
                  style={{ marginTop: 10 }}
                  onClick={() => handleDeletePoint(selectedPoint.id)}
                >
                  DELETE POINT
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
