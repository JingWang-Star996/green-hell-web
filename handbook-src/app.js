(() => {
  "use strict";

  const data = window.GAME_DEV_HANDBOOK_DATA;
  if (!data) {
    document.body.innerHTML = '<main class="noscript"><h1>宝典数据未载入</h1><p>请刷新页面；若问题持续，请检查静态制品是否完整。</p></main>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const normalize = (value) => String(value ?? "")
    .toLocaleLowerCase("zh-CN")
    .normalize("NFKC")
    .replace(/[，。！？、：；（）【】《》“”‘’·—_\-\/\\|,.!?;:()[\]{}<>"'`~@#$%^&*+=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const evidenceClass = { "项目事实": "evidence-fact", "默认方法": "evidence-template", "开放风险": "evidence-risk" };
  const state = { glossaryGroup: "全部", query: "", domain: "all", evidence: "all" };
  let toastTimer = 0;
  let lastNavTrigger = null;

  function evidenceBadge(label) {
    return `<span class="evidence-badge ${evidenceClass[label] ?? ""}">${escapeHtml(label)}</span>`;
  }

  function sourceTrace(paths) {
    if (!paths?.length) return "";
    return `<details class="source-trace"><summary>来源与边界</summary>${paths.map((path) => `<code>${escapeHtml(path)}</code>`).join("")}</details>`;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1800);
  }

  async function copyText(text, successMessage = "已复制") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    showToast(successMessage);
  }

  function renderChrome() {
    $("#hero-subtitle").textContent = data.meta.subtitle;
    $("#nav-edition").textContent = data.meta.edition;
    $("#game-link").href = data.meta.canonicalGameUrl;
    $("#game-wiki-link").href = data.meta.canonicalGameWikiUrl;
    const stats = [
      [data.meta.counts.chapters, "专业章节"],
      [data.meta.counts.entries, "方法条目"],
      [data.meta.counts.gates, "阶段门"],
      [data.meta.counts.terms, "术语"],
      [data.meta.counts.templates, "模板"],
    ];
    $("#hero-stats").innerHTML = stats.map(([value, label]) => `<div class="hero-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    $("#manifesto").innerHTML = data.manifesto.map((text, index) => `<article><b>0${index + 1}</b><p>${escapeHtml(text)}</p></article>`).join("");
    $("#chapter-nav").innerHTML = data.chapters.map((chapter) => `<a href="#chapter-${escapeHtml(chapter.id)}" data-nav-link>${escapeHtml(chapter.index)} · ${escapeHtml(chapter.title)}</a>`).join("");
  }

  function renderReaderPaths() {
    $("#reader-path-grid").innerHTML = data.readerPaths.map((path, index) => `<a class="reader-card" href="#chapter-${escapeHtml(path.route[0])}">
      <span class="reader-icon">${String(index + 1).padStart(2, "0")}</span>
      <h3>${escapeHtml(path.title)}</h3>
      <p>${escapeHtml(path.copy)}</p>
      <span>${path.route.map((id) => escapeHtml(data.chapters.find((chapter) => chapter.id === id)?.domain ?? id)).join(" → ")}</span>
    </a>`).join("");
  }

  function renderEvidence() {
    $("#evidence-grid").innerHTML = data.evidenceAxes.map((item) => `<article class="evidence-card" id="axis-${escapeHtml(item.axis)}">
      <span class="axis">${escapeHtml(item.axis)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="level-row">${item.levels.map((level) => `<span>${escapeHtml(level)}</span>`).join("")}</div>
      <dl><dt>能证明</dt><dd>${escapeHtml(item.proves)}</dd><dt>仍不能证明</dt><dd>${escapeHtml(item.cannot)}</dd></dl>
    </article>`).join("");
    $("#accuracy-note").innerHTML = `<strong>本宝典的口径：</strong> ${escapeHtml(data.meta.accuracy)}`;
  }

  function renderCaseTimeline() {
    $("#case-timeline").innerHTML = data.caseTimeline.map((item) => `<article class="case-phase" id="case-${escapeHtml(item.phase)}">
      <span class="phase">${escapeHtml(item.phase)}</span><h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.evidence)}</p><strong>${escapeHtml(item.lesson)}</strong>
    </article>`).join("");
  }

  function renderEntry(entryItem, chapter) {
    const id = `entry-${entryItem.id}`;
    return `<article class="entry-card section-anchor" id="${escapeHtml(id)}" data-domain="${escapeHtml(chapter.domain)}" data-evidence="${escapeHtml(entryItem.evidence)}">
      <div class="entry-card-header"><div><span class="entry-id">${escapeHtml(chapter.index)} / ${escapeHtml(entryItem.id)}</span><div>${evidenceBadge(entryItem.evidence)}</div></div><div><a class="anchor-link" href="#${escapeHtml(id)}" aria-label="链接到${escapeHtml(entryItem.title)}">#</a></div></div>
      <h3>${escapeHtml(entryItem.title)}</h3><p>${escapeHtml(entryItem.summary)}</p>
      <details class="entry-details"><summary>展开做法、失败信号与案例</summary>
        <h4>怎样应用</h4><ul>${entryItem.practice.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
        <h4>失败信号</h4><ul>${entryItem.failureSignals.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>
        <div class="case-note"><strong>CANOPY 案例：</strong>${escapeHtml(entryItem.canopyCase)}</div>
        ${sourceTrace(entryItem.sources)}
      </details>
    </article>`;
  }

  function renderChapters() {
    $("#chapter-sections").innerHTML = data.chapters.map((chapter) => `<section id="chapter-${escapeHtml(chapter.id)}" class="wiki-section chapter-section section-anchor" data-chapter-section>
      <header class="section-header"><div><span class="section-number">${escapeHtml(chapter.index)}</span><p class="section-kicker">${escapeHtml(chapter.domain).toLocaleUpperCase("zh-CN")}</p></div><div><h2>${escapeHtml(chapter.title)}</h2><p>${escapeHtml(chapter.summary)}</p></div></header>
      <div class="entry-grid">${chapter.entries.map((item) => renderEntry(item, chapter)).join("")}</div>
    </section>`).join("");
  }

  function renderGates() {
    $("#gate-list").innerHTML = data.gates.map((gate) => `<article class="gate-card section-anchor" id="gate-${escapeHtml(gate.id)}">
      <div class="gate-title"><strong>${escapeHtml(gate.id)}</strong><span>${escapeHtml(gate.title)}</span></div>
      <div class="gate-cell">${escapeHtml(gate.deliverable)}</div>
      <div class="gate-cell">${escapeHtml(gate.gate)}</div>
      <div class="gate-cell">${escapeHtml(gate.stop)}</div>
    </article>`).join("");
  }

  function renderAntiPatterns() {
    $("#anti-pattern-grid").innerHTML = data.antiPatterns.map((item, index) => `<article class="anti-card section-anchor" id="anti-${String(index + 1).padStart(2, "0")}">
      <span class="warning-index">RED FLAG ${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.symptom)}</p><strong>纠正：${escapeHtml(item.correction)}</strong>
    </article>`).join("");
  }

  function checklistKey(id) { return `game-dev-handbook:v1:checklist:${id}`; }
  function readChecklist(id, length) {
    try {
      const parsed = JSON.parse(localStorage.getItem(checklistKey(id)) ?? "[]");
      return Array.from({ length }, (_, index) => parsed[index] === true);
    } catch { return Array.from({ length }, () => false); }
  }
  function writeChecklist(id, values) {
    try { localStorage.setItem(checklistKey(id), JSON.stringify(values)); } catch { showToast("当前环境无法保存勾选进度"); }
  }
  function updateChecklistProgress(card, values) {
    const complete = values.filter(Boolean).length;
    const progress = $(".progress-ring", card);
    progress.textContent = `${complete}/${values.length}`;
    progress.setAttribute("aria-label", `已完成 ${complete} 项，共 ${values.length} 项`);
  }
  function renderChecklists() {
    $("#checklist-grid").innerHTML = data.checklists.map((list) => {
      const values = readChecklist(list.id, list.items.length);
      return `<article class="checklist-card section-anchor" id="checklist-${escapeHtml(list.id)}" data-checklist="${escapeHtml(list.id)}">
        <header class="checklist-header"><div><span>${escapeHtml(list.audience)}</span><h3>${escapeHtml(list.title)}</h3></div><div class="progress-ring" aria-label="已完成 ${values.filter(Boolean).length} 项，共 ${values.length} 项">${values.filter(Boolean).length}/${values.length}</div></header>
        <div class="checklist-items">${list.items.map((text, index) => `<label class="check-item"><input type="checkbox" data-check-index="${index}" ${values[index] ? "checked" : ""} /><span>${escapeHtml(text)}</span></label>`).join("")}</div>
        <div class="card-actions"><button class="small-button" type="button" data-copy-checklist>复制清单</button><button class="small-button" type="button" data-reset-checklist>重置</button></div>
      </article>`;
    }).join("");

    $$('[data-checklist]').forEach((card) => {
      const id = card.dataset.checklist;
      const list = data.checklists.find((item) => item.id === id);
      const inputs = $$('input[type="checkbox"]', card);
      inputs.forEach((input) => input.addEventListener("change", () => {
        const values = inputs.map((candidate) => candidate.checked);
        writeChecklist(id, values);
        updateChecklistProgress(card, values);
      }));
      $("[data-copy-checklist]", card).addEventListener("click", () => copyText(`${list.title}\n${list.items.map((text) => `- [ ] ${text}`).join("\n")}`, "清单已复制"));
      $("[data-reset-checklist]", card).addEventListener("click", () => {
        inputs.forEach((input) => { input.checked = false; });
        writeChecklist(id, inputs.map(() => false));
        updateChecklistProgress(card, inputs.map(() => false));
        showToast("清单进度已重置");
      });
    });
  }

  function renderTemplates() {
    $("#template-grid").innerHTML = data.templates.map((template) => `<article class="template-card section-anchor" id="template-${escapeHtml(template.id)}">
      <div class="template-top"><div><span>${escapeHtml(template.usage)}</span><h3>${escapeHtml(template.title)}</h3></div><button class="copy-link" type="button" data-copy-template="${escapeHtml(template.id)}" aria-label="复制${escapeHtml(template.title)}">⧉</button></div>
      <pre>${escapeHtml(template.body)}</pre>
    </article>`).join("");
    $$('[data-copy-template]').forEach((button) => button.addEventListener("click", () => {
      const template = data.templates.find((item) => item.id === button.dataset.copyTemplate);
      copyText(`${template.title}\n\n${template.body}`, "模板已复制");
    }));
  }

  function renderGlossary() {
    const groups = ["全部", ...new Set(data.glossary.map((term) => term.group))];
    $("#glossary-filters").innerHTML = groups.map((group) => `<button type="button" data-glossary-group="${escapeHtml(group)}" aria-pressed="${String(group === state.glossaryGroup)}">${escapeHtml(group)}</button>`).join("");
    const visible = state.glossaryGroup === "全部" ? data.glossary : data.glossary.filter((term) => term.group === state.glossaryGroup);
    $("#glossary-list").innerHTML = visible.map((term) => `<div class="term-card section-anchor" id="${escapeHtml(term.id)}"><div class="term-top"><dt>${escapeHtml(term.term)}</dt><span class="term-group">${escapeHtml(term.group)}</span></div><dd>${escapeHtml(term.definition)}</dd><dd class="term-note">${escapeHtml(term.note)}</dd></div>`).join("");
    $$('[data-glossary-group]').forEach((button) => button.addEventListener("click", () => {
      state.glossaryGroup = button.dataset.glossaryGroup;
      renderGlossary();
    }));
  }

  function renderBoundaries() {
    $("#open-risk-list").innerHTML = data.openRisks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("");
    const manifest = data.sourceManifest ?? [];
    $("#source-list").innerHTML = manifest.map((source) => `<li><a href="./sources/${encodeURIComponent(source.file)}" target="_blank" rel="noopener">${escapeHtml(source.title ?? source.path)}</a><br /><small>${escapeHtml(source.bytes)} bytes · sha256:${escapeHtml(source.sha256.slice(0, 16))}…</small></li>`).join("");
    const build = {
      edition: data.meta.edition,
      builtAt: data.meta.builtAt,
      sourceCommit: data.meta.sourceCommit,
      sourceDirty: data.meta.sourceDirty,
      sourceDocuments: manifest.length,
      sourceDigest: data.meta.sourceDigest,
      artifactDigest: data.meta.artifactDigest ?? "构建后写入独立 manifest",
    };
    $("#build-info").textContent = JSON.stringify(build, null, 2);
  }

  function buildSearchIndex() {
    const items = [];
    for (const chapter of data.chapters) {
      for (const item of chapter.entries) {
        items.push({ type: "方法条目", id: item.id, href: `#entry-${item.id}`, title: item.title, summary: item.summary, domain: chapter.domain, evidence: item.evidence, titleText: normalize(item.title), text: normalize([item.title, item.id, chapter.title, chapter.domain, item.summary, item.practice, item.failureSignals, item.canopyCase].flat(Infinity).join(" ")) });
      }
    }
    data.gates.forEach((item) => items.push({ type: "阶段门", id: item.id, href: `#gate-${item.id}`, title: `${item.id} · ${item.title}`, summary: item.gate, domain: "制作流程", evidence: "默认方法", titleText: normalize(`${item.id} ${item.title}`), text: normalize([item.id, item.title, item.deliverable, item.gate, item.stop].join(" ")) }));
    data.antiPatterns.forEach((item, index) => items.push({ type: "反模式", id: `anti-${index + 1}`, href: `#anti-${String(index + 1).padStart(2, "0")}`, title: item.title, summary: item.symptom, domain: "诊断", evidence: "项目事实", titleText: normalize(item.title), text: normalize([item.title, item.symptom, item.correction].join(" ")) }));
    data.checklists.forEach((item) => items.push({ type: "检查清单", id: item.id, href: `#checklist-${item.id}`, title: item.title, summary: item.audience, domain: "验收", evidence: "默认方法", titleText: normalize(item.title), text: normalize([item.title, item.audience, item.items].flat(Infinity).join(" ")) }));
    data.templates.forEach((item) => items.push({ type: "模板", id: item.id, href: `#template-${item.id}`, title: item.title, summary: item.usage, domain: "制作工具", evidence: "默认方法", titleText: normalize(item.title), text: normalize([item.title, item.usage, item.body].join(" ")) }));
    data.glossary.forEach((item) => items.push({ type: "术语", id: item.id, href: `#${item.id}`, title: item.term, summary: item.definition, domain: item.group, evidence: "", titleText: normalize(item.term), text: normalize([item.term, item.group, item.definition, item.note].join(" ")) }));
    data.caseTimeline.forEach((item) => items.push({ type: "CANOPY 案例", id: item.phase, href: `#case-${item.phase}`, title: `${item.phase} · ${item.title}`, summary: item.lesson, domain: "案例", evidence: "项目事实", titleText: normalize(`${item.phase} ${item.title}`), text: normalize([item.phase, item.title, item.evidence, item.lesson].join(" ")) }));
    return items;
  }
  const searchIndex = buildSearchIndex();

  function scoreResult(item, tokens) {
    if (!tokens.every((token) => item.text.includes(token))) return -1;
    return tokens.reduce((score, token) => score + (item.titleText.includes(token) ? 12 : 3) + (item.titleText === token ? 10 : 0), 0);
  }

  function renderSearch() {
    state.query = $("#global-search").value.trim();
    state.domain = $("#search-domain").value;
    state.evidence = $("#search-evidence").value;
    const searchSection = $("#search-results");
    const content = $("#knowledge-content");
    if (!state.query) {
      searchSection.hidden = true;
      content.hidden = false;
      $("#search-live").textContent = "已退出搜索";
      return;
    }
    const tokens = normalize(state.query).split(" ").filter(Boolean);
    const results = searchIndex
      .map((item) => ({ ...item, score: scoreResult(item, tokens) }))
      .filter((item) => item.score >= 0)
      .filter((item) => state.domain === "all" || item.domain === state.domain)
      .filter((item) => state.evidence === "all" || item.evidence === state.evidence)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
      .slice(0, 80);
    const groups = new Map();
    results.forEach((item) => groups.set(item.type, [...(groups.get(item.type) ?? []), item]));
    $("#search-summary").textContent = `“${state.query}”共找到 ${results.length} 条结果；多个关键词按 AND 匹配。`;
    $("#search-live").textContent = `找到 ${results.length} 条结果`;
    $("#search-result-groups").innerHTML = results.length ? [...groups.entries()].map(([type, items]) => `<section class="result-group"><h3>${escapeHtml(type)}<span>${items.length}</span></h3><div class="result-list">${items.map((item) => `<a class="search-result" href="${escapeHtml(item.href)}" data-search-result><div class="result-meta"><span>${escapeHtml(item.domain)}</span>${item.evidence ? `<span>${escapeHtml(item.evidence)}</span>` : ""}</div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p></a>`).join("")}</div></section>`).join("") : `<div class="empty-search"><strong>没有匹配条目</strong><p>尝试“存档 云”“移动端 动词”“导演 刷新”“Toy 路径”或清除筛选。</p></div>`;
    searchSection.hidden = false;
    content.hidden = true;
    searchSection.scrollIntoView({ block: "start" });
    $$('[data-search-result]').forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      const hash = link.getAttribute("href");
      $("#global-search").value = "";
      renderSearch();
      history.pushState(null, "", hash);
      focusDeepLink(hash);
    }));
  }

  function populateSearchFilters() {
    const domains = [...new Set(searchIndex.map((item) => item.domain))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    $("#search-domain").innerHTML = `<option value="all">全部领域</option>${domains.map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join("")}`;
  }

  function openNav(trigger) {
    lastNavTrigger = trigger;
    document.body.classList.add("nav-open");
    $("#nav-toggle").setAttribute("aria-expanded", "true");
    $("#nav-overlay").hidden = false;
    $("#nav-close").focus();
  }
  function closeNav(restoreFocus = true) {
    document.body.classList.remove("nav-open");
    $("#nav-toggle").setAttribute("aria-expanded", "false");
    $("#nav-overlay").hidden = true;
    if (restoreFocus) lastNavTrigger?.focus();
  }

  function wireInteractions() {
    $("#nav-toggle").addEventListener("click", (event) => openNav(event.currentTarget));
    $("#nav-close").addEventListener("click", () => closeNav());
    $("#nav-overlay").addEventListener("click", () => closeNav());
    $$('[data-nav-link]').forEach((link) => link.addEventListener("click", () => closeNav(false)));
    $("#back-to-top").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    window.addEventListener("scroll", () => $("#back-to-top").classList.toggle("visible", window.scrollY > 700), { passive: true });

    const search = $("#global-search");
    let debounceTimer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(renderSearch, 90);
    });
    $("#search-domain").addEventListener("change", renderSearch);
    $("#search-evidence").addEventListener("change", renderSearch);
    $("#clear-search").addEventListener("click", () => { search.value = ""; state.domain = "all"; state.evidence = "all"; $("#search-domain").value = "all"; $("#search-evidence").value = "all"; renderSearch(); search.focus(); });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
      if ((event.key === "/" && !editable) || ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k")) {
        event.preventDefault();
        search.classList.add("search-open");
        search.focus();
      }
      if (event.key === "Escape") {
        if (document.body.classList.contains("nav-open")) { closeNav(); return; }
        if (state.query) { search.value = ""; renderSearch(); search.focus(); return; }
        search.classList.remove("search-open");
      }
      if (event.key === "Tab" && document.body.classList.contains("nav-open") && window.matchMedia("(max-width: 900px)").matches) {
        const focusable = $$("a[href], button:not([disabled])", $("#knowledge-nav"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    search.addEventListener("blur", () => { if (!search.value) search.classList.remove("search-open"); });
  }

  function wireNavigation() {
    const links = $$('[data-nav-link]');
    const byHash = new Map(links.map((link) => [link.hash, link]));
    const targets = links.map((link) => $(link.hash)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.removeAttribute("aria-current"));
      byHash.get(`#${visible.target.id}`)?.setAttribute("aria-current", "location");
    }, { rootMargin: "-20% 0px -68%", threshold: [0, .1, .35] });
    targets.forEach((target) => observer.observe(target));
  }

  function restoreDeepLink() {
    if (!location.hash || location.hash === "#") return;
    focusDeepLink(location.hash);
  }

  function focusDeepLink(hash) {
    let target;
    try { target = $(decodeURIComponent(hash)); } catch { target = null; }
    if (!target) return;
    $$(".deep-link-active").forEach((item) => item.classList.remove("deep-link-active"));
    target.classList.add("deep-link-active");
    const details = target.querySelector(".entry-details");
    if (details) details.open = true;
    window.setTimeout(() => target.scrollIntoView({ block: "start" }), 30);
  }

  function renderApp() {
    renderChrome();
    renderReaderPaths();
    renderEvidence();
    renderCaseTimeline();
    renderChapters();
    renderGates();
    renderAntiPatterns();
    renderChecklists();
    renderTemplates();
    renderGlossary();
    renderBoundaries();
    populateSearchFilters();
    wireInteractions();
    wireNavigation();
    window.addEventListener("hashchange", () => focusDeepLink(location.hash));
    restoreDeepLink();
  }

  renderApp();
})();
