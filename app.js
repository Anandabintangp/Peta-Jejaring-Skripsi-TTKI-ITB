/* global d3 */
"use strict";

const state = {
  summary: null,
  index: null,
  filtered: [],
  currentPage: 1,
  pageSize: 5,
  faculty: "",
  program: "",
  topic: "",
  year: "",
  advisor: "",
  query: "",
  specificity: "broad",
  nodeLimit: 110,
  showAdvisors: true,
  showTopics: true,
  recordCache: new Map(),
  simulation: null,
  zoom: null,
  svg: null,
  selectedNode: null,
  viewMode: "graph",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = new Intl.NumberFormat("id-ID");
const levelMap = { 1: "broad", 2: "medium", 3: "specific" };
const levelDescription = {
  broad: "Umum: rumpun besar lintas disiplin",
  medium: "Menengah: istilah utama dari judul, kata kunci, dan abstrak",
  specific: "Spesifik: kata kunci rinci pada setiap skripsi",
};
const nodeColors = {
  faculty: "var(--faculty)",
  program: "var(--program)",
  advisor: "var(--advisor)",
  topic: "var(--topic)",
};

const normalize = (value = "") => value.toString().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const escapeHtml = (value = "") => value.toString().replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const truncate = (value, length = 44) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const safeUrl = (value = "") => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Gagal memuat ${path}: ${response.status}`);
  return response.json();
}

async function init() {
  bindEvents();
  try {
    state.summary = await fetchJson("data/summary.json");
    populateStaticControls();
    updateStats();
    refreshTopicControl();
    renderNetwork();
    renderTopTopics();
    scheduleIndexLoad();
  } catch (error) {
    console.error(error);
    $("#indexStatus").textContent = "Data gagal dimuat. Jalankan melalui web server, bukan file://.";
    $("#network").innerHTML = `<div class="empty-state"><strong>Data tidak dapat dimuat.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function scheduleIndexLoad() {
  const load = async () => {
    try {
      $("#indexStatus").textContent = "Memuat indeks judul…";
      state.index = await fetchJson("data/search-index.json");
      $("#indexStatus").textContent = `${fmt.format(state.index.length)} judul siap ditelusuri.`;
      $("#exportCsv").disabled = false;
      applyFilters();
      renderNetwork();
      if (state.selectedNode) nodeSelected(state.selectedNode);
    } catch (error) {
      console.error(error);
      $("#indexStatus").textContent = "Indeks judul gagal dimuat.";
    }
  };
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 1000 });
  else setTimeout(load, 50);
}

function bindEvents() {
  $("#facultyFilter").addEventListener("change", (e) => {
    state.faculty = e.target.value;
    state.program = "";
    state.advisor = "";
    state.topic = "";
    $("#programFilter").value = "";
    populatePrograms();
    refreshTopicControl();
    refreshAll();
  });

  $("#programFilter").addEventListener("change", (e) => {
    state.program = e.target.value;
    state.topic = "";
    state.advisor = "";
    refreshTopicControl();
    refreshAll();
  });

  $("#topicFilter").addEventListener("change", (e) => {
    state.topic = e.target.value;
    refreshAll(false);
  });

  $("#yearFilter").addEventListener("change", (e) => {
    state.year = e.target.value;
    applyFilters();
    updateActiveFilters();
    renderNetwork();
  });

  $("#specificityRange").addEventListener("input", (e) => {
    state.specificity = levelMap[e.target.value];
    state.topic = "";
    state.advisor = "";
    $("#specificityDescription").textContent = levelDescription[state.specificity];
    refreshTopicControl();
    refreshAll();
  });

  $("#globalSearch").addEventListener("input", debounce((e) => {
    state.query = e.target.value;
    applyFilters();
  }, 160));

  $("#nodeLimit").addEventListener("input", debounce((e) => {
    state.nodeLimit = Number(e.target.value);
    renderNetwork();
  }, 100));

  $("#showAdvisors").addEventListener("change", (e) => {
    state.showAdvisors = e.target.checked;
    renderNetwork();
  });

  $("#showTopics").addEventListener("change", (e) => {
    state.showTopics = e.target.checked;
    renderNetwork();
  });

  $$(".view-switch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.viewMode === btn.dataset.view) return;
      state.viewMode = btn.dataset.view;
      $$(".view-switch-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      const isCloseness = state.viewMode === "closeness";
      $("#closenessHint").hidden = !isCloseness;
      $("#showAdvisors").closest("label").style.display = isCloseness ? "none" : "";
      $("#showTopics").closest("label").style.display = isCloseness ? "none" : "";
      renderNetwork();
    });
  });

  $("#resetFilters").addEventListener("click", resetFilters);
  $("#resetZoom").addEventListener("click", resetZoom);
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#closeModal").addEventListener("click", () => $("#detailModal").close());
  $("#detailModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  $("#themeToggle").addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|select|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#globalSearch").focus();
    }
    if (e.key === "Escape" && $("#detailModal").open) $("#detailModal").close();
  });

  window.addEventListener("resize", debounce(() => renderNetwork(), 180));
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function populateStaticControls() {
  const facultySelect = $("#facultyFilter");
  state.summary.faculties.forEach((f) => {
    facultySelect.add(new Option(`${f.code} · ${f.name} (${fmt.format(f.count)})`, f.code));
  });
  populatePrograms();

  const yearSelect = $("#yearFilter");
  Object.keys(state.summary.years).sort((a, b) => b - a).forEach((year) => {
    yearSelect.add(new Option(`${year} (${fmt.format(state.summary.years[year])})`, year));
  });
}

