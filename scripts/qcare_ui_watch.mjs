#!/usr/bin/env node
/**
 * Watches receptionist_ui.html and, on save, renders + screenshots it and
 * sends the screenshot to Telegram.
 *
 * Usage:
 *   export HERMES_HOME="$HOME/Library/Application Support/ai.atomicbot.hermes/hermes"
 *   node scripts/qcare_ui_watch.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const target = path.resolve(process.cwd(), "receptionist_ui.html");
const outDir = path.resolve(process.cwd(), ".ui_previews");

let timer = null;
let running = false;
let queued = false;

function runPreview() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  queued = false;

  const args = [
    path.resolve(process.cwd(), "scripts/qcare_ui_preview.mjs"),
    "--file",
    target,
    "--out",
    outDir,
    "--send-telegram",
  ];

  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", () => {
    running = false;
    if (queued) runPreview();
  });
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(runPreview, 350);
}

if (!fs.existsSync(target)) {
  process.stderr.write(`Missing ${target}\n`);
  process.exit(1);
}

process.stdout.write(`Watching ${target}\n`);
process.stdout.write("On save: screenshot (desktop) -> Telegram\n");

// Watch the directory so we survive editor “atomic save” (rename/replace).
const dir = path.dirname(target);
const base = path.basename(target);
fs.watch(dir, { persistent: true }, (_event, filename) => {
  if (!filename) return;
  if (String(filename) !== base) return;
  schedule();
});

