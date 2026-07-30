"use client";

import React from "react";
import { GridCell as GridCellType, SliceView, Axis } from "../lib/types";
import { GridCell } from "./GridCell";

interface VibeGridProps {
  sliceView: SliceView;
  axes: Axis[];
  cells: GridCellType[];
}

export function VibeGrid({ sliceView, axes, cells }: VibeGridProps) {
  const xAxis = axes.find(a => a.id === sliceView.xAxisId);
  const yAxis = axes.find(a => a.id === sliceView.yAxisId);

  if (!xAxis || !yAxis) return null;

  return (
    <div className="card animate-fade-in flex flex-col items-center">
      <div className="w-full flex justify-between text-sm font-medium text-muted" style={{ paddingBottom: "1rem" }}>
        <span>{yAxis.positivePole} ↑</span>
      </div>
      
      <div className="flex w-full items-center">
        <div className="text-sm font-medium text-muted" style={{ paddingRight: "1rem", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {xAxis.negativePole} ←
        </div>
        
        <div className="vibe-grid-container">
          <div 
            className="vibe-grid"
            style={{ 
              gridTemplateColumns: `repeat(${sliceView.resolution}, 1fr)`,
              gridTemplateRows: `repeat(${sliceView.resolution}, 1fr)`
            }}
          >
            {cells.map((cell, i) => (
              <GridCell 
                key={i} 
                cell={cell} 
                xAxis={xAxis} 
                yAxis={yAxis} 
              />
            ))}
          </div>
        </div>

        <div className="text-sm font-medium text-muted" style={{ paddingLeft: "1rem", writingMode: "vertical-rl" }}>
          → {xAxis.positivePole}
        </div>
      </div>

      <div className="w-full flex justify-center text-sm font-medium text-muted" style={{ paddingTop: "1rem" }}>
        <span>↓ {yAxis.negativePole}</span>
      </div>
    </div>
  );
}
