"use client";

import React, { useRef, useEffect } from "react";
import { Axis, Coordinate, SliceAxisIds } from "@/lib/types";
import { axisValue } from "@/lib/space";

interface RadialGizmoProps {
  axes: Axis[];
  activeAxisIds: SliceAxisIds;
  coordinate: Coordinate;
  onChange: (coord: Coordinate) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const RADIUS = 80;

function Petal({
  axis,
  value,
  angle,
  onChange,
}: {
  axis: Axis;
  value: number;
  angle: number;
  onChange: (val: number) => void;
}) {
  const lineRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = lineRef.current;
    if (!el) return;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const hub = el.closest(".radial-gizmo-hub");
      if (!hub) return;
      const hubRect = hub.getBoundingClientRect();
      const cx = hubRect.left + hubRect.width / 2;
      const cy = hubRect.top + hubRect.height / 2;

      const dx = moveEvent.clientX - cx;
      const dy = moveEvent.clientY - cy;

      const petalDx = Math.cos(angle);
      const petalDy = Math.sin(angle);

      const projection = dx * petalDx + dy * petalDy;
      let val = projection / RADIUS;
      val = Math.max(-1, Math.min(1, val));
      onChange(val);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    // Also trigger immediately for click-to-move
    onPointerMove(e.nativeEvent);
  };

  return (
    <div
      className="gizmo-petal-container"
      style={{
        transform: `rotate(${angle}rad)`,
      }}
    >
      <div
        className="gizmo-petal-line"
        ref={lineRef}
        onPointerDown={handlePointerDown}
      >
        <div className="gizmo-petal-track" />
        <div
          className="gizmo-petal-handle"
          style={{ transform: `translate(${value * RADIUS}px, -50%)` }}
        />
        <div className="gizmo-petal-label neg-pole">{axis.negativePole}</div>
        <div className="gizmo-petal-label pos-pole">{axis.positivePole}</div>
      </div>
    </div>
  );
}

function chunkAxes(axes: Axis[]): Axis[][] {
  const chunks: Axis[][] = [];
  const remaining = [...axes];
  while (remaining.length > 0) {
    if (remaining.length === 4) {
      // 4 must be split as 2, 2 to avoid leaving a dimension alone
      chunks.push(remaining.splice(0, 2));
    } else if (remaining.length >= 3) {
      chunks.push(remaining.splice(0, 3));
    } else if (remaining.length === 2) {
      chunks.push(remaining.splice(0, 2));
    } else {
      chunks.push(remaining.splice(0, remaining.length));
    }
  }
  return chunks;
}

export function RadialGizmo({
  axes,
  activeAxisIds,
  coordinate,
  onChange,
  onConfirm,
  onCancel,
}: RadialGizmoProps) {
  const inactiveAxes = axes.filter((a) => !activeAxisIds.includes(a.id));
  const chunks = chunkAxes(inactiveAxes);

  // Block clicks from passing through the gizmo actions back to the ThreeJS canvas
  const blockEvents = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="radial-gizmo-wrapper" onPointerDown={blockEvents}>
      <div className="gizmo-hubs-container" style={{ position: "relative" }}>
        {chunks.map((chunk, chunkIdx) => {
          const offsetX = chunkIdx * 160;
          const offsetY = chunkIdx * -160;
          const distance = Math.sqrt(160 * 160 * 2);

          return (
            <div
              className="radial-gizmo-hub"
              key={chunkIdx}
              style={{
                position: chunkIdx === 0 ? "relative" : "absolute",
                left: offsetX,
                top: offsetY,
              }}
            >
              {chunkIdx > 0 && (
                <div
                  className="gizmo-connector"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: distance,
                    height: 1,
                    borderTop: "1px dashed rgba(255, 255, 255, 0.4)",
                    transformOrigin: "0 0",
                    transform: "rotate(135deg)",
                    zIndex: -1,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: distance / 2,
                      top: -4,
                      width: 8,
                      height: 8,
                      borderTop: "1px solid rgba(255,255,255,0.8)",
                      borderRight: "1px solid rgba(255,255,255,0.8)",
                      transform: "rotate(225deg)",
                    }}
                  />
                </div>
              )}

              <div className="gizmo-center-dot" />

              {chunk.map((axis, i) => {
                // Spread evenly over a half-circle (Math.PI) to create a starburst.
                // Because each petal is a full line (drawn from -radius to +radius),
                // distributing them over 180 degrees prevents them from overlapping.
                const angle = -Math.PI / 2 + (i / chunk.length) * Math.PI;
                const val = axisValue(coordinate, axis.id);
                return (
                  <Petal
                    key={axis.id}
                    axis={axis}
                    value={val}
                    angle={angle}
                    onChange={(newVal) =>
                      onChange({ ...coordinate, [axis.id]: newVal })
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="gizmo-actions">
        <button className="btn-solid" onClick={onConfirm}>
          GENERATE
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
