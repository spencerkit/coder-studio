<script setup lang="ts">
import { computed, ref } from "vue";

const count = ref(0);
const doubled = computed(() => count.value * 2);

interface Props {
  label: string;
}
const props = defineProps<Props>();
</script>

<template>
  <button @click="count++">{{ props.label }} {{ doubled }}</button>
</template>