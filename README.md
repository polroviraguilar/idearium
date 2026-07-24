# Idearium

Idearium és una aplicació web privada i instal·lable per capturar, ordenar i desenvolupar idees. Està pensada per a un sol usuari, no necessita cap compte i desa les dades localment al navegador. Només utilitza un petit servidor per fer la transcripció de veu amb alta precisió.

## Funcionalitats principals

- Crear, editar, fixar, arxivar, cercar i categoritzar notes.
- Afegir etiquetes separades per comes.
- Gravar notes de veu des del navegador.
- Transcriure les gravacions i crear automàticament una entrada a **Pendent de revisió**.
- Conservar l'àudio original al costat de la transcripció.
- Reintentar una transcripció fallida sense perdre la gravació.
- Adjuntar imatges, àudios, vídeos, documents i qualsevol altre tipus de fitxer.
- Afegir enllaços, amb previsualització automàtica de YouTube, Spotify i imatges directes.
- Consultar i editar les dades sense connexió.
- Instal·lar l'aplicació com a PWA.
- Exportar i restaurar una còpia JSON completa, inclosos els adjunts.
- Utilitzar tema clar o fosc.

## Arquitectura

```text
Navegador / PWA instal·lada
  React + TypeScript + Vite
  Dexie / IndexedDB
    notes
    categories
    adjunts binaris

POST /api/transcribe
  Servidor Express
  API de transcripció d'OpenAI
```

La clau de l'API no s'envia mai al navegador. Es conserva exclusivament al fitxer `.env` del servidor.

## Requisits

- Node.js 20 o superior.
- npm.
- Un navegador modern amb IndexedDB i MediaRecorder.
- Una clau de l'API d'OpenAI només si vols utilitzar la transcripció de veu.

## Instal·lació

Obre una terminal dins la carpeta del projecte i executa:

```bash
npm install
```

A Windows PowerShell, crea el fitxer de configuració amb:

```powershell
Copy-Item .env.example .env
```

A macOS o Linux:

```bash
cp .env.example .env
```

Obre el fitxer `.env` i substitueix el valor de mostra:

```env
OPENAI_API_KEY=sk-la-teva-clau
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
PORT=8787
```

No enganxis la clau a `src`, `vite.config.ts`, IndexedDB ni cap fitxer que puguis publicar a Git.

## Executar en desenvolupament

Des de l'arrel del projecte:

```bash
npm run dev
```

Obre aquesta adreça al navegador:

```text
http://localhost:5173
```

Vite redirigeix automàticament les crides `/api/*` cap a `http://localhost:8787`.

## Compilar i executar en producció

```bash
npm run build
npm start
```

El servidor Express servirà tant la PWA compilada com l'endpoint de transcripció:

```text
http://localhost:8787
```

Per utilitzar el micròfon fora de `localhost`, has de publicar l'aplicació sota HTTPS.

## Persistència de dades

Les notes i els adjunts es desen a la base de dades IndexedDB `idearium` del navegador.

Això implica que:

- No necessites SQL Server, MySQL ni cap altre servidor de base de dades.
- Les notes continuen disponibles sense connexió.
- Cada navegador i cada perfil tenen una base de dades diferent.
- Esborrar les dades del lloc web pot eliminar tota la informació.
- Els fitxers grans consumeixen la quota d'emmagatzematge del navegador.

Idearium demana al navegador emmagatzematge persistent, però igualment convé utilitzar **Exportar còpia** regularment. La importació substitueix totes les dades locals actuals.

## Flux d'una nota de veu

1. Prem el botó del micròfon.
2. Autoritza l'accés al micròfon.
3. Selecciona l'idioma principal o deixa activa la detecció automàtica.
4. Escriu noms propis, sigles o termes especialitzats al camp de context si cal.
5. Grava i revisa l'àudio.
6. Prem **Transcriure i crear nota**.
7. Idearium crea una entrada a **Pendent de revisió** i hi adjunta la gravació original.

Si el servidor no està disponible o falta la clau de l'API, pots desar l'àudio igualment. La nota quedarà marcada com a pendent i podràs reintentar la transcripció més endavant.

## Limitacions actuals

- La transcripció fora de línia no està inclosa. Afegir Whisper local augmentaria molt la mida i els requisits de maquinari.
- IndexedDB és adequada per a una aplicació personal en un dispositiu, però no sincronitza automàticament diversos dispositius.
- La quota disponible varia segons el navegador i el sistema operatiu.
- Les previsualitzacions incrustades depenen del proveïdor extern i necessiten connexió.

## Estructura del projecte

```text
idearium/
  public/icons/            Icones de la PWA
  server/index.ts          API de transcripció i servidor de producció
  src/components/          Components de la interfície
  src/lib/db.ts            Esquema IndexedDB i còpies de seguretat
  src/lib/media.ts         Detecció i previsualització de mitjans
  src/App.tsx              Estat i fluxos principals
  src/styles.css           Sistema visual responsive
  vite.config.ts           Configuració de la PWA i proxy de desenvolupament
```
