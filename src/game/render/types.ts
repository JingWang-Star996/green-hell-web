export type RenderEntityKind =
  | "stick"
  | "stone"
  | "vine"
  | "herb"
  | "tobacco"
  | "palm"
  | "coconut"
  | "banana"
  | "nut"
  | "mushroom"
  | "water"
  | "wreck"
  | "station"
  | "cache"
  | "beacon"
  | "snake";

export type RenderEntity = {
  id: string;
  kind: RenderEntityKind;
  label: string;
  x: number;
  z: number;
  interactRadius: number;
  interactive: boolean;
  available: boolean;
};

export type RenderSnapshot = {
  day: number;
  minuteOfDay: number;
  rain: number;
  storm: boolean;
  fireBuilt: boolean;
  fireLit: boolean;
  shelterBuilt: boolean;
  bedBuilt: boolean;
  beaconBuilt: boolean;
  signalActive: boolean;
  canSprint: boolean;
  entities: RenderEntity[];
};

export type InteractionTarget = {
  id: string;
  kind: RenderEntityKind;
  label: string;
  distance: number;
};

export type PlayerFrame = {
  x: number;
  z: number;
  yaw: number;
  distance: number;
  sprinting: boolean;
  inWater: boolean;
  sheltered: boolean;
};

export type EngineDiagnostics = {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  x: number;
  z: number;
};

export type EngineCallbacks = {
  onTargetChange: (target: InteractionTarget | null) => void;
  onInteract: (target: InteractionTarget) => void;
  onPlayerFrame: (frame: PlayerFrame) => void;
  onHazardWarning: (hazardId: string) => void;
  onHazard: (hazardId: string) => void;
  onPointerLockChange: (locked: boolean) => void;
};

export type TouchInput = {
  forward: number;
  right: number;
  lookX: number;
  lookY: number;
  sprint: boolean;
};
