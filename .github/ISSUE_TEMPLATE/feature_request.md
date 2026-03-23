# 📋 Modulo Raccolta Requisiti: Ottimizzazione Container

> **Istruzioni per l'utente:** Compila questo documento per aiutarci a capire esattamente le tue necessità di magazzino. Sostituisci i testi tra parentesi quadre `[...]` con le tue risposte e spunta le caselle `[x]` pertinenti.

## 1. Informazioni sul Flusso di Lavoro
* **Chi userà principalmente questa applicazione?**
  [Es. Il responsabile di magazzino, gli operatori sul muletto, l'ufficio commerciale per fare preventivi...]
* **In quale momento del processo verrà usata?**
  [Es. Prima di confermare un ordine al cliente, durante la fase di imballaggio fisico, ecc.]

## 2. Natura dei Pacchi da Caricare
*I pacchi hanno caratteristiche fisiche che l'algoritmo deve rispettare? (Spunta le opzioni necessarie)*

- [ ] **Orientamento Obbligato:** Alcuni pacchi hanno un lato "Alto" e non possono essere ribaltati o ruotati di lato.
- [ ] **Sovrapponibilità (Stacking):** Alcuni pacchi sono fragili e non possono avere pesi sopra di essi.
- [ ] **Limiti di Peso:** Oltre al volume, dobbiamo calcolare anche il peso massimo per ogni singola scatola.
- [ ] **Forme Irregolari:** Gestiamo pallet non perfettamente cubici o merce sfusa. (Specificare: [...])
- [ ] **Merce Pericolosa/Incompatibile:** Alcuni pacchi non possono viaggiare vicini ad altri (es. chimici e alimentari).

## 3. Gestione dei Container e dei Veicoli
*Quali sono le regole per i mezzi di trasporto?*

- [ ] **Limiti di Peso del Container:** Dobbiamo bloccare il carico se si supera la portata massima in Kg del container, anche se c'è ancora spazio vuoto.
- [ ] **Multi-Container:** Se la merce non entra in un solo container, l'app deve calcolare automaticamente il numero di container aggiuntivi necessari.
- [ ] **Distribuzione del Peso (Bilanciamento):** È importante che il peso sia distribuito uniformemente per non sbilanciare il rimorchio.

## 4. Input e Output dei Dati
*Come vuoi inserire i dati e come vuoi leggere i risultati?*

**Come preferisci caricare la lista dei pacchi?**
- [ ] File Excel / CSV da caricare nell'app
- [ ] Connessione diretta a un gestionale (ERP/WMS)
- [ ] Inserimento manuale tramite interfaccia web

**Cosa deve mostrare il risultato finale?**
- [ ] Solo una lista testuale dei colli caricati/scartati
- [ ] Un'indicazione di quanti container servono
- [ ] Una rappresentazione visiva/3D del carico (molto complesso)
- [ ] Un PDF stampabile da dare al magazziniere con le istruzioni

## 5. Requisiti Tecnici e Varie
* **L'applicazione verrà usata in zone senza connessione internet?**
  [Sì / No]
* **Quali dispositivi verranno usati?**
  [Es. PC fissi in ufficio, Tablet robusti in magazzino, Smartphone]
* **Note Aggiuntive:**
  [Inserisci qui qualsiasi altra necessità particolare del tuo magazzino...]
