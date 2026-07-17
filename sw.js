/* 星空メモ Service Worker — オフライン起動・キャッシュ・リマインダー通知 */
const VER = "hoshizora-v4";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
/* キャッシュ優先 → ネット → ナビゲーションはindex.htmlへフォールバック（完全オフライン起動） */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" }).then(hit =>
      hit || fetch(e.request).then(res => {
        const cp = res.clone();
        caches.open(VER).then(c => c.put(e.request, cp));
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});

/* リマインダー：アプリのIndexedDBを直接読んで、期限が来た⏰を通知
   （periodic background sync — インストール済みPWA・Chrome系のみ・OS任せの目安間隔） */
function idbGetState() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open("hoshizora", 1);
    rq.onsuccess = () => {
      try {
        const g = rq.result.transaction("kv").objectStore("kv").get("state");
        g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
      } catch (e) { rej(e); }
    };
    rq.onerror = () => rej(rq.error);
  });
}
async function checkReminders() {
  try {
    const st = await idbGetState();
    if (!st || !st.notes) return;
    const now = Date.now();
    const re = /⏰\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g;
    for (const n of st.notes) {
      const txt = (n.title || "") + " " + (n.blocks || []).map(b => b.md || "").join(" ");
      let m;
      while ((m = re.exec(txt))) {
        const d = new Date(); d.setMonth(+m[1] - 1, +m[2]); d.setHours(+m[3], +m[4], 0, 0);
        const key = n.id + ":" + m[0];
        if (+d <= now && now - +d < 12 * 3600 * 1000 && !((st.remFired || {})[key])) {
          self.registration.showNotification("⏰ " + (n.title || "星空メモ"), {
            body: m[0].replace("⏰", "").trim() + " のリマインダー",
            icon: "./icon-192.png", badge: "./icon-192.png", tag: key,
          });
        }
      }
    }
  } catch (e) {}
}
self.addEventListener("periodicsync", e => { if (e.tag === "rem-check") e.waitUntil(checkReminders()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(ws => ws.length ? ws[0].focus() : self.clients.openWindow("./")));
});
