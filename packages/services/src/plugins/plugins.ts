import type {
  PluginScope,
  PluginsOverviewResult,
  YCodePluginsMarketplaceMutationResult,
} from "@ycode/shared";
import { ServiceChannels } from "@ycode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IPluginsService {
  getOverview(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<PluginsOverviewResult>;
  addMarketplace(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    source: string;
  }): Promise<void>;
  removeMarketplace(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    marketplace: string;
  }): Promise<void>;
  updateMarketplace(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    marketplace?: string;
  }): Promise<YCodePluginsMarketplaceMutationResult | void>;
  installPlugin(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    pluginName: string;
    marketplace: string;
    scope?: PluginScope;
  }): Promise<void>;
  uninstallPlugin(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    pluginName: string;
    marketplace: string;
    scope?: PluginScope;
  }): Promise<void>;
  setPluginEnabled(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    pluginName: string;
    marketplace: string;
    scope?: PluginScope;
    nativeScope?: "user" | "project" | "local";
    enabled: boolean;
  }): Promise<void>;
}

export const IPluginsService = createServiceDescriptor<IPluginsService>(ServiceChannels.Plugins);
