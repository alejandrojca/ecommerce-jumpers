import "./mapEditor.css";
import type {
  EditableMapDefinition, EditableMapObject, MapObjectKind, MapTexture
} from "@tetherbound/shared";

const STORAGE_KEY = "tetherbound-custom-maps-v1";

const TOOLS: Array<{ kind: MapObjectKind; label: string; icon: string; description: string }> = [
  { kind: "spawn", label: "Spawn", icon: "S", description: "Punto de aparición" },
  { kind: "platform", label: "Piso fijo", icon: "▁", description: "Camino o plataforma" },
  { kind: "movingPlatform", label: "Piso móvil", icon: "↔", description: "Plataforma con recorrido" },
  { kind: "box", label: "Obstáculo", icon: "▣", description: "Caja empujable" },
  { kind: "door", label: "Puerta", icon: "D", description: "Salida del nivel" },
  { kind: "key", label: "Llave", icon: "K", description: "Llave de la salida" },
  { kind: "checkpoint", label: "Checkpoint", icon: "C", description: "Punto de reaparición" },
  { kind: "deathZone", label: "Zona mortal", icon: "!", description: "Reinicia al jugador" },
  { kind: "decoration", label: "Decoración", icon: "✦", description: "Elemento sin colisión" },
];

const TEXTURES: Array<{ value: MapTexture; label: string }> = [
  { value: "grass", label: "Piedra con pasto" },
  { value: "stone", label: "Piedra" },
  { value: "wood", label: "Madera" },
  { value: "metal", label: "Metal" },
  { value: "crystal", label: "Cristal" },
  { value: "hazard", label: "Peligro" },
  { value: "custom", label: "Textura personalizada" },
];

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]!);

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function defaultObject(kind: MapObjectKind, x: number, y: number): EditableMapObject {
  const dimensions: Record<MapObjectKind, [number, number, MapTexture]> = {
    spawn: [42, 58, "crystal"],
    platform: [260, 50, "grass"],
    movingPlatform: [180, 34, "metal"],
    box: [64, 64, "wood"],
    door: [90, 130, "stone"],
    key: [42, 42, "crystal"],
    checkpoint: [54, 90, "crystal"],
    deathZone: [320, 70, "hazard"],
    decoration: [120, 120, "grass"],
  };
  const [width, height, texture] = dimensions[kind];
  const sequence = kind === "spawn" ? "Spawn" : TOOLS.find((tool) => tool.kind === kind)!.label;
  return {
    id: id(), kind, name: sequence, x, y, width, height, texture,
    moving: kind === "movingPlatform" ? { axis: "horizontal", distance: 220, speed: 50 } : undefined,
    mass: kind === "box" ? 9 : undefined,
  };
}

