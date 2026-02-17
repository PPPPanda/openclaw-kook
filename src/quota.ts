/**
 * KOOK daily message quota tracker.
 * Daily limit: 10,000 messages (create + update) per developer.
 * Reset time: 12:00 Beijing Time (UTC+8) = 04:00 UTC.
 *
 * This module only tracks and reports. It does NOT auto-degrade.
 * Degradation decisions are controlled by user config (blockStreaming / blockStreamingMode).
 */

export class KookQuotaTracker {
  private dailyCount = 0;
  private resetAt: number;
  private readonly DAILY_LIMIT = 10_000;
  private warningThreshold: number;
  private log: (...args: unknown[]) => void;
  private warningEmitted = false;

  constructor(opts?: {
    warningThreshold?: number;
    log?: (...args: unknown[]) => void;
  }) {
    this.warningThreshold = opts?.warningThreshold ?? 0.8;
    this.log = opts?.log ?? console.log;
    this.resetAt = this.nextResetTime();
  }

  record(action: "create" | "update"): void {
    this.checkReset();
    this.dailyCount++;

    if (!this.warningEmitted && this.isWarning()) {
      this.warningEmitted = true;
      this.log(
        `kook quota WARNING: ${this.dailyCount}/${this.DAILY_LIMIT} used (${this.getUsagePercent()}%), ` +
        `${this.getRemaining()} remaining. Resets at ${new Date(this.resetAt).toISOString()}`,
      );
    }

    if (this.dailyCount === this.DAILY_LIMIT) {
      this.log(
        `kook quota EXHAUSTED: ${this.DAILY_LIMIT}/${this.DAILY_LIMIT} used. ` +
        `No more messages can be sent until ${new Date(this.resetAt).toISOString()}`,
      );
    }
  }

  getRemaining(): number {
    this.checkReset();
    return Math.max(0, this.DAILY_LIMIT - this.dailyCount);
  }

  getUsed(): number {
    this.checkReset();
    return this.dailyCount;
  }

  getUsagePercent(): number {
    return Math.round((this.dailyCount / this.DAILY_LIMIT) * 100);
  }

  isWarning(): boolean {
    return this.dailyCount >= this.DAILY_LIMIT * this.warningThreshold;
  }

  isExhausted(): boolean {
    return this.dailyCount >= this.DAILY_LIMIT;
  }

  getStatus(): { used: number; remaining: number; percent: number; exhausted: boolean; resetsAt: string } {
    this.checkReset();
    return {
      used: this.dailyCount,
      remaining: this.getRemaining(),
      percent: this.getUsagePercent(),
      exhausted: this.isExhausted(),
      resetsAt: new Date(this.resetAt).toISOString(),
    };
  }

  private nextResetTime(): number {
    // Beijing Time 12:00 = UTC 04:00
    const now = new Date();
    const resetToday = new Date(now);
    resetToday.setUTCHours(4, 0, 0, 0);
    if (now.getTime() >= resetToday.getTime()) {
      resetToday.setUTCDate(resetToday.getUTCDate() + 1);
    }
    return resetToday.getTime();
  }

  private checkReset(): void {
    if (Date.now() >= this.resetAt) {
      const prevCount = this.dailyCount;
      this.dailyCount = 0;
      this.resetAt = this.nextResetTime();
      this.warningEmitted = false;
      if (prevCount > 0) {
        this.log(`kook quota: reset (previous usage: ${prevCount}/${this.DAILY_LIMIT})`);
      }
    }
  }
}

// Singleton quota tracker
let globalTracker: KookQuotaTracker | null = null;

export function getQuotaTracker(opts?: {
  warningThreshold?: number;
  log?: (...args: unknown[]) => void;
}): KookQuotaTracker {
  if (!globalTracker) {
    globalTracker = new KookQuotaTracker(opts);
  }
  return globalTracker;
}

export function resetQuotaTracker(): void {
  globalTracker = null;
}
