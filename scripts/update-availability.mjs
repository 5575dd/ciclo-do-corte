import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const subscriberId = "1029";
const professionalId = "387";
const projectRoot = resolve(import.meta.dirname, "..");

function iso(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

async function slotsFor(date) {
  const endpoint = new URL("https://bmsistemasdev.site/app/API/horariosLivres.php");
  endpoint.searchParams.set("id_assinante", subscriberId);
  endpoint.searchParams.set("profissional", professionalId);
  endpoint.searchParams.set("data", date);
  const response = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Availability request failed for " + date);
  const payload = await response.json();
  return Array.isArray(payload.HorariosLivres) ? payload.HorariosLivres : [];
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
