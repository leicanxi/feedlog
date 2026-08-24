<script setup lang="ts">
import '~/assets/css/md-editor-preview.css'
import { toast } from 'vue-sonner'
import { sanitizeAttachmentHtml } from '~/utils/attachment';

// Event types for post mutations
export interface PostUpdatedEvent {
  id: string
  slug: string
  title?: string
  content?: string
  excerpt?: string
  status?: string
  boardId?: string | null
  commentCount?: number
  voteCount?: number
  hasVoted?: boolean
}

const props = defineProps<{
  slug: string
}>()

const emit = defineEmits<{
  updated: [post: PostUpdatedEvent]
  deleted: [postId: string]
}>()

const { onUploadImg } = useUploadImg()
const store = usePostDetailStore()
const boardStore = useBoardStore()
const { boards } = storeToRefs(boardStore)

// Derive data from store using slug
const post = computed(() => store.getPost(props.slug))
const comments = computed(() => store.getComments(props.slug))
const hasMoreComments = computed(() => !!store.getCommentCursor(props.slug))
const loading = computed(() => store.isPostLoading(props.slug))
const commentLoading = useDebouncedLoading(computed(() => store.isCommentLoading(props.slug)))
const moreCommentLoading = computed(() => store.isMoreCommentLoading(props.slug))

// Comment sort is local UI state
const commentSort = ref<'newest' | 'oldest' | 'top'>('newest')

// Auth & login modal
const { data: session } = useAuthSession()
const isLoggedIn = computed(() => !!session.value?.user)
const loginModal = useLoginModal()

// Permissions
const postAuthorId = computed(() => post.value?.author?.id)
const { canEdit: canEditPost, canDelete: canDeletePost, isOrgManager, showMenu: showPostMenu } = usePermission(postAuthorId, 'post')


function initials(name: string | null) {
  return (name || '?').slice(0, 2).toUpperCase()
}

// Board name
const boardName = computed(() => {
  if (!post.value?.boardId) return null
  return boardStore.boardMap.get(post.value.boardId) ?? null
})

// ---- Post editing state ----
const editing = ref(false)
const editTitle = ref('')
const editContent = ref('')
const editSaving = ref(false)
const editError = ref('')
const { confirm } = useConfirmDialog()
const { t } = useI18n()
const timeAgo = useTimeAgo()
const deleting = ref(false)

function startEditPost() {
  if (!post.value) return
  editTitle.value = post.value.title
  editContent.value = post.value.content
  editError.value = ''
  editing.value = true
  replyingTo.value = null
  editingCommentId.value = null
}

function cancelEditPost() {
  editing.value = false
  editError.value = ''
}

async function saveEditPost() {
  if (!post.value) return
  const title = editTitle.value.trim()
  const content = editContent.value.trim()
  if (!title) { editError.value = t('post.detail.errors.titleRequired'); return }
  if (!content) { editError.value = t('post.detail.errors.contentRequired'); return }

  editSaving.value = true
  editError.value = ''
  try {
    await store.updatePost(props.slug, { title, content }, isOrgManager.value)
    editing.value = false
    emit('updated', { id: post.value.id, slug: post.value.slug, title, content })
  } catch (e: any) {
    editError.value = e.data?.message || t('post.detail.errors.saveFailed')
  } finally {
    editSaving.value = false
  }
}

async function handleDeletePost() {
  if (!post.value) return
  const ok = await confirm({
    title: t('post.detail.deleteTitle'),
    description: t('post.detail.deleteDescription'),
    cancelText: t('common.cancel'),
    confirmText: t('common.delete'),
    variant: 'destructive',
  })
  if (!ok) return
  const postId = post.value.id
  deleting.value = true
  try {
    await store.deletePost(props.slug)
    emit('deleted', postId)
  } catch (e: any) {
    editError.value = e.data?.message || t('post.detail.errors.deleteFailed')
  } finally {
    deleting.value = false
  }
}

