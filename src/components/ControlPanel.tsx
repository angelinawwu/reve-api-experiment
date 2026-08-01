"use client";

import React, { useState } from "react";
import { Eye, EyeClosed, Pencil, Trash } from "@phosphor-icons/react";
import { GeneratingLoader } from "./GeneratingLoader";
import {
  Axis,
  AxisId,
  InteractionMode,
  SliceAxisIds,
  ImagePoint,
} from "@/lib/types";
import { axisValue } from "@/lib/space";

interface ControlPanelProps {
  axes: Axis[];
  activeAxisIds: SliceAxisIds;
  mode: InteractionMode;
  points: ImagePoint[];
  selectedPoint: ImagePoint | null;
  onAddAxis: (positivePole: string, negativePole: string) => void;
  onRenameAxis: (id: AxisId, positivePole: string, negativePole: string) => void;
  onRemoveAxis: (id: AxisId) => void;
  onChangeSlice: (ids: SliceAxisIds) => void;
  onChangeMode: (mode: InteractionMode) => void;
  onRepositionPoint: (pointId: string, axisId: AxisId, value: number) => void;
  onDeletePoint: (pointId: string) => void;
}

function AxisRow({
  axis,
  isActive,
  canToggleOn,
  canToggleOff,
  onToggle,
  onRename,
  onRemove,
  removable,
}: {
  axis: Axis;
  isActive: boolean;
  canToggleOn: boolean;
  canToggleOff: boolean;
  onToggle: () => void;
  onRename: (pos: string, neg: string) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pos, setPos] = useState(axis.positivePole);
  const [neg, setNeg] = useState(axis.negativePole);

  if (editing) {
    return (
      <form
        className="axis-row axis-row-editing bg-[#0a0a0a]"
        onSubmit={(e) => {
          e.preventDefault();
          if (pos.trim() && neg.trim()) {
            onRename(pos.trim(), neg.trim());
            setEditing(false);
          }
        }}
      >
        <input
          className="field field-compact bg-[#0a0a0a]"
          value={neg}
          onChange={(e) => setNeg(e.target.value)}
          aria-label="Negative pole"
        />
        <span className="axis-sep">/</span>
        <input
          className="field field-compact bg-[#0a0a0a]"
          value={pos}
          onChange={(e) => setPos(e.target.value)}
          aria-label="Positive pole"
        />
        <button type="submit" className="btn-ghost" title="Save">
          OK
        </button>
      </form>
    );
  }

  return (
    <div className="axis-row bg-[#0a0a0a]">
      <span className="axis-name">
        {axis.negativePole}
        <span className="axis-sep">/</span>
        {axis.positivePole}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: "2px" }}>
        <button
          className="btn-ghost btn-icon"
          onClick={onToggle}
          disabled={isActive ? !canToggleOff : !canToggleOn}
          title={isActive ? (canToggleOff ? "Hide dimension" : "At least 2 dimensions must be visible") : (canToggleOn ? "Show dimension" : "Maximum of 3 dimensions can be visible")}
        >
          {isActive ? <Eye size={16} /> : <EyeClosed size={16} />}
        </button>
        <button
          className="btn-ghost btn-icon"
          onClick={() => {
            setPos(axis.positivePole);
            setNeg(axis.negativePole);
            setEditing(true);
          }}
          title="Rename"
        >
          <Pencil size={16} />
        </button>
        <button
          className="btn-ghost btn-icon btn-danger"
          onClick={onRemove}
          disabled={!removable}
          title={removable ? "Delete dimension" : "At least 2 dimensions required"}
        >
          <Trash size={16} />
        </button>
      </div>
    </div>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const [newPos, setNewPos] = useState("");
  const [newNeg, setNewNeg] = useState("");
  const is3D = props.activeAxisIds.length === 3;

  const handleToggleAxis = (axisId: AxisId) => {
    const isActive = props.activeAxisIds.includes(axisId);
    if (isActive) {
      if (props.activeAxisIds.length <= 2) return;
      const newSlice = props.activeAxisIds.filter((id) => id !== axisId);
      props.onChangeSlice(
        newSlice.length === 3
          ? [newSlice[0], newSlice[1], newSlice[2]]
          : [newSlice[0], newSlice[1]]
      );
    } else {
      if (props.activeAxisIds.length >= 3) return;
      const newSlice = [...props.activeAxisIds, axisId];
      props.onChangeSlice(
        newSlice.length === 3
          ? [newSlice[0], newSlice[1], newSlice[2]]
          : [newSlice[0], newSlice[1]]
      );
    }
  };

  return (
    <aside className="panel bg-[#121212]">
      <header className="panel-header">
        <h1 className="panel-title">IMAGESPACE</h1>
        <span className="panel-meta">
          {props.axes.length}D · {props.points.length} PT
        </span>
      </header>

      {/* Mode */}
      <section className="panel-section">
        <h2 className="section-label">MODE</h2>
        <div className="segmented">
          <button
            className={`seg ${props.mode === "click" ? "bg-white/12 text-white" : ""}`}
            onClick={() => props.onChangeMode("click")}
          >
            CLICK
          </button>
          <button
            className={`seg ${props.mode === "walk" ? "bg-white/12 text-white" : ""}`}
            onClick={() => props.onChangeMode("walk")}
          >
            WALK
          </button>
        </div>
        <p className="hint">
          {props.mode === "click"
            ? is3D
              ? "Click to place a point. Drag empty space to orbit."
              : "Click anywhere on the plane to place a point."
            : "Drag through the space — a point generates each time motion pauses."}
        </p>
      </section>

      {/* Dimensions */}
      <section className="panel-section">
        <h2 className="section-label">DIMENSIONS</h2>
        <div className="axis-list">
          {props.axes.map((axis) => {
            const isActive = props.activeAxisIds.includes(axis.id);
            const canToggleOn = props.activeAxisIds.length < 3;
            const canToggleOff = props.activeAxisIds.length > 2;
            return (
              <AxisRow
                key={axis.id}
                axis={axis}
                isActive={isActive}
                canToggleOn={canToggleOn}
                canToggleOff={canToggleOff}
                onToggle={() => handleToggleAxis(axis.id)}
                removable={props.axes.length > 2}
                onRename={(pos, neg) => props.onRenameAxis(axis.id, pos, neg)}
                onRemove={() => props.onRemoveAxis(axis.id)}
              />
            );
          })}
        </div>
        <form
          className="axis-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (newPos.trim() && newNeg.trim()) {
              props.onAddAxis(newPos.trim(), newNeg.trim());
              setNewPos("");
              setNewNeg("");
            }
          }}
        >
          <input
            className="field field-compact bg-[#0a0a0a]"
            placeholder="negative pole"
            value={newNeg}
            onChange={(e) => setNewNeg(e.target.value)}
          />
          <span className="axis-sep">/</span>
          <input
            className="field field-compact bg-[#0a0a0a]"
            placeholder="positive pole"
            value={newPos}
            onChange={(e) => setNewPos(e.target.value)}
          />
          <button
            type="submit"
            className="btn-ghost btn-accent"
            disabled={!newPos.trim() || !newNeg.trim()}
          >
            ADD
          </button>
        </form>
        <p className="hint">Adding a dimension never generates an image.</p>
      </section>

      {/* Selected point inspector */}
      {props.selectedPoint && (
        <section className="panel-section">
          <h2 className="section-label">
            {props.selectedPoint.isOrigin ? "ORIGIN POINT" : "POINT"}
          </h2>
          <div className="inspector-image-container relative mb-4">
              {props.selectedPoint.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="inspector-image w-full h-auto block rounded-lg bg-frame"
                  src={props.selectedPoint.imageUrl}
                  alt="Selected point"
                />
              ) : (
                <div className="inspector-image w-full aspect-square rounded-lg bg-frame overflow-hidden relative">
                  {props.selectedPoint.status === "generating" && (
                    <GeneratingLoader />
                  )}
                </div>
              )}
          </div>
          <div className="inspector-coords">
            {props.axes.map((axis) => {
              const v = axisValue(props.selectedPoint!.coordinate, axis.id);
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
                    disabled={props.selectedPoint!.isOrigin}
                    onChange={(e) =>
                      props.onRepositionPoint(
                        props.selectedPoint!.id,
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
          {props.selectedPoint.isOrigin ? (
            <p className="hint">The origin is fixed at the zero coordinate.</p>
          ) : (
            <>
              <p className="hint">
                Repositioning calibrates metadata only. The point is not regenerated.
              </p>
              <button
                className="btn-ghost btn-danger"
                style={{ marginTop: 10 }}
                onClick={() => props.onDeletePoint(props.selectedPoint!.id)}
              >
                DELETE POINT
              </button>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
