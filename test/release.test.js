import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps the v0.3.0 release metadata and announcements aligned", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const page = await readFile(new URL("public/index.html", root), "utf8");
  const p2pPage = await readFile(new URL("public/p2p.html", root), "utf8");
  const app = await readFile(new URL("public/app.js", root), "utf8");
  const readme = await readFile(new URL("README.md", root), "utf8");
  const announcement = await readFile(new URL("ANNOUNCEMENT.md", root), "utf8");
  const previous = await readFile(new URL("docs/announcements/v0.2.2.md", root), "utf8");
  const history = await readFile(new URL("docs/announcements/README.md", root), "utf8");
  const pagesWorkflow = await readFile(new URL(".github/workflows/pages.yml", root), "utf8");

  assert.equal(manifest.version, "0.3.0");
  assert.match(page, /V0\.3\.0/);
  assert.match(page, /styles\.css\?v=0\.3\.0/);
  assert.match(page, /app\.js\?v=0\.3\.0/);
  assert.match(page, /href="\.\/p2p\.html"/);
  assert.match(p2pPage, /V0\.3\.0/);
  assert.match(p2pPage, /p2p\.css\?v=0\.3\.0/);
  assert.match(p2pPage, /p2p\.js\?v=0\.3\.0/);
  assert.match(readme, /当前版本：`v0\.3\.0`/);
  assert.match(page, /id="static-notice"/);
  assert.match(app, /hostname\.endsWith\("\.github\.io"\)/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(announcement, /v0\.3\.0/i);
  assert.match(previous, /v0\.2\.2/i);
  assert.match(history, /v0\.2\.2/i);
  assert.match(pagesWorkflow, /actions\/upload-pages-artifact@v4/);
  assert.match(pagesWorkflow, /path:\s*\.\/public/);
  assert.match(pagesWorkflow, /actions\/deploy-pages@v4/);
});
