// ブラシエンジン（Canvas2D）。
// 端末に筆圧ペンが無い前提のため、速度からの筆圧推定を標準の入力として使う。
// 水彩は「§6.3 フォールバック層」を既定実装とし、紙目は§6.0のとおり
// キャンバス固定のCanvasPattern（destination-out）で表現する。

export const TOOLS = [
  { id: "pencil", label: "えんぴつ", icon: "✏️", sizeRange: [2, 26], strengthLabel: "しん の こさ" },
  { id: "crayon", label: "クレパス", icon: "🖍️", sizeRange: [10, 70], strengthLabel: "ちから の いれぐあい" },
  { id: "watercolor", label: "すいさい", icon: "🖌️", sizeRange: [12, 90], strengthLabel: "みず の りょう" },
  { id: "waterbrush", label: "みずふで", icon: "💧", sizeRange: [15, 100], strengthLabel: "みず の りょう" },
  { id: "eraser", label: "けしゴム", icon: "🧹", sizeRange: [10, 100], strengthLabel: "けす つよさ" },
];

const DRY_TIMEOUT_MS = 6000;
const STABILIZE_FACTORS = [1, 0.55, 0.32, 0.18];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 58, g: 58, b: 58 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export class BrushEngine {
  constructor() {
    this.tool = "pencil";
    this.color = "#3a3a3a";
    this.settings = {};
    for (const t of TOOLS) this.settings[t.id] = { size: 45, strength: 60 };
    this.stabilizeLevel = 1;
    this._active = false;
  }

  setTool(id) {
    this.tool = id;
  }

  currentToolDef() {
    return TOOLS.find((t) => t.id === this.tool);
  }

  setColor(hex) {
    this.color = hex;
  }

  setSize(pct) {
    this.settings[this.tool].size = pct;
  }

  getSize() {
    return this.settings[this.tool].size;
  }

  setStrength(pct) {
    this.settings[this.tool].strength = pct;
  }

  getStrength() {
    return this.settings[this.tool].strength;
  }

  sizePx() {
    const def = this.currentToolDef();
    const pct = this.settings[this.tool].size / 100;
    return lerp(def.sizeRange[0], def.sizeRange[1], pct);
  }

  strengthUnit() {
    return this.settings[this.tool].strength / 100;
  }

  // --- 速度からの筆圧推定 ---
  _estimatePressure(dx, dy, dtMs) {
    if (dtMs <= 0) return 0.75;
    const speed = Math.hypot(dx, dy) / dtMs;
    const t = Math.max(0, Math.min(1, speed / 2.4));
    return lerp(1.0, 0.28, t);
  }

  beginStroke(doc, layer, point, now) {
    this._active = true;
    this._layer = layer;
    this._smoothX = point.x;
    this._smoothY = point.y;
    this._lastRawX = point.x;
    this._lastRawY = point.y;
    this._lastTime = now;
    this._leftover = 0;
    this._strokePoints = [];

    if (this.tool === "watercolor" || this.tool === "waterbrush") {
      layer.markWet(now);
    }

    this._stampAt(doc, layer, point.x, point.y, this._resolvePressure(point, 0));
  }

  _resolvePressure(point, estimated) {
    const raw = point.pressure;
    if (raw && raw > 0 && Math.abs(raw - 0.5) > 0.03) {
      return raw * 0.55 + estimated * 0.45;
    }
    return estimated;
  }

  extendStroke(doc, layer, points, now) {
    if (!this._active) return;
    for (const p of points) {
      const factor = STABILIZE_FACTORS[this.stabilizeLevel] ?? 0.32;
      this._smoothX = lerp(this._smoothX, p.x, factor);
      this._smoothY = lerp(this._smoothY, p.y, factor);

      const dt = Math.max(1, (p.t ?? now) - this._lastTime);
      const dx = p.x - this._lastRawX;
      const dy = p.y - this._lastRawY;
      const estimated = this._estimatePressure(dx, dy, dt);
      const pressure = this._resolvePressure(p, estimated);

      const dist = Math.hypot(this._smoothX - this._lastStampX, this._smoothY - this._lastStampY);
      this._walkAndStamp(doc, layer, this._smoothX, this._smoothY, pressure);

      this._lastRawX = p.x;
      this._lastRawY = p.y;
      this._lastTime = p.t ?? now;
    }
  }

  _walkAndStamp(doc, layer, x, y, pressure) {
    const spacingPx = Math.max(1.2, this.sizePx() * 0.16);
    let dist = Math.hypot(x - this._lastStampX, y - this._lastStampY);
    let steps = Math.floor((this._leftover + dist) / spacingPx);
    if (steps <= 0) {
      this._leftover += dist;
      return;
    }
    const startX = this._lastStampX;
    const startY = this._lastStampY;
    for (let i = 1; i <= steps; i++) {
      const t = (spacingPx * i - this._leftover) / dist;
      const sx = lerp(startX, x, t);
      const sy = lerp(startY, y, t);
      this._stampAt(doc, layer, sx, sy, pressure);
    }
    this._leftover = this._leftover + dist - steps * spacingPx;
  }

  _stampAt(doc, layer, x, y, pressure) {
    this._lastStampX = x;
    this._lastStampY = y;
    const angle = Math.atan2(y - (this._prevStampY ?? y), x - (this._prevStampX ?? x));
    this._prevStampX = x;
    this._prevStampY = y;

    switch (this.tool) {
      case "pencil":
        stampPencil(layer.ctx, doc, x, y, pressure, this);
        break;
      case "crayon":
        stampCrayon(layer.ctx, doc, x, y, pressure, angle, this);
        break;
      case "watercolor":
        stampWatercolor(layer.wetCtx, x, y, pressure, this, 1);
        this._strokePoints.push({ x, y, pressure });
        break;
      case "waterbrush":
        stampWatercolor(layer.wetCtx, x, y, pressure, this, 0.3);
        this._strokePoints.push({ x, y, pressure: pressure * 0.5 });
        break;
      case "eraser":
        stampEraser(layer, x, y, pressure, this);
        break;
      default:
        break;
    }
  }

  endStroke(doc, layer, now) {
    if (!this._active) return;
    this._active = false;
    if (this.tool === "watercolor" || this.tool === "waterbrush") {
      const blurPx = 4 + this.strengthUnit() * 7;
      diffuseWetLayer(layer, blurPx);
      redepositEdges(layer.wetCtx, this._strokePoints, this.color);
      layer.markWet(now);
    }
    this._strokePoints = [];
  }

  checkDrying(doc, now) {
    for (const layer of doc.layers) {
      if (layer.isWet() && now - layer.wetSince > DRY_TIMEOUT_MS) {
        layer.mergeWetToDry();
      }
    }
  }

  forceDry(layer, now) {
    layer.mergeWetToDry();
  }
}

