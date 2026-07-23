import "./style.css";
import { COLORS, type RoomReply, type RoomView, type VictoryResult } from "@tetherbound/shared";
import { SocketClient } from "./network/SocketClient";
import { createGame } from "./game/Game";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="game"></div>
  <div class="shell" id="shell"></div>
  <div class="hud" id="hud" hidden>
    <div class="mission" id="mission">Encuentren la llave y lleguen juntos a la salida</div>
    <div class="room-pill" id="room-pill"></div>
    <pre class="debug" id="debug"></pre>
    <div class="toast" id="toast" hidden></div>
  </div>
`;

const shell = document.querySelector<HTMLElement>("#shell")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const mission = document.querySelector<HTMLElement>("#mission")!;
const network = new SocketClient();
let room: RoomView | undefined;
let chosenColor: number = COLORS[0];
let notice = "";
let gameStarted = false;
let draftName = "";
let draftRoomCode = "";

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderMenu(): void {
  shell.hidden = false;
  hud.hidden = true;
  shell.innerHTML = `
    <section class="card">
      <div class="eyebrow">Cooperación bajo tensión</div>
      <h1>Ecommerce<br>jumpers</h1>
      <p class="subtitle">Un equipo, una cuerda y ningún héroe solitario. Coordinen saltos, rescates y empujes para que todos crucen.</p>
      <label class="field">Tu nombre <input id="name" maxlength="18" autocomplete="nickname" placeholder="Explorador" value="${escape(draftName)}" /></label>
      <div class="field">Tu color <div class="colors">${COLORS.map((color) => `<button class="color ${color === chosenColor ? "selected" : ""}" data-color="${color}" style="--color:#${color.toString(16).padStart(6, "0")}" aria-label="Elegir color"></button>`).join("")}</div></div>
      <div class="actions">
        <button class="button" id="create">Crear sala</button>
        <button class="button secondary" id="join">Unirme</button>
      </div>
      <div class="notice">${escape(notice)}</div>
      <div class="controls">Teclado: A/D o flechas · Saltar: W, ↑ o espacio · Gamepad compatible</div>
    </section>`;
  shell.querySelectorAll<HTMLElement>(".color").forEach((button) => button.onclick = () => {
    chosenColor = Number(button.dataset.color);
    shell.querySelectorAll<HTMLElement>(".color").forEach((colorButton) => {
      colorButton.classList.toggle("selected", Number(colorButton.dataset.color) === chosenColor);
    });
  });
  const nameInput = shell.querySelector<HTMLInputElement>("#name")!;
  nameInput.addEventListener("input", () => { draftName = nameInput.value; });
  shell.querySelector<HTMLButtonElement>("#create")!.onclick = async () => {
    draftName = (nameInput.value || "Explorador").trim();
    const reply = await network.create({ name: draftName, color: chosenColor });
    if (!reply.ok) {
      notice = reply.error ?? "No se pudo conectar.";
      renderMenu();
      return;
    }
    finishRoomEntry(reply, draftName);
  };
  shell.querySelector<HTMLButtonElement>("#join")!.onclick = () => {
    draftName = (nameInput.value || "Explorador").trim();
    notice = "";
    renderJoinPrompt();
  };
}

function renderJoinPrompt(): void {
  shell.hidden = false;
  hud.hidden = true;
  shell.innerHTML = `
    <section class="card join-card">
      <div class="eyebrow">Ecommerce jumpers</div>
      <h2>Unirse a una sala</h2>
      <p class="subtitle">Ingresa el código que te compartió el líder del equipo.</p>
      <label class="field">Código de sala
        <input id="join-code" maxlength="5" placeholder="ABCDE" autocapitalize="characters" autocomplete="off" value="${escape(draftRoomCode)}" />
      </label>
      <div class="actions">
        <button class="button secondary" id="back">Volver</button>
        <button class="button" id="confirm-join">Entrar</button>
      </div>
      <div class="notice">${escape(notice)}</div>
    </section>`;
  const codeInput = shell.querySelector<HTMLInputElement>("#join-code")!;
  codeInput.focus();
  codeInput.addEventListener("input", () => {
    draftRoomCode = codeInput.value.toUpperCase();
    codeInput.value = draftRoomCode;
  });
  shell.querySelector<HTMLButtonElement>("#back")!.onclick = () => {
    notice = "";
    renderMenu();
  };
  const join = async () => {
    draftRoomCode = codeInput.value.trim().toUpperCase();
    const name = draftName || "Explorador";
    const reply = await network.join(draftRoomCode, { name, color: chosenColor });
    if (!reply.ok) {
      notice = reply.error ?? "No se pudo entrar a la sala.";
      renderJoinPrompt();
      return;
    }
    finishRoomEntry(reply, name);
  };
  shell.querySelector<HTMLButtonElement>("#confirm-join")!.onclick = () => void join();
  codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void join();
  });
}

function finishRoomEntry(reply: RoomReply, name: string): void {
  if (reply.reconnectToken && reply.room) {
    localStorage.setItem("tetherbound-session", JSON.stringify({
      code: reply.room.code,
      name,
      color: chosenColor,
      reconnectToken: reply.reconnectToken
    }));
  }
  room = reply.room;
  draftRoomCode = "";
  renderLobby();
}

function renderLobby(): void {
  if (!room) return renderMenu();
  const self = room.players.find((p) => p.id === network.playerId);
  shell.hidden = false;
  hud.hidden = true;
  shell.innerHTML = `
    <section class="card">
      <div class="eyebrow">Sala <span class="room-code">${escape(room.code)}</span></div>
      <h2>Formen el equipo</h2>
      <p class="subtitle">Compartan el código. La expedición comienza cuando todos estén listos.</p>
      <div class="players">${room.players.map((p) => `
        <div class="player-row">
          <span class="dot" style="--color:#${p.color.toString(16).padStart(6, "0")}"></span>
          <span>${escape(p.name)} ${p.leader ? "♛" : ""}</span>
          <span class="badge ${p.ready ? "ready" : ""}">${p.connected ? (p.ready ? "LISTO" : "ESPERANDO") : "RECONECTANDO"}</span>
        </div>`).join("")}
      </div>
      <div class="actions">
        <button class="button secondary" id="ready">${self?.ready ? "No estoy listo" : "Estoy listo"}</button>
        ${self?.leader ? `<button class="button" id="start">Iniciar</button>` : ""}
      </div>
      <div class="notice">${escape(notice)}</div>
      <div class="controls">De 2 a 12 jugadores · El líder puede iniciar cuando todos estén listos</div>
    </section>`;
  shell.querySelector<HTMLButtonElement>("#ready")!.onclick = () => network.socket.emit("room:ready", !self?.ready);
  const start = shell.querySelector<HTMLButtonElement>("#start");
  if (start) start.onclick = () => network.socket.emit("room:start", (reply) => {
    if (!reply.ok) { notice = reply.error ?? ""; renderLobby(); }
  });
}

function showGame(): void {
  gameStarted = true;
  shell.hidden = true;
  hud.hidden = false;
  document.querySelector<HTMLElement>("#room-pill")!.textContent = room?.code ?? "";
}

function formatTime(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1000);
  const milliseconds = Math.floor(timeMs % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function renderVictory(results: VictoryResult[]): void {
  const self = room?.players.find((player) => player.id === network.playerId);
  gameStarted = false;
  hud.hidden = true;
  shell.hidden = false;
  shell.innerHTML = `
    <section class="card victory-card">
      <div class="eyebrow">Expedición completada</div>
      <h2>Todos a salvo</h2>
      <p class="subtitle">Clasificación por tiempo de llegada. El último en entrar aparece primero.</p>
      <div class="results">
        ${results.map((result, index) => `
          <div class="result-row">
            <span class="result-position">${index + 1}</span>
            <span class="dot" style="--color:#${result.color.toString(16).padStart(6, "0")}"></span>
            <span class="result-name">${escape(result.name)}</span>
            <time class="result-time">${formatTime(result.timeMs)}</time>
          </div>
        `).join("")}
      </div>
      ${self?.leader ? `
        <div class="actions">
          <button class="button secondary" id="exit-lobby">Salir</button>
          <button class="button" id="play-again">Volver a jugar</button>
        </div>
      ` : `<div class="waiting-leader">Esperando la decisión del líder…</div>`}
      <div class="notice" id="victory-notice"></div>
    </section>`;

  const handleReply = (reply: { ok: boolean; error?: string }) => {
    if (!reply.ok) {
      shell.querySelector<HTMLElement>("#victory-notice")!.textContent = reply.error ?? "No se pudo completar la acción.";
    }
  };
  shell.querySelector<HTMLButtonElement>("#exit-lobby")?.addEventListener("click", () => {
    network.socket.emit("game:exitToLobby", handleReply);
  });
  shell.querySelector<HTMLButtonElement>("#play-again")?.addEventListener("click", () => {
    network.socket.emit("game:playAgain", handleReply);
  });
}

network.socket.on("room:update", (updated) => {
  room = updated;
  network.roomCode = updated.code;
  if (updated.state === "lobby") {
    gameStarted = false;
    renderLobby();
  } else if (updated.state === "playing" && !gameStarted) {
    showGame();
  }
});
network.socket.on("room:notice", (message) => {
  notice = message;
  if (!gameStarted) renderLobby();
});
network.socket.on("game:started", showGame);
network.socket.on("game:snapshot", (snapshot) => {
  mission.textContent = snapshot.keyState.collected
    ? `Puerta abierta · ${snapshot.doorState.inside}/${snapshot.doorState.required} en la salida`
    : "Encuentren la llave y lleguen juntos a la salida";
});
network.socket.on("game:victory", renderVictory);
network.socket.on("connect_error", () => {
  notice = "Servidor no disponible. Reintentando…";
  if (!gameStarted) renderMenu();
});

createGame(network, document.querySelector<HTMLElement>("#debug")!);
renderMenu();
