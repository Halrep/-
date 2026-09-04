// 紙の高さマップ（粒状感のもと）を作る。
// 実寸解像度ではなく小さめのテクスチャを1回だけ生成し、キャンバス座標を
// テクスチャ座標へ折り返して参照する（毎フレームの生成コストを避けるため）。

const PAPER_PARAMS = {
  gayoshi:    { texW: 512, texH: 384, octaves: [ [8, 0.55], [24, 0.30], [70, 0.15] ], contrast: 1.35, tint: null },
  kent:       { texW: 512, texH: 384, octaves: [ [10, 0.7], [40, 0.3] ],             contrast: 0.55, tint: null },
  warabanshi: { texW: 512, texH: 384, octaves: [ [6, 0.5], [20, 0.35], [55, 0.15] ], contrast: 1.15, tint: "#f3e9c9" },
};

// セルの格子点をランダムに決め、あまり(モジュロ)を使ったバイリニア補間で
// 拡大する。補間の参照先が両端で必ずグリッドの反対側へ折り返すため、
// CanvasPatternで敷き詰めても継ぎ目ができない（真にタイル可能なノイズ）。
function makeOctave(cells, w, h) {
  const cw = Math.max(2, Math.round(w / cells));
  const ch = Math.max(2, Math.round(h / cells));
  const grid = new Float32Array(cw * ch);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * ch;
    const y0 = Math.floor(gy) % ch;
    const y1 = (y0 + 1) % ch;
    const fy = gy - Math.floor(gy);
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cw;
      const x0 = Math.floor(gx) % cw;
      const x1 = (x0 + 1) % cw;
      const fx = gx - Math.floor(gx);
      const v00 = grid[y0 * cw + x0];
      const v10 = grid[y0 * cw + x1];
      const v01 = grid[y1 * cw + x0];
      const v11 = grid[y1 * cw + x1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      out[y * w + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

export function generatePaperTexture(paperType) {
  const params = PAPER_PARAMS[paperType] || PAPER_PARAMS.gayoshi;
  const { texW, texH, octaves, contrast } = params;
  const combined = new Float32Array(texW * texH);
  let totalWeight = 0;
  for (const [cells, weight] of octaves) {
    const layer = makeOctave(cells, texW, texH);
    for (let p = 0; p < texW * texH; p++) {
      combined[p] += layer[p] * weight;
    }
    totalWeight += weight;
  }

  let min = Infinity, max = -Infinity;
  for (let p = 0; p < combined.length; p++) {
    combined[p] /= totalWeight;
    if (combined[p] < min) min = combined[p];
    if (combined[p] > max) max = combined[p];
  }
  const range = Math.max(1e-4, max - min);
  const data = new Uint8ClampedArray(texW * texH);
  for (let p = 0; p < combined.length; p++) {
    let v = (combined[p] - min) / range;
    v = 0.5 + (v - 0.5) * contrast;
    data[p] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  const texCanvas = document.createElement("canvas");
  texCanvas.width = texW;
  texCanvas.height = texH;
  const tctx = texCanvas.getContext("2d");
  const timg = tctx.createImageData(texW, texH);
  for (let p = 0; p < data.length; p++) {
    timg.data[p * 4] = data[p];
    timg.data[p * 4 + 1] = data[p];
    timg.data[p * 4 + 2] = data[p];
    timg.data[p * 4 + 3] = 255;
  }
  tctx.putImageData(timg, 0, 0);

  // destination-out で使う「抜き量」パターン。凹(値が低い)ほど不透明=強く抜く。
  const grainMaskCanvas = document.createElement("canvas");
  grainMaskCanvas.width = texW;
  grainMaskCanvas.height = texH;
  const gctx = grainMaskCanvas.getContext("2d");
  const gimg = gctx.createImageData(texW, texH);
  for (let p = 0; p < data.length; p++) {
    gimg.data[p * 4 + 3] = 255 - data[p];
  }
  gctx.putImageData(gimg, 0, 0);

  return {
    width: texW,
    height: texH,
    data,
    texCanvas,
    grainMaskCanvas,
    tint: params.tint,
    // canvas座標(px,py)における0..1の高さ（凸=1, 凹=0）を返す。紙の実寸に対して
    // テクスチャを敷き詰めるので、原点はキャンバス左上に固定される（ズームしても紙目は動かない）。
    heightAt(px, py) {
      const x = ((Math.floor(px) % texW) + texW) % texW;
      const y = ((Math.floor(py) % texH) + texH) % texH;
      return data[y * texW + x] / 255;
    },
  };
}
