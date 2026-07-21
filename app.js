const STORAGE_KEY = "personal-reading-library-v1";
const ATTACHMENT_DB = "personal-reading-library-files";
const ATTACHMENT_STORE = "attachments";
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const SUPABASE_URL = "https://pvzixscmdbzxsaywedhs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gJpnWRkLJnbcJRm0IU2YJA_hSLvn6jV";
const BOOK_CATEGORIES = ["人物传记", "历史", "认知", "心理", "商业", "小说", "其他"];
const $ = (selector, parent = document) => parent.querySelector(selector);
const cloudClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let cloudUser = null;
let cloudReady = false;
let cloudStatus = cloudClient ? "local" : "unavailable";
let cloudSaveTimer = null;

const today = () => new Date().toISOString().slice(0, 10);
const dateFromUnix = (value) => Number(value) > 0 ? new Date(Number(value) * 1000).toISOString().slice(0, 10) : "";
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
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

function normalizeWeReadUrl(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return ["http:", "https:", "weread:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function classifyBookCategory(book = {}) {
  const title = String(book.title || "");
  const sourceCategory = String(book.sourceCategory || book.category || "");
  if (BOOK_CATEGORIES.includes(sourceCategory)) return sourceCategory;
  const corpus = `${sourceCategory} ${title}`;
  if (/^人物传记-|(?:自传|传记|回忆录|口述史|亲笔自传|CEO自述|人物志)/.test(corpus) || /(?:传|传记)(?:（|\(|：|:|$)/.test(title)) return "人物传记";
  if (/^(历史-|政治军事-)|历史|史记|世界史|中国古代|考古/.test(corpus)) return "历史";
  if (/^心理-|个人成长-(?:情绪心灵|女性成长)|生活百科-情感|心理学|心理问题|情绪|焦虑|亲密关系|人格|疗愈/.test(corpus)) return "心理";
  if (/^经济理财-|商业|管理者|管理学|创业|投资|理财|经济学|金融|营销|公司|企业/.test(corpus)) return "商业";
  if (/^精品小说-|^文学-(?:外国文学|经典作品)|^童书-儿童文学|小说|悬疑|推理|科幻/.test(corpus)) return "小说";
  if (/^个人成长-|^社会文化-|^科学技术-|^哲学宗教-|^艺术-|^教育-|^文学-(?:散文杂著|现代诗歌)|认知|思维|思考|学习|习惯|高效|自我管理|哲学|社会|文化|科学|科普|散文|诗歌/.test(corpus)) return "认知";
  return "其他";
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPreviewableAttachment(attachment = {}) {
  return /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i.test(attachment.type || "") || /\.(pdf|png|jpe?g|webp|gif)$/i.test(attachment.name || "");
}

function normalizeProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function progressRatio(book = {}) {
  const total = normalizeProgress(book.progressTotal);
  if (!total) return 0;
  return Math.min(normalizeProgress(book.progressCurrent) / total, 1);
}

function progressPercent(book = {}) {
  return Math.round(progressRatio(book) * 100);
}

function progressText(book = {}) {
  const total = normalizeProgress(book.progressTotal);
  const current = normalizeProgress(book.progressCurrent);
  const unit = normalizeProgressUnit(book.progressUnit);
  if (!total) return current ? `读到 ${current} ${unit}` : "未记录";
  return `${current} / ${total}${unit ? ` ${unit}` : ""} · ${progressPercent(book)}%`;
}

function normalizeProgressUnit(value = "页") {
  return String(value || "页").trim() || "页";
}

function normalizePositionText(value = "") {
  return String(value).trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[／⁄]/g, "/");
}

function inferProgressUnit(text = "", fallback = "页") {
  if (/章|chapter|ch\./i.test(text)) return "章";
  if (/页|p(?:age)?s?\.?/i.test(text)) return "页";
  return normalizeProgressUnit(fallback);
}

function parseProgressPosition(position, book = {}) {
  const text = normalizePositionText(position);
  if (!text) return null;
  const pair = text.match(/(\d+(?:\.\d+)?)\s*(?:页|章|p(?:age)?s?\.?)?\s*\/\s*(\d+(?:\.\d+)?)/i);
  if (pair) {
    const total = normalizeProgress(pair[2]);
    if (!total) return null;
    return { current: normalizeProgress(pair[1]), total, unit: inferProgressUnit(text, book.progressUnit) };
  }
  const explicitUnit = text.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(页|章|p(?:age)?s?\.?)(?:\s|$)/i);
  if (explicitUnit) return { current: normalizeProgress(explicitUnit[1]), unit: inferProgressUnit(explicitUnit[2], book.progressUnit) };
  if (/^\d+(?:\.\d+)?$/.test(text)) return { current: normalizeProgress(text), unit: normalizeProgressUnit(book.progressUnit) };
  return null;
}

function applyProgressFromPosition(book, position) {
  const progress = parseProgressPosition(position, book);
  if (!progress) return false;
  book.progressCurrent = progress.current;
  if (progress.total !== undefined) book.progressTotal = progress.total;
  book.progressUnit = progress.unit || normalizeProgressUnit(book.progressUnit);
  return true;
}

function rebuildProgressFromDailyCards(book) {
  const rebuilt = { progressCurrent: 0, progressTotal: normalizeProgress(book.progressTotal), progressUnit: normalizeProgressUnit(book.progressUnit) };
  const sortedCards = [...book.dailyCards].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.id || "").localeCompare(String(b.id || "")));
  const hasProgress = sortedCards.reduce((found, card) => applyProgressFromPosition(rebuilt, card.position) || found, false);
  book.progressCurrent = hasProgress ? rebuilt.progressCurrent : 0;
  book.progressTotal = hasProgress ? rebuilt.progressTotal : 0;
  book.progressUnit = hasProgress ? rebuilt.progressUnit : normalizeProgressUnit(book.progressUnit);
}

function normalizeBook(book = {}) {
  return {
    ...book,
    progressCurrent: normalizeProgress(book.progressCurrent),
    progressTotal: normalizeProgress(book.progressTotal),
    progressUnit: normalizeProgressUnit(book.progressUnit),
    dailyCards: Array.isArray(book.dailyCards) ? book.dailyCards : [],
    notes: Array.isArray(book.notes) ? book.notes : [],
  };
}

