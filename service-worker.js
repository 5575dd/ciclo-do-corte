const CACHE_NAME = "ciclo-do-corte-v6";
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
  if (event.data?.type === "STATE") {
    event.waitUntil(saveText("state.json", JSON.stringify(event.data.state)));
    return;
  }
  if (event.data?.type === "BOOK_OFFER") {
    event.waitUntil(replyTo(event, () => dispatchBooking(event.data)));
    return;
  }
  if (event.data?.type === "BOOKING_STATUS") {
    event.waitUntil(replyTo(event, () => bookingStatus(event.data.requestId)));
    return;
  }
  if (event.data?.type === "BOOKING_SETUP") {
    event.waitUntil(replyTo(event, async () => ({ ready: Boolean(await readText("booking-token.txt")) })));
    return;
  }
  if (event.data?.type === "BOOKING_RESULT") {
    event.waitUntil(replyTo(event, async () => JSON.parse(await readText("booking-result.json") || "null")));
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-availability") event.waitUntil(checkAvailability());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data?.json() || null;
  } catch {}
  if (payload?.bookingActivationToken) {
    event.waitUntil(activateBooking(payload.bookingActivationToken));
  } else if (payload?.bookingResult) {
    event.waitUntil(showBookingResult(payload.bookingResult));
  } else {
    event.waitUntil(payload?.test ? showTestNotification() : checkAvailability(payload));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.registration.scope;
  event.waitUntil(openApp(targetUrl));
});

async function openApp(targetUrl) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const appWindow = windows.find((client) => client.url.startsWith(self.registration.scope));
  if (appWindow) {
    await appWindow.navigate(targetUrl);
    return appWindow.focus();
  }
  return self.clients.openWindow(targetUrl);
}

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

async function replyTo(event, callback) {
  const port = event.ports?.[0];
  if (!port) return;
  try {
    port.postMessage(await callback());
  } catch {
    port.postMessage({ ok: false, error: "connection_failed" });
  }
}

async function githubRequest(path, options = {}) {
  const token = await readText("booking-token.txt");
  if (!token) return { missingToken: true };
  const response = await fetch("https://api.github.com/repos/5575dd/ciclo-do-corte/" + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28",
      ...(options.body ? { "content-type": "application/json" } : {})
    }
  });
  return { response };
}

async function dispatchBooking({ date, time, requestId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
      !/^\d{2}:\d{2}$/.test(time || "") ||
      !/^[0-9a-f-]{36}$/.test(requestId || "")) return { ok: false, error: "invalid_offer" };
  const { response, missingToken } = await githubRequest("actions/workflows/book-haircut.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { date, time, request_id: requestId, dry_run: "false" } })
  });
  if (missingToken) return { ok: false, error: "booking_not_activated" };
  return response.status === 204
    ? { ok: true }
    : { ok: false, error: response.status === 401 || response.status === 403 ? "booking_access_expired" : "booking_request_failed" };
}

async function bookingStatus(requestId) {
  if (!/^[0-9a-f-]{36}$/.test(requestId || "")) return { ok: false, error: "invalid_request" };
  const { response, missingToken } = await githubRequest("actions/workflows/book-haircut.yml/runs?event=workflow_dispatch&per_page=30");
  if (missingToken) return { ok: false, error: "booking_not_activated" };
  if (!response.ok) return { ok: false, error: "status_unavailable" };
  const payload = await response.json();
  const run = payload.workflow_runs?.find((item) => item.display_title?.includes(requestId));
  return { ok: true, status: run?.status || "queued", conclusion: run?.conclusion || null };
}

async function activateBooking(token) {
  if (typeof token !== "string" || token.length < 20) return;
  await saveText("booking-token.txt", token);
  await self.registration.showNotification("Reserva direta ativada", {
    body: "Agora você pode tocar em Confirmar no Ciclo do Corte para reservar o horário.",
    icon: new URL("icon.svg", self.registration.scope).href,
    badge: new URL("icon.svg", self.registration.scope).href,
    tag: "haircut-booking-activation",
    data: { url: self.registration.scope }
  });
}

async function showBookingResult(result) {
  if (!result || !/^\d{4}-\d{2}-\d{2}$/.test(result.date || "") || !/^\d{2}:\d{2}$/.test(result.time || "")) return;
  await saveText("booking-result.json", JSON.stringify(result));
  const booked = result.status === "booked" || result.status === "already_booked";
  await self.registration.showNotification(booked ? "Corte marcado" : "Reserva não concluída", {
    body: booked
      ? result.date.split("-").reverse().join("/") + " às " + result.time + " com Igor. Toque para ver no app."
      : "A vaga não foi confirmada na barbearia. Abra o app para tentar outra opção.",
    icon: new URL("icon.svg", self.registration.scope).href,
    badge: new URL("icon.svg", self.registration.scope).href,
    tag: "haircut-booking-result",
    renotify: true,
    data: { url: self.registration.scope }
  });
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "BOOKING_RESULT", result });
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
  const dates = [0, 7, 14, 21, 28].map((offset) => addDays(state.anchor, offset));
  const matches = [];

  for (const date of dates) {
    if (state.appointments?.[date]) continue;
    if (state.pendingOffer?.date === date) continue;
    const slots = filterPreference(sourceDates[date] || [], state.preference).sort((a, b) => minutes(a) - minutes(b));
    if (slots.length) matches.push({ date, slots });
  }

  if (!matches.length) return;
  const notificationKey = JSON.stringify({ matches, changeId: payload?.changeId || null });
  if (notificationKey === await readText("last-notification.txt")) return;
  await saveText("last-notification.txt", notificationKey);

  const first = matches[0];
  const offerUrl = new URL("./", self.registration.scope);
  offerUrl.searchParams.set("offerDate", first.date);
  offerUrl.searchParams.set("offerTime", first.slots[0]);
  await self.registration.showNotification("Horário disponível para corte", {
    body: first.date.split("-").reverse().join("/") + " às " + first.slots[0] + ". Toque para confirmar no app.",
    icon: new URL("icon.svg", self.registration.scope).href,
    badge: new URL("icon.svg", self.registration.scope).href,
    tag: "haircut-availability",
    renotify: true,
    actions: [{ action: "confirm", title: "Confirmar no app" }],
    data: { url: offerUrl.href, date: first.date, time: first.slots[0] }
  });
}
