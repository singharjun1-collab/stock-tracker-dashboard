# Stock Chatter — Lemon Squeezy setup guide

This is a step-by-step walkthrough for connecting the new landing page to your existing **getfamilyfinance** Lemon Squeezy store so paying customers get auto-approved.

You'll do this once. After that, every new $199 subscription auto-approves on payment, and the user is sent straight to the dashboard the next time they sign in with Google.

**Time required:** about 15–20 minutes.

---

## Part 0 — Set your store refund policy

**Do this once, before creating the product.** Lemon Squeezy displays your store-level refund policy on every checkout page, and chargeback disputes go better when the buyer's confirmation email and the landing page agree.

Go to **Settings → Store → Refund policy**, and paste:

> All sales are final. We do not offer refunds. You may cancel future renewals at any time from your subscriber portal; you retain full access through the end of your paid year.

Click **Save**.

---

## Part 1 — Create the Stock Chatter product in Lemon Squeezy

### Step 1. Sign in to your Lemon Squeezy dashboard

Go to <https://app.lemonsqueezy.com> and sign in with your **getfamilyfinance** account.

### Step 2. Open your store

Click the store dropdown in the top-left and select your **getfamilyfinance** store.

### Step 3. Create a new product

In the left sidebar, click **Products** → **+ New product** (top right).

Fill in:

- **Product name**: `Stock Chatter — Annual`
- **Description**: `AI-first stock signals from 10 leading-indicator sources. Daily watchlist with entry, target and stop on every pick.`
- **Type**: **Subscription** (important — not "Single payment")
- **Price**: `$199.00 USD`
- **Billing interval**: **Yearly**
- **Trial**: **Off** (we are not offering a free trial — you decided this in the spec)
- **Tax category**: SaaS / Software
- **Statement descriptor**: `STOCKCHATTER`

Click **Save & publish**.

### Step 4. Copy the variant ID

After saving, you'll see your new product. Click into it.

In the URL bar, the product page looks like:
```
https://app.lemonsqueezy.com/products/123456
```
That number (`123456`) is the **product ID**.

Now scroll down to the **Variants** section and click into the variant. The URL will show:
```
https://app.lemonsqueezy.com/products/123456/variants/987654
```
That number (`987654`) is the **variant ID** — that's the one you actually need.

Also note your store's checkout URL. It looks like:
```
https://getfamilyfinance.lemonsqueezy.com/buy/<variant-id>
```

**Save these for Part 3.** ✏️

---

## Part 2 — Set up the webhook

This is what tells **Stock Chatter** that someone has paid, so we can auto-approve them.

### Step 1. Open Webhooks settings

In the Lemon Squeezy sidebar: **Settings** → **Webhooks**.

### Step 2. Click "+ Add endpoint"

Fill in:

- **URL**: `https://stocktracker.getfamilyfinance.com/api/webhooks/lemonsqueezy`
- **Signing secret**: click **Generate** (or type your own random string — at least 24 characters of random letters & numbers). **Copy this secret somewhere safe** — you'll paste it into Vercel in Part 3.
- **Events to subscribe to** (check ALL of these):
  - ✅ `subscription_created`
  - ✅ `subscription_updated`
  - ✅ `subscription_payment_success`
  - ✅ `subscription_cancelled`
  - ✅ `subscription_expired`
  - ✅ `subscription_paused`
  - ✅ `subscription_resumed`
  - ✅ `subscription_unpaused`
  - ✅ `order_created`

Click **Save**.

### Step 3. Send a test webhook

