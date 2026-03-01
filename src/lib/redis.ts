import Redis from "ioredis";
import { env } from "@/lib/env";

export const redis = new Redis(env.REDIS_URL);
export const redisSub = new Redis(env.REDIS_URL);
redis.on("error", (error) => {
  console.error("Redis error", error);
});
redisSub.on("error", (error) => {
  console.error("Redis sub error", error);
});
