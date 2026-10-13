import "./style.css";
import {
  type EditableMapDefinition, type RoomReply, type RoomView, type VictoryResult
} from "@tetherbound/shared";
import { SocketClient } from "./network/SocketClient";
import { createGame } from "./game/Game";
import { openMapManager } from "./editor/MapEditor";
import { gameAudio } from "./audio/GameAudio";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="game"></div>
  <div class="shell" id="shell"></div>
  <div class="hud" id="hud" hidden>
    <div class="mission" id="mission">Encuentren la llave y lleguen juntos a la salida</div>
    <div class="room-pill" id="room-pill"></div>
    <button class="sound-toggle" id="sound-toggle" type="button" aria-label="Silenciar sonidos"></button>
    <button class="exit-game" id="exit-game" type="button" hidden>Salir</button>
    <div class="game-confirm" id="game-confirm" hidden>
      <section class="card game-confirm-card" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title">
        <div class="eyebrow">Terminar partida</div>
        <h2 id="game-confirm-title">¿Querés salir?</h2>
        <p class="subtitle">La partida terminará para todo el equipo y todos volverán a la pantalla principal.</p>
        <div class="actions">
          <button class="button secondary" id="cancel-exit" type="button">Seguir jugando</button>
          <button class="button danger" id="confirm-exit" type="button">Salir</button>
        </div>
      </section>
    </div>
    <pre class="debug" id="debug"></pre>
    <div class="toast" id="toast" hidden></div>
  </div>
`;

const shell = document.querySelector<HTMLElement>("#shell")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const mission = document.querySelector<HTMLElement>("#mission")!;
const soundToggle = document.querySelector<HTMLButtonElement>("#sound-toggle")!;
const exitGameButton = document.querySelector<HTMLButtonElement>("#exit-game")!;
const gameConfirm = document.querySelector<HTMLElement>("#game-confirm")!;
const cancelExitButton = document.querySelector<HTMLButtonElement>("#cancel-exit")!;
const confirmExitButton = document.querySelector<HTMLButtonElement>("#confirm-exit")!;
const network = new SocketClient();
let room: RoomView | undefined;
let notice = "";
let gameStarted = false;
let draftRoomCode = "";
let draftName = "";

function updateSoundButton(): void {
  soundToggle.textContent = gameAudio.isMuted ? "🔇" : "🔊";
  soundToggle.setAttribute("aria-label", gameAudio.isMuted ? "Activar sonidos" : "Silenciar sonidos");
  soundToggle.title = gameAudio.isMuted ? "Activar sonidos" : "Silenciar sonidos";
}

soundToggle.addEventListener("click", () => {
  gameAudio.toggleMuted();
  updateSoundButton();
});
document.addEventListener("pointerdown", () => { void gameAudio.unlock(); }, { once: true });
document.addEventListener("keydown", () => { void gameAudio.unlock(); }, { once: true });
updateSoundButton();

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const identityFields = () => `
  <label class="field">Nombre
    <input id="player-name" maxlength="18" autocomplete="nickname" value="${escape(draftName)}" />
  </label>`;

function bindIdentityFields(): void {
  const name = shell.querySelector<HTMLInputElement>("#player-name")!;
  name.addEventListener("input", () => { draftName = name.value; });
}

const identityRequest = () => ({ name: draftName.trim() });

async function createRoomWithMap(map: EditableMapDefinition): Promise<string | undefined> {
  if (!draftName.trim()) return "Ingresá tu nombre en la pantalla principal antes de jugar el mapa.";
  const reply = await network.create({ ...identityRequest(), map });
  if (!reply.ok) return reply.error ?? "No se pudo crear la sala con este mapa.";
  finishRoomEntry(reply);
  return undefined;
}

function renderMenu(): void {
  shell.hidden = false;
  hud.hidden = true;
  shell.innerHTML = `
    <section class="card">
      <div class="eyebrow">Cooperación bajo tensión</div>
      <h1>Ecommerce<br>jumpers</h1>
      <p class="subtitle">Un equipo, una cuerda y ningún héroe solitario. Coordinen saltos, rescates y empujes para que todos crucen.</p>
      ${identityFields()}
      <div class="actions">
        <button class="button" id="create">Crear sala</button>
        <button class="button secondary" id="join">Unirme</button>
      </div>
      <button class="map-editor-entry" id="open-map-editor" type="button">Editor de mapas</button>
      <div class="notice">${escape(notice)}</div>
      <div class="controls">Teclado: A/D o flechas · Saltar: W, ↑ o espacio · Gamepad compatible</div>
    </section>`;
  bindIdentityFields();
  shell.querySelector<HTMLButtonElement>("#create")!.onclick = () => {
    notice = "";
    renderGameModePrompt();
  };
  shell.querySelector<HTMLButtonElement>("#join")!.onclick = () => {
    notice = "";
    renderJoinPrompt();
  };
  shell.querySelector<HTMLButtonElement>("#open-map-editor")!.onclick = () => {
    openMapManager(shell, renderMenu, createRoomWithMap);
  };
}

function renderGameModePrompt(): void {
  shell.hidden = false;
  hud.hidden = true;
  shell.innerHTML = `
    <section class="card mode-card" role="dialog" aria-labelledby="mode-title" aria-modal="true">
      <div class="eyebrow">Nueva sala</div>
      <h2 id="mode-title">Elige un modo</h2>
      <p class="subtitle">Selecciona cómo quieren jugar. Muy pronto habrá más desafíos.</p>
      <div class="mode-options" role="radiogroup" aria-label="Modo de juego">
        <button class="mode-option" type="button" disabled aria-disabled="true">
          <span class="mode-option-title">Atados</span>
          <span class="mode-option-description">Coordinen cada movimiento unidos por una cuerda.</span>
          <span class="mode-option-status">Próximamente</span>
        </button>
        <button class="mode-option selected" type="button" role="radio" aria-checked="true" data-mode="no-touch">
          <span class="mode-option-title">No se toquen</span>
          <span class="mode-option-description">Superen el recorrido sin tocar a los demás jugadores.</span>
          <span class="mode-option-status available">Seleccionado</span>
        </button>
        <button class="mode-option" type="button" disabled aria-disabled="true">
          <span class="mode-option-title">Totems</span>
          <span class="mode-option-description">Activen los totems en equipo para abrir el camino.</span>
          <span class="mode-option-status">Próximamente</span>
        </button>
      </div>
      <div class="actions">
        <button class="button secondary" id="cancel-mode">Volver</button>
        <button class="button" id="confirm-mode">Crear sala</button>
      </div>
      <div class="notice">${escape(notice)}</div>
    </section>`;

  shell.querySelector<HTMLButtonElement>("#cancel-mode")!.onclick = () => {
    notice = "";
    renderMenu();
  };
  shell.querySelector<HTMLButtonElement>("#confirm-mode")!.onclick = async () => {
    const confirmButton = shell.querySelector<HTMLButtonElement>("#confirm-mode")!;
    confirmButton.disabled = true;
    confirmButton.textContent = "Creando…";
    const reply = await network.create(identityRequest());
    if (!reply.ok) {
      notice = reply.error ?? "No se pudo conectar.";
      renderGameModePrompt();
      return;
    }
    finishRoomEntry(reply);
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
      ${identityFields()}
      <label class="field">Código de sala
        <input id="join-code" maxlength="5" placeholder="ABCDE" autocapitalize="characters" autocomplete="off" value="${escape(draftRoomCode)}" />
      </label>
      <div class="actions">
        <button class="button secondary" id="back">Volver</button>
        <button class="button" id="confirm-join">Entrar</button>
      </div>
      <div class="notice">${escape(notice)}</div>
    </section>`;
  bindIdentityFields();
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
    const reply = await network.join(draftRoomCode, identityRequest());
    if (!reply.ok) {
      notice = reply.error ?? "No se pudo entrar a la sala.";
      renderJoinPrompt();
      return;
    }
    finishRoomEntry(reply);
  };
  shell.querySelector<HTMLButtonElement>("#confirm-join")!.onclick = () => void join();
  codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void join();
  });
}

