/**
 * Signal Strength Scorer
 * ----------------------
 * Computes a 0-100 strength score for a stock pick, blending four factors:
 *
 *   30% — Unique sources (how many distinct platforms mention the ticker)
 *   25% — Mention volume (total alerts + signal changes for this ticker)
 *   25% — Velocity (how fast the price/mentions are accelerating)
 *   20% — Sentiment + analyst consensus
 *
 * Bucket mapping:
 *   0-39   Weak         (1 bar)
 *   40-59  Moderate     (2 bars)
 *   60-79  Strong       (3 bars)
 *   80-100 Very Strong  (4 bars)
 *
 * Weights are also surfaced to the dashboard Settings page as a reference
 * table so AJ can see how each score was calculated.
 */

export const SIGNAL_WEIGHTS = {
  source_count: 0.30,
  mention_count: 0.25,
  velocity: 0.25,
  sentiment: 0.20,
};

export const SIGNAL_BUCKETS = [
  { min: 80, max: 100, label: 'Very Strong', bars: 4, color: '#00e676' },
  { min: 60, max: 79,  label: 'Strong',      bars: 3, color: '#76ff03' },
  { min: 40, max: 59,  label: 'Moderate',    bars: 2, color: '#ffc107' },
  { min: 0,  max: 39,  label: 'Weak',        bars: 1, color: '#9e9e9e' },
];

export function bucketFor(score) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  return SIGNAL_BUCKETS.find(b => s >= b.min && s <= b.max) || SIGNAL_BUCKETS[3];
}

/**
 * Build a per-ticker activity map from the full alerts + signal_changes list.
 * Used so we can score each alert in O(1) time during the main loop.
 */
export function buildActivityIndex(allAlerts = [], signalChanges = []) {
  const idx = {};
  for (const a of allAlerts) {
    const t = (a.ticker || '').toUpperCase();
    if (!t) continue;
    if (!idx[t]) idx[t] = { sources: new Set(), mentionCount: 0, signalChanges: 0 };
    const src = (a.source || 'unknown').toLowerCase().trim();
    // Handle comma-separated sources like "wsb,reddit"
    src.split(/[,;|/]+/).forEach(s => {
      const clean = s.trim();
      if (clean && clean !== 'unknown') idx[t].sources.add(clean);
    });
    idx[t].mentionCount += 1;
  }
  for (const sc of signalChanges) {
    const t = (sc.ticker || '').toUpperCase();
    if (!t || !idx[t]) continue;
    idx[t].signalChanges += 1;
  }
  return idx;
}

/**
 * Compute the four sub-scores (0-100) for a single alert, plus the final
 * weighted signal_strength score.
 */
export function computeSignalStrength(alert, activityIndex = {}) {
  const t = (alert?.ticker || '').toUpperCase();
  const activity = activityIndex[t] || { sources: new Set(), mentionCount: 0, signalChanges: 0 };

  // --- Source score (30%) ---
  // 1 source = 20, 2 = 45, 3 = 65, 4 = 80, 5+ = 100
  const srcN = activity.sources.size || 1;
  const sourceScore = Math.min(100, [0, 20, 45, 65, 80, 100][Math.min(srcN, 5)] || 100);

  // --- Mention-volume score (25%) ---
  // Total mentions = alerts for this ticker + signal-change events.
  // 1 mention = 15, 2 = 35, 3 = 55, 5 = 75, 8+ = 100 (log-ish curve)
  const mentions = (activity.mentionCount || 0) + (activity.signalChanges || 0);
  let mentionScore;
  if (mentions <= 1) mentionScore = 15;
  else if (mentions <= 2) mentionScore = 35;
  else if (mentions <= 3) mentionScore = 55;
  else if (mentions <= 5) mentionScore = 75;
  else if (mentions <= 8) mentionScore = 90;
  else mentionScore = 100;

  // --- Velocity score (25%) ---
  // Acceleration of the stock itself: last day's pct_change vs avg of prior days.
  const prices = Array.isArray(alert?.prices) ? alert.prices : [];
  let velocityScore = 30; // neutral default
  if (prices.length >= 2) {
    const last = Math.abs(parseFloat(prices[prices.length - 1]?.pct_change) || 0);
    const priorArr = prices.slice(0, -1).map(p => Math.abs(parseFloat(p.pct_change) || 0));
    const priorAvg = priorArr.length
      ? priorArr.reduce((s, x) => s + x, 0) / priorArr.length
      : 0;
    const accel = last - priorAvg; // positive => accelerating
    // Map: accel <= 0 => 20, 0-1% => 40, 1-3% => 60, 3-6% => 80, 6%+ => 100
    if (accel <= 0) velocityScore = 20;
    else if (accel <= 1) velocityScore = 40;
    else if (accel <= 3) velocityScore = 60;
    else if (accel <= 6) velocityScore = 80;
    else velocityScore = 100;
  }

  // --- Sentiment + analyst score (20%) ---
  // Blend the recommendation field (BUY/HOLD/SELL) with any analyst_breakdown
  // attached to the alert by the API (optional: { strongBuy, buy, hold, sell, strongSell }).
  const rec = (alert?.recommendation || 'HOLD').toUpperCase();
  let recScore;
  if (rec === 'STRONG BUY' || rec === 'STRONG_BUY') recScore = 100;
  else if (rec === 'BUY') recScore = 80;
  else if (rec === 'HOLD') recScore = 50;
  else if (rec === 'UNDERPERFORM') recScore = 25;
  else if (rec === 'SELL') recScore = 10;
  else recScore = 50;

  let analystScore = null;
  const br = alert?.analyst_breakdown;
  if (br && (br.strongBuy + br.buy + br.hold + br.sell + br.strongSell) > 0) {
    const total = br.strongBuy + br.buy + br.hold + br.sell + br.strongSell;
    // Weighted: strongBuy=100, buy=75, hold=50, sell=20, strongSell=0
    analystScore = (
      100 * br.strongBuy + 75 * br.buy + 50 * br.hold + 20 * br.sell + 0 * br.strongSell
    ) / total;
  }

  // If we have analyst data, blend 60% analyst / 40% recommendation.
  const sentimentScore = analystScore != null
    ? 0.6 * analystScore + 0.4 * recScore
    : recScore;

  // --- Weighted total ---
  const total = Math.round(
    SIGNAL_WEIGHTS.source_count * sourceScore +
    SIGNAL_WEIGHTS.mention_count * mentionScore +
    SIGNAL_WEIGHTS.velocity * velocityScore +
    SIGNAL_WEIGHTS.sentiment * sentimentScore
  );

  return {
    signal_strength: total,
    source_count: srcN,
    mention_count: mentions,
    velocity_score: Math.round(velocityScore),
    sentiment_score: Math.round(sentimentScore),
    sub_scores: {
      source: Math.round(sourceScore),
      mention: Math.round(mentionScore),
      velocity: Math.round(velocityScore),
      sentiment: Math.round(sentimentScore),
    },
  };
}
