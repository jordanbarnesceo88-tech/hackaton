export type FacilityKind = "warehouse" | "airport" | "medical" | "other";

export type Zone = {
  kind: "rack" | "gate" | "belt" | "room" | "zone" | "dock";
  x: number;
  y: number;
  w: number;
  h: number; // normalized 0..1
  label?: string;
};

export type Waypoint = { x: number; y: number };

export type RobotState = {
  id: number;
  pos: Waypoint; // normalized 0..1
  path: Waypoint[]; // looping path (>= 2 points)
  segment: number; // current segment index (0..path.length-1)
  t: number; // 0..1 progress along current segment
};

export type Layout = {
  kind: FacilityKind;
  zones: Zone[];
  pathTemplate: Waypoint[]; // >= 2 waypoints; robots follow offset copies of this
};
