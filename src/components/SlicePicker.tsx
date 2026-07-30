"use client";

import React from "react";
import { Axis } from "../lib/types";

interface SlicePickerProps {
  axes: Axis[];
  xAxisId: string;
  yAxisId: string;
  onChange: (xAxisId: string, yAxisId: string) => void;
}

export function SlicePicker({ axes, xAxisId, yAxisId, onChange }: SlicePickerProps) {
  if (axes.length < 2) return null;

  return (
    <div className="card animate-fade-in" style={{ marginBottom: "2rem" }}>
      <h2 className="text-lg font-semibold" style={{ marginBottom: "1rem" }}>
        3. Choose a Slice
      </h2>
      <div className="flex gap-4">
        <div className="flex-1 flex flex-col gap-2">
          <label className="text-sm font-medium">X-Axis</label>
          <select 
            className="input"
            value={xAxisId}
            onChange={(e) => onChange(e.target.value, yAxisId)}
          >
            <option value="" disabled>Select axis</option>
            {axes.map(axis => (
              <option key={axis.id} value={axis.id}>
                {axis.negativePole} ↔ {axis.positivePole}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <label className="text-sm font-medium">Y-Axis</label>
          <select 
            className="input"
            value={yAxisId}
            onChange={(e) => onChange(xAxisId, e.target.value)}
          >
            <option value="" disabled>Select axis</option>
            {axes.map(axis => (
              <option key={axis.id} value={axis.id}>
                {axis.negativePole} ↔ {axis.positivePole}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