function populatePrograms() {
  const select = $("#programFilter");
  select.innerHTML = '<option value="">Semua jurusan</option>';
  state.summary.programs
    .filter((p) => !state.faculty || p.faculty === state.faculty)
    .sort((a, b) => a.name.localeCompare(b.name, "id"))
    .forEach((p) => select.add(new Option(`${p.name} (${fmt.format(p.count)})`, p.key)));
  select.value = state.program;
}

function selectedPrograms() {
  return state.summary.programs.filter((p) => (
    (!state.faculty || p.faculty === state.faculty) &&
    (!state.program || p.key === state.program)
  ));
}

function aggregateTopics(programs = selectedPrograms()) {
  const counter = new Map();
  programs.forEach((p) => {
    (p.topics[state.specificity] || []).forEach((t) => {
      counter.set(t.name, (counter.get(t.name) || 0) + t.count);
    });
  });
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"));
}

function refreshTopicControl() {
  const select = $("#topicFilter");
  select.innerHTML = '<option value="">Semua topik</option>';
  aggregateTopics().slice(0, state.specificity === "specific" ? 450 : 300).forEach((t) => {
    select.add(new Option(`${t.name} (${fmt.format(t.count)})`, t.name));
  });
  select.value = state.topic;
  renderTopTopics();
}

function refreshAll(rebuildNetwork = true) {
  if (rebuildNetwork) renderNetwork();
  renderTopTopics();
  applyFilters();
  updateStats();
  updateActiveFilters();
}

function updateStats() {
  if (!state.summary) return;
  const programs = selectedPrograms();
  const recordCount = programs.reduce((sum, p) => sum + p.count, 0);
  const facultyCount = new Set(programs.map((p) => p.faculty)).size;
  const advisors = new Set(programs.flatMap((p) => p.advisors.map((a) => a.key)));
  $("#statTheses").textContent = fmt.format(recordCount);
  $("#statFaculties").textContent = fmt.format(facultyCount);
  $("#statPrograms").textContent = fmt.format(programs.length);
  $("#statAdvisors").textContent = fmt.format(advisors.size);
}

function resetFilters() {
  Object.assign(state, {
    faculty: "",
    program: "",
    topic: "",
    year: "",
    advisor: "",
    query: "",
    specificity: "broad",
    currentPage: 1,
    selectedNode: null,
  });
  $("#facultyFilter").value = "";
  $("#programFilter").value = "";
  $("#yearFilter").value = "";
  $("#globalSearch").value = "";
  $("#specificityRange").value = "1";
  $("#specificityDescription").textContent = levelDescription.broad;
  populatePrograms();
  refreshTopicControl();
  refreshAll();
  resetNodeInsight();
  showToast("Filter dikembalikan ke awal.");
}

function updateActiveFilters() {
  const wrap = $("#activeFilters");
  const chips = [];
  if (state.faculty) chips.push(["faculty", `Fakultas: ${state.faculty}`]);
  if (state.program) chips.push(["program", `Jurusan: ${state.summary.programs.find((p) => p.key === state.program)?.name || state.program}`]);
  if (state.topic) chips.push(["topic", `Topik: ${state.topic}`]);
  if (state.year) chips.push(["year", `Tahun: ${state.year}`]);
  if (state.advisor) chips.push(["advisor", `Pembimbing: ${state.summary.advisors.find((a) => a.key === state.advisor)?.name || state.advisor}`]);

  wrap.innerHTML = chips.map(([key, label]) => (
    `<span class="filter-chip">${escapeHtml(label)}<button type="button" data-remove="${key}" aria-label="Hapus filter">×</button></span>`
  )).join("");

  wrap.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => removeFilter(button.dataset.remove));
  });
}

