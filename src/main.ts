import './style.css';
import { App } from './app';

try {
  new App(
    document.getElementById('gl') as HTMLCanvasElement,
    document.getElementById('overlay') as HTMLCanvasElement,
    document.getElementById('panel') as HTMLElement,
    document.getElementById('yt-layer') as HTMLElement,
  );
} catch (e) {
  const box = document.getElementById('error')!;
  box.hidden = false;
  box.textContent = `Errore di avvio: ${(e as Error).message}`;
  console.error(e);
}
