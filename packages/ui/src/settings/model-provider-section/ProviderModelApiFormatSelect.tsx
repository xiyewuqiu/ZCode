import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useYCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import type { ProviderModelDraftValues } from "./modelDraft.js";
import { modelEditorControlStyle } from "./modelEditorControls.js";

const MODEL_API_FORMATS = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
] as const satisfies readonly Exclude<ProviderModelDraftValues["apiFormatValue"], "inherit">[];

const MODEL_API_FORMAT_TITLE_IDS: Record<(typeof MODEL_API_FORMATS)[number], string> = {
  "anthropic-messages": "settings.modelProvider.apiFormat.title.anthropicMessages",
  "openai-chat-completions": "settings.modelProvider.apiFormat.title.chatCompletions",
  "openai-responses": "settings.modelProvider.apiFormat.title.responses",
};

/** 模型级协议覆盖；inherit 不写个人字段，继续继承 Provider 默认值。 */
export function ProviderModelApiFormatSelect({
  value,
  overridden,
  onChange,
}: {
  value: ProviderModelDraftValues["apiFormatValue"];
  overridden: boolean;
  onChange: (value: ProviderModelDraftValues["apiFormatValue"]) => void;
}) {
  const { intl } = useYCodeIntl();
  return (
    <Select
      value={value}
      onValueChange={(nextValue) =>
        onChange(nextValue as ProviderModelDraftValues["apiFormatValue"])
      }
    >
      <SelectTrigger
        size="lg"
        data-personal-override={overridden}
        className={cn("w-full justify-between", modelEditorControlStyle(overridden))}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="inherit">
          {intl.formatMessage({ id: "settings.modelProvider.apiFormat.inherit" })}
        </SelectItem>
        {MODEL_API_FORMATS.map((format) => (
          <SelectItem key={format} value={format}>
            {intl.formatMessage({ id: MODEL_API_FORMAT_TITLE_IDS[format] })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
