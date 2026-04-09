import type { StatusReporter } from "../types.js";

type WritableStatusStream = {
  write(chunk: string): unknown;
  isTTY?: boolean;
};

export function createStreamStatusReporter(
  stream: WritableStatusStream,
  prefix = "[archa] "
): StatusReporter & { flush(): void } {
  let hasInteractiveCodexStatus = false;

  const reporter = createCallbackStatusReporter(message => {
    const renderedMessage = `${prefix}${message}`;

    if (!isInteractiveCodexStatus(stream, message)) {
      if (hasInteractiveCodexStatus) {
        stream.write("\n");
        hasInteractiveCodexStatus = false;
      }

      stream.write(`${renderedMessage}\n`);
      return;
    }

    if (hasInteractiveCodexStatus) {
      stream.write(`\r\x1b[2K${renderedMessage}`);
      return;
    }

    stream.write(renderedMessage);
    hasInteractiveCodexStatus = true;
  });

  return {
    ...reporter,
    flush() {
      if (!hasInteractiveCodexStatus) {
        return;
      }

      stream.write("\n");
      hasInteractiveCodexStatus = false;
    }
  };
}

export function createCallbackStatusReporter(onInfo?: (message: string) => void): StatusReporter {
  return {
    info(message: string) {
      if (!message) {
        return;
      }

      onInfo?.(message);
    }
  };
}

function isInteractiveCodexStatus(stream: WritableStatusStream, message: string): boolean {
  return Boolean(stream?.isTTY) && isCodexStatus(message);
}

function isCodexStatus(message: string): boolean {
  return message.startsWith("Running Codex");
}