Right after saving, Lemon Squeezy gives you a **Send test event** button. Click it. You should see a green ✓ in the dashboard. (If you see red, double-check the URL — typos are the #1 cause.)

---

## Part 3 — Add the secrets to Vercel

These three values tell **Stock Chatter** how to handle Lemon Squeezy.

### Step 1. Open your Vercel dashboard

Go to <https://vercel.com> → sign in → click into the `stock-tracker-dashboard` project → **Settings** → **Environment Variables**.

### Step 2. Add three new environment variables

Click **Add new** for each one. Apply each to **Production**, **Preview**, AND **Development**.

| Key | Value | Where it came from |
| --- | --- | --- |
| `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` | `https://getfamilyfinance.lemonsqueezy.com/buy/<variant-id>` | Replace `<variant-id>` with the number from Part 1, Step 4 |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | The signing secret you generated | Part 2, Step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | (already set — verify it's there) | Supabase → Project settings → API |

The `NEXT_PUBLIC_` prefix on the checkout URL is intentional — it's the only one that needs to be visible to the browser. The webhook secret and service-role key MUST stay server-side only.

### Step 3. Redeploy

Vercel will prompt you to redeploy after editing env vars. Click **Redeploy** on the most recent production deployment.

---

## Part 4 — Run the database migration

The webhook writes to a new table called `subscriptions`. You need to create it once.

### Step 1. Open Supabase

Go to <https://supabase.com/dashboard> → sign in → click into the `second-brain` project → **SQL Editor** in the left sidebar.

### Step 2. Run the migration

Click **+ New query**, then paste the contents of:

```
/Users/ajsingh/Documents/GitHub/stock-tracker-dashboard/migrations/2026-04-29_lemonsqueezy_subscriptions.sql
```

Click **Run** (the green play button bottom-right). You should see "Success. No rows returned" — that means the table was created.

### Step 3. Verify

In the left sidebar, click **Table Editor**. You should now see `subscriptions` in the list. (It'll be empty for now — that's fine.)

---

## Part 5 — End-to-end test

### Step 1. Buy your own subscription (in test mode)

Lemon Squeezy has a **test mode** in the top toolbar — toggle it on. Then go to your landing page (`https://stocktracker.getfamilyfinance.com`) and click **Start — $199/year**.

Use one of these test cards:

- **Success**: `4242 4242 4242 4242` — any future date, any CVC
- **Decline**: `4000 0000 0000 0002`

After payment:

1. Within ~5 seconds your `subscriptions` table in Supabase should show a new row with your email.
2. If you've already signed in to Stock Chatter with that email, refresh the page and you should be auto-redirected to the dashboard.
3. If you haven't signed in yet, click **Sign in** in the top nav, sign in with the same Google account, and you'll go straight to the dashboard.

### Step 2. If something goes wrong

| Symptom | Fix |
| --- | --- |
| "Coming soon" button on landing | `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` not set in Vercel |
| Webhook test fails with 401 | `LEMONSQUEEZY_WEBHOOK_SECRET` doesn't match what's in Lemon Squeezy |
| Webhook test fails with 500 | `SUPABASE_SERVICE_ROLE_KEY` not set, or migration not run |
| Paid but still on /pending | Look at Vercel → Functions → Logs for `[lemonsqueezy webhook]` errors |

### Step 3. Switch to live mode

Once tested, toggle **test mode OFF** in Lemon Squeezy. You're live. 🎉

---

## What happens to existing approved users?

Nothing. They stay approved. The webhook only flips `pending → approved`, never the other direction unless a subscription explicitly expires.

You and Angad (the existing distribution list members) keep your current access untouched.

---

## Quick reference — what each env var does

```
NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL  → the "Subscribe" button target on the landing page
LEMONSQUEEZY_WEBHOOK_SECRET            → used to verify webhook signatures (security)
SUPABASE_SERVICE_ROLE_KEY              → lets the webhook write to subscriptions + profiles
NEXT_PUBLIC_SUPABASE_URL               → already set — Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY          → already set — public Supabase key
```

---

If you hit a snag, send me a screenshot of:

1. Lemon Squeezy → Webhooks → the failed delivery's response body, AND
2. Vercel → Functions → Logs at the same timestamp.

I can debug from those two pieces.
