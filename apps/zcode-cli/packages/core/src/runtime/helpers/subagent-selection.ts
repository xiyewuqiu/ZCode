import { createCoreError, CoreErrorType, type ModelSelection } from "../deps.js";
import { cloneModelSelection } from "../model-selection.js";
import type { EffectiveModelSelectionResult } from "@zcode/shared/model-selection";
import type { Logger } from "../deps.js";

const SUBAGENT_SELECTION_MESSAGES = {
  "selection-missing": "No model selected / 未选择模型",
  "account-connection-unavailable": "Account connection unavailable / 当前账号连接不可用",
  "provider-not-found": "Provider unavailable / 供应商不存在或不可用",
  "model-not-found": "Model unavailable / 模型不存在或不可用",
  "reasoning-level-missing": "No reasoning level selected / 未选择思考档位",
  "reasoning-level-not-supported": "Reasoning level unsupported / 不支持所选思考档位",
} satisfies Record<NonNullable<EffectiveModelSelectionResult["selectionIssue"]>, string>;

/**
 * 覆盖/Profile 指向的供应商或模型已从注册表消失时（典型：供应商被删除或重建），
 * 该引用属于失效配置：作废本层引用并继续尝试下一级来源，而不是把配置腐化
 * 传导成派遣失败。上层（host）负责据此清理持久化的失效覆盖，保证状态最终一致。
 */
function isDanglingSelectionIssue(
  issue: EffectiveModelSelectionResult["selectionIssue"],
): boolean {
  return issue === "provider-not-found" || issue === "model-not-found";
}

interface SubagentSelectionLayer {
  selection: ModelSelection;
  /** 该层是否需要过注册表校验；父会话模型已在会话中生效，无需重复校验。 */
  requiresResolution: boolean;
  /** 失效时的日志身份。 */
  describe: string;
}

/**
 * 显式 profile 是待解析意图；继承与内部 override 已有执行归属，不重新对应账号。
 * 逐层尝试 override → profile → 父会话模型：某一层的引用失效（provider/model 已
 * 不存在）时作废该层并落到下一层，保证子代理永远拿到一个当前可用的模型。
 */
export function resolveSubagentSelection(input: {
  profileSelection?: ModelSelection | null;
  parentSelection?: ModelSelection | null;
  overrideSelection?: ModelSelection;
  resolveSelection?: (selection: ModelSelection) => EffectiveModelSelectionResult;
  logger?: Pick<Logger, "warn">;
}): { hasConcreteModel: boolean; selection: ModelSelection } {
  const resolve = (selection: ModelSelection): EffectiveModelSelectionResult =>
    input.resolveSelection
      ? input.resolveSelection(cloneModelSelection(selection))
      : { effectiveSelection: selection };

  const layers: SubagentSelectionLayer[] = [];
  if (input.overrideSelection) {
    layers.push({
      selection: input.overrideSelection,
      requiresResolution: true,
      describe: `override ${input.overrideSelection.providerId}/${input.overrideSelection.modelId}`,
    });
  }
  if (input.profileSelection) {
    layers.push({
      selection: input.profileSelection,
      requiresResolution: true,
      describe: `profile ${input.profileSelection.providerId}/${input.profileSelection.modelId}`,
    });
  }
  if (input.parentSelection) {
    layers.push({
      selection: input.parentSelection,
      requiresResolution: false,
      describe: `parent ${input.parentSelection.providerId}/${input.parentSelection.modelId}`,
    });
  }

  let hasConcreteModel = false;
  for (const layer of layers) {
    const result = layer.requiresResolution
      ? resolve(layer.selection)
      : { effectiveSelection: layer.selection };

    if (result.effectiveSelection && !result.selectionIssue) {
      return {
        hasConcreteModel,
        selection: cloneModelSelection(result.effectiveSelection),
      };
    }

    if (result.effectiveSelection && result.selectionIssue) {
      // 模型存在但选项不被支持（reasoning 档位类）：这是真实配置错误，保持硬失败。
      throw createCoreError(
        CoreErrorType.ConfigurationError,
        `Cannot start subagent: ${SUBAGENT_SELECTION_MESSAGES[result.selectionIssue]} [reason=${result.selectionIssue}; selection=${layer.selection.providerId}/${layer.selection.modelId}]`,
        {
          recoverable: true,
          context: {
            selectionIssue: result.selectionIssue,
            reason: result.selectionIssue,
          },
        },
      );
    }

    if (result.selectionIssue && !isDanglingSelectionIssue(result.selectionIssue)) {
      // 账号连接不可用等真实环境状态：换层会掩盖，保持硬失败。
      throw createCoreError(
        CoreErrorType.ConfigurationError,
        `Cannot start subagent: ${SUBAGENT_SELECTION_MESSAGES[result.selectionIssue]} [reason=${result.selectionIssue}; selection=${layer.selection.providerId}/${layer.selection.modelId}]`,
        {
          recoverable: true,
          context: {
            selectionIssue: result.selectionIssue,
            reason: result.selectionIssue,
          },
        },
      );
    }

    // 失效引用（provider/model 已不存在）：作废本层，落下一层，并留下追踪日志。
    if (layer.requiresResolution) {
      hasConcreteModel = false;
      input.logger?.warn(
        `[subagent] 模型覆盖指向已不存在的供应商/模型，作废本层回退下一级 layer=${layer.describe} issue=${result.selectionIssue ?? "none"}`,
      );
    }
  }

  const requested = input.overrideSelection ?? input.profileSelection ?? input.parentSelection;
  const identity = requested ? `; selection=${requested.providerId}/${requested.modelId}` : "";
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    `Cannot start subagent: ${SUBAGENT_SELECTION_MESSAGES["selection-missing"]} [reason=selection-missing${identity}]`,
    {
      recoverable: true,
      context: {
        selectionIssue: "selection-missing",
        reason: "selection-missing",
      },
    },
  );
}
