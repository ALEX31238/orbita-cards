// Офлайн: при первом открытии всё складывается в кэш, дальше страница работает без интернета (в метро тоже).
const CACHE = "orbita-v1";
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

self.addEventListener("install", (event) => {
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
        })()
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    event.respondWith(
        (async () => {
            const cached = await caches.match(event.request, { ignoreSearch: true });
            if (cached) return cached;
            try {
                const response = await fetch(event.request);
                if (response.ok && new URL(event.request.url).origin === location.origin) {
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
