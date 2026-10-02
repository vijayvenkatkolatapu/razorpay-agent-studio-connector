import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../src/client/rate-limiter.js';

describe('RateLimiter', () => {
  it('should initialize with expected defaults and allow token acquisition', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 60 });
    const metricsBefore = limiter.getMetrics();
    expect(metricsBefore.currentTokens).toBe(60);

    await limiter.acquireToken();
    const metricsAfter = limiter.getMetrics();
    expect(metricsAfter.currentTokens).toBe(59);
  });

  it('should correctly parse Retry-After headers in seconds and dates', () => {
    const limiter = new RateLimiter();

    // Integer seconds
    expect(limiter.parseRetryAfterHeader('5')).toBe(5000);
    expect(limiter.parseRetryAfterHeader(10)).toBe(10000);

    // Undefined / null
    expect(limiter.parseRetryAfterHeader(undefined)).toBeNull();

    // Future HTTP date
    const futureDate = new Date(Date.now() + 8000).toUTCString();
    const parsedDateMs = limiter.parseRetryAfterHeader(futureDate);
    expect(parsedDateMs).toBeGreaterThan(0);
    expect(parsedDateMs).toBeLessThanOrEqual(9000);
  });

  it('should calculate exponential backoff with jitter and respect caps', () => {
    const limiter = new RateLimiter({
      baseBackoffMs: 200,
      maxBackoffMs: 2000,
    });

    const b0 = limiter.calculateBackoff(0);
    const b1 = limiter.calculateBackoff(1);
    const b2 = limiter.calculateBackoff(2);

    expect(b0).toBeGreaterThanOrEqual(200);
    expect(b1).toBeGreaterThanOrEqual(400);
    expect(b2).toBeGreaterThanOrEqual(800);

    // Should cap at maxBackoffMs
    const b10 = limiter.calculateBackoff(10);
    expect(b10).toBeLessThanOrEqual(2000);

    // Explicit retry-after header override
    const bWithHeader = limiter.calculateBackoff(0, 1500);
    expect(bWithHeader).toBe(1500);
  });

  it('should automatically retry on HTTP 429 and recover successfully', async () => {
    let attempts = 0;
    const retrySpy = vi.fn();

    const limiter = new RateLimiter({
      maxRetries: 3,
      baseBackoffMs: 50,
      maxBackoffMs: 300,
      onRetry: retrySpy,
    });

    const result = await limiter.executeWithRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        const error: any = new Error('Too Many Requests');
        error.response = { status: 429, headers: {} };
        throw error;
      }
      return 'recovered-data';
    });

    expect(result).toBe('recovered-data');
    expect(attempts).toBe(3);
    expect(retrySpy).toHaveBeenCalledTimes(2);

    const metrics = limiter.getMetrics();
    expect(metrics.throttledRequests).toBe(2);
    expect(metrics.successfulRetries).toBe(1);
  });

  it('should NOT retry on 404 or 401 client errors', async () => {
    const limiter = new RateLimiter({ maxRetries: 3 });

    let attempts = 0;
    await expect(
      limiter.executeWithRetry(async () => {
        attempts += 1;
        const error: any = new Error('Not Found');
        error.status = 404;
        throw error;
      })
    ).rejects.toThrow('Not Found');

    expect(attempts).toBe(1);
  });
});
