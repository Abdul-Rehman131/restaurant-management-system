# Client demo script (10 minutes)

One order's whole journey, live on three screens: waiter phone, kitchen, cashier. Then the
owner's view. Everything runs on **staging** with the clearly fake "Ember Kitchen (Demo)" menu
(setup-checklist.md, "Demo deploy today").

## Before the client arrives (15 minutes)

- **Devices:**
  - a phone for the waiter (the app added to the Home Screen);
  - a laptop with two browser windows side by side, the kitchen on the left and the cashier
    on the right;
  - the receipt printer (or "Save as PDF").
- **Accounts:** the four staging accounts from the vault (`waiter`, `chef`, `cashier`, `admin`),
  and the Admin's authenticator on your own phone. Sign in to all of them now, not in front of
  the client.
- **Shifts:** tap **Start shift** on the waiter phone, the kitchen and the cashier (each shows
  **Shift on**). Turn the volume up.
- **Clean slate:** no open bills on the cashier screen. Pay or cancel leftovers from the rehearsal.

## The demo

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | All | Show the three screens. | "One order, one pipeline: waiter, kitchen, cashier, owner. Each person sees only their screen." |
| 1:00 | Waiter phone | **Tables** → Table 2 → add Chicken Tikka, Garlic Naan ×2, Daal Makhani, Mineral Water (500 ml); note on the Tikka "extra spicy" → **Review** → **Send to Kitchen**. | "Under a minute, no paper. The total is worked out by the server, never typed." |
| 2:30 | Kitchen | The ticket appears with a chime, within about 2 seconds. | "No prices in the kitchen. The bottled water never shows here: nothing to cook." |
| 3:00 | Kitchen | **Start**, then **Ready**. | Point at the phone: the waiter hears it and sees "Table 2 is ready". |
| 3:30 | Waiter phone | **Mark served**, then **Add more items** → Sweet Lassi → **Send add-on**. | "Extras go as a new batch; the kitchen sees only the new item, marked ADD-ON." |
| 4:30 | Kitchen | **Sold out list** → switch **Chicken Biryani** off. | On the phone it greys out at once, on every screen. Switch it back on. |
| 5:30 | Waiter phone | **Request bill**. | The cashier hears a tone; Table 2 jumps to the top of **Open bills**. |
| 6:00 | Cashier | Open the bill → **Pay** → **Split** (part cash, part card) → **Pay and print**. | "Tax and service charge come from Settings. Split payments must add up exactly." The receipt prints, and on the phone Table 2 is free again. |
| 7:30 | Laptop: Admin | Sign in as `admin` with the authenticator code → **Dashboard**. | "Today's sales, orders and top items, live. Admins always need the code." |
| 8:30 | Admin | **Menu** → open an item → change the price → **Save**. | "A new price applies to new orders only; today's bills keep theirs." Change it back. |
| 9:00 | | Questions. | Next phases: online ordering (P2), delivery and reservations (P3), profit reports (P4). |

## Do NOT click during the demo

- **Settings**: tax, service charge, currency or the business day. It changes every bill.
- **Staff**: **Deactivate**, **Reset password** or **Reset two-step sign-in** on the demo
  accounts. Each one signs that person out on their device mid-demo.
- **Change password** in the account menu on a demo account.
- **Archive** on the menu, categories or tables (it hides them from every screen).
- **Void** a payment or give a **Discount**, unless the client asks. Then do it on a new bill.
- **End shift** or **Sign out** on a device you still need.
- The customer website: it is not part of P1 yet.
- Promising dates or features from later phases. Note the request instead.

## If something goes wrong

- **No chime:** tap **Start shift** again, or check the speaker button and the phone volume.
- **"You are offline" bar:** move closer to the Wi-Fi. Nothing is half-sent, and the screen
  catches up by itself.
- **Signed out:** sign in again (passwords in the vault). An Admin enters the code again.
- **Fish Tikka shows Sold out:** that is part of the demo menu, on purpose.
