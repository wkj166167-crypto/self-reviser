-- Self Reviser — Phase 1 persistent exhibition archive
-- Apply this migration in the Supabase SQL editor before enabling persistence.

create table if not exists public.exhibition_sessions (
  id uuid primary key,
  sequence_number bigint generated always as identity unique,
  status text not null default 'active' check (status in ('active', 'incomplete', 'completed', 'failed')),
  author_label text,
  language text not null default 'unknown' check (language in ('zh', 'en', 'mixed', 'unknown')),
  word_count integer not null default 0 check (word_count >= 0),
  document_state jsonb not null default '{}'::jsonb,
  write_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  revision_completed_at timestamptz
);

create table if not exists public.session_paragraphs (
  id uuid primary key,
  session_id uuid not null references public.exhibition_sessions(id) on delete cascade,
  position integer not null check (position >= 0),
  draft_text text not null default '',
  committed_text text not null default '',
  state text not null check (state in ('editing', 'pending', 'committed')),
  revision_status text not null default 'not_started',
  revision_pass_index integer not null default 0 check (revision_pass_index between 0 and 6),
  committed_at timestamptz,
  timing_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (session_id, position)
);

create table if not exists public.editorial_notes (
  id uuid primary key,
  session_id uuid not null references public.exhibition_sessions(id) on delete cascade,
  paragraph_id uuid not null references public.session_paragraphs(id) on delete cascade,
  note_number integer,
  source_quote text not null,
  category text,
  body text not null,
  status text not null default 'active',
  text_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_passes (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.exhibition_sessions(id) on delete cascade,
  paragraph_id uuid not null references public.session_paragraphs(id) on delete cascade,
  pass_number integer not null check (pass_number between 1 and 6),
  status text not null default 'pending',
  text_before text,
  text_after text,
  operations jsonb not null default '[]'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  timing_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (session_id, paragraph_id, pass_number)
);

create table if not exists public.archive_event_log (
  id bigint generated always as identity primary key,
  session_id uuid references public.exhibition_sessions(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists exhibition_sessions_status_updated_idx
  on public.exhibition_sessions (status, updated_at desc);
create index if not exists session_paragraphs_session_position_idx
  on public.session_paragraphs (session_id, position);
create index if not exists editorial_notes_session_paragraph_idx
  on public.editorial_notes (session_id, paragraph_id);
create index if not exists revision_passes_session_paragraph_idx
  on public.revision_passes (session_id, paragraph_id, pass_number);

-- One RPC keeps each autosave internally atomic. The raw document state is
-- retained on the session as the recovery source; normalised rows make Phase 2
-- archive browsing and Phase 3 exports efficient.
create or replace function public.save_archive_session(
  p_session_id uuid,
  p_document_state jsonb,
  p_language text,
  p_word_count integer,
  p_event_type text default 'autosave'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  note jsonb;
  pass jsonb;
  current_status text;
begin
  select status into current_status from public.exhibition_sessions where id = p_session_id for update;
  if current_status is null then
    raise exception 'Unknown archive session';
  end if;
  if current_status <> 'active' then
    raise exception 'Archive session is not active';
  end if;

  update public.exhibition_sessions
  set document_state = p_document_state,
      language = case when p_language in ('zh', 'en', 'mixed', 'unknown') then p_language else 'unknown' end,
      word_count = greatest(0, p_word_count),
      updated_at = now(),
      last_activity_at = now(),
      revision_completed_at = case
        when coalesce((p_document_state->'meta'->>'all_committed_revisions_complete')::boolean, false) then now()
        else revision_completed_at
      end
  where id = p_session_id;

  delete from public.revision_passes where session_id = p_session_id;
  delete from public.editorial_notes where session_id = p_session_id;
  delete from public.session_paragraphs where session_id = p_session_id;

  for item in select value from jsonb_array_elements(coalesce(p_document_state->'paragraphs', '[]'::jsonb)) loop
    insert into public.session_paragraphs (
      id, session_id, position, draft_text, committed_text, state,
      revision_status, revision_pass_index, committed_at, timing_data
    ) values (
      (item->>'id')::uuid,
      p_session_id,
      coalesce((item->>'position')::integer, 0),
      coalesce(item->>'text', ''),
      coalesce(item->>'committed_text', ''),
      case when item->>'state' in ('editing', 'pending', 'committed') then item->>'state' else 'editing' end,
      coalesce(item->'revision'->>'status', 'not_started'),
      greatest(0, least(6, coalesce((item->'revision'->>'pass_index')::integer, 0))),
      nullif(item->>'committed_at', '')::timestamptz,
      coalesce(item->'timing', '{}'::jsonb)
    );

    for note in select value from jsonb_array_elements(coalesce(item->'comments', '[]'::jsonb)) loop
      insert into public.editorial_notes (
        id, session_id, paragraph_id, note_number, source_quote, category,
        body, status, text_version, created_at, updated_at
      ) values (
        (note->>'id')::uuid,
        p_session_id,
        (item->>'id')::uuid,
        nullif(note->>'number', '')::integer,
        coalesce(note->>'source_quote', ''),
        nullif(note->>'category', ''),
        coalesce(note->>'text', ''),
        coalesce(note->>'status', 'active'),
        nullif(note->>'text_version', ''),
        coalesce(nullif(note->>'created_at', '')::timestamptz, now()),
        now()
      );
    end loop;

    for pass in select value from jsonb_array_elements(coalesce(item->'revision'->'history', '[]'::jsonb)) loop
      insert into public.revision_passes (
        session_id, paragraph_id, pass_number, status, text_before, text_after,
        operations, context_snapshot, timing_data, created_at, updated_at, completed_at
      ) values (
        p_session_id,
        (item->>'id')::uuid,
        (pass->>'pass_number')::integer,
        coalesce(pass->>'status', 'completed'),
        pass->>'text_before',
        pass->>'text_after',
        coalesce(pass->'operations', '[]'::jsonb),
        coalesce(pass->'context_snapshot', '{}'::jsonb),
        coalesce(pass->'timing', '{}'::jsonb),
        coalesce(nullif(pass->'timing'->>'started_at', '')::timestamptz, now()),
        now(),
        coalesce(nullif(pass->'timing'->>'completed_at', '')::timestamptz, now())
      );
    end loop;
  end loop;

  insert into public.archive_event_log (session_id, event_type, payload)
  values (p_session_id, p_event_type, jsonb_build_object('paragraph_count', jsonb_array_length(coalesce(p_document_state->'paragraphs', '[]'::jsonb))));
end;
$$;

alter table public.exhibition_sessions enable row level security;
alter table public.session_paragraphs enable row level security;
alter table public.editorial_notes enable row level security;
alter table public.revision_passes enable row level security;
alter table public.archive_event_log enable row level security;

revoke all on function public.save_archive_session(uuid, jsonb, text, integer, text) from public, anon, authenticated;
grant execute on function public.save_archive_session(uuid, jsonb, text, integer, text) to service_role;
