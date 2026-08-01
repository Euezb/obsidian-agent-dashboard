export type ModuleStatus = "idle" | "loading" | "ready" | "stale" | "error";

export interface DashboardTask {
  id: string;
  path: string;
  line: number;
  text: string;
  completed: boolean;
  dueDate?: string;
  /** Owning note date (from the filename when present, otherwise the file's modified day), YYYY-MM-DD. */
  date?: string;
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
