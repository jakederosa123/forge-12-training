import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const base = new URL("../public/training-app/", import.meta.url);

test("standalone page links the application assets", async () => {
  const html = await readFile(new URL("index.html", base), "utf8");
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css"/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
});

test("program opens with Pull A and uses the requested six-day order", async () => {
  const program = JSON.parse(await readFile(new URL("program-data.json", base), "utf8"));
  assert.deepEqual(program.weeks[0].sessions.map((session) => session.session), ["Pull A", "Legs A", "Push A", "Pull B", "Legs B + Athletic", "Push B"]);
});

test("application includes local saving and portable exports", async () => {
  const source = await readFile(new URL("app.js", base), "utf8");
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /Download backup/);
  assert.match(source, /Export CSV/);
});

