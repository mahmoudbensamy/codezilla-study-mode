// Generates blocked-domains.txt and the browser extension (rules.json + manifest.json) from config.json.
// Usage: node generate.js   (or require("./generate.js").generate(rootDir))
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PLAYER = "http://127.0.0.1:8765";
const RE_DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const RE_ID = /^[A-Za-z0-9_-]{2,64}$/;
const RE_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const RE_HANDLE = /^@[A-Za-z0-9._-]{2,60}$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function validate(cfg) {
  const err = [];
  if (!cfg || typeof cfg !== "object") throw new Error("config is not an object");
  const iv = cfg.guard && cfg.guard.intervalMinutes;
  if (!Number.isInteger(iv) || iv < 1 || iv > 1440) err.push("guard interval must be 1-1440 minutes");
  (cfg.blockedDomains || []).forEach((d) => { if (!RE_DOMAIN.test(d.domain || "")) err.push("bad blocked domain: " + d.domain); });
  (cfg.redirects || []).forEach((r) => {
    if (!r.name) err.push("redirect without a name");
    if (!Array.isArray(r.domains) || !r.domains.length || !r.domains.every((d) => RE_DOMAIN.test(d))) err.push("bad domains in redirect: " + r.name);
    if (!/^https?:\/\/[^\s]+$/i.test(r.target || "")) err.push("bad target in redirect: " + r.name);
  });
  const s = cfg.study || {};
  (s.embedExemptSites || []).forEach((d) => { if (!RE_DOMAIN.test(d)) err.push("bad exempt site: " + d); });
  (s.playlists || []).forEach((p) => { if (!RE_ID.test(p.id || "")) err.push("bad playlist id: " + p.id); });
  (s.channels || []).forEach((c) => {
    if (!RE_CHANNEL.test(c.channelId || "")) err.push("bad channel id (must start with UC): " + c.channelId);
    if (c.handle && !RE_HANDLE.test(c.handle)) err.push("bad handle: " + c.handle);
    (c.courses || []).forEach((p) => { if (!RE_ID.test(p.id || "")) err.push("bad course id: " + p.id); });
  });
  if (err.length) throw new Error(err.join("; "));
}

