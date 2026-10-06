import { describe, it, expect } from "vitest";
import { selectQuestions, describeLevels, type SelectableQuestion } from "../selection";
import { buildPresetSuites } from "../../../db/presets";
import { CATEGORIES, type SuiteConfig } from "../../../contracts/eval";

type Q = SelectableQuestion & { tag: string };

function q(id: number, category: string, difficulty: number): Q {
  return { id, category, difficulty, tag: `${category}-${difficulty}-${id}` };
}

// 逻辑维度：L1~L5 各 2 题；数学维度：L4/L5 各 1 题；其余维度各 1 题 L3
const BANK: Q[] = [
  ...[1, 2, 3, 4, 5].flatMap((lv) => [q(lv * 10 + 1, "logic", lv), q(lv * 10 + 2, "logic", lv)]),
  q(401, "math", 4),
  q(501, "math", 5),
  q(301, "coding", 3),
];

function cfg(patch: Partial<SuiteConfig>): Pick<SuiteConfig, "categories" | "levels"> {
  const base = {
    categories: Object.fromEntries(
      CATEGORIES.map((c) => [c.key, { enabled: true, count: 0, weight: 1 }]),
    ),
    levels: [1, 2, 3, 4, 5],
  };
  return { ...base, ...patch } as Pick<SuiteConfig, "categories" | "levels">;
}

describe("selectQuestions 难度分层", () => {
  it("仅抽取指定难度级别的题目", () => {
    const picked = selectQuestions(BANK, cfg({ levels: [4, 5] }), 42);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((p) => p.difficulty === 4 || p.difficulty === 5)).toBe(true);
    // 逻辑 L1~L3 不应出现
    expect(picked.some((p) => p.difficulty <= 3)).toBe(false);
  });

  it("levels 缺省或空数组 = 全部难度", () => {
    const undef = selectQuestions(BANK, { ...cfg({}), levels: undefined }, 42);
    const empty = selectQuestions(BANK, { ...cfg({}), levels: [] }, 42);
    expect(undef.length).toBe(BANK.length);
    expect(empty.length).toBe(BANK.length);
  });

  it("难度分层 + 题量上限叠加生效", () => {
    const c = cfg({ levels: [4, 5] });
    c.categories.logic = { enabled: true, count: 3, weight: 1 };
    const picked = selectQuestions(BANK, c, 42);
    const logic = picked.filter((p) => p.category === "logic");
    expect(logic.length).toBe(3);
    expect(logic.every((p) => p.difficulty === 4 || p.difficulty === 5)).toBe(true);
  });

  it("停用维度不参与抽题", () => {
    const c = cfg({ levels: [1, 2, 3, 4, 5] });
    c.categories.logic = { enabled: false, count: 0, weight: 1 };
    const picked = selectQuestions(BANK, c, 42);
    expect(picked.some((p) => p.category === "logic")).toBe(false);
  });

  it("同一种子 → 同一题集（可复现）", () => {
    const c = cfg({ levels: [1, 2, 3, 4, 5] });
    c.categories.logic = { enabled: true, count: 3, weight: 1 };
    const a = selectQuestions(BANK, c, 7).map((p) => p.id);
    const b = selectQuestions(BANK, c, 7).map((p) => p.id);
    expect(a).toEqual(b);
  });

  it("难度过高导致无题时返回空集（由调用方报错）", () => {
    const c = cfg({ levels: [5] });
    c.categories.logic = { enabled: false, count: 0, weight: 1 };
    c.categories.math = { enabled: false, count: 0, weight: 1 };
    // 仅 coding（L3）启用，却要求 L5 → 空
    const picked = selectQuestions(BANK, c, 42);
    expect(picked.length).toBe(0);
  });
});

describe("describeLevels", () => {
  it("全部或空 = 全部 1~5 级", () => {
    expect(describeLevels(undefined)).toBe("全部 1~5 级");
    expect(describeLevels([])).toBe("全部 1~5 级");
    expect(describeLevels([1, 2, 3, 4, 5])).toBe("全部 1~5 级");
  });
  it("子集按升序展示", () => {
    expect(describeLevels([5, 4])).toBe("4/5 级");
  });
});

describe("内置专业套件差异化", () => {
  const presets = buildPresetSuites(1);

  it("至少 6 个专业套件", () => {
    expect(presets.length).toBeGreaterThanOrEqual(6);
  });

  it("各套件在「维度集合 / 难度分层 / 参数 / 判分通道」上存在实质差异（而非仅描述不同）", () => {
    const sig = (p: (typeof presets)[number]) => {
      const c = p.config;
      const enabled = Object.entries(c.categories)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k)
        .sort()
        .join(",");
      const weights = Object.entries(c.categories)
        .filter(([, v]) => v.enabled && v.weight !== 1)
        .map(([k, v]) => `${k}=${v.weight}`)
        .sort()
        .join(",");
      const levels = (c.levels ?? []).slice().sort((a, b) => a - b).join(",");
      const params = `${c.params.repeatCount}|${c.params.concurrency}|${c.params.maxTokens}|${c.params.timeoutMs}`;
      return `${enabled}#${weights}#${levels}#${params}#${c.judgeEnabled}`;
    };
    const sigs = presets.map(sig);
    expect(new Set(sigs).size).toBe(presets.length);
  });

  it("启用评审的套件均绑定评审模型（离线旗舰模型，不消耗额度）", () => {
    for (const p of presets) {
      if (p.config.judgeEnabled) expect(p.config.judgeModelId).toBe(1);
    }
  });

  it("难度分层确实存在差异（冒烟测试含基础题、地狱专项仅 L4/L5）", () => {
    const smoke = presets.find((p) => p.name === "极速冒烟测试")!;
    const hell = presets.find((p) => p.name === "地狱难度专项")!;
    expect(smoke.config.levels).toEqual([1, 2, 3]);
    expect(hell.config.levels).toEqual([4, 5]);
  });
});
