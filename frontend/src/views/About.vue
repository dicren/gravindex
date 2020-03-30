<template>
  <section class="section has-text-white">
    <h4 class="title has-text-white-ter">¿Por qué?</h4>
    <p>
      ¿Por qué no? Si estás aquí es porque te gusta gravina, ¿No sería genial
      poder tener todos los buenos momentos del podcast guardados en un mismo
      sitio? Ayudame a conseguirlo colaborando en esta página.<br />
      Llevaba tiempo pensando en hacer algo como esto, y cuando apareció el
      <a
        href="https://docs.google.com/spreadsheets/d/1K_jSPXo0cLzOm7NeWSohPoRnfSoaWzDsFjjMc-n6PFY"
        target="_blank"
        >Índice gravinero
      </a>
      obra de
      <a target="_blank" href="https://twitter.com/ICMarja">Iván Caballero</a>
      me pareció el mejor momento.<br />
      Mi intención es ir añadiendo funcionalidades a la página con el tiempo,
      sobretodo si tiene buena acogida.
    </p>
    <h4 class="title has-text-white-ter">¿Cómo puedo colaborar?</h4>

    <p>
      Puedes añadir nuevos clips a la biblioteca utilizando el botón de
      <router-link to="creator">añadir</router-link>
      corte.
      <br />
      También puedes <a href="https://twitter.com/dicren">escribirme</a> si
      encuentras algún fallo en la web o si se te ocurre alguna idea. <br />
      Si quieres colaborar con en apartado técnico puedes encontrar el código de
      la página en <a href="https://github.com/DiCrEn/gravindex">github</a>.
    </p>

    <h4 class="title has-text-white-ter">La web</h4>
    <p>
      Todo el contenido de esta web es propiedad de
      <a href="https://gravina82.com/">Gravina82</a> y la web puedes encontrarla
      en <a href="https://github.com/DiCrEn/gravindex">github</a>. <br />
      La intención de esta página es tener un índice de fácil acceso a todos
      esos grandes momentos gravineros.
    </p>

    <h4 class="title has-text-white-ter">Versiones</h4>

    <ul>
      <li>
        <span class="has-text-weight-bold">1.0.0</span> - Primera versión
        pública
      </li>
    </ul>
  </section>
</template>

<script>
export default {
  name: "About",
};
</script>

<style scoped>
p {
  margin-bottom: 2rem;
}
</style>
