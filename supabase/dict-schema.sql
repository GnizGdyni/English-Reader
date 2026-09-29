-- Dictionary (Kaikki slim) — uruchom w Supabase SQL Editor PRZED importem
-- Tabele publiczne (tylko SELECT) — dane słownika, nie dane użytkownika

create table if not exists dict_words (
  word text not null,
  pos text not null,
  gloss text,
  primary key (word, pos)
);

create table if not exists dict_forms (
  form text not null,
  word text not null,
  pos text not null,
  tags text,
  primary key (form, word, pos)
);

create table if not exists dict_examples (
  id bigserial primary key,
  word text not null,
  pos text not null,
  example text not null
);

create index if not exists dict_words_word_lower_idx on dict_words (lower(word));
create index if not exists dict_forms_form_lower_idx on dict_forms (lower(form));
create index if not exists dict_examples_word_lower_idx on dict_examples (lower(word));

alter table dict_words enable row level security;
alter table dict_forms enable row level security;
alter table dict_examples enable row level security;

drop policy if exists "dict_words: public read" on dict_words;
create policy "dict_words: public read"
  on dict_words for select
  to anon, authenticated
  using (true);

drop policy if exists "dict_forms: public read" on dict_forms;
create policy "dict_forms: public read"
  on dict_forms for select
  to anon, authenticated
  using (true);

drop policy if exists "dict_examples: public read" on dict_examples;
create policy "dict_examples: public read"
  on dict_examples for select
  to anon, authenticated
  using (true);

-- Jedno zapytanie z apki (ten sam kontrakt co /api/local-dict)
create or replace function public.lookup_dict(raw_q text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  q text;
  lemma text;
  via_form text;
  via_lemma text;
  via_pos text;
  via_tags text;
  entries jsonb := '[]'::jsonb;
  row_rec record;
  ex_arr text[];
begin
  q := lower(trim(coalesce(raw_q, '')));
  if q = '' or length(q) > 48 then
    return jsonb_build_object(
      'ok', false,
      'query', coalesce(raw_q, ''),
      'reason', 'invalid_query'
    );
  end if;

  lemma := q;
  via_form := null;
  via_lemma := null;
  via_pos := null;
  via_tags := null;

  select f.form, f.word, f.pos, f.tags
    into via_form, via_lemma, via_pos, via_tags
  from dict_forms f
  where lower(f.form) = q
  order by case when lower(f.word) <> q then 0 else 1 end
  limit 1;

  if via_lemma is not null then
    lemma := via_lemma;
  end if;

  if not exists (
    select 1 from dict_words w where lower(w.word) = lower(lemma) limit 1
  ) and lemma <> q then
    lemma := q;
    via_form := null;
    via_lemma := null;
    via_pos := null;
    via_tags := null;
  end if;

  for row_rec in
    select w.word, w.pos, w.gloss
    from dict_words w
    where lower(w.word) = lower(lemma)
    limit 6
  loop
    select coalesce(array_agg(e.example), array[]::text[])
      into ex_arr
    from (
      select example
      from dict_examples
      where lower(word) = lower(row_rec.word)
      limit 1
    ) e;

    entries := entries || jsonb_build_array(
      jsonb_build_object(
        'word', row_rec.word,
        'pos', row_rec.pos,
        'gloss', row_rec.gloss,
        'examples', to_jsonb(ex_arr)
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'query', q,
    'lemma', lemma,
    'viaForm', case
      when via_form is null then null
      else jsonb_build_object(
        'form', via_form,
        'lemma', via_lemma,
        'pos', via_pos,
        'tags', via_tags
      )
    end,
    'entries', entries
  );
end;
$$;

grant execute on function public.lookup_dict(text) to anon, authenticated;
