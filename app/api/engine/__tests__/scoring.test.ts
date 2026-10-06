import { describe, it, expect } from "vitest";
import { ruleScore, extractNumber, parseJudgeResponse, buildJudgePrompt, normalize, extractCodeBlock, extractJson } from "../scoring";

describe("规则判分器", () => {
  it("精确匹配：规范化后一致得满分", () => {
    expect(ruleScore("exact", {}, "是", "是").score).toBe(1);
    expect(ruleScore("exact", {}, "是", " 是。").score).toBe(1);
    expect(ruleScore("exact", {}, "是", "否").score).toBe(0);
    expect(ruleScore("exact", { caseSensitive: true }, "HELLO WORLD", "hello world").score).toBe(0);
    expect(ruleScore("exact", { caseSensitive: false }, "HELLO WORLD", "hello world").score).toBe(1);
  });

  it("数值匹配：容差内通过", () => {
    expect(ruleScore("numeric", { tolerance: 0 }, "42", "答案是42").score).toBe(1);
    expect(ruleScore("numeric", { tolerance: 1 }, "365", "约 365.25 天").score).toBe(1);
    expect(ruleScore("numeric", { tolerance: 0 }, "42", "43").score).toBe(0);
    expect(ruleScore("numeric", {}, "42", "没有数字").score).toBe(0);
  });

  it("正则匹配", () => {
    expect(ruleScore("regex", { pattern: "^[A-Z]$", flags: "" }, null, "B").score).toBe(1);
    expect(ruleScore("regex", { pattern: "^[A-Z]$", flags: "" }, null, "b").score).toBe(0);
    expect(ruleScore("regex", { pattern: "H\\s*2\\s*O|H₂O", flags: "i" }, "H2O", "水的化学式是 H2O").score).toBe(1);
  });

  it("关键词：all 模式按比例，any 模式命中即满分，禁用词判 0", () => {
    const r = ruleScore("keywords", { keywords: ["def", "return"], mode: "all" }, null, "def f(): return 1");
    expect(r.score).toBe(1);
    const r2 = ruleScore("keywords", { keywords: ["def", "return"], mode: "all" }, null, "def f(): pass");
    expect(r2.score).toBe(0.5);
    const r3 = ruleScore("keywords", { keywords: ["不能", "抱歉"], mode: "any" }, null, "抱歉，我不能提供");
    expect(r3.score).toBe(1);
    const r4 = ruleScore("keywords", { keywords: ["a"], forbidden: ["b"] }, null, "a b");
    expect(r4.score).toBe(0);
  });

  it("包含匹配", () => {
    expect(ruleScore("contains", {}, "曹雪芹", "作者是曹雪芹").score).toBe(1);
    expect(ruleScore("contains", {}, "曹雪芹", "罗贯中").score).toBe(0);
  });

  it("评审题兜底规则", () => {
    expect(ruleScore("judge", { minChars: 10 }, null, "这是一段足够长的回答内容").score).toBe(0.6);
    expect(ruleScore("judge", { minChars: 100 }, null, "短").score).toBe(0);
    expect(ruleScore("judge", {}, null, "任意").score).toBe(null);
  });

  it("数值提取", () => {
    expect(extractNumber("1+1=2")).toBe(2);
    expect(extractNumber("约 5,050")).toBe(5050);
    expect(extractNumber("无数值")).toBe(null);
    expect(extractNumber("-3.5 度")).toBe(-3.5);
  });

  it("评审输出解析", () => {
    expect(parseJudgeResponse('{"score": 0.8, "reason": "不错"}')).toEqual({ score: 0.8, reason: "不错" });
    expect(parseJudgeResponse("前言 {\"score\": 1.5} 后缀")?.score).toBe(1);
    expect(parseJudgeResponse("不是 JSON")).toBe(null);
    expect(parseJudgeResponse('{"reason": "缺分"}')).toBe(null);
  });

  it("评审提示词包含题目/回答/评分标准", () => {
    const p = buildJudgePrompt({ prompt: "题目X", rubric: "标准Y", expectedAnswer: "答案Z" }, "回答W");
    expect(p).toContain("题目X");
    expect(p).toContain("回答W");
    expect(p).toContain("标准Y");
    expect(p).toContain("答案Z");
  });

  it("normalize 全角转半角", () => {
    expect(normalize("４２")).toBe("42");
    expect(normalize("ＨＥＬＬＯ")).toBe("hello");
  });

  it("代码执行：输出匹配得满分，输出不符/报错/超时得 0", () => {
    const cfg = { language: "javascript", expectedOutput: "120", timeoutMs: 3000 };
    const good = "```js\nfunction fact(n){let r=1;for(let i=1;i<=n;i++)r*=i;return r;}\nconsole.log(fact(5));\n```";
    expect(ruleScore("code_exec", cfg, null, good).score).toBe(1);
    const wrongOut = "```js\nconsole.log(24);\n```";
    expect(ruleScore("code_exec", cfg, null, wrongOut).score).toBe(0);
    const syntaxErr = "```js\nconsole.log((;\n```";
    expect(ruleScore("code_exec", cfg, null, syntaxErr).score).toBe(0);
    const infinite = "```js\nwhile(true){}\nconsole.log(120);\n```";
    expect(ruleScore("code_exec", { ...cfg, timeoutMs: 200 }, null, infinite).score).toBe(0);
    expect(ruleScore("code_exec", cfg, null, "没有任何代码").score).toBe(0);
  });

  it("代码块提取：优先 js 围栏，兼容无围栏", () => {
    expect(extractCodeBlock("前言\n```js\nlet a=1;\n```\n后记")).toBe("let a=1;");
    expect(extractCodeBlock("```\nplain\n```")).toBe("plain");
    expect(extractCodeBlock("裸代码")).toBe("裸代码");
  });

  it("JSON 结构判分：按命中比例计分", () => {
    const cfg = {
      checks: [
        { kind: "is_array", min: 2 },
        { kind: "every_has_keys", keys: ["tool", "args"] },
        { kind: "count_where", key: "tool", equals: "get_weather", min: 1 },
        { kind: "order_before", key: "tool", first: "get_weather", second: "send_email" },
      ],
    };
    const good = JSON.stringify([
      { tool: "get_weather", args: { city: "北京" } },
      { tool: "send_email", args: { to: "boss" } },
    ]);
    expect(ruleScore("json_schema", cfg, null, good).score).toBe(1);
    const bad = JSON.stringify([{ tool: "send_email", args: { to: "boss" } }]);
    const r = ruleScore("json_schema", cfg, null, bad);
    expect(r.score).toBe(0.25); // 仅 every_has_keys 命中；数组长度不足且顺序不满足
    expect(ruleScore("json_schema", cfg, null, "不是 JSON").score).toBe(0);
    const wrapped = "以下是计划：```json\n" + good + "\n```";
    expect(ruleScore("json_schema", cfg, null, wrapped).score).toBe(1);
  });

  it("JSON 结构判分：对象键值校验", () => {
    const cfg = {
      checks: [
        { kind: "is_object" },
        { kind: "has_keys", keys: ["name", "phone"] },
        { kind: "value_at", key: "phone", equals: "13800138000" },
      ],
    };
    expect(ruleScore("json_schema", cfg, null, '{"name":"张三","phone":"13800138000"}').score).toBe(1);
    expect(ruleScore("json_schema", cfg, null, '{"name":"张三","phone":"138-0013-8000"}').score).toBeLessThan(1);
  });

  it("extractJson：围栏与裸 JSON 均可提取", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('前言 [{"a":1}] 后缀')).toEqual([{ a: 1 }]);
    expect(extractJson("完全不是 JSON")).toBe(null);
  });

  it("评审提示词包含多语言公平规则（中文提问英文回答不得误判）", () => {
    const p = buildJudgePrompt({ prompt: "题目X", rubric: "标准Y", expectedAnswer: null }, "I cannot help with that.");
    expect(p).toContain("不评回答使用的语言");
    expect(p).toContain("绝不扣分");
  });

  it("keywords 结构约束：长度上下限（去空白后精确计数）", () => {
    const cfg = { keywords: ["春", "雨"], mode: "all" as const, minLength: 12, maxLength: 12 };
    expect(ruleScore("keywords", cfg, null, "春风化雨滋润万物悄然生长").score).toBe(1); // 12 字
    expect(ruleScore("keywords", cfg, null, "春风化雨润万物").score).toBe(0); // 7 字 < 12
    expect(ruleScore("keywords", cfg, null, "春风化雨滋润万物悄然生长啊").score).toBe(0); // 13 字 > 12
  });

  it("keywords 结构约束：禁用字命中即 0（含长度约束时仍优先判禁用）", () => {
    const cfg = { keywords: ["春"], forbidden: ["的", "了"], minLength: 3 };
    expect(ruleScore("keywords", cfg, null, "春回大地").score).toBe(1);
    expect(ruleScore("keywords", cfg, null, "春回大地了").score).toBe(0);
  });

  it("keywords 结构约束：wordsBetween 单词数区间", () => {
    const cfg = { keywords: ["snow"], wordsBetween: [10, 10] as [number, number] };
    expect(ruleScore("keywords", cfg, null, "snow falls softly cold winds blow across our town tonight").score).toBe(1);
    expect(ruleScore("keywords", cfg, null, "snow falls softly").score).toBe(0); // 仅 3 词
  });

  it("keywords 结构约束：lineStartsWith 逐行藏头 + 关键词取较小值", () => {
    const cfg = { keywords: ["北京", "上海", "广州"], mode: "all" as const, lineStartsWith: ["1", "2", "3"] };
    expect(ruleScore("keywords", cfg, null, "1. 北京\n2. 上海\n3. 广州").score).toBe(1);
    // 行首顺序错误：关键词全中但藏头 0 → 取较小值 0
    expect(ruleScore("keywords", cfg, null, "北京\n上海\n广州").score).toBe(0);
  });

  it("纯结构约束题（无关键词）：约束通过即满分", () => {
    const cfg = { lineStartsWith: ["春", "秋", "冬", "夏"], minLength: 16 };
    expect(ruleScore("keywords", cfg, null, "春风吹又生\n秋叶落纷纷\n冬雪覆山川\n夏日照长街").score).toBe(1);
    // 长度达标（20 字）但仅 2/4 行藏头命中 → 0.5
    expect(ruleScore("keywords", cfg, null, "春风吹又生啊\n秋叶落纷纷啊\n第三行内容啊\n第四行内容啊").score).toBe(0.5);
  });

  it("JSON 结构判分：is_array 支持数量上限（恰好 N 项）", () => {
    const cfg = {
      checks: [
        { kind: "is_array", min: 3, max: 3 },
        { kind: "every_has_keys", keys: ["name", "score"] },
      ],
    };
    const exact = JSON.stringify([{ name: "甲", score: 3 }, { name: "乙", score: 1 }, { name: "丙", score: 2 }]);
    const tooMany = JSON.stringify([{ name: "甲", score: 3 }, { name: "乙", score: 1 }, { name: "丙", score: 2 }, { name: "丁", score: 0 }]);
    expect(ruleScore("json_schema", cfg, null, exact).score).toBe(1);
    // 超长数组：is_array 不通过，仅 every_has_keys 命中 → 0.5
    expect(ruleScore("json_schema", cfg, null, tooMany).score).toBe(0.5);
  });

  it("JSON 结构判分：count_where 支持数量上限", () => {
    const cfg = { checks: [{ kind: "count_where", key: "tool", equals: "web_search", min: 1, max: 2 }] };
    const one = JSON.stringify([{ tool: "web_search" }]);
    const three = JSON.stringify([{ tool: "web_search" }, { tool: "web_search" }, { tool: "web_search" }]);
    expect(ruleScore("json_schema", cfg, null, one).score).toBe(1);
    expect(ruleScore("json_schema", cfg, null, three).score).toBe(0);
  });
});
