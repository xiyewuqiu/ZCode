import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { TID_MODEL_PROVIDER_NAME_EDIT_BUTTON, TID_MODEL_PROVIDER_NAME_INPUT } from "@zcode/shared";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import type { ProviderConfigObject } from "@zcode/provider";
import { ProviderLogo } from "./ProviderLogo.js";

/** 供应商卡片标题栏：Logo、就地重命名与供应商级操作菜单。 */
export function ProviderCardHeader({
  providerName,
  logo,
  editingName,
  nameValue,
  nameInputRef,
  onNameChange,
  onNameBlur,
  onNameKeyDown,
  onNameCompositionEnd,
  onNameCompositionStart,
  onStartEditName,
  onDelete,
  providerToggle,
}: {
  providerName: string;
  logo?: ProviderConfigObject["logo"];
  editingName: boolean;
  nameValue: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onNameChange: (value: string) => void;
  onNameBlur: () => void;
  onNameKeyDown: (event: ReactKeyboardEvent) => void;
  onNameCompositionEnd?: () => void;
  onNameCompositionStart?: () => void;
  onStartEditName: () => void;
  onDelete?: () => void;
  providerToggle?: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const renameRequestedRef = useRef(false);

  return (
    <div className="flex items-center justify-between gap-3" data-testid="model-provider-header">
      <div className="flex min-w-0 items-center gap-2">
        <ProviderLogo logo={logo} className="size-5" />
        {editingName ? (
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            ref={nameInputRef}
            data-testid={TID_MODEL_PROVIDER_NAME_INPUT}
            type="text"
            size="lg"
            className="w-auto min-w-0 text-ui-lg font-semibold"
            value={nameValue}
            onChange={(event) => onNameChange(event.target.value)}
            onCompositionEnd={onNameCompositionEnd}
            onCompositionStart={onNameCompositionStart}
            onBlur={onNameBlur}
            onKeyDown={onNameKeyDown}
          />
        ) : (
          <div className="min-w-0 truncate text-ui-lg font-semibold text-foreground">
            {providerName}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {providerToggle}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-testid="model-provider-actions-button"
              aria-label={intl.formatMessage({ id: "common.more" })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // 重命名后的焦点交给输入框，不能被菜单关闭时重新抢回触发按钮。
              if (renameRequestedRef.current) {
                event.preventDefault();
                renameRequestedRef.current = false;
              }
            }}
          >
            <DropdownMenuItem
              data-testid={TID_MODEL_PROVIDER_NAME_EDIT_BUTTON}
              onSelect={() => {
                renameRequestedRef.current = true;
                onStartEditName();
              }}
            >
              <Pencil className="size-3.5" />
              {intl.formatMessage({ id: "settings.modelProvider.renameProvider" })}
            </DropdownMenuItem>
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="size-3.5" />
                  {intl.formatMessage({ id: "common.delete" })}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
