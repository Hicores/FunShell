export type Disposer = () => void;

/** Keeps an asynchronous subscription disposable even when it resolves after unmount. */
export function bindAsyncDisposer(subscription: Promise<Disposer>): Disposer {
  let disposed = false;
  let disposer: Disposer | null = null;
  void subscription.then((next) => {
    if (disposed) next();
    else disposer = next;
  }, () => undefined);
  return () => {
    disposed = true;
    disposer?.();
    disposer = null;
  };
}
