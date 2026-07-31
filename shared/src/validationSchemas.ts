import { z } from "zod";

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
  if (value.color === undefined) context.addIssue({ code: "custom", path: ["color"], message: "El color es obligatorio." });
});
