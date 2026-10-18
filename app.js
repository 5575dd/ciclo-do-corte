(function () {
  const KEY = "ciclo-do-corte-mobile-v1";
  const DEFAULT_STATE = {
    anchor: "2026-10-31",
    preference: "Qualquer horário",
    phone: "",
    paused: false,
    history: [],
    appointments: {
      "2026-10-31": "16:30",
      "2026-11-14": "16:30"
    }
  };

  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const shortMonths = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const weekdays = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  let availability = { updatedAt: null, windowEnd: null, dates: {} };
  let installPrompt = null;
  let state;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    state = { ...DEFAULT_STATE, ...saved, appointments: { ...DEFAULT_STATE.appointments, ...(saved.appointments || {}) } };
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }

  function importPhoneFromPersonalLink() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const phone = (params.get("phone") || "").replace(/\D/g, "");

    if (phone.length >= 10 && phone.length <= 15) {
      state.phone = phone;
      localStorage.setItem(KEY, JSON.stringify(state));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  importPhoneFromPersonalLink();

  function parseDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function iso(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function addDays(value, days) {
    const date = parseDate(value);
    date.setDate(date.getDate() + days);
    return iso(date);
  }

  function longDate(value) {
    const date = parseDate(value);
    return date.getDate() + " de " + months[date.getMonth()];
  }

  function dayName(value) {
    return weekdays[parseDate(value).getDay()];
  }

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(state));
    syncWorker();
  }

  function toast(message) {
    const element = document.getElementById("toast");
    element.textContent = message;
    element.classList.add("show");
    setTimeout(() => element.classList.remove("show"), 2200);
  }

  function notice(html) {
    const element = document.getElementById("notice");
    element.innerHTML = html;
    element.classList.add("show");
  }

  function minuteValue(time) {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  }

  function preferredSlots(slots) {
    if (state.preference === "Manhã") return slots.filter((slot) => minuteValue(slot) < 720);
    if (state.preference === "Depois das 12h") return slots.filter((slot) => minuteValue(slot) >= 720);
    if (state.preference === "Fim da tarde") return slots.filter((slot) => minuteValue(slot) >= 960);
    return slots;
  }

  function renderAvailability(date, elementId) {
    const element = document.getElementById(elementId);
    const bookedTime = state.appointments[date];
    if (bookedTime) {
      element.className = "availability good";
      element.textContent = "Já marcado às " + bookedTime + ".";
      return;
    }
    if (state.paused) {
      element.className = "availability wait";
      element.textContent = "Monitoramento pausado.";
      return;
    }
    if (availability.windowEnd && date > availability.windowEnd) {
      element.className = "availability wait";
      element.textContent = "Ainda fora da janela de 30 dias.";
      return;
    }
    if (!Object.hasOwn(availability.dates || {}, date)) {
      element.className = "availability";
      element.textContent = "Aguardando a próxima atualização.";
      return;
    }
    const slots = preferredSlots(availability.dates[date] || []);
    if (slots.length) {
      element.className = "availability good";
      element.textContent = "Disponível: " + slots.join(", ");
    } else {
      element.className = "availability";
      element.textContent = "Sem horários livres agora.";
    }
  }

  function render() {
    const backup = addDays(state.anchor, 7);
    const regular = addDays(state.anchor, 14);
    const anchorDate = parseDate(state.anchor);
    document.getElementById("heroDate").firstChild.nodeValue = anchorDate.getDate() + " " + shortMonths[anchorDate.getMonth()];
    document.getElementById("heroDetail").textContent = dayName(state.anchor) + " · Corte · Igor Freitas";
    document.getElementById("mainDate").textContent = longDate(state.anchor);
    document.getElementById("mainDow").textContent = dayName(state.anchor);
    document.getElementById("backupDate").textContent = longDate(backup);
    document.getElementById("backupDow").textContent = dayName(backup);
    document.getElementById("regularDate").textContent = longDate(regular);
    document.getElementById("regularDow").textContent = dayName(regular);
    document.getElementById("preferenceLabel").textContent = state.preference;
    document.getElementById("anchorInput").value = state.anchor;
    document.getElementById("preferenceInput").value = state.preference;
    document.getElementById("phoneInput").value = state.phone;

    const status = document.getElementById("status");
    status.classList.toggle("paused", state.paused);
    status.lastElementChild.textContent = state.paused ? "Monitoramento pausado" : "Atualização automática · 6h";
    document.getElementById("pause").textContent = state.paused ? "Retomar monitoramento" : "Pausar monitoramento";

    renderAvailability(state.anchor, "mainAvailability");
    renderAvailability(backup, "backupAvailability");
    renderAvailability(regular, "regularAvailability");
  }

  async function refreshAvailability(showFeedback) {
    try {
      const response = await fetch("data/availability.json?ts=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("availability unavailable");
      availability = await response.json();
      render();
      if (showFeedback) toast("Horários atualizados.");
    } catch {
      render();
      if (showFeedback) toast("A atualização ainda não está disponível.");
    }
  }

  async function syncWorker() {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: "STATE", state });
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("service-worker.js");
      await syncWorker();
    } catch {
      notice("O navegador não conseguiu ativar o modo aplicativo. O painel ainda funciona normalmente quando aberto.");
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      notice("Este navegador não oferece avisos em segundo plano. Você ainda pode instalar o painel e abri-lo normalmente.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notice("Os avisos não foram autorizados. Você pode alterar essa permissão nas configurações do navegador.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    if ("periodicSync" in registration) {
      try {
        await registration.periodicSync.register("check-availability", { minInterval: 12 * 60 * 60 * 1000 });
        toast("Avisos ativados no celular.");
      } catch {
        notice("Os avisos foram permitidos, mas o celular decidirá quando verificar em segundo plano. Instalar o painel na tela inicial melhora o funcionamento.");
      }
    } else {
      notice("Os avisos foram permitidos. Neste celular, a consulta em segundo plano pode depender de você abrir o painel de vez em quando.");
    }
  }

  document.getElementById("didCut").addEventListener("click", () => {
    const oldAnchor = state.anchor;
    if (!confirm("Confirmar que você cortou o cabelo em " + longDate(oldAnchor) + "?")) return;
    state.history.unshift({ date: oldAnchor, result: "cut" });
    delete state.appointments[oldAnchor];
    state.anchor = addDays(oldAnchor, 14);
    persist();
    render();
    notice("Ciclo avançado. A próxima data principal é <strong>" + longDate(state.anchor) + "</strong>. Se havia uma reserva para " + longDate(addDays(oldAnchor, 7)) + ", use “Ver ou desmarcar” para cancelá-la no sistema oficial.");
    toast("Corte confirmado e ciclo avançado.");
  });

  document.getElementById("missed").addEventListener("click", () => {
    const oldAnchor = state.anchor;
    if (!confirm("Confirmar que você não conseguiu cortar em " + longDate(oldAnchor) + "?")) return;
    state.history.unshift({ date: oldAnchor, result: "missed" });
    delete state.appointments[oldAnchor];
    state.anchor = addDays(oldAnchor, 7);
    persist();
    render();
    notice("A reserva de segurança virou a data principal: <strong>" + longDate(state.anchor) + "</strong>.");
    toast("Reserva de segurança assumiu o ciclo.");
  });

  document.getElementById("refresh").addEventListener("click", () => refreshAvailability(true));
  document.getElementById("save").addEventListener("click", () => {
    const date = document.getElementById("anchorInput").value;
    const phone = document.getElementById("phoneInput").value.replace(/\D/g, "");
    if (!date) return;
    if (phone && phone.length < 10) {
      toast("Confira o telefone com DDD.");
      return;
    }
    state.anchor = date;
    state.preference = document.getElementById("preferenceInput").value;
    state.phone = phone;
    persist();
    render();
    toast("Preferências salvas neste aparelho.");
  });

  document.getElementById("pause").addEventListener("click", () => {
    state.paused = !state.paused;
    persist();
    render();
    notice(state.paused ? "O monitoramento deste aparelho está pausado." : "O monitoramento foi retomado.");
  });

  document.getElementById("appointments").addEventListener("click", () => {
    if (!state.phone) {
      document.querySelector("details").open = true;
      document.getElementById("phoneInput").focus();
      notice("Informe seu telefone uma vez e toque em “Salvar preferências”. Ele ficará somente neste aparelho.");
      return;
    }
    const url = "https://bmsistemasdev.site/app/barbeariafreitas1029/meusAgendamentos.php?contato=" + encodeURIComponent(state.phone);
    window.open(url, "_blank", "noopener,noreferrer");
  });

  document.getElementById("notifications").addEventListener("click", enableNotifications);
  document.getElementById("install").addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else {
      notice("No iPhone, use Compartilhar → Adicionar à Tela de Início. No Android, abra o menu do navegador → Instalar aplicativo.");
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  render();
  registerServiceWorker();
  refreshAvailability(false);
}());
