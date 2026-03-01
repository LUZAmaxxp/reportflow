import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

async function main() {
  const queues = ["ocr-job", "embedding-job", "extraction-job"];

  for (const q of queues) {
    // BullMQ stores failed jobs in a sorted set
    const failedIds = await redis.zrange(`bull:${q}:failed`, 0, 10);
    console.log(`\n=== ${q} : ${failedIds.length} failed ===`);

    for (const jid of failedIds) {
      const data = await redis.hgetall(`bull:${q}:${jid}`);
      if (data.failedReason) {
        console.log(`  Job ${jid}:`);
        console.log(`    reason: ${data.failedReason.substring(0, 800)}`);
        if (data.stacktrace) {
          try {
            const st = JSON.parse(data.stacktrace);
            console.log(`    stack: ${(st[0] || "").substring(0, 400)}`);
          } catch { /* ignore */ }
        }
      }
    }

    // Also check waiting/active/delayed counts
    const waiting = await redis.llen(`bull:${q}:wait`);
    const active = await redis.llen(`bull:${q}:active`);
    const delayed = await redis.zcard(`bull:${q}:delayed`);
    console.log(`  waiting=${waiting} active=${active} delayed=${delayed}`);
  }

  await redis.quit();
}

main().catch((e) => { console.error(e); process.exit(1); });
