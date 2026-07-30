export type AxisId = string;

export interface Axis {
  id: AxisId;
  positivePole: string;
  negativePole: string;
  createdAt: number;
}

export interface VibeSpace {
  id: string;
  subjectPrompt: string;
  baseImageUrl: string;
  axes: Axis[];
}

export type Coordinate = Partial<Record<AxisId, number>>;

export interface GridCell {
  coordinate: Coordinate;
  imageUrl: string | null;
  status: "empty" | "generating" | "ready" | "error";
}

export interface SliceView {
  xAxisId: AxisId;
  yAxisId: AxisId;
  resolution: number;
  heldConstant: Coordinate;
}
