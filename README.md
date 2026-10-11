# Weekly Shop

The household shop planner as its own app. It sits on both iPhones with its own icon, the two phones share one live list, and a small agent on the PC adds the finished list to your booked Waitrose order. You still confirm and pay in the Waitrose app yourselves.

```
 iPhone (Owen) ─┐                         ┌─ PC agent ── waitrose.com (signed in on the PC only)
                ├── Supabase database ────┤
 iPhone (Zoe) ──┘   (your lists, private) └─ never checks out, never pays
```

| Folder | What it is |
|---|---|
| `app/` | The app itself (a web app you add to the Home Screen). Published free by GitHub Pages. |
| `supabase/` | The database setup: tables, and the rules for who may see and change what. |
| `agent/` | The PC agent (Python). It refreshes prices, finds new products, and fills the booked order. |
| `.github/workflows/` | Publishes `app/` whenever you change it on GitHub. |

**Keep `seed-data.sql` out of this repository.** It holds your shopping history and lists. This repository is public, so that file stays on your PC and goes straight into Supabase (step 2).

---

## How it's kept secure

- **The Waitrose login never leaves the PC.** You sign in to Waitrose once, by hand, in the agent's own browser window on the PC. The phones never see it, and neither does the database.
- **The agent can't buy anything.** It only adds items or raises quantities in an order you've already booked. It never removes anything, never lowers a quantity, and its browser blocks any checkout or payment page.
- **Only invited people can get in.** New sign-ups are switched off. You add each person yourself, and the database only shows a household's data to its members. That rule is enforced by the database, not by the app.
- **Sign-in is a password your iPhone keeps.** You each sign in once with your email and password; the iPhone saves it and fills it with Face ID, and the app stays signed in. You can also turn on Face ID sign-in (a passkey). The app sends no emails, so nothing here costs money.
- **The agent has its own, limited account.** It can update prices, product look-ups, recipes, items and a week's status. It can't delete anything, create anything new, or change stock levels. Its password is kept in Windows Credential Manager, not in a file.
- **The address and publishable key in `app/config.js` are fine to be public.** They're designed to be. On their own they show nothing, because of the rules above.

One thing to know: automating Waitrose's website may go against their terms of use. The agent works slowly, like a person, on your own account only, and you approve every order in the Waitrose app.

---

## Setting it up (about 45 minutes, once)

You'll need your GitHub account, a computer browser, and the PC.

### 1. Supabase project (the database)

