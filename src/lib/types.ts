export type AxisId = string;

/** axisId -> value in [-1, 1]. Sparse: a missing axis means 0. */
export type Coordinate = Partial<Record<AxisId, number>>;

export interface Axis {
  id: AxisId;
  positivePole: string;
  negativePole: string;
  source: "default" | "manual";
}

export type PointStatus = "generating" | "ready" | "error";

export interface ImagePoint {
  id: string;
  coordinate: Coordinate;
  imageUrl: string | null;
  status: PointStatus;
  isOrigin: boolean;
  error?: string;
}

export type SliceAxisIds = [AxisId, AxisId] | [AxisId, AxisId, AxisId];

export type InteractionMode = "click" | "walk";

export interface ViewState {
  activeAxisIds: SliceAxisIds;
  mode: InteractionMode;
}

/** A coordinate awaiting user confirmation before generation (click mode). */
export interface PendingPlacement {
  coordinate: Coordinate;
}
