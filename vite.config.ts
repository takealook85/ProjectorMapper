import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // host: true ascolta su tutte le interfacce: all'avvio Vite elenca tutti gli indirizzi
  // (Local e Network) da cui l'app è raggiungibile, anche da altri dispositivi in rete
  server: { open: true, host: true },
  preview: { host: true },
});
