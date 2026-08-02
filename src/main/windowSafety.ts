export interface WindowSafetyRuntime {
  pauseActiveTasks(): Promise<void>;
}

export interface WindowSafetyTarget {
  on(
    event: "close" | "unresponsive",
    listener: (...arguments_: any[]) => void,
  ): unknown;
  webContents: {
    on(
      event: "render-process-gone",
      listener: (...arguments_: any[]) => void,
    ): unknown;
  };
  destroy(): void;
}

export function installWindowSafetyHandlers(
  window: WindowSafetyTarget,
  getRuntime: () => WindowSafetyRuntime | null,
): void {
  let closePrepared = false;
  const reportPauseFailure = (error: unknown) => {
    console.error(
      "ZoroCoding 无法在窗口异常后暂停活动任务。",
      error,
    );
  };
  const pauseActive = () => {
    const runtime = getRuntime();
    if (runtime !== null) {
      void runtime.pauseActiveTasks().catch(reportPauseFailure);
    }
  };

  window.on("close", (event: { preventDefault(): void }) => {
    const runtime = getRuntime();
    if (closePrepared || runtime === null) {
      return;
    }
    event.preventDefault();
    void runtime
      .pauseActiveTasks()
      .catch(reportPauseFailure)
      .finally(() => {
        closePrepared = true;
        window.destroy();
      });
  });
  window.on("unresponsive", pauseActive);
  window.webContents.on("render-process-gone", pauseActive);
}
