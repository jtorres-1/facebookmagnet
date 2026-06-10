require("dotenv").config();
const { spawn } = require("child_process");
const fs = require("fs");
const SCRAPE_INTERVAL_MS = 5 * 60 * 60 * 1000;
const LOG_PATH = "./runner.log";

function log(msg) {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

function runScript(script) {
  return new Promise((resolve) => {
    log(`Starting ${script}...`);
    const proc = spawn("node", [script], { stdio: "inherit" });
    proc.on("close", code => { log(`${script} done (code ${code})`); resolve(code); });
    proc.on("error", err => { log(`${script} error: ${err.message}`); resolve(1); });
  });
}

async function cycle() {
  log("=== Cycle start ===");
  await runScript("fb_poster.cjs");
  log("=== Poster cycle complete ===");
}

async function commenterCycle() {
  log("=== Commenter cycle start ===");
  await runScript("fb_commenter.cjs");
  log("=== Commenter cycle complete ===");
}

(async () => {
  log("FacebookMagnet runner started");

  // Run poster and commenter in parallel on separate intervals
  cycle();
  setInterval(cycle, SCRAPE_INTERVAL_MS);

  // Commenter runs every 30 minutes independently
  commenterCycle();
  setInterval(commenterCycle, 30 * 60 * 1000);
})();
