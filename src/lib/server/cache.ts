import "server-only";

// Bounded, expiring process-local cache. Expired identities are removed on access.
export class ExpiringCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private maxEntries: number, private now = () => Date.now()) {}
  get(key: string): T | undefined {
    this.sweep();
    return this.entries.get(key)?.value;
  }
  set(key: string, value: T, ttlMs: number) {
    this.sweep();
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
  delete(key: string) { this.entries.delete(key); }
  private sweep() {
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(key);
  }
}
