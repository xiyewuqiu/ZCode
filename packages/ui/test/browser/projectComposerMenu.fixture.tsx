import { createRoot } from "react-dom/client";
import { YCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ComposerSubmissionPendingContext } from "@/project-sidebar/ComposerSubmissionPendingContext.js";
import { ProjectComposerMenu } from "@/project-sidebar/ProjectComposerMenu.js";
import type {
  ProjectAvailability,
  RemoteProjectHost,
  VirtualProject,
} from "@/project-sidebar/contract.js";
import { projectKey } from "@/project-sidebar/view.js";
import "@/styles.css";

declare global {
  interface Window {
    __projectComposerDirectory: unknown;
    __projectComposerCalls: unknown[];
    __projectComposerPendingCalls: boolean[];
    __projectComposerConversationCalls: number;
    __projectComposerRemotePreference: unknown;
  }
}

const params = new URLSearchParams(location.search);
const theme = params.get("theme") ?? "light";
const locale = params.get("locale") === "en-US" ? "en-US" : "zh-CN";
document.documentElement.className = `${theme} theme-zai-${theme}`;

const makeProject = (
  id: string,
  hostId: string,
  name: string,
  roots: string[],
): VirtualProject => ({
  id,
  hostId,
  name,
  roots: roots.map((rootPath, position) => ({
    rootPath,
    position,
    isPrimary: position === 0,
  })),
  nameOverridden: true,
  pinned: false,
  deleted: false,
  position: Number(id) || 0,
  createdAt: 1,
  updatedAt: 1,
});

const localProject = makeProject("1", "local", "Project 1", ["/same"]);
const remoteProject = makeProject("1", "remote:server:host", "Remote Project", ["/same"]);
const otherProject = makeProject("0", "local", "Project 0", ["/other"]);
const offlineProject = makeProject("offline", "local", "Offline Project", ["/offline"]);
const zeroRootProject = makeProject("zero", "local", "Zero Root Project", []);
const remoteHost: RemoteProjectHost = {
  id: remoteProject.hostId,
  membershipId: "membership",
  kind: "server",
  target: { kind: "server", url: "https://example.test", name: "Dev device" },
  connectionStatus: "online",
  position: 0,
};
const availability = new Map<string, ProjectAvailability>([
  [projectKey(remoteProject), { online: true, entryId: "remote-entry" }],
  [projectKey(offlineProject), { online: false }],
]);
const projects = [otherProject, localProject, remoteProject, offlineProject, zeroRootProject];
const workspaceIdentity =
  params.get("identity") === "remote" ? "remote:server:host:/same" : undefined;
const workspacePath = params.get("path") ?? "/same";

window.__projectComposerCalls = [];
window.__projectComposerPendingCalls = [];
window.__projectComposerConversationCalls = 0;
window.__projectComposerDirectory = {
  tree: { projects, tasks: [] },
  projects,
  availability,
  directory: { hosts: [remoteHost], entries: [] },
  deviceNames: new Map([["host", "Dev device"]]),
  loading: false,
  error: null,
  service: {
    readDirectory: async () => ({ hosts: [remoteHost] }),
    readTree: async () => ({ projects, tasks: [] }),
  },
  remoteService: {
    readDirectory: async () => ({ hosts: [remoteHost] }),
    addEntry: async () => ({}),
  },
  refresh: async () => {},
};

createRoot(document.getElementById("root")!).render(
  <YCodeIntlProvider initialLocale={locale}>
    <TooltipProvider>
      <ComposerSubmissionPendingContext.Provider
        value={(pending) => window.__projectComposerPendingCalls.push(pending)}
      >
        <div className="p-4">
          <ProjectComposerMenu
            showEditProject={params.get("edit") !== "0"}
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            compactForRemoteControl={params.get("mobile") === "1"}
            onCreateTask={(request) => window.__projectComposerCalls.push(request)}
            onSelectConversationWorkspace={() => {
              window.__projectComposerConversationCalls += 1;
            }}
            onOpenRemoteWorkspace={(preference) => {
              window.__projectComposerRemotePreference = preference;
              return true;
            }}
          />
        </div>
      </ComposerSubmissionPendingContext.Provider>
    </TooltipProvider>
  </YCodeIntlProvider>,
);
