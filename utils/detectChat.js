/**
 * Phát hiện cấu trúc giao diện chat bằng Canny Edge Detection + Edge Band Analysis.
 *
 * Pipeline:
 *   1. sharp  → Resize + Grayscale + Raw pixels
 *   2. Gaussian Blur (5×5)  → giảm noise
 *   3. Sobel Gradient  → biên độ + góc gradient
 *   4. Non-Maximum Suppression  → làm mỏng cạnh
 *   5. Double Threshold + Hysteresis  → nhị phân hóa cạnh (Canny hoàn chỉnh)
 *   6. Edge Band with Gaps Analysis  → đếm các vùng nội dung phân tách bởi khoảng trắng
 *      (thay thế countWideRectangles – vốn không nhận được bubble bo tròn)
 */

import sharp from 'sharp';

// ── Tham số xử lý ─────────────────────────────────────────────────────────
const TARGET_W   = 300;  // resize về 300px rộng
const CANNY_LOW  = 8;    // ngưỡng thấp Canny – đủ nhạy với viền xám nhạt trên nền trắng
const CANNY_HIGH = 28;   // ngưỡng cao Canny

// ── Tiêu chí phân loại ────────────────────────────────────────────────────
// Phải thỏa MỌI điều kiện sau:
const MIN_H_LINES = 2;   // ít nhất 2 "đường ngang" (nhóm liên tục các hàng edge cao)
const MAX_H_LINES = 50;  // quá nhiều → ảnh dày đặc chi tiết (không phải screenshot UI)
const MIN_BANDS   = 2;   // ≥2 vùng nội dung phân tách bởi khoảng trắng thực sự
const H_THRESH    = 0.07; // hàng có ≥7% pixel edge = "hàng có nội dung"
const GAP_MIN     = 4;   // khoảng trắng ≥4 hàng mới tính là ranh giới thực giữa 2 bubble

// ─────────────────────────────────────────────────────────────────────────

function gaussianBlur(g, w, h) {
  const K = [1,4,6,4,1, 4,16,24,16,4, 6,24,36,24,6, 4,16,24,16,4, 1,4,6,4,1];
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
      out[y * w + x] = v / 256;
    }
  }
  return out;
}

function sobelGradient(g, w, h) {
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i  = y * w + x;
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

function nonMaxSuppression(mag, ang, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i   = y * w + x;
      const deg = ((ang[i] * 180 / Math.PI) + 180) % 180;
      let n1, n2;
      if      (deg < 22.5 || deg >= 157.5) { n1 = mag[i-1]; n2 = mag[i+1]; }
      else if (deg < 67.5)                 { n1 = mag[(y-1)*w+(x+1)]; n2 = mag[(y+1)*w+(x-1)]; }
      else if (deg < 112.5)                { n1 = mag[(y-1)*w+x];     n2 = mag[(y+1)*w+x]; }
      else                                 { n1 = mag[(y-1)*w+(x-1)]; n2 = mag[(y+1)*w+(x+1)]; }
      out[i] = (mag[i] >= n1 && mag[i] >= n2) ? mag[i] : 0;
    }
  }
  return out;
}

function doubleThreshold(nms, w, h, lo, hi) {
  const STRONG = 255, WEAK = 50;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < nms.length; i++) {
    if      (nms[i] >= hi) out[i] = STRONG;
    else if (nms[i] >= lo) out[i] = WEAK;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (out[i] === WEAK) {
        const neighbors = [i-1,i+1,(y-1)*w+x,(y+1)*w+x,
                           (y-1)*w+(x-1),(y-1)*w+(x+1),(y+1)*w+(x-1),(y+1)*w+(x+1)];
        out[i] = neighbors.some(j => out[j] === STRONG) ? STRONG : 0;
      }
    }
  }
  return out;
}

/** Tính mật độ edge mỗi hàng */
function rowEdgeDensities(edges, w, h) {
  const densities = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    for (let x = 0; x < w; x++) if (edges[y * w + x] > 0) cnt++;
    densities[y] = cnt / w;
  }
  return densities;
}

/**
 * Đếm số nhóm hàng có mật độ edge cao (= "đường ngang" của chat bubble).
 * Mỗi nhóm liên tục = 1 hLine.
 */
function countHorizontalLines(densities) {
  let lines = 0, inLine = false;
  for (const d of densities) {
    if (d >= H_THRESH) { if (!inLine) { lines++; inLine = true; } }
    else inLine = false;
  }
  return lines;
}

/**
 * Đếm số "vùng nội dung" phân tách bởi khoảng trắng thực sự (≥ GAP_MIN hàng edge thấp).
 *
 * Khác với countHorizontalLines ở chỗ: khoảng trắng ngắn (1-3 hàng) không tính là ranh giới.
 * Chỉ khoảng trắng thực sự (≥ GAP_MIN hàng) mới tách 2 bubble ra.
 *
 * Chat screenshot (ảnh SMS này): gap giữa bubble = 5-20 hàng → bands ≥ 2 ✓
 * Ảnh chụp thật: thường là 1 vùng liên tục → bands = 1 ✗
 */
function countEdgeBands(densities) {
  let bands = 0, gapLen = 0, inBand = false;
  for (const d of densities) {
    if (d >= H_THRESH) {
      if (!inBand) { bands++; inBand = true; }
      gapLen = 0;
    } else {
      gapLen++;
      if (gapLen >= GAP_MIN) inBand = false; // khoảng trắng đủ lớn → ranh giới thực
    }
  }
  return bands;
}

/**
 * Xác định ảnh có phải screenshot giao diện chat không.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ valid: boolean, reason: string, hLines: number, bands: number }>}
 */
export async function detectChatStructure(imageBuffer) {
  // ── Bước 1: Tiền xử lý ────────────────────────────────────────────
  const { data: raw, info } = await sharp(imageBuffer)
    .resize({ width: TARGET_W, withoutEnlargement: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < raw.length; i++) gray[i] = raw[i];

  // ── Bước 2–5: Canny Edge Detection ────────────────────────────────
  const blurred = gaussianBlur(gray, w, h);
  const { mag, ang } = sobelGradient(blurred, w, h);
  const nms   = nonMaxSuppression(mag, ang, w, h);
  const edges = doubleThreshold(nms, w, h, CANNY_LOW, CANNY_HIGH);

  // ── Bước 6: Phân tích cấu trúc ────────────────────────────────────
  const densities = rowEdgeDensities(edges, w, h);
  const hLines    = countHorizontalLines(densities);
  const bands     = countEdgeBands(densities);

  console.log(`[CV] ${w}×${h}px | hLines=${hLines} | bands=${bands}`);

  let valid  = true;
  let reason = '';

  if (hLines < MIN_H_LINES) {
    valid  = false;
    reason = 'Ảnh không có đủ cấu trúc nội dung. Vui lòng chụp màn hình cuộc hội thoại tin nhắn.';
  } else if (hLines > MAX_H_LINES) {
    valid  = false;
    reason = 'Ảnh có quá nhiều chi tiết phức tạp – có vẻ là ảnh chụp thật chứ không phải screenshot. Vui lòng gửi ảnh chụp màn hình tin nhắn.';
  } else if (bands < MIN_BANDS) {
    valid  = false;
    reason = 'Không phát hiện đủ vùng tin nhắn phân tách rõ ràng. Vui lòng chụp màn hình bao gồm nhiều tin nhắn.';
  }

  return { valid, reason, hLines, bands };
}
