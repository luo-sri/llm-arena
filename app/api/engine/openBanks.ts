/**
 * 公开题库中心：离线精选包 + 在线同步源。
 * - 离线包：原创改编、风格对齐公开基准（GSM8K / HumanEval / BBH），无需网络一键导入
 * - 在线源：Open Trivia DB（免费无 Key 常识题）、GSM8K（HuggingFace datasets-server）
 * 全部通过题目去重幂等导入，判分规则保持公开（numeric / code_exec / contains）。
 */

export interface OpenBankQuestion {
  category: string;
  difficulty: number;
  prompt: string;
  expectedAnswer: string | null;
  scoringType: string;
  scoringConfig: Record<string, unknown> | null;
  rubric: string | null;
  weight: number;
}

export interface OfflinePack {
  key: string;
  name: string;
  description: string;
  license: string;
  questions: OpenBankQuestion[];
}

export interface OnlineSource {
  key: string;
  name: string;
  description: string;
  host: string;
  /** 单次同步可拉取的最大题量 */
  maxCount: number;
  /** 该源累计收录上限：反复点击同步也不会无限累积题目（在线源每次返回的题目是随机的） */
  totalCap: number;
  /** 是否配置了备用镜像节点（用于在探测失败时给出准确提示） */
  hasFallback: boolean;
}

/** GSM8K 风格：多步数学应用题（原创改编，12 题） */
const GSM8K_PACK: OpenBankQuestion[] = [
  {
    category: "math", difficulty: 2,
    prompt: "水果店运进苹果和梨共 240 千克，苹果的质量是梨的 3 倍。苹果比梨多多少千克？只回答数字。",
    expectedAnswer: "120", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "梨 60、苹果 180，多 120。", weight: 1,
  },
  {
    category: "math", difficulty: 3,
    prompt: "一辆汽车上午行驶 2.5 小时，平均每小时 60 千米；下午行驶 1.5 小时，平均每小时 80 千米。全天平均速度是每小时多少千米？只回答数字（可用小数）。",
    expectedAnswer: "67.5", scoringType: "numeric", scoringConfig: { tolerance: 0.1 },
    rubric: "总路程 150+120=270，总时间 4h，270÷4=67.5。", weight: 1,
  },
  {
    category: "math", difficulty: 2,
    prompt: "某班男生比女生多 4 人，全班共 48 人。男生有多少人？只回答数字。",
    expectedAnswer: "26", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "(48+4)÷2=26。", weight: 1,
  },
  {
    category: "math", difficulty: 3,
    prompt: "打印机每分钟打 45 页，复印机每分钟比打印机多打 30 页。两台机器同时工作 12 分钟，一共打印多少页？只回答数字。",
    expectedAnswer: "1440", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "(45+75)×12=1440。", weight: 1,
  },
  {
    category: "math", difficulty: 3,
    prompt: "一本书原价 80 元，先涨价 25%，随后又打八折出售。现在的售价是多少元？只回答数字。",
    expectedAnswer: "80", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "80×1.25=100，100×0.8=80。", weight: 1,
  },
  {
    category: "math", difficulty: 2,
    prompt: "快递员周一派件 120 件，之后每天比前一天多派 15 件。周一到周五五天共派件多少件？只回答数字。",
    expectedAnswer: "750", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "120+135+150+165+180=750。", weight: 1,
  },
  {
    category: "math", difficulty: 3,
    prompt: "游泳池长 25 米、宽 10 米、深 2 米。现蓄水至池深的 80%，蓄了多少立方米水？只回答数字。",
    expectedAnswer: "400", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "25×10×(2×0.8)=400。", weight: 1,
  },
  {
    category: "math", difficulty: 4,
    prompt: "一批零件，师徒合作 6 天完成；师傅单独做 10 天完成。徒弟单独做需要多少天？只回答数字（单位：天）。",
    expectedAnswer: "15", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "1/6 − 1/10 = 1/15，故 15 天。", weight: 1,
  },
  {
    category: "math", difficulty: 2,
    prompt: "手机电量从 20% 充到 100% 用了 80 分钟。平均每分钟充入的电量是满电量的百分之几？只回答数字。",
    expectedAnswer: "1", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "80% ÷ 80min = 1%/min。", weight: 1,
  },
  {
    category: "math", difficulty: 4,
    prompt: "一件衣服先提价 40%，再打七折出售。最终售价比原价低百分之几？只回答数字（百分数）。",
    expectedAnswer: "2", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "1.4×0.7=0.98，比原价低 2%。", weight: 1,
  },
  {
    category: "math", difficulty: 4,
    prompt: "甲乙两地相距 360 千米，快车每小时 90 千米，慢车每小时 60 千米，两车同时从两地相向而行。相遇时快车比慢车多行驶多少千米？只回答数字。",
    expectedAnswer: "72", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "相遇 360÷150=2.4h；快车 216，慢车 144，差 72。", weight: 1,
  },
  {
    category: "math", difficulty: 4,
    prompt: "班级 40 人参加测验，答对第一题的有 28 人，答对第二题的有 25 人。两题都答对的至少有多少人？只回答数字。",
    expectedAnswer: "13", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "28+25−40=13（容斥原理下界）。", weight: 1,
  },
];

