"use client";

import React from "react";
import { Asterisk, Cube, CubeTransparent, Eye, EyeClosed, ArrowsOutCardinal } from "@phosphor-icons/react";
import { Axis, AxisId, ViewMode } from "@/lib/types";

interface ViewSwitcherProps {
  viewMode: ViewMode;
  axes: Axis[];
  hiddenAxisIds: AxisId[];
  onChangeViewMode: (mode: ViewMode) => void;
  onToggleAxisVisibility: (id: AxisId) => void;
}

const VIEWS: { mode: ViewMode; label: string; Icon: React.ElementType }[] = [
  { mode: "slice", label: "Slice view", Icon: Cube },
  { mode: "starburst", label: "Starburst view", Icon: Asterisk },
  { mode: "projection", label: "Projection view", Icon: ArrowsOutCardinal },
  { mode: "astral", label: "Astral view", Icon: CubeTransparent },
];

export function ViewSwitcher({
  viewMode,
  axes,
  hiddenAxisIds,
  onChangeViewMode,
  onToggleAxisVisibility,
}: ViewSwitcherProps) {
  return (
    <div className="view-switcher">
      <div className="view-switcher-buttons">
        {VIEWS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            className={`view-switcher-btn${viewMode === mode ? " active" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={viewMode === mode}
            onClick={() => onChangeViewMode(mode)}
          >
            <Icon size={16} weight={viewMode === mode ? "fill" : "regular"} />
          </button>
        ))}
      </div>

      {viewMode !== "slice" && (
        <div className="view-switcher-axes">
          <div className="view-switcher-axes-title">DIMENSIONS</div>
          {axes.map((axis) => {
            const visible = !hiddenAxisIds.includes(axis.id);
            return (
              <button
                key={axis.id}
                className={`view-switcher-axis${visible ? "" : " hidden-axis"}`}
                onClick={() => onToggleAxisVisibility(axis.id)}
                title={visible ? "Hide dimension" : "Show dimension"}
              >
                {visible ? <Eye size={13} /> : <EyeClosed size={13} />}
                <span>
                  {axis.negativePole} ↔ {axis.positivePole}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
