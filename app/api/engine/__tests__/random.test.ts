import { describe, it, expect } from "vitest";
import { seededShuffle, mulberry32, stableHash } from "../random";
import { callModel } from "../provider";
import { DEFAULT_PARAMS } from "../../../contracts/eval";
import type { Model } from "../../../db/schema";

describe("公平性：确定性随机", () => {
  const arr = Array.from({ length: 36 }, (_, i) => i + 1);

  it("同一种子产生完全相同的题目顺序", () => {
    expect(seededShuffle(arr, 42)).toEqual(seededShuffle(arr, 42));
  });

  it("不同种子产生不同顺序，且为原数组的排列", () => {
    const a = seededShuffle(arr, 42);
    const b = seededShuffle(arr, 43);
    expect(a).not.toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(arr);
    expect([...b].sort((x, y) => x - y)).toEqual(arr);
  });

  it("mulberry32 输出在 [0,1) 且确定", () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(r2());
    }
  });

  it("stableHash 稳定", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
  });
});

describe("模拟模型：行为确定性（相同输入相同输出，可复现）", () => {
  const mockModel = {
    id: 1, groupId: null, name: "mock", provider: "mock", baseUrl: "builtin://mock",
    apiKey: "", modelId: "mock-test", inputPrice: 0, outputPrice: 0, enabled: true,
    notes: null, lastTestStatus: null, lastTestLatencyMs: null, lastTestError: null,
    lastTestedAt: null, createdAt: new Date(), updatedAt: new Date(),
  } satisfies Model;

  const question = { prompt: "1+1=?", expectedAnswer: "2", scoringType: "numeric", scoringConfig: null };

  it("同一模型同一题同一轮次结果一致", async () => {
    const a = await callModel(mockModel, question, DEFAULT_PARAMS, 0);
    const b = await callModel(mockModel, question, DEFAULT_PARAMS, 0);
    expect(a.text).toBe(b.text);
    expect(a.latencyMs).toBe(b.latencyMs);
  });

  it("存在能答对参考值的模拟模型（覆盖正确分支）", async () => {
    let sawCorrect = false;
    for (let i = 0; i < 20; i++) {
      const m = { ...mockModel, modelId: `mock-${i}` };
      const r = await callModel(m, question, DEFAULT_PARAMS, 0);
      if (r.text === "2") { sawCorrect = true; break; }
    }
    expect(sawCorrect).toBe(true);
  });
});
