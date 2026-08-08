import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0009_rhythmcoach_personal_library.sql', 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(migration.includes('create table if not exists public.rhythmcoach_personal_materials'), 'RhythmCoach personal material table is missing');
expect(migration.includes('alter table public.rhythmcoach_personal_materials enable row level security'), 'Personal material RLS must be enabled');
expect(migration.includes("(select auth.uid()) = user_id"), 'Personal materials must remain user-scoped');
expect(migration.includes("'rhythmcoach.personal_library_cloud'"), 'Cloud-library entitlement mapping is missing');
expect(migration.includes("a.role = 'owner'"), 'Owner access must be explicit');
expect(migration.includes('title text') && migration.includes('content text'), 'Text material fields are missing');
expect(!/audio|recording|blob|storage\.objects/i.test(migration), 'RhythmCoach personal library migration must not create online audio storage');

console.log('RhythmCoach personal library contract checks passed');
