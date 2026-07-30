"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { VibeSpace, Axis, SliceView, GridCell, Coordinate } from "@/lib/types";
import { createBaseImage, generateCell, buildEditPrompt } from "@/lib/api";
import { SubjectPicker } from "@/components/SubjectPicker";
import { AxisManager } from "@/components/AxisManager";
import { SlicePicker } from "@/components/SlicePicker";
import { VibeGrid } from "@/components/VibeGrid";

export default function Home() {
  const [space, setSpace] = useState<VibeSpace | null>(null);
  const [sliceView, setSliceView] = useState<SliceView | null>(null);
  const [cellCache, setCellCache] = useState<Record<string, GridCell>>({});
  const [isCreatingBase, setIsCreatingBase] = useState(false);

  // We use a ref to track in-flight requests so we don't duplicate generation calls
  const generatingRef = useRef<Set<string>>(new Set());

  // Define initial axes (per MVP requirement: 2 fixed axes to start)
  const [axes, setAxes] = useState<Axis[]>([
    { id: "axis-1", positivePole: "whimsy", negativePole: "glumness", createdAt: Date.now() },
    { id: "axis-2", positivePole: "cyberpunk", negativePole: "cottagecore", createdAt: Date.now() + 1 }
  ]);

  const handleSetSubject = async (subject: string) => {
    setIsCreatingBase(true);
    try {
      const baseImageUrl = await createBaseImage(subject);
      const newSpace: VibeSpace = {
        id: `space-${Date.now()}`,
        subjectPrompt: subject,
        baseImageUrl,
        axes: axes
      };
      setSpace(newSpace);
      
      // Auto-set slice view if we have at least 2 axes
      if (axes.length >= 2) {
        setSliceView({
          xAxisId: axes[0].id,
          yAxisId: axes[1].id,
          resolution: 5,
          heldConstant: {}
        });
      }
    } catch (err) {
      console.error(err);
      alert("Failed to create base image. Check API key in .env.local");
    } finally {
      setIsCreatingBase(false);
    }
  };

  const handleAddAxis = (positivePole: string, negativePole: string) => {
    const newAxis: Axis = {
      id: `axis-${Date.now()}`,
      positivePole,
      negativePole,
      createdAt: Date.now()
    };
    const newAxes = [...axes, newAxis];
    setAxes(newAxes);
    if (space) {
      setSpace({ ...space, axes: newAxes });
    }
  };

  const handleRemoveAxis = (id: string) => {
    const newAxes = axes.filter(a => a.id !== id);
    setAxes(newAxes);
    if (space) {
      setSpace({ ...space, axes: newAxes });
    }
    // Update slice view if an active axis is removed
    if (sliceView && (sliceView.xAxisId === id || sliceView.yAxisId === id)) {
      setSliceView(null);
    }
  };

  const handleChangeSlice = (xAxisId: string, yAxisId: string) => {
    if (xAxisId !== yAxisId) {
      setSliceView({
        xAxisId,
        yAxisId,
        resolution: 5,
        heldConstant: {}
      });
    }
  };

  // Helper to serialize coordinate into a string hash
  const hashCoord = (coord: Coordinate) => {
    const entries = Object.entries(coord)
      .filter(([_, v]) => v !== 0)
      .sort(([k1], [k2]) => k1.localeCompare(k2));
    return JSON.stringify(entries);
  };

  // Compute the current grid coordinates
  const computeCells = useCallback(() => {
    if (!sliceView || !space) return [];
    
    const { xAxisId, yAxisId, resolution } = sliceView;
    const cells: GridCell[] = [];
    
    // Map grid indices (0 to res-1) to coordinate values (1 to -1)
    // Note: CSS Grid goes top-to-bottom, so y=0 is top (+1), y=res-1 is bottom (-1)
    // x=0 is left (-1), x=res-1 is right (+1)
    for (let r = 0; r < resolution; r++) {
      for (let c = 0; c < resolution; c++) {
        // Normalize coordinates to -1 ... 1
        const xValue = -1 + (2 * c) / (resolution - 1);
        const yValue = 1 - (2 * r) / (resolution - 1); // Inverted so top is +1
        
        const coord: Coordinate = {
          ...sliceView.heldConstant,
          [xAxisId]: parseFloat(xValue.toFixed(2)),
          [yAxisId]: parseFloat(yValue.toFixed(2))
        };
        
        const hash = hashCoord(coord);
        let cell = cellCache[hash];
        
        if (!cell) {
          // If it's the exact center origin (0,0), use the base image
          if (xValue === 0 && yValue === 0 && Object.keys(sliceView.heldConstant).length === 0) {
            cell = { coordinate: coord, imageUrl: space.baseImageUrl, status: "ready" };
          } else {
            cell = { coordinate: coord, imageUrl: null, status: "empty" };
          }
        }
        cells.push(cell);
      }
    }
    return cells;
  }, [sliceView, space, cellCache]);

  const activeCells = computeCells();

  // Generate missing cells in batches
  useEffect(() => {
    if (!space || !sliceView) return;

    const generateBatch = async () => {
      const missingCells = activeCells.filter(c => c.status === "empty");
      if (missingCells.length === 0) return;

      // Update their status to 'generating'
      const newCache = { ...cellCache };
      const toGenerate: Coordinate[] = [];

      for (const cell of missingCells) {
        const hash = hashCoord(cell.coordinate);
        if (!generatingRef.current.has(hash)) {
          generatingRef.current.add(hash);
          newCache[hash] = { ...cell, status: "generating" };
          toGenerate.push(cell.coordinate);
        }
      }

      if (toGenerate.length === 0) return;
      setCellCache(newCache);

      // Process in batches of 5 to avoid overwhelming the API and getting rate limited
      const batchSize = 5;
      for (let i = 0; i < toGenerate.length; i += batchSize) {
        const batch = toGenerate.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (coord) => {
          const hash = hashCoord(coord);
          try {
            const prompt = buildEditPrompt(space, coord);
            const imageUrl = await generateCell(space.baseImageUrl, prompt);
            
            setCellCache(prev => ({
              ...prev,
              [hash]: { coordinate: coord, imageUrl, status: "ready" }
            }));
          } catch (err) {
            console.error(err);
            setCellCache(prev => ({
              ...prev,
              [hash]: { coordinate: coord, imageUrl: null, status: "error" }
            }));
          } finally {
            generatingRef.current.delete(hash);
          }
        }));
      }
    };

    generateBatch();
  }, [activeCells, space, sliceView, cellCache]);

  return (
    <main className="container" style={{ paddingBottom: "4rem" }}>
      <header className="text-center" style={{ marginBottom: "3rem", marginTop: "2rem" }}>
        <h1 className="text-3x-large font-bold">N-Dimensional Vibe Space</h1>
        <p className="text-muted text-lg" style={{ marginTop: "0.5rem" }}>
          Explore design aesthetics across custom axes.
        </p>
      </header>

      <SubjectPicker onSubjectSet={handleSetSubject} isLoading={isCreatingBase} />
      
      {space && (
        <div className="animate-fade-in">
          <AxisManager axes={axes} onAddAxis={handleAddAxis} onRemoveAxis={handleRemoveAxis} />
          
          <SlicePicker 
            axes={axes} 
            xAxisId={sliceView?.xAxisId || ""} 
            yAxisId={sliceView?.yAxisId || ""} 
            onChange={handleChangeSlice} 
          />

          {sliceView && (
            <VibeGrid 
              sliceView={sliceView} 
              axes={axes} 
              cells={activeCells} 
            />
          )}
        </div>
      )}
    </main>
  );
}
