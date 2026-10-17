import type { Event, IDisposable } from "@ycode/rpc";
import type { YCodeProtocolMessage } from "@ycode/shared";

export type YCodeProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface YCodeProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface YCodeProtocolTransport extends IDisposable {
  readonly kind: YCodeProtocolTransportKind;
  readonly onMessage: Event<YCodeProtocolMessage>;
  readonly onClose: Event<YCodeProtocolTransportClosedEvent>;
  send(message: YCodeProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
