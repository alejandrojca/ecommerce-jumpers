import { z } from "zod";

const mapTextureSchema = z.enum(["grass", "stone", "wood", "metal", "crystal", "hazard", "custom"]);
const mapObjectKindSchema = z.enum([
  "spawn", "platform", "movingPlatform", "box", "door", "key", "checkpoint", "deathZone", "decoration"
]);

export const editableMapObjectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: mapObjectKindSchema,
  name: z.string().min(1).max(60),
  x: z.number().finite().min(0).max(8000),
  y: z.number().finite().min(0).max(3000),
  width: z.number().finite().min(10).max(8000),
  height: z.number().finite().min(10).max(3000),
  texture: mapTextureSchema,
  customTexture: z.string().max(250_000).optional(),
  moving: z.object({
    axis: z.enum(["horizontal", "vertical"]),
    distance: z.number().finite().min(20).max(3000),
    speed: z.number().finite().min(5).max(500),
  }).strict().optional(),
  mass: z.number().finite().min(1).max(100).optional(),
}).strict();

export const editableMapSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  width: z.number().finite().min(800).max(8000),
  height: z.number().finite().min(500).max(3000),
  background: z.object({
    preset: z.enum(["forest", "sky", "night", "solid", "custom"]),
    value: z.string().max(250_000).optional(),
  }).strict(),
  objects: z.array(editableMapObjectSchema).min(4).max(250),
  createdAt: z.string().max(50),
  updatedAt: z.string().max(50),
}).strict().superRefine((map, context) => {
  for (const kind of ["spawn", "key", "door"] as const) {
    const count = map.objects.filter((object) => object.kind === kind).length;
    if (count !== 1 && kind !== "spawn") context.addIssue({ code: "custom", path: ["objects"], message: `El mapa necesita exactamente un elemento ${kind}.` });
    if (kind === "spawn" && count < 1) context.addIssue({ code: "custom", path: ["objects"], message: "El mapa necesita al menos un spawn." });
  }
  if (!map.objects.some((object) => object.kind === "platform" || object.kind === "movingPlatform")) {
    context.addIssue({ code: "custom", path: ["objects"], message: "El mapa necesita al menos un piso." });
  }
  if (map.objects.some((object) => object.x > map.width || object.y > map.height)) {
    context.addIssue({ code: "custom", path: ["objects"], message: "Hay elementos fuera de los límites del mapa." });
  }
});

export const inputSchema = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  left: z.boolean(),
  right: z.boolean(),
  jumpPressed: z.boolean(),
  jumpHeld: z.boolean(),
  clientTime: z.number().finite(),
}).strict();

export const joinSchema = z.object({
  name: z.string().trim().min(1).max(18).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  reconnectToken: z.string().max(128).optional(),
}).strict().superRefine((value, context) => {
  if (value.reconnectToken) return;
  if (!value.name) context.addIssue({ code: "custom", path: ["name"], message: "El nombre es obligatorio." });
});

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(18),
  color: z.number().int().min(0).max(0xffffff).optional(),
  reconnectToken: z.string().max(128).optional(),
  map: editableMapSchema.optional(),
}).strict();
