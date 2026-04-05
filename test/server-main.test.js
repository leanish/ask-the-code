import { describe, expect, it, vi } from "vitest";

import { setupShutdownHandlers } from "../src/server-main.js";

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
