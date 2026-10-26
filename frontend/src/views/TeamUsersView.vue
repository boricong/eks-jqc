<script setup lang="ts">
import UserManagementPanel from '../components/UserManagementPanel.vue';
import { useDemo } from '../stores/demo';
const store = useDemo();
</script>
<template>
  <UserManagementPanel :key="`${store.actorId}:${store.managementLv1}`" mode="team" />
</template>
