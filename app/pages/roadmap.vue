<script setup lang="ts">
usePageOg({ kind: 'roadmap' })

const postDetailStore = usePostDetailStore()
const showDetail = ref(false)
const detailSlug = ref<string | null>(null)
const kanbanRef = ref<{ updateItem: (post: any) => void; removeItem: (id: string) => void } | null>(null)

function openPostDetail(item: PostListItem) {
  postDetailStore.prefill(item.slug, item)
  detailSlug.value = item.slug
  showDetail.value = true
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 max-h-[calc(100vh-5rem)] min-h-[500px]">
    <!-- Title area -->
    <div class="border-b border-border/75 pb-5 md:pb-7">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 class="shrink-0 font-heading text-xl font-semibold leading-tight tracking-[-0.03em] sm:text-2xl md:text-[28px]">{{ $t('roadmap.title') }}</h1>
        <p class="text-sm leading-relaxed text-muted-foreground">{{ $t('roadmap.subtitle') }}</p>
      </div>
    </div>

    <!-- Board area -->
    <div class="flex-1 min-h-[400px] overflow-x-auto overflow-y-hidden pt-5 md:pt-6">
      <RoadmapKanban ref="kanbanRef" @open-detail="openPostDetail" />
    </div>
  </div>

  <PostDetailModal
    v-model:open="showDetail"
    :slug="detailSlug"
    @updated="kanbanRef?.updateItem($event)"
    @deleted="kanbanRef?.removeItem($event)"
  />
</template>
