// ペン・タッチ・マウスの入力をまとめて扱う。
// - ペン優先（手のひら誤描画防止）: ペンが押されている間はタッチを無視する
// - 2本指=パン/ピンチ/タップでもどす、3本指タップ=すすむ
// - スペース+ドラッグ / ホイールでのパン・ズーム（トラックパッド・マウス機用）

function centroid(list) {
  let x = 0;
  let y = 0;
  for (const p of list) {
    x += p.x;
    y += p.y;
  }
  return { x: x / list.length, y: y / list.length };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class InputController {
  constructor({ viewportEl, getViewport, getDoc, getActiveLayer, brush, history, onStrokeStart, onStrokeCommit, onRequestUndo, onRequestRedo }) {
    this.viewportEl = viewportEl;
    this.getViewport = getViewport;
    this.getDoc = getDoc;
    this.getActiveLayer = getActiveLayer;
    this.brush = brush;
    this.history = history;
    this.onStrokeStart = onStrokeStart;
    this.onStrokeCommit = onStrokeCommit;
    this.onRequestUndo = onRequestUndo;
    this.onRequestRedo = onRequestRedo;

    this.touches = new Map();
    this.penActive = false;
    this.drawing = false;
    this.drawingPointerId = null;
    this.gestureMode = false;
    this.spaceHeld = false;
    this.mousePanning = false;
    this.enabled = true;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);

    viewportEl.addEventListener("pointerdown", this._onPointerDown);
    viewportEl.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
    viewportEl.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  dispose() {
    this.viewportEl.removeEventListener("pointerdown", this._onPointerDown);
    this.viewportEl.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    this.viewportEl.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    this.viewportEl.setPointerCapture?.(e.pointerId);

    if (e.pointerType === "touch") {
      if (this.penActive) {
        e.preventDefault();
        return;
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });

      if (this.touches.size === 1 && !this.gestureMode) {
        this._beginDraw(e);
        return;
      }
      if (this.touches.size >= 2) {
        if (this.drawing) this._endDraw();
        if (!this.gestureMode) {
          this.gestureMode = true;
          this._gestureStartTime = performance.now();
          this._gestureMoved = false;
          this._gestureMaxTouches = 0;
        }
        this._gestureMaxTouches = Math.max(this._gestureMaxTouches, this.touches.size);
        this._captureGestureBase();
      }
      return;
    }

    if (e.pointerType === "pen") {
      this.penActive = true;
      e.preventDefault();
      this._beginDraw(e);
      return;
    }

    if (e.button === 1 || this.spaceHeld) {
      this.mousePanning = true;
      this._panLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 0) this._beginDraw(e);
  }

  _onPointerMove(e) {
    if (!this.enabled) return;

    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      const info = this.touches.get(e.pointerId);
      info.x = e.clientX;
      info.y = e.clientY;
      if (this.gestureMode) {
        this._applyGesture();
        return;
      }
    }

    if (this.mousePanning) {
      const dx = e.clientX - this._panLast.x;
      const dy = e.clientY - this._panLast.y;
      this._panLast = { x: e.clientX, y: e.clientY };
      this.getViewport().panBy(dx, dy);
      return;
    }

    if (!this.drawing) return;
    if (e.pointerType === "touch" && e.pointerId !== this.drawingPointerId) return;

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const vp = this.getViewport();
    const pts = events.map((ev) => {
      const d = vp.screenToDoc(ev.clientX, ev.clientY);
      return { x: d.x, y: d.y, pressure: ev.pressure, t: ev.timeStamp };
    });
    this.brush.extendStroke(this.getDoc(), this.getActiveLayer(), pts, performance.now());
  }

  _onPointerUp(e) {
    if (e.pointerType === "touch") {
      const wasTracked = this.touches.has(e.pointerId);
      this.touches.delete(e.pointerId);

      if (this.gestureMode) {
        if (this.touches.size === 0) {
          const dt = performance.now() - this._gestureStartTime;
          if (!this._gestureMoved && dt < 350) {
            if (this._gestureMaxTouches === 2) this.onRequestUndo?.();
            else if (this._gestureMaxTouches >= 3) this.onRequestRedo?.();
          }
          this.gestureMode = false;
          this._gestureMaxTouches = 0;
        }
        return;
      }
      if (wasTracked && e.pointerId === this.drawingPointerId) this._endDraw();
      return;
    }

    if (e.pointerType === "pen") this.penActive = false;
    if (this.mousePanning) {
      this.mousePanning = false;
      return;
    }
    if (this.drawing) this._endDraw();
  }

  _captureGestureBase() {
    const arr = [...this.touches.values()];
    if (arr.length >= 2) {
      this._gestureCentroid = centroid(arr);
      this._gestureDist = dist(arr[0], arr[1]);
    }
  }

  _applyGesture() {
    const arr = [...this.touches.values()];
    for (const t of arr) {
      if (Math.hypot(t.x - t.startX, t.y - t.startY) > 14) this._gestureMoved = true;
    }
    if (arr.length === 2) {
      const c = centroid(arr);
      const d = dist(arr[0], arr[1]);
      const vp = this.getViewport();
      vp.panBy(c.x - this._gestureCentroid.x, c.y - this._gestureCentroid.y);
      const factor = d / (this._gestureDist || d);
      if (Math.abs(factor - 1) > 0.001) vp.zoomAt(c.x, c.y, factor);
      this._gestureCentroid = c;
      this._gestureDist = d;
    }
  }

  _beginDraw(e) {
    this.drawing = true;
    if (e.pointerType === "touch") this.drawingPointerId = e.pointerId;
    const vp = this.getViewport();
    const d = vp.screenToDoc(e.clientX, e.clientY);
    const layer = this.getActiveLayer();
    this.history.beginAction(layer);
    this.onStrokeStart?.();
    this.brush.beginStroke(this.getDoc(), layer, { x: d.x, y: d.y, pressure: e.pressure }, performance.now());
  }

  _endDraw() {
    this.drawing = false;
    this.drawingPointerId = null;
    const layer = this.getActiveLayer();
    this.brush.endStroke(this.getDoc(), layer, performance.now());
    this.history.commitAction(layer);
    this.onStrokeCommit?.();
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    this.getViewport().zoomAt(e.clientX, e.clientY, factor);
  }

  _onKeyDown(e) {
    if (e.code === "Space") {
      this.spaceHeld = true;
    }
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      this.onRequestUndo?.();
    } else if ((meta && e.key.toLowerCase() === "z" && e.shiftKey) || (meta && e.key.toLowerCase() === "y")) {
      e.preventDefault();
      this.onRequestRedo?.();
    }
  }

  _onKeyUp(e) {
    if (e.code === "Space") this.spaceHeld = false;
  }
}
