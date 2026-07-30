"use client";

import React from "react";
import { GridCell as GridCellType, Axis } from "../lib/types";

interface GridCellProps {
  cell: GridCellType;
  xAxis: Axis;
  yAxis: Axis;
}

export function GridCell({ cell, xAxis, yAxis }: GridCellProps) {
  const isGenerating = cell.status === "generating";
  const xValue = cell.coordinate[xAxis.id] ?? 0;
  const yValue = cell.coordinate[yAxis.id] ?? 0;
  
  // Tooltip text explaining the coordinate
  const xLabel = xValue === 0 ? "Neutral" : xValue > 0 ? `${Math.abs(xValue * 100)}% ${xAxis.positivePole}` : `${Math.abs(xValue * 100)}% ${xAxis.negativePole}`;
  const yLabel = yValue === 0 ? "Neutral" : yValue > 0 ? `${Math.abs(yValue * 100)}% ${yAxis.positivePole}` : `${Math.abs(yValue * 100)}% ${yAxis.negativePole}`;

  return (
    <div className="vibe-cell" title={`${xLabel}, ${yLabel}`}>
      {cell.status === "ready" && cell.imageUrl ? (
        <img 
          src={cell.imageUrl} 
          alt={`Generated at ${xValue}, ${yValue}`} 
          className="animate-fade-in"
          loading="lazy"
        />
      ) : isGenerating ? (
        <div className="w-full h-full skeleton" />
      ) : cell.status === "error" ? (
        <div className="vibe-cell-empty text-destructive text-sm text-center p-2">
          Failed
        </div>
      ) : (
        <div className="vibe-cell-empty">
          <span style={{ opacity: 0.5 }}>...</span>
        </div>
      )}
    </div>
  );
}