function normalizeLibraryState(library) {
  const validWishes = Array.isArray(library.wishes)
    ? library.wishes.filter((wish) => !(wish.source === "微信读书" && /\uFFFD/.test(`${wish.title || ""}${wish.author || ""}`)))
    : [];
  return {
    ...library,
    categories: [...BOOK_CATEGORIES],
    books: (library.books || []).map((book) => normalizeBook({ ...book, category: BOOK_CATEGORIES.includes(book.category) ? book.category : classifyBookCategory({ ...book, sourceCategory: book.category }) })),
    wishes: validWishes.map((wish) => ({ ...wish, category: BOOK_CATEGORIES.includes(wish.category) ? wish.category : classifyBookCategory({ ...wish, sourceCategory: wish.category }), categoryLocked: wish.categoryLocked ?? true })),
  };
}

const starterState = {
  theme: "white",
  route: { page: "home", view: "category", statusLayout: "category", sort: "lastRead", direction: "desc", deleteMode: "", noteFilter: "all" },
  categories: [...BOOK_CATEGORIES],
  books: [
    {
      id: "book-1", title: "苏东坡传", author: "林语堂", category: "人物传记", startDate: "2026-07-10", source: "朋友推荐", reason: "想借一段不被得失困住的人生，重新校准自己的节奏。", firstImpression: "文字有一种很从容的光。", expectation: "读到他如何把困顿过成一种气象。", status: "reading", createdAt: "2026-07-10", lastRead: "2026-07-16", color: "sage", progressCurrent: 23, progressTotal: 100, progressUnit: "页",
      dailyCards: [{ id: "card-1", date: "2026-07-16", position: "第一章", insight: "他好像总能把失意变成对生活更具体的热爱。", thought: "我羡慕的不是豁达，而是那种不急着证明自己的能力。", link: "想到最近刻意留出的散步时间。" }],
      notes: [{ id: "note-1", type: "金句", title: "做一个完整的人", content: "把读到的片段留在这里，等它们慢慢和生活发生关系。", createdAt: "2026-07-16" }],
    },
    {
      id: "book-2", title: "置身事内", author: "兰小欢", category: "商业", startDate: "2026-06-26", source: "微信读书", reason: "想把新闻里零散的经济话题，放回一个更完整的框架。", firstImpression: "信息密度很高，但叙述并不生硬。", expectation: "理解地方经济运行的逻辑。", status: "pending", createdAt: "2026-06-26", lastRead: "2026-07-11", color: "ink", progressCurrent: 56, progressTotal: 100, progressUnit: "页",
      dailyCards: [{ id: "card-2", date: "2026-07-11", position: "第三章", insight: "很多看似局部的选择，背后是激励结构。", thought: "理解结构不是为了变得冷漠，而是为了少一点轻率判断。", link: "联想到城市规划的讨论。" }],
      notes: [{ id: "note-2", type: "内容总结", title: "一个理解问题的框架", content: "先看参与者、资源和约束，再谈结果。", createdAt: "2026-07-12" }],
    },
    {
      id: "book-3", title: "始于陌生的相遇", author: "佚名", category: "小说", startDate: "2026-05-18", source: "书店偶遇", reason: "被封面的安静感吸引。", firstImpression: "像一盏很晚才亮起的灯。", expectation: "留意它如何写人与人之间的距离。", status: "organized", createdAt: "2026-05-18", lastRead: "2026-06-02", color: "image", progressCurrent: 100, progressTotal: 100, progressUnit: "页",
      dailyCards: [{ id: "card-3", date: "2026-06-02", position: "全书", insight: "关系并不总靠抵达来证明。", thought: "有些理解可以留白。", link: "想起很久未联系的一位朋友。" }],
      notes: [{ id: "note-3", type: "自己的理解", title: "关于留白", content: "读完后仍然有些地方说不清，这也许正是它留给我的部分。", createdAt: "2026-06-03" }],
    },
  ],
  wishes: [
    { id: "wish-1", title: "东京八平米", author: "吉井忍", category: "认知", startDate: "2026-07-15", source: "小红书", status: "wish", createdAt: "2026-07-15" },
    { id: "wish-2", title: "枪炮、病菌与钢铁", author: "贾雷德·戴蒙德", category: "历史", startDate: "2026-07-12", source: "朋友推荐", status: "wish", createdAt: "2026-07-12" },
  ],
};

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeLibraryState(saved ? { ...starterState, ...saved, route: starterState.route } : structuredClone(starterState));
  } catch {
    return normalizeLibraryState(structuredClone(starterState));
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateForStorage()));
  queueCloudSave();
}

function stateForStorage() {
  return { ...state, route: undefined };
}

function queueCloudSave() {
  if (!cloudClient || !cloudUser || !cloudReady) return;
  window.clearTimeout(cloudSaveTimer);
  cloudStatus = "saving";
  cloudSaveTimer = window.setTimeout(() => pushCloudState(), 450);
}

async function pushCloudState() {
  if (!cloudClient || !cloudUser) return false;
  cloudStatus = "saving";
  render();
  const { error } = await cloudClient.from("library_states").upsert({
    user_id: cloudUser.id,
    data: stateForStorage(),
    updated_at: new Date().toISOString(),
  });
  cloudStatus = error ? "error" : "synced";
  render();
  return !error;
}

async function applyCloudSession(session) {
  cloudUser = session?.user || null;
  cloudReady = false;
  if (!cloudUser) {
    cloudStatus = cloudClient ? "local" : "unavailable";
    cloudReady = true;
    render();
    return;
  }
  cloudStatus = "loading";
  render();
  const { data, error } = await cloudClient.from("library_states").select("data").eq("user_id", cloudUser.id).maybeSingle();
  if (error) {
    cloudStatus = "error";
    cloudReady = true;
    render();
    return;
  }
  if (data?.data) {
    state = normalizeLibraryState({ ...starterState, ...data.data, route: state.route });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateForStorage()));
  } else {
    const { error: uploadError } = await cloudClient.from("library_states").upsert({
      user_id: cloudUser.id,
      data: stateForStorage(),
      updated_at: new Date().toISOString(),
    });
    if (uploadError) {
      cloudStatus = "error";
      cloudReady = true;
      render();
      return;
    }
  }
  cloudStatus = "synced";
  cloudReady = true;
  render();
}

async function initializeCloud() {
  if (!cloudClient) return;
  const { data } = await cloudClient.auth.getSession();
  await applyCloudSession(data.session);
  cloudClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (session?.user?.id !== cloudUser?.id) applyCloudSession(session);
    }, 0);
  });
}

