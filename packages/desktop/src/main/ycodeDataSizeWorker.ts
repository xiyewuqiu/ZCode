import { isMainThread, parentPort, workerData } from "node:worker_threads";

import { scanYCodeDataDirectory, type YCodeDataSizeScanRequest } from "./ycodeDataSizeScanner.js";

type WorkerResponse =
  | { ok: true; result: Awaited<ReturnType<typeof scanYCodeDataDirectory>> }
  | { ok: false; error: string };

const workerParentPort = parentPort;
if (!isMainThread && workerParentPort) {
  void scanYCodeDataDirectory(workerData as YCodeDataSizeScanRequest)
    .then((result) => {
      workerParentPort.postMessage({ ok: true, result } satisfies WorkerResponse);
    })
    .catch((error) => {
      workerParentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "unknown worker error",
      } satisfies WorkerResponse);
    });
}
