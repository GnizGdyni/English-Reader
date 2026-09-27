# English Reader — dictionary API (Railway)

## Co to jest
Mały serwer Node z `en.sqlite`. Endpoint jak lokalnie:

`GET /api/local-dict?q=feet`

## 1. Wrzuć bazę (raz)
Opcja A — **Supabase Storage** (masz już konto):
1. Storage → New bucket `dict` (public read OK dla tego pliku, to dane słownika)
2. Upload `data/dict/en.sqlite`
3. Skopiuj publiczny URL pliku

Opcja B — **GitHub Release**: utwórz release i dodaj `en.sqlite` jako asset, skopiuj link do pliku.

## 2. Deploy na Railway (zalecane)
1. Wejdź na https://railway.app → Login (GitHub)
2. **New Project** → **Deploy from GitHub repo** (ten projekt)  
   albo **Empty Project** → **Add service** → **GitHub Repo**
3. Ustaw **Root Directory** na `dict-api` (jeśli monorepo w `English Reader`)
4. Variables:
   - `DICT_DB_URL` = URL do `en.sqlite` z kroku 1
   - `CORS_ORIGIN` = `https://TWOJA-APKA.vercel.app,http://localhost:5173`
5. Deploy → skopiuj publiczny URL serwisu (np. `https://dict-api-xxxx.up.railway.app`)

Sprawdź:
- `https://…/health` → `{"ok":true,"db":true}`
- `https://…/api/local-dict?q=feet`

## 3. Podłącz front (Vercel)
W Vercel → Project → Settings → Environment Variables:

`VITE_DICT_API_URL=https://dict-api-xxxx.up.railway.app`

Redeploy frontu.

Lokalnie (opcjonalnie) w `.env.local`:

`VITE_DICT_API_URL=https://dict-api-xxxx.up.railway.app`

Bez tej zmiennej w `npm run dev` nadal działa lokalny Vite plugin.

## Test lokalny API
```bash
cd dict-api
# skopiuj bazę albo ustaw DICT_DB_URL
mkdir -p data && copy ..\data\dict\en.sqlite data\en.sqlite
npm start
# http://localhost:8080/api/local-dict?q=feet
```

## Uwagi free
- Pierwsze zapytanie po śnie bywa wolniejsze (cold start)
- Baza ~169 MB — pobiera się **raz** przy starcie kontenera (trwa chwilę)
- Nie commituj `en.sqlite` do gita