/** HumanEval 风格：代码实现题（沙箱真实执行验证，8 题） */
const HUMANEVAL_PACK: OpenBankQuestion[] = [
  {
    category: "coding", difficulty: 2,
    prompt: "实现函数 is_palindrome(s)：忽略大小写与非字母数字字符，判断是否回文。用 ```js 代码块输出函数及调用：console.log(is_palindrome(\"A man, a plan, a canal: Panama\")); console.log(is_palindrome(\"race a car\"))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "truefalse" },
    rubric: "清洗后正反一致。输出 true/false。", weight: 1,
  },
  {
    category: "coding", difficulty: 2,
    prompt: "实现函数 fizzbuzz(n)：对 1..n 逐行打印，3 的倍数打 Fizz、5 的倍数打 Buzz、15 的倍数打 FizzBuzz。用 ```js 代码块输出函数及调用 fizzbuzz(5)。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "12Fizz4Buzz" },
    rubric: "经典题。输出 1/2/Fizz/4/Buzz。", weight: 1,
  },
  {
    category: "coding", difficulty: 4,
    prompt: "实现函数 max_subarray(nums)：返回最大子数组和（至少选一个元素）。用 ```js 代码块输出函数及调用：console.log(max_subarray([-2,1,-3,4,-1,2,1,-5,4]))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "6" },
    rubric: "Kadane 算法：[4,−1,2,1] 和为 6。", weight: 1,
  },
  {
    category: "coding", difficulty: 3,
    prompt: "实现函数 word_frequency(s)：返回字符串中出现次数最多的单词（单词以空格分隔，区分大小写不做要求但需自洽）。用 ```js 代码块输出函数及调用：console.log(word_frequency(\"apple banana apple cherry apple\"))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "apple" },
    rubric: "apple 出现 3 次最多。", weight: 1,
  },
  {
    category: "coding", difficulty: 3,
    prompt: "实现函数 binary_search(arr, target)：在升序数组中二分查找，返回下标（不存在返回 -1）。用 ```js 代码块输出函数及调用：console.log(binary_search([1,3,5,7,9], 7)); console.log(binary_search([1,3,5,7,9], 4))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "3-1" },
    rubric: "输出 3 与 -1。", weight: 1,
  },
  {
    category: "coding", difficulty: 4,
    prompt: "实现函数 flatten(arr)：把任意深度嵌套的数字数组展平为一维。用 ```js 代码块输出函数及调用：console.log(JSON.stringify(flatten([1,[2,[3,[4]],5]])))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "[1,2,3,4,5]" },
    rubric: "输出 [1,2,3,4,5]。", weight: 1,
  },
  {
    category: "coding", difficulty: 4,
    prompt: "实现函数 romanToInt(s)：把罗马数字转为整数。用 ```js 代码块输出函数及调用：console.log(romanToInt(\"MCMXCIV\")); console.log(romanToInt(\"IX\"))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "19949" },
    rubric: "MCMXCIV=1994，IX=9。", weight: 1,
  },
  {
    category: "coding", difficulty: 3,
    prompt: "实现函数 is_prime(n)：判断 n 是否质数。用 ```js 代码块输出函数及调用：console.log(is_prime(97)); console.log(is_prime(1)); console.log(is_prime(2))。不要解释。",
    expectedAnswer: null, scoringType: "code_exec",
    scoringConfig: { language: "javascript", timeoutMs: 4000, expectedOutput: "truefalsetrue" },
    rubric: "97 质数、1 非质数、2 质数。", weight: 1,
  },
];

