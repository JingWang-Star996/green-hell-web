import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createHandbookData } from "../../handbook-src/handbookData";

const root = resolve(import.meta.dirname, "../..");

test("handbook has complete cross-discipline coverage", () => {
  const data = createHandbookData();
  const entries = data.chapters.flatMap((chapter) => chapter.entries);
  assert.ok(data.chapters.length >= 10);
  assert.ok(entries.length >= 40);
  assert.ok(data.gates.length >= 13);
  assert.ok(data.glossary.length >= 70);
  assert.ok(data.checklists.length >= 6);
  assert.ok(data.templates.length >= 6);
  for (const domain of ["设计", "系统设计", "工程", "UI / 多端", "存档", "视觉 / 世界", "测试 / 证据", "团队 / Agent", "构建 / 发布", "制作流程"]) {
    assert.ok(data.chapters.some((chapter) => chapter.domain === domain), domain);
  }
});

test("all knowledge IDs are stable and unique within their namespace", () => {
  const data = createHandbookData();
  const groups = {
    chapters: data.chapters.map((item) => item.id),
    entries: data.chapters.flatMap((chapter) => chapter.entries.map((item) => item.id)),
    gates: data.gates.map((item) => item.id),
    checklists: data.checklists.map((item) => item.id),
    templates: data.templates.map((item) => item.id),
    glossary: data.glossary.map((item) => item.id),
  };
  for (const [name, ids] of Object.entries(groups)) {
    assert.equal(new Set(ids).size, ids.length, name);
    assert.ok(ids.every((id) => /^[a-z0-9][a-z0-9-]*$/i.test(id)), name);
  }
});

test("entries separate project facts, default methods and open risks", () => {
  const data = createHandbookData();
  const entries = data.chapters.flatMap((chapter) => chapter.entries);
  const labels = new Set(entries.map((item) => item.evidence));
  assert.deepEqual([...labels].sort(), ["开放风险", "项目事实", "默认方法"].sort());
  for (const item of entries) {
    assert.ok(item.summary.length >= 20, item.id);
    assert.ok(item.practice.length >= 2, item.id);
    assert.ok(item.failureSignals.length >= 2, item.id);
    assert.ok(item.canopyCase.length >= 12, item.id);
    assert.ok(item.sources.length > 0, item.id);
    assert.ok(item.sources.every((path) => !path.startsWith("/") && !/^[A-Za-z]:/.test(path)), item.id);
  }
});

test("critical CANOPY limitations remain explicit", () => {
  const data = createHandbookData();
  const risks = data.openRisks.join(" ");
  for (const phrase of ["三小时", "完整资源、威胁与章节导演", "完整生态链", "A3–A5", "Valheim", "跨设备云", "唯一 Git SHA"]) {
    assert.match(risks, new RegExp(phrase));
  }
  const allText = JSON.stringify(data);
  for (const falseClaim of ["完整导演已经完成", "完整生态链已经完成", "A3–A5 已完成", "最终 Valheim 式画面已经完成"]) {
    assert.equal(allText.includes(falseClaim), false, falseClaim);
  }
});

test("G0–G9 gate chain includes split chapter and freeze gates", () => {
  const data = createHandbookData();
  assert.deepEqual(data.gates.map((gate) => gate.id), ["G0", "G1", "G2", "G3", "G4", "G5", "G6A", "G6B", "G6C", "G7", "G8A", "G8B", "G9"]);
  for (const gate of data.gates) {
    assert.ok(gate.deliverable.length >= 12, gate.id);
    assert.ok(gate.gate.length >= 12, gate.id);
    assert.ok(gate.stop.length >= 8, gate.id);
  }
});

test("checklists and templates are executable rather than decorative", () => {
  const data = createHandbookData();
  for (const checklist of data.checklists) {
    assert.ok(checklist.items.length >= 8, checklist.id);
    assert.ok(checklist.audience.length >= 2, checklist.id);
  }
  for (const template of data.templates) {
    assert.ok(template.body.split("\n").length >= 6, template.id);
    assert.ok(template.usage.length >= 3, template.id);
  }
});

test("glossary spans design, engineering, evidence, production and release language", () => {
  const data = createHandbookData();
  const groups = new Set(data.glossary.map((term) => term.group));
  for (const group of ["设计", "系统", "工程", "存档", "世界", "UI", "测试", "证据", "制作", "发布", "Agent", "视觉"]) {
    assert.ok(groups.has(group), group);
  }
  const terms = new Set(data.glossary.map((term) => term.term));
  for (const term of ["因果链", "模拟权威", "WorldIdentity", "语义输入路由", "恢复时间线", "I / U / D", "候选冻结", "任务契约"]) {
    assert.ok(terms.has(term), term);
  }
});

test("source paths exist and public copy omits private notification context", () => {
  const data = createHandbookData();
  for (const source of data.sourceCatalog) assert.ok(existsSync(resolve(root, source.path)), source.path);
  const publicSourcePaths = [
    "docs/CANOPY_DEVELOPMENT_RETROSPECTIVE_AND_NEXT_GAME_PLAYBOOK.md",
    "docs/POSTMORTEM.md",
    "docs/PRODUCTION_PLAYBOOK.md",
    "PROJECT_BRIEF.md",
    "PLAYTEST_RUBRIC.md",
  ];
  const content = publicSourcePaths.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");
  assert.doesNotMatch(content, /[A-Za-z]:\\(?:Users|文档|Documents|Temp|AppData)\\/i);
  assert.doesNotMatch(content, /飞书会话|王鲸Codex/i);
});

test("handbook links only to canonical CANOPY public pages", () => {
  const data = createHandbookData();
  assert.equal(data.meta.canonicalGameUrl, "https://www.bilibili.com/toy/green-hell-web/index.html");
  assert.equal(data.meta.canonicalGameWikiUrl, "https://www.bilibili.com/toy/canopy-survival-wiki/index.html");
});
