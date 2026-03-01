import http from "http";
import { pool } from "./pool";

let server: http.Server | null = null;

export function startHealthServer(port: number): void {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        pool_size: pool.poolSize,
        active_renders: pool.activeRenders,
      })
    );
  });

  server.listen(port, () => {
    console.log(`[pdf-worker] Health server listening on port ${port}`);
  });
}

export function stopHealthServer(): void {
  server?.close();
}
