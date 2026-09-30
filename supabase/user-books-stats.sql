-- Uruchom w Supabase SQL Editor (istniejące projekty)
-- Dodaje czas czytania + postęp % dla własnych książek

alter table user_books
  add column if not exists reading_seconds int not null default 0;

alter table user_books
  add column if not exists total_pages int;

alter table user_books
  add column if not exists progress_percent int not null default 0
    check (progress_percent >= 0 and progress_percent <= 100);

create or replace function public.increment_book_reading_time(
  p_book_id uuid,
  p_seconds int
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_seconds is null or p_seconds <= 0 then
    return;
  end if;
  update user_books
  set reading_seconds = reading_seconds + p_seconds
  where id = p_book_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.increment_book_reading_time(uuid, int)
  to authenticated;
