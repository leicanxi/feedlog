<script setup lang="ts">
usePageOg({ kind: 'home' })
const portalOrg = usePortalOrg() // for the sr-only <h1> below
const branding = computed(() => portalOrg.value.branding)
const hasWelcome = computed(() => branding.value.welcomeTitle || branding.value.welcomeDescription)

// Auth & login modal
const { data: session } = useAuthSession()
const isLoggedIn = computed(() => !!session.value?.user)
const isSsoSession = computed(
  () => !!(session.value as { session?: { ssoOrgId?: string | null } } | null)?.session?.ssoOrgId,
)
const orgCtx = useOrgContext()
const canEditPortal = computed(() => !!session.value?.user && !!orgCtx.value.role && !isSsoSession.value)
const loginModal = useLoginModal()
const timeAgo = useTimeAgo()

// Board store
const boardStore = useBoardStore()
await callOnce(() => boardStore.fetchBoards())
const { boards, boardMap, totalPostCount } = storeToRefs(boardStore)

// Currently selected board and sort order
const route = useRoute()
const router = useRouter()

// `?b=` accepts a board id or its name, so pre-filled links can be hand-written
// without looking up a uuid in the dashboard. Names are matched only once the
// board store has loaded; until then this reads as "no filter".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const activeBoardId = computed(() => {
  const raw = (route.query.b as string) || null
  if (!raw) return null
  if (UUID_RE.test(raw)) return raw
  const wanted = raw.trim().toLowerCase()
  // Board names carry no uniqueness constraint — first by position wins.
  return boards.value.find(b => b.name.toLowerCase() === wanted)?.id ?? null
})
const sortBy = ref<'top' | 'recent'>('recent')

// Post list
const sort = computed(() => sortBy.value === 'top' ? 'votes' : 'createdAt')

const posts = ref<PostListItem[]>([])
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)
const fetchingPosts = ref(false)

// Loading indicator for board switching (top progress bar)
const { start: startLoading, finish: finishLoading } = useLoadingIndicator()

async function fetchPosts(cursor?: string) {
  const data = await useApiFetch<CursorPaginatedList<PostListItem>>('/api/posts', {
    query: {
      boardId: activeBoardId.value || undefined,
      sort: sort.value,
      pageSize: 10,
      cursor,
    },
  })
  return data
}

// Initial load
const initialData = await fetchPosts()
posts.value = initialData.data
nextCursor.value = initialData.pagination.nextCursor

const searchQuery = ref('')
const searching = ref(false)
const searchActive = computed(() => searchQuery.value.trim().length > 0)
const searchToolbar = ref<{ reset: () => void } | null>(null)
let boardSwitchClearing = false

// Reset list when filters change
watch(activeBoardId, async () => {
  if (searchActive.value) return
  startLoading()
  fetchingPosts.value = true
  try {
    const data = await fetchPosts()
    posts.value = data.data
    nextCursor.value = data.pagination.nextCursor
  } finally {
    finishLoading()
    fetchingPosts.value = false
  }
})

watch(sort, async () => {
  if (searchActive.value) return
  fetchingPosts.value = true
  try {
    const data = await fetchPosts()
    posts.value = data.data
    nextCursor.value = data.pagination.nextCursor
  } finally {
    fetchingPosts.value = false
  }
})

async function refreshPosts() {
  const data = await fetchPosts()
  posts.value = data.data
  nextCursor.value = data.pagination.nextCursor
}

watch(searchQuery, async () => {
  const q = searchQuery.value.trim()
  if (!q) {
    if (boardSwitchClearing) { boardSwitchClearing = false; return }
    await refreshPosts()
    return
  }
  searching.value = true
  try {
    const res = await useApiFetch<{ data: PostListItem[] }>('/api/posts/search', { query: { q } })
    posts.value = res.data
    nextCursor.value = null // search returns a flat capped set — no "load more"
  } finally {
    searching.value = false
  }
})

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const data = await fetchPosts(nextCursor.value)
    posts.value.push(...data.data)
    nextCursor.value = data.pagination.nextCursor
  } finally {
    loadingMore.value = false
  }
}

// Switch board
async function selectBoard(boardId: string | null) {
  const wasCommitted = searchActive.value
  const sameBoard = activeBoardId.value === boardId
  searchToolbar.value?.reset()
  if (wasCommitted) {
    boardSwitchClearing = true
    searchQuery.value = ''
  }
  router.push({ query: boardId ? { b: boardId } : {} })
  if (wasCommitted && sameBoard) await refreshPosts()
}

// Status configuration (centralized)


// User initials
function initials(name: string | null) {
  return (name || '?').slice(0, 2).toUpperCase()
}

// Post detail store
const postDetailStore = usePostDetailStore()

