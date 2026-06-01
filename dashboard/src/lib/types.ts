export interface Position {
  position: string;
  pool: string;
  pool_name?: string;
  strategy?: string;
  bin_range?: { lower: number; upper: number };
  amount_sol?: number;
  deployed_at?: string;
  out_of_range_since?: string | null;
  closed?: boolean;
  peak_pnl_pct?: number;
  total_fees_claimed_usd?: number;
  instruction?: string | null;
  notes?: string[];
  pnl_pct?: number;
  pnl_usd?: number;
  in_range?: boolean;
  active_bin?: number;
  bin_step?: number;
  age_minutes?: number;
}

export interface Decision {
  id: string;
  ts: string;
  type: string;
  actor: string;
  pool?: string;
  pool_name?: string;
  position?: string;
  summary?: string;
  reason?: string;
  risks?: string[];
  metrics?: Record<string, unknown>;
  rejected?: string[];
}

export interface Candidate {
  pool_address?: string;
  pool?: string;
  name?: string;
  fee_active_tvl_ratio?: number;
  organic_score?: number;
  volume?: number;
  mcap?: number;
  tvl?: number;
  volatility?: number;
  bin_step?: number;
  score?: number;
  smart_wallets?: string[];
  base_mint?: string;
}

export interface ActionEntry {
  timestamp: string;
  tool: string;
  success: boolean;
  duration_ms?: number;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
}

export interface BrainPageMeta {
  ref: string;
  title: string;
  type: string;
  updated_at?: string;
}
