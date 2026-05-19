export interface RetryOptions {
  retries?: number;
  delayMs?: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 150;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        throw lastError;
      }

      await wait(delayMs);
    }
  }

  throw lastError;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
