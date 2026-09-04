// キャンバスの表示だけを拡大・移動する（内部の描画解像度は変えない）。
export class Viewport {
  constructor(viewportEl, stageEl, docWidth, docHeight) {
    this.viewportEl = viewportEl;
    this.stageEl = stageEl;
    this.docWidth = docWidth;
    this.docHeight = docHeight;
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.minScale = 0.2;
    this.maxScale = 8;
  }

  setDocSize(w, h) {
    this.docWidth = w;
    this.docHeight = h;
  }

  fit() {
    const vw = this.viewportEl.clientWidth;
    const vh = this.viewportEl.clientHeight;
    const pad = 20;
    const scale = Math.min((vw - pad * 2) / this.docWidth, (vh - pad * 2) / this.docHeight);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    this.x = (vw - this.docWidth * this.scale) / 2;
    this.y = (vh - this.docHeight * this.scale) / 2;
    this.apply();
  }

  apply() {
    this.stageEl.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  zoomAt(clientX, clientY, factor) {
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    const rect = this.viewportEl.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const docX = (localX - this.x) / this.scale;
    const docY = (localY - this.y) / this.scale;
    this.scale = newScale;
    this.x = localX - docX * this.scale;
    this.y = localY - docY * this.scale;
    this.apply();
  }

  screenToDoc(clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return { x: (localX - this.x) / this.scale, y: (localY - this.y) / this.scale };
  }
}