/** BBH 风格：逻辑推理（10 题） */
const BBH_PACK: OpenBankQuestion[] = [
  {
    category: "logic", difficulty: 2,
    prompt: "今天是星期三。100 天后是星期几？只回答「星期X」。",
    expectedAnswer: "星期五", scoringType: "contains", scoringConfig: { caseSensitive: false },
    rubric: "100 mod 7 = 2，周三+2=星期五。", weight: 1,
  },
  {
    category: "logic", difficulty: 3,
    prompt: "哥哥每分钟走 120 米，弟弟每分钟走 80 米。弟弟先出发 5 分钟后哥哥才出发。哥哥出发多少分钟后追上弟弟？只回答数字。",
    expectedAnswer: "10", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "差距 400 米，速度差 40 米/分，400÷40=10。", weight: 1,
  },
  {
    category: "logic", difficulty: 3,
    prompt: "数列 2, 3, 5, 9, 17, 33 的下一项是多少？只回答数字。",
    expectedAnswer: "65", scoringType: "numeric", scoringConfig: { tolerance: 0 },
    rubric: "相邻差为 1,2,4,8,16，下一个差 32 → 65。", weight: 1,
  },
  {
    category: "logic", difficulty: 2,
    prompt: "一场会议 14:30 开始，进行了 1 小时 50 分钟。几点结束？按 24 小时制回答（如：15:30）。",
    expectedAnswer: "16:20", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "14:30 + 1:50 = 16:20。", weight: 1,
  },
  {
    category: "logic", difficulty: 3,
    prompt: "已知：如果下雨，地面就会湿。现在地面没有湿。能否推出「没有下雨」？只回答「能」或「不能」。",
    expectedAnswer: "能", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "逆否命题有效：¬湿 → ¬下雨。", weight: 1,
  },
  {
    category: "logic", difficulty: 4,
    prompt: "甲、乙、丙三人，一人只说真话，其余两人说假话。甲说：「乙说假话。」乙说：「丙说假话。」丙说：「甲和乙都说假话。」谁说真话？只回答一个字（甲/乙/丙）。",
    expectedAnswer: "乙", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "若甲真 → 乙假 → 乙说「丙假」为假 → 丙真，但丙说「甲乙都假」与甲真矛盾；若乙真 → 甲假（甲说乙假→甲假成立一致）→ 丙说「甲乙都假」为假 → 丙假 ✓ 一致。答案：乙。", weight: 1,
  },
  {
    category: "logic", difficulty: 4,
    prompt: "五个人的身高两两不同。已知：A 比 B 高；C 比 D 高；E 比 A 矮但比 B 高；D 比 B 高。谁最矮？只回答字母。",
    expectedAnswer: "B", scoringType: "exact", scoringConfig: { caseSensitive: true },
    rubric: "A>B（E>B）；C>D>B；A>E>B。B 被所有人压着，最矮。", weight: 1,
  },
  {
    category: "logic", difficulty: 3,
    prompt: "所有作家都爱阅读。有些爱阅读的人不写作。据此能否推出「有些作家不写作」？只回答「能」或「不能」。",
    expectedAnswer: "不能", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "「有些爱阅读的人不写作」不能保证这些人里有作家；作家可能全部写作。经典三段论陷阱。", weight: 1,
  },
  {
    category: "logic", difficulty: 5,
    prompt: "三个盒子：金盒、银盒、铅盒。只有一句标签为真。金盒标签：「奖品在此盒」；银盒标签：「奖品不在本盒」；铅盒标签：「奖品不在金盒」。奖品在哪个盒子？只回答一个字（金/银/铅）。",
    expectedAnswer: "银", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "若奖品在金：金真、银真、铅假 → 两真，矛盾；若在铅：金假、银真、铅真 → 两真，矛盾；若在银：金假、银假、铅真 → 恰一真 ✓。答案：银。", weight: 1,
  },
  {
    category: "logic", difficulty: 4,
    prompt: "甲、乙、丙、丁、戊五人赛跑，名次无并列。已知：①戊得第一；②丁紧随丙之后（两人名次相邻）；③甲比丙靠前；④甲比乙靠前；⑤乙不是最后一名。请按第一名到最后一名的顺序输出五人名字，用半角逗号分隔（如：甲,乙,丙,丁,戊），不要解释。",
    expectedAnswer: "戊,甲,乙,丙,丁", scoringType: "exact", scoringConfig: { caseSensitive: false },
    rubric: "戊=1。②丙=k、丁=k+1（k≥2）：若丙=2丁=3，则③要求甲<2，但第 1 名已是戊，矛盾；若丙=3丁=4，则甲=2，乙只能第 5，违反⑤；故丙=4丁=5，甲∈{2,3}、乙∈{2,3} 且④甲<乙 → 甲=2、乙=3。唯一解「戊,甲,乙,丙,丁」。", weight: 1,
  },
];

