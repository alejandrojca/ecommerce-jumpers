import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  inputSchema, joinSchema, NETWORK, type ClientToServerEvents, type ServerToClientEvents
} from "@tetherbound/shared";
import { RoomManager } from "./rooms/RoomManager.js";

const app = express();
const origin = process.env.CLIENT_ORIGIN?.split(",") ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
app.use(cors({ origin }));
app.get("/health", (_request, response) => response.json({ ok: true, service: "ecommerce-jumpers-server" }));

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin },
  maxHttpBufferSize: NETWORK.MAX_MESSAGE_BYTES,
  pingInterval: 5000,
  pingTimeout: 8000
});
const rooms = new RoomManager(io);

io.on("connection", (socket) => {
  socket.on("net:ping", (_clientTime, reply) => reply(Date.now()));
  socket.on("room:create", (raw, reply) => {
    const parsed = joinSchema.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "Datos inválidos." });
    try {
      const result = rooms.create(socket, parsed.data.name!, parsed.data.color!);
      reply({ ok: true, room: result.room.view, playerId: result.playerId, reconnectToken: result.token });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : "No se pudo crear la sala." });
    }
  });
  socket.on("room:join", (raw, reply) => {
    const { code, ...join } = raw;
    const parsed = joinSchema.safeParse(join);
    if (!parsed.success || typeof code !== "string" || code.length > 8) return reply({ ok: false, error: "Datos inválidos." });
    try {
      const result = rooms.join(socket, code, parsed.data);
      reply({ ok: true, room: result.room.view, playerId: result.playerId, reconnectToken: result.token });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : "No se pudo entrar." });
    }
  });
  socket.on("room:ready", (ready) => {
    const session = rooms.session(socket.id);
    if (session && typeof ready === "boolean") session.room.setReady(session.playerId, ready);
  });
  socket.on("room:start", (reply) => {
    const session = rooms.session(socket.id);
    if (!session) return reply({ ok: false, error: "No estás en una sala." });
    const error = session.room.start(session.playerId);
    reply(error ? { ok: false, error } : { ok: true });
  });
  socket.on("game:input", (raw) => {
    const parsed = inputSchema.safeParse(raw);
    const session = rooms.session(socket.id);
    if (parsed.success && session) session.room.input(session.playerId, parsed.data);
  });
  socket.on("game:restart", () => {
    const session = rooms.session(socket.id);
    if (session) session.room.restart(session.playerId);
  });
  socket.on("game:exitToLobby", (reply) => {
    const session = rooms.session(socket.id);
    if (!session) return reply({ ok: false, error: "No estás en una sala." });
    const error = session.room.exitToLobby(session.playerId);
    reply(error ? { ok: false, error } : { ok: true });
  });
  socket.on("game:playAgain", (reply) => {
    const session = rooms.session(socket.id);
    if (!session) return reply({ ok: false, error: "No estás en una sala." });
    const error = session.room.playAgain(session.playerId);
    reply(error ? { ok: false, error } : { ok: true });
  });
  socket.on("disconnect", () => rooms.disconnect(socket.id));
});

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Ecommerce jumpers server listening on http://localhost:${port}`);
});
