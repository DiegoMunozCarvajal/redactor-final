export async function runSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;

    try {
      results[index] = {
        status: "fulfilled",
        value: await worker(items[index], index),
      };
    } catch (reason) {
      results[index] = { status: "rejected", reason };
    }

    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext()),
  );

  return results;
}
