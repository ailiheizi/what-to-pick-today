import assert from 'node:assert/strict'
import test from 'node:test'
import { HarnessStorage, harnessStorage } from '../src/lib/harness/storage.ts'

/**
 * Minimal in-memory IndexedDB double. It only implements the surface
 * `storage.ts` actually touches: open/upgrade, readwrite put+delete,
 * readonly get, and an `updatedAt` index `getAll()`.
 */
function createFakeIndexedDB() {
  const rows = new Map()
  const stats = { opens: 0, puts: 0, deletes: 0, gets: 0, getAlls: 0, transactions: 0 }

  function request(execute) {
    const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null }
    queueMicrotask(() => {
      try {
        req.result = execute(req)
        req.onsuccess?.()
      } catch (error) {
        req.error = error
        req.onerror?.()
      }
    })
    return req
  }

  function createStore() {
    return {
      put(value) {
        stats.puts += 1
        rows.set(value.sessionId, structuredClone(value))
        return request(() => undefined)
      },
      delete(sessionId) {
        stats.deletes += 1
        rows.delete(sessionId)
        return request(() => undefined)
      },
      get(sessionId) {
        stats.gets += 1
        const row = rows.get(sessionId)
        return request(() => (row ? structuredClone(row) : undefined))
      },
      index(name) {
        assert.equal(name, 'updatedAt')
        return {
          getAll: () => {
            stats.getAlls += 1
            return request(() => [...rows.values()]
              .map((row) => structuredClone(row))
              .sort((a, b) => a.updatedAt - b.updatedAt))
          },
        }
      },
    }
  }

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => createStore(),
    onversionchange: null,
    onclose: null,
    close() {},
    transaction() {
      stats.transactions += 1
      const transaction = { oncomplete: null, onerror: null, onabort: null, error: null, objectStore: () => createStore() }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    },
  }

  return {
    stats,
    rows,
    factory: {
      open() {
        stats.opens += 1
        return request(() => database)
      },
    },
  }
}

function snapshot(sessionId, updatedAt, requirement = `req-${updatedAt}`) {
  return {
    version: 1,
    sessionId,
    requirement,
    phase: 'generating',
    createdAt: 1,
    updatedAt,
    plan: null,
    direction: null,
    candidates: [],
    selections: {},
    review: null,
    events: [],
  }
}

function fastStorage(fake) {
  return new HarnessStorage({ debounceMs: 20, maxWaitMs: 120, indexedDB: fake.factory })
}

test('20 rapid saves collapse into a single write and the last snapshot wins', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const promises = []
  for (let index = 0; index < 20; index += 1) promises.push(storage.save(snapshot('s1', index)))
  await Promise.all(promises)

  // Before: 20 opens / 20 transactions / 20 puts. After: 1 / 1 / 1.
  assert.equal(fake.stats.puts, 1, '20 saves must coalesce into one put')
  assert.equal(fake.stats.transactions, 1, '20 saves must use one transaction')
  assert.equal(fake.stats.opens, 1, 'the connection must be reused, not reopened per call')
  assert.equal(fake.rows.get('s1').updatedAt, 19)
  assert.equal(fake.rows.get('s1').requirement, 'req-19')
})

test('every save promise resolves, none are dropped', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const settled = new Array(20).fill(false)
  const promises = []
  for (let index = 0; index < 20; index += 1) {
    promises.push(storage.save(snapshot('s1', index)).then(() => { settled[index] = true }))
  }
  await Promise.all(promises)

  assert.deepEqual(settled, new Array(20).fill(true))
})

test('saves for different sessions are coalesced independently', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  await Promise.all([
    storage.save(snapshot('a', 1)),
    storage.save(snapshot('a', 2)),
    storage.save(snapshot('b', 3)),
    storage.save(snapshot('b', 4)),
  ])

  assert.equal(fake.stats.puts, 2)
  assert.equal(fake.rows.get('a').updatedAt, 2)
  assert.equal(fake.rows.get('b').updatedAt, 4)
})

