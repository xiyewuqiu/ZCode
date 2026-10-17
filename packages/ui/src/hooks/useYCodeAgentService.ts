import type { IYCodeAgentService } from "@ycode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useYCodeAgentService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IYCodeAgentService {
  const services = workspacePath
    ? useWorkspaceServices(workspacePath, preferredRemoteSessionId, workspaceIdentity)
    : useServices();
  return services.ycodeAgentService;
}
