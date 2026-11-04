import {
  APP_AUTHOR,
  APP_NAME,
  APP_NAME_EN,
  GITHUB_ICON_PATH,
  REPORT_EXTRA_DISCLAIMER,
  REPO_NAME,
  REPO_URL,
} from "./site";

/** 报告页脚免责声明之外，页头也需要公开展示的来源信息 */

interface Summary {
  rank: number;
  modelId: number;
  modelName: string;
  total: number;
  categories: Record<string, number>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  repeatStd: number;
  successRate: number;
  totalTokens: number;
  estimatedCost: number;
  difficultyScores?: Record<string, number>;
  totalCI?: [number, number] | null;
}

interface ArenaRating {
  modelName: string;
  rating: number;
  ciLow: number;
  ciHigh: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
}

interface ArenaCell {
  modelAName: string;
  modelBName: string;
  aWins: number;
  bWins: number;
  ties: number;
  total: number;
}

interface Arena {
  total: number;
  methods: Record<string, number>;
  ratings: ArenaRating[];
  matrix: ArenaCell[];
}

interface ReportItem {
  id: number;
  modelName: string;
  repeatIndex: number;
  seq: number;
  status: string;
  category: string;
  difficulty: number;
  prompt: string;
  expectedAnswer: string | null;
  scoringType: string;
  rubric: string | null;
  responseText: string | null;
  latencyMs: number | null;
  ruleScore: number | null;
  judgeScore: number | null;
  finalScore: number | null;
  reviewScore: number | null;
  reviewNote: string | null;
  needsReview: boolean;
  error: string | null;
  retryCount: number;
}

export interface ReportPayload {
  title: string;
  createdAt: string | Date;
  shareId: string;
  run: {
    id: number;
    name: string;
    status: string;
    seed: number;
    bankVersion: string;
    bankHash: string;
    startedAt: string | Date | null;
    finishedAt: string | Date | null;
    paramSnapshot: { params?: Record<string, unknown>; judgeEnabled?: boolean; judgeOnly?: boolean };
    totalItems: number;
    doneItems: number;
    failedItems: number;
  };
  summaries: Summary[];
  arena: Arena;
  categoryNames: Record<string, { name: string; color: string }>;
  items: ReportItem[];
  disclaimer: string;
}

const SERIES = [
  "#1f1f23",
  "#0d8a6e",
  "#b45309",
  "#2563eb",
  "#6d28d9",
  "#be185d",
  "#8a8a92",
  "#b8b8be",
  "#c8c8ce",
  "#4dd0a6",
];

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * 能力维度雷达（与「评测任务 → 结果可视化 → 维度雷达图」一致的交互）：
 * - 尺寸收敛为 520×300 的小卡片，避免在报告里占据过大版面；
 * - 鼠标悬停顶点实时显示「模型 / 维度 / 分数」；
 * - 「显示模型」下拉支持逐个勾选、全选、清空，图表与图例同步显隐；
 * - 全部为内联 SVG + 原生 JS，不依赖任何外部资源，离线可交互。
 */
