"use client";

import { useMemo, useState } from "react";
import { groupDailyTrend, type TrendGroup } from "@/lib/trend-groups";
import type { DailyTrendPoint } from "@/lib/types";

const width = 480, height = 250;
const plot = { left: 60, right: 42, top: 22, bottom: 42 };
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const metricText = (value: number | null, suffix: string) => value === null ? "표본 없음" : `${number.format(value)}${suffix}`;

type Metric = "winRate" | "averageRank";
function TrendPlot({ groups, metric, selectedIndex, onSelect }: {
  groups: TrendGroup[]; metric: Metric; selectedIndex: number; onSelect: (index: number) => void;
}) {
  const isWinRate = metric === "winRate";
  const title = isWinRate ? "구간별 승률" : "구간별 평균 순위";
  const suffix = isWinRate ? "%" : "위";
  const maximumRank = groups.reduce((highest, group) => Math.max(highest, Math.ceil(group.averageRank ?? 1)), 2);
  const x = (index: number) => plot.left + (groups.length === 1 ? 0.5 : index / (groups.length - 1)) * (width - plot.left - plot.right);
  const y = (value: number) => plot.top + (isWinRate ? 1 - value / 100 : (value - 1) / (maximumRank - 1)) * (height - plot.top - plot.bottom);
  const plotted = groups.filter(group => group[metric] !== null);
  const lines = groups.slice(1).flatMap((group, index) => {
    const previous = groups[index];
    const previousValue = previous[metric], value = group[metric];
    return previousValue !== null && value !== null
      ? [{ a: previous, b: group, first: previousValue, second: value }] : [];
  });
  const id = `trend-${metric}`;
  return <article className="trend-card">
    <div className="trend-card-head"><h3>{title}</h3><span>{isWinRate ? "유효 순위 경기 중 승리 비율" : "낮을수록 좋은 순위"}</span></div>
    <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{title} 그래프</title>
      <desc id={`${id}-desc`}>선택 기간을 최대 7개 달력 날짜 구간으로 묶었습니다. 경기가 없거나 순위 표본이 없는 구간은 선으로 연결하지 않습니다.</desc>
      {[0, 0.5, 1].map(fraction => {
        const position = plot.top + fraction * (height - plot.top - plot.bottom);
        const label = isWinRate ? `${Math.round((1 - fraction) * 100)}%` : `${number.format(1 + fraction * (maximumRank - 1))}위`;
        return <g key={fraction}><line className="trend-grid-line" x1={plot.left} x2={width - plot.right} y1={position} y2={position}/><text className="trend-axis-label" x={plot.left - 8} y={position + 4} textAnchor="end">{label}</text></g>;
      })}
      {lines.map(line => <line key={`${line.a.index}-${line.b.index}`} className={`trend-line ${metric}`} x1={x(line.a.index)} y1={y(line.first)} x2={x(line.b.index)} y2={y(line.second)}/>)}
      {plotted.map(group => <g key={group.index} className="trend-point-control" role="button" tabIndex={0} aria-label={`${group.label}, ${group.startDate}부터 ${group.endDate}까지, ${title} ${metricText(group[metric], suffix)}, ${group.games}경기 중 순위 표본 ${group.rankSamples}경기`} aria-pressed={selectedIndex === group.index}
        onPointerEnter={() => onSelect(group.index)} onClick={() => onSelect(group.index)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(group.index); } }}>
        <circle className="trend-hit" cx={x(group.index)} cy={y(group[metric]!)} r={16}/>
        <circle className={`trend-point ${metric} ${selectedIndex === group.index ? "selected" : ""}`} cx={x(group.index)} cy={y(group[metric]!)} r={5}/>
      </g>)}
      {groups.map(group => <text key={group.index} className="trend-range-label" x={x(group.index)} y={height - 7} textAnchor="middle">{group.tickLabel}</text>)}
      {plotted.length === 0 && <text className="trend-empty-label" x={width / 2} y={height / 2} textAnchor="middle">순위 표본이 없습니다</text>}
    </svg>
  </article>;
}

export function TrendCharts({ trend, startDate, endDate, selectedCharacterCount }: {
  trend: DailyTrendPoint[]; startDate: string; endDate: string; selectedCharacterCount: number;
}) {
  const groups = useMemo(() => groupDailyTrend(trend, startDate, endDate), [trend, startDate, endDate]);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, groups.findLastIndex(group => group.games > 0)));
  const selected = groups[selectedIndex] ?? groups[0];
  return <section className="data-section trend-section" aria-labelledby="trend-heading">
    <div className="section-heading"><div><span className="section-kicker">PERIOD PERFORMANCE</span><h2 id="trend-heading">기간별 추이</h2></div><span className="section-count">{groups.length}개 구간</span></div>
    <p className="section-explainer">선택 조건에 맞는 수집 경기{selectedCharacterCount > 0 ? ` · 선택 실험체 ${selectedCharacterCount}개 합산` : " · 전체 실험체 합산"} · 한국 시간 기준입니다. 선택한 기간을 최대 7개 구간으로 나누고, 순위 기록이 없는 구간은 비워 둡니다.</p>
    {trend.length === 0 && <p className="trend-no-games">선택 조건에 맞는 수집 경기가 없습니다. 각 구간의 승률과 평균 순위는 표본 없음으로 표시됩니다.</p>}
    <div className="trend-grid"><TrendPlot groups={groups} metric="winRate" selectedIndex={selected?.index ?? 0} onSelect={setSelectedIndex}/><TrendPlot groups={groups} metric="averageRank" selectedIndex={selected?.index ?? 0} onSelect={setSelectedIndex}/></div>
    {selected && <div className="trend-selected"><div className="trend-day-navigation"><button type="button" aria-label="이전 구간" disabled={selectedIndex <= 0} onClick={() => setSelectedIndex(selectedIndex - 1)}>‹</button><strong aria-live="polite">{selected.label} · {selected.startDate}{selected.startDate === selected.endDate ? "" : ` ~ ${selected.endDate}`} (KST)</strong><button type="button" aria-label="다음 구간" disabled={selectedIndex >= groups.length - 1} onClick={() => setSelectedIndex(selectedIndex + 1)}>›</button></div><span>{selected.games}경기 / {selected.wins}승</span><span>승률 {metricText(selected.winRate, "%")}</span><span>평균 순위 {metricText(selected.averageRank, "위")}</span><span>순위 표본 {selected.rankSamples}경기</span></div>}
    <details className="trend-details"><summary>구간별 수치 표 보기</summary><div className="trend-table-scroll"><table><thead><tr><th scope="col">구간</th><th scope="col">날짜 (KST)</th><th scope="col">경기</th><th scope="col">승리</th><th scope="col">순위 표본</th><th scope="col">승률</th><th scope="col">평균 순위</th></tr></thead><tbody>{groups.map(group => <tr key={group.index}><td><button type="button" className="trend-day-button" onClick={() => setSelectedIndex(group.index)} aria-pressed={selected?.index === group.index}>{group.label}</button></td><td>{group.startDate} ~ {group.endDate}</td><td>{group.games}</td><td>{group.wins}</td><td>{group.rankSamples}</td><td>{metricText(group.winRate, "%")}</td><td>{metricText(group.averageRank, "위")}</td></tr>)}</tbody></table></div></details>
  </section>;
}
