export interface RateLimiterOptions {
  maxRequestsPerMinute?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: any) => void;
}

export interface RateLimiterMetrics {
  totalRequests: number;
  throttledRequests: number;
  successfulRetries: number;
  failedRetries: number;
  currentTokens: number;
}

/**
 * Enterprise Rate Limiter with Token Bucket + Exponential Backoff & Jitter
 * Handles HTTP 429 Too Many Requests, Retry-After headers, and 5xx transient server errors.
 */
export class RateLimiter {
  private maxTokens: number;
  private currentTokens: number;
  private refillRatePerMs: number;
  private lastRefillTimestamp: number;

  private maxRetries: number;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private onRetry?: (attempt: number, delayMs: number, error: any) => void;

  private metrics: RateLimiterMetrics = {
    totalRequests: 0,
    throttledRequests: 0,
    successfulRetries: 0,
    failedRetries: 0,
    currentTokens: 0,
  };

  constructor(options: RateLimiterOptions = {}) {
    const rpm = options.maxRequestsPerMinute ?? 60;
    this.maxTokens = rpm;
    this.currentTokens = rpm;
    this.refillRatePerMs = rpm / 60000;
    this.lastRefillTimestamp = Date.now();

    this.maxRetries = options.maxRetries ?? 4;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 8000;
    this.onRetry = options.onRetry;
  }

  /**
   * Refill token bucket based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTimestamp;
    const tokensToAdd = elapsed * this.refillRatePerMs;

    this.currentTokens = Math.min(this.maxTokens, this.currentTokens + tokensToAdd);
    this.lastRefillTimestamp = now;
    this.metrics.currentTokens = Math.floor(this.currentTokens);
  }

  /**
   * Acquire a token before dispatching a request
   */
  public async acquireToken(): Promise<void> {
    this.refillTokens();

    if (this.currentTokens >= 1) {
      this.currentTokens -= 1;
      this.metrics.currentTokens = Math.floor(this.currentTokens);
      return;
    }

    // Wait until at least 1 token is available
    const missing = 1 - this.currentTokens;
    const waitMs = Math.ceil(missing / this.refillRatePerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refillTokens();
    this.currentTokens = Math.max(0, this.currentTokens - 1);
  }

  /**
   * Parse Retry-After header (supports either integer seconds or HTTP-Date)
   */
  public parseRetryAfterHeader(headerValue: string | number | undefined): number | null {
    if (!headerValue) return null;

    if (typeof headerValue === 'number') {
      return headerValue * 1000;
    }

    const numericSeconds = parseInt(headerValue, 10);
    if (!isNaN(numericSeconds)) {
      return numericSeconds * 1000;
    }

    // Attempt date parsing
    const dateMs = Date.parse(headerValue);
    if (!isNaN(dateMs)) {
      const delta = dateMs - Date.now();
      return delta > 0 ? delta : 0;
    }

    return null;
  }

  /**
   * Calculate exponential backoff with full randomized jitter:
   * backoff = min(maxBackoff, baseBackoff * 2^attempt + jitter)
   */
  public calculateBackoff(attempt: number, retryAfterMs?: number | null): number {
    if (retryAfterMs !== undefined && retryAfterMs !== null && retryAfterMs > 0) {
      return Math.min(retryAfterMs, this.maxBackoffMs);
    }

    const exp = Math.min(this.baseBackoffMs * Math.pow(2, attempt), this.maxBackoffMs);
    const jitter = Math.random() * (this.baseBackoffMs * 0.5);
    return Math.min(Math.floor(exp + jitter), this.maxBackoffMs);
  }

  /**
   * Execute an operation with automatic rate limiting and exponential backoff retry
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'api_request'
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      await this.acquireToken();
      this.metrics.totalRequests += 1;

      try {
        const result = await operation();
        if (attempt > 0) {
          this.metrics.successfulRetries += 1;
        }
        return result;
      } catch (error: any) {
        const status = error?.response?.status ?? error?.status;
        const isRateLimited = status === 429;
        const isServerError = status >= 500 && status <= 599;
        const isNetworkError = error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';

        const shouldRetry = (isRateLimited || isServerError || isNetworkError) && attempt < this.maxRetries;

        if (!shouldRetry) {
          if (attempt > 0) {
            this.metrics.failedRetries += 1;
          }
          throw error;
        }

        attempt += 1;
        this.metrics.throttledRequests += 1;

        const retryAfterRaw = error?.response?.headers?.['retry-after'];
        const retryAfterMs = this.parseRetryAfterHeader(retryAfterRaw);
        const delayMs = this.calculateBackoff(attempt, retryAfterMs);

        if (this.onRetry) {
          this.onRetry(attempt, delayMs, error);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Get telemetry metrics
   */
  public getMetrics(): RateLimiterMetrics {
    this.refillTokens();
    return { ...this.metrics };
  }

  /**
   * Reset internal state (useful in testing)
   */
  public reset(): void {
    this.currentTokens = this.maxTokens;
    this.lastRefillTimestamp = Date.now();
    this.metrics = {
      totalRequests: 0,
      throttledRequests: 0,
      successfulRetries: 0,
      failedRetries: 0,
      currentTokens: this.maxTokens,
    };
  }
}
