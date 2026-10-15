# ER Statistics MVP 설계

작성일: 2026-10-15. 한국어 개인 전적 분석 웹 앱. 이 문서는 구현 기준이며 실제 API 호출 성공을 의미하지 않는다.

## 사용자에게 제공하는 기능

닉네임을 입력하고 시작일·종료일, 게임 모드, 여러 캐릭터를 선택해 하나의 결과를 조회한다. 기간은 사용자가 직접 지정한다. 날짜와 모드와 캐릭터 조건은 AND, 선택한 캐릭터끼리는 OR다. 캐릭터 미선택은 전체다. 기간 여러 개를 비교하는 기능은 범위 밖이다.

첫 화면은 바로 작동하는 샘플 프로필, 최근 30일, 전체 모드, 전체 캐릭터를 보여준다. 상단에 항상 `데모 데이터` 또는 `실제 API · 마지막 수집 시각`을 표시한다. 데모는 임의 닉네임을 실제 조회한 것처럼 보여주지 않고 `데모플레이어` 샘플임을 명시한다. API 실패 시 데모로 자동 전환하지 않는다.

화면 순서:

1. 서비스 이름, 데이터 출처 배지, 닉네임 검색.
2. 시작일·종료일, 전체/일반/랭크 모드, 검색 가능한 다중 캐릭터 선택, 조회 버튼. 선택한 캐릭터는 해제 가능한 칩과 개수로 표시한다.
3. 수집 범위/누락 가능성 안내. 기간 밖 미수집 데이터와 실제 0경기 상태를 구별한다.
4. 경기 수, 승률, 평균 순위, 평균 킬, 평균 어시스트, 평균 플레이어 피해량.
5. 캐릭터별 경기 수·승률·평균 순위·평균 킬 비교 표.
6. 최근 경기 목록(일시, 캐릭터, 모드, 순위, 킬, 어시스트, 피해량). 20개씩 더 보기 또는 페이지 이동.

짙은 네이비 배경, 명확한 대비, 청록색 강조를 기본으로 한다. 외부 이미지나 폰트가 없어도 완전하게 표시한다. 모바일에서는 필터를 세로로 쌓고 표는 가로 스크롤을 제공한다. 입력의 label, 키보드 조작, 버튼 disabled 상태, 로딩·빈 결과·오류 상태를 구현한다. 스크린 리더에 조회 결과 변화를 알리고 이전 요청은 취소하거나 응답 순번으로 오래된 응답을 무시한다.

## 기술 결정

Next.js App Router + TypeScript, React, 일반 CSS를 사용한다. 같은 앱의 Route Handler가 서버 전용 API 어댑터와 집계 함수를 호출한다. 별도 백엔드, 로그인, 작업 큐, Redis, ORM은 초기 MVP에 필요 없다. Node 런타임을 사용하고 기본 검증은 TypeScript와 작은 런타임 검증 함수 또는 Zod로 한다.

```text
Browser → /api/characters, /api/stats
                   ↓ validate query
             StatsService
          ↙                     ↘
 DemoProvider               LiveProvider (server-only)
 deterministic fixtures       official API → normalize → pg repository
          ↘                     ↙
       deduplicate → filter → aggregate → DTO
```

권장 파일 경계는 `app/`, `components/`, `lib/domain/`(타입·날짜·필터·집계), `lib/server/`(provider·공식 API·저장소), `lib/demo/`, `db/`, `tests/`다. 모든 API 키 접근 및 DB 코드는 서버 전용 모듈에 둔다. 공식 API의 원본 응답 전체를 브라우저로 보내지 않는다.

환경 설정:

| 변수 | 의미 |
| --- | --- |
| `ER_DATA_SOURCE=demo` | 기본값. 키·DB·외부 연결 없이 실행 |
| `ER_DATA_SOURCE=live` | 실제 API 사용. 실패 시 명시적 오류 |
| `ER_API_KEY` | 서버 전용 `x-api-key`, `NEXT_PUBLIC_` 접두사 금지 |
| `DATABASE_URL` | live에서 PostgreSQL 영속 저장 활성화. 없으면 메모리 임시 저장임을 표시 |
| `ER_API_TIME_ZONE` | 시간대 없는 공식 startDtm 해석을 위한 명시적 `Asia/Seoul` 또는 `UTC` 설정 |

MVP의 live 모드에서 DB 없이 동작하게 해도 되지만 `storage: memory`와 재시작 시 기록 소실을 알려야 한다. 실제 배포에서는 PostgreSQL을 권장한다. 데모는 live 테이블에 절대 저장하지 않는다.

## 날짜·필터·집계의 정의

모든 사용자 날짜는 `Asia/Seoul`의 달력 날짜다. 종료일 포함 규칙은 `[시작일 00:00:00+09:00, 종료일 다음날 00:00:00+09:00)`이다. 예: 2026-10-01~2026-10-01은 UTC `2026-09-30T15:00:00Z <= startedAt < 2026-10-01T15:00:00Z`. 서버/브라우저 로컬 시간대에 의존하지 않는다. 유효한 날짜 여부를 엄격하게 검사하여 2월 30일 등을 거절한다. 날짜가 오늘 이후이거나 과거 90일 이전이어도 임의 기간 조회는 허용하고 수집 범위를 별도로 설명한다.

집계 대상은 `(uid, gameId)` 중복 제거 후의 경기다. 정렬은 시작 시각 내림차순, 동률이면 gameId를 안정적으로 비교한다. 모든 요약/캐릭터 통계는 페이지네이션 전 전체 필터 결과로 계산한다. gameRank=1을 승리로 정의한다. 평균과 승률은 원본 합계에서 계산하고 UI에서만 반올림한다. 경기 수가 0이면 승리 수 0, 비율·평균은 null이며 화면에서는 `—`다. 캐릭터를 선택했다면 0경기인 선택 캐릭터도 표에 남긴다. 전체 캐릭터 조회에서는 관측된 캐릭터만 표에 표시한다.

없거나 유효하지 않은 선택적 수치는 0으로 만들지 않고 null로 처리한다. 해당 평균의 분모는 그 수치가 유효한 경기 수다. 응답에 metricCounts를 포함하여 유효 표본 수를 드러낸다. 필수 식별/시간/캐릭터 필드가 깨진 행은 제외하고 coverage.droppedRecords로 공개한다. 상대 플레이어의 게임 데이터와 섞이지 않도록 UID별 사용자 전적 응답만 사용한다.

## 공식 API 연결과 확인 범위

