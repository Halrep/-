import { SketchDocument, syncStageDom } from "./canvas-engine.js";
import { Viewport } from "./viewport.js";
import { InputController } from "./input.js";
import { History } from "./history.js";
import { BrushEngine, TOOLS, brushPreview } from "./brushes.js";
import { ColorPicker } from "./color-picker.js";
import { saveWork, loadWorkRecord, hydrateDocument } from "./storage.js";
import { confirmDialog, show, hide, positionPopover } from "./dialogs.js";
import { showEditorScreen } from "./screens.js";
import { showGallery } from "./gallery.js";

const stageEl = document.getElementById("canvas-stage");
const viewportEl = document.getElementById("canvas-viewport");
const titleInput = document.getElementById("input-title");
const btnBack = document.getElementById("btn-back-gallery");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnSettings = document.getElementById("btn-settings");
const btnFit = document.getElementById("btn-fit");

const btnLayersToggle = document.getElementById("btn-layers-toggle");
const layerPanel = document.getElementById("layer-panel");
const layerList = document.getElementById("layer-list");
const btnLayerAdd = document.getElementById("btn-layer-add");

const toolListEl = document.getElementById("tool-list");
const btnDry = document.getElementById("btn-dry");
const btnSizePopover = document.getElementById("btn-size-popover");
const sizePreviewDot = document.getElementById("size-preview-dot");

const popoverSize = document.getElementById("popover-size");
const rangeSize = document.getElementById("range-size");
const rangeStrength = document.getElementById("range-strength");
const strengthLabel = document.getElementById("strength-label");
const rowStrength = document.getElementById("row-strength");
const brushPreviewCanvas = document.getElementById("brush-preview");

const modalSettings = document.getElementById("modal-settings");
const chkLowQuality = document.getElementById("chk-low-quality");
const chkLeftHanded = document.getElementById("chk-left-handed");
const rangeStabilize = document.getElementById("range-stabilize");
const btnExportPng = document.getElementById("btn-export-png");
const btnPrint = document.getElementById("btn-print");
const btnCloseSettings = document.getElementById("btn-close-settings");

const SETTINGS_KEY = "sketchnote_settings";

function loadSettings() {
  try {
    return { lowQuality: false, leftHanded: false, stabilize: 1, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch (e) {
    return { lowQuality: false, leftHanded: false, stabilize: 1 };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    /* 保存できなくても動作は続ける */
  }
}

let doc = null;
let viewport = null;
let inputController = null;
const brush = new BrushEngine();
const history = new History();
let colorPicker = null;
let settings = loadSettings();
let autosaveTimer = null;
let dryIntervalStarted = false;
let layerRowRefs = new Map();

export function initEditor() {
  brush.stabilizeLevel = settings.stabilize;
  document.body.classList.toggle("left-handed", settings.leftHanded);

  colorPicker = new ColorPicker(brush, () => {});

  history.onChange = (canUndo, canRedo) => {
    btnUndo.disabled = !canUndo;
    btnRedo.disabled = !canRedo;
  };

  buildToolList();
  selectTool("pencil");

  btnBack.addEventListener("click", async () => {
    await saveNow();
    showGallery();
  });
  titleInput.addEventListener("change", () => {
    if (!doc) return;
    doc.title = titleInput.value.trim() || "むだい";
    scheduleAutosave();
  });

  btnUndo.addEventListener("click", () => {
    if (!doc) return;
    history.undo(doc);
    renderLayerPanel();
    scheduleAutosave();
  });
  btnRedo.addEventListener("click", () => {
    if (!doc) return;
    history.redo(doc);
    renderLayerPanel();
    scheduleAutosave();
  });

  btnFit.addEventListener("click", () => viewport?.fit());

  btnLayersToggle.addEventListener("click", () => {
    layerPanel.hidden = !layerPanel.hidden;
  });
  btnLayerAdd.addEventListener("click", () => {
    if (!doc || doc.layers.length >= 4) return;
    const layer = doc.addLayer(`かみ${doc.layers.length + 1}`);
    doc.activeLayerIndex = doc.layers.length - 1;
    syncStageDom(doc, stageEl);
    renderLayerPanel();
    scheduleAutosave();
  });

  btnDry.addEventListener("click", () => {
    if (!doc) return;
    const layer = doc.getActiveLayer();
    history.beginAction(layer);
    brush.forceDry(layer, performance.now());
    history.commitAction();
    scheduleAutosave();
  });

  btnSizePopover.addEventListener("click", () => {
    if (!popoverSize.hidden) {
      hide(popoverSize);
      return;
    }
    show(popoverSize);
    positionPopover(popoverSize, btnSizePopover);
    updateSizePopoverValues();
  });
  document.addEventListener("pointerdown", (e) => {
    if (popoverSize.hidden) return;
    if (popoverSize.contains(e.target) || btnSizePopover.contains(e.target)) return;
    hide(popoverSize);
  });
  rangeSize.addEventListener("input", () => {
    brush.setSize(Number(rangeSize.value));
    updateSizePreviewDot();
    brushPreview(brushPreviewCanvas, brush);
  });
  rangeStrength.addEventListener("input", () => {
    brush.setStrength(Number(rangeStrength.value));
    brushPreview(brushPreviewCanvas, brush);
  });

  btnSettings.addEventListener("click", () => {
    chkLowQuality.checked = settings.lowQuality;
    chkLeftHanded.checked = settings.leftHanded;
    rangeStabilize.value = String(settings.stabilize);
    show(modalSettings);
  });
  chkLowQuality.addEventListener("change", () => {
    settings.lowQuality = chkLowQuality.checked;
    saveSettings(settings);
  });
  chkLeftHanded.addEventListener("change", () => {
    settings.leftHanded = chkLeftHanded.checked;
    document.body.classList.toggle("left-handed", settings.leftHanded);
    saveSettings(settings);
  });
  rangeStabilize.addEventListener("input", () => {
    settings.stabilize = Number(rangeStabilize.value);
    brush.stabilizeLevel = settings.stabilize;
    saveSettings(settings);
  });
  btnCloseSettings.addEventListener("click", () => hide(modalSettings));
  btnExportPng.addEventListener("click", exportPng);
  btnPrint.addEventListener("click", printWork);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });

  setInterval(() => {
    if (doc) brush.checkDrying(doc, performance.now());
  }, 500);
}

