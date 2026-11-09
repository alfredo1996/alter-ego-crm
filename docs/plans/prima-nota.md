> History, dated 2026-11-09: this plan predates the split of the personal and company apps. It describes the old build, so the personal tools (`list_accounts`, `add_transaction`) and the `-crm` file names it mentions no longer exist here.

# Prima nota nell'app: il piano finale

> Copia per il repository: indirizzi, saldi, banche, fornitori, importi e conteggi reali sostituiti da segnaposto. Nessun dato reale del proprietario va mai nel repository o nei test.

> Base: design A ("minimal correct"), con gli innesti scelti dal giudice, i suoi difetti corretti e i 23 punti del critico risolti o messi fuori perimetro (tabella in §8.12). Le affermazioni sul codice sono verificate su `main` @ 109aa4a.

## 1. Il piano in breve

1. La prima nota diventa una pagina nuova nella parte aziendale dell'app: **Cash Book** (in inglese, come il resto dell'app), nel menu Company subito dopo Invoices.
2. Lì vivono i conti della società: Bank A, Bank B e, se vuoi, una cassa. Sono separati dai tuoi conti personali, che restano solo nella parte personale dell'app.
3. Ogni euro si scrive una volta sola, dove già esiste: l'incasso sulla fattura, il costo nei Costi, il finanziamento soci nei Finanziamenti, e tutto il resto (giroconti, affitti delle stanze, depositi, F24, compenso) come movimento.
4. La pagina mette tutto insieme e ti mostra il saldo di ogni conto mese per mese, come i tuoi fogli da Maggio a Ottobre.
5. Una volta al mese scrivi il saldo vero della banca e l'app ti risponde «Matches the bank» oppure «Missing OUT of € x», come il foglio Verifica.
6. Vedi anche i soldi che non sono davvero tuoi: l'IVA da versare, i depositi cauzionali da restituire, quanto devi ai fornitori e quanto la società deve a te.
7. Le fatture dei fornitori sono facoltative: le registri solo quando servono (importi grandi o pagati a rate) e l'app ti dice quanto resta da pagare.
8. Ogni riga può avere un progetto (Via Esempio, Consulting) e vedi entrate, costi e risultato per progetto, con i depositi tenuti fuori.
9. Lo stesso costo conta sia per la cassa sia per il Piano delle tasse, mai due volte, e gli affitti incassati entrano finalmente anche nel Piano.
10. Il tuo Excel si importa una volta sola: l'app lo accetta solo se alla fine Bank A fa <saldo Bank A del foglio Saldo> e Bank B <saldo Bank B del foglio Saldo>, come in banca al 07/10/2026.
11. Puoi scrivere dal web o in chat («pagato 1.850 affitto Via Esempio da Bank B il 5/10»); l'AI resta facoltativa e ogni cosa si fa anche a mano.
12. Non sostituisce il commercialista: al posto dell'Excel gli dai un export CSV.

## 2. Cosa vedrai e come lo userai

### 2.1 La pagina Cash Book

**In alto**

