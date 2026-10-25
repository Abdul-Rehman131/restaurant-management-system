# Pricing rules: tax, service charge and rounding

> **Status: ASSUMED, TO BE CONFIRMED by the owner (open question Q1, decision D2).**
> Every rule below is a column in the `settings` table, so the owner's answer changes **data**
> (one `UPDATE`, in P1 through the Admin settings screen), not the schema or the code.

All money is stored as integers in the smallest currency unit (PKR: paisa, ×100). Rates are
basis points (1600 = 16%). Totals are calculated **only** by the database function
`private.compute_order_totals` (BR-01, BR-16), and saved on the order by
`private.calc_order_totals`.

## Formula
```
net         = subtotal − discount
base        = discount_reduces_charges ? net : subtotal
service     = applies(order type) ? round(base × service_charge_bps / 10000) : 0

prices exclusive of tax (prices_include_tax = false):
  tax       = round((base + (tax_on_service_charge ? service : 0)) × tax_bps / 10000)
  total     = net + service + tax

prices inclusive of tax (prices_include_tax = true):
  tax       = round(base × tax_bps / (10000 + tax_bps))          ← already inside the prices
            + (tax_on_service_charge ? round(service × tax_bps / 10000) : 0)
  total     = net + service + (tax on service, if any)
```
`subtotal` is the sum of non-cancelled lines (price snapshot × quantity). `round()` is applied
once per calculated charge, per order (never per line), using `rounding_mode` to the nearest
`rounding_unit_minor`.

## Settings and assumed defaults (G7)
| Setting | Assumed default | Meaning |
|---|---|---|
| `tax_bps` | `0` | Tax rate. 0 until the owner provides it (D2). |
| `service_charge_bps` | `0` | Service-charge rate. 0 until the owner provides it (D2). |
| `prices_include_tax` | `false` | Menu prices are **exclusive** of tax; tax is added on top. |
| `discount_reduces_charges` | `true` | Service charge and tax are calculated after the discount. |
| `service_charge_on_dine_in` | `true` | Dine-In orders pay service charge. |
| `service_charge_on_take_away` | `false` | Take Away orders do not. |
| `service_charge_on_delivery` | `false` | Delivery orders do not (P3). |
| `tax_on_service_charge` | `false` | Tax is calculated on the food only, not on the service charge. |
| `rounding_mode` | `half_up` | 0.5 rounds up. Also `half_even`, `up`, `down`. |
| `rounding_unit_minor` | `1` | Round to 1 paisa. Set `100` to round charges to whole rupees. |

## Worked example (demo rates only: tax 16%, service charge 5%)
Dine-In, lines worth Rs 3,500, no discount, defaults above:

| Line | Amount |
|---|---|
| Subtotal | Rs 3,500.00 |
| Service charge 5% | Rs 175.00 |
| Tax 16% (on Rs 3,500) | Rs 560.00 |
| **Total** | **Rs 4,235.00** |

The same order as Take Away: no service charge, total Rs 4,060.00.
With a Rs 500 discount (Dine-In): base Rs 3,000, service charge Rs 150, tax Rs 480, total Rs 3,630.

Each case, plus every rule toggle and rounding mode, is covered by
`supabase/tests/100_order_totals.test.sql`.

## Questions for the owner (Q1)
1. Are menu prices shown **with** tax included, or is tax added on the bill?
2. What are the tax % and service-charge %?
3. Does service charge apply to Take Away (and later, Delivery)?
4. Is tax charged on the service charge too?
5. Is a discount taken off **before** service charge and tax are calculated?
6. Should charges be rounded to whole rupees on the bill?
