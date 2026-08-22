/**
 * Il service worker. È la cosa che decide se l'app si apre in metro o no.
 *
 * 🔴 Il bug numero uno dell'HTML attuale sta qui: il suo `sw.js` alla riga 47 SALTA le
 * richieste cross-origin, e Leaflet arriva da `unpkg.com`. Risultato: senza segnale
 * `L` è `undefined` e al posto della mappa c'è un rettangolo grigio.
 *
 * La correzione **non** è mettere in cache anche il cross-origin — le risposte opache
 * non si possono controllare, e la CDN può cambiare o rispondere 403 al momento
 * dell'installazione senza che nessuno se ne accorga. La correzione è **non avere
 * dipendenze cross-origin**: qui MapLibre, React e tutto il resto entrano nel build
 * come pacchetti npm e finiscono in `assets/`, sullo stesso origin. Questo file infatti
 * non contiene un solo dominio esterno, e non deve mai contenerne uno.
 *
 * L'elenco dei file lo scrive `scripts/build_sw.mjs` dopo il build, perché i nomi
 * hanno un hash (`index-a3f9c1.js`) e un elenco scritto a mano è sbagliato al secondo
 * build — con il sintomo peggiore possibile: l'app si apre offline, ma con il codice
 * di due settimane prima.
 */
/* eslint-disable no-restricted-globals */

// Sostituiti a build time. Se restano così, il build non è stato completato.
const PRECACHE = [
  "./index.html",
  "./assets/EventRow-DxlNvrir.js",
  "./assets/Giorno-JKPxisEM.js",
  "./assets/Info-uFnjBhba.js",
  "./assets/Luogo-D2IFCbOS.js",
  "./assets/Mappa-9UNWPgFo.css",
  "./assets/Mappa-DsMNZvS1.js",
  "./assets/Obiettivi-DW38dW4w.js",
  "./assets/Oggi-K9LFguXJ.js",
  "./assets/TopBar-TllKhhz1.js",
  "./assets/Viaggio-C4RPjGIw.js",
  "./assets/geo-CiwvUJUH.js",
  "./assets/index-CEBtHkrP.css",
  "./assets/index-kUIlZiqd.js",
  "./assets/maplibre-gl-worker-BDpjEBlB.js",
  "./assets/open--8tDkQRZ.js",
  "./assets/style-D0IkgN-N.js",
  "./assets/time-C4a4AXup.js",
  "./assets/tripday-CJ6G6FTO.js",
  "./assets/useNow-E44o7V_P.js",
  "./data/rail-seoul.geojson",
  "./data/rail-tokyo.geojson",
  "./data/trip-giappone-2026.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest"
]
const VERSION = "2477b53bb24b"

const CACHE = 'viaggi-' + VERSION
const SHELL = './index.html'
const READY = !PRECACHE.includes('__PRECACHE_FILES__')

/**
 * 🔴 **Il contratto della mappa, iniettato da `build_sw.mjs` da `src/map/`.**
 *
 * Un service worker non può importare un modulo TypeScript, e riscrivere questi nomi a mano
 * qui sarebbe la seconda metà di un contratto che nessun test vede divergere — su questa app
 * quel difetto è già costato quattro mappe grigie. Quindi i valori veri stanno in
 * `src/map/tiles.ts` (e `TILE_HOST` in `src/map/style.ts`, dove c'è il perché di quel
 * fornitore), l'app li importa da lì, e il build li sostituisce qui.
 *
 * ⚠️ Se la sostituzione non è avvenuta, `MAP_READY` è falso e le richieste alla mappa
 * **passano al browser** invece di essere intercettate: la mappa funziona come prima (dalla
 * rete, ogni volta), non si rompe. Un guasto del build non deve mai togliere la mappa; deve
 * togliere solo il risparmio.
 */
const TILE_HOST = "https://tiles.openfreemap.org"
const TILE_CACHE = "mappa-tessere-v1"
const BASE_CACHE = "mappa-base-v1"
const TILE_LEDGER = "/__registro__"
// ⚠️ Fra apici, e non un numero nudo. Un `const X = __SEGNAPOSTO__` non sostituito sarebbe un
// `ReferenceError` alla prima riga del worker, cioè **niente service worker e niente offline
// per tutta l'app** — il guasto grosso al posto di quello piccolo. Così invece diventa 0.
const TILE_BUDGET = Number("125829120") || 0
const MAP_READY = !TILE_HOST.startsWith('__') && !TILE_CACHE.startsWith('__') && TILE_BUDGET > 0
const TILE_ORIGIN = MAP_READY ? new URL(TILE_HOST).origin : null