function removeFilter(key) {
  state[key] = "";
  if (key === "faculty") {
    state.program = "";
    populatePrograms();
  }
  if (key === "program" || key === "faculty") {
    state.topic = "";
    refreshTopicControl();
  }
  const control = {
    faculty: "#facultyFilter",
    program: "#programFilter",
    topic: "#topicFilter",
    year: "#yearFilter",
  }[key];
  if (control) $(control).value = "";
  refreshAll();
}

function applyFilters() {
  if (!state.index) return;
  const q = normalize(state.query);
  const tokens = q.split(" ").filter(Boolean);

  state.filtered = state.index.filter((item) => {
    if (state.faculty && item.faculty !== state.faculty) return false;
    if (state.program && item.pkey !== state.program) return false;
    if (state.year && String(item.year || "") !== state.year) return false;
    if (state.advisor && !item.advisorKeys.includes(state.advisor)) return false;
    if (state.topic && !(item.topics[state.specificity] || []).some((t) => normalize(t) === normalize(state.topic))) return false;

    if (tokens.length) {
      const haystack = normalize([
        item.title,
        item.author,
        ...(item.advisors || []),
        ...(item.keywords || []),
        ...Object.values(item.topics).flat(),
      ].join(" "));
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  }).sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, "id"));

  state.currentPage = 1;
  renderTheses();
}

function renderTheses() {
  const list = $("#thesisList");
  const total = state.filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  state.currentPage = Math.min(state.currentPage, pageCount);
  const start = (state.currentPage - 1) * state.pageSize;
  const end = Math.min(start + state.pageSize, total);

  $("#resultSummary").textContent = total
    ? `${fmt.format(total)} skripsi ditemukan. Menampilkan ${fmt.format(start + 1)}–${fmt.format(end)}.`
    : "Tidak ada skripsi yang cocok.";

  if (!total) {
    list.innerHTML = '<div class="empty-state"><strong>Tidak ada skripsi yang cocok.</strong><span>Coba longgarkan filter atau kurangi kata pencarian.</span></div>';
    renderPagination(0);
    return;
  }

  list.innerHTML = state.filtered.slice(start, end).map((item) => {
    const tags = (item.topics[state.specificity] || []).slice(0, 4);
    return `<article class="thesis-card">
      <div class="thesis-main">
        <h3>${escapeHtml(item.title)}</h3>
        <div class="thesis-meta">
          <span>${escapeHtml(item.author || "Penulis tidak tercantum")}</span>
          <span>${escapeHtml(item.program)}</span>
          <span>${escapeHtml(item.faculty)}</span>
          ${item.year ? `<span>${item.year}</span>` : ""}
          ${item.advisors?.length ? `<span>Pembimbing: ${escapeHtml(item.advisors.join(" · "))}</span>` : ""}
        </div>
        <div class="thesis-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <button class="open-detail" type="button" data-id="${item.id}" data-pkey="${escapeHtml(item.pkey)}">Lihat abstrak</button>
    </article>`;
  }).join("");

  list.querySelectorAll(".open-detail").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.id, button.dataset.pkey));
  });
  renderPagination(pageCount);
}

function renderPagination(pageCount) {
  const nav = $("#pagination");
  if (!pageCount || pageCount <= 1) {
    nav.innerHTML = "";
    nav.hidden = true;
    return;
  }

  nav.hidden = false;
  const pages = paginationItems(state.currentPage, pageCount);
  nav.innerHTML = `
    <button type="button" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? "disabled" : ""} aria-label="Halaman sebelumnya">‹</button>
    ${pages.map((page) => page === "…"
      ? '<span class="page-ellipsis">…</span>'
      : `<button type="button" data-page="${page}" class="${page === state.currentPage ? "active" : ""}" ${page === state.currentPage ? 'aria-current="page"' : ""}>${page}</button>`).join("")}
    <button type="button" data-page="${state.currentPage + 1}" ${state.currentPage === pageCount ? "disabled" : ""} aria-label="Halaman berikutnya">›</button>
  `;

  nav.querySelectorAll("button[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = Number(button.dataset.page);
      if (!Number.isFinite(page) || page < 1 || page > pageCount || page === state.currentPage) return;
      state.currentPage = page;
      renderTheses();
      $("#koleksi").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function paginationItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => set.add(n));
  const sorted = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const output = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) output.push("…");
    output.push(n);
  });
  return output;
}