function buildRules(cfg) {
  const rules = [];
  let n = 1;
  const add = (priority, action, condition) => rules.push({ id: n++, priority, action, condition });

  (cfg.redirects || []).filter((r) => r.enabled).forEach((r) =>
    add(1, { type: "redirect", redirect: { url: r.target } }, { requestDomains: r.domains, resourceTypes: ["main_frame"] }));

  const s = cfg.study || {};
  if (s.enabled) {
    add(1, { type: "block" }, {
      requestDomains: ["youtube-nocookie.com"],
      excludedInitiatorDomains: [...(s.embedExemptSites || []), "youtube-nocookie.com"],
      resourceTypes: ["main_frame", "sub_frame"]
    });
    const allowed = [];
    const forList = (id, ch) => {
      allowed.push(id);
      const base = PLAYER + "/?list=" + id + (ch ? "&ch=" + ch : "");
      add(2, { type: "redirect", redirect: { url: base } }, {
        regexFilter: "^https?://(www\\.|m\\.)?youtube\\.com/playlist\\?(.*&)?list=" + id + "(&.*)?$", resourceTypes: ["main_frame"] });
      add(2, { type: "redirect", redirect: { url: base } }, {
        regexFilter: "^https?://(www\\.|m\\.)?youtube\\.com/watch\\?(.*&)?list=" + id + "(&.*)?$", resourceTypes: ["main_frame"] });
      add(3, { type: "redirect", redirect: { regexSubstitution: base + "&v=\\2" } }, {
        regexFilter: "^https?://(www\\.|m\\.)?youtube\\.com/watch\\?v=([A-Za-z0-9_-]{11})&(.*&)?list=" + id + "(&.*)?$", resourceTypes: ["main_frame"] });
    };
    (s.playlists || []).forEach((p) => forList(p.id));
    (s.channels || []).forEach((c) => {
      const up = "UU" + c.channelId.slice(2);
      allowed.push(up);
      const alts = ["channel/" + esc(c.channelId)];
      if (c.handle) alts.unshift(esc(c.handle));
      add(2, { type: "redirect", redirect: { url: PLAYER + "/?list=" + up } }, {
        regexFilter: "^https?://(www\\.|m\\.)?youtube\\.com/(" + alts.join("|") + ")(/.*)?$",
        isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"] });
      (c.courses || []).forEach((p) => forList(p.id, up));
    });
    if (allowed.length) {
      add(4, { type: "allow" }, {
        regexFilter: "^https://www\\.youtube-nocookie\\.com/embed/(videoseries|[A-Za-z0-9_-]{11})\\?list=(" + allowed.join("|") + ")(&.*)?$",
        resourceTypes: ["sub_frame"] });
    }
  }
  rules.forEach((r) => { if (r.condition.regexFilter) new RegExp(r.condition.regexFilter); });
  return rules;
}

function buildManifest(cfg, rulesJson) {
  const doms = new Set();
  (cfg.redirects || []).filter((r) => r.enabled).forEach((r) => r.domains.forEach((d) => doms.add(d)));
  if ((cfg.study || {}).enabled) doms.add("youtube.com");
  const ver = "1." + (parseInt(crypto.createHash("sha256").update(rulesJson).digest("hex").slice(0, 6), 16) % 100000);
  return {
    manifest_version: 3,
    name: (cfg.extension && cfg.extension.name) || "Distraction Redirects",
    version: ver,
    description: "Managed by the Study & Guard Manager. Do not edit by hand.",
    permissions: ["declarativeNetRequest"],
    host_permissions: [...doms].map((d) => "*://*." + d + "/*"),
    declarative_net_request: { rule_resources: [{ id: "redirect", enabled: true, path: "rules.json" }] }
  };
}

function blockedText(cfg) {
  const out = [
    "# GENERATED by the Study & Guard Manager from config.json. Edit domains in the app, not here.",
    "# One domain per line. Lines starting with # are ignored (a '# domain' line is a disabled domain).",
    "# The hosts file has no wildcards, so every subdomain is listed separately.",
    ""
  ];
  const groups = new Map();
  (cfg.blockedDomains || []).forEach((d) => { const g = d.group || "Other"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); });
  groups.forEach((list, g) => {
    out.push("# --- " + g + " ---");
    list.forEach((d) => out.push((d.enabled ? "" : "# ") + d.domain.toLowerCase()));
    out.push("");
  });
  return out.join("\n");
}

function generate(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  validate(cfg);
  if (!(cfg.blockedDomains || []).some((d) => d.enabled)) throw new Error("at least one blocked domain must be enabled (installer needs a non-empty list)");
  const rulesJson = JSON.stringify(buildRules(cfg), null, 2) + "\n";
  const manifestJson = JSON.stringify(buildManifest(cfg, rulesJson), null, 2) + "\n";
  const extDir = path.join(root, "extension");
  fs.mkdirSync(extDir, { recursive: true });
  const rp = path.join(extDir, "rules.json");
  let prev = "";
  try { prev = fs.readFileSync(rp, "utf8"); } catch (e) {}
  fs.writeFileSync(rp, rulesJson);
  fs.writeFileSync(path.join(extDir, "manifest.json"), manifestJson);
  fs.writeFileSync(path.join(root, "blocked-domains.txt"), blockedText(cfg));
  return { rulesChanged: prev !== rulesJson, rules: JSON.parse(rulesJson).length, version: JSON.parse(manifestJson).version };
}

module.exports = { generate, validate };
if (require.main === module) {
  try { console.log(JSON.stringify(generate(__dirname))); }
  catch (e) { console.error("ERROR: " + e.message); process.exit(1); }
}
