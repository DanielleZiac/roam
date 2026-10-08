/*
 * Small charts for the dashboard, drawn with plain SVG and HTML so the app
 * needs no charting library. Each chart has a text description for screen
 * readers, and every value is also shown as a number.
 */
import type { ReactNode } from "react";

export const CHART_COLORS = {
  demand: "#4b2be0",
  stock: "#0e8a80",
  muted: "#616161",
  track: "#ebebeb",
  // Suggested and added to cart share one bar, so the two must stand apart from each other and from white.
  suggested: "#8f7df0",
  added: "#2e1a8c",
  good: "#0e8a80",
  weak: "#b98900",
  text: "#303030",
  // One colour per slice, in order. Slices are also labelled with their numbers, so colour is never the only cue.
  series: ["#4b2be0", "#0e8a80", "#b98900", "#c2417a", "#3d6fb8", "#8a8a8a"],
};

const numberStyle = { fontSize: 13, color: CHART_COLORS.text, fontVariantNumeric: "tabular-nums" } as const;

// --- Stat tile: one big number with a label and a short note -------------------

export function StatTile({
  label,
  value,
  note,
  visual,
}: {
  label: string;
  // Left out when the picture already shows the number.
  value?: string;
  // A line break in the note is kept, so a note can be split where it reads best.
  note?: string;
  // An optional picture of the value, shown between the label and the number.
  visual?: ReactNode;
}) {
  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#616161" }}>{label}</div>
      {visual ? <div style={{ margin: "8px 0 2px" }}>{visual}</div> : null}
      {value ? (
        <div style={{ fontSize: 24, fontWeight: 650, lineHeight: 1.2, margin: "4px 0", color: CHART_COLORS.text }}>{value}</div>
      ) : null}
      {note ? <div style={{ fontSize: 13, color: "#616161", marginTop: value ? 0 : 6, whiteSpace: "pre-line" }}>{note}</div> : null}
    </div>
  );
}

// --- Stat grid: four tiles in one row, or two rows of two where there is less room ---

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ containerType: "inline-size" }}>
      <style>{`
        .roam-stat-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @container (min-width: 560px) { .roam-stat-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      `}</style>
      <div className="roam-stat-grid">{children}</div>
    </div>
  );
}

// --- Stars: a rating out of five, filled to the nearest tenth of a star -----------

const STAR_PATH = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

export function Stars({ rating }: { rating: number }) {
  const row = (color: string) =>
    [0, 1, 2, 3, 4].map((index) => (
      <svg key={index} viewBox="0 0 24 24" style={{ width: "20%", height: "auto", flex: "none" }}>
        <path d={STAR_PATH} fill={color} />
      </svg>
    ));

  return (
    <div
      role="img"
      aria-label={`${rating.toFixed(1)} out of 5 stars`}
      style={{ position: "relative", display: "flex", width: "100%", maxWidth: 120 }}
    >
      {row(CHART_COLORS.track)}
      {/* The filled stars sit on top and are cut off at the rating. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          clipPath: `inset(0 ${100 - Math.max(0, Math.min(5, rating)) * 20}% 0 0)`,
        }}
      >
        {row(CHART_COLORS.weak)}
      </div>
    </div>
  );
}

// --- Pie chart: shares of a whole, with every slice listed beside it --------------

export function PieChart({
  label,
  data,
  description,
  emptyText,
}: {
  label: string;
  data: { label: string; value: number; color?: string }[];
  description: string;
  emptyText: string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 50;
  let angle = -Math.PI / 2;

  const slices = data.map((slice, index) => {
    const sweep = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    const point = (at: number) => `${(radius * Math.cos(at)).toFixed(2)} ${(radius * Math.sin(at)).toFixed(2)}`;
    return {
      ...slice,
      color: slice.color ?? CHART_COLORS.series[index % CHART_COLORS.series.length],
      percent: total > 0 ? Math.round((slice.value / total) * 100) : 0,
      // A single slice that fills the pie cannot be drawn as an arc, so it becomes a circle below.
      path: `M 0 0 L ${point(start)} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(angle)} Z`,
    };
  });

  const largest = slices.reduce((top, slice) => (slice.value > top.value ? slice : top), slices[0]);

  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#616161", marginBottom: 12 }}>{label}</div>
      {total === 0 ? (
        <div style={{ fontSize: 13, color: "#616161" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {/* When the card is narrow the pie shrinks, so the largest slice's name and count stay on one line. */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <svg viewBox="-52 -52 104 104" role="img" aria-label={description} style={{ flex: "0 1 120px", minWidth: 40, height: "auto" }}>
              {slices.length === 1 ? (
                <circle r={radius} fill={slices[0].color} />
              ) : (
                slices.map((slice) => (
                  <path key={slice.label} d={slice.path} fill={slice.color} stroke="#fff" strokeWidth="1">
                    <title>{`${slice.label}: ${slice.value} (${slice.percent}%)`}</title>
                  </path>
                ))
              )}
            </svg>
            {/* The largest slice, spelled out so the main point reads at a glance. */}
            <div style={{ flex: "none", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 36, fontWeight: 650, lineHeight: 1.1, color: CHART_COLORS.text }}>{largest.percent}%</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, ...numberStyle }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: largest.color, flex: "none" }} aria-hidden="true" />
                <span>
                  {largest.label} ({largest.value})
                </span>
              </div>
            </div>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {slices
              .filter((slice) => slice !== largest)
              .map((slice) => (
                <li
                  key={slice.label}
                  style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 8, alignItems: "center", ...numberStyle }}
                >
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: slice.color }} aria-hidden="true" />
                  <span>
                    {slice.label} ({slice.value})
                  </span>
                  <span>{slice.percent}%</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Half pie: one share of a whole, as a half ring with the percentage inside it ---

