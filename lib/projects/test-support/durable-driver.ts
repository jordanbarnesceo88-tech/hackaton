/** Test worker: a null claim can mean lease pressure, retry backoff or an incompatible
 * older job. Completion belongs to the submitted receipt, not to one queue poll. */
export async function drainOwnReceipt<T, C>(options: {
  inspect: () => Promise<{ status: string; diagnosticCode?: string | null; value: T } | null>;
  recover: () => Promise<unknown>;
  claim: () => Promise<C | null>;
  execute: (claim: C) => Promise<void>;
  diagnostics: () => Promise<unknown>;
  onEmptyClaim?: (snapshot: unknown) => void;
  wait?: () => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<T> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 110_000);
  const wait = options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 100)));
  try {
    for (;;) {
      const current = await options.inspect();
      if (!current) throw new Error("Submitted durable receipt disappeared or is no longer owned");
      if (current.status === "SUCCEEDED") return current.value;
      if (current.status === "FAILED" || current.status === "CANCELLED") {
        throw new Error(`Submitted durable receipt is ${current.status}: ${current.diagnosticCode ?? "no diagnostic"}`);
      }
      if (now() >= deadline) throw new Error("Timed out waiting for submitted durable receipt");
      await options.recover();
      const claim = await options.claim();
      if (claim) await options.execute(claim);
      else {
        options.onEmptyClaim?.(await options.diagnostics());
        await wait();
      }
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; durable state=${JSON.stringify(await options.diagnostics())}`, { cause: error });
  }
}

/** A failed command must not poison the serial worker used by later tests. */
export function serialTestCommands() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
}
