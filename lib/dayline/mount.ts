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
      // WALL clock (v0.2.349): the engine self-advances its own now-marker on its rAF
      // (engine.frame, clockMode !== "data") and grows open-ended bars live. Zero's `now` IS wall-clock,
      // so this is equivalent — and it means Zero never has to push `now` every second. That per-second
      // push rebuilt the whole marks array and called loadData(), which clobbers any in-progress drag
      // (loadData unconditionally replaces this.events) — the cause of drag snap-back.
      clock: "wall",
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
