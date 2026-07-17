const STORAGE_KEY = "personal-reading-library-v1";
const ATTACHMENT_DB = "personal-reading-library-files";
const ATTACHMENT_STORE = "attachments";
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const $ = (selector, parent = document) => parent.querySelector(selector);

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>\"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character]));
const formatDate = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "未记录";

function normalizeExternalUrl(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  try {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPreviewableAttachment(attachment = {}) {
  return /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i.test(attachment.type || "") || /\.(pdf|png|jpe?g|webp|gif)$/i.test(attachment.name || "");
}

const starterState = {
  theme: "white",
  route: { page: "home", view: "category", statusLayout: "category", sort: "lastRead", direction: "desc", deleteMode: "" },
  categories: ["人物传记", "历史", "商业", "心理", "小说", "随笔"],
  books: [
    {
      id: "book-1", title: "苏东坡传", author: "林语堂", category: "人物传记", startDate: "2026-07-10", source: "朋友推荐", reason: "想借一段不被得失困住的人生，重新校准自己的节奏。", firstImpression: "文字有一种很从容的光。", expectation: "读到他如何把困顿过成一种气象。", status: "reading", createdAt: "2026-07-10", lastRead: "2026-07-16", color: "sage",
      dailyCards: [{ id: "card-1", date: "2026-07-16", position: "第一章", insight: "他好像总能把失意变成对生活更具体的热爱。", thought: "我羡慕的不是豁达，而是那种不急着证明自己的能力。", link: "想到最近刻意留出的散步时间。", tags: ["从容", "生活感"] }],
      notes: [{ id: "note-1", type: "金句", title: "做一个完整的人", content: "把读到的片段留在这里，等它们慢慢和生活发生关系。", createdAt: "2026-07-16" }],
    },
    {
      id: "book-2", title: "置身事内", author: "兰小欢", category: "商业", startDate: "2026-06-26", source: "微信读书", reason: "想把新闻里零散的经济话题，放回一个更完整的框架。", firstImpression: "信息密度很高，但叙述并不生硬。", expectation: "理解地方经济运行的逻辑。", status: "pending", createdAt: "2026-06-26", lastRead: "2026-07-11", color: "ink",
      dailyCards: [{ id: "card-2", date: "2026-07-11", position: "第三章", insight: "很多看似局部的选择，背后是激励结构。", thought: "理解结构不是为了变得冷漠，而是为了少一点轻率判断。", link: "联想到城市规划的讨论。", tags: ["结构", "判断"] }],
      notes: [{ id: "note-2", type: "内容总结", title: "一个理解问题的框架", content: "先看参与者、资源和约束，再谈结果。", createdAt: "2026-07-12" }],
    },
    {
      id: "book-3", title: "始于陌生的相遇", author: "佚名", category: "小说", startDate: "2026-05-18", source: "书店偶遇", reason: "被封面的安静感吸引。", firstImpression: "像一盏很晚才亮起的灯。", expectation: "留意它如何写人与人之间的距离。", status: "organized", createdAt: "2026-05-18", lastRead: "2026-06-02", color: "image",
      dailyCards: [{ id: "card-3", date: "2026-06-02", position: "全书", insight: "关系并不总靠抵达来证明。", thought: "有些理解可以留白。", link: "想起很久未联系的一位朋友。", tags: ["关系"] }],
      notes: [{ id: "note-3", type: "自己的理解", title: "关于留白", content: "读完后仍然有些地方说不清，这也许正是它留给我的部分。", createdAt: "2026-06-03" }],
    },
  ],
  wishes: [
    { id: "wish-1", title: "东京八平米", author: "吉井忍", category: "随笔", reason: "想看看一种更轻的生活如何被写出来。", source: "小红书", priority: "high", createdAt: "2026-07-15" },
    { id: "wish-2", title: "枪炮、病菌与钢铁", author: "贾雷德·戴蒙德", category: "历史", reason: "朋友反复提起。", source: "朋友推荐", priority: "medium", createdAt: "2026-07-12" },
  ],
};

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...starterState, ...saved, route: starterState.route } : structuredClone(starterState);
  } catch {
    return structuredClone(starterState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, route: undefined }));
}

function openAttachmentDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ATTACHMENT_STORE)) request.result.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeAttachment(file) {
  const database = await openAttachmentDatabase();
  const metadata = { id: `file-${uid()}`, name: file.name, type: file.type, size: file.size };
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(ATTACHMENT_STORE).put({ ...metadata, blob: file, createdAt: new Date().toISOString() });
    transaction.oncomplete = () => { database.close(); resolve(metadata); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

async function readAttachment(id) {
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).get(id);
    request.onsuccess = () => { database.close(); resolve(request.result); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function deleteStoredAttachment(id) {
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ATTACHMENT_STORE, "readwrite");
    transaction.objectStore(ATTACHMENT_STORE).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

async function openStoredAttachment(id, previewable) {
  const previewWindow = previewable ? window.open("about:blank", "_blank") : null;
  try {
    const attachment = await readAttachment(id);
    if (!attachment?.blob) throw new Error("Attachment not found");
    const objectUrl = URL.createObjectURL(attachment.blob);
    if (previewable) {
      if (previewWindow) {
        previewWindow.opener = null;
        previewWindow.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
      }
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachment.name || "attachment";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch {
    previewWindow?.close();
    window.alert("这个附件暂时无法读取，请重新导入。");
  }
}

function setRoute(route) {
  state.route = { ...state.route, ...route };
  render();
}

function cover(book, compact = false) {
  const className = `cover cover-${book.color || "rose"} ${compact ? "cover-compact" : ""}`;
  const initials = escapeHtml(book.title.slice(0, 4));
  if (book.coverImage) return `<div class="${className} photo-cover"><img src="${book.coverImage}" alt="${escapeHtml(book.title)} 封面"></div>`;
  if (book.color === "image") return `<div class="cover cover-rose"><span>${initials}</span><small>${escapeHtml(book.author || "")}</small></div>`;
  return `<div class="${className}"><span>${initials}</span><small>${escapeHtml(book.author || "")}</small></div>`;
}

function statusLabel(status) {
  return ({ reading: "阅读中", pending: "待整理", organized: "已整理" })[status] || status;
}

function selectionControl(kind, id, label) {
  return `<label class="selection-control" title="${escapeHtml(label)}"><input type="checkbox" data-select-item="${escapeHtml(kind)}" data-item-id="${escapeHtml(id)}"><span class="sr-only">${escapeHtml(label)}</span></label>`;
}

function bookRow(book, selectable = false) {
  const content = `${cover(book, true)}
    <span class="book-row-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "未署名")} · ${escapeHtml(book.category || "未分类")}</small></span>`;
  if (selectable) {
    return `<article class="book-row selectable-book">
    ${content}
    ${selectionControl("book", book.id, "选择这本书")}
  </article>`;
  }
  return `<button class="book-row" data-book="${book.id}">
    ${content}
    <span class="row-meta">${formatDate(book.lastRead)}</span>
  </button>`;
}

function renderCoverBookCard(book, selectable = false) {
  const content = `${cover(book)}<strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "未署名")}</small>`;
  if (selectable) return `<article class="book-card selectable-book">${selectionControl("book", book.id, "选择这本书")}${content}</article>`;
  return `<button class="book-card" data-book="${book.id}">${content}</button>`;
}

function renderMiniBookCard(book, selectable = false) {
  const content = `${cover(book, true)}<small>${escapeHtml(book.title)}</small>`;
  if (selectable) return `<article class="mini-card selectable-book">${selectionControl("book", book.id, "选择这本书")}${content}</article>`;
  return `<button class="mini-card" data-book="${book.id}">${content}</button>`;
}

function renderHomeDeleteActions() {
  if (state.route.deleteMode !== "book") return "";
  return `<section class="home-delete-actions"><button class="quiet-button" data-action="cancel-delete-mode">取消</button><button class="quiet-button danger-button" data-action="delete-selected-books" data-bulk-delete="book" disabled>删除所选</button></section>`;
}

function bookDeleteActive() {
  return state.route.page === "home" && state.route.deleteMode === "book";
}

function renderFirstMeetCard(book) {
  return `<article class="first-meet-card field-grid"><div><span>为什么开始看</span><p>${escapeHtml(book.reason || "还没有写下这个答案。")}</p></div><div><span>第一印象</span><p>${escapeHtml(book.firstImpression || "还没有写下第一印象。")}</p></div></article>`;
}

function renderDailyCard(card, selectable = false) {
  const selection = selectable ? `<div class="card-toolbar-actions">${selectionControl("daily", card.id, "选择这条阅读记录")}</div>` : "";
  return `<article class="daily-card"><div class="card-toolbar"><time>${formatDate(card.date)} · ${escapeHtml(card.position || "未标记位置")}</time>${selection}</div><h3>💎 ${escapeHtml(card.insight || "今日最有意思的一点")}</h3><p><b>💭</b> ${escapeHtml(card.thought || "")}</p>${card.link ? `<p><b>🔗</b> ${escapeHtml(card.link)}</p>` : ""}${card.tags?.length ? `<div class="chips">${card.tags.map((tag) => `<span class="chip"># ${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</article>`;
}

function renderNoteCard(note, selectable = false) {
  const resourceUrl = normalizeExternalUrl(note.resourceUrl);
  const attachment = note.attachment?.id ? note.attachment : null;
  const selection = selectable ? `<div class="card-toolbar-actions">${selectionControl("note", note.id, "选择这条整理内容")}</div>` : "";
  const resources = [
    resourceUrl ? `<a class="note-resource-link" href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener noreferrer">打开关联地址 ↗</a>` : "",
    attachment ? `<button class="note-attachment-button" data-action="open-attachment" data-attachment="${escapeHtml(attachment.id)}" data-preview="${isPreviewableAttachment(attachment)}">${isPreviewableAttachment(attachment) ? "打开" : "下载"} ${escapeHtml(attachment.name)} <small>${formatFileSize(attachment.size)}</small></button>` : "",
  ].filter(Boolean).join("");
  return `<article class="note-card"><div class="card-toolbar"><span class="note-kind">${escapeHtml(note.type)}</span>${selection}</div><h3>${escapeHtml(note.title)}</h3>${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}${resources ? `<div class="note-card-actions">${resources}</div>` : ""}</article>`;
}

function renderAppShell(content, options = {}) {
  const { page = "home", title = "我的图书馆", subtitle = "让每本书留下它在你生命里的位置" } = options;
  const homeDeleteActive = page === "home" && state.route.deleteMode === "book";
  const homeDeleteButton = page === "home" ? `<button class="icon-button danger-icon ${homeDeleteActive ? "is-active" : ""}" data-action="${homeDeleteActive ? "cancel-delete-mode" : "enter-delete-mode"}" ${homeDeleteActive ? "" : 'data-delete-mode="book"'} title="${homeDeleteActive ? "退出删除" : "删除书籍"}" aria-label="${homeDeleteActive ? "退出删除" : "删除书籍"}">⌫</button>` : "";
  return `<main class="app-shell">
    <header class="topbar">
      <form class="search" data-form="search"><span aria-hidden="true">⌕</span><input name="query" value="${escapeHtml(state.route.query || "")}" placeholder="搜索书、想法、标签或整理内容" autocomplete="off"></form>
    </header>
    <section class="page-heading"><div><p class="eyebrow">${page === "book" ? "BOOK PAGE" : page === "wishes" ? "WISH POOL" : "PRIVATE COLLECTION"}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="heading-tools">${page !== "book" ? `<span class="collection-count">${state.books.length} 本已入馆</span>` : ""}<nav class="actions" aria-label="图书馆工具"><button class="icon-button" data-action="theme" title="换肤" aria-label="换肤">◐</button><button class="icon-button ${page === "wishes" ? "is-active" : ""}" data-action="wishes" title="愿望池" aria-label="愿望池">♡</button>${homeDeleteButton}<button class="icon-button ${page === "home" ? "is-active" : ""}" data-action="view-menu" title="切换视图" aria-label="切换视图">▦</button></nav></div></section>
    ${content}
    <button class="fab" data-action="open-add" aria-label="新增内容" title="新增">+</button>
    <div id="modal-root"></div>
  </main>`;
}

function renderHome() {
  const view = state.route.view;
  let content = `<section class="view-tabs"><button class="${view === "category" ? "active" : ""}" data-action="view" data-view="category">分类</button><button class="${view === "cover" ? "active" : ""}" data-action="view" data-view="cover">封面</button><button class="${view === "status" ? "active" : ""}" data-action="view" data-view="status">阅读状态</button></section>`;
  content += renderHomeDeleteActions();
  if (view === "category") content += renderCategoryView();
  if (view === "cover") content += renderCoverView();
  if (view === "status") content += renderStatusView();
  return renderAppShell(content, { title: "我的图书馆" });
}

function renderCategoryView() {
  const grouped = groupBy(state.books, (book) => book.category || "未分类");
  const categories = [...state.categories, ...Object.keys(grouped).filter((name) => !state.categories.includes(name))];
  const selectable = bookDeleteActive();
  return `<section class="category-list">${categories.filter((name) => grouped[name]?.length).map((name) => `<article class="category-section"><div class="section-header"><button data-action="category" data-category="${escapeHtml(name)}"><h2>${escapeHtml(name)}</h2></button></div><div class="book-list">${grouped[name].slice(0, 4).map((book) => bookRow(book, selectable)).join("")}</div></article>`).join("") || empty("还没有书，先把第一本放进来。")}</section>`;
}

function renderCoverView() {
  const sort = state.route.sort;
  const direction = state.route.direction;
  const sorted = [...state.books].sort((a, b) => {
    const field = sort === "title" ? "title" : sort === "created" ? "createdAt" : "lastRead";
    const value = String(a[field] || "").localeCompare(String(b[field] || ""), "zh-CN");
    return direction === "asc" ? value : -value;
  });
  return `<section class="cover-view"><div class="toolbar"><div class="sorts"><label class="sort-select"><span class="sr-only">排序方式</span><select data-control="sort" aria-label="排序方式"><option value="lastRead" ${sort === "lastRead" ? "selected" : ""}>最后阅读</option><option value="created" ${sort === "created" ? "selected" : ""}>加入时间</option><option value="title" ${sort === "title" ? "selected" : ""}>书名</option></select></label><button class="quiet-button" data-action="direction">${direction === "asc" ? "↑ 升序" : "↓ 降序"}</button></div><span>无形书架，按你此刻的方式相遇。</span></div><div class="cover-grid">${sorted.map((book) => renderCoverBookCard(book, bookDeleteActive())).join("")}</div></section>`;
}

function renderStatusView() {
  const layout = state.route.statusLayout;
  const statuses = [["reading", "🌱 阅读中"], ["pending", "📝 待整理"], ["organized", "🌳 已整理"]];
  const selectable = bookDeleteActive();
  return `<section class="status-board"><div class="toolbar"><p>每本书都可以随时回到任何阶段。</p><div class="segmented"><button class="${layout === "category" ? "active" : ""}" data-action="status-layout" data-layout="category">分类显示</button><button class="${layout === "cover" ? "active" : ""}" data-action="status-layout" data-layout="cover">封面显示</button></div></div><div class="status-columns">${statuses.map(([status, label]) => { const books = state.books.filter((book) => book.status === status); return `<article class="status-column"><header><h2>${label}</h2></header>${layout === "cover" ? `<div class="mini-cover-grid">${books.map((book) => renderMiniBookCard(book, selectable)).join("") || empty("暂时没有")}</div>` : renderStatusCategory(books, selectable)}</article>`; }).join("")}</div></section>`;
}

function renderStatusCategory(books, selectable = false) {
  const grouped = groupBy(books, (book) => book.category || "未分类");
  return Object.entries(grouped).map(([category, entries]) => `<section class="status-group"><p>${escapeHtml(category)}</p><div class="book-list">${entries.map((book) => bookRow(book, selectable)).join("")}</div></section>`).join("") || empty("暂时没有");
}

function renderCategoryPage(category) {
  const books = state.books.filter((book) => book.category === category);
  return renderAppShell(`<section class="detail-panel"><div class="section-header"><h2>${escapeHtml(category)}</h2><button class="quiet-button" data-action="home">返回图书馆</button></div><div class="book-list">${books.map(bookRow).join("") || empty("这个分类还没有书。")}</div></section>`, { title: category, subtitle: "在这里相遇的书" });
}

function renderSectionActions(kind, bookId, addAction, addLabel, hasItems) {
  const active = state.route.deleteMode === kind;
  const deleteAction = kind === "daily" ? "delete-selected-daily" : "delete-selected-notes";
  if (active) {
    return `<div class="section-actions is-delete-mode"><button class="quiet-button" data-action="cancel-delete-mode">取消</button><button class="quiet-button danger-button" data-action="${deleteAction}" data-book="${escapeHtml(bookId)}" data-bulk-delete="${escapeHtml(kind)}" disabled>删除所选</button></div>`;
  }
  return `<div class="section-actions"><button class="quiet-button" data-action="${addAction}" data-book="${escapeHtml(bookId)}">${addLabel}</button><button class="quiet-button danger-button" data-action="enter-delete-mode" data-delete-mode="${escapeHtml(kind)}" ${hasItems ? "" : "disabled"}>删除</button></div>`;
}

function renderBook(book) {
  const cards = [...book.dailyCards].sort((a, b) => b.date.localeCompare(a.date));
  const dailyDeleteActive = state.route.deleteMode === "daily";
  const noteDeleteActive = state.route.deleteMode === "note";
  const dailyActions = renderSectionActions("daily", book.id, "add-daily", "+ 记一次阅读", cards.length > 0);
  const noteActions = renderSectionActions("note", book.id, "add-note", "+ 添加整理内容", book.notes.length > 0);
  return renderAppShell(`<section class="book-nav"><button class="quiet-button" data-action="home">返回图书馆 →</button></section><div class="detail-layout"><aside class="book-profile">${cover(book)}<div><p class="eyebrow">${escapeHtml(book.category || "未分类")}</p><h2>${escapeHtml(book.title)}</h2><p class="book-author">${escapeHtml(book.author || "未署名")}</p></div><button class="quiet-button full" data-action="change-cover" data-book="${book.id}">更换封面</button><label class="field-label">阅读阶段<select data-status="${book.id}"><option value="reading" ${book.status === "reading" ? "selected" : ""}>🌱 阅读中</option><option value="pending" ${book.status === "pending" ? "selected" : ""}>📝 待整理</option><option value="organized" ${book.status === "organized" ? "selected" : ""}>🌳 已整理</option></select></label><dl class="book-facts"><div><dt>开始阅读</dt><dd>${formatDate(book.startDate)}</dd></div><div><dt>来源</dt><dd>${escapeHtml(book.source || "未记录")}</dd></div></dl></aside><div class="detail-stack"><section class="detail-panel"><div class="section-header"><div><p class="eyebrow">FIRST MEET</p><h2>初见</h2></div><button class="quiet-button" data-action="edit-book" data-book="${book.id}">编辑</button></div>${renderFirstMeetCard(book)}</section><section class="detail-panel"><div class="section-header"><div><p class="eyebrow">READING DAYS</p><h2>每日卡片</h2></div>${dailyActions}</div><div class="timeline">${cards.map((card) => renderDailyCard(card, dailyDeleteActive)).join("") || empty("还没有每日卡片。一次阅读，留下一张就够了。")}</div></section><section class="detail-panel"><div class="section-header"><div><p class="eyebrow">GROWING NOTES</p><h2>整理区</h2></div>${noteActions}</div><div class="notes-grid">${book.notes.map((note) => renderNoteCard(note, noteDeleteActive)).join("") || empty("想法不必一次整理完，它们会慢慢长出来。")}</div></section></div></div>`, { page: "book", title: book.title, subtitle: "这本书在你这里留下的痕迹" });
}

function renderWishes() {
  const priority = { high: ["❤️", "很想看"], medium: ["💛", "一般"], low: ["🤍", "随缘"] };
  return renderAppShell(`<section class="book-nav"><button class="quiet-button" data-action="home">返回图书馆 →</button></section><section class="wishlist-panel"><div class="wishlist-head"><div><p class="eyebrow">SOMEDAY SHELF</p><h2>愿望池</h2><p>把想读的书放在这里，等一个恰好的二十分钟。</p></div><button class="primary-button" data-action="random-wish">🎲 随机抽一本</button></div><div class="wishlist-grid">${state.wishes.map((wish) => `<article class="wish-card"><div><span class="wish-priority">${priority[wish.priority]?.[0] || "🤍"} ${priority[wish.priority]?.[1] || "随缘"}</span><p class="eyebrow">${escapeHtml(wish.category || "未分类")}</p><h3>${escapeHtml(wish.title)}</h3><p class="book-author">${escapeHtml(wish.author || "未署名")}</p></div><p>${escapeHtml(wish.reason || "暂时没有写下原因。")}</p><small>来自 ${escapeHtml(wish.source || "未记录")}</small><div class="wish-actions"><button class="quiet-button" data-action="edit-wish" data-wish="${wish.id}">编辑</button><button class="quiet-button" data-action="start-wish" data-wish="${wish.id}">开始阅读 →</button></div></article>`).join("") || empty("愿望池很安静，等下一本想读的书。")}</div></section>`, { page: "wishes", title: "愿望池", subtitle: "还没相遇，但已经为它们留了位置" });
}

function renderSearch(query) {
  const normalized = query.toLocaleLowerCase();
  const results = state.books.filter((book) => JSON.stringify(book).toLocaleLowerCase().includes(normalized));
  return renderAppShell(`<section class="search-panel"><div class="section-header"><div><p class="eyebrow">FULL TEXT SEARCH</p><h2>“${escapeHtml(query)}”</h2></div><span>${results.length} 个结果</span></div><div class="search-results">${results.map((book) => `<button class="result-card" data-book="${book.id}">${cover(book, true)}<span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "") } · ${escapeHtml(book.category || "")}</small><p>${escapeHtml(searchExcerpt(book, query))}</p></span><i>→</i></button>`).join("") || empty("没有找到结果。试试书名、作者、标签或你写下的一个词。")}</div></section>`, { page: "search", title: "搜索结果", subtitle: "从一本书，也从一个念头重新进入" });
}

function searchExcerpt(book, query) {
  const corpus = [book.reason, book.firstImpression, book.expectation, ...book.dailyCards.flatMap((card) => [card.insight, card.thought, card.link, ...(card.tags || [])]), ...book.notes.flatMap((note) => [note.title, note.content])].filter(Boolean).join(" · ");
  const index = corpus.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return index > -1 ? `${index > 26 ? "…" : ""}${corpus.slice(Math.max(0, index - 26), index + query.length + 55)}${corpus.length > index + query.length + 55 ? "…" : ""}` : "书名、作者或分类中匹配";
}

function render() {
  document.body.dataset.theme = state.theme;
  const { page } = state.route;
  const book = state.books.find((entry) => entry.id === state.route.bookId);
  let html = renderHome();
  if (page === "category") html = renderCategoryPage(state.route.category);
  if (page === "book" && book) html = renderBook(book);
  if (page === "wishes") html = renderWishes();
  if (page === "search") html = renderSearch(state.route.query || "");
  $("#app").innerHTML = html;
  if (page === "wishes") {
    $(".wishlist-head")?.remove();
    $(".book-nav")?.insertAdjacentHTML("afterbegin", '<button class="primary-button" data-action="random-wish">🎲 随机抽一本</button>');
  }
  if (page === "home") $(".heading-tools")?.append($(".view-tabs"));
  if (page === "home" && state.route.view === "cover") $(".cover-view .toolbar > span")?.remove();
  if (page === "home" && state.route.view === "status") $(".status-board .toolbar > p")?.remove();
  document.querySelectorAll(".book-nav .quiet-button").forEach((button) => { button.textContent = "返回图书馆"; });
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => { const key = keyFn(item); (groups[key] ||= []).push(item); return groups; }, {});
}
function empty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }

function openModal(title, content) {
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" data-modal-surface role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><h2>${escapeHtml(title)}</h2></header>${content}</section></div>`;
}
function closeModal() { const root = $("#modal-root"); if (root) root.innerHTML = ""; }
function options(values, selected = "") { return values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join(""); }

function openAddMenu() {
  const onBook = state.route.page === "book";
  const choices = onBook ? [["add-daily", "🌱", "每日卡片"], ["add-note", "🧠", "思维导图"], ["add-note", "👥", "人物关系"], ["add-note", "📄", "长笔记"], ["add-note", "💎", "金句"], ["add-note", "📎", "图片 / PDF"]] : [["add-book", "📖", "一本书"], ["add-category", "📂", "分类"], ["add-wish", "♡", "愿望池"]];
  openModal("新增", `<div class="add-menu">${choices.map(([action, icon, label]) => `<button data-action="${action}" ${onBook ? `data-book="${state.route.bookId}" data-note-type="${label}"` : ""}><span>${icon}</span>${label}</button>`).join("")}</div>`);
}

function bookForm(book = {}) {
  return `<form data-form="book" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(book.id || "")}"><label>书名<input required name="title" value="${escapeHtml(book.title || "")}" placeholder="例如：乔布斯传"></label><label>作者<input name="author" value="${escapeHtml(book.author || "")}" placeholder="作者"></label><label>分类<select name="category"><option value="">未分类</option>${options(state.categories, book.category)}</select></label><label>开始阅读日期<input type="date" name="startDate" value="${escapeHtml(book.startDate || today())}"></label><label>来源<input name="source" value="${escapeHtml(book.source || "")}" placeholder="书店、朋友推荐、微信读书…"></label><label>阅读阶段<select name="status"><option value="reading" ${book.status === "reading" ? "selected" : ""}>🌱 阅读中</option><option value="pending" ${book.status === "pending" ? "selected" : ""}>📝 待整理</option><option value="organized" ${book.status === "organized" ? "selected" : ""}>🌳 已整理</option></select></label><label class="span-2">为什么开始看<textarea name="reason" placeholder="那一刻，是什么让我翻开它？">${escapeHtml(book.reason || "")}</textarea></label><label class="span-2">第一印象<textarea name="firstImpression">${escapeHtml(book.firstImpression || "")}</textarea></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">保存</button></footer></form>`;
}

function openBookForm(book) { openModal(book ? "编辑初见" : "新增一本书", bookForm(book)); }
function openWishForm(wish = {}) { openModal(wish.id ? "编辑愿望" : "放进愿望池", `<form data-form="wish" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(wish.id || "")}"><label>书名<input required name="title" value="${escapeHtml(wish.title || "")}" placeholder="想读的书"></label><label>作者<input name="author" value="${escapeHtml(wish.author || "")}" placeholder="作者"></label><label>分类<select name="category"><option value="">未分类</option>${options(state.categories, wish.category)}</select></label><label>期待程度<select name="priority"><option value="high" ${wish.priority === "high" ? "selected" : ""}>❤️ 很想看</option><option value="medium" ${wish.priority === "medium" ? "selected" : ""}>💛 一般</option><option value="low" ${wish.priority === "low" ? "selected" : ""}>🤍 随缘</option></select></label><label class="span-2">为什么想看<textarea name="reason" placeholder="可选，留给未来的自己。">${escapeHtml(wish.reason || "")}</textarea></label><label class="span-2">来源<input name="source" value="${escapeHtml(wish.source || "")}" placeholder="微信读书、小红书、朋友推荐…"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">${wish.id ? "保存修改" : "放进愿望池"}</button></footer></form>`); }
function openCategoryForm() { openModal("新增分类", `<form data-form="category" class="form-grid"><label>分类名称<input required name="name" placeholder="例如：哲学"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">添加</button></footer></form>`); }
function openDailyForm(bookId) { openModal("新增每日卡片", `<form data-form="daily" class="form-grid"><input type="hidden" name="bookId" value="${bookId}"><label>日期<input type="date" name="date" value="${today()}"></label><label>阅读位置<input name="position" placeholder="章节、页码"></label><label class="span-2">💎 今日最有意思的一点<textarea required name="insight" placeholder="用一句话留住它。"></textarea></label><label class="span-2">💭 我的想法<textarea name="thought" placeholder="这让我想到什么？"></textarea></label><label class="span-2">🔗 联想到什么<textarea name="link" placeholder="人、事、旧笔记，或另一本书。"></textarea></label><label class="span-2">标签<input name="tags" placeholder="用逗号分开，可选"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">收下这次阅读</button></footer></form>`); }
function openNoteForm(bookId, suggestedType = "长笔记") {
  const types = ["思维导图", "人物关系", "时间线", "长笔记", "金句", "内容总结", "自己的理解", "关联书籍", "图片 / PDF"];
  openModal("添加整理内容", `<form data-form="note" class="form-grid note-form"><input type="hidden" name="bookId" value="${bookId}"><label>类型<select name="type">${options(types, suggestedType)}</select></label><label>标题<input required name="title" placeholder="给这份内容一个名字"></label><div class="span-2 form-field"><label for="note-resource-url">关联地址</label><span class="url-input-row"><input id="note-resource-url" type="text" inputmode="url" name="resourceUrl" placeholder="chatgpt.com 或完整网址"><button type="button" class="quiet-button" data-action="open-note-url">打开地址</button></span></div><label class="span-2 attachment-field">导入附件<input type="file" name="attachment" accept=".xmind,.pdf,.opml,.png,.jpg,.jpeg,.webp,.gif,image/*,application/pdf"></label><label class="span-2">文字补充<textarea name="content" placeholder="可选，补充说明这份整理内容。"></textarea></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">放入整理区</button></footer></form>`);
}

function onAction(event) {
  const target = event.target.closest("[data-action], [data-book]");
  if (!target) return;
  const modalSurface = event.target.closest("[data-modal-surface]");
  if (modalSurface && !modalSurface.contains(target)) return;
  const action = target.dataset.action;
  if (!action && target.dataset.book) { setRoute({ page: "book", bookId: target.dataset.book, deleteMode: "" }); return; }
  if (!action) return;
  if (action === "home") setRoute({ page: "home", query: "", deleteMode: "" });
  if (action === "wishes") setRoute({ page: "wishes", query: "", deleteMode: "" });
  if (action === "view") setRoute({ page: "home", view: target.dataset.view, deleteMode: "" });
  if (action === "category") setRoute({ page: "category", category: target.dataset.category, deleteMode: "" });
  if (action === "status-layout") setRoute({ statusLayout: target.dataset.layout });
  if (action === "direction") setRoute({ direction: state.route.direction === "asc" ? "desc" : "asc" });
  if (action === "view-menu") { setRoute({ page: "home", view: state.route.view === "category" ? "cover" : state.route.view === "cover" ? "status" : "category", deleteMode: "" }); }
  if (action === "theme") { const themes = ["white", "black", "pink", "green", "blue"]; state.theme = themes[(themes.indexOf(state.theme) + 1) % themes.length]; saveState(); render(); }
  if (action === "open-add") openAddMenu();
  if (action === "close-modal") closeModal();
  if (action === "add-book") openBookForm();
  if (action === "edit-book") openBookForm(state.books.find((book) => book.id === target.dataset.book));
  if (action === "add-wish") openWishForm();
  if (action === "edit-wish") openWishForm(state.wishes.find((wish) => wish.id === target.dataset.wish));
  if (action === "add-category") openCategoryForm();
  if (action === "add-daily") openDailyForm(target.dataset.book);
  if (action === "add-note") openNoteForm(target.dataset.book, target.dataset.noteType);
  if (action === "enter-delete-mode") setRoute({ deleteMode: target.dataset.deleteMode });
  if (action === "cancel-delete-mode") setRoute({ deleteMode: "" });
  if (action === "delete-selected-books") deleteBooks(getSelectedItemIds("book"));
  if (action === "delete-selected-daily") deleteDailyCards(target.dataset.book, getSelectedItemIds("daily"));
  if (action === "delete-selected-notes") deleteNotes(target.dataset.book, getSelectedItemIds("note"));
  if (action === "open-note-url") {
    const input = target.closest("form")?.elements.resourceUrl;
    const url = normalizeExternalUrl(input?.value);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else window.alert("请先填写有效的网址。");
  }
  if (action === "open-attachment") openStoredAttachment(target.dataset.attachment, target.dataset.preview === "true");
  if (action === "change-cover") openCoverPicker(target.dataset.book);
  if (action === "random-wish") pickRandomWish();
  if (action === "start-wish") startWish(target.dataset.wish);
}

function openCoverPicker(bookId) {
  openModal("更换封面", `<form data-form="cover" class="cover-picker"><input type="hidden" name="bookId" value="${bookId}"><p>从你的设备选择一张照片。图片只保存在当前浏览器里。</p><label class="upload-area">选择照片<input required type="file" name="cover" accept="image/*"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">使用这张封面</button></footer></form>`);
}

function pickRandomWish() {
  if (!state.wishes.length) return;
  const wish = state.wishes[Math.floor(Math.random() * state.wishes.length)];
  openModal("今天读这一本", `<div class="random-pick"><p class="eyebrow">A SMALL READING WINDOW</p><h2>${escapeHtml(wish.title)}</h2><p>${escapeHtml(wish.author || "未署名")} · ${escapeHtml(wish.category || "未分类")}</p><p>${escapeHtml(wish.reason || "也许现在正是打开它的时刻。")}</p><div class="form-actions"><button class="quiet-button" data-action="close-modal">换个时间</button><button class="primary-button" data-action="start-wish" data-wish="${wish.id}">开始阅读</button></div></div>`);
}

function startWish(wishId) {
  const index = state.wishes.findIndex((wish) => wish.id === wishId);
  if (index === -1) return;
  const wish = state.wishes.splice(index, 1)[0];
  const book = { id: uid(), title: wish.title, author: wish.author, category: wish.category, source: wish.source, reason: wish.reason, startDate: today(), firstImpression: "", expectation: "", status: "reading", createdAt: today(), lastRead: today(), color: "rose", dailyCards: [], notes: [] };
  state.books.unshift(book); saveState(); closeModal(); setRoute({ page: "book", bookId: book.id, deleteMode: "" });
}

function getSelectedItemIds(kind) {
  return [...document.querySelectorAll(`input[data-select-item="${kind}"]:checked`)].map((input) => input.dataset.itemId).filter(Boolean);
}

function updateBulkDeleteButton(kind) {
  const button = document.querySelector(`[data-bulk-delete="${kind}"]`);
  if (button) button.disabled = getSelectedItemIds(kind).length === 0;
}

function updateLastReadFromCards(book) {
  const latestCardDate = book.dailyCards.map((card) => card.date).filter(Boolean).sort().at(-1);
  book.lastRead = latestCardDate || book.startDate || book.createdAt || today();
}

function deleteBooks(bookIds) {
  const ids = new Set((bookIds || []).filter(Boolean));
  if (!ids.size) return;
  const deletedBooks = state.books.filter((book) => ids.has(book.id));
  if (!deletedBooks.length) return;
  const message = deletedBooks.length === 1 ? "确定删除这本书吗？" : `确定删除选中的 ${deletedBooks.length} 本书吗？`;
  if (!window.confirm(message)) return;
  const attachmentIds = deletedBooks.flatMap((book) => book.notes.map((note) => note.attachment?.id).filter(Boolean));
  state.books = state.books.filter((book) => !ids.has(book.id));
  state.route.deleteMode = "";
  saveState();
  render();
  if (attachmentIds.length) Promise.allSettled(attachmentIds.map(deleteStoredAttachment));
}

function deleteDailyCards(bookId, cardIds) {
  const book = state.books.find((entry) => entry.id === bookId);
  const ids = new Set((cardIds || []).filter(Boolean));
  if (!book || !ids.size) return;
  const count = book.dailyCards.filter((card) => ids.has(card.id)).length;
  if (!count) return;
  const message = count === 1 ? "确定删除这条阅读记录吗？" : `确定删除选中的 ${count} 条阅读记录吗？`;
  if (!window.confirm(message)) return;
  book.dailyCards = book.dailyCards.filter((card) => !ids.has(card.id));
  updateLastReadFromCards(book);
  state.route.deleteMode = "";
  saveState();
  render();
}

function deleteNotes(bookId, noteIds) {
  const book = state.books.find((entry) => entry.id === bookId);
  const ids = new Set((noteIds || []).filter(Boolean));
  if (!book || !ids.size) return;
  const deletedNotes = book.notes.filter((note) => ids.has(note.id));
  if (!deletedNotes.length) return;
  const message = deletedNotes.length === 1 ? "确定删除这条整理内容吗？" : `确定删除选中的 ${deletedNotes.length} 条整理内容吗？`;
  if (!window.confirm(message)) return;
  const attachmentIds = deletedNotes.map((note) => note.attachment?.id).filter(Boolean);
  book.notes = book.notes.filter((note) => !ids.has(note.id));
  state.route.deleteMode = "";
  saveState();
  render();
  if (attachmentIds.length) Promise.allSettled(attachmentIds.map(deleteStoredAttachment));
}

function prepareCoverForStorage(file) {
  return new Promise((resolve, reject) => {
    const source = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      source.onload = () => {
        const maxEdge = 720;
        const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };
      source.onerror = reject;
      source.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onForm(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "search") { setRoute({ page: "search", query: data.query.trim(), deleteMode: "" }); return; }
  if (form.dataset.form === "book") {
    const existing = state.books.find((book) => book.id === data.id);
    const record = { ...data, id: data.id || uid(), createdAt: existing?.createdAt || today(), lastRead: existing?.lastRead || today(), color: existing?.color || "rose", coverImage: existing?.coverImage, dailyCards: existing?.dailyCards || [], notes: existing?.notes || [] };
    if (existing) Object.assign(existing, record); else state.books.unshift(record);
    saveState(); closeModal(); setRoute({ page: "book", bookId: record.id, deleteMode: "" });
  }
  if (form.dataset.form === "wish") { const existing = state.wishes.find((wish) => wish.id === data.id); if (existing) Object.assign(existing, { ...existing, ...data }); else state.wishes.unshift({ ...data, id: uid(), createdAt: today() }); saveState(); closeModal(); render(); }
  if (form.dataset.form === "category") { const name = data.name.trim(); if (name && !state.categories.includes(name)) state.categories.push(name); saveState(); closeModal(); render(); }
  if (form.dataset.form === "daily") { const book = state.books.find((entry) => entry.id === data.bookId); if (book) { book.dailyCards.push({ ...data, id: uid(), tags: data.tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) }); book.lastRead = data.date; saveState(); closeModal(); render(); } }
  if (form.dataset.form === "note") {
    const book = state.books.find((entry) => entry.id === data.bookId);
    const file = form.elements.attachment.files[0];
    const resourceUrl = normalizeExternalUrl(data.resourceUrl);
    const title = data.title.trim();
    const content = data.content.trim();
    if (!title) { window.alert("请填写整理内容的标题。"); return; }
    if (data.resourceUrl && !resourceUrl) { window.alert("关联地址格式不正确，请检查后再试。"); return; }
    if (!content && !resourceUrl && !file) { window.alert("请填写文字、关联地址或导入一个附件。"); return; }
    if (file?.size > MAX_ATTACHMENT_SIZE) { window.alert("单个附件请不要超过 25 MB。"); return; }
    if (book) {
      try {
        const attachment = file ? await storeAttachment(file) : undefined;
        book.notes.unshift({ id: uid(), type: data.type, title, content, resourceUrl, attachment, createdAt: today() });
        saveState(); closeModal(); render();
      } catch {
        window.alert("附件保存失败，请换一个文件或稍后再试。");
      }
    }
  }
  if (form.dataset.form === "cover") { const file = form.elements.cover.files[0]; const book = state.books.find((entry) => entry.id === data.bookId); if (!file || !book) return; prepareCoverForStorage(file).then((image) => { book.coverImage = image; saveState(); closeModal(); render(); }).catch(() => { window.alert("这张照片暂时无法读取，请换一张试试。"); }); }
}

document.addEventListener("click", onAction);
document.addEventListener("submit", onForm);
document.addEventListener("change", (event) => {
  if (event.target.dataset.control === "sort") setRoute({ sort: event.target.value });
  if (event.target.dataset.status) { const book = state.books.find((entry) => entry.id === event.target.dataset.status); if (book) { book.status = event.target.value; saveState(); render(); } }
  if (event.target.dataset.selectItem) updateBulkDeleteButton(event.target.dataset.selectItem);
});

render();