export const OFFLINE_PACKS: OfflinePack[] = [
  {
    key: "gsm8k-style",
    name: "GSM8K 风格·数学应用包",
    description: "12 道多步数学应用题，风格对齐公开基准 GSM8K（小学数学应用题，MIT 协议）。数值精确判分。",
    license: "原创改编，风格对齐 GSM8K（原数据集 MIT License）",
    questions: GSM8K_PACK,
  },
  {
    key: "humaneval-style",
    name: "HumanEval 风格·代码实现包",
    description: "8 道代码实现题，风格对齐公开基准 HumanEval（函数级编程，MIT 协议）。沙箱真实执行验证输出。",
    license: "原创改编，风格对齐 HumanEval（原数据集 MIT License）",
    questions: HUMANEVAL_PACK,
  },
  {
    key: "bbh-style",
    name: "BBH 风格·逻辑推理包",
    description: "10 道高难逻辑题，风格对齐公开基准 Big-Bench Hard（MIT 协议）：时间/日期推理、真假话、约束满足。",
    license: "原创改编，风格对齐 BBH（原数据集 MIT License）",
    questions: BBH_PACK,
  },
];

export const ONLINE_SOURCES: OnlineSource[] = [
  {
    key: "opentdb",
    name: "Open Trivia DB",
    description: "免费公开英文常识题库（无需 API Key），实时拉取最新题目，转为本系统常识/多语言维度题。",
    host: "opentdb.com",
    maxCount: 50,
    totalCap: 100,
    hasFallback: false,
  },
  {
    key: "gsm8k",
    name: "GSM8K（HuggingFace）",
    description: "OpenAI 发布的公开数学应用题基准（test 集，MIT 协议）。优先经 HuggingFace 同步，网络不可达时自动降级到 jsDelivr / GitHub 镜像源。",
    host: "datasets-server.huggingface.co",
    maxCount: 50,
    totalCap: 100,
    hasFallback: true,
  },
];

interface OpenTdbItem {
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
  category: string;
  difficulty: string;
}

/**
 * Open Trivia DB 对同一 IP 有严格限流（约每 5 秒 1 次），「打开面板探测」与「点击同步」接连发起极易触发限流。
 * 这里把请求串行化（两次请求保持最小间隔）并对限流做退避重试，
 * 使探测与同步都能稳定拿到数据，而不是一限流就报「不可用」。
 */
