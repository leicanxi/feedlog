<script setup lang="ts">
defineProps<{
  post: PostListItem
}>()

defineEmits<{
  click: []
}>()

const cardEl = ref<HTMLElement | null>(null)
defineExpose({ el: cardEl })

const boardStore = useBoardStore()
const { boardMap } = storeToRefs(boardStore)
</script>

<template>
  <div
    ref="cardEl"
    class="group bg-card/90 border border-border/85 p-4 rounded-xl transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-px hover:border-primary/45 hover:bg-card cursor-pointer"
    @click="$emit('click')"
  >
    <h4
      class="text-base font-semibold leading-snug"
    >
      {{ post.title }}
    </h4>

    <!-- Bottom meta -->
    <div class="flex items-center justify-between gap-3 mt-4 text-muted-foreground">
      <span
        v-if="post.boardId && boardMap.get(post.boardId)"
        class="max-w-[50%] truncate rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground"
      >
        {{ boardMap.get(post.boardId) }}
      </span>
      <span v-else />
      <div class="flex shrink-0 items-center gap-2.5">
        <div class="flex items-center gap-1 text-[11px] font-medium">
          <Icon name="lucide:triangle" size="11" /> {{ post.voteCount }}
        </div>
        <div class="flex items-center gap-1 text-[11px] font-medium">
          <Icon name="lucide:message-square" size="14" /> {{ post.commentCount }}
        </div>
      </div>
    </div>
  </div>
</template>
