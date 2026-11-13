/**
 * Import a JSON document of Docker images.
 *
 * Written to accept the shapes an operator is likely to have rather than one
 * exact schema: a bare array of strings, an array of objects, or an object with
 * an `images` key. Being strict here would mean rejecting a file that is
 * obviously what they meant.
 *
 * The parser never writes. It reports what it understood and what it rejected,
 * so the caller can show a preview before committing anything.
 */

/** One image parsed from an import document. */
export interface ImportedImage {
  reference: string
  description?: string
  /** Function name to group under, resolved to an id by the caller. */
  functionName?: string
  /** DNS template to apply to the function, when the document carries one. */
  dnsTemplate?: string
  /** Port the function listens on. */
  port?: number
}

/** What an import document contained. */
export interface ParsedImageImport {
  images: ImportedImage[]
  /** Functions declared at the top level of the document. */
  functions: Array<{ name: string; description?: string; dnsTemplate?: string; port?: number }>
  /** Entries that could not be understood, with the reason. */
  rejected: Array<{ entry: string; reason: string }>
  error?: string
}

/** A readable label for a rejected entry. */
function label(entry: unknown): string {
  try {
    return JSON.stringify(entry).slice(0, 80)
  } catch {
    return String(entry).slice(0, 80)
  }
}

/** Coerce one entry into an image, or explain why it is not one. */
function toImage(entry: unknown): ImportedImage | { reason: string } {
  // `"postgres:17"` — the simplest possible file.
  if (typeof entry === 'string') {
    const reference = entry.trim()
    return reference.length === 0 ? { reason: 'empty string' } : { reference }
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { reason: 'expected a string or an object' }
  }
  const record = entry as Record<string, unknown>
  // Accept `reference` or the friendlier `image`.
  const reference = String(record.reference ?? record.image ?? '').trim()
  if (reference.length === 0) return { reason: 'no reference or image field' }
  const description = record.description === undefined ? undefined : String(record.description)
  const functionName = record.function ?? record.group ?? record.purpose
  const dnsTemplate = record.dnsTemplate ?? record.dns_template ?? record.template
  const rawPort = record.port
  const port = rawPort === undefined ? undefined : Number(rawPort)
  return {
    reference,
    ...(description === undefined ? {} : { description }),
    ...(functionName === undefined ? {} : { functionName: String(functionName).trim() }),
    ...(dnsTemplate === undefined ? {} : { dnsTemplate: String(dnsTemplate).trim() }),
    ...(port === undefined || !Number.isFinite(port) ? {} : { port }),
  }
}

/**
 * Parse an import document.
 *
 * @param text - the raw file contents.
 * @returns the images understood, the functions declared, and anything rejected.
 */
export function parseImageImport(text: string): ParsedImageImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { images: [], functions: [], rejected: [], error: `not valid JSON: ${(error as Error).message}` }
  }

  const rejected: ParsedImageImport['rejected'] = []
  const functions: ParsedImageImport['functions'] = []
  let rawImages: unknown[] = []

  if (Array.isArray(parsed)) {
    rawImages = parsed
  } else if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.images)) rawImages = record.images
    // A document that is only a function declaration is still useful.
    if (Array.isArray(record.functions)) {
      for (const entry of record.functions) {
        if (entry === null || typeof entry !== 'object') {
          rejected.push({ entry: label(entry), reason: 'a function must be an object' })
          continue
        }
        const fn = entry as Record<string, unknown>
        const name = String(fn.name ?? '').trim()
        if (name.length === 0) {
          rejected.push({ entry: label(entry), reason: 'a function needs a name' })
          continue
        }
        const template = fn.dnsTemplate ?? fn.dns_template ?? fn.template
        const rawPort = fn.port
        const port = rawPort === undefined ? undefined : Number(rawPort)
        functions.push({
          name,
          ...(fn.description === undefined ? {} : { description: String(fn.description) }),
          ...(template === undefined ? {} : { dnsTemplate: String(template) }),
          ...(port === undefined || !Number.isFinite(port) ? {} : { port }),
        })
      }
    }
    if (rawImages.length === 0 && functions.length === 0) {
      return {
        images: [],
        functions: [],
        rejected: [],
        error: 'expected an array of images, or an object with an "images" or "functions" key',
      }
    }
  } else {
    return { images: [], functions: [], rejected: [], error: 'expected a JSON object or array' }
  }

  const images: ImportedImage[] = []
  const seen = new Set<string>()
  for (const entry of rawImages) {
    const result = toImage(entry)
    if ('reason' in result) {
      rejected.push({ entry: label(entry), reason: result.reason })
      continue
    }
    // A reference twice in one file is a mistake in the file, not two entries.
    if (seen.has(result.reference)) {
      rejected.push({ entry: result.reference, reason: 'duplicate reference in this document' })
      continue
    }
    seen.add(result.reference)
    images.push(result)
  }

  return {
    images,
    functions,
    rejected,
    ...(images.length === 0 && functions.length === 0
      ? { error: 'nothing usable found in the document' }
      : {}),
  }
}
