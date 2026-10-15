# 내부 API 계약 v1

브라우저가 호출하는 동일 출처 JSON API다. 날짜는 한국 시간, 숫자는 반올림 전 값, 시각은 UTC ISO 8601, ID는 문자열이다. 아래 인터페이스는 구현용 계약이다. 원본 공식 API 스키마와 구별한다.

## GET /api/characters

`200 { source: "demo" | "live", characters: Array<{ code: number, name: string }> }`

UI의 다중 선택 목록. code는 공식 characterNum에 대응한다. 라이브에서 이름을 알 수 없는 관측 코드는 `캐릭터 {code}`로 표시하고 필터할 수 있게 보존한다. demo metadata를 live 경기인 것처럼 섞지 않는다. 정적 캐릭터 사전 사용 시 이름 메타데이터라는 사실과 버전을 명시한다.

## GET /api/stats

예: `/api/stats?nickname=데모플레이어&startDate=2026-10-01&endDate=2026-10-15&characterCodes=1,2&mode=all&page=1&pageSize=20`

| 매개변수 | 규칙 |
| --- | --- |
| nickname | 필수, 앞뒤 공백 제거, 1~64자. URL 길이 방어용 한도이며 공식 닉네임 제약이라고 주장하지 않음 |
| startDate/endDate | 필수, 실재하는 YYYY-MM-DD, 시작≤종료. 90일 밖 범위도 허용 |
| characterCodes | 생략/빈 문자열은 전체. 쉼표 구분 양의 정수 최대 100개. 중복 제거·오름차순 정규화 |
| mode | all/normal/ranked, 기본 all |
| page | 정수 1 이상, 기본 1 |
| pageSize | 1~100 정수, 기본 20 |

잘못된 날짜/숫자/모드를 임의 보정하거나 무시하지 않고 400으로 반환한다. known character 선택 목록에 없는 양의 코드는 구문상 허용하고 이름 fallback/0경기 행으로 처리한다. 공유 URL에는 위 필터를 유지한다. 서버와 클라이언트가 같은 검증·정규화 로직을 재사용한다.

```ts
type MetricSummary = {
  games: number;
  wins: number;
  winRate: number | null; // 0..100, valid gameRank 표본 기준
  averageRank: number | null;
  averageKills: number | null;
  averageAssists: number | null;
  averageDamage: number | null;
  metricCounts: { rank: number; kills: number; assists: number; damage: number };
};

type StatsResponse = {
  source: "demo" | "live";
  storage: "fixture" | "memory" | "postgres";
  player: { uid: string; nickname: string };
  filters: {
    startDate: string; endDate: string; timeZone: "Asia/Seoul";
    startInclusive: string; endExclusive: string;
    characterCodes: number[]; mode: "all" | "normal" | "ranked";
  };
  coverage: {
    completeness: "demo" | "partial" | "complete";
    upstreamRetentionDays: 90 | null; // demo=null
    observedFrom: string | null; // 보관 중인 해당 UID 전체 데이터의 최소 경기 시각
    observedTo: string | null; // 최대 경기 시각. 완전 수집 구간의 의미가 아님
    lastSyncedAt: string | null;
    stale: boolean;
    droppedRecords: number;
    timestampPolicy: "explicit-offset" | "assumed-Asia/Seoul" | "assumed-UTC" | "demo";
    warnings: Array<{ code: string; message: string }>;
  };
  summary: MetricSummary;
  trend: Array<{
    date: string; // YYYY-MM-DD, KST
    games: number; wins: number;
    winRate: number | null; averageRank: number | null;
    rankSamples: number;
  }>;
  characters: Array<MetricSummary & { code: number; name: string }>;
  matches: Array<{
    gameId: string; startedAt: string;
    characterCode: number; characterName: string;
    mode: "normal" | "ranked" | "unknown";
    rank: number | null; kills: number | null; assists: number | null;
    damage: number | null;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
```

