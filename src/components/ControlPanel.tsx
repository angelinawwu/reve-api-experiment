"use client";

import React, { useState } from "react";
import {
  Axis,
  AxisId,
  InteractionMode,
  SliceAxisIds,
  VibePoint,
} from "@/lib/types";
import { axisValue } from "@/lib/space";

interface ControlPanelProps {
  axes: Axis[];
  activeAxisIds: SliceAxisIds;
  mode: InteractionMode;
  points: VibePoint[];
  selectedPoint: VibePoint | null;
  onAddAxis: (positivePole: string, negativePole: string) => void;
  onRenameAxis: (id: AxisId, positivePole: string, negativePole: string) => void;
  onRemoveAxis: (id: AxisId) => void;
  onChangeSlice: (ids: SliceAxisIds) => void;
  onChangeMode: (mode: InteractionMode) => void;
  onRepositionPoint: (pointId: string, axisId: AxisId, value: number) => void;
  onDeletePoint: (pointId: string) => void;
}

const SLOT_LABELS = ["X", "Y", "Z"] as const;

function AxisRow({
  axis,
  onRename,
  onRemove,
  removable,
}: {
  axis: Axis;
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
        className="axis-row axis-row-editing"
        onSubmit={(e) => {
          e.preventDefault();
          if (pos.trim() && neg.trim()) {
            onRename(pos.trim(), neg.trim());
            setEditing(false);
          }
        }}
      >
        <input
          className="field field-compact"
          value={pos}
          onChange={(e) => setPos(e.target.value)}
          aria-label="Positive pole"
        />
        <span className="axis-sep">/</span>
        <input
          className="field field-compact"
          value={neg}
          onChange={(e) => setNeg(e.target.value)}
          aria-label="Negative pole"
        />
        <button type="submit" className="btn-ghost" title="Save">
          OK
        </button>
      </form>
    );
  }

  return (
    <div className="axis-row">
      <span className="axis-name">
        {axis.positivePole}
        <span className="axis-sep">/</span>
        {axis.negativePole}
      </span>
      {axis.source === "default" && <span className="axis-tag">DEF</span>}
      <button
        className="btn-ghost"
        onClick={() => {
          setPos(axis.positivePole);
          setNeg(axis.negativePole);
          setEditing(true);
        }}
        title="Rename"
      >
        EDIT
      </button>
      <button
        className="btn-ghost btn-danger"
        onClick={onRemove}
        disabled={!removable}
        title={removable ? "Delete dimension" : "At least 2 dimensions required"}
      >
        DEL
      </button>
    </div>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const [newPos, setNewPos] = useState("");
  const [newNeg, setNewNeg] = useState("");
  const is3D = props.activeAxisIds.length === 3;

  const handleSlotChange = (slot: number, value: string) => {
    const current: (AxisId | null)[] = [
      props.activeAxisIds[0],
      props.activeAxisIds[1],
      props.activeAxisIds.length === 3 ? props.activeAxisIds[2] : null,
    ];
    current[slot] = value === "" ? null : value;
    // De-duplicate: a given axis can only occupy one slot.
    for (let i = 0; i < 3; i++) {
      if (i !== slot && current[i] === value && value !== "") current[i] = null;
    }
    const filled = current.filter((id): id is AxisId => id !== null);
    if (filled.length >= 2) {
      props.onChangeSlice(
        filled.length >= 3
          ? [filled[0], filled[1], filled[2]]
          : [filled[0], filled[1]]
      );
    }
  };

  return (
    <aside className="panel">
      <header className="panel-header">
        <h1 className="panel-title">VIBE SPACE</h1>
        <span className="panel-meta">
          {props.axes.length}D · {props.points.length} PT
        </span>
      </header>

      {/* Mode */}
      <section className="panel-section">
        <h2 className="section-label">MODE</h2>
        <div className="segmented">
          <button
            className={props.mode === "click" ? "seg active" : "seg"}
            onClick={() => props.onChangeMode("click")}
          >
            CLICK
          </button>
          <button
            className={props.mode === "walk" ? "seg active" : "seg"}
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

      {/* Slice */}
      <section className="panel-section">
        <h2 className="section-label">ACTIVE SLICE</h2>
        {SLOT_LABELS.map((label, i) => {
          const value =
            i < props.activeAxisIds.length ? props.activeAxisIds[i] : "";
          return (
            <div className="slice-row" key={label}>
              <span className="slice-slot">{label}</span>
              <select
                className="field field-select"
                value={value}
                onChange={(e) => handleSlotChange(i, e.target.value)}
              >
                {i === 2 && <option value="">— (2D plane)</option>}
                {props.axes.map((axis) => (
                  <option key={axis.id} value={axis.id}>
                    {axis.positivePole} / {axis.negativePole}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <p className="hint">All other dimensions are held at 0.</p>
      </section>

      {/* Dimensions */}
      <section className="panel-section">
        <h2 className="section-label">DIMENSIONS</h2>
        <div className="axis-list">
          {props.axes.map((axis) => (
            <AxisRow
              key={axis.id}
              axis={axis}
              removable={props.axes.length > 2}
              onRename={(pos, neg) => props.onRenameAxis(axis.id, pos, neg)}
              onRemove={() => props.onRemoveAxis(axis.id)}
            />
          ))}
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
            className="field field-compact"
            placeholder="positive pole"
            value={newPos}
            onChange={(e) => setNewPos(e.target.value)}
          />
          <span className="axis-sep">/</span>
          <input
            className="field field-compact"
            placeholder="negative pole"
            value={newNeg}
            onChange={(e) => setNewNeg(e.target.value)}
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
          {props.selectedPoint.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="inspector-image"
              src={props.selectedPoint.imageUrl}
              alt="Selected point"
            />
          )}
          <div className="inspector-coords">
            {props.axes.map((axis) => {
              const v = axisValue(props.selectedPoint!.coordinate, axis.id);
              return (
                <div className="coord-row" key={axis.id}>
                  <span className="coord-label">
                    {axis.positivePole}/{axis.negativePole}
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
                Repositioning moves the point&apos;s metadata only — no
                regeneration.
              </p>
              <button
                className="btn-ghost btn-danger"
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
