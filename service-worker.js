const CACHE_NAME = "ciclo-do-corte-v4";
const STATE_CACHE = "ciclo-do-corte-state-v1";
const APP_SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg", "./data/push-config.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith("ciclo-do-corte-v") && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  ]));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/data/availability.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "STATE") return;
  event.waitUntil(saveText("state.json", JSON.stringify(event.data.state)));
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-availability") event.waitUntil(checkAvailability());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data?.json() || null;
  } catch {}
  event.waitUntil(payload?.test ? showTestNotification() : checkAvailability(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(self.registration.scope));
});

async function showTestNotification() {
  await self.registration.showNotification("Teste do Ciclo do Corte", {
    body: "Tudo certo! Este celular receberá avisos quando surgir uma vaga.",
    icon: new URL("icon.svg", self.registration.scope).href,
    badge: new URL("icon.svg", self.registration.scope).href,
    tag: "haircut-test",
    renotify: true,
    data: { url: self.registration.scope }
  });
}

async function saveText(name, value) {
  const cache = await caches.open(STATE_CACHE);
  await cache.put(new Request(new URL(name, self.registration.scope)), new Response(value));
}

async function readText(name) {
  const cache = await caches.open(STATE_CACHE);
  const response = await cache.match(new Request(new URL(name, self.registration.scope)));
  return response ? response.text() : null;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function iso(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function filterPreference(slots, preference) {
  if (preference === "A partir das 13h") return slots.filter((slot) => minutes(slot) >= 780);
  if (preference === "Manhã") return slots.filter((slot) => minutes(slot) < 720);
  if (preference === "Depois das 12h") return slots.filter((slot) => minutes(slot) >= 720);
  if (preference === "Fim da tarde") return slots.filter((slot) => minutes(slot) >= 960);
  return slots;
}

async function checkAvailability(payload = null) {
  const rawState = await readText("state.json");
  if (!rawState) return;
  const state = JSON.parse(rawState);
  if (state.paused) return;

  let availability = payload?.availability || null;
  if (!availability) {
    const dataUrl = new URL("data/availability.json?ts=" + Date.now(), self.registration.scope);
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok) return;
    availability = await response.json();
  }
  const sourceDates = payload?.opened || availability.dates || {};
  const dates = [state.anchor, addDays(state.anchor, 7), addDays(state.anchor, 14)];
  const matches = [];

  for (const date of dates) {
    if (state.appointments?.[date]) continue;
    const slots = filterPreference(sourceDates[date] || [], state.preference);
    if (slots.length) matches.push({ date, slots });
  }

  if (!matches.length) return;
  const notificationKey = JSON.stringify({ matches, changeId: payload?.changeId || null });
  if (notificationKey === await readText("last-notification.txt")) return;
  await saveText("last-notification.txt", notificationKey);

  const first = matches[0];
  await self.registration.showNotification("Horário disponível para corte", {
    body: first.date.split("-").reverse().join("/") + ": " + first.slots.join(", "),
    icon: new URL("icon.svg", self.registration.scope).href,
    badge: new URL("icon.svg", self.registration.scope).href,
    tag: "haircut-availability",
    renotify: true,
    data: { url: self.registration.scope }
  });
}
