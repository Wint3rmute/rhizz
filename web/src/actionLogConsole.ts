// Browser-only glue that mirrors the model-editor action log to the console
// so the developer can copy a full, replayable TypeScript test out of the
// browser devtools. Kept deliberately thin — all logic lives in actionLog.ts
// (which is Node-testable); this module only wires the log to `console.log`
// and `navigator.clipboard`.

import {
  type ActionLog,
  asTestScript,
  encodeCall,
  type ModelAction,
} from "./actionLog";

// A stable prefix so the trace block is easy to spot and grep for in a busy
// console.
export const REPLAY_PREFIX = "[rhizz-replay]";

// Writes each recorded action to the console as a single copy-pasteable line
// as it happens. Returns an unsubscribe function.
export function attachConsoleMirror(
  log: ActionLog,
  consoleFn: (line: string) => void = (line) => {
    console.log(line);
  },
): () => void {
  const seen = new Set<ModelAction>();
  const flush = () => {
    for (const action of log.actions()) {
      if (seen.has(action)) continue;
      seen.add(action);
      consoleFn(`${REPLAY_PREFIX} ${encodeCall(action, "project")}`);
    }
  };
  flush();
  // The log is mutated in place (record() pushes), so poll on an interval
  // rather than relying on a subscription callback that may never fire.
  const interval = setInterval(flush, 500);
  return () => {
    clearInterval(interval);
  };
}

// Serializes the whole log into a self-contained test script and copies it to
// the clipboard. Returns the script text so callers can also show it.
export async function copyDebugScript(
  log: ActionLog,
  finalHcl: string,
  baselineHcl = "",
): Promise<string> {
  const script = asTestScript(log.actions(), finalHcl, { baselineHcl });
  await navigator.clipboard.writeText(script);
  return script;
}
