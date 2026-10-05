/*
 * Small charts for the dashboard, drawn with plain SVG and HTML so the app
 * needs no charting library. Each chart has a text description for screen
 * readers, and every value is also shown as a number.
 */
import type { ReactNode } from "react";

export const CHART_COLORS = {
  demand: "#4b2be0",
  stock: "#0e8a80",
  muted: "#8a8a8a",
  track: "#ebebeb",
  good: "#0e8a80",
  weak: "#b98900",
  text: "#303030",
};

const numberStyle = { fontSize: 13, color: CHART_COLORS.text, fontVariantNumeric: "tabular-nums" } as const;

// --- Stat tile: one big number with a label and a short note -------------------

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#616161" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 650, lineHeight: 1.2, margin: "4px 0", color: CHART_COLORS.text }}>
        {value}
      </div>
      {note ? <div style={{ fontSize: 13, color: "#616161" }}>{note}</div> : null}
    </div>
  );
}

// --- Column chart: one column per day -------------------------------------------

export function ColumnChart({
  data,
  description,
}: {
  data: { label: string; value: number }[];
  description: string;
}) {
  const width = 640;
  const height = 180;
  const left = 28;
  const bottom = 22;
  const top = 8;
  const max = Math.max(1, ...data.map((point) => point.value));
  const niceMax = Math.ceil(max / 2) * 2;
  const plotWidth = width - left;
  const plotHeight = height - bottom - top;
  const step = plotWidth / data.length;
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description} style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map((fraction) => {
        const y = top + plotHeight * (1 - fraction);
        return (
          <g key={fraction}>
            <line x1={left} x2={width} y1={y} y2={y} stroke={CHART_COLORS.track} />
            <text x={left - 6} y={y + 4} textAnchor="end" fontSize="11" fill={CHART_COLORS.muted}>
              {Math.round(niceMax * fraction)}
            </text>
          </g>
        );
      })}
      {data.map((point, index) => {
        const barHeight = (point.value / niceMax) * plotHeight;
        const x = left + index * step;
        return (
          <g key={point.label}>
            <rect
              x={x + step * 0.15}
              y={top + plotHeight - barHeight}
              width={step * 0.7}
              height={barHeight}
              rx="2"
              fill={CHART_COLORS.demand}
            >
              <title>{`${point.label}: ${point.value}`}</title>
            </rect>
            {index % labelEvery === 0 ? (
              <text x={x + step / 2} y={height - 6} textAnchor="middle" fontSize="11" fill={CHART_COLORS.muted}>
                {point.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// --- Legend ---------------------------------------------------------------------

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: CHART_COLORS.text }}>
      {items.map((item) => (
        <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Track({ percent, color, scale }: { percent: number; color: string; scale: number }) {
  return (
    <div style={{ background: CHART_COLORS.track, borderRadius: 4, height: 12 }} aria-hidden="true">
      <div
        style={{ width: `${Math.min(100, (percent / scale) * 100)}%`, background: color, borderRadius: 4, height: 12 }}
      />
    </div>
  );
}

// --- Paired bars: two values per row, e.g. demand against stock ------------------

export function PairedBars({
  rows,
  firstLabel,
  secondLabel,
}: {
  rows: { key: string; label: string; first: number; second: number; firstText: string; secondText: string; aside: ReactNode }[];
  firstLabel: string;
  secondLabel: string;
}) {
  const scale = Math.max(10, ...rows.flatMap((row) => [row.first, row.second]));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2.2fr) auto", gap: 12, alignItems: "center" }}
        >
          <div style={{ fontSize: 14, fontWeight: 550, color: CHART_COLORS.text }}>{row.label}</div>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8, alignItems: "center" }}>
              <Track percent={row.first} color={CHART_COLORS.demand} scale={scale} />
              <span style={numberStyle}>
                <span style={{ position: "absolute", left: -9999 }}>{firstLabel}: </span>
                {row.firstText}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8, alignItems: "center" }}>
              <Track percent={row.second} color={CHART_COLORS.stock} scale={scale} />
              <span style={numberStyle}>
                <span style={{ position: "absolute", left: -9999 }}>{secondLabel}: </span>
                {row.secondText}
              </span>
            </div>
          </div>
          <div>{row.aside}</div>
        </div>
      ))}
    </div>
  );
}

// --- Rate bars: one bar per row, with a line marking the average -----------------

export function RateBars({
  rows,
  average,
}: {
  rows: { key: string; label: ReactNode; percent: number; text: string; weak: boolean; aside: ReactNode }[];
  average: number;
}) {
  const scale = Math.max(20, average, ...rows.map((row) => row.percent));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2.2fr) auto", gap: 12, alignItems: "center" }}
        >
          <div style={{ fontSize: 14, color: CHART_COLORS.text }}>{row.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 92px", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative" }} aria-hidden="true">
              <Track percent={row.percent} color={row.weak ? CHART_COLORS.weak : CHART_COLORS.good} scale={scale} />
              <div
                style={{
                  position: "absolute",
                  top: -3,
                  bottom: -3,
                  left: `${(average / scale) * 100}%`,
                  width: 2,
                  background: CHART_COLORS.text,
                }}
              />
            </div>
            <span style={numberStyle}>{row.text}</span>
          </div>
          <div>{row.aside}</div>
        </div>
      ))}
    </div>
  );
}
