import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn()
}));

vi.mock("node:http", () => ({
  default: {
    createServer: mocks.createServer
  }
}));

import { startHttpServer } from "../src/http-server.js";

describe("http-server startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the server, formats the url, and destroys tracked sockets on close", async () => {
    const server = createServerDouble({
      addressValue: {
        family: "IPv6",
        address: "::1",
        port: 43123
      }
    });
    const socket = createSocketDouble();
    const jobManager = {
      close: vi.fn()
    };
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      host: "::1",
      port: 43123,
      bodyLimitBytes: 1024,
      jobManager
    });

    server.emit("connection", socket);
    socket.emit("close");
    server.emit("connection", socket);

    expect(server.listen).toHaveBeenCalledWith(43123, "::1", expect.any(Function));
    expect(handle.url).toBe("http://[::1]:43123");

    await handle.close();

    expect(jobManager.close).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("returns a null url when the server address is not an object", async () => {
    const server = createServerDouble({
      addressValue: "pipe"
    });
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      jobManager: {
        close: vi.fn()
      }
    });

    expect(handle.url).toBeNull();

    await handle.close();
  });

  it("rejects invalid numeric server configuration from the environment", async () => {
    const jobManager = {
      close: vi.fn()
    };

    await expect(startHttpServer({
      env: {
        ARCHA_SERVER_PORT: "wat"
      },
      jobManager
    })).rejects.toThrow("Invalid ARCHA_SERVER_PORT: wat. Use a TCP port between 0 and 65535.");

    await expect(startHttpServer({
      env: {
        ARCHA_SERVER_BODY_LIMIT_BYTES: "wat"
      },
      jobManager
    })).rejects.toThrow("Invalid ARCHA_SERVER_BODY_LIMIT_BYTES: wat. Use a positive integer.");

    await expect(startHttpServer({
      env: {
        ARCHA_SERVER_MAX_CONCURRENT_JOBS: "wat"
      },
      jobManager
    })).rejects.toThrow("Invalid ARCHA_SERVER_MAX_CONCURRENT_JOBS: wat. Use a positive integer.");

    await expect(startHttpServer({
      env: {
        ARCHA_SERVER_JOB_RETENTION_MS: "wat"
      },
      jobManager
    })).rejects.toThrow("Invalid ARCHA_SERVER_JOB_RETENTION_MS: wat. Use a positive integer.");
  });

  it("accepts port zero from the environment", async () => {
    const server = createServerDouble({
      addressValue: {
        family: "IPv4",
        address: "127.0.0.1",
        port: 0
      }
    });
    const jobManager = {
      close: vi.fn()
    };
    mocks.createServer.mockReturnValue(server);

    const handle = await startHttpServer({
      env: {
        ARCHA_SERVER_PORT: "0"
      },
      jobManager
    });

    expect(server.listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));

    await handle.close();
  });
});

function createServerDouble({ addressValue }) {
  const handlers = new Map();
  const server = {
    on: vi.fn((event, handler) => {
      handlers.set(event, handler);
      return server;
    }),
    off: vi.fn((event, handler) => {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }

      return server;
    }),
    listen: vi.fn((port, host, callback) => {
      callback?.();
      return server;
    }),
    close: vi.fn(callback => {
      callback?.();
      return server;
    }),
    address: vi.fn(() => addressValue),
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    }
  };

  return server;
}

function createSocketDouble() {
  const handlers = new Map();

  return {
    destroy: vi.fn(),
    on: vi.fn((event, handler) => {
      handlers.set(event, handler);
    }),
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    }
  };
}
