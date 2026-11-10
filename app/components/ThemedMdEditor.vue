<script setup lang="ts">
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

// Thin forwarding wrapper around md-editor's MdEditor that binds `theme` to the
// global `<html>.dark` contract, so every editor follows the app theme (incl.
// live OS changes) without each call site remembering to pass :theme. All other
// props/listeners flow through via $attrs; v-model and named slots
// (#defToolbars / #defFooters) are forwarded.
defineOptions({ inheritAttrs: false })
const model = defineModel<string>()
const theme = useEditorTheme()
const attrs = useAttrs()

// 编辑器的实时预览同样会把 HTML 写进 innerHTML：管理员打开/编辑一条带载荷的
// 帖子时会当场中招。调用方原有的 sanitize（attachment 链接改写）先跑，
// 最后统一过 html 净化。
const sanitize = (html: string) => {
  const passthrough = attrs.sanitize as ((h: string) => string) | undefined
  return sanitizeMarkdownHtml(typeof passthrough === 'function' ? passthrough(html) : html)
}
</script>

<template>
  <MdEditor v-model="model" :theme="theme" v-bind="$attrs" :sanitize="sanitize">
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </MdEditor>
</template>
