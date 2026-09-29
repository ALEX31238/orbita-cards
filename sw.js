// Офлайн: при первом открытии всё складывается в кэш, дальше страница работает без интернета (в метро тоже).
const CACHE = "orbita-202609292139";
const ASSETS = [
    ".",
    "index.html",
    "app.css",
    "app.js",
    "deck.json",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-180.png",
    "vendor/katex/katex.min.css",
    "vendor/katex/katex.min.js",
];

// Когда версия обновилась, открытые страницы надо перезагрузить — иначе на экране останется старая колода.
let replacesOldVersion = false;

self.addEventListener("install", (event) => {
    replacesOldVersion = Boolean(self.registration.active);
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await cache.addAll(ASSETS);
            const fonts = await fetch("vendor/katex/fonts.json").then((r) => r.json()).catch(() => []);
            await Promise.all(fonts.map((name) => cache.add(`vendor/katex/fonts/${name}`).catch(() => {})));
            self.skipWaiting();
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
            await self.clients.claim();
            if (replacesOldVersion) {
                const windows = await self.clients.matchAll({ type: "window" });
                for (const client of windows) {
                    client.navigate(client.url).catch(() => {});
                }
            }
        })()
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    const name = url.pathname.split("/").pop() || "index.html";
    // Колода и код могут меняться — если сеть есть, берём свежие; шрифты и значки не меняются никогда.
    const live = event.request.mode === "navigate" || ["", "index.html", "app.js", "app.css", "deck.json", "manifest.webmanifest"].includes(name);
    event.respondWith(
        (async () => {
            if (live && url.origin === location.origin) {
                try {
                    const response = await fetch(event.request);
                    if (response.ok) {
                        const cache = await caches.open(CACHE);
                        cache.put(event.request, response.clone());
                        return response;
                    }
                } catch (error) {
                    // Интернета нет — ниже отдадим то, что лежит в кэше.
                }
            }
            const cached = await caches.match(event.request, { ignoreSearch: true });
            if (cached) return cached;
            try {
                const response = await fetch(event.request);
                if (response.ok && url.origin === location.origin) {
                    const cache = await caches.open(CACHE);
                    cache.put(event.request, response.clone());
                }
                return response;
            } catch (error) {
                const fallback = await caches.match("index.html");
                return fallback || Response.error();
            }
        })()
    );
});