// ---- Admin sidebar actions ----
// Status changes apply immediately and silently; this prompt (when set to the
// new status) then asks whether to mail the subscribers.
const notifyStatus = ref<string | null>(null)

async function handleStatusChange(status: string) {
  if (!post.value || !isOrgManager.value || post.value.status === status) return
  await store.updatePost(props.slug, { status }, true)
  emit('updated', { id: post.value.id, slug: post.value.slug, status })
  notifyStatus.value = status
}

async function sendStatusNotification(note: string) {
  const status = notifyStatus.value
  if (!post.value || !status) return
  notifyStatus.value = null
  try {
    await useApiFetch(`/api/admin/posts/${post.value.id}/notify-status`, {
      method: 'POST',
      body: { status, note: note || undefined },
    })
  }
  catch (err: unknown) {
    // 409 = status changed under the admin between the write and the send.
    if ((err as { statusCode?: number })?.statusCode === 409) {
      console.error('[notifications] status changed by someone else')
    }
  }
}

async function handleBoardChange(boardId: string | null) {
  if (!post.value || !isOrgManager.value) return
  await store.updatePost(props.slug, { boardId }, true)
  emit('updated', { id: post.value.id, slug: post.value.slug, boardId })
}

// ---- Merge state ----
const isMerged = computed(() => !!post.value?.mergedTo)
const mergedCount = computed(() => post.value?.mergedCount ?? 0)
const mergeDialogOpen = ref(false)
const mergeDirection = ref<'bring' | 'push'>('bring')

function openMergeDialog(direction: 'bring' | 'push') {
  mergeDirection.value = direction
  mergeDialogOpen.value = true
}

async function handleMerged() {
  // Refresh post data after merge
  await store.fetchPost(props.slug)
  await store.fetchComments(props.slug, commentSort.value)
}

async function handleUnmerge(postId: string) {
  try {
    await useApiFetch('/api/admin/posts/unmerge', { method: 'POST', body: { postId } })
    await store.fetchPost(props.slug)
    await store.fetchComments(props.slug, commentSort.value)
  } catch (e: any) {
    console.error('Unmerge failed:', e)
  }
}

async function handleSimilarMerge(direction: 'bring' | 'push', targetPost: any) {
  if (!post.value) return
  const body = direction === 'bring'
    ? { canonicalPostId: post.value.id, mergedPostId: targetPost.id }
    : { canonicalPostId: targetPost.id, mergedPostId: post.value.id }

  try {
    await useApiFetch('/api/admin/posts/merge', { method: 'POST', body })
    await handleMerged()
  } catch (e: any) {
    console.error('Merge failed:', e)
  }
}

// ---- Vote handler ----
function handleVote() {
  if (!post.value) return
  if (isMerged.value) return // Block voting on merged posts
  if (!isLoggedIn.value) return loginModal.open()
  const p = post.value
  const settled = p.hasVoted ? store.unvote(props.slug) : store.vote(props.slug)
  const syncList = () => emit('updated', { id: p.id, slug: p.slug, voteCount: p.voteCount, hasVoted: p.hasVoted })
  syncList()
  settled.then(syncList)
}

// ---- Comment interaction state ----
const replyingTo = ref<{ commentId: string; parentId: string } | null>(null)
const editingCommentId = ref<string | null>(null)
const commentSubmitting = ref(false)
const commentEditorRef = ref<{ clear: () => void } | null>(null)

function emitCommentCount() {
  if (post.value) {
    emit('updated', { id: post.value.id, slug: post.value.slug, commentCount: post.value.commentCount })
  }
}

// Comment handlers
async function handleCommentSubmit(content: string, notify: boolean) {
  commentSubmitting.value = true
  try {
    await store.addComment(props.slug, content, { notify })
    commentEditorRef.value?.clear()
    emitCommentCount()
  } finally {
    commentSubmitting.value = false
  }
}

