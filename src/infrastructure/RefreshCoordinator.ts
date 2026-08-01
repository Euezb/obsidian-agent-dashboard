export class RefreshKey<T> {
  declare private readonly resultType: (value: T) => T;

  private constructor(readonly id: string) {}

  static create<T>(id: string): RefreshKey<T> {
    return new RefreshKey<T>(id);
  }
}

export function createRefreshKey<T>(id: string): RefreshKey<T> {
  return RefreshKey.create<T>(id);
}

export class RefreshCoordinator {
  private readonly inFlight = new Map<object, Promise<unknown>>();

  join<T>(key: RefreshKey<T>): Promise<T> | undefined {
    return this.inFlight.get(key) as Promise<T> | undefined;
  }

  runOnce<T>(key: RefreshKey<T>, work: () => Promise<T> | T): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    const operation = Promise.resolve().then(work);
    let tracked: Promise<T>;
    tracked = operation.finally(() => {
      if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
    });
    this.inFlight.set(key, tracked);
    return tracked;
  }
}