function radarBlock(d: ReportPayload): string {
  const catKeys = Object.keys(d.categoryNames).filter((k) =>
    d.summaries.some((s) => s.categories[k] !== undefined),
  );
  if (d.summaries.length === 0 || catKeys.length < 3) {
    return `<p class="muted">该报告维度不足 3 个，暂不绘制雷达图。</p>`;
  }

  const cx = 260;
  const cy = 150;
  const R = 102;
  const n = catKeys.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(100, value)) / 100) * R;
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;
  };
  const ring = (pct: number) =>
    catKeys
      .map((_, i) => {
        const [x, y] = point(i, pct);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const grid = [25, 50, 75, 100]
    .map((p) => `<polygon points="${ring(p)}" fill="none" stroke="var(--grid)" stroke-width="1" />`)
    .join("");

  const axes = catKeys
    .map((k, i) => {
      const [x, y] = point(i, 100);
      const [lx, ly] = point(i, 120);
      const anchor = Math.cos(angle(i)) > 0.3 ? "start" : Math.cos(angle(i)) < -0.3 ? "end" : "middle";
      return (
        `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1" />` +
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="${anchor}" dominant-baseline="middle">${esc(d.categoryNames[k]?.name ?? k)}</text>`
      );
    })
    .join("");

  const series = d.summaries
    .map((s, idx) => {
      const color = SERIES[idx % SERIES.length];
      const pts = catKeys
        .map((k, i) => {
          const [x, y] = point(i, s.categories[k] ?? 0);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      const nodes = catKeys
        .map((k, i) => {
          const value = s.categories[k] ?? 0;
          const [x, y] = point(i, value);
          const label = d.categoryNames[k]?.name ?? k;
          return (
            `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="transparent" pointer-events="all" data-model="${esc(s.modelName)}" data-dim="${esc(label)}" data-value="${value.toFixed(1)}" />` +
            `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}" pointer-events="none" />`
          );
        })
        .join("");
      return `<g data-radar-series="${idx}"><polygon points="${pts}" fill="${color}" fill-opacity="0.10" stroke="${color}" stroke-width="1.6" />${nodes}</g>`;
    })
    .join("");

  const legend = d.summaries
    .map((s, idx) => {
      const color = SERIES[idx % SERIES.length];
      return `<span class="legend-item" data-radar-legend="${idx}"><i style="background:${color}"></i>${esc(s.modelName)}</span>`;
    })
    .join("");

  const picker = `
<details class="picker">
  <summary>显示模型（<span id="radar-shown">${d.summaries.length}</span>/<span id="radar-total">${d.summaries.length}</span>）</summary>
  <div class="picker-panel">
    <div class="picker-actions">
      <button type="button" onclick="radarAll(true)">全选</button>
      <button type="button" onclick="radarAll(false)">清空</button>
    </div>
    <div class="picker-list">
      ${d.summaries
        .map(
          (s, idx) =>
            `<label><input type="checkbox" checked data-radar-model="${idx}" onchange="radarToggle(${idx}, this.checked)" /><i style="background:${SERIES[idx % SERIES.length]}"></i><span>${esc(s.modelName)}</span></label>`,
        )
        .join("")}
    </div>
  </div>
</details>`;

  return `
<div class="chart-card">
  <div class="chart-head">
    <div class="chart-title">维度雷达图</div>
    ${picker}
  </div>
  <div class="radar-box" id="radar-box">
    <svg viewBox="0 0 520 300" role="img" aria-label="能力维度雷达图">
      ${grid}${axes}${series}
    </svg>
    <div id="radar-tip" class="radar-tip"></div>
  </div>
  <div class="legend">${legend}</div>
</div>
<script>
(function () {
  var boxes = document.querySelectorAll('input[data-radar-model]');
  function radarUpdate() {
    var shown = 0;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) shown++;
    var s = document.getElementById('radar-shown');
    var t = document.getElementById('radar-total');
    if (s) s.textContent = shown;
    if (t) t.textContent = boxes.length;
  }
  window.radarToggle = function (i, on) {
    var g = document.querySelector('[data-radar-series="' + i + '"]');
    if (g) g.style.display = on ? '' : 'none';
    var lg = document.querySelector('[data-radar-legend="' + i + '"]');
    if (lg) lg.style.display = on ? '' : 'none';
    radarUpdate();
  };
  window.radarAll = function (on) {
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = on;
      window.radarToggle(boxes[i].getAttribute('data-radar-model'), on);
    }
  };
  radarUpdate();

  var box = document.getElementById('radar-box');
  var tip = document.getElementById('radar-tip');
  if (box && tip) {
    box.addEventListener('mousemove', function (e) {
      var target = e.target;
      while (target && target !== box && !(target.getAttribute && target.getAttribute('data-value'))) {
        target = target.parentNode;
      }
      if (!target || target === box || !target.getAttribute) {
        tip.style.display = 'none';
        return;
      }
      var model = target.getAttribute('data-model') || '';
      var dim = target.getAttribute('data-dim') || '';
      var value = target.getAttribute('data-value') || '';
      tip.textContent = '';
      var nameEl = document.createElement('b');
      nameEl.textContent = model;
      tip.appendChild(nameEl);
      tip.appendChild(document.createElement('br'));
      tip.appendChild(document.createTextNode(dim + '：'));
      var valueEl = document.createElement('b');
      valueEl.textContent = value;
      tip.appendChild(valueEl);
      var rect = box.getBoundingClientRect();
      var left = e.clientX - rect.left + 12;
      var top = e.clientY - rect.top + 12;
      if (left + 150 > rect.width) left = left - 160;
      if (top + 44 > rect.height) top = top - 52;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.display = 'block';
    });
    box.addEventListener('mouseleave', function () {
      tip.style.display = 'none';
    });
  }
})();
</script>`;
}