function newMap(name = "Mapa sin nombre"): EditableMapDefinition {
  const timestamp = now();
  return {
    schemaVersion: 1,
    id: id(),
    name,
    width: 2700,
    height: 800,
    background: { preset: "forest" },
    objects: [
      defaultObject("spawn", 180, 590),
      defaultObject("platform", 260, 650),
      defaultObject("key", 2200, 540),
      defaultObject("door", 2520, 560),
      { ...defaultObject("deathZone", 1350, 790), width: 2700, height: 40 },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function loadMaps(): EditableMapDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as EditableMapDefinition[];
    return Array.isArray(parsed) ? parsed.filter((map) => map?.schemaVersion === 1 && Array.isArray(map.objects)) : [];
  } catch {
    return [];
  }
}

function persistMaps(maps: EditableMapDefinition[]): string | undefined {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
    return undefined;
  } catch {
    return "No se pudo guardar. Las imágenes pueden superar el espacio disponible del navegador.";
  }
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function validateMap(map: EditableMapDefinition): string[] {
  const count = (kind: MapObjectKind) => map.objects.filter((object) => object.kind === kind).length;
  const issues: string[] = [];
  if (count("spawn") === 0) issues.push("Agregá al menos un spawn.");
  if (count("platform") === 0 && count("movingPlatform") === 0) issues.push("Agregá al menos un piso.");
  if (count("key") !== 1) issues.push("El mapa necesita exactamente una llave.");
  if (count("door") !== 1) issues.push("El mapa necesita exactamente una puerta.");
  if (map.objects.some((object) => object.x < 0 || object.y < 0 || object.x > map.width || object.y > map.height)) {
    issues.push("Hay elementos fuera de los límites del mapa.");
  }
  return issues;
}

export function openMapManager(
  container: HTMLElement,
  onBack: () => void,
  onPlay?: (map: EditableMapDefinition) => Promise<string | undefined>
): void {
  let maps = loadMaps();
  let activeMap: EditableMapDefinition | undefined;
  let selectedId = "";
  let activeTool: MapObjectKind | undefined;
  let zoom = 0.38;
  let dirty = false;
  let deleteArmed = "";
  let copiedObject: EditableMapObject | undefined;
  let pasteSequence = 0;

  const duplicateObject = (source: EditableMapObject, offset = 40): EditableMapObject | undefined => {
    if (!activeMap) return undefined;
    const copy = structuredClone(source);
    const minX = copy.width / 2;
    const maxX = Math.max(minX, activeMap.width - copy.width / 2);
    const minY = copy.height / 2;
    const maxY = Math.max(minY, activeMap.height - copy.height / 2);
    const shiftedX = source.x + offset;
    const shiftedY = source.y + offset;
    copy.id = id();
    copy.name = source.name.endsWith(" (copia)") ? source.name : `${source.name} (copia)`;
    copy.x = shiftedX <= maxX ? Math.max(minX, shiftedX) : Math.max(minX, source.x - offset);
    copy.y = shiftedY <= maxY ? Math.max(minY, shiftedY) : Math.max(minY, source.y - offset);
    activeMap.objects.push(copy);
    selectedId = copy.id;
    markDirty();
    renderSurface();
    renderInspector();
    return copy;
  };

  const deleteObject = (object: EditableMapObject): void => {
    if (!activeMap) return;
    activeMap.objects = activeMap.objects.filter((candidate) => candidate.id !== object.id);
    selectedId = "";
    markDirty();
    renderSurface();
    renderInspector();
    setStatus(`Se eliminó ${object.name}`);
  };

  const save = () => {
    if (!activeMap) return;
    activeMap.updatedAt = now();
    const index = maps.findIndex((map) => map.id === activeMap!.id);
    if (index >= 0) maps[index] = activeMap;
    else maps.push(activeMap);
    const error = persistMaps(maps);
    dirty = !!error;
    setStatus(error ?? "Mapa guardado", !!error);
    renderHeaderState();
  };

  const setStatus = (message: string, error = false) => {
    const status = container.querySelector<HTMLElement>("#map-editor-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", error);
  };

  const markDirty = () => {
    dirty = true;
    renderHeaderState();
  };

  const renderHeaderState = () => {
    const indicator = container.querySelector<HTMLElement>("#map-dirty-indicator");
    if (indicator) indicator.textContent = dirty ? "Cambios sin guardar" : "Guardado";
  };

  const renderManager = () => {
    activeMap = undefined;
    container.onkeydown = null;
    container.innerHTML = `
      <section class="map-manager">
        <header class="map-manager-header">
          <div><div class="eyebrow">Herramientas de creación</div><h2>Mapas</h2><p>Creá, editá, duplicá e intercambiá niveles.</p></div>
          <button class="button secondary compact" id="maps-back">Volver al juego</button>
        </header>
        <div class="map-create-row">
          <input id="new-map-name" maxlength="40" placeholder="Nombre del mapa" value="Nuevo mapa" />
          <button class="button compact" id="new-map">Crear mapa</button>
          <button class="button secondary compact" id="import-map">Importar JSON</button>
          <input id="import-map-file" type="file" accept="application/json,.json" hidden />
        </div>
        <div class="map-library">
          ${maps.length ? maps.map((map) => {
            const issues = validateMap(map);
            return `<article class="map-library-card">
              <div class="map-thumbnail background-${map.background.preset}" ${map.background.preset === "custom" ? `style="background-image:url('${map.background.value ?? ""}')"` : ""}>
                <span>${map.objects.length} elementos</span>
              </div>
              <div class="map-card-body">
                <h3>${escapeHtml(map.name)}</h3>
                <p>${map.width} × ${map.height} · ${issues.length ? `${issues.length} pendiente${issues.length === 1 ? "" : "s"}` : "Estructura válida"}</p>
                <div class="map-card-actions">
                  ${onPlay ? `<button class="button compact" data-play="${map.id}">Jugar</button>` : ""}
                  <button class="button compact" data-edit="${map.id}">Editar</button>
                  <button class="button secondary compact" data-duplicate="${map.id}">Duplicar</button>
                  <button class="button danger compact" data-delete="${map.id}">${deleteArmed === map.id ? "Confirmar" : "Eliminar"}</button>
                </div>
              </div>
            </article>`;
          }).join("") : `<div class="empty-library"><strong>Todavía no hay mapas</strong><span>Creá el primero o importá un archivo JSON.</span></div>`}
        </div>
      </section>`;
    container.querySelector<HTMLButtonElement>("#maps-back")!.onclick = onBack;
    container.querySelector<HTMLButtonElement>("#new-map")!.onclick = () => {
      const name = container.querySelector<HTMLInputElement>("#new-map-name")!.value.trim() || "Nuevo mapa";
      activeMap = newMap(name);
      maps.push(activeMap);
      persistMaps(maps);
      renderEditor();
    };
    const importInput = container.querySelector<HTMLInputElement>("#import-map-file")!;
    container.querySelector<HTMLButtonElement>("#import-map")!.onclick = () => importInput.click();
    importInput.onchange = async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text()) as EditableMapDefinition;
        if (imported.schemaVersion !== 1 || !Array.isArray(imported.objects)) throw new Error();
        imported.id = id();
        imported.name = `${imported.name || "Mapa importado"} (importado)`;
        imported.createdAt = imported.updatedAt = now();
        maps.push(imported);
        persistMaps(maps);
        renderManager();
      } catch { window.alert("El archivo no contiene un mapa válido."); }
    };
    container.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => button.onclick = () => {
      activeMap = maps.find((map) => map.id === button.dataset.edit);
      if (activeMap) renderEditor();
    });
    container.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((button) => button.onclick = async () => {
      const map = maps.find((candidate) => candidate.id === button.dataset.play);
      if (!map || !onPlay) return;
      button.disabled = true;
      button.textContent = "Creando…";
      const error = await onPlay(structuredClone(map));
      if (error) {
        button.disabled = false;
        button.textContent = "Jugar";
        window.alert(error);
      }
    });
    container.querySelectorAll<HTMLButtonElement>("[data-duplicate]").forEach((button) => button.onclick = () => {
      const source = maps.find((map) => map.id === button.dataset.duplicate);
      if (!source) return;
      const copy = structuredClone(source);
      copy.id = id(); copy.name = `${source.name} (copia)`; copy.createdAt = copy.updatedAt = now();
      copy.objects.forEach((object) => { object.id = id(); });
      maps.push(copy); persistMaps(maps); renderManager();
    });
    container.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => button.onclick = () => {
      const mapId = button.dataset.delete!;
      if (deleteArmed !== mapId) {
        deleteArmed = mapId;
        renderManager();
        window.setTimeout(() => { if (deleteArmed === mapId) { deleteArmed = ""; renderManager(); } }, 3000);
        return;
      }
      maps = maps.filter((map) => map.id !== mapId);
      deleteArmed = ""; persistMaps(maps); renderManager();
    });
  };

  const renderEditor = () => {
    if (!activeMap) return renderManager();
    selectedId = activeMap.objects[0]?.id ?? "";
    activeTool = undefined;
    dirty = false;
    container.innerHTML = `
      <section class="map-editor">
        <header class="map-editor-header">
          <button class="icon-button" id="editor-back" title="Volver a mapas">←</button>
          <input class="map-title-input" id="map-name" maxlength="40" value="${escapeHtml(activeMap.name)}" aria-label="Nombre del mapa" />
          <span class="save-state" id="map-dirty-indicator">Guardado</span>
          <div class="header-spacer"></div>
          <button class="button secondary compact" id="validate-map">Validar</button>
          <button class="button secondary compact" id="export-map">Exportar</button>
          <button class="button compact" id="save-map">Guardar</button>
        </header>
        <div class="map-editor-body">
          <aside class="tool-palette">
            <h3>Elementos</h3>
            <p>Elegí una herramienta y hacé clic en el mapa.</p>
            <div class="tool-list">${TOOLS.map((tool) => `<button class="tool-button" data-tool="${tool.kind}" title="${tool.description}"><span>${tool.icon}</span><strong>${tool.label}</strong></button>`).join("")}</div>
            <hr>
            <h3>Escenario</h3>
            <label>Fondo<select id="map-background">
              <option value="forest">Bosque</option><option value="sky">Cielo</option><option value="night">Noche</option><option value="solid">Color plano</option><option value="custom">Imagen propia</option>
            </select></label>
            <button class="button secondary compact" id="upload-background">Elegir imagen</button>
            <input id="background-file" type="file" accept="image/*" hidden />
            <div class="dimension-grid"><label>Ancho<input id="map-width" type="number" min="800" max="8000" step="50" value="${activeMap.width}"></label><label>Alto<input id="map-height" type="number" min="500" max="3000" step="50" value="${activeMap.height}"></label></div>
          </aside>
          <main class="map-workspace">
            <div class="workspace-toolbar"><span id="map-editor-status">Mover y redimensionar · Ctrl+C / Ctrl+V · Supr elimina</span><label title="También podés usar Ctrl + rueda del mouse">Zoom <input id="map-zoom" type="range" min="0.2" max="0.8" step="0.05" value="${zoom}"></label></div>
            <div class="map-scroll"><div class="map-surface" id="map-surface" tabindex="0"></div></div>
          </main>
          <aside class="property-panel" id="property-panel"></aside>
        </div>
      </section>`;
    const backgroundSelect = container.querySelector<HTMLSelectElement>("#map-background")!;
    backgroundSelect.value = activeMap.background.preset;
    bindEditorControls();
    renderSurface();
    renderInspector();
  };

  const bindEditorControls = () => {
    if (!activeMap) return;
    container.querySelector<HTMLButtonElement>("#editor-back")!.onclick = () => {
      if (dirty) save();
      renderManager();
    };
    const nameInput = container.querySelector<HTMLInputElement>("#map-name")!;
    nameInput.oninput = () => { activeMap!.name = nameInput.value; markDirty(); };
    container.querySelector<HTMLButtonElement>("#save-map")!.onclick = save;
    container.querySelector<HTMLButtonElement>("#validate-map")!.onclick = () => {
      const issues = validateMap(activeMap!);
      setStatus(issues.length ? issues.join(" ") : "Estructura del mapa válida", issues.length > 0);
    };
    container.querySelector<HTMLButtonElement>("#export-map")!.onclick = () => {
      save();
      const blob = new Blob([JSON.stringify(activeMap, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${activeMap!.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "mapa"}.json`; link.click();
      URL.revokeObjectURL(url);
    };
    container.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => button.onclick = () => {
      activeTool = activeTool === button.dataset.tool ? undefined : button.dataset.tool as MapObjectKind;
      container.querySelectorAll("[data-tool]").forEach((item) => item.classList.toggle("active", item === button && !!activeTool));
      setStatus(activeTool ? `Hacé clic para colocar: ${button.textContent?.trim()}` : "Herramienta cancelada");
    });
    const background = container.querySelector<HTMLSelectElement>("#map-background")!;
    background.onchange = () => {
      activeMap!.background = { preset: background.value as EditableMapDefinition["background"]["preset"] };
      markDirty(); renderSurface();
    };
    const backgroundFile = container.querySelector<HTMLInputElement>("#background-file")!;
    container.querySelector<HTMLButtonElement>("#upload-background")!.onclick = () => backgroundFile.click();
    backgroundFile.onchange = async () => {
      const file = backgroundFile.files?.[0]; if (!file) return;
      activeMap!.background = { preset: "custom", value: await readImage(file) };
      background.value = "custom"; markDirty(); renderSurface();
    };
    for (const dimension of ["width", "height"] as const) {
      const input = container.querySelector<HTMLInputElement>(`#map-${dimension}`)!;
      input.onchange = () => {
        activeMap![dimension] = clamp(Number(input.value), dimension === "width" ? 800 : 500, dimension === "width" ? 8000 : 3000);
        markDirty(); renderSurface();
      };
    }
    const zoomInput = container.querySelector<HTMLInputElement>("#map-zoom")!;
    zoomInput.oninput = () => { zoom = Number(zoomInput.value); renderSurface(); };
    const mapScroll = container.querySelector<HTMLElement>(".map-scroll")!;
    mapScroll.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const surface = container.querySelector<HTMLElement>("#map-surface")!;
      const surfaceBounds = surface.getBoundingClientRect();
      const worldX = (event.clientX - surfaceBounds.left) / zoom;
      const worldY = (event.clientY - surfaceBounds.top) / zoom;
      const previousZoom = zoom;
      zoom = clamp(Math.round((zoom + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100, 0.2, 0.8);
      if (zoom === previousZoom) return;
      zoomInput.value = String(zoom);
      renderSurface();
      mapScroll.scrollLeft += worldX * (zoom - previousZoom);
      mapScroll.scrollTop += worldY * (zoom - previousZoom);
      setStatus(`Zoom: ${Math.round(zoom * 100)}%`);
    }, { passive: false });
    container.onkeydown = (event) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, select, textarea") || target.isContentEditable) return;
      if (event.key === "Delete") {
        const selected = activeMap!.objects.find((object) => object.id === selectedId);
        if (!selected) return;
        event.preventDefault();
        deleteObject(selected);
        return;
      }
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        const selected = activeMap!.objects.find((object) => object.id === selectedId);
        if (!selected) return;
        event.preventDefault();
        copiedObject = structuredClone(selected);
        pasteSequence = 0;
        setStatus(`Se copió ${selected.name}. Usá Ctrl+V para pegarlo.`);
      }
      if (key === "v" && copiedObject) {
        event.preventDefault();
        pasteSequence += 1;
        const copy = duplicateObject(copiedObject, 40 * pasteSequence);
        if (copy) setStatus(`Se pegó ${copy.name}`);
      }
    };
  };

  const backgroundStyle = () => {
    if (!activeMap) return "";
    if (activeMap.background.preset === "custom") return `background-image:url('${activeMap.background.value ?? ""}')`;
    return "";
  };

  const renderSurface = () => {
    if (!activeMap) return;
    const surface = container.querySelector<HTMLElement>("#map-surface")!;
    surface.className = `map-surface background-${activeMap.background.preset}`;
    surface.style.cssText = `width:${activeMap.width * zoom}px;height:${activeMap.height * zoom}px;${backgroundStyle()}`;
    surface.innerHTML = activeMap.objects.map((object) => {
      const selected = object.id === selectedId ? "selected" : "";
      const custom = object.texture === "custom" && object.customTexture ? `background-image:url('${object.customTexture}')` : "";
      const tool = TOOLS.find((candidate) => candidate.kind === object.kind)!;
      const moving = object.moving ? `<span class="movement-path ${object.moving.axis}" style="--distance:${object.moving.distance * zoom}px"></span>` : "";
      const resizeHandles = `<span class="resize-handle resize-nw" data-resize="nw"></span><span class="resize-handle resize-ne" data-resize="ne"></span><span class="resize-handle resize-sw" data-resize="sw"></span><span class="resize-handle resize-se" data-resize="se"></span>`;
      return `<div class="map-object kind-${object.kind} texture-${object.texture} ${selected}" data-object="${object.id}" title="${escapeHtml(object.name)}" style="left:${object.x * zoom}px;top:${object.y * zoom}px;width:${Math.max(16, object.width * zoom)}px;height:${Math.max(16, object.height * zoom)}px;${custom}">${moving}<span class="object-icon">${tool.icon}</span><span class="object-label">${escapeHtml(object.name)}</span>${resizeHandles}</div>`;
    }).join("");
    surface.onclick = (event) => {
      if ((event.target as HTMLElement).closest("[data-object]")) return;
      if (!activeTool) { selectedId = ""; renderSurface(); renderInspector(); return; }
      const bounds = surface.getBoundingClientRect();
      const x = clamp((event.clientX - bounds.left) / zoom, 0, activeMap!.width);
      const y = clamp((event.clientY - bounds.top) / zoom, 0, activeMap!.height);
      const object = defaultObject(activeTool, Math.round(x), Math.round(y));
      activeMap!.objects.push(object); selectedId = object.id; markDirty(); renderSurface(); renderInspector();
    };
    surface.querySelectorAll<HTMLElement>("[data-object]").forEach((element) => {
      element.onpointerdown = (event) => {
        event.preventDefault(); event.stopPropagation();
        selectedId = element.dataset.object!;
        const object = activeMap!.objects.find((candidate) => candidate.id === selectedId)!;
        surface.focus();
        surface.querySelectorAll(".map-object.selected").forEach((candidate) => candidate.classList.remove("selected"));
        element.classList.add("selected");
        const resizeHandle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize]");
        if (resizeHandle) {
          const direction = resizeHandle.dataset.resize!;
          const start = {
            x: event.clientX, y: event.clientY,
            left: object.x - object.width / 2, right: object.x + object.width / 2,
            top: object.y - object.height / 2, bottom: object.y + object.height / 2,
          };
          resizeHandle.setPointerCapture(event.pointerId);
          element.classList.add("resizing");
          resizeHandle.onpointermove = (moveEvent) => {
            if (!resizeHandle.hasPointerCapture(moveEvent.pointerId)) return;
            const deltaX = (moveEvent.clientX - start.x) / zoom;
            const deltaY = (moveEvent.clientY - start.y) / zoom;
            let left = start.left; let right = start.right; let top = start.top; let bottom = start.bottom;
            if (direction.includes("w")) left = clamp(start.left + deltaX, 0, start.right - 10);
            if (direction.includes("e")) right = clamp(start.right + deltaX, start.left + 10, activeMap!.width);
            if (direction.includes("n")) top = clamp(start.top + deltaY, 0, start.bottom - 10);
            if (direction.includes("s")) bottom = clamp(start.bottom + deltaY, start.top + 10, activeMap!.height);
            object.x = Math.round((left + right) / 2);
            object.y = Math.round((top + bottom) / 2);
            object.width = Math.round(right - left);
            object.height = Math.round(bottom - top);
            element.style.left = `${object.x * zoom}px`;
            element.style.top = `${object.y * zoom}px`;
            element.style.width = `${Math.max(16, object.width * zoom)}px`;
            element.style.height = `${Math.max(16, object.height * zoom)}px`;
            markDirty();
          };
          resizeHandle.onpointerup = (upEvent) => {
            resizeHandle.releasePointerCapture(upEvent.pointerId);
            element.classList.remove("resizing");
            renderSurface();
            renderInspector();
            setStatus(`Tamaño: ${object.width} × ${object.height}`);
          };
          renderInspector();
          return;
        }
        const start = { x: event.clientX, y: event.clientY, objectX: object.x, objectY: object.y };
        element.setPointerCapture(event.pointerId);
        element.classList.add("dragging");
        renderInspector();
        element.onpointermove = (moveEvent) => {
          if (!element.hasPointerCapture(moveEvent.pointerId)) return;
          object.x = clamp(Math.round((start.objectX + (moveEvent.clientX - start.x) / zoom) / 10) * 10, 0, activeMap!.width);
          object.y = clamp(Math.round((start.objectY + (moveEvent.clientY - start.y) / zoom) / 10) * 10, 0, activeMap!.height);
          element.style.left = `${object.x * zoom}px`; element.style.top = `${object.y * zoom}px`; markDirty();
        };
        element.onpointerup = (upEvent) => {
          element.releasePointerCapture(upEvent.pointerId); element.classList.remove("dragging"); renderInspector();
        };
      };
    });
  };

  const renderInspector = () => {
    if (!activeMap) return;
    const panel = container.querySelector<HTMLElement>("#property-panel")!;
    const object = activeMap.objects.find((candidate) => candidate.id === selectedId);
    if (!object) {
      const issues = validateMap(activeMap);
      panel.innerHTML = `<h3>Inspector</h3><div class="inspector-empty">Seleccioná un elemento para editarlo.</div><h3>Estado del mapa</h3><ul class="validation-list ${issues.length ? "has-errors" : ""}">${issues.length ? issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("") : "<li>Estructura válida</li>"}</ul>`;
      return;
    }
    panel.innerHTML = `<h3>Inspector</h3>
      <div class="selected-kind">${TOOLS.find((tool) => tool.kind === object.kind)!.label}</div>
      <label>Nombre<input id="object-name" maxlength="30" value="${escapeHtml(object.name)}"></label>
      <div class="dimension-grid"><label>X<input id="object-x" type="number" step="10" value="${object.x}"></label><label>Y<input id="object-y" type="number" step="10" value="${object.y}"></label></div>
      <div class="dimension-grid"><label>Ancho<input id="object-width" type="number" min="10" step="10" value="${object.width}"></label><label>Alto<input id="object-height" type="number" min="10" step="10" value="${object.height}"></label></div>
      <label>Textura<select id="object-texture">${TEXTURES.map((texture) => `<option value="${texture.value}" ${texture.value === object.texture ? "selected" : ""}>${texture.label}</option>`).join("")}</select></label>
      <button class="button secondary compact" id="upload-texture">Elegir textura propia</button><input id="texture-file" type="file" accept="image/*" hidden>
      ${object.moving ? `<h3>Movimiento</h3><label>Eje<select id="moving-axis"><option value="horizontal" ${object.moving.axis === "horizontal" ? "selected" : ""}>Horizontal</option><option value="vertical" ${object.moving.axis === "vertical" ? "selected" : ""}>Vertical</option></select></label><label>Recorrido<input id="moving-distance" type="number" min="20" max="1500" step="10" value="${object.moving.distance}"></label><label>Velocidad<input id="moving-speed" type="number" min="5" max="500" step="5" value="${object.moving.speed}"></label>` : ""}
      ${object.kind === "box" ? `<label>Masa<input id="object-mass" type="number" min="1" max="100" value="${object.mass ?? 9}"></label>` : ""}
      <button class="button secondary compact inspector-duplicate" id="duplicate-object">Duplicar elemento</button>
      <button class="button danger compact inspector-delete" id="delete-object">Eliminar elemento</button>`;
    const updateNumber = (selector: string, key: "x" | "y" | "width" | "height") => {
      panel.querySelector<HTMLInputElement>(selector)!.onchange = (event) => {
        object[key] = Math.max(key === "width" || key === "height" ? 10 : 0, Number((event.target as HTMLInputElement).value));
        markDirty(); renderSurface(); renderInspector();
      };
    };
    updateNumber("#object-x", "x"); updateNumber("#object-y", "y"); updateNumber("#object-width", "width"); updateNumber("#object-height", "height");
    panel.querySelector<HTMLInputElement>("#object-name")!.onchange = (event) => { object.name = (event.target as HTMLInputElement).value; markDirty(); renderSurface(); renderInspector(); };
    panel.querySelector<HTMLSelectElement>("#object-texture")!.onchange = (event) => { object.texture = (event.target as HTMLSelectElement).value as MapTexture; markDirty(); renderSurface(); };
    const textureFile = panel.querySelector<HTMLInputElement>("#texture-file")!;
    panel.querySelector<HTMLButtonElement>("#upload-texture")!.onclick = () => textureFile.click();
    textureFile.onchange = async () => { const file = textureFile.files?.[0]; if (!file) return; object.customTexture = await readImage(file); object.texture = "custom"; markDirty(); renderSurface(); renderInspector(); };
    if (object.moving) {
      panel.querySelector<HTMLSelectElement>("#moving-axis")!.onchange = (event) => { object.moving!.axis = (event.target as HTMLSelectElement).value as "horizontal" | "vertical"; markDirty(); renderSurface(); };
      panel.querySelector<HTMLInputElement>("#moving-distance")!.onchange = (event) => { object.moving!.distance = Number((event.target as HTMLInputElement).value); markDirty(); renderSurface(); };
      panel.querySelector<HTMLInputElement>("#moving-speed")!.onchange = (event) => { object.moving!.speed = Number((event.target as HTMLInputElement).value); markDirty(); };
    }
    panel.querySelector<HTMLInputElement>("#object-mass")?.addEventListener("change", (event) => { object.mass = Number((event.target as HTMLInputElement).value); markDirty(); });
    panel.querySelector<HTMLButtonElement>("#duplicate-object")!.onclick = () => {
      const copy = duplicateObject(object);
      if (copy) setStatus(`Se duplicó ${copy.name}`);
    };
    panel.querySelector<HTMLButtonElement>("#delete-object")!.onclick = () => deleteObject(object);
  };

  renderManager();
}
