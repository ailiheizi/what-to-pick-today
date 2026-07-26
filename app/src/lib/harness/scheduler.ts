export type ScheduledTask<T> = {
  id: string
  run: (signal: AbortSignal, attempt: number) => Promise<T>
}

type SchedulerOptions = {
  concurrency: number
  retries: number
  signal: AbortSignal
  onRetry?: (taskId: string, attempt: number, error: Error) => void
  onFailed?: (taskId: string, error: Error) => void
}

type QueueItem<T> = ScheduledTask<T> & { attempt: number }

export class TaskScheduler<T = void> {
  #options: SchedulerOptions
  #queue: QueueItem<T>[] = []
  #active = 0
  #results: T[] = []
  #resolve: ((results: T[]) => void) | null = null

  constructor(options: SchedulerOptions) {
    this.#options = options
  }

  add(task: ScheduledTask<T>) {
    this.#queue.push({ ...task, attempt: 0 })
  }

  run(): Promise<T[]> {
    return new Promise((resolve) => {
      this.#resolve = resolve
      this.#pump()
    })
  }

  #pump() {
    if (this.#options.signal.aborted) this.#queue = []
    while (!this.#options.signal.aborted && this.#active < this.#options.concurrency && this.#queue.length) {
      const item = this.#queue.shift()
      if (!item) break
      this.#active += 1
      item.run(this.#options.signal, item.attempt)
        .then((result) => this.#results.push(result))
        .catch((reason: unknown) => {
          const error = reason instanceof Error ? reason : new Error(String(reason))
          if (!this.#options.signal.aborted && item.attempt < this.#options.retries) {
            item.attempt += 1
            this.#options.onRetry?.(item.id, item.attempt, error)
            this.#queue.push(item)
          } else if (!this.#options.signal.aborted) {
            this.#options.onFailed?.(item.id, error)
          }
        })
        .finally(() => {
          this.#active -= 1
          this.#pump()
          this.#finishIfIdle()
        })
    }
    this.#finishIfIdle()
  }

  #finishIfIdle() {
    if (this.#active !== 0 || this.#queue.length !== 0 || !this.#resolve) return
    const resolve = this.#resolve
    this.#resolve = null
    resolve([...this.#results])
  }
}
