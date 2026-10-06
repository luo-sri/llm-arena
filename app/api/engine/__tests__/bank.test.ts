import { describe, it, expect } from "vitest";
import { BUILTIN_BANK, computeBankHash } from "../bank";
import { CATEGORIES, SCORING_TYPES } from "../../../contracts/eval";

describe("内置公开题库", () => {
  it("覆盖全部 9 个维度", () => {
    for (const c of CATEGORIES) {
      const n = BUILTIN_BANK.filter((q) => q.category === c.key).length;
      expect(n, `维度 ${c.name} 题量`).toBeGreaterThanOrEqual(3);
    }
  });

  it("所有题目的判分类型合法且题干非空、评分标准公开", () => {
    const types = new Set(SCORING_TYPES.map((s) => s.key));
    for (const q of BUILTIN_BANK) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(types.has(q.scoringType as (typeof SCORING_TYPES)[number]["key"])).toBe(true);
      expect(q.weight).toBeGreaterThan(0);
      expect(q.rubric, `题目「${q.prompt.slice(0, 20)}」缺少公开评分标准`).toBeTruthy();
    }
  });

  it("规则判分题必须有参考答案或判分配置", () => {
    for (const q of BUILTIN_BANK) {
      if (q.scoringType === "judge") continue;
      const hasExpected = !!q.expectedAnswer;
      const hasConfig = !!q.scoringConfig && Object.keys(q.scoringConfig).length > 0;
      expect(hasExpected || hasConfig, `题目「${q.prompt.slice(0, 20)}」`).toBe(true);
    }
  });

  it("题库哈希：内容稳定哈希一致，内容变动哈希改变", () => {
    const h1 = computeBankHash(BUILTIN_BANK);
    const h2 = computeBankHash(BUILTIN_BANK);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
    const mutated = BUILTIN_BANK.map((q) => ({ ...q }));
    mutated[0] = { ...mutated[0], prompt: `${mutated[0].prompt}（改）` };
    expect(computeBankHash(mutated)).not.toBe(h1);
  });

  it("题库规模与难度：题量 ≥ 120，且 L4/L5 高难题占比 ≥ 60%", () => {
    expect(BUILTIN_BANK.length).toBeGreaterThanOrEqual(120);
    const hard = BUILTIN_BANK.filter((q) => q.difficulty >= 4).length;
    expect(hard / BUILTIN_BANK.length).toBeGreaterThanOrEqual(0.6);
  });

  it("code_exec 题必须配置 expectedOutput 与 language", () => {
    for (const q of BUILTIN_BANK.filter((q) => q.scoringType === "code_exec")) {
      const cfg = q.scoringConfig as { expectedOutput?: string; language?: string } | null;
      expect(cfg?.expectedOutput, `代码题「${q.prompt.slice(0, 20)}」缺少 expectedOutput`).toBeTruthy();
      expect(cfg?.language).toBeTruthy();
    }
  });

  it("json_schema 题必须配置非空 checks 且每项含 kind", () => {
    for (const q of BUILTIN_BANK.filter((q) => q.scoringType === "json_schema")) {
      const cfg = q.scoringConfig as { checks?: Array<{ kind?: string }> } | null;
      expect(cfg?.checks?.length ?? 0, `结构题「${q.prompt.slice(0, 20)}」缺少 checks`).toBeGreaterThan(0);
      for (const c of cfg?.checks ?? []) expect(c.kind).toBeTruthy();
    }
  });

  it("numeric 题的参考答案必须能提取出数值", () => {
    for (const q of BUILTIN_BANK.filter((q) => q.scoringType === "numeric")) {
      expect(q.expectedAnswer, `数值题「${q.prompt.slice(0, 20)}」缺少参考答案`).toBeTruthy();
      expect(/-?\d/.test(q.expectedAnswer ?? ""), `数值题「${q.prompt.slice(0, 20)}」参考答案无数值`).toBe(true);
    }
  });

  it("keywords 结构约束自洽：长度下限不大于上限", () => {
    for (const q of BUILTIN_BANK.filter((q) => q.scoringType === "keywords")) {
      const cfg = q.scoringConfig as { minLength?: number; maxLength?: number; minChars?: number; maxChars?: number } | null;
      const min = cfg?.minLength ?? cfg?.minChars;
      const max = cfg?.maxLength ?? cfg?.maxChars;
      if (min != null && max != null) {
        expect(min, `题目「${q.prompt.slice(0, 20)}」长度约束上下限颠倒`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("题干与评分标准无内部冲突标记（不得残留自问自答式草稿）", () => {
    for (const q of BUILTIN_BANK) {
      expect(q.rubric ?? "", `题目「${q.prompt.slice(0, 20)}」评分标准含未清理的草稿标记`).not.toContain("？不——");
    }
  });
});
