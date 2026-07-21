/* global d3 */
"use strict";

const state = {
  summary: null,
  index: null,
  filtered: [],
  visibleCount: 30,
  faculty: "",
  program: "",
  topic: "",
  year: "",
  advisor: "",
  query: "",
  specificity: "broad",
  nodeLimit: 120,
  showAdvisors: true,
  showTopics: true,
  recordCache: new Map(),
  simulation: null,
  zoom: null,
  svg: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = new Intl.NumberFormat("id-ID");
const levelMap = { 1: "broad", 2: "medium", 3: "specific" };
const levelDescription = {
  broad: "Umum: rumpun besar lintas disiplin",
  medium: "Menengah: istilah utama hasil analisis judul, kata kunci, dan abstrak",
  specific: "Spesifik: kata kunci rinci pada setiap skripsi",
};
const nodeColors = { faculty: "var(--faculty)", program: "var(--program)", advisor: "var(--advisor)", topic: "var(--topic)" };

const normalize = (value = "") => value.toString().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const escapeHtml = (value = "") => value.toString().replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const truncate = (value, length = 44) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const safeUrl = (value = "") => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
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
      $("#indexStatus").textContent = "Memuat indeks 29 ribu judul…";
      state.index = await fetchJson("data/search-index.json");
      $("#indexStatus").textContent = `${fmt.format(state.index.length)} judul siap ditelusuri.`;
      $("#exportCsv").disabled = false;
      applyFilters();
    } catch (error) {
      console.error(error);
      $("#indexStatus").textContent = "Indeks judul gagal dimuat.";
    }
  };
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 1000 }); else setTimeout(load, 50);
}

function bindEvents() {
  $("#facultyFilter").addEventListener("change", (e) => {
    state.faculty = e.target.value;
    state.program = "";
    state.advisor = "";
    $("#programFilter").value = "";
    state.topic = "";
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
  $("#topicFilter").addEventListener("change", (e) => { state.topic = e.target.value; refreshAll(false); });
  $("#yearFilter").addEventListener("change", (e) => { state.year = e.target.value; applyFilters(); updateActiveFilters(); });
  $("#specificityRange").addEventListener("input", (e) => {
    state.specificity = levelMap[e.target.value];
    state.topic = "";
    state.advisor = "";
    $("#specificityDescription").textContent = levelDescription[state.specificity];
    refreshTopicControl();
    refreshAll();
  });
  $("#globalSearch").addEventListener("input", debounce((e) => { state.query = e.target.value; applyFilters(); }, 160));
  $("#nodeLimit").addEventListener("input", debounce((e) => { state.nodeLimit = Number(e.target.value); renderNetwork(); }, 100));
  $("#showAdvisors").addEventListener("change", (e) => { state.showAdvisors = e.target.checked; renderNetwork(); });
  $("#showTopics").addEventListener("change", (e) => { state.showTopics = e.target.checked; renderNetwork(); });
  $("#resetFilters").addEventListener("click", resetFilters);
  $("#resetZoom").addEventListener("click", resetZoom);
  $("#loadMore").addEventListener("click", () => { state.visibleCount += 30; renderTheses(); });
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#closeModal").addEventListener("click", () => $("#detailModal").close());
  $("#detailModal").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("#themeToggle").addEventListener("click", toggleTheme);
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#globalSearch").focus(); }
    if (e.key === "Escape" && $("#detailModal").open) $("#detailModal").close();
  });
  window.addEventListener("resize", debounce(() => renderNetwork(), 180));
}

function debounce(fn, wait) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

function populateStaticControls() {
  const facultySelect = $("#facultyFilter");
  state.summary.faculties.forEach((f) => facultySelect.add(new Option(`${f.code} · ${f.name} (${fmt.format(f.count)})`, f.code)));
  populatePrograms();
  const yearSelect = $("#yearFilter");
  Object.keys(state.summary.years).sort((a, b) => b - a).forEach((year) => yearSelect.add(new Option(`${year} (${fmt.format(state.summary.years[year])})`, year)));
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
  return state.summary.programs.filter((p) => (!state.faculty || p.faculty === state.faculty) && (!state.program || p.key === state.program));
}

