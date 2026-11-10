import DOMPurify from 'dompurify'

// Markdown 由用户提交，md-editor-v3 的预览会把渲染结果直接写进 innerHTML，
// 而且默认不做任何净化（sanitize 默认就是恒等函数）。一条
// `<img src=x onerror=...>` 就能在看帖人的浏览器里以他的身份发请求。
// 2026-09 那次事故正是这样把 `__Secure-better-auth.session_token` 偷走的。
//
// 这里统一兜底：任何走 MdPreview / MdEditor 的内容都必须先过 DOMPurify。
// html profile 只放行普通 HTML，SVG / MathML 整类禁止（<svg onload> 是
// 这类攻击的常见载体，而本项目的 Markdown 不需要内联 SVG）。
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'srcdoc'],
}

export function sanitizeMarkdownHtml(html: string): string {
  if (!html) return ''
  // 服务端不渲染 Markdown 预览（md-editor 在客户端挂载时才生成 HTML），
  // DOMPurify 在 Node 里也没有 DOM 可用。这里给最保守的兜底：宁可空白，
  // 也不把未经净化的 HTML 交出去。
  if (import.meta.server) return ''
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}
