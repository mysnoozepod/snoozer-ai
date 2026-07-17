const { spawn, spawnSync } = require("node:child_process");

const isWindows = process.platform === "win32";

function npmInvocation(args) {
  if (!isWindows) return { command: "npm", args };
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", ["npm", ...args].join(" ")],
  };
}
const env = {
  ...process.env,
  VITE_DEPLOYMENT_ROLE: "review",
  VITE_DEVICE_ID: "admin-dev",
};

const buildCommand = npmInvocation(["run", "build"]);
const build = spawnSync(buildCommand.command, buildCommand.args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status || 1);
}

const previewCommand = npmInvocation(["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"]);
const preview = spawn(previewCommand.command, previewCommand.args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

function stop(signal) {
  if (!preview.killed) {
    preview.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

preview.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
