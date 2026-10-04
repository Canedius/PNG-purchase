// Увесь JS винесено окремо, готуємося до підключення реального API.

document.addEventListener("DOMContentLoaded", () => {
  // Дані приходять з вебхука; контейнер для збереження
  let suppliers = [];
  const dataUrl = "https://primary-production-eeb3.up.railway.app/webhook/1c480cd8-acda-4af4-92cd-75b452e6f159";
  const updateUrl = "https://primary-production-eeb3.up.railway.app/webhook/26cb3bb4-e19f-4037-8291-6525da83be45";
  const receiveWebhook = "https://primary-production-eeb3.up.railway.app/webhook/aaf5a6e4-f47b-45ce-8f6b-e8e3600a2ab5"; // вебхук для статусу 'received'
  const createUrl = "https://primary-production-eeb3.up.railway.app/webhook/aad0017a-9bac-4968-ad7a-fdb13e03a33e"; // створення одноразового товару
  const deleteUrl = "https://primary-production-eeb3.up.railway.app/webhook/9befdb41-a9e6-48bb-9e9d-b662a45719b5"; // видалення ОДНОГО рядка по ?id=<row.id> (Webhook1 -> Delete row(s))
  const stockListUrl = "https://primary-production-eeb3.up.railway.app/webhook/b345a2cb-c38e-473f-a2cb-984179c2a16d"; // GET список залишків
  const stockSaveUrl = "https://primary-production-eeb3.up.railway.app/webhook/083515fd-b0b5-4176-b3e8-47f41f9d0e14"; // POST upsert/delete залишку
  const stockTakenSaveUrl = "https://primary-production-eeb3.up.railway.app/webhook/e73ac8d7-1d06-44fd-8df7-f7be8b64f412"; // POST [{id, stock_taken}] — скільки взято зі складу
  const orderLinkBase = "https://pngstudio.keycrm.app/app/orders/view/";
  const imgbbKey = "94bdaee3905112e98422049edbc5347f"; // ключ imgbb для аплоуду фото

  // Групи статусів KeyCRM: 1 нові, 2 погодження, 3 виробництво, 4 доставка, 5 виконано, 6 скасовано
  const crmGroupClass = { 1: "badge-indigo", 2: "badge-amber", 3: "badge-sky", 4: "badge-emerald", 5: "badge-slate", 6: "badge-rose" };
  function crmStatusBadge(item) {
    if (!item.orderStatus) return "";
    const cls = crmGroupClass[item.orderStatusGroup] || "badge-slate";
    return `<span class="badge ${cls} crm-status" title="Статус замовлення в KeyCRM">${String(item.orderStatus).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]))}</span>`;
  }

  const columns = [
    "Дата замов", "Номер замов", "Фото",
    "Назва товару", "к-сть", "Артикул", "Статус"
  ];
  const pdfColumns = [
    "Назва товару", "Фото",
    "к-сть", "Артикул", "Штрихкод"
  ];
  // компактний 1x1 PNG як базовий плейсхолдер (валідний, щоб не ламати addImage)
  const defaultPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XbRuoAAAAASUVORK5CYII=";

  const container = document.getElementById("suppliersContainer");
  const printFrame = document.getElementById("printFrame");
  const pageLogo = document.getElementById("pageLogo");
  const tabAll = document.getElementById("tabAll");
  const tabOrdered = document.getElementById("tabOrdered");
  const tabReceipt = document.getElementById("tabReceipt");
  const tabsBar = document.getElementById("tabsBar");
  const brandPngDruk = document.getElementById("brandPngDruk");
  const brandPngStudio = document.getElementById("brandPngStudio");
  // Modal одноразового товару
  const oneOffModal = document.getElementById("oneOffModal");
  const mOrder = document.getElementById("mOrder");
  const mName = document.getElementById("mName");
  const mQty = document.getElementById("mQty");
  const mSku = document.getElementById("mSku");
  const mPhotoFile = document.getElementById("mPhotoFile");
  const mMsg = document.getElementById("mMsg");
  const mSave = document.getElementById("mSave");
  const mCancel = document.getElementById("mCancel");
  const mClose = document.getElementById("oneOffClose");
  const mSupplierWrap = document.getElementById("mSupplierWrap");
  const mSupplier = document.getElementById("mSupplier");
  const addSupplierBtn = document.getElementById("addSupplierBtn");
  // Індикатор автооновлення в шапці
  const autoChip = document.getElementById("autoRefreshChip");
  const autoChipText = document.getElementById("autoRefreshText");
  // Пошук
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const searchCount = document.getElementById("searchCount");
  const searchShell = document.getElementById("searchShell");
  let oneOffTarget = { supplier: null, batch: null, date: null };
  const { jsPDF } = window.jspdf;
  let logoDataPromise = null;
  let currentView = "new"; // new | ordered | receipt
  let currentBrand = "png_druk"; // png_druk | png_studio
  const BRAND_TAGS = {
    png_druk: new Set(["PNG druk Львів", "PNG druk Київ", "PNG druk"]),
    png_studio: new Set(["PNG studio"]),
  };
  // Мінімальний валідний PNG 1x1 (прозорий), щоб уникнути помилок декодування
  const fallbackLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XbRuoAAAAASUVORK5CYII=";
  const markIcons = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 4 4 12-12"></path></svg>`
  ];
  let markIconIdx = 0;

  // Зберігаємо відмітку "Друковано" між перезавантаженнями (по постачальнику + партіям)
  const printedStoreKey = "zakupka_printed_suppliers_v2";
  const loadPrintedStore = () => {
    try {
      const raw = localStorage.getItem(printedStoreKey);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) {
      return {};
    }
  };
  const savePrintedStore = (store) => {
    try { localStorage.setItem(printedStoreKey, JSON.stringify(store)); } catch (e) {}
  };
  let printedStore = loadPrintedStore();
  // Запам'ятовуємо, в яку партію додали одноразовий товар (ключ: orderNumber -> batchId)
  const oneOffBatchKey = "zakupka_oneoff_batch_v1";
  const loadOneOffBatches = () => {
    try {
      const raw = localStorage.getItem(oneOffBatchKey);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) { return {}; }
  };
  const saveOneOffBatches = (map) => {
    try { localStorage.setItem(oneOffBatchKey, JSON.stringify(map)); } catch (e) {}
  };
  let oneOffBatches = loadOneOffBatches();

  // === Залишки на складі (спільна база в n8n) ===
  // Map: нормалізований артикул -> { sku, name, quantity }
  let stockMap = new Map();
  const normalizeSku = (s) => String(s ?? "").trim().toUpperCase();
  const getStock = (sku) => {
    const key = normalizeSku(sku);
    if (!key) return null;
    return stockMap.get(key) || null;
  };

  // === Фото до артикулів ===
  // Бекенд залишків не зберігає фото, тому збираємо їх з даних закупівлі
  // (SKU -> photo) і кешуємо, щоб вони лишались і після зміни вкладки.
  const skuPhotoKey = "zakupka_sku_photos_v1";
  const loadSkuPhotos = () => {
    try {
      const raw = localStorage.getItem(skuPhotoKey);
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === "object" ? new Map(Object.entries(obj)) : new Map();
    } catch (e) { return new Map(); }
  };
  let skuPhotos = loadSkuPhotos();
  const saveSkuPhotos = () => {
    try { localStorage.setItem(skuPhotoKey, JSON.stringify(Object.fromEntries(skuPhotos))); } catch (e) {}
  };
  const getSkuPhoto = (sku) => skuPhotos.get(normalizeSku(sku)) || null;

  // === Локальний кеш картинок (IndexedDB) ===
  // Кожне фото качаємо з KeyCRM/imgbb рівно один раз, далі беремо з диска браузера.
  // Ключ — сам URL фото, тож нове фото кешується автоматично при першому показі.
  const PHOTO_DB = "zakupka_photos";
  const PHOTO_STORE = "photos";
  const PHOTO_TTL_MS = 90 * 24 * 60 * 60 * 1000; // не чіпали 90 днів — чистимо
  let photoDbPromise = null;
  function openPhotoDb() {
    if (photoDbPromise) return photoDbPromise;
    photoDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(PHOTO_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: "url" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);   // приватний режим / заблоковане сховище
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return photoDbPromise;
  }
  const idbReq = (req) => new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  async function photoCacheGet(url) {
    const db = await openPhotoDb();
    if (!db) return null;
    try { return await idbReq(db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).get(url)); }
    catch (e) { return null; }
  }
  async function photoCachePut(url, blob) {
    const db = await openPhotoDb();
    if (!db) return;
    try { await idbReq(db.transaction(PHOTO_STORE, "readwrite").objectStore(PHOTO_STORE).put({ url, blob, savedAt: Date.now() })); }
    catch (e) {}
  }
  async function prunePhotoCache() {
    const db = await openPhotoDb();
    if (!db) return;
    try {
      const store = db.transaction(PHOTO_STORE, "readwrite").objectStore(PHOTO_STORE);
      const all = await idbReq(store.getAll());
      const dead = Date.now() - PHOTO_TTL_MS;
      (all || []).forEach(rec => { if (!rec?.savedAt || rec.savedAt < dead) store.delete(rec.url); });
    } catch (e) {}
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  const photoObjectUrls = new Map(); // віддалений URL -> blob: URL цієї сесії
  const photoPending = new Map();    // щоб те саме фото не тягнулось двічі паралельно
  // Повертає локальний blob:-URL або null, якщо закешувати не вдалось (CORS тощо)
  function cachedPhotoUrl(url) {
    if (!url || url.startsWith("data:")) return Promise.resolve(null);
    if (photoObjectUrls.has(url)) return Promise.resolve(photoObjectUrls.get(url));
    if (photoPending.has(url)) return photoPending.get(url);
    const task = (async () => {
      const rec = await photoCacheGet(url);
      let blob = rec?.blob || null;
      if (blob) {
        photoCachePut(url, blob); // освіжаємо мітку часу, щоб не вичистило
      } else {
        try {
          const resp = await fetch(url, { cache: "force-cache" });
          if (!resp.ok) return null;
          const fetched = await resp.blob();
          if (!fetched.type.startsWith("image/") || fetched.size < 50) return null;
          blob = fetched;
          await photoCachePut(url, blob);
        } catch (e) {
          return null; // не кешується — сторінка просто візьме звичайний URL
        }
      }
      const objUrl = URL.createObjectURL(blob);
      photoObjectUrls.set(url, objUrl);
      return objUrl;
    })().finally(() => photoPending.delete(url));
    photoPending.set(url, task);
    return task;
  }
  // Малюємо картинку через кеш: у розмітці лишаємо data-remote, а src підставляємо тут
  const photoImgTag = (url, cls) => {
    const safe = url || defaultPhoto;
    const remote = url && !url.startsWith("data:") ? url : "";
    // якщо вже тягнули в цій сесії — одразу локальний blob:, без мигання
    const ready = remote ? photoObjectUrls.get(remote) : null;
    const src = ready || (remote ? defaultPhoto : safe);
    return `<img src="${src}" data-remote="${remote}" data-full="${ready || safe}" alt="Фото" class="${cls}">`;
  };
  async function hydratePhotos(root = document) {
    const imgs = [...root.querySelectorAll("img[data-remote]")].filter(i => i.dataset.remote);
    await Promise.all(imgs.map(async (img) => {
      const remote = img.dataset.remote;
      const local = await cachedPhotoUrl(remote);
      const src = local || remote; // не закешувалось — вантажимо як раніше
      img.src = src;
      img.dataset.full = src;
    }));
  }

  // === Пам'ять «взято зі складу» ===
  // Після списання залишок падає і бейдж «Є на складі» зникає, тому окремо
  // запам'ятовуємо, скільки штук по рядку взяли зі складу — щоб у «Замовлено»
  // було видно, що товар треба шукати на складі, а не чекати від постачальника.
  const stockTakenKey = "zakupka_stock_taken_v1";
  const loadStockTaken = () => {
    try {
      const raw = localStorage.getItem(stockTakenKey);
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) { return {}; }
  };
  let stockTaken = loadStockTaken();
  const saveStockTaken = () => {
    try { localStorage.setItem(stockTakenKey, JSON.stringify(stockTaken)); } catch (e) {}
  };
  const itemStockKey = (item) =>
    item?.id != null && item.id !== "" ? `id:${item.id}` : `ord:${item?.orderNumber}|${normalizeSku(item?.sku)}`;
  // Значення з бекенду (колонка stock_taken) головніше за локальне —
  // воно спільне для всіх машин, localStorage лишається запасним варіантом.
  const getStockTaken = (item) => {
    const fromServer = Number(item?.raw?.stock_taken ?? item?.stockTaken);
    if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
    return Number(stockTaken[itemStockKey(item)]) || 0;
  };
  // Розподіляємо списану кількість по рядках того ж артикулу (по порядку)
  function rememberStockTaken(items, usage) {
    const changes = []; // [{ id, stock_taken }] — те саме поїде на бекенд
    (usage || []).forEach(u => {
      let left = Number(u.use) || 0;
      const key = normalizeSku(u.stock.sku);
      items.filter(it => normalizeSku(it.sku) === key).forEach(it => {
        if (left <= 0) return;
        let need = Number(it.quantity);
        if (!Number.isFinite(need) || need <= 0) need = 1;
        const alloc = Math.min(need, left);
        left -= alloc;
        const total = (Number(stockTaken[itemStockKey(it)]) || 0) + alloc;
        stockTaken[itemStockKey(it)] = total;
        if (it.raw) it.raw.stock_taken = total; // щоб плашка зʼявилась без перезавантаження
        if (it.id != null && it.id !== "") changes.push({ id: it.id, stock_taken: total });
      });
    });
    if (changes.length) saveStockTaken();
    return changes;
  }

  // Пишемо «взято зі складу» в колонку stock_taken таблиці «Закупівлі»,
  // щоб позначка була спільною для всіх машин, а не лише в цьому браузері.
  async function pushStockTaken(changes) {
    if (!changes || !changes.length) return;
    const resp = await fetch(stockTakenSaveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  }

  // Сирі рядки обох вкладок поточного бренду — потрібні, щоб резервування складу
  // рахувалось по всіх замовленнях, а не лише по видимих зараз.
  let allBrandRows = [];
  // Ключ рядка -> скільки штук цього рядка покриває склад.
  // Штуки роздаємо в порядку створення рядків: хто раніше замовив, той і бере зі складу.
  function computeStockAlloc() {
    const alloc = new Map();
    const remaining = new Map();
    stockMap.forEach((v, k) => remaining.set(k, v.quantity));
    const rows = [...allBrandRows].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    rows.forEach(row => {
      const ref = { id: row.id ?? null, orderNumber: String(row.OrderID), sku: row.SKU || "", stockTaken: row.stock_taken };
      if (getStockTaken(ref) > 0) return; // вже списано зі складу — склад під нього не резервуємо
      const key = normalizeSku(row.SKU);
      const rem = remaining.get(key);
      if (!rem || rem <= 0) return;
      let need = Number(row.Quantity);
      if (!Number.isFinite(need) || need <= 0) need = 1;
      const take = Math.min(need, rem);
      if (take <= 0) return;
      alloc.set(itemStockKey(ref), take);
      remaining.set(key, rem - take);
    });
    return alloc;
  }
  // Запам'ятовуємо фото з сирих рядків бекенду; повертає true, якщо щось змінилось
  function rememberSkuPhotos(rows) {
    let changed = false;
    (rows || []).forEach(r => {
      const key = normalizeSku(r?.SKU);
      const photo = r?.photo;
      if (!key || !photo) return;
      if (skuPhotos.get(key) === photo) return;
      skuPhotos.set(key, photo);
      changed = true;
    });
    if (changed) saveSkuPhotos();
    return changed;
  }
  // Догружаємо фото для артикулів складу, яких немає в поточній вкладці
  async function ensureStockPhotos() {
    const missing = [...stockMap.keys()].filter(k => !skuPhotos.has(k));
    if (!missing.length) return false;
    try {
      const lists = await Promise.all(["to_buy", "ordered"].map(async (st) => {
        const resp = await fetch(`${dataUrl}?status=${encodeURIComponent(st)}`, { cache: "no-store" });
        if (!resp.ok) return [];
        const text = await resp.text();
        if (!text || !text.trim()) return [];
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
      }));
      return rememberSkuPhotos([].concat(...lists));
    } catch (e) {
      console.warn("Не вдалося підтягнути фото до залишків", e);
      return false;
    }
  }

  async function loadStock() {
    try {
      const resp = await fetch(stockListUrl, { cache: "no-store" });
      const text = await resp.text();
      let rows = [];
      if (text && text.trim().length) {
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) rows = parsed; } catch (e) {}
      }
      const next = new Map();
      rows.forEach(r => {
        if (!r) return;
        const key = normalizeSku(r.sku);
        if (!key) return;
        const qty = Number(r.quantity) || 0;
        if (qty <= 0) return; // нульові залишки не показуємо взагалі
        next.set(key, { sku: String(r.sku).trim(), name: r.name || "", quantity: qty });
      });
      stockMap = next;
    } catch (e) {
      console.warn("Не вдалося завантажити залишки", e);
    }
  }

  // Записати нову кількість залишку. 0 — артикул повністю прибираємо зі складу.
  async function setStockQuantity(stock, newQty) {
    const qty = Math.max(0, Number(newQty) || 0);
    const payload = qty > 0
      ? { sku: stock.sku, name: stock.name || "", quantity: qty }
      : { sku: stock.sku, _delete: true };
    const resp = await fetch(stockSaveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const key = normalizeSku(stock.sku);
    if (qty > 0) stockMap.set(key, { sku: stock.sku, name: stock.name || "", quantity: qty });
    else stockMap.delete(key);
  }

  // Питає, чи списати товар зі складу. Повертає:
  //  { proceed:true, usage:[{stock, use}] } — продовжити (usage може бути порожнім)
  //  { proceed:false } — скасувати перенесення
  function askStockUsage(items) {
    // Агрегуємо обрані товари за артикулом, лишаємо лише ті, що є на складі (к-сть > 0)
    const bySku = new Map();
    items.forEach(it => {
      const st = getStock(it.sku);
      if (!st || st.quantity <= 0) return;
      const key = normalizeSku(it.sku);
      const entry = bySku.get(key) || { stock: st, ordered: 0 };
      entry.ordered += Number(it.quantity) || 0;
      bySku.set(key, entry);
    });
    const rows = [...bySku.values()];
    if (rows.length === 0) return Promise.resolve({ proceed: true, usage: [] });

    const modal = document.getElementById("stockUseModal");
    const listEl = document.getElementById("stockUseList");
    const msgEl = document.getElementById("stockUseMsg");
    const confirmBtn = document.getElementById("stockUseConfirm");
    const skipBtn = document.getElementById("stockUseSkip");
    const closeBtn = document.getElementById("stockUseClose");

    msgEl.textContent = "";
    listEl.innerHTML = rows.map((r, i) => {
      const def = Math.min(r.ordered, r.stock.quantity);
      return `
        <div class="glass-soft flex items-center gap-3 px-3 py-2.5">
          <div class="min-w-0 grow">
            <div class="text-[13px] font-semibold text-slate-800 truncate">${r.stock.name || r.stock.sku}</div>
            <div class="text-[11px] text-slate-500 mt-0.5">Артикул: <span class="font-mono">${r.stock.sku}</span> · на складі: <b>${r.stock.quantity} шт</b> · замовляється: ${r.ordered} шт</div>
          </div>
          <label class="text-[11px] text-slate-500 shrink-0 text-center">
            списати
            <input type="number" class="stock-use-input gfield gfield-emerald w-20 text-center mt-1"
                   data-idx="${i}" min="0" max="${r.stock.quantity}" value="${def}">
          </label>
        </div>`;
    }).join("");

    modal.classList.remove("hidden");

    return new Promise((resolve) => {
      const cleanup = () => {
        modal.classList.add("hidden");
        confirmBtn.removeEventListener("click", onConfirm);
        skipBtn.removeEventListener("click", onSkip);
        closeBtn.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
      };
      const onConfirm = () => {
        const inputs = listEl.querySelectorAll(".stock-use-input");
        const usage = [];
        for (const inp of inputs) {
          const r = rows[Number(inp.dataset.idx)];
          let use = Number(inp.value);
          if (!Number.isFinite(use) || use < 0) use = 0;
          if (use > r.stock.quantity) { msgEl.textContent = `Не можна списати більше, ніж є на складі (${r.stock.sku}: ${r.stock.quantity} шт).`; return; }
          if (use > 0) usage.push({ stock: r.stock, use });
        }
        cleanup();
        resolve({ proceed: true, usage });
      };
      const onSkip = () => { cleanup(); resolve({ proceed: true, usage: [] }); };
      const onCancel = () => { cleanup(); resolve({ proceed: false }); };
      const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
      confirmBtn.addEventListener("click", onConfirm);
      skipBtn.addEventListener("click", onSkip);
      closeBtn.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
    });
  }

  const renderMarkIcon = (idx) => markIcons[idx] || markIcons[0];

  // Попап прев'ю для фото
  const preview = document.createElement("div");
  preview.className = "img-hover-preview";
  preview.innerHTML = `<img src="" alt="preview">`;
  document.body.appendChild(preview);

  function attachPreviewHandlers(root = document) {
    root.querySelectorAll(".thumb-img").forEach(img => {
      img.addEventListener("mouseenter", (e) => {
        const src = e.currentTarget.dataset.full || e.currentTarget.src;
        preview.querySelector("img").src = src;
        preview.style.display = "block";
        positionPreview(e);
      });
      img.addEventListener("mousemove", positionPreview);
      img.addEventListener("mouseleave", () => {
        preview.style.display = "none";
      });
    });
  }

  function positionPreview(e) {
    const pad = 16;
    const w = preview.offsetWidth || 320;
    const h = preview.offsetHeight || 320;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + w > window.innerWidth) x = e.clientX - w - pad;
    if (y + h > window.innerHeight) y = e.clientY - h - pad;
    preview.style.left = `${Math.max(8, x)}px`;
    preview.style.top = `${Math.max(8, y)}px`;
  }

  function getLogoData() {
    if (logoDataPromise) return logoDataPromise;
    logoDataPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cvs = document.createElement("canvas");
          cvs.width = img.naturalWidth;
          cvs.height = img.naturalHeight;
          const ctx = cvs.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(cvs.toDataURL("image/png"));
        } catch (e) { resolve(fallbackLogo); }
      };
      img.onerror = () => resolve(fallbackLogo);
      img.src = "logo/PNG GROUP logo.avif";
    });
    return logoDataPromise;
  }

  let fontReady = false;
  function loadRoboto(doc) {
    // Використовуємо шрифти з pdfMake vfs (Roboto містить кирилицю)
    if (window.pdfMake && pdfMake.vfs && pdfMake.vfs["Roboto-Regular.ttf"]) {
      try {
        ["Roboto-Regular.ttf", "Roboto-Medium.ttf", "Roboto-Bold.ttf"].forEach(fn => {
          if (pdfMake.vfs[fn]) doc.addFileToVFS(fn, pdfMake.vfs[fn]);
        });
        doc.addFont("Roboto-Regular.ttf", "Roboto", "normal", "Identity-H");
        if (pdfMake.vfs["Roboto-Bold.ttf"]) {
          doc.addFont("Roboto-Bold.ttf", "Roboto", "bold", "Identity-H");
        } else if (pdfMake.vfs["Roboto-Medium.ttf"]) {
          doc.addFont("Roboto-Medium.ttf", "Roboto", "bold", "Identity-H");
        }
        doc.setFont("Roboto", "normal");
        fontReady = true;
        return;
      } catch (e) {
        console.warn("Roboto vfs load failed, fallback helvetica", e);
      }
    }
    doc.setFont("helvetica", "normal");
    fontReady = false;
  }

  // === Нечіткий пошук ===
  // Літери запиту мають траплятися в тексті по порядку, але не обов'язково
  // поруч: "чрн фтб" знайде "Футболка чорна". Рахуємо не лише факт збігу, а і
  // його якість — збіги впритул і на початку слова цінуємо вище, щоб
  // найточніші рядки спливали першими.
  let searchQuery = "";
  let searchTokens = [];

  const WORD_CHAR = /[a-zа-яїієґё0-9]/i;

  function fuzzyMatch(token, text) {
    const t = String(text ?? "").toLowerCase();
    if (!t) return null;
    const positions = [];
    let score = 0, cursor = 0, prevIdx = -2;
    for (const ch of token) {
      const found = t.indexOf(ch, cursor);
      if (found === -1) return null;
      let bonus = 1;
      if (found === prevIdx + 1) bonus += 6;                       // йде впритул
      if (found === 0) bonus += 8;                                 // з початку рядка
      else if (!WORD_CHAR.test(t[found - 1] || "")) bonus += 5;    // з початку слова
      score += bonus;
      positions.push(found);
      prevIdx = found;
      cursor = found + 1;
    }
    return { score: score - positions[0] * 0.15, positions };
  }

  // Токени об'єднуємо через AND: кожне слово запиту має знайтись хоча б в
  // одному полі товару. Позиції збігів повертаємо окремо для назви й артикулу —
  // саме їх підсвічуємо в таблиці.
  function matchItem(item, supplierName) {
    if (!searchTokens.length) return { score: 0, name: [], sku: [] };
    const fields = [item.productName, item.sku, item.orderNumber, supplierName, item.dateOrder];
    let total = 0;
    const namePos = [], skuPos = [];
    for (const token of searchTokens) {
      let best = null, bestField = -1;
      fields.forEach((value, i) => {
        const hit = fuzzyMatch(token, value);
        if (hit && (!best || hit.score > best.score)) { best = hit; bestField = i; }
      });
      if (!best) return null; // жодне поле не має цього слова
      total += best.score;
      if (bestField === 0) namePos.push(...best.positions);
      if (bestField === 1) skuPos.push(...best.positions);
    }
    return { score: total, name: namePos, sku: skuPos };
  }

  // Обгортаємо знайдені літери, не ламаючи решту тексту
  function highlightHits(text, positions) {
    const src = String(text ?? "");
    if (!positions || !positions.length) return src;
    const marked = new Set(positions);
    let out = "", open = false;
    for (let i = 0; i < src.length; i++) {
      const hit = marked.has(i);
      if (hit && !open) { out += `<mark class="search-hit">`; open = true; }
      if (!hit && open) { out += "</mark>"; open = false; }
      out += src[i];
    }
    return open ? out + "</mark>" : out;
  }

  function renderSuppliers(highlightBatch = null) {
    container.innerHTML = "";
    if (highlightBatch?.animate) {
      container.classList.add("fade-in-up");
      container.addEventListener("animationend", () => container.classList.remove("fade-in-up"), { once: true });
    }
    if (suppliers.length === 0) {
      container.innerHTML = `<div class="empty-state rise-in">
        Даних поки немає. Підключіть API та заповніть suppliers.
      </div>`;
      return;
    }

    // Розподіл залишків рахуємо ГЛОБАЛЬНО — по рядках обох вкладок разом.
    // Інакше та сама штука зі складу показувалась би вільною і в «Поточні», і в «Замовлено».
    const stockAlloc = computeStockAlloc();

    let shownCount = 0;

    // Спершу оцінюємо всі товари — тоді постачальників можна впорядкувати за
    // релевантністю ще до рендеру. Рядки, які пошук ховає, знімаємо з вибору:
    // інакше «Позначити замовлено» потягне те, чого користувач не бачить.
    suppliers.forEach(s => {
      let best = -Infinity;
      s.items.forEach(item => {
        if (!searchTokens.length) { item._match = null; return; }
        const hit = matchItem(item, s.name);
        item._match = hit;
        if (!hit) item._selected = false;
        else if (hit.score > best) best = hit.score;
      });
      s._searchScore = best;
    });

    const order = suppliers.map((s, i) => [s, i]);
    if (searchTokens.length) {
      order.sort((a, b) => (b[0]._searchScore ?? -Infinity) - (a[0]._searchScore ?? -Infinity));
    }

    order.forEach(([supplier, idx]) => {
      const visibleItems = supplier.items.filter(item =>
        (currentView === "ordered" ? item.status === "ordered" : item.status !== "ordered") &&
        (!searchTokens.length || item._match)
      );
      shownCount += visibleItems.length;
      if (currentView === "ordered") {
        // За замовчуванням відмічено, але можна зняти (перезаписуємо лише undefined)
        visibleItems.forEach(item => { if (item._selected === undefined) item._selected = true; });
      } else {
        visibleItems.forEach(item => { if (item._selected === undefined) item._selected = false; });
      }
      if (visibleItems.length === 0) return;
      const selectedItemsView = visibleItems.filter(i => i._selected);
      const anySelected = selectedItemsView.length > 0;

      const batches = {};
      const batchKey = (it) => currentView === "ordered" ? (it.batchId || "unsorted") : "current";
      visibleItems.forEach(item => {
        const key = batchKey(item);
        (batches[key] ||= []).push(item);
      });
      const batchEntries = Object.entries(batches).sort((a, b) => {
        const ta = Number(a[0].toString().split("-")[0]) || 0;
        const tb = Number(b[0].toString().split("-")[0]) || 0;
        return tb - ta;
      });

      const section = document.createElement("section");
      section.className = "glass-card is-static rise-in";
      section.style.animationDelay = `${Math.min(idx, 6) * 0.05}s`;
      supplier._printedBatches = supplier._printedBatches || [];
      supplier._ttnByBatch = supplier._ttnByBatch || {};
      const confirmPrintBtn = (!supplier._printed && supplier._printRequested)
        ? `<button class="confirm-print gbtn gbtn-on-dark text-[12px]"
                     data-index="${idx}" title="Підтвердити, що друк виконано">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M20 6 9 17l-5-5"/>
               </svg>
               Підтвердити друк
             </button>` : "";

      let html = "";
      if (currentView === "new") {
        html += `
          <div class="supplier-head">
              <div class="flex items-center gap-2.5 flex-wrap">
                <div class="supplier-name">${supplier.name}</div>
                <span class="selected-counter head-chip ${anySelected ? "" : "hidden"}">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                  Виділено ${selectedItemsView.length} шт
                </span>
              </div>
              <div class="inline-flex items-center gap-2">
                <button class="add-oneoff-btn gbtn gbtn-on-dark text-[12px] ${currentBrand === "png_druk" ? "" : "hidden"}"
                        data-supplier="${idx}" data-batch="" data-date="${visibleItems[0]?.dateOrder || ""}" title="Додати одноразовий товар">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Додати
                </button>
                <button class="mark-btn gbtn gbtn-icon ${anySelected ? "" : "hidden"}"
                                data-index="${idx}" title="Позначити замовлено" data-icon="${markIconIdx}">
                  ${renderMarkIcon(markIconIdx)}
                </button>
                <div class="icon-palette inline-flex gap-1"></div>
              ${confirmPrintBtn}
            </div>
          </div>
        `;
      }

      html += `<div class="space-y-3 p-3">`;
      html += batchEntries.map(([batchId, batchItems]) => {
        const grouped = {};
        batchItems.forEach(item => {
          grouped[item.orderNumber] = grouped[item.orderNumber] || [];
          grouped[item.orderNumber].push(item);
        });
        const firstItem = batchItems[0];
        const rawTime = firstItem?.raw?.updatedAt || firstItem?.raw?.createdAt || null;
        const fallbackDate = rawTime
          ? new Date(rawTime).toLocaleString("uk-UA")
          : (firstItem?.dateOrder && firstItem.dateOrder !== "-" ? firstItem.dateOrder : null);
        const tsPart = Number(batchId.toString().split("-")[0]);
        const tsMs = !Number.isNaN(tsPart) && tsPart > 0 ? tsPart * 60000 : null;
        const hasTs = !!tsMs;
        const batchLabel = batchId === "current"
          ? "Поточні"
          : batchId === "unsorted"
            ? (fallbackDate ? `Перенесено: ${fallbackDate}` : "Імпортовано")
            : hasTs
              ? new Date(tsMs).toLocaleString("uk-UA")
              : (fallbackDate ? `Перенесено: ${fallbackDate}` : `Партія ${batchId}`);
        const printed = supplier._printedBatches.includes(batchId);
        const showHeader = currentView === "ordered";
        const highlight = highlightBatch && highlightBatch.supplier === idx && highlightBatch.batchId === batchId;
        return `
          <div class="glass-soft overflow-hidden ${highlight ? "pulse-soft ring-emerald" : ""}">
            ${showHeader ? `
            <div class="supplier-head">
              <div class="flex items-center gap-2.5 flex-wrap">
                <div class="supplier-name">${supplier.name}</div>
                <span class="head-chip">${batchLabel}</span>
                <input type="text" class="ttn-input"
                       data-supplier="${idx}" data-batch="${batchId}" placeholder="ТТН" value="${supplier._ttnByBatch[batchId] || ""}">
              </div>
              <div class="flex items-center gap-2">
                <button class="add-oneoff-btn gbtn gbtn-on-dark text-[12px] ${currentBrand === "png_druk" ? "" : "hidden"}"
                        data-supplier="${idx}" data-batch="${batchId}" data-date="${firstItem?.dateOrder || fallbackDate || ""}" title="Додати одноразовий товар">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Додати
                </button>
                ${printed ? `<span class="head-chip">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg> Друковано</span>` : ""}
                <button class="print-btn gbtn gbtn-icon gbtn-on-dark ${currentView === "ordered" ? "" : "hidden"}"
                        data-index="${idx}" data-batch="${batchId}" title="Друк цієї партії">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor" aria-label="Print">
                    <path d="M7 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h-2V5H9v2H7V5Z"/>
                    <path d="M6 9h12a2 2 0 0 1 2 2v4H4v-4a2 2 0 0 1 2-2Z"/>
                    <path d="M7 15h10v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-4Z"/>
                    <path d="M10 18h4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>` : ""}
            <div class="table-wrap scroll-slim">
              <table class="glass-table">
                <thead>
                  <tr>
                    <th class="w-9 text-center">
                      <input type="checkbox" class="toggle-all styled-check mx-auto" data-index="${idx}" data-batch="${batchId}" ${batchItems.length>0 && batchItems.every(i => i._selected) ? "checked" : ""}>
                    </th>
                    ${columns.map(col => `<th>${col}</th>`).join("")}
                    <th class="w-9"></th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.keys(grouped).map((order, groupIdx) => {
                    const rows = grouped[order];
                    return `
                    <tr class="group-sep ${groupIdx === 0 ? "is-first" : ""}"><td colspan="${2 + columns.length}"></td></tr>
                    ${rows.map(item => {
                      const itemIdx = supplier.items.indexOf(item);
                      return `
                      <tr>
                        <td class="text-center row-lead">
                          <input type="checkbox" class="row-check styled-check" data-supplier="${idx}" data-item="${itemIdx}" ${item._selected ? "checked" : ""}>
                        </td>
                        <td>${item.dateOrder}</td>
                        <td>
                          <div class="flex items-center gap-2 group">
                            <a class="cell-link" href="${item.orderLink}" target="_blank" rel="noopener">${item.orderNumber}</a>
                            <button class="copy-btn" data-copy="${item.orderNumber}" title="Копіювати номер замовлення">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td>
                          ${photoImgTag(item.photo, "thumb-img")}
                        </td>
                        <td>
                          <div class="flex items-center gap-2 group flex-wrap">
                            <span>${highlightHits(item.productName, item._match?.name)}</span>
                            ${(() => {
                              // Уже списано зі складу — показуємо це замість «Є на складі»
                              const taken = getStockTaken(item);
                              if (taken > 0) {
                                return `<span class="badge badge-amber" title="Ці штуки взяті зі складу — шукати на складі, постачальник їх не везе">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>
                                    Зі складу: ${taken} шт
                                   </span>`;
                              }
                              const key = normalizeSku(item.sku);
                              const total = stockMap.get(key)?.quantity || 0;
                              if (total <= 0) return ""; // артикулу на складі немає взагалі
                              const alloc = stockAlloc.get(itemStockKey(item)) || 0;
                              if (alloc <= 0) {
                                // Склад є, але його вже розібрали інші рядки з цим артикулом
                                return `<span class="badge badge-slate" title="На складі всього ${total} шт цього артикулу — їх уже позначено під іншими замовленнями. На цей рядок складу не вистачає.">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>
                                    Склад зайнято (${total} шт)
                                   </span>`;
                              }
                              return `<span class="badge badge-emerald" title="Артикул є на складі">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                    Є на складі: ${alloc} шт
                                   </span>`;
                            })()}
                            <button class="copy-btn" data-copy="${item.productName}" title="Копіювати назву">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td>${item.quantity}</td>
                        <td>
                          <div class="flex items-center gap-2 group">
                            <span>${highlightHits(item.sku, item._match?.sku)}</span>
                            <button class="copy-btn" data-copy="${item.sku}" title="Копіювати артикул">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td class="font-semibold">
                          ${currentView === "ordered"
                            ? `<span class="badge badge-amber">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M3 13V6a1 1 0 0 1 1-1h9v8H3Z"></path>
                                  <path d="M13 8h3l3 3v3h-6V8Z"></path>
                                  <circle cx="7.5" cy="16.5" r="1.5"></circle>
                                  <circle cx="17.5" cy="16.5" r="1.5"></circle>
                                </svg>
                                В дорозі
                               </span>`
                            : `<span class="badge badge-emerald">Новий</span>`}
                          ${crmStatusBadge(item)}
                        </td>
                        <td class="text-center">
                          <button class="delete-item-btn icon-btn" data-row-id="${item.id ?? ''}" data-order-id="${item.orderNumber}" data-supplier="${idx}" data-item="${itemIdx}" title="Видалити товар">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 6h18"/>
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                      `;
                    }).join("")}
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join("");
      html += `</div>`;
      section.innerHTML = html;
      container.appendChild(section);
    });

    if (searchTokens.length && shownCount === 0) {
      container.innerHTML = `<div class="empty-state rise-in">
        Нічого не знайшлося за запитом «${searchQuery}».
      </div>`;
    }
    updateSearchCount(shownCount);

    document.querySelectorAll(".print-btn").forEach(btn =>
      btn.addEventListener("click", (e) => {
        const index = Number(e.currentTarget.dataset.index);
        const batch = e.currentTarget.dataset.batch || null;
        generatePdf(suppliers[index], batch);
      })
    );

    document.querySelectorAll(".delete-item-btn").forEach(btn =>
      btn.addEventListener("click", async (e) => {
        const orderId = e.currentTarget.dataset.orderId;
        const rowId = e.currentTarget.dataset.rowId;
        if (!rowId) { alert("Немає id рядка — онови сторінку і спробуй ще раз."); return; }
        if (!confirm(`Видалити цей товар із замовлення ${orderId}?`)) return;
        const row = e.currentTarget.closest("tr");
        try {
          row.style.opacity = "0.4";
          const resp = await fetch(`${deleteUrl}?id=${encodeURIComponent(rowId)}`);
          if (resp.ok) {
            row.style.transition = "opacity 0.3s";
            row.style.opacity = "0";
            setTimeout(() => row.remove(), 300);
          } else {
            row.style.opacity = "1";
            alert("Помилка видалення: " + resp.status);
          }
        } catch (err) {
          row.style.opacity = "1";
          alert("Помилка: " + err.message);
        }
      })
    );

    document.querySelectorAll(".mark-btn").forEach(btn =>
      btn.addEventListener("click", async (e) => {
        const sIdx = Number(e.currentTarget.dataset.index);
        const targetSupplier = suppliers[sIdx];
        let any = false;
        const now = Date.now();
        const windowMs = 60 * 1000;
        if (!targetSupplier._openBatch || (now - targetSupplier._openBatch.started) > windowMs) {
          targetSupplier._batchCounter = (targetSupplier._batchCounter || 0) + 1;
          const batchIdNew = `${now}-${targetSupplier._batchCounter}`;
          targetSupplier._openBatch = { id: batchIdNew, started: now };
        }
        const batchId = targetSupplier._openBatch.id;
        // Спершу збираємо обрані товари (статус ще не міняємо — раптом скасують у вікні складу)
        const changedItems = targetSupplier.items.filter(item => item._selected === true && item.status !== "ordered");
        if (changedItems.length === 0) {
          alert("Спочатку відміть товари для зміни статусу.");
          return;
        }
        // Питаємо, чи списати товар зі складу (лише для PNG druk, де є залишки)
        if (currentBrand === "png_druk") {
          const decision = await askStockUsage(changedItems);
          if (!decision.proceed) return; // скасовано — нічого не змінюємо
          if (decision.usage && decision.usage.length) {
            try {
              for (const u of decision.usage) {
                await setStockQuantity(u.stock, u.stock.quantity - u.use);
              }
              // Лишаємо слід, що ці рядки беруться зі складу
              const takenChanges = rememberStockTaken(changedItems, decision.usage);
              // Бекенд не критичний: якщо не записалось, лишається локальна позначка
              await pushStockTaken(takenChanges).catch(e =>
                console.warn("Не вдалося записати «взято зі складу» на бекенд", e));
            } catch (err) {
              alert(`Не вдалося списати зі складу: ${err.message}. Перенесення скасовано.`);
              return renderSuppliers();
            }
          }
        }
        // Тепер фіксуємо статус і батч
        changedItems.forEach(item => { item.status = "ordered"; item.batchId = batchId; });
        any = true;
        try {
          await updateStatus(changedItems, "ordered");
        } catch (err) {
          // відкочуємо
          changedItems.forEach(i => i.status = "new");
          alert(`Не вдалося оновити статуси на бекенді: ${err.message}`);
          return renderSuppliers();
        }
        targetSupplier.items.forEach(item => { item._selected = false; });
        renderSuppliers({ supplier: sIdx, batchId, animate: true });
      })
    );

    document.querySelectorAll(".toggle-all").forEach(cb =>
      cb.addEventListener("change", (e) => {
        const sIdx = Number(e.target.dataset.index);
        const checked = e.target.checked;
        const batch = e.target.dataset.batch;
        suppliers[sIdx].items
          .filter(item => {
            if (currentView === "ordered") {
              if (item.status !== "ordered") return false;
              if (batch) return (item.batchId ? item.batchId.toString() : "unsorted") === batch;
              return true;
            } else {
              return item.status !== "ordered";
            }
          })
          .forEach(item => { item._selected = checked; });
        renderSuppliers();
      })
    );

    document.querySelectorAll(".row-check").forEach(cb =>
      cb.addEventListener("change", (e) => {
        const sIdx = Number(e.target.dataset.supplier);
        const iIdx = Number(e.target.dataset.item);
        suppliers[sIdx].items[iIdx]._selected = e.target.checked;
        renderSuppliers();
      })
    );

    document.querySelectorAll(".ttn-input").forEach(input =>
      input.addEventListener("input", (e) => {
        const sIdx = Number(e.target.dataset.supplier);
        const batchId = e.target.dataset.batch;
        suppliers[sIdx]._ttnByBatch = suppliers[sIdx]._ttnByBatch || {};
        suppliers[sIdx]._ttnByBatch[batchId] = e.target.value.trim();
      })
    );

    document.querySelectorAll(".copy-btn").forEach(btn =>
      btn.addEventListener("click", async () => {
        const text = btn.dataset.copy;
        try {
          await navigator.clipboard.writeText(text);
          btn.classList.add("text-emerald-600");
          setTimeout(() => btn.classList.remove("text-emerald-600"), 800);
        } catch (e) {
          console.warn("Clipboard error", e);
        }
      })
    );

    attachPreviewHandlers();
    hydratePhotos(container);
  }

  async function generatePdf(supplier, batchId = null) {
    try {
      const debugInfo = supplier.items.map(i => ({
        id: i.id,
        order: i.orderNumber,
        status: i.status,
        batch: i.batchId,
        selected: i._selected
      }));
      const selectedItems = supplier.items.filter(i => {
        if (batchId) {
          // для batchId "unsorted" беремо ті, що без batchId
          const matchesUnsorted = batchId === "unsorted" && !i.batchId;
          return i.status === "ordered" && (i.batchId === batchId || matchesUnsorted) && i._selected === true;
        }
        return i._selected === true;
      });
      console.groupCollapsed(`[PDF] ${supplier.name} batch=${batchId || "all"}`);
      console.log("Всього товарів:", supplier.items.length, "Обрано:", selectedItems.length);
      if (batchId) {
        const dropped = debugInfo.filter(i => !(i.status === "ordered" && (i.batch === batchId || (batchId === "unsorted" && !i.batch)) && i.selected));
        console.log("Пропущені для batch:", dropped.slice(0, 10));
      } else {
        const dropped = debugInfo.filter(i => !i.selected);
        console.log("Не вибрані:", dropped.slice(0, 10));
      }
      console.groupEnd();
      if (selectedItems.length === 0) {
        alert("Немає відмічених товарів для друку.");
        return;
      }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    loadRoboto(doc);
    const createdAt = new Date().toLocaleDateString("uk-UA");
    const ttnValue = batchId ? (supplier._ttnByBatch && supplier._ttnByBatch[batchId]) : null;

    let headerBottom = 24;
    // QR для бек-вебхука: статус "received" + id вибраних товарів
    const qrY = 32;
    let qrBottom = qrY;
    const idsForQr = selectedItems.map(i => i.id || i.orderNumber || i.sku).filter(Boolean);
    const orderDateParam =
      (selectedItems[0]?.dateOrder && selectedItems[0].dateOrder !== "-")
        ? selectedItems[0].dateOrder
        : (selectedItems[0]?.raw?.OrderDate
            ? new Date(selectedItems[0].raw.OrderDate).toISOString().slice(0,10)
            : "");
      if (idsForQr.length) {
        const confirmBase = "https://canedius.github.io/PNG-purchase/confirm.html";
        const query = `status=received&supplier=${encodeURIComponent(supplier.name)}&` +
                      idsForQr.map(id => `ids[]=${encodeURIComponent(id)}`).join("&") +
                      (orderDateParam ? `&date=${encodeURIComponent(orderDateParam)}` : "");
        const targetUrl = `${confirmBase}?${query}`;
      const pageWidth = doc.internal.pageSize.getWidth();
      const placeQr = (dataUrl) => {
        const qrSize = 105;
        doc.addImage(dataUrl, "PNG", pageWidth - (qrSize + 24), qrY, qrSize, qrSize);
        qrBottom = qrY + qrSize;
      };
      let qrDone = false;
      // Пробуємо бібліотеку QRCode
      if (window.QRCode && typeof QRCode.toDataURL === "function") {
        try {
          const qrData = await QRCode.toDataURL(targetUrl, { margin: 2, width: 140, errorCorrectionLevel: "L" });
          placeQr(qrData);
          qrDone = true;
        } catch (e) {
          console.warn("QR generate failed (QRCode)", e);
        }
      }
      // Фолбек на qrcode-generator (window.qrcode)
      if (!qrDone && window.qrcode && typeof window.qrcode === "function") {
        try {
          const qr = window.qrcode(0, "M");
          qr.addData(targetUrl);
          qr.make();
          const qrData = qr.createDataURL(5);
          placeQr(qrData);
          qrDone = true;
        } catch (e) {
          console.warn("QR generate failed (qrcode-generator)", e);
        }
      }
    }

    doc.setFontSize(18);
    doc.setFont(fontReady ? "Roboto" : "helvetica", "bold");
    headerBottom = Math.max(headerBottom, qrBottom);
    const line1Y = 44; // стабільна висота шапки
    doc.text("Прибуткова накладна", 40, line1Y);
    doc.setFontSize(12);
    doc.setFont(fontReady ? "Roboto" : "helvetica", "bold");
    doc.text(`Постачальник: ${supplier.name}`, 40, line1Y + 18);
    doc.setFontSize(11);
    doc.setFont(fontReady ? "Roboto" : "helvetica", "normal");
    doc.text(`Дата створення: ${createdAt}`, 40, line1Y + 34);
    if (ttnValue) {
      doc.text(`ТТН: ${ttnValue}`, 40, line1Y + 50);
    }

    const barcodeMap = new Map();
    const photoMap = new Map(); // key: original url | placeholder -> {data, format}
    const groupedForPdf = {};
    selectedItems.forEach(item => {
      (groupedForPdf[item.orderNumber] ||= []).push(item);
      if (!barcodeMap.has(item.orderNumber)) {
        const canvas = document.createElement("canvas");
        try {
          JsBarcode(canvas, item.orderNumber, { format: "CODE128", displayValue: false, height: 40, margin: 0 });
          barcodeMap.set(item.orderNumber, canvas.toDataURL("image/png"));
        } catch (e) {
          console.warn("Barcode encode error", e);
        }
      }
      const photoKey = item.photo || defaultPhoto;
      if (!photoMap.has(photoKey)) photoMap.set(photoKey, null);
    });

    const placeholderEntry = { data: defaultPhoto, format: "PNG", ratio: 1 };
    // Перевіряємо чи зображення валідне і конвертуємо в JPEG через canvas
    // (jsPDF PNG-декодер може зависнути на битих файлах, JPEG — безпечніший)
    const validateImage = (dataUrl) => new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ""; resolve(null); }, 2500);
      img.onload = () => {
        clearTimeout(timer);
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          try {
            const cvs = document.createElement("canvas");
            cvs.width = img.naturalWidth;
            cvs.height = img.naturalHeight;
            const ctx = cvs.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, cvs.width, cvs.height);
            ctx.drawImage(img, 0, 0);
            const jpegData = cvs.toDataURL("image/jpeg", 0.85);
            resolve({ data: jpegData, format: "JPEG", ratio: img.naturalWidth / img.naturalHeight });
          } catch (e) {
            resolve(null); // canvas tainted або інша помилка
          }
        } else {
          resolve(null); // битий — 0×0
        }
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = dataUrl;
    });
    const toDataUrl = async (url) => {
      if (!url) return placeholderEntry;
      if (url.startsWith("data:image/")) {
        const v = await validateImage(url);
        if (!v) return placeholderEntry;
        return { data: v.data, format: v.format, ratio: v.ratio };
      }
      // Спершу локальний кеш — тоді PDF будується без мережі
      const cached = await photoCacheGet(url);
      if (cached?.blob) {
        try {
          const v = await validateImage(await blobToDataUrl(cached.blob));
          if (v) return { data: v.data, format: v.format, ratio: v.ratio };
        } catch (e) {}
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort("timeout"), 4000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const contentType = resp.headers.get("content-type") || "";
        if (!resp.ok || !contentType.startsWith("image/")) throw new Error("not image");
        const blob = await resp.blob();
        if (blob.size < 50) throw new Error("too small");
        photoCachePut(url, blob); // заодно кладемо в кеш для наступних разів
        const dataUrl = await blobToDataUrl(blob);
        const v = await validateImage(dataUrl);
        if (!v) return placeholderEntry; // битий файл — підставляємо placeholder
        return { data: v.data, format: v.format, ratio: v.ratio };
      } catch (e) {
        return placeholderEntry;
      }
    };
    for (const key of photoMap.keys()) {
      const val = await toDataUrl(key);
      photoMap.set(key, val);
    }

    const groups = Object.entries(groupedForPdf);
    const drawnBarcodes = new Set();
    let currentY = Math.max(headerBottom + 16, line1Y + (ttnValue ? 70 : 54)); // відступ під шапкою і QR
    const pageHeight = doc.internal.pageSize.getHeight();
    groups.forEach(([orderNum, items], idxGroup) => {
      const groupBody = [];
      const dateLabel = items[0]?.dateOrder && items[0].dateOrder !== "-" ? ` від ${items[0].dateOrder}` : "";
      groupBody.push([{
        content: `Замовлення ${orderNum}${dateLabel}`,
        colSpan: pdfColumns.length,
        styles: {
          fillColor: [225, 239, 254],
          textColor: [37, 99, 235],
          fontStyle: "bold",
          halign: "left",
          cellPadding: { top: 6, bottom: 6, left: 6, right: 2 },
          minCellHeight: 0
        }
      }]);
      const MIN_H = 110;
      const seen = new Set();
      items.forEach((item, idx) => {
        const firstInGroup = idx === 0 && !seen.has(orderNum);
        if (firstInGroup) seen.add(orderNum);
        const photoVal = item.photo || defaultPhoto;
        groupBody.push([
          item.productName,
          { image: photoVal },
          item.quantity,
          item.sku,
          firstInGroup ? { content: "", orderCode: orderNum, rowSpan: items.length, styles: { halign: "center", valign: "middle", minCellHeight: MIN_H } } : null
        ]);
      });

      const estimatedHeight = (groupBody.length + 1) * 22 + 12;
      if (currentY + estimatedHeight > pageHeight - 40) {
        doc.addPage();
        currentY = 40;
      }

      doc.autoTable({
        startY: currentY,
        head: [pdfColumns],
        body: groupBody,
        styles: { fontSize: 10, font: fontReady ? "Roboto" : "helvetica", overflow: "linebreak", cellPadding: 6, cellWidth: "auto" },
        bodyStyles: { minCellHeight: MIN_H },
        headStyles: { fillColor: [79, 70, 229], textColor: 255, font: fontReady ? "Roboto" : "helvetica", fontStyle: "bold" },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        margin: { left: 20, right: 20, top: 12, bottom: 14 },
        tableWidth: 'auto',
        columnStyles: {
          0: { cellWidth: 150, valign: "middle" },
          1: { cellWidth: 120, halign: "center", minCellHeight: 110, valign: "middle" },
          2: { halign: "center", valign: "middle" },
          3: { halign: "center", valign: "middle" },
          4: { halign: "center", valign: "middle" }
        },
        didDrawCell: function(data) {
          if (data.row.raw && data.row.raw[0] && data.row.raw[0].colSpan) return;
          // Фото
          if (data.section === "body" && data.column.index === 1) {
            const raw = data.row.raw?.[1];
            const url = raw?.image || raw;
            const imgEntry = photoMap.get(url) || placeholderEntry;
            data.cell.text = [""]; // прибираємо будь‑який текст/лінк
            if (!imgEntry?.data || imgEntry.data.length < 20) return;
            // Заливаємо фон білим, щоб перекрити можливий текст
            doc.setFillColor(255, 255, 255);
            doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, "F");
            const maxW = Math.min(100, data.cell.width - 10);
            const maxH = Math.min(100, data.cell.height - 10);
            const ratio = imgEntry.ratio || 1;
            let w, h;
            if (ratio >= 1) {
              w = maxW;
              h = Math.min(maxH, w / ratio);
            } else {
              h = maxH;
              w = Math.min(maxW, h * ratio);
            }
            const x = data.cell.x + (data.cell.width - w) / 2;
            const y = data.cell.y + (data.cell.height - h) / 2;
            try {
              // Використовуємо JPEG формат — jsPDF краще обробляє і не зависає на битих PNG
              const safeFormat = imgEntry.format === "JPEG" ? "JPEG" : "PNG";
              doc.addImage(imgEntry.data, safeFormat, x, y, w, h);
            } catch (e) {
              console.warn("Photo addImage failed, using placeholder", e);
              try { doc.addImage(defaultPhoto, "PNG", x, y, w, h); } catch (_) {}
            }
            return;
          }
          // Штрихкод
          if (data.section === "body" && data.column.index === pdfColumns.length - 1) {
            if (data.cell.raw === null) return;
            if (data.cell.raw && data.cell.raw.content === undefined && data.cell.raw.rowSpan === undefined && data.cell.raw.orderCode === undefined) return;
            const code = (data.cell.raw?.orderCode || data.cell.raw?.content || data.cell.raw || "").toString().trim();
            data.cell.text = [""];
            if (code && !barcodeMap.has(code)) {
              const canvas = document.createElement("canvas");
              try {
                JsBarcode(canvas, code, { format: "CODE128", displayValue: false, height: 40, margin: 0 });
                barcodeMap.set(code, canvas.toDataURL("image/png"));
              } catch (e) {
                console.warn("Barcode fallback error", e);
              }
            }
            const img = barcodeMap.get(code);
            const BAR_W = 120;
            const BAR_H = 42;
            const TEXT_GAP = 6;
            if (img && !drawnBarcodes.has(code)) {
              const drawWidth = Math.min(BAR_W, data.cell.width - 6);
              const drawHeight = Math.min(BAR_H, data.cell.height * 0.4);
              const totalContentH = drawHeight + 12;
              const x = data.cell.x + (data.cell.width - drawWidth) / 2;
              const y = data.cell.y + (data.cell.height - totalContentH) / 2;
              try {
                doc.addImage(img, "PNG", x, y, drawWidth, drawHeight);
              } catch (e) {
                console.warn("Barcode addImage failed", e);
              }
              const prevSize = doc.getFontSize();
              const prevColor = doc.getTextColor();
              doc.setFontSize(8);
              doc.setTextColor(0, 0, 0);
              doc.text(code, data.cell.x + data.cell.width / 2, y + drawHeight + 8, { align: "center" });
              doc.setFontSize(prevSize);
              doc.setTextColor(prevColor);
              drawnBarcodes.add(code);
            }
            data.cell.text = [""];
          }
        },
        rowPageBreak: "avoid"
      });
      currentY = doc.lastAutoTable.finalY + 10;
    });

    const summaryY = doc.lastAutoTable.finalY + 30;
    doc.setFontSize(12);
    doc.text(`Усього позицій: ${selectedItems.length}`, 40, summaryY);

      const blob = doc.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      printFrame.onload = () => {
        try {
          printFrame.contentWindow.focus();
          printFrame.contentWindow.print();
        } catch (e) {
          console.warn("iframe print() failed, opening in new tab", e);
          window.open(blobUrl);
        }
        const key = String(supplier.key || supplier.name);
        const entry = printedStore[key] || { all: false, batches: [] };
        if (batchId) {
          if (!entry.batches.includes(batchId)) entry.batches.push(batchId);
          if (!supplier._printedBatches.includes(batchId)) supplier._printedBatches.push(batchId);
        } else {
          entry.all = true;
          supplier._printed = true;
        }
        printedStore[key] = entry;
        savePrintedStore(printedStore);
        supplier._printRequested = false;
        renderSuppliers();
      };
      printFrame.src = blobUrl;
    } catch (err) {
      console.error("generatePdf error", err);
      alert("Помилка генерації PDF (див. консоль).");
    }
  }

  // Стан завантаження — щоб автооновлення не накладалось на ручне
  let isLoading = false;
  let lastLoadedAt = 0;
  let loadSeq = 0; // номер запиту: відповідь від застарілого не малюємо

  // silent: перечитуємо дані без спінера, не блимаючи вже показаною таблицею
  async function loadData({ silent = false } = {}) {
    if (isLoading && silent) return; // тихе оновлення поступається ручному
    const seq = ++loadSeq;
    isLoading = true;
    // ТТН живе лише в пам'яті — рятуємо його від перебудови suppliers
    const ttnBackup = new Map(suppliers.map(s => [String(s.key || s.name), s._ttnByBatch || {}]));
    if (!silent) {
      container.innerHTML = `<div class="empty-state flex flex-col items-center gap-3">
        <div class="spinner"></div>
        <div class="text-sm font-medium">Завантажую дані...</div>
      </div>`;
    }
    try {
      const statusParam = currentView === "ordered" ? "ordered" : "to_buy";
      const otherParam = currentView === "ordered" ? "to_buy" : "ordered";
      // Залишки тягнемо паралельно (лише для PNG druk), щоб бейджі були готові до рендеру
      const stockPromise = currentBrand === "png_druk" ? loadStock() : Promise.resolve(stockMap.clear());
      const resp = await fetch(`${dataUrl}?status=${encodeURIComponent(statusParam)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rawText = await resp.text();
      if (seq !== loadSeq) return; // поки чекали, стартував новіший запит
      let rows = [];
      if (rawText && rawText.trim().length) {
        try {
          rows = JSON.parse(rawText);
        } catch (e) {
          throw new Error("Неможливо розпарсити JSON");
        }
      } else {
        rows = [];
      }
      const allowed = BRAND_TAGS[currentBrand] || new Set();
      const keepRow = (r) => r &&
        (r.OrderID != null && r.OrderID !== "") &&
        (r.SKU || r.ProductName) &&
        allowed.has(r.company_tag);
      if (Array.isArray(rows)) {
        rows = rows.filter(keepRow);
        rememberSkuPhotos(rows);
      }
      // Друга вкладка потрібна лише для розподілу складу — падіння запиту не критичне
      const otherRows = await fetch(`${dataUrl}?status=${encodeURIComponent(otherParam)}`)
        .then(r => (r.ok ? r.json() : []))
        .then(list => (Array.isArray(list) ? list.filter(keepRow) : []))
        .catch(() => []);
      if (seq !== loadSeq) return;
      rememberSkuPhotos(otherRows);
      allBrandRows = [...(Array.isArray(rows) ? rows : []), ...otherRows];
      if (!Array.isArray(rows) || rows.length === 0) {
        const msg = currentView === "ordered"
          ? "Замовлених товарів поки немає."
          : "Товарів для замовлення поки немає.";
        container.innerHTML = `<div class="empty-state rise-in">
          ${msg}
        </div>`;
        if (typeof refreshOneOffSuppliers === "function") refreshOneOffSuppliers();
        return;
      }

      const bySupplier = {};
      rows.forEach(row => {
      const supplierName = (row.SupplierName && row.SupplierName.trim()) ? row.SupplierName.trim() : "Невідомий постачальник";
      if (!bySupplier[supplierName]) bySupplier[supplierName] = { name: supplierName, key: (row.SupplierID || supplierName), items: [] };
      const dateIso = row.OrderDate ? new Date(row.OrderDate).toISOString().slice(0,10) : "";
      const status = row.procurement_status === "ordered" ? "ordered" : "new";
      const orderKey = row.OrderID != null ? String(row.OrderID) : "";
      let batchId = row.batchId || (orderKey && oneOffBatches[orderKey]) || null;
      if (status === "ordered" && !batchId) {
        const ts = row.updatedAt || row.createdAt || row.OrderDate;
        batchId = ts ? Math.floor(new Date(ts).getTime() / 60000).toString() : "unsorted";
      }
      bySupplier[supplierName].items.push({
        id: row.id ?? null,
        dateOrder: dateIso || "-",
        orderNumber: String(row.OrderID),
        productName: row.ProductName || "",
          sku: row.SKU || "",
          quantity: row.Quantity || 0,
          purchasePrice: row.PurchasePrice || 0,
          barcode: row.OrderID ? String(row.OrderID) : "",
          orderLink: row.OrderLink || "#",
          photo: row.photo || null,
          orderStatus: row.order_status || "",
          orderStatusGroup: row.order_status_group ?? null,
          status,
          batchId,
          raw: row
        });
      });
      suppliers = Object.values(bySupplier);
      // Новіші (за останнім оновленням серед товарів) показуємо першими
      suppliers.sort((a, b) => {
        const lastA = Math.max(...a.items.map(i => new Date(i.raw?.updatedAt || i.raw?.createdAt || i.raw?.OrderDate || 0).getTime() || 0));
        const lastB = Math.max(...b.items.map(i => new Date(i.raw?.updatedAt || i.raw?.createdAt || i.raw?.OrderDate || 0).getTime() || 0));
        return lastB - lastA;
      });
      // Відновлюємо відмітки "Друковано" та введені ТТН по ключу постачальника
      suppliers.forEach(s => {
        const key = String(s.key || s.name);
        const saved = printedStore[key];
        if (saved) {
          s._printed = !!saved.all;
          s._printedBatches = Array.isArray(saved.batches) ? [...saved.batches] : [];
        }
        const ttn = ttnBackup.get(key);
        if (ttn) s._ttnByBatch = { ...ttn };
      });
      await stockPromise;
      renderSuppliers();
    } catch (e) {
      console.error("Fetch error", e);
      // Тихе оновлення не має зносити вже показану таблицю через мережевий збій
      if (!silent) {
        container.innerHTML = `<div class="empty-state is-error rise-in">
          Не вдалося завантажити дані (${e.message}). Перевірте вебхук.
        </div>`;
      }
    } finally {
      isLoading = false;
      lastLoadedAt = Date.now();
      updateAutoChip();
    }
  }

  async function updateStatus(items, newStatus) {
    if (!items.length) return;
    // Надсилаємо у форматі, як приходить з бекенду, але з оновленим статусом
    const payload = items.map(i => ({
      ...(i.raw || {}),
      procurement_status: newStatus
    }));
    const resp = await fetch(updateUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} ${text}`);
    }
  }

  function setTabState(view) {
    currentView = view;
    try { localStorage.setItem("tabView", view); } catch (e) {}
    if (oneOffModal) {
      // Модалка відкривається лише по кнопці, але прихована за замовчуванням
      oneOffModal.classList.add("hidden");
    }
    // «Прийом» — окрема вкладка зі своїми даними (receipt.js), закупівлі на цей час ховаємо
    const isReceipt = view === "receipt";
    tabReceipt?.classList.toggle("is-active", isReceipt);
    document.getElementById("boxIcon")?.classList.toggle("text-emerald-500", isReceipt);
    document.getElementById("boxIcon")?.classList.toggle("text-slate-400", !isReceipt);
    container.classList.toggle("hidden", isReceipt);
    searchShell?.classList.toggle("hidden", isReceipt);
    autoChip?.classList.toggle("hidden", isReceipt);
    if (isReceipt) {
      tabAll.className = "tab-btn";
      tabOrdered.className = "tab-btn";
      document.getElementById("flameIcon")?.classList.remove("flame-active", "text-rose-500");
      document.getElementById("flameIcon")?.classList.add("text-slate-400");
      document.getElementById("clockIcon")?.classList.remove("clock-active", "text-amber-500");
      document.getElementById("clockIcon")?.classList.add("text-slate-400");
      updateSummaryBtn();
      window.ReceiptTab?.show();
      return;
    }
    window.ReceiptTab?.hide();
    if (view === "new") {
      tabAll.className = "tab-btn is-active";
      tabOrdered.className = "tab-btn";
      document.getElementById("flameIcon")?.classList.add("flame-active");
      document.getElementById("flameIcon")?.classList.remove("text-slate-400");
      document.getElementById("flameIcon")?.classList.add("text-rose-500");
      document.getElementById("clockIcon")?.classList.remove("clock-active","text-amber-500");
      document.getElementById("clockIcon")?.classList.add("text-slate-400");
    } else {
      tabOrdered.className = "tab-btn is-active";
      tabAll.className = "tab-btn";
      document.getElementById("flameIcon")?.classList.remove("flame-active");
      document.getElementById("flameIcon")?.classList.remove("text-rose-500");
      document.getElementById("flameIcon")?.classList.add("text-slate-400");
      document.getElementById("clockIcon")?.classList.add("clock-active","text-amber-500");
      document.getElementById("clockIcon")?.classList.remove("text-slate-400");
    }
    updateSummaryBtn();
    loadData();
  }

  tabAll.addEventListener("click", () => setTabState("new"));
  tabOrdered.addEventListener("click", () => setTabState("ordered"));
  tabReceipt?.addEventListener("click", () => setTabState("receipt"));

  function setBrand(brand, { load = true } = {}) {
    if (!BRAND_TAGS[brand]) return;
    currentBrand = brand;
    try { localStorage.setItem("brand", brand); } catch (e) {}
    [brandPngDruk, brandPngStudio].forEach(btn => {
      if (!btn) return;
      btn.classList.toggle("is-active", btn.dataset.brand === brand);
    });
    // Вкладки Поточні/Замовлено працюють для обох брендів (PNG druk і PNG studio)
    if (tabsBar) tabsBar.classList.remove("hidden");
    // Склад і одноразові товари — лише для PNG druk
    if (addSupplierBtn) addSupplierBtn.classList.toggle("hidden", brand !== "png_druk");
    const stockBtnEl = document.getElementById("stockBtn");
    if (stockBtnEl) stockBtnEl.classList.toggle("hidden", brand !== "png_druk");
    updateSummaryBtn();
    if (load) loadData();
  }
  brandPngDruk?.addEventListener("click", () => setBrand("png_druk"));
  brandPngStudio?.addEventListener("click", () => setBrand("png_studio"));

  // === Модалка одноразового товару ===
  function openOneOffModal(supplierIndex, batchId, dateDefault) {
    if (!oneOffModal) return;
    oneOffTarget = { supplier: supplierIndex, batch: batchId || null, date: dateDefault || null };
    mOrder.value = "";
    mName.value = "";
    mQty.value = 1;
    mSku.value = "";
    if (mPhotoFile) mPhotoFile.value = "";
    mMsg.textContent = "";
    if (mSupplierWrap) {
      const isNewSupplier = supplierIndex === null || supplierIndex === undefined;
      mSupplierWrap.classList.toggle("hidden", !isNewSupplier);
      if (mSupplier && isNewSupplier) mSupplier.value = "";
    }
    oneOffModal.classList.remove("hidden");
  }
  function closeOneOffModal() {
    if (!oneOffModal) return;
    oneOffModal.classList.add("hidden");
  }
  function fileToDataUrl(inputEl) {
    return new Promise((resolve) => {
      if (!inputEl || !inputEl.files || !inputEl.files[0]) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(inputEl.files[0]);
    });
  }

  async function uploadToImgbb(dataUrl) {
    if (!dataUrl) return null;
    try {
      const base64 = dataUrl.split(",")[1] || dataUrl;
      const form = new FormData();
      form.append("image", base64);
      const resp = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
        method: "POST",
        body: form
      });
      const json = await resp.json();
      if (json && json.data && json.data.url) return json.data.url;
    } catch (e) {
      console.warn("imgbb upload failed", e);
    }
    return null;
  }

  async function saveOneOff() {
    mMsg.textContent = "";
    const sIdx = oneOffTarget.supplier;
    let supplier = null;
    if (sIdx === null || sIdx === undefined) {
      const supName = (mSupplier?.value || "").trim();
      if (!supName) {
        mMsg.textContent = "Вкажіть постачальника.";
        return;
      }
      supplier = suppliers.find(s => s.name === supName);
      if (!supplier) {
        supplier = { name: supName, key: supName, items: [], _printedBatches: [], _ttnByBatch: {} };
        suppliers.push(supplier);
      }
    } else {
      supplier = suppliers[sIdx];
      if (!supplier) return closeOneOffModal();
    }
    const orderNumber = (mOrder.value || "").trim();
    const productName = (mName.value || "").trim();
    if (!orderNumber || !productName) {
      mMsg.textContent = "Вкажіть номер замовлення і назву товару.";
      return;
    }
    if (!/^\d+$/.test(orderNumber)) {
      mMsg.textContent = "Номер замовлення має містити лише цифри.";
      return;
    }
    const batchNumeric = oneOffTarget.batch ? Number(oneOffTarget.batch) : null;
    let dateOrder = oneOffTarget.date || "";
    // якщо дати нема, беремо її з batchId (число-хвилини)
    if (!dateOrder && oneOffTarget.batch && !Number.isNaN(batchNumeric)) {
      const dt = new Date(batchNumeric * 60000);
      dateOrder = dt.toISOString().slice(0, 10);
    }
    if (!dateOrder) dateOrder = new Date().toISOString().slice(0,10);
    let timestamp = `${dateOrder}T00:00:00.000Z`;
    if (oneOffTarget.batch && !Number.isNaN(batchNumeric)) {
      const dt = new Date(batchNumeric * 60000);
      timestamp = dt.toISOString();
    }
    const qty = Number(mQty.value) > 0 ? Number(mQty.value) : 1;
    const status = oneOffTarget.batch ? "ordered" : "new";
    const photoDataUrl = await fileToDataUrl(mPhotoFile);
    const photoUrl = await uploadToImgbb(photoDataUrl);
    const newItem = {
      id: null,
      dateOrder,
      orderNumber,
      productName,
      sku: (mSku.value || "").trim(),
      quantity: qty,
      purchasePrice: 0,
      barcode: orderNumber,
      orderLink: `${orderLinkBase}${orderNumber}`,
      photo: photoUrl || photoDataUrl,
      status,
      batchId: oneOffTarget.batch,
      _selected: status === "ordered",
      raw: { OrderDate: timestamp, createdAt: timestamp, updatedAt: timestamp, batchId: oneOffTarget.batch }
    };
    supplier.items.unshift(newItem);
    const batchKeyToStore = oneOffTarget.batch
      ? oneOffTarget.batch
      : (oneOffTarget.batch === "unsorted"
        ? "unsorted"
        : (batchNumeric !== null && !Number.isNaN(batchNumeric) ? batchNumeric.toString() : null));
    if (batchKeyToStore) {
      oneOffBatches[String(orderNumber)] = batchKeyToStore;
      saveOneOffBatches(oneOffBatches);
    }
    // надсилаємо на бек
    try {
      const orderIdNum = Number(orderNumber);
      const supplierIdNum = Number(supplier.key);
      const supplierIdPayload = Number.isFinite(supplierIdNum) ? supplierIdNum : null;
      const payload = {
        OrderDate: timestamp,
        OrderID: Number.isFinite(orderIdNum) ? orderIdNum : orderNumber,
        ProductName: productName,
        SKU: newItem.sku,
        Quantity: qty,
        PurchasePrice: 0,
        SupplierName: supplier.name,
        SupplierID: supplierIdPayload,
        OrderLink: newItem.orderLink,
        procurement_status: status === "ordered" ? "ordered" : "to_buy",
        photo: photoUrl || null,
        createdAt: timestamp,
        updatedAt: timestamp,
        batchId: oneOffTarget.batch || null
      };
      await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn("Create one-off failed", err);
      mMsg.textContent = "Не вдалося відправити на бекенд, товар додано лише локально.";
    }
    closeOneOffModal();
    renderSuppliers({ supplier: sIdx, batchId: oneOffTarget.batch, animate: true });
  }
  if (mSave) mSave.addEventListener("click", saveOneOff);
  if (mCancel) mCancel.addEventListener("click", closeOneOffModal);
  if (mClose) mClose.addEventListener("click", closeOneOffModal);
  if (oneOffModal) {
    oneOffModal.addEventListener("click", (e) => {
      if (e.target === oneOffModal) closeOneOffModal();
    });
  }
  if (addSupplierBtn) {
    addSupplierBtn.addEventListener("click", () => {
      const today = new Date().toISOString().slice(0, 10);
      openOneOffModal(null, null, today);
    });
  }

  // Кнопки "Додати" біля тасок
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".add-oneoff-btn");
    if (addBtn) {
      const sIdx = Number(addBtn.dataset.supplier);
      const batch = addBtn.dataset.batch || null;
      const date = addBtn.dataset.date || null;
      openOneOffModal(sIdx, batch, date);
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".confirm-print");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    suppliers[idx]._printed = true;
    const key = String(suppliers[idx].key || suppliers[idx].name);
    const entry = printedStore[key] || { all: false, batches: [] };
    entry.all = true;
    printedStore[key] = entry;
    savePrintedStore(printedStore);
    suppliers[idx]._printRequested = false;
    renderSuppliers();
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    const btn = document.getElementById("refreshBtn");
    const prev = btn.innerHTML; // саме innerHTML — інакше губиться іконка в кнопці
    btn.innerHTML = "Оновлюю...";
    btn.disabled = true;
    try {
      await fetch("https://primary-production-eeb3.up.railway.app/webhook/08aca309-7ad4-460c-9610-a242e3c43789", { method: "POST" });
      await loadData();
    } catch (e) {
      alert("Не вдалося оновити дані з CRM.");
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = prev;
    }
  });

  // === Поле пошуку ===
  function updateSearchCount(shown) {
    if (!searchCount) return;
    searchCount.textContent = searchTokens.length ? `${shown}` : "";
    searchCount.classList.toggle("hidden", !searchTokens.length);
    searchShell?.classList.toggle("is-empty", searchTokens.length > 0 && shown === 0);
  }

  function applySearch(value) {
    clearTimeout(searchTimer);
    searchQuery = value.trim();
    searchTokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    searchClear?.classList.toggle("hidden", !searchQuery);
    searchShell?.classList.toggle("is-active", !!searchQuery);
    searchShell?.classList.remove("is-pending");
    renderSuppliers();
  }

  // Кожен рендер перемальовує всю таблицю, тож не женемось за кожною літерою:
  // чекаємо паузу в наборі. Очищення й Enter застосовуємо миттєво — там
  // користувач уже знає, чого хоче, і затримка тільки дратує.
  const SEARCH_DEBOUNCE_MS = 250;
  let searchTimer = null;

  function scheduleSearch(value, delay = SEARCH_DEBOUNCE_MS) {
    clearTimeout(searchTimer);
    if (value.trim() === searchQuery) return; // нормалізований запит той самий — рендер нічого не змінить
    searchShell?.classList.add("is-pending");
    if (!delay) return applySearch(value);
    searchTimer = setTimeout(() => applySearch(value), delay);
  }

  searchInput?.addEventListener("input", (e) => {
    const value = e.target.value;
    scheduleSearch(value, value.trim() ? SEARCH_DEBOUNCE_MS : 0);
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scheduleSearch(e.currentTarget.value, 0);
  });

  searchClear?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    applySearch("");
    searchInput?.focus();
  });

  // «/» — стрибок у пошук, Esc — очистити
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (e.key === "Escape" && document.activeElement === searchInput) {
      if (searchInput) searchInput.value = "";
      applySearch("");
      searchInput?.blur();
    }
  });

  // === Автооновлення ===
  // Раз на хвилину тихо перечитуємо закупівлю. Сторінку не перезавантажуємо —
  // оновлюються лише дані, тож нічого не блимає і скрол лишається на місці.
  const AUTO_REFRESH_MS = 60 * 1000;

  const anythingSelected = () => suppliers.some(s => s.items.some(i => i._selected));
  const modalOpen = () => !!document.querySelector(".modal-backdrop:not(.hidden)");
  const isTyping = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

  // Не чіпаємо сторінку, поки користувач із нею працює
  function autoRefreshBlocked() {
    return isLoading || modalOpen() || isTyping() || anythingSelected();
  }

  function updateAutoChip() {
    if (!autoChip || !autoChipText) return;
    const paused = autoRefreshBlocked() && !isLoading;
    if (paused) {
      autoChipText.textContent = "оновлення на паузі";
    } else if (!lastLoadedAt) {
      autoChipText.textContent = "оновлюю…";
    } else {
      const mins = Math.floor((Date.now() - lastLoadedAt) / 60000);
      autoChipText.textContent = mins < 1 ? "оновлено щойно" : `оновлено ${mins} хв тому`;
    }
    autoChip.classList.toggle("is-paused", paused);
  }

  async function autoRefresh() {
    if (currentView === "receipt") return; // «Прийом» оновлюється сам (receipt.js)
    if (document.hidden || autoRefreshBlocked()) return updateAutoChip();
    autoChip?.classList.add("is-syncing");
    try {
      await loadData({ silent: true });
    } catch (e) {
      console.warn("Автооновлення не вдалося", e);
    } finally {
      autoChip?.classList.remove("is-syncing");
    }
  }

  setInterval(autoRefresh, AUTO_REFRESH_MS);
  setInterval(updateAutoChip, 15 * 1000);

  // Повернулись на вкладку — підтягуємо одразу, якщо дані вже застаріли
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoadedAt >= AUTO_REFRESH_MS) autoRefresh();
  });

  // === Модалка залишків на складі ===
  const stockBtn = document.getElementById("stockBtn");
  const stockModal = document.getElementById("stockModal");
  const stockClose = document.getElementById("stockClose");
  const stSku = document.getElementById("stSku");
  const stName = document.getElementById("stName");
  const stQty = document.getElementById("stQty");
  const stAdd = document.getElementById("stAdd");
  const stMsg = document.getElementById("stMsg");
  const stList = document.getElementById("stList");

  function renderStockList() {
    if (!stList) return;
    const items = [...stockMap.values()].filter(it => it.quantity > 0).sort((a, b) => a.sku.localeCompare(b.sku, "uk"));
    if (items.length === 0) {
      stList.innerHTML = `<div class="text-sm text-slate-400 text-center py-6">Поки що немає жодного артикулу на складі.</div>`;
      return;
    }
    stList.innerHTML = `
      <table class="glass-table">
        <thead>
          <tr>
            <th class="w-14">Фото</th>
            <th>Артикул</th>
            <th>Назва</th>
            <th class="w-20 text-center">К-сть</th>
            <th class="w-9"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>
                ${getSkuPhoto(it.sku)
                  ? photoImgTag(getSkuPhoto(it.sku), "thumb-img")
                  : `<div class="thumb-img thumb-empty" title="Фото не знайдено">
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                       </svg>
                     </div>`}
              </td>
              <td class="font-semibold text-slate-800">${it.sku}</td>
              <td class="text-slate-600">${it.name || "<span class='text-slate-300'>—</span>"}</td>
              <td class="text-center">
                <span class="inline-flex items-center gap-1">
                  <input type="number" min="0" value="${it.quantity}" data-sku="${it.sku}"
                    class="st-qty gfield gfield-emerald w-16 text-center text-emerald-700 font-semibold">
                  <span class="text-[11px] text-slate-400">шт</span>
                </span>
              </td>
              <td class="text-center">
                <button class="st-del icon-btn" data-sku="${it.sku}" title="Видалити зі складу">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;
    attachPreviewHandlers(stList);
    hydratePhotos(stList);
    stList.querySelectorAll(".st-del").forEach(btn =>
      btn.addEventListener("click", () => deleteStock(btn.dataset.sku, btn))
    );
    stList.querySelectorAll(".st-qty").forEach(inp => {
      const commit = async () => {
        const sku = inp.dataset.sku;
        const cur = getStock(sku);
        if (!cur) return;
        let qty = Number(inp.value);
        if (!Number.isFinite(qty) || qty < 0) qty = 0;
        if (qty === cur.quantity) return; // без змін
        inp.disabled = true;
        try {
          await setStockQuantity(cur, qty);
          renderSuppliers(); // оновити бейджі в таблиці
          if (qty === 0) { renderStockList(); return; } // 0 — артикул зник зі складу
          inp.classList.add("ring-emerald");
          setTimeout(() => inp.classList.remove("ring-emerald"), 700);
        } catch (e) {
          inp.value = cur.quantity; // відкат
          if (stMsg) stMsg.textContent = "Не вдалося зберегти кількість: " + e.message;
        } finally {
          inp.disabled = false;
        }
      };
      inp.addEventListener("change", commit);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    });
  }

  async function openStockModal() {
    if (!stockModal) return;
    stMsg.textContent = "";
    stSku.value = ""; stName.value = ""; stQty.value = 1;
    stockModal.classList.remove("hidden");
    stList.innerHTML = `<div class="text-sm text-slate-400 text-center py-6">Завантаження…</div>`;
    await loadStock();
    renderStockList();
    // Фото для артикулів, яких немає в поточній вкладці, тягнемо фоново
    if (await ensureStockPhotos()) renderStockList();
  }
  function closeStockModal() {
    if (stockModal) stockModal.classList.add("hidden");
  }

  async function saveStock() {
    stMsg.textContent = "";
    const sku = (stSku.value || "").trim();
    if (!sku) { stMsg.textContent = "Вкажіть артикул."; return; }
    const qty = Number(stQty.value);
    if (!Number.isFinite(qty) || qty <= 0) { stMsg.textContent = "Кількість має бути більшою за 0."; return; }
    const payload = {
      sku,
      name: (stName.value || "").trim(),
      quantity: qty
    };
    stAdd.disabled = true;
    const prevTxt = stAdd.textContent;
    stAdd.textContent = "Зберігаю…";
    try {
      const resp = await fetch(stockSaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // локально оновлюємо одразу
      stockMap.set(normalizeSku(sku), { sku, name: payload.name, quantity: payload.quantity });
      stSku.value = ""; stName.value = ""; stQty.value = 1;
      renderStockList();
      renderSuppliers(); // оновити бейджі в таблиці
    } catch (e) {
      stMsg.textContent = "Не вдалося зберегти: " + e.message;
    } finally {
      stAdd.disabled = false;
      stAdd.textContent = prevTxt;
    }
  }

  async function deleteStock(sku, btn) {
    if (!confirm(`Прибрати артикул ${sku} зі складу?`)) return;
    if (btn) btn.disabled = true;
    try {
      const resp = await fetch(stockSaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, _delete: true })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      stockMap.delete(normalizeSku(sku));
      renderStockList();
      renderSuppliers();
    } catch (e) {
      if (btn) btn.disabled = false;
      alert("Не вдалося видалити: " + e.message);
    }
  }

  if (stockBtn) stockBtn.addEventListener("click", openStockModal);
  if (stockClose) stockClose.addEventListener("click", closeStockModal);
  if (stAdd) stAdd.addEventListener("click", saveStock);
  if (stSku) stSku.addEventListener("keydown", (e) => { if (e.key === "Enter") saveStock(); });
  if (stQty) stQty.addEventListener("keydown", (e) => { if (e.key === "Enter") saveStock(); });
  if (stockModal) stockModal.addEventListener("click", (e) => { if (e.target === stockModal) closeStockModal(); });

  // === Модалка «Підсумувати»: однакові позиції одним рядком ===
  const summaryBtn = document.getElementById("summaryBtn");
  const summaryModal = document.getElementById("summaryModal");
  const summaryClose = document.getElementById("summaryClose");
  const summaryList = document.getElementById("summaryList");
  const summarySub = document.getElementById("summarySub");

  // Підсумок потрібен лише там, де формується закупівля: PNG druk + «Поточні»
  function updateSummaryBtn() {
    if (!summaryBtn) return;
    const show = currentBrand === "png_druk" && currentView === "new";
    summaryBtn.classList.toggle("hidden", !show);
    if (!show) closeSummaryModal();
  }

  // Розмір живе всередині назви: «... (Колір: Deep Black, Розмір: M)»
  const extractSize = (name) => {
    const m = String(name || "").match(/(?:Розмір|Розм\.|Size)\s*[:：]\s*([^,)]+)/i);
    return m ? m[1].trim() : "";
  };

  // Групуємо за артикулом; якщо його немає — за назвою, щоб різне не злилось
  function buildSummary() {
    const groups = new Map();
    suppliers.forEach(supplier => {
      supplier.items.forEach(item => {
        if (item.status === "ordered") return;
        if (searchTokens.length && !item._match) return; // рахуємо те, що видно
        const sku = normalizeSku(item.sku);
        const name = String(item.productName || "").trim();
        const key = sku || (name ? "name:" + name.toLowerCase() : "");
        if (!key) return;
        let g = groups.get(key);
        if (!g) {
          g = { sku: item.sku || "", name, size: extractSize(name), photo: null, quantity: 0, orders: new Set(), suppliers: new Set() };
          groups.set(key, g);
        }
        g.quantity += Number(item.quantity) || 0;
        if (!g.name && name) g.name = name;
        if (!g.size) g.size = extractSize(name);
        if (!g.photo) g.photo = item.photo || getSkuPhoto(item.sku) || null;
        if (item.orderNumber) g.orders.add(item.orderNumber);
        if (supplier.name) g.suppliers.add(supplier.name);
      });
    });
    return [...groups.values()].sort((a, b) =>
      b.quantity - a.quantity || a.name.localeCompare(b.name, "uk"));
  }

  function renderSummary() {
    if (!summaryList) return;
    const rows = buildSummary();
    if (summarySub) {
      summarySub.textContent = searchTokens.length
        ? "Однакові товари зведені в один рядок. Враховано лише те, що показує пошук."
        : "Однакові товари зведені в один рядок із загальною кількістю по всіх замовленнях.";
    }
    if (rows.length === 0) {
      summaryList.innerHTML = `<div class="text-sm text-slate-400 text-center py-6">Немає позицій для підсумку.</div>`;
      return;
    }
    const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0);
    const emptyThumb = `<div class="thumb-img thumb-empty" title="Фото не знайдено">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
        </svg>
      </div>`;
    summaryList.innerHTML = `
      <table class="glass-table">
        <thead>
          <tr>
            <th class="w-20 text-center">Замовлень</th>
            <th class="w-14">Фото</th>
            <th>Назва товару</th>
            <th>Артикул</th>
            <th>Постачальник</th>
            <th class="w-20 text-center">Розмір</th>
            <th class="w-24 text-center">Кількість</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="text-center text-slate-500" title="Замовлення: ${[...r.orders].join(", ")}">${r.orders.size}</td>
              <td>${r.photo ? photoImgTag(r.photo, "thumb-img") : emptyThumb}</td>
              <td class="text-slate-700">${r.name || "<span class='text-slate-300'>—</span>"}</td>
              <td class="font-semibold text-slate-800">${r.sku || "<span class='text-slate-300'>—</span>"}</td>
              <td class="text-slate-500 text-[12px]">${[...r.suppliers].join(", ")}</td>
              <td class="text-center font-bold text-slate-900">${r.size || "<span class='text-slate-300 font-normal'>—</span>"}</td>
              <td class="text-center"><span class="badge badge-indigo">${r.quantity} шт</span></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="flex items-center justify-between gap-3 mt-3 px-1 text-[12px] text-slate-500">
        <span>Унікальних позицій: <b class="text-slate-700">${rows.length}</b></span>
        <span>Загалом: <b class="text-slate-700">${totalQty} шт</b></span>
      </div>`;
    attachPreviewHandlers(summaryList);
    hydratePhotos(summaryList);
  }

  function openSummaryModal() {
    if (!summaryModal) return;
    renderSummary();
    summaryModal.classList.remove("hidden");
  }
  function closeSummaryModal() {
    if (summaryModal) summaryModal.classList.add("hidden");
  }

  if (summaryBtn) summaryBtn.addEventListener("click", openSummaryModal);
  if (summaryClose) summaryClose.addEventListener("click", closeSummaryModal);
  if (summaryModal) summaryModal.addEventListener("click", (e) => { if (e.target === summaryModal) closeSummaryModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && summaryModal && !summaryModal.classList.contains("hidden")) closeSummaryModal();
  });

  // Завантажуємо дані й стартуємо (запам'ятовуємо останній бренд і вкладку)
  let initialBrand = "png_druk";
  try {
    const savedBrand = localStorage.getItem("brand");
    if (savedBrand === "png_druk" || savedBrand === "png_studio") initialBrand = savedBrand;
  } catch (e) {}
  let initialView = "new";
  try {
    const saved = localStorage.getItem("tabView");
    if (saved === "ordered" || saved === "new" || saved === "receipt") initialView = saved;
  } catch (e) {}
  // ?tab=receipt — закладка на ПК складівника відкривається одразу на «Прийом»
  const tabParam = new URLSearchParams(location.search).get("tab");
  if (["new", "ordered", "receipt"].includes(tabParam)) initialView = tabParam;
  setBrand(initialBrand, { load: false }); // виставляємо бренд без зайвого завантаження
  setTabState(initialView);                // встановлює вкладку і вантажить дані один раз
  prunePhotoCache();                       // прибираємо фото, яких не торкались 90 днів
});