function cloudStatusText() {
  if (cloudStatus === "loading") return "☁ 正在读取";
  if (cloudStatus === "saving") return "☁ 正在同步";
  if (cloudStatus === "synced") return "☁ 已同步";
  if (cloudStatus === "error") return "☁ 同步失败";
  if (cloudStatus === "unavailable") return "☁ 暂不可用";
  return "☁ 登录同步";
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
    <span class="book-row-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "未署名")}</small></span>`;
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

function statusBookRow(book, selectable = false) {
  const content = `${cover(book, true)}
    <span class="book-row-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "未署名")}</small></span>`;
  if (selectable) {
    return `<article class="book-row status-book-row selectable-book">
    ${content}
    ${selectionControl("book", book.id, "选择这本书")}
  </article>`;
  }
  return `<button class="book-row status-book-row" data-book="${book.id}">
    ${content}
  </button>`;
}

function renderCoverBookCard(book, selectable = false) {
  const content = `${cover(book)}<strong>${escapeHtml(book.title)}</strong>`;
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
  return `<article class="first-meet-card field-grid editable-region" data-book-id="${escapeHtml(book.id)}"><div><span>为什么开始看</span><p>${escapeHtml(book.reason || "还没有写下这个答案。")}</p></div><div><span>第一印象</span><p>${escapeHtml(book.firstImpression || "还没有写下第一印象。")}</p></div></article>`;
}

function renderDailyCard(card, bookId, selectable = false) {
  const selection = selectable ? `<div class="card-toolbar-actions">${selectionControl("daily", card.id, "选择这条阅读记录")}</div>` : "";
  return `<article class="daily-card" data-daily-card="${escapeHtml(card.id)}" data-daily-book="${escapeHtml(bookId)}"><div class="card-toolbar"><time>${formatDate(card.date)} · ${escapeHtml(card.position || "未标记位置")}</time>${selection}</div><h3>💎 ${escapeHtml(card.insight || "今日最有意思的一点")}</h3><p><b>💭</b> ${escapeHtml(card.thought || "")}</p>${card.link ? `<p><b>🔗</b> ${escapeHtml(card.link)}</p>` : ""}</article>`;
}

function renderNoteCard(note, bookId, selectable = false) {
  const resourceUrl = normalizeExternalUrl(note.resourceUrl);
  const attachment = note.attachment?.id ? note.attachment : null;
  const attachmentLabel = note.attachmentTitle?.trim() || attachment?.name || "";
  const selection = selectable ? `<div class="card-toolbar-actions">${selectionControl("note", note.id, "选择这条整理内容")}</div>` : "";
  const resources = [
    resourceUrl ? `<a class="note-resource-link" href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener noreferrer">打开关联地址 ↗</a>` : "",
    attachment ? `<button class="note-attachment-button" data-action="open-attachment" data-attachment="${escapeHtml(attachment.id)}" data-preview="${isPreviewableAttachment(attachment)}">${isPreviewableAttachment(attachment) ? "打开" : "下载"} ${escapeHtml(attachmentLabel)} <small>${formatFileSize(attachment.size)}</small></button>` : "",
  ].filter(Boolean).join("");
  return `<article class="note-card editable-region" data-note-card="${escapeHtml(note.id)}" data-note-book="${escapeHtml(bookId)}"><div class="card-toolbar"><span class="note-kind">${escapeHtml(note.type)}</span>${selection}</div><h3>${escapeHtml(note.title)}</h3>${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}${resources ? `<div class="note-card-actions">${resources}</div>` : ""}</article>`;
}

function renderNoteFilter(book, activeType) {
  const types = [...new Set(book.notes.map((note) => note.type).filter(Boolean))];
  if (types.length < 2) return "";
  return `<label class="note-filter"><span class="sr-only">整理区筛选</span><select data-control="note-filter" aria-label="整理区筛选"><option value="all" ${activeType === "all" ? "selected" : ""}>全部整理</option>${types.map((type) => `<option value="${escapeHtml(type)}" ${activeType === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></label>`;
}

function renderAppShell(content, options = {}) {
  const { page = "home", title = "我的图书馆", subtitle = "让每本书留下它在你生命里的位置" } = options;
  const homeDeleteActive = page === "home" && state.route.deleteMode === "book";
  const homeDeleteButton = page === "home" ? `<button class="icon-button delete-icon ${homeDeleteActive ? "is-active" : ""}" data-action="${homeDeleteActive ? "cancel-delete-mode" : "enter-delete-mode"}" ${homeDeleteActive ? "" : 'data-delete-mode="book"'} title="${homeDeleteActive ? "退出删除" : "删除书籍"}" aria-label="${homeDeleteActive ? "退出删除" : "删除书籍"}">×</button>` : "";
  return `<main class="app-shell">
    <header class="topbar">
      <form class="search" data-form="search"><span aria-hidden="true">⌕</span><input name="query" value="${escapeHtml(state.route.query || "")}" placeholder="搜索书、想法、标签或整理内容" autocomplete="off"></form>
      <button class="cloud-sync-button" data-action="cloud-account" title="云端同步">${escapeHtml(cloudStatusText())}</button>
    </header>
    <section class="page-heading"><div><p class="eyebrow">${page === "book" ? "BOOK PAGE" : page === "wishes" ? "WISH POOL" : "PRIVATE COLLECTION"}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="heading-tools">${page !== "book" ? `<span class="collection-count">${state.books.length} 本已入馆</span>` : ""}<nav class="actions" aria-label="图书馆工具"><button class="icon-button" data-action="theme" title="换肤" aria-label="换肤">◐</button>${homeDeleteButton}<button class="icon-button ${page === "wishes" ? "is-active" : ""}" data-action="wishes" title="愿望池" aria-label="愿望池">♡</button><button class="icon-button ${page === "home" ? "is-active" : ""}" data-action="view-menu" title="切换视图" aria-label="切换视图">▦</button></nav></div></section>
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
    let value = 0;
    if (sort === "progress") {
      value = progressRatio(a) - progressRatio(b);
      if (!value) value = String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
    } else {
      const field = sort === "title" ? "title" : sort === "created" ? "createdAt" : "lastRead";
      value = String(a[field] || "").localeCompare(String(b[field] || ""), "zh-CN");
    }
    return direction === "asc" ? value : -value;
  });
  return `<section class="cover-view"><div class="toolbar"><div class="sorts"><label class="sort-select"><span class="sr-only">排序方式</span><select data-control="sort" aria-label="排序方式"><option value="lastRead" ${sort === "lastRead" ? "selected" : ""}>最后阅读</option><option value="created" ${sort === "created" ? "selected" : ""}>加入时间</option><option value="title" ${sort === "title" ? "selected" : ""}>书名</option><option value="progress" ${sort === "progress" ? "selected" : ""}>阅读进度</option></select></label><button class="quiet-button" data-action="direction">${direction === "asc" ? "↑ 升序" : "↓ 降序"}</button></div><span>无形书架，按你此刻的方式相遇。</span></div><div class="cover-grid">${sorted.map((book) => renderCoverBookCard(book, bookDeleteActive())).join("")}</div></section>`;
}

