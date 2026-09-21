import { createSharedZCodeCredentialStore, SHARED_ZCODE_CREDENTIAL_KEYS } from "@zcode/adapters";
import type { SharedZCodeCredentialStore } from "@zcode/adapters";
import type { EnvRecord } from "@zcode/adapters/model";
import {
  readStandaloneCodingPlanProviders,
  standaloneAccountIdentityCredentialKey,
  standaloneAccountProviderCredentialKey,
} from "./app/standalone-account-provider-runtime.js";

export interface LogoutZCodeCliOptions {
  credentialStore?: SharedZCodeCredentialStore;
  env?: EnvRecord;
}

export interface LogoutZCodeCliResult {
  credentialsPath: string;
}

/**
 * 清空共享凭据文件里的官方账号残留。
 *
 * 官方 Z.AI / BigModel 登录已从产品移除，这里只保留一次性清理能力：按 Built-in Config
 * 声明的 Standalone Coding Plan Provider 及其账号身份定位凭据键，值仍然匹配才删除。
 */
export async function logoutZCodeCli(
  options: LogoutZCodeCliOptions = {},
): Promise<LogoutZCodeCliResult> {
  const credentialStore =
    options.credentialStore ?? createSharedZCodeCredentialStore({ env: options.env });
  const providerIds = (await readStandaloneCodingPlanProviders(options.env ?? process.env)).map(
    ({ providerId }) => providerId,
  );
  const identityKeys = providerIds.map(standaloneAccountIdentityCredentialKey);
  const identities = await credentialStore.loadMany(identityKeys);
  const dynamicApiKeyKeys = providerIds.flatMap((providerId) => {
    const identity = identities[standaloneAccountIdentityCredentialKey(providerId)]?.trim();
    return identity
      ? [
          standaloneAccountProviderCredentialKey({
            providerId,
            accountIdentity: identity,
          }),
        ]
      : [];
  });
  const keys = [
    ...Object.values(SHARED_ZCODE_CREDENTIAL_KEYS),
    ...identityKeys,
    ...dynamicApiKeyKeys,
  ];
  const current = await credentialStore.loadMany(keys);
  await credentialStore.deleteIfValues(
    Object.fromEntries(
      Object.entries(current).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
    ),
  );
  return {
    credentialsPath: credentialStore.filePath,
  };
}
