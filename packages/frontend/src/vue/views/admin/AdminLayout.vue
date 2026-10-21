<script setup lang="ts">
/**
 * The frame every moderation screen sits in: who you are, the way out, and the
 * one place that reacts to a session ending.
 *
 * ⚠️ **The watcher below is the whole reason this is a layout and not a
 * fragment repeated in two views.** A token expires after 12 h and can be
 * revoked at any moment by deleting the `user` row, so the session can end
 * *between* two clicks rather than between two page loads — and when it does,
 * every screen behind the guard has to react the same way. One watcher, one
 * navigation, no view that can forget.
 *
 * ⚠️ It watches `isSignedOut`, i.e. "the server refused the credential", not
 * `!isAuthenticated`. A token that could not be *checked* because the network
 * failed is still held (`unverified`), the guard admits it, and the screens
 * behind it show their own connection error. Logging someone out over a blink
 * of wifi is a bug they experience as randomness.
 *
 * ⚠️ There is no link to `/admin` anywhere in the public navbar, and that is
 * deliberate: the moderation surface has one user, who can type an address. A
 * nav item would advertise an authentication endpoint to every visitor of a
 * site that otherwise has none, in exchange for saving one person eight
 * keystrokes.
 */
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAdminSessionStore } from '@/stores/admin-session.store';
import { loginRedirectFor } from '@/router/admin-guard';
import GravTitle from '@/components/GravTitle.vue';

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();

watch(
  () => session.isSignedOut,
  (signedOut) => {
    if (!signedOut) return;
    // ⚠️ `replace`, not `push`: the admin URL we are leaving cannot be reached
    // any more, so leaving it in the history would make Back bounce straight
    // through the guard and land here again.
    void router.replace(loginRedirectFor(route));
  },
);

/**
 * ⚠️ The button only forgets the token — there is no logout endpoint, because
 * the backend issues stateless JWTs and keeps no session table. Navigation is
 * left to the watcher above, so "I clicked Salir" and "my token expired" follow
 * exactly one code path and cannot drift apart.
 */
function signOut(): void {
  session.logout();
}
</script>

<template>
  <v-container class="admin">
    <header class="admin__header">
      <GravTitle :level="1">Administración</GravTitle>

      <div class="admin__session">
        <span v-if="session.username" class="admin__user">{{ session.username }}</span>
        <v-btn variant="flat" color="warning" size="small" @click="signOut">Salir</v-btn>
      </div>
    </header>

    <p class="admin__note">Lo que se borra aquí se borra de verdad y no se puede recuperar.</p>

    <RouterView />
  </v-container>
</template>

<style scoped>
.admin__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.admin__session {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.admin__user {
  font-weight: 700;
}

.admin__note {
  margin: 0.25rem 0 1.5rem;
  opacity: 0.75;
}
</style>
