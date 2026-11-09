-- Campus Vision: вставьте весь файл в Supabase -> SQL Editor -> Run
create extension if not exists pgcrypto;

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('student','teacher')),
  full_name text not null,
  group_name text,
  phone text,
  external_id text,                       -- ID в университетской системе баллов
  consent boolean not null default false, -- согласие на биометрию
  descriptors jsonb not null default '[]',-- эмбеддинги лица (128 чисел каждый)
  appearance jsonb not null default '[]', -- цвет формы/одежды при разном свете
  descriptor_count int not null default 0,
  rating_points numeric not null default 0,
  module_points numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  group_name text,
  teacher_id uuid references people(id) on delete set null,
  room text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  grace_min int not null default 5,
  status text not null default 'planned',
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  first_seen timestamptz,
  status text not null check (status in ('present','late','absent')),
  late_minutes int not null default 0,
  unique (lesson_id, person_id)
);

create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  label text not null,
  role text not null default 'student' check (role in ('student','teacher','both')),
  min_seconds int not null default 0,
  base_points numeric not null default 0,       -- минус = штраф, плюс = бонус
  per_minute_points numeric not null default 0, -- за каждую следующую минуту
  target text not null default 'both' check (target in ('rating','module','both')),
  auto_apply boolean not null default false,    -- false = сначала проверка человеком
  active boolean not null default true
);

create table if not exists activity_log (
  id bigserial primary key,
  lesson_id uuid references lessons(id) on delete cascade,
  person_id uuid references people(id) on delete cascade,
  state text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_s int not null,
  confidence real,
  created_at timestamptz not null default now()
);

create table if not exists violations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete set null,
  rule_id uuid references rules(id) on delete set null,
  state text not null,
  seconds int not null default 0,
  points numeric not null,
  target text not null,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists point_log (
  id bigserial primary key,
  person_id uuid not null references people(id) on delete cascade,
  violation_id uuid references violations(id) on delete set null,
  delta numeric not null,
  target text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_att_lesson on attendance(lesson_id);
create index if not exists idx_act_lesson on activity_log(lesson_id, person_id);
create index if not exists idx_act_person on activity_log(person_id, started_at desc);
create index if not exists idx_viol_status on violations(status, created_at desc);
create index if not exists idx_pl_person on point_log(person_id, created_at desc);

-- Доступ только через сервер (service key). Публичный доступ закрыт.
alter table people enable row level security;
alter table lessons enable row level security;
alter table attendance enable row level security;
alter table rules enable row level security;
alter table activity_log enable row level security;
alter table violations enable row level security;
alter table point_log enable row level security;

insert into rules (state,label,role,min_seconds,base_points,per_minute_points,target,auto_apply,active) values
 ('late',    'Опоздание',                 'student',  0, -1, -0.5, 'both', true,  true),
 ('absent',  'Не пришёл на занятие',      'student',  0, -5,  0,   'both', true,  true),
 ('phone',   'Телефон на занятии',        'student', 30, -1, -1,   'both', false, true),
 ('lying',   'Лежит / голова на парте',   'student', 60, -2, -1,   'both', false, true),
 ('away',    'Отвернулся от занятия',     'student',120, -1, -0.5, 'both', false, true),
 ('standing','Стоит / вышел из-за парты', 'student',120, -1,  0,   'both', false, false),
 ('board',   'Отвечает у доски',          'student', 60,  1,  0,   'both', false, true),
 ('late',    'Опоздание преподавателя',   'teacher',  0,  0,  0,   'both', true,  true);
