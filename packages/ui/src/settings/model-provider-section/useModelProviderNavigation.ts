import { useEffect, useMemo } from "react";
import {
  getProviderFormLabel,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  sortModelProvidersForDisplay,
  type ProviderOrderView,
} from "@/lib/modelProviderOrdering.js";
import {
  createCustomProviderNodeKey,
  type ModelProviderNavGroup,
  type ModelProviderNavItem,
} from "@/settings/model-provider-section/constants.js";

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

/** 设置页供应商导航：只展示用户自己配置的供应商，顺序与聊天框模型菜单一致。 */
export function useModelProviderNavigation({
  modelProviders,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const customProviders = useMemo(() => {
    const allCustomProviders = modelProviders.filter(
      (provider) => provider.config.group === "standard-personal",
    );
    // 这里复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    return sortModelProvidersForDisplay(allCustomProviders, displayOrder);
  }, [displayOrder, modelProviders]);

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(
    () => [
      {
        id: "custom",
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          label: getProviderFormLabel(provider),
          provider,
        })),
      },
    ],
    // 分组标题在这个 memo 内格式化；语言切换时必须依赖 intl 才能刷新旧 locale 文案。
    [customProviders, intl],
  );

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );

  const selectedNavItem: ModelProviderNavItem | null = selectedNodeKey
    ? (navigationItems.find((item) => item.key === selectedNodeKey) ?? null)
    : null;

  const fallbackNodeKey = navigationItems[0]?.key ?? null;
  useEffect(() => {
    const hasSelectedNode = selectedNodeKey
      ? navigationItems.some((item) => item.key === selectedNodeKey)
      : false;
    if (hasSelectedNode) {
      return;
    }

    // 选中的供应商被删除或 key 已失效时回落到第一个可编辑项；
    // 此时不能让详情页停留在已消失的 key 上。
    if (selectedNodeKey !== fallbackNodeKey) {
      setSelectedNodeKey(fallbackNodeKey);
    }
  }, [fallbackNodeKey, navigationItems, selectedNodeKey, setSelectedNodeKey]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
  };
}
