/**
 * Phát hiện cấu trúc giao diện chat bằng Canny Edge Detection + Contour Analysis.
 *
 * Pipeline:
 *   1. sharp  → Resize + Grayscale + Raw pixels
 *   2. Gaussian Blur (5×5)  → giảm noise
 *   3. Sobel Gradient  → biên độ + góc gradient
 *   4. Non-Maximum Suppression  → làm mỏng cạnh
 *   5. Double Threshold + Hysteresis  → nhị phân hóa cạnh (Canny hoàn chỉnh)
 *   6. Horizontal Line Analysis  → đếm đường ngang đặc trưng của chat bubbles
 *   7. Rectangular Contour Count  → đếm khối hình chữ nhật xếp dọc
 */

import sharp from 'sharp';

// ── Tham số xử lý ─────────────────────────────────────────────────────────
const TARGET_W    = 300;    // resize về 300px rộng (giữ tỷ lệ)
const CANNY_LOW   = 15;     // ngưỡng thấp Canny (0–255)
const CANNY_HIGH  = 45;     // ngưỡng cao Canny (0–255)

// ── Tiêu chí phân loại ────────────────────────────────────────────────────
const MIN_H_LINES = 3;      // ít nhất 3 đường ngang liên tục = top-bar + ≥2 bong bóng
const MIN_RECT    = 2;      // ít nhất 2 khối hình chữ nhật rộng chiếm ≥40% ảnh
const MAX_H_LINES = 60;     // quá nhiều đường ngang = ảnh texture/pattern, không phải chat

// ─────────────────────────────────────────────────────────────────────────

/** Gaussian blur 5×5 kernel (sigma≈1) */
function gaussianBlur(g, w, h) {
  const K = [1,4,6,4,1, 4,16,24,16,4, 6,24,36,24,6, 4,16,24,16,4, 1,4,6,4,1];
  const S = 256;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let ky = 0; ky < 5; ky++) {
        for (let kx = 0; kx < 5; kx++) {
          const px = Math.min(Math.max(x + kx - 2, 0), w - 1);
          const py = Math.min(Math.max(y + ky - 2, 0), h - 1);
          v += g[py * w + px] * K[ky * 5 + kx];
        }
      }
      out[y * w + x] = v / S;
    }
  }
  return out;
}

/** Sobel gradient – trả về magnitude và angle (radian) */
function sobelGradient(g, w, h) {
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[(y-1)*w+(x-1)] - 2*g[y*w+(x-1)] - g[(y+1)*w+(x-1)]
               +  g[(y-1)*w+(x+1)] + 2*g[y*w+(x+1)] + g[(y+1)*w+(x+1)];
      const gy = -g[(y-1)*w+(x-1)] - 2*g[(y-1)*w+x] - g[(y-1)*w+(x+1)]
               +  g[(y+1)*w+(x-1)] + 2*g[(y+1)*w+x] + g[(y+1)*w+(x+1)];
      mag[i] = Math.sqrt(gx*gx + gy*gy);
      ang[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, ang };
}

/** Non-Maximum Suppression – giữ chỉ pixel cực đại theo hướng gradient */
function nonMaxSuppression(mag, ang, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i   = y * w + x;
      const a   = ang[i];
      const deg = ((a * 180 / Math.PI) + 180) % 180;
      let n1, n2;
      if (deg < 22.5 || deg >= 157.5)      { n1 = mag[i-1];   n2 = mag[i+1]; }
      else if (deg < 67.5)                  { n1 = mag[(y-1)*w+(x+1)]; n2 = mag[(y+1)*w+(x-1)]; }
      else if (deg < 112.5)                 { n1 = mag[(y-1)*w+x];     n2 = mag[(y+1)*w+x]; }
      else                                  { n1 = mag[(y-1)*w+(x-1)]; n2 = mag[(y+1)*w+(x+1)]; }
      out[i] = (mag[i] >= n1 && mag[i] >= n2) ? mag[i] : 0;
    }
  }
  return out;
}

