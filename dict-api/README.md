# Dictionary API (opcjonalny fallback)

Osobny serwer Node ze SQLite — **nie jest wymagany**, jeśli słownik działa przez Supabase (`lookup_dict`).

Użyj tylko gdy chcesz hostować `en.sqlite` poza Postgresem (np. Railway).

Szczegóły setupu: główne [README](../README.md) oraz zmienna `VITE_DICT_API_URL` w `.env.example`.

```bash
# lokalnie
mkdir -p data && cp ../data/dict/en.sqlite data/en.sqlite
npm start
```
