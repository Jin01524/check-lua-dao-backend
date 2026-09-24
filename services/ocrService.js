import { createWorker } from 'tesseract.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Một worker dùng chung giúp giới hạn bộ nhớ khi nhiều request đến cùng lúc.
let workerPromise;
let lastJob = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    const cachePath = join(tmpdir(), 'checkluadao-ocr');
    mkdirSync(cachePath, { recursive: true });
    workerPromise = createWorker(['vie', 'eng'], undefined, { cachePath }).catch((error) => {
      workerPromise = undefined;
      throw error;
    });
  }
  return workerPromise;
}

/** OCR trên backend; không gửi buffer ảnh tới dịch vụ bên ngoài. */
export function extractTextFromImages(imageFiles) {
  const result = lastJob.then(async () => {
    const worker = await getWorker();
    const texts = [];

    for (const [index, file] of imageFiles.entries()) {
      const { data } = await worker.recognize(file.buffer);
      const recognized = data.text.trim();
      if (recognized) texts.push(`Ảnh ${index + 1}:\n${recognized.slice(0, 12000)}`);
    }

    return texts.join('\n\n');
  });

  lastJob = result.catch(() => {});
  return result;
}
