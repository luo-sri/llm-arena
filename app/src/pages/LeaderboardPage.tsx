import { trpc } from "@/providers/trpc";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreText } from "@/components/common";

interface RatingRow {
  modelId: number;
  modelName: string;
  rating: number;
  ciLow: number;
  ciHigh: number;
  wins: number;
  losses: number;
  ties: number;
  battlesCount: number;
  winRate: number;
  avgItemScore: number | null;
  runsCount: number;
}

/** 迷你置信区间条：评级按全局范围映射到条宽，高亮 95% CI 区段 */
function CiBar({ row, min, max }: { row: RatingRow; min: number; max: number }) {
  const span = Math.max(max - min, 1);
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  return (
    <div className="relative h-4 min-w-[110px] bg-muted/50 rounded">
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 bg-primary/30 rounded"
        style={{ left: `${pos(row.ciLow)}%`, width: `${Math.max(pos(row.ciHigh) - pos(row.ciLow), 0.5)}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-primary"
        style={{ left: `calc(${pos(row.rating)}% - 5px)` }}
      />
    </div>
  );
}

export default function LeaderboardPage() {
  const board = trpc.runs.leaderboard.useQuery(undefined, { refetchInterval: 10000 });
  const rows: RatingRow[] = board.data ?? [];

  const min = rows.length ? Math.min(...rows.map((r) => r.ciLow)) - 20 : 0;
  const max = rows.length ? Math.max(...rows.map((r) => r.ciHigh)) + 20 : 1;

  return (
    <div>
      <PageHeader
        title="竞技场排行榜"
        desc="Bradley-Terry 评级 + 95% bootstrap 置信区间（对齐 Chatbot Arena 开源方法论）· 聚合全部已完成运行的两两对战记录"
      />

      {(board.data?.length ?? 0) === 0 ? (
        <EmptyState
          text="暂无对战记录"
          hint="完成一次包含 2 个以上模型的评测后，系统自动生成两两对战并计算评级"
        />
      ) : (
        <>
          <Card>
            <CardHeader className="py-2.5">
              <CardTitle className="text-xs">全局评级（评级 ± 95% 置信区间 · 按评级降序）</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs min-w-[860px]">
                <thead>
                  <tr className="text-muted-foreground text-left border-b border-border">
                    <th className="py-1.5 font-normal w-8">#</th>
                    <th className="py-1.5 font-normal">模型</th>
                    <th className="py-1.5 font-normal text-right">BT 评级</th>
                    <th className="py-1.5 font-normal w-32">95% 置信区间</th>
                    <th className="py-1.5 font-normal text-right">胜/平/负</th>
                    <th className="py-1.5 font-normal text-right">胜率</th>
                    <th className="py-1.5 font-normal text-right">对战场次</th>
                    <th className="py-1.5 font-normal text-right">平均题分</th>
                    <th className="py-1.5 font-normal text-right">参赛运行</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.modelId} className="border-b border-border/50">
                      <td className="py-2 font-data text-primary">{i + 1}</td>
                      <td className="py-2">{r.modelName}</td>
                      <td className="py-2 text-right font-data font-medium">{r.rating.toFixed(1)}</td>
                      <td className="py-2">
                        <CiBar row={r} min={min} max={max} />
                        <div className="text-[10px] text-muted-foreground font-data mt-0.5 text-center">
                          {r.ciLow.toFixed(0)} ~ {r.ciHigh.toFixed(0)}
                        </div>
                      </td>
                      <td className="py-2 text-right font-data">
                        <span className="text-success">{r.wins}</span> / <span className="text-muted-foreground">{r.ties}</span> / <span className="text-destructive">{r.losses}</span>
                      </td>
                      <td className="py-2 text-right font-data">{(r.winRate * 100).toFixed(1)}%</td>
                      <td className="py-2 text-right font-data">{r.battlesCount}</td>
                      <td className="py-2 text-right font-data">{r.avgItemScore !== null ? <ScoreText score={r.avgItemScore} /> : "—"}</td>
                      <td className="py-2 text-right font-data">{r.runsCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader className="py-2.5"><CardTitle className="text-xs">评级方法论（公开可验证）</CardTitle></CardHeader>
            <CardContent className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                <Badge variant="outline" className="text-[10px] mr-1.5">Bradley-Terry</Badge>
                由两两对战记录拟合各模型相对强度 P(i 胜 j) = rᵢ/(rᵢ+rⱼ)，评级 = 1000 + 400·log₁₀(强度/几何均值)，方法对齐
                Chatbot Arena 开源实现（LMSYS）。
              </p>
              <p>
                <Badge variant="outline" className="text-[10px] mr-1.5">Bootstrap 置信区间</Badge>
                对战记录有放回重采样 500 次重新拟合，取 2.5%/97.5% 分位为 95% 置信区间；区间越窄说明该模型对战样本越充分、评级越可信。
              </p>
              <p>
                <Badge variant="outline" className="text-[10px] mr-1.5">虚拟平局正则</Badge>
                每对模型注入 1 场虚拟平局：防止全胜/全负模型评级发散，并让对战样本少的模型评级自动向均值收缩（低样本不虚高）。
              </p>
              <p>
                <Badge variant="outline" className="text-[10px] mr-1.5">判定双模式</Badge>
                AI 裁决：启用评审模型时由其盲选更优回答（A/B 位置随机化消除位置偏差，中英文互答不扣分）；
                分差判定：机器审核时按最终分差定胜负（|Δ|≤0.05 判平局）。两种模式的战报均永久可查。
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
