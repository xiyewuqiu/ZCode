import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationOutline } from "../../src/v4/ConversationOutline.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import type {
  ConversationTurnNavigatorHydrationResult,
  ConversationTurnNavigatorItem,
} from "../../src/v4/conversationTurnNavigatorHelpers.js";
import "../../src/styles.css";

const items: ConversationTurnNavigatorItem[] = Array.from({ length: 2000 }, (_, index) => ({
  key: `q-${index}`,
  rowId: index,
  unitIndex: index,
  turnId: `t-${index}`,
  userText: `Question ${index} ${index === 1700 ? "前言".repeat(300) + "深层关键词" : ""}`,
  userPreview: `Question ${index}`,
  assistantPreview: `Answer ${index}`,
  assistantPreviewKind: "text",
  isRunning: index === 1999,
}));

function Fixture() {
  const [scope, setScope] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [jump, setJump] = useState<number | null>(null);
  useEffect(() => {
    const switchScope = () => setScope((value) => value + 1);
    window.addEventListener("outline-switch-scope", switchScope);
    return () => window.removeEventListener("outline-switch-scope", switchScope);
  }, []);
  const load = () => {
    setCount((value) => value + 1);
    setLoading(true);
    return new Promise<ConversationTurnNavigatorHydrationResult>((resolve) => {
      window.addEventListener(
        "outline-load-finish",
        (event) => {
          const status = (event as CustomEvent<"hydrated" | "retryable-failure">).detail;
          setLoading(false);
          if (status === "hydrated") setComplete(true);
          resolve({ status, logEpoch: "test" });
        },
        { once: true },
      );
    });
  };
  return (
    <div className="h-screen bg-background text-foreground">
      <output data-testid="load-count">{count}</output>
      <output data-testid="jump">{jump}</output>
      <ConversationOutline
        key={scope}
        items={items}
        currentKey="q-1000"
        canLoadOlder={!complete}
        loadingOlder={loading}
        onLoadAllOlder={load}
        onJumpToQuery={(item) => setJump(item.rowId)}
      />
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <ZCodeIntlProvider
    initialLocale={
      new URLSearchParams(location.search).get("locale") === "zh-CN" ? "zh-CN" : "en-US"
    }
  >
    <Fixture />
  </ZCodeIntlProvider>,
);
import.meta.hot?.dispose(() => root.unmount());
