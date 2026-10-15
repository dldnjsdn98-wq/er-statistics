"use client";

import { conditionsKey, type SearchConditions } from "@/lib/search-preferences";

interface Props {
  recent: SearchConditions[];
  saved: SearchConditions[];
  names: Map<number, string>;
  onRestore: (condition: SearchConditions) => void;
  onRemove: (kind: "recent" | "saved", key: string) => void;
  onClearRecent: () => void;
  onClearSaved: () => void;
  onSave: () => void;
  status: string;
}

function conditionLabel(item: SearchConditions, names: Map<number, string>): string {
  const mode = item.mode === "ranked" ? "랭크" : item.mode === "normal" ? "일반" : "전체 모드";
  const characters = item.characterCodes.length ? item.characterCodes.map(code => names.get(code) ?? `코드 ${code}`).join(", ") : "전체 실험체";
  return `${item.nickname} · ${item.startDate}~${item.endDate} · ${mode} · ${characters}`;
}

export function SearchCollections({ recent, saved, names, onRestore, onRemove, onClearRecent, onClearSaved, onSave, status }: Props) {
  return <div className="search-collections">
    <section className="search-collection" aria-labelledby="recent-search-title">
      <div className="search-collection-head"><div><h3 id="recent-search-title">최근 성공 조회</h3><p>이 기기에서 분석에 성공한 조건만 보관합니다.</p></div>{recent.length > 0 && <button type="button" className="text-action" onClick={onClearRecent}>전체 삭제</button>}</div>
      {recent.length ? <ul className="condition-list">{recent.map(item => <li key={conditionsKey(item)}><span>{conditionLabel(item, names)}</span><div><button type="button" onClick={() => onRestore(item)} aria-label={`${conditionLabel(item, names)} 최근 조회 불러오기`}>불러오기</button><button type="button" onClick={() => onRemove("recent", conditionsKey(item))} aria-label={`${conditionLabel(item, names)} 최근 조회 삭제`}>삭제</button></div></li>)}</ul> : <p className="condition-empty">아직 성공한 조회가 없습니다.</p>}
    </section>
    <section className="search-collection" aria-labelledby="saved-search-title">
      <div className="search-collection-head"><div><h3 id="saved-search-title">저장한 조건</h3><p>조회 전에도 현재 입력 조건을 최대 5개까지 저장할 수 있습니다.</p></div><div className="collection-head-actions">{saved.length > 0 && <button type="button" className="text-action" onClick={onClearSaved}>전체 삭제</button>}<button type="button" className="save-condition" onClick={onSave}>현재 조건 저장</button></div></div>
      {saved.length ? <ul className="condition-list">{saved.map(item => <li key={conditionsKey(item)}><span>{conditionLabel(item, names)}</span><div><button type="button" onClick={() => onRestore(item)} aria-label={`${conditionLabel(item, names)} 저장한 조건 불러오기`}>불러오기</button><button type="button" onClick={() => onRemove("saved", conditionsKey(item))} aria-label={`${conditionLabel(item, names)} 저장한 조건 삭제`}>삭제</button></div></li>)}</ul> : <p className="condition-empty">저장한 조건이 없습니다.</p>}
    </section>
    <p className="collection-help">조건만 불러옵니다. 분석하기를 눌러야 조회합니다. 이 기기에만 저장됩니다.</p>
    <p className="collection-status" role="status" aria-live="polite">{status}</p>
  </div>;
}
