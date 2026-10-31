# UAT script: a test day on staging (P1)

The owner and staff run this on **staging** with the real menu and tables, before go-live
(spec 12, go-live step 1). Each row is done by the role named, on that role's real device.
Write **Pass** or **Fail** and a note. Any Fail is fixed and the row is run again before sign-off.

**Setup (developer, before the day):** staging deployed from `develop`; real menu, prices, cost
prices, tables, tax and service charge loaded; one account per tester (temporary passwords handed
out); two admins with two-step sign-in; receipt printer connected to the counter PC; a paper
notebook for the manual totals.

| # | Who | Do this | Expected | Pass / Fail | Note |
|---|---|---|---|---|---|
| 1 | Everyone | Sign in with the temporary password. | Asked to choose your own password; then lands on your role's screen. | | |
| 2 | Admin | Sign in. | Asked for the 6-digit code; Dashboard opens. | | |
| 3 | Waiter, chef, cashier | Tap **Start shift**. | Sound on; the waiter's screen stays awake. | | |
| 4 | Waiter | Table 1: 5 items, one with a note, **Send to Kitchen**. Time it. | Done in under 1 minute; order number shown. | | |
| 5 | Chef | Watch the kitchen screen during row 4. | The ticket appears within about 2 seconds, note visible, no prices. | | |
| 6 | Waiter | Table 2: a bottled drink only. | Never shows in the kitchen; the order is Ready at once. | | |
| 7 | Chef | **Start**, then **Ready** on table 1. | The waiter gets a sound and **Table 1 is ready** within about 2 seconds. | | |
| 8 | Waiter | **Mark served**, then **Add more items**: 2 items, **Send add-on**. | The kitchen shows only the 2 new items, marked **ADD-ON**. | | |
| 9 | Chef | **Sold out list**: mark one item **Sold out**. | Gone from the waiter's and cashier's menus within about 2 seconds. Mark it available again. | | |
| 10 | Waiter | Double-tap **Send to Kitchen** on table 3 (also try with weak Wi-Fi). | Exactly one order is created. | | |
| 11 | Waiter | Try to remove a sent item. | Not possible; the app says to ask the cashier. | | |
| 12 | Cashier | Cancel one sent line on table 3 with a reason. | Line shows as cancelled; totals worked out again; the kitchen sees it. | | |
| 13 | Waiter | Table 1: **Request bill**. | The cashier hears the tone; the bill is at the top of **Open bills**. | | |
| 14 | Cashier | Check table 1's total by hand (prices + service charge + tax, as in Settings). | The app's total matches the hand calculation exactly. | | |
| 15 | Cashier | Pay table 1 in **Cash** with change. | Change shown; receipt prints on 80 mm paper; table 1 is free. | | |
| 16 | Cashier | Pay table 2 by **Card**, table 3 by **Split**. | Both complete; split parts must add up; receipts print. | | |
| 17 | Cashier | **New counter order**, Take Away, name; chef marks Ready; pay; **Hand over**. | Completed; shows in the dashboard as Take Away. | | |
| 18 | Admin | On the cashier screen: **Discount** on an open bill with a reason; **Void** one payment. | Totals updated; the cashier cannot do either. | | |
| 19 | Admin | Change an item's price, then order it. | Old orders keep the old price; the new order has the new one. | | |
| 20 | Admin | **Staff**: create a waiter, reset a password, deactivate the waiter. | The deactivated person is signed out at once and can't sign in. | | |
| 21 | Anyone | Turn the Wi-Fi off for 30 seconds during service, then on. | Offline bar; sending is blocked; everything reloads after reconnect with nothing missing. | | |
| 22 | Everyone | Through the day: at least 50 orders of every kind. | No wrong totals, no lost orders, no stuck tables. | | |
| 23 | Admin + cashier | End of day: compare **Dashboard** sales and order count with the paper notebook and the cash drawer. | They match exactly. | | |
| 24 | Everyone | Use the app on Android Chrome, iOS Safari and the desktop browser. | Works on every device; text is readable; buttons are easy to tap. | | |

**Sign-off:** owner name, date, and "all rows Pass" (or the list of open Fails with an agreed
fix date). Rows 4, 5, 7, 8, 9, 10, 15 to 17, 22 and 24 are the P1 done criteria (spec 11).