function renderStatusView() {
  const statuses = [["reading", "🌱 阅读中"], ["pending", "📝 待整理"], ["organized", "🌳 已整理"]];
  const selectable = bookDeleteActive();
  return `<section class="status-board"><div class="toolbar"><p>每本书都可以随时回到任何阶段。</p></div><div class="status-columns">${statuses.map(([status, label]) => { const books = state.books.filter((book) => book.status === status); return `<article class="status-column"><header><h2>${label}</h2></header>${renderStatusCategory(books, selectable)}</article>`; }).join("")}</div></section>`;
}

function renderStatusCategory(books, selectable = false) {
  const grouped = groupBy(books, (book) => book.category || "未分类");
  return Object.entries(grouped).map(([category, entries]) => `<section class="status-group"><p>${escapeHtml(category)}</p><div class="book-list">${entries.map((book) => statusBookRow(book, selectable)).join("")}</div></section>`).join("") || empty("暂时没有");
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
  const activeNoteFilter = state.route.noteFilter && book.notes.some((note) => note.type === state.route.noteFilter) ? state.route.noteFilter : "all";
  const visibleNotes = activeNoteFilter === "all" ? book.notes : book.notes.filter((note) => note.type === activeNoteFilter);
  const noteHeaderTools = `<div class="note-header-tools">${renderNoteFilter(book, activeNoteFilter)}${noteActions}</div>`;
  const timelineClass = cards.length ? "timeline timeline-list" : "timeline";
  const notesEmptyText = activeNoteFilter === "all" ? "想法不必一次整理完，它们会慢慢长出来。" : "这个类型下面暂时还没有整理内容。";
  const percent = progressPercent(book);
  return renderAppShell(`<section class="book-nav"><button class="quiet-button" data-action="home">返回图书馆 →</button></section><div class="detail-layout"><aside class="book-profile">${cover(book)}<div><p class="eyebrow">${escapeHtml(book.category || "未分类")}</p><h2>${escapeHtml(book.title)}</h2><p class="book-author">${escapeHtml(book.author || "未署名")}</p></div><button class="quiet-button full" data-action="change-cover" data-book="${book.id}">更换封面</button><label class="field-label">阅读阶段<select data-status="${book.id}"><option value="reading" ${book.status === "reading" ? "selected" : ""}>🌱 阅读中</option><option value="pending" ${book.status === "pending" ? "selected" : ""}>📝 待整理</option><option value="organized" ${book.status === "organized" ? "selected" : ""}>🌳 已整理</option></select></label><dl class="book-facts"><div><dt>开始阅读</dt><dd>${formatDate(book.startDate)}</dd></div><div><dt>来源</dt><dd>${escapeHtml(book.source || "未记录")}</dd></div><div class="progress-fact"><dt>阅读进度</dt><dd>${escapeHtml(progressText(book))}<span class="progress-meter" aria-hidden="true"><i style="width: ${percent}%"></i></span></dd></div></dl></aside><div class="detail-stack"><section class="detail-panel"><div class="section-header"><div><p class="eyebrow">FIRST MEET</p><h2>初见</h2></div></div>${renderFirstMeetCard(book)}</section><section class="detail-panel"><div class="section-header"><div><p class="eyebrow">READING DAYS</p><h2>每日卡片</h2></div>${dailyActions}</div><div class="${timelineClass}">${cards.map((card) => renderDailyCard(card, book.id, dailyDeleteActive)).join("") || empty("还没有每日卡片。一次阅读，留下一张就够了。")}</div></section><section class="detail-panel notes-panel"><div class="section-header"><div><p class="eyebrow">GROWING NOTES</p><h2>整理区</h2></div>${noteHeaderTools}</div><div class="notes-grid notes-tray">${visibleNotes.map((note) => renderNoteCard(note, book.id, noteDeleteActive)).join("") || empty(notesEmptyText)}</div></section></div></div>`, { page: "book", title: book.title, subtitle: "这本书在你这里留下的痕迹" });
}

function renderWishes() {
  return renderAppShell(`<section class="book-nav"><button class="quiet-button" data-action="home">返回图书馆 →</button></section><section class="wishlist-panel"><div class="wishlist-head"><div><p class="eyebrow">SOMEDAY SHELF</p><h2>愿望池</h2><p>微信读书里的未读书籍，先在这里等候。</p></div><button class="primary-button" data-action="random-wish">🎲 随机抽一本</button></div><div class="wishlist-grid">${state.wishes.map((wish) => `<article class="wish-card editable-region" data-wish-id="${escapeHtml(wish.id)}"><div><span class="wish-priority">♡ 未读</span><p class="eyebrow">${escapeHtml(wish.category || "其他")}</p><h3>${escapeHtml(wish.title)}</h3><p class="book-author">${escapeHtml(wish.author || "未署名")}</p></div><div class="wish-meta"><small>${formatDate(wish.startDate || wish.createdAt)}</small><small>来自 ${escapeHtml(wish.source || "未记录")}</small></div><div class="wish-actions">${wish.wereadUrl ? `<button class="quiet-button" data-action="open-wish-url" data-wish="${wish.id}">微信读书 ↗</button>` : ""}<button class="quiet-button" data-action="start-wish" data-wish="${wish.id}">开始阅读</button></div></article>`).join("") || empty("愿望池很安静，等下一本想读的书。")}</div></section>`, { page: "wishes", title: "愿望池", subtitle: "还没相遇，但已经为它们留了位置" });
}

function renderSearch(query) {
  const normalized = query.toLocaleLowerCase();
  const results = state.books.filter((book) => JSON.stringify(book).toLocaleLowerCase().includes(normalized));
  return renderAppShell(`<section class="search-panel"><div class="section-header"><div><p class="eyebrow">FULL TEXT SEARCH</p><h2>“${escapeHtml(query)}”</h2></div><span>${results.length} 个结果</span></div><div class="search-results">${results.map((book) => `<button class="result-card" data-book="${book.id}">${cover(book, true)}<span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "") } · ${escapeHtml(book.category || "")}</small><p>${escapeHtml(searchExcerpt(book, query))}</p></span><i>→</i></button>`).join("") || empty("没有找到结果。试试书名、作者、标签或你写下的一个词。")}</div></section>`, { page: "search", title: "搜索结果", subtitle: "从一本书，也从一个念头重新进入" });
}

