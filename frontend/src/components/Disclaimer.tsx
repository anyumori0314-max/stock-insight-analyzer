/**
 * Always-visible disclaimer footer. Pinned regardless of state so the product
 * never reads as investment advice. Kept consistent with the API `disclaimer`
 * field and the README disclaimer section.
 */
export function Disclaimer() {
  return (
    <footer className="disclaimer">
      <strong>免責事項</strong>
      <ul className="disclaimer__list">
        <li>本ツールは情報提供を目的としたものであり、投資助言や特定銘柄の売買推奨ではありません。</li>
        <li>表示データの正確性・完全性・即時性を保証するものではありません。</li>
        <li>過去の実績は将来の成果を保証するものではありません。</li>
        <li>
          価格は分割・配当調整前の終値（raw close）を使用しており、調整後の値とは異なる場合があります。
        </li>
        <li>外部データ提供元（Alpha Vantage）の遅延・停止・利用制限が生じる場合があります。</li>
        <li>投資に関する最終的な判断は、利用者ご自身の責任で行ってください。</li>
      </ul>
    </footer>
  );
}
