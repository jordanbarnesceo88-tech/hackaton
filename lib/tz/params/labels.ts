import type { ParamSpec } from "../types";
import { unitsCompatible } from "./schema";

/**
 * Сопоставление строк файла с параметрами по названию — для листа организатора, где ключей нет
 * (ТЗ §3.2.3: загрузка «по шаблону», а шаблон организатора — его датасет). Названия в файле и
 * в описаниях могут расходиться уточнениями в скобках («Объём приёмки (поддоны/сутки)»),
 * вводными словами («Из них: отборщики») и хвостами («…персонала склада»), поэтому
 * сопоставление идёт в три прохода от строгого к мягкому, и каждый следующий проход видит только
 * то, что не сопоставили предыдущие.
 */

/** Название без регистра, «ё» как «е», вместо знаков препинания — пробел. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/g, " ")
    .trim();
}

/** Суть названия: без уточнений в скобках и без вводного «Из них:». */
export function coreLabel(label: string): string {
  return normalizeLabel(label.replace(/\([^)]*\)/g, " ")).replace(/^из них /, "");
}

/** Служебные слова, которые не различают параметры. */
const STOPWORDS = new Set(["и", "в", "во", "на", "из", "них", "с", "со", "по", "для", "от", "до", "к", "а", "о", "об", "за", "при", "без", "или"]);

/** Основы слов: первые пять букв — грубо, но «класса» и «класс», «грузов» и «грузы» совпадут. */
function stems(label: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeLabel(label).split(" ")) {
    if (w && !STOPWORDS.has(w)) out.add(w.slice(0, 5));
  }
  return out;
}

/** Строка файла для сопоставления: название и единица (если есть). */
export type LabelRow = { label: string; unit?: string | null };

/** Минимальная доля совпавших основ (от меньшего из двух названий) в третьем проходе. */
const MIN_TOKEN_SCORE = 0.75;
/** Минимальное число совпавших основ в третьем проходе — одно слово не доказательство. */
const MIN_TOKEN_OVERLAP = 2;

/**
 * Единственный кандидат: если он один — он; если их несколько — единственный с единицей,
 * совместимой с единицей строки; иначе null. Единица здесь только разбивает ничью: кандидат с
 * чужой единицей всё равно сопоставляется, чтобы проверка сообщила `unit_mismatch`, а не
 * «строка не сопоставлена».
 */
function pickOne(row: LabelRow, candidates: readonly ParamSpec[]): ParamSpec | null {
  if (candidates.length === 1) return candidates[0] ?? null;
  const compatible = candidates.filter((d) => unitsCompatible(row.unit, d.unit));
  return compatible.length === 1 ? (compatible[0] ?? null) : null;
}

/**
 * Сопоставляет строки файла с описаниями параметров. Возвращает для каждой строки описание или
 * null (строку не удалось сопоставить однозначно).
 *
 * Проходы:
 * 1. Точное совпадение нормализованного названия (или ключа параметра). Здесь одна строка может
 *    сопоставиться с уже занятым параметром — тогда проверка отметит повтор (`duplicate_key`).
 * 2. Совпадение сути названия (без скобок и «Из них:») среди свободных параметров: кандидат
 *    должен быть один, а из нескольких выбирается единственный с совместимой единицей.
 * 3. Доля общих основ слов ≥ 0,75 от меньшего названия и не меньше двух общих основ; из лучших
 *    по доле кандидатов — единственный, а при ничьей — единственный с совместимой единицей.
 *
 * Во всех проходах единица не отсекает кандидата, а только разбивает ничью: строка с чужой
 * единицей сопоставляется, и проверка значений сообщает `unit_mismatch` («пересчитайте значение
 * в …»), а не молча оставляет значение по умолчанию.
 */
export function matchLabelsToDefs(rows: readonly LabelRow[], defs: readonly ParamSpec[]): (ParamSpec | null)[] {
  const result: (ParamSpec | null)[] = rows.map(() => null);
  const taken = new Set<string>();

  // Проход 1: точное название или ключ.
  const byExact = new Map<string, ParamSpec>();
  for (const def of defs) {
    for (const k of [normalizeLabel(def.label), normalizeLabel(def.key)]) {
      if (k && !byExact.has(k)) byExact.set(k, def);
    }
  }
  rows.forEach((row, i) => {
    const def = byExact.get(normalizeLabel(row.label));
    if (def) {
      result[i] = def;
      taken.add(def.key);
    }
  });

  // Проход 2: суть названия, однозначно среди свободных.
  rows.forEach((row, i) => {
    if (result[i]) return;
    const core = coreLabel(row.label);
    if (!core) return;
    const only = pickOne(
      row,
      defs.filter((d) => !taken.has(d.key) && coreLabel(d.label) === core),
    );
    if (only) {
      result[i] = only;
      taken.add(only.key);
    }
  });

  // Проход 3: общие основы слов.
  rows.forEach((row, i) => {
    if (result[i]) return;
    const a = stems(row.label);
    if (a.size === 0) return;
    let best: ParamSpec[] = [];
    let bestScore = 0;
    for (const d of defs) {
      if (taken.has(d.key)) continue;
      const b = stems(d.label);
      let overlap = 0;
      for (const w of a) if (b.has(w)) overlap++;
      if (overlap < MIN_TOKEN_OVERLAP) continue;
      const score = overlap / Math.min(a.size, b.size);
      if (score < MIN_TOKEN_SCORE) continue;
      if (score > bestScore + 1e-9) {
        best = [d];
        bestScore = score;
      } else if (Math.abs(score - bestScore) <= 1e-9) {
        best.push(d);
      }
    }
    const only = pickOne(row, best);
    if (only) {
      result[i] = only;
      taken.add(only.key);
    }
  });

  return result;
}
