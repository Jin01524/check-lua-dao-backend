import { createWorker } from 'tesseract.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abortable } from '../lib/scanCancellation.js';

export function createOcrQueue({ workerFactory = createWorker } = {}) {
  // Jobs remain serialized, including termination of a cancelled active job.
  let workerPromise;
  let lastJob = Promise.resolve();

  function getWorker() {
    if (!workerPromise) {
      const cachePath = join(tmpdir(), 'checkluadao-ocr');
      mkdirSync(cachePath, { recursive: true });
      workerPromise = workerFactory(['vie', 'eng'], undefined, { cachePath }).catch((error) => {
        workerPromise = undefined;
        throw error;
      });
    }
    return workerPromise;
  }

  /** OCR trên backend; không gửi buffer ảnh tới dịch vụ bên ngoài. */
  return function extractTextFromImages(imageFiles, { signal } = {}) {
    const result = lastJob.then(async () => {
      signal?.throwIfAborted();
      const worker = await getWorker();
      signal?.throwIfAborted();
      const texts = [];
      let termination;
      const onAbort = () => {
        workerPromise = undefined;
        termination = Promise.resolve().then(() => worker.terminate()).catch(() => {});
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        signal?.throwIfAborted();
        for (const [index, file] of imageFiles.entries()) {
          signal?.throwIfAborted();
          const { data } = await abortable(worker.recognize(file.buffer), signal);
          signal?.throwIfAborted();
          const recognized = data.text.trim();
          if (recognized) texts.push(`Ảnh ${index + 1}:\n${recognized.slice(0, 12000)}`);
        }
        return texts.join('\n\n');
      } finally {
        signal?.removeEventListener('abort', onAbort);
        if (termination) await termination;
      }
    });

    lastJob = result.catch(() => {});
    return abortable(result, signal);
  };
}

/** OCR stays local; only the cancelled request's active worker is terminated. */
export const extractTextFromImages = createOcrQueue();
