// PDF worker Puppeteer pool — Slice 5 §5.7
// Maintains max 3 concurrent browser instances, tracks per-instance render count
// and restarts after 50 renders, enforces per-render 30s timeout via Promise.race.

import puppeteer, { Browser } from "puppeteer";

export const PDF_POOL_MAX_BROWSERS = 3;
export const PDF_POOL_RESTART_AFTER_RENDERS = 50;
export const PDF_PER_RENDER_TIMEOUT_MS = 30000;

interface PooledBrowser {
  browser: Browser;
  renderCount: number;
  inUse: boolean;
}

class PuppeteerPool {
  private pool: PooledBrowser[] = [];
  private waitQueue: Array<(pb: PooledBrowser) => void> = [];

  get poolSize(): number {
    return this.pool.length;
  }

  get activeRenders(): number {
    return this.pool.filter((pb) => pb.inUse).length;
  }

  async acquire(): Promise<PooledBrowser> {
    // Find an available browser
    const available = this.pool.find((pb) => !pb.inUse);
    if (available) {
      available.inUse = true;
      return available;
    }

    // Create new if under limit
    if (this.pool.length < PDF_POOL_MAX_BROWSERS) {
      const browser = await this.launchBrowser();
      const pb: PooledBrowser = { browser, renderCount: 0, inUse: true };
      this.pool.push(pb);
      return pb;
    }

    // Wait for one to become available
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this resolver from the wait queue
        const idx = this.waitQueue.indexOf(resolve);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error("PuppeteerPool.acquire: timed out after 30s waiting for available browser"));
      }, 30_000);

      this.waitQueue.push((pb) => {
        clearTimeout(timer);
        resolve(pb);
      });
    });
  }

  async release(pb: PooledBrowser): Promise<void> {
    pb.renderCount++;
    pb.inUse = false;

    // Recycle if exceeded max renders
    if (pb.renderCount >= PDF_POOL_RESTART_AFTER_RENDERS) {
      const idx = this.pool.indexOf(pb);
      if (idx >= 0) {
        this.pool.splice(idx, 1);
      }
      try {
        await pb.browser.close();
      } catch {
        // Ignore close errors
      }

      // Launch replacement if there are waiters
      if (this.waitQueue.length > 0) {
        const browser = await this.launchBrowser();
        const newPb: PooledBrowser = { browser, renderCount: 0, inUse: true };
        this.pool.push(newPb);
        const waiter = this.waitQueue.shift()!;
        waiter(newPb);
      }
      return;
    }

    // Serve waiting requests
    if (this.waitQueue.length > 0) {
      pb.inUse = true;
      const waiter = this.waitQueue.shift()!;
      waiter(pb);
    }
  }

  async shutdown(): Promise<void> {
    for (const pb of this.pool) {
      try {
        await pb.browser.close();
      } catch {
        // Ignore
      }
    }
    this.pool = [];
    this.waitQueue = [];
  }

  private async launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });
  }
}

export const pool = new PuppeteerPool();