async function handleReplySubmit(content: string) {
  if (!replyingTo.value) return
  commentSubmitting.value = true
  try {
    const { parentId, commentId } = replyingTo.value
    const replyToId = commentId !== parentId ? commentId : undefined
    await store.addComment(props.slug, content, { parentId, replyToId })
    replyingTo.value = null
    emitCommentCount()
  } finally {
    commentSubmitting.value = false
  }
}

function handleReply(commentId: string) {
  if (!isLoggedIn.value) return loginModal.open()

  editingCommentId.value = null
  editing.value = false

  const topLevel = comments.value.find(c => c.id === commentId)
  if (topLevel) {
    replyingTo.value = { commentId, parentId: commentId }
  } else {
    const parent = comments.value.find(c => c.children?.some(ch => ch.id === commentId))
    if (parent) {
      replyingTo.value = { commentId, parentId: parent.id }
    }
  }
}

function handleLike(commentId: string) {
  if (!isLoggedIn.value) return loginModal.open()

  const c = comments.value.find(item => item.id === commentId)
    || comments.value.flatMap(item => item.children ?? []).find(ch => ch.id === commentId)
  if (!c) return
  if (c.hasLiked) {
    store.unlikeComment(props.slug, commentId)
  } else {
    store.likeComment(props.slug, commentId)
  }
}

function handleEditComment(commentId: string) {
  replyingTo.value = null
  editing.value = false
  editingCommentId.value = commentId
}

async function handleEditCommentSubmit(commentId: string, content: string) {
  commentSubmitting.value = true
  try {
    await store.updateComment(props.slug, commentId, content)
    editingCommentId.value = null
  } finally {
    commentSubmitting.value = false
  }
}

function handleEditCommentCancel() {
  editingCommentId.value = null
}

async function handleDeleteComment(commentId: string) {
  await store.deleteComment(props.slug, commentId)
  emitCommentCount()
}

// Watch comment sort changes → refetch
watch(commentSort, () => {
  store.fetchComments(props.slug, commentSort.value)
})

async function handleCopyEmail() {
  const email = post.value?.author?.email
  if (!email) return
  try {
    await navigator.clipboard.writeText(email)
    toast.success(t('post.detail.emailCopied'))
  } catch {
    toast.error(t('post.detail.emailCopyFailed'))
  }
}

