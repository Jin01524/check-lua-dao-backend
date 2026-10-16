/** Reject promptly even when a queued/shared operation cannot stop on its own. */
export function abortable(operation, signal) {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) {
    Promise.resolve(operation).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** A response closing before completion means the caller cancelled/disconnected. */
export async function withScanCancellation(req, res, work) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Scan cancelled', 'AbortError'));
  const onClose = () => { if (!res.writableEnded) cancel(); };
  req.once('aborted', cancel);
  res.once('close', onClose);
  if (req.aborted || res.destroyed) cancel();
  try {
    controller.signal.throwIfAborted();
    await work(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    req.off('aborted', cancel);
    res.off('close', onClose);
  }
}
