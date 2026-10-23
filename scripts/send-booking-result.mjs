import { readFile } from "node:fs/promises";

if (process.env.DRY_RUN === "true") process.exit(0);
const key = process.env.VAPID_PRIVATE_KEY;
const subscriptionText = process.env.PUSH_SUBSCRIPTION;
if (!key || !subscriptionText) process.exit(0);

const resultPath = process.env.BOOKING_RESULT_FILE;
let result = {
  status: "unexpected_error", date: process.env.BOOKING_DATE,
  time: process.env.BOOKING_TIME, requestId: process.env.BOOKING_REQUEST_ID
};
try {
  result = JSON.parse(await readFile(resultPath, "utf8"));
} catch {}

const { default: webpush } = await import("web-push");
const config = JSON.parse(await readFile("data/push-config.json", "utf8"));
webpush.setVapidDetails("https://5575dd.github.io/ciclo-do-corte/", config.publicKey, key);
try {
  await webpush.sendNotification(JSON.parse(subscriptionText), JSON.stringify({
    bookingResult: result,
    changeId: `booking-${Date.now()}`
  }), { TTL: 60 * 60 });
  console.log("Resultado da reserva enviado ao aplicativo.");
} catch {
  console.log("Não foi possível enviar o aviso de resultado; a reserva deve ser consultada no aplicativo.");
}
