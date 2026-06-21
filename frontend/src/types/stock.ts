import type { z } from "zod";

import type {
  cacheMetadataSchema,
  momentumVerdictSchema,
  riskVerdictSchema,
  stockAnalysisSchema,
  stockMetricsSchema,
  stockPricePointSchema,
  stockReportSchema,
  trendVerdictSchema,
} from "../lib/reportSchema";

/**
 * Frontend contract types, inferred from the same zod schema used to validate
 * responses, so the runtime check and the static types can never drift.
 */

export type TrendVerdict = z.infer<typeof trendVerdictSchema>;
export type MomentumVerdict = z.infer<typeof momentumVerdictSchema>;
export type RiskVerdict = z.infer<typeof riskVerdictSchema>;
export type StockPricePoint = z.infer<typeof stockPricePointSchema>;
export type StockMetrics = z.infer<typeof stockMetricsSchema>;
export type StockAnalysis = z.infer<typeof stockAnalysisSchema>;
export type CacheMetadata = z.infer<typeof cacheMetadataSchema>;
export type StockReport = z.infer<typeof stockReportSchema>;

/** Unified error contract returned by the backend. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
