import { VIEW_TYPE } from "../constants";

export interface ActivatableLeaf {
  setViewState(state: { type: string; active: boolean }): Promise<void>;
}

export interface ViewActivationPort<TLeaf extends ActivatableLeaf> {
  getExistingLeaf(): TLeaf | undefined;
  createLeaf(): TLeaf;
  revealLeaf(leaf: TLeaf): Promise<void>;
}

export class ViewActivationCoordinator<TLeaf extends ActivatableLeaf> {
  private inFlight: Promise<void> | null = null;

  constructor(private readonly port: ViewActivationPort<TLeaf>) {}

  activate(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const activation = this.activateOnce();
    this.inFlight = activation;
    void activation.then(
      () => this.clear(activation),
      () => this.clear(activation),
    );

    return activation;
  }

  private async activateOnce(): Promise<void> {
    const existingLeaf = this.port.getExistingLeaf();

    if (existingLeaf) {
      await this.port.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.port.createLeaf();
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.port.revealLeaf(leaf);
  }

  private clear(activation: Promise<void>): void {
    if (this.inFlight === activation) {
      this.inFlight = null;
    }
  }
}

export function runSafely(
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): void {
  void Promise.resolve().then(task).catch(onError);
}
