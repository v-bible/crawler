const withTimeout = async <T>(
  taskFn: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out',
): Promise<T> => {
  const controller = new AbortController();
  const { signal } = controller;

  // Keep track of the timer ID outside the promise scope
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([taskFn(signal), timeoutPromise]);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    // This executes whether the race wins, loses, or throws
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export { withTimeout };
