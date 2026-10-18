import { uid } from './state';

export interface MediaItem {
  id: string;
  name: string;
  kind: 'image' | 'video';
  el: HTMLImageElement | HTMLVideoElement;
  url: string;
}

const DB_NAME = 'projector-mapper';
const STORE = 'media';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Gestisce i file multimediali in memoria e li salva in IndexedDB. */
export class MediaLibrary {
  private items = new Map<string, MediaItem>();
  onChange: () => void = () => {};

  get(id: string | null): MediaItem | undefined {
    return id ? this.items.get(id) : undefined;
  }

  async add(file: File): Promise<MediaItem> {
    const id = uid();
    const item = await this.materialize(id, file.name, file);
    try {
      await tx('readwrite', (s) => s.put({ name: file.name, blob: file }, id));
    } catch (e) {
      console.warn('Impossibile salvare il file in IndexedDB', e);
    }
    return item;
  }

  /** Carica dal database i media referenziati dalla scena. */
  async restore(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      if (this.items.has(id)) continue;
      try {
        const rec = await tx<{ name: string; blob: Blob } | undefined>('readonly', (s) => s.get(id));
        if (rec) await this.materialize(id, rec.name, rec.blob);
      } catch (e) {
        console.warn('Media non recuperabile', id, e);
      }
    }
  }

  /** Elimina dal database i media che nessuna superficie usa più. */
  async collect(usedIds: string[]): Promise<void> {
    const used = new Set(usedIds);
    for (const [id, item] of this.items) {
      if (used.has(id)) continue;
      if (item.el instanceof HTMLVideoElement) item.el.pause();
      URL.revokeObjectURL(item.url);
      this.items.delete(id);
      tx('readwrite', (s) => s.delete(id)).catch(() => {});
    }
  }

  private async materialize(id: string, name: string, blob: Blob): Promise<MediaItem> {
    const url = URL.createObjectURL(blob);
    const isVideo = blob.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name);
    let el: HTMLImageElement | HTMLVideoElement;
    if (isVideo) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, loop: true, muted: true, playsInline: true, autoplay: true });
      await new Promise<void>((res) => {
        v.onloadeddata = () => res();
        v.onerror = () => res();
      });
      v.play().catch(() => {});
      el = v;
    } else {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      el = img;
    }
    const item: MediaItem = { id, name, kind: isVideo ? 'video' : 'image', el, url };
    this.items.set(id, item);
    this.onChange();
    return item;
  }
}

export function mediaSize(el: HTMLImageElement | HTMLVideoElement): { w: number; h: number } {
  return el instanceof HTMLVideoElement
    ? { w: el.videoWidth, h: el.videoHeight }
    : { w: el.naturalWidth, h: el.naturalHeight };
}
