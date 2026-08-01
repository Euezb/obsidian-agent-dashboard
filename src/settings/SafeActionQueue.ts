export class SafeActionQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(
    action: () => Promise<T>,
    onError: (error: unknown) => void,
  ): Promise<T | undefined> {
    const operation = this.tail.then(action);
    this.tail = operation.then(() => undefined, () => undefined);
    return operation.catch((error: unknown) => {
      onError(error);
      return undefined;
    });
  }
}

export async function persistSetting<T extends object, K extends keyof T>(
  queue: SafeActionQueue,
  settings: T,
  key: K,
  value: T[K],
  save: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  const result = await queue.run(async () => {
    const previous = settings[key];
    settings[key] = value;
    try {
      await save();
    } catch (error) {
      settings[key] = previous;
      throw error;
    }
    return true;
  }, onError);
  return result === true;
}

export interface DisableControl {
  setDisabled(disabled: boolean): unknown;
}

export class SafeButtonActionRunner {
  private readonly active = new Set<DisableControl>();

  constructor(private readonly queue: SafeActionQueue) {}

  async run<T>(
    control: DisableControl,
    action: () => Promise<T>,
    onError: (error: unknown) => void,
  ): Promise<T | undefined> {
    if (this.active.has(control)) return undefined;
    this.active.add(control);
    control.setDisabled(true);
    try {
      return await this.queue.run(action, onError);
    } finally {
      this.active.delete(control);
      control.setDisabled(false);
    }
  }
}
