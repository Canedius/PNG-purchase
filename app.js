// Увесь JS винесено окремо, готуємося до підключення реального API.

document.addEventListener("DOMContentLoaded", () => {
  // Дані приходять з вебхука; контейнер для збереження
  let suppliers = [];
  const dataUrl = "https://primary-production-eeb3.up.railway.app/webhook/1c480cd8-acda-4af4-92cd-75b452e6f159";
  const updateUrl = "https://primary-production-eeb3.up.railway.app/webhook/26cb3bb4-e19f-4037-8291-6525da83be45";
  const receiveWebhook = "https://primary-production-eeb3.up.railway.app/webhook/aaf5a6e4-f47b-45ce-8f6b-e8e3600a2ab5"; // вебхук для статусу 'received'

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
  const { jsPDF } = window.jspdf;
  let logoDataPromise = null;
  let currentView = "new"; // new | ordered
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

  const renderMarkIcon = (idx) => markIcons[idx] || markIcons[0];

  // Попап прев'ю для фото
  const preview = document.createElement("div");
  preview.className = "img-hover-preview";
  preview.innerHTML = `<img src="" alt="preview">`;
  document.body.appendChild(preview);

  function attachPreviewHandlers() {
    document.querySelectorAll(".thumb-img").forEach(img => {
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
    // Використовуємо вбудований favicon як логотип у PDF, щоб уникнути CORS/tainted canvas
    return Promise.resolve(fallbackLogo);
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

  function renderSuppliers(highlightBatch = null) {
    container.innerHTML = "";
    if (highlightBatch?.animate) {
      container.classList.add("fade-in-up");
      container.addEventListener("animationend", () => container.classList.remove("fade-in-up"), { once: true });
    }
    if (suppliers.length === 0) {
      container.innerHTML = `<div class="p-6 text-center text-slate-500 border border-dashed border-slate-300 rounded-xl bg-white">
        Даних поки немає. Підключіть API та заповніть suppliers.
      </div>`;
      return;
    }

    suppliers.forEach((supplier, idx) => {
      const visibleItems = supplier.items.filter(item => currentView === "ordered" ? item.status === "ordered" : item.status !== "ordered");
      if (currentView === "ordered") {
        visibleItems.forEach(item => { item._selected = true; });
      } else {
        visibleItems.forEach(item => { if (item._selected === undefined) item._selected = false; });
      }
      if (visibleItems.length === 0) return;
      const anySelected = visibleItems.some(i => i._selected);

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
      section.className = "bg-white shadow rounded-xl border border-slate-200";
      supplier._printedBatches = supplier._printedBatches || [];
      supplier._ttnByBatch = supplier._ttnByBatch || {};
      const confirmPrintBtn = (!supplier._printed && supplier._printRequested)
        ? `<button class="confirm-print inline-flex items-center gap-1 bg-white text-emerald-600 border border-emerald-500 hover:bg-emerald-50 transition px-2 py-1 rounded text-xs"
                     data-index="${idx}" title="Підтвердити, що друк виконано">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M20 6 9 17l-5-5"/>
               </svg>
               Підтвердити друк
             </button>` : "";

      let html = "";
      if (currentView === "new") {
        html += `
          <div class="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-t-xl">
            <div class="flex items-center gap-3">
              <div class="text-lg font-semibold">${supplier.name}</div>
            </div>
            <div class="inline-flex items-center gap-2">
              <button class="mark-btn inline-flex items-center justify-center bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:translate-y-0.5 transition px-2.5 py-1.5 rounded-md shadow-sm text-sm ${anySelected ? "" : "hidden"}"
                              data-index="${idx}" title="Позначити замовлено" data-icon="${markIconIdx}">
                ${renderMarkIcon(markIconIdx)}
              </button>
              <div class="icon-palette inline-flex gap-1"></div>
              ${confirmPrintBtn}
            </div>
          </div>
        `;
      }

      html += `<div class="space-y-4 pt-1">`;
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
        const batchLabel = batchId === "current"
          ? "Поточні"
          : batchId === "unsorted"
            ? (fallbackDate ? `Перенесено: ${fallbackDate}` : "Імпортовано")
            : (!Number.isNaN(tsPart) ? new Date(tsPart).toLocaleString("uk-UA") : `Партія ${batchId}`);
        const printed = supplier._printedBatches.includes(batchId);
        const showHeader = currentView === "ordered";
        const highlight = highlightBatch && highlightBatch.supplier === idx && highlightBatch.batchId === batchId;
        return `
          <div class="rounded-lg border border-slate-200 shadow-sm overflow-hidden bg-white ${highlight ? "pulse-soft ring-2 ring-emerald-300" : ""}">
            ${showHeader ? `
            <div class="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
              <div class="flex items-center gap-3 flex-wrap">
                <div class="text-lg font-semibold">${supplier.name}</div>
                <span class="text-[12px] bg-white/20 px-2 py-1 rounded-full">${batchLabel}</span>
                <input type="text" class="ttn-input text-sm px-3 py-1 rounded-md bg-white/20 border border-white/30 placeholder-white/80 focus:outline-none focus:ring-2 focus:ring-amber-300"
                       data-supplier="${idx}" data-batch="${batchId}" placeholder="ТТН" value="${supplier._ttnByBatch[batchId] || ""}">
              </div>
              <div class="flex items-center gap-2">
                ${printed ? `<span class="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg> Друковано</span>` : ""}
                <button class="print-btn inline-flex items-center justify-center bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:translate-y-0.5 transition px-2 py-1.5 rounded-md shadow-sm text-sm ${currentView === "ordered" ? "" : "hidden"}"
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
            <div class="overflow-x-auto rounded-lg border border-slate-200">
              <table class="min-w-full bg-white text-slate-800">
                <thead class="bg-slate-100">
                  <tr>
                    <th class="w-10 px-2 py-2 text-center">
                      <input type="checkbox" class="toggle-all styled-check" data-index="${idx}" data-batch="${batchId}" ${batchItems.length>0 && batchItems.every(i => i._selected) ? "checked" : ""}>
                    </th>
                    ${columns.map(col => `<th class="px-3 py-2 text-left text-sm font-semibold text-slate-700">${col}</th>`).join("")}
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${Object.keys(grouped).map((order, groupIdx) => {
                    const rows = grouped[order];
                    const color = "#3b82f6";
                    const bg = "#f5f7ff";
                    return `
                    <tr><td colspan="${1 + columns.length}" class="bg-transparent h-1" style="background:${bg}; ${groupIdx === 0 ? "border-top: 0;" : `border-top: 3px solid ${color};`}"></td></tr>
                    ${rows.map(item => {
                      const itemIdx = supplier.items.indexOf(item);
                      return `
                      <tr class="hover:bg-indigo-50 transition" style="background:${bg};">
                        <td class="px-2 py-2 text-center border-l-4" style="border-color:${color}; background:${bg}">
                          <input type="checkbox" class="row-check styled-check" data-supplier="${idx}" data-item="${itemIdx}" ${item._selected ? "checked" : ""}>
                        </td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">${item.dateOrder}</td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">
                          <div class="flex items-center gap-2 group">
                            <a class="text-indigo-600 underline" href="${item.orderLink}" target="_blank" rel="noopener">${item.orderNumber}</a>
                            <button class="copy-btn text-indigo-600 hover:text-indigo-800 transition opacity-0 group-hover:opacity-100" data-copy="${item.orderNumber}" title="Копіювати номер замовлення">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">
                          <img src="${item.photo || defaultPhoto}" data-full="${item.photo || defaultPhoto}" alt="Фото" class="thumb-img rounded border border-slate-200 bg-white">
                        </td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">
                          <div class="flex items-center gap-2 group">
                            <span>${item.productName}</span>
                            <button class="copy-btn text-indigo-600 hover:text-indigo-800 transition opacity-0 group-hover:opacity-100" data-copy="${item.productName}" title="Копіювати назву">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">${item.quantity}</td>
                        <td class="px-3 py-2 text-sm" style="background:${bg}">
                          <div class="flex items-center gap-2 group">
                            <span>${item.sku}</span>
                            <button class="copy-btn text-indigo-600 hover:text-indigo-800 transition opacity-0 group-hover:opacity-100" data-copy="${item.sku}" title="Копіювати артикул">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 fill-current">
                                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Z M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h12v14Z"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td class="px-3 py-2 text-sm font-semibold" style="background:${bg}">
                          ${currentView === "ordered"
                            ? `<span class="inline-flex items-center gap-1 text-amber-600">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M3 13V6a1 1 0 0 1 1-1h9v8H3Z"></path>
                                  <path d="M13 8h3l3 3v3h-6V8Z"></path>
                                  <circle cx="7.5" cy="16.5" r="1.5"></circle>
                                  <circle cx="17.5" cy="16.5" r="1.5"></circle>
                                </svg>
                                В дорозі
                               </span>`
                            : `<span class="text-emerald-600">Новий</span>`}
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

    document.querySelectorAll(".print-btn").forEach(btn =>
      btn.addEventListener("click", (e) => {
        const index = Number(e.currentTarget.dataset.index);
        const batch = e.currentTarget.dataset.batch || null;
        generatePdf(suppliers[index], batch);
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
        const changedItems = [];
        targetSupplier.items.forEach(item => {
          if (item._selected === true && item.status !== "ordered") {
            item.status = "ordered";
            item.batchId = batchId;
            changedItems.push(item);
            any = true;
          }
        });
        if (!any) {
          alert("Спочатку відміть товари для зміни статусу.");
          return;
        }
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
  }

  async function generatePdf(supplier, batchId = null) {
    const selectedItems = supplier.items.filter(i => {
      if (batchId) {
        // для batchId "unsorted" беремо ті, що без batchId
        const matchesUnsorted = batchId === "unsorted" && !i.batchId;
        return i.status === "ordered" && (i.batchId === batchId || matchesUnsorted);
      }
      return i._selected !== false;
    });
    if (selectedItems.length === 0) {
      alert("Немає відмічених товарів для друку.");
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    loadRoboto(doc);
    const createdAt = new Date().toLocaleDateString("uk-UA");
    const ttnValue = batchId ? (supplier._ttnByBatch && supplier._ttnByBatch[batchId]) : null;

    const logoData = await getLogoData();
    let headerBottom = 24;
    if (logoData) {
      try {
        const logoFormat = logoData.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
        doc.addImage(logoData, logoFormat, 40, 24, 100, 32);
        headerBottom = 24 + 32;
      } catch (e) {
        console.warn("Logo addImage failed, skip", e);
      }
    }
    // QR для бек-вебхука: статус "received" + id вибраних товарів
    const qrY = 32;
    let qrBottom = qrY;
    const idsForQr = selectedItems.map(i => i.id || i.orderNumber || i.sku).filter(Boolean);
    if (idsForQr.length) {
      const payload = { status: "received", ids: idsForQr, supplier: supplier.name };
      // компактна сторінка підтвердження у data:URL
      const confirmHtml = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:16px">
<h3>Підтвердити отримання</h3>
<p>Постачальник: ${supplier.name}<br>Позицій: ${idsForQr.length}</p>
<button id="ok">Підтвердити</button><div id="r" style="color:#666;font-size:12px"></div>
<script>
const p=${JSON.stringify(payload)};
ok.onclick=async()=>{
  r.textContent='Відправляю...';
  try{
    const resp=await fetch("${receiveWebhook}",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
    const t=await resp.text();
    r.textContent=resp.ok?'Готово: '+t:'Помилка: '+resp.status+' '+t;
  }catch(e){r.textContent='Помилка: '+e;}
};
</script>`;
      const targetUrl = "data:text/html;base64," + btoa(unescape(encodeURIComponent(confirmHtml)));
      const pageWidth = doc.internal.pageSize.getWidth();
      const placeQr = (dataUrl) => {
        const qrSize = 140;
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

    const placeholderDataUrl = defaultPhoto;
    const toDataUrl = async (url) => {
      if (!url) return { data: placeholderDataUrl, format: "PNG" };
      if (url.startsWith("data:image/")) {
        const fmt = url.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
        return { data: url, format: fmt };
      }
      try {
        const resp = await fetch(url);
        const contentType = resp.headers.get("content-type") || "";
        if (!resp.ok || !contentType.startsWith("image/")) throw new Error("not image");
        const blob = await resp.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const fmt = dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
        return { data: dataUrl, format: fmt };
      } catch (e) {
        return { data: placeholderDataUrl, format: "PNG" };
      }
    };
    for (const key of photoMap.keys()) {
      const val = await toDataUrl(key);
      photoMap.set(key, val);
    }

    const groups = Object.entries(groupedForPdf);
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
          cellPadding: { top: 6, bottom: 6, left: 6, right: 2 }
        }
      }]);
      const MIN_H = 68;
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
          firstInGroup ? { content: orderNum, rowSpan: items.length, styles: { halign: "center", valign: "middle", minCellHeight: MIN_H } } : null
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
        styles: { fontSize: 10, font: fontReady ? "Roboto" : "helvetica", overflow: "linebreak", cellPadding: 6 },
        headStyles: { fillColor: [79, 70, 229], textColor: 255, font: fontReady ? "Roboto" : "helvetica", fontStyle: "bold" },
        alternateRowStyles: { fillColor: [235, 242, 255] },
        margin: { left: 20, right: 20, top: 12, bottom: 14 },
        tableWidth: "auto",
        columnStyles: {
          0: { cellWidth: 200 },
          1: { cellWidth: 60, halign: "center" },
          2: { cellWidth: 40, halign: "center" },
          3: { cellWidth: 80 },
          4: { cellWidth: 140, halign: "center" }
        },
        didDrawCell: function(data) {
          if (data.row.raw && data.row.raw[0] && data.row.raw[0].colSpan) return;
          // Фото
          if (data.section === "body" && data.column.index === 1) {
            const raw = data.row.raw?.[1];
            const url = raw?.image || raw;
            const imgEntry = photoMap.get(url) || { data: placeholderDataUrl, format: "PNG" };
            data.cell.text = [""]; // прибираємо будь‑який текст/лінк
            if (!imgEntry?.data || imgEntry.data.length < 20) return;
            // Заливаємо фон білим, щоб перекрити можливий текст
            doc.setFillColor(255, 255, 255);
            doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, "F");
            const w = Math.min(42, data.cell.width - 8);
            const h = Math.min(42, data.cell.height - 8);
            const x = data.cell.x + (data.cell.width - w) / 2;
            const y = data.cell.y + (data.cell.height - h) / 2;
            try {
              doc.addImage(imgEntry.data, imgEntry.format || "PNG", x, y, w, h);
            } catch (e) {
              console.warn("Photo addImage failed", e);
            }
            return;
          }
          // Штрихкод
          if (data.section === "body" && data.column.index === pdfColumns.length - 1) {
            if (data.cell.raw === null) return;
            if (data.cell.raw && data.cell.raw.content === undefined && data.cell.raw.rowSpan === undefined) return;
            const code = (data.cell.raw?.content || data.cell.raw || "").toString().trim();
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
            if (img) {
              const drawWidth = Math.min(BAR_W, data.cell.width - 6);
              const maxHeightForCell = Math.max(20, data.cell.height - 16);
              const drawHeight = Math.min(BAR_H, maxHeightForCell - 12);
              const x = data.cell.x + (data.cell.width - drawWidth) / 2;
              const y = data.cell.y + 6;
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

    doc.autoPrint();
    const dataUri = doc.output("dataurlstring");
    printFrame.onload = () => {
      const w = printFrame.contentWindow;
      if (w) w.focus();
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
    printFrame.src = dataUri;
  }

  async function loadData() {
    container.innerHTML = `<div class="p-8 flex flex-col items-center gap-3 text-slate-500 border border-dashed border-slate-300 rounded-xl bg-white">
      <div class="spinner"></div>
      <div class="text-sm font-medium">Завантажую дані...</div>
    </div>`;
    try {
      const statusParam = currentView === "ordered" ? "ordered" : "to_buy";
      const resp = await fetch(`${dataUrl}?status=${encodeURIComponent(statusParam)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = await resp.json();
      const bySupplier = {};
      rows.forEach(row => {
        const supplierName = (row.SupplierName && row.SupplierName.trim()) ? row.SupplierName.trim() : "Невідомий постачальник";
        if (!bySupplier[supplierName]) bySupplier[supplierName] = { name: supplierName, key: (row.SupplierID || supplierName), items: [] };
        const dateIso = row.OrderDate ? new Date(row.OrderDate).toISOString().slice(0,10) : "";
        const status = row.procurement_status === "ordered" ? "ordered" : "new";
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
          status,
          raw: row
        });
      });
      suppliers = Object.values(bySupplier);
      // Відновлюємо відмітки "Друковано" по ключу постачальника
      suppliers.forEach(s => {
        const key = String(s.key || s.name);
        const saved = printedStore[key];
        if (saved) {
          s._printed = !!saved.all;
          s._printedBatches = Array.isArray(saved.batches) ? [...saved.batches] : [];
        }
      });
      renderSuppliers();
    } catch (e) {
      console.error("Fetch error", e);
      container.innerHTML = `<div class="p-6 text-center text-red-600 border border-dashed border-red-300 rounded-xl bg-white">
        Не вдалося завантажити дані (${e.message}). Перевірте вебхук.
      </div>`;
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
    if (view === "new") {
      tabAll.className = "tab-btn flex items-center gap-2 px-6 py-3 text-base font-semibold bg-gradient-to-r from-indigo-50 to-amber-50 text-indigo-800 shadow-inner";
      tabOrdered.className = "tab-btn flex items-center gap-2 px-6 py-3 text-base font-semibold text-slate-600 hover:bg-slate-50";
      document.getElementById("flameIcon")?.classList.add("flame-active");
      document.getElementById("flameIcon")?.classList.remove("text-slate-400");
      document.getElementById("flameIcon")?.classList.add("text-rose-500");
      document.getElementById("clockIcon")?.classList.remove("clock-active","text-amber-500");
      document.getElementById("clockIcon")?.classList.add("text-slate-400");
    } else {
      tabOrdered.className = "tab-btn flex items-center gap-2 px-6 py-3 text-base font-semibold bg-gradient-to-r from-indigo-50 to-amber-50 text-indigo-800 shadow-inner";
      tabAll.className = "tab-btn flex items-center gap-2 px-6 py-3 text-base font-semibold text-slate-600 hover:bg-slate-50";
      document.getElementById("flameIcon")?.classList.remove("flame-active");
      document.getElementById("flameIcon")?.classList.remove("text-rose-500");
      document.getElementById("flameIcon")?.classList.add("text-slate-400");
      document.getElementById("clockIcon")?.classList.add("clock-active","text-amber-500");
      document.getElementById("clockIcon")?.classList.remove("text-slate-400");
    }
    loadData();
  }

  tabAll.addEventListener("click", () => setTabState("new"));
  tabOrdered.addEventListener("click", () => setTabState("ordered"));

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
    const prev = btn.innerText;
    btn.innerText = "Оновлюю...";
    btn.disabled = true;
    try {
      await fetch("https://primary-production-eeb3.up.railway.app/webhook/08aca309-7ad4-460c-9610-a242e3c43789", { method: "POST" });
      await loadData();
    } catch (e) {
      alert("Не вдалося оновити дані з CRM.");
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerText = prev;
    }
  });

  // Завантажуємо дані й стартуємо (запам'ятовуємо останню вкладку)
  let initialView = "new";
  try {
    const saved = localStorage.getItem("tabView");
    if (saved === "ordered" || saved === "new") initialView = saved;
  } catch (e) {}
  setTabState(initialView);
});


