/**
 * Serialises an embedding to pgvector's text format (`[1,2,3]`) for use as a bound
 * parameter: `$queryRaw\`... embedding <=> ${toPgVector(v)}::vector ...\``.
 * Never interpolate vectors into SQL strings.
 */
export function toPgVector(values: readonly number[], expectedDimensions?: number): string {
  if (values.length === 0) throw new RangeError('Vector must not be empty');
  if (expectedDimensions !== undefined && values.length !== expectedDimensions) {
    throw new RangeError(`Vector has ${values.length} dimensions, expected ${expectedDimensions}`);
  }
  for (const v of values) {
    if (!Number.isFinite(v)) throw new RangeError('Vector contains a non-finite value');
  }
  return `[${values.join(',')}]`;
}

/** Parses pgvector's text output back into numbers. */
export function fromPgVector(text: string): number[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']'))
    throw new SyntaxError('Not a pgvector literal');
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body.split(',').map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new SyntaxError('Invalid vector component');
    return n;
  });
}
