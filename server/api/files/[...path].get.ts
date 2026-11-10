// `blobStorage` auto-imported from server/utils/blob.ts.

// GET /api/files/** — Serve uploaded files (local dev proxy)
//
// SECURITY: 这个路由的参数会一路传到 blob provider 的 `getArrayBuffer(pathname)`，
// 而文件驱动做的是 `join(root, pathname)` —— 只要路径里能塞进 `..`，就能读到
// 容器内任意文件（2026-11 事故里 `/etc/passwd` 就是这么被读走的）。
//
// 关键点：blobStorage.serve 内部还会自己 `decodeURIComponent` 一次，所以只校验
// 原始字符串不够 —— `%252e%252e%252f` 解一层是 `%2e%2e%2f`，再解一次才是 `../`。
// 这里对每一层解码结果都校验，深度用完就拒绝。
const MAX_DECODE_DEPTH = 4

function rejectPath(message = 'Invalid file path') {
  return createError({ statusCode: 400, message })
}

function assertSafeSegment(raw: string, prefix: string) {
  if (!raw || raw.includes('\0') || raw.includes('\\'))
    throw rejectPath()

  // '' / '.' / '..' 任何一段出现都直接拒：合法上传键永远是
  // `<prefix>/<orgId>/<name>-<uuid>.<ext>`，不含空段。
  const segments = raw.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..'))
    throw rejectPath()

  // 只允许上传目录下的键，别的一律当成不存在，避免泄露「存在性」信息。
  if (!raw.startsWith(`${prefix}/`))
    throw createError({ statusCode: 404, message: 'File not found' })
}

export default defineEventHandler(async (event) => {
  const rawPath = getRouterParam(event, 'path')
  if (!rawPath)
    throw createError({ statusCode: 400, message: 'Path required' })

  const prefix = (useRuntimeConfig().public.uploadPrefix as string | undefined) || 'uploads'

  let current = rawPath
  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth++) {
    assertSafeSegment(current, prefix)

    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    }
    catch {
      // 非法百分号转义：交给 provider 去 404/500，它构不成穿越。
      break
    }
    if (decoded === current)
      break
    current = decoded
  }

  // 传原始串（不是解码后的）：provider 自己会解一次，正好对上上面校验过的第一层。
  return blobStorage.serve(event, rawPath)
})
