#!/usr/bin/env node
/**
 * Run multiple UI preview watchers from a single config file.
 *
 * Config file (JSON):
 * {
 *   "jobs": [
 *     {
 *       "name": "receptionist",
 *       "watch": "/abs/path/to/icloud/mockup.html",
 *       "target": "receptionist_ui.html",
 *       "output": ".ui_previews/receptionist.png",
 *       "sendTelegram": true,
 *       "fullPage": false
 *     }
 *   ]
 * }
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

function usageAndExit(code = 1) {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/ui_preview_multi.mjs [--config <path>]",
      "",
      "Notes:",
      "  - Default config: ./ui_preview.config.json",
      "  - Each job spawns a watcher process running scripts/qcare_ui_preview.mjs",
    ].join("\n") + "\n"
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = { config: "ui_preview.config.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i] ?? args.config;
    else if (a === "-h" || a === "--help") usageAndExit(0);
    else usageAndExit(1);
  }
  return args;
}

function loadConfig(configPath) {
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Config not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw);
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  if (!jobs.length) throw new Error("Config has no jobs");
  return { abs, jobs };
}

function validateJob(job) {
  if (!job || typeof job !== "object") throw new Error("Invalid job entry");
  const name = String(job.name || "").trim();
  const watch = String(job.watch || "").trim();
  if (!name) throw new Error("Job missing name");
  if (!watch) throw new Error(`Job '${name}' missing watch path`);
  return {
    name,
    watch,
    target: String(job.target || "receptionist_ui.html"),
    output: String(job.output || `.ui_previews/${name}.png`),
    sendTelegram: Boolean(job.sendTelegram ?? true),
    fullPage: Boolean(job.fullPage ?? false),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { abs: configAbs, jobs } = loadConfig(args.config);

  process.stdout.write(`Loaded ${jobs.length} job(s) from ${configAbs}\n`);

  const children = [];
  for (const rawJob of jobs) {
    const job = validateJob(rawJob);

    const childArgs = [
      path.join("scripts", "qcare_ui_preview.mjs"),
      "--watch",
      job.watch,
      "--target",
      job.target,
      "--output",
      job.output,
    ];
    if (job.sendTelegram) childArgs.push("--send-telegram");
    if (job.fullPage) childArgs.push("--full-page");

    const child = spawn(process.execPath, childArgs, {
      stdio: "inherit",
      env: process.env,
    });
    children.push({ name: job.name, child });
    process.stdout.write(`Started '${job.name}' watcher\n`);
  }

  const shutdown = () => {
    for (const { child } of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();