// Modal controls
const showDetail = ref(false)
const showSubmit = ref(false)
const detailSlug = ref<string | null>(null)

// Pre-filled submit links: /?new=1&title=...&body=...&b=...
// This is the one entry point that opens the form to signed-out visitors — they
// arrive holding a draft, so making them sign in first would throw it away.
// Caps mirror the form's own limits; over-long values are truncated rather than
// rejected, since a broken link should still get the reporter to a usable form.
const submitPrefill = ref<{ title?: string; body?: string }>()

onMounted(() => {
  const q = route.query
  // `?new` with no value parses to null — bare presence counts as enabled.
  if (q.new === undefined || q.new === '0' || q.new === 'false') return

  submitPrefill.value = {
    title: typeof q.title === 'string' ? q.title.slice(0, 200) : undefined,
    body: typeof q.body === 'string' ? q.body.slice(0, 10000) : undefined,
  }
  showSubmit.value = true

  // Strip the one-shot params: otherwise a refresh replays the draft, and
  // sharing the current URL hands your draft to someone else. `b` stays — it is
  // the list's filter state, not part of the prefill.
  const query = { ...q }
  delete query.new
  delete query.title
  delete query.body
  router.replace({ query })
})

// Open post detail modal with prefill from list data
function openPostDetail(item: PostListItem) {
  postDetailStore.prefill(item.slug, item)
  detailSlug.value = item.slug
  showDetail.value = true
}

// Local update handlers
function onPostUpdated(updated: { id: string; status?: string; boardId?: string | null; [key: string]: any }) {
  const idx = posts.value.findIndex(p => p.id === updated.id)
  if (idx === -1) return

  // Board changed → the sidebar's per-board counts (served from the board store)
  // are now stale. Compare against the pre-update boardId, then refresh the store.
  if (updated.boardId !== undefined && updated.boardId !== posts.value[idx].boardId) {
    void boardStore.fetchBoards()
  }

  // If status or board changed and no longer matches current filter, remove
  if (updated.boardId !== undefined && activeBoardId.value && updated.boardId !== activeBoardId.value) {
    posts.value.splice(idx, 1)
    return
  }

  // Update fields in place
  Object.assign(posts.value[idx], updated)
}

function onPostDeleted(postId: string) {
  const idx = posts.value.findIndex(p => p.id === postId)
  if (idx !== -1) posts.value.splice(idx, 1)
  // A deleted post drops its board's count (and the total) → refresh the store.
  void boardStore.fetchBoards()
}

// Vote / unvote on list items
async function handleVote(post: PostListItem) {
  if (!isLoggedIn.value) return loginModal.open()
  const wasVoted = post.hasVoted
  post.hasVoted = !wasVoted
  post.voteCount += wasVoted ? -1 : 1
  try {
    await useApiFetch(`/api/posts/${post.id}/vote`, {
      method: wasVoted ? 'DELETE' : 'POST',
    })
  } catch {
    post.hasVoted = wasVoted
    post.voteCount += wasVoted ? 1 : -1
  }
}
</script>

