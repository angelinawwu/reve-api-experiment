"use client";

import React, { useState } from "react";
import { Axis } from "../lib/types";

interface AxisManagerProps {
  axes: Axis[];
  onAddAxis: (positivePole: string, negativePole: string) => void;
  onRemoveAxis: (id: string) => void;
}

export function AxisManager({ axes, onAddAxis, onRemoveAxis }: AxisManagerProps) {
  const [positivePole, setPositivePole] = useState("");
  const [negativePole, setNegativePole] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (positivePole.trim() && negativePole.trim()) {
      onAddAxis(positivePole.trim(), negativePole.trim());
      setPositivePole("");
      setNegativePole("");
    }
  };

  return (
    <div className="card animate-fade-in" style={{ marginBottom: "2rem" }}>
      <h2 className="text-lg font-semibold" style={{ marginBottom: "1rem" }}>
        2. Define Axes
      </h2>
      
      {axes.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginBottom: "1.5rem" }}>
          {axes.map((axis) => (
            <div key={axis.id} className="flex items-center justify-between" style={{ padding: "0.75rem", backgroundColor: "var(--muted)", borderRadius: "var(--radius-md)" }}>
              <span className="font-medium">
                {axis.negativePole} <span className="text-muted mx-2">↔</span> {axis.positivePole}
              </span>
              <button 
                onClick={() => onRemoveAxis(axis.id)}
                className="btn btn-secondary text-sm"
                style={{ padding: "0.25rem 0.5rem" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-4 items-center">
        <input
          type="text"
          className="input"
          placeholder='Negative pole (e.g. "glumness")'
          value={negativePole}
          onChange={(e) => setNegativePole(e.target.value)}
        />
        <span className="text-muted">↔</span>
        <input
          type="text"
          className="input"
          placeholder='Positive pole (e.g. "whimsy")'
          value={positivePole}
          onChange={(e) => setPositivePole(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={!positivePole.trim() || !negativePole.trim()}
          style={{ whiteSpace: "nowrap" }}
        >
          Add Axis
        </button>
      </form>
    </div>
  );
}
