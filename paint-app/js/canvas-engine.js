import { generatePaperTexture } from "./paper-texture.js";

let uidCounter = 0;
export function nextId(prefix = "id") {
  uidCounter += 1;
  return `${prefix}_${uidCounter}_${Date.now().toString(36)}`;
}

const OPACITY_LEVELS = [0.4, 0.7, 1.0];

export class Layer {
  constructor(width, height, name, opts = {}) {
    this.id = opts.id || nextId("layer");
    this.name = name;
    this.width = width;
    this.height = height;
    this.visible = true;
    this.opacityLevel = opts.opacityLevel ?? 2;
    this.isSketch = !!opts.isSketch;
    this.excludeFromExport = opts.excludeFromExport ?? this.isSketch;

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.pointerEvents = "none";
    this.ctx = this.canvas.getContext("2d");

    this.wetCanvas = document.createElement("canvas");
    this.wetCanvas.width = width;
    this.wetCanvas.height = height;
    this.wetCanvas.style.pointerEvents = "none";
    this.wetCtx = this.wetCanvas.getContext("2d");
    this.wetSince = 0;
  }

  opacityValue() {
    return OPACITY_LEVELS[this.opacityLevel];
  }

  applyOpacityToDom() {
    const v = this.visible ? this.opacityValue() : 0;
    this.canvas.style.opacity = String(v);
    this.wetCanvas.style.opacity = String(v);
  }

  isWet() {
    return this.wetSince !== 0;
  }

  markWet(now) {
    this.wetSince = now;
  }

  mergeWetToDry() {
    if (!this.isWet()) return;
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.drawImage(this.wetCanvas, 0, 0);
    this.wetCtx.clearRect(0, 0, this.width, this.height);
    this.wetSince = 0;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.wetCtx.clearRect(0, 0, this.width, this.height);
    this.wetSince = 0;
  }

  snapshotClone() {
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    c.getContext("2d").drawImage(this.canvas, 0, 0);
    return c;
  }

  restoreFrom(canvasClone) {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(canvasClone, 0, 0);
    this.wetCtx.clearRect(0, 0, this.width, this.height);
    this.wetSince = 0;
  }

  toBlob() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }
}

export class SketchDocument {
  constructor({ id, title, width, height, paperType }) {
    this.id = id || nextId("work");
    this.title = title || "むだい";
    this.width = width;
    this.height = height;
    this.paperType = paperType || "gayoshi";
    this.paperTexture = generatePaperTexture(this.paperType);
    this.paperCanvas = renderPaperBackground(width, height, this.paperTexture);
    this.layers = [];
    this.activeLayerIndex = 0;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  static createDefault(opts) {
    const doc = new SketchDocument(opts);
    doc.addLayer("したがき", { isSketch: true, opacityLevel: 0 });
    doc.addLayer("いろ");
    doc.addLayer("かきこみ");
    doc.activeLayerIndex = doc.layers.length - 1;
    return doc;
  }

  addLayer(name, opts = {}) {
    if (this.layers.length >= 4) return null;
    const layer = new Layer(this.width, this.height, name || `かみ${this.layers.length + 1}`, opts);
    this.layers.push(layer);
    return layer;
  }

  removeLayer(id) {
    if (this.layers.length <= 1) return false;
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0) return false;
    this.layers.splice(idx, 1);
    if (this.activeLayerIndex >= this.layers.length) this.activeLayerIndex = this.layers.length - 1;
    return true;
  }

  duplicateLayer(id) {
    if (this.layers.length >= 4) return null;
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0) return null;
    const src = this.layers[idx];
    const copy = new Layer(this.width, this.height, `${src.name}のコピー`, {
      opacityLevel: src.opacityLevel,
      excludeFromExport: src.excludeFromExport,
    });
    copy.ctx.drawImage(src.canvas, 0, 0);
    this.layers.splice(idx + 1, 0, copy);
    return copy;
  }

  moveLayer(id, dir) {
    const idx = this.layers.findIndex((l) => l.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= this.layers.length) return false;
    [this.layers[idx], this.layers[j]] = [this.layers[j], this.layers[idx]];
    return true;
  }

  getActiveLayer() {
    return this.layers[this.activeLayerIndex];
  }

  flatten({ forExport = false, maxSize = null } = {}) {
    const out = document.createElement("canvas");
    let w = this.width;
    let h = this.height;
    if (maxSize && Math.max(w, h) > maxSize) {
      const scale = maxSize / Math.max(w, h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);
    if (!forExport) octx.drawImage(this.paperCanvas, 0, 0, w, h);
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      if (forExport && layer.excludeFromExport) continue;
      octx.globalAlpha = layer.opacityValue();
      octx.drawImage(layer.canvas, 0, 0, w, h);
      if (layer.isWet()) octx.drawImage(layer.wetCanvas, 0, 0, w, h);
    }
    octx.globalAlpha = 1;
    return out;
  }
}

function renderPaperBackground(width, height, texture) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = texture.tint || "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const pattern = ctx.createPattern(texture.texCanvas, "repeat");
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  return canvas;
}

// レイヤー配列の中身をDOM(#canvas-stage)へ反映する。
// 追加・削除・並べ替え・表示/不透明度変更のたびに呼ぶ。
export function syncStageDom(doc, stageEl) {
  stageEl.style.width = `${doc.width}px`;
  stageEl.style.height = `${doc.height}px`;

  if (doc.paperCanvas.parentNode !== stageEl) {
    stageEl.innerHTML = "";
    stageEl.appendChild(doc.paperCanvas);
  } else {
    stageEl.appendChild(doc.paperCanvas);
  }

  for (const layer of doc.layers) {
    stageEl.appendChild(layer.canvas);
    stageEl.appendChild(layer.wetCanvas);
    layer.applyOpacityToDom();
  }
}

export const PAPER_PRESETS = [
  { id: "postcard-h", label: "はがき(横)", w: 148, h: 100 },
  { id: "postcard-v", label: "はがき(縦)", w: 100, h: 148 },
  { id: "a5", label: "A5", w: 210, h: 148 },
  { id: "a4-h", label: "A4(横)", w: 297, h: 210 },
  { id: "square", label: "せいほうけい", w: 200, h: 200 },
];

export const PAPER_TYPES = [
  { id: "gayoshi", label: "画用紙" },
  { id: "kent", label: "ケント紙" },
  { id: "warabanshi", label: "わら半紙" },
];

const PX_PER_MM = 5.6;
export function mmToPx(mm) {
  return Math.round(mm * PX_PER_MM);
}
