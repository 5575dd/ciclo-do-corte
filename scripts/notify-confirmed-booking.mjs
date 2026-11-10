import { readFile } from "node:fs/promises";
import { parsePushSubscription } from "./push-subscription.mjs";

const date = process.env.BOOKING_DATE || "";
const time = process.env.BOOKING_TIME || "";
const requestId = process.env.BOOKING_REQUEST_ID || "";
const key = process.env.VAPID_PRIVATE_KEY;
const subscription = process.env.PUSH_SUBSCRIPTION;

if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !requestId) {
  throw new Error("Dados da confirmação inválidos.");
}
const parsedDate = new Date(`${date}T12:00:00Z`);
if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || parsedDate.getUTCDay() !== 6) {
  throw new Error("A data confirmada precisa ser um sábado válido.");
}
const [hour, minute] = time.split(":").map(Number);
if (hour < 13 || hour > 23 || minute > 59) throw new Error("O horário precisa ser a partir das 13h.");
if (!key || !subscription) throw new Error("Avisos deste aparelho não estão configurados.");

const { default: webpush } = await import("web-push");
const config = JSON.parse(await readFile("data/push-config.json", "utf8"));
webpush.setVapidDetails("https://5575dd.github.io/ciclo-do-corte/", config.publicKey, key);
await webpush.sendNotification(parsePushSubscription(subscription), JSON.stringify({
  bookingResult: { status: "booked", date, time, requestId },
  changeId: `confirmed-booking-${requestId}`
}), { TTL: 60 * 60 });
console.log("Aviso de confirmação enviado ao aparelho.");
