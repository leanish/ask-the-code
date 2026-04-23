import type { AddressInfo } from "node:net";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn()
}));

vi.mock("node:http", () => ({
  default: {
    createServer: mocks.createServer
  }
}));

import { startHttpServer } from "../src/server/api/http-server.js";
import type { AskJobManager } from "../src/core/types.js";
import { createLoadedConfig } from "./test-helpers.js";

describe("http-server startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the server, formats the url, and drains the job manager on close", async () => {
    const server = createServerDouble({
      addressValue: {
        family: "IPv6",
        address: "::1",
        port: 43123
      }
    });
    const jobManager = createJobManagerDouble({
      shutdown: vi.fn(() => Promise.resolve()),
      close: vi.fn()
    });
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      host: "::1",
      port: 43123,
      bodyLimitBytes: 1024,
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    });

    expect(server.listen).toHaveBeenCalledWith(43123, "::1", expect.any(Function));
    expect(handle.url).toBe("http://[::1]:43123");

    await handle.close();

    expect(jobManager.shutdown).toHaveBeenCalled();
    expect(jobManager.close).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
    expect(server.closeIdleConnections).toHaveBeenCalled();
  });

  it("waits for server close and job shutdown before clearing the manager", async () => {
    let finishShutdown: () => void = () => {
      throw new Error("Shutdown resolver was not initialized.");
    };
    const shutdownPromise = new Promise<void>(resolve => {
      finishShutdown = resolve;
    });
    const server = createServerDouble({
      addressValue: {
        family: "IPv4",
        address: "127.0.0.1",
        port: 8787
      },
      deferClose: true
    });
    const jobManager = createJobManagerDouble({
      shutdown: vi.fn(() => shutdownPromise),
      close: vi.fn()
    });
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    });

    const closePromise = handle.close();

    expect(jobManager.shutdown).toHaveBeenCalled();
    expect(jobManager.close).not.toHaveBeenCalled();

    server.finishClose();
    await Promise.resolve();
    expect(jobManager.close).not.toHaveBeenCalled();

    finishShutdown();
    await closePromise;

    expect(jobManager.close).toHaveBeenCalled();
  });

  it("returns a null url when the server address is not an object", async () => {
    const server = createServerDouble({
      addressValue: "pipe"
    });
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager: createJobManagerDouble()
    });

    expect(handle.url).toBeNull();

    await handle.close();
  });

  it("rejects invalid numeric server configuration from the environment", async () => {
    const jobManager = createJobManagerDouble({
      shutdown: vi.fn(() => Promise.resolve()),
      close: vi.fn()
    });

    await expect(startHttpServer({
      env: {
        ATC_SERVER_PORT: "wat"
      },
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    })).rejects.toThrow("Invalid ATC_SERVER_PORT: wat. Use a TCP port between 0 and 65535.");

    await expect(startHttpServer({
      env: {
        ATC_SERVER_BODY_LIMIT_BYTES: "wat"
      },
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    })).rejects.toThrow("Invalid ATC_SERVER_BODY_LIMIT_BYTES: wat. Use a positive integer.");

    await expect(startHttpServer({
      env: {
        ATC_SERVER_MAX_CONCURRENT_JOBS: "wat"
      },
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    })).rejects.toThrow("Invalid ATC_SERVER_MAX_CONCURRENT_JOBS: wat. Use a positive integer.");

    await expect(startHttpServer({
      env: {
        ATC_SERVER_JOB_RETENTION_MS: "wat"
      },
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    })).rejects.toThrow("Invalid ATC_SERVER_JOB_RETENTION_MS: wat. Use a positive integer.");
  });

  it("accepts port zero from the environment", async () => {
    const server = createServerDouble({
      addressValue: {
        family: "IPv4",
        address: "127.0.0.1",
        port: 0
      }
    });
    const jobManager = createJobManagerDouble({
      close: vi.fn()
    });
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      env: {
        ATC_SERVER_PORT: "0"
      },
      loadConfigFn: async () => createLoadedConfig({ repos: [] }),
      jobManager
    });

    expect(server.listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));

    await handle.close();
  });

  it("fails fast when config loading fails before binding the server", async () => {
    const server = createServerDouble({
      addressValue: {
        family: "IPv4",
        address: "127.0.0.1",
        port: 8787
      }
    });
    mocks.createServer.mockReturnValue(server);

    await expect(startHttpServer({
      loadConfigFn: async () => {
        throw new Error("Invalid ask-the-code config at /tmp/config.json: bad value");
      },
      jobManager: createJobManagerDouble()
    })).rejects.toThrow("Invalid ask-the-code config at /tmp/config.json: bad value");

    expect(mocks.createServer).not.toHaveBeenCalled();
  });
});

function createServerDouble({
  addressValue,
  deferClose = false
}: {
  addressValue: AddressInfo | string | null;
  deferClose?: boolean;
}) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let closeCallback: (() => void) | null = null;
  const server = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return server;
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }

      return server;
    }),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      callback?.();
      return server;
    }),
    close: vi.fn((callback?: () => void) => {
      closeCallback = callback ?? null;
      if (!deferClose) {
        closeCallback?.();
      }
      return server;
    }),
    closeIdleConnections: vi.fn(),
    address: vi.fn(() => addressValue),
    finishClose() {
      closeCallback?.();
    },
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args);
    }
  };

  return server;
}

function createJobManagerDouble(
  overrides: Partial<AskJobManager> = {}
): AskJobManager {
  return {
    createJob: vi.fn(),
    getJob: vi.fn(() => null),
    getStats: vi.fn(() => ({ queued: 0, running: 0, completed: 0, failed: 0 })),
    shutdown: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => null),
    close: vi.fn(),
    ...overrides
  };
}
