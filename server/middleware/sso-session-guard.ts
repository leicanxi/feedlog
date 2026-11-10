// Blocks identity elevation on product-SSO sessions.
//
// An SSO session asserts an org-provided email that FeedLog never verified, so
// it must not set/change a password, change email, edit profile, or bind a
// login method — any of which would turn a borrowed email into a fully-owned
// account. Nor may it reach org-management or admin endpoints: better-auth's
// organization plugin enforces permission off the member table, and its admin
// plugin off user.role — both bypass our requireOrg* gates and the host-binding
// collar, so an SSO session whose email matches an owner/admin could otherwise
// drive them. Blocking the /api/auth/organization/ and /api/auth/admin/ prefixes
// wholesale stays robust as better-auth adds endpoints.
//
// Keyed on session.ssoOrgId, NOT user.emailVerified: the latter is global and a
// separate verified login could flip it true for an SSO session to ride on.
// `auth` is auto-imported.

const BLOCKED_AUTH_ENDPOINTS = new Set([
  'set-password',
  'change-password',
  'change-email',
  'update-user',
  'delete-user',
  'link-social',
  'unlink-account',
])

function isBlockedForSso(path: string): boolean {
  if (!path.startsWith('/api/auth/')) return false
  const rest = path.slice('/api/auth/'.length)
  if (rest.startsWith('organization/') || rest.startsWith('admin/')) return true
  const suffix = rest.split(/[?/]/)[0]
  return !!suffix && BLOCKED_AUTH_ENDPOINTS.has(suffix)
}

// 前缀判断必须建立在「归一化之后的路径」上：`/api/auth/%61dmin/set-user-password`、
// `/api/auth//admin/set-user-password`、`/api/auth/x/../admin/...` 这类写法在原始
// path 上都对不上 `admin/`，但下游路由仍可能解析到同一个 handler。
// 所以把解码 / 折叠斜杠 / 消解 `.` `..` 的每种形态都查一遍，任一命中即拦截。
function pathVariants(path: string): string[] {
  const variants = new Set<string>()
  let current = path.split(/[?#]/)[0]!

  for (let i = 0; i < 3; i++) {
    variants.add(current)
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    }
    catch {
      break
    }
    if (decoded === current) break
    current = decoded
  }
  variants.add(current)

  const collapsed = current.replace(/\/{2,}/g, '/')
  variants.add(collapsed)

  const segments: string[] = []
  for (const segment of collapsed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  variants.add(`/${segments.join('/')}`)

  return [...variants]
}

export default defineEventHandler(async (event) => {
  if (!pathVariants(event.path).some(isBlockedForSso)) return

  const session = await auth.api.getSession({ headers: event.headers })
  const ssoOrgId = (session?.session as { ssoOrgId?: string | null } | undefined)?.ssoOrgId
  if (ssoOrgId) {
    throw createError({
      statusCode: 403,
      message: 'SSO sessions cannot manage credentials, profile, or organization',
    })
  }
})
