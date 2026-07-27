import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROVIDER_PRESETS,
  ModelListError,
  fetchModelList,
  getModelProviderPreset,
} from '../src/lib/harness/providers.ts'

test('provider presets cover popular OpenAI-compatible services and local development', () => {
  assert.deepEqual(PROVIDER_PRESETS.map(({ id }) => id), [
    'deepseek',
    'openai',
    'openrouter',
    'moonshot',
    'local-proxy',
    'custom',
  ])
  assert.deepEqual(getModelProviderPreset('deepseek'), {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    codeModel: 'deepseek-chat',
    description: '浏览器可直连，性价比高',
    requiresApiKey: true,
  })
  assert.equal(getModelProviderPreset('local-proxy').baseUrl, '/api/model')
  assert.equal(getModelProviderPreset('local-proxy').developmentOnly, true)
  assert.equal(getModelProviderPreset('custom').baseUrl, '')
})

test('fetchModelList uses GET /models with Bearer auth and returns sorted unique ids', async () => {
  const calls = []
  const models = await fetchModelList({
    baseUrl: 'https://provider.test/v1/',
    apiKey: '  secret-key  ',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({
        data: [
          { id: 'zeta' },
          { id: ' alpha ' },
          { id: 'zeta' },
          { id: '' },
          { name: 'missing-id' },
          null,
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })

  assert.deepEqual(models, ['alpha', 'zeta'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://provider.test/v1/models')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-key')
})

test('fetchModelList supports the local proxy without an API key', async () => {
  let request
  const models = await fetchModelList({
    baseUrl: '/api/model',
    apiKey: '',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return Response.json({ data: [{ id: 'local-model' }] })
    },
  })

  assert.deepEqual(models, ['local-model'])
  assert.equal(request.url, '/api/model/models')
  assert.equal('authorization' in request.init.headers, false)
})

test('fetchModelList reports authentication failures without exposing response secrets', async () => {
  await assert.rejects(
    fetchModelList({
      baseUrl: 'https://provider.test/v1',
      apiKey: 'bad-key',
      fetchImpl: async () => new Response('sensitive upstream body', { status: 401 }),
    }),
    (error) => {
      assert.ok(error instanceof ModelListError)
      assert.equal(error.code, 'auth')
      assert.equal(error.status, 401)
      assert.match(error.message, /API Key/)
      assert.doesNotMatch(error.message, /sensitive/)
      return true
    },
  )
})

test('fetchModelList gives actionable errors for CORS/network and malformed responses', async () => {
  await assert.rejects(
    fetchModelList({
      baseUrl: 'https://provider.test/v1',
      apiKey: 'key',
      fetchImpl: async () => { throw new TypeError('Failed to fetch') },
    }),
    (error) => error instanceof ModelListError
      && error.code === 'network'
      && /CORS/.test(error.message)
      && /手动填写/.test(error.message),
  )

  await assert.rejects(
    fetchModelList({
      baseUrl: 'https://provider.test/v1',
      apiKey: 'key',
      fetchImpl: async () => Response.json({ models: [] }),
    }),
    (error) => error instanceof ModelListError
      && error.code === 'invalid_response'
      && /data/.test(error.message),
  )
})

test('fetchModelList validates the base URL before making a request', async () => {
  let called = false
  await assert.rejects(
    fetchModelList({
      baseUrl: 'ftp://provider.test/v1',
      apiKey: 'key',
      fetchImpl: async () => {
        called = true
        return Response.json({ data: [] })
      },
    }),
    (error) => error instanceof ModelListError && error.code === 'invalid_url',
  )
  assert.equal(called, false)
})
