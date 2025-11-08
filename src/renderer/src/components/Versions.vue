<script setup lang="ts">
import { reactive } from 'vue'
// 在纯浏览器预览时 window.electron 不存在，需兜底以避免报错
const safeVersions = ((): Record<string, string> => {
  const ve = (globalThis as any)?.window?.electron?.process?.versions
  if (ve && typeof ve === 'object') return ve as Record<string, string>
  return { electron: '-', chrome: '-', node: '-' }
})()

const versions = reactive({ ...safeVersions })
</script>

<template>
  <ul class="versions">
    <li class="electron-version">Electron v{{ versions.electron }}</li>
    <li class="chrome-version">Chromium v{{ versions.chrome }}</li>
    <li class="node-version">Node v{{ versions.node }}</li>
  </ul>
</template>