let opentdbNextAllowedAt = 0;
const OPENTDB_MIN_GAP_MS = 2200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 串行化的单次请求：保证与上一次 OpenTDB 请求间隔足够，降低触发限流的概率 */
async function opentdbFetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const wait = opentdbNextAllowedAt - Date.now();
  if (wait > 0) await sleep(wait);
  opentdbNextAllowedAt = Date.now() + OPENTDB_MIN_GAP_MS;
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function fetchOpentdb(count: number): Promise<OpenBankQuestion[]> {
  const url = `https://opentdb.com/api.php?amount=${count}&type=multiple&encode=urlLegacy`;
  // 限流可能表现为 HTTP 429，也可能表现为 200 + response_code 5，两种都退避重试
  let data: { response_code: number; results?: OpenTdbItem[] } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await opentdbFetchOnce(url, 20000);
    if (res.status === 429) {
      if (attempt === 2) throw new Error("Open Trivia DB 持续限流（HTTP 429），请稍后重试");
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Open Trivia DB 返回 ${httpErrText(res.status)}`);
    data = (await res.json()) as { response_code: number; results?: OpenTdbItem[] };
    if (data.response_code === 5) {
      if (attempt === 2) throw new Error("Open Trivia DB 持续限流，请稍后重试");
      await sleep(1500 * (attempt + 1));
      continue;
    }
    break;
  }
  if (!data || data.response_code !== 0 || !data.results) {
    throw new Error(data?.response_code === 4 ? "题目量不足（该源单次最多 50 题）" : "Open Trivia DB 拒绝了请求");
  }
  return data.results.map((it) => {
    const q = decodeURIComponent(it.question);
    const correct = decodeURIComponent(it.correct_answer);
    const options = [...it.incorrect_answers.map(decodeURIComponent), correct];
    // 确定性打乱：按字符码排序，稳定且随机
    options.sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0) || a.localeCompare(b));
    const letters = ["A", "B", "C", "D"];
    const optionLines = options.map((o, i) => `${letters[i]}. ${o}`).join("\n");
    return {
      category: "commonsense",
      difficulty: 3,
      prompt: `【公开题库同步 · Open Trivia DB】\n${q}\n\n${optionLines}\n\n请只回答正确选项的完整文本（Answer with the option text only）。`,
      expectedAnswer: correct,
      scoringType: "contains",
      scoringConfig: { caseSensitive: false },
      rubric: `来源 Open Trivia DB（分类 ${it.category}）。答案与正确选项文本一致（包含匹配，大小写不敏感）。`,
      weight: 1,
    };
  });
}

/** GSM8K 原始记录：HuggingFace rows 与 GitHub JSONL 的字段完全一致 */
interface Gsm8kRaw {
  question: string;
  answer: string;
}

/** 把底层网络异常转成可读文案：AbortError 多因连接超时或被网络拦截 */
function netErrText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return "连接超时";
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network/i.test(msg)) return "网络不可达";
  return msg.slice(0, 60);
}

/** HTTP 状态码转可读文案：区分限流与一般错误，便于用户判断是重试还是换源 */
function httpErrText(status: number): string {
  if (status === 429) return "请求过于频繁（HTTP 429），请稍后重试";
  if (status === 403 || status === 451) return `访问被拒绝（HTTP ${status}）`;
  if (status >= 500) return `服务端错误（HTTP ${status}）`;
  return `HTTP ${status}`;
}

/**
 * GSM8K 数据源候选链：官方 HuggingFace datasets-server 优先，
 * 其次为 jsDelivr CDN 与 GitHub 原始 JSONL（均为同一份 OpenAI 原始数据）。
 * 部分网络环境无法直连 huggingface.co，只挂单一官方源会导致同步必然超时，故必须提供备用源。
 * 注：实测 raw.githubusercontent.com 在 Node 运行时可能整段超时，故把 jsDelivr 排在它之前。
 */
const GSM8K_ENDPOINTS: { label: string; kind: "hf-rows" | "jsonl"; url: string; timeoutMs: number }[] = [
  {
    label: "HuggingFace 官方",
    kind: "hf-rows",
    url: "https://datasets-server.huggingface.co/rows?dataset=openai%2Fgsm8k&config=main&split=test",
    timeoutMs: 6000,
  },
  {
    label: "jsDelivr 镜像",
    kind: "jsonl",
    url: "https://cdn.jsdelivr.net/gh/openai/grade-school-math@master/grade_school_math/data/test.jsonl",
    timeoutMs: 20000,
  },
  {
    label: "GitHub 源",
    kind: "jsonl",
    url: "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl",
    timeoutMs: 20000,
  },
];

/**
 * 节点记忆与失败熔断：记住最近一次成功的节点并优先使用，
 * 对刚失败的节点做 5 分钟熔断，避免每次同步都先白等官方源超时。
 * 可用性探测会预热这份记忆，因此用户点「一键同步」时通常已直达可用节点。
 */
let preferredGsm8kIdx: number | null = null;
const gsm8kDeadUntil = new Map<number, number>();
const GSM8K_DEAD_TTL_MS = 5 * 60 * 1000;

function gsm8kOrder(): number[] {
  const now = Date.now();
  const all = GSM8K_ENDPOINTS.map((_, i) => i);
  const alive = all.filter((i) => (gsm8kDeadUntil.get(i) ?? 0) <= now);
  const pool = alive.length > 0 ? alive : all; // 全部熔断时仍逐一尝试，避免永久卡死
  if (preferredGsm8kIdx !== null && pool.includes(preferredGsm8kIdx)) {
    return [preferredGsm8kIdx, ...pool.filter((i) => i !== preferredGsm8kIdx)];
  }
  return pool;
}

function markGsm8kOk(i: number) {
  preferredGsm8kIdx = i;
  gsm8kDeadUntil.delete(i);
}

function markGsm8kDead(i: number) {
  gsm8kDeadUntil.set(i, Date.now() + GSM8K_DEAD_TTL_MS);
  if (preferredGsm8kIdx === i) preferredGsm8kIdx = null;
}

/** 整份 JSONL 内存缓存（10 分钟）：重复同步时不必反复下载数百 KB */
const gsm8kJsonlCache = new Map<string, { at: number; rows: Gsm8kRaw[] }>();
const GSM8K_CACHE_TTL_MS = 10 * 60 * 1000;

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

async function loadGsm8kJsonl(url: string, timeoutMs: number): Promise<Gsm8kRaw[]> {
  const cached = gsm8kJsonlCache.get(url);
  if (cached && Date.now() - cached.at < GSM8K_CACHE_TTL_MS) return cached.rows;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(httpErrText(res.status));
  const text = await res.text();
  const rows: Gsm8kRaw[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<Gsm8kRaw>;
      if (typeof o.question === "string" && typeof o.answer === "string") {
        rows.push({ question: o.question, answer: o.answer });
      }
    } catch {
      // 忽略无法解析的行，避免个别脏数据导致整批失败
    }
  }
  if (rows.length === 0) throw new Error("未解析到题目");
  gsm8kJsonlCache.set(url, { at: Date.now(), rows });
  return rows;
}

async function fetchGsm8kFrom(
  ep: (typeof GSM8K_ENDPOINTS)[number],
  count: number,
): Promise<Gsm8kRaw[]> {
  if (ep.kind === "hf-rows") {
    const offset = Math.floor(Math.random() * 800);
    const res = await fetch(`${ep.url}&offset=${offset}&length=${count}`, {
      signal: AbortSignal.timeout(ep.timeoutMs),
    });
    if (!res.ok) throw new Error(httpErrText(res.status));
    const data = (await res.json()) as { rows?: { row: Gsm8kRaw }[] };
    if (!data.rows?.length) throw new Error("未返回题目");
    return data.rows.map((r) => r.row);
  }
  return pickRandom(await loadGsm8kJsonl(ep.url, ep.timeoutMs), count);
}

function toGsm8kQuestion(r: Gsm8kRaw): OpenBankQuestion {
  const finalNum = (r.answer.match(/####\s*([\d.,]+)/)?.[1] ?? "").replace(/,/g, "");
  return {
    category: "math",
    difficulty: 3,
    prompt: `【公开基准 GSM8K · test 集】\n${r.question}\n\n请一步步推理，最后单独一行给出最终数字答案，格式：#### 数字`,
    expectedAnswer: finalNum,
    scoringType: "numeric",
    scoringConfig: { tolerance: 0 },
    rubric: "来源 GSM8K（MIT License）。数值判分：从回答中提取最后一个数值与标准答案比对。",
    weight: 1,
  };
}

