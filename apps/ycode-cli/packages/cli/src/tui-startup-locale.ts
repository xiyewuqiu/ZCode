import { createConfig } from "@ycode/adapters/config";
import type { RuntimeConfigPatch } from "@ycode/contracts";
import { resolveLocale, type SupportedLocale } from "@ycode/i18n";
import type { GlobalOptions } from "@ycode/shared-types";
import type { RunDependencies } from "./cli-types.js";

type ResolveTuiStartupLocaleInput = {
  deps: RunDependencies;
  options: GlobalOptions;
  workingDirectory: string;
};

const localeCliOverrides = (locale: GlobalOptions["locale"]): RuntimeConfigPatch | undefined =>
  locale
    ? {
        ui: {
          locale,
        },
      }
    : undefined;

export function resolveTuiStartupLocale({
  deps,
  options,
  workingDirectory,
}: ResolveTuiStartupLocaleInput): SupportedLocale {
  const configResult = createConfig({
    cliOverrides: localeCliOverrides(options.locale),
    env: deps.env ?? process.env,
    projectConfigPath: deps.projectConfigPath,
    skipUserConfig: deps.skipUserConfig,
    userConfigPath: deps.userConfigPath,
    workingDirectory,
  });

  // login-required startup renders local TUI panels before YCodeApp
  // exists, so the CLI boundary must resolve persisted ui.locale itself.
  return resolveLocale(configResult.config.ui.locale, options.detectedLocale);
}
