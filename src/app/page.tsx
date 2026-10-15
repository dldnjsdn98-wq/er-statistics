"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseQuery } from "@/lib/domain";
import type { Character, Match, MatchMode, Query, Source, StatsResponse } from "@/lib/types";

function dateInput(offsetDays: number): string {
  const kst = new Date(Date.now() + 9 * 3600000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().slice(0, 10);
}
const int = new Intl.NumberFormat("ko-KR");
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmt = (value: number | null) => value === null ? "—" : int.format(value);
const avg = (value: number | null) => value === null ? "—" : decimal.format(value);
const pct = (value: number | null) => value === null ? "—" : `${decimal.format(value)}%`;
const displayMode = (mode: MatchMode | "unknown") => mode === "ranked" ? "랭크" : mode === "normal" ? "일반" : mode === "unknown" ? "기타" : "전체 모드";

function GameRow({ game }: { game: Match }) {
  return <tr>
    <td><span className="game-character"><span className="character-dot">{game.characterName.slice(0, 1)}</span>{game.characterName}</span></td>
    <td><span className={`mode-tag ${game.mode}`}>{displayMode(game.mode)}</span></td>
    <td><span className={game.rank === 1 ? "win-text" : ""}>{game.rank === null ? "—" : game.rank === 1 ? "1위 · 승리" : `${game.rank}위`}</span></td>
    <td>{fmt(game.kills)} / {fmt(game.assists)}</td><td>{fmt(game.damage)}</td>
    <td>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(game.startedAt))}</td>
  </tr>;
}

