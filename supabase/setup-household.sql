-- Weekly Shop: create your household and say who may join it.
-- Run AFTER schema.sql. Edit the three emails first, then Run.
-- Nobody gets access unless their email is listed here (or added later by the owner).

do $$
declare
  owner_email   text := 'YOUR-EMAIL@example.com';        -- you
  partner_email text := 'YOUR-WIFES-EMAIL@example.com';  -- your wife
  agent_email   text := 'shop-agent@example.com';        -- the PC agent's login (see README step 4)
  hh uuid := '7d2f3c3e-9a51-4c1e-b8f4-2a6d5e0c9b11';
begin
  insert into public.households(id, name) values (hh, 'Home') on conflict (id) do nothing;
  insert into public.household_invites(household_id, email, role) values
    (hh, lower(owner_email), 'owner'),
    (hh, lower(partner_email), 'member'),
    (hh, lower(agent_email), 'agent')
  on conflict (household_id, email) do update set role = excluded.role;
end $$;
