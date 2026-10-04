# Product Editor — operating guide

For whoever updates product information. No GitHub account needed.

Open:

    https://www.rigebalighting.com/admin/products-editor.html?token=YOUR-TOKEN

The link above is personal. Keep it to yourself — anyone who has it can change
prices on the live site. Your name is recorded in the commit message, so we can
always tell who changed what.

The token is remembered in that browser after the first visit, so you normally
just open `/admin/products-editor.html` from then on.

## Finding a product

Type part of the model number (for example `ML420WC`) or a phrase from the name,
or pick a category. Click a row to load it.

## What you can change

| Field | Notes |
|---|---|
| Product name | The long name shown as the page heading |
| Short label | The compact name used on cards and filters |
| EXW price | USD, per unit. This is the number buyers see |
| MOQ | Minimum order quantity in pieces |
| Tagline | One-line summary |
| Short description | Used in listings and in search results |
| Key features | One per line |
| Applications | One per line |

You cannot change the model number, the product URL, the category or the
photograph. Those decide which page exists and what its address is; changing one
would break links that buyers have already saved. Ask the site owner if
something in that list needs to change.

## Saving

Press **Save changes**. Only the fields you actually touched are sent.

The save writes to the site and the site rebuilds. **The change is live in about
two minutes.** If a product page still shows the old price after five minutes,
tell the site owner — it did not deploy.

## Catalogue settings

The bottom panel shows the currency, default MOQ and category labels. These are
read-only; ask the site owner to change them.

## Why there is a separate editor

The product catalogue is a 1.19 MB file, and GitHub refuses to hand back files
over 1 MB through the API the old CMS used. The old CMS could not open the
catalogue at all, which is why it felt unusable. This editor reads and writes it
through a different path that has no size limit, and handles one product at a
time so you never wait on the other 631.

## If something goes wrong

- **"Unauthorized"** — the token is wrong or not saved. Open your personal link
  again.
- **"Could not read the catalogue"** — the site is briefly unreachable or
  deploying. Wait a minute and retry.
- **A field is greyed out / rejected** — it is not in the editable list above.
