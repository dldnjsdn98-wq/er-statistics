"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseQuery } from "@/lib/domain";
import { activeQuickPeriod, conditionsKey, MAX_CONDITIONS, normalizeConditions, queryParams, QUICK_DAYS, quickPeriod, readConditions, RECENT_KEY, rememberCondition, SAVED_KEY, shareUrl, writeConditions, type SearchConditions } from "@/lib/search-preferences";
import type { Character, MatchMode, Query, Source, StatsResponse } from "@/lib/types";
import { TrendCharts } from "./trend-charts";
import { CharacterComparison, MatchHistory } from "./results-sections";
import { SearchCollections } from "./search-collections";

const int = new Intl.NumberFormat("ko-KR");
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmt = (value: number | null) => value === null ? "—" : int.format(value);
const avg = (value: number | null) => value === null ? "—" : decimal.format(value);
const pct = (value: number | null) => value === null ? "—" : `${decimal.format(value)}%`;
const displayMode = (mode: MatchMode | "unknown") => mode === "ranked" ? "랭크" : mode === "normal" ? "일반" : mode === "unknown" ? "기타" : "전체 모드";

type Search = Pick<Query, "nickname" | "startDate" | "endDate" | "characterCodes" | "mode" | "page" | "pageSize">;
export default function Home() {
  const [nickname, setNickname] = useState("데모플레이어");
  const [startDate, setStartDate] = useState(() => quickPeriod(30).startDate);
  const [endDate, setEndDate] = useState(() => quickPeriod(30).endDate);
  const [mode, setMode] = useState<MatchMode>("all");
  const [pageSize, setPageSize] = useState(20);
  const [appliedSearch, setAppliedSearch] = useState<Search | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [characterSearch, setCharacterSearch] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [showCharacters, setShowCharacters] = useState(false);
  const [recent, setRecent] = useState<SearchConditions[]>([]);
  const [saved, setSaved] = useState<SearchConditions[]>([]);
  const [collectionStatus, setCollectionStatus] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  const characterControlRef = useRef<HTMLDivElement>(null);
  const characterTriggerRef = useRef<HTMLButtonElement>(null);
  const requestSeq = useRef(0);
  const recentRef = useRef<SearchConditions[]>([]);
  const allCharacters = useMemo(() => [...new Map([...characters, ...(data?.characters ?? []).map(character => ({ code: character.code, name: character.name }))].map(character => [character.code, character])).values()], [characters, data]);
  const visibleCharacters = useMemo(() => allCharacters.filter(character => character.name.toLowerCase().includes(characterSearch.toLowerCase()) || String(character.code).includes(characterSearch)).slice(0, 100), [allCharacters, characterSearch]);
  const names = useMemo(() => new Map(allCharacters.map(character => [character.code, character.name])), [allCharacters]);

  const draft: Search = { nickname, startDate, endDate, mode, characterCodes: selected, page: 1, pageSize };
  const draftConditions = normalizeConditions(draft);
  const draftDiffers = !!data && !!appliedSearch && (!draftConditions || conditionsKey(draftConditions) !== conditionsKey(appliedSearch));

  async function loadStats(search: Search, updateUrl = false, explicitAnalysis = false) {
    let parsed: Query;
    try { parsed = parseQuery(queryParams(search)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "검색 조건이 올바르지 않습니다."); return; }
    const sequence = ++requestSeq.current;
    setLoading(true); setError(null); setData(null);
    setShareStatus(""); setShareFallback("");
    const params = queryParams(parsed);
    if (updateUrl) window.history.replaceState(null, "", `?${params}`);
    try {
      const response = await fetch(`/api/stats?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error?.message === "string" ? body.error.message : "잠시 후 다시 시도해 주세요.");
      if (sequence === requestSeq.current) {
        setData(body as StatsResponse); setSource(body.source as Source); setAppliedSearch(parsed);
        setShareStatus(""); setShareFallback("");
        if (explicitAnalysis) {
          const next = rememberCondition(recentRef.current, parsed);
          recentRef.current = next; setRecent(next);
          try { writeConditions(window.localStorage, RECENT_KEY, next); } catch { /* storage may be unavailable */ }
        }
      }
    } catch (cause) {
      if (sequence === requestSeq.current) setError(cause instanceof Error ? cause.message : "잠시 후 다시 시도해 주세요.");
    } finally { if (sequence === requestSeq.current) setLoading(false); }
  }

  useEffect(() => {
    fetch("/api/characters").then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "실험체 목록 오류"); return body; }).then(body => { setCharacters(body.characters as Character[]); setSource(body.source as Source); }).catch(() => setCharacters([]));
    const params = new URLSearchParams(window.location.search);
    if (!params.has("nickname")) params.set("nickname", "데모플레이어");
    if (!params.has("startDate")) params.set("startDate", quickPeriod(30).startDate);
    if (!params.has("endDate")) params.set("endDate", quickPeriod(30).endDate);
    try { const stored = readConditions(window.localStorage, RECENT_KEY); recentRef.current = stored; setRecent(stored); setSaved(readConditions(window.localStorage, SAVED_KEY)); } catch { /* storage may be unavailable */ }
    try {
      const search = parseQuery(params);
      setNickname(search.nickname); setStartDate(search.startDate); setEndDate(search.endDate); setMode(search.mode); setSelected(search.characterCodes); setPageSize(search.pageSize);
      void loadStats(search);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크의 검색 조건이 올바르지 않습니다."); }
  }, []);

  useEffect(() => {
    if (!showCharacters) return;
    function onPointerDown(event: PointerEvent) { if (!characterControlRef.current?.contains(event.target as Node)) setShowCharacters(false); }
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") { setShowCharacters(false); characterTriggerRef.current?.focus(); } }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [showCharacters]);

  function restoreConditions(value: SearchConditions) {
    setNickname(value.nickname); setStartDate(value.startDate); setEndDate(value.endDate); setMode(value.mode); setSelected(value.characterCodes); setShowCharacters(false);
    setCollectionStatus("조건만 불러왔습니다. 분석하기로 조회하세요.");
  }
  function saveDraft() {
    if (!draftConditions) { setCollectionStatus("저장할 검색 조건을 확인해 주세요."); return; }
    const key = conditionsKey(draftConditions);
    if (saved.length >= MAX_CONDITIONS && !saved.some(item => conditionsKey(item) === key)) { setCollectionStatus("최대 5개까지 저장할 수 있습니다. 기존 조건을 삭제해 주세요."); return; }
    const next = rememberCondition(saved, draftConditions);
    setSaved(next);
    let written = false;
    try { written = writeConditions(window.localStorage, SAVED_KEY, next); } catch { /* storage may be unavailable */ }
    setCollectionStatus(written ? "현재 조건을 이 기기에 저장했습니다." : "저장소를 사용할 수 없어 이번 방문 동안만 조건을 보관합니다.");
  }
  function removeCondition(kind: "recent" | "saved", key: string) {
    const next = (kind === "recent" ? recent : saved).filter(item => conditionsKey(item) !== key);
    if (kind === "recent") { recentRef.current = next; setRecent(next); } else setSaved(next);
    let written = false;
    try { written = writeConditions(window.localStorage, kind === "recent" ? RECENT_KEY : SAVED_KEY, next); } catch { /* storage may be unavailable */ }
    setCollectionStatus(written ? "조건을 삭제했습니다." : "화면에서 삭제했습니다. 저장소를 사용할 수 없어 새로고침 후 다시 보일 수 있습니다.");
  }
  function clearRecent() {
    recentRef.current = []; setRecent([]);
    let written = false;
    try { written = writeConditions(window.localStorage, RECENT_KEY, []); } catch { /* storage may be unavailable */ }
    setCollectionStatus(written ? "최근 성공 조회를 모두 삭제했습니다." : "화면에서 삭제했습니다. 저장소를 사용할 수 없어 새로고침 후 다시 보일 수 있습니다.");
  }
  function clearSaved() {
    setSaved([]);
    let written = false;
    try { written = writeConditions(window.localStorage, SAVED_KEY, []); } catch { /* storage may be unavailable */ }
    setCollectionStatus(written ? "저장한 조건을 모두 삭제했습니다." : "화면에서 삭제했습니다. 저장소를 사용할 수 없어 새로고침 후 다시 보일 수 있습니다.");
  }

  function toggleCharacter(code: number) { setSelected(current => current.includes(code) ? current.filter(value => value !== code) : [...current, code]); }
  function addManualCode() { const code = Number(manualCode); if (Number.isSafeInteger(code) && code > 0 && !selected.includes(code) && selected.length < 100) { setSelected(current => [...current, code]); setManualCode(""); } }
  const active = data?.filters;
  const pageSearch: Search | null = data && appliedSearch ? { ...appliedSearch, page: data.pagination.page, pageSize: data.pagination.pageSize } : null;
  async function copyShareLink() {
    if (!pageSearch) return;
    const sequence = requestSeq.current;
    const link = shareUrl(window.location.origin, window.location.pathname, pageSearch);
    try {
      await navigator.clipboard.writeText(link);
      if (sequence !== requestSeq.current) return;
      setShareFallback(""); setShareStatus("적용된 조회 조건 링크를 복사했습니다.");
    } catch {
      if (sequence !== requestSeq.current) return;
      setShareFallback(link); setShareStatus("자동 복사가 불가능합니다. 아래 링크를 선택해 복사해 주세요.");
    }
  }

  return <main className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">E<span>R</span></span><span className="brand-name">INSIGHT<span className="brand-sub">이터널 리턴 데이터 랩</span></span></a><div className="topbar-right"><span className="status-indicator"/><span>{source === "demo" ? "데모 데이터 · 실제 전적 아님" : source === "live" ? "실제 API 연결" : error ? "데이터 연결 실패" : "데이터 연결 확인 중"}</span><span className="topbar-divider"/> KST 기준</div></header>
    <section className="hero"><div className="eyebrow"><span className="eyebrow-line"/> THE DATA BEHIND YOUR GAME</div><h1>플레이의 기록을,<br/><span>인사이트로.</span></h1><p>원하는 기간과 실험체를 선택해 전적의 흐름을 확인하세요.<br className="desktop-only"/> 여러 실험체를 한 번에 비교할 수 있습니다.</p><div className="hero-orbit"><div className="orbit-ring orbit-one"/><div className="orbit-ring orbit-two"/><div className="orbit-core">ER<span>01</span></div></div></section>
    <section className="filter-card" aria-label="전적 검색 필터"><div className="filter-heading"><div><span className="section-kicker">SEARCH PARAMETERS</span><h2>분석 조건</h2></div><span className="filter-hint">조건을 설정한 뒤 분석하기를 눌러주세요</span></div>
      <form noValidate onSubmit={event => { event.preventDefault(); void loadStats(draft, true, true); }}>
        <div className="filter-grid"><label className="field nickname-field"><span>플레이어 닉네임</span><input type="text" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={64} placeholder="닉네임 입력" required/></label><div className="date-group"><label className="field"><span>시작 날짜</span><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} required/></label><span className="date-tilde">—</span><label className="field"><span>종료 날짜</span><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} required/></label></div><label className="field mode-field"><span>게임 모드</span><select value={mode} onChange={event => setMode(event.target.value as MatchMode)}><option value="all">전체 모드</option><option value="ranked">랭크</option><option value="normal">일반</option></select></label></div>
        <div className="quick-periods" role="group" aria-label="빠른 기간 선택"><span>빠른 기간</span>{QUICK_DAYS.map(days => <button key={days} type="button" aria-pressed={activeQuickPeriod(startDate, endDate) === days} onClick={() => { const period = quickPeriod(days); setStartDate(period.startDate); setEndDate(period.endDate); }}>최근 {days}일</button>)}<small>한국 시간 오늘 포함 · 날짜 직접 수정 가능</small></div>
        <div className="filter-bottom"><div className="character-control" ref={characterControlRef}><span className="field-label">실험체 선택 <em>복수 선택 가능</em></span><button ref={characterTriggerRef} type="button" className="character-trigger" onClick={() => setShowCharacters(value => !value)} aria-expanded={showCharacters} aria-controls="character-options"><span>{selected.length ? `${selected.length}개 실험체 선택됨` : "전체 실험체"}</span><span className="chevron">⌄</span></button>{showCharacters && <div className="character-popover" id="character-options"><input className="character-search" value={characterSearch} onChange={event => setCharacterSearch(event.target.value)} placeholder="실험체 검색" aria-label="실험체 검색"/><div className="character-popover-actions"><span>선택 {selected.length}개</span><button type="button" onClick={() => setSelected([])}>전체로 초기화</button></div><div className="character-list">{visibleCharacters.map(character => <label key={character.code} className="character-option"><input type="checkbox" checked={selected.includes(character.code)} onChange={() => toggleCharacter(character.code)} disabled={!selected.includes(character.code) && selected.length >= 100}/><span>{character.name}</span><small>#{character.code}</small></label>)}{visibleCharacters.length === 0 && <p className="no-character">검색 결과가 없습니다.</p>}</div><div className="manual-code"><input aria-label="실험체 코드 직접 입력" inputMode="numeric" pattern="[0-9]*" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder="목록에 없다면 코드 입력"/><button type="button" onClick={addManualCode}>추가</button></div></div>}{selected.length > 0 && <div className="selected-chips">{selected.map(code => <button type="button" key={code} onClick={() => toggleCharacter(code)} aria-label={`${names.get(code) ?? `캐릭터 ${code}`} 선택 해제`}>{names.get(code) ?? `캐릭터 ${code}`} ×</button>)}</div>}</div><button className="analyze-button" disabled={loading} type="submit"><span>{loading ? "분석 중..." : "전적 분석하기"}</span><span aria-hidden="true">↗</span></button></div>
      </form>
      {draftDiffers && <p className="draft-notice">입력 조건이 현재 결과와 다릅니다. 새 조건은 전적 분석하기를 눌러 적용하세요.</p>}
      <SearchCollections recent={recent} saved={saved} names={names} onRestore={restoreConditions} onRemove={removeCondition} onClearRecent={clearRecent} onClearSaved={clearSaved} onSave={saveDraft} status={collectionStatus}/>
    </section>
    <div aria-live="polite" aria-atomic="true">{loading && <div className="loading-panel" role="status"><span className="loader"/> 전적을 분석하고 있어요...</div>}{error && <div className="error-panel" role="alert"><strong>전적을 불러오지 못했어요.</strong><span>{error}</span></div>}</div>
    {data && <>
      <section className="results-head"><div><span className="section-kicker">PERFORMANCE OVERVIEW</span><h2>{data.player.nickname}님의 전적</h2><p>{active?.startDate} — {active?.endDate} · {displayMode(active?.mode ?? "all")}</p></div><div className="results-actions"><span className={`source-badge ${data.source}`}>{data.source === "demo" ? "DEMO DATA" : `LIVE API · ${data.coverage.lastSyncedAt ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(data.coverage.lastSyncedAt)) : "수집 전"}`}</span><button type="button" className="share-button" onClick={() => void copyShareLink()}>조회 조건 링크 복사</button></div></section>
      {(shareStatus || shareFallback) && <div className="share-feedback" role="status"><span>{shareStatus}</span>{shareFallback && <div className="share-fallback"><input aria-label="복사할 조회 조건 링크" readOnly value={shareFallback} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()}/></div>}</div>}
      <div className={`coverage-note ${data.source}`}><span className="coverage-icon">{data.source === "demo" ? "◈" : "ⓘ"}</span><span><strong>{data.source === "demo" ? "데모 데이터 · 실제 전적이 아닙니다" : "실제 API · 수집 범위가 일부일 수 있습니다"}</strong><br/>{data.coverage.warnings.map(warning => warning.message).join(" ")}{data.source === "live" && <><br/>보관된 게임 시각: {data.coverage.observedFrom ? data.coverage.observedFrom.slice(0, 10) : "없음"} ~ {data.coverage.observedTo ? data.coverage.observedTo.slice(0, 10) : "없음"} (UTC)</>}</span></div>
      <section className="metric-grid" aria-label="전적 요약"><article className="metric-card primary"><span className="metric-label">TOTAL MATCHES</span><strong>{fmt(data.summary.games)}</strong><span className="metric-detail">선택한 기간의 게임</span><span className="metric-accent">↗</span></article><article className="metric-card"><span className="metric-label">WIN RATE</span><strong>{pct(data.summary.winRate)}</strong><span className="metric-detail">{fmt(data.summary.wins)}승 · 순위 표본 {data.summary.metricCounts.rank}경기</span><div className="metric-bar"><span style={{ width: `${Math.min(data.summary.winRate ?? 0, 100)}%` }}/></div></article><article className="metric-card"><span className="metric-label">AVG. RANK</span><strong>{avg(data.summary.averageRank)}<small>{data.summary.averageRank === null ? "" : "위"}</small></strong><span className="metric-detail">평균 최종 순위</span></article><article className="metric-card"><span className="metric-label">AVG. KILLS</span><strong>{avg(data.summary.averageKills)}</strong><span className="metric-detail">게임당 평균 킬</span></article><article className="metric-card"><span className="metric-label">AVG. ASSISTS</span><strong>{avg(data.summary.averageAssists)}</strong><span className="metric-detail">게임당 평균 어시스트</span></article><article className="metric-card"><span className="metric-label">AVG. DAMAGE</span><strong>{fmt(data.summary.averageDamage === null ? null : Math.round(data.summary.averageDamage))}</strong><span className="metric-detail">게임당 플레이어 피해량</span></article></section>
      <TrendCharts trend={data.trend} startDate={data.filters.startDate} endDate={data.filters.endDate} selectedCharacterCount={data.filters.characterCodes.length}/>
      <CharacterComparison rows={data.characters} selectedCount={data.filters.characterCodes.length}/>
      <MatchHistory matches={data.matches} pagination={data.pagination} loading={loading} onPage={page => { if (pageSearch) void loadStats({ ...pageSearch, page }, true); }} onPageSize={size => { setPageSize(size); if (pageSearch) void loadStats({ ...pageSearch, page: 1, pageSize: size }, true); }}/>
    </>}
    <footer><span className="footer-brand">ER <strong>INSIGHT</strong></span><span>이터널 리턴 게임 데이터 분석 · 시간은 한국 표준시 기준</span><span>{source === "demo" ? "DEMO EXPERIENCE" : source === "live" ? "LIVE API" : "DATA"}</span></footer>
  </main>;
}
