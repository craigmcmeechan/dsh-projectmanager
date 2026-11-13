
import { handleProjectsRequest } from './routes.module.ts'
import { ChangeFeed } from './changes.module.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type {} from '@deepseek-ai/dsh-host-webserver'

import type { Context } from '@deepseek-ai/cordis'

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

import { BRAINSTORM_PROMPT, BRAINSTORM_SKILL_NAME } from '../stages/index.ts'

import { registerTools } from '../tools/index.ts'

export const name = 'ui-projects'

/**
 * `webServer` is required: the API lives on its route table, so the plugin must
 * not activate before that service exists.
 */
export const inject = ['webServer', 'tools']

/**
 * Mount the Projects host half.
 * @param ctx - owning context.
 */
export function apply(ctx: Context): void {
  // The pipeline needs a parent Agent, which only a tool call can supply. This
  // is why project_run exists rather than a "run" button in the panel.
  // One home path for every reader, so the tools and the HTTP surface cannot
  // disagree about which directory holds machine state.
  const home = resolveDshHome()
  registerTools(ctx, home)

  // The brainstorm skill is registered best-effort: a minimal profile has no
  // skills service, and that must not stop the plugin loading. It is
  // user-invocable only — a model-triggered version would intercept every
  // request with a clarifying interview, which is worse than absent.
  const skills = ctx.get('skills') as
    | { register?: (skill: unknown) => unknown }
    | undefined
  if (skills !== undefined && typeof skills.register === 'function') {
    try {
      skills.register({
        name: BRAINSTORM_SKILL_NAME,
        description:
          'Think a requirement through with the user before it enters the pipeline, then output requirement text for the requirement stage. User-invoked only.',
        source: 'runtime',
        content: BRAINSTORM_PROMPT,
        invocation: { modelInvocable: false, userInvocable: true },
      })
    } catch (error) {
      // Registration failure is a degraded feature, never a failed boot.
      ctx.logger?.warn?.('project-manager: brainstorm skill not registered: %s', String(error))
    }
  }

  // One change feed: the route handler publishes into it, the sidebar listens.
  const changes = new ChangeFeed()

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/api/projects',
      auth: 'required',
      handler: async (req, res) => {
        // The stream is its own response shape, so it is answered before the
        // JSON dispatcher sees it.
        if (req.method === 'GET' && (req.url ?? '').split('?')[0]?.replace(/\/+$/, '') === '/api/projects/events') {
          await serveChangeStream(req, res, changes)
          return
        }
        await handleProjectsRequest(req, res, home, changes)
      },
    }),
  )
}

/**
 * Hold one Server-Sent Events response open for a connected client.
 *
 * Written against the raw Node response rather than a framework response: this
 * route is a stream that stays open, and buffering anywhere along the path would
 * make the list update in bursts or not at all.
 *
 * @param req - request, used only to notice the client going away.
 * @param res - response to stream into.
 * @param changes - the feed to attach to.
 */
async function serveChangeStream(
  req: IncomingMessage,
  res: ServerResponse,
  changes: ChangeFeed,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    // `no-transform` asks intermediaries not to buffer or recompress the body.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  // Flush the headers so the browser opens the stream before the first event.
  res.flushHeaders?.()
  const detach = changes.add(
    (text) => res.write(text),
    () => res.end(),
  )
  // A closed tab ends the request; without this the client would linger.
  req.on('close', detach)
}
