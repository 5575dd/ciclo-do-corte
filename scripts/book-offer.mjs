import { writeFile } from "node:fs/promises";

const SHOP = "https://bmsistemasdev.site/app/barbeariafreitas1029/";
const API = "https://bmsistemasdev.site/app/API/horariosLivres.php";
const PROFESSIONAL = "387";
const SERVICE = "924";
const DURATION = "28";
const SHOP_ID = "1029";
const date = process.env.BOOKING_DATE || "";
const time = process.env.BOOKING_TIME || "";
const requestId = process.env.BOOKING_REQUEST_ID || "";
const name = (process.env.BOOKING_NAME || "").trim();
const phone = (process.env.BOOKING_PHONE || "").replace(/\D/g, "");
const dryRun = process.env.DRY_RUN === "true";
const resultPath = process.env.BOOKING_RESULT_FILE;

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function asUtcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function validateRequest() {
  const target = asUtcDay(date);
  const today = asUtcDay(todayInSaoPaulo());
  if (!target || !today || target.getUTCDay() !== 6) throw new Error("invalid_date");
  const daysAhead = Math.round((target - today) / 86_400_000);
  if (daysAhead < 0 || daysAhead > 30) throw new Error("outside_booking_window");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("invalid_time");
  const [hour, minute] = time.split(":").map(Number);
  if (hour < 13 || hour > 23 || minute > 59) throw new Error("outside_preference");
  if (!dryRun && (!name || phone.length < 10 || phone.length > 15)) throw new Error("missing_client_details");
}

async function get(url, cookie = "") {
  const response = await fetch(url, {
    headers: { accept: "text/html,application/json", ...(cookie ? { cookie } : {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("official_site_unavailable");
  return response;
}

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

function decodeAttribute(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#039;", "'");
}

function hiddenFields(html) {
  const fields = new Map();
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = new Map();
    for (const [, key, value] of tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
      attributes.set(key.toLowerCase(), decodeAttribute(value));
    }
    if (attributes.get("type") === "hidden" && attributes.has("name")) {
      fields.set(attributes.get("name"), attributes.get("value") || "");
    }
  }
  return fields;
}

async function officialBookings() {
  if (!phone) return "";
  const response = await get(`${SHOP}meusAgendamentos.php?contato=${encodeURIComponent(phone)}`);
  return response.text();
}

function hasBooking(html, { anyService = false } = {}) {
  const dateBr = date.split("-").reverse().join("/");
  const escaped = `${dateBr} às ${time}`;
  const blocks = html.split(/<div\s+class="list-group-item\b/gi).slice(1);
  return blocks.some((block) => {
    const part = block.slice(0, 800);
    return part.includes(escaped) && part.includes("Profissional: Igor Freitas")
      && (anyService || /<strong>\s*Corte\s*<\/strong>/i.test(part));
  });
}

async function availableSlots() {
  const url = new URL(API);
  url.searchParams.set("profissional", PROFESSIONAL);
  url.searchParams.set("id_assinante", SHOP_ID);
  url.searchParams.set("data", date);
  url.searchParams.set("duracao", DURATION);
  const response = await get(url);
  const body = await response.json();
  const raw = body?.HorariosLivres;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split("|").map((slot) => slot.trim()).filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).map(String);
  throw new Error("invalid_availability_response");
}

async function prepareOfficialForm() {
  const first = await get(`${SHOP}index.php`);
  const cookie = cookieFrom(first);
  if (!cookie) throw new Error("missing_booking_session");
  await get(`${SHOP}profissional.php?data=${encodeURIComponent(date)}`, cookie);
  await get(`${SHOP}servico.php?profissional=${PROFESSIONAL}`, cookie);
  const response = await get(`${SHOP}horario.php?servicos%5B%5D=${SERVICE}&duracao=${DURATION}`, cookie);
  const html = await response.text();
  if (!html.includes('id="form-horarios"') || !html.includes('action="insertAPI.php"')) {
    throw new Error("booking_form_changed");
  }
  const fields = hiddenFields(html);
  for (const [key, expected] of Object.entries({
    data: date, profissional: PROFESSIONAL, "servicos[]": SERVICE,
    duracao: DURATION, id_assinante: SHOP_ID
  })) {
    if (fields.get(key) !== expected) throw new Error("booking_form_changed");
  }
  if (!fields.get("csrf_token")) throw new Error("missing_booking_validation");
  return { cookie, fields };
}

async function saveResult(status) {
  if (resultPath) await writeFile(resultPath, JSON.stringify({ status, date, time, requestId }) + "\n", "utf8");
  console.log(`BOOKING_RESULT=${status}`);
}

try {
  validateRequest();
  if (!dryRun) {
    const before = await officialBookings();
    if (hasBooking(before)) {
      await saveResult("already_booked");
      process.exit(0);
    }
    if (hasBooking(before, { anyService: true })) throw new Error("time_already_booked");
  }

  const { cookie, fields } = await prepareOfficialForm();
  const slots = await availableSlots();
  if (!slots.includes(time)) throw new Error("slot_unavailable");
  if (dryRun) {
    await saveResult("ready_without_booking");
    process.exit(0);
  }

  const body = new URLSearchParams();
  for (const key of ["data", "profissional", "servicos[]", "duracao", "id_assinante", "csrf_token"]) {
    body.append(key, fields.get(key));
  }
  body.set("horario", time);
  body.set("nome", name);
  body.set("contato", phone);
  body.set("email", "");
  const response = await fetch(`${SHOP}insertAPI.php`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: new URL(SHOP).origin,
      referer: `${SHOP}horario.php`,
      cookie
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000)
  });
  if (response.status >= 500) throw new Error("official_site_unavailable");

  for (let attempt = 0; attempt < 3; attempt++) {
    const after = await officialBookings();
    if (hasBooking(after)) {
      await saveResult("booked");
      process.exit(0);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("booking_not_verified");
} catch (error) {
  if (dryRun) console.error(`DRY_RUN_ERROR=${error?.message || "unknown"}`);
  const allowed = new Set([
    "invalid_date", "outside_booking_window", "invalid_time", "outside_preference",
    "missing_client_details", "official_site_unavailable", "invalid_availability_response",
    "missing_booking_session", "booking_form_changed", "missing_booking_validation",
    "time_already_booked", "slot_unavailable", "booking_not_verified"
  ]);
  const code = allowed.has(error?.message) ? error.message : "unexpected_error";
  await saveResult(code);
  process.exitCode = 1;
}
