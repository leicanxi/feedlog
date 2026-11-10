import sanitizeHtml from 'sanitize-html'

// Markdown 正文由用户提交，md-editor-v3 的预览会把渲染结果直接写进 innerHTML，
// 且它自带的 sanitize 选项默认是恒等函数 —— 等于不净化。一条
// `<img src=x onerror=...>` 就能在看帖人的浏览器里以他的身份发请求。
//
// 这里统一兜底：任何走 MdPreview / MdEditor 的内容都必须先过这一层。
//
// 为什么是 sanitize-html 而不是 DOMPurify：DOMPurify 需要 DOM，而文章正文是
// **服务端**就渲染进 HTML 的（首屏 + SEO 都依赖它）。在 Nitro 里没有 window，
// 只能退化成「服务端不放正文、客户端再补」，那是可见的倒退。sanitize-html 是
// 纯字符串解析，服务端和浏览器里行为一致。
//
// 白名单刻意与上游 upstream/main 的 app/lib/markdown-render.ts 保持一致，
// 这样将来合并上游时渲染行为不会漂移。
const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img',
  'figure',
  'figcaption',
  'details',
  'summary',
  'input',
  'del',
  'button',
]

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['class', 'id', 'data-md-container', 'aria-hidden'],
    a: ['href', 'title', 'target', 'rel'],
    button: ['type', 'aria-label', 'aria-expanded', 'aria-live'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    input: ['type', 'checked', 'disabled'],
    th: ['colspan', 'rowspan', 'align'],
    td: ['colspan', 'rowspan', 'align'],
    ol: ['start'],
  },
  // 不允许 javascript: / data: / vbscript: 这类可执行协议。
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  transformTags: {
    button: sanitizeHtml.simpleTransform('button', { type: 'button' }),
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    // 任务列表的 checkbox 只有展示意义，强制 disabled，避免它被当成表单控件。
    input: (_tag, attrs) => ({
      tagName: 'input',
      attribs: {
        type: 'checkbox',
        disabled: '',
        ...(Object.hasOwn(attrs, 'checked') ? { checked: '' } : {}),
      },
    }),
  },
}

export function sanitizeMarkdownHtml(html: string): string {
  if (!html) return ''
  return sanitizeHtml(html, OPTIONS)
}
