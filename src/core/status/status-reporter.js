export function createStreamStatusReporter(stream, prefix = "[archa] ") {
  return createCallbackStatusReporter(message => {
    stream.write(`${prefix}${message}\n`);
  });
}

export function createCallbackStatusReporter(onInfo) {
  return {
    info(message) {
      if (!message) {
        return;
      }

      onInfo?.(message);
    }
  };
}
