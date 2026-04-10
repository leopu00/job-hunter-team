import { spawn } from 'child_process'
import type { JhtConfig, ProviderConfig, ProviderId } from './jht-config'

export class LLMError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'auth' | 'unsupported' | 'upstream' | 'timeout') {
    super(message)
  }
}

export interface LLMRequest {
  system: string
  user: string
  maxTokens?: number
}

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o-mini',
  kimi: 'moonshot-v1-32k',
  minimax: 'abab6.5s-chat',
}

const CLI_TIMEOUT_MS = 120_000

export async function runLLM(config: JhtConfig, req: LLMRequest): Promise<string> {
  const id = config.active_provider
  const conf = config.providers[id]
  if (!conf) throw new LLMError(`provider "${id}" non configurato`, 'not_configured')

  if (conf.auth_method === 'subscription') {
    return runSubscription(id, conf, req)
  }
  return runApiKey(id, conf, req)
}

async function runApiKey(id: ProviderId, conf: ProviderConfig, req: LLMRequest): Promise<string> {
  if (!conf.api_key) throw new LLMError(`api_key mancante per ${id}`, 'auth')
  const model = conf.model ?? DEFAULT_MODELS[id]
  switch (id) {
    case 'anthropic':
    case 'claude':
      return callAnthropic(conf.api_key, model, req)
    case 'openai':
      return callOpenAI(conf.api_key, model, req)
    case 'kimi':
      return callMoonshot(conf.api_key, model, req)
    case 'minimax':
      throw new LLMError('estrazione CV via MiniMax non ancora supportata: configura Anthropic/OpenAI/Kimi oppure usa il wizard manuale', 'unsupported')
  }
}

async function runSubscription(id: ProviderId, _conf: ProviderConfig, req: LLMRequest): Promise<string> {
  switch (id) {
    case 'anthropic':
    case 'claude':
      return spawnCli('claude', ['--print', '--output-format', 'text'], req)
    case 'openai':
      return spawnCli('codex', ['exec', '--skip-git-repo-check', '-'], req)
    case 'kimi':
      return spawnCli('kimi', ['--print'], req)
    case 'minimax':
      throw new LLMError('subscription MiniMax non supportata: configura Anthropic/OpenAI/Kimi oppure usa il wizard manuale', 'unsupported')
  }
}

async function callAnthropic(apiKey: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LLMError(`Anthropic ${res.status}: ${text.slice(0, 200)}`, res.status === 401 ? 'auth' : 'upstream')
  }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const text = data.content?.find(c => c.type === 'text')?.text ?? ''
  if (!text) throw new LLMError('risposta Anthropic vuota', 'upstream')
  return text
}

async function callOpenAI(apiKey: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LLMError(`OpenAI ${res.status}: ${text.slice(0, 200)}`, res.status === 401 ? 'auth' : 'upstream')
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new LLMError('risposta OpenAI vuota', 'upstream')
  return text
}

async function callMoonshot(apiKey: string, model: string, req: LLMRequest): Promise<string> {
  const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LLMError(`Moonshot ${res.status}: ${text.slice(0, 200)}`, res.status === 401 ? 'auth' : 'upstream')
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new LLMError('risposta Moonshot vuota', 'upstream')
  return text
}

function spawnCli(bin: string, args: string[], req: LLMRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(new LLMError(`CLI "${bin}" non avviabile: ${(err as Error).message}`, 'not_configured'))
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new LLMError(`timeout CLI ${bin} (${CLI_TIMEOUT_MS}ms)`, 'timeout'))
    }, CLI_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf-8') })

    child.on('error', err => {
      clearTimeout(timer)
      reject(new LLMError(`CLI "${bin}" errore: ${err.message}`, 'not_configured'))
    })

    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(new LLMError(`CLI ${bin} exit ${code}: ${stderr.slice(0, 300)}`, 'upstream'))
      }
      const out = stdout.trim()
      if (!out) return reject(new LLMError(`CLI ${bin} output vuoto`, 'upstream'))
      resolve(out)
    })

    const payload = `${req.system}\n\n${req.user}\n`
    child.stdin.write(payload)
    child.stdin.end()
  })
}
