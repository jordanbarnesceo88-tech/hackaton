/** Aggregate UTF-8 JSON limit shared by project save and calculation API. Geometry/proof
 * field limits still apply; their individual maxima are not an unbounded total allowance. */
export const PROJECT_INPUT_MAX_BYTES = 4 * 1024 * 1024;

export function projectInputJsonBytes(value: unknown): number {
  const json = JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('Non-finite project input');
    return entry;
  });
  if (json === undefined) throw new Error('Project input is not JSON');
  return new TextEncoder().encode(json).byteLength;
}

/** Size admission only: a null result never substitutes for semantic validation. */
export function projectInputSizeIssue(value: unknown): string | null {
  try {
    return projectInputJsonBytes(value) <= PROJECT_INPUT_MAX_BYTES ? null
      : 'Данные проекта превышают 4 МиБ. Сократите число сценариев или разделите их на несколько проектов';
  } catch {
    return 'Данные проекта не сериализуются в JSON: проверьте конечность чисел и структуру данных';
  }
}
