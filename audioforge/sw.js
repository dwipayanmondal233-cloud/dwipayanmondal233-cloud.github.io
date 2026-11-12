const C='audioforge-v1',F=['./','index.html','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(!(u.origin===location.origin||/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(u.host)))return;
e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(n=>{if(n&&(n.ok||n.type==='opaque')){const c=n.clone();caches.open(C).then(x=>x.put(e.request,c))}return n}).catch(()=>caches.match('index.html'))))});