1. Go to **supabase.com** and choose **Sign in with GitHub**. Create an organisation (Free plan), then **New project**: name it `weekly-shop`, choose a strong database password (store it in your password manager; you won't need it day to day), region **London (eu-west-2)**.
2. When it's ready, open **SQL Editor** → **New query**. Paste the whole of `supabase/schema.sql` and press **Run**. It should say *Success*.
3. New query: paste `supabase/setup-household.sql`. **Change the three emails at the top first:**
   - `owner_email`: your email
   - `partner_email`: Zoe's email
   - `agent_email`: an address just for the agent. A "plus" version of your Gmail is ideal, e.g. `yourname+shopagent@gmail.com`.

   Then press **Run**.
4. New query: open `seed-data.sql` from your PC (the private file, not in this repository), paste it all, and press **Run**. This loads your meals, staples, prices, recipes and the current week.

### 2. Sign-in settings

In the Supabase dashboard, under **Authentication**:

1. **Sign In / Providers → Email**: keep Email on. Turn **off** "Allow new users to sign up". Save.
2. **Users → Add user → Create new user**, three times:
   - your email and a strong password you'll use to sign in (10+ characters), tick **Auto Confirm User**
   - Zoe's email and a password for her (give it to her in person; she can change it in the app)
   - the agent email, with a **strong password you keep** (you type it once into the PC agent). Tick **Auto Confirm User**.
3. **URL Configuration**: set **Site URL** to `https://<your-github-name>.github.io/weekly-shop/`.
4. **Passkeys**: turn on **Enable Passkey authentication**, set **Relying Party ID** to `<your-github-name>.github.io` and **Relying Party Origins** to `https://<your-github-name>.github.io`. Don't change the ID later (it would invalidate existing Face ID sign-ins). Supabase marks passkeys experimental; if it won't save, skip it. The saved password still signs you in with Face ID.

Then **Project Settings → API Keys**: copy the **Project URL** and the **publishable key** (or the legacy `anon` key). Never use the `service_role` / secret key in the app.

### 3. Put the app on GitHub

1. Open `app/config.js` and paste in the two values:
   ```js
   window.WS_CONFIG = { supabaseUrl: "https://abcd1234.supabase.co", supabaseKey: "sb_publishable_..." };
   ```
2. On github.com: **New repository** → name `weekly-shop` → **Public** → Create.
3. On the new repository page choose **uploading an existing file**. Drag in **everything inside this folder** (`app`, `agent`, `supabase`, `.github`, `README.md`, `.gitignore`), then **Commit changes**. (If the `.github` folder doesn't come across, use **Add file → Create new file**, type `.github/workflows/pages.yml` as the name, and paste the file's contents.)
4. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
5. Open the **Actions** tab → **Deploy app to GitHub Pages** → **Run workflow**. When it shows a green tick (a minute or two), the app is live at
   `https://<your-github-name>.github.io/weekly-shop/`

### 4. Install on both iPhones

On each phone:

1. Open the address above in **Safari** (it must be Safari).
2. Tap **Share** → **Add to Home Screen** → **Add**. You now have a green basket icon called *Shop*.
3. Open the app **from the new icon** (it keeps its own sign-in, separate from Safari).
4. Enter your email and password → **Sign in**. When the iPhone offers to save the password, tap **Save**.
5. When it asks *Use Face ID to sign in next time?*, tap **Set up Face ID sign-in**.

Zoe does the same with her email. The first time she signs in, her invitation turns into membership of the household.

### 5. The PC agent

1. Install **Python 3.11 or newer** from python.org. During setup, tick **Add python.exe to PATH**.
2. Copy the `agent` folder somewhere permanent, e.g. `Documents\weekly-shop-agent`.
3. Double-click **`install.bat`**. It sets up its own Python environment and a browser.
4. Double-click **`run_setup.bat`**. It asks for:
   - the Supabase Project URL and publishable key (as above)
   - the agent email, and the agent's password (stored in Windows Credential Manager)

   Then a browser window opens on waitrose.com. **Sign in to Waitrose yourself** in that window, then press Enter in the black window. It finishes with a check of both connections.

### 6. The first real run, supervised

The agent starts in **dry-run** mode: it only reports what it would add.

1. Book your Waitrose delivery slot as usual.
2. In the app, plan the week and tap **Mark ready**.
3. On the PC, open a command prompt in the agent folder and run:
   ```
   .venv\Scripts\activate
   python agent.py fill          (or double-click dry_run.bat)
   ```
   In the app you'll see an **Agent report** listing what it found on Waitrose. Check the matches look right.
4. Now the real thing, watching the browser:
   ```
   python agent.py fill --commit --interactive          (or double-click first_real_run.bat)
   ```
   It opens your orders, clicks **Amend** on the order for that delivery date, then searches for and adds each item. If it can't find the Amend button, it asks you to open the order in amend mode yourself and press Enter.
5. Open the Waitrose app, check the order, and confirm the changes.

If that went well, set `FILL_MODE=commit` in the agent's `.env` file (open it with Notepad).

### 7. Keep it running

Double-click **`autostart.bat`** once. From then on the agent starts (minimised) whenever you log in to the PC. Every 10 minutes it checks for work:

- **Check latest prices** tapped on a phone → it refreshes prices.
- A product typed into **Inventory update** that it needs to find on Waitrose → it finds it.
- A week marked **ready** → it fills the booked order (or does a dry run, if you left `FILL_MODE=dry-run`) and posts its report to the app.

The browser window only opens while it's working. If the PC is off, nothing is lost: it catches up when you next log in. Make sure the PC is on before the 11pm amend cut-off.

---

## Day to day

- **Plan** in the app on either phone. Changes appear on the other phone within a second or two.
- Tap **Mark ready** when the week is settled. Changed your mind later? Edit, then **Mark ready again**: the agent adds anything new, and doesn't double up what's already in the order.
- Read the **Agent report**, then confirm the order in the Waitrose app.

## When something goes wrong

| You see | Do this |
|---|---|
| "The PC isn't signed in to Waitrose any more" | On the PC double-click `login.bat`, sign in, then tap **Mark ready** again. |
| "Couldn't find a booked order delivering …" | Check the slot is booked for that date. Then on the PC double-click `first_real_run.bat` and show it the order. |
| An item marked ✗ in the report | Waitrose couldn't find a close match (renamed or discontinued). Pick a replacement in **Inventory update**, or add it in the Waitrose app. |
| "That email and password don't match" | Check the password. For a forgotten one, run in the SQL Editor: `update auth.users set encrypted_password = extensions.crypt('NEW-PASSWORD', extensions.gen_salt('bf')) where email = 'their@email.com';` |
| "…hasn't been invited to a household" | Add their email to `household_invites` (run `setup-household.sql` again with it). |
| The agent picks wrong products everywhere | Waitrose has changed their pages. The selectors are all in `SEL` at the top of `agent/waitrose.py`. Send Claude the agent's error and a screenshot and it can update them. |
| You want to see what the agent did | `agent.log` in the agent folder. |

## Changing the app later

Edit files in `app/` on GitHub (or upload new versions). The site republishes itself in a minute or two. The phones pick up the new version the next time the app is opened while online. If one seems stuck on an old version, close the app fully and open it again.
