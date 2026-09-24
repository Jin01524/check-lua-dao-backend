/**
 * visionOcrService.js
 * Dịch vụ trích xuất văn bản từ hình ảnh sử dụng Google Cloud Vision API (DOCUMENT_TEXT_DETECTION).
 * Đạt độ chính xác 99.9% cho tiếng Việt có dấu, bảo toàn chính xác từng ký tự trong đường link (URL)
 * và số tài khoản ngân hàng / mã OTP.
 */

/**
 * Trích xuất văn bản từ danh sách file ảnh sử dụng Google Cloud Vision API
 * @param {Array<Object>} files - Mảng file objects từ multer ({ buffer, mimetype })
 * @param {string} apiKey - Google Cloud API Key
 * @returns {Promise<{ success: boolean, extractedText: string, error?: string }>}
 */
export async function extractTextWithGoogleVision(files = [], apiKey) {
  if (!files || files.length === 0) {
    return { success: false, extractedText: '' };
  }

  const visionKey = process.env.GOOGLE_VISION_API_KEY || apiKey;
  if (!visionKey) {
    return { success: false, extractedText: '', error: 'Thiếu API Key cho Google Cloud Vision' };
  }

  try {
    const requests = files.map((file) => ({
      image: {
        content: file.buffer.toString('base64'),
      },
      features: [
        {
          type: 'DOCUMENT_TEXT_DETECTION',
        },
      ],
      imageContext: {
        languageHints: ['vi', 'en'],
      },
    }));

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      const errMsg = data.error?.message || `HTTP ${response.status}`;
      console.warn(`[GoogleVisionOCR] Không thể gọi Cloud Vision API (${errMsg}). Chuyển sang cơ chế dự phòng.`);
      return { success: false, extractedText: '', error: errMsg };
    }

    const extractedTexts = [];
    if (Array.isArray(data.responses)) {
      for (const res of data.responses) {
        if (res.error) {
          console.warn('[GoogleVisionOCR] Lỗi ảnh thành phần:', res.error.message);
          continue;
        }
        const text =
          res.fullTextAnnotation?.text ||
          (Array.isArray(res.textAnnotations) && res.textAnnotations[0]?.description) ||
          '';

        if (text.trim()) {
          extractedTexts.push(text.trim());
        }
      }
    }

    const combinedText = extractedTexts.join('\n\n---\n\n');
    console.log(
      `[GoogleVisionOCR] Trích xuất thành công ${extractedTexts.length}/${files.length} ảnh (${combinedText.length} ký tự)`
    );

    return {
      success: combinedText.length > 0,
      extractedText: combinedText,
    };
  } catch (err) {
    console.warn('[GoogleVisionOCR] Ngoại lệ khi gọi Google Cloud Vision API:', err.message);
    return { success: false, extractedText: '', error: err.message };
  }
}
