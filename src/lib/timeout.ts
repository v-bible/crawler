const withTimeout = async <T>(
  taskFn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out',
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const taskPromise = Promise.resolve().then(() => taskFn());

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const res = await Promise.race([taskPromise, timeoutPromise]);
    return res as T;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export { withTimeout };
