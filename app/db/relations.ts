import { relations } from "drizzle-orm";
import {
  modelGroups,
  models,
  questions,
  evalSuites,
  runs,
  runItems,
  runLogs,
  reports,
} from "./schema";

export const modelGroupsRelations = relations(modelGroups, ({ many }) => ({
  models: many(models),
}));

export const modelsRelations = relations(models, ({ one, many }) => ({
  group: one(modelGroups, { fields: [models.groupId], references: [modelGroups.id] }),
  items: many(runItems),
}));

export const evalSuitesRelations = relations(evalSuites, ({ many }) => ({
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  suite: one(evalSuites, { fields: [runs.suiteId], references: [evalSuites.id] }),
  items: many(runItems),
  logs: many(runLogs),
  reports: many(reports),
}));

export const runItemsRelations = relations(runItems, ({ one }) => ({
  run: one(runs, { fields: [runItems.runId], references: [runs.id] }),
  model: one(models, { fields: [runItems.modelId], references: [models.id] }),
  question: one(questions, { fields: [runItems.questionId], references: [questions.id] }),
}));

export const runLogsRelations = relations(runLogs, ({ one }) => ({
  run: one(runs, { fields: [runLogs.runId], references: [runs.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  run: one(runs, { fields: [reports.runId], references: [runs.id] }),
}));