export function isLowQuality() {
  return settings.lowQuality;
}

function buildToolList() {
  toolListEl.innerHTML = "";
  for (const t of TOOLS) {
    const btn = document.createElement("button");
    btn.className = "tool-btn";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.dataset.tool = t.id;
    btn.innerHTML = `<span class="tool-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span>`;
    btn.addEventListener("click", () => selectTool(t.id));
    toolListEl.appendChild(btn);
  }
}

function selectTool(id) {
  brush.setTool(id);
  [...toolListEl.children].forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tool === id)));
  btnDry.hidden = id !== "watercolor" && id !== "waterbrush";
  colorPicker.swatchBtn.parentElement.style.visibility = id === "eraser" ? "hidden" : "visible";
  const def = TOOLS.find((t) => t.id === id);
  strengthLabel.textContent = def.strengthLabel;
  rowStrength.hidden = false;
  updateSizePreviewDot();
}

function updateSizePopoverValues() {
  rangeSize.value = String(brush.getSize());
  rangeStrength.value = String(brush.getStrength());
  brushPreview(brushPreviewCanvas, brush);
}

function updateSizePreviewDot() {
  const px = Math.max(6, Math.min(32, brush.sizePx() * 0.5));
  sizePreviewDot.style.width = `${px}px`;
  sizePreviewDot.style.height = `${px}px`;
  sizePreviewDot.style.background = brush.tool === "eraser" ? "#c9c4b6" : brush.color;
}

export async function openNewWork({ width, height, paperType, title }) {
  let w = width;
  let h = height;
  if (settings.lowQuality) {
    w = Math.round(w * 0.8);
    h = Math.round(h * 0.8);
  }
  const newDoc = SketchDocument.createDefault({ width: w, height: h, paperType, title });
  await setupDocument(newDoc);
  await saveNow();
}

export async function openWork(id) {
  const record = await loadWorkRecord(id);
  if (!record) return;
  const hydrated = await hydrateDocument(record);
  await setupDocument(hydrated);
}

async function setupDocument(newDoc) {
  doc = newDoc;
  history.reset();
  titleInput.value = doc.title;
  syncStageDom(doc, stageEl);

  if (inputController) inputController.dispose();
  viewport = new Viewport(viewportEl, stageEl, doc.width, doc.height);
  inputController = new InputController({
    viewportEl,
    getViewport: () => viewport,
    getDoc: () => doc,
    getActiveLayer: () => doc.getActiveLayer(),
    brush,
    history,
    onStrokeStart: () => {},
    onStrokeCommit: () => {
      updateLayerThumbnails();
      scheduleAutosave();
    },
    onRequestUndo: () => {
      history.undo(doc);
      renderLayerPanel();
      scheduleAutosave();
    },
    onRequestRedo: () => {
      history.redo(doc);
      renderLayerPanel();
      scheduleAutosave();
    },
  });

  renderLayerPanel();
  showEditorScreen();
  requestAnimationFrame(() => viewport.fit());
}

