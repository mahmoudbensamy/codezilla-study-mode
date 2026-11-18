// Local server (127.0.0.1 only):
//  - YouTube-style channel page + watch page for the allowlisted study channels/playlists
//  - /admin : the Study & Guard Manager GUI and its API
// Usage: node server.js [path-to-config.json] [path-to-project-root]
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");

const CONFIG = process.argv[2] || path.join(__dirname, "..", "config.json");
const ROOT = process.argv[3] || path.dirname(CONFIG);
const ORIGIN = "http://127.0.0.1:8765";
const HOST_HEADER = "127.0.0.1:8765";
const HOSTS_FILE = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
const DATA_DIR = path.join(process.env.ProgramData || "C:\\ProgramData", "HostsGuard");
const BLOCK_BEGIN = "# >>> HostsGuard >>>", BLOCK_END = "# <<< HostsGuard <<<";

// ---------- config ----------------------------------------------------------
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, "utf8"));
function studyView() {
  let cfg;
  try { cfg = readConfig(); } catch (e) { return { enabled: false, playlists: {}, channels: {} }; }
  const s = cfg.study || {};
  const playlists = {}, channels = {};
  (s.playlists || []).forEach((p) => { playlists[p.id] = p.title || "Playlist"; });
  (s.channels || []).forEach((c) => {
    channels["UU" + c.channelId.slice(2)] = { name: c.name || "Channel", handle: c.handle || "", courses: c.courses || [] };
  });
  return { enabled: !!s.enabled, playlists, channels };
}

