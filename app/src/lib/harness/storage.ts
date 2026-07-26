import type { HarnessSnapshot } from './types.ts'

const DATABASE = 'what-to-pick-today'
const VERSION = 1
const PROJECTS = 'projects'

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

async function openDatabase() {
  const request = indexedDB.open(DATABASE, VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(PROJECTS)) {
      const store = database.createObjectStore(PROJECTS, { keyPath: 'sessionId' })
      store.createIndex('updatedAt', 'updatedAt')
    }
  }
  return requestResult(request)
}

export class HarnessStorage {
  async save(snapshot: HarnessSnapshot) {
    const database = await openDatabase()
    const transaction = database.transaction(PROJECTS, 'readwrite')
    transaction.objectStore(PROJECTS).put(snapshot)
    await transactionDone(transaction)
    database.close()
  }

  async load(sessionId: string) {
    const database = await openDatabase()
    const transaction = database.transaction(PROJECTS, 'readonly')
    const result = await requestResult(transaction.objectStore(PROJECTS).get(sessionId)) as HarnessSnapshot | undefined
    database.close()
    return result ?? null
  }

  async list() {
    const database = await openDatabase()
    const transaction = database.transaction(PROJECTS, 'readonly')
    const result = await requestResult(transaction.objectStore(PROJECTS).index('updatedAt').getAll()) as HarnessSnapshot[]
    database.close()
    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async remove(sessionId: string) {
    const database = await openDatabase()
    const transaction = database.transaction(PROJECTS, 'readwrite')
    transaction.objectStore(PROJECTS).delete(sessionId)
    await transactionDone(transaction)
    database.close()
  }
}

export const harnessStorage = new HarnessStorage()
