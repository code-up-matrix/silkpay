import { spawn } from "node:child_process";
// The managed preview passes Vite-style host/port flags. Translate them for Next.
const input = process.argv.slice(2);
let port = process.env.PORT || "3000",
  hostname = "0.0.0.0";
for (let i = 0; i < input.length; i++) {
  if (input[i] === "--port" || input[i] === "-p") port = input[++i];
  else if (input[i] === "--host" || input[i] === "--hostname")
    hostname = input[++i];
}
if (!/^\d+$/.test(port)) throw new Error("Invalid development port");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    hostname,
    "--port",
    port,
  ],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
