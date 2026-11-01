import type { App } from './app';
import { EFFECTS, MAX_VERTICES, SHAPES, type Content, type EffectId, type ShapeId, type Surface } from './state';
import { parseYouTube } from './youtube';

type Child = Node | string | null | false | undefined;

/** Mini-helper per creare elementi DOM. Le proprietà vengono assegnate in ordine. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'title' || k.startsWith('data-')) el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

/** Campo con etichetta e valore numerico visibile. */
function slider(
  label: string, value: number, min: number, max: number, step: number,
  onInput: (v: number) => void, fmt: (v: number) => string = (v) => v.toFixed(2),
): HTMLElement {
  const out = h('span', { class: 'val' }, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      const v = parseFloat(input.value);
      out.textContent = fmt(v);
      onInput(v);
    },
  });
  return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), input, out);
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), control);
}

export class Panel {
  private helpOpen = false;

  constructor(private app: App, private root: HTMLElement) {}

  render(): void {
    const app = this.app;
    this.root.hidden = !app.uiVisible;
    if (!app.uiVisible) return;

    const scrollTop = this.root.scrollTop;
    this.root.replaceChildren(
      h('header', {},
        h('h1', {}, 'Projection Mapper'),
        h('button', { class: 'ghost', title: 'Nascondi interfaccia (H)', onclick: () => app.setUiVisible(false) }, 'Nascondi ✕'),
      ),
      this.sceneSection(),
      this.outputSection(),
      this.surfacesSection(),
      app.surface ? this.surfaceSection(app.surface) : h('p', { class: 'hint' }, 'Seleziona una superficie per modificarne il contenuto.'),
      this.helpSection(),
    );
    this.root.scrollTop = scrollTop;
  }

