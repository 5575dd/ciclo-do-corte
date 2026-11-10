function decodeHtml(value) {
  const named = {
    amp: "&", apos: "'", quot: '"', nbsp: " ", lt: "<", gt: ">",
    aacute: "á", acirc: "â", agrave: "à", atilde: "ã",
    ccedil: "ç", eacute: "é", ecirc: "ê", iacute: "í",
    oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú"
  };
  return value
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
      if (key[0] === "#") {
        const codePoint = key[1]?.toLowerCase() === "x"
          ? Number.parseInt(key.slice(2), 16)
          : Number.parseInt(key.slice(1), 10);
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : " ";
      }
      return named[key.toLowerCase()] ?? " ";
    });
}

function normalizeText(value) {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bookingCards(html) {
  const openingTags = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\blist-group-item\b[^"']*["'][^>]*>/gi;
  const divTags = /<\/?div\b[^>]*>/gi;
  const cards = [];
  let opening;

  while ((opening = openingTags.exec(html))) {
    divTags.lastIndex = openingTags.lastIndex;
    let depth = 1;
    let closing;
    while ((closing = divTags.exec(html))) {
      if (/^<\//.test(closing[0])) depth--;
      else depth++;
      if (depth === 0) break;
    }
    const end = closing ? closing.index + closing[0].length : html.length;
    cards.push(html.slice(opening.index, end));
    if (!closing) break;
    openingTags.lastIndex = end;
  }

  return cards;
}

export function hasOfficialBooking(html, { date, time, anyService = false, anyTime = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  if (!anyTime && !/^\d{2}:\d{2}$/.test(time || "")) return false;
  const dateBr = date.split("-").reverse().join("/");
  const dateText = normalizeText(dateBr);
  const timeText = anyTime ? "" : normalizeText(time);

  return bookingCards(String(html || "")).some((card) => {
    const text = normalizeText(card);
    if (!text.includes("profissional: igor freitas")) return false;
    if (!text.includes(dateText) || (!anyTime && !text.includes(timeText))) return false;
    if (anyService) return true;
    const datePosition = text.indexOf(dateText);
    const serviceLabel = datePosition >= 0 ? text.slice(0, datePosition) : "";
    return /(^|\s)corte(\s|\+|$)/.test(serviceLabel);
  });
}

export function extractOfficialHaircuts(html) {
  const bookings = [];
  for (const card of bookingCards(String(html || ""))) {
    const text = normalizeText(card);
    const dateMatch = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const service = dateMatch ? text.slice(0, dateMatch.index) : "";
    if (!text.includes("profissional: igor freitas") || !dateMatch || !timeMatch || !/(^|\s)corte(\s|\+|$)/.test(service)) continue;
    bookings.push({
      date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
      time: `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    });
  }
  return Object.fromEntries(bookings.map(({ date, time }) => [date, time]));
}
