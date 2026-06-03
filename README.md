# Besloten fotogalerij

Dit is een kleine website voor Render waar bezoekers met hun naam en een wachtwoord foto's per galerij kunnen bekijken en downloaden. Via de beheerpagina kun je galerijen aanmaken/verwijderen, foto's per galerij uploaden/verwijderen en zien wie welke foto's heeft gedownload.

## Lokaal starten

1. Start de website:

   ```bash
   npm start
   ```

2. Open `http://localhost:3000`.

Standaard is het lokale bezoekerswachtwoord `veranderdit`. Het lokale beheerderswachtwoord is `beheerdit`. Zet voor echt gebruik altijd eigen wachtwoorden via `GALLERY_PASSWORD` en `ADMIN_PASSWORD`.

## Op Render zetten

Maak op Render een nieuwe **Web Service** aan en gebruik deze instellingen:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `Node`

Omdat deze site geen externe pakketten gebruikt, mag je de Build Command op Render ook leeg laten als Render dat toestaat.

Voeg bij **Environment Variables** toe:

- `GALLERY_PASSWORD`: het wachtwoord voor gewone bezoekers
- `ADMIN_PASSWORD`: het aparte wachtwoord voor beheer
- `SESSION_SECRET`: een lange willekeurige tekst, bijvoorbeeld 40 tekens of meer
- `NODE_ENV`: `production`
- `CLOUDINARY_CLOUD_NAME`: je Cloudinary cloud name
- `CLOUDINARY_API_KEY`: je Cloudinary API key
- `CLOUDINARY_API_SECRET`: je Cloudinary API secret

Optioneel:

- `CLOUDINARY_BASE_FOLDER`: de hoofdmap in Cloudinary, standaard `fetish-social-brabant`

## Foto's bewaren op Render

Uploads, galerijen en downloadlogs in een gewone Render Web Service kunnen verdwijnen bij een nieuwe deploy. Wil je alles via de beheerpagina beheren en bewaren, voeg dan een Render Disk toe en zet:

- `UPLOAD_DIR`: het pad van die disk, bijvoorbeeld `/data/uploads`

Met Cloudinary staan de foto’s zelf in Cloudinary. Het galerijbestand, de Cloudinary-fotolijst en het downloadlog worden standaard in deze map bewaard. Wil je aparte paden gebruiken, zet dan `GALLERY_FILE`, `CLOUDINARY_PHOTO_FILE` en `DOWNLOAD_LOG_FILE`.

Het bezoekerswachtwoord dat je via beheer aanpast wordt opgeslagen in `SETTINGS_FILE`. Op Render kun je hiervoor bijvoorbeeld zetten:

- `SETTINGS_FILE=/data/settings.json`

Zonder disk kun je foto's beter lokaal in de map `uploads` zetten en daarna opnieuw deployen.
