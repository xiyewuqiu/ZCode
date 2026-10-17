export interface HelloMessage {
  type: "ycode-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "ycode-hello-ack";
  version: string;
  clientId: string;
}
