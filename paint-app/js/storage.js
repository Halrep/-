// IndexedDBへの保存・読み込み。作品はすべて端末内のみに保存し、外部へは送らない。
import { SketchDocument, Layer } from "./canvas-engine.js";

const DB_NAME = "sketchnote-db";
const DB_VERSION = 1;
const STORE = "works";
export const WORK_COUNT_WARNING = 20;

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveWork(doc) {
  const thumbCanvas = doc.flatten({ maxSize: 320 });
  const thumb = await new Promise((r) => thumbCanvas.toBlob(r, "image/png"));
  const layers = [];
  for (const layer of doc.layers) {
    layer.mergeWetToDry();
    const blob = await layer.toBlob();
    layers.push({
      id: layer.id,
      name: layer.name,
      opacityLevel: layer.opacityLevel,
      visible: layer.visible,
      excludeFromExport: layer.excludeFromExport,
      isSketch: layer.isSketch,
      blob,
    });
  }
  doc.updatedAt = Date.now();
  const record = {
    id: doc.id,
    title: doc.title,
    paperType: doc.paperType,
    width: doc.width,
    height: doc.height,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    activeLayerIndex: doc.activeLayerIndex,
    thumb,
    layers,
  };
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

export async function loadWorkList() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqP(tx.objectStore(STORE).getAll());
  return all
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, thumb: r.thumb, width: r.width, height: r.height }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadWorkRecord(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  return reqP(tx.objectStore(STORE).get(id));
}

export async function deleteWork(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function renameWork(id, title) {
  const record = await loadWorkRecord(id);
  if (!record) return;
  record.title = title;
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function duplicateWork(id) {
  const record = await loadWorkRecord(id);
  if (!record) return null;
  const copy = { ...record, id: `${record.id}_copy_${Date.now().toString(36)}`, title: `${record.title}のコピー`, updatedAt: Date.now(), createdAt: Date.now() };
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(copy);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return copy.id;
}

export async function hydrateDocument(record) {
  const doc = new SketchDocument({
    id: record.id,
    title: record.title,
    width: record.width,
    height: record.height,
    paperType: record.paperType,
  });
  doc.createdAt = record.createdAt;
  doc.updatedAt = record.updatedAt;
  doc.layers = [];
  for (const ld of record.layers) {
    const layer = new Layer(record.width, record.height, ld.name, {
      id: ld.id,
      opacityLevel: ld.opacityLevel,
      isSketch: ld.isSketch,
      excludeFromExport: ld.excludeFromExport,
    });
    layer.visible = ld.visible;
    if (ld.blob) {
      const bitmap = await createImageBitmap(ld.blob);
      layer.ctx.drawImage(bitmap, 0, 0);
    }
    doc.layers.push(layer);
  }
  doc.activeLayerIndex = Math.min(record.activeLayerIndex ?? doc.layers.length - 1, doc.layers.length - 1);
  return doc;
}

export async function estimateStorage() {
  if (navigator.storage?.estimate) {
    try {
      return await navigator.storage.estimate();
    } catch (e) {
      return null;
    }
  }
  return null;
}
