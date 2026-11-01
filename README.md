# Projection Mapper

Applicazione web per il projection mapping: proietta contenuti su superfici inclinate
(es. le facce di una scatola vista a 3/4) correggendo la prospettiva in tempo reale.

Documentazione completa: [docs/documentazione.md](docs/documentazione.md).

## Avvio

```bash
npm install
npm run dev      # apre http://localhost:5173 ed elenca gli indirizzi di rete
npm run build    # build statica in dist/
```

All'avvio il terminale mostra tutti gli indirizzi su cui l'app è pubblicata (Local e Network):
gli indirizzi Network funzionano anche da altri dispositivi sulla stessa rete. Scena e file salvati
sono legati all'indirizzo usato.

## Uso

1. Collega il proiettore come secondo schermo (estendi desktop), trascina la finestra del browser
   sul proiettore e premi **F** per lo schermo intero.
2. Punta il proiettore sulla scatola. Parte già con un **cubo 3/4** (3 facce con vertici condivisi).
3. Trascina gli angoli gialli finché coincidono con gli spigoli reali; rifinisci con le **frecce**
   (1 px, Shift = 10 px). Trascina l'interno di una faccia per spostare tutto il cubo.
4. Scegli l'effetto per ogni faccia; usa **Ritardi a cascata** per effetti che si inseguono.
5. Premi **H** per nascondere interfaccia e maniglie (modalità show).

### Video YouTube

Scegli l'effetto **Video YouTube** e incolla un link (youtube.com, youtu.be, shorts, anche con `?t=`).
Il player parte muto (requisito dei browser per l'autoplay); spunta **Audio** per attivare il suono.

Limiti: YouTube non permette di leggere i pixel del suo player, quindi non passa dallo shader ma viene
deformato con CSS `matrix3d`. Di conseguenza sta sempre sopra gli effetti generati, non ha sfumatura
dei bordi, richiede connessione internet e all'avvio YouTube mostra per qualche secondo titolo e logo.
Alcuni video hanno l'incorporamento disabilitato dal proprietario e non partono.

La scena si salva automaticamente nel browser; immagini e video in IndexedDB.
Con **Esporta/Importa** salvi la configurazione in JSON (i file multimediali non sono inclusi).

## Comandi

| Tasto | Azione |
|---|---|
| H | mostra/nascondi interfaccia |
| F | schermo intero |
| B | blackout |
| G | griglia di calibrazione su tutte le superfici |
| N / doppio clic | nuova superficie |
| Tab / V | superficie successiva / vertice successivo |
| Frecce | sposta vertice selezionato (o il gruppo) |
| Doppio clic su un lato / I | aggiunge un vertice al poligono |
| X | rimuove il vertice selezionato (non i 4 angoli) |
| D | stacca un vertice condiviso |
| Esc | annulla il disegno a mano libera / deseleziona il vertice |
| Canc | elimina superficie |
| Ctrl+Z | annulla |

Trascinando un vertice vicino a un altro si aggancia e i due diventano condivisi
(Shift durante il trascinamento disattiva l'aggancio).

Le superfici sono poligoni fino a 32 vertici. I 4 vertici iniziali sono gli angoli prospettici
(definiscono la prospettiva del contenuto); i vertici aggiunti modellano solo il contorno,
ritagliando o estendendo il contenuto. Sono ammessi poligoni concavi.

Dal menu **Forma** il contenuto si ritaglia con un'**ellisse inscritta** nel quadrilatero degli angoli
oppure con una sagoma **a mano libera** (si traccia trascinando il mouse sull'area di proiezione;
Esc annulla). Le forme sono salvate in coordinate della faccia e seguono la prospettiva.

## Struttura

- `src/geometry.ts` – omografia quadrato→quadrilatero (la matematica della correzione prospettica), triangolazione dei poligoni
- `src/shaders.ts` – shader WebGL2 con tutti gli effetti
- `src/renderer.ts` – disegno delle superfici su GPU
- `src/app.ts` – editor: maniglie, trascinamento, scorciatoie, annulla
- `src/ui.ts` – pannello di controllo
- `src/state.ts` – modello della scena, preset, salvataggio
- `src/youtube.ts` – player YouTube deformati con CSS matrix3d
- `src/media.ts` – immagini/video e persistenza in IndexedDB
