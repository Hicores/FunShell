import { describe, expect, it, vi } from "vitest";
import { bindAsyncDisposer, type Disposer } from "./asyncDisposer";

describe("bindAsyncDisposer", () => {
  it("disposes a subscription that resolves before cleanup", async () => {
    let resolve: (disposer: Disposer) => void = () => undefined;
    const cleanup = bindAsyncDisposer(new Promise<Disposer>((next) => { resolve = next; }));
    const disposer = vi.fn();
    resolve(disposer);
    await Promise.resolve();
    cleanup();
    expect(disposer).toHaveBeenCalledOnce();
  });

  it("disposes immediately when a subscription resolves after cleanup", async () => {
    let resolve: (disposer: Disposer) => void = () => undefined;
    const cleanup = bindAsyncDisposer(new Promise<Disposer>((next) => { resolve = next; }));
    cleanup();
    const disposer = vi.fn();
    resolve(disposer);
    await Promise.resolve();
    expect(disposer).toHaveBeenCalledOnce();
  });
});
