// paint-app/js/*.js をfile://でも動く1本のスクリプトに結合し、
// css/style.css・icons/icon.svgをインライン化した単一HTMLを作る。
const fs = require("fs");
const path = require("path");

const APP_DIR = __dirname;
const OUT_DIR = path.join(APP_DIR, "standalone");
const OUT_FILE = path.join(OUT_DIR, "index.html");

// import先に依存する順(トポロジカル順)
const ORDER = [
  "paper-texture.js",
  "canvas-engine.js",
  "viewport.js",
  "history.js",
  "brushes.js",
  "dialogs.js",
  "screens.js",
  "furigana.js",
  "color-picker.js",
  "storage.js",
  "input.js",
  "gallery.js",
  "editor.js",
  "main.js",
];

function stripModuleSyntax(src, filename) {
  const lines = src.split("\n");
  const out = [];
  for (const line of lines) {
    if (/^import\s.*from\s+["'].*["'];?\s*$/.test(line)) continue; // import文は同一スコープになるため除去
    const exported = line.replace(/^(export\s+)(async\s+function|function|class|const)/, "$2");
    out.push(exported);
  }
  return `// ---- ${filename} ----\n${out.join("\n")}`;
}

let bundle = "";
for (const file of ORDER) {
  const src = fs.readFileSync(path.join(APP_DIR, "js", file), "utf8");
  bundle += stripModuleSyntax(src, file) + "\n\n";
}
// main.jsのDOMContentLoadedは元々あるのでそのまま動く。
// main.js内のService Worker登録部分をfile://用に無効化する。
bundle = bundle.replace(
  /if \("serviceWorker" in navigator\) \{[\s\S]*?\}\)\;\s*\}\);\s*\}/,
  '// file://配布版ではService Workerは使わない(そもそも動作しない)'
);

const css = fs.readFileSync(path.join(APP_DIR, "css", "style.css"), "utf8");
const iconSvg = fs.readFileSync(path.join(APP_DIR, "icons", "icon.svg"), "utf8");
const iconDataUri = "data:image/svg+xml;base64," + Buffer.from(iconSvg, "utf8").toString("base64");

let html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");

// <head>内の外部参照(manifest/css/icon)を削除し、styleとiconを埋め込む
html = html.replace(/\n?\s*<link rel="manifest"[^>]*>\n?/, "\n");
html = html.replace(
  /<link rel="icon" href="\.\/icons\/icon\.svg" type="image\/svg\+xml">/,
  `<link rel="icon" href="${iconDataUri}" type="image/svg+xml">`
);
html = html.replace(
  /<link rel="stylesheet" href="\.\/css\/style\.css">/,
  `<style>\n${css}\n</style>`
);
// <script type="module" src="./js/main.js"></script> を結合済みスクリプトへ置換
html = html.replace(
  /<script type="module" src="\.\/js\/main\.js"><\/script>/,
  `<script>\n${bundle}\n</script>`
);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, "utf8");
console.log("wrote", OUT_FILE, fs.statSync(OUT_FILE).size, "bytes");
