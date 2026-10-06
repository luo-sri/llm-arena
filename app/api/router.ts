import { createRouter, publicQuery } from "./middleware";
import { modelsRouter } from "./routers/models";
import { questionsRouter } from "./routers/questions";
import { suitesRouter } from "./routers/suites";
import { runsRouter } from "./routers/runs";
import { reportsRouter } from "./routers/reports";
import { systemRouter } from "./routers/system";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  models: modelsRouter,
  questions: questionsRouter,
  suites: suitesRouter,
  runs: runsRouter,
  reports: reportsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
