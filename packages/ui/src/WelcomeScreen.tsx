/* oxlint-disable eslint(max-lines) */
/**
 * WelcomeScreen —— API Key 登录入口
 *
 * YCode 不再内置官方 OAuth 供应商，登录只走用户自备 API Key 的 provider；
 * 因此这里不再有 OAuth 渠道列表、等待态与回调失败态，只保留：
 * 登录标题 + 「使用 API Key」入口 + 「跳过登录」逃生出口。
 */
import { useCallback, useState, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { TID_LOGIN_USE_API_KEY_BUTTON } from "@zcode/shared";
import { Button } from "./components/ui/button.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { logger } from "./logger.js";
import { LoginApiKeyForm } from "./login/LoginApiKeyForm.js";
import {
  buildLoginApiKeySkipSettings,
  resolveLoginApiKeyDefaultProvider,
  selectLoginApiKeyProviderTemplates,
} from "./login/LoginApiKeyForm.helpers.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

export type LoginCompleteReason = "apiKey" | "skip";

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute left-0 top-0 right-0 z-10 flex h-12 w-full items-center [app-region:drag]" />
      <section className="relative z-10 w-full flex flex-col gap-10 max-w-sm rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10">
        <LoginPanel onComplete={onComplete} />
      </section>
    </main>
  );
}

interface LoginPanelProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

function LoginPanel({ onComplete }: LoginPanelProps) {
  const { intl } = useZCodeIntl();
  const { settingService } = useServices();
  const providerSettingsRead = useProviderSettingsView();
  const [loginMode, setLoginMode] = useState<"entry" | "apiKey">("entry");
  const [skippingLogin, setSkippingLogin] = useState(false);

  const handleSkipLogin = useCallback(async () => {
    // 登录面板主视图的“跳过并继续”与 API Key 表单里的跳过共用同一语义：
    // 写入 skip 设置（provider family domain 标记），避免后续会话再次弹出登录。
    // 写失败只记录日志、不阻断进入工作区——跳过是登录页的逃生出口，不能被设置写入卡住。
    try {
      const view =
        providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
      const defaultChoice = resolveLoginApiKeyDefaultProvider(
        selectLoginApiKeyProviderTemplates(view?.providerTemplates ?? []),
      );
      await settingService.update(buildLoginApiKeySkipSettings(defaultChoice, Date.now()));
    } catch (skipError) {
      logger.error("[LoginEntry] 跳过登录并写入 skip 设置失败", {
        error: skipError,
      });
    } finally {
      void onComplete("skip");
    }
  }, [onComplete, providerSettingsRead.state, settingService]);

  return (
    <>
      <LoginPanelHeader
        title={intl.formatMessage({ id: "login.title" })}
        description={intl.formatMessage({ id: "login.description" })}
      >
        {null}
      </LoginPanelHeader>

      {loginMode === "entry" ? (
        <div className="space-y-2">
          <Button
            variant="default"
            className="h-10 w-full text-ui-base"
            size="lg"
            data-testid={TID_LOGIN_USE_API_KEY_BUTTON}
            onClick={() => {
              setLoginMode("apiKey");
            }}
          >
            {intl.formatMessage({ id: "login.useApiKey" })}
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full text-ui-base"
            size="lg"
            disabled={skippingLogin}
            onClick={() => {
              setSkippingLogin(true);
              void handleSkipLogin();
            }}
          >
            {skippingLogin ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {intl.formatMessage({ id: "login.skip" })}
          </Button>
        </div>
      ) : (
        <LoginApiKeyForm
          onCancel={() => setLoginMode("entry")}
          onSaved={() => {
            setLoginMode("entry");
            return onComplete("apiKey");
          }}
          onSkipped={() => {
            setLoginMode("entry");
            return onComplete("skip");
          }}
        />
      )}
    </>
  );
}

function LoginPanelHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-ui-base/relaxed text-foreground-subtle">{description}</p>
      </div>
      {children}
    </header>
  );
}

function LoginPanelLogo() {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative mb-1 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="ZCode"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-10" />
    </div>
  );
}
