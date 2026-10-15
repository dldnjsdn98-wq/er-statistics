"use client";

import { Fragment, useMemo, useState } from "react";
import { sortCharacterRows, type CharacterSortKey, type SortDirection } from "@/lib/character-sort";
import type { Match, StatsResponse } from "@/lib/types";

const integer = new Intl.NumberFormat("ko-KR");
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const whole = (value: number | null) => value === null ? "—" : integer.format(value);
const average = (value: number | null) => value === null ? "—" : decimal.format(value);
const percent = (value: number | null) => value === null ? "—" : `${decimal.format(value)}%`;
const columns: Array<{ key: CharacterSortKey; label: string; defaultDirection: SortDirection }> = [
  { key: "games", label: "게임", defaultDirection: "desc" },
  { key: "winRate", label: "승률", defaultDirection: "desc" },
  { key: "averageRank", label: "평균 순위", defaultDirection: "asc" },
  { key: "averageKills", label: "평균 킬", defaultDirection: "desc" },
  { key: "averageAssists", label: "평균 어시스트", defaultDirection: "desc" },
  { key: "averageDamage", label: "평균 피해량", defaultDirection: "desc" },
];

export function CharacterComparison({ rows, selectedCount }: { rows: StatsResponse["characters"]; selectedCount: number }) {
  const [sort, setSort] = useState<{ key: CharacterSortKey; direction: SortDirection }>({ key: "games", direction: "desc" });
  const sorted = useMemo(() => sortCharacterRows(rows, sort.key, sort.direction), [rows, sort]);
  const sortBy = (key: CharacterSortKey) => {
    const column = columns.find(item => item.key === key)!;
    setSort(current => ({ key, direction: current.key === key ? current.direction === "asc" ? "desc" : "asc" : column.defaultDirection }));
  };
  const setSortKey = (key: CharacterSortKey) => setSort({ key, direction: columns.find(item => item.key === key)!.defaultDirection });
  return <section className="data-section comparison-section" aria-labelledby="comparison-heading">
    <div className="section-heading"><div><span className="section-kicker">CHARACTER BREAKDOWN</span><h2 id="comparison-heading">실험체별 성적 비교</h2></div><span className="section-count">{selectedCount ? `선택 ${selectedCount}개` : `관측 ${rows.length}개`}</span></div>
    <p className="section-explainer">선택 조건의 전체 수집 경기 기준입니다. 승률과 평균 순위는 순위가 있는 경기만 계산하며, 기록이 없는 선택 실험체도 표시합니다.</p>
    <div className="comparison-mobile-sort"><label>비교 정렬 기준 <select value={sort.key} onChange={event => setSortKey(event.target.value as CharacterSortKey)}>{columns.map(column => <option value={column.key} key={column.key}>{column.label}</option>)}</select></label><button type="button" onClick={() => setSort(current => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))}>정렬 방향: {sort.direction === "asc" ? "오름차순" : "내림차순"}</button></div>
    <div className="table-wrap comparison-wrap"><table className="comparison-table"><thead><tr><th scope="col">실험체</th>{columns.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="sort-button" onClick={() => sortBy(column.key)} aria-label={`${column.label} 기준 정렬`}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead>
      <tbody>{sorted.map(character => <tr key={character.code} className={character.games === 0 ? "zero-game-row" : ""}><td data-label="실험체"><span className="game-character"><span className="character-dot">{character.name.slice(0, 1)}</span><span>{character.name}<small className="character-code">#{character.code}</small></span></span></td><td data-label="게임" className="emphasis">{whole(character.games)}</td><td data-label="승률"><div className="winrate-cell"><span>{percent(character.winRate)}</span><span className="winrate-track" aria-hidden="true"><span style={{ width: `${character.winRate ?? 0}%` }}/></span></div></td><td data-label="평균 순위">{average(character.averageRank)}</td><td data-label="평균 킬">{average(character.averageKills)}</td><td data-label="평균 어시스트">{average(character.averageAssists)}</td><td data-label="평균 피해량">{whole(character.averageDamage === null ? null : Math.round(character.averageDamage))}</td></tr>)}{rows.length === 0 && <tr><td colSpan={7} className="empty-table">해당 조건의 실험체 기록이 없습니다.</td></tr>}</tbody>
    </table></div>
  </section>;
}

const kstTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const modeLabel = (mode: Match["mode"]) => mode === "ranked" ? "랭크" : mode === "normal" ? "일반" : "기타";

function MatchRow({ game }: { game: Match }) {
  const result = game.rank === null ? "순위 없음" : game.rank === 1 ? "1위 · 승리" : `${game.rank}위`;
  return <tr className="history-game-row"><td data-label="시작 시각"><time dateTime={game.startedAt}>{kstTime.format(new Date(game.startedAt))}</time></td><td data-label="결과"><span className={`rank-tag ${game.rank === 1 ? "win" : ""}`}>{result}</span></td><td data-label="실험체"><span className="game-character"><span className="character-dot">{game.characterName.slice(0, 1)}</span>{game.characterName}</span></td><td data-label="모드"><span className={`mode-tag ${game.mode}`}>{modeLabel(game.mode)}</span></td><td data-label="킬 / 어시스트">{whole(game.kills)} / {whole(game.assists)}</td><td data-label="피해량">{whole(game.damage)}</td></tr>;
}

export function MatchHistory({ matches, pagination, loading, onPage, onPageSize }: {
  matches: Match[]; pagination: StatsResponse["pagination"]; loading: boolean;
  onPage: (page: number) => void; onPageSize: (pageSize: number) => void;
}) {
  const first = matches.length ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const last = first ? first + matches.length - 1 : 0;
  return <section className="data-section recent-section" aria-labelledby="history-heading">
    <div className="section-heading"><div><span className="section-kicker">MATCH HISTORY</span><h2 id="history-heading">최근 게임</h2></div><span className="section-count">전체 {whole(pagination.total)}경기</span></div>
    <div className="history-toolbar"><p>현재 페이지의 게임을 한국 시간 날짜별로 묶었습니다. {first ? `${whole(first)}–${whole(last)}번째 경기` : "표시할 경기가 없습니다."}</p><label>페이지당 경기 수 <select aria-label="페이지당 경기 수" value={pagination.pageSize} onChange={event => onPageSize(Number(event.target.value))} disabled={loading}>{![20, 50, 100].includes(pagination.pageSize) && <option value={pagination.pageSize}>{pagination.pageSize} (공유 링크)</option>}<option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
    <div className="table-wrap history-wrap"><table className="history-table"><thead><tr><th scope="col">시작 시각 (KST)</th><th scope="col">결과</th><th scope="col">실험체</th><th scope="col">모드</th><th scope="col">킬 / 어시스트</th><th scope="col">피해량</th></tr></thead><tbody>{matches.map((game, index) => {
      const date = kstDay(game.startedAt);
      return <Fragment key={game.gameId}>{(index === 0 || date !== kstDay(matches[index - 1].startedAt)) && <tr className="history-date-row"><th scope="colgroup" colSpan={6}>{date} · KST</th></tr>}<MatchRow game={game}/></Fragment>;
    })}{matches.length === 0 && <tr><td colSpan={6} className="empty-table">해당 조건의 게임이 없습니다.</td></tr>}</tbody></table></div>
    {pagination.totalPages > 1 && <div className="pagination"><button type="button" disabled={loading || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>이전</button><span>{pagination.page} / {pagination.totalPages}</span><button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>다음</button></div>}
  </section>;
}
