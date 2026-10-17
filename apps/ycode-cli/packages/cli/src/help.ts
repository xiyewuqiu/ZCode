import { getYCodeCopy, type SupportedLocale, type UiLocale } from "@ycode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getYCodeCopy(locale, detectedLocale).cli.help(version);
}
