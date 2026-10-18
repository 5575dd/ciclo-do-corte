import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const subscriberId = "1029";
const professionalId = "387";
const projectRoot = resolve(import.meta.dirname, "..");

function iso(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

async function slotsFor(date) {
  const params = new URLSearchParams({
    id_assinante: subscriberId,
    profissional: professionalId,
    data: date,
    ts: String(Date.now())
  });
  const source = "http://bmsistemasdev.site/app/API/horariosLivres.php?" + params.toString();
  const proxy = "https://r.jina.ai/" + source.replaceAll("&", "%26");

  try {
    const response = await fetch(proxy, {
      headers: { accept: "text/plain", "x-no-cache": "true" },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error("Proxy request failed with " + response.status);
    const text = await response.text();
    const match = text.match(/\{"HorariosLivres"\s*:\s*\[[^\]]*\]\}/);
    if (!match) throw new Error("Availability data not found in proxy response");
    const payload = JSON.parse(match[0]);
    return Array.isArray(payload.HorariosLivres) ? payload.HorariosLivres : [];
  } catch (proxyError) {
    const endpoint = new URL(source.replace("http://", "https://"));
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error("Availability request failed for " + date, { cause: proxyError });
    const payload = await response.json();
    return Array.isArray(payload.HorariosLivres) ? payload.HorariosLivres : [];
  }
}

const start = new Date();
start.setHours(12, 0, 0, 0);
const end = new Date(start);
end.setDate(end.getDate() + 30);
const dates = {};

for (let offset = 0; offset <= 30; offset += 1) {
  const date = new Date(start);
  date.setDate(start.getDate() + offset);
  if (date.getDay() !== 6) continue;
  const value = iso(date);
  dates[value] = await slotsFor(value);
}

const output = {
  updatedAt: new Date().toISOString(),
  windowEnd: iso(end),
  dates
};

await mkdir(resolve(projectRoot, "data"), { recursive: true });
await writeFile(resolve(projectRoot, "data/availability.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
console.log("Availability updated for " + Object.keys(dates).length + " Saturdays.");