`complete`는 요청 기간 전체의 수집 완료를 입증한 경우만 가능하며 초기 live 어댑터는 반환하지 않는다. `demo`는 샘플일 뿐 실제 계정의 수집 완료를 뜻하지 않는다. timestampPolicy는 원본에 오프셋이 없는 행이 하나라도 있으면 설정 기반 정책을 반환한다. warnings 예시는 `PARTIAL_HISTORY`, `NICKNAME_UID_LIMITATION`, `STALE_DATA`, `OUTSIDE_API_RETENTION`, `EPHEMERAL_STORAGE`, `DROPPED_RECORDS`, `TIMESTAMP_ASSUMPTION`이다. 오류가 발생해도 cached live를 반환할 경우 HTTP 200과 stale 경고를 함께 보낸다.

캐릭터 행은 경기 수 내림차순, 동률 code 오름차순이다. 명시 선택된 캐릭터는 경기가 없어도 모두 행을 반환한다. 페이지 번호가 결과 범위를 넘어가면 matches=[], 기존 summary/characters/total을 유지한다. 전체 0건일 때 totalPages=0이다. stats 응답은 `Cache-Control: no-store`를 권장하고 상위 API 호출 캐시는 서버에서 관리한다.

`trend`는 중복 제거와 날짜·모드·복수 실험체 필터를 모두 적용한 뒤, `matches` 페이지를 자르기 전에 한국 시간 날짜별로 집계한다. 경기가 있는 날짜만 오름차순으로 반환하며 빈 날짜는 0% 행을 만들지 않는다. 순위가 유효한 경기만 `rankSamples`, 승률의 분모, 평균 순위에 포함한다. 순위 표본이 없으면 `winRate`와 `averageRank`는 `null`이다. 이 일별 API 데이터는 그대로 유지한다. 화면은 요청한 전체 날짜 범위를 최대 7개의 연속된 달력 날짜 구간으로 요약한다. 구간 승률은 승리 합계/유효 순위 표본 합계, 구간 평균 순위는 각 날짜의 평균 순위에 표본 수를 곱한 합계/표본 합계다. 빈 구간이나 순위 표본이 없는 구간은 `null` 수치로 보여주며 선으로 연결하지 않는다.

## 오류 계약

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "시작일은 종료일보다 늦을 수 없습니다.",
    "fields": { "startDate": "종료일 이전 날짜를 선택해 주세요." },
    "retryAfterSeconds": null
  }
}
```

| HTTP | code | 의미 |
| --- | --- | --- |
| 400 | INVALID_QUERY | 입력 검증 실패 |
| 404 | UPSTREAM_NOT_FOUND | 공식 API가 조회 결과를 제공하지 않음; 플레이어 또는 조회 대상의 존재 여부는 미확인 |
| 429 | RATE_LIMITED | 로컬/공식 요청 한도, 가능한 경우 Retry-After 응답 헤더 |
| 503 | LIVE_NOT_CONFIGURED | live인데 키가 없음 |
| 503 | UPSTREAM_TIMEZONE_REQUIRED | 시간대 없는 원본 시각을 안전하게 해석할 설정 없음 |
| 502 | UPSTREAM_AUTH_FAILED | 공식 API가 401을 반환함; 비밀값은 노출하지 않음 |
| 502 | UPSTREAM_FORBIDDEN | 공식 API가 403을 반환함; 권한 또는 요청 제한 사유는 미확인 |
| 502 | UPSTREAM_INVALID_RESPONSE | JSON·응답 envelope·UID 등 필수 필드가 유효하지 않음 |
| 502 | UPSTREAM_UNAVAILABLE | 그 밖의 공식 API 오류 또는 연결 실패 |
| 504 | UPSTREAM_TIMEOUT | 외부 시간 초과 |
| 503 | STORAGE_UNAVAILABLE | 설정된 DB 연결 실패; 조용한 메모리 전환 금지 |

서버의 데이터 출처는 환경 설정으로 정한다. 클라이언트가 `source=live` 파라미터를 보내 키나 서버 설정을 우회할 수 없다. 데모에서 닉네임 요청은 샘플로 실행하며 응답 nickname은 반드시 실제 fixture 이름을 유지하고 화면에 샘플임을 표시한다.
