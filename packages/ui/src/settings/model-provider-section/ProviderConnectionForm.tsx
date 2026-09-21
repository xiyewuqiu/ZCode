import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  TID_MODEL_PROVIDER_API_FORMAT_ITEM,
  TID_MODEL_PROVIDER_API_FORMAT_TRIGGER,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  testId,
} from "@zcode/shared";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import type { ProviderApiType } from "@zcode/provider";

const PROVIDER_CONNECTION_API_FORMATS: readonly ProviderApiType[] = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
];

const PROVIDER_CONNECTION_API_FORMAT_PATHS: Record<ProviderApiType, string> = {
  "anthropic-messages": "/v1/messages",
  "openai-chat-completions": "/chat/completions",
  "openai-responses": "/responses",
};

const PROVIDER_CONNECTION_API_FORMAT_TITLE_IDS: Record<ProviderApiType, string> = {
  "anthropic-messages": "settings.modelProvider.apiFormat.title.anthropicMessages",
  "openai-chat-completions": "settings.modelProvider.apiFormat.title.chatCompletions",
  "openai-responses": "settings.modelProvider.apiFormat.title.responses",
};

function resolveProviderConnectionApiFormatDisplayLabel(
  intl: { formatMessage: (descriptor: { id: string }) => string },
  format: ProviderApiType,
): string {
  const title = intl.formatMessage({
    id: PROVIDER_CONNECTION_API_FORMAT_TITLE_IDS[format],
  });
  return `${title} (${PROVIDER_CONNECTION_API_FORMAT_PATHS[format]})`;
}

function ProviderApiFormatSelect({
  value,
  onChange,
}: {
  value: ProviderApiType;
  onChange: (value: ProviderApiType) => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as ProviderApiType)}>
      <SelectTrigger
        data-testid={TID_MODEL_PROVIDER_API_FORMAT_TRIGGER}
        size="lg"
        className="w-full justify-between"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {PROVIDER_CONNECTION_API_FORMATS.map((format) => (
          <SelectItem
            key={format}
            value={format}
            data-testid={testId(TID_MODEL_PROVIDER_API_FORMAT_ITEM, format)}
          >
            {resolveProviderConnectionApiFormatDisplayLabel(intl, format)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProviderConnectionSection({
  apiFormat,
  baseUrlValue,
  onApiFormatChange,
  onBaseUrlChange,
  onBaseUrlBlur,
  onBaseUrlKeyDown,
  onBaseUrlCompositionStart,
  onBaseUrlCompositionEnd,
}: {
  apiFormat: ProviderApiType;
  baseUrlValue: string;
  onApiFormatChange: (value: ProviderApiType) => void;
  onBaseUrlChange: (value: string) => void;
  onBaseUrlBlur: () => void;
  onBaseUrlKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBaseUrlCompositionStart?: () => void;
  onBaseUrlCompositionEnd?: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <>
      <div>
        <label className="mb-1 block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.baseUrl" })}
        </label>
        <Input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          type="text"
          size="lg"
          data-testid={TID_MODEL_PROVIDER_BASE_URL_INPUT}
          value={baseUrlValue}
          placeholder={intl.formatMessage({
            id: "settings.modelProvider.baseUrlPlaceholder",
          })}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          onBlur={onBaseUrlBlur}
          onKeyDown={onBaseUrlKeyDown}
          onCompositionStart={onBaseUrlCompositionStart}
          onCompositionEnd={onBaseUrlCompositionEnd}
        />
      </div>
      <div>
        <label className="mb-1 block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.apiFormat" })}
        </label>
        <ProviderApiFormatSelect value={apiFormat} onChange={onApiFormatChange} />
      </div>
    </>
  );
}

/** 获取入口不区分个人／团队；两个按钮和专用字段会偏离单一控制台入口的预期。 */
function PresetProviderApiKeyLink({ onOpenApiKey }: { onOpenApiKey: () => void }) {
  const { intl } = useZCodeIntl();
  return (
    <button
      type="button"
      className="text-primary cursor-pointer rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onOpenApiKey}
    >
      {intl.formatMessage({ id: "settings.modelProvider.getApiKey" })}
    </button>
  );
}

function ProviderApiKeyInput({
  value,
  visible,
  onChange,
  onBlur,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onToggleVisibility,
}: {
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onToggleVisibility: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="relative">
      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        type={visible ? "text" : "password"}
        size="lg"
        data-testid={TID_MODEL_PROVIDER_API_KEY_INPUT}
        className="h-9 pr-10"
        placeholder={intl.formatMessage({
          id: "settings.modelProvider.apiKeyPlaceholder",
        })}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1.5 -translate-y-1/2"
        onClick={onToggleVisibility}
      >
        {visible ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
      </Button>
    </div>
  );
}

export function ProviderApiKeySection({
  apiKeyValue,
  apiKeyVisible,
  apiKeyManagementUrl,
  onApiKeyChange,
  onApiKeyBlur,
  onApiKeyKeyDown,
  onApiKeyCompositionStart,
  onApiKeyCompositionEnd,
  onToggleApiKeyVisibility,
}: {
  apiKeyValue: string;
  apiKeyVisible: boolean;
  apiKeyManagementUrl?: string;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: () => void;
  onApiKeyKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onApiKeyCompositionStart?: () => void;
  onApiKeyCompositionEnd?: () => void;
  onToggleApiKeyVisibility: () => void;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const openApiKeyManagementUrl = useCallback(() => {
    const normalized = apiKeyManagementUrl?.trim();
    if (normalized) platform.openExternal(normalized);
  }, [apiKeyManagementUrl, platform]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.apiKey" })}
        </label>
        {apiKeyManagementUrl ? (
          <PresetProviderApiKeyLink onOpenApiKey={openApiKeyManagementUrl} />
        ) : null}
      </div>
      <ProviderApiKeyInput
        value={apiKeyValue}
        visible={apiKeyVisible}
        onChange={onApiKeyChange}
        onBlur={onApiKeyBlur}
        onKeyDown={onApiKeyKeyDown}
        onCompositionStart={onApiKeyCompositionStart}
        onCompositionEnd={onApiKeyCompositionEnd}
        onToggleVisibility={onToggleApiKeyVisibility}
      />
    </div>
  );
}
