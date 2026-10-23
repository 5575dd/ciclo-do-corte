import fs from "node:fs";

const privateKey = process.env.VAPID_PRIVATE_KEY;
const subscriptionText = process.env.PUSH_SUBSCRIPTION;

if (!privateKey || !subscriptionText) {
  console.log("Notificação não configurada neste aparelho; consulta concluída normalmente.");
  process.exit(0);
}

const { default: webpush } = await import("web-push");

const config = JSON.parse(fs.readFileSync("data/push-config.json", "utf8"));
const current = JSON.parse(fs.readFileSync("data/availability.json", "utf8"));
const subscription = JSON.parse(subscriptionText);
const forceCurrent = process.env.FORCE_CURRENT === "true";

webpush.setVapidDetails(
  "https://5575dd.github.io/ciclo-do-corte/",
  config.publicKey,
  privateKey
);

if (process.env.FORCE_TEST === "true") {
  await webpush.sendNotification(subscription, JSON.stringify({
    test: true,
    changeId: "test-" + new Date().toISOString()
  }), { TTL: 60 });
  console.log("Notificação de teste enviada.");
  process.exit(0);
}

const previousPath = process.env.PREVIOUS_AVAILABILITY_FILE;
const previous = previousPath && fs.existsSync(previousPath)
  ? JSON.parse(fs.readFileSync(previousPath, "utf8"))
  : { dates: {} };

const minuteValue = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const opened = {};
for (const [date, slots] of Object.entries(current.dates || {})) {
  const oldSlots = new Set(previous.dates?.[date] || []);
  const newSlots = slots.filter((slot) => minuteValue(slot) >= 780 && (forceCurrent || !oldSlots.has(slot)));
  if (newSlots.length) opened[date] = newSlots;
}

if (!Object.keys(opened).length) {
  console.log("Nenhuma nova vaga a partir das 13h; nenhum aviso enviado.");
  process.exit(0);
}

const payload = JSON.stringify({
  availability: current,
  opened,
  changeId: forceCurrent ? "manual-" + new Date().toISOString() : (current.updatedAt || new Date().toISOString())
});

try {
  await webpush.sendNotification(subscription, payload, { TTL: 6 * 60 * 60 });
  console.log("Aviso de nova vaga enviado.");
} catch (error) {
  if (error.statusCode === 404 || error.statusCode === 410) {
    console.log("A inscrição deste aparelho expirou; é preciso ativar os avisos novamente.");
    process.exit(0);
  }
  throw error;
}