  private sceneSection(): HTMLElement {
    const app = this.app;
    const importInput = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: () => {
        const f = importInput.files?.[0];
        if (f) app.importScene(f);
      },
    });
    return h('section', {},
      h('h2', {}, 'Scena'),
      h('div', { class: 'buttons' },
        h('button', { onclick: () => app.addSurface(), title: 'Nuova superficie (N) – oppure doppio clic su un punto vuoto' }, '+ Superficie'),
        h('button', { onclick: () => app.addCube() }, '+ Cubo 3/4'),
        h('button', { onclick: () => app.undo(), title: 'Ctrl+Z' }, '↶ Annulla'),
      ),
      h('div', { class: 'buttons' },
        h('button', { onclick: () => app.exportScene() }, 'Esporta'),
        h('button', { onclick: () => importInput.click() }, 'Importa'),
        h('button', { class: 'danger', onclick: () => confirm('Eliminare tutte le superfici?') && app.clearScene() }, 'Svuota'),
        importInput,
      ),
    );
  }

  private outputSection(): HTMLElement {
    const app = this.app;
    const toggle = (label: string, key: 'calibration' | 'blackout', hint: string) =>
      h('label', { class: 'check', title: hint },
        h('input', {
          type: 'checkbox', checked: app[key],
          onchange: (e: Event) => { app[key] = (e.target as HTMLInputElement).checked; },
        }),
        label,
      );
    return h('section', {},
      h('h2', {}, 'Uscita'),
      slider('Luminosità', app.master, 0, 1, 0.01, (v) => (app.master = v), (v) => `${Math.round(v * 100)}%`),
      h('div', { class: 'buttons' },
        toggle('Griglia su tutto', 'calibration', 'Mostra la griglia di calibrazione su ogni superficie (G)'),
        toggle('Blackout', 'blackout', 'Spegne la proiezione (B)'),
      ),
      h('div', { class: 'buttons' },
        h('button', { onclick: () => app.toggleFullscreen(), title: 'F' },
          document.fullscreenElement ? 'Esci da schermo intero' : 'Schermo intero'),
        h('button', { class: 'primary', onclick: () => app.setUiVisible(false), title: 'H' }, 'Modalità show'),
      ),
    );
  }

  private surfacesSection(): HTMLElement {
    const app = this.app;
    const list = app.scene.surfaces;
    // In cima alla lista le superfici disegnate sopra
    const items = [...list].reverse().map((s) =>
      h('li', { class: s.id === app.selected ? 'sel' : '', onclick: () => app.select(s.id) },
        h('input', {
          type: 'checkbox', checked: s.visible, title: 'Visibile',
          onclick: (e: Event) => e.stopPropagation(),
          onchange: (e: Event) => { s.visible = (e.target as HTMLInputElement).checked; app.changed(); },
        }),
        h('span', { class: 'name' }, s.name),
        h('span', { class: 'fx' }, EFFECTS.find((x) => x.id === s.content.effect)?.label ?? ''),
        h('button', { class: 'icon', title: 'Porta sopra', onclick: (e: Event) => { e.stopPropagation(); app.reorder(s.id, 1); } }, '▲'),
        h('button', { class: 'icon', title: 'Porta sotto', onclick: (e: Event) => { e.stopPropagation(); app.reorder(s.id, -1); } }, '▼'),
      ),
    );
    return h('section', {},
      h('h2', {}, `Superfici (${list.length})`),
      list.length ? h('ul', { class: 'surfaces' }, ...items) : h('p', { class: 'hint' }, 'Nessuna superficie. Aggiungi un cubo o una superficie.'),
    );
  }

  private surfaceSection(s: Surface): HTMLElement {
    const app = this.app;
    const c = s.content;
    const set = <K extends keyof Content>(k: K, v: Content[K], structural = false) => {
      c[k] = v;
      app.changed(structural);
    };

    const effectSelect = h('select', {
      onchange: () => { app.snapshot(); set('effect', effectSelect.value as EffectId, true); },
    }, ...EFFECTS.map((e) => h('option', { value: e.id, selected: e.id === c.effect }, e.label)));

    const color = (k: 'c1' | 'c2') => h('input', { type: 'color', value: c[k], oninput: (e: Event) => set(k, (e.target as HTMLInputElement).value) });

    const fileInput = h('input', {
      type: 'file', accept: 'image/*,video/*', hidden: true,
      onchange: async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        const item = await app.media.add(f);
        app.snapshot();
        c.mediaId = item.id;
        c.mediaName = item.name;
        c.effect = 'media';
        app.changed(true);
      },
    });

    const mediaMissing = c.mediaId && !app.media.get(c.mediaId);
    const isMedia = c.effect === 'media';
    const isYouTube = c.effect === 'youtube';
    const noFx = isMedia || isYouTube;

    const fitSelect = () => field('Adattamento', h('select', {
      onchange: (e: Event) => set('fit', (e.target as HTMLSelectElement).value as Content['fit']),
    },
      h('option', { value: 'cover', selected: c.fit === 'cover' }, 'Riempi (ritaglia)'),
      h('option', { value: 'stretch', selected: c.fit === 'stretch' }, 'Deforma'),
    ));

    const ytValid = c.youtubeUrl ? parseYouTube(c.youtubeUrl) : null;
    const ytHint = h('p', { class: c.youtubeUrl && !ytValid ? 'hint warn' : 'hint' },
      !c.youtubeUrl ? 'Incolla un link youtube.com, youtu.be o shorts.'
        : ytValid ? `Video ${ytValid.id}${ytValid.start ? ` da ${ytValid.start} s` : ''}` : 'Link non riconosciuto.');

    return h('section', { class: 'selected' },
      h('h2', {}, 'Superficie selezionata'),
      field('Nome', h('input', {
        type: 'text', value: s.name,
        onchange: (e: Event) => { s.name = (e.target as HTMLInputElement).value || s.name; app.changed(true); },
      })),
      field('Effetto', effectSelect),

      isMedia && h('div', { class: 'media' },
        h('div', { class: 'buttons' },
          h('button', { onclick: () => fileInput.click() }, c.mediaId ? 'Cambia file…' : 'Carica immagine/video…'),
          fileInput,
        ),
        c.mediaName && h('p', { class: mediaMissing ? 'hint warn' : 'hint' },
          mediaMissing ? `“${c.mediaName}” non trovato: ricaricalo.` : c.mediaName),
        fitSelect(),
      ),

      isYouTube && h('div', { class: 'media' },
        field('Link', h('input', {
          type: 'text', value: c.youtubeUrl ?? '', placeholder: 'https://youtu.be/…',
          onchange: (e: Event) => {
            app.snapshot();
            set('youtubeUrl', (e.target as HTMLInputElement).value.trim() || null, true);
          },
        })),
        ytHint,
        fitSelect(),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: c.audio, onchange: (e: Event) => set('audio', (e.target as HTMLInputElement).checked) }),
          'Audio',
        ),
        h('p', { class: 'hint' }, 'I video YouTube stanno sempre sopra gli effetti generati e non supportano la sfumatura dei bordi.'),
      ),

      !noFx && h('div', { class: 'row colors' }, h('span', { class: 'lbl' }, 'Colori'), color('c1'), color('c2')),
      !noFx && slider('Velocità', c.speed, 0, 4, 0.05, (v) => set('speed', v)),
      !noFx && slider('Scala', c.scale, 0.1, 4, 0.05, (v) => set('scale', v)),
      !noFx && slider('Ritardo', c.delay, 0, 5, 0.05, (v) => set('delay', v), (v) => `${v.toFixed(2)} s`),

      field('Rotazione', h('select', {
        onchange: (e: Event) => set('rot', Number((e.target as HTMLSelectElement).value) as Content['rot']),
      }, ...[0, 1, 2, 3].map((r) => h('option', { value: r, selected: r === c.rot }, `${r * 90}°`)))),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c.flip, onchange: (e: Event) => set('flip', (e.target as HTMLInputElement).checked) }),
        'Specchia orizzontalmente',
      ),

      slider('Opacità', s.opacity, 0, 1, 0.01, (v) => { s.opacity = v; app.changed(); }, (v) => `${Math.round(v * 100)}%`),
      slider('Sfumatura bordi', s.feather, 0, 0.3, 0.005, (v) => { s.feather = v; app.changed(); }),
      field('Proporzioni L/A', h('input', {
        type: 'number', min: 0.1, max: 10, step: 0.05, value: s.aspect,
        title: 'Rapporto larghezza/altezza della faccia reale (1 per la faccia di un cubo). Serve per non deformare cerchi e griglie.',
        onchange: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (v > 0) { s.aspect = v; app.changed(); }
        },
      })),

      field('Forma', h('select', {
        title: 'Forma inscritta nel quadrilatero dei 4 angoli prospettici: segue la stessa prospettiva',
        onchange: (e: Event) => app.setShape((e.target as HTMLSelectElement).value as ShapeId),
      }, ...SHAPES.map((x) => h('option', { value: x.id, selected: x.id === s.shape }, x.label)))),
      s.shape === 'free' && h('div', { class: 'buttons' },
        app.drawing
          ? h('button', { class: 'primary', onclick: () => app.cancelDrawing(), title: 'Esc' }, 'Annulla disegno')
          : h('button', { onclick: () => app.startDrawing() }, s.freeform.length >= 3 ? '✎ Ridisegna forma' : '✎ Disegna forma'),
      ),
      s.shape === 'free' && h('p', { class: 'hint' }, app.drawing
        ? 'Tieni premuto e traccia il contorno sull’area di proiezione: la forma si chiude da sola al rilascio.'
        : s.freeform.length >= 3 ? `Forma di ${s.freeform.length} punti.` : 'Nessuna forma disegnata: la superficie usa il contorno del poligono.'),

      h('div', { class: 'buttons' },
        h('button', {
          title: 'Copia effetto, colori e parametri su tutte le superfici',
          onclick: () => {
            app.snapshot();
            for (const o of app.scene.surfaces) if (o !== s) o.content = { ...c, delay: o.content.delay };
            app.changed(true);
          },
        }, 'Applica a tutte'),
        h('button', {
          title: 'Imposta ritardi crescenti sulle superfici per un effetto a cascata',
          onclick: () => {
            app.snapshot();
            app.scene.surfaces.forEach((o, i) => (o.content.delay = +(i * 0.4).toFixed(2)));
            app.changed(true);
          },
        }, 'Ritardi a cascata'),
      ),
      h('div', { class: 'buttons' },
        h('button', {
          onclick: () => app.insertVertexOnSelected(), disabled: s.v.length >= MAX_VERTICES,
          title: 'Aggiunge un vertice a metà del lato dopo il vertice selezionato (I) – oppure doppio clic su un lato',
        }, '+ Vertice'),
        app.selVertex && !s.corners.some((i) => s.v[i] === app.selVertex) &&
          h('button', { onclick: () => app.removeSelectedVertex(), title: 'X' }, 'Rimuovi vertice'),
        app.selVertex && h('button', { onclick: () => app.detachSelectedVertex(), title: 'D' }, 'Stacca vertice'),
      ),
      h('div', { class: 'buttons' },
        h('button', { class: 'danger', onclick: () => app.deleteSelected(), title: 'Canc' }, 'Elimina superficie'),
      ),
    );
  }

  private helpSection(): HTMLElement {
    const rows: [string, string][] = [
      ['Trascina un angolo', 'sposta il vertice (si aggancia ai vertici vicini; Shift = niente aggancio)'],
      ['Trascina l’interno', 'sposta tutto il gruppo collegato (Alt = solo questa superficie)'],
      ['Doppio clic sul vuoto', 'nuova superficie'],
      ['Frecce', 'sposta il vertice selezionato di 1 px (Shift = 10 px)'],
      ['V / Tab', 'vertice successivo / superficie successiva'],
      ['Doppio clic su un lato', 'aggiunge un vertice (I: a metà del lato dopo quello selezionato)'],
      ['X', 'rimuove il vertice selezionato (non i 4 angoli)'],
      ['D', 'stacca il vertice condiviso selezionato'],
      ['Forma → Mano libera', 'trascina per disegnare il contorno (Esc annulla)'],
      ['H', 'nascondi/mostra interfaccia (modalità show)'],
      ['F · B · G', 'schermo intero · blackout · griglia su tutto'],
      ['Ctrl+Z · Canc', 'annulla · elimina superficie'],
    ];
    const details = h('details', {
      class: 'help', open: this.helpOpen,
      ontoggle: () => (this.helpOpen = details.open),
    },
      h('summary', {}, 'Comandi'),
      h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
    return details;
  }
}