async function handleShare() {
  // Canonical post URL — independent of current location (post may be opened in a modal)
  const url = `${window.location.origin}/p/${props.slug}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success(t('post.detail.linkCopied'))
  } catch {
    toast.error(t('post.detail.linkCopyFailed'))
  }
}
</script>

<template>
  <!-- Single stable root for SSR hydration -->
  <template v-if="loading && !post">
    <div class="flex-1 min-w-0">
      <div class="bg-card border border-border rounded-lg p-6 lg:p-8 shadow-sm animate-pulse">
        <div class="flex gap-6">
          <div class="w-14 h-[72px] rounded-md bg-muted"></div>
          <div class="flex-1 space-y-3">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-6 bg-muted rounded w-2/3"></div>
            <div class="h-4 bg-muted rounded w-full"></div>
            <div class="h-4 bg-muted rounded w-4/5"></div>
          </div>
        </div>
      </div>
    </div>
    <aside class="w-full md:w-[320px] shrink-0 self-start">
      <div class="bg-card border border-border rounded-lg p-6 shadow-sm animate-pulse space-y-6">
        <div class="h-4 bg-muted rounded w-1/2"></div>
        <div class="h-10 bg-muted rounded"></div>
        <div class="h-4 bg-muted rounded w-1/2"></div>
        <div class="h-6 bg-muted rounded w-1/3"></div>
      </div>
    </aside>
  </template>

  <!-- Content: use v-if (not v-else-if) so SSR always renders this when post exists -->
  <template v-if="post">
    <!-- Left column: post card + discussion -->
    <div class="flex-1 min-w-0 space-y-6">
      <!-- Post card -->
      <div class="bg-card border border-border rounded-lg p-6 lg:p-8 shadow-sm">
        <template v-if="editing">
          <div class="space-y-4">
            <Input v-model="editTitle" class="h-10 text-lg font-heading font-bold" :placeholder="$t('post.detail.titlePlaceholder')" :maxlength="200" />
            <div class="editor-preview-styled">
              <ThemedMdEditor v-model="editContent" language="en-US" :placeholder="$t('post.detail.editPlaceholder')" :preview="false" :max-length="10000" :toolbars="['bold', 'italic', 'strikeThrough', '-', 'title', 'unorderedList', 'orderedList', '-', 'link', 'image', 'code', 'codeRow', '-', 'previewOnly']" :sanitize="sanitizeAttachmentHtml" :style="{ height: '280px' }" @on-upload-img="onUploadImg" />
            </div>
            <p v-if="editError" class="text-sm text-destructive">{{ editError }}</p>
            <div class="flex items-center gap-3 justify-end">
              <button class="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" @click="cancelEditPost">{{ $t('common.cancel') }}</button>
              <button class="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-heading font-bold hover:bg-primary/90 transition-colors disabled:opacity-50" :disabled="editSaving" @click="saveEditPost">{{ editSaving ? $t('post.detail.saving') : $t('post.detail.saveChanges') }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <DropdownMenu v-if="!isMerged && isOrgManager">
              <DropdownMenuTrigger as-child>
                <button
                  class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none transition-opacity hover:opacity-75"
                  :style="{
                    color: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar})`,
                    backgroundColor: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar}-bg)`,
                    borderColor: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar}-border)`,
                  }"
                >
                  {{ $t(statusLabelKey(post.status)) }}<Icon name="lucide:chevron-down" size="12" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-[160px]">
                <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" class="text-xs font-medium gap-2" :class="post.status === opt.value ? 'font-bold' : ''" @click="handleStatusChange(opt.value)">
                  <span class="w-4 shrink-0 flex items-center justify-center"><Icon v-if="post.status === opt.value" name="lucide:check" size="12" /></span>
                  <div class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: `var(${opt.cssVar})` }"></div> {{ $t(statusLabelKey(opt.value)) }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span
              v-else-if="!isMerged"
              class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none"
              :style="{
                color: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar})`,
                backgroundColor: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar}-bg)`,
                borderColor: `var(${(STATUS_CONFIG[post.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.open).cssVar}-border)`,
              }"
            >{{ $t(statusLabelKey(post.status)) }}</span>

            <DropdownMenu v-if="isOrgManager && !isMerged">
              <DropdownMenuTrigger as-child>
                <button class="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-border/75 bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <Icon name="lucide:folder" size="12" class="shrink-0" /><span class="truncate">{{ boardName ?? $t('post.detail.none') }}</span><Icon name="lucide:chevron-down" size="12" class="shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-[200px]">
                <DropdownMenuItem class="text-xs font-medium gap-2" :class="!post.boardId ? 'font-bold' : ''" @click="handleBoardChange(null)"><span class="w-4 shrink-0 flex items-center justify-center"><Icon v-if="!post.boardId" name="lucide:check" size="12" /></span>{{ $t('post.detail.none') }}</DropdownMenuItem>
                <DropdownMenuItem v-for="board in boards" :key="board.id" class="text-xs font-medium gap-2" :class="post.boardId === board.id ? 'font-bold' : ''" @click="handleBoardChange(board.id)"><span class="w-4 shrink-0 flex items-center justify-center"><Icon v-if="post.boardId === board.id" name="lucide:check" size="12" /></span>{{ board.name }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-else class="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-border/75 bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"><Icon name="lucide:folder" size="12" class="shrink-0" /><span class="truncate">{{ boardName ?? $t('post.detail.none') }}</span></span>
          </div>

          <StatusNotifyPrompt v-if="notifyStatus" class="mb-4" :actor-name="session?.user?.name" :actor-image="session?.user?.image" @send="sendStatusNotification" @dismiss="notifyStatus = null" />

          <div class="flex items-start gap-3 mb-4">
            <div class="flex-1 min-w-0">
              <h2 class="font-heading text-2xl font-bold min-w-0 break-words">{{ post.title }}</h2>
            </div>
            <div class="flex items-center gap-2 shrink-0 pt-1">
              <span class="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Icon name="lucide:clock" size="14" /> {{ timeAgo(post.createdAt) }}</span>
              <DropdownMenu v-if="isOrgManager && !isMerged">
                <DropdownMenuTrigger as-child><button class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" :title="$t('post.merge.tooltip')"><Icon name="lucide:git-merge" size="18" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="min-w-[200px]"><DropdownMenuItem class="text-xs font-bold gap-2" @click="openMergeDialog('bring')"><Icon name="lucide:arrow-down-left" size="14" /> {{ $t('post.merge.toThis') }}</DropdownMenuItem><DropdownMenuItem class="text-xs font-bold gap-2" @click="openMergeDialog('push')"><Icon name="lucide:arrow-up-right" size="14" /> {{ $t('post.merge.thisInto') }}</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu v-if="showPostMenu">
                <DropdownMenuTrigger as-child><button class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"><Icon name="lucide:more-horizontal" size="18" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="min-w-[120px]"><DropdownMenuItem v-if="canEditPost" class="text-xs font-bold gap-2" @click="startEditPost"><Icon name="lucide:pencil" size="14" /> {{ $t('common.edit') }}</DropdownMenuItem><DropdownMenuItem v-if="canDeletePost" class="text-xs font-bold gap-2 text-destructive" @click="handleDeletePost"><Icon name="lucide:trash-2" size="14" /> {{ $t('common.delete') }}</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <PostContent v-if="post.content" :content="post.content" />
          <div v-else class="h-20 bg-muted rounded animate-pulse" />

          <div class="mt-6 flex flex-col gap-4 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <img v-if="post.author?.image" :src="post.author.image" :alt="post.author.name" class="size-8 rounded-full object-cover shrink-0" referrerpolicy="no-referrer">
              <div v-else class="size-8 rounded-full bg-foreground/10 flex items-center justify-center text-foreground font-bold text-xs shrink-0">{{ initials(post.author?.name) }}</div>
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate">{{ post.author?.name ?? $t('common.anonymous') }}</p>
                <div v-if="post.author?.email" class="flex items-center gap-1"><a :href="`mailto:${post.author.email}`" class="min-w-0 text-[11px] text-muted-foreground hover:text-primary truncate transition-colors" :title="post.author.email">{{ post.author.email }}</a><button class="size-5 shrink-0 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" :title="$t('post.detail.copyEmail')" @click="handleCopyEmail"><Icon name="lucide:copy" size="12" /></button></div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2 sm:ml-auto">
              <button class="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" :aria-label="$t('post.detail.shareRequest')" :title="$t('post.detail.shareRequest')" @click="handleShare"><Icon name="lucide:share-2" size="17" /></button>
              <button v-if="!isMerged" type="button" class="upvote-btn" :class="post.hasVoted ? 'upvote-btn--voted' : 'upvote-btn--idle'" :aria-label="post.hasVoted ? $t('board.removeUpvote', { title: post.title }) : $t('board.upvote', { title: post.title })" :aria-pressed="post.hasVoted" @click="handleVote"><span class="upvote-btn__triangle" aria-hidden="true" /><span>{{ $t('board.upvote') }}</span><span class="upvote-btn__count">{{ post.voteCount }}</span></button>
            </div>
          </div>
        </template>
      </div>

      <!-- Discussion -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-heading text-lg font-bold flex items-center gap-2">
            <Icon name="lucide:message-square" size="20" /> {{ $t('post.detail.discussion', { count: post.commentCount }) }}
          </h3>
          <div class="flex items-center gap-2 bg-border/20 p-1 rounded-md">
            <button v-for="s in (['newest', 'oldest', 'top'] as const)" :key="s" class="px-3 py-1 text-[11px] font-medium rounded-md capitalize transition-colors" :class="commentSort === s ? 'bg-card shadow-sm text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'" @click="commentSort = s">{{ $t(`post.detail.sort.${s}`) }}</button>
          </div>
        </div>
        <!-- Merge banner (inside discussion, per PRD) -->
        <MergeBanner v-if="isMerged && post.canonicalPost" :canonical-post="post.canonicalPost" />
        <ClientOnly v-if="!isMerged">
          <CommentEditor v-if="isLoggedIn" ref="commentEditorRef" :loading="commentSubmitting" :can-notify="isOrgManager" @submit="handleCommentSubmit" />
          <CommentLoginPrompt v-else />
        </ClientOnly>
        <div v-if="commentLoading && comments.length === 0" class="space-y-4 pt-2">
          <div v-for="i in 3" :key="i" class="flex gap-4 animate-pulse">
            <div class="w-10 h-10 rounded-full bg-border shrink-0" />
            <div class="flex-1 bg-card border border-border rounded-lg p-4 space-y-2">
              <div class="h-3 bg-muted rounded w-1/4" /><div class="h-4 bg-muted rounded w-full" /><div class="h-4 bg-muted rounded w-3/4" />
            </div>
          </div>
        </div>
        <div v-else-if="comments.length > 0" class="space-y-4 pt-2 transition-opacity duration-200" :class="commentLoading ? 'opacity-60 pointer-events-none' : ''">
          <template v-for="comment in comments" :key="comment.id">
            <CommentItem :comment="comment" :replying-to="replyingTo?.parentId === comment.id ? replyingTo.commentId : undefined" :editing-id="editingCommentId ?? undefined" :submitting="commentSubmitting" @reply="handleReply" @like="handleLike" @reply-submit="handleReplySubmit" @reply-cancel="replyingTo = null" @edit="handleEditComment" @edit-submit="handleEditCommentSubmit" @edit-cancel="handleEditCommentCancel" @delete="handleDeleteComment" @load-more-children="store.loadMoreChildren(slug, $event)" @unmerge="handleUnmerge" />
          </template>
        </div>
        <div v-else class="flex flex-col items-center justify-center py-12 text-center">
          <Icon name="lucide:message-circle" size="48" class="text-muted-foreground/40 mb-4" />
          <p class="text-sm font-medium text-muted-foreground">{{ $t('post.detail.noComments') }}</p>
          <p class="text-xs text-muted-foreground/60 mt-1">{{ $t('post.detail.noCommentsHint') }}</p>
        </div>
        <div v-if="hasMoreComments" class="flex justify-center mt-8">
          <button class="px-6 py-2.5 rounded-full border border-border text-sm font-heading font-semibold hover:border-primary hover:text-primary transition-colors bg-card shadow-warm" :disabled="moreCommentLoading" @click="store.loadMoreComments(slug, commentSort)">{{ moreCommentLoading ? $t('post.detail.loadingMore') : $t('post.detail.viewMoreComments') }}</button>
        </div>
      </div>
    </div>

    <!-- Right sidebar -->
    <aside class="w-full md:w-[320px] shrink-0 self-start space-y-4">
      <!-- Admins never receive post-thread email, so the card would lie to them. -->
      <PostSubscribeCard v-if="post.id && isLoggedIn && !isOrgManager && !isMerged" :post-id="post.id" :subscribed="post.subscribed ?? false" @update:subscribed="post.subscribed = $event" />
      <SimilarPostsPanel v-if="post.id && !isMerged" :post-id="post.id" :is-admin="isOrgManager" @merge="handleSimilarMerge" />
    </aside>

    <!-- Merge dialog -->
    <MergeDialog v-if="post.id" v-model:open="mergeDialogOpen" :post-id="post.id" :post-title="post.title" :direction="mergeDirection" @merged="handleMerged" />

  </template>
</template>

<style scoped>
.upvote-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--border) 88%, transparent);
  border-radius: 9999px;
  padding: 0.25rem 1rem;
  color: var(--muted-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 4px rgb(44 38 37 / 0.02), inset 0 1px 0 rgb(255 255 255 / 0.9);
  transition: border-color 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms cubic-bezier(0.4, 0, 0.2, 1), color 200ms ease, box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1), transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.upvote-btn--idle {
  --upvote-surface: color-mix(in oklab, var(--foreground) 2%, var(--card));
  background: linear-gradient(180deg, rgb(255 255 255 / 0.82) 0%, color-mix(in oklab, var(--foreground) 2%, var(--card)) 100%);
}

