import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SessionDatabaseStats, SessionStoragePreview } from "@ycode/shared";
import { TaskStorageDialog } from "../../src/TaskStorageDialog.js";
import type { TaskStorageService } from "../../src/hooks/useTaskStorage.js";
import { YCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import "../../src/styles.css";

const parameters = new URLSearchParams(location.search);
function Fixture() {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(0);
  const [optimizeCalls, setOptimizeCalls] = useState(0);
  const [scope, setScope] = useState(0);
  const service = useMemo<TaskStorageService>(() => {
    let attempts = 0;
    const database: SessionDatabaseStats = {
      databaseBytes: 16384,
      walBytes: 0,
      pageSize: 4096,
      pageCount: 4,
      freelistCount: 2,
      freelistBytes: 8192,
      autoVacuum: 0,
      journalMode: "wal",
    };
    const preview: SessionStoragePreview = {
      sessionId: "one",
      revision: "version",
      state: "present",
      logicalBytes: 2048,
      recordCount: 20,
      ownedFileBytes: 1024,
      ownedFileCount: 1,
      blockers: parameters.has("blocked") ? ["session-active"] : [],
    };
    return {
      previewTaskStorage: async () => {
        if (parameters.has("delay"))
          await new Promise<void>((resolve) =>
            window.addEventListener("finish-preview", () => resolve(), { once: true }),
          );
        return structuredClone(preview);
      },
      purgeTaskStorage: async (params) => {
        if (!params.confirmPermanent || params.expectedRevision !== "version")
          throw new Error("invalid confirmation");
        setCalls((value) => value + 1);
        attempts++;
        if (parameters.has("error") && attempts === 1)
          throw new Error("session_purge_stale_preview");
        const pending = parameters.has("pending") && attempts === 1;
        preview.state = pending ? "cleanup-pending" : "purged";
        return {
          sessionId: "one",
          state: preview.state,
          deletedRecords: 20,
          deletedLogicalBytes: 2048,
          removedFileBytes: pending ? 0 : 1024,
          pendingFileCount: pending ? 1 : 0,
          databaseFreeBytes: 4096,
        };
      },
      getTaskDatabaseStats: async () => structuredClone(database),
      optimizeTaskDatabase: async (params) => {
        if (!params.confirm) throw new Error("invalid confirmation");
        setOptimizeCalls((value) => value + 1);
        const after: SessionDatabaseStats = {
          ...database,
          databaseBytes: 8192,
          pageCount: 2,
          freelistCount: 0,
          freelistBytes: 0,
        };
        return {
          status: "optimized",
          action: "vacuum",
          before: structuredClone(database),
          after,
          reclaimedBytes: 8192,
          durationMs: 1,
        };
      },
    };
  }, [scope]);
  return (
    <div className="h-screen bg-background p-4 text-foreground">
      <button onClick={() => setOpen(true)}>Open storage</button>
      <button data-testid="switch" onClick={() => setScope((value) => value + 1)}>
        Switch source
      </button>
      <output data-testid="calls">{calls}</output>
      <output data-testid="optimize-calls">{optimizeCalls}</output>
      {open ? (
        <TaskStorageDialog
          target={{ taskId: "one", workspacePath: "D:/workspace/test" }}
          title={`Conversation ${scope}`}
          service={service}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <YCodeIntlProvider initialLocale={parameters.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
    <Fixture />
  </YCodeIntlProvider>,
);
import.meta.hot?.dispose(() => root.unmount());
