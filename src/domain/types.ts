export type ModuleStatus = "idle" | "loading" | "ready" | "stale" | "error";

export interface DashboardTask {
  id: string;
  path: string;
  line: number;
  text: string;
  completed: boolean;
  dueDate?: string;
  /** Owning day from the task's own 📅 token, otherwise from a date in the note's path. */
  date?: string;
  /** True when the line sits under the daily note's archive heading. */
  archived?: boolean;
}

export interface RecentNote {
  path: string;
  title: string;
  modifiedAt: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface HealthBreakdown {
  frontmatter: number;
  links: number;
  tags: number;
  activity: number;
  inbox: number;
}

export interface VaultHealth {
  score: number | null;
  breakdown: HealthBreakdown;
  suggestions: string[];
  insufficientData: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  /** Source-provided popularity signal (e.g. Hacker News score), when available. */
  score?: number;
}

export interface DailyBrief {
  date: string;
  generatedAt: number;
  /** Whole-day digest in prose; the summary card shows this instead of repeating item rows. */
  overview: string;
  items: Array<{
    title: string;
    url: string;
    source: string;
    summary: string;
  }>;
}

export interface TrendingRepo {
  name: string;
  url: string;
  description: string;
  language?: string;
  stars: number;
  starsInPeriod?: number;
  source: "github-trending" | "github-search-fallback";
}

export interface ModuleState<T> {
  status: ModuleStatus;
  data: T;
  updatedAt?: number;
  retryAt?: number;
  message?: string;
}

export interface DashboardState {
  tasks: ModuleState<DashboardTask[]>;
  recentNotes: ModuleState<RecentNote[]>;
  heatmap: ModuleState<HeatmapDay[]>;
  health: ModuleState<VaultHealth | null>;
  aiNews: ModuleState<NewsItem[]>;
  githubDaily: ModuleState<TrendingRepo[]>;
  githubWeekly: ModuleState<TrendingRepo[]>;
  dailyBrief: ModuleState<DailyBrief | null>;
}