function searchExcerpt(book, query) {
  const corpus = [book.reason, book.firstImpression, book.expectation, ...book.dailyCards.flatMap((card) => [card.insight, card.thought, card.link]), ...book.notes.flatMap((note) => [note.title, note.content])].filter(Boolean).join(" · ");
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
  if (page === "book" && book?.wereadUrl) {
    $(".book-profile [data-action=\"change-cover\"]")?.insertAdjacentHTML("afterend", `<button class="quiet-button full book-source-link" data-action="open-book-url" data-book="${escapeHtml(book.id)}">在微信读书打开 ↗</button>`);
  }
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

function openCloudAccount() {
  if (!cloudClient) {
    window.alert("云端同步组件暂时没有加载成功，请刷新页面后再试。");
    return;
  }
  if (cloudUser) {
    openModal("云端书库", `<div class="cloud-account-panel"><p class="cloud-account-email">${escapeHtml(cloudUser.email || "已登录")}</p><p>登录同一账号后，其他浏览器和设备会读取同一份书库。</p><div class="form-actions"><button type="button" class="quiet-button" data-action="cloud-sign-out">退出登录</button><button type="button" class="primary-button" data-action="cloud-sync-now">立即同步</button></div></div>`);
    return;
  }
  openModal("登录云端书库", `<form data-form="cloud-auth" class="form-grid cloud-auth-form"><div class="span-2 import-intro"><strong>让书库在不同设备保持一致</strong><p>第一次使用请选择“注册并同步”；已有账号直接登录。首次注册可能需要到邮箱点击确认链接。</p></div><label class="span-2">邮箱<input required type="email" name="email" autocomplete="email" placeholder="你的邮箱"></label><label class="span-2">密码<input required minlength="8" type="password" name="password" autocomplete="current-password" placeholder="至少 8 位"></label><footer class="form-actions"><button class="quiet-button" name="authMode" value="signup">注册并同步</button><button class="primary-button" name="authMode" value="signin">登录</button></footer></form>`);
}

function openAddMenu() {
  const onBook = state.route.page === "book";
  const choices = onBook ? [["add-daily", "🌱", "每日卡片"], ["add-note", "🧠", "思维导图"], ["add-note", "👥", "人物关系"], ["add-note", "📄", "长笔记"], ["add-note", "💎", "金句"], ["add-note", "📎", "图片 / PDF"]] : [["add-book", "📖", "一本书"], ["import-weread", "⚡", "微信读书 / 批量导入"], ["add-category", "📂", "分类"], ["add-wish", "♡", "愿望池"]];
  openModal("新增", `<div class="add-menu">${choices.map(([action, icon, label]) => `<button data-action="${action}" ${onBook ? `data-book="${state.route.bookId}" data-note-type="${label}"` : ""}><span>${icon}</span>${label}</button>`).join("")}</div>`);
}

function bookForm(book = {}) {
  return `<form data-form="book" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(book.id || "")}"><label>书名<input required name="title" value="${escapeHtml(book.title || "")}" placeholder="例如：乔布斯传"></label><label>作者<input name="author" value="${escapeHtml(book.author || "")}" placeholder="作者"></label><label>分类<select name="category"><option value="">未分类</option>${options(state.categories, book.category)}</select></label><label>开始阅读日期<input type="date" name="startDate" value="${escapeHtml(book.startDate || today())}"></label><label>来源<input name="source" value="${escapeHtml(book.source || "")}" placeholder="书店、朋友推荐、微信读书…"></label><label>阅读阶段<select name="status"><option value="reading" ${book.status === "reading" ? "selected" : ""}>🌱 阅读中</option><option value="pending" ${book.status === "pending" ? "selected" : ""}>📝 待整理</option><option value="organized" ${book.status === "organized" ? "selected" : ""}>🌳 已整理</option></select></label><label class="span-2">微信读书链接<input type="url" name="wereadUrl" value="${escapeHtml(book.wereadUrl || "")}" placeholder="https://weread.qq.com/..."></label><label class="span-2">为什么开始看<textarea name="reason" placeholder="那一刻，是什么让我翻开它？">${escapeHtml(book.reason || "")}</textarea></label><label class="span-2">第一印象<textarea name="firstImpression">${escapeHtml(book.firstImpression || "")}</textarea></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">保存</button></footer></form>`;
}

function openBookForm(book) { openModal(book ? "编辑初见" : "新增一本书", bookForm(book)); }
function openWeReadImport() {
  openModal("从微信读书导入愿望池", `<form data-form="weread-import" class="form-grid import-form"><div class="span-2 import-intro"><strong>一次同步，全部进入愿望池</strong><p>支持完整微信读书书架 JSON、分享文字，或每行一本：<code>书名 | 作者 | 分类 | 链接</code>。系统会自动归入六个主题分类，无法可靠判断的书放进“其他”。</p></div><label class="span-2">粘贴书架信息<textarea required name="content" rows="9" placeholder="粘贴微信读书书架 JSON，或：\n《置身事内》\n作者：兰小欢\nhttps://weread.qq.com/..."></textarea></label><label class="span-2">分类方式<select name="category"><option value="">自动识别（推荐）</option>${options(state.categories)}</select></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">导入愿望池</button></footer></form>`);
}

function cleanImportedText(value = "") {
  return String(value).replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").trim();
}

function importedBookFromObject(entry = {}) {
  const album = entry.albumInfo || {};
  const albumExtra = entry.albumInfoExtra || {};
  return {
    title: cleanImportedText(entry.title || entry.bookName || entry.name || album.name),
    author: cleanImportedText(entry.author || entry.authorName || entry.writer || album.authorName),
    sourceCategory: cleanImportedText(entry.sourceCategory || entry.category || entry.genre || (entry.albumInfo ? "有声书" : "")),
    wereadUrl: normalizeWeReadUrl(entry.deepLink || entry.wereadUrl || entry.bookUrl || entry.url || entry.link),
    coverImage: normalizeExternalUrl(entry.coverImage || entry.cover || entry.coverUrl || album.cover),
    wereadBookId: cleanImportedText(entry.bookId || entry.wereadBookId || album.albumId),
    readUpdateTime: Number(entry.readUpdateTime || albumExtra.lectureReadUpdateTime || 0),
    finishReading: Number(entry.finishReading || album.finish || 0),
  };
}

function parseWeReadImport(raw = "") {
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.books) ? [...parsed.books, ...(Array.isArray(parsed.albums) ? parsed.albums : [])] : [parsed];
    return entries.map(importedBookFromObject).filter((book) => book.title);
  } catch {}

  const delimited = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => /[|\t]/.test(line)).map((line) => {
    const [title, author = "", category = "", url = ""] = line.split(/\s*(?:\||\t)\s*/);
    return importedBookFromObject({ title, author, category, url });
  }).filter((book) => book.title);
  if (delimited.length) return delimited;

  const titleMatches = [...text.matchAll(/《([^》]+)》/g)];
  if (titleMatches.length) return titleMatches.map((match, index) => {
    const block = text.slice(match.index, titleMatches[index + 1]?.index ?? text.length);
    const author = block.match(/(?:作者|著者|作者简介)\s*[：:]\s*([^\n\r|]+)/)?.[1]?.replace(/https?:\/\/\S+.*/, "") || "";
    const url = block.match(/https?:\/\/[^\s]+/)?.[0] || "";
    return importedBookFromObject({ title: match[1], author, url });
  });

  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const url = line.match(/https?:\/\/[^\s]+/)?.[0] || "";
    const withoutUrl = line.replace(url, "").trim();
    const [title, author = ""] = withoutUrl.split(/\s+(?:[-—·]|作者[：:])\s+/, 2);
    return importedBookFromObject({ title, author, url });
  }).filter((book) => book.title && !/^https?:\/\//i.test(book.title));
}
function openWishForm(wish = {}) { openModal(wish.id ? "编辑未读书籍" : "放进愿望池", `<form data-form="wish" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(wish.id || "")}"><label>书名<input required name="title" value="${escapeHtml(wish.title || "")}" placeholder="例如：乔布斯传"></label><label>作者<input name="author" value="${escapeHtml(wish.author || "")}" placeholder="作者"></label><label>分类<select name="category">${options(state.categories, wish.category || "其他")}</select></label><label>开始阅读日期<input type="date" name="startDate" value="${escapeHtml(wish.startDate || wish.createdAt || today())}"></label><label>来源<input name="source" value="${escapeHtml(wish.source || "")}" placeholder="书店、朋友推荐、微信读书…"></label><label>阅读阶段<select name="status"><option value="wish" selected>♡ 未读 / 愿望池</option></select></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">${wish.id ? "保存修改" : "放进愿望池"}</button></footer></form>`); }
function openCategoryForm() { openModal("新增分类", `<form data-form="category" class="form-grid"><label>分类名称<input required name="name" placeholder="例如：哲学"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">添加</button></footer></form>`); }
function openDailyForm(bookId, card = {}) {
  openModal(card.id ? "编辑每日卡片" : "新增每日卡片", `<form data-form="daily" class="form-grid"><input type="hidden" name="bookId" value="${escapeHtml(bookId)}"><input type="hidden" name="id" value="${escapeHtml(card.id || "")}"><label>日期<input type="date" name="date" value="${escapeHtml(card.date || today())}"></label><label>阅读位置 / 进度<input name="position" value="${escapeHtml(card.position || "")}" placeholder="23/100，之后可写 43"></label><label class="span-2">💎 今日最有意思的一点<textarea required name="insight" placeholder="用一句话留住它。">${escapeHtml(card.insight || "")}</textarea></label><label class="span-2">💭 我的想法<textarea name="thought" placeholder="这让我想到什么？">${escapeHtml(card.thought || "")}</textarea></label><label class="span-2">🔗 联想到什么<textarea name="link" placeholder="人、事、旧笔记，或另一本书。">${escapeHtml(card.link || "")}</textarea></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">${card.id ? "保存修改" : "收下这次阅读"}</button></footer></form>`);
}
function openNoteForm(bookId, suggestedType = "长笔记", note = {}) {
  const types = ["思维导图", "人物关系", "时间线", "长笔记", "金句", "内容总结", "自己的理解", "关联书籍", "图片 / PDF"];
  const selectedType = note.type || suggestedType;
  const attachmentTitle = note.attachmentTitle || "";
  const currentAttachmentName = note.attachmentTitle?.trim() && note.attachment?.name ? `${note.attachmentTitle}（原文件：${note.attachment.name}）` : note.attachment?.name;
  const attachmentHint = currentAttachmentName ? `<small>当前附件：${escapeHtml(currentAttachmentName)}；重新选择文件会替换它。</small>` : "";
  openModal(note.id ? "编辑整理内容" : "添加整理内容", `<form data-form="note" class="form-grid note-form"><input type="hidden" name="bookId" value="${escapeHtml(bookId)}"><input type="hidden" name="id" value="${escapeHtml(note.id || "")}"><label>类型<select name="type">${options(types, selectedType)}</select></label><label>标题<input required name="title" value="${escapeHtml(note.title || "")}" placeholder="给这份内容一个名字"></label><div class="span-2 form-field"><label for="note-resource-url">关联地址</label><span class="url-input-row"><input id="note-resource-url" type="text" inputmode="url" name="resourceUrl" value="${escapeHtml(note.resourceUrl || "")}" placeholder="chatgpt.com 或完整网址"><button type="button" class="quiet-button" data-action="open-note-url">打开地址</button></span></div><label class="span-2 attachment-field">导入附件<input type="file" name="attachment" accept=".xmind,.pdf,.opml,.png,.jpg,.jpeg,.webp,.gif,image/*,application/pdf">${attachmentHint}</label><label class="span-2">附件显示名<input name="attachmentTitle" value="${escapeHtml(attachmentTitle)}" placeholder="例如：第一章 ABCD 人物关系图"></label><label class="span-2">文字补充<textarea name="content" placeholder="可选，补充说明这份整理内容。">${escapeHtml(note.content || "")}</textarea></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">${note.id ? "保存修改" : "放入整理区"}</button></footer></form>`);
}

