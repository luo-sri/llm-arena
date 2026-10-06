import type { Model, Question } from "@db/schema";
import type { EvalParams } from "../../contracts/eval";
import { stableHash, mulberry32 } from "./random";
import { getMockSkill, getMockLatencyRange } from "./mockPresets";

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export class ProviderError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ProviderError";
    this.statusCode = statusCode;
  }
}

/**
 * 统一模型调用入口。
 * - openai：OpenAI 兼容协议（/chat/completions），支持自定义 baseUrl / key / modelId
 * - mock：内置模拟模型，无需密钥，行为完全确定性（同一模型+同一题+同一重复轮次结果一致），
 *         用于自检脚本与无密钥演示。
 */
export async function callModel(
  model: Model,
  question: Pick<Question, "prompt" | "expectedAnswer" | "scoringType" | "scoringConfig">,
  params: EvalParams,
  repeatIndex: number,
): Promise<ChatResult> {
  if (model.provider === "mock") {
    return callMock(model, question, params, repeatIndex);
  }
  return callOpenAICompat(model, question.prompt, params);
}

async function callOpenAICompat(
  model: Model,
  prompt: string,
  params: EvalParams,
): Promise<ChatResult> {
  const base = model.baseUrl.replace(/\/+$/, "");
  if (!base) throw new ProviderError("API 地址为空");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          ...(params.systemPrompt
            ? [{ role: "system" as const, content: params.systemPrompt }]
            : []),
          { role: "user" as const, content: prompt },
        ],
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("Timeout")) {
      throw new ProviderError(`请求超时（>${params.timeoutMs}ms）`);
    }
    throw new ProviderError(`网络错误：${msg}`);
  }
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      `HTTP ${res.status}：${body.slice(0, 300) || res.statusText}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    text,
    promptTokens: data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 3),
    completionTokens: data.usage?.completion_tokens ?? Math.ceil(text.length / 3),
    latencyMs,
  };
}

/** 模拟模型：四档位 skill 由预设决定（未知 ID 回退哈希）；逐题确定性答对/答错 */
async function callMock(
  model: Model,
  question: Pick<Question, "prompt" | "expectedAnswer" | "scoringType" | "scoringConfig">,
  params: EvalParams,
  repeatIndex: number,
): Promise<ChatResult> {
  const skill = getMockSkill(model.modelId);
  const h = stableHash(`${model.modelId}::${question.prompt}::${repeatIndex}::${params.seed ?? 0}`);
  const rand = mulberry32(h);
  const [lo, hi] = getMockLatencyRange(model.modelId);
  const latencyMs = lo + Math.floor(rand() * (hi - lo));

  // 模拟真实网络时延（压缩到可接受范围，保证演示流畅）
  await new Promise((r) => setTimeout(r, Math.min(latencyMs, 400)));

  // 成对裁判调用：竞技场盲选（识别「竞技场裁判」提示词，按内容质量判胜负，确定性）
  if (/竞技场裁判/.test(question.prompt)) {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
    const textA = question.prompt.match(/【回答 A】\n([\s\S]*?)\n\n【回答 B】/)?.[1] ?? "";
    const textB = question.prompt.match(/【回答 B】\n([\s\S]*?)\n\n【输出要求】/)?.[1] ?? "";
    const expected = question.prompt.match(/【参考答案】[^\n]*\n([^\n]+)/)?.[1]?.trim() ?? "";
    let winner: "A" | "B" | "tie";
    let reason: string;
    if (expected) {
      const hitA = !/（误）|\(误\)/.test(textA) && norm(textA).includes(norm(expected));
      const hitB = !/（误）|\(误\)/.test(textB) && norm(textB).includes(norm(expected));
      if (hitA && hitB) {
        winner = "tie";
        reason = "模拟裁判：两者结论均与参考答案等价，判平局。";
      } else if (hitA) {
        winner = "A";
        reason = "模拟裁判：A 结论与参考答案一致，B 不符，A 胜。";
      } else if (hitB) {
        winner = "B";
        reason = "模拟裁判：B 结论与参考答案一致，A 不符，B 胜。";
      } else {
        winner = "tie";
        reason = "模拟裁判：两者均未命中参考答案，判平局。";
      }
    } else {
      // 无参考答案：按完整度启发式
      const la = textA.trim().length;
      const lb = textB.trim().length;
      winner = la > lb * 1.2 ? "A" : lb > la * 1.2 ? "B" : "tie";
      reason = `模拟裁判：无参考答案，按任务完成度比较（A ${la} 字 / B ${lb} 字）。`;
    }
    const text = JSON.stringify({ winner, reason });
    return {
      text,
      promptTokens: Math.ceil(question.prompt.length / 2) + 12,
      completionTokens: Math.ceil(text.length / 2),
      latencyMs,
    };
  }

  // 评审调用：识别评审提示词，按回答内容对照评分锚点差异化打分（正确高分、错误低分），杜绝趋同打分
  if (/你是.*AI 能力评测评审/.test(question.prompt)) {
    const resp = question.prompt.match(/【受测模型的回答】\n([\s\S]*?)\n\n【/)?.[1] ?? "";
    const expected = question.prompt.match(/【参考答案】[^\n]*\n([^\n]+)/)?.[1]?.trim() ?? "";
    const jr = mulberry32(stableHash(`${model.modelId}::judge::${question.prompt}`));
    // 档位越低噪声越大：旗舰评审稳定，入门评审带波动
    const noise = (jr() - 0.5) * 0.18 * (1 - skill);
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
    let base: number;
    let reason: string;
    if (expected) {
      // 模拟选手答错时的「答案（误）」标记视为不命中
      const marked = /（误）|\(误\)/.test(resp);
      const hit = !marked && norm(resp).includes(norm(expected));
      base = hit ? 0.9 + skill * 0.09 : 0.08 + skill * 0.22;
      reason = hit
        ? "模拟评审：结论与参考答案内容等价，符合锚点「完全正确」。"
        : "模拟评审：结论与参考答案不符，按锚点给低分。";
    } else {
      const len = resp.trim().length;
      base = len >= 120 ? 0.72 + skill * 0.2 : len >= 40 ? 0.45 + skill * 0.25 : len >= 10 ? 0.2 + skill * 0.2 : 0.04;
      reason = "模拟评审：按回答完整度与任务完成度对照评分锚点综合判定。";
    }
    const score = Math.round(Math.min(1, Math.max(0, base + noise)) * 100) / 100;
    const text = JSON.stringify({ score, reason });
    return {
      text,
      promptTokens: Math.ceil(question.prompt.length / 2) + 12,
      completionTokens: Math.ceil(text.length / 2),
      latencyMs,
    };
  }

  const correct = rand() < skill;
  const text = buildMockAnswer(question, correct, rand);
  return {
    text,
    promptTokens: Math.ceil(question.prompt.length / 2) + 12,
    completionTokens: Math.ceil(text.length / 2),
    latencyMs,
  };
}

function buildMockAnswer(
  question: Pick<Question, "expectedAnswer" | "scoringType" | "scoringConfig" | "prompt">,
  correct: boolean,
  rand: () => number,
): string {
  const cfg = (question.scoringConfig ?? {}) as Record<string, unknown>;
  const expected = question.expectedAnswer ?? "";

  if (correct) {
    if (question.scoringType === "judge" && !expected) {
      const kw = (cfg.keywords as string[] | undefined) ?? [];
      return `春风吹过大地，万物复苏生机盎然。${kw.join("，")}。这是一段用心创作的回答，语言流畅且紧扣主题，结构完整。`;
    }
    if (question.scoringType === "json_schema" && cfg.sample != null) {
      return JSON.stringify(cfg.sample);
    }
    return expected || "好的，已完成。";
  }

  // 答错：生成合理但错误的回答
  switch (question.scoringType) {
    case "numeric": {
      const n = parseFloat(expected);
      if (!Number.isNaN(n)) return String(Math.round(n + 1 + rand() * 5));
      return "0";
    }
    case "exact":
    case "contains":
      return expected ? `${expected}（误）` : "不确定";
    case "regex":
      return "我无法给出符合要求的答案。";
    case "keywords": {
      const kw = (cfg.keywords as string[] | undefined) ?? [];
      // 只命中部分关键词
      return kw.length > 1 ? `关于${kw[0]}，我暂时没有更多把握。` : "这个问题我回答不上来。";
    }
    case "code_exec":
      // 能运行但输出错误结果的代码：沙箱执行成功、输出比对不通过 → 0 分
      return "```js\nconsole.log(0);\n```";
    case "json_schema": {
      // 缺一截的结构：按命中比例得部分分
      if (Array.isArray(cfg.sample) && cfg.sample.length > 1) {
        return JSON.stringify(cfg.sample.slice(0, Math.max(1, cfg.sample.length - 1)));
      }
      if (cfg.sample && typeof cfg.sample === "object") {
        const entries = Object.entries(cfg.sample as Record<string, unknown>);
        const dropped = entries.slice(0, Math.max(1, entries.length - 1));
        return JSON.stringify(Object.fromEntries(dropped));
      }
      return "[]";
    }
    case "judge":
      return "随便写点。";
    default:
      return "不知道";
  }
}
