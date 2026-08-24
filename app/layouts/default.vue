<script setup lang="ts">
const { signOut } = useAuth()
const { data: session } = await useAuthSession()
const localePath = useLocalePath()

const user = computed(() => session.value?.user)
// SSO sessions (signed in via the customer's product) are end-user only.
const isSsoSession = computed(
  () => !!(session.value as { session?: { ssoOrgId?: string | null } } | null)?.session?.ssoOrgId,
)
// Dashboard entry visibility matches the /dashboard middleware: any org
// member (owner / manager / contributor) gets in. Do NOT gate on
// `user.role === 'admin'` — that's the legacy better-auth admin plugin
// field, no longer consulted now that access is driven by org-membership
// role.
const orgCtx = useOrgContext()
// An SSO session is end-user only and can never reach the dashboard (server
// gates 403, /dashboard middleware redirects). Hide the entry too so we don't
// dangle a link that dead-ends — even if this email is an org member.
const canEnterDashboard = computed(() => !!user.value && !!orgCtx.value.role && !isSsoSession.value)

// User initials as avatar fallback
const initials = computed(() => {
  const name = user.value?.name || ''
  return name.slice(0, 2).toUpperCase()
})

// Fall back to initials when avatar image fails to load
const avatarError = ref(false)
watch(user, () => { avatarError.value = false })

const { isOpen: showLoginModal } = useLoginModal()
const showChangePassword = ref(false)

// SSO sessions can't manage credentials — the backend blocks set/change-password
// etc. Hide the control instead of offering an action that 403s.

const navItems = [
  { key: 'nav.feedback', to: '/', icon: 'lucide:message-square' },
  { key: 'nav.roadmap', to: '/roadmap', icon: 'lucide:map' },
  { key: 'nav.changelog', to: '/changelog', icon: 'lucide:newspaper' },
]

async function handleSignOut() {
  await signOut()
  window.location.href = localePath('/')
}

// Mobile expandable nav
const mobileNavOpen = ref(false)
const route = useRoute()
watch(() => route.path, () => { mobileNavOpen.value = false })
</script>

<template>
  <div class="min-h-screen flex flex-col bg-background text-foreground font-body">
    <!-- Editorial navigation: quiet framing, one clear action, and no competing card chrome. -->
    <header class="fixed inset-x-0 top-0 z-50 w-full border-b border-border/80 bg-background/95 backdrop-blur-sm transition-colors duration-300">
      <!-- Main bar -->
      <div class="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:h-[72px] lg:px-10">
        <!-- Left: Hamburger (mobile) + Logo + Navigation (desktop) -->
        <div class="flex items-center gap-3 md:gap-12">
          <!-- Mobile hamburger -->
          <button
            class="md:hidden flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            type="button"
            :aria-label="mobileNavOpen ? '关闭导航' : '打开导航'"
            :aria-expanded="mobileNavOpen"
            @click="mobileNavOpen = !mobileNavOpen"
          >
            <Icon :name="mobileNavOpen ? 'lucide:x' : 'lucide:menu'" size="20" />
          </button>

          <AppBrand />

          <nav class="hidden items-center gap-7 md:flex" aria-label="主导航">
            <NuxtLink
              v-for="item in navItems"
              :key="item.to"
              :to="localePath(item.to)"
              class="nav-link"
              active-class="is-active"
            >
              {{ $t(item.key) }}
            </NuxtLink>
          </nav>
        </div>

        <!-- Right side -->
        <div class="flex items-center gap-1.5 sm:gap-2.5">
          <ThemeSwitcher />
          <LocaleSwitcher />

          <!-- Dashboard link (admin only) -->
          <!-- Desktop: button with text -->
          <Button
            v-if="canEnterDashboard"
            as-child
            variant="secondary"
            class="hidden rounded-full border-0 bg-transparent px-3 shadow-none hover:bg-secondary md:inline-flex"
          >
            <NuxtLink :to="localePath('/dashboard')">
              <Icon name="lucide:layout-dashboard" size="18" />
              {{ $t('nav.dashboard') }}
            </NuxtLink>
          </Button>
          <!-- Mobile: icon only -->
          <NuxtLink
            v-if="canEnterDashboard"
            :to="localePath('/dashboard')"
            class="md:hidden flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Icon name="lucide:layout-dashboard" size="20" />
          </NuxtLink>

          <!-- Logged in: Avatar + Dropdown menu -->
          <DropdownMenu v-if="user">
            <DropdownMenuTrigger as-child>
              <button class="flex items-center rounded-full border border-border bg-card p-1 transition-colors hover:border-foreground/35 focus:outline-none">
                <Avatar class="w-8 h-8">
                  <img v-if="user.image && !avatarError" :src="user.image" :alt="user.name" class="aspect-square size-full rounded-full object-cover" referrerpolicy="no-referrer" @error="avatarError = true">
                  <!-- Brand accent (not a neutral gray) so identity chips carry the
                       brand; derived in deriveBrandVars. -->
                  <AvatarFallback v-else class="bg-accent text-accent-foreground text-sm font-bold">
                    {{ initials }}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuLabel class="font-normal">
                <div class="flex flex-col space-y-1">
                  <p class="text-sm font-medium">{{ user.name }}</p>
                  <p class="text-xs text-muted-foreground truncate">{{ user.email }}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem v-if="!isSsoSession" @click="showChangePassword = true">
                <Icon name="lucide:key-round" size="16" class="mr-2" />
                {{ $t('nav.changePassword') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="handleSignOut">
                <Icon name="lucide:log-out" size="16" class="mr-2" />
                {{ $t('common.signOut') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- Not logged in: Sign in button -->
          <button
            v-if="!user"
            class="flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 py-2 font-heading text-sm font-semibold text-background transition-colors hover:bg-foreground/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            @click="showLoginModal = true"
          >
            <Icon name="lucide:log-in" size="16" />
            <span class="hidden sm:inline">{{ $t('common.signIn') }}</span>
          </button>
        </div>
      </div>

      <!-- Mobile expandable nav row -->
      <div
        class="mx-auto w-full max-w-[1440px] overflow-hidden transition-all duration-200 ease-in-out md:hidden"
        :style="{ maxHeight: mobileNavOpen ? '120px' : '0px' }"
      >
        <nav class="flex flex-col border-t border-border/70 px-4 py-2" aria-label="移动端主导航">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="localePath(item.to)"
            class="flex min-h-11 items-center text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            active-class="!text-foreground"
          >
            {{ $t(item.key) }}
          </NuxtLink>
        </nav>
      </div>
    </header>

    <!-- Login modal (global, controlled via useLoginModal) -->
    <LoginModal v-model:open="showLoginModal" />
    <ChangePasswordDialog v-model:open="showChangePassword" />

    <!-- Page content (header is position:fixed, so add top padding equal to header height) -->
    <main class="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-8 px-4 pb-8 pt-24 sm:px-6 md:flex-row md:pt-28 lg:px-10 lg:pt-32">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.nav-link {
  position: relative;
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  color: var(--muted-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: color 180ms ease;
}

.nav-link::after {
  position: absolute;
  right: 0;
  bottom: 0.35rem;
  left: 0;
  height: 1px;
  content: '';
  transform: scaleX(0);
  transform-origin: center;
  background: currentColor;
  transition: transform 180ms ease;
}

.nav-link:hover,
.nav-link.is-active {
  color: var(--foreground);
}

.nav-link:hover::after {
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  .nav-link,
  .nav-link::after {
    transition: none;
  }
}
</style>
