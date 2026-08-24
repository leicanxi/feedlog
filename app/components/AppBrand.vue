<!--
  Brand mark (logo + wordmark) rendered in the default layout header.
-->
<template>
  <NuxtLink :to="localePath('/')" class="flex min-w-0 items-center gap-2.5">
    <img
      v-if="portal.logo"
      :src="portal.logo"
      :alt="portal.name"
      width="40"
      height="40"
      class="size-8 shrink-0 rounded-md object-cover md:size-9"
    >
    <AppLogo v-else :size="32" class="md:size-9" />
    <span class="truncate font-heading text-[1.0625rem] font-semibold tracking-[-0.03em] md:text-lg">{{ portal.name }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
const portal = usePortalOrg()
const localePath = useLocalePath()
</script>
