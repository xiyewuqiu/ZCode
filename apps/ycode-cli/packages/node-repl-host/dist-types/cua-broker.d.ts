import type { ComputerUseRuntime } from "@ycode/ycode-cua";
import type { Logger } from "@ycode/contracts";
import type { NodeReplCuaBrokerConnection } from "./cua-bridge.js";
export interface NodeReplCuaBroker {
    connection: NodeReplCuaBrokerConnection;
    ready: Promise<void>;
    close(): Promise<void>;
}
export declare function createNodeReplCuaBroker(input: {
    runtime: ComputerUseRuntime;
    logger?: Logger;
    platform?: NodeJS.Platform | string;
}): NodeReplCuaBroker;
//# sourceMappingURL=cua-broker.d.ts.map