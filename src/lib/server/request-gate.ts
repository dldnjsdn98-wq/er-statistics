import "server-only";
import { AppError } from "./errors";

const timeoutError = () => new AppError("UPSTREAM_TIMEOUT", 504, "공식 API 대기 또는 응답 시간이 초과되었습니다.");
export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 60;
  const text = value.trim();
  const seconds = /^\d+$/.test(text) ? Number(text) : Math.ceil((Date.parse(text) - now) / 1000);
  // Preserve long delays; never turn a provider's long cooldown into an earlier retry.
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= (8_640_000_000_000_000 - now) / 1000 ? seconds : 60;
}
function limited<T>(work: Promise<T>, ms: number, abort?: () => void): Promise<T> {
  if (ms <= 0) { abort?.(); return Promise.reject(timeoutError()); }
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort?.(); reject(timeoutError()); }, ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
export function createRequestGate(options: { spacingMs?: number; requestMs?: number; totalMs?: number; maxPending?: number } = {}) {
  const { spacingMs = 1000, requestMs = 8000, totalMs = 20000, maxPending = 16 } = options;
  let tail: Promise<void> = Promise.resolve();
  let pending = 0, lastCall = -Infinity, blockedUntil = 0;
  const rateError = () => new AppError("RATE_LIMITED", 429, "공식 API 재시도 대기 중입니다. 안내된 시각 이후 다시 조회해 주세요.", Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)));
  return {
    block(seconds: number) { blockedUntil = Math.max(blockedUntil, Date.now() + seconds * 1000); },
    async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (Date.now() < blockedUntil) throw rateError();
      if (pending >= maxPending) throw new AppError("REQUEST_QUEUE_FULL", 503, "조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.", 1);
      pending++;
      const previous = tail;
      let release!: () => void;
      const turn = new Promise<void>(resolve => { release = resolve; });
      tail = previous.then(() => turn);
      const expires = Date.now() + totalMs;
      try {
        await limited(previous, expires - Date.now());
        if (Date.now() < blockedUntil) throw rateError();
        const delay = Math.max(0, lastCall + spacingMs - Date.now());
        if (delay) {
          if (delay >= expires - Date.now()) throw timeoutError();
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
        if (Date.now() >= expires) throw timeoutError();
        lastCall = Date.now();
        const controller = new AbortController();
        try {
          const remaining = Math.min(requestMs, expires - Date.now());
          if (remaining <= 0) throw timeoutError();
          return await limited(Promise.resolve().then(() => {
            if (controller.signal.aborted || Date.now() >= expires) throw timeoutError();
            return work(controller.signal);
          }), remaining, () => controller.abort());
        } catch (cause) {
          if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) throw timeoutError();
          throw cause;
        }
      } finally { pending--; release(); }
    },
  };
}
