import http from "node:http";

let activeJobs = 0;
const startTime = Date.now();

export function incrementActiveJobs() {
  activeJobs++;
}

export function decrementActiveJobs() {
  activeJobs = Math.max(0, activeJobs - 1);
}

export function startHealthServer(port: number = 3002): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          active_jobs: activeJobs,
          uptime_s: Math.floor((Date.now() - startTime) / 1000),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(`Pipeline worker health server listening on port ${port}`);
  });

  return server;
}
