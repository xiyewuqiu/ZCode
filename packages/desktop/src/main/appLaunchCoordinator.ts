interface AppLaunchGateLike {
  consume(): boolean;
}

interface RendererReadyInput {
  rendererId: number;
}

/** renderer 就绪后消费启动 gate；gate 自身保证只消费一次。 */
export function createAppLaunchCoordinator(appLaunchGate: AppLaunchGateLike) {
  return {
    onRendererReady(_input: RendererReadyInput): boolean {
      return appLaunchGate.consume();
    },
  };
}
