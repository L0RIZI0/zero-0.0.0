import type {
  DaylineHandle,
  MountDayline,
  MountDaylineArgs,
} from "./contract";
import { DaylineEngine } from "./engine";

/**
 * Zero-facing entry. The engine owns the canvas; Zero holds the handle.
 * This chat preview uses DaylineEngine directly so the toolbar stays wired.
 */
export const mountDayline: MountDayline = (args: MountDaylineArgs): DaylineHandle => {
  const engine = new DaylineEngine(
    args.surface,
    { onChange: () => {} },
    {
      persist: false,
      clock: "data",
      data: args.data,
      theme: args.theme,
      callbacks: args.callbacks,
      nowRestFraction: args.options?.nowRestFraction,
      dpr: args.options?.dpr,
    },
  );
  return {
    update: (data) => engine.loadData(data),
    setTheme: (theme) => engine.setContractTheme(theme),
    resize: (width, height) => engine.resizeTo(width, height),
    destroy: () => engine.destroy(),
  };
};

export { DaylineEngine };
