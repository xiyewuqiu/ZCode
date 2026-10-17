import type { IYCodeSessionService } from "@ycode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useYCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IYCodeSessionService {
  const services = workspacePath
    ? useWorkspaceServices(workspacePath, preferredRemoteSessionId, workspaceIdentity)
    : useServices();
  return services.ycodeSessionService;
}
