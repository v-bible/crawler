const withTimeout = async <T>(
  taskFn: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out',
): Promise<T> => {
  const controller = new AbortController();
  const { signal } = controller;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort(); // Fire the abort event
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    signal.addEventListener('abort', () => clearTimeout(timer));
  });

  try {
    // Pass the signal. Existing handlers will just ignore it.
    // New/updated handlers can choose to accept it.
    return await Promise.race([taskFn(signal), timeoutPromise]);
  } catch (error) {
    controller.abort();
    throw error;
  }
};

export { withTimeout };
