# Dubbel Uit

Een darts-scorebord als app voor je telefoon.

- **Camera telt je punten:** zet je telefoon naast het bord en hij herkent waar je darts zitten.
- **Tegen een bot:** van Starter (gemiddelde ± 30) tot Wereldtop (± 105), of elk gemiddelde tussen 20 en 115.
- **Wedstrijden met vrienden:** 301, 501 of 701, dubbel uit, met legs en sets, voor 1 tot 6 spelers.
- **Omroeper:** roept in het Nederlands je score, en wat je nodig hebt om uit te gooien.
- **Extra's:** uitgooiroutes, gemiddeldes, 180's en eerdere uitslagen. Werkt ook zonder internet.

**Openen:** https://dylanschutte172.github.io/dubbel-uit/

## Op je telefoon zetten

1. Open de link hierboven op je telefoon.
2. Zet hem op je beginscherm:
   - **Android (Chrome):** menu ⋮ → **App installeren** of **Toevoegen aan startscherm**
   - **iPhone (Safari):** deelknop (vierkantje met pijl) → **Zet op beginscherm**
3. Open Dubbel Uit voortaan via het icoon.

## De camera gebruiken

1. Zet je telefoon stevig neer (statief of houder), schuin voor het bord en iets lager, met het hele bord in beeld.
2. Ga in een wedstrijd naar **Camera** en druk op **Camera aan**. Geef toestemming voor de camera.
3. **Kalibreer:** tik de 4 punten aan die de app vraagt. Dat zijn punten op de buitenrand van de dubbelring, op de draad tussen twee nummers. Een geel rooster laat zien of het klopt.
4. Gooi. Na 3 darts zegt de app *"Haal je darts uit het bord"*.

**Tips:**
- **Verkeerd herkend?** Druk op **Herstel**. Gebruik daarna **Bord** om de juiste plek aan te tikken, of **Cijfers** om de hele beurt in te typen.
- **Dart naast het bord?** Druk op **Mis (0)**.
- **Spookdarts of gemiste darts?** Pas de **Gevoeligheid** aan onder *Camera-instellingen*.

## Code

Gewone HTML en JavaScript, zonder bouwstap: `logic.js` (regels, bot, uitgooiroutes), `vision.js` (camera) en `app.js` (scherm). Tests draaien met `node --test tests/logic.test.js tests/vision.test.js`.
