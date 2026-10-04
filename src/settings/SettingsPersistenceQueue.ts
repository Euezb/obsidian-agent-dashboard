import { cloneSettingValue } from "../infrastructure/cloneSettingValue";

export class SettingsPersistenceQueue<T extends object> {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly settings: T,
    private readonly save: (snapshot: T) => Promise<void>,
  ) {}

  update<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    const operation = this.tail.then(async () => {
      const previous = clone(this.settings);
      this.settings[key] = cloneSettingValue(value);
      try {
        await this.save(clone(this.settings));
      } catch (error) {
        restore(this.settings, previous);
        throw error;
      }
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  saveCurrent(): Promise<void> {
    const operation = this.tail.then(() => this.save(clone(this.settings)));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function clone<T extends object>(value: T): T {
  const copy = {} as T;
  for (const key of Object.keys(value) as Array<keyof T>) copy[key] = cloneSettingValue(value[key]);
  return copy;
}

function restore<T extends object>(target: T, snapshot: T): void {
  for (const key of Object.keys(target) as Array<keyof T>) delete target[key];
  for (const key of Object.keys(snapshot) as Array<keyof T>) {
    target[key] = cloneSettingValue(snapshot[key]);
  }
}
