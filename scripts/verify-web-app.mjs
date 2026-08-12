import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const base = new URL("../public/training-app/", import.meta.url);
const required = ["index.html", "styles.css", "app.js", "program-data.json", "manifest.webmanifest", "sw.js", "favicon.svg"];
await Promise.all(required.map((file) => access(new URL(file, base))));

const [html, app, worker] = await Promise.all([
  readFile(new URL("index.html", base), "utf8"),
  readFile(new URL("app.js", base), "utf8"),
  readFile(new URL("sw.js", base), "utf8"),
]);

for (const asset of ["styles.css", "app.js", "manifest.webmanifest", "favicon.svg"]) assert.match(html, new RegExp(asset.replace(".", "\\.")), `${asset} is not linked from index.html`);
for (const feature of ["localStorage", "downloadBackup", "restoreBackup", "exportCSV", "buildRecommendations", "calculateReadiness", "registerServiceWorker"]) assert.match(app, new RegExp(feature), `${feature} is missing from app.js`);
for (const asset of ["index.html", "styles.css", "app.js", "program-data.json"]) assert.match(worker, new RegExp(asset.replace(".", "\\.")), `${asset} is not cached by sw.js`);

console.log("Web app verified: core files, auto-save, backup, export, progression, readiness, and offline cache are present.");

