import { positionPopover, show, hide } from "./dialogs.js";

const BASE_COLORS = [
  "#2b2b2b", "#7a5230", "#e0503c", "#f2924a",
  "#f4d35e", "#9bc53d", "#3fa987", "#2ea3ac",
  "#3b6fd4", "#5b4bcf", "#d65fa8", "#ffffff",
];
const RECENT_KEY = "sketchnote_recent_colors";

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) {
    /* 保存できなくても致命的ではない */
  }
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return `#${[R, G, B].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function drawHueRing(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) / 2 - 2;
  const inner = outer * 0.68;
  ctx.clearRect(0, 0, w, h);
  for (let a = 0; a < 360; a += 2) {
    const r0 = ((a - 1.2) * Math.PI) / 180;
    const r1 = ((a + 1.2) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, r0, r1);
    ctx.arc(cx, cy, inner, r1, r0, true);
    ctx.closePath();
    ctx.fillStyle = `hsl(${a},85%,55%)`;
    ctx.fill();
  }
}

function drawSVSquare(canvas, hue) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = `hsl(${hue},100%,50%)`;
  ctx.fillRect(0, 0, w, h);
  const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
  whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
  whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = whiteGrad;
  ctx.fillRect(0, 0, w, h);
  const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
  blackGrad.addColorStop(0, "rgba(0,0,0,0)");
  blackGrad.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = blackGrad;
  ctx.fillRect(0, 0, w, h);
}

export class ColorPicker {
  constructor(brush, onChange) {
    this.brush = brush;
    this.onChange = onChange;
    this.recent = loadRecent();
    this.currentHue = 0;

    this.popover = document.getElementById("popover-color");
    this.swatchBtn = document.getElementById("btn-color-swatch");
    this.baseGrid = document.getElementById("color-grid-base");
    this.recentGrid = document.getElementById("color-grid-recent");
    this.moreBtn = document.getElementById("btn-more-color");
    this.advanced = document.getElementById("color-advanced");
    this.hueRing = document.getElementById("hue-ring");
    this.svSquare = document.getElementById("sv-square");

    this._buildBaseGrid();
    this._renderRecent();
    this._bindOpen();
    this._bindAdvanced();
    this.updateSwatch();
  }

  _buildBaseGrid() {
    this.baseGrid.innerHTML = "";
    for (const hex of BASE_COLORS) {
      const b = document.createElement("button");
      b.style.setProperty("--c", hex);
      b.setAttribute("aria-label", `いろ ${hex}`);
      b.addEventListener("click", () => this.selectColor(hex));
      this.baseGrid.appendChild(b);
    }
  }

  _renderRecent() {
    this.recentGrid.innerHTML = "";
    for (const hex of this.recent) {
      const b = document.createElement("button");
      b.style.setProperty("--c", hex);
      b.setAttribute("aria-label", `さいきん つかった いろ ${hex}`);
      b.addEventListener("click", () => this.selectColor(hex));
      this.recentGrid.appendChild(b);
    }
  }

  selectColor(hex) {
    this.brush.setColor(hex);
    this._pushRecent(hex);
    this.updateSwatch();
    this.onChange?.(hex);
    hide(this.popover);
  }

  _liveColor(hex) {
    this.brush.setColor(hex);
    this.updateSwatch();
    this.onChange?.(hex);
  }

  _pushRecent(hex) {
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 8);
    saveRecent(this.recent);
    this._renderRecent();
  }

  updateSwatch() {
    this.swatchBtn.style.setProperty("--swatch-color", this.brush.color);
  }

  _bindOpen() {
    this.swatchBtn.addEventListener("click", () => {
      if (!this.popover.hidden) {
        hide(this.popover);
        return;
      }
      show(this.popover);
      positionPopover(this.popover, this.swatchBtn);
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.popover.hidden) return;
      if (this.popover.contains(e.target) || this.swatchBtn.contains(e.target)) return;
      hide(this.popover);
    });
  }

  _bindAdvanced() {
    this.moreBtn.addEventListener("click", () => {
      const willShow = this.advanced.hidden;
      this.advanced.hidden = !willShow;
      if (willShow) {
        drawHueRing(this.hueRing);
        drawSVSquare(this.svSquare, this.currentHue);
      }
    });

    const pickHue = (e) => {
      const rect = this.hueRing.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const x = e.clientX - rect.left - cx;
      const y = e.clientY - rect.top - cy;
      let deg = (Math.atan2(y, x) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      this.currentHue = deg;
      drawSVSquare(this.svSquare, this.currentHue);
      this._liveColor(hsvToHex(this.currentHue, 0.85, 0.9));
    };
    this.hueRing.addEventListener("pointerdown", (e) => {
      this._hueDown = true;
      this.hueRing.setPointerCapture(e.pointerId);
      pickHue(e);
    });
    this.hueRing.addEventListener("pointermove", (e) => {
      if (this._hueDown) pickHue(e);
    });
    this.hueRing.addEventListener("pointerup", () => {
      this._hueDown = false;
      this._pushRecent(this.brush.color);
    });

    const pickSV = (e) => {
      const rect = this.svSquare.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const s = x / rect.width;
      const v = 1 - y / rect.height;
      this._liveColor(hsvToHex(this.currentHue, s, v));
    };
    this.svSquare.addEventListener("pointerdown", (e) => {
      this._svDown = true;
      this.svSquare.setPointerCapture(e.pointerId);
      pickSV(e);
    });
    this.svSquare.addEventListener("pointermove", (e) => {
      if (this._svDown) pickSV(e);
    });
    this.svSquare.addEventListener("pointerup", () => {
      this._svDown = false;
      this._pushRecent(this.brush.color);
    });
  }
}
