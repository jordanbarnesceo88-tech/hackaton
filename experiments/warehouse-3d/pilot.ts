import { simInputIdentity } from "../../lib/sim/identity";
import type { SimInput } from "../../lib/sim/types";
import { stableJson } from "../../lib/tz/version";
import type { DemoAssessment } from "./assessment";
import type { SectionInput } from "./sections";

type PilotModel = {
  kind?: string; input: SimInput | SectionInput; simModelVersion: string; assessment: DemoAssessment;
  projectOrigin?: { sourceInputKey: string };
};

/** Model evidence defines measurement goals; it cannot certify a site or annual savings. */
export function buildPilotPlan(model: PilotModel) {
  const a = model.assessment;
  const cleaning = model.kind === "cleaning";
  const blockers = a.checks.filter(c => c.affectsOverall && ["FAIL", "WARN", "NOT_EVALUATED"].includes(c.status));
  return {
    schemaVersion: "pilot-plan-1" as const,
    source: { simModelVersion: model.simModelVersion, executionInputKey: "kind" in model.input ? stableJson({ version: model.simModelVersion, input: model.input }) : simInputIdentity(model.input), sourceInputKey: model.projectOrigin?.sourceInputKey ?? null, assessmentStatus: a.status },
    mode: a.status === "OK" ? "verify-model-on-site" : "measure-and-resolve",
    title: a.status === "OK" ? "План проверки выбранного решения на объекте" : "План проверки ограничений сценария",
    siteReadiness: "NOT_EVALUATED" as const,
    conclusion: a.status === "OK" ? "Критерии модели выполнены. На объекте нужно подтвердить производительность, безопасность процесса и ручной остаток." : "Заданная нагрузка выполнена не полностью. Сначала сравните варианты и разберите невыполненные критерии ниже; для проверки на объекте задайте конкретный объём работ и ожидаемый результат.",
    blockers: blockers.map(c => ({ id: c.id, label: c.label, measured: c.measuredText, required: c.limitText, nextAction: c.action, evidence: structuredClone(c.evidence) })),
    acceptance: a.checks.filter(c => c.category === "goal").map(c => ({ id: c.id, label: c.label, target: c.limitText, observedInModel: c.measuredText, status: c.status })),
    steps: [
      "Выбрать один ограниченный участок и назначить ответственного со стороны объекта и интегратора.",
      "Проверить проходы, покрытие, маршруты людей, связь, электропитание, размещение док-станций; при необходимости — лифты и доступ между этажами.",
      cleaning ? "Записать маршруты по секциям, уникальное покрытие, качество уборки, повторы, ручные вмешательства и время возврата." : "Записать поступления и завершения перевозок, полный цикл, остаток очереди, причины ожиданий и время ручного обслуживания.",
      "Проверить остановку при отказе, получение сигнала, диагностику и восстановление; разделить модельное расписание и фактические действия оператора.",
      "До старта согласовать длительность, нагрузку, критерии приёмки, стоимость, ответственность и условия прекращения пилота.",
      "После пилота сопоставить журналы с критериями, уточнить остаточную ручную работу и затраты; только затем решать об увеличении парка.",
    ],
    economics: {
      status: "NOT_EVALUATED" as const,
      reason: "Годовая экономика рассчитывается в финансовом варианте с явно заданными долями нагрузки и денежной реализации труда. Этот чеклист содержит задачи для уточнения допущений; он не пересчитывает NPV.",
      requiredEvidence: [
        "Согласованный профиль нагрузки по сменам, пикам, рабочим дням и сезонности.",
        "Оценка ручных операций, вмешательств и оставшихся обязанностей; явное допущение о сокращении расходов на персонал.",
        "Оценочные цены пилота, оборудования или аренды, доставки, инфраструктуры, интеграций и сервиса с источниками и диапазонами.",
        "Принятые доступность, зарядка, простой и срок службы; что потребуется проверить измерениями на объекте.",
      ],
    },
  };
}