function aggregateTopics(programs = selectedPrograms()) {
  const counter = new Map();
  programs.forEach((p) => (p.topics[state.specificity] || []).forEach((t) => counter.set(t.name, (counter.get(t.name) || 0) + t.count)));
  return [...counter.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"));
}

function refreshTopicControl() {
  const select = $("#topicFilter");
  select.innerHTML = '<option value="">Semua topik</option>';
  aggregateTopics().slice(0, state.specificity === "specific" ? 450 : 300).forEach((t) => select.add(new Option(`${t.name} (${fmt.format(t.count)})`, t.name)));
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
  Object.assign(state, { faculty: "", program: "", topic: "", year: "", advisor: "", query: "", specificity: "broad", visibleCount: 30 });
  $("#facultyFilter").value = "";
  $("#programFilter").value = "";
  $("#yearFilter").value = "";
  $("#globalSearch").value = "";
  $("#specificityRange").value = "1";
  $("#specificityDescription").textContent = levelDescription.broad;
  populatePrograms();
  refreshTopicControl();
  refreshAll();
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
  wrap.innerHTML = chips.map(([key, label]) => `<span class="filter-chip">${escapeHtml(label)}<button type="button" data-remove="${key}" aria-label="Hapus filter">×</button></span>`).join("");
  wrap.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => removeFilter(button.dataset.remove)));
}

function removeFilter(key) {
  state[key] = "";
  if (key === "faculty") { state.program = ""; populatePrograms(); }
  if (key === "program" || key === "faculty") { state.topic = ""; refreshTopicControl(); }
  const control = { faculty: "#facultyFilter", program: "#programFilter", topic: "#topicFilter", year: "#yearFilter" }[key];
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
      const haystack = normalize([item.title, item.author, ...(item.advisors || []), ...(item.keywords || []), ...Object.values(item.topics).flat()].join(" "));
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  }).sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, "id"));
  state.visibleCount = 30;
  renderTheses();
}

