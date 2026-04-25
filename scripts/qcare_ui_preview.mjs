#!/usr/bin/env node
/**
 * Qcare UI preview helper:
 * - Ingest HTML from --url, --file, stdin, or watch a local file
 * - Write to receptionist_ui.html (or --target)
 * - Render with Playwright (Chromium) and take a desktop screenshot
 * - Optionally send the screenshot to Telegram via Bot API
 *
 * Examples:
 *   node scripts/qcare_ui_preview.mjs --url https://example.com/mockup.html
 *   cat receptionist_ui.html | node scripts/qcare_ui_preview.mjs --stdin
 *   node scripts/qcare_ui_preview.mjs --file /tmp/mock.html --send-telegram
 *   node scripts/qcare_ui_preview.mjs --watch "$HOME/Library/Mobile Documents/com~apple~CloudDocs/qcare/mockup.html" --send-telegram
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function usageAndExit(code = 1) {
  const msg = [
    "Usage:",
    "  node scripts/qcare_ui_preview.mjs [--url <https://...> | --file <path> | --stdin | --watch <path>]",
    "    [--target <path>] [--out <dir>] [--output <path>] [--send-telegram] [--full-page]",
    "",
    "Notes:",
    "  - Default target: ./receptionist_ui.html",
    "  - Default out dir: ./.ui_previews",
    "  - Default output: <out>/qcare-ui.png",
    "  - Default screenshot is viewport-only. Use --full-page for full-page.",
    "  - For Telegram send, set TELEGRAM_BOT_TOKEN and TELEGRAM_HOME_CHANNEL",
    "    (or set HERMES_HOME so we can read $HERMES_HOME/.env).",
  ].join("\n");
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    url: null,
    file: null,
    stdin: false,
    watch: null,
    target: "receptionist_ui.html",
    outDir: ".ui_previews",
    output: null,
    sendTelegram: false,
    fullPage: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i] ?? null;
    else if (a === "--file") args.file = argv[++i] ?? null;
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--watch") args.watch = argv[++i] ?? null;
    else if (a === "--target") args.target = argv[++i] ?? args.target;
    else if (a === "--out") args.outDir = argv[++i] ?? args.outDir;
    else if (a === "--output") args.output = argv[++i] ?? null;
    else if (a === "--send-telegram") args.sendTelegram = true;
    else if (a === "--full-page") args.fullPage = true;
    else if (a === "-h" || a === "--help") usageAndExit(0);
    else usageAndExit(1);
  }

  const sources = [Boolean(args.url), Boolean(args.file), Boolean(args.stdin), Boolean(args.watch)].filter(Boolean).length;
  if (sources !== 1) usageAndExit(1);
  if (args.url && !/^https?:\/\//i.test(args.url)) {
    throw new Error("--url must be http(s)");
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseDotenv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function loadTelegramEnv() {
  const merged = { ...process.env };

  const hermesHome =
    process.env.HERMES_HOME ||
    path.join(process.env.HOME || "", "Library/Application Support/ai.atomicbot.hermes/hermes");

  const envPath = path.join(hermesHome, ".env");
  try {
    if (fs.existsSync(envPath)) {
      const parsed = parseDotenv(fs.readFileSync(envPath, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        if (merged[k] == null || merged[k] === "") merged[k] = v;
      }
    }
  } catch {
    // ignore
  }

  return {
    token: merged.TELEGRAM_BOT_TOKEN || "",
    chatId: merged.TELEGRAM_HOME_CHANNEL || "",
  };
}

async function sendTelegramPhoto({ token, chatId, photoPath, caption }) {
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const buf = await fs.promises.readFile(photoPath);
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([buf]), path.basename(photoPath));

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), waitMs);
  };
}

async function loadHtmlOnce(args) {
  if (args.url) {
    const res = await fetch(args.url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    return await res.text();
  }
  if (args.file) return await fs.promises.readFile(args.file, "utf8");
  if (args.watch) return await fs.promises.readFile(args.watch, "utf8");
  if (args.stdin) return await readStdin();
  return "";
}

async function renderAndMaybeSend({ args, html }) {
  if (!html.trim()) throw new Error("No HTML provided");

  const repoRoot = process.cwd();
  const targetPath = path.resolve(repoRoot, args.target);
  await fs.promises.writeFile(targetPath, html, "utf8");

  const outDir = path.resolve(repoRoot, args.outDir);
  await fs.promises.mkdir(outDir, { recursive: true });

  const desktopPng = args.output
    ? path.resolve(repoRoot, args.output)
    : path.join(outDir, "qcare-ui.png");
  await fs.promises.mkdir(path.dirname(desktopPng), { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const fileUrl = pathToFileURL(targetPath).toString();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: desktopPng, fullPage: Boolean(args.fullPage) });
    await context.close();
  } finally {
    await browser.close();
  }

  process.stdout.write(`Wrote ${path.relative(repoRoot, targetPath)}\n`);
  process.stdout.write(`Saved ${path.relative(repoRoot, desktopPng)}\n`);

  if (args.sendTelegram) {
    const { token, chatId } = loadTelegramEnv();
    if (!token || !chatId) {
      throw new Error(
        "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_HOME_CHANNEL (set env vars or ensure $HERMES_HOME/.env contains them)."
      );
    }
    const caption = `Qcare UI preview: ${path.basename(desktopPng)}`;
    await sendTelegramPhoto({ token, chatId, photoPath: desktopPng, caption });
    process.stdout.write("Sent screenshot to Telegram.\n");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.watch) {
    const html = await loadHtmlOnce(args);
    await renderAndMaybeSend({ args, html });
    return;
  }

  const watchPath = path.resolve(process.cwd(), args.watch);
  process.stdout.write(`Watching ${watchPath}\n`);

  let lastMtimeMs = 0;
  const doRun = async () => {
    try {
      const st = await fs.promises.stat(watchPath);
      if (!st.isFile()) return;
      if (st.mtimeMs <= lastMtimeMs) return;
      lastMtimeMs = st.mtimeMs;

      const html = await fs.promises.readFile(watchPath, "utf8");
      await renderAndMaybeSend({ args, html });
    } catch (e) {
      process.stderr.write(String(e?.stack || e) + "\n");
    }
  };

  const schedule = debounce(() => {
    void doRun();
  }, 250);

  // Initial run
  await doRun();

  fs.watch(watchPath, { persistent: true }, () => schedule());

  // Keep process alive
  // eslint-disable-next-line no-constant-condition
  while (true) await new Promise((r) => setTimeout(r, 60_000));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
