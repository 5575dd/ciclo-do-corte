import { readFile } from "node:fs/promises";

const token = process.env.BOOKING_APP_TOKEN;
const key = process.env.VAPID_PRIVATE_KEY;
const subscription = process.env.PUSH_SUBSCRIPTION;
if (!token || !key || !subscription) throw new Error("Ativação incompleta.");

const { default: webpush } = await import("web-push");
const config = JSON.parse(await readFile("data/push-config.json", "utf8"));
webpush.setVapidDetails("https://5575dd.github.io/ciclo-do-corte/", config.publicKey, key);
await webpush.sendNotification(JSON.parse(subscription), JSON.stringify({
  bookingActivationToken: token,
  changeId: `booking-activation-${Date.now()}`
}), { TTL: 60 * 60 });
console.log("Acesso à reserva direta enviado ao aplicativo.");
