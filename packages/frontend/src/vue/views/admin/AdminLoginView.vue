<script setup lang="ts">
/**
 * The only place in the whole application where a password is typed.
 *
 * ⚠️ **One message for every refusal, on purpose.** The backend answers an
 * unknown username and a wrong password with the same body, the same status
 * **and the same elapsed time** — it hashes the attempt against a decoy — so
 * that the endpoint cannot be used to find out which accounts exist. A screen
 * that said "ese usuario no existe" would hand back exactly the information the
 * server spent a bcrypt round hiding. So the copy below never depends on the
 * response: every refusal reads the same, and the only distinction drawn is
 * between "the server said no" and "the server never answered", which is
 * information the browser already has.
 *
 * ⚠️ For the same reason the fixed Spanish string is used instead of the
 * server's own message, which is the app's rule everywhere else
 * (`domainErrorNotice`). Here the server's message is a deliberate constant, so
 * showing our own loses nothing and keeps the UI in one language. Recorded as a
 * conscious exception rather than an oversight.
 *
 * There is **no signup, and no password reset**: the first (and only) admin row
 * is inserted by hand in the database with an already-hashed password. Nothing
 * on this screen should ever imply otherwise.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DomainError } from '#/domain/errors';
import { useAdminSessionStore } from '@/stores/admin-session.store';
import GravTitle from '@/components/GravTitle.vue';

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();

const username = ref('');
const password = ref('');
const busy = ref(false);
const message = ref('');

/**
 * Where to land after a successful login.
 *
 * ⚠️ **The `redirect` parameter is validated, not trusted.** It reaches this
 * component from the address bar, so anyone can put anything in it, and
 * `router.replace(whatever)` on an unchecked string is how an open redirect
 * gets built. Only an in-app absolute path under `/admin` is accepted — a
 * leading `//` (protocol-relative, i.e. another host) is rejected explicitly
 * because it is a path by every naive test and an external URL to a browser.
 */
const destination = computed(() => {
  const raw = route.query.redirect;
  const target = typeof raw === 'string' ? raw : '';
  const isInternalAdminPath = target.startsWith('/admin') && !target.startsWith('//');
  return isInternalAdminPath ? target : { name: 'adminClips' as const };
});

/**
 * ⚠️ Branching on the domain `code`, never on an HTTP status — the app's rule
 * (`core/domain/errors`). `REQUEST_REJECTED` is "the server understood and said
 * no", which for this endpoint means one thing and one thing only.
 */
function refusalMessage(error: unknown): string {
  if (error instanceof DomainError) {
    if (error.code === 'REQUEST_REJECTED') return 'Usuario o contraseña incorrectos.';
    if (error.code === 'VALIDATION_ERROR') return 'Escribe el usuario y la contraseña.';
  }
  return 'No se ha podido conectar con el servidor.';
}

async function submit(): Promise<void> {
  message.value = '';

  // Checked here so the empty-field case never becomes a request, and so its
  // wording is Spanish UI copy rather than the use case's English guard.
  if (username.value.trim() === '' || password.value === '') {
    message.value = 'Escribe el usuario y la contraseña.';
    return;
  }

  busy.value = true;
  try {
    await session.login({ username: username.value, password: password.value });
    // ⚠️ Cleared on the way out. The field is about to be unmounted anyway, but
    // a password left in a reactive ref is a password in a heap snapshot.
    password.value = '';
    await router.replace(destination.value);
  } catch (error) {
    message.value = refusalMessage(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-container class="admin-login">
    <GravTitle :level="1">Administración</GravTitle>

    <!-- `@submit.prevent` and a real `<form>`: Enter in either field submits,
         which is what anyone typing a password expects. -->
    <form class="admin-login__form" @submit.prevent="submit">
      <div class="control-graviner">
        <v-text-field
          v-model="username"
          label="Usuario"
          name="username"
          autocomplete="username"
          autofocus
          hide-details
        />
      </div>

      <div class="control-graviner">
        <v-text-field
          v-model="password"
          label="Contraseña"
          name="password"
          type="password"
          autocomplete="current-password"
          hide-details
        />
      </div>

      <!-- `role="alert"` so the refusal is announced: this screen has no other
           feedback, and a failed login that only changes colour is invisible to
           a screen reader. -->
      <v-alert v-if="message" type="error" variant="tonal" role="alert" class="admin-login__error">
        {{ message }}
      </v-alert>

      <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="busy">
        Entrar
      </v-btn>
    </form>
  </v-container>
</template>

<style scoped>
.admin-login__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 22rem;
  margin-top: 1.5rem;
}
</style>