function renderLayerPanel() {
  layerList.innerHTML = "";
  layerRowRefs = new Map();
  if (!doc) return;
  const orderTopFirst = [...doc.layers].reverse();
  btnLayerAdd.disabled = doc.layers.length >= 4;

  for (const layer of orderTopFirst) {
    const idx = doc.layers.indexOf(layer);
    const li = document.createElement("li");
    li.className = "layer-item" + (idx === doc.activeLayerIndex ? " active" : "");

    const thumb = document.createElement("canvas");
    thumb.className = "layer-thumb";
    thumb.width = 72;
    thumb.height = 56;
    drawThumb(thumb, layer);

    const nameSpan = document.createElement("span");
    nameSpan.className = "layer-name";
    nameSpan.textContent = layer.name + (layer.isSketch ? "(したがき)" : "");

    const clickArea = document.createElement("div");
    clickArea.style.display = "flex";
    clickArea.style.alignItems = "center";
    clickArea.style.gap = "6px";
    clickArea.style.flex = "1";
    clickArea.style.cursor = "pointer";
    clickArea.appendChild(thumb);
    clickArea.appendChild(nameSpan);
    clickArea.addEventListener("click", () => {
      doc.activeLayerIndex = idx;
      renderLayerPanel();
    });

    const visBtn = document.createElement("button");
    visBtn.textContent = layer.visible ? "👁" : "🚫";
    visBtn.setAttribute("aria-label", "見える/見えない");
    visBtn.addEventListener("click", () => {
      layer.visible = !layer.visible;
      layer.applyOpacityToDom();
      visBtn.textContent = layer.visible ? "👁" : "🚫";
      scheduleAutosave();
    });

    const opacityBtn = document.createElement("button");
    opacityBtn.className = "opacity-toggle";
    const opacityLabels = ["うすい", "ふつう", "こい"];
    opacityBtn.textContent = opacityLabels[layer.opacityLevel];
    opacityBtn.addEventListener("click", () => {
      layer.opacityLevel = (layer.opacityLevel + 1) % 3;
      layer.applyOpacityToDom();
      opacityBtn.textContent = opacityLabels[layer.opacityLevel];
      scheduleAutosave();
    });

    const upBtn = document.createElement("button");
    upBtn.textContent = "▲";
    upBtn.setAttribute("aria-label", "上へ");
    upBtn.disabled = idx === doc.layers.length - 1;
    upBtn.addEventListener("click", () => {
      doc.moveLayer(layer.id, 1);
      syncStageDom(doc, stageEl);
      renderLayerPanel();
      scheduleAutosave();
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "▼";
    downBtn.setAttribute("aria-label", "下へ");
    downBtn.disabled = idx === 0;
    downBtn.addEventListener("click", () => {
      doc.moveLayer(layer.id, -1);
      syncStageDom(doc, stageEl);
      renderLayerPanel();
      scheduleAutosave();
    });

    const dupBtn = document.createElement("button");
    dupBtn.textContent = "⧉";
    dupBtn.setAttribute("aria-label", "コピー");
    dupBtn.disabled = doc.layers.length >= 4;
    dupBtn.addEventListener("click", () => {
      doc.duplicateLayer(layer.id);
      syncStageDom(doc, stageEl);
      renderLayerPanel();
      scheduleAutosave();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.setAttribute("aria-label", "けす");
    delBtn.disabled = doc.layers.length <= 1;
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog(`「${layer.name}」を けしますか？`);
      if (!ok) return;
      doc.removeLayer(layer.id);
      syncStageDom(doc, stageEl);
      renderLayerPanel();
      scheduleAutosave();
    });

    const excludeLabel = document.createElement("label");
    excludeLabel.className = "exclude-chk";
    const excludeChk = document.createElement("input");
    excludeChk.type = "checkbox";
    excludeChk.checked = layer.excludeFromExport;
    excludeChk.addEventListener("change", () => {
      layer.excludeFromExport = excludeChk.checked;
      scheduleAutosave();
    });
    excludeLabel.appendChild(excludeChk);
    excludeLabel.appendChild(document.createTextNode("除外"));

    const row2 = document.createElement("div");
    row2.style.display = "flex";
    row2.style.flexWrap = "wrap";
    row2.style.gap = "3px";
    row2.style.alignItems = "center";
    row2.appendChild(visBtn);
    row2.appendChild(opacityBtn);
    row2.appendChild(upBtn);
    row2.appendChild(downBtn);
    row2.appendChild(dupBtn);
    row2.appendChild(delBtn);
    row2.appendChild(excludeLabel);

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.flex = "1";
    wrap.appendChild(clickArea);
    wrap.appendChild(row2);

    li.appendChild(wrap);
    layerList.appendChild(li);
    layerRowRefs.set(layer.id, thumb);
  }
}

function drawThumb(canvas, layer) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
  if (layer.isWet()) ctx.drawImage(layer.wetCanvas, 0, 0, canvas.width, canvas.height);
}

function updateLayerThumbnails() {
  if (!doc) return;
  for (const layer of doc.layers) {
    const thumb = layerRowRefs.get(layer.id);
    if (thumb) drawThumb(thumb, layer);
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveNow, 3000);
}

async function saveNow() {
  if (!doc) return;
  try {
    await saveWork(doc);
  } catch (e) {
    console.warn("保存に失敗しました", e);
  }
}

function exportPng() {
  if (!doc) return;
  const canvas = doc.flatten({ forExport: true });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${doc.title}_${date}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

function printWork() {
  if (!doc) return;
  let printArea = document.getElementById("print-area");
  if (!printArea) {
    printArea = document.createElement("div");
    printArea.id = "print-area";
    document.body.appendChild(printArea);
  }
  printArea.innerHTML = "";
  const canvas = doc.flatten({ forExport: true });
  printArea.appendChild(canvas);
  window.print();
}
