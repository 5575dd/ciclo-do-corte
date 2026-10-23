(function () {
  const KEY = "ciclo-do-corte-mobile-v1";
  const DEFAULT_STATE = {
    anchor: "2026-10-31",
    preference: "A partir das 13h",
    settingsVersion: 2,
    phone: "",
    paused: false,
    history: [],
    pendingOffer: null,
    dismissedOffers: [],
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
  let currentOffer = null;
  let bookingPollTimer = null;
  let state;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    state = { ...DEFAULT_STATE, ...saved, appointments: saved.appointments || { ...DEFAULT_STATE.appointments } };
    if (!Array.isArray(state.dismissedOffers)) state.dismissedOffers = [];
    if ((saved.settingsVersion || 0) < 2) {
      state.preference = "A partir das 13h";
      state.settingsVersion = 2;
      localStorage.setItem(KEY, JSON.stringify(state));
    }
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

  function base64UrlFromBytes(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function bytesFromBase64Url(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  }

  async function showActivationCode(subscription) {
    const code = base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(subscription.toJSON())));
    localStorage.setItem("ciclo-do-corte-push-code", code);
    const element = document.getElementById("notice");
    element.innerHTML = "<strong>Último passo:</strong> copie o código abaixo e envie nesta conversa uma única vez. Depois disso, os avisos chegam mesmo com o painel fechado.<div class=\"activation\"><textarea id=\"activationCode\" readonly aria-label=\"Código de ativação\"></textarea><button class=\"btn primary\" type=\"button\" id=\"copyActivation\">Copiar código</button></div>";
    element.classList.add("show");
    document.getElementById("activationCode").value = code;
    document.getElementById("copyActivation").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast("Código copiado. Envie nesta conversa.");
      } catch {
        document.getElementById("activationCode").select();
        document.execCommand("copy");
        toast("Código copiado. Envie nesta conversa.");
      }
    });
  }

  function minuteValue(time) {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  }

  function preferredSlots(slots) {
    if (state.preference === "A partir das 13h") return slots.filter((slot) => minuteValue(slot) >= 780);
    if (state.preference === "Manhã") return slots.filter((slot) => minuteValue(slot) < 720);
    if (state.preference === "Depois das 12h") return slots.filter((slot) => minuteValue(slot) >= 720);
    if (state.preference === "Fim da tarde") return slots.filter((slot) => minuteValue(slot) >= 960);
    return slots;
  }

  function validOffer(date, time) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && /^\d{2}:\d{2}$/.test(time || "");
  }

  function offerKey(offer) {
    return offer.date + "@" + offer.time;
  }

  function offerFromLocation() {
    const url = new URL(window.location.href);
    const date = url.searchParams.get("offerDate");
    const time = url.searchParams.get("offerTime");
    if (!validOffer(date, time)) return null;
    url.searchParams.delete("offerDate");
    url.searchParams.delete("offerTime");
    history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    return { date, time };
  }

  function showOffer(offer, pending = false) {
    if (!offer || !validOffer(offer.date, offer.time) || state.appointments[offer.date]) return;
    currentOffer = offer;
    const element = document.getElementById("offer");
    document.getElementById("offerKicker").textContent = pending
      ? (offer.status === "needs_check" ? "Confira o agendamento" : "Reserva em andamento")
      : "Vaga encontrada";
    document.getElementById("offerTitle").textContent = longDate(offer.date) + " às " + offer.time;
    document.getElementById("offerText").textContent = pending
      ? (offer.status === "needs_check"
        ? "Não foi possível confirmar o resultado. Consulte seus agendamentos antes de tentar novamente."
        : "Enviamos sua confirmação. O aplicativo mostrará o resultado após conferir a agenda da barbearia.")
      : "Toque para reservar este corte com Igor. O aplicativo conferirá a vaga e mostrará o resultado.";
    document.getElementById("confirmOffer").hidden = pending;
    document.getElementById("dismissOffer").hidden = pending;
    element.classList.add("show");
  }

  function hideOffer() {
    currentOffer = null;
    document.getElementById("offer").classList.remove("show");
  }

  function bestAvailableOffer() {
    const today = iso(new Date());
    for (const offset of [0, 7, 14, 21, 28]) {
      const date = addDays(state.anchor, offset);
      if (date < today || state.appointments[date]) continue;
      if (availability.windowEnd && date > availability.windowEnd) continue;
      const slots = preferredSlots(availability.dates?.[date] || []).sort((a, b) => minuteValue(a) - minuteValue(b));
      for (const time of slots) {
        const offer = { date, time };
        if (!state.dismissedOffers.includes(offerKey(offer))) return offer;
      }
    }
    return null;
  }

  function renderOffer() {
    if (state.pendingOffer && validOffer(state.pendingOffer.date, state.pendingOffer.time) && !state.appointments[state.pendingOffer.date]) {
      showOffer(state.pendingOffer, true);
      return;
    }
    const offer = bestAvailableOffer();
    if (offer) showOffer(offer);
    else hideOffer();
  }

  async function workerRequest(type, data = {}) {
    if (!("serviceWorker" in navigator)) throw new Error("worker_unavailable");
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || navigator.serviceWorker.controller;
    if (!worker) throw new Error("worker_unavailable");
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error("worker_timeout")), 20_000);
      channel.port1.onmessage = ({ data: answer }) => {
        clearTimeout(timeout);
        resolve(answer);
      };
      worker.postMessage({ type, ...data }, [channel.port2]);
    });
  }

  async function refreshBookingSetup() {
    const element = document.getElementById("bookingActivationStatus");
    try {
      const setup = await workerRequest("BOOKING_SETUP");
      element.textContent = setup?.ready
        ? "✓ Reserva direta ativa neste aparelho. Ao confirmar uma vaga, o aplicativo fará a marcação e conferirá o resultado."
        : "Reserva direta ainda não ativada neste aparelho. Abra o aviso de ativação quando ele chegar.";
    } catch {
      element.textContent = "Não foi possível verificar a ativação agora. Reabra o aplicativo com internet.";
    }
  }

  async function refreshPushDiagnostics() {
    const element = document.getElementById("pushDiagnostics");
    try {
      const result = await workerRequest("PUSH_DIAGNOSTICS");
      if (!result?.receivedAt) {
        element.textContent = "Nenhum aviso recebido por esta versão do aplicativo ainda.";
        return;
      }
      const time = new Date(result.receivedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      const labels = {
        shown: "exibido", received: "recebido", "no-app-state": "aguardando sincronização",
        paused: "monitoramento pausado", "data-unavailable": "consulta indisponível",
        "no-match": "sem vaga para o ciclo salvo", "already-notified": "aviso já mostrado", error: "falha ao exibir"
      };
      element.textContent = "Último aviso no aparelho: " + time + " · " + (labels[result.status] || result.status) + ".";
    } catch {
      element.textContent = "Não foi possível verificar o último aviso neste aparelho.";
    }
  }

  function applyBookingResult(result) {
    if (!result || !validOffer(result.date, result.time) || !result.requestId) return;
    if (state.lastBookingResultId === result.requestId) return;
    const samePending = state.pendingOffer?.requestId === result.requestId;
    const booked = result.status === "booked" || result.status === "already_booked";
    if (booked) {
      state.appointments[result.date] = result.time;
      if (samePending) state.pendingOffer = null;
      state.dismissedOffers = state.dismissedOffers.filter((key) => key !== offerKey(result));
      state.lastBookingResultId = result.requestId;
      persist();
      hideOffer();
      render();
      notice("Corte confirmado pela barbearia: <strong>" + longDate(result.date) + " às " + result.time + "</strong> com Igor.");
      toast("Agendamento confirmado.");
      return;
    }
    if (!samePending) return;
    state.lastBookingResultId = result.requestId;
    if (result.status === "booking_not_verified" || result.status === "unexpected_error") {
      state.pendingOffer.status = "needs_check";
      persist();
      showOffer(state.pendingOffer, true);
      notice("A barbearia não confirmou o resultado da tentativa. Verifique em “Meus agendamentos” antes de tentar de novo.");
      return;
    }
    const failedOffer = { ...state.pendingOffer };
    state.pendingOffer = null;
    state.dismissedOffers = [offerKey(failedOffer), ...state.dismissedOffers].slice(0, 30);
    persist();
    hideOffer();
    renderOffer();
    notice("A reserva de " + longDate(result.date) + " às " + result.time + " não foi concluída. Atualize os horários para escolher outra vaga.");
  }

  async function checkBookingProgress() {
    if (!state.pendingOffer?.requestId || state.pendingOffer.status === "needs_check") return;
    try {
      const savedResult = await workerRequest("BOOKING_RESULT");
      if (savedResult?.requestId === state.pendingOffer.requestId) {
        applyBookingResult(savedResult);
        return;
      }
      const progress = await workerRequest("BOOKING_STATUS", { requestId: state.pendingOffer.requestId });
      if (progress?.ok && progress.status === "completed" && progress.conclusion === "success") {
        applyBookingResult({ ...state.pendingOffer, status: "booked" });
      } else if (progress?.ok && progress.status === "completed" && progress.conclusion !== "success") {
        state.pendingOffer.status = "needs_check";
        persist();
        showOffer(state.pendingOffer, true);
        notice("A tentativa terminou sem confirmação. Verifique em “Ver ou desmarcar” se a reserva aparece antes de tentar outra vez.");
      }
    } catch {}
  }

  function startBookingPolling() {
    if (bookingPollTimer) clearInterval(bookingPollTimer);
    if (!state.pendingOffer?.requestId || state.pendingOffer.status === "needs_check") return;
    checkBookingProgress();
    bookingPollTimer = setInterval(() => {
      if (!state.pendingOffer?.requestId || state.pendingOffer.status === "needs_check") {
        clearInterval(bookingPollTimer);
        bookingPollTimer = null;
        return;
      }
      checkBookingProgress();
    }, 7000);
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
    renderExtraAppointments([state.anchor, backup, regular]);
  }

  function renderExtraAppointments(visibleDates) {
    const today = iso(new Date());
    const appointments = Object.entries(state.appointments || {})
      .filter(([date, time]) => date >= today && time && !visibleDates.includes(date))
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
    const section = document.getElementById("extraAppointments");
    const list = document.getElementById("extraAppointmentList");
    list.replaceChildren();
    section.hidden = appointments.length === 0;

    for (const [date, time] of appointments) {
      const card = document.createElement("article");
      card.className = "extra-appointment card active";
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "Marcado";
      const heading = document.createElement("h3");
      heading.textContent = longDate(date);
      const weekday = document.createElement("span");
      weekday.className = "dow";
      weekday.textContent = dayName(date);
      const availability = document.createElement("div");
      availability.className = "availability good";
      availability.textContent = "Já marcado às " + time + ".";
      card.append(tag, heading, weekday, availability);
      list.append(card);
    }
  }

  async function refreshAvailability(showFeedback) {
    try {
      const response = await fetch("data/availability.json?ts=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("availability unavailable");
      availability = await response.json();
      if (showFeedback && state.dismissedOffers.length) {
        state.dismissedOffers = [];
        persist();
      }
      render();
      renderOffer();
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
      const registration = await navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" });
      await registration.update().catch(() => {});
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
    if (!window.matchMedia("(display-mode: standalone)").matches && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      notice("No iPhone, abra este painel pelo ícone instalado na Tela de Início e toque novamente em “Ativar avisos”.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notice("Os avisos não foram autorizados. Você pode alterar essa permissão nas configurações do navegador.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    try {
      const configResponse = await fetch("data/push-config.json", { cache: "no-store" });
      if (!configResponse.ok) throw new Error("push config unavailable");
      const config = await configResponse.json();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytesFromBase64Url(config.publicKey)
        });
      }
      await showActivationCode(subscription);
    } catch {
      notice("A permissão foi aceita, mas não foi possível concluir a ativação agora. Verifique a internet e tente novamente.");
      return;
    }
    if ("periodicSync" in registration) {
      try {
        await registration.periodicSync.register("check-availability", { minInterval: 12 * 60 * 60 * 1000 });
      } catch {}
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
  document.getElementById("confirmOffer").addEventListener("click", async () => {
    if (!currentOffer) return;
    const offer = { date: currentOffer.date, time: currentOffer.time };
    const requestId = crypto.randomUUID();
    state.pendingOffer = { ...offer, requestId, status: "processing" };
    state.dismissedOffers = state.dismissedOffers.filter((key) => key !== offerKey(currentOffer));
    persist();
    showOffer(state.pendingOffer, true);
    let response;
    try {
      response = await workerRequest("BOOK_OFFER", { ...offer, requestId });
    } catch {
      state.pendingOffer.status = "needs_check";
      persist();
      showOffer(state.pendingOffer, true);
      notice("A conexão caiu durante o envio. Confira seus agendamentos antes de tentar novamente.");
      return;
    }
    if (!response?.ok) {
      state.pendingOffer = null;
      persist();
      showOffer(offer);
      const message = response?.error === "booking_not_activated"
        ? "A reserva direta ainda não está ativada neste aparelho. Vou concluir essa configuração e avisar você."
        : response?.error === "booking_access_expired"
          ? "O acesso da reserva direta expirou. É preciso renovar a ativação antes de confirmar."
          : "Não foi possível enviar a reserva agora. Tente novamente em instantes.";
      notice(message);
      return;
    }
    toast("Pedido enviado. Conferindo a reserva.");
    startBookingPolling();
  });
  document.getElementById("dismissOffer").addEventListener("click", () => {
    if (!currentOffer) return;
    const key = offerKey(currentOffer);
    state.dismissedOffers = [key, ...state.dismissedOffers.filter((value) => value !== key)].slice(0, 30);
    if (state.pendingOffer && offerKey(state.pendingOffer) === key) state.pendingOffer = null;
    persist();
    hideOffer();
    toast("Esta opção foi dispensada.");
  });
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

  const linkedOffer = offerFromLocation();
  render();
  if (state.pendingOffer) showOffer(state.pendingOffer, true);
  else if (linkedOffer) showOffer(linkedOffer);
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "BOOKING_RESULT") applyBookingResult(event.data.result);
    if (event.data?.type === "BOOKING_ACTIVATED") refreshBookingSetup();
    if (event.data?.type === "PUSH_DIAGNOSTICS") refreshPushDiagnostics();
  });
  registerServiceWorker().then(() => {
    refreshBookingSetup();
    refreshPushDiagnostics();
    startBookingPolling();
  });
  refreshAvailability(false);
}());