async function openDetail(id, pkey) {
  const modal = $("#detailModal");
  $("#modalContent").innerHTML = '<div class="empty-state"><strong>Memuat abstrak…</strong></div>';
  modal.showModal();
  try {
    let records = state.recordCache.get(pkey);
    if (!records) {
      const program = state.summary.programs.find((p) => p.key === pkey);
      if (!program) throw new Error("Jurusan tidak ditemukan.");
      records = await fetchJson(program.file);
      state.recordCache.set(pkey, records);
    }
    const item = records.find((record) => record.id === id);
    if (!item) throw new Error("Detail skripsi tidak ditemukan.");
    renderModal(item);
  } catch (error) {
    $("#modalContent").innerHTML = `<div class="empty-state"><strong>Detail gagal dimuat.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderModal(item) {
  const topicTags = [...new Set([
    ...item.topics.broad,
    ...item.topics.medium,
    ...item.topics.specific,
  ])].slice(0, 12);
  const sourceUrl = safeUrl(item.url);

  $("#modalContent").innerHTML = `
    <p class="eyebrow">${escapeHtml(item.faculty)} · ${escapeHtml(item.program)}</p>
    <h2>${escapeHtml(item.title)}</h2>
    <div class="thesis-tags">${topicTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="modal-grid">
      <div class="modal-fact"><small>Penulis</small><strong>${escapeHtml(item.author || "—")}</strong></div>
      <div class="modal-fact"><small>Tahun / tanggal</small><strong>${escapeHtml(item.date || item.year || "—")}</strong></div>
      <div class="modal-fact"><small>Dosen pembimbing</small><strong>${escapeHtml(item.advisors?.join("; ") || "—")}</strong></div>
      <div class="modal-fact"><small>Kata kunci</small><strong>${escapeHtml(item.keywords?.join("; ") || "—")}</strong></div>
    </div>
    <section class="modal-abstract"><h3>Abstrak</h3><p>${escapeHtml(item.abstract || "Abstrak tidak tersedia pada dataset.")}</p></section>
    ${sourceUrl ? `<a class="modal-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Buka sumber Digilib ↗</a>` : ""}`;
}

function renderTopTopics() {
  if (!state.summary || !$("#topTopics")) return;
  const topics = aggregateTopics().slice(0, 6);
  const max = topics[0]?.count || 1;
  $("#topTopics").innerHTML = topics.map((t) => `<div class="rank-item">
    <button type="button" data-topic="${escapeHtml(t.name)}" title="Pilih topik ${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
    <span>${fmt.format(t.count)}</span>
    <div class="rank-bar"><i style="width:${Math.max(7, (t.count / max) * 100)}%"></i></div>
  </div>`).join("") || "<p>Tidak ada topik untuk filter ini.</p>";

  $("#topTopics").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => selectTopic(button.dataset.topic));
  });
}

function selectTopic(topic) {
  state.topic = topic;
  let option = [...$("#topicFilter").options].find((o) => o.value === topic);
  if (!option) {
    option = new Option(topic, topic);
    $("#topicFilter").add(option);
  }
  $("#topicFilter").value = topic;
  refreshAll(false);
  $("#koleksi").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildGraphData() {
  const programs = selectedPrograms();
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const addNode = (node) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };
  const addLink = (source, target, weight, kind = "standard") => {
    if (nodeIds.has(source) && nodeIds.has(target)) links.push({ source, target, weight, kind });
  };

  const facultyCodes = [...new Set(programs.map((p) => p.faculty))];
  facultyCodes.forEach((code) => {
    const f = state.summary.faculties.find((x) => x.code === code);
    addNode({
      id: `f:${code}`,
      type: "faculty",
      label: code,
      fullLabel: f.name,
      count: programs.filter((p) => p.faculty === code).reduce((s, p) => s + p.count, 0),
      value: code,
    });
  });

  programs.forEach((p) => addNode({
    id: `p:${p.key}`,
    type: "program",
    label: p.name,
    fullLabel: p.name,
    count: p.count,
    value: p.key,
    faculty: p.faculty,
  }));
  programs.forEach((p) => addLink(`f:${p.faculty}`, `p:${p.key}`, p.count));

  const baseCount = nodes.length;
  const remaining = Math.max(10, state.nodeLimit - baseCount);
  const advisorQuota = state.showAdvisors ? Math.floor(remaining * (state.showTopics ? 0.5 : 1)) : 0;
  const topicQuota = state.showTopics ? remaining - advisorQuota : 0;
  const visibleAdvisorKeys = new Set();
  const visibleTopicNames = new Set();

  if (state.showAdvisors) {
    const counts = new Map();
    programs.forEach((p) => p.advisors.forEach((a) => {
      counts.set(a.key, (counts.get(a.key) || 0) + a.count);
    }));
    const selected = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, advisorQuota);
    selected.forEach(([key, count]) => {
      const info = state.summary.advisors.find((a) => a.key === key);
      visibleAdvisorKeys.add(key);
      addNode({
        id: `a:${key}`,
        type: "advisor",
        label: info?.name || key,
        fullLabel: info?.name || key,
        count,
        value: key,
      });
    });
    programs.forEach((p) => p.advisors.forEach((a) => {
      addLink(`p:${p.key}`, `a:${a.key}`, a.count);
    }));
  }

  if (state.showTopics) {
    const topics = aggregateTopics(programs).slice(0, topicQuota);
    topics.forEach((t) => {
      visibleTopicNames.add(t.name);
      addNode({
        id: `t:${t.name}`,
        type: "topic",
        label: t.name,
        fullLabel: t.name,
        count: t.count,
        value: t.name,
      });
    });
    programs.forEach((p) => (p.topics[state.specificity] || []).forEach((t) => {
      addLink(`p:${p.key}`, `t:${t.name}`, t.count);
    }));
  }

  if (state.index && state.showAdvisors && state.showTopics) {
    const programKeys = new Set(programs.map((p) => p.key));
    const advisorTopicCounts = new Map();
    state.index.forEach((item) => {
      if (!programKeys.has(item.pkey)) return;
      if (state.year && String(item.year || "") !== state.year) return;
      const advisors = (item.advisorKeys || []).filter((key) => visibleAdvisorKeys.has(key));
      const topics = (item.topics[state.specificity] || []).filter((topic) => visibleTopicNames.has(topic));
      advisors.forEach((advisor) => topics.forEach((topic) => {
        const key = `${advisor}\u0000${topic}`;
        advisorTopicCounts.set(key, (advisorTopicCounts.get(key) || 0) + 1);
      }));
    });

    [...advisorTopicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 180)
      .forEach(([key, count]) => {
        const [advisor, topic] = key.split("\u0000");
        addLink(`a:${advisor}`, `t:${topic}`, count, "advisor-topic");
      });
  }

  return { nodes, links };
}

function renderNetwork() {
  if (!state.summary || typeof d3 === "undefined") return;
  if (state.viewMode === "closeness") return renderTopicCloseness();
  const container = $("#network");
  container.innerHTML = "";
  const width = Math.max(container.clientWidth, 500);
  const height = window.innerWidth <= 720 ? 500 : 610;
  const graph = buildGraphData();
  const nodeById = {};
  graph.nodes.forEach((node) => { nodeById[node.id] = node; });
  graph.links = graph.links
    .map((link) => ({ ...link, source: nodeById[link.source], target: nodeById[link.target] }))
    .filter((link) => link.source && link.target);

  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const root = svg.append("g");
  const zoom = d3.behavior.zoom().scaleExtent([0.25, 4]).on("zoom", function () {
    root.attr("transform", `translate(${d3.event.translate})scale(${d3.event.scale})`);
  });
  svg.call(zoom);
  state.svg = svg;
  state.zoom = zoom;
  state.zoomRoot = root;

  const maxWeight = d3.max(graph.links, (d) => d.weight) || 1;
  const link = root.append("g").selectAll("line").data(graph.links).enter().append("line")
    .attr("class", (d) => d.kind === "advisor-topic" ? "link cross-link" : "link")
    .attr("stroke-width", (d) => 0.5 + Math.sqrt(d.weight / maxWeight) * 3);

  const node = root.append("g").selectAll("g").data(graph.nodes).enter().append("g")
    .attr("class", "node")
    .on("click", function (d) { nodeSelected(d); });

  node.append("circle")
    .attr("r", (d) => Math.max(6, Math.min(d.type === "faculty" ? 20 : d.type === "program" ? 15 : 12, 5 + Math.log2(d.count + 1) * 1.5)))
    .attr("fill", (d) => nodeColors[d.type]);

  node.append("text")
    .attr("x", (d) => d.type === "faculty" ? 23 : d.type === "program" ? 18 : 14)
    .attr("y", 3)
    .text((d) => truncate(d.label, d.type === "faculty" ? 8 : 30));

  node.append("title").text((d) => `${d.fullLabel}\n${fmt.format(d.count)} skripsi/relasi`);

  const force = d3.layout.force()
    .nodes(graph.nodes)
    .links(graph.links)
    .size([width, height])
    .linkDistance((d) => d.kind === "advisor-topic" ? 82 : d.source.type === "faculty" ? 92 : 70)
    .linkStrength((d) => d.kind === "advisor-topic" ? 0.12 : 0.25)
    .charge((d) => d.type === "faculty" ? -850 : d.type === "program" ? -390 : -125)
    .gravity(0.07)
    .friction(0.86)
    .on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    })
    .start();

  state.simulation = force;

  const drag = force.drag()
    .on("dragstart", function (d) {
      if (d3.event.sourceEvent) d3.event.sourceEvent.stopPropagation();
      d.fixed = true;
    })
    .on("dragend", function (d) { d.fixed = false; });
  node.call(drag);

  node.on("mouseenter", function (hovered) {
    const connected = new Set([hovered.id]);
    graph.links.forEach((l) => {
      if (l.source.id === hovered.id) connected.add(l.target.id);
      if (l.target.id === hovered.id) connected.add(l.source.id);
    });
    node.classed("dimmed", (d) => !connected.has(d.id)).classed("highlighted", (d) => d.id === hovered.id);
    link.classed("dimmed", (d) => d.source.id !== hovered.id && d.target.id !== hovered.id);
  }).on("mouseleave", function () {
    node.classed("dimmed", false).classed("highlighted", false);
    link.classed("dimmed", false);
  });
}

function buildTopicClosenessGraph() {
  const programs = selectedPrograms();
  const programKeys = new Set(programs.map((p) => p.key));
  const topicLimit = Math.max(12, Math.min(70, state.nodeLimit));
  const topTopics = aggregateTopics(programs).slice(0, topicLimit);
  const allowedTopics = new Set(topTopics.map((t) => t.name));
  const nodes = topTopics.map((t) => ({
    id: `t:${t.name}`,
    type: "topic",
    label: t.name,
    fullLabel: t.name,
    count: t.count,
    value: t.name,
  }));

  const pairCounts = new Map();
  if (state.index) {
    state.index.forEach((item) => {
      if (!programKeys.has(item.pkey)) return;
      if (state.year && String(item.year || "") !== state.year) return;
      const topics = [...new Set((item.topics[state.specificity] || []).filter((name) => allowedTopics.has(name)))];
      for (let i = 0; i < topics.length; i++) {
        for (let j = i + 1; j < topics.length; j++) {
          const key = topics[i] < topics[j] ? `${topics[i]}\u0000${topics[j]}` : `${topics[j]}\u0000${topics[i]}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    });
  }

  const links = [...pairCounts.entries()]
    .map(([key, weight]) => {
      const [a, b] = key.split("\u0000");
      return { source: `t:${a}`, target: `t:${b}`, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 420);

  return { nodes, links };
}

// Groups topics into clusters using union-find over their strongest co-occurrence
// links, so we can draw an enclosing hull around topics that consistently show
// up together in the same abstracts.
function clusterTopics(nodes, links, minWeight = 2) {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  links.forEach((l) => {
    if (l.weight >= minWeight) union(l.source.id, l.target.id);
  });
  const groups = new Map();
  nodes.forEach((n) => {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  });
  return [...groups.values()].filter((g) => g.length >= 3);
}

function padHullPoint(centroid, point, padding) {
  const dx = point[0] - centroid[0];
  const dy = point[1] - centroid[1];
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const scale = (dist + padding) / dist;
  return [centroid[0] + dx * scale, centroid[1] + dy * scale];
}

function renderTopicCloseness() {
  const container = $("#network");
  container.innerHTML = "";
  const width = Math.max(container.clientWidth, 500);
  const height = window.innerWidth <= 720 ? 500 : 610;

  if (!state.index) {
    container.innerHTML = '<div class="network-loading">Menunggu indeks skripsi selesai dimuat…</div>';
    return;
  }

  const graph = buildTopicClosenessGraph();
  const nodeById = {};
  graph.nodes.forEach((n) => { nodeById[n.id] = n; });
  graph.links = graph.links
    .map((l) => ({ ...l, source: nodeById[l.source], target: nodeById[l.target] }))
    .filter((l) => l.source && l.target);

  if (!graph.nodes.length) {
    container.innerHTML = '<div class="network-loading">Tidak ada topik untuk filter ini.</div>';
    return;
  }

  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const root = svg.append("g");
  const hullLayer = root.append("g").attr("class", "hull-layer");
  const zoom = d3.behavior.zoom().scaleExtent([0.25, 4]).on("zoom", function () {
    root.attr("transform", `translate(${d3.event.translate})scale(${d3.event.scale})`);
  });
  svg.call(zoom);
  state.svg = svg;
  state.zoom = zoom;
  state.zoomRoot = root;

  const maxWeight = d3.max(graph.links, (d) => d.weight) || 1;
  const link = root.append("g").selectAll("line").data(graph.links).enter().append("line")
    .attr("class", "link closeness-link")
    .attr("stroke-width", (d) => 0.5 + Math.sqrt(d.weight / maxWeight) * 3);

  const node = root.append("g").selectAll("g").data(graph.nodes).enter().append("g")
    .attr("class", "node")
    .on("click", function (d) { selectTopic(d.value); });

  node.append("circle")
    .attr("r", (d) => Math.max(6, Math.min(20, 5 + Math.log2(d.count + 1) * 1.6)))
    .attr("fill", nodeColors.topic);

  node.append("text")
    .attr("x", 14)
    .attr("y", 3)
    .text((d) => truncate(d.label, 30));

  node.append("title").text((d) => `${d.fullLabel}\n${fmt.format(d.count)} skripsi`);

  const clusters = clusterTopics(graph.nodes, graph.links);
  const hullColors = ["var(--faculty)", "var(--program)", "var(--advisor)", "var(--topic)", "var(--accent)"];
  const lineGen = d3.svg.line().interpolate("cardinal-closed").tension(0.7);
  const hullPaths = clusters.map((group, i) => ({
    group,
    path: hullLayer.append("path")
      .attr("class", "topic-hull")
      .style("fill", hullColors[i % hullColors.length])
      .style("stroke", hullColors[i % hullColors.length]),
  }));

  const force = d3.layout.force()
    .nodes(graph.nodes)
    .links(graph.links)
    .size([width, height])
    .linkDistance((d) => Math.max(36, 130 - Math.sqrt(d.weight) * 22))
    .linkStrength((d) => Math.min(0.85, 0.15 + d.weight * 0.05))
    .charge(-190)
    .gravity(0.09)
    .friction(0.88)
    .on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      hullPaths.forEach(({ group, path }) => {
        if (group.length < 3) { path.attr("d", ""); return; }
        const centroid = [d3.mean(group, (d) => d.x), d3.mean(group, (d) => d.y)];
        const hullPoints = d3.geom.hull(group.map((d) => [d.x, d.y]));
        if (!hullPoints.length) { path.attr("d", ""); return; }
        const padded = hullPoints.map((p) => padHullPoint(centroid, p, 22));
        path.attr("d", lineGen(padded));
      });
    })
    .start();

  state.simulation = force;

  const drag = force.drag()
    .on("dragstart", function (d) {
      if (d3.event.sourceEvent) d3.event.sourceEvent.stopPropagation();
      d.fixed = true;
    })
    .on("dragend", function (d) { d.fixed = false; });
  node.call(drag);

  node.on("mouseenter", function (hovered) {
    const connected = new Set([hovered.id]);
    graph.links.forEach((l) => {
      if (l.source.id === hovered.id) connected.add(l.target.id);
      if (l.target.id === hovered.id) connected.add(l.source.id);
    });
    node.classed("dimmed", (d) => !connected.has(d.id)).classed("highlighted", (d) => d.id === hovered.id);
    link.classed("dimmed", (d) => d.source.id !== hovered.id && d.target.id !== hovered.id);
  }).on("mouseleave", function () {
    node.classed("dimmed", false).classed("highlighted", false);
    link.classed("dimmed", false);
  });
}