test('a continuous save stream still lands within the max-wait window', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const promises = []
  // Each save is closer together than the 20ms debounce, so a pure trailing
  // debounce would starve forever. The 120ms max-wait must force a write.
  for (let index = 0; index < 30; index += 1) {
    promises.push(storage.save(snapshot('stream', index)))
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.ok(fake.stats.puts >= 1, 'max-wait must force at least one intermediate write')
  assert.ok(fake.stats.puts < 30, 'max-wait must not defeat coalescing')
  await Promise.all(promises)
  assert.equal(fake.rows.get('stream').updatedAt, 29)
})

test('load right after save observes the new data (read-your-writes)', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  void storage.save(snapshot('s1', 7, 'pending-requirement'))
  const loaded = await storage.load('s1')

  assert.ok(loaded)
  assert.equal(loaded.updatedAt, 7)
  assert.equal(loaded.requirement, 'pending-requirement')
})

test('load resolves null for an unknown session', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)
  assert.equal(await storage.load('missing'), null)
})

test('list flushes pending writes and sorts by updatedAt descending', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  void storage.save(snapshot('a', 10))
  void storage.save(snapshot('b', 30))
  void storage.save(snapshot('c', 20))
  const listed = await storage.list()

  assert.deepEqual(listed.map((row) => row.sessionId), ['b', 'c', 'a'])
})

test('remove cancels a pending save and the session stays removed', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const pending = storage.save(snapshot('s1', 1))
  await storage.remove('s1')
  // The dropped save must still settle so awaiting callers never hang.
  await pending

  assert.equal(fake.rows.has('s1'), false)
  // Give the old debounce + max-wait timers a chance to misfire.
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(fake.rows.has('s1'), false, 'a cancelled save must not resurrect the session')
  assert.equal(await storage.load('s1'), null)
})

test('remove waits for an already in-flight write of the same session', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const pending = storage.save(snapshot('s1', 1))
  await new Promise((resolve) => setTimeout(resolve, 40)) // let the debounce fire
  await pending
  assert.equal(fake.rows.has('s1'), true)

  await storage.remove('s1')
  assert.equal(fake.rows.has('s1'), false)
  assert.equal(await storage.load('s1'), null)
})

test('remove does not disturb pending writes for other sessions', async () => {
  const fake = createFakeIndexedDB()
  const storage = fastStorage(fake)

  const kept = storage.save(snapshot('keep', 5))
  await storage.remove('drop')
  await kept

  assert.equal(fake.rows.get('keep').updatedAt, 5)
})

test('flush() drains every pending session immediately', async () => {
  const fake = createFakeIndexedDB()
  const storage = new HarnessStorage({ debounceMs: 5_000, maxWaitMs: 10_000, indexedDB: fake.factory })

  const promises = [storage.save(snapshot('a', 1)), storage.save(snapshot('b', 2))]
  await storage.flush()

  assert.equal(fake.stats.puts, 2)
  await Promise.all(promises)
})

test('save rejections propagate to every coalesced caller', async () => {
  const fake = createFakeIndexedDB()
  const storage = new HarnessStorage({
    debounceMs: 5,
    maxWaitMs: 20,
    indexedDB: { open: () => { throw new Error('boom') } },
  })

  const first = storage.save(snapshot('s1', 1))
  const second = storage.save(snapshot('s1', 2))
  await assert.rejects(first, /boom/)
  await assert.rejects(second, /boom/)
  assert.equal(fake.stats.puts, 0)
})

test('the module imports cleanly under Node with no window/document and no real IndexedDB', () => {
  assert.equal(typeof globalThis.window, 'undefined')
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(typeof globalThis.indexedDB, 'undefined')
  assert.ok(harnessStorage instanceof HarnessStorage)
  // Queuing a save must not throw even though no IndexedDB backend exists.
  const pending = harnessStorage.save(snapshot('node-only', 1))
  assert.ok(pending instanceof Promise)
  return assert.rejects(pending, /IndexedDB/)
})
