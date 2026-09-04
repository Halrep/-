// もどす/すすむ。ストローク単位で「変更のあったレイヤー」の描画前後を
// まるごと複製して保持する（MVPでは1手=1レイヤーのスナップショット）。
// レイヤーの追加・削除・並べ替えは対象外（現状復帰が難しいため）。

const HISTORY_LIMIT = 20;

export class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
    this._pendingLayer = null;
    this._pendingSnapshot = null;
  }

  beginAction(layer) {
    this._pendingLayer = layer;
    this._pendingSnapshot = layer.snapshotClone();
  }

  commitAction() {
    if (!this._pendingLayer) return;
    this.undoStack.push({ layerId: this._pendingLayer.id, snapshot: this._pendingSnapshot });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this._pendingLayer = null;
    this._pendingSnapshot = null;
    this._notify();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(doc) {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const layer = doc.layers.find((l) => l.id === entry.layerId);
    if (!layer) {
      this._notify();
      return false;
    }
    const afterSnapshot = layer.snapshotClone();
    layer.restoreFrom(entry.snapshot);
    this.redoStack.push({ layerId: entry.layerId, snapshot: afterSnapshot });
    this._notify();
    return true;
  }

  redo(doc) {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const layer = doc.layers.find((l) => l.id === entry.layerId);
    if (!layer) {
      this._notify();
      return false;
    }
    const beforeSnapshot = layer.snapshotClone();
    layer.restoreFrom(entry.snapshot);
    this.undoStack.push({ layerId: entry.layerId, snapshot: beforeSnapshot });
    this._notify();
    return true;
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this._notify();
  }

  _notify() {
    this.onChange?.(this.canUndo(), this.canRedo());
  }
}
