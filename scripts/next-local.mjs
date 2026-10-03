import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  console.error("Usage: node scripts/next-local.mjs <dev|start>");
  process.exit(2);
}

const portText = process.env.SCAN_PORT ?? "3210";
const port = Number(portText);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error("SCAN_PORT must be an integer from 1 through 65535.");
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = resolve(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  [
    nextCli,
    command,
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
    ...process.argv.slice(3),
  ],
  {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`Unable to start SCAN: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`SCAN process stopped by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
