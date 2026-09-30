// Startup logging in hooks.client.ts. The SDK is initialized by a module side
// effect, so the only way to test either branch is to import the module with
// a stubbed environment and watch what it did — hence resetModules plus a
// dynamic import per case rather than a static one.
import { afterEach, describe, expect, it, vi } from "vitest";

// No interface for the mock shape: annotating it would erase the `Mock`
// types vi.fn() gives each function, and `.mockClear()` below would stop
// resolving.
const mocks = vi.hoisted(() => {
  // One shared ordered log, so a case can assert not just *that* init ran but
  // that it ran before the line reporting it.
  const calls: string[] = [];
  return {
    calls,
    sentry: {
      init: vi.fn((options: unknown) => {
        calls.push("sentry.init");
        void options;
      }),
      handleErrorWithSentry: vi.fn(() => {
        calls.push("sentry.handleErrorWithSentry");
        return () => undefined;
      }),
      consoleLoggingIntegration: vi.fn(() => {
        calls.push("sentry.consoleLoggingIntegration");
        return { name: "ConsoleLogging" };
      }),
    },
  };
});

vi.mock("@sentry/sveltekit", () => mocks.sentry);

// Imports hooks.client.ts fresh with `env` applied, and returns the console
// lines it printed (joined the way the browser would show them) alongside the
// ordered call log the Sentry mock recorded.
async function loadHooks(env: {
  VITE_SENTRY_DSN?: string;
}): Promise<{ lines: string[]; calls: string[] }> {
  vi.resetModules();
  vi.stubEnv("VITE_SENTRY_DSN", env.VITE_SENTRY_DSN);
  mocks.calls.length = 0;
  mocks.sentry.init.mockClear();
  mocks.sentry.consoleLoggingIntegration.mockClear();

  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      // Recorded in the same ordered log as the Sentry mock, which is the
      // only way to compare *when* the two happened relative to each other.
      mocks.calls.push("console.log");
      lines.push(
        args
          .map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg))
          .join(" "),
      );
    });
  try {
    await import("./hooks.client");
  } finally {
    spy.mockRestore();
  }
  return { lines, calls: [...mocks.calls] };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sentry startup logging", () => {
  it("says so, and skips init entirely, when the build has no DSN", async () => {
    const { lines, calls } = await loadHooks({ VITE_SENTRY_DSN: "" });
    expect(mocks.sentry.init).not.toHaveBeenCalled();
    expect(calls).not.toContain("sentry.init");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not initialized");
    // The reason is the whole point of the line: a missing DSN is the first
    // thing to check when nothing shows up in Sentry.
    expect(lines[0]).toContain("VITE_SENTRY_DSN");
  });

  it("says so when the DSN variable is absent rather than empty", async () => {
    const { lines } = await loadHooks({});
    expect(mocks.sentry.init).not.toHaveBeenCalled();
    expect(lines[0]).toContain("not initialized");
  });

  it("announces the init after it has actually run", async () => {
    const { lines, calls } = await loadHooks({
      VITE_SENTRY_DSN: "https://key@example.ingest.sentry.io/1",
    });
    expect(mocks.sentry.init).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("initialized");
    expect(lines[0]).not.toContain("not initialized");
    // Ordering is the load-bearing part: consoleLoggingIntegration is only
    // installed by init, so a line printed before it could never reach
    // Sentry — which would make this the one line that does not show up in
    // Sentry, exactly when it is most needed.
    //
    // Only the relative order of these two is asserted. consoleLoggingIntegration
    // is built as an argument to init and so legitimately precedes it, and
    // handleErrorWithSentry runs at module scope afterwards — neither is
    // anything this change is about.
    expect(calls.indexOf("sentry.init")).toBeLessThan(
      calls.indexOf("console.log"),
    );
  });

  it("never prints the DSN itself", async () => {
    const dsn = "https://secretkey@example.ingest.sentry.io/1";
    const { lines } = await loadHooks({ VITE_SENTRY_DSN: dsn });
    expect(lines.join("\n")).not.toContain("secretkey");
    expect(lines.join("\n")).not.toContain("example.ingest.sentry.io");
  });
});
