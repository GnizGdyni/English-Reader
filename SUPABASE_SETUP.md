# Podłączenie Supabase do English Reader

Kod jest już w projekcie. Zrób te kroki w panelu Supabase i lokalnie.

## 1. Projekt Supabase

1. [supabase.com](https://supabase.com) → **New project**
2. Region: **Frankfurt** (blisko Polski)
3. Zapisz hasło bazy

## 2. Klucze API

**Project Settings** → **API** → skopiuj:

- **Project URL**
- **anon public** key

## 3. Plik lokalny

W folderze `English Reader`:

```bash
copy .env.example .env.local
```

Uzupełnij `.env.local`:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Restart dev servera: `npm run dev`

## 4. Baza — SQL

**SQL Editor** → wklej całą zawartość pliku:

`supabase/schema.sql`

Klik **Run**.

## 5. Storage (pliki książek)

1. **Storage** → **New bucket**
2. Name: `books`
3. **Private** (nie public)
4. W **SQL Editor** uruchom ponownie sekcję polityk storage z `schema.sql` (od `create policy "books: read own"`)

## 6. Auth (logowanie + reset hasła)

**Authentication** → **Providers** → **Email** → włącz

Na start (bez maila potwierdzającego przy rejestracji):

**Authentication** → **Providers** → Email → wyłącz **Confirm email**

### Reset hasła — obowiązkowe URL-e

**Authentication** → **URL Configuration**:

1. **Site URL**
   - lokalnie: `http://localhost:5173`
   - produkcja: `https://twoja-domena.vercel.app`

2. **Redirect URLs** — dodaj (Add URL):
   - `http://localhost:5173/**`
   - `https://twoja-domena.vercel.app/**`

Bez tych URL link z maila nie wróci do apki.

### Szablon maila (opcjonalnie)

**Authentication** → **Email Templates** → **Reset Password**  
Możesz zostawić domyślny tekst.

### Jak testować w apce

1. Zaloguj / Zarejestruj → **Nie pamiętam hasła**
2. Podaj email → **Wyślij link**
3. Otwórz mail (sprawdź spam)
4. Kliknij link → apka otworzy formularz **Nowe hasło**
5. Ustaw hasło → gotowe

## 7. Vercel (produkcja)

Vercel → projekt → **Settings** → **Environment Variables**:

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |

**Redeploy** po dodaniu zmiennych.

## Co działa po podłączeniu

- Przycisk **Zaloguj / Zarejestruj** na stronie głównej
- Po logowaniu: **Moja biblioteka** (max 2 książki, usuwanie, otwieranie)
- Sync **fiszek** do chmury
- Sync **strony** dla książek z biblioteki (PDF + EPUB)

Bez `.env.local` apka działa jak wcześniej — upload lokalny, fiszki w przeglądarce.

## Limity (darmowy tier)

- Supabase: ~500 MB bazy, ~1 GB storage, ~50k użytkowników auth/mies.
- Max 2 książki — limit w aplikacji

## Problemy

| Błąd | Rozwiązanie |
|------|-------------|
| Brak przycisku logowania | Brak env — dodaj `.env.local` |
| `row-level security` | Uruchom `schema.sql` |
| Upload książki fail | Bucket `books` + polityki storage |
| Logowanie nie działa | Włącz Email provider, wyłącz confirm email na test |