// ---- 紙目（凹凸）パターン。destination-out の抜き量をアルファで表す ----
const grainPatternCache = new WeakMap();
function getGrainPattern(ctx, doc) {
  let p = grainPatternCache.get(doc.paperTexture);
  if (!p) {
    p = ctx.createPattern(doc.paperTexture.grainMaskCanvas, "repeat");
    grainPatternCache.set(doc.paperTexture, p);
  }
  return p;
}

function punchGrain(ctx, doc, x, y, radius, strength) {
  if (strength <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = strength;
  ctx.fillStyle = getGrainPattern(ctx, doc);
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function stampPencil(ctx, doc, x, y, pressure, brush) {
  const hardness = brush.strengthUnit();
  const radius = brush.sizePx() * (0.35 + pressure * 0.3);
  const alphaBase = lerp(0.18, 0.8, hardness) * lerp(0.5, 1, pressure);
  const grainStrength = lerp(0.75, 0.2, hardness);
  const { r, g, b } = hexToRgb(brush.color);

  ctx.save();
  ctx.globalCompositeOperation = "lighten";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},${alphaBase})`;
  ctx.fill();
  ctx.restore();

  punchGrain(ctx, doc, x, y, radius, grainStrength);
}

function stampCrayon(ctx, doc, x, y, pressure, angle, brush) {
  const force = brush.strengthUnit();
  const radius = brush.sizePx() * (0.4 + pressure * 0.25);
  const alpha = lerp(0.35, 0.9, force) * lerp(0.6, 1, pressure);
  const { r, g, b } = hexToRgb(brush.color);
  const wobble = (Math.random() - 0.5) * radius * 0.18;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(wobble, 0, radius, radius * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
  ctx.restore();

  punchGrain(ctx, doc, x, y, radius, 0.5);
}

function stampWatercolor(ctx, x, y, pressure, brush, amountScale) {
  const radius = brush.sizePx() * (0.5 + pressure * 0.35);
  const strengthUnit = brush.strengthUnit();
  const alpha = lerp(0.08, 0.4, strengthUnit) * lerp(0.5, 1, pressure) * amountScale;
  const { r, g, b } = hexToRgb(brush.color);

  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},${alpha * 0.7})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function redepositEdges(ctx, points, color) {
  if (points.length < 2) return;
  const { r, g, b } = hexToRgb(color);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(${r},${g},${b},0.14)`;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, points[0].pressure * 3);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function stampEraser(layer, x, y, pressure, brush) {
  const radius = brush.sizePx() * (0.4 + pressure * 0.3);
  const strength = brush.strengthUnit();
  const alpha = lerp(0.18, 1, strength) * lerp(0.6, 1, pressure);

  for (const ctx of [layer.ctx, layer.wetCtx]) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function diffuseWetLayer(layer, blurPx) {
  const w = layer.width;
  const h = layer.height;
  const dw = Math.max(1, Math.round(w / 2));
  const dh = Math.max(1, Math.round(h / 2));

  const a = document.createElement("canvas");
  a.width = dw;
  a.height = dh;
  a.getContext("2d").drawImage(layer.wetCanvas, 0, 0, dw, dh);

  const b = document.createElement("canvas");
  b.width = dw;
  b.height = dh;
  const bctx = b.getContext("2d");
  try {
    bctx.filter = `blur(${blurPx / 2}px)`;
  } catch (e) {
    /* filter未対応ブラウザはぼかし無しで続行 */
  }
  bctx.drawImage(a, 0, 0);

  layer.wetCtx.clearRect(0, 0, w, h);
  layer.wetCtx.imageSmoothingEnabled = true;
  layer.wetCtx.drawImage(b, 0, 0, w, h);
}

export function brushPreview(canvas, brush) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#faf7ee";
  ctx.fillRect(0, 0, w, h);
  const radius = Math.min(w, h) * 0.32 * (0.4 + brush.settings[brush.tool].size / 100 * 0.6);
  const { r, g, b } = hexToRgb(brush.color);
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
  const alpha = brush.tool === "eraser" ? 0.5 : lerp(0.3, 0.9, brush.strengthUnit());
  ctx.fillStyle = brush.tool === "eraser" ? "rgba(200,200,200,0.6)" : `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
}
