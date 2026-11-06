/** A presentation-only clock; it never advances while the visible game is paused. */
export class CosmeticClock {
  private elapsed = 0;
  private previous: number;
  private paused = false;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.previous = this.now();
  }

  read(): number {
    const current = this.now();
    if (!this.paused) this.elapsed += Math.max(0, current - this.previous);
    this.previous = current;
    return this.elapsed;
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.read();
    this.paused = paused;
  }
}
