-- English Reader — uruchom w Supabase SQL Editor

-- Książki (max 2 per user — limit w aplikacji)
create table if not exists user_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  format text not null check (format in ('pdf', 'epub', 'txt')),
  storage_path text not null,
  page int not null default 1,
  progress_cfi text,
  created_at timestamptz not null default now()
);

create index if not exists user_books_user_id_idx on user_books(user_id);

-- Fiszki
create table if not exists study_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  client_id text not null,
  term text not null,
  translation text not null,
  context text,
  explanation text,
  added_at bigint not null default 0,
  unique (user_id, client_id)
);

create index if not exists study_cards_user_id_idx on study_cards(user_id);

alter table user_books enable row level security;
alter table study_cards enable row level security;

create policy "user_books: own"
  on user_books for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "study_cards: own"
  on study_cards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Storage bucket: utwórz w panelu Storage nazwę "books", typ Private
-- Polityki storage (uruchom po utworzeniu bucketa):

create policy "books: read own"
  on storage.objects for select
  using (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "books: upload own"
  on storage.objects for insert
  with check (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "books: delete own"
  on storage.objects for delete
  using (
    bucket_id = 'books'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
