export type Candidate = { value: number; score: number; context: string };

export function extractDistanceCandidates(raw: string): Candidate[] {
  const text = raw.normalize("NFKC").replace(/(\d)[oO](\d)/g, (_match, left, right) => `${left}0${right}`);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const found = new Map<number, Candidate>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nearby = [lines[i - 1], line, lines[i + 1]].filter(Boolean).join(" ");
    if (/\b(?:19|20)\d{2}[-/.年]\s*\d{1,2}\b/.test(line)) continue;
    if (/配速|时长|用时|步数|卡路里|消耗|pace|bpm|kcal/i.test(line) && !/km|公里|千米/i.test(line)) continue;
    for (const match of line.matchAll(/(?<!\d)(\d{1,4}(?:[.,]\d{1,2})?)(?!\d)/g)) {
      const value = Number(match[1].replace(",", "."));
      if (!Number.isFinite(value) || value <= 0 || value > 10000) continue;
      if (Number.isInteger(value) && value >= 1990 && value <= 2100) continue;
      let score = 0;
      if (/月跑量|本月|月度|月累计|monthly|month/i.test(line)) score += 8;
      else if (/月跑量|本月|月度|月累计|monthly|month/i.test(nearby)) score += 3;
      if (/总里程|累计|总距离|总跑量|总计|total/i.test(line)) score += 5;
      else if (/总里程|累计|总距离|总跑量|总计|total/i.test(nearby)) score += 3;
      if (/km|公里|千米/i.test(line)) score += 6;
      else if (/km|公里|千米/i.test(nearby)) score += 2;
      if (/距离|里程|distance/i.test(nearby)) score += 3;
      if (/配速|时长|用时|步数|卡路里|消耗|pace|min|bpm|kcal/i.test(line)) score -= 8;
      if (match[1].includes(".") || match[1].includes(",")) score += 1;
      const candidate = { value: Math.round(value * 100) / 100, score, context: line.slice(0, 90) };
      const previous = found.get(candidate.value);
      if (!previous || previous.score < score) found.set(candidate.value, candidate);
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || b.value - a.value).slice(0, 8);
}