.upvote-btn--idle:hover {
  --upvote-surface: color-mix(in oklab, var(--foreground) 4%, var(--card));
  border-color: color-mix(in oklab, var(--foreground) 18%, var(--border));
  background: linear-gradient(180deg, rgb(255 255 255 / 0.92) 0%, color-mix(in oklab, var(--foreground) 4%, var(--card)) 100%);
  color: var(--foreground);
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgb(44 38 37 / 0.08), 0 4px 8px -2px rgb(44 38 37 / 0.03), inset 0 1px 0 rgb(255 255 255 / 0.95);
}

.upvote-btn--voted {
  --upvote-surface: var(--primary);
  border-color: color-mix(in oklab, var(--primary) 30%, var(--border));
  background: linear-gradient(180deg, color-mix(in oklab, var(--primary) 9%, var(--card)) 0%, color-mix(in oklab, var(--primary) 16%, var(--card)) 100%);
  color: var(--primary);
  animation: vote-pop 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.upvote-btn--voted:hover {
  border-color: color-mix(in oklab, var(--primary) 48%, var(--border));
  background: linear-gradient(180deg, color-mix(in oklab, var(--primary) 15%, var(--card)) 0%, color-mix(in oklab, var(--primary) 22%, var(--card)) 100%);
  transform: translateY(-2px);
}

.upvote-btn__triangle {
  position: relative;
  display: inline-block;
  width: 0.75rem;
  height: 0.6875rem;
  flex: 0 0 auto;
  transition: transform 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.upvote-btn__triangle::before,
.upvote-btn__triangle::after {
  position: absolute;
  content: '';
  clip-path: polygon(50% 3%, 97% 94%, 3% 94%);
}

.upvote-btn__triangle::before {
  inset: 0;
  background: currentColor;
}

.upvote-btn__triangle::after {
  top: 0.20rem;
  right: 0.16rem;
  bottom: 0.13rem;
  left: 0.16rem;
  background: var(--upvote-surface, var(--card));
}

.upvote-btn--voted .upvote-btn__triangle::after {
  display: none;
}

.upvote-btn:hover .upvote-btn__triangle {
  transform: translateY(-2px);
}

.upvote-btn__count {
  display: inline-flex;
  min-width: 1.25rem;
  align-items: center;
  height: 1.25rem;
  border-left: 1px solid color-mix(in oklab, currentColor 20%, transparent);
  padding-left: 0.5rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.upvote-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgb(44 38 37 / 0.06);
}

.upvote-btn:active .upvote-btn__triangle {
  transform: translateY(0) scale(0.9);
}

.upvote-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .detail-vote-control {
    display: flex;
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .upvote-btn {
    transition: none;
  }

  .upvote-btn:active {
    transform: none;
  }
}

@keyframes vote-pop {
  0% { transform: scale(0.96); }
  60% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
</style>
