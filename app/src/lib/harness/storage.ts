import type { HarnessSnapshot } from './types.ts'

const DATABASE = 'what-to-pick-today'
const VERSION = 1
const PROJECTS = 'projects'

/**
 * 尾沿防抖窗口。会话里一次阶段跳变往往连续触发多个 persist（事件写入、候选更新、
 * 阶段切换），300ms 足以把它们吸收成一次写；同时低于人眼可察觉的“保存变慢”阈值。
 */
const DEBOUNCE_MS = 300
/**
 * 最长等待。持续不断的写入流（例如逐个候选完成）不能被防抖无限推迟，
 * 1.5s 保证至少每 1.5s 落盘一次，从而把页面被关闭时的数据丢失上限限定在 1.5s。
 */
const MAX_WAIT_MS = 1500

/** 连接可能被 versionchange / close 掐断，这些错误值得用新连接重试一次。 */
const CONNECTION_ERRORS = new Set(['InvalidStateError', 'InvalidAccessError', 'TransactionInactiveError'])

function noop() {}

function isConnectionError(error: unknown) {
  return error instanceof Error && CONNECTION_ERRORS.has(error.name)
}

type Gate = {
  promise: Promise<void>
  resolve: () => void
  reject: (reason: unknown) => void
}

function createGate(): Gate {
  let resolve: () => void = noop
  let reject: (reason: unknown) => void = noop
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  // 模块内部长期持有这个 promise。挂一个空 catch 让它始终“已被处理”，
  // 这样 session.ts 里 `void persist()` 式的调用不会变成 unhandled rejection；
  // 真正 await 的调用方依然会拿到同一个 rejection。
  promise.catch(noop)
  return { promise, resolve, reject }
}

type PendingWrite = {
  /** 只保留最新快照：最后一次写入获胜，绝不排队 N 份陈旧序列化。 */
  snapshot: HarnessSnapshot
  gate: Gate
  timer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
}