async function fetchGsm8k(count: number): Promise<OpenBankQuestion[]> {
  const errors: string[] = [];
  for (const i of gsm8kOrder()) {
    const ep = GSM8K_ENDPOINTS[i];
    try {
      const rows = await fetchGsm8kFrom(ep, count);
      const mapped = rows.map(toGsm8kQuestion).filter((q) => !!q.expectedAnswer);
      if (mapped.length > 0) {
        markGsm8kOk(i);
        return mapped;
      }
      errors.push(`${ep.label}：无有效题目`);
      markGsm8kDead(i);
    } catch (e) {
      errors.push(`${ep.label}：${netErrText(e)}`);
      markGsm8kDead(i);
    }
  }
  throw new Error(
    `GSM8K 全部数据源均不可用（${errors.join("；")}）。可改用离线精选包「GSM8K 风格·数学应用包」，或配置网络代理后重试`,
  );
}

/**
 * 在线源可用性探测：候选链中任一节点可用即视为可达，并返回实际命中的节点。
 * 关键点：HTTP 429 表示服务器「已应答、只是限流」，属于可达而非不可达，
 * 因此单独用 rateLimited 标记，避免把限流误报成「不可用」。
 */
export async function probeOnlineSource(
  key: string,
): Promise<{ reachable: boolean; error: string | null; endpoint: string | null; rateLimited?: boolean }> {
  if (key === "opentdb") {
    try {
      const res = await opentdbFetchOnce("https://opentdb.com/api.php?amount=1", 6000);
      if (res.ok) return { reachable: true, error: null, endpoint: null };
      if (res.status === 429) return { reachable: true, error: null, endpoint: null, rateLimited: true };
      return { reachable: false, error: httpErrText(res.status), endpoint: null };
    } catch (e) {
      return { reachable: false, error: netErrText(e), endpoint: null };
    }
  }
  if (key === "gsm8k") {
    const errors: string[] = [];
    let sawRateLimit = false;
    for (const i of gsm8kOrder()) {
      const ep = GSM8K_ENDPOINTS[i];
      try {
        // jsonl 端点用 Range 只取前 200 字节做轻量探测，避免为探测下载整份数据
        const res =
          ep.kind === "hf-rows"
            ? await fetch(`${ep.url}&offset=0&length=1`, { signal: AbortSignal.timeout(6000) })
            : await fetch(ep.url, {
                headers: { Range: "bytes=0-199" },
                signal: AbortSignal.timeout(6000),
              });
        if (res.ok) {
          markGsm8kOk(i);
          return { reachable: true, error: null, endpoint: ep.label };
        }
        if (res.status === 429) sawRateLimit = true;
        errors.push(`${ep.label}：${httpErrText(res.status)}`);
        markGsm8kDead(i);
      } catch (e) {
        errors.push(`${ep.label}：${netErrText(e)}`);
        markGsm8kDead(i);
      }
    }
    // 全部候选都只是被限流时，说明服务端可达，不应判定为不可达
    if (sawRateLimit) return { reachable: true, error: null, endpoint: null, rateLimited: true };
    return { reachable: false, error: errors.join("；"), endpoint: null };
  }
  return { reachable: false, error: "未知在线源", endpoint: null };
}

export async function fetchOnlineQuestions(source: string, count: number): Promise<OpenBankQuestion[]> {
  if (source === "opentdb") return fetchOpentdb(Math.min(count, 50));
  if (source === "gsm8k") return fetchGsm8k(Math.min(count, 50));
  throw new Error(`未知在线源：${source}`);
}
