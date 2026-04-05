import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startHttpServer: vi.fn(),
  ensureInteractiveConfigSetup: vi.fn()
}));

vi.mock("../src/http-server.js", () => ({
  startHttpServer: mocks.startHttpServer
}));

vi.mock("../src/cli-bootstrap.js", () => ({
  ensureInteractiveConfigSetup: mocks.ensureInteractiveConfigSetup
}));

import { main, setupShutdownHandlers } from "../src/server-main.js";

describe("server-main", () => {
  let stdout;
  let stderr;
  let originalStdoutWrite;
  let originalStderrWrite;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = [];
    stderr = [];
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    process.stdout.write = vi.fn(chunk => {
      stdout.push(chunk);
      return true;
    });
    process.stderr.write = vi.fn(chunk => {
      stderr.push(chunk);
      return true;
    });
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(true);
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("prints the listening url and suggests discovery when no repos are configured", async () => {
    const serverHandle = {
      url: "http://127.0.0.1:8787",
      configuredRepoCount: 0
    };
    mocks.startHttpServer.mockResolvedValue(serverHandle);

    const result = await main([]);

    expect(result).toBe(serverHandle);
    expect(mocks.ensureInteractiveConfigSetup).toHaveBeenCalled();
    expect(stdout.join("")).toBe("Archa server listening on http://127.0.0.1:8787\n");
    expect(stderr.join("")).toContain('Suggestion: run "archa config discover-github --owner <github-user-or-org> --apply".');
  });

  it("does not print the discovery suggestion when repos are already configured", async () => {
    mocks.startHttpServer.mockResolvedValue({
      url: "http://127.0.0.1:8787",
      configuredRepoCount: 2
    });

    await main([]);

    expect(stderr.join("")).toBe("");
  });

  it("does not start the server when interactive setup is declined", async () => {
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(false);

    const result = await main([]);

    expect(result).toBeNull();
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });
});

describe("setupShutdownHandlers", () => {
  function createProcessDouble() {
    const handlers = new Map();

    return {
      stderr: { write: vi.fn() },
      exit: vi.fn(),
      on: vi.fn((event, handler) => {
        const existing = handlers.get(event) || [];
        existing.push(handler);
        handlers.set(event, existing);
      }),
      emit(event) {
        for (const handler of handlers.get(event) || []) {
          handler();
        }
      }
    };
  }

  function createServerHandle() {
    return {
      close: vi.fn(() => Promise.resolve())
    };
  }

  it("calls close on the server handle when SIGTERM is received", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGTERM");

    expect(handle.close).toHaveBeenCalled();
    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGTERM)...\n");

    await handle.close.mock.results[0].value;
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("calls close on the server handle when SIGINT is received", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGINT");

    expect(handle.close).toHaveBeenCalled();
    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGINT)...\n");

    await handle.close.mock.results[0].value;
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("forces shutdown on repeated signal", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();
    handle.close.mockReturnValue(new Promise(() => {}));

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGTERM");
    proc.emit("SIGTERM");

    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGTERM)...\n");
    expect(proc.stderr.write).toHaveBeenCalledWith("Forced shutdown (SIGTERM)\n");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when close rejects", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();
    handle.close.mockReturnValue(Promise.reject(new Error("close failed")));

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGINT");

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(1);
    });
  });
});