export type HarnessStorageOptions = {
  /** 尾沿防抖窗口（毫秒），默认 300。 */
  debounceMs?: number
  /** 首次入队后的最长等待（毫秒），默认 1500。 */
  maxWaitMs?: number
  /** 可选注入点（测试用），默认使用真实的 globalThis.indexedDB。 */
  indexedDB?: IDBFactory
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class HarnessStorage {
  #debounceMs: number
  #maxWaitMs: number
  #injected: IDBFactory | undefined
  /** sessionId -> 尚未入队的写入。 */
  #pending = new Map<string, PendingWrite>()
  /** 全局串行链，保证写 / 删 / 读之间的顺序（例如 remove 一定在既有写之后）。 */
  #chain: Promise<unknown> = Promise.resolve()
  #connection: Promise<IDBDatabase> | null = null
  #connected: IDBDatabase | null = null
  #hooksInstalled = false

  constructor(options: HarnessStorageOptions = {}) {
    this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS
    this.#maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS
    this.#injected = options.indexedDB
  }

  /**
   * 合并短时间内针对同一会话的连续保存。返回的 promise 只在数据真正落盘后 resolve，
   * 或者在该会话被 remove() 取消时 resolve —— 任何情况下都不会被静默丢弃。
   */
  save(snapshot: HarnessSnapshot): Promise<void> {
    this.#installFlushHooks()
    const sessionId = snapshot.sessionId
    const pending = this.#pending.get(sessionId)
    if (pending) {
      pending.snapshot = snapshot
      if (pending.timer !== null) clearTimeout(pending.timer)
      pending.timer = setTimeout(() => void this.#flushSession(sessionId), this.#debounceMs)
      return pending.gate.promise
    }
    const created: PendingWrite = {
      snapshot,
      gate: createGate(),
      timer: setTimeout(() => void this.#flushSession(sessionId), this.#debounceMs),
      maxTimer: setTimeout(() => void this.#flushSession(sessionId), this.#maxWaitMs),
    }
    this.#pending.set(sessionId, created)
    return created.gate.promise
  }

  async load(sessionId: string) {
    // read-your-writes：先把该会话尚未落盘的写入刷掉，再读。
    await this.#settle(sessionId)
    const result = await this.#withDatabase(async (database) => {
      const transaction = database.transaction(PROJECTS, 'readonly')
      return await requestResult(transaction.objectStore(PROJECTS).get(sessionId)) as HarnessSnapshot | undefined
    })
    return result ?? null
  }

  async list() {
    await this.flush()
    const result = await this.#withDatabase(async (database) => {
      const transaction = database.transaction(PROJECTS, 'readonly')
      return await requestResult(transaction.objectStore(PROJECTS).index('updatedAt').getAll()) as HarnessSnapshot[]
    })
    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async remove(sessionId: string) {
    const pending = this.#pending.get(sessionId)
    if (pending) {
      // 挂起的快照即将被这次删除取代：取消它，避免复活已删除的会话。
      // 仍然结算 gate，让 await save() 的调用方不会悬挂。
      this.#pending.delete(sessionId)
      this.#clearTimers(pending)
      pending.gate.resolve()
    }
    // #chain 是全局有序的：任何已经入队（正在写）的同会话写入都会先于删除完成。
    await this.#withDatabase(async (database) => {
      const transaction = database.transaction(PROJECTS, 'readwrite')
      transaction.objectStore(PROJECTS).delete(sessionId)
      await transactionDone(transaction)
    })
  }

  /** 立即落盘所有挂起的写入。页面隐藏 / 卸载时会自动调用。 */
  async flush() {
    const sessions = [...this.#pending.keys()]
    await Promise.all(sessions.map((sessionId) => this.#settle(sessionId)))
    // 排在链尾，等已入队的写入也结束。
    await this.#enqueue(async () => undefined)
  }

  #settle(sessionId: string) {
    return this.#flushSession(sessionId).then(noop, noop)
  }

  #flushSession(sessionId: string): Promise<void> {
    const pending = this.#pending.get(sessionId)
    if (!pending) {
      // 没有挂起写入时，仍要等链上已有的同会话写入结束，才算“已刷新”。
      return this.#enqueue(async () => undefined)
    }
    this.#pending.delete(sessionId)
    this.#clearTimers(pending)
    const snapshot = pending.snapshot
    const write = this.#withDatabase(async (database) => {
      const transaction = database.transaction(PROJECTS, 'readwrite')
      transaction.objectStore(PROJECTS).put(snapshot)
      await transactionDone(transaction)
    })
    write.then(pending.gate.resolve, pending.gate.reject)
    return pending.gate.promise
  }

  #clearTimers(pending: PendingWrite) {
    if (pending.timer !== null) clearTimeout(pending.timer)
    if (pending.maxTimer !== null) clearTimeout(pending.maxTimer)
    pending.timer = null
    pending.maxTimer = null
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(task)
    this.#chain = run.then(noop, noop)
    return run
  }

  #withDatabase<T>(task: (database: IDBDatabase) => Promise<T>): Promise<T> {
    return this.#enqueue(async () => {
      try {
        return await task(await this.#database())
      } catch (error) {
        if (!isConnectionError(error)) throw error
        // 连接被 versionchange / close 掐断，用新连接重试一次。
        this.#invalidate()
        return await task(await this.#database())
      }
    })
  }

  #database(): Promise<IDBDatabase> {
    if (this.#connection) return this.#connection
    const opening = this.#open()
    this.#connection = opening
    opening.catch(() => {
      if (this.#connection === opening) this.#invalidate()
    })
    return opening
  }

  async #open(): Promise<IDBDatabase> {
    const factory = this.#injected ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
    if (!factory) throw new Error('当前环境不支持 IndexedDB')
    const request = factory.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECTS)) {
        const store = database.createObjectStore(PROJECTS, { keyPath: 'sessionId' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    const database = await requestResult(request)
    this.#connected = database
    // 另一个标签页升级数据库时必须让路，否则会阻塞对方并让本连接失效。
    database.onversionchange = () => {
      this.#invalidate(database)
      database.close()
    }
    database.onclose = () => this.#invalidate(database)
    return database
  }

  #invalidate(database?: IDBDatabase) {
    if (database && this.#connected !== database) return
    this.#connection = null
    this.#connected = null
  }

  /** 浏览器专属；在 Node（测试）里 window/document 不存在，必须特性检测且不得抛错。 */
  #installFlushHooks() {
    if (this.#hooksInstalled) return
    this.#hooksInstalled = true
    const doc = typeof document === 'undefined' ? null : document
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') void this.flush()
      })
    }
    const win = typeof window === 'undefined' ? null : window
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', () => void this.flush())
    }
  }
}

export const harnessStorage = new HarnessStorage()
