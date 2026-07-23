export interface RectDef { id: string; x: number; y: number; width: number; height: number }

export const level1 = {
  width: 2200,
  height: 760,
  spawn: { x: 110, y: 560 },
  checkpoint: { x: 1050, y: 460 },
  deathY: 790,
  platforms: [
    { id: "start", x: 215, y: 650, width: 430, height: 50 },
    { id: "pit-step", x: 530, y: 610, width: 150, height: 30 },
    { id: "ledge", x: 720, y: 535, width: 200, height: 30 },
    { id: "rescue", x: 955, y: 645, width: 260, height: 40 },
    { id: "corridor-floor", x: 1270, y: 650, width: 370, height: 40 },
    { id: "key-platform", x: 1515, y: 480, width: 210, height: 28 },
    { id: "finish", x: 1900, y: 650, width: 440, height: 50 },
    { id: "corridor-roof", x: 1285, y: 525, width: 300, height: 25 },
    { id: "left-wall", x: -20, y: 350, width: 40, height: 700 },
    { id: "right-wall", x: 2220, y: 350, width: 40, height: 700 }
  ] satisfies RectDef[],
  movingPlatform: { id: "lift", x: 1110, y: 550, width: 130, height: 22, fromX: 1050, toX: 1210, speed: 55 },
  boxes: [{ id: "heavy-box", x: 850, y: 585, width: 62, height: 62, mass: 9 }],
  key: { x: 1515, y: 430 },
  door: { x: 2050, y: 575, width: 80, height: 110 },
};
