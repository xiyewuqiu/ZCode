import { useYCodeStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useYCodeStoreWithDefault((state) => state.interfaceMode === "office", false);
}