<template>
  <!-- Sr-only H1: the board layout has no visible page title, but SEO needs one. -->
  <h1 class="sr-only">{{ portalOrg.name }} Feedback</h1>

  <!-- Sidebar: Boards -->
  <aside class="w-full shrink-0 space-y-8 md:w-[272px] md:border-r md:border-border/75 md:pr-8">
    <div class="space-y-3">
      <div class="mb-4 hidden font-heading text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground md:block">{{ $t('board.boards') }}</div>

      <!-- Mobile: horizontal scrollable pills with fade edges -->
      <div class="md:hidden relative">
        <div class="font-heading text-[13px] font-semibold text-muted-foreground uppercase tracking-[0.04em] mb-2">{{ $t('board.boards') }}</div>
        <div class="relative -mx-4">
          <nav class="flex gap-2 overflow-x-auto px-4" style="-ms-overflow-style: none; scrollbar-width: none;">
        <button
          class="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors"
          :class="!activeBoardId
            ? 'border-foreground/15 bg-secondary text-foreground'
            : 'hover:border-foreground/20 hover:text-foreground'"
          @click="selectBoard(null)"
        >
          {{ $t('board.allFeedback') }}
          <span class="text-xs opacity-70">{{ totalPostCount }}</span>
        </button>
        <button
          v-for="b in boards"
          :key="b.id"
          class="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors"
          :class="activeBoardId === b.id
            ? 'border-foreground/15 bg-secondary text-foreground'
            : 'hover:border-foreground/20 hover:text-foreground'"
          @click="selectBoard(b.id)"
        >
          {{ b.name }}
          <span class="text-xs opacity-70">{{ b.postCount ?? 0 }}</span>
        </button>
          </nav>
          <!-- Fade edges -->
          <div class="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" />
          <div class="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
        </div>
      </div>

      <!-- Desktop: vertical list -->
      <nav class="hidden md:flex md:flex-col">
        <!-- All Feedback -->
        <button
          class="board-nav-item"
          :class="!activeBoardId
            ? 'is-active'
            : ''"
          @click="selectBoard(null)"
        >
          <span>{{ $t('board.allFeedback') }}</span>
          <span class="text-xs font-medium tabular-nums text-muted-foreground">
            {{ totalPostCount }}
          </span>
        </button>

        <!-- Individual boards -->
        <button
          v-for="b in boards"
          :key="b.id"
          class="board-nav-item"
          :class="activeBoardId === b.id
            ? 'is-active'
            : ''"
          @click="selectBoard(b.id)"
        >
          <span class="truncate">{{ b.name }}</span>
          <span class="text-xs font-medium tabular-nums text-muted-foreground">
            {{ b.postCount ?? 0 }}
          </span>
        </button>
      </nav>

    </div>
  </aside>

  <!-- Main content: Feedback area -->
  <section class="-mt-4 md:mt-0 flex-1 min-w-0 flex flex-col gap-6">
    <PortalWelcomeBlock
      v-if="hasWelcome"
      :title="branding.welcomeTitle"
      :description="branding.welcomeDescription"
      :editable="canEditPortal"
    />

    <!-- Header row -->
    <BoardSearchToolbar
      ref="searchToolbar"
      v-model="searchQuery"
      v-model:sort="sortBy"
      @new-request="isLoggedIn ? (showSubmit = true) : loginModal.open()"
    />

    <!-- Post list with loading state -->
    <div :class="{ 'opacity-50 pointer-events-none': fetchingPosts || searching }" class="transition-opacity duration-200">

    <!-- Empty state -->
    <div v-if="posts.length === 0" class="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <!-- Search yielded nothing: nudge toward raising it (duplicate-prevention payoff) -->
      <template v-if="searchActive">
        <Icon name="lucide:search-x" size="48" class="mb-4 opacity-50" />
        <p class="text-lg font-medium">{{ $t('board.noMatches', { query: searchQuery.trim() }) }}</p>
        <p class="fl-empty__hint">{{ $t('board.noMatchesHint') }}</p>
        <Button
          class="h-10 px-4 rounded-lg text-[15px] font-heading font-semibold"
          @click="isLoggedIn ? showSubmit = true : loginModal.open()"
        >
          <Icon name="lucide:plus" size="18" />
          {{ $t('board.newRequest') }}
        </Button>
      </template>
      <template v-else>
        <Icon name="lucide:inbox" size="48" class="mb-4 opacity-50" />
        <p class="text-lg font-medium">{{ $t('board.noFeedback') }}</p>
      </template>
    </div>

    <!-- Feedback card list -->
    <div v-else class="flex flex-col gap-4">
      <article
        v-for="p in posts"
        :key="p.id"
        class="feedback-card group relative overflow-hidden rounded-2xl border border-border bg-card p-5 cursor-pointer"
        @click="openPostDetail(p)"
      >
        <div class="feedback-card__content">
          <!-- FeedLog issue-card header: classification left, timestamp right. -->
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span
                v-if="p.status && p.status !== 'open' && STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG]"
                class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none"
                :style="{
                  color: `var(${STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG].cssVar})`,
                  backgroundColor: `var(${STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG].cssVar}-bg)`,
                  borderColor: `var(${STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG].cssVar}-border)`,
                }"
              >
                {{ $t(statusLabelKey(p.status)) }}
              </span>
              <span v-if="p.boardId && boardMap.get(p.boardId)" class="issue-category">
                <span class="truncate">{{ boardMap.get(p.boardId) }}</span>
              </span>
            </div>
            <span class="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{{ timeAgo(p.createdAt) }}</span>
          </div>

          <div class="min-w-0">
            <h3 class="feedback-card__title line-clamp-2">
              {{ p.title }}
            </h3>
            <div class="feedback-card__title-rule" aria-hidden="true" />
          </div>

          <!-- Keep FeedLog's repo-name treatment, now carrying the original comment count. -->
          <div class="feedback-card__footer">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="repo-name">
                <Icon name="lucide:message-square" size="13" aria-hidden="true" />
                <span>{{ $t('board.comments', { n: p.commentCount }) }}</span>
              </span>
              <div class="feedback-author">
                <img v-if="p.author?.image" :src="p.author.image" :alt="p.author.name" class="size-5 rounded-full object-cover shrink-0" referrerpolicy="no-referrer">
                <span v-else class="feedback-author__fallback">{{ initials(p.author?.name) }}</span>
                <span class="truncate">{{ p.author?.name }}</span>
              </div>
            </div>

            <button
              type="button"
              class="upvote-btn"
              :class="p.hasVoted ? 'upvote-btn--voted' : 'upvote-btn--idle'"
              :aria-label="p.hasVoted ? $t('board.removeUpvote', { title: p.title }) : $t('board.upvote', { title: p.title })"
              :aria-pressed="p.hasVoted"
              @click.stop="handleVote(p)"
            >
              <span class="upvote-btn__triangle" aria-hidden="true" />
              <span class="upvote-btn__label">{{ $t('board.upvote') }}</span>
              <span class="upvote-btn__count">{{ p.voteCount }}</span>
            </button>
          </div>
        </div>
      </article>
    </div>

    </div>

    <!-- Load More -->
    <div v-if="nextCursor" class="flex justify-center mt-6">
      <button
        class="px-6 py-2.5 rounded-full border border-border text-sm font-heading font-semibold hover:border-primary hover:text-primary transition-colors bg-card shadow-warm disabled:opacity-50"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? $t('board.loading') : $t('board.loadMore') }}
      </button>
    </div>
  </section>

  <!-- Post detail modal -->
  <PostDetailModal v-model:open="showDetail" :slug="detailSlug" @updated="onPostUpdated" @deleted="onPostDeleted" />

  <!-- Submit feedback modal -->
  <SubmitModal
    v-model:open="showSubmit"
    :default-board-id="activeBoardId ?? undefined"
    :prefill="submitPrefill"
    @created="refreshPosts()"
  />
