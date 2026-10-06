// Чат «Хто купив?»: питання про посилку чи товар → ШІ-агент n8n (закупівля, бух. чат, посилки НП; лише читання).
// Кнопка в правому нижньому куті, працює на всіх вкладках.

(() => {
  const chatUrl = "https://primary-production-eeb3.up.railway.app/webhook/buyer-chat";

  let sessionId = "";
  try { sessionId = sessionStorage.getItem("buyerChatSession") || ""; } catch (e) {}
  if (!sessionId) {
    sessionId = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { sessionStorage.setItem("buyerChatSession", sessionId); } catch (e) {}
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const root = document.createElement("div");
  root.className = "bc";
  root.innerHTML = `
    <button type="button" class="bc-fab" title="Хто купив? Спитати про посилку чи товар">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5"/><path d="M12 16.5h.01"/></svg>
      <span>Хто купив?</span>
    </button>
    <section class="bc-panel glass-card is-static hidden" aria-label="Хто купив?">
      <header class="bc-head">
        <div><b>Хто купив?</b><small>закупівля · бух. чат · посилки НП, останні 30 днів</small></div>
        <button type="button" class="bc-close" aria-label="Закрити">&times;</button>
      </header>
      <div class="bc-log scroll-slim">
        <div class="bc-msg is-bot">Опишіть, що прийшло, наприклад: «прийшли 2 парасолі ІКЕА, хто купив?», «чашки Еней 20 шт — чиї?» або «посилка 20451550299554 — до чого?»</div>
      </div>
      <form class="bc-form">
        <textarea rows="1" placeholder="Що прийшло?" maxlength="1000"></textarea>
        <button type="submit" class="gbtn gbtn-accent">Спитати</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const panel = $(".bc-panel");
  const log = $(".bc-log");
  const input = $(".bc-form textarea");
  const send = $(".bc-form button");
  let busy = false;

  const add = (text, cls) => {
    const el = document.createElement("div");
    el.className = "bc-msg " + cls;
    el.innerHTML = esc(text).replace(/\n/g, "<br>");
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    send.disabled = true;
    add(text.trim(), "is-me");
    input.value = "";
    const wait = add("Шукаю в закупівлі, бух. чаті й посилках…", "is-bot is-wait");
    try {
      const resp = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text.trim() })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      wait.remove();
      add(json.reply || "Порожня відповідь", "is-bot");
    } catch (e) {
      wait.remove();
      add("Не вдалося отримати відповідь (" + e.message + "). Спробуйте ще раз.", "is-bot is-err");
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  $(".bc-fab").addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) input.focus();
  });
  $(".bc-close").addEventListener("click", () => panel.classList.add("hidden"));
  $(".bc-form").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    if (e.key === "Escape") panel.classList.add("hidden");
  });
})();
