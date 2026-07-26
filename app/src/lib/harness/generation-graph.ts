import { Annotation, END, Send, START, StateGraph } from '@langchain/langgraph/web'
import { builderAgentFor } from './agents.ts'
import type { CandidateVariant } from './types.ts'

export type ComponentAgentJob<T> = {
  id: string
  variant: CandidateVariant
  run: () => Promise<T>
}

type GraphOptions = {
  signal: AbortSignal
  concurrency: number
  retries: number
  onRetry?: (jobId: string, attempt: number, error: Error) => void
  onFailed?: (jobId: string, error: Error) => void
}

const ComponentAgentState = Annotation.Root({
  jobs: Annotation<ComponentAgentJob<unknown>[]>(),
  job: Annotation<ComponentAgentJob<unknown> | null>(),
  results: Annotation<unknown[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
})

const AGENT_NODE = {
  motion: 'motion_agent',
  product: 'product_agent',
  explorer: 'explorer_agent',
} as const

/**
 * Browser-native LangGraph map/reduce graph. Conditional Send edges fan jobs
 * out to named specialist nodes; the results reducer is the fan-in boundary.
 */
export async function runComponentAgentGraph<T>(jobs: ComponentAgentJob<T>[], options: GraphOptions) {
  if (!jobs.length || options.signal.aborted) return []

  const runAgentNode = async (state: typeof ComponentAgentState.State) => {
    const job = state.job
    if (!job || options.signal.aborted) return { results: [] }
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      try {
        return { results: [await job.run()] }
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error(String(reason))
        lastError = error
        if (options.signal.aborted) return { results: [] }
        if (attempt < options.retries) options.onRetry?.(job.id, attempt + 1, error)
      }
    }
    options.onFailed?.(job.id, lastError ?? new Error('Agent 生成失败'))
    return { results: [] }
  }

  const graph = new StateGraph(ComponentAgentState)
    .addNode('motion_agent', runAgentNode)
    .addNode('product_agent', runAgentNode)
    .addNode('explorer_agent', runAgentNode)
    .addConditionalEdges(START, (state) => state.jobs.map((job) =>
      new Send(AGENT_NODE[builderAgentFor(job.variant).id], { job })))
    .addEdge('motion_agent', END)
    .addEdge('product_agent', END)
    .addEdge('explorer_agent', END)
    .compile()

  const state = await graph.invoke({ jobs, job: null, results: [] }, {
    signal: options.signal,
    maxConcurrency: options.concurrency,
  })
  return state.results as T[]
}