type Search = Pick<Query, "nickname" | "startDate" | "endDate" | "characterCodes" | "mode" | "page" | "pageSize">;
export default function Home() {
  const [nickname, setNickname] = useState("데모플레이어");
  const [startDate, setStartDate] = useState(() => dateInput(-30));
  const [endDate, setEndDate] = useState(() => dateInput(0));
  const [mode, setMode] = useState<MatchMode>("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [characterSearch, setCharacterSearch] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [showCharacters, setShowCharacters] = useState(false);
  const requestSeq = useRef(0);
  const allCharacters = useMemo(() => [...new Map([...characters, ...(data?.characters ?? []).map(character => ({ code: character.code, name: character.name }))].map(character => [character.code, character])).values()], [characters, data]);
  const visibleCharacters = useMemo(() => allCharacters.filter(character => character.name.toLowerCase().includes(characterSearch.toLowerCase()) || String(character.code).includes(characterSearch)).slice(0, 100), [allCharacters, characterSearch]);
  const names = useMemo(() => new Map(allCharacters.map(character => [character.code, character.name])), [allCharacters]);

  async function loadStats(search: Search, updateUrl = false) {
    const sequence = ++requestSeq.current;
    setLoading(true); setError(null); setData(null);
    const params = new URLSearchParams({ nickname: search.nickname.trim(), startDate: search.startDate, endDate: search.endDate, mode: search.mode, page: String(search.page), pageSize: String(search.pageSize) });
    if (search.characterCodes.length) params.set("characterCodes", search.characterCodes.join(","));
    if (updateUrl) window.history.replaceState(null, "", `?${params}`);
    try {
      const response = await fetch(`/api/stats?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error?.message === "string" ? body.error.message : "잠시 후 다시 시도해 주세요.");
      if (sequence === requestSeq.current) { setData(body as StatsResponse); setSource(body.source as Source); }
    } catch (cause) {
      if (sequence === requestSeq.current) setError(cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.");
    } finally { if (sequence === requestSeq.current) setLoading(false); }
  }

  useEffect(() => {
    fetch("/api/characters").then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "실험체 목록 오류"); return body; }).then(body => { setCharacters(body.characters as Character[]); setSource(body.source as Source); }).catch(() => setCharacters([]));
    const params = new URLSearchParams(window.location.search);
    if (!params.has("nickname")) params.set("nickname", "데모플레이어");
    if (!params.has("startDate")) params.set("startDate", dateInput(-30));
    if (!params.has("endDate")) params.set("endDate", dateInput(0));
    try {
      const search = parseQuery(params);
      setNickname(search.nickname); setStartDate(search.startDate); setEndDate(search.endDate); setMode(search.mode); setSelected(search.characterCodes);
      void loadStats(search);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크의 검색 조건이 올바르지 않습니다."); }
  }, []);

  function toggleCharacter(code: number) { setSelected(current => current.includes(code) ? current.filter(value => value !== code) : [...current, code]); }
  function addManualCode() { const code = Number(manualCode); if (Number.isSafeInteger(code) && code > 0 && !selected.includes(code) && selected.length < 100) { setSelected(current => [...current, code]); setManualCode(""); } }
  const active = data?.filters;
  const pageSearch: Search | null = data ? { nickname: data.player.nickname, startDate: data.filters.startDate, endDate: data.filters.endDate, mode: data.filters.mode, characterCodes: data.filters.characterCodes, page: data.pagination.page, pageSize: data.pagination.pageSize } : null;

  return <main className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">E<span>R</span></span><span className="brand-name">INSIGHT<span className="brand-sub">이터널 리턴 데이터 랩</span></span></a><div className="topbar-right"><span className="status-indicator"/><span>{source === "demo" ? "데모 데이터 · 실제 전적 아님" : source === "live" ? "실제 API 연결" : error ? "데이터 연결 실패" : "데이터 연결 확인 중"}</span><span className="topbar-divider"/> KST 기준</div></header>
    <section className="hero"><div className="eyebrow"><span className="eyebrow-line"/> THE DATA BEHIND YOUR GAME</div><h1>플레이의 기록을,<br/><span>인사이트로.</span></h1><p>원하는 기간과 실험체를 선택해 전적의 흐름을 확인하세요.<br className="desktop-only"/> 여러 실험체를 한 번에 비교할 수 있습니다.</p><div className="hero-orbit"><div className="orbit-ring orbit-one"/><div className="orbit-ring orbit-two"/><div className="orbit-core">ER<span>01</span></div></div></section>
    <section className="filter-card" aria-label="전적 검색 필터"><div className="filter-heading"><div><span className="section-kicker">SEARCH PARAMETERS</span><h2>분석 조건</h2></div><span className="filter-hint">조건을 설정한 뒤 분석하기를 눌러주세요</span></div>
      <form onSubmit={event => { event.preventDefault(); void loadStats({ nickname, startDate, endDate, mode, characterCodes: selected, page: 1, pageSize: 20 }, true); }}>
        <div className="filter-grid"><label className="field nickname-field"><span>플레이어 닉네임</span><input type="text" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={64} placeholder="닉네임 입력" required/></label><div className="date-group"><label className="field"><span>시작 날짜</span><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required/></label><span className="date-tilde">—</span><label className="field"><span>종료 날짜</span><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} required/></label></div><label className="field mode-field"><span>게임 모드</span><select value={mode} onChange={event => setMode(event.target.value as MatchMode)}><option value="all">전체 모드</option><option value="ranked">랭크</option><option value="normal">일반</option></select></label></div>
        <div className="filter-bottom"><div className="character-control"><span className="field-label">실험체 선택 <em>복수 선택 가능</em></span><button type="button" className="character-trigger" onClick={() => setShowCharacters(value => !value)} aria-expanded={showCharacters} aria-controls="character-options"><span>{selected.length ? `${selected.length}개 실험체 선택됨` : "전체 실험체"}</span><span className="chevron">⌄</span></button>{showCharacters && <div className="character-popover" id="character-options"><input className="character-search" value={characterSearch} onChange={event => setCharacterSearch(event.target.value)} placeholder="실험체 검색" aria-label="실험체 검색"/><div className="character-popover-actions"><span>선택 {selected.length}개</span><button type="button" onClick={() => setSelected([])}>전체로 초기화</button></div><div className="character-list">{visibleCharacters.map(character => <label key={character.code} className="character-option"><input type="checkbox" checked={selected.includes(character.code)} onChange={() => toggleCharacter(character.code)} disabled={!selected.includes(character.code) && selected.length >= 100}/><span>{character.name}</span><small>#{character.code}</small></label>)}{visibleCharacters.length === 0 && <p className="no-character">검색 결과가 없습니다.</p>}</div><div className="manual-code"><input aria-label="실험체 코드 직접 입력" inputMode="numeric" pattern="[0-9]*" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder="목록에 없다면 코드 입력"/><button type="button" onClick={addManualCode}>추가</button></div></div>}{selected.length > 0 && <div className="selected-chips">{selected.map(code => <button type="button" key={code} onClick={() => toggleCharacter(code)} aria-label={`${names.get(code) ?? `캐릭터 ${code}`} 선택 해제`}>{names.get(code) ?? `캐릭터 ${code}`} ×</button>)}</div>}</div><button className="analyze-button" disabled={loading} type="submit"><span>{loading ? "분석 중..." : "전적 분석하기"}</span><span aria-hidden="true">↗</span></button></div>
      </form></section>
    <div aria-live="polite" aria-atomic="true">{loading && <div className="loading-panel" role="status"><span className="loader"/> 전적을 분석하고 있어요...</div>}{error && <div className="error-panel" role="alert"><strong>전적을 불러오지 못했어요.</strong><span>{error}</span></div>}</div>
    {data && <>
      <section className="results-head"><div><span className="section-kicker">PERFORMANCE OVERVIEW</span><h2>{data.player.nickname}님의 전적</h2><p>{active?.startDate} — {active?.endDate} · {displayMode(active?.mode ?? "all")}</p></div><span className={`source-badge ${data.source}`}>{data.source === "demo" ? "DEMO DATA" : `LIVE API · ${data.coverage.lastSyncedAt ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(data.coverage.lastSyncedAt)) : "수집 전"}`}</span></section>
      <div className={`coverage-note ${data.source}`}><span className="coverage-icon">{data.source === "demo" ? "◈" : "ⓘ"}</span><span><strong>{data.source === "demo" ? "데모 데이터 · 실제 전적이 아닙니다" : "실제 API · 수집 범위가 일부일 수 있습니다"}</strong><br/>{data.coverage.warnings.map(warning => warning.message).join(" ")}{data.source === "live" && <><br/>보관된 게임 시각: {data.coverage.observedFrom ? data.coverage.observedFrom.slice(0, 10) : "없음"} ~ {data.coverage.observedTo ? data.coverage.observedTo.slice(0, 10) : "없음"} (UTC)</>}</span></div>
      <section className="metric-grid" aria-label="전적 요약"><article className="metric-card primary"><span className="metric-label">TOTAL MATCHES</span><strong>{fmt(data.summary.games)}</strong><span className="metric-detail">선택한 기간의 게임</span><span className="metric-accent">↗</span></article><article className="metric-card"><span className="metric-label">WIN RATE</span><strong>{pct(data.summary.winRate)}</strong><span className="metric-detail">{fmt(data.summary.wins)}승 · 순위 표본 {data.summary.metricCounts.rank}경기</span><div className="metric-bar"><span style={{ width: `${Math.min(data.summary.winRate ?? 0, 100)}%` }}/></div></article><article className="metric-card"><span className="metric-label">AVG. RANK</span><strong>{avg(data.summary.averageRank)}<small>{data.summary.averageRank === null ? "" : "위"}</small></strong><span className="metric-detail">평균 최종 순위</span></article><article className="metric-card"><span className="metric-label">AVG. KILLS</span><strong>{avg(data.summary.averageKills)}</strong><span className="metric-detail">게임당 평균 킬</span></article><article className="metric-card"><span className="metric-label">AVG. ASSISTS</span><strong>{avg(data.summary.averageAssists)}</strong><span className="metric-detail">게임당 평균 어시스트</span></article><article className="metric-card"><span className="metric-label">AVG. DAMAGE</span><strong>{fmt(data.summary.averageDamage === null ? null : Math.round(data.summary.averageDamage))}</strong><span className="metric-detail">게임당 플레이어 피해량</span></article></section>
      <section className="data-section"><div className="section-heading"><div><span className="section-kicker">CHARACTER BREAKDOWN</span><h2>실험체별 성적</h2></div><span className="section-count">{data.characters.length} CHARACTERS</span></div><div className="table-wrap"><table><thead><tr><th>실험체</th><th>게임</th><th>승률</th><th>평균 순위</th><th>평균 킬</th><th>평균 어시스트</th><th>평균 피해량</th></tr></thead><tbody>{data.characters.map(character => <tr key={character.code}><td><span className="game-character"><span className="character-dot">{character.name.slice(0, 1)}</span>{character.name}</span></td><td className="emphasis">{fmt(character.games)}</td><td>{pct(character.winRate)}</td><td>{avg(character.averageRank)}</td><td>{avg(character.averageKills)}</td><td>{avg(character.averageAssists)}</td><td>{fmt(character.averageDamage === null ? null : Math.round(character.averageDamage))}</td></tr>)}{data.characters.length === 0 && <tr><td colSpan={7} className="empty-table">해당 조건의 실험체 기록이 없습니다.</td></tr>}</tbody></table></div></section>
      <section className="data-section recent-section"><div className="section-heading"><div><span className="section-kicker">MATCH HISTORY</span><h2>최근 게임</h2></div><span className="section-count">전체 {data.pagination.total}경기 · {data.pagination.page}페이지</span></div><div className="table-wrap"><table><thead><tr><th>실험체</th><th>모드</th><th>결과</th><th>킬 / 어시스트</th><th>피해량</th><th>시작 시각 (KST)</th></tr></thead><tbody>{data.matches.map(game => <GameRow game={game} key={game.gameId}/>)}{data.matches.length === 0 && <tr><td colSpan={6} className="empty-table">해당 조건의 게임이 없습니다.</td></tr>}</tbody></table></div>{pageSearch && data.pagination.totalPages > 1 && <div className="pagination"><button type="button" disabled={loading || data.pagination.page <= 1} onClick={() => void loadStats({ ...pageSearch, page: pageSearch.page - 1 }, true)}>이전</button><span>{data.pagination.page} / {data.pagination.totalPages}</span><button type="button" disabled={loading || data.pagination.page >= data.pagination.totalPages} onClick={() => void loadStats({ ...pageSearch, page: pageSearch.page + 1 }, true)}>다음</button></div>}</section>
    </>}
    <footer><span className="footer-brand">ER <strong>INSIGHT</strong></span><span>이터널 리턴 게임 데이터 분석 · 시간은 한국 표준시 기준</span><span>{source === "demo" ? "DEMO EXPERIENCE" : source === "live" ? "LIVE API" : "DATA"}</span></footer>
  </main>;
}