function summaryTable(d: ReportPayload): string {
  const catKeys = Object.keys(d.categoryNames).filter((k) =>
    d.summaries.some((s) => s.categories[k] !== undefined),
  );
  return `<div class="scroll">
<table>
  <thead>
    <tr>
      <th class="w-8">#</th>
      <th>模型</th>
      <th class="right">总分</th>
      ${catKeys.map((k) => `<th class="right">${esc(d.categoryNames[k]?.name ?? k)}</th>`).join("")}
      <th class="right">成功率</th>
      <th class="right">平均时延</th>
      <th class="right">P95 时延</th>
      <th class="right">稳定性</th>
      <th class="right">Tokens</th>
      <th class="right">估算成本</th>
    </tr>
  </thead>
  <tbody>
    ${d.summaries
      .map(
        (s) => `<tr>
      <td class="right mono accent">${s.rank}</td>
      <td>${esc(s.modelName)}</td>
      <td class="right mono"><b>${num(s.total, 1)}</b></td>
      ${catKeys.map((k) => `<td class="right mono">${num(s.categories[k], 1)}</td>`).join("")}
      <td class="right mono">${(s.successRate * 100).toFixed(1)}%</td>
      <td class="right mono">${fmtMs(s.avgLatencyMs)}</td>
      <td class="right mono">${fmtMs(s.p95LatencyMs)}</td>
      <td class="right mono">${num(s.repeatStd, 3)}</td>
      <td class="right mono">${s.totalTokens.toLocaleString("zh-CN")}</td>
      <td class="right mono">$${num(s.estimatedCost, 4)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>
</div>`;
}

function difficultyTable(d: ReportPayload): string {
  const levels = [...new Set(d.summaries.flatMap((s) => Object.keys(s.difficultyScores ?? {}).map(Number)))].sort(
    (a, b) => a - b,
  );
  if (levels.length === 0) return "";
  return `<h2>难度分层得分</h2>
<div class="scroll">
<table>
  <thead><tr><th>模型</th>${levels.map((lv) => `<th class="right">L${lv}</th>`).join("")}</tr></thead>
  <tbody>
    ${d.summaries
      .map(
        (s) => `<tr><td>${esc(s.modelName)}</td>${levels
          .map((lv) => `<td class="right mono">${num(s.difficultyScores?.[String(lv)], 1)}</td>`)
          .join("")}</tr>`,
      )
      .join("")}
  </tbody>
</table>
</div>`;
}

function arenaTable(d: ReportPayload): string {
  if (!d.arena || d.arena.ratings.length < 2) return "";
  const methods = Object.entries(d.arena.methods ?? {})
    .map(([m, n]) => `${m === "ai_judge" ? "AI 盲选裁决" : "分差判定"} ${n} 场`)
    .join(" · ");
  return `<h2>竞技场评级（Bradley-Terry）</h2>
<p class="muted">共 ${d.arena.total} 场对战${methods ? `（${esc(methods)}）` : ""}。评级 = 1000 + 400·log₁₀(强度比)，置信区间经 500 次 bootstrap 重采样估计。</p>
<div class="scroll">
<table>
  <thead><tr><th class="w-8">#</th><th>模型</th><th class="right">评级</th><th class="right">95% CI</th><th class="right">胜/负/平</th><th class="right">胜率</th></tr></thead>
  <tbody>
    ${d.arena.ratings
      .map(
        (r, i) => `<tr>
      <td class="right mono accent">${i + 1}</td>
      <td>${esc(r.modelName)}</td>
      <td class="right mono"><b>${r.rating.toFixed(1)}</b></td>
      <td class="right mono muted">${r.ciLow.toFixed(0)} ~ ${r.ciHigh.toFixed(0)}</td>
      <td class="right mono">${r.wins} / ${r.losses} / ${r.ties}</td>
      <td class="right mono">${(r.winRate * 100).toFixed(1)}%</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>
</div>`;
}

function itemDetails(d: ReportPayload): string {
  return d.items
    .map(
      (i) => `<details>
  <summary>
    <span class="mono muted">#${i.seq + 1}</span>
    <span class="item-model">${esc(i.modelName)}</span>
    <span class="chip">${esc(d.categoryNames[i.category]?.name ?? i.category)}</span>
    <span class="item-prompt">${esc(i.prompt)}</span>
    <span class="mono score">${num(i.finalScore)}</span>
  </summary>
  <div class="detail">
    <div class="kv"><span>题目</span><div class="pre">${esc(i.prompt)}</div></div>
    ${i.expectedAnswer ? `<div class="kv"><span>参考答案</span><div class="pre mono">${esc(i.expectedAnswer)}</div></div>` : ""}
    ${i.rubric ? `<div class="kv"><span>评分标准</span><div class="pre">${esc(i.rubric)}</div></div>` : ""}
    <div class="kv"><span>模型回答</span><div class="pre">${esc(i.responseText ?? i.error ?? "（无）")}</div></div>
    <div class="scores mono">
      规则 ${num(i.ruleScore)} · 评审 ${num(i.judgeScore)} · 最终 ${num(i.finalScore)}
      ${i.reviewScore !== null ? ` · 人工复核 ${num(i.reviewScore)}${i.reviewNote ? `（${esc(i.reviewNote)}）` : ""}` : ""}
      ${i.latencyMs !== null ? ` · ${fmtMs(i.latencyMs)}` : ""}
      ${i.retryCount > 0 ? ` · 重试 ${i.retryCount} 次` : ""}
    </div>
  </div>
</details>`,
    )
    .join("");
}

/**
 * 生成完全自包含的单文件 HTML 报告：
 * 内联样式、内联 SVG 图表、原生 <details> 折叠，不依赖任何外部资源与网络，离线也能正常浏览。
 */
export function buildReportHtml(d: ReportPayload): string {
  const cfg = d.run.paramSnapshot ?? {};
  const params = Object.entries(cfg.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  const judgeDesc = cfg.judgeOnly
    ? "AI 裁判（唯一评分）"
    : cfg.judgeEnabled
      ? "规则 + 模型评审（双通道）"
      : "规则判分";
  const generatedAt = fmtDateTime(new Date());

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.title)} · ${esc(APP_NAME)}</title>
<style>
:root{
  --bg:#ffffff;--card:#fafafa;--ink:#1f1f23;--muted:#6e6e76;--line:#e6e6ea;--grid:#ececef;
  --accent:#b45309;--chip:#f3f3f5;
}
@media (prefers-color-scheme: dark){
  :root{--bg:#111113;--card:#18181b;--ink:#f4f4f5;--muted:#a1a1aa;--line:#2c2c31;--grid:#26262b;--accent:#fbbf24;--chip:#232329;}
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6}
.page{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
a{color:inherit}
h1{font-size:24px;margin:14px 0 6px;letter-spacing:.01em}
h2{font-size:16px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
p{margin:8px 0}
.muted{color:var(--muted)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.right{text-align:right}
.w-8{width:40px}
.brand{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:14px 16px}
.brand-main{display:flex;align-items:center;gap:12px;min-width:260px}
.logo{width:38px;height:38px;border-radius:9px;background:var(--ink);color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;letter-spacing:.06em;flex:0 0 auto}
.brand-title{font-size:15px;font-weight:650;letter-spacing:.02em}
.brand-sub{font-size:11.5px;color:var(--muted);margin-top:2px}
.brand-meta{font-size:11.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px}
.brand-right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.repo{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;text-decoration:none;font-size:12px;background:var(--bg);transition:border-color .15s, transform .15s}
.repo:hover{border-color:var(--ink);transform:translateY(-1px)}
.repo svg{width:16px;height:16px;flex:0 0 auto}
.star-tip{font-size:11.5px;color:var(--muted)}
.star-tip b{color:var(--accent)}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 18px;margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:var(--card);font-size:12px;color:var(--muted)}
.meta-grid b{color:var(--ink);font-weight:600}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:26px 0 10px}
.toolbar button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:7px;padding:6px 12px;font-size:12px;cursor:pointer}
.toolbar button:hover{border-color:var(--ink)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:9px}
table{border-collapse:collapse;width:100%;min-width:720px;font-size:12px;background:var(--bg)}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--chip);font-weight:600;color:var(--muted)}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--card)}
.accent{color:var(--accent)}
.chart-card{max-width:700px;margin:0 auto;border:1px solid var(--line);border-radius:9px;background:var(--card);padding:10px 14px}
.chart-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.chart-title{font-size:13px;font-weight:600}
.picker{position:relative;border:none;margin:0;background:transparent}
.picker[open]{background:transparent}
.picker summary{padding:5px 9px;border:1px solid var(--line);border-radius:7px;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;background:var(--bg)}
.picker summary:before{content:"";display:none}
.picker summary::-webkit-details-marker{display:none}
.picker summary:hover{border-color:var(--ink)}
.picker-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:240px;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:8px}
.picker-actions{display:flex;justify-content:flex-end;gap:12px;padding:0 2px 6px;border-bottom:1px solid var(--line)}
.picker-actions button{border:none;background:none;color:var(--accent);cursor:pointer;padding:0;font-size:11px}
.picker-list{max-height:200px;overflow:auto;padding-top:4px}
.picker-list label{display:flex;align-items:center;gap:7px;padding:4px;border-radius:5px;font-size:11.5px;cursor:pointer}
.picker-list label:hover{background:var(--chip)}
.picker-list i{width:9px;height:9px;border-radius:2px;display:inline-block}
.radar-box{position:relative;max-width:500px;margin:0 auto}
.radar-box svg{width:100%;height:auto;display:block}
.radar-tip{position:absolute;display:none;z-index:40;pointer-events:none;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:5px 9px;font-size:11px;box-shadow:0 6px 18px rgba(0,0,0,.16);white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;padding:4px 8px 2px;font-size:12px;color:var(--muted)}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.legend-item i{width:10px;height:10px;border-radius:2px;display:inline-block}
details{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--card)}
details[open]{background:var(--bg)}
summary{cursor:pointer;padding:9px 12px;display:flex;align-items:center;gap:10px;font-size:12px;list-style:none}
summary::-webkit-details-marker{display:none}
summary:before{content:"▸";color:var(--muted);font-size:11px;transition:transform .15s}
details[open] summary:before{transform:rotate(90deg)}
.item-model{min-width:110px;font-weight:600}
.item-prompt{flex:1;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-prompt{min-width:0}
.score{font-weight:700;color:var(--accent)}
.chip{background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--muted);white-space:nowrap}
.detail{padding:4px 14px 12px;border-top:1px solid var(--line)}
.kv{display:flex;gap:10px;padding:5px 0}
.kv>span{width:70px;flex:0 0 auto;color:var(--muted);font-size:12px}
.kv>.pre{flex:1;white-space:pre-wrap;word-break:break-word;background:var(--chip);border-radius:6px;padding:8px 10px;font-size:12px;max-height:320px;overflow:auto}
.scores{color:var(--muted);padding-top:4px;font-size:11.5px}
footer{margin-top:44px;border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:11.5px;line-height:1.75}
footer .foot-links{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
footer a{color:var(--ink);text-decoration:none;border-bottom:1px dashed var(--line)}
@media print{
  body{background:#fff;color:#000}
  .toolbar{display:none}
  details{break-inside:avoid}
  .scroll{overflow:visible}
  table{min-width:0}
  a{color:#000}
}
@media (max-width:720px){
  .page{padding:16px 12px 40px}
  .brand-right{margin-left:0;align-items:flex-start}
  summary{flex-wrap:wrap}
  .item-prompt{flex-basis:100%;white-space:normal}
  .kv{flex-direction:column;gap:4px}
  .kv>span{width:auto}
}
</style>
</head>
<body>
<div class="page">
  <header class="brand">
    <div class="brand-main">
      <div class="logo">LA</div>
      <div>
        <div class="brand-title">${esc(APP_NAME)} · ${esc(APP_NAME_EN)}</div>
        <div class="brand-sub">本报告由开源评测工具「${esc(APP_NAME)}」自动生成</div>
        <div class="brand-meta">
          <span>作者：${esc(APP_AUTHOR)}</span>
          <span>本项目已开源，欢迎使用与监督</span>
        </div>
      </div>
    </div>
    <div class="brand-right">
      <a class="repo" href="${esc(REPO_URL)}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${GITHUB_ICON_PATH}" /></svg>
        ${esc(REPO_NAME)}
      </a>
      <div class="star-tip">如果这份报告帮到了你，欢迎去仓库点个 <b>Star ⭐</b></div>
    </div>
  </header>

  <h1>${esc(d.title)}</h1>
  <div class="meta-grid">
    <span>运行编号：<b>#${d.run.id}</b></span>
    <span>运行名称：<b>${esc(d.run.name)}</b></span>
    <span>状态：<b>${esc(d.run.status)}</b></span>
    <span>题库版本：<b class="mono">${esc(d.run.bankVersion)}</b></span>
    <span>题库哈希：<b class="mono">${esc(d.run.bankHash)}</b></span>
    <span>随机种子：<b class="mono">${d.run.seed}</b></span>
    <span>题目任务：<b>${d.run.doneItems}/${d.run.totalItems} 成功（失败 ${d.run.failedItems}）</b></span>
    <span>判分通道：<b>${esc(judgeDesc)}</b></span>
    <span>开始：<b>${esc(fmtDateTime(d.run.startedAt))}</b></span>
    <span>结束：<b>${esc(fmtDateTime(d.run.finishedAt))}</b></span>
    <span class="mono" style="grid-column:1/-1">参数快照：${esc(params || "—")}</span>
  </div>

  <div class="toolbar">
    <button type="button" onclick="toggleAll(true)">展开全部逐题明细</button>
    <button type="button" onclick="toggleAll(false)">收起全部</button>
  </div>

  <h2>模型排名</h2>
  ${summaryTable(d)}

  <h2>能力维度雷达</h2>
  ${radarBlock(d)}
  ${difficultyTable(d)}

  ${arenaTable(d)}

  <h2>逐题明细（${d.items.length} 条，全部公开）</h2>
  ${itemDetails(d)}

  <footer>
    <div>${esc(d.disclaimer)}</div>
    <div>${esc(REPORT_EXTRA_DISCLAIMER)}</div>
    <div class="foot-links">
      <span>生成工具：<a href="${esc(REPO_URL)}" target="_blank" rel="noopener noreferrer">${esc(APP_NAME)}（开源仓库 ${esc(REPO_NAME)}）</a></span>
      <span>作者：${esc(APP_AUTHOR)}</span>
      <span>报告导出时间：${esc(generatedAt)}</span>
      <span class="mono">share/${esc(d.shareId.slice(0, 8))}</span>
    </div>
  </footer>
</div>
<script>
function toggleAll(open) {
  var list = document.querySelectorAll('details:not(.picker)');
  for (var i = 0; i < list.length; i++) list[i].open = open;
}
window.addEventListener('beforeprint', function () { toggleAll(true); });
</script>
</body>
</html>`;
}
