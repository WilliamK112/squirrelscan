import { existsSync } from "fs";

import { startCrawlLease } from "../../src/storage/crawl-lease";

const [dbPath, crawlId, startPath, resultPath, releasePath] = Bun.argv.slice(2);
if (!dbPath || !crawlId || !startPath || !resultPath || !releasePath) {
  throw new Error("expected db, crawl, start, result and release paths");
}

const lease = startCrawlLease({
  dbPath,
  getCrawlId: () => null,
  host: "same-host",
  now: () => 10_000_000,
});

while (!existsSync(startPath)) await Bun.sleep(5);
const claim = lease.claim(crawlId);
await Bun.write(resultPath, JSON.stringify({ claim, pid: process.pid }));

while (!existsSync(releasePath)) await Bun.sleep(5);
lease.release();