function onAction(event) {
  const target = event.target.closest("[data-action], [data-book]");
  if (!target) return;
  const modalSurface = event.target.closest("[data-modal-surface]");
  if (modalSurface && !modalSurface.contains(target)) return;
  const action = target.dataset.action;
  if (!action && target.dataset.book) { setRoute({ page: "book", bookId: target.dataset.book, deleteMode: "", noteFilter: "all" }); return; }
  if (!action) return;
  if (action === "home") setRoute({ page: "home", query: "", deleteMode: "" });
  if (action === "wishes") setRoute({ page: "wishes", query: "", deleteMode: "" });
  if (action === "view") setRoute({ page: "home", view: target.dataset.view, deleteMode: "" });
  if (action === "category") setRoute({ page: "category", category: target.dataset.category, deleteMode: "" });
  if (action === "direction") setRoute({ direction: state.route.direction === "asc" ? "desc" : "asc" });
  if (action === "view-menu") { setRoute({ page: "home", view: state.route.view === "category" ? "cover" : state.route.view === "cover" ? "status" : "category", deleteMode: "" }); }
  if (action === "theme") { const themes = ["white", "black", "pink", "green", "blue"]; state.theme = themes[(themes.indexOf(state.theme) + 1) % themes.length]; saveState(); render(); }
  if (action === "cloud-account") openCloudAccount();
  if (action === "cloud-sync-now") { pushCloudState().then((ok) => { if (ok) { closeModal(); window.alert("云端书库已同步。"); } else window.alert("同步失败，请稍后再试。"); }); }
  if (action === "cloud-sign-out") { cloudClient?.auth.signOut().then(() => { closeModal(); cloudUser = null; cloudStatus = "local"; render(); }); }
  if (action === "open-add") openAddMenu();
  if (action === "close-modal") closeModal();
  if (action === "add-book") openBookForm();
  if (action === "import-weread") openWeReadImport();
  if (action === "add-wish") openWishForm();
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
  if (action === "open-book-url") {
    const book = state.books.find((entry) => entry.id === target.dataset.book);
    const url = normalizeWeReadUrl(book?.wereadUrl);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  if (action === "open-wish-url") {
    const wish = state.wishes.find((entry) => entry.id === target.dataset.wish);
    const url = normalizeWeReadUrl(wish?.wereadUrl);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  if (action === "open-attachment") openStoredAttachment(target.dataset.attachment, target.dataset.preview === "true");
  if (action === "change-cover") openCoverPicker(target.dataset.book);
  if (action === "random-wish") pickRandomWish();
  if (action === "start-wish") startWish(target.dataset.wish);
}

function onDoubleClick(event) {
  if (event.target.closest("button, input, select, textarea, a, label")) return;
  const dailyCard = event.target.closest("[data-daily-card]");
  if (dailyCard && state.route.deleteMode !== "daily") {
    const book = state.books.find((entry) => entry.id === dailyCard.dataset.dailyBook);
    const card = book?.dailyCards.find((entry) => entry.id === dailyCard.dataset.dailyCard);
    if (book && card) openDailyForm(book.id, card);
    return;
  }
  const noteCard = event.target.closest("[data-note-card]");
  if (noteCard && state.route.deleteMode !== "note") {
    const book = state.books.find((entry) => entry.id === noteCard.dataset.noteBook);
    const note = book?.notes.find((entry) => entry.id === noteCard.dataset.noteCard);
    if (book && note) openNoteForm(book.id, note.type, note);
    return;
  }
  const bookRegion = event.target.closest(".first-meet-card[data-book-id]");
  if (bookRegion) {
    const book = state.books.find((entry) => entry.id === bookRegion.dataset.bookId);
    if (book) openBookForm(book);
    return;
  }
  const wishRegion = event.target.closest(".wish-card[data-wish-id]");
  if (wishRegion) {
    const wish = state.wishes.find((entry) => entry.id === wishRegion.dataset.wishId);
    if (wish) openWishForm(wish);
  }
}

function openCoverPicker(bookId) {
  openModal("更换封面", `<form data-form="cover" class="cover-picker"><input type="hidden" name="bookId" value="${bookId}"><p>从你的设备选择一张照片。图片只保存在当前浏览器里。</p><label class="upload-area">选择照片<input required type="file" name="cover" accept="image/*"></label><footer class="form-actions"><button type="button" class="quiet-button" data-action="close-modal">取消</button><button class="primary-button">使用这张封面</button></footer></form>`);
}

function pickRandomWish() {
  if (!state.wishes.length) return;
  const wish = state.wishes[Math.floor(Math.random() * state.wishes.length)];
  openModal("今天读这一本", `<div class="random-pick"><p class="eyebrow">A SMALL READING WINDOW</p><h2>${escapeHtml(wish.title)}</h2><p>${escapeHtml(wish.author || "未署名")} · ${escapeHtml(wish.category || "其他")}</p><p>也许现在正是打开它的时刻。</p><div class="form-actions"><button class="quiet-button" data-action="close-modal">换个时间</button><button class="primary-button" data-action="start-wish" data-wish="${wish.id}">开始阅读</button></div></div>`);
}

function startWish(wishId) {
  const index = state.wishes.findIndex((wish) => wish.id === wishId);
  if (index === -1) return;
  const wish = state.wishes.splice(index, 1)[0];
  const book = { id: uid(), title: wish.title, author: wish.author, category: wish.category, source: wish.source, reason: wish.reason, startDate: today(), firstImpression: "", expectation: "", status: "reading", createdAt: today(), lastRead: wish.lastRead || today(), color: "rose", coverImage: wish.coverImage, wereadUrl: wish.wereadUrl, wereadBookId: wish.wereadBookId, progressCurrent: 0, progressTotal: 0, progressUnit: "页", dailyCards: [], notes: [] };
  state.books.unshift(book); saveState(); closeModal(); setRoute({ page: "book", bookId: book.id, deleteMode: "", noteFilter: "all" });
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
  const shouldRebuildProgress = book.dailyCards.some((card) => parseProgressPosition(card.position, book));
  book.dailyCards = book.dailyCards.filter((card) => !ids.has(card.id));
  updateLastReadFromCards(book);
  if (shouldRebuildProgress) rebuildProgressFromDailyCards(book);
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
  if (form.dataset.form === "cloud-auth") {
    const email = data.email.trim();
    const password = data.password;
    const authMode = event.submitter?.value || "signin";
    const submitButtons = form.querySelectorAll("button");
    submitButtons.forEach((button) => { button.disabled = true; });
    const result = authMode === "signup"
      ? await cloudClient.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${location.pathname}` } })
      : await cloudClient.auth.signInWithPassword({ email, password });
    if (result.error) {
      submitButtons.forEach((button) => { button.disabled = false; });
      window.alert(`登录失败：${result.error.message}`);
      return;
    }
    if (result.data.session) {
      await applyCloudSession(result.data.session);
      closeModal();
      window.alert("已登录，当前书库已经接入云端。");
    } else {
      closeModal();
      window.alert("注册邮件已发送，请到邮箱完成确认后再返回登录。");
    }
    return;
  }
  if (form.dataset.form === "book") {
    const existing = state.books.find((book) => book.id === data.id);
    const progressCurrent = hasOwn(data, "progressCurrent") ? normalizeProgress(data.progressCurrent) : normalizeProgress(existing?.progressCurrent);
    const progressTotal = hasOwn(data, "progressTotal") ? normalizeProgress(data.progressTotal) : normalizeProgress(existing?.progressTotal);
    const progressUnit = hasOwn(data, "progressUnit") ? normalizeProgressUnit(data.progressUnit) : normalizeProgressUnit(existing?.progressUnit);
    const record = normalizeBook({ ...data, progressCurrent, progressTotal, progressUnit, id: data.id || uid(), createdAt: existing?.createdAt || today(), lastRead: existing?.lastRead || today(), color: existing?.color || "rose", coverImage: existing?.coverImage, dailyCards: existing?.dailyCards || [], notes: existing?.notes || [] });
    if (existing) Object.assign(existing, record); else state.books.unshift(record);
    saveState(); closeModal(); setRoute({ page: "book", bookId: record.id, deleteMode: "", noteFilter: "all" });
  }
  if (form.dataset.form === "weread-import") {
    const parsed = parseWeReadImport(data.content);
    if (!parsed.length) { window.alert("没有识别到书名。请粘贴包含书名的分享文字，或按“书名 | 作者 | 分类 | 链接”每行一本。"); return; }
    const identityKey = (entry) => `${entry.title.trim().toLocaleLowerCase()}\u0000${(entry.author || "").trim().toLocaleLowerCase()}`;
    const matchesEntry = (candidate, entry) => (entry.wereadBookId && candidate.wereadBookId === entry.wereadBookId) || (entry.wereadUrl && normalizeWeReadUrl(candidate.wereadUrl) === entry.wereadUrl) || identityKey(candidate) === identityKey(entry);
    const imported = [];
    let updated = 0;
    let alreadyReading = 0;
    parsed.forEach((entry) => {
      const existingBook = state.books.find((book) => matchesEntry(book, entry));
      if (existingBook) {
        Object.assign(existingBook, { wereadUrl: entry.wereadUrl || existingBook.wereadUrl, wereadBookId: entry.wereadBookId || existingBook.wereadBookId, coverImage: existingBook.coverImage || entry.coverImage, lastRead: dateFromUnix(entry.readUpdateTime) || existingBook.lastRead });
        alreadyReading += 1;
        return;
      }
      const category = data.category || classifyBookCategory(entry);
      const existingWish = state.wishes.find((wish) => matchesEntry(wish, entry));
      if (existingWish) {
        Object.assign(existingWish, { author: entry.author || existingWish.author, source: "微信读书", sourceCategory: entry.sourceCategory || existingWish.sourceCategory, wereadUrl: entry.wereadUrl || existingWish.wereadUrl, wereadBookId: entry.wereadBookId || existingWish.wereadBookId, coverImage: entry.coverImage || existingWish.coverImage, readUpdateTime: entry.readUpdateTime || existingWish.readUpdateTime, lastRead: dateFromUnix(entry.readUpdateTime) || existingWish.lastRead, category: existingWish.categoryLocked ? existingWish.category : category });
        updated += 1;
        return;
      }
      imported.push({ ...entry, id: uid(), category, categoryLocked: Boolean(data.category), source: "微信读书", startDate: today(), status: "wish", createdAt: today(), lastRead: dateFromUnix(entry.readUpdateTime) });
    });
    if (!imported.length && !updated && !alreadyReading) { window.alert("没有可以同步的书籍。"); return; }
    state.wishes.unshift(...imported); saveState(); closeModal(); setRoute({ page: "wishes", deleteMode: "" });
    window.alert(`愿望池同步完成：新增 ${imported.length} 本，更新 ${updated} 本${alreadyReading ? `，关联书库中已有的 ${alreadyReading} 本` : ""}。`);
  }
  if (form.dataset.form === "wish") { const existing = state.wishes.find((wish) => wish.id === data.id); const record = { ...data, title: data.title.trim(), author: data.author.trim(), wereadUrl: hasOwn(data, "wereadUrl") ? normalizeWeReadUrl(data.wereadUrl) : existing?.wereadUrl || "", category: data.category || "其他", categoryLocked: true }; if (existing) Object.assign(existing, record); else state.wishes.unshift({ ...record, id: uid(), createdAt: today() }); saveState(); closeModal(); render(); }
  if (form.dataset.form === "category") { const name = data.name.trim(); if (name && !state.categories.includes(name)) state.categories.push(name); saveState(); closeModal(); render(); }
  if (form.dataset.form === "daily") {
    const book = state.books.find((entry) => entry.id === data.bookId);
    if (book) {
      const existing = book.dailyCards.find((card) => card.id === data.id);
      const card = { ...data, id: data.id || uid() };
      if (existing) Object.assign(existing, card);
      else book.dailyCards.push(card);
      updateLastReadFromCards(book);
      rebuildProgressFromDailyCards(book);
      saveState(); closeModal(); render();
    }
  }
  if (form.dataset.form === "note") {
    const book = state.books.find((entry) => entry.id === data.bookId);
    const file = form.elements.attachment.files[0];
    const resourceUrl = normalizeExternalUrl(data.resourceUrl);
    const title = data.title.trim();
    const content = data.content.trim();
    const attachmentTitle = (data.attachmentTitle || "").trim();
    const existing = book?.notes.find((note) => note.id === data.id);
    if (!title) { window.alert("请填写整理内容的标题。"); return; }
    if (data.resourceUrl && !resourceUrl) { window.alert("关联地址格式不正确，请检查后再试。"); return; }
    if (!content && !resourceUrl && !file && !existing?.attachment) { window.alert("请填写文字、关联地址或导入一个附件。"); return; }
    if (file?.size > MAX_ATTACHMENT_SIZE) { window.alert("单个附件请不要超过 25 MB。"); return; }
    if (book) {
      try {
        const oldAttachmentId = existing?.attachment?.id;
        const attachment = file ? await storeAttachment(file) : existing?.attachment;
        const record = { id: data.id || uid(), type: data.type, title, content, resourceUrl, attachment, attachmentTitle, createdAt: existing?.createdAt || today() };
        if (existing) Object.assign(existing, record);
        else book.notes.unshift(record);
        saveState(); closeModal(); render();
        if (file && oldAttachmentId) deleteStoredAttachment(oldAttachmentId).catch(() => {});
      } catch {
        window.alert("附件保存失败，请换一个文件或稍后再试。");
      }
    }
  }
  if (form.dataset.form === "cover") { const file = form.elements.cover.files[0]; const book = state.books.find((entry) => entry.id === data.bookId); if (!file || !book) return; prepareCoverForStorage(file).then((image) => { book.coverImage = image; saveState(); closeModal(); render(); }).catch(() => { window.alert("这张照片暂时无法读取，请换一张试试。"); }); }
}

document.addEventListener("click", onAction);
document.addEventListener("dblclick", onDoubleClick);
document.addEventListener("submit", onForm);
document.addEventListener("change", (event) => {
  if (event.target.dataset.control === "sort") setRoute({ sort: event.target.value });
  if (event.target.dataset.control === "note-filter") setRoute({ noteFilter: event.target.value, deleteMode: "" });
  if (event.target.dataset.status) { const book = state.books.find((entry) => entry.id === event.target.dataset.status); if (book) { book.status = event.target.value; saveState(); render(); } }
  if (event.target.dataset.selectItem) updateBulkDeleteButton(event.target.dataset.selectItem);
});

render();
initializeCloud();
