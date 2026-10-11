import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, jsonResponse } from '../src/lib/server/payments.mjs'

const bucket = 'team-cvs'
const maxRequestSize = 4_096
const maxFileSize = 5 * 1024 * 1024
const allowedTypes = {
  pdf: ['application/pdf'],
  doc: ['application/msword', 'application/octet-stream'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
  txt: ['text/plain', 'application/octet-stream'],
}

export function validateCvMetadata(file) {
  if (!file || typeof file !== 'object') return null
  const extension = typeof file.name === 'string' ? file.name.split('.').at(-1)?.toLowerCase() : ''
  if (!extension || !Object.hasOwn(allowedTypes, extension)) return null
  if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxFileSize) return null
  if (typeof file.type !== 'string' || (file.type && !allowedTypes[extension].includes(file.type))) return null

  const name = file.name.split(/[\\/]/).at(-1)?.replace(/[^\w.-]/g, '_')
  if (!name) return null
  return { extension, name, type: file.type || allowedTypes[extension][0], size: file.size }
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > maxRequestSize) return jsonResponse(413, { error: 'Upload details are too large' })

    let file
    try {
      const rawBody = await request.text()
      if (!rawBody || rawBody.length > maxRequestSize) {
        return jsonResponse(413, { error: 'Upload details are too large' })
      }
      file = JSON.parse(rawBody)
    } catch {
      return jsonResponse(400, { error: 'Invalid upload details' })
    }

    const cv = validateCvMetadata(file)
    if (!cv) return jsonResponse(400, { error: 'Upload a PDF, DOC, DOCX, or TXT CV no larger than 5 MB' })

    let supabase
    try {
      supabase = getSupabaseAdmin()
    } catch (error) {
      console.error('Supabase is not configured for CV uploads:', error.message)
      return jsonResponse(503, { error: 'CV uploads are temporarily unavailable' })
    }

    const path = `team-applications/${randomUUID()}.${cv.extension}`
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: false })
    if (error || !data?.token) {
      console.error('Could not create signed CV upload URL:', error?.message || 'missing upload token')
      return jsonResponse(503, { error: 'Could not prepare CV upload' })
    }

    return jsonResponse(200, {
      path,
      token: data.token,
      name: cv.name,
      type: cv.type,
      size: cv.size,
    })
  },
}
