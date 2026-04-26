export type CircuitBreakerState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitBreakerState = "closed";

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 30_000,
  ) {}

  canPass(): boolean {
    if (this.state !== "open") {
      return true;
    }
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half_open";
      return true;
    }
    return false;
  }

  success(): void {
    this.failures = 0;
    this.state = "closed";
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}
