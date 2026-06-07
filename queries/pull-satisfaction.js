// Stage the Patient Satisfaction survey xlsx into data/ for the pipeline.
//
// No-IT, no-auth approach: the survey files live in Brad Miller's OneDrive, shared with you. There
// is no programmatic path to the BINARY without IT (az is blocked/nonce-hardened for these, Graph
// PowerShell needs admin consent, the claude.ai M365 connector only extracts text, and a OneDrive
// FILE shortcut syncs only a .url pointer — not content). So the workflow is: you Download the two
// files from the browser (2 clicks), then this copies the newest matching ones from your Downloads
// folder into data/. For a fully hands-off refresh later, have Brad put both files in a shared
// FOLDER and add a shortcut to that FOLDER (folder shortcuts DO sync real content locally).
//
// Usage: node queries/pull-satisfaction.js [--src "C:\\path\\to\\folder"]
const fs = require("fs");
const path = require("path");
const os = require("os");

const TARGETS = [
  { re: /^patient satisfaction survey.*\.xlsx$/i, out: "satisfaction-main.xlsx", label: "Patient Satisfaction Survey" },
  { re: /^ohana survey.*\.xlsx$/i, out: "satisfaction-ohana.xlsx", label: "Ohana Survey" },
];

function parseSrc() {
  const i = process.argv.indexOf("--src");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(os.homedir(), "Downloads");
}

function newestMatch(dir, re) {
  let best = null;
  for (const name of fs.readdirSync(dir)) {
    if (!re.test(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { full, name, mtimeMs: st.mtimeMs };
  }
  return best;
}

(() => {
  const src = parseSrc();
  const data = path.join(__dirname, "..", "data");
  if (!fs.existsSync(data)) fs.mkdirSync(data, { recursive: true });
  if (!fs.existsSync(src)) { console.error(`FATAL: source folder not found: ${src}`); process.exit(1); }

  let ok = 0;
  for (const t of TARGETS) {
    const m = newestMatch(src, t.re);
    if (!m) { console.error(`MISS ${t.label}: no "${t.re}" file in ${src} — Download it first.`); continue; }
    // sanity: xlsx is a zip ('PK')
    const head = fs.readFileSync(m.full).slice(0, 2).toString("latin1");
    if (head !== "PK") { console.error(`FAIL ${t.label}: ${m.name} is not a valid xlsx (first2='${head}')`); continue; }
    fs.copyFileSync(m.full, path.join(data, t.out));
    const when = new Date(m.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
    console.error(`OK   ${t.out}  <-  ${m.name}  (modified ${when})`);
    ok++;
  }
  console.error(`done: ${ok}/${TARGETS.length} staged into data/`);
  process.exit(ok === TARGETS.length ? 0 : 1);
})();
