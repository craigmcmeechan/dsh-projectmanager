/**
 * A change feed for projects and templates.
 *
 * The sidebar lists projects and templates as rows, and both change at runtime:
 * a project is created, a template is deleted. Polling would show those changes
 * eventually; this pushes them, so the list reflects reality the moment it
 * changes.
 *
 * Server-Sent Events rather than WebSockets: the transport is one HTTP response
 * the plugin already owns, the browser reconnects on its own, and nothing here
 * needs a duplex channel.
 *
 * ## Why one stream, not two
 *
 * Projects and templates change for the same reasons and are rendered in the
 * same list, so one event carries both. A second stream would only double the
 * connection count and the chance of one lagging the other.
 */

/** Events this feed sends. */
export type ChangeEvent =
  | { kind: 'projects' }
  | { kind: 'templates' }

/** One connected client. */
interface Client {
  write: (text: string) => void
  close: () => void
}

/**
 * The feed itself.
 *
 * Held as a module-level registry rather than a Cordis service because the
 * producers are HTTP handlers in this plugin: they announce a change after
 * writing, and the only consumer is the sidebar.
 */
export class ChangeFeed {
  private readonly clients = new Set<Client>()
  /** How often a comment frame is sent to keep intermediaries from closing. */
  private readonly heartbeatMs: number
  private timer: ReturnType<typeof setInterval> | undefined

  /** @param heartbeatMs - idle keep-alive interval. */
  constructor(heartbeatMs = 25_000) {
    this.heartbeatMs = heartbeatMs
  }

  /**
   * Add one client and keep the connection open.
   *
   * The response is written by the caller, which owns the headers; this only
   * appends frames.
   * @param write - write one already-serialised frame.
   * @param close - end the response.
   * @returns a disposer removing the client.
   */
  add(write: (text: string) => void, close: () => void): () => void {
    const client: Client = { write, close }
    this.clients.add(client)
    this.startHeartbeat()
    // A comment frame immediately: some proxies buffer until they see bytes, and
    // the browser's EventSource only reports `open` once data arrives.
    write(': connected\n\n')
    return () => {
      this.clients.delete(client)
      if (this.clients.size === 0) this.stopHeartbeat()
    }
  }

  /**
   * Tell every connected client what changed.
   *
   * A client whose write throws is dropped: a dead response must not keep the
   * feed from serving the others.
   * @param event - what changed.
   */
  publish(event: ChangeEvent): void {
    const frame = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of [...this.clients]) {
      try {
        client.write(frame)
      } catch {
        this.clients.delete(client)
        try {
          client.close()
        } catch {
          // Already gone.
        }
      }
    }
  }

  /** Number of connected clients, for diagnostics. */
  size(): number {
    return this.clients.size
  }

  private startHeartbeat(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      for (const client of [...this.clients]) {
        try {
          client.write(': keep-alive\n\n')
        } catch {
          this.clients.delete(client)
        }
      }
    }, this.heartbeatMs)
    // Do not hold the process open for a feed.
    this.timer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }
}
