(() => {
  "use strict";

  const data = window.CANOPY_WIKI_DATA;
  if (!data) {
    document.body.innerHTML = '<main class="empty-state"><strong>Wiki 数据未载入</strong><p>请重新构建或刷新页面。</p></main>';
    return;
  }

  const state = {
    query: "",
    itemCategory: "all",
    taxonomy: "plants",
    spoilers: sessionStorage.getItem("canopy-wiki-spoilers") === "visible",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const normalize = (value) => String(value ?? "").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
  const joinSearch = (...parts) => normalize(parts.flat(Infinity).filter(Boolean).join(" "));
  const recipeById = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));

  const labels = {
    categories: { all: "全部", tool: "工具", food: "食物与水", medicine: "医疗", material: "材料", container: "容器", mission: "任务" },
    nutrition: { carbohydrates: "碳水", protein: "蛋白", fat: "脂肪", hydration: "水分", energy: "能量", sanity: "理智" },
    actions: { pickup: "拾取", cut: "割取", chop: "砍伐", mine: "开采" },
    tools: { hand: "徒手", blade: "石刃", axe: "石斧", pick: "石镐" },
  };

  function sourceTrace(paths) {
    if (!paths?.length) return "";
    return `<details class="source-trace"><summary>代码依据</summary>${paths.map((path) => `<code>${escapeHtml(path)}</code>`).join("")}</details>`;
  }

  function searchAttrs(...values) {
    return `data-search-entry data-search="${escapeHtml(joinSearch(...values))}"`;
  }

  function heroStats() {
    const entries = [
      [data.meta.counts.items, "物品"],
      [data.meta.counts.recipes, "配方"],
      [data.meta.counts.tasks, "可玩任务"],
      [data.meta.counts.biomes, "群系"],
      [data.meta.counts.plants, "可采植物"],
      [data.meta.counts.fauna, "动物"],
    ];
    $("#hero-stats").innerHTML = entries.map(([value, label]) => `<div class="hero-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    $("#accuracy-copy").textContent = data.meta.accuracy;
    $("#build-stamp").textContent = `SOURCE ${data.meta.sourceCommit ?? "working-tree"} · ${new Date(data.meta.builtAt).toLocaleString("zh-CN", { hour12: false })}`;
  }

  function renderStart() {
    $("#quick-start").innerHTML = data.quickStart.map((step) => `<article class="step-card" ${searchAttrs(step.title, step.text)}><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.text)}</p></article>`).join("");
    $("#controls").innerHTML = data.controls.map((control) => `<div class="control-row" ${searchAttrs(control.input, control.action)}><code>${escapeHtml(control.input)}</code><span>${escapeHtml(control.action)}</span></div>`).join("");
    $("#interaction-rules").innerHTML = data.interactionRules.map((rule) => `<div class="rule-card" ${searchAttrs(rule.title, rule.text)}><strong>${escapeHtml(rule.title)}</strong><p>${escapeHtml(rule.text)}</p></div>`).join("");
  }

  function nutritionMarkup(edible) {
    if (!edible) return "";
    return `<div class="nutrition">${Object.entries(labels.nutrition).map(([key, label]) => {
      const value = edible[key] ?? 0;
      return `<span><b>${value > 0 ? "+" : ""}${escapeHtml(value)}</b>${label}</span>`;
    }).join("")}</div>`;
  }

  function renderItemCard(item) {
    const metrics = [
      `<span class="metric">堆叠 <b>${item.stackLimit}</b></span>`,
      item.shelfLifeGameHours ? `<span class="metric">保质 <b>${item.shelfLifeGameHours}h</b></span>` : "",
      item.durability ? `<span class="metric">耐久 <b>${item.durability}</b></span>` : "",
    ].filter(Boolean).join("");
    const aliases = item.id === "dry-leaf" ? "火绒 引火物" : item.id === "vine" ? "藤蔓 纤维" : item.id === "palm-fruit" ? "香蕉 芭蕉" : "";
    return `<article class="entry-card item-card" data-item-category="${escapeHtml(item.category)}" ${searchAttrs(item.title, item.id, item.category, item.summary, item.obtain, item.use, aliases)}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(item.id)}</span><span class="tag">${escapeHtml(labels.categories[item.category] ?? item.category)}</span></div>
      <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>
      <div class="metric-row">${metrics}</div>${nutritionMarkup(item.edible)}
      <dl class="entry-details"><div><dt>来源</dt><dd>${escapeHtml(item.obtain)}</dd></div><div><dt>用途</dt><dd>${escapeHtml(item.use)}</dd></div></dl>
      ${sourceTrace(item.source)}
    </article>`;
  }

  function renderItems() {
    const counts = data.items.reduce((result, item) => ({ ...result, [item.category]: (result[item.category] ?? 0) + 1 }), {});
    $("#item-filters").innerHTML = Object.entries(labels.categories).map(([id, label]) => `<button type="button" data-item-filter="${id}" aria-pressed="${id === state.itemCategory}">${escapeHtml(label)} <span>${id === "all" ? data.items.length : counts[id] ?? 0}</span></button>`).join("");
    $("#item-grid").innerHTML = data.items.map(renderItemCard).join("");
    $$("[data-item-filter]").forEach((button) => button.addEventListener("click", () => {
      state.itemCategory = button.dataset.itemFilter;
      $$("[data-item-filter]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      applySearch();
    }));
  }

  function materialPills(materials) {
    return materials.map((material) => `<span class="ingredient">${escapeHtml(material.label)} <b>×${material.amount ?? 1}</b></span>`).join("");
  }

  function recipeResult(recipe) {
    if (recipe.results.length) return materialPills(recipe.results);
    const copy = recipe.structure?.purpose ?? recipe.effect ?? "世界效果";
    return escapeHtml(copy);
  }

  function renderRecipeCard(recipe) {
    const tools = recipe.tools.length ? recipe.tools.map((tool) => tool.label).join("、") : "无";
    const search = [recipe.title, recipe.id, ...recipe.ingredients.map((entry) => entry.label), ...recipe.tools.map((entry) => entry.label), ...recipe.results.map((entry) => entry.label), recipe.structure?.purpose];
    return `<article class="entry-card recipe-card" ${searchAttrs(search)}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(recipe.id)}</span><span class="tag tag-amber">${recipe.structure ? "建筑" : "制作"}</span></div>
      <h3>${escapeHtml(recipe.title)}</h3>
      <div class="ingredient-line">${materialPills(recipe.ingredients)}</div>
      <div class="recipe-meta"><span>工具：${escapeHtml(tools)}${recipe.tools.length ? "（不消耗）" : ""}</span><span>${escapeHtml(recipe.workSeconds)} 秒</span></div>
      <div class="recipe-result">结果：${recipeResult(recipe)}</div>
      <div class="metric-row">${recipe.requiresCamp ? '<span class="metric">需营地</span>' : ""}${recipe.requiresLitFire ? '<span class="metric">需点燃营火</span>' : ""}</div>
      ${sourceTrace(recipe.source)}
    </article>`;
  }

  function renderStructureCard(recipe) {
    const copy = recipe.structure;
    return `<article class="entry-card structure-card" ${searchAttrs(recipe.title, recipe.id, copy.purpose, copy.operation, copy.warning)}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(recipe.id)}</span><span class="tag tag-amber">可重复建造</span></div>
      <h3>${escapeHtml(recipe.title)}</h3><p>${escapeHtml(copy.purpose)}</p>
      <div class="ingredient-line">${materialPills(recipe.ingredients)}</div>
      <dl class="entry-details"><div><dt>操作</dt><dd>${escapeHtml(copy.operation)}</dd></div></dl>
      <div class="warning">${escapeHtml(copy.warning)}</div>${sourceTrace(recipe.source)}
    </article>`;
  }

  function tableMarkup(rows, valueLabel, formatter) {
    return `<table class="data-table"><thead><tr><th>群系</th><th>${escapeHtml(valueLabel)}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(formatter(row))}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderCrafting() {
    $("#recipe-count").textContent = `${data.recipes.length} 条当前配方`;
    $("#recipe-grid").innerHTML = data.recipes.map(renderRecipeCard).join("");
    $("#structure-grid").innerHTML = data.structures.map(renderStructureCard).join("");
    $("#smoking-table").innerHTML = tableMarkup(data.processing.smoking.biomeRules, "速度倍率", (row) => `${row.rateMultiplier.toFixed(2)}×`);
    $("#rain-table").innerHTML = tableMarkup(data.processing.rainCollector.biomeMultipliers, "群系倍率", (row) => `${row.multiplier.toFixed(2)}×`);
  }

  function renderSurvival() {
    $("#survival-grid").innerHTML = data.survivalSystems.map((system) => `<article class="entry-card system-card" ${searchAttrs(system.title, system.text)}><span class="entry-id">${escapeHtml(system.id)}</span><h3>${escapeHtml(system.title)}</h3><p>${escapeHtml(system.text)}</p></article>`).join("");
    $("#director-summary").textContent = data.director.summary;
    $("#director-rules").innerHTML = data.director.rules.map((rule) => `<li ${searchAttrs(rule)}>${escapeHtml(rule)}</li>`).join("");
    $("#regeneration-grid").innerHTML = data.director.regeneration.map((entry) => `<article class="regen-card" ${searchAttrs(entry.title, entry.id, "刷新 再生")}><strong>${escapeHtml(entry.title)}</strong><span><b>${entry.minimumIntervalGameHours}–${entry.maximumIntervalGameHours}h</b> 后到期</span><span>每次 ${entry.minimumAmount}–${entry.maximumAmount} · 距离 ≥ ${entry.minimumPlayerDistance}m</span></article>`).join("");
  }

  function biomeBar(label, value) {
    const percent = Math.max(0, Math.min(100, value * 100));
    return `<div class="biome-bar"><span>${escapeHtml(label)}</span><div class="bar-track"><i style="width:${percent}%"></i></div><b>${Math.round(percent)}</b></div>`;
  }

  function renderBiomes() {
    $("#biome-grid").innerHTML = data.biomes.map((biome, index) => `<article class="biome-card" ${searchAttrs(biome.title, biome.id, biome.resourceTags, biome.faunaTags, biome.trees.map((entry) => entry.label), biome.rocks.map((entry) => entry.label), biome.plants.map((entry) => entry.label))}>
      <span class="number">0${index + 1}</span><h3>${escapeHtml(biome.title)}</h3><span class="entry-id">${escapeHtml(biome.id)}</span>
      <div class="biome-bars">${biomeBar("湿度", biome.moisture)}${biomeBar("冠层", biome.canopy)}</div>
      <div class="biome-tags">${biome.resourceTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="density-list">树 ${biome.counts.trees.minimum}–${biome.counts.trees.maximum} · 岩 ${biome.counts.rocks.minimum}–${biome.counts.rocks.maximum}<br>可采植物 ${biome.counts.plants.minimum}–${biome.counts.plants.maximum}</div>
    </article>`).join("");
  }

  function plantCard(plant) {
    return `<article class="entry-card taxonomy-card" ${searchAttrs(plant.title, plant.id, plant.primaryYield, plant.material, labels.actions[plant.action], labels.tools[plant.toolClass])}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(plant.id)}</span><span class="tag">可采植物</span></div><h3>${escapeHtml(plant.title)}</h3>
      <p>${escapeHtml(labels.actions[plant.action] ?? plant.action)} · ${escapeHtml(labels.tools[plant.toolClass] ?? plant.toolClass)}${plant.minimumTier ? ` T${plant.minimumTier}` : ""}</p>
      <div class="yield">实际产出：${escapeHtml(plant.primaryYield)} ×${plant.yieldRange[0]}–${plant.yieldRange[1]}</div>
      <p class="implementation-note">${escapeHtml(plant.settlementNote)}</p>
      <ul>${plant.variants.map((variant) => `<li>${escapeHtml(variant)}</li>`).join("")}</ul>${sourceTrace(plant.source)}
    </article>`;
  }

  function treeCard(tree) {
    return `<article class="entry-card taxonomy-card" ${searchAttrs(tree.title, tree.id, tree.material, tree.interaction, "砍树 再生")}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(tree.id)}</span><span class="tag">离散树木</span></div><h3>${escapeHtml(tree.title)}</h3><p>${escapeHtml(tree.interaction)}</p>
      <div class="yield">恢复：${tree.regrowth.totalHours.minimum}–${tree.regrowth.totalHours.maximum} 游戏小时</div>
      <ul><li>树桩 ${tree.regrowth.stumpHours.minimum}–${tree.regrowth.stumpHours.maximum}h</li><li>树苗 ${tree.regrowth.saplingHours.minimum}–${tree.regrowth.saplingHours.maximum}h</li><li>幼树 ${tree.regrowth.youngHours.minimum}–${tree.regrowth.youngHours.maximum}h</li></ul>${sourceTrace(tree.source)}
    </article>`;
  }

  function rockCard(rock) {
    return `<article class="entry-card taxonomy-card" ${searchAttrs(rock.title, rock.id, rock.tool, rock.currentYield, rock.note, "岩石 挖掘")}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(rock.id)}</span><span class="tag">可开采岩体</span></div><h3>${escapeHtml(rock.title)}</h3><p>${escapeHtml(rock.note)}</p>
      <div class="yield">工具：${escapeHtml(rock.tool)} · 产出：${escapeHtml(rock.currentYield)}</div>
      <ul>${Object.entries(rock.profiles).map(([size, profile]) => `<li>${escapeHtml(size)}：石块 ×${rock.yieldBySize[size][0]}–${rock.yieldBySize[size][1]} · ${profile.workSeconds}s / 体力 ${profile.staminaCost} / 耐久 ${profile.durabilityCost}</li>`).join("")}</ul>${sourceTrace(rock.source)}
    </article>`;
  }

  function renderTaxonomy() {
    const entries = data[state.taxonomy];
    const renderer = state.taxonomy === "plants" ? plantCard : state.taxonomy === "trees" ? treeCard : rockCard;
    $("#taxonomy-grid").innerHTML = entries.map(renderer).join("");
    $$("[data-taxonomy]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.taxonomy === state.taxonomy)));
  }

  function renderWorld() {
    renderBiomes();
    renderTaxonomy();
    $$("[data-taxonomy]").forEach((button) => button.addEventListener("click", () => {
      state.taxonomy = button.dataset.taxonomy;
      renderTaxonomy();
      applySearch();
    }));
  }

  function dangerTicks(level) {
    const count = Math.round(level * 5);
    return `<div class="danger" aria-label="危险度 ${Math.round(level * 100)}%">${Array.from({ length: 5 }, (_, index) => `<i class="${index < count ? "active" : ""}"></i>`).join("")}</div>`;
  }

  function renderFauna() {
    $("#fauna-grid").innerHTML = data.fauna.map((animal) => `<article class="fauna-card" ${searchAttrs(animal.title, animal.id, animal.role, animal.activity, animal.biomes.map((entry) => entry.label), "动物 攻击 狩猎")}>
      <div class="card-topline"><span class="entry-id">${escapeHtml(animal.id)}</span><span class="tag ${animal.dangerLevel > .5 ? "tag-amber" : ""}">${escapeHtml(animal.activity)}</span></div>
      <h3>${escapeHtml(animal.title)}</h3><p>${escapeHtml(animal.role)}</p>${dangerTicks(animal.dangerLevel)}
      <div class="fauna-stats"><span>生命<b>${animal.combat.maxHealth}</b></span><span>矛伤害<b>${animal.combat.spearDamage}</b></span><span>接触伤害<b>${animal.combat.contactDamage}</b></span><span>感知半径<b>${animal.awarenessRadius}m</b></span><span>恢复<b>${animal.combat.recoveryGameHours}h</b></span></div>
      <div class="yield">战利品：生肉 ×${animal.loot.meat}${animal.loot.hide ? ` · 兽皮 ×${animal.loot.hide}` : ""}</div>
      <div class="affinity-list">${animal.biomes.slice(0, 3).map((entry) => `<div class="affinity"><span>${escapeHtml(entry.label)}</span><b>${Math.round(entry.affinity * 100)}%</b></div>`).join("")}</div>
      ${sourceTrace(animal.source)}
    </article>`).join("");
  }

  function renderTasks() {
    $("#task-timeline").innerHTML = data.tasks.map((task) => {
      const recipeLinks = task.supportRecipeIds.map((id) => recipeById.get(id)?.title ?? id).join("、");
      const guidance = task.guidance.length ? `<div class="task-guidance ${task.spoiler ? "spoiler-content" : ""}">${task.guidance.map((step) => `<div class="guidance-step"><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.instruction)}</span></div>`).join("")}</div>` : "";
      return `<article class="task-card" data-spoiler="${task.spoiler}" ${searchAttrs(task.title, task.id, task.description, task.guidance.map((step) => [step.title, step.instruction]), recipeLinks)}>
        <div class="task-number">${String(task.order).padStart(2, "0")}</div><div><div class="card-topline"><span class="tag">${escapeHtml(task.actId)}</span>${task.spoiler ? '<span class="tag tag-amber">剧情</span>' : ""}</div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p>${recipeLinks ? `<div class="metric-row"><span class="metric">支持配方：${escapeHtml(recipeLinks)}</span></div>` : ""}${guidance}${sourceTrace(task.source)}</div>
      </article>`;
    }).join("");
  }

  function renderSave() {
    $("#manual-count").textContent = data.saveSystem.manualSlots;
    $("#auto-count").textContent = data.saveSystem.autoSlots;
    $("#save-features").innerHTML = data.saveSystem.features.map((feature) => `<li ${searchAttrs(feature, "存档 保存 导入 导出 云恢复")}>${escapeHtml(feature)}</li>`).join("");
  }

  function renderFaq() {
    $("#faq-list").innerHTML = data.faq.map((entry) => `<details class="faq-item" ${searchAttrs(entry.question, entry.answer, entry.keywords)}><summary>${escapeHtml(entry.question)}</summary><p>${escapeHtml(entry.answer)}</p></details>`).join("");
  }

  function renderRoadmap() {
    $("#roadmap-grid").innerHTML = data.roadmap.map((entry) => `<article class="roadmap-card ${escapeHtml(entry.tone)}" ${searchAttrs(entry.title, entry.items)}><h3>${escapeHtml(entry.title)}</h3><ul>${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>`).join("");
    $("#source-list").innerHTML = data.sources.map((source) => `<li><code>${escapeHtml(source)}</code></li>`).join("");
  }

  function setSpoilerVisibility(visible) {
    state.spoilers = visible;
    document.body.classList.toggle("spoilers-visible", visible);
    const button = $("#spoiler-toggle");
    button.setAttribute("aria-pressed", String(visible));
    $("span:last-child", button).textContent = visible ? "重新隐藏剧情" : "隐藏剧情剧透";
    sessionStorage.setItem("canopy-wiki-spoilers", visible ? "visible" : "hidden");
  }

  function applySearch() {
    const query = normalize(state.query);
    let visible = 0;
    const cards = $$('[data-search-entry]');
    for (const card of cards) {
      const matchesQuery = !query || card.dataset.search.includes(query);
      const matchesCategory = !card.matches(".item-card") || state.itemCategory === "all" || card.dataset.itemCategory === state.itemCategory;
      const show = matchesQuery && matchesCategory;
      card.classList.toggle("search-hidden", !show);
      if (show) visible += 1;
      if (card.matches(".faq-item") && query) card.open = show;
    }

    for (const section of $$("[data-section]")) {
      const entries = $$('[data-search-entry]', section);
      const hasVisible = entries.some((entry) => !entry.classList.contains("search-hidden"));
      section.classList.toggle("search-hidden", Boolean(query) && entries.length > 0 && !hasVisible);
    }
    const noResults = Boolean(query) && visible === 0;
    $("#empty-state").hidden = !noResults;
    $("#search-status").textContent = query ? `${visible} 条匹配` : `${cards.length} 条可检索记录`;
  }

  function wireInteractions() {
    const search = $("#wiki-search");
    search.addEventListener("input", () => {
      state.query = search.value;
      applySearch();
    });
    $("#clear-search").addEventListener("click", () => {
      search.value = "";
      state.query = "";
      state.itemCategory = "all";
      $$("[data-item-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.itemFilter === "all")));
      applySearch();
      search.focus();
    });
    $("#spoiler-toggle").addEventListener("click", () => setSpoilerVisibility(!state.spoilers));
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        search.focus();
      }
    });
  }

  function wireNavigation() {
    const links = $$(".section-nav a");
    const linkById = new Map(links.map((link) => [link.hash.slice(1), link]));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.removeAttribute("aria-current"));
      linkById.get(visible.target.id)?.setAttribute("aria-current", "location");
    }, { rootMargin: "-25% 0px -62%", threshold: [0, .15, .45] });
    $$(".wiki-section").forEach((section) => observer.observe(section));
  }

  function renderWiki() {
    heroStats();
    renderStart();
    renderItems();
    renderCrafting();
    renderSurvival();
    renderWorld();
    renderFauna();
    renderTasks();
    renderSave();
    renderFaq();
    renderRoadmap();
    setSpoilerVisibility(state.spoilers);
    wireInteractions();
    wireNavigation();
    applySearch();
  }

  renderWiki();
})();