/** Double Threshold + Hysteresis (Canny bước cuối) */
function doubleThreshold(nms, w, h, lo, hi) {
  const STRONG = 255, WEAK = 50, NONE = 0;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= hi)       out[i] = STRONG;
    else if (nms[i] >= lo)  out[i] = WEAK;
    else                    out[i] = NONE;
  }
  // Hysteresis: WEAK pixel liền kề STRONG → STRONG
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (out[i] === WEAK) {
        const hasStrong = [i-1,i+1,(y-1)*w+x,(y+1)*w+x,
                           (y-1)*w+(x-1),(y-1)*w+(x+1),
                           (y+1)*w+(x-1),(y+1)*w+(x+1)]
                          .some(j => out[j] === STRONG);
        out[i] = hasStrong ? STRONG : NONE;
      }
    }
  }
  return out;
}

/**
 * Đếm số "đường ngang nổi bật" – đặc trưng của chat bubbles.
 * Mỗi đường = một dải liên tục của các hàng pixel có mật độ cạnh ngang cao.
 */
function countHorizontalLines(edges, w, h) {
  const H_THRESH = 0.15; // hàng có ≥15% pixel cạnh = có đường ngang
  let lines = 0, inLine = false;
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    for (let x = 0; x < w; x++) if (edges[y * w + x] > 0) cnt++;
    const density = cnt / w;
    if (density >= H_THRESH) { if (!inLine) { lines++; inLine = true; } }
    else inLine = false;
  }
  return lines;
}

/**
 * Đếm "khối hình chữ nhật rộng" trong ảnh cạnh –
 * tức là các vùng bị bao bởi đường ngang kéo dài ≥40% chiều rộng ảnh.
 * Đây là đặc trưng của chat bubbles và các thanh UI.
 */
function countWideRectangles(edges, w, h) {
  const MIN_WIDTH_RATIO = 0.40; // đường phải dài ≥40% chiều rộng
  const MIN_SPAN = 10;          // chiều cao khối ≥10px
  const minW = Math.floor(w * MIN_WIDTH_RATIO);

  // Tìm các hàng là "đường ngang dài"
  const isHLine = new Array(h).fill(false);
  for (let y = 0; y < h; y++) {
    // Đếm đoạn liên tục dài nhất trong hàng này
    let maxRun = 0, run = 0;
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x] > 0) { run++; maxRun = Math.max(maxRun, run); }
      else run = 0;
    }
    isHLine[y] = maxRun >= minW;
  }

  // Đếm các cặp đường ngang cách nhau ≥ MIN_SPAN (= mỗi cặp là 1 khối)
  let rects = 0, lastLine = -1;
  for (let y = 0; y < h; y++) {
    if (isHLine[y]) {
      if (lastLine >= 0 && (y - lastLine) >= MIN_SPAN) rects++;
      lastLine = y;
    }
  }
  return rects;
}

/**
 * Xác định ảnh có phải screenshot giao diện chat không.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ valid: boolean, reason: string, hLines: number, rects: number }>}
 */
export async function detectChatStructure(imageBuffer) {
  // ── Bước 1: Tiền xử lý bằng sharp ─────────────────────────────────
  const { data: raw, info } = await sharp(imageBuffer)
    .resize({ width: TARGET_W, withoutEnlargement: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < raw.length; i++) gray[i] = raw[i]; // uint8 → float

  // ── Bước 2–5: Canny Edge Detection ────────────────────────────────
  const blurred = gaussianBlur(gray, w, h);
  const { mag, ang } = sobelGradient(blurred, w, h);
  const nms   = nonMaxSuppression(mag, ang, w, h);
  const edges = doubleThreshold(nms, w, h, CANNY_LOW, CANNY_HIGH);

  // ── Bước 6–7: Phân tích cấu trúc ─────────────────────────────────
  const hLines = countHorizontalLines(edges, w, h);
  const rects  = countWideRectangles(edges, w, h);

  console.log(`[CV] ${w}×${h}px | hLines=${hLines} | rects=${rects}`);

  let valid  = true;
  let reason = '';

  if (hLines < MIN_H_LINES) {
    valid  = false;
    reason = 'Ảnh không có cấu trúc giao diện chat (thiếu các đường ngang). Vui lòng chụp màn hình cuộc hội thoại.';
  } else if (rects < MIN_RECT) {
    valid  = false;
    reason = 'Không phát hiện đủ khối tin nhắn hình chữ nhật. Vui lòng chụp màn hình bao gồm nhiều tin nhắn.';
  } else if (hLines > MAX_H_LINES) {
    valid  = false;
    reason = 'Ảnh có quá nhiều đường cạnh (có thể là ảnh texture hoặc ảnh chụp thật). Vui lòng gửi screenshot tin nhắn.';
  }

  return { valid, reason, hLines, rects };
}
