import { readFile } from "node:fs/promises";
import { extractOfficialHaircuts } from "./booking-confirmation.mjs";
import { parsePushSubscription } from "./push-subscription.mjs";

const phone = (process.env.BOOKING_PHONE || "").replace(/\D/g, "");
const key = process.env.VAPID_PRIVATE_KEY;
const subscription = process.env.PUSH_SUBSCRIPTION;
if (phone.length < 10 || !key || !subscription) throw new Error("A sincronização não está configurada.");

const response = await fetch(`https://bmsistemasdev.site/app/barbeariafreitas1029/meusAgendamentos.php?contato=${encodeURIComponent(phone)}`, {
  headers: { accept: "text/html" },
  signal: AbortSignal.timeout(30_000)
});
if (!response.ok) throw new Error("Não foi possível consultar os agendamentos oficiais.");
const appointments = extractOfficialHaircuts(await response.text());

const { default: webpush } = await import("web-push");
const config = JSON.parse(await readFile("data/push-config.json", "utf8"));
webpush.setVapidDetails("https://5575dd.github.io/ciclo-do-corte/", config.publicKey, key);
await webpush.sendNotification(parsePushSubscription(subscription), JSON.stringify({
  officialAppointments: appointments,
  changeId: `appointments-sync-${Date.now()}`
}), { TTL: 60 * 60 });
console.log(`Official Corte appointments found: ${Object.keys(appointments).length}; sync sent to this device.`);