공식 문서: [한국어 2026-07-24](https://developer.eternalreturn.io/static/media/OpenAPI_KR_20260724.html), [영어 2026-09-17](https://developer.eternalreturn.io/static/media/OpenAPI_EN_20260917_01.html). 설계에 사용한 아래 경로·필드는 상위 조사에서 문서 확인되었다. 이 작업 환경에는 키가 없고 live API 호스트가 허용되지 않아 실제 응답/인증/처리량은 검증하지 못했다.

기본 URL `https://open-api.bser.io`, 요청 헤더 `x-api-key`.

| 공식 경로 | 용도/제약 |
| --- | --- |
| `GET /v1/user/nickname?query={nickname}` | `{user:{uid,nickname}}`. 닉네임 변경으로 UID가 바뀌며 이전 닉네임 전적이 빠질 수 있음 |
| `GET /v1/user/games/uid/{uid}` | `userGames: BattleUserResult[]`, 최근 90일 제공 |
| `GET /v2/user/stats/uid/{userId}/{seasonId}/{matchingMode}` | 시즌 집계이므로 임의 기간 통계에 사용 금지 |
| `GET /v1/games/{gameId}` | 상세 경기. MVP에 필수 아님; 매 경기 N+1 호출하지 않음 |
| `GET /v2/data/Character` | 캐릭터 메타데이터 |
| `GET /v1/l10n/Korean` | 한국어 이름 소스. 응답에서 추가 URL을 반환하면 허용 호스트를 검증해야 함 |

문서 확인된 BattleUserResult 필드: `characterNum`, `startDtm`(Server time, 시간대 미명시), `gameRank`, `playerKill`, `playerAssistant`, `playerDeaths`, `damageToPlayer`, `playTime`(초). 내부 DTO는 characterCode/startedAt/kills/assists로 정규화한다. gameId/UID 및 matchingMode의 실제 자료형·누락 형태와 모드 코드 매핑은 어댑터 테스트와 실제 연결 시 재확인한다. 일반 2·랭크 3 매핑을 쓰면 명시적인 매핑 상수로 제한하고 기타 코드는 `unknown`으로 보존한다. `all`은 unknown도 포함한다.

시간대가 포함된 startDtm은 그 오프셋을 따른다. 시간대 없는 startDtm은 `ER_API_TIME_ZONE`이 설정된 경우에만 해석하며, 미설정이면 `UPSTREAM_TIMEZONE_REQUIRED`로 실패한다. 추측으로 UTC나 실행 머신 시간대를 붙이지 않는다. 설정된 시간대는 coverage.timestampPolicy로 노출한다.

페이지네이션·커서 계약과 전체 결과 보장은 아직 확인되지 않았다. 첫 구현은 문서로 확인한 요청만 보내며 받은 결과를 `completeness: partial`로 보고한다. 커서 이름이나 시간 정렬을 추정하지 않는다. 첫/마지막 경기 시각만으로 그 사이의 수집 완료를 주장할 수 없다. 후속 검증에서 전체 페이지 순회/종료 조건이 확인되어야 완전 수집 구간을 기록한다.

MMR/RP, 티어, 공식 시즌 승률, 캐릭터 초상화, 게임 메타 점수는 초기 화면에서 제외한다. MMR 필드는 일부 API 사용자에게만 제공되고 모드 예외가 있으므로 0이나 임의 값으로 대체하지 않는다.

## 수집·캐시·오류 정책

조회 시 닉네임을 해석하고 해당 UID 전적을 수집해 저장한 뒤 누적 저장분을 조회한다. 별도 전체 플레이어 크롤러는 만들지 않는다. 닉네임 캐시 60초, UID 전적 재수집 간격 60초, 메타데이터 캐시 24시간을 권장한다. 같은 UID 동시 요청은 진행 중 Promise로 합친다. 원격 호출은 타임아웃 8초, 제한된 재시도 최대 1회다. `429`는 Retry-After를 존중하고 즉시 반복하지 않는다. 실제 공식 처리량은 확인되지 않았으므로 숫자 SLA를 광고하지 않는다. 단일 인스턴스에서 키별 직렬 큐와 보수적 최소 호출 간격 1초를 기본으로 하되 배포 시 발급 정책에 맞게 조정한다. 다중 인스턴스 배포 전에 분산 제한으로 바꾼다.

원격 실패 시 저장된 live 데이터가 있으면 source=live, stale=true, 경고와 마지막 성공 수집 시각을 포함하여 반환할 수 있다. 저장분이 없으면 오류를 반환한다. 인증 실패, 429, 사용자 없음, 서비스 장애를 구별한다. API 키·Authorization·전체 외부 응답을 로그나 사용자 오류에 노출하지 않는다. 닉네임은 URLSearchParams로 인코딩한다. 공식 API base URL은 코드 상수이며 사용자 입력으로 바꾸지 않는다.

## PostgreSQL 저장 모델

초기 구현은 SQL migration 한 개와 `pg` 기반 저장소면 충분하다. 아래는 논리 스키마이며 실행 migration은 구현 단계에서 만든다.

```sql
players (
  uid text primary key,
  nickname text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null
);
player_games (
  uid text not null references players(uid),
  game_id text not null,
  started_at timestamptz not null,
  character_code integer not null,
  matching_mode integer,
  game_rank integer,
  kills integer,
  assists integer,
  deaths integer,
  damage_to_player double precision,
  play_time_seconds integer,
  ingested_at timestamptz not null,
  primary key (uid, game_id)
);
-- index player_games(uid, started_at DESC)
-- index player_games(uid, character_code, started_at DESC)
sync_runs (
  id bigint generated always as identity primary key,
  uid text not null references players(uid),
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  record_count integer not null default 0,
  dropped_records integer not null default 0,
  completeness text not null default 'partial',
  timestamp_policy text,
  error_code text
);
```

UID는 영구 계정 식별자로 취급하지 않는다. 닉네임에 unique 제약을 두거나 이름 변경 전후 UID를 자동 합치지 않는다. 최근 닉네임 조회 결과를 현재 조회 대상으로 사용한다. game_id/uid는 숫자가 커질 가능성이 있으므로 문자열로 보존한다. 수집은 트랜잭션 upsert로 재실행 가능하게 하며 최신 null이 기존의 유효 수치를 덮지 않도록 한다. 실패한 수집이 이전 성공 이력이나 데이터를 삭제하면 안 된다. 데모는 DB를 쓰지 않는다.

저장된 90일 이전 경기도 사용자가 지정한 기간에 포함할 수 있다. 단, 앱 수집 시작 이전의 전체 과거 전적을 되살릴 수는 없다. coverage에서 `최근 90일 API 범위`, `앱에 실제 보관된 경기 시각`, `전체 수집 미확인`을 서로 다른 정보로 표시한다.

## 구현 완료 기준

`npm install`, `npm run dev`만으로 키와 DB 없이 한국어 데모 화면이 동작한다. 날짜 범위+캐릭터 두 개+모드 조합이 같은 조건으로 요약·캐릭터표·경기 목록에 적용된다. 공개 클라이언트 번들에 API 키가 없다. live 연결 미검증 상태는 README에 명시한다. 상세 API와 검증 시나리오는 [api-contract.md](api-contract.md), [acceptance.md](acceptance.md)를 따른다.
