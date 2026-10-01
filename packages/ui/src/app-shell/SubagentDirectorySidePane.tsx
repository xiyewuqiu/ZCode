import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { SubagentProjectionState } from "@zcode/shared/zcode-protocol-v4";
import { useSessionSubagents } from "@/hooks/useSessionSubagents.js";
import type {
  OpenScopedSubagentSideTabRequest,
  SubagentDirectorySidePaneTab,
} from "@/lib/workspaceSidePane.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import type { ConversationStoreState } from "@/v4/conversationProjectionStore.js";
import { V4PaneConversationProvider, useV4Conversation } from "@/v4/V4ConversationContext.js";
import { useConversationProjectionSelector } from "@/v4/useConversationProjection.js";
import { SubagentDirectoryList } from "./SubagentDirectoryList.js";
import type { SubagentDirectoryItem } from "./SubagentDirectoryRow.js";

const EMPTY_SUBAGENTS: SubagentProjectionState = {
  revision: 0,
  childSessionIds: [],
  running: [],
  endedTotal: 0,
};
const selectSubagents = (state: ConversationStoreState) =>
  state.snapshot ? (state.snapshot.subagents ?? EMPTY_SUBAGENTS) : null;

export const SubagentDirectorySidePane = memo(function SubagentDirectorySidePane({
  tab,
  onOpenSubagentSession,
}: {
  tab: SubagentDirectorySidePaneTab;
  onOpenSubagentSession: (request: OpenScopedSubagentSideTabRequest) => void;
}) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  const scopeKey = JSON.stringify([
    tab.workspaceIdentity?.trim() || tab.workspacePath,
    tab.workspacePath,
    tab.remoteSessionId,
    tab.parentSessionId,
  ]);
  return (
    <V4PaneConversationProvider scope={scope}>
      <SubagentDirectoryContents
        key={scopeKey}
        tab={tab}
        onOpenSubagentSession={onOpenSubagentSession}
      />
    </V4PaneConversationProvider>
  );
});

const SubagentDirectoryContents = memo(function SubagentDirectoryContents({
  tab,
  onOpenSubagentSession,
}: {
  tab: SubagentDirectorySidePaneTab;
  onOpenSubagentSession: (request: OpenScopedSubagentSideTabRequest) => void;
}) {
  const { layer } = useV4Conversation();
  const [acquired, setAcquired] = useState<{ layer: typeof layer; lease: SessionLease } | null>(
    null,
  );
  const lease = acquired?.layer === layer ? acquired.lease : null;
  // 普通文本流不改变 subagents 引用，目录无需随父会话每个 token 重绘。
  const subagents = useConversationProjectionSelector(lease, selectSubagents);
  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setAcquired({ layer, lease: nextLease });
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const directory = useSessionSubagents({
    enabled: subagents !== null,
    workspacePath: tab.workspacePath,
    workspaceIdentity: tab.workspaceIdentity,
    remoteSessionId: tab.remoteSessionId,
    sessionId: tab.parentSessionId,
    refreshKey: subagents?.revision ?? 0,
  });
  const handleOpen = useCallback(
    (item: SubagentDirectoryItem) => {
      onOpenSubagentSession({
        workspacePath: tab.workspacePath,
        ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
        ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
        rootSessionId: tab.rootSessionId,
        parentSessionId: tab.parentSessionId,
        childSessionId: item.childSessionId,
        subagentType: item.subagentType,
        title: item.title,
      });
    },
    [
      onOpenSubagentSession,
      tab.parentSessionId,
      tab.remoteSessionId,
      tab.rootSessionId,
      tab.workspaceIdentity,
      tab.workspacePath,
    ],
  );
  return (
    <SubagentDirectoryList
      running={subagents?.running ?? EMPTY_SUBAGENTS.running}
      ended={directory.ended.items}
      endedTotal={subagents?.endedTotal ?? directory.ended.total}
      loading={directory.loading}
      error={directory.error}
      hasMore={Boolean(directory.ended.nextCursor)}
      onLoadMore={directory.loadMore}
      onRetry={directory.refresh}
      onOpen={handleOpen}
    />
  );
});
