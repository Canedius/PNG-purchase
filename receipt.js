// Вкладка «Прийом»: реєстр вхідних посилок НП на день і результат сканування.
// Дані — вебхуки n8n workflow «Прийом товару» (база parcels). Перемикає app.js через window.ReceiptTab.

(() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const base = local ? "" : "https://primary-production-eeb3.up.railway.app";
  const listUrl = `${base}/webhook/receipt-list`;
  const scanUrl = `${base}/webhook/receipt-scan`;
  const orderLinkBase = "https://pngstudio.keycrm.app/app/orders/view/";
  const REFRESH_MS = 4000;

  const panel = document.getElementById("receiptPanel");
  if (!panel) return;

  const kyivDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
  const shiftDay = (day, n) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayLabel = (day) => new Date(`${day}T12:00:00Z`)
    .toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" });
  const hhmm = (ts) => ts ? new Date(ts).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }) : "";
  // Час; якщо подія не у вибраний день — ще й дата
  const when = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (kyivDay(d) === day) return hhmm(ts);
    return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Kyiv" }) + " " + hhmm(ts);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let day = kyivDay();
  let data = null;
  let query = "";
  let timer = null;
  let visible = false;
  let busy = false;
  let filter = null; // клік по лічильнику: accepted | waiting | transit | issued | npday
  // Місто отримувача за накладною; при відкритті завжди Львів. Невідоме місто — теж Львів, щоб нічого не загубилось
  let city = "Львів";
  const cityOf = (r) => r.recipient_city === "Київ" ? "Київ" : "Львів";
  const cityRows = () => ((data && data.rows) || []).filter(r => cityOf(r) === city);

  panel.innerHTML = `
    <div class="rcp-head glass-card is-static">
      <div class="rcp-day">
        <button class="gbtn gbtn-ghost gbtn-icon" data-act="prev" title="Попередній день">‹</button>
        <span class="rcp-day-label"></span>
        <button class="gbtn gbtn-ghost gbtn-icon" data-act="next" title="Наступний день">›</button>
        <button class="gbtn gbtn-ghost rcp-today" data-act="today">сьогодні</button>
      </div>
      <div class="rcp-city tabs-bar"></div>
      <div class="search-shell rcp-search">
        <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>
        </svg>
        <input type="text" autocomplete="off" spellcheck="false"
               placeholder="ТТН, замовлення, відправник… 14 цифр + Enter — прийняти" />
      </div>
    </div>
    <div class="rcp-counters"></div>
    <div class="rcp-list"></div>`;

  const $ = (sel) => panel.querySelector(sel);
  const searchEl = $(".rcp-search input");

  // Стан посилки для лічильників і кольору рядка
  function kind(r) {
    if (r.accepted_at) return "accepted";
    if (r.issued_at) return "issued";       // НП каже «видано», а скану немає
    if (r.arrived_at) return "waiting";     // лежить у відділенні
    return "transit";                       // у дорозі або статус ще невідомий
  }

  function ageClass(days) {
    if (days == null) return "";
    if (days >= 5) return "is-red";
    if (days >= 3) return "is-amber";
    return "";
  }

  function matches(r) {
    if (!query) return true;
    const hay = [r.ttn, r.order_id, r.alias_name, r.counterparty, r.sender, r.cargo, r.warehouse, r.accepted_by]
      .join(" ").toLowerCase();
    return query.split(/\s+/).every(t => hay.includes(t));
  }

  // НП відмітила «видано» саме у вибраний день
  const npDay = (r) => r.issued_at && kyivDay(new Date(r.issued_at)) === day;
  // Основний реєстр дня: те, що чекає, і прийняте саме цього дня
  // (рядки, прийняті іншого дня, приходять лише для звірки з НП)
  const inDay = (r) => !r.accepted_at || r.shift_date === day;

  const FILTERS = {
    npday:    npDay,
    accepted: r => inDay(r) && kind(r) === "accepted",
    onway:    r => kind(r) === "transit" || kind(r) === "waiting",   // у дорозі + лежить у відділенні
    issued:   r => kind(r) === "issued"
  };

  // Іконки плиток (лінійні, як у решті інтерфейсу)
  const ICONS = {
    npday: `<img src="logo/novaposhta.svg" alt="Нова Пошта">`,
    accepted: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="m8.5 13.5 2.5 2.5 4.5-5"/></svg>`,
    onway: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>`,
    issued: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>`
  };

  // Порядок плиток: що віддала НП → що прийняв склад → що ще їде → що віддали, а скану немає
  function renderCounters(rows) {
    const n = (f) => rows.filter(FILTERS[f]).length;
    const np = rows.filter(npDay);
    const atBranch = rows.filter(r => kind(r) === "waiting").length;
    const issued = n("issued");
    const tile = (f, num, label, cls = "", sub = "") =>
      `<button type="button" data-filter="${f}" class="rcp-tile glass-card is-static is-${f} ${cls} ${filter === f ? "is-active" : ""}"
               title="${filter === f ? "Показати все" : "Показати лише це"}">
         <span class="rcp-tile-icon">${ICONS[f]}</span>
         <b>${num}</b>
         <span class="rcp-tile-label">${label}</span>
         ${sub ? `<span class="rcp-tile-sub">${sub}</span>` : ""}
       </button>`;
    $(".rcp-counters").innerHTML =
      tile("npday", np.length, "Віддано Новою Поштою") +
      tile("accepted", n("accepted"), "Прийнято складом") +
      tile("onway", n("onway"), "У дорозі до нас", "", atBranch ? `з них у відділенні ${atBranch}` : "") +
      tile("issued", issued, "Не відскановані", issued ? "has-alert" : "");
  }

  function rowHtml(r) {
    const k = kind(r);
    const who = r.alias_name
      ? `<b>${esc(r.alias_name)}</b> <span class="rcp-mute">${esc(r.counterparty && r.counterparty !== "Приватна особа" ? r.counterparty : r.sender || "")}</span>`
      : `<b>${esc(r.counterparty && r.counterparty !== "Приватна особа" ? r.counterparty : r.sender || (r.known ? "відправник невідомий" : "немає в реєстрі НП"))}</b>`;
    const meta = [r.cargo, r.weight ? `${r.weight} кг` : "", r.seats ? `${r.seats} місц.` : "", r.city]
      .filter(Boolean).map(esc).join(" · ");
    const target = r.order_id
      ? `<a class="rcp-order" href="${orderLinkBase}${encodeURIComponent(r.order_id)}" target="_blank" rel="noopener">№ ${esc(r.order_id)}</a>`
      : (r.alias_kind === "category" ? `<span class="rcp-cat">${esc(r.alias_name)}</span>` : "");
    let state;
    if (k === "accepted") {
      // звірка з НП під нашою відміткою
      const np = r.issued_at
        ? `<span class="rcp-np is-ok">НП: видано ${esc(when(r.issued_at))}</span>`
        : `<span class="rcp-np">НП ще не відмітила</span>`;
      state = `<span class="rcp-done">✓ ${esc(when(r.accepted_at))} ${esc(r.accepted_by || "")}</span>${np}`;
    }
    else if (k === "issued") state = `<span class="rcp-badge is-red">НП: видано ${esc(when(r.issued_at))}</span>`;
    else if (k === "waiting") state = `<span class="rcp-badge ${ageClass(r.days_waiting)}">${r.days_waiting ? `у відділенні ${r.days_waiting} дн.` : "прибула сьогодні"}</span>`;
    else state = `<span class="rcp-badge is-mute">${esc(r.status_text || "у дорозі")}</span>`;
    return `<div class="rcp-row is-${k}">
        <div class="rcp-ttn rcp-copy" data-copy="${esc(r.ttn)}" title="Скопіювати ${esc(r.ttn)}">${esc(String(r.ttn).slice(-4))}</div>
        <div class="rcp-main">
          <div class="rcp-who">${who}</div>
          <div class="rcp-meta">${meta}</div>
        </div>
        <div class="rcp-target">${target}</div>
        <div class="rcp-state">${state}</div>
      </div>`;
  }

  const section = (title, sub, list, cls = "") => `<section class="glass-card is-static rcp-group ${cls}">
      <h3>${title} <span class="rcp-mute">${sub}</span></h3>
      ${list.map(rowHtml).join("")}
    </section>`;

  function renderList(all) {
    const el = $(".rcp-list");
    const rows = all.filter(r => matches(r) && (filter ? FILTERS[filter](r) : inDay(r)));
    if (!rows.length) {
      el.innerHTML = `<div class="glass-card is-static rcp-empty">${query || filter ? "Нічого не знайдено" : "На цей день посилок немає"}</div>`;
      return;
    }
    // Звірка з НП за день: спершу те, що НП видала, а скану немає
    if (filter === "npday") {
      const byTime = (a, b) => String(a.issued_at).localeCompare(String(b.issued_at));
      const noScan = rows.filter(r => !r.accepted_at).sort(byTime);
      const ok = rows.filter(r => r.accepted_at).sort(byTime);
      el.innerHTML =
        (noScan.length ? section("⚠️ НП видала — скану немає", `${noScan.length} · шукати на складі або писати в НП`, noScan, "is-alert") : "") +
        (ok.length ? section("✓ НП видала — прийнято", `${ok.length} · збігається`, ok) : "");
      return;
    }
    const groups = new Map();
    rows.forEach(r => {
      const g = r.warehouse || (r.known ? "Відділення ще невідоме" : "Невідомі ТТН");
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    });
    // Спершу те, що чекає довше; прийняте — вниз
    const order = { issued: 0, waiting: 1, transit: 2, accepted: 3 };
    el.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].filter(r => !r.accepted_at).length - a[1].filter(r => !r.accepted_at).length)
      .map(([name, list]) => {
        list.sort((a, b) => order[kind(a)] - order[kind(b)] || (b.days_waiting || 0) - (a.days_waiting || 0)
          || String(b.accepted_at || "").localeCompare(String(a.accepted_at || "")));
        const left = list.filter(r => !r.accepted_at).length;
        return `<section class="glass-card is-static rcp-group">
            <h3>${esc(name)} <span class="rcp-mute">${left ? `чекає ${left}` : "усе прийнято"} · усього ${list.length}</span></h3>
            ${list.map(rowHtml).join("")}
          </section>`;
      }).join("");
  }

  // Перемикач міста: у кнопці — скільки посилок ще чекає прийому
  function renderCity() {
    const all = (data && data.rows) || [];
    const left = (c) => all.filter(r => cityOf(r) === c && !r.accepted_at).length;
    $(".rcp-city").innerHTML = ["Львів", "Київ"].map(c =>
      `<button type="button" data-city="${c}" class="tab-btn ${city === c ? "is-active" : ""}">${c} <span class="rcp-mute">${left(c)}</span></button>`).join("");
  }

  function render() {
    $(".rcp-day-label").textContent = dayLabel(day) + (day === kyivDay() ? " · сьогодні" : "");
    $('[data-act="next"]').disabled = day >= kyivDay();
    if (!data) { $(".rcp-list").innerHTML = `<div class="glass-card is-static rcp-empty">Завантаження…</div>`; return; }
    renderCity();
    const rows = cityRows();
    renderCounters(rows);
    renderList(rows);
  }

  async function load() {
    if (busy) return;
    busy = true;
    const want = day;
    try {
      const resp = await fetch(`${listUrl}?date=${want}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (want === day) { data = json; render(); }
    } catch (e) {
      console.warn("Прийом: не вдалося завантажити", e);
      if (!data) $(".rcp-list").innerHTML = `<div class="glass-card is-static rcp-empty is-error">Не вдалося завантажити реєстр (${esc(e.message)})</div>`;
    } finally {
      busy = false;
    }
  }

  function operator() {
    let by = "";
    try { by = localStorage.getItem("receiptBy") || ""; } catch (e) {}
    if (!by) {
      by = (prompt("Хто приймає? (імʼя зберігається на цьому компʼютері)") || "").trim();
      if (by) try { localStorage.setItem("receiptBy", by); } catch (e) {}
    }
    return by || "фронт";
  }

  // Ручне приймання: ТТН у пошуку + Enter (коли сканер недоступний)
  async function acceptManual(ttn) {
    try {
      const resp = await fetch(scanUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttn, by: operator() })
      });
      await resp.json().catch(() => ({}));
      searchEl.value = "";
      query = "";
      if (day !== kyivDay()) day = kyivDay();
      await load();
    } catch (e) {
      alert(`Не вдалося прийняти ${ttn}: ${e.message}`);
    }
  }

  function setDay(d) {
    day = d;
    data = null;
    render();
    load();
  }

  // Клік по ТТН — повний номер у буфер обміну
  async function copyTtn(el) {
    const ttn = el.dataset.copy;
    try {
      await navigator.clipboard.writeText(ttn);
    } catch (e) {
      // запасний шлях, якщо Clipboard API недоступний
      const ta = document.createElement("textarea");
      ta.value = ttn;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    el.classList.add("is-copied");
    setTimeout(() => el.classList.remove("is-copied"), 1200);
  }

  panel.addEventListener("click", (e) => {
    const cityEl = e.target.closest("[data-city]");
    if (cityEl) { city = cityEl.dataset.city; render(); return; }
    const copyEl = e.target.closest("[data-copy]");
    if (copyEl) { copyTtn(copyEl); return; }
    const tileEl = e.target.closest("[data-filter]");
    if (tileEl) { filter = filter === tileEl.dataset.filter ? null : tileEl.dataset.filter; render(); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "prev") setDay(shiftDay(day, -1));
    else if (act === "next" && day < kyivDay()) setDay(shiftDay(day, 1));
    else if (act === "today") setDay(kyivDay());
  });
  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim().toLowerCase();
    if (data) renderList(cityRows());
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { searchEl.value = ""; query = ""; render(); }
    if (e.key !== "Enter") return;
    const digits = searchEl.value.replace(/\D/g, "");
    if (/^\d{14}$/.test(digits)) acceptManual(digits);
  });

  function tick() {
    if (visible && !document.hidden) load();
  }

  window.ReceiptTab = {
    show() {
      visible = true;
      panel.classList.remove("hidden");
      if (day !== kyivDay() && !data) day = kyivDay();
      render();
      load();
      if (!timer) timer = setInterval(tick, REFRESH_MS);
    },
    hide() {
      visible = false;
      panel.classList.add("hidden");
      clearInterval(timer);
      timer = null;
    }
  };
})();
