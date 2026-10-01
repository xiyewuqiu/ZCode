export interface DesktopProductIdentity {
  readonly flavor: "production" | "preview";
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: "preview" | null;
}
export const ZCODE_PREVIEW_IDENTITY_ENV: "ZCODE_PREVIEW_IDENTITY";
export const desktopProductIdentities: Readonly<
  Record<"production" | "preview", DesktopProductIdentity>
>;
export function isPreviewIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function resolveDesktopProductFlavor(env?: NodeJS.ProcessEnv): "production";
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: NodeJS.ProcessEnv): "_TEST" | "";
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: string,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged: boolean },
): string;
