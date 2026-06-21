import type {
  MomentumVerdict,
  RiskVerdict,
  StockAnalysis,
  TrendVerdict,
} from "../types/stock";

interface AnalysisPanelProps {
  analysis: StockAnalysis;
}

type BadgeTone = "good" | "bad" | "warn" | "neutral";

const TREND_LABELS: Record<TrendVerdict, { text: string; tone: BadgeTone }> = {
  uptrend: { text: "上昇基調", tone: "good" },
  downtrend: { text: "下落基調", tone: "bad" },
  sideways: { text: "横ばい", tone: "warn" },
  unknown: { text: "判定不可", tone: "neutral" },
};

const MOMENTUM_LABELS: Record<MomentumVerdict, { text: string; tone: BadgeTone }> = {
  overbought: { text: "買われ過ぎ", tone: "warn" },
  oversold: { text: "売られ過ぎ", tone: "warn" },
  neutral: { text: "中立", tone: "neutral" },
  unknown: { text: "判定不可", tone: "neutral" },
};

const RISK_LABELS: Record<RiskVerdict, { text: string; tone: BadgeTone }> = {
  low: { text: "低", tone: "good" },
  medium: { text: "中", tone: "warn" },
  high: { text: "高", tone: "bad" },
  unknown: { text: "判定不可", tone: "neutral" },
};

function Badge({ caption, text, tone }: { caption: string; text: string; tone: BadgeTone }) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="muted">{caption}</span>
      {text}
    </span>
  );
}

export function AnalysisPanel({ analysis }: AnalysisPanelProps) {
  const trend = TREND_LABELS[analysis.trend];
  const momentum = MOMENTUM_LABELS[analysis.momentum];
  const risk = RISK_LABELS[analysis.risk];

  return (
    <div>
      <div className="score">
        <span className="score__value">{analysis.score ?? "—"}</span>
        <span className="score__max">/ 100 テクニカル状態スコア</span>
      </div>
      <p className="score-note">
        この数値は複数のテクニカル指標を便宜的にまとめた参考値であり、売買判断・将来リターン・推奨度を示すものではありません。
      </p>

      <div className="badge-row">
        <Badge caption="トレンド" text={trend.text} tone={trend.tone} />
        <Badge caption="過熱感" text={momentum.text} tone={momentum.tone} />
        <Badge caption="リスク" text={risk.text} tone={risk.tone} />
      </div>

      <ul className="comment-list">
        {analysis.comments.map((comment, index) => (
          <li key={index}>{comment}</li>
        ))}
      </ul>
    </div>
  );
}