function finishRoomEntry(reply: RoomReply): void {
  if (reply.reconnectToken && reply.room) {
    localStorage.setItem("tetherbound-session", JSON.stringify({
      code: reply.room.code,
      reconnectToken: reply.reconnectToken
    }));
  }
  room = reply.room;
  network.activeMap = reply.room?.map;
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
      <div class="badge ready">Mapa: ${escape(room.map.name)}</div>
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
  gameConfirm.hidden = true;
  updateLeaderExitButton();
}

function updateLeaderExitButton(): void {
  const self = room?.players.find((player) => player.id === network.playerId);
  exitGameButton.hidden = !gameStarted || !self?.leader;
  if (!self?.leader) gameConfirm.hidden = true;
}

exitGameButton.addEventListener("click", () => {
  gameConfirm.hidden = false;
  confirmExitButton.focus();
});

cancelExitButton.addEventListener("click", () => {
  gameConfirm.hidden = true;
  exitGameButton.focus();
});

confirmExitButton.addEventListener("click", () => {
  confirmExitButton.disabled = true;
  network.socket.emit("game:end", (reply) => {
    confirmExitButton.disabled = false;
    if (reply.ok) return;
    gameConfirm.hidden = true;
    toast.textContent = reply.error ?? "No se pudo terminar la partida.";
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2000);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !gameConfirm.hidden) {
    gameConfirm.hidden = true;
    exitGameButton.focus();
  }
});


function formatTime(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1000);
  const milliseconds = Math.floor(timeMs % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function renderVictory(results: VictoryResult[]): void {
  gameAudio.victory();
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
    network.socket.emit("game:end", handleReply);
  });
  shell.querySelector<HTMLButtonElement>("#play-again")?.addEventListener("click", () => {
    network.socket.emit("game:playAgain", handleReply);
  });
}

network.socket.on("room:update", (updated) => {
  room = updated;
  network.roomCode = updated.code;
  network.activeMap = updated.map;
  if (updated.state === "lobby") {
    gameStarted = false;
    renderLobby();
  } else if (updated.state === "playing" && !gameStarted) {
    showGame();
  }
  updateLeaderExitButton();
});
network.socket.on("room:notice", (message) => {
  notice = message;
  if (!gameStarted) renderLobby();
});
network.socket.on("room:closed", (message) => {
  network.clearSession();
  room = undefined;
  gameStarted = false;
  gameConfirm.hidden = true;
  confirmExitButton.disabled = false;
  notice = message;
  renderMenu();
});
network.socket.on("game:started", (map) => {
  network.activeMap = map;
  showGame();
});
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