// ---------- title cache -----------------------------------------------------
const CACHE_FILE = path.join(os.homedir(), ".study-player-titles.json");
const titleCache = new Map();
try { Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))).forEach(([k, v]) => titleCache.set(k, v)); } catch (e) {}
let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(titleCache))); } catch (e) {} }, 2000);
}
async function getTitle(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  try {
    const r = await fetch("https://noembed.com/embed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id));
    const j = await r.json();
    const t = typeof j.title === "string" ? j.title : "";
    if (t) { titleCache.set(id, t); saveCache(); }
    return t;
  } catch (e) { return ""; }
}

// ---------- study pages -----------------------------------------------------
const VID = /^[A-Za-z0-9_-]{11}$/;
function resolve(list, ch, v) {
  const S = studyView();
  if (!S.enabled) return null;
  v = VID.test(v || "") ? v : "";
  if (S.channels[list]) {
    const c = S.channels[list];
    return { page: v ? "watch" : "channel", list, v, title: c.name, handle: c.handle, sub: "", courses: c.courses, back: "/?list=" + list };
  }
  if (ch && S.channels[ch]) {
    const course = S.channels[ch].courses.find((x) => x.id === list);
    if (course) return { page: "watch", list, v, title: S.channels[ch].name, sub: course.title, courses: [], back: "/?list=" + ch };
  }
  if (S.playlists[list]) return { page: "watch", list, v, title: S.playlists[list], sub: "Playlist", courses: [], back: "" };
  return null;
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0f0f0f;color:#f1f1f1;font-family:Roboto,system-ui,Segoe UI,Tahoma,sans-serif}
a{color:inherit;text-decoration:none}
#ban{height:150px;background:linear-gradient(120deg,var(--c1),var(--c2))}
#chhead{display:flex;gap:24px;align-items:center;padding:20px 5% 8px}
#bigav{width:128px;height:128px;border-radius:50%;background:var(--c1);display:flex;align-items:center;justify-content:center;font-size:56px;font-weight:700;color:#fff;flex:none}
#chname{font-size:32px;font-weight:700;margin:0 0 6px}#chmeta{color:#aaa;font-size:14px}
#chtabs{display:flex;gap:28px;padding:0 5%;border-bottom:1px solid #303030;margin-top:10px}
#chtabs button{background:none;border:0;border-bottom:2px solid transparent;color:#aaa;padding:14px 4px;font-size:15px;font-weight:500;cursor:pointer}
#chtabs button.on{color:#fff;border-bottom-color:#fff}
#tools{padding:16px 5% 0}#q{width:280px;max-width:100%;padding:8px 14px;border-radius:20px;border:1px solid #303030;background:#121212;color:#eee;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px 16px;padding:20px 5% 40px}
.card .th{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#222}
.card img{width:100%;height:100%;object-fit:cover;display:block}
.card .ct{margin-top:10px;font-size:14px;font-weight:500;line-height:1.4;max-height:2.8em;overflow:hidden}
.card:hover .ct{color:#fff}
.pl .th{display:flex;align-items:center;justify-content:center;font-size:42px;color:#777;background:linear-gradient(135deg,#232323,#171717)}
.pl .sub{color:#aaa;font-size:12px;margin-top:4px}
.msg{padding:30px 5%;color:#999;font-size:14px;line-height:1.7}
#app{display:flex;height:100vh}#main{flex:1;min-width:0;background:#000}#main iframe{border:0;width:100%;height:100%}
#side{width:400px;display:flex;flex-direction:column;border-left:1px solid #2a2a2c;background:#161617}
#whead{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #2a2a2c}
#wav{width:38px;height:38px;border-radius:50%;background:var(--c1);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
#wchn{font-size:15px;font-weight:600}#wsub{font-size:12px;color:#aaa;margin-top:2px}
#wback{padding:8px 14px;font-size:13px;border-bottom:1px solid #2a2a2c}#wback a{color:#8ab4ff}
#pos{padding:6px 14px;font-size:12px;color:#888;border-bottom:1px solid #202022}
#list{flex:1;overflow-y:auto;margin:0;padding:0;list-style:none}
#list li{display:flex;gap:10px;padding:8px 12px;cursor:pointer;font-size:13px;line-height:1.4;align-items:flex-start}
#list li:hover{background:#202022}#list li.on{background:#272727}
#list .n{color:#888;min-width:22px;text-align:right;padding-top:2px}
#list img{width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#222;flex:none}
@media(max-width:800px){#app{flex-direction:column;height:auto}#main{height:56vw}#side{width:100%;height:60vh;border-left:0}}`;

const CHANNEL_BODY = `<div id="ban"></div>
<div id="chhead"><div id="bigav"></div><div><h1 id="chname"></h1><div id="chmeta"></div></div></div>
<div id="chtabs"><button id="tv" class="on">Videos</button><button id="tp">Playlists</button></div>
<div id="tools"><input id="q" placeholder="Search videos"></div>
<div id="vids" class="grid"></div>
<div id="pls" class="grid" style="display:none"></div>
<iframe id="hid" style="display:none" allow="autoplay"></iframe>`;

const WATCH_BODY = `<div id="app"><div id="main"><iframe id="p" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
<div id="side">
<div id="whead"><div id="wav"></div><div><div id="wchn"></div><div id="wsub"></div></div></div>
<div id="wback"><a id="wbacka" href="#">&larr; Back to channel</a></div>
<div id="pos">loading...</div>
<ul id="list"></ul>
</div></div>`;

const COMMON_JS = `
var C=__CFG__, ORIGIN=__ORIGIN__;
var $=function(i){return document.getElementById(i);};
var h=0,s=C.title;for(var k=0;k<s.length;k++){h=(h*31+s.charCodeAt(k))%360;}
document.documentElement.style.setProperty("--c1","hsl("+h+",55%,38%)");
document.documentElement.style.setProperty("--c2","hsl("+((h+50)%360)+",60%,22%)");
var ids=[], queue=[], active=0, titleEls=[];
function thumb(id){return "https://img.youtube.com/vi/"+id+"/mqdefault.jpg";}
function pump(){
  if(active>=3||!queue.length)return;
  var i=queue.shift();active++;
  fetch("/title?id="+ids[i]).then(function(r){return r.text();}).then(function(t){if(t&&titleEls[i]){titleEls[i].textContent=t;}})
  .catch(function(){}).then(function(){active--;pump();});
  pump();
}
function listen(frame){frame.contentWindow.postMessage(JSON.stringify({event:"listening",id:1,channel:"widget"}),"*");}
function handshake(frame){
  frame.addEventListener("load",function(){listen(frame);var t=0,iv=setInterval(function(){listen(frame);if(++t>10||ids.length)clearInterval(iv);},700);});
}`;

const CHANNEL_JS = `
$("chname").textContent=C.title;$("bigav").textContent=C.title.charAt(0);
$("chmeta").textContent=(C.handle?C.handle+" \\u00b7 ":"")+"Study channel";document.title=C.title+" - Study player";
var hid=$("hid"), vids=$("vids"), pls=$("pls"), q=$("q");
function tab(t){var v=(t==="v");vids.style.display=v?"":"none";pls.style.display=v?"none":"";$("tools").style.display=v?"":"none";
  $("tv").className=v?"on":"";$("tp").className=v?"":"on";}
$("tv").onclick=function(){tab("v");};$("tp").onclick=function(){tab("p");};
if(!C.courses.length){pls.innerHTML='<div class="msg" style="grid-column:1/-1">No playlists added for this channel yet.</div>';}
C.courses.forEach(function(c){var a=document.createElement("a");a.className="card pl";a.href="/?list="+encodeURIComponent(c.id)+"&ch="+encodeURIComponent(C.list);
  a.innerHTML='<div class="th">&#9776;</div><div class="ct"></div><div class="sub">Playlist</div>';a.querySelector(".ct").textContent=c.title;pls.appendChild(a);});
vids.innerHTML='<div class="msg" style="grid-column:1/-1">Loading videos...</div>';
function build(){
  vids.innerHTML="";
  ids.forEach(function(id,i){
    var a=document.createElement("a");a.className="card";a.href="/?list="+encodeURIComponent(C.list)+"&v="+id;
    a.innerHTML='<div class="th"><img loading="lazy" alt=""></div><div class="ct">Video '+(i+1)+'</div>';
    a.querySelector("img").src=thumb(id);titleEls.push(a.querySelector(".ct"));vids.appendChild(a);queue.push(i);
  });
  for(var k=0;k<3;k++)pump();
}
q.addEventListener("input",function(){var s=q.value.trim().toLowerCase();
  Array.prototype.forEach.call(vids.children,function(a){var t=(a.querySelector(".ct")||{}).textContent||"";a.style.display=(!s||t.toLowerCase().indexOf(s)>-1)?"":"none";});});
window.addEventListener("message",function(e){
  if(e.source!==hid.contentWindow)return;var d;try{d=JSON.parse(e.data);}catch(x){return;}
  var info=d.info;if(info&&info.playlist&&info.playlist.length&&!ids.length){ids=info.playlist;build();}
});
handshake(hid);
hid.src="https://www.youtube-nocookie.com/embed/videoseries?list="+C.list+"&enablejsapi=1&origin="+encodeURIComponent(ORIGIN);
`;

const WATCH_JS = `
$("wchn").textContent=C.title;$("wav").textContent=C.title.charAt(0);$("wsub").textContent=C.sub||"";
document.title=(C.sub||C.title)+" - Study player";
if(C.back){$("wbacka").href=C.back;}else{$("wback").style.display="none";}
var frame=$("p"), ul=$("list"), pos=$("pos"), items=[], cur=-1;
function send(o){frame.contentWindow.postMessage(JSON.stringify(o),"*");}
function build(){
  ul.innerHTML="";
  ids.forEach(function(id,i){
    var li=document.createElement("li");
    li.innerHTML='<span class="n">'+(i+1)+'</span><img loading="lazy" alt=""><span class="t">Video '+(i+1)+'</span>';
    li.querySelector("img").src=thumb(id);titleEls.push(li.querySelector(".t"));
    li.onclick=function(){send({event:"command",func:"playVideoAt",args:[i]});};
    ul.appendChild(li);items.push(li);queue.push(i);
  });
  for(var k=0;k<3;k++)pump();
}
function mark(i){
  if(i===cur||i<0||!items[i])return;
  if(items[cur])items[cur].classList.remove("on");
  cur=i;items[i].classList.add("on");items[i].scrollIntoView({block:"nearest"});
  pos.textContent=(i+1)+" / "+ids.length;
}
window.addEventListener("message",function(e){
  if(e.source!==frame.contentWindow)return;var d;try{d=JSON.parse(e.data);}catch(x){return;}
  var info=d.info;if(!info)return;
  if(info.playlist&&info.playlist.length&&!ids.length){ids=info.playlist;build();}
  if(typeof info.playlistIndex==="number")mark(info.playlistIndex);
});
handshake(frame);
frame.src="https://www.youtube-nocookie.com/embed/"+(C.v||"videoseries")+"?list="+C.list+"&enablejsapi=1&origin="+encodeURIComponent(ORIGIN);
`;

const PAGE = (cfg) => {
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const body = cfg.page === "channel" ? CHANNEL_BODY : WATCH_BODY;
  const js = COMMON_JS + (cfg.page === "channel" ? CHANNEL_JS : WATCH_JS);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Study player</title><style>${CSS}</style></head><body>${body}<script>${js.replace("__CFG__", () => json).replace("__ORIGIN__", () => JSON.stringify(ORIGIN))}</script></body></html>`;
};

// ---------- admin API -------------------------------------------------------
const sendJson = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((ok, fail) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > 1e6) { fail(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}
const run = (cmd, args, ms) => new Promise((ok) => execFile(cmd, args, { timeout: ms || 4000, windowsHide: true }, (e, so) => ok(e ? null : String(so))));

function hostsStatus(cfg) {
  const want = new Set((cfg.blockedDomains || []).filter((d) => d.enabled).map((d) => d.domain.toLowerCase()));
  let txt = "";
  try { txt = fs.readFileSync(HOSTS_FILE, "utf8"); } catch (e) { return { known: false }; }
  const lines = txt.split(/\r?\n/);
  let inBlock = false, found = false; const have = new Set();
  lines.forEach((l) => {
    const t = l.trim();
    if (t === BLOCK_BEGIN) { inBlock = true; found = true; return; }
    if (t === BLOCK_END) { inBlock = false; return; }
    if (inBlock) { const m = t.match(/^0\.0\.0\.0\s+(\S+)/); if (m) have.add(m[1].toLowerCase()); }
  });
  return {
    known: true, blockPresent: found,
    toAdd: [...want].filter((d) => !have.has(d)),
    toRemove: [...have].filter((d) => !want.has(d)),
    inSync: found && [...want].every((d) => have.has(d)) && [...have].every((d) => want.has(d))
  };
}
async function guardStatus() {
  const g = { known: false, intervalMinutes: null, lastRestores: [] };
  const xml = await run("schtasks.exe", ["/Query", "/TN", "HostsGuard", "/XML"]);
  if (xml) {
    g.known = true;
    const m = xml.match(/<Interval>PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (m) g.intervalMinutes = (parseInt(m[1] || "0", 10) * 60) + parseInt(m[2] || "0", 10);
  }
  try { g.lastRestores = fs.readFileSync(path.join(DATA_DIR, "guard.log"), "utf8").trim().split(/\r?\n/).slice(-8); } catch (e) {}
  return g;
}

async function api(req, res, u) {
  if (req.headers["x-manager"] !== "1") return sendJson(res, 403, { error: "missing header" });
  if (req.method !== "GET" && req.headers.origin !== ORIGIN) return sendJson(res, 403, { error: "bad origin" });
  const gen = () => require(path.join(ROOT, "generate.js"));
  try {
    if (u.pathname === "/api/config" && req.method === "GET") return sendJson(res, 200, readConfig());
    if (u.pathname === "/api/config" && req.method === "PUT") {
      const cfg = JSON.parse(await readBody(req));
      const g = gen();
      g.validate(cfg);
      try { fs.copyFileSync(CONFIG, CONFIG + ".bak"); } catch (e) {}
      fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
      return sendJson(res, 200, { ok: true, ...g.generate(ROOT) });
    }
    if (u.pathname === "/api/status" && req.method === "GET") {
      const cfg = readConfig();
      let ext = {};
      try { ext = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8")); } catch (e) {}
      return sendJson(res, 200, {
        player: { running: true },
        hosts: hostsStatus(cfg),
        guard: Object.assign(await guardStatus(), { wantedMinutes: cfg.guard.intervalMinutes }),
        extension: { version: ext.version || "?", folder: path.join(ROOT, "extension") },
        root: ROOT
      });
    }
    if (u.pathname === "/api/apply" && req.method === "POST") {
      const bat = path.join(ROOT, "install.bat");
      if (!fs.existsSync(bat)) return sendJson(res, 500, { error: "install.bat not found" });
      spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", "Start-Process -FilePath '" + bat + "' -Verb RunAs"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "unknown endpoint" });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
}

// ---------- server ----------------------------------------------------------
http.createServer(async (req, res) => {
  if (req.headers.host !== HOST_HEADER) { res.writeHead(403); return res.end("bad host"); }
  const u = new URL(req.url, ORIGIN);
  if (u.pathname.startsWith("/api/")) return api(req, res, u);
  if (u.pathname === "/admin") {
    try {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(__dirname, "admin.html")));
    } catch (e) { res.writeHead(500); return res.end("admin.html missing"); }
  }
  if (u.pathname === "/title") {
    const id = u.searchParams.get("id") || "";
    if (!VID.test(id)) { res.writeHead(400); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(await getTitle(id));
  }
  const cfg = resolve(u.searchParams.get("list") || "", u.searchParams.get("ch") || "", u.searchParams.get("v") || "");
  if (cfg) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE(cfg));
  } else {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not on the study allowlist.");
  }
}).listen(8765, "127.0.0.1");