- Un chip per conto: _All_, _Bank A_, _Bank B_, _Cassa_ (se l'hai creata). Scegliere un conto filtra tutta la pagina.
- Il mese: ‹ Oct 2026 ›.
- Pulsanti: **Add Movement** (il principale), **Check Balance**, e nel menu **Import Excel**, **Undo Import** (solo se c'è un import), **Accounts**, **Export CSV**.

**I riquadri**

- Un riquadro per conto: saldo di oggi e stato del controllo: «Matches the bank on 07/10/2026», oppure «Missing OUT of € 25,00», oppure «Not checked» (mai controllato, per esempio la cassa).
- **Total**: la somma dei conti.
- **Available**: quanto è davvero libero, cioè il totale meno l'IVA da versare e meno i depositi da restituire.
- **VAT Not Yet Paid**: l'IVA incassata dai clienti italiani e non ancora versata con F24. Sotto, in piccolo, **VAT on unpaid invoices**: l'IVA delle fatture emesse ma non ancora incassate, che a scadenza devi versare lo stesso.
- **Deposits to Give Back**: i depositi cauzionali degli inquilini.
- **Clients Owe You**: fatture aperte dei clienti.
- **You Owe Suppliers**: il residuo delle fatture fornitori che hai registrato.
- **SRL Owes You**: finanziamenti soci più acquisti fatti con la tua carta personale, meno i rimborsi.

**Le schede**

- **Movements**: il mese come un foglio del tuo Excel.
  - Prima riga: il saldo di inizio mese. Poi le righe: data (con «~» se è stimata), descrizione con il progetto, documento, conto, Entrata, Uscita, e il saldo **a fine giornata** (non riga per riga, perché molte righe importate hanno la stessa data).
  - I giroconti sono in grigio: «Bank A → Bank B».
  - In fondo: entrate, uscite e netto del mese (giroconti esclusi, come le tue colonne D/E) e il saldo di chiusura di ogni conto.
  - Filtri: progetto (anche «Untagged»), tipo o categoria, «No Document», «Date Estimated», ricerca testo.
  - Clic su una riga: si apre la scheda da cui viene (la fattura, il costo, il finanziamento o il movimento) e la modifichi lì.
- **Months**: il tuo foglio Verifica. Per ogni mese: entrate, uscite, netto e saldo finale di ogni conto. Sotto, una riga: «Administrator pay recorded this year € x (net) — the Plan assumes € y gross».
- **Projects**: Via Esempio, Consulting e Untagged, con entrate, costi e risultato per il mese o per l'anno. Depositi ricevuti e caparra stanno accanto, mai dentro il risultato.
- **Owed & Held**: chi deve cosa a chi.
  - Fatture clienti aperte.
  - Fatture fornitori: totale, pagato, residuo, e il pulsante **Pay** che apre Add Movement già compilato.
  - Depositi per inquilino o stanza (da restituire) e caparra al proprietario (da riavere).
  - Quanto la società ti deve, diviso in finanziamenti e carta personale.
- **To Chase**: le cose da sistemare.
  - Costi pagati senza documento (la tua «fattura assente / da recuperare»).
  - Date stimate da correggere (correggere la data toglie la «~»).
  - Fatture segnate pagate ma senza conto.
  - Un conto che va sotto zero in un certo giorno (in banca è impossibile, quindi è un errore di registrazione).
  - Righe datate prima dell'apertura di un conto.

### 2.2 Le modifiche ad altre pagine

- **Invoices › Mark Paid** (lo stesso pulsante compare anche in Deadlines): nuovo campo **Into Account** (Bank A, Bank B, oppure «Offset, No Bank Payment» per chiudere una fattura con la sua nota di credito senza soldi), e **Amount Received**. Se arriva un po' meno (fino a 50 €), l'app registra la differenza come commissione bancaria. Anche la scheda della fattura ha il conto accanto alla data di pagamento.
- **Costs**: il modulo del costo ha **Paid From** (un conto, «Owner's Personal Card», oppure «Not Paid Yet» per una fattura fornitore da pagare), **VAT**, **Document**, **Project**, **Pays Recurring Cost** (quale stima mensile sostituisce) e **Refund** (per un rimborso ricevuto). Le stime ricorrenti hanno **Record Payment**.
- **Costs › Loans**: i pulsanti con il prompt diventano una finestra con data, importo, conto e descrizione: **Lend to SRL** e **Repay Shareholder Loan**. La parola «Withdrawal» sparisce.
- **Plan**: compare la riga **Other Income** (affitti delle stanze, contributi spese), che entra nella stima IRES/IRAP.

### 2.3 Add Movement, la finestra di tutti i giorni

1. Scegli **Out**, **In** o **Transfer**.
2. Importo, descrizione, conto (ricorda l'ultimo usato), data (oggi), tipo.
   - Out: _Cost_, _Supplier Invoice Payment_, _VAT (F24)_, _Tax (F24)_, _Administrator Pay_, _Deposit Returned_, _Deposit Paid (caparra)_, _Shareholder Loan Repayment_.
   - In: _Client Invoice Payment_, _Rent & Other Income_, _Client Payment Without Invoice_, _Deposit Received_, _Deposit Refunded_, _Shareholder Loan_, _Share Capital_, _Refund_.
   - Transfer: da quale conto a quale.
3. Progetto, documento, note; per i depositi chi è (anche solo «Stanza 2»).
4. **Save** oppure **Save & Add Another**, che tiene data e conto: comodo per un bonifico che va diviso in più righe (affitto + contributo + deposito, oppure le righe di un F24).

Ogni tipo finisce nel suo posto: _Cost_ diventa un costo nella pagina Costs, _Client Invoice Payment_ segna pagata la fattura, i tipi _Shareholder Loan_ diventano un finanziamento, tutto il resto è un movimento. Tu vedi una sola finestra.

### 2.4 La routine

- **Ogni giorno, pochi secondi**: una riga con Add Movement o in chat.
- **Ogni mese, pochi minuti**:
  1. **Check Balance**: scrivi il saldo dell'estratto conto di ogni conto.
  2. Se non torna, l'app ti dice quanto manca e ti mostra le righe dall'ultimo controllo.
  3. Svuota **To Chase**.
  4. Guarda **Owed & Held** e il **Plan**.
  5. **Export CSV** per il commercialista.
- **Una volta sola**: l'import dell'Excel (§4).

### 2.5 In chat

| Dici                                                                           | Cosa fa l'app                                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| «pagato 1.850 affitto Via Esempio da Bank B il 5/10»                           | Un costo _rent_ da Bank B il 05/10, progetto Via Esempio, che sostituisce la stima mensile dell'affitto per ottobre. Risponde con il nuovo saldo di Bank B. |
| «giroconto 2.500 da Bank A a Bank B»                                           | Un giroconto: Bank A −2.500, Bank B +2.500, né entrata né uscita.                                                                                           |
| «incassato affitto Stanza 2, 650 su Bank B»                                    | Un'entrata _Rent & Other Income_ Via Esempio; conta anche nel Piano.                                                                                        |
| «la Stanza 3 ha versato 900 di deposito cauzionale su Bank B»                  | Un deposito da restituire, intestato «Stanza 3».                                                                                                            |
| «Alfa ha pagato la fattura 15/2026 su Bank A il 5/11»                          | Segna pagata la fattura, con il conto. Se gli dici l'importo ricevuto e manca poco, registra la commissione.                                                |
| «ho comprato un frigo da 480 con la carta personale per Via Esempio»           | Un costo pagato da te: nessun movimento sul conto, la società ti deve 480 in più.                                                                           |
| «ho prestato 5.000 alla società su Bank A» / «la società mi ha rimborsato 480» | Un finanziamento soci, o un suo rimborso. Mai un «prelievo».                                                                                                |
| «Bank A oggi <saldo Bank A del foglio Saldo>»                                  | Salva il saldo della banca e risponde «matches» oppure quanto manca.                                                                                        |
| «quanto ho in banca?», «com'è andato ottobre?», «prima nota di settembre»      | Saldi, entrate e uscite del mese, IVA da versare, depositi, debiti e crediti.                                                                               |

I conti sono sempre quelli **della società**: le risposte dicono «company account», così una spesa personale non finisce per sbaglio nella prima nota (e viceversa).

## 3. Esempi

Nomi e importi sono inventati; i tipi di movimento sono quelli del tuo Excel.

**Esempio 1 — Cliente italiano con IVA.** Emetti a _Alfa S.p.A._ la fattura 15/2026: 9 giorni × 900 € = 8.100 € + IVA 22% 1.782 € = 9.882 €.

- Finché non paga: _Clients Owe You_ 9.882 €, e _VAT on unpaid invoices_ 1.782 € (quell'IVA la devi versare comunque alla scadenza).
- Il 5/11 arrivano 9.882 € su Bank A: Invoices › Mark Paid, Into Account _Bank A_.
- Cash Book: una riga +9.882 € su Bank A, progetto Consulting. _VAT Not Yet Paid_ sale di 1.782 € e _Available_ non li conta.
- Piano: nessun cambiamento. Il ricavo c'era già (giorni × tariffa del contratto); un incasso non è un ricavo nuovo.

**Esempio 2 — Cliente estero che paga un po' meno.** Fattura 16/2026 a _Northwind Ltd_: 7.650 €, senza IVA (art. 7-ter). Su Bank A arrivano 7.625 €: la banca intermediaria ha trattenuto 25 €.

- Mark Paid: Into Account _Bank A_, Amount Received 7.625.
- L'app segna la fattura pagata (per intero: il cliente non ti deve più nulla) e registra un costo _Bank fee_ di 25 € lo stesso giorno, dallo stesso conto.
- Saldo Bank A: +7.625 €, esattamente come in banca. I 25 € sono un costo deducibile nel Piano. Niente IVA da accantonare.

**Esempio 3 — Fattura fornitore pagata in due rate.** _Edil Rossi_ ti fattura 12.000 € di lavori per Via Esempio (FPR 40/26).

- Costs › nuovo costo, Paid From _Not Paid Yet_, Document «FPR 40/26», progetto Via Esempio, VAT 0 (l'affitto delle stanze è esente, quindi l'IVA non si recupera e resta dentro il costo).
- Il 10/10 paghi 5.000 € da Bank B: Add Movement › _Supplier Invoice Payment_ su FPR 40/26. _You Owe Suppliers_: 7.000 €.
- Il 10/11 paghi 7.000 €: residuo 0, la fattura sparisce da Owed & Held.
- Piano: il costo conta una volta sola, 12.000 € alla data della fattura. Le due rate sono solo cassa.

**Esempio 4 — Un inquilino paga affitto, spese e deposito insieme.** La _Stanza 2_ fa un bonifico di 1.450 € su Bank B il 1/11: 650 € di affitto, 100 € di contributo spese, 700 € di deposito cauzionale.

- Tre righe con lo stesso giorno e conto (Save & Add Another): _Rent & Other Income_ 650 €, _Rent & Other Income_ 100 €, _Deposit Received_ 700 € per «Stanza 2».
- Bank B +1.450 €, come in banca. Via Esempio: entrate +750 €. _Deposits to Give Back_: +700 €. Piano: +750 € di _Other Income_.
- Quando l'inquilino se ne va, restituisci 600 € e ne trattieni 100 € per un danno: _Deposit Returned_ 600 € da Bank B; poi, per i 100 € trattenuti, _Deposit Returned_ 100 € e _Rent & Other Income_ 100 € lo stesso giorno (le due righe si annullano in banca). Il deposito della Stanza 2 torna a 0 e i 100 € diventano un'entrata.

**Esempio 5 — Acquisto con la carta personale e poi il rimborso.** Compri un frigorifero da 480 € per Via Esempio con la tua carta.

- Costs › Paid From _Owner's Personal Card_, progetto Via Esempio.
- È un costo della società nel Piano, ma nessun conto della società si muove. _SRL Owes You_: +480 €.
- A fine mese la società ti restituisce 480 € da Bank A: Costs › Loans › _Repay Shareholder Loan_ (oppure in chat «la società mi ha rimborsato 480»). Bank A −480 €, _SRL Owes You_ torna a prima. È il rimborso di un debito verso di te, non un prelievo, e non è un secondo costo.
- Se un giorno la società ti restituisse più di quanto ti deve, l'app lo segnala: in una SRL quei soldi non hanno una causa e il commercialista li considererebbe un rischio.

**Esempio 6 — Giroconto tra Bank A e Bank B.** Sposti 2.500 € da Bank A a Bank B per pagare l'affitto.

- Add Movement › _Transfer_, da Bank A a Bank B.
- Una sola riga, grigia: Bank A −2.500 €, Bank B +2.500 €. Non è un'entrata né un'uscita, non ha un progetto, non tocca il Piano, e il totale dei conti non cambia (come nel tuo Excel, dove D/E sono vuote).

**Esempio 7 — Un F24.** Il 16/11 paghi da Bank A un F24 di 2.402 €: 2.200 € di IVA del trimestre, 2 € di imposta di bollo e 200 € di ritenuta d'acconto sulla fattura dell'architetto.

- Tre righe, stesso giorno e conto:
  - _VAT (F24)_ 2.200 €: _VAT Not Yet Paid_ scende di 2.200 €.
  - _Cost_ «Imposta di bollo» 2 €, documento «F24 16/11»: è un vero costo deducibile.
  - _Supplier Invoice Payment_ 200 € sulla fattura dell'architetto, registrata al lordo: l'architetto ha ricevuto il netto con un bonifico, la ritenuta la paghi tu con l'F24, e il residuo della sua fattura arriva a 0.
- Bank A −2.402 €, come in banca. Il calendario F24 del Piano resta una stima e non cambia (§6).

## 4. Il tuo Excel nell'app

L'import si fa una volta sola, dalla pagina Cash Book › **Import Excel**. Il file resta nel tuo browser: non viene caricato su nessun server e l'app non ne tiene una copia.

**Passo 1 — Riconoscimento.** L'app cerca il foglio _Saldo_, i fogli con il nome di un mese (Maggio … Ottobre) e le 13 colonne, confrontate per nome e non per posizione. _Verifica_ viene ignorato, perché l'app rifà gli stessi conti da sola. Un foglio con un nome sconosciuto, una colonna mancante o il Saldo assente fermano tutto con un messaggio che dice quale foglio e quale colonna: l'app non indovina mai. Le righe completamente vuote si saltano. Le due righe con tutti gli importi vuoti («movimento rimosso / sostituito») finiscono nel report.

**Passo 2 — Conti.** Dalle colonne _Entrata/Uscita Bank A_ e _Entrata/Uscita Bank B_ e dal foglio Saldo l'app prepara _Bank A_ e _Bank B_, con saldo iniziale 0 al 1/5/2026. Se hai già creato i due conti a mano e sono vuoti, li usa (abbinati per nome). La colonna _di Cassa_ (D/E) non è un conto: è il totale della società e serve solo come controllo (D = F+H, E = G+I, altrimenti la riga viene rifiutata e mostrata). L'import non crea né tocca una cassa.

**Passo 3 — Date.** L'Excel non ha una colonna data, quindi per ogni riga:

1. la data della banca scritta nelle note («Bonifico del 05/10», «Addebito del …»), anche se cade in un altro mese (succede una volta: una riga di agosto addebitata il 1° settembre);
2. altrimenti la data della fattura nella nota, solo se cade nel mese del foglio;
3. altrimenti il 1° del mese, segnata come **data stimata** («~» nella lista, filtro _Date Estimated_). Sono la maggior parte delle righe. Mai l'ultimo giorno del mese: due righe di ottobre finirebbero dopo il 07/10 e il saldo non tornerebbe più.

L'anno viene dalla data del Saldo; un foglio di un mese successivo a quello del Saldo appartiene all'anno prima (serve quando un file va da dicembre a gennaio). Quando correggi una data stimata, la «~» sparisce da sola.

**Passo 4 — Ogni riga al suo posto.**

- _Incasso fattura N/2026_ → la fattura dell'app con lo stesso numero, segnata pagata con data e conto. Se una riga cita più fatture, le segna tutte, stessa data e conto. Se è arrivato un po' meno e l'importo nell'Excel è uguale al totale nell'app, la differenza diventa una commissione bancaria.
- _Finanziamento Soci_ → finanziamento soci; _Prelievo / Rimborso Finanziamento Soci_ e i rimborsi a te per la carta personale → rimborso del finanziamento. Il rimborso fatto per errore e la sua correzione si importano tutti e due, come sono avvenuti in banca.
- _Restituzione Deposito Capitale_ → capitale sociale (non è un ricavo né un finanziamento).
- Pagamenti a fornitori → costi con conto, documento (colonna C), progetto e categoria proposta dalla descrizione (fornitori di software → software, commercialista → accountant, voli e taxi → travel, …; in caso di dubbio _other_).
- Una fattura fornitore in colonna K → una fattura da pagare (_Not Paid Yet_); il pagamento con lo stesso numero e lo stesso fornitore diventa una sua rata, e l'app mostra il residuo. Le note di credito che la annullano vengono compensate; una fattura annullata del tutto non viene creata (è nel report).
- _carta personale_ in colonna K → costo pagato da te; la società ti deve quell'importo.
- _Caparra_ → caparra da riavere; _deposito cauzionale_ → deposito da restituire, intestato con il nome proposto dalla descrizione, che puoi sostituire con «Stanza 2».
- Affitti e contributi spese degli inquilini → entrate Via Esempio; l'affitto al proprietario → costo _rent_ Via Esempio.
- Rimborsi dai negozi («(rimborso)») → costo negativo; i giroconti → giroconti.
- _Emessa fattura_ e _Nota di credito_ → nessuna scrittura di cassa: servono a controllare le fatture dell'app (vedi passo 5).
- Progetto: colonna M = X → Via Esempio; inquilini, depositi e affitto al proprietario → Via Esempio anche senza X; incassi dei clienti → Consulting; giroconti e finanziamenti mai.

**Passo 5 — Excel e fatture dell'app.** Regola: **l'Excel vince sui fatti di cassa** (conto, data vera della banca), **l'app vince sui documenti** (numero, cliente, importo, IVA).

- Pagata nell'Excel, non pagata nell'app → l'app la segna pagata.
- Pagata in tutti e due ma in date diverse → se la data dell'Excel è vera vince l'Excel, se è stimata resta quella dell'app quando cade nello stesso mese; vedi le due date.
- Pagata nell'app senza incasso nell'Excel → te la mostra: _Mark Unpaid_ oppure _Keep as Non-Cash_. L'app non inventa mai un movimento di cassa.
- Incasso senza fattura nell'app → scegli _Create Invoice_ (precompilata) oppure _Client Payment, No Invoice_.
- Fatture annullate da una nota di credito (anche le catene di riemissioni) → vengono chiuse con la nota di credito, senza soldi e senza conto, così non restano «Overdue» e non disturbano il Mark Paid della fattura riemessa. Un'annullata senza nota di credito nell'app viene segnalata. Un numero mancante nella sequenza viene segnalato.
- Incassi tramite piattaforma freelance → secondo la decisione 1 (§9).

**Passo 6 — Le righe che decidi tu.** Tutte in una lista prima di scrivere qualsiasi cosa: il bonifico con affitto + deposito + contributo senza divisione, gli affitti con una parte di spese, l'affitto decurtato di un rimborso, un affitto senza nota, l'accredito da verificare, il capitale, il rimborso per errore e la correzione, gli incassi tramite piattaforma, la fattura pagata meno, la fattura senza cliente, le note di credito senza numero, la nota di credito diventata buono, i rimborsi agli inquilini, la riga con la data del mese dopo. Per una riga mista scrivi le parti, anche negative (affitto +, rimborso −): devono sommare all'importo della banca.

**Passo 7 — Quello che c'è già nell'app.**

- Costi una tantum e finanziamenti già presenti che somigliano a una riga dell'Excel (stesso importo, entro un mese) → te li mostra in coppia; cosa fare di default lo decidi tu (decisione 2).
- Le stime ricorrenti (abbonamenti software, donazione, commercialista, affitto) → l'app propone a quale stima collegare ogni gruppo di pagamenti (per esempio più pagamenti allo stesso fornitore → la sua stima), e ti propone di spostare l'inizio della stima al 1/5/2026 e di metterle l'IVA giusta (0 per affitto, donazione e reverse charge).

**Passo 8 — Il controllo, prima di scrivere.** L'app rifà i conti del foglio Verifica sullo stato che l'import produrrebbe:

- saldo al 07/10/2026 **Bank A <saldo Bank A del foglio Saldo>** e **Bank B <saldo Bank B del foglio Saldo>**, al centesimo;
- per ogni foglio, entrate − uscite di ogni conto uguali a quelle del foglio;
- la somma di D − E uguale alla somma dei saldi.

Se qualcosa non torna, vedi «Bank B: missing IN of € x» e il pulsante **Import** resta spento. Se non torna solo perché hai aggiunto righe dopo il 07/10, l'app te lo dice: aggiorna il foglio Saldo con il saldo di oggi e riprova.

**Passo 9 — Import.** Pochi secondi, con una barra di avanzamento. Alla fine entrambi i conti dicono «Matches the bank on 07/10/2026» e resta il report: date stimate, documenti mancanti, note per il commercialista (reverse charge, IVA, ristrutturazione, donazione), fatture annullate e numerazione.

**Due volte? No.** Se l'import c'è già, il pulsante non lo rifà e offre **Undo Import**, anche dopo un ricaricamento della pagina o un errore a metà. Undo cancella solo quello che l'import ha creato. Le righe importate che hai modificato dopo te le elenca e le tiene, a meno che tu non confermi. Le date di pagamento delle fatture restano (l'Excel le prova), il conto viene tolto. Poi puoi reimportare.

**Dopo.** L'Excel va in pensione alla data del Saldo: quello che succede dopo lo scrivi nell'app. Una seconda importazione di un altro file non è prevista.

**E la pagina Costs?**

- I costi importati compaiono nella pagina Costs con la colonna _Paid From_ (Bank A, Bank B, carta personale, _Not Paid Yet_). Sono le stesse righe che il Cash Book legge: un costo, una riga.
- Le stime ricorrenti restano per i mesi futuri. Nei mesi in cui c'è un pagamento collegato, la stima non conta più: niente doppio conteggio, né nel Piano né nel riquadro _Annualized_.
- L'IVA dei costi importati è 0, perché l'Excel non la separa. Il Piano non chiede crediti IVA su questi costi (prudente) e li deduce al lordo. Quando il commercialista ti dà l'IVA delle fatture grandi, la puoi dividere riga per riga.
- Il tuo affitto e i costi della casa entrano nel Piano solo insieme agli affitti delle stanze: per questo la riga _Other Income_ del Piano arriva prima dell'import (§7).

## 5. IVA, depositi, finanziamenti, progetti

### IVA

- **Sulle tue fatture.** L'IVA che i clienti italiani ti pagano (22%) non è tua: appena incassi finisce in _VAT Not Yet Paid_ e viene tolta da _Available_. Quando paghi l'F24 dell'IVA (tipo _VAT (F24)_), scende.
- **IVA su fatture non incassate.** Per le fatture normali tra aziende l'IVA si deve alla scadenza anche se il cliente non ha ancora pagato. L'app la mostra a parte (_VAT on unpaid invoices_), così sai che il prossimo F24 può essere più alto di quanto hai incassato.
- **Clienti esteri (art. 7-ter).** IVA 0: niente da accantonare.
- **Sui costi.** Il campo _VAT_ contiene solo l'IVA che **recuperi**. Va a 0 per il reverse charge (acquisti da fornitori esteri), per la donazione, per il tuo affitto e per i costi della casa di Via Esempio: l'affitto delle stanze è esente, quindi l'IVA di quei costi non si recupera e resta dentro il costo.
- **Nel Piano.** La stima dell'F24 IVA usa l'IVA vera dei costi. I costi vecchi senza IVA indicata continuano a valere il 22%, come oggi, quindi i tuoi numeri attuali non cambiano finché non tocchi quelle righe.
- È sempre una stima: la liquidazione vera la fa il commercialista.

### Depositi

- **Deposito cauzionale ricevuto da un inquilino** = soldi da restituire, cioè un debito. Non è un'entrata, non entra nel Piano e non entra nel risultato di Via Esempio. Lo vedi in _Deposits to Give Back_, diviso per inquilino o stanza.
- **Caparra pagata al proprietario** = soldi da riavere, cioè un credito. Sta a parte e non si somma alla cassa disponibile; quando torna, è _Deposit Refunded_.
- **Restituzione.** Totale: _Deposit Returned_ per l'intero importo. Parziale: restituisci una parte e la parte trattenuta diventa un'entrata (esempio 4).
- Il nome dell'inquilino è facoltativo: puoi scrivere «Stanza 2». L'app non crea una scheda per gli inquilini.

### Finanziamenti soci e carta personale

- **Presti alla società** (_Lend to SRL_) → la società ti deve quei soldi.
- **La società ti restituisce** (_Repay Shareholder Loan_) → è il rimborso del finanziamento, mai un «prelievo». In una SRL i soldi verso di te escono solo come compenso, rimborso di un finanziamento, dividendo deliberato o rimborso spese documentate: l'app non ha un tipo «prelievo» e il vecchio pulsante «Withdrawal from SRL» sparisce.
- **Carta personale** → il costo è della società e la società ti deve l'importo. Nessun conto della società si muove finché non ti rimborsa.
- _SRL Owes You_ = finanziamenti − rimborsi + acquisti con la tua carta. La pagina Costs e il Cash Book usano lo stesso calcolo e mostrano lo stesso numero.
- Se il numero diventa negativo (la società ti ha dato più di quanto ti doveva), l'app avvisa nei Costi, nel Cash Book e in chat.
- I finanziamenti non sono né ricavi né costi: il Piano non li vede. Il **capitale sociale** è un'altra cosa e ha il suo tipo, _Share Capital_.

### Progetti

- Un progetto è un'etichetta libera: _Via Esempio_, _Consulting_, o quello che vuoi. Non c'è niente da configurare: l'app ti propone le etichette già usate.
- Gli incassi delle fatture contano sempre in _Consulting_. Tutto ciò che non ha etichetta finisce in _Untagged_.
- Per ogni progetto:
  - **entrate**: affitti, contributi, altri incassi con quell'etichetta;
  - **costi**: anche quelli pagati con la tua carta e le fatture fornitori, contate alla loro data;
  - **risultato**: entrate − costi.
- Fuori dal risultato: depositi e caparra (accanto), giroconti, finanziamenti, tasse, e le rate dei fornitori (il costo è già la fattura).
- **Nel Piano**: gli affitti e i contributi delle stanze entrano come _Other Income_, senza IVA, nella stima di IRES e IRAP. I soldi dei clienti di consulenza no, perché il Piano li conta già da giorni × tariffa dei contratti. Per lo stesso motivo un incasso tramite piattaforma senza fattura (_Client Payment Without Invoice_) non entra nel Piano.

## 6. Cosa NON fa

- **Non è la contabilità del commercialista.** Non è il libro giornale, né il libro inventari, né i registri IVA. È il tuo strumento di gestione, e la pagina e l'export lo dicono chiaramente. Le fatture ufficiali restano nel software di fatturazione elettronica e nello SDI.
- **Non calcola né paga le tasse.** Niente F24 generati, niente dichiarazioni. Le cifre del Piano restano stime.
- **Non confronta il calendario F24 con i pagamenti veri.** Come oggi, il calendario dà per pagati gli F24 con la data passata. Gli F24 che paghi li vedi nella prima nota, ma l'app non dice ancora «questo F24 manca». Farlo oggi riempirebbe il calendario di falsi allarmi (acconti che una società al primo anno non deve, ritenute su un compenso mai pagato).
- **Non ha un «prelievo del socio»** (§5).
- **Non legge l'estratto conto della banca.** L'import dei movimenti bancari è un passo successivo; per ora si scrive a mano, dal web o in chat.
- **Non modifica e non cancella dalla chat.** In chat aggiungi e consulti; correzioni e cancellazioni si fanno dal web, dove vedi cosa stai toccando.
- **Non gestisce:**
  - altre valute oltre l'euro;
  - pagamenti parziali di una fattura cliente (una differenza piccola diventa commissione, una grande la sistemi tu);
  - conti chiusi o archiviati (nessuno lo è oggi);
  - una seconda importazione di un altro Excel.
- **Non decide le regole fiscali**: la deducibilità della ristrutturazione e della donazione, l'IVA dei ricavi, il bollo da 2 € sulle fatture senza IVA. Le righe interessate sono segnalate nel report per il commercialista.
- **Al commercialista dai l'Export CSV** al posto dell'Excel:
  - una riga per movimento: data, conto, entrata o uscita, IVA, documento, progetto, note e segnalazioni;
  - pronto per Excel italiano: separatore «;», virgola decimale, date gg/mm/aaaa;
  - in fondo l'avviso che non è un libro contabile.

  Arriva insieme alla pagina Cash Book, quindi prima che tu mandi in pensione l'Excel.

- **Domande da fare al commercialista** (l'app non le risolve):
  1. L'architetto e il commercialista applicano la ritenuta d'acconto? Se sì, va pagata con F24.
  2. C'era qualche F24 da pagare prima del 07/10?
  3. Gli affitti delle stanze e i contributi spese vanno fatturati?
  4. La ristrutturazione di Via Esempio si deduce subito o si ripartisce sulla durata della locazione?
  5. La donazione mensile è deducibile, e fino a che punto?
  6. Il compenso da amministratore: da quando e quanto?

## 7. Ordine di costruzione

Sei PR in pila, ognuna rilasciabile da sola, ognuna su un branch `feat/…` da `main` (retarget prima di fare merge della base). Gate per ogni PR: `pnpm test --run` + `pnpm lint`; più `pnpm test:firebase:docker` per le PR che toccano backend, regole o MCP (1, 2, 4, 6). Taglie: **S** < 10 file, **M** 10–25 file, **L** > 25 file o > 1.000 righe.

### PR 1 — I dati: conti e movimenti · `feat(crm): company accounts and movements (cash book 1/6)` · **M**

- Details: `CompanyAccount` and `CompanyMovement` (types, zod, `CrmAdapter`, mock with zod-parsing create/update and `__resetMockState`, Firebase client), `Invoice.paidAccountId` through types/zod/rules/three adapters, `crm.rules` blocks + `pnpm rules:build`, `CRM_COLLECTIONS`, rules emulator tests, adapter-contract sections, `use-company-accounts` / `use-company-movements`, a new `src/lib/cash-book.ts` holding only the guard constants for now (with its boundary entries), the `ACCOUNT_HAS_ENTRIES` delete guard over movements and invoices, and the CI path-filter fix (`firestore/**`, `firebaseadmin.crm.test.ts`).
- **Dopo questa PR**: niente di visibile. Nessun cambiamento di comportamento; è la base.

### PR 2 — La pagina Cash Book · `feat(cash-book): Cash Book page with accounts, movements and invoice payments (2/6)` · **L**

- Details: `src/lib/cash-book.ts` over invoices + movements; `/cash-book` page and nav entry; account cards with the statement check; tabs Movements (month sheet, end-of-day balance), Months and To Chase; the Accounts and Check Balance dialogs; Add Movement for every movement kind (Out/In/Transfer, Save & Add Another, remembered account); Mark Paid gains Into Account + Amount Received (bank fee) and the credit-note offset rule, so Invoices and Deadlines both get it; the invoice sheet gets the account select; `CLIENT_HAS_CASH`; Export CSV; boundary/nav/loading-states edits; e2e.
- **Dopo questa PR**: crei Bank A e Bank B con il saldo iniziale e registri giroconti, affitti delle stanze, depositi, caparra, F24, compenso e capitale. Segni le fatture pagate _su un conto_, controlli il saldo con la banca ed esporti il CSV. I costi non ci sono ancora: per ora restano nella pagina Costs come oggi.
- **As shipped** (differences from the design above, for PRs 3–6):
  - `CompanyExpense.accountId` (null | string, guarded in `crm.rules` on create and update, mapped to `null` when absent) arrived here, not in PR 4: the short-payment bank fee is a `bank_fees` cost on the account, and without the field the balance would miss it. `ACCOUNT_HAS_ENTRIES` counts costs too. PR 4 adds the other cost fields and the cross-field constraints (recurring rows carry no account, and the rest).
  - `cashRows` reads invoices, costs with an account and movements; loans join in PR 4. Rows sort by day, then creation: `importOrder` waits for the import (PR 5).
  - `vatPosition.notYetPaid` leaves costs' VAT out until costs carry `vat` (PR 4). The tiles are Total, Available, VAT Not Yet Paid (with VAT on unpaid invoices), Deposits to Give Back (with the deposits paid, to get back) and Clients Owe You; You Owe Suppliers and SRL Owes You come with PR 4.
  - Add Movement offers the kinds that are movements, plus Client Invoice Payment (Mark Paid inside the dialog). Cost, Supplier Invoice Payment, Shareholder Loan, its repayment and Refund come with PR 4.
  - Mark Paid states the bank fee (up to `MAX_BANK_FEE`, €50) instead of a checkbox: unticked, the book would be off by the fee. Without any account it is the form of before.
  - The account chips filter Movements, Months, To Chase and the CSV; the cards and tiles stay company-wide.
  - The CSV notice is English only ("not a statutory accounting book or VAT register"), per the app's language rule.
  - No global mock seed: specs and screenshots seed synthetic data through `window.__mockBackend`, like the other CRM specs.
  - `openingBalance` is the start of `openingDate` (the previous day's closing on the statement), and the Accounts dialog says so. An account is absent from `balancesAt` before its opening day; a month sheet opens at the start of the 1st and lists the accounts that open later in the month (`opened`).
  - A deposit row dated before its account opened is how a deposit already held when the book began is recorded: counted by `deposits()`, not in the balance, never in To Chase. `deposits()` drops a group below 0, so a deposit returned with no receipt never raises Available; Add Movement warns as it is typed.
  - The CSV opens each account with an Opening Balance line, writes numbers and dates without the formula guard (a credit note's VAT stays `-22,00`), and the menu item reads Export All Months (CSV). A credit note is typed Credit Note; its description says "deducted from invoice N" when its customer's invoice was paid into the same account that day.
  - The current month's totals read "Balance so far, <today>", and Months marks it "(so far)". On a phone Months is one card per month with every account's balance.

### PR 3 — Gli affitti nel Piano · `feat(plan): non-contract income in the projection (3/6)` · **S**

- Details: `ProjectionInput.otherIncome` from `income` movements only (`client_income` excluded); a trailing `otherRevenue = 0` on `calculateMonthlyTax` that adds to `totalGrossRevenue` with no VAT; `MonthlyTaxBreakdown.otherRevenue`; plan-shell, deadlines-shell and salary-shell pass it; an Other Income row in the Plan; snapshot test that no movements means identical numbers.
- **Dopo questa PR**: gli affitti e i contributi che registri alzano la stima di IRES/IRAP e degli acconti. Deve arrivare **prima** dell'import, altrimenti i costi della casa ridurrebbero le tasse stimate senza i suoi ricavi.

### PR 4 — Un costo, una riga · `feat(costs): one entry feeds both, costs and loans in the Cash Book (4/6)` · **L**

- Details: the new `CompanyExpense` fields (accountId, paidByOwner, vat, documentRef, project, recurringExpenseId, dateEstimated, importRef) and `CompanyLoan` fields (accountId, dateEstimated, importRef) with zod and rules, closing today's update-rule gaps; `updateCompanyLoanSchema`; `estimateCovered` and the per-month VAT credit in projection; `vatCreditOnExpenses` preferred by the VAT calendar; the shared Cost fields in the Costs dialog and in Add Movement (Paid From, VAT, Document, Project, Pays Recurring Cost with the pre-select rule, Refund; Recurring hidden once paid); Record Payment; the dated loan dialog with edit/delete; `ownerLoanBalance` on both pages + negative warning; Owed & Held and Projects tabs; `BILL_HAS_PAYMENTS`, and `ACCOUNT_HAS_ENTRIES` extended to expenses and loans; the remaining tiles; e2e for a personal-card cost.
- **Dopo questa PR**: un costo pagato da un conto, dalla tua carta o ancora da pagare compare una volta sola, sia nella prima nota sia nel Piano. Le stime ricorrenti si «spengono» nei mesi pagati. Registri le fatture fornitori e le loro rate, vedi cosa devi e cosa ti devono, i finanziamenti hanno data e conto, e i progetti hanno i loro totali. Da qui la prima nota è completa a mano.
- **As shipped, PRs 3 and 4 together** (one PR, with the owner's requests of 2026-10-08: every income and cost in the book, by cost centre and by account, and an export for the accountant):
  - The plan's "project" is a **Cost Centre** in every screen, filter and CSV header; the stored field stays `project`, so nothing migrates. The Projects tab is the **Cost Centres** tab: per month or year, the account chip respected (under one account, only what went through it: no card costs, no supplier invoices), the result written "Gain €x" / "Loss €x", deposits beside it, loans in a line below.
  - Add Movement's Cost takes the bank amount with the VAT inside it ("Of Which VAT") and stores amount − VAT; the Costs form takes the amount net of VAT with the VAT on top and shows the total paid. Both say the outcome before saving.
  - A recurring estimate is made with **Add Recurring Cost**; the Recurring switch shows only for a cost Not Paid Yet with no estimate link. Record Payment opens the form linked to the estimate, from the remembered account.
  - The loan dialog's submit reads Record Loan / Record Repayment, the direction toggle Lend to SRL / Repay Shareholder Loan.
  - **Export** is a dialog (this month, a month, a year, a date range; an account; a cost centre). The rows carry no Opening Balance line any more: each account's balance at the start, In, Out and the balance at the end are a summary block after the rows, then one per cost centre, then the costs no account paid (card, supplier invoices).
  - To Chase lists a cost paid from an account or by card with no document (bank fees excepted). Owed & Held is company-wide, whatever the chip.
  - The VAT calendar takes `vatCreditOnExpenses` only when some counted cost states its VAT, so costs written before keep the 22% to the cent; a pinned synthetic input proves the Plan unchanged with no movements.
  - Still no global mock seed: `e2e/helpers/cash-book-seed.ts` fills a synthetic book for the specs and the screenshots.

### PR 5 — L'import dell'Excel · `feat(cash-book): import the prima nota workbook (5/6)` · **L**

- Details: `src/lib/xlsx.ts` (zero-dependency reader), `src/lib/prima-nota.ts` (detection, dates, classification, invoice reconciliation, split rows, pre-check, acceptance check, plan of writes), the import dialog (preview, review list, overlaps and estimate links, blocking check, sequential commit with progress, Undo Import), the synthetic workbook builder, unit + e2e tests, and the CLAUDE.md language exception for the parser's Italian keywords. Needs PRs 1–4.
- **Dopo questa PR**: importi l'Excel, decidi le righe in sospeso, vedi «Matches the bank» su Bank A (<saldo Bank A del foglio Saldo>) e Bank B (<saldo Bank B del foglio Saldo>) e mandi in pensione l'Excel.
- **As shipped**:
  - `lib/xlsx.ts` reads the XML with a small tokenizer instead of `DOMParser`, so it runs the same in browsers, happy-dom and Node; formulas are read by their cached value.
  - The accounts are named after the `Entrata <X>` / `Uscita <X>` headers and matched to a Saldo row and to an empty company account by name prefix, either way round; the cost centre comes from the `Spesa per Casa …` header. Nothing in the code names a real bank, address or supplier.
  - The preview says what Import will do in one sentence, then the rows per sheet and per account and the records per kind, split into Written to the App and Checked or Reported, Not Written. The review list has Accept All Suggestions; a split is a list of signed parts that must sum to the bank amount.
  - Platform payouts (decision 1): an invoice at the gross with column C as its number, paid, plus a Platform commission cost (reverse charge, VAT 0); the gross is read from the note's commission when it states one, otherwise typed. Overlaps (decision 2) default to Replace With the Workbook's.
  - Same-day rows sort by their workbook row (`importOrder` in `lib/cash-book.ts`), so a day reads as the sheet did.
  - The report downloads as a `.txt` file. Undo Import also keeps an account it created while rows typed by hand still use it, and says so; an account of yours the import used keeps its new opening and statement.
  - The e2e is `e2e/cash-book-import.spec.ts`: the invoices the synthetic workbook receives are seeded through `window.__mockBackend`, so the receipts are covered too.
  - The replaced Costs and Loans rows are deleted last, after every record is written, and when there are any the report (their data included) downloads before the first write. Download Report is also on the preview, and leads the closing screen. Every record is checked against the create schemas before Import turns on, so the backend never refuses one halfway.
  - A platform payout whose number is already in the app (typed, or left paid with no account by an Undo) is suggested as that invoice marked paid: no second invoice with the same number. A month sheet after the Saldo month is refused, naming it; only a December to January file reads it as the year before.
  - Overlaps pair only rows with no account (a cash box's are never touched), and a card cost only with a card cost; Replace keeps the app's day when the workbook has none in that month. Estimates no word links get one unticked card (for "other", the payments over two months or more nearest the estimate's amount).
  - Undo clears the account only on invoices changed while the import ran (up to 10 minutes after its last record), so one you mark paid later keeps it; it lists them by number and says what stays as the import left it (invoices it created, settled or marked unpaid, recurring-cost start and VAT), whose previous values are in the report. Closing the dialog with decisions taken asks first; Change File keeps the decisions of the rows that read the same.
  - Checked on the owner's workbook outside the repo: both banks match the Saldo sheet to the cent, and importing again after Undo creates no duplicate invoice. Only synthetic data is in the repository.

### PR 6 — La chat · `feat(mcp): cash book by chat, server 0.20.0 (6/6)` · **M**

- Details: firebase-admin functions + `ServerDb` picks + `settleInvoicePayment` batch; `get_cash_book`, `add_movement`, `add_expense`, `record_loan`, `check_balance`; `account` and `received` on `mark_invoice_paid`; `resolveCompanyAccount`; duplicate guard with `force`; "personal" wording on the personal tools; `WRITE_TOOLS` 22 → 26; version 0.19.0 → 0.20.0 in two places; README tool count 43 → 50; emulator tests.
- **Dopo questa PR**: scrivi e chiedi in chat («pagato 1.850 affitto Via Esempio da Bank B il 5/10», «quanto ho in banca?», «Bank A oggi …»).
- **As shipped**:
  - `get_cash_book` takes `period` (a month `YYYY-MM`, default this month, or a year `YYYY`), `account`, `costCentre` and `limit`, not from/to. A month is its `monthSheet`, a year the months `monthEnds` lists; a transfer is one row with its amount, as on the sheet. The money held (VAT, deposits, what is owed) stays company-wide whatever the filters, as the tiles do.
  - A supplier invoice payment is `add_expense` with `supplierInvoice` (its number or id), never above what is owed; `add_movement` takes every other movement kind. A `documentRef` that is already a supplier invoice is refused with how to pay it, so a payment never becomes a second cost.
  - `add_expense`'s `paidFrom` left out is the only account (asked with two or more, naming `paidFrom`), like every other tool; `"owner"` and `"not_paid"` are said. `category` is required except for a supplier invoice payment: a default guessed from the description hid the estimate the cost pays, and the Plan counted both. An unclear recurring estimate is asked (`paysRecurring`, or `"none"`). `refund` with `supplierInvoice` is refused: paying one is money out.
  - A cost centre typed in chat takes the spelling already in the book, case aside (`costCentreLabel` over `costCentresOf`), and the reply says when it is new. `add_movement` keeps a counterparty only on income and deposits, as Add Movement does.
  - The duplicate guard is the same account, day and signed amount over every row of the book, whatever wrote it and whatever its description: a retried call with new words is still caught. Card costs and unpaid invoices with no account compare day and total.
  - The bank fee is the cost `bank-fee-<invoiceId>`, written in the same batch as the invoice: a fee already booked for it (paid, marked unpaid, paid again) fails the whole write, and the tool says so first, also for a fee the web or the import booked (by its description, `Bank fee on invoice N`). Undoing the payment leaves the fee on Costs, and the description and the reply say so.
  - `received` short while a credit note of the same customer and months is open is refused, naming it: Mark Paid ticks those and adds them to the expected amount, so a deduction never becomes a bank fee. The credit note is marked paid into the same account on the same day, and the invoice without `received`. `paidDate` is checked as a real day (`2026-02-30` is refused, never stored as 2 March).
  - `mark_invoice_paid` with no company account and no `account` or `received` stamps the date alone, as before; once the book has accounts it asks for one, and refuses a day not come yet.
  - A deposit given back under a name the book doesn't hold is refused before anything is written, listing the deposits open, unless `force`: chat cannot fix a row afterwards. Given back beyond what is held under its name, and days before an account opened, are written with the web's warning in the reply. A repayment past what the SRL owes is written and warned.
  - Every tool builds the rows with `bookRows`, the customers' names included, as the page does: without them a credit note read as deducted from another customer's invoice, in `check_balance`'s rows and the duplicate guard's refusal. `cashRows` with no names never says deducted. `get_cash_book` with `costCentre` leaves out the all-centres total, as the export does.
  - The Check Balance dialog's rows and wording moved to `rowsSinceCheck` and `checkDetail` in `lib/cash-book.ts`, shared with `check_balance`; its old note that costs paid from an account "don't show here yet" went with them.
  - the registry test checks the README's tool count against what is served, the "PERSONAL" wording on the personal tools (naming a company tool only "when the company tools are installed", since a personal build serves none), and "company (SRL)" with at most three owner phrasings on the cash book's.

### Dopo, solo se lo decidi (§9)

- Ripartire la ristrutturazione sulla locazione (un campo `spreadMonths`) — **S**.
- Contare nel Piano solo il compenso davvero pagato nei mesi chiusi — **S**.
- Import dell'estratto conto bancario; confronto F24 stimati / pagati — da progettare quando servono.

## 8. Engineering design

Principle (from design A, kept): **each euro fact is stored once, in the record that already owns it; the cash book is a read-time union; balances are never stored; nothing is migrated.** Two new collections hold only what has no home today. Only `CompanyExpense` and the new `income` movements reach `projection.ts`.

### 8.1 Data model

All new fields are optional on read: the three adapters map a missing field to `null` / `false`, as `invoiceClientId` does for `clientId`. No migration.

**`company_accounts` (new) — `CompanyAccount`**

| Field              | Type           | Rule                                                                                       |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------ |
| `name`             | string         | 1–100                                                                                      |
| `openingBalance`   | number         | finite, may be negative; the balance at the start of `openingDate`, before that day's rows |
| `openingDate`      | Date           | rows dated before it are excluded from balances and listed in To Chase                     |
| `statementBalance` | number \| null | last real bank balance checked                                                             |
| `statementDate`    | Date \| null   | set together with `statementBalance`                                                       |
| `importRef`        | string \| null | ≤ 40; set when the import created the account                                              |

No `kind`, no archive. ponytail: a cash account is one named "Cassa"; add archive when an account actually closes (none has).

**`company_movements` (new) — `CompanyMovement`**

| Field           | Type                  | Rule                                                                               |
| --------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `kind`          | `CompanyMovementKind` | see below                                                                          |
| `direction`     | `"in" \| "out"`       | a transfer is always `"out"`: from `accountId` into `toAccountId`                  |
| `amount`        | number                | > 0                                                                                |
| `date`          | Date                  |                                                                                    |
| `accountId`     | string                | ≤ 200                                                                              |
| `toAccountId`   | string \| null        | transfer only, ≠ `accountId`; null otherwise                                       |
| `expenseId`     | string \| null        | `supplier_payment` only (the supplier document); null otherwise                    |
| `description`   | string                | 1–300                                                                              |
| `documentRef`   | string \| null        | ≤ 100                                                                              |
| `project`       | string \| null        | ≤ 60, free label                                                                   |
| `counterparty`  | string \| null        | ≤ 100, free text ("Room 2"); the UI requires it on deposit kinds, the rules do not |
| `notes`         | string \| null        | ≤ 1000                                                                             |
| `dateEstimated` | boolean               | cleared by any date edit                                                           |
| `importRef`     | string \| null        | ≤ 40, `"2026:Luglio!12"`, split parts `"…!12a"`                                    |

| Kind               | Meaning                                                        | Plan                                               |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------- |
| `transfer`         | between own accounts; one document, two legs                   | never                                              |
| `income`           | rent, expense contributions, cashback, a kept deposit share    | **yes**, as `otherIncome` (in − out)               |
| `client_income`    | client money with no app invoice: platform payout, overpayment | never (contracts already count consulting revenue) |
| `deposit_held`     | tenant deposit in / returned out — a liability                 | never                                              |
| `deposit_paid`     | caparra paid out / refunded in — an asset                      | never                                              |
| `capital`          | share capital                                                  | never                                              |
| `vat`              | F24 VAT out, VAT refund in                                     | never                                              |
| `tax`              | every other F24 line that is a tax (IRES, IRAP, INPS, IRPEF)   | never                                              |
| `compensation`     | administrator pay, net                                         | never (already in `yearlyGrossCompensation`)       |
| `supplier_payment` | an instalment on a supplier document                           | never (the document is the cost)                   |

**`Invoice`** gains `paidAccountId: string | null`.

- A paid invoice is a cash row only when `paidDate && paidAccountId`. Paid with no account = a non-cash offset (credit-note settlement) or a legacy row, listed in To Chase.
- **No cross-field rule** between `paidDate` and `paidAccountId`. `deadlines-shell.tsx:155` and `invoice-table.tsx:288` write `{ paidDate: null }` alone, and the Deadlines Undo at :163 restores `paidDate` alone; all keep working. A stale `paidAccountId` on an unpaid invoice is ignored at read time and re-used when the invoice is ticked again.
- No `paidAmount`: a short payment is the invoice at its total plus a `bank_fees` expense (§8.5). ponytail: add `paidAmount` when a real partial client payment appears.

**`CompanyExpense`** gains `accountId: string | null`, `paidByOwner: boolean`, `vat: number | null`, `documentRef: string | null` (≤ 100), `project: string | null` (≤ 60), `recurringExpenseId: string | null`, `dateEstimated: boolean`, `importRef: string | null`.

- `amount` stays the deductible cost, net of **recoverable** VAT. Non-recoverable VAT (the exempt rental, reverse charge) stays inside `amount` with `vat = 0`. Cash out = `amount + (vat ?? 0)`.
- `vat = null` only on legacy rows: the plan keeps today's 22% fallback for them; the cash book reads 0.

| State                      | `isRecurring` | `accountId` | `paidByOwner` | `documentRef` | Cash row                                   | Plan cost                                      |
| -------------------------- | ------------- | ----------- | ------------- | ------------- | ------------------------------------------ | ---------------------------------------------- |
| Estimate                   | true          | null        | false         | any           | none                                       | `amount/every` per month, skipped when covered |
| Paid cost                  | false         | set         | false         | any           | −(amount + vat)                            | at `date`                                      |
| Refund                     | false         | set         | false         | any           | +, amount < 0                              | lowers that month                              |
| Owner-paid                 | false         | null        | true          | any           | none; raises `ownerLoanBalance`            | at `date`                                      |
| Supplier document          | false         | null        | false         | set           | none; paid by `supplier_payment` movements | at `date`                                      |
| Plan-only one-off (legacy) | false         | null        | false         | null          | none                                       | at `date`, as today                            |

Constraints (zod + rules): a recurring row carries no `accountId`, `paidByOwner` or `recurringExpenseId`; `accountId` and `paidByOwner` exclude each other; `amount ≠ 0`, negative only on a one-off with `accountId`; `vat` has the sign of `amount` or is 0.

**`CompanyLoan`** gains `accountId: string | null`, `dateEstimated: boolean`, `importRef: string | null`. A loan with an account is a cash row (`to_company` +, `from_company` −); one without (legacy, created by the old prompt) affects only `ownerLoanBalance`. Add the missing `updateCompanyLoanSchema`.

**Delete guards** (exported constants in `src/lib/cash-book.ts`, thrown by mock and Firebase client like `CONTRACT_HAS_HOURS` at `firebase.ts:2038`):

- `ACCOUNT_HAS_ENTRIES` — `deleteCompanyAccount` refuses while any movement (`accountId` or `toAccountId`), expense, loan or paid invoice points at it. PR 1 checks movements and invoices; PR 4 adds expenses and loans.
- `CLIENT_HAS_CASH` — `deleteClient` (`mock.ts:1258`, `firebase.ts:1846`) refuses when any of the client's invoices has `paidDate && paidAccountId`. One read before the existing batch. firebase-admin has no `deleteClient`, so MCP needs nothing.
- `BILL_HAS_PAYMENTS` — `deleteCompanyExpense` refuses a document that `supplier_payment` movements point at.
- `deleteInvoice` stays a plain delete: the statement check ("Missing IN of €x") is the backstop.

### 8.2 Firestore rules (`firestore/crm.rules` → `pnpm rules:build`)

On update `incoming()` is `request.resource.data`, the merged document (`base.rules:16-17`, comment at :33-35). One validation function per new block therefore covers create and update; it reads optional fields with `d.get(f, default)` so it never errors on a missing key.

```
match /company_accounts/{accountId} {
  function validAccount(d) {
    return d.userId == userId
      && isShortString(d.name, 100)
      && d.openingBalance is number
      && d.openingDate is timestamp
      && (d.get('statementBalance', null) == null) == (d.get('statementDate', null) == null)
      && (d.get('statementBalance', null) == null || d.statementBalance is number)
      && (d.get('statementDate', null) == null || d.statementDate is timestamp)
      && isOptionalString(d.get('importRef', null), 40);
  }
  allow read, delete: if isOwner(userId);
  allow create, update: if isOwner(userId) && validAccount(incoming());
}

match /company_movements/{movementId} {
  function validMovement(d) {
    return d.userId == userId
      && d.kind in ['transfer','income','client_income','deposit_held','deposit_paid',
                    'capital','vat','tax','compensation','supplier_payment']
      && d.direction in ['in','out']
      && d.amount is number && d.amount > 0
      && d.date is timestamp
      && isShortString(d.accountId, 200)
      && (d.kind == 'transfer'
            ? (d.direction == 'out' && d.get('toAccountId', null) is string
               && d.toAccountId != d.accountId)
            : d.get('toAccountId', null) == null)
      && (d.kind == 'supplier_payment'
            ? d.get('expenseId', null) is string
            : d.get('expenseId', null) == null)
      && isShortString(d.description, 300)
      && isOptionalString(d.get('documentRef', null), 100)
      && isOptionalString(d.get('project', null), 60)
      && isOptionalString(d.get('counterparty', null), 100)
      && isOptionalString(d.get('notes', null), 1000)
      && d.get('dateEstimated', false) is bool
      && isOptionalString(d.get('importRef', null), 40);
  }
  allow read, delete: if isOwner(userId);
  allow create, update: if isOwner(userId) && validMovement(incoming());
}
```

`isOptionalString(s, max)` is `s == null || (s is string && s.size() <= max)` (`base.rules:72-74`), so `isOptionalString(d.get(f, null), n)` accepts a missing key.

Existing blocks — every new field guarded `!('f' in incoming()) || …` on **create and update**, and every cross-field check written with `.get()` so legacy documents still pass:

- `invoices`: `paidAccountId` null or `isShortString(…, 200)`.
- `company_expenses`:
  - new fields: `accountId` (null|string), `paidByOwner` (bool), `vat` (null|number), `documentRef` (≤100), `project` (≤60), `recurringExpenseId` (null|string), `dateEstimated` (bool), `importRef` (≤40);
  - `!(d.get('isRecurring',false) && (d.get('accountId',null) != null || d.get('paidByOwner',false) || d.get('recurringExpenseId',null) != null))`;
  - `!(d.get('accountId',null) != null && d.get('paidByOwner',false))`;
  - `amount is number && amount != 0 && (amount > 0 || (!d.get('isRecurring',false) && d.get('accountId',null) is string))`, replacing `amount > 0`;
  - **close today's gaps** (`crm.rules:257-260`): update now checks `category`, `date`, `isRecurring`, `recurrenceMonths`, `notes`; create now checks `notes` and `recurrenceMonths`.
- `company_loans`: `accountId`, `dateEstimated`, `importRef` guarded; update now checks `description`, `date`, `notes` (gap at `:274-277`).
- `firestore-rules-build.test.ts`: add `company_accounts`, `company_movements` to `CRM_COLLECTIONS`.
- `.github/workflows/firebase-emulator.yml`: add `firestore/**` and `src/lib/backend/__tests__/firebaseadmin.crm.test.ts` to both path lists (`:9-31`, `:33-…`). `firestore.rules` is already listed (`:27`), so a `rules:build` output change does trigger the suite; the CRM admin test does not.

The rules cannot express "consulting money is never `income`", "a supplier payment never exceeds what is owed" or "the account exists". Those live in zod (web and MCP share it) and in the tool layer.

### 8.3 Read model — `src/lib/cash-book.ts` (CRM, pure, no I/O)

The sign and transfer maths of `account-ledger.ts` (`txDelta` :25-29) is rewritten here in about 10 lines, never imported: that file is typed on the personal `Transaction`, and the CRM must build without it.

| Function                                                    | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cashRows({invoices, expenses, loans, movements})`          | One `CashRow` per euro fact: `{source, sourceId, date, accountId, delta, kind, description, documentRef, project, counterparty, dateEstimated, importOrder, createdAt}`. Invoice: `paidDate` set and `paidAccountId` set and ≠ `NON_CASH` → `+invoiceTotal(i)` (a credit note is negative). Expense: `!isRecurring && accountId` → `−(amount + (vat ?? 0))`. Loan with `accountId`: `to_company` +, `from_company` −. Movement: in +, out −; a transfer gives two legs. Sorted by date, then `importOrder` parsed from `importRef` (month-sheet index, numeric row, split letter — never the string, `"Luglio!12"` < `"Luglio!2"`), then `createdAt`. |
| `balanceAt(accounts, rows, asOf)`                           | `openingBalance + Σ delta` for rows with `openingDate ≤ date ≤ asOf`. Rows before `openingDate` go to `beforeOpening[]`, rows naming no account to `unassigned[]`; neither reaches a balance.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `statementCheck(account, rows)`                             | `not_checked` with no statement; else `difference = bank − book at statementDate`: 0 → "Matches the bank on dd/mm/yyyy"; > 0 → "Missing IN of €x"; < 0 → "Missing OUT of €x" (the Verifica wording).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `monthSheet(accounts, rows, ym, accountId?)`                | Opening balance per account at the month start; rows grouped by day with an **end-of-day** balance (per account, or the total under _All_), so same-day ordering never produces fake intermediate balances; footer In / Out / Net (transfers excluded, like D/E), each account's closing balance and a by-kind breakdown.                                                                                                                                                                                                                                                                                                                             |
| `monthEnds(accounts, rows, year)`                           | The Months tab: per calendar month In, Out, Net and each account's end balance. A row whose bank date falls in another month moves with it, so a month-end can differ from the Excel's Verifica for that month; the import's acceptance check is per source sheet for that reason (§8.7).                                                                                                                                                                                                                                                                                                                                                             |
| `negativeDays(accounts, rows)`                              | First day each account's end-of-day balance is below 0 → To Chase and the account card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `projectTotals({invoices, expenses, movements}, from, to)`  | Per label: **income** = `income` + `client_income` movements with that label + invoices paid in the window net of VAT under the constant label "Consulting"; **costs** = one-off expenses (paid, owner-paid, supplier documents) at their own date, net `amount`; **net**. Deposits held and paid are returned beside, never inside net. Transfers, loans, capital, tax, compensation and supplier payments are excluded. Unlabelled rows → "Untagged". ponytail: invoices are always Consulting; add `Invoice.project` when a second invoicing activity exists.                                                                                      |
| `supplierDocuments(expenses, movements)`                    | Per document: `total = amount + (vat ?? 0)`, `paid = Σ supplier_payment (out − in)`, `owed = max(0, total − paid)`; plus payments whose `expenseId` names no document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `deposits(movements)`                                       | Per `(kind, counterparty ?? "Unnamed", project)`: held = `deposit_held` in − out (to give back), paid = `deposit_paid` out − in (to get back), with rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ownerLoanBalance(loans, expenses)`                         | `Σ to_company − Σ from_company + Σ paidByOwner (amount + (vat ?? 0))`. Used by Costs and Cash Book, and by `record_loan` / `add_expense` replies. Negative → warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `vatPosition(invoices, expenses, movements)`                | `notYetPaid = max(0, Σ vat of invoices paid into an account − Σ (vat ?? 0) of one-off expenses − Σ vat movements (out − in))`; `onUnpaidInvoices = max(0, Σ vat of invoices with paidDate null)`. Labelled an estimate.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `available`                                                 | `Σ balances − vatPosition.notYetPaid − Σ deposits held`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `clientsOwe(invoices)`                                      | `outstanding()` from `lib/invoices` per client (grouped by `invoiceClientId`), summed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `toChase(…)`                                                | Missing documents (a paid or owner-paid one-off with `documentRef` null and `category ≠ bank_fees`; income kinds shown as information only), `dateEstimated` rows, paid invoices with `paidAccountId == null` dated on or after the first account's `openingDate`, `unassigned`, `beforeOpening`, `negativeDays`.                                                                                                                                                                                                                                                                                                                                     |
| `adminPay(movements, yearlyGrossCompensation, year, today)` | `{recordedNet, plannedGross}` with `plannedGross = yearlyGrossCompensation × elapsedMonths / 12`. One line on the Months tab; no engine change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `otherIncomeByMonth(movements)`                             | `Record<"YYYY-MM", number>` of `income` movements (in − out). `client_income` is excluded by construction. Feeds the Plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pickEstimate(expense, estimates)`                          | Shared by the Costs form, Add Movement › Cost, `add_expense` and the import grouping: candidates = recurring estimates of the same category; exactly one **and** its first significant word (≥ 3 letters) appears in the description → pre-selected; one candidate without the word match, or several → "ask" (the UI shows them unselected, MCP lists them); none → no link.                                                                                                                                                                                                                                                                         |
| `suggestCategory(description)`                              | One keyword table: software vendor names → software; commercialista → accountant; Commissione → bank_fees; volo, airline names, Taxi, Noleggio → travel; law firm → legal; landlord Affitto → rent; cena, pranzo, rappresentanza → marketing; else other.                                                                                                                                                                                                                                                                                                                                                                                             |
| `toCsv(rows, accounts)`                                     | UTF-8 BOM, `;` separator, decimal comma, `dd/mm/yyyy`; columns Date; Account; Type; Description; Document; Project; Counterparty; In; Out; VAT; Notes; Flags; last line the disclaimer "Management record, not a statutory book (libro giornale / registri IVA)". About 40 lines.                                                                                                                                                                                                                                                                                                                                                                     |
| `accountInUse(accountId, data)`                             | Backs the delete button and `ACCOUNT_HAS_ENTRIES`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Also exported: `NON_CASH = "non-cash"`, the `paidAccountId` value written by "Offset, No Bank Payment" and by the import's credit-note settlement. `cashRows` skips it, `toChase` never lists it (a deliberate offset, unlike `null`, which means "not known"). It cannot collide with an auto-generated account id. Plus the three guard constants.

### 8.4 Plan and tax engine

**PR 3 — other income**

- `ProjectionInput.otherIncome?: Record<string, number>` (`projection.ts:80-89`).
- `projectMonths` passes `input.otherIncome?.[ym] ?? 0` as a new trailing `otherRevenue = 0` argument of `calculateMonthlyTax` (`italian-tax.ts:346-352`). It adds to `totalGrossRevenue` (IRES and IRAP bases) with no VAT, and is exposed as `MonthlyTaxBreakdown.otherRevenue`.
- `calculateAnnualTax` already sums the months' `totalGrossRevenue` (`italian-tax.ts:429`), so annual IRES/IRAP and the F24 acconti follow with no further change. `netCashAfterTaxPayments` uses `totalInvoiced` (`projection.ts:303`), so the cash forecast follows too.
- Callers `plan-shell.tsx:148-153`, `deadlines-shell.tsx:100-106`, `salary-shell.tsx:49-59` (the three that pass `companyExpenses` today) read `useCompanyMovements()` and pass `otherIncomeByMonth(movements)`. The Plan shows an "Other Income" row when it is non-zero.
- The per-line `netShare` denominators include other revenue, so corporate tax is shared with the rental activity. Intended.

**PR 4 — costs counted once, real VAT**

- `estimateCovered(estimate, ym, expenses)`: true when a one-off with `recurringExpenseId === estimate.id` is dated in `(ym − every, ym]`. `deductibleExpensesFor` (`projection.ts:110-127`) skips the estimate's share in covered months. Future months keep the estimate. An estimate with no linked actual behaves exactly as today.
- `deductibleExpensesFor` returns `{ cost, vatCredit, statedVat }` with `vatCredit = Σ (vat ?? amount × IVA_RATE)` over exactly the rows (or estimate shares, divided by `every`) it counted.
- `annualTaxes` sets `AnnualTaxSummary.vatCreditOnExpenses` (new, optional) to the year's sum **only when some counted row has a non-null `vat`**. Otherwise it stays undefined and `buildIvaEvents` takes today's `deductibleExpenses × IVA_RATE` path (`italian-tax-calendar.ts:143-144`), to the cent.
- `applyTaxCalendar` (`projection.ts:262-282`) passes `ivaCreditOnExpenses: annual.vatCreditOnExpenses` to `buildTaxCalendar` (the input already exists, `italian-tax-calendar.ts:68`).
- The Costs "Annualized" tile (`company-expenses-shell.tsx:69-79`) uses `estimateCovered` and leaves linked actuals out.

**Unchanged on purpose**

- `company-calendar.ts:77-89` keeps `isDone = event.date < today` (§6).
- `yearlyGrossCompensation` keeps being charged /12 every month (`italian-tax.ts:373-381`); decision 3.
- No `spreadMonths` / `deductiblePct`; decision 4.

### 8.5 Screens and components

All copy English, Title Case for buttons, dialog titles and headings; "prima nota" appears only as a «…» gloss in MCP text. Every flow works with `ai_mode = off`.

**Route and nav**

- `src/app/(app)/cash-book/page.tsx`: thin page, metadata title "Cash Book".
- `src/lib/nav-crm.ts:15-22`: `{ label: "Cash Book", href: "/cash-book", icon: BookOpen, featureFlag: "company" }` after Invoices. The crm `homeRoute` stays `/pipeline` (first item). The nav item is also the route gate in the personal build.

**`src/components/cash-book/`**

- `cash-book-shell.tsx`: `pageState([...])` gate like the Costs shell; account chips; month stepper; tiles; tabs Movements / Months / Projects / Owed & Held / To Chase (§2.1). Reads `useCompanyAccounts`, `useCompanyMovements`, `useInvoices`, `useCompanyExpenses`, `useCompanyLoans`: mutations on Invoices or Costs refresh it through their own query keys, with no extra invalidation. Empty state: "Add Your First Account" and "Import Excel".
- `movement-dialog.tsx` (Add Movement, also the movement editor):

| Toggle   | Type                           | Writes                                                                                                                                                                                                                       |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Out      | Cost                           | `createCompanyExpense` via the shared `CostFields` (below)                                                                                                                                                                   |
| Out      | Supplier Invoice Payment       | `supplier_payment` movement; a select of open documents with what is owed; more than owed is refused                                                                                                                         |
| Out      | VAT (F24)                      | `vat` out                                                                                                                                                                                                                    |
| Out      | Tax (F24)                      | `tax` out. Help text: stamp duty, chamber-of-commerce fee and local-tax lines are a _Cost_ with document "F24 dd/mm"; withholding (code 1040) is a _Supplier Invoice Payment_ on the professional's document, recorded gross |
| Out      | Administrator Pay              | `compensation` out (net)                                                                                                                                                                                                     |
| Out      | Deposit Returned               | `deposit_held` out; counterparty picked from held deposits                                                                                                                                                                   |
| Out      | Deposit Paid                   | `deposit_paid` out                                                                                                                                                                                                           |
| Out      | Shareholder Loan Repayment     | `createCompanyLoan` `from_company` with `accountId`; shows what the SRL owes you, warns when the repayment exceeds it                                                                                                        |
| In       | Client Invoice Payment         | invoice select (open invoices) → `updateInvoice {paidDate, paidAccountId}`; Amount Received with the bank-fee rule of Mark Paid                                                                                              |
| In       | Rent & Other Income            | `income` in. Help text: consulting money goes on its invoice                                                                                                                                                                 |
| In       | Client Payment Without Invoice | `client_income` in                                                                                                                                                                                                           |
| In       | Deposit Received               | `deposit_held` in; counterparty required (free text)                                                                                                                                                                         |
| In       | Deposit Refunded               | `deposit_paid` in                                                                                                                                                                                                            |
| In       | Shareholder Loan               | `createCompanyLoan` `to_company` with `accountId`                                                                                                                                                                            |
| In       | Share Capital                  | `capital` in                                                                                                                                                                                                                 |
| In       | Refund                         | `createCompanyExpense` with a negative amount and `accountId`                                                                                                                                                                |
| Transfer | —                              | `transfer`, From ≠ To                                                                                                                                                                                                        |

Fields: Amount (autofocus), Description, Account (last used, stored in `localStorage` inside try/catch; defaults to the only account), Date (today), Type, Project (input + datalist of labels in use), Document, Notes, Counterparty (deposit types). Buttons "Save" and "Save & Add Another" (keeps date and account). Editing a date sends `dateEstimated: false`. Rare reversals (VAT refund, income reversal, capital out) are allowed by the kinds and the import, not offered in the type list. ponytail: add them to the list when one happens.

- `accounts-dialog.tsx` ("Company Accounts"): name, opening balance, opening date (default today), statement; Delete disabled with the reason when `accountInUse`.
- `check-balance-dialog.tsx`: per account Bank Balance and Date (today); live statement check; lists the rows since the previous statement date; Save writes `statementBalance` / `statementDate`.
- `import-dialog.tsx` (PR 5, §8.7).

**Invoices › `MarkPaid`** (`invoice-table.tsx:183-290`; Deadlines imports the same component at `deadlines-shell.tsx:8` and renders it at :449, so Deadlines gets every change below — design A's "Deadlines untouched" was wrong)

- **Into Account**: the accounts plus "Offset, No Bank Payment" (`NON_CASH`). Default: last used, or the only account. Shown and required once any account exists; with no account the form is today's.
- **Amount Received**, prefilled with the expected total (invoice + ticked credits, `:267`):
  - short by 0 < d ≤ €50 → a checked "Book the €d difference as a bank fee" creates a `bank_fees` expense, same date and account;
  - short by more → blocked: "Partial payments aren't supported: record the payment when it is complete, or fix the invoice";
  - more than expected → blocked, with the hint to record the extra as a Client Payment Without Invoice.
- Expected ≤ 0 (ticked credit notes cover the invoice) → the account is forced to `NON_CASH` and Amount Received hides: an offset never touches a balance. Ticked credits larger than the invoice → a warning before saving.
- The account is stamped on the invoice and on every ticked credit note (`:269-273`).
- Undo (toast) clears `paidDate` and `paidAccountId` on all of them and deletes the fee it just created, by the id the create returned. A later untick from Deadlines leaves the fee; the statement check shows it.
- `invoice-sheet.tsx`: an account select next to the paid date (`:177`), so an estimated invoice date can be fixed without losing the account.

**Costs** (`src/components/company-expenses/`)

- New `cost-fields.tsx`, shared by `company-expense-form-dialog.tsx` and Add Movement › Cost:
  - Paid From: Not Paid Yet / each account / Owner's Personal Card → `accountId` / `paidByOwner`;
  - VAT, with a read-only "Total Paid" (= amount + VAT);
  - Document; Project;
  - Pays Recurring Cost (pre-filled by `pickEstimate`, hidden on recurring rows);
  - Refund toggle (only when Paid From is an account; stores a negative amount, the input keeps `min="0"`);
  - the Recurring checkbox hides once Paid From is an account or the card.
- One zod schema pair (`createCompanyExpenseSchema` / `updateCompanyExpenseSchema`) for the form, the mock and MCP. As in every editor of a cash row, changing the date sends `dateEstimated: false`.
- Recurring rows: "Record Payment" opens the dialog prefilled and linked. A "Paid From" column.
- Loans tab: new `loan-form-dialog.tsx` replaces `window.prompt` (`company-expenses-shell.tsx:59-66`):
  - "Lend to SRL" / "Repay Shareholder Loan" with date, amount, account and description; "Withdrawal" goes;
  - edit and delete (the unused `useUpdateCompanyLoan` gets its caller);
  - the summary uses `ownerLoanBalance`; negative → "The SRL has paid you €x more than it owed".

**Plan**: the Other Income row (PR 3).

### 8.6 MCP (server 0.20.0, PR 6)

**Rules for every new tool**

- English text, at most three «…» owner-phrasing hints.
- Every description says **company (SRL) bank accounts**, and every reply says "company account". The personal `list_accounts` (the personal tools, today "how much do I have in the bank?") and `add_transaction` descriptions gain "personal; for the SRL use get_cash_book / add_expense". Text-only edits.
- Zod is the only validation (the Admin SDK skips rules): the same schemas as the web, plus the checks rules cannot do (owed amount, account exists, duplicate).
- Writes are wrapped in `audited()` (`crm-write.ts:135-157`) and added to `WRITE_TOOLS` (`:71-94`, 22 → 26).
- Accounts resolve through `resolveCompanyAccount(accounts, query)` in `helpers.ts`: id, exact name, or a unique case-insensitive substring, modelled on `resolveDeadline` (`:191`). Unknown or ambiguous → `ToolInputError` listing the names. Defaults to the only account when exactly one exists; required when there are two or more. A cassa never captures a payment silently.
- **Duplicate guard**, copied from personal `add_transaction` (the personal tools): refuse the same account + date + amount + description unless `force: true`. A retried call cannot write money twice; a genuine twin (July's two identical loan rows) passes with `force`.
- No edit or delete by chat in v1: the web shows what is being changed.

**`get_cash_book`** (read, `crm-read.ts`)

- Hints: «prima nota», «saldo dei conti della società», «com'è andato ottobre».
- Input: `from?`, `to?` (YYYY-MM-DD; default: first of this month → today), `account?`, `project?`, `limit?` (1–200, default 50).
- Reply:
  - `summary`, e.g. "Bank A €… (bank 2026-10-07: matches) · Bank B €… · in €… / out €… this period · available €…";
  - `accounts`: `[{name, balance, statement: {date, bank, difference, status}}]`;
  - `period`: `{in, out, net, byKind}`;
  - `figures`: `{available, vatNotYetPaid, vatOnUnpaidInvoices, depositsHeld: [{counterparty, project, amount}], depositsPaid, ownerLoanBalance, clientsOwe, suppliersOwed: [{documentRef, description, owed}]}`;
  - `toChase` counts;
  - `rows`: `[{date, account, description, documentRef, project, in, out, source, dateEstimated}]`.

**`add_movement`** (write)

- Input: `kind` (movement kinds), `direction` (required unless transfer), `amount > 0`, `date?` (default today), `account`, `toAccount` (transfer), `description`, `documentRef?`, `project?`, `counterparty?` (required for deposit kinds), `notes?`, `document?` (supplier_payment: id or documentRef of an open supplier document), `force?`.
- Description states the boundaries: "Consulting money from a client is mark_invoice_paid, never income; a platform payout with no invoice is client_income. Costs are add_expense; shareholder loans are record_loan. An F24 is one call per line: VAT → vat; IRES, IRAP, INPS, IRPEF → tax; stamp duty and fees → add_expense; withholding on a professional's fee → supplier_payment on their document."
- Refuses: a transfer to the same account; an unknown account; a deposit with no counterparty; a supplier_payment with no matching open document, or above what is owed (the error states the owed amount); a duplicate without `force`.
- Reply: "Recorded €x in to Bank B on 2026-10-05 (deposit held, Room 2). Bank B balance €y." plus the movement and `documentIds`.
- Hints: «giroconto», «deposito cauzionale», «affitto stanza».

**`add_expense`** (write)

- Input: `description`, `category?` (default `suggestCategory`), `total` (what left the account, VAT included), `vat?` (default 0; "pass it only when the receipt shows recoverable Italian VAT"), `date?`, `paidFrom?` (account, `"owner"`, or omitted = not paid yet, which requires `documentRef`), `documentRef?`, `project?`, `notes?`, `paysRecurring?` (estimate id, description or `"none"`), `refund?` (negative amount; needs an account), `force?`.
- Stores `amount = total − vat`. `pickEstimate`: pre-selected → linked and said in the reply; "ask" → `ToolInputError` listing the candidate estimates and how to pass `paysRecurring`.
- Reply: "Cost recorded: rent €1,850.00 from Bank B on 2026-10-05, project Via Esempio; counts in the Plan for 2026-10 instead of the estimate 'Rent Via Esempio'. Bank B balance €…". With `paidFrom: "owner"`: "The SRL now owes you €…".
- Hints: «ho pagato», «carta personale», «fattura fornitore».

**`record_loan`** (write)

- Input: `direction` (`to_company` | `from_company`), `amount`, `date?`, `account` (required: a loan recorded by chat is cash), `description?`, `notes?`, `force?`.
- Description: "Never a withdrawal. Money to the owner is a loan repayment, administrator pay (add_movement compensation) or an expense refund."
- Reply: the new "SRL owes you" figure; when negative, "the SRL has paid you €x more than it owed".
- Hints: «finanziamento soci», «rimborso finanziamento».

**`check_balance`** (write: stores the statement)

- Input: `account`, `balance`, `date?` (default today).
- Reply: "Bank B: bank €x on 2026-10-07, book €x: matches." or "Missing OUT of €25.00: the bank shows a payment the book lacks", plus up to 20 rows since the previous statement.
- Hints: «saldo banca», «estratto conto».

**`mark_invoice_paid`** (changed, `crm-write.ts:1444-1476`)

- Gains `account?` (`"none"` = `NON_CASH` offset) and `received?`.
- Short by ≤ €50 → the fee `bank_fees` expense and the invoice update are written atomically by `settleInvoicePayment`. Short by more, or over → `ToolInputError` with the same guidance as the web form.
- Description adds: "One transfer paying several invoices: call once per invoice with the same date and account."
- The reply names the account and any fee.

**Server side**

- `firebase-admin.ts` exports `getCompanyAccounts`, `updateCompanyAccount`, `getCompanyMovements`, `createCompanyMovement`, `getCompanyExpenses`, `createCompanyExpense`, `getCompanyLoans`, `createCompanyLoan`. None exist today. Its invoice mapper and `updateInvoice` (`:843-887`) carry `paidAccountId`.
- `settleInvoicePayment(userId, {invoiceId, paidDate, paidAccountId, fee?})` writes one `WriteBatch`. It goes on `CrmServerAdapter` (`types.ts:326-334`), with a sequential mock.
- `ServerDb` (`server-db.ts:22-68`) picks the eight. The `as unknown as ServerDb` cast (`:72`) hides a missing export, so each function gets its own `firebaseadmin.crm.test.ts` case, including "reads a document lacking X as null". Its `afterEach` collection list gains `company_accounts` and `company_movements`.
- Version `0.19.0` → `0.20.0` in `src/app/api/mcp/route.ts:55` and `scripts/mcp-stdio.ts:28`. `README.md:59` "43 tools" (already stale: 45 are registered) → "50 tools".
- `mcp_audit` keeps storing raw params (`crm-write.ts:145`): server-only, the owner's own data. Tenant labels typed in chat persist there; noted in risks.

### 8.7 Import (PR 5)

Everything runs in the browser. There is no upload endpoint; the file is read with `File.arrayBuffer()` and dropped after commit. Errors cite `(sheet, row, column)`, never cell content, and nothing is logged to the console.

**`src/lib/xlsx.ts`** — product-neutral, zero imports, about 120 lines.

- Zip: find the EOCD (`0x06054b50`) from the end, walk the central directory (`0x02014b50`) for name, method, compressed size and local-header offset, skip the local header (`0x04034b50` + name and extra lengths). Sizes come from the central directory, so data descriptors work. Method 0 is copied, method 8 is inflated with `new DecompressionStream('deflate-raw')`; anything else, ZIP64 or encryption is an error.
- XML with `DOMParser` + `getElementsByTagName`. Sheet order from `xl/workbook.xml` plus `xl/_rels/workbook.xml.rels`. Shared strings join the `t` runs of each `si` and skip `rPh` (phonetic) runs. Cells: `t="s"` shared string, `str` / `inlineStr` text, otherwise a number. Only cells that exist are kept: the declared `A1:AC1000` dimension full of empty styled cells costs nothing.
- `date1904="true"` is refused. Serial → UTC day: `new Date(Math.round((serial − 25569) × 86400000))`.
- API: `readXlsx(buf): Promise<{ sheets: { name: string; rows: (string | number | null)[][] }[] }>`.
- ponytail: hand-rolled because npm `xlsx` (SheetJS) is frozen at 0.18.5 with CVE-2023-30533 and CVE-2024-22363, and exceljs is heavy and Node-oriented. Ceiling: no ZIP64, no encrypted workbooks, no formulas (the month sheets have none). `DecompressionStream` is in Node 24 (CI), Chrome 103+, Firefox 113+ and Safari 16.4+; vitest's happy-dom `DOMParser` handles the XML (probed).

**`src/lib/prima-nota.ts`** — CRM, pure. It exports `detect`, `parseRows`, `planImport(parsed, appData, choices)` → `{ writes, review, report, check }` and the keyword constants. Italian keywords are user data the parser reads: CLAUDE.md's language rule gains "the prima nota import parser" next to "the Money Manager import parser".

**Detection** (hard errors, never a guess)

- A `Saldo` sheet with headers `Conto | Data | Saldo`, one row per account: name, statement date, balance.
- One or more sheets named after an Italian month (Gennaio … Dicembre). `Verifica` is skipped; any other sheet name is an error naming it.
- Row 1 of each month sheet, compared by trimmed, case-insensitive name: `Numero Transazione, Descrizione, Numero Fattura, Entrata/Uscita di Cassa, Entrata/Uscita <Account> …, Credito, Debito, Note`, plus a last column starting `Spesa per`. Its suffix after "Casa " gives the project label (`Via Esempio`).
- Account columns: `Entrata <X>` / `Uscita <X>` pairs, matched to a Saldo `Conto` by prefix (`Bank A` → `Bank A Business`). Two accounts in this file; the parser takes N.
- Year: the Saldo date's year; a month sheet later than the Saldo month belongs to the previous year.

**Per row**

- Key: `importRef = "<year>:<Sheet>!<row>"`; split parts add `a`, `b`, …. Rows are never deduplicated by content: July has two identical genuine loan rows, and a content hash drops 5 real rows in this file.
- Rows whose A–M are all empty are skipped. Rows whose amounts D–K are all empty go to the report with their row number.
- Checksum: when D or E is present, `D = F + H` and `E = G + I`, otherwise the row is rejected (shown, blocks the check).
- **Date**, first rule that applies:
  1. a bank date in L, `/(bonifico|addebito|addebitati|accredito|giroconto|rimborso|pagat[oi])[^.|;]*?(del|il)\s+(\d{1,2})\/(\d{1,2})(\/\d{4})?/i`, kept even outside the sheet month;
  2. a document date in L, `/(fattura|ricevuta)[^.|;]*?del\s+(\d{1,2})\/(\d{1,2})/i`, only inside the sheet month;
  3. the 1st of the sheet month with `dateEstimated: true`.

  Never the last day of the month. A document-only row (J/K) takes rule 2, else the 1st; never a bank date found in its note (the part-paid supplier invoice's note carries the payment date).

- **Missing document**: when L matches `/fattura assente|fattura da recuperare|nessuna fattura|non ancora ricevuta|da richiedere|serve ricevuta|non una fattura/i`, `documentRef` stays null and C goes into notes ("Excel ref: …"). To Chase then lists it with no extra flag.
- **Notes** = L. "Needs review" phrases (`da verificare|da chiarire|differenza|documenti non corretti|persona fisica|manca srls|per errore`) put the row in the review list. Reverse-charge phrases go to the accountant section of the report; `vat` stays 0.
- **Project**: M = `X` → the header project. Inferred for tenant, deposit and landlord-rent rows and for rows whose B names the project. Client receipts → Consulting. Never on transfers or loans; otherwise null.

**Mapping** (first match wins; every row can be overridden in the review list)

| #   | Row                                                                                                   | Target                                                                                                                                                                                                | Review?                        |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | D and E empty, one in-leg and one out-leg on different accounts, equal amounts                        | `transfer` movement                                                                                                                                                                                   | —                              |
| 2   | D and E empty, money present, not rule 1                                                              | rejected                                                                                                                                                                                              | blocks                         |
| 3   | In, B starts `Incasso fattura`                                                                        | every `N/YYYY` token in C → that app invoice (reconciliation below)                                                                                                                                   | on mismatch                    |
| 4   | In, B starts `Incasso` (platform)                                                                     | decision 1: invoice at gross + "Platform commission" cost (`other`, vat 0, reverse-charge note), gross prefilled from L or typed; or an open app invoice picked by hand; fallback net `client_income` | yes                            |
| 5   | In, B `^finanziamento soci`                                                                           | `CompanyLoan` `to_company`, `accountId`                                                                                                                                                               | —                              |
| 6   | Out, B `(prelievo\|rimborso) finanziamento soci`, or B/L "rimborso" with `socio` or `carta personale` | `CompanyLoan` `from_company` — never a cost                                                                                                                                                           | the mistaken pair: import both |
| 7   | In, B `Deposito Capitale`                                                                             | `capital` movement                                                                                                                                                                                    | confirm                        |
| 8   | Out, B starts `Commissione`                                                                           | expense `bank_fees`                                                                                                                                                                                   | —                              |
| 9   | Out, B `Caparra`                                                                                      | `deposit_paid`, counterparty "Landlord", project                                                                                                                                                      | —                              |
| 10  | In, B `deposito cauzionale` without `affitto`                                                         | `deposit_held`, counterparty prefilled from B (replaceable, e.g. "Room 2"), project                                                                                                                   | —                              |
| 11  | In, mixed tenant row (`di cui … rimborso spese`, `+ spese N`, `decurtat`, or deposit + rent)          | split into **signed** parts prefilled from the `di cui N` / `+ spese N` amounts, summing to the signed bank amount; an out part becomes a cost or a deposit out on the same date and account          | yes                            |
| 12  | In, `affitto\|canone\|contributo spese`                                                               | `income`, project                                                                                                                                                                                     | —                              |
| 13  | Out, B `^affitto .*<project>`                                                                         | expense `rent`, project                                                                                                                                                                               | —                              |
| 14  | Out, L starts `Rimborso` (not rule 6)                                                                 | expense `other`, project; alternative: deposit returned                                                                                                                                               | yes                            |
| 15  | In, B `(rimborso)`                                                                                    | negative expense with `accountId` (refund), `documentRef` C                                                                                                                                           | —                              |
| 16  | In, anything else                                                                                     | `income`                                                                                                                                                                                              | yes                            |
| 17  | Out, C and the supplier token (first uppercase token of B) both equal a K document's                  | `supplier_payment` on that document                                                                                                                                                                   | —                              |
| 18  | Out, anything else                                                                                    | one-off expense with `accountId`, amount = bank amount, `vat` 0, `documentRef` C (multi-refs `a÷b`, `/`, `+` kept as text), `suggestCategory`, project                                                | —                              |
| 19  | K, B starts `Emessa fattura`                                                                          | no write: match by (n, year), check K = amount + VAT, numbering gaps over these rows only                                                                                                             | report                         |
| 20  | J, B starts `Nota di credito a storno`                                                                | credit-note settlement below                                                                                                                                                                          | report                         |
| 21  | K with `carta personale` in B or L                                                                    | expense `paidByOwner`, project                                                                                                                                                                        | —                              |
| 22  | K, other                                                                                              | supplier document: expense, no account, `documentRef` C, amount K, `vat` 0, document date. A J credit note naming it nets into it (ref in notes); netted to 0 → not created, reported                 | —                              |
| 23  | J, other (store credit)                                                                               | no write                                                                                                                                                                                              | report                         |

**Invoices: the Excel wins on cash facts, the app on document facts**

- (a) Paid in the Excel, unpaid in the app → `paidDate` (row date) + `paidAccountId`.
- (b) Both paid on different dates: Excel date from rule 1 → Excel wins (both shown). Estimated, app date in the same month → app date kept. Estimated, other month → review.
- (c) Paid in the app inside the file's months with no receipt in the file → review: Mark Unpaid / Keep (stays in To Chase) / Offset (`NON_CASH`). Never an invented cash row.
- (d) A receipt with no app invoice → review: Create Invoice (prefilled from C, the matching `Emessa fattura` K and a `di cui IVA` note) or Client Payment, No Invoice (`client_income`, never `otherIncome`). Invoices the import creates are real documents and stay after Undo; only their account link is cleared.
- (e) Received < app total: when the file's K for that number equals the app total and the gap is ≤ €50 → a `bank_fees` expense, same date and account. Any other gap, or received > total, → review (default for an excess: `client_income` "overpayment, to review").
- Several `N/YYYY` tokens in one `Incasso fattura` → each invoice paid with the same date and account; the received amount is compared with their sum.
- **Credit-note chains** (rows 19–20; this file has one invoice re-issued twice): per client, each cancelled original (`NC su N/YYYY`) plus one app credit note with total = −J get `paidDate` = the credit-note row's date and `paidAccountId = NON_CASH`. Equal-total credit notes are interchangeable, so ambiguity is harmless. An original with no app credit note → report: "reads as owed: add the credit note on Invoices". This settles them before anyone opens Mark Paid on the re-issue, so `openCredits` (`invoice-table.tsx:222`, `:264`) no longer pre-ticks them.

**Pre-check against the app**

- **Already imported** = any expense, loan, movement or account with `importRef`. Import is then disabled and Undo Import offered. This is derived from data, so it survives a reload or a crash.
- **Accounts**: Saldo names are matched to existing company accounts by case-insensitive prefix. A matched account must have no rows; the import sets `openingBalance 0`, `openingDate` = 1st of the first month sheet and the statement. Unmatched ones are created with `importRef`. A cassa is never touched.
- **Overlaps**: every existing loan and one-off cost is listed. A pair is an existing row and an imported row with the same cash amount within ±1 month (loans made through the old `prompt()` carry the click date, `company-expenses-shell.tsx:65`). The default action on a pair follows decision 2; an unpaired row is kept.
- **Estimates**: imported costs grouped by supplier token, each group with the `pickEstimate` suggestion. Per group: link (`recurringExpenseId`); move the estimate's start to the opening date when earlier (otherwise it keeps charging January–April); set its `vat` (0 suggested for rent, donation and reverse charge, where today's `null` means 22% credit).

**Acceptance check** — computed with `lib/cash-book` on the planned state (imported rows + invoices after reconciliation); Import stays disabled until it passes:

1. per account, `balanceAt(Saldo date)` = Saldo balance, to the cent (Bank A <saldo Bank A del foglio Saldo>, Bank B <saldo Bank B del foglio Saldo>for this file);
2. per **source sheet** and account, Σ in − out of the rows from that sheet = Σ(F − G) and Σ(H − I). Grouped by sheet, not by calendar month, so the August row with a September bank date does not fail it;
3. Σ(D − E) over the file = Σ balances.

A failure reads like Verifica ("Bank B: missing IN of €x"). When the only cause is rows dated after the Saldo date: "Rows after 07/10/2026: update the Saldo sheet to today's balance and import again." It proves balances, not kinds; the review list and the per-target counts are the control for kinds.

**Commit**

1. Accounts.
2. Overlap deletions chosen in the preview.
3. Rows one at a time in sheet order: supplier documents first (payments need their ids), then expenses, loans, movements.
4. Invoice updates and creations.
5. Estimate edits.
6. Invalidate `companyAccounts`, `companyMovements`, `companyExpenses`, `companyLoans`, `invoices`.

A few seconds, with a progress bar. On error it stops and offers Undo. The report (estimated dates, missing documents, accountant notes, cancelled invoices, numbering gaps, replaced rows with their fields) stays on screen with "Download Report" (a client-side text file).

**Undo Import** — shown whenever imported records exist.

- Imported rows edited after the import (`updatedAt > createdAt`) are listed and kept unless confirmed.
- It deletes the other imported expenses, loans and movements, and clears `paidAccountId` on invoices that point at an imported account (`paidDate` stays: the Excel proved it).
- It deletes imported accounts that nothing references any more.
- Overlap rows that were replaced are not restored; their fields are in the downloaded report.
- After Undo the file can be imported again. A second, different file is not supported: the Excel is retired at the Saldo date.

### 8.8 Costs reconciliation: one entry feeds both

**Invariant**: only `CompanyExpense` rows and `income` movements reach `projection.ts`. Each cost is exactly one `CompanyExpense`; each euro of rent is exactly one `income` movement.

| Fact                                                                                  | Cash Book                                              | Plan                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Paid cost (`accountId`)                                                               | −(amount + vat) on its account                         | `amount` at its date via `deductibleExpensesFor`, as today                                                          |
| Owner-paid cost (`paidByOwner`)                                                       | no cash row; + `ownerLoanBalance`                      | `amount` at its date                                                                                                |
| Supplier document (no account, `documentRef`)                                         | none; its `supplier_payment` instalments are cash only | `amount` at the document date, once                                                                                 |
| Refund (negative, `accountId`)                                                        | + on its account                                       | lowers that month                                                                                                   |
| Recurring estimate                                                                    | never                                                  | `amount/every` per month, **skipped in months covered** by a linked actual; future months keep it                   |
| Bank fee on a short payment, platform commission                                      | − on the account                                       | deductible, no special code                                                                                         |
| `income` movement (rent, contributions, kept deposit share)                           | ±                                                      | `otherIncome` → IRES/IRAP base, no VAT                                                                              |
| `client_income` (platform payout without invoice, overpayment)                        | +                                                      | **never**: contracts × days already count consulting revenue                                                        |
| Paid invoice                                                                          | + total                                                | never (revenue stays accrual from contracts; `crm.ts:240-242`)                                                      |
| Loans, deposits, transfers, capital, `vat`, `tax`, `compensation`, `supplier_payment` | ±                                                      | never (balance-sheet items; taxes are not costs; pay is already in `yearlyGrossCompensation`, `italian-tax.ts:318`) |

**Recurring cost stays a plan estimate until paid.**

- A recurring row can carry no `accountId`, `paidByOwner` or `recurringExpenseId` (zod + rules).
- Each real payment is a one-off with `recurringExpenseId`, set by Record Payment, by `pickEstimate`, or by the import's group step.
- Pre-selection only when the category **and** a description word match. That stops an unrelated software purchase from silently replacing a subscription estimate.
- An unlinked actual next to an estimate double counts. That is visible on the Costs page (both rows in the month) and is the owner's call, since the form shows the suggestion.

**Costs page**

- "Annualized" leaves linked actuals out (`estimateCovered`). "Total" stays actual spend.
- "SRL owes you" becomes `ownerLoanBalance`, so card purchases count.

**VAT credit** uses real `vat`. The 22% fallback is kept only when every counted row is legacy (`null`), so legacy-only data gives today's numbers to the cent (snapshot test).

**Existing data on day one** (production data not inspected)

- Legacy rows keep today's maths everywhere.
- The import's overlap and estimate steps (§8.7) are the only place existing rows are touched, with decision 2 setting the default.
- `annualTaxes` walks whole years from January (`projection.ts:234-254`), so imported May–October actuals do reach 2026 IRES/IRAP and the acconti. That is intended, and it is why the estimate skip ships in the same PR as the cost fields, and the rent income (PR 3) before the import (PR 5).

**Hook refresh**: the Cash Book reads the same `useInvoices`, `useCompanyExpenses` and `useCompanyLoans` queries the Costs, Invoices, Plan, Deadlines and Compensation pages use. `create-crud-hooks` invalidates the key it owns (`create-crud-hooks.ts:37-40`), so every page refreshes with no extra wiring. The three plan shells add `useCompanyMovements` for `otherIncome`.

### 8.10 Tests (synthetic data only)

No fixture, snapshot or test string may contain a name, number or amount from the owner's workbook. The workbook builder writes made-up rows ("Room A", "Acme Ltd", round amounts) and lives at `src/lib/__tests__/helpers/prima-nota-workbook.ts`; it uses only `node:zlib`, so Playwright can import it too.

| Where                                                                            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/__tests__/cash-book.test.ts`                                            | Invoice cash row needs `paidDate` and an account; `NON_CASH` and `null` are not cash; a credit note is negative. Recurring expense never a cash row; cash = amount + vat; refund positive. Owner-paid → no cash row, raises `ownerLoanBalance`. Transfer two legs, nets to 0, out of In/Out. `balanceAt` respects `openingDate`; `beforeOpening` and `unassigned` reported. `statementCheck` wording for 0 / + / − / not checked. `monthSheet` end-of-day balances do not depend on same-day order (shuffle test). `monthEnds` with a cross-month row: equal to the per-sheet totals except that month. `importOrder` sorts `!2` before `!12`. Supplier owed clamps at 0, dangling payments listed. Deposits by counterparty, partial return + kept share reaches 0. `projectTotals` keeps deposits, loans, transfers, supplier payments out of net; invoices under Consulting. `vatPosition` (reverse charge neutral, unpaid-invoice VAT apart). `ownerLoanBalance` negative flagged. `pickEstimate` (one + word, one without word, several, none). `toCsv` BOM, `;`, decimal comma, dd/mm/yyyy, disclaimer. `otherIncomeByMonth` ignores `client_income`. |
| `projection.test.ts`, `italian-tax.test.ts`, `italian-tax-calendar.test.ts`      | No movements and legacy-only expenses → output identical to today (snapshot of a realistic synthetic input, PR 3 and PR 4). `otherIncome` raises IRES and IRAP bases, adds no VAT, reaches `calculateAnnualTax`. Monthly estimate replaced only in the linked month; quarterly covered over `(ym−3, ym]`; unlinked unchanged. Negative refund lowers cost. VAT credit uses real `vat`, falls back only when all rows are legacy; `buildIvaEvents` uses `vatCreditOnExpenses`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/lib/__tests__/schemas.test.ts` (new, beside `transaction-schemas.test.ts`)  | Transfer to same account, `supplier_payment` without `expenseId`, `toAccountId` on a non-transfer, recurring + account/owner/link, account + owner, negative amount unless paid one-off, vat sign, statement pair, deposit-kind counterparty optional in schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/lib/__tests__/xlsx.test.ts`                                                 | A zip built in the test with `deflateRawSync`, one stored entry and one with a data-descriptor flag; shared strings with rich `r/t` runs and `rPh` skipped; numbers; `inlineStr`; serial date to UTC day; sheet order from rels; `date1904` refused; non-zip and unsupported method refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/__tests__/prima-nota.test.ts`                                           | Detection errors (header, unknown sheet, no Saldo) name sheet/column and never cell text. Checksum rejection. Transfer detection and rejection. Date rules 1–3, cross-month bank date kept, never last day, document rows ignore bank dates, Dec→Jan year rule. Identical rows both kept. Every mapping row 1–23. Invoice reconciliation (a)–(e), multi-token receipt, short payment fee only when K = app total, overpayment to review. Credit-note chain settled as `NON_CASH` with interchangeable equal totals. Platform default and fallback. Signed split parts must sum. Missing-document phrase empties `documentRef`. Pre-check: already-imported, empty existing accounts reused, overlap pairs within ±1 month, estimate groups. Acceptance check passes on the fixture and fails with "missing OUT of €x" when one row is dropped, and with the after-Saldo message when a row is dated later.                                                                                                                                                                                                                                                  |
| `adapter-contract.ts` (mock + Firebase client)                                   | CRUD for accounts and movements with user isolation and date sort; each zod/rules rejection asserted on both backends (the mock parses the same schemas). New fields on invoices, expenses and loans round-trip; a document without them reads `null`/`false`. `ACCOUNT_HAS_ENTRIES`, `CLIENT_HAS_CASH`, `BILL_HAS_PAYMENTS`. `mock.test.ts`: `__resetMockState` clears both new maps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `firestore-rules.test.ts` (emulator)                                             | `validAccount` / `validMovement` mine/theirs; bad kind, same-account transfer, payment without document, stray `toAccountId` denied. Expenses: recurring + account denied, negative unpaid denied, **update of a legacy expense/loan/invoice lacking every new field allowed**, the newly validated category/date/notes/recurrenceMonths and loan description/date/notes deny bad types. `invoices.paidAccountId` string or null, number denied; `{paidDate: null}` alone allowed on an invoice with an account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `firebaseadmin.crm.test.ts` (emulator)                                           | The eight admin functions and `settleInvoicePayment` (atomic: a failing fee write leaves the invoice unpaid), each with a "lacking X reads null" case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tools-read.emulator.test.ts`, `tools-write.emulator.test.ts`, `helpers.test.ts` | `get_cash_book` balances, statement, filters, figures. `add_movement` transfer, same-account refusal, owed cap, deposit counterparty, duplicate refused then accepted with `force`. `add_expense` stores total − vat, `pickEstimate` link and ask, owner raises balance, refund needs account. `record_loan` and the negative warning. `check_balance`. `mark_invoice_paid` account default / required / `"none"`, fee batch. Every write audited. `resolveCompanyAccount` exact, substring, ambiguous, unknown. the registry test `WRITE_TOOLS` parity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e/crm.spec.ts` (mock, production build)                                       | (1) Two accounts, a transfer, a cost from one account, Mark Paid into the other with a small fee; cards and Months tab balances. (2) Import a synthetic workbook passed to `setInputFiles` as a buffer, holding transfers, costs, loans and deposits but **no receipts** (the mock is wiped by `page.goto`, so invoices would have to be created through the UI first); "Matches the bank"; Undo Import empties the book. (3) A personal-card cost shows the same SRL Owes You on Costs and Cash Book.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Gate per PR: the three-mode unit run, `pnpm lint`, and `pnpm test:firebase:docker` for PRs 1, 2, 4 and 6.

### 8.11 Risks

1. **Estimated dates.** Most imported money rows (invoice receipts included) get the 1st of their sheet month. Day-level dates, overdue flags and the paid-basis month in `get_revenue` stay approximate until corrected from To Chase. Month-ends per sheet and the as-of-Saldo balances are exact. The end-of-day view keeps same-day order from inventing balances.
2. **Classification relies on Italian free text.** The acceptance check proves sums, not kinds: a deposit booked as income still balances, but would now raise the Plan. The review list, the per-target counts and the Plan's Other Income row are the controls.
3. **The Plan moves.** Other income (PR 3) and real VAT credit (PR 4) change IRES/IRAP and the F24 estimates. That is the correction; it goes in the release notes. Known artefacts remain and are the owner's decisions:
   - pay charged for every month of 2026, before the founding included (decision 3);
   - first-year acconti;
   - renovation deducted in one month (decision 4).
4. **Existing Costs and Loans rows** were not inspected. The overlap step mitigates double counting but cannot prove its absence. Decision 2 sets its default.
5. **Imported costs carry `vat` 0.** This is right for reverse charge, exempt rental, rent and donation. For VAT-bearing consulting purchases the Plan deducts the gross and claims no credit, until the owner splits the big documents.
6. **Rules on legacy documents.** One unguarded field or one cross-field check without `.get()` denies every edit of an old Cost, Loan or Invoice on Firebase only. The emulator "legacy update" cases cover all three collections, plus `{paidDate: null}` alone.
7. **`ServerDb` unchecked cast** (`server-db.ts:72`): a missing admin export passes mock tests and fails in production. Each admin function has its own emulator case.
8. **Hand-rolled xlsx.** A workbook re-saved by Excel instead of LibreOffice may differ (rich strings, styles, a stored part). Detection fails loudly; tests cover data descriptors, rich and phonetic runs, `inlineStr`.
9. **Non-atomic import.** Sequential writes; a closed tab leaves a partial book that Undo Import (derived from `importRef`) removes. ponytail: batch writes when a file reaches a few thousand rows.
10. **Deletes.** `deleteInvoice` of a paid invoice still changes a balance silently; the statement check ("Missing IN of €x") is the backstop. Adapter guards do not run on Admin writes, which is why MCP has no delete tools.
11. **Mark Paid now asks for an account on Deadlines too** once an account exists. This is intended, but it is a new required field on a page that does not mention the cash book.
12. **Personal vs company in chat** (full build, personal accounts at the same banks likely). Descriptions and replies say "company" and "personal"; the model may still have to ask. Neither side writes to the other's accounts: `resolveCompanyAccount` reads only `company_accounts`.
13. **Privacy.** Tenant labels (counterparty, descriptions) are third parties' data.
    - Counterparty is optional free text, there is no tenant entity, and the import's prefill is replaceable ("Room 2").
    - `get_cash_book` sends descriptions to the chat model when the owner asks.
    - `mcp_audit` stores tool params.
    - Erasure means editing or deleting rows; the CSV is the way out.
    - The scratchpad copies (`prime-note-2026.xlsx`, `pn-dump.txt`, `pn/*.py`, `agg*.py`) must be deleted after the work and never enter the repo.
14. **CI.** Until PR 1's path-filter fix lands, run `pnpm test:firebase:docker` locally for admin-test or `crm.rules`-only changes.
15. **Costs page size** grows by about 110 imported rows. Add a Paid From or month filter when it hurts.

### 8.12 Traceability and out of scope

**Judge's grafts**
| Graft | Where |
| --- | --- |
| Rental income in the plan before the import (`otherIncome`, trailing `otherRevenue = 0`) | PR 3 (§7, §8.4) |
| One Add Movement dialog routing to home records, Save & Add Another, remembered account | §8.5 |
| Month-sheet Movements tab, opening row, end-of-day balance, footer | §8.3 `monthSheet`, §8.5 |
| Pre-select the estimate when exactly one shares the category | `pickEstimate`, with the critic's word-match guard (§8.3, §8.8) |
| "VAT on unpaid invoices" | `vatPosition.onUnpaidInvoices` |
| `add_movement` states "consulting money is mark_invoice_paid, never income" | §8.6 |
| CLAUDE.md language exception for the parser | §8.7, PR 5 |

**Judge's flaws, fixed**
| Flaw | Fix |
| --- | --- |
| A: tenant income missing while flat costs are imported | PR 3 before PR 5; `income` → `otherIncome` |
| A: "Deadlines untouched" | Corrected: Deadlines renders the same `MarkPaid` and gets Into Account (§8.5, risk 11) |
| A: cash-basis VAT only | `onUnpaidInvoices` beside `notYetPaid` |
| A: `monthTotals reproduces month-ends` | Calendar month-ends may differ by a cross-month row; the acceptance check is per source sheet (§8.3, §8.7) |
| A: intra-day running balance by `createdAt` | End-of-day balances; display order by parsed `importRef` |
| B: `paidAccountId ⇒ paidDate` rule breaks the Deadlines untick | No cross-field rule; emulator case for `{paidDate: null}` alone |
| B: Undo cannot find the fee | Undo deletes the fee by the id it just created; MCP writes invoice + fee in one batch |
| B: destructive "Replace" default | Owner's decision 2; the preview shows each pair; the replaced fields go in the report |
| B: max(estimate, actual) per category; plan "mode" switch | Not used: per-estimate link + `estimateCovered` |
| B: F24 "Not recorded" nags | No F24 matching in v1 |
| C: `other_income` from platform payouts in the plan | Only `income` feeds the plan; platform payouts and overpayments are `client_income` |
| C: 22% VAT default on imported costs | Imported `vat` is 0 |
| C: `Client.project`, update/delete by chat, Replace Previous Import | Not adopted. `CLIENT_HAS_CASH` is kept as a single pre-batch check, because a client delete would otherwise erase cash. |
| All: CI path-filter claim | `firestore.rules` already triggers; add `firestore/**` and `firebaseadmin.crm.test.ts` (PR 1) |

**Critic's gaps**
| # | Gap | Resolution |
| --- | --- | --- |
| 1 | Estimated dates | `dateEstimated` on movements, expenses, loans, cleared on edit; order by parsed `importRef`; previous-year rule; the 9 estimated invoice dates listed in the report, no flag on Invoice |
| 2 | Re-import, crash, pre-created accounts | "Imported" = `importRef` exists; empty matched accounts reused; Undo derived from data; after-Saldo message; Excel retired |
| 3 | Excel vs app invoices | Excel wins cash facts, app wins documents; rules (a)–(e) |
| 4 | Credit-note chains | Import settles them as `NON_CASH`; Mark Paid forces `NON_CASH` when expected ≤ 0 and warns on excess credits |
| 5 | Platform receipts | Decision 1; default gross invoice + commission cost; numbering-gap check on `Emessa fattura` rows only |
| 6 | One payment, several invoices | Every `N/YYYY` token; `mark_invoice_paid` once per invoice; supplier multi-refs stay text |
| 7 | Fees, overpayment | Fee only when K = app total and gap ≤ €50; any other gap reviewed; excess → `client_income` to review; stamp-duty gaps booked at the bank amount |
| 8 | Deposits returned later | `counterparty`; partial return + kept share pattern; caparra refund = `deposit_paid` in |
| 9 | Mixed/netted tenant receipts | Signed split parts; missing-document info on income kinds; invoicing rent is a question for the commercialista |
| 10 | Card purchases and repayment | "Rimborso" + socio/carta personale → loan `from_company`, never a cost; owed shown on Repay; negative balance warns everywhere |
| 11 | F24 lines that are costs, withholding | One row per line: `vat`/`tax` movements, cost lines as expenses ("F24 dd/mm"), 1040 as `supplier_payment`; questions in §6 |
| 12 | F24 calendar | Out of scope v1: `isDone = date < today` kept; matching later, only for events after the Saldo date |
| 13 | Administrator pay | `adminPay` line on Months; engine change is decision 3 |
| 14 | Existing Costs/Loans on day one | Overlap step (every loan and one-off, amount ±1 month, decision 2 default); estimate start/VAT fix; word-match auto-link; Recurring hidden once paid; Refund toggle; one shared zod schema |
| 15 | Plan counts the wrong costs | PR 3 before PR 5; flat costs `vat` 0; renovation spread = decision 4; donation deductibility in the report for the commercialista (field only if the answer requires it); legacy snapshot test |
| 16 | Deleting records that hold cash | `ACCOUNT_HAS_ENTRIES`, `CLIENT_HAS_CASH`, `BILL_HAS_PAYMENTS` in mock + Firebase; no archive (none needed yet) |
| 17 | Editing imported rows | No `paidDate` cross-field rule; account select in the invoice sheet; Undo keeps edited rows unless confirmed; date edit clears `dateEstimated` |
| 18 | Cassa | `openingDate`; "Not checked"; import never touches it; MCP requires an account once there are two or more |
| 19 | Mock parity, e2e seed | Mock parses the shared zod; e2e workbook without receipts; guards and resets in the mock |
| 20 | MCP write safety | Duplicate guard + `force`; `settleInvoicePayment` batch; guards repeated in tools; no delete by chat; `mcp_audit` unchanged, noted |
| 21 | Export for the commercialista | `toCsv` + Export CSV in PR 2, before the Excel is retired |
| 22 | Privacy | Optional free-text counterparty, no tenant entity, errors cite positions only, synthetic fixtures, scratchpad deletion |
| 23 | Personal vs full-mode boundaries | "company"/"personal" wording on both sides, `resolveCompanyAccount`, "Company Accounts" label, boundary tests (§8.9) |

**Out of scope, with the reason**

- **Bank-statement import**: the owner asked for it later; manual entry plus Check Balance covers v1.
- **F24 matching**: it floods the calendar with first-year artefacts; revisit after the cutover, only for events after the Saldo date.
- **Archived accounts, account kinds**: no account has closed; a cash account is a name.
- **Partial client payments (`paidAmount`)**: none in the file; small gaps are fees.
- **`Invoice.project`, issue date, VAT nature, stamp-duty tracking**: no current need. Consulting is the invoices' fixed label. The VAT nature and the bollo are the commercialista's.
- **Edit and delete by chat**: the web shows what changes. Admin writes bypass the adapter guards.
- **A second, different import file**: the Excel is retired at the Saldo date.
- **Foreign currency**: every amount in the file is EUR.
- **Export in the Excel layout**: only if the commercialista asks; the CSV opens in Excel.
- **Tenant entity, per-tenant ledgers**: `counterparty` covers the four deposits; privacy favours free text.
- **`deductiblePct`**: only if the commercialista says the donation is not (fully) deductible.

## 9. Decisioni aperte

Tutto il resto è deciso (conti, fatture fornitori facoltative, progetti, depositi, carta personale, un solo inserimento per cassa e Piano, web + chat, import di questo Excel). Restano quattro scelte tue.

### Decisione 1 — Incassi tramite piattaforma

La piattaforma freelance emette la fattura al posto tuo e ti paga al netto della commissione. Come li registro?

- **Lordo + commissione** _(consigliata)_: una fattura al lordo con il numero della piattaforma, segnata pagata, più un costo «Platform commission» (reverse charge, IVA 0) per la differenza. Il saldo resta uguale alla banca e la commissione diventa un costo deducibile. Il lordo lo prende dalla nota quando c'è; altrimenti lo scrivi tu dall'estratto della piattaforma.
- **Solo il netto**: un incasso cliente senza fattura per quanto è arrivato. È più semplice, ma la commissione non diventa mai un costo e il Piano paga un po' più IRES/IRAP del dovuto.

### Decisione 2 — Doppioni con i Costi e i Finanziamenti già nell'app

Se nell'app c'è già un costo una tantum o un finanziamento con lo stesso importo, entro un mese da una riga dell'Excel, cosa fa l'import di default? (Nell'anteprima puoi sempre cambiare la scelta coppia per coppia.)

- **Sostituisci con l'Excel** _(consigliata)_: all'import la riga vecchia viene cancellata (i suoi dati finiscono nel report scaricabile) e resta quella dell'Excel, con la data vera e il conto. Niente doppi nel Piano né in «SRL Owes You». I finanziamenti creati con i vecchi pulsanti hanno la data del clic, quindi sono quasi certamente doppioni.
- **Tieni entrambe**: l'import non cancella nulla, le coppie restano nel report e le sistemi tu nella pagina Costs. È più prudente, ma fino a quel momento il Piano conta due volte.

### Decisione 3 — Compenso da amministratore nel Piano

Oggi il Piano deduce il compenso annuo diviso 12 in ogni mese del 2026, anche prima che la società esistesse, e stima F24 di ritenute su un compenso che non hai ancora pagato.

- **Stima, come oggi** _(consigliata per ora)_: nessun cambiamento al motore. La scheda Months mostra «pagato» contro «stimato», e tu metti nelle impostazioni il compenso che pagherai davvero. Ne parli con il commercialista.
- **Solo il pagato**: nei mesi già chiusi il Piano deduce solo il compenso registrato, e niente prima della costituzione. È più vicino alla regola (si deduce quando è pagato), ma serve registrare anche il lordo e le ritenute, e costa una PR in più.

### Decisione 4 — Lavori di Via Esempio nel Piano

I lavori sono su una casa in affitto, non tua. Nel Piano si deducono tutti nel mese della fattura o si ripartiscono sulla durata della locazione?

- **Ripartiti sulla locazione** _(consigliata, se il commercialista conferma)_: un campo «Spread Over (months)» sul costo, e il Piano ne conta una quota al mese. Di solito le migliorie su beni di terzi si ammortizzano così. È una PR piccola dopo l'import.
- **Tutto nel mese**: come oggi. Il 2026 mostra una perdita grande, e IRES/IRAP e gli acconti stimati risultano troppo bassi.
