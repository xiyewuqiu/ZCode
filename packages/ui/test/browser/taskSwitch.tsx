import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useActiveTaskSnapshotMeta } from "../../src/hooks/useActiveTaskSnapshotMeta.js";
import { requests, taskMeta } from "./taskSwitchMocks.js";
import "../../src/styles.css";

type Target = { taskId: string | null; identity?: string; remote?: string; listed?: boolean };
const commits: { target: Target; title: string | null }[] = [];
function App() {
  const [target, setTarget] = useState<Target>({ taskId: "a" });
  const meta = useActiveTaskSnapshotMeta(
    "/synthetic",
    target.taskId,
    target.remote,
    target.identity,
    target.listed ? taskMeta(target.taskId ?? "", "Listed") : null,
  );
  useLayoutEffect(() => {
    commits.push({ target, title: meta?.title ?? null });
  });
  Object.assign(window, {
    switchTarget: setTarget,
    titleCommits: commits,
    titleRequests: requests,
  });
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 data-testid="title" className="text-ui-lg">
        {meta?.title ?? "Loading"}
      </h1>
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
import.meta.hot?.dispose(() => root.unmount());
