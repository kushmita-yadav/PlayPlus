# Requirements Traceability

| Requirement | Planned implementation | Checkpoint |
|---|---|---|
| Gold, Silver, Junior plans and benefits | Membership plan and member entities, benefit calculation | 3 |
| Member registration, renewal, history | Members REST APIs and history queries | 3 |
| Court reservations and overlap prevention | PostgreSQL advisory/exclusion-safe transaction design | 4 |
| 30-minute sessions and two-bookings-per-day limit | Configurable scheduling service and constraints | 4 |
| Social-play participants | Session participant records | 4 |
| Shared shop inventory and online/counter sales | Product, stock movement and order entities | 5 |
| Pickup and delivery fulfillment | Order fulfillment workflow | 5 |
| Bar menu, tables, tabs and settlements | Menu, table, order, tab and payment entities | 6 |
| Public facilities, prices and enquiries | Versioned public read APIs and lead APIs | 7 |
| Staff roles, shifts and leave | Staff, role, schedule and leave entities | 7 |
| Finance, invoices and reports | Transaction, invoice, payroll and reporting APIs | 7 |
| Smart operational assistance | Rule-based assistant with bounded integration boundaries | 8 |
| Daily, weekly and monthly reporting | Aggregated reporting queries | 7 |
| Secure API and automated validation | JWT/RBAC, validation, tests and CI | 2, 9 |
