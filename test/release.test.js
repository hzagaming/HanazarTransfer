import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps the v0.2.0 release metadata and announcements aligned", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const page = await readFile(new URL("public/index.html", root), "utf8");
  const announcement = await readFile(new URL("ANNOUNCEMENT.md", root), "utf8");
  const history = await readFile(new URL("docs/announcements/v0.1.0.md", root), "utf8");

  assert.equal(manifest.version, "0.2.0");
  assert.match(page, /V0\.2\.0/);
  assert.match(page, /styles\.css\?v=0\.2\.0/);
  assert.match(page, /app\.js\?v=0\.2\.0/);
  assert.match(announcement, /v0\.2\.0/i);
  assert.match(history, /v0\.1\.0/i);
});