function resetNodeInsight() {
  $("#nodeInsight").innerHTML = `
    <h3>Klik salah satu node</h3>
    <p>Panel ini akan menampilkan judul skripsi dan hubungan akademik yang paling sering muncul.</p>`;
}

function nodeSelected(node) {
  state.selectedNode = node;
  const labels = {
    faculty: "Fakultas/sekolah",
    program: "Jurusan",
    advisor: "Dosen pembimbing",
    topic: `Topik ${state.specificity}`,
  };

  if (!state.index) {
    $("#nodeInsight").innerHTML = `
      <p class="eyebrow">${labels[node.type]}</p>
      <h3>${escapeHtml(node.fullLabel)}</h3>
      <p>Indeks judul masih dimuat. Informasi terkait akan muncul sesaat lagi.</p>`;
    return;
  }

  const records = recordsForNode(node);
  const titles = records.slice(0, 5);
  const topicCounts = countRelatedTopics(records).slice(0, 6);
  const advisorCounts = countRelatedAdvisors(records).slice(0, 6);
  const relationTitle = node.type === "advisor"
    ? "Topik yang sering terkait"
    : node.type === "topic"
      ? "Pembimbing yang sering terkait"
      : "Topik dan pembimbing dominan";

  const relationHtml = node.type === "advisor"
    ? renderMiniList(topicCounts)
    : node.type === "topic"
      ? renderMiniList(advisorCounts)
      : `<div class="relation-columns">
          <div><strong>Topik</strong>${renderMiniList(topicCounts)}</div>
          <div><strong>Pembimbing</strong>${renderMiniList(advisorCounts)}</div>
        </div>`;

  $("#nodeInsight").innerHTML = `
    <p class="eyebrow">${labels[node.type]}</p>
    <h3>${escapeHtml(node.fullLabel)}</h3>
    <p>${fmt.format(records.length)} skripsi terkait pada data yang sedang ditampilkan.</p>
    <div class="insight-section">
      <h4>Judul skripsi terbaru</h4>
      <div class="insight-title-list">
        ${titles.length ? titles.map((item) => `
          <button class="insight-title" type="button" data-id="${item.id}" data-pkey="${escapeHtml(item.pkey)}">
            <span>${escapeHtml(item.title)}</span>
            <small>${escapeHtml(item.author || "Penulis tidak tercantum")}${item.year ? ` · ${item.year}` : ""}</small>
          </button>`).join("") : "<p>Belum ada judul yang dapat ditampilkan.</p>"}
      </div>
    </div>
    <div class="insight-section">
      <h4>${relationTitle}</h4>
      ${relationHtml || "<p>Belum ada relasi yang cukup kuat.</p>"}
    </div>`;

  $("#nodeInsight").querySelectorAll(".insight-title").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.id, button.dataset.pkey));
  });
}

