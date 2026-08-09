export type MapObjectKind =
  | "spawn"
  | "platform"
  | "movingPlatform"
  | "box"
  | "door"
  | "key"
  | "checkpoint"
  | "deathZone"
  | "decoration";

export type MapTexture =
  | "grass"
  | "stone"
  | "wood"
  | "metal"
  | "crystal"
  | "hazard"
  | "custom";

export interface EditableMapObject {
  id: string;
  kind: MapObjectKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  texture: MapTexture;
  customTexture?: string;
  moving?: {
    axis: "horizontal" | "vertical";
    distance: number;
    speed: number;
  };
  mass?: number;
}

export interface EditableMapDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  background: {
    preset: "forest" | "sky" | "night" | "solid" | "custom";
    value?: string;
  };
  objects: EditableMapObject[];
  createdAt: string;
  updatedAt: string;
}

