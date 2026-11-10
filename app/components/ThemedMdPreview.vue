<script setup lang="ts">
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'

// Read-only counterpart of ThemedMdEditor: forwards everything (incl. the
// one-way model-value) via $attrs and binds `theme` to the global `<html>.dark`
// contract so rendered markdown follows the app theme automatically.
defineOptions({ inheritAttrs: false })
const theme = useEditorTheme()
const attrs = useAttrs()

// 调用方自己的 sanitize（目前是 attachment: 链接改写）先跑，最后统一过一遍
// DOMPurify —— 保证不管调用方传没传、传了什么，出去的都是净化过的 HTML。
const sanitize = (html: string) => {
  const passthrough = attrs.sanitize as ((h: string) => string) | undefined
  return sanitizeMarkdownHtml(typeof passthrough === 'function' ? passthrough(html) : html)
}
</script>

<template>
  <MdPreview :theme="theme" v-bind="$attrs" :sanitize="sanitize" />
</template>