export function HalfPie({ percent, description }: { percent: number; description: string }) {
  const outer = 50;
  const inner = 31;
  const share = Math.max(0, Math.min(100, percent)) / 100;
  // The half ring runs from the left edge (angle pi), over the top, to the right edge (angle 0).
  const point = (radius: number, angle: number) => `${(radius * Math.cos(angle)).toFixed(2)} ${(-radius * Math.sin(angle)).toFixed(2)}`;
  const band = (from: number, to: number) =>
    `M ${point(outer, from)} A ${outer} ${outer} 0 0 1 ${point(outer, to)} L ${point(inner, to)} A ${inner} ${inner} 0 0 0 ${point(inner, from)} Z`;
  const split = Math.PI * (1 - share);
  // A sliver of white keeps the two parts apart, so the split does not rely on colour alone.
  const gap = share > 0 && share < 1 ? 0.025 : 0;

  return (
    <svg
      viewBox="-52 -52 104 54"
      role="img"
      aria-label={description}
      style={{ display: "block", width: "100%", maxWidth: 96, height: "auto" }}
    >
      {share > 0 ? <path d={band(Math.PI, split + gap)} fill={CHART_COLORS.good} /> : null}
      {share < 1 ? <path d={band(split - gap, 0)} fill={CHART_COLORS.track} /> : null}
      <text x="0" y="-1" textAnchor="middle" fontSize="19" fontWeight="650" fill={CHART_COLORS.text}>
        {percent}%
      </text>
    </svg>
  );
}

// --- Column chart: one column per day -------------------------------------------

export function ColumnChart({ data, description }: { data: { label: string; value: number }[]; description: string }) {
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
      <div style={{ width: `${Math.min(100, (percent / scale) * 100)}%`, background: color, borderRadius: 4, height: 12 }} />
    </div>
  );
}

// --- Overlap bar: a part drawn on top of its whole, e.g. added to cart on top of suggested ---

export function OverlapBar({ outer, inner, scale }: { outer: number; inner: number; scale: number }) {
  const width = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;

  return (
    <div style={{ position: "relative", background: CHART_COLORS.track, borderRadius: 4, height: 12 }} aria-hidden="true">
      <div style={{ position: "absolute", inset: 0, width: width(outer), background: CHART_COLORS.suggested, borderRadius: 4 }} />
      <div style={{ position: "absolute", inset: 0, width: width(inner), background: CHART_COLORS.added, borderRadius: 4 }} />
    </div>
  );
}

// --- Marker bar: one value as a bar, with a marker showing a second value to compare it to ---

export function MarkerBar({ value, marker, scale }: { value: number; marker: number; scale: number }) {
  const at = (percent: number) => `${Math.min(100, (percent / scale) * 100)}%`;

  return (
    <div style={{ position: "relative", background: CHART_COLORS.track, borderRadius: 4, height: 12 }} aria-hidden="true">
      <div style={{ width: at(value), background: CHART_COLORS.demand, borderRadius: 4, height: 12 }} />
      {/* White edges keep the marker visible where it crosses the bar. */}
      <div
        style={{
          position: "absolute",
          top: -4,
          bottom: -4,
          left: at(marker),
          width: 3,
          marginLeft: -1.5,
          background: CHART_COLORS.text,
          boxShadow: "0 0 0 1.5px #fff",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

// --- Chart card: a labelled white box around any chart ---------------------------

export function ChartCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff" }}>
      <div style={{ fontSize: 13, color: "#616161", marginBottom: 12 }}>{label}</div>
      {children}
    </div>
  );
}

// --- Rate bars: one bar per row, with a line marking the average -----------------

export function RateBars({
  rows,
  average,
  max,
}: {
  rows: { key: string; label: ReactNode; percent: number; text: string; weak: boolean; aside: ReactNode }[];
  average: number;
  // The value a full-width bar stands for. Set it to compare two charts on the same scale.
  max?: number;
}) {
  const scale = Math.max(20, average, max ?? 0, ...rows.map((row) => row.percent));

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