</template>

<style scoped>
.upvote-btn {
  display: inline-flex;
  flex-shrink: 0;
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
  box-shadow: 0 2px 4px rgb(44 38 37 / 0.02), inset 0 1px 0 rgb(255 255 255 / 0.9);
  transition: border-color 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms cubic-bezier(0.4, 0, 0.2, 1), color 200ms ease, box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1), transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}

.board-nav-item {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 2.875rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 72%, transparent);
  color: var(--muted-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  text-align: left;
  transition: color 180ms ease;
}

.board-nav-item::before {
  position: absolute;
  top: 0.625rem;
  bottom: 0.625rem;
  left: -0.625rem;
  width: 2px;
  content: '';
  transform: scaleY(0);
  background: var(--foreground);
  transition: transform 180ms ease;
}

.board-nav-item:hover,
.board-nav-item.is-active {
  color: var(--foreground);
}

.board-nav-item.is-active::before {
  transform: scaleY(1);
}

.feedback-card {
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.04);
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.feedback-card::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  content: '';
  background: linear-gradient(90deg, var(--primary), var(--accent), color-mix(in oklab, var(--primary) 28%, transparent));
}

.feedback-card__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.875rem;
}

.feedback-card__title {
  color: var(--card-foreground);
  font-family: var(--font-heading);
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.02em;
}

.feedback-card__title-rule {
  width: 3rem;
  height: 2px;
  margin-top: 0.5rem;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), var(--accent));
}

.feedback-card__footer {
  display: flex;
  min-height: 2.25rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: auto;
}

.issue-category {
  display: inline-flex;
  max-width: 12rem;
  align-items: center;
  gap: 0.3125rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
}

.repo-name {
  display: inline-flex;
  min-width: 6.25rem;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  flex-shrink: 0;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--foreground) 7%, transparent);
  padding: 0.375rem 0.625rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.feedback-author {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
}

.feedback-author__fallback {
  display: inline-flex;
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--foreground) 10%, transparent);
  color: var(--foreground);
  font-size: 0.5625rem;
  font-weight: 700;
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

.feedback-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in oklab, var(--primary) 28%, var(--border));
  box-shadow: 0 2px 4px rgb(0 0 0 / 0.05), 0 8px 20px rgb(0 0 0 / 0.06);
}

.feedback-card:hover .upvote-btn:not(:focus-visible) {
  box-shadow: 0 3px 10px color-mix(in oklab, var(--primary) 14%, transparent);
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

@media (max-width: 640px) {
  .feedback-card__title {
    font-size: 1.125rem;
  }

  .upvote-btn__label {
    display: none;
  }

  .upvote-btn {
    min-width: 2.75rem;
    justify-content: center;
  }

  .feedback-author > span:last-child {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feedback-card,
  .upvote-btn {
    transition: none;
  }

  .feedback-card:hover,
  .upvote-btn:active {
    transform: none;
  }
}

@keyframes vote-pop {
  0% { transform: scale(0.96); }
  60% { transform: scale(1.04); }
  100% { transform: scale(1); }
}

nav::-webkit-scrollbar {
  display: none;
}

.fl-empty__hint {
  font-size: 14px;
  margin: 4px 0 20px;
  color: var(--muted-foreground);
}
</style>
