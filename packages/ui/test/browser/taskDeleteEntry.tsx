import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { SessionStoragePreview } from "@zcode/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../src/components/ui/context-menu.js";
import { TaskActionMenuContent } from "../../src/TaskActionMenuContent.js";
import { TaskStorageDialogHost } from "../../src/TaskStorageDialogHost.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../src/i18n/IntlProvider.js";
import { TabStoreProvider } from "../../src/store/TabStoreProvider.js";
import { useTaskStorageDialogStore } from "../../src/store/taskStorageDialogStore.js";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const metrics = { previews: 0, purges: 0 };
Object.assign(window, { deleteEntryMetrics: metrics });

const preview: SessionStoragePreview = {
  sessionId: "task-one",
  revision: "v1",
  state: "present",
  logicalBytes: 4096,
  recordCount: 30,
  ownedFileBytes: 2048,
  ownedFileCount: 2,
  blockers: [],
};

// 只提供删除链路需要的两个方法，其余服务不参与该入口。
const services = {
  zcodeTaskService: {
    previewTaskStorage: async () => {
      metrics.previews++;
      return structuredClone(preview);
    },
    purgeTaskStorage: async (input: { confirmPermanent?: boolean; expectedRevision?: string }) => {
      if (!input.confirmPermanent || input.expectedRevision !== "v1") {
        throw new Error("invalid confirmation");
      }
      metrics.purges++;
      return {
        sessionId: "task-one",
        state: "purged",
        deletedRecords: 30,
        deletedLogicalBytes: 4096,
        removedFileBytes: 2048,
        pendingFileCount: 0,
        databaseFreeBytes: 8192,
      };
    },
  },
} as unknown as IServiceAccessor;

const noop = () => {};

function Fixture() {
  const { intl } = useZCodeIntl();
  const readOnly = params.has("readonly");
  return (
    <div className="h-screen bg-background p-4 text-foreground">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button data-testid="task-row" type="button" className="rounded-md border px-3 py-2">
            Conversation one
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <TaskActionMenuContent
            intl={intl}
            isPinned={false}
            fileManagerLabel="Open in Explorer"
            taskSessionFile={{
              loading: false,
              path: "D:/workspace/demo/session.json",
              exists: true,
            }}
            activeSessionId="task-one"
            taskNativeSessionLogFile={{
              loading: false,
              path: "D:/workspace/demo/session.log",
              exists: true,
            }}
            disableTaskActions={readOnly}
            disabledReason={readOnly ? "Workspace is read-only" : undefined}
            Item={ContextMenuItem}
            Separator={ContextMenuSeparator}
            onTogglePinTask={noop}
            onStartRenameTask={noop}
            onArchiveTask={noop}
            onMarkTaskAsUnread={noop}
            onDeleteSession={() => {
              // 与生产接线一致：菜单只写入目标，弹窗由 app 级 host 挂载。
              useTaskStorageDialogStore.getState().open({
                taskId: "task-one",
                workspacePath: "D:/workspace/demo",
                title: "Conversation one",
              });
            }}
            onOpenTaskPathInFileManager={noop}
            onCopyWorkspacePath={noop}
            onCopyTaskPath={noop}
            onCopyTaskLogPath={noop}
          />
        </ContextMenuContent>
      </ContextMenu>
      <TaskStorageDialogHost />
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <ServiceProvider services={services}>
      <TabStoreProvider>
        <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
          <Fixture />
        </ZCodeIntlProvider>
      </TabStoreProvider>
    </ServiceProvider>
  </StrictMode>,
);
import.meta.hot?.dispose(() => root.unmount());
