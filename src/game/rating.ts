export type Rank = "S" | "A" | "B" | "C" | "D" | "F";

export type Grade = {
  score: number;
  rank: Rank;
  title: string;
};

export type BoardRow = {
  name: string;
  score: number;
  rank: Rank;
  time: number;
  escaped: boolean;
  at: number;
};

const KEY = "mishkin-dom-board-v1";

const TITLES: Record<Rank, string> = {
  S: "Без единого скрипа",
  A: "Тихая ночь",
  B: "Выбрался",
  C: "С грохотом",
  D: "Чудом жив",
  F: "Пойман",
};

export function grade(time: number, noises: number, spots: number, escaped: boolean): Grade {
  if (!escaped) {
    return { score: Math.round(time * 5), rank: "F", title: TITLES.F };
  }
  const score = Math.max(80, Math.round(1500 + Math.max(0, 220 - time) * 7 - noises * 14 - spots * 80));
  const rank: Rank =
    score >= 2100 ? "S" : score >= 1650 ? "A" : score >= 1250 ? "B" : score >= 850 ? "C" : "D";
  return { score, rank, title: TITLES[rank] };
}

export function loadBoard(): BoardRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BoardRow[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.score === "number" && typeof r.name === "string")
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function pushBoard(row: BoardRow): BoardRow[] {
  const next = [...loadBoard(), row].sort((a, b) => b.score - a.score).slice(0, 8);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
