# Order Shopee Import, Bulk Fulfillment, and Picklist Design

## Goal
Import one Shopee workbook with `orders` and `Advance Fulfilment` sheets into Order, safely review orders that already have tracking numbers, support bulk fulfillment transitions, and generate a picker-focused PDF without duplicate stock changes.

## Confirmed import semantics
- `orders.No. Pesanan` and `Advance Fulfilment.Booking SN` identify the same order.
- Merge both sheets by order ID and resolved SKU.
- `orders.Jumlah` contributes its numeric quantity.
- Each `Advance Fulfilment` row contributes quantity 1. Add counts when an order/SKU appears in both sheets.
- Resolve product SKU as `Nomor Referensi SKU`, then `SKU Induk` when ref is blank.
- Import-created orders default to internal `pending`, regardless of Shopee status.
- Import rows with a non-empty `No. Resi` require an explicit per-order decision in preview:
  - `Sudah diserahkan`: internal status `kirim`; no stock mutation; excluded from picklist.
  - `Belum diserahkan`: internal status `pending`; eligible for picklist; `pack` deducts stock once.
- Re-import replaces imported order items for that order rather than adding duplicate quantity. Preserve later internal fulfillment status unless the preview decision explicitly changes the tracking disposition.

## Order and stock invariants
- Order is the sole source for internal sales movements. Import never changes stock.
- `pending → pack` deducts aggregate SKU quantities exactly once.
- Bulk status action is atomic from the user's perspective: if any selected order cannot transition or lacks stock, no selected order changes status or stock.
- `pack → kirim` and `kirim → selesai` do not mutate stock.
- Cancelling `pack`/`kirim` restores stock once; cancelling `pending` does not.
- Selection is scoped to currently loaded/filter-matching orders; UI shows selected count and clears selection after successful transition or data reload.

## Picklist
- Generate PDF for selected eligible `pending` orders only.
- Aggregate selected order items by canonical master SKU.
- Display product name from the stock product master, SKU, total quantity, and a picker check box/mark column. Include selected order count, unit count, generation timestamp in `Asia/Jakarta`, and picker name blank line.
- Sort by SKU ascending for predictable warehouse walking; warehouse/bin location omitted until location data is a reliable requirement.
- If any selected SKU is missing from the master product table, fail PDF generation with an explicit list; do not silently omit items.
- PDF generation is read-only and has no stock/status side effects.

## Responsive UI
- Desktop/tablet: filter toolbar, selectable data table, selection count, transition controls and PDF action grouped above results.
- Mobile webview: compact order cards with touch-sized checkboxes/actions; sticky bottom action bar when selection is non-empty; no horizontal overflow requirement for core actions.
- “Pilih semua” selects only visible filtered pending orders. A bulk action is enabled only when every selected order allows that transition.
- Import preview groups warnings/rejections by order, puts tracking-number decisions visibly before final import confirmation, and supports narrow viewport scrolling.

## Template contract
- Update the official workbook generator to emit a single Shopee-compatible workbook with sheets `orders` and `Advance Fulfilment` and exact header rows taken from the supplied export structure.
- Preserve all source columns needed by order import, status review, tracking review, laba estimation (`Subtotal Pesanan`), and picklist SKU resolution.
- Both laba upload and order import use the same workbook file but different sheet(s): laba reads only `orders`; order reads and merges both.
- Legacy generic template tabs remain available only if product/stok flows depend on them; avoid breaking existing stock imports.

## Explicit non-goals
- No automatic Shopee-status mapping beyond the tracking review decision.
- No stock mutation at import time.
- No packing slips, labels, images, barcode scanning, route optimization, or wave grouping.
- No PDF picklist for `kirim`/`selesai` or orders excluded by the user selection.

## Acceptance criteria
1. Import merges order and Advance rows per ID/SKU and computes quantities as `orders.Jumlah + advance_row_count`.
2. Reimporting identical workbook does not duplicate order items or stock movements.
3. Every imported row with tracking number requires an explicit review disposition before confirmation.
4. Disposition `Sudah diserahkan` sets `kirim` and causes no stock movement; `Belum diserahkan` sets `pending`.
5. Bulk `pack` cannot partially update selected orders; insufficient stock leaves all selected orders and inventory unchanged.
6. Bulk select/transition works for visible filtered orders, including empty, mixed-status, and already-transitioned selections.
7. Picklist aggregates SKU quantities across selected pending orders, uses master product names, and refuses unknown SKUs with order/SKU detail.
8. PDF is legible on A4 and contains SKU, master product name, aggregated quantity, picker mark column, timestamp, and order/unit totals.
9. Mobile 360px and desktop 1280px layouts expose core selection, status, import, and picklist actions without clipping.
10. Laba import continues reading `orders` only and never writes stock/orders state.