function recordsForNode(node) {
  const currentPrograms = new Set(selectedPrograms().map((p) => p.key));
  return state.index.filter((item) => {
    if (!currentPrograms.has(item.pkey)) return false;
    if (state.year && String(item.year || "") !== state.year) return false;
    if (node.type === "faculty") return item.faculty === node.value;
    if (node.type === "program") return item.pkey === node.value;
    if (node.type === "advisor") return (item.advisorKeys || []).includes(node.value);
    if (node.type === "topic") return (item.topics[state.specificity] || []).some((topic) => normalize(topic) === normalize(node.value));
    return false;
  }).sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, "id"));
}

function countRelatedTopics(records) {
  const counts = new Map();
  records.forEach((item) => (item.topics[state.specificity] || []).forEach((topic) => {
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function countRelatedAdvisors(records) {
  const counts = new Map();
  records.forEach((item) => (item.advisors || []).forEach((advisor) => {
    counts.set(advisor, (counts.get(advisor) || 0) + 1);
  }));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderMiniList(items) {
  if (!items.length) return "";
  return `<div class="mini-list">${items.map(([name, count]) => (
    `<span><b>${escapeHtml(name)}</b><small>${fmt.format(count)}</small></span>`
  )).join("")}</div>`;
}

function resetZoom() {
  if (!state.svg || !state.zoom) return;
  state.zoom.translate([0, 0]).scale(1);
  state.svg.transition().duration(450).call(state.zoom.event);
}

function exportCsv() {
  if (!state.filtered.length) return showToast("Tidak ada hasil untuk diekspor.");
  const rows = state.filtered.map((r) => [
    r.title,
    r.author,
    r.advisors.join("; "),
    r.faculty,
    r.program,
    r.year || "",
    (r.topics[state.specificity] || []).join("; "),
    r.url,
  ]);
  const header = ["Judul", "Penulis", "Pembimbing", "Fakultas", "Jurusan", "Tahun", `Topik_${state.specificity}`, "URL"];
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hasil-peta-skripsi-itb.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`${fmt.format(rows.length)} baris diekspor.`);
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("thesis-theme", document.body.classList.contains("dark") ? "dark" : "light");
  setTimeout(renderNetwork, 50);
}

if (localStorage.getItem("thesis-theme") === "dark") document.body.classList.add("dark");
init();
