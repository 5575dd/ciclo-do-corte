export function parsePushSubscription(value) {
  const input = value?.trim();
  if (!input) throw new Error("Inscrição de avisos ausente.");

  // The app's “Copiar código” exports the subscription as base64url JSON;
  // older/manual setups may still provide the raw JSON object.
  const json = input.startsWith("{")
    ? input
    : Buffer.from(input, "base64url").toString("utf8");
  const subscription = JSON.parse(json);
  if (typeof subscription.endpoint !== "string" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error("Inscrição de avisos inválida.");
  }
  return subscription;
}