self.addEventListener('install', (e) => {
  if (!READY) {
    // Meglio un service worker che non fa niente di uno che mette in cache un
    // segnaposto: `addAll` fallirebbe, l'installazione con lui, e l'app resterebbe
    // senza offline **in silenzio**.
    console.error('[sw] build incompleto: manca l’elenco del precache. Nessuna cache.')
    return
  }
  e.waitUntil(
    caches.open(CACHE)
      // `reload` salta la cache HTTP del browser: senza, il service worker può
      // precachare una copia vecchia servita da lì e congelarla per sempre.
      .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' }))))
      // Il nuovo worker prende il posto del vecchio senza aspettare che tutte le
      // schede si chiudano. Su un'app installata «tutte le schede» può voler dire
      // «mai», e un aggiornamento che non arriva è un aggiornamento che non esiste.
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      /**
       * Si cancellano solo le cache di questa app e solo quelle di versioni precedenti.
       *
       * 🔴 **Questa riga è ciò che rende utile la cache delle tessere**, e va letta al
       * contrario: `mappa-tessere-v1` e `mappa-base-v1` non iniziano per `viaggi-`, quindi
       * **sopravvivono al deploy**. Senza, un punto e virgola cambiato nel codice cambierebbe
       * `VERSION`, butterebbe la mappa con lo scheletro, e Davide si ritroverebbe a
       * riscaricare Tokyo per una modifica che non l'ha nemmeno sfiorata — cioè il difetto
       * che stiamo riparando, reintrodotto dalla porta di servizio.
       */
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith('viaggi-') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

/**
 * La strategia: **cache prima, rete dopo e solo per aggiornare.**
 *
 * L'inverso («rete, e se non c'è la cache») sembra più aggiornato ed è la scelta
 * sbagliata per questa app: in metro ogni richiesta aspetta il timeout prima di
 * arrendersi, quindi l'avvio diventa trenta secondi di scheletro. Qui la rete non è
 * l'eccezione da gestire, è l'eccezione da *non aspettare*.
 */
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  /**
   * 🔴 **La mappa: si intercetta, e si tiene.** È la riparazione del 20 agosto 2026.
   *
   * Dal passaggio a OpenFreeMap le tessere sono cross-origin, e finivano nel `return` qui
   * sotto: passavano al browser e **nessuno le salvava**. Sul portatile non si nota (la cache
   * HTTP fa il suo lavoro); su un iPhone quella cache è piccola e viene svuotata, quindi ogni
   * apertura della Mappa era un download da capo — in roaming, a pagamento.
   *
   * Le due obiezioni scritte qui il 19 agosto erano giuste allora e vanno riviste, non
   * cancellate:
   *
   *  1. *«butterebbero la cache dell'app a ogni deploy»* → è il motivo per cui stanno in
   *     **cache loro**, che l'`activate` non tocca (vedi sopra), e non nel precache;
   *  2. *«una risposta cross-origin è opaca, quindi una 403 si installerebbe come buona»* →
   *     **misurato, non è più vero**: OpenFreeMap risponde `access-control-allow-origin: *`,
   *     MapLibre chiede in modalità `cors`, quindi `res.type` è `'cors'` e **lo stato si
   *     legge**. Il controllo su `res.ok` qui sotto è ciò che rende vera l'obiezione al
   *     contrario: una 403 non entra, e la mappa guarisce da sé quando il fornitore torna.
   *
   * ⚠️ E il prezzo dichiarato il 19 agosto cambia in meglio, non sparisce: **senza rete la
   * mappa non si disegna dove non sei mai stato.** Le zone che hai già guardato invece sì.
   */
  if (MAP_READY && url.origin === TILE_ORIGIN) {
    e.respondWith(fromMap(req, url))
    return
  }

  /**
   * Tutto il resto del cross-origin: non si intercetta. Non perché sia difficile, ma perché se
   * qualcosa di essenziale finisse fuori origin questo `return` lo farebbe morire offline — e
   * allora il posto giusto per accorgersene è il build, non qui. Il guardiano di
   * `build_sw.mjs` conta gli host esterni dei sorgenti e ne ammette **uno**: quello sopra.
   */
  if (url.origin !== self.location.origin) return

  // Navigazione: c'è una sola pagina. Il routing è nell'hash (`/#/day/12`), quindi
  // qualunque URL di navigazione si serve con lo scheletro e ci pensa React.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(SHELL, { ignoreSearch: true })
        .then(r => r || fetch(req))
        // Ultima rete di sicurezza: se anche lo scheletro manca, una frase invece
        // dell'errore del browser, che non dice niente a chi lo legge.
        .catch(() => new Response(
          '<meta charset=utf-8><p style="font:16px system-ui;padding:2rem">' +
          'Il viaggio non è ancora stato scaricato. Apri l’app una volta con la rete.',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ))
    )
    return
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(hit => {
      if (hit) {
        // C'è: si risponde subito e si controlla la rete **dopo**, in silenzio. Serve
        // per `data/trip-*.json`, il file che Davide corregge più spesso: la
        // correzione arriva al giro successivo senza che l'avvio rallenti mai.
        if (url.pathname.includes('/data/')) void revalidate(req)
        return hit
      }
      return fetch(req).then(res => {
        // Solo le risposte buone e non opache: una 404 in cache è un errore che
        // sopravvive al deploy che l'ha risolto.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          void caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      })
    })
  )
})

/** Aggiorna la copia in cache senza far aspettare nessuno. Gli errori sono normali. */
function revalidate(req) {
  return fetch(req)
    .then(res => {
      if (res.ok && res.type === 'basic') return caches.open(CACHE).then(c => c.put(req, res))
    })
    .catch(() => { /* nessuna rete: è il caso previsto, non un guasto */ })
}

// ─── la mappa ───────────────────────────────────────────────────────────────────

/**
 * Le **tre** famiglie di richieste che il fornitore serve, e perché non si trattano uguale.
 *
 *  · `manifesto` — `/styles/liberty` e `/planet`. Sono i JSON che dichiarano tutto il resto, e
 *    scadono in **un giorno**: si servono dalla cache e si rinfrescano **in sottofondo**, come
 *    i dati del viaggio. Averli in cache è ciò che permette alla mappa di *partire* senza rete.
 *  · `risorsa` — `/fonts/…` e `/sprites/…`: glifi e icone, poche centinaia di KB, immutabili,
 *    mai sfrattati.
 *  · `tessera` — `/planet/<versione>/z/x/y.pbf` e `/natural_earth/ne2sr/z/x/y.png`: migliaia di
 *    file, immutabili (URL versionato), **sfrattabili** e sotto il tetto dei byte.
 *
 * 🔴 **`/planet` è un manifesto, non una tessera, e il 20 agosto 2026 questo worker sbagliava.**
 * Lo ha misurato la sonda `prove_tile_cache.mjs`, non un test: lo stile non dichiara l'indirizzo
 * delle tessere: dichiara `"url": "https://tiles.openfreemap.org/planet"`, cioè un **TileJSON**,
 * ed è **l'unico posto** dove vive la versione del planet. Trattarlo come una tessera aveva due
 * conseguenze, entrambe silenziose e la seconda senza rimedio:
 *  1. era **sfrattabile**, quindi il primo sfratto si portava via il file senza il quale la
 *     mappa non sa nemmeno da dove prendere le tessere che ha in cache;
 *  2. non veniva **mai rinfrescato** — e il fornitore ruota il planet (misurato:
 *     `20250122_001001_pt` il 19 agosto, `20260816_080001_pt` il 20). Una copia eterna del
 *     TileJSON vecchio significa che il giorno in cui loro cancellano quel planet la mappa
 *     smette di funzionare **e non guarisce più**, perché la cache continua a rispondere col
 *     vecchio indirizzo. Un guasto permanente causato dalla cura.
 *
 * ⚠️ **La tessera si riconosce dallo `z/x/y`, non dall'estensione né dal prefisso.** I glifi
 * sono `.pbf` come le tessere (`/fonts/Noto Sans Regular/0-255.pbf`), quindi un
 * `endsWith('.pbf')` metterebbe le etichette fra le cose sfrattabili; e `/planet` ha lo stesso
 * prefisso delle tessere del planet, quindi `startsWith('/planet/')` non separa il manifesto
 * dalle tessere che dichiara. `z/x/y` è invece **come funzionano le tessere**, per chiunque le
 * serva — ed è ciò che ha fatto entrare gratis anche l'ombreggiatura `natural_earth`.
 *
 * ⚠️ E la scelta di quale famiglia sta nel `default` è deliberata: **una cosa non riconosciuta è
 * un manifesto**, cioè finisce in `BASE_CACHE`. Se fosse una tessera, un endpoint nuovo del
 * fornitore diventerebbe qualcosa di sfrattabile per errore; così invece diventa qualcosa che
 * non si sfratta, e il prezzo di sbagliare è che cresca — per questo `keep()` ha un tetto anche
 * sul numero di voci di `BASE_CACHE`.
 */
function kind(pathname) {
  if (pathname.startsWith('/fonts/') || pathname.startsWith('/sprites/')) return 'risorsa'
  if (/\/\d+\/\d+\/\d+\.[a-z0-9]+$/i.test(pathname)) return 'tessera'
  return 'manifesto'
}

/**
 * Cache prima, rete solo se manca. Le tessere non si rivalidano: il loro URL contiene la
 * versione del planet (`/planet/20250122_001001_pt/…`) e il fornitore le dichiara valide dieci
 * anni (`max-age=315360000`), quindi una tessera in cache **non può essere vecchia** — o è
 * quella giusta, o l'URL è cambiato e questa non la chiede più nessuno.
 */
async function fromMap(req, url) {
  const k = kind(url.pathname)
  const cache = await caches.open(k === 'tessera' ? TILE_CACHE : BASE_CACHE)
  /**
   * ⚠️ `ignoreVary`. Le tessere arrivano con `vary: accept-encoding`, e senza questa opzione
   * la Cache API considera un colpo valido **solo** se l'`Accept-Encoding` della richiesta
   * combacia con quello di quando fu salvata. È un header che mette il browser e noi non
   * controlliamo: basta che cambi (o che non ci sia, come nelle richieste del worker di
   * MapLibre) perché ogni tessera risulti assente e si riscarichi tutto — cioè il difetto di
   * oggi, con la cache piena.
   */
  const hit = await cache.match(req, { ignoreVary: true })
  if (hit) {
    if (k === 'manifesto') void refresh(cache, req)
    return hit
  }

  const res = await fetch(req)
  // Solo le risposte buone: una 403 o una 404 in cache sarebbe un guasto che sopravvive al
  // ritorno del fornitore. `type` esclude le opache, che avrebbero `ok` falso comunque:
  // meglio due controlli espliciti che dipendere da quale dei due scatta.
  if (res.ok && res.type !== 'opaque') void keep(k, req, res.clone())
  return res
}

/** Rinfresca un manifesto senza far aspettare nessuno. Senza rete non è un guasto. */
function refresh(cache, req) {
  return fetch(req)
    .then(res => { if (res.ok && res.type !== 'opaque') return cache.put(req, res) })
    .catch(() => {})
}

/**
 * Salva, e tiene aggiornato il registro dei byte.
 *
 * 🔴 Perché un registro. La Cache API **non dice quanto pesa**: l'unico modo di saperlo è
 * rileggere il corpo di ogni voce, cioè tirare decine di MB su dal disco per fare una somma.
 * Qui il peso si misura **quando la tessera passa** (`blob().size`, il corpo è già in RAM) e
 * si somma a un numero di venti byte che vive in `BASE_CACHE`, dove nessuno sfratto lo tocca.
 *
 * ⚠️ Le scritture del registro passano tutte da `queue`: un `leggi-somma-scrivi` su venti
 * tessere in volo insieme — ed è esattamente quello che fa MapLibre a ogni pan — perderebbe
 * dei conti, e un registro che sottostima non sfratta mai.
 */
async function keep(k, req, res) {
  try {
    if (k !== 'tessera') {
      const cache = await caches.open(BASE_CACHE)
      /**
       * 🔴 **Il tetto sul numero di voci, che è l'assicurazione sul `default` di `kind()`.**
       *
       * `BASE_CACHE` non ha un tetto in byte e non si sfratta mai — è giusto, perché contiene
       * poche centinaia di KB di cose senza le quali non si disegna niente. Ma «poche centinaia
       * di KB» è vero solo finché `kind()` riconosce le tessere: se il fornitore cambiasse la
       * forma dei loro URL abbandonando lo `z/x/y`, ogni tessera diventerebbe un «manifesto» e
       * finirebbe **qui**, senza tetto e senza sfratto, fino al giorno in cui Safari cancella
       * tutto l'archivio dell'app — bundle e note comprese, senza avvisare.
       *
       * Con questo tetto quel guasto si riduce a **una mappa che si riscarica ogni volta**, cioè
       * il difetto di prima del 20 agosto: brutto, recuperabile, e non porta via gli appunti.
       *
       * 1200: le facce dei glifi sono 3 e ogni faccia ha al massimo 256 intervalli (768), più
       * gli sprite e i due manifesti. Nell'uso vero le voci misurate sono ~20.
       */
      if ((await cache.keys()).length >= 1200) return
      await cache.put(req, res)
      return
    }
    const bytes = (await res.clone().blob()).size
    const cache = await caches.open(TILE_CACHE)
    await cache.put(req, res)
    await queue(() => account(cache, bytes))
  } catch {
    /* Salvare è un'ottimizzazione: se la quota è piena o la richiesta è stata annullata,
       la mappa deve continuare a funzionare. Non si rilancia. */
  }
}

let chain = Promise.resolve()
/** Una coda: le operazioni sul registro non si scavalcano. */
function queue(fn) {
  chain = chain.then(fn, fn)
  return chain
}

async function readLedger(cache) {
  const hit = await cache.match(TILE_HOST + TILE_LEDGER)
  if (!hit) return { bytes: 0, n: 0 }
  try {
    const j = await hit.json()
    return { bytes: Number(j.bytes) || 0, n: Number(j.n) || 0 }
  } catch {
    return { bytes: 0, n: 0 }
  }
}

function writeLedger(l) {
  return caches.open(BASE_CACHE).then(c => c.put(
    TILE_HOST + TILE_LEDGER,
    new Response(JSON.stringify(l), { headers: { 'Content-Type': 'application/json' } })
  ))
}

/** Somma una tessera al registro e, se si sfonda il tetto, sfratta. */
async function account(cache, bytes) {
  const base = await caches.open(BASE_CACHE)
  const l = await readLedger(base)
  l.bytes += bytes
  l.n += 1
  if (l.bytes > TILE_BUDGET) await evict(cache, l)
  await writeLedger(l)
}

/**
 * Sfratto **FIFO**: si cancella dalla testa di `cache.keys()`, che la Cache API restituisce
 * nell'ordine in cui le voci sono entrate.
 *
 * ⚠️ FIFO e non LRU, dichiarato: un vero LRU vorrebbe riscrivere la voce a ogni lettura, cioè
 * pagare byte per risparmiare byte, e su una mappa le letture sono continue. Per le tessere la
 * differenza conta poco — quelle vecchie sono le zone che non guardi più — e il costo di
 * sbagliare è una tessera da riscaricare, non un guasto.
 *
 * Si scende al **90%** del tetto e non al 100%: sfrattare una voce sola a ogni tessera nuova
 * vorrebbe dire rileggere e cancellare per sempre, a ogni pan della mappa.
 */
async function evict(cache, l) {
  const keys = await cache.keys()
  const target = TILE_BUDGET * 0.9
  for (const k of keys) {
    if (l.bytes <= target) break
    // Il peso della voce che si butta si misura rileggendola: sono poche voci per sfratto,
    // e senza questo il registro perderebbe il conto e il tetto diventerebbe una bugia.
    const old = await cache.match(k, { ignoreVary: true })
    const size = old ? (await old.blob()).size : 0
    await cache.delete(k)
    l.bytes = Math.max(0, l.bytes - size)
    l.n = Math.max(0, l.n - 1)
  }
}
