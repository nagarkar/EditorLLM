// ============================================================
// DocPropsCache.ts — Write-through cache for DocumentProperties.
//
// Design:
//   READ  — CacheService first; on miss, load from DocumentProperties
//           and populate the cache.
//   WRITE — DocumentProperties first (source of truth, durable);
//           then update CacheService. Cache failures are non-fatal.
//
// Cache scope: getDocumentCache() matches DocumentProperties' document
// scope — all editors of the same document share the same cached view.
//
// Race conditions: Concurrent writes from multiple editors produce a
// short inconsistency window (≤ CACHE_TTL_SECS). This is acceptable
// for all current use cases. callers that require strict consistency
// (e.g. publisherSetActiveVersion) must acquire a LockService lock
// before calling write().
// ============================================================

const DocPropsCache = (() => {
  const CACHE_TTL_SECS = 300;   // 5-minute TTL — matches DocumentProperties' change frequency

  function cache_(): GoogleAppsScript.Cache.Cache {
    return CacheService.getDocumentCache();
  }

  function cacheKey_(key: string): string {
    // Prefix avoids collisions with other GAS cache entries in the same document cache.
    return `editorllm:dp:${key}`;
  }

  /**
   * Returns the stored value, checking CacheService first.
   * On a cache miss the value is loaded from DocumentProperties and the
   * cache is primed so subsequent reads are fast.
   */
  function read(key: string): string | null {
    try {
      const hit = cache_().get(cacheKey_(key));
      if (hit !== null) return hit;
    } catch (_) {}
    const value = PropertiesService.getDocumentProperties().getProperty(key);
    if (value !== null) {
      try { cache_().put(cacheKey_(key), value, CACHE_TTL_SECS); } catch (_) {}
    }
    return value;
  }

  /**
   * Writes to DocumentProperties (durable), then updates CacheService.
   * The cache update is the "lazy" half — it runs after the durable write
   * and is wrapped in try/catch so a cache failure never fails the operation.
   */
  function write(key: string, value: string): void {
    PropertiesService.getDocumentProperties().setProperty(key, value);
    try { cache_().put(cacheKey_(key), value, CACHE_TTL_SECS); } catch (_) {}
  }

  /**
   * Bulk write. DocumentProperties.setProperties first, then cache.putAll.
   */
  function writeMany(entries: Record<string, string>): void {
    PropertiesService.getDocumentProperties().setProperties(entries);
    try {
      const cacheEntries: Record<string, string> = {};
      for (const key of Object.keys(entries)) {
        cacheEntries[cacheKey_(key)] = entries[key];
      }
      cache_().putAll(cacheEntries, CACHE_TTL_SECS);
    } catch (_) {}
  }

  /**
   * Deletes from DocumentProperties and removes from cache.
   */
  function remove(key: string): void {
    PropertiesService.getDocumentProperties().deleteProperty(key);
    try { cache_().remove(cacheKey_(key)); } catch (_) {}
  }

  /**
   * Removes only from cache, leaving DocumentProperties unchanged.
   * Forces the next read to re-fetch from DocumentProperties.
   */
  function invalidate(key: string): void {
    try { cache_().remove(cacheKey_(key)); } catch (_) {}
  }

  return { read, write, writeMany, remove, invalidate };
})();
