/** A broken network transport can leave a Firestore call hanging forever with no error (seen
 *  live repeatedly — the streaming channel gets silently torn down). Caps any promise so the
 *  caller always eventually gets a real answer instead of a spinner stuck forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out — check your network connection and try again.`)), ms)
  );
  return Promise.race([promise, timeout]);
}
