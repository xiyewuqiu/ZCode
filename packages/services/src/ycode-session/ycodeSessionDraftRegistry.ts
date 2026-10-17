import type { YCodeSessionStateSnapshot } from "@ycode/shared";
import type {
  YCodeSessionWorkspaceTarget,
  YCodeTaskTarget,
} from "#src/ycode-session/ycodeSession.js";

function getWorkspaceKey(target: YCodeSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: YCodeTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createYCodeDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: YCodeSessionWorkspaceTarget, snapshot: YCodeSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: YCodeTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: YCodeTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