function renderTheses() {
  const list = $("#thesisList");
  const total = state.filtered.length;
  $("#resultSummary").textContent = `${fmt.format(total)} skripsi ditemukan${state.query ? ` untuk “${state.query}”` : ""}.`;
  if (!total) {
    list.innerHTML = '<div class="empty-state"><strong>Tidak ada skripsi yang cocok.</strong><span>Coba longgarkan filter atau kurangi kata pencarian. Data tidak tersinggung, hanya terlalu patuh.</span></div>';
    $("#loadMore").hidden = true;
    return;
  }
  list.innerHTML = state.filtered.slice(0, state.visibleCount).map((item) => {
    const tags = (item.topics[state.specificity] || []).slice(0, 4);
    return `<article class="thesis-card">
      <div>
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
  list.querySelectorAll(".open-detail").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id, button.dataset.pkey)));
  $("#loadMore").hidden = state.visibleCount >= total;
  $("#loadMore").textContent = `Muat lebih banyak (${fmt.format(Math.min(30, total - state.visibleCount))})`;
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
  const topicTags = [...new Set([...item.topics.broad, ...item.topics.medium, ...item.topics.specific])].slice(0, 12);
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
  if (!state.summary) return;
  const topics = aggregateTopics().slice(0, 8);
  const max = topics[0]?.count || 1;
  $("#topTopics").innerHTML = topics.map((t) => `<div class="rank-item">
    <button type="button" data-topic="${escapeHtml(t.name)}" title="Filter topik ${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
    <span>${fmt.format(t.count)}</span>
    <div class="rank-bar"><i style="width:${Math.max(7, (t.count / max) * 100)}%"></i></div>
  </div>`).join("") || '<p>Tidak ada topik untuk filter ini.</p>';
  $("#topTopics").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectTopic(button.dataset.topic)));
}

function selectTopic(topic) {
  state.topic = topic;
  let option = [...$("#topicFilter").options].find((o) => o.value === topic);
  if (!option) { option = new Option(topic, topic); $("#topicFilter").add(option); }
  $("#topicFilter").value = topic;
  refreshAll(false);
  document.querySelector("#koleksi").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildGraphData() {
  const programs = selectedPrograms();
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const addNode = (node) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
  const addLink = (source, target, weight) => { if (nodeIds.has(source) && nodeIds.has(target)) links.push({ source, target, weight }); };

  const facultyCodes = [...new Set(programs.map((p) => p.faculty))];
  facultyCodes.forEach((code) => {
    const f = state.summary.faculties.find((x) => x.code === code);
    addNode({ id: `f:${code}`, type: "faculty", label: code, fullLabel: f.name, count: programs.filter((p) => p.faculty === code).reduce((s, p) => s + p.count, 0), value: code });
  });
  programs.forEach((p) => addNode({ id: `p:${p.key}`, type: "program", label: p.name, fullLabel: p.name, count: p.count, value: p.key, faculty: p.faculty }));
  programs.forEach((p) => addLink(`f:${p.faculty}`, `p:${p.key}`, p.count));

  const baseCount = nodes.length;
  const remaining = Math.max(10, state.nodeLimit - baseCount);
  const advisorQuota = state.showAdvisors ? Math.floor(remaining * (state.showTopics ? .54 : 1)) : 0;
  const topicQuota = state.showTopics ? remaining - advisorQuota : 0;

  if (state.showAdvisors) {
    const counts = new Map();
    programs.forEach((p) => p.advisors.forEach((a) => counts.set(a.key, (counts.get(a.key) || 0) + a.count)));
    const selected = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, advisorQuota);
    selected.forEach(([key, count]) => {
      const info = state.summary.advisors.find((a) => a.key === key);
      addNode({ id: `a:${key}`, type: "advisor", label: info?.name || key, fullLabel: info?.name || key, count, value: key });
    });
    programs.forEach((p) => p.advisors.forEach((a) => addLink(`p:${p.key}`, `a:${a.key}`, a.count)));
  }

  if (state.showTopics) {
    const topics = aggregateTopics(programs).slice(0, topicQuota);
    topics.forEach((t) => addNode({ id: `t:${t.name}`, type: "topic", label: t.name, fullLabel: t.name, count: t.count, value: t.name }));
    programs.forEach((p) => (p.topics[state.specificity] || []).forEach((t) => addLink(`p:${p.key}`, `t:${t.name}`, t.count)));
  }
  return { nodes, links };
}

function renderNetwork() {
  if (!state.summary || typeof d3 === "undefined") return;
  const container = $("#network");
  container.innerHTML = "";
  const width = Math.max(container.clientWidth, 500);
  const height = window.innerWidth <= 720 ? 540 : 660;
  const graph = buildGraphData();
  const nodeById = {};
  graph.nodes.forEach((node) => { nodeById[node.id] = node; });
  graph.links = graph.links
    .map((link) => ({ ...link, source: nodeById[link.source], target: nodeById[link.target] }))
    .filter((link) => link.source && link.target);

  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const root = svg.append("g");
  const zoom = d3.behavior.zoom().scaleExtent([.25, 4]).on("zoom", function () {
    root.attr("transform", `translate(${d3.event.translate})scale(${d3.event.scale})`);
  });
  svg.call(zoom);
  state.svg = svg; state.zoom = zoom; state.zoomRoot = root;

  const maxWeight = d3.max(graph.links, (d) => d.weight) || 1;
  const link = root.append("g").selectAll("line").data(graph.links).enter().append("line")
    .attr("class", "link").attr("stroke-width", (d) => 0.5 + Math.sqrt(d.weight / maxWeight) * 3);
  const node = root.append("g").selectAll("g").data(graph.nodes).enter().append("g")
    .attr("class", "node").on("click", function (d) { nodeSelected(d); });
  node.append("circle")
    .attr("r", (d) => Math.max(6, Math.min(d.type === "faculty" ? 20 : d.type === "program" ? 15 : 12, 5 + Math.log2(d.count + 1) * 1.5)))
    .attr("fill", (d) => nodeColors[d.type]);
  node.append("text")
    .attr("x", (d) => d.type === "faculty" ? 23 : d.type === "program" ? 18 : 14)
    .attr("y", 3)
    .text((d) => truncate(d.label, d.type === "faculty" ? 8 : 34));
  node.append("title").text((d) => `${d.fullLabel}\n${fmt.format(d.count)} skripsi/relasi`);

  const force = d3.layout.force()
    .nodes(graph.nodes)
    .links(graph.links)
    .size([width, height])
    .linkDistance((d) => d.source.type === "faculty" ? 95 : 72)
    .linkStrength(.25)
    .charge((d) => d.type === "faculty" ? -900 : d.type === "program" ? -420 : -130)
    .gravity(.07)
    .friction(.86)
    .on("tick", () => {
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    })
    .start();
  state.simulation = force;

  const drag = force.drag()
    .on("dragstart", function (d) { if (d3.event.sourceEvent) d3.event.sourceEvent.stopPropagation(); d.fixed = true; })
    .on("dragend", function (d) { d.fixed = false; });
  node.call(drag);

  node.on("mouseenter", function (hovered) {
    const connected = new Set([hovered.id]);
    graph.links.forEach((l) => { if (l.source.id === hovered.id) connected.add(l.target.id); if (l.target.id === hovered.id) connected.add(l.source.id); });
    node.classed("dimmed", (d) => !connected.has(d.id)).classed("highlighted", (d) => d.id === hovered.id);
    link.classed("dimmed", (d) => d.source.id !== hovered.id && d.target.id !== hovered.id);
  }).on("mouseleave", function () {
    node.classed("dimmed", false).classed("highlighted", false);
    link.classed("dimmed", false);
  });
}
function nodeSelected(node) {
  const labels = { faculty: "Fakultas/sekolah", program: "Jurusan", advisor: "Dosen pembimbing", topic: `Topik ${state.specificity}` };
  $("#nodeInsight").innerHTML = `
    <p class="eyebrow">${labels[node.type]}</p>
    <h3>${escapeHtml(node.fullLabel)}</h3>
    <p>Node ini terhubung dengan ${fmt.format(node.count)} skripsi atau relasi dalam tampilan saat ini.</p>
    <div class="insight-meta"><span>Jenis <b>${labels[node.type]}</b></span><span>Jumlah <b>${fmt.format(node.count)}</b></span></div>
    <button class="insight-action" type="button">Gunakan sebagai filter</button>`;
  $("#nodeInsight .insight-action").addEventListener("click", () => filterByNode(node));
}

function filterByNode(node) {
  if (node.type === "faculty") {
    state.faculty = node.value; state.program = ""; state.topic = ""; state.advisor = "";
    $("#facultyFilter").value = node.value; populatePrograms(); refreshTopicControl();
  } else if (node.type === "program") {
    const p = state.summary.programs.find((item) => item.key === node.value);
    state.faculty = p.faculty; state.program = node.value; state.topic = ""; state.advisor = "";
    $("#facultyFilter").value = p.faculty; populatePrograms(); $("#programFilter").value = node.value; refreshTopicControl();
  } else if (node.type === "advisor") {
    state.advisor = node.value;
  } else if (node.type === "topic") {
    state.topic = node.value;
    let option = [...$("#topicFilter").options].find((o) => o.value === node.value);
    if (!option) { option = new Option(node.value, node.value); $("#topicFilter").add(option); }
    $("#topicFilter").value = node.value;
  }
  refreshAll(node.type !== "topic" && node.type !== "advisor");
  document.querySelector("#koleksi").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetZoom() {
  if (!state.svg || !state.zoom) return;
  state.zoom.translate([0, 0]).scale(1);
  state.svg.transition().duration(450).call(state.zoom.event);
}

function exportCsv() {
  if (!state.filtered.length) return showToast("Tidak ada hasil untuk diekspor.");
  const rows = state.filtered.map((r) => [r.title, r.author, r.advisors.join("; "), r.faculty, r.program, r.year || "", (r.topics[state.specificity] || []).join("; "), r.url]);
  const header = ["Judul", "Penulis", "Pembimbing", "Fakultas", "Jurusan", "Tahun", `Topik_${state.specificity}`, "URL"];
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hasil-peta-skripsi-itb.csv";
  a.click(); URL.revokeObjectURL(a.href);
  showToast(`${fmt.format(rows.length)} baris diekspor.`);
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("thesis-theme", document.body.classList.contains("dark") ? "dark" : "light");
  setTimeout(renderNetwork, 50);
}

if (localStorage.getItem("thesis-theme") === "dark") document.body.classList.add("dark");
init();
