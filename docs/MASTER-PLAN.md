# IGLOUE MASTER PLAN

## 1. Project Goal

Build IGLOUE into a professional portable air-conditioning rental business with:

- A polished customer-facing website
- Guided AC recommendation
- Real availability
- Online booking
- Payments
- Customer magic-link access
- Admin dashboard
- Physical machine allocation
- Delivery and collection management
- Photos and signatures
- Inspection and maintenance tracking
- QR asset tracking
- Secure backend and database
- Legal, accounting and operational readiness

Target: Launch a strong V1 for the next cooling season.

---

## 2. Current Status

### Website
Status: BUILDING

### Backend
Status: NOT STARTED

### Database
Status: NOT STARTED

### Customer Account
Status: NOT STARTED

### Admin System
Status: EARLY PROTOTYPE

### Fleet / Physical Machine Tracking
Status: EARLY PROTOTYPE

### Payments
Status: RESEARCHING

### Louez Integration
Status: RESEARCHING

### Legal / Contracts / GDPR
Status: NOT STARTED

### SASU / TVA / Accounting
Status: NOT STARTED

### Insurance
Status: NOT STARTED

### Equipment / Stock
Status: RESEARCHING

### Launch Readiness
Status: NOT STARTED

---

## 3. Launch V1

The first live version of IGLOUE should allow a customer to:

1. Enter their postcode
2. Describe their room
3. Receive an AC recommendation
4. Choose dates
5. See real availability
6. Choose options
7. Book
8. Pay
9. Receive confirmation
10. Access their reservation using a magic link
11. Receive their machine
12. Sign for delivery
13. Have delivery photos recorded
14. Return the machine
15. Have the machine inspected
16. Close the rental

The admin should be able to:

1. View reservations
2. View customers
3. View available machines
4. Allocate a physical machine
5. View deliveries and collections
6. Record signatures
7. Record photos
8. Record inspection results
9. Mark machines available / rented / cleaning / maintenance
10. View basic payment status

---

## 4. Later / Not Required For Launch

- Automatic route optimisation
- Large staff management system
- Advanced analytics
- Multi-depot management
- Complex dynamic pricing
- Automated maintenance prediction
- Large-scale warehouse management
- Full Climloc-level operational complexity

---

## 5. Core System Flow

Customer
↓
Reservation
↓
Product
↓
Physical Machine
↓
Allocation
↓
Delivery
↓
Rental
↓
Collection
↓
Inspection
↓
Available Again

Supporting systems:

- Payments
- Customer authentication
- Photos
- Signatures
- Accessories / kits
- Email notifications
- Contracts
- Maintenance
- Admin
- Reporting

---

## 6. Workstreams

### Customer Website
- Recommendation assistant
- Postcode / delivery zone
- Availability
- Booking flow
- Pricing
- Mobile usability
- Accessibility
- Multilingual support

### Backend
- API
- Business logic
- Reservation lifecycle
- Availability logic
- Machine allocation
- Delivery / collection logic

### Database
- Customers
- Products
- Physical machines
- Reservations
- Allocations
- Payments
- Delivery events
- Inspections
- Photos
- Signatures
- Accessories / kits

### Customer Account
- Magic-link login
- Reservation view
- Delivery information
- Collection information
- Contract / invoice downloads
- Extend rental
- Update contact details

### Admin
- Dashboard
- Reservations
- Customers
- Fleet
- Allocations
- Deliveries
- Collections
- Inspections
- Maintenance
- Payments

### Security
- Authentication
- Staff permissions
- Customer permissions
- Secret management
- Backups
- Logging
- Data protection

### Legal / Business
- SASU
- TVA
- Accountant
- Insurance
- CGV
- Rental contract
- Privacy policy
- Legal notices
- Copyright / trademarks
- GDPR

### Operations
- Machine labels
- QR codes
- Delivery checklist
- Collection checklist
- Cleaning
- Maintenance
- Damage process
- Missing accessory process

---

## 7. Current Decisions

- IGLOUE should not depend entirely on Louez.
- Louez may remain useful as an integration or admin tool.
- IGLOUE should own its customer journey.
- Product stock and individual physical machines must remain separate concepts.
- Backend development should be modular.
- Stripe should handle payment card data.
- Secrets must never be exposed in frontend JavaScript.
- Build for 10 machines now, but structure the data so it can scale much further.
- PostgreSQL will be used as the primary IGLOUE database.
- Supabase is the selected PostgreSQL hosting platform for V1.
- The Supabase project should use the Paris region.
- Supabase may later provide customer authentication and file storage, but IGLOUE business logic must remain modular and not depend unnecessarily on Supabase-specific features.
- Supabase project `igloue` has been created on the Free plan.
- Primary database region: West EU (Paris).
- Database schema changes should be managed through version-controlled SQL migrations in the IGLOUE repository rather than relying on manual dashboard edits.

---

## 8. Current Priorities

### Priority 1
Design backend architecture.

### Priority 2
Design database structure.

### Priority 3
Build backend foundation.

### Priority 4
Connect real availability.

### Priority 5
Create reservations.

### Priority 6
Add payments.

### Priority 7
Build customer account.

### Priority 8
Expand admin and fleet operations.

---
## 9. Database Design - Core Entities
### Customer

Represents a real IGLOUE customer.

Fields:

- `id` — unique customer ID
- `first_name`
- `last_name`
- `email`
- `phone`
- `created_at`
- `updated_at`

The customer record represents the person, not a particular booking or delivery address.

Addresses will be stored with reservations so that a customer can rent to different locations without changing their permanent customer record.

A customer can have many reservations.

Relationship:

`reservations.customer_id`
→ `customers.id`

### Product

Represents a customer-facing IGLOUE rental model.

Fields:

- `id` — human-readable product ID, e.g. `split-12`
- `name`
- `tagline`
- `type`
- `tier`
- `cooling_capacity_kw`
- `max_room_size_m2`
- `weekly_price`
- `deposit_amount`
- `installation_required`
- `service_area`
- `active`
- `created_at`
- `updated_at`

Examples of product IDs:

- `essential`
- `mobile-duo`
- `split-12`
- `max-pro`

A Product describes the model the customer chooses.

A Product can have many physical machines.

Relationship:

`physical_machines.product_id`
→ `products.id`

### Physical Machine

Represents one real air-conditioning unit owned by IGLOUE.

Fields:

- `id` — human-readable asset ID, e.g. `S03`
- `product_id` — references `products.id`
- `serial_number`
- `status`
- `purchase_date`
- `purchase_cost`
- `current_location`
- `condition`
- `unavailable_until`
- `active`
- `created_at`
- `updated_at`

Relationship:

`physical_machines.product_id`
→ `products.id`

V1 machine statuses:

- `available`
- `reserved`
- `allocated`
- `rented`
- `returned`
- `inspection`
- `cleaning`
- `maintenance`
- `retired`

Operational concepts such as loaded, en-route, delivered and collection-due should normally belong to delivery/collection jobs rather than the machine status itself.

### Reservation

Represents one customer rental booking.

Fields:

- `id` — unique reservation ID
- `customer_id` — references `customers.id`
- `product_id` — references `products.id`
- `quantity`
- `rental_start`
- `rental_end`
- `status`
- `delivery_address_line_1`
- `delivery_address_line_2`
- `delivery_postcode`
- `delivery_city`
- `delivery_zone`
- `weekly_price_at_booking`
- `delivery_fee`
- `options_total`
- `deposit_amount`
- `total_amount`
- `payment_status`
- `customer_notes`
- `internal_notes`
- `created_at`
- `updated_at`

Relationships:

`reservations.customer_id`
→ `customers.id`

`reservations.product_id`
→ `products.id`

The reservation stores the commercial details of that specific booking.

Prices are copied into the reservation at booking time so that an old reservation does not change if IGLOUE later changes its normal product price.

The delivery address belongs to the reservation, not the customer.

V1 reservation statuses:

- `pending`
- `confirmed`
- `ongoing`
- `completed`
- `cancelled`

Payment status remains separate from reservation status.

### Allocation

Connects a reservation to a specific physical machine.

Fields:

- `id` — unique allocation ID
- `reservation_id` — references `reservations.id`
- `machine_id` — references `physical_machines.id`
- `status`
- `allocated_at`
- `released_at`
- `created_at`
- `updated_at`

Relationships:

`allocations.reservation_id`
→ `reservations.id`

`allocations.machine_id`
→ `physical_machines.id`

An allocation is what turns a product-level booking into a real-world machine assignment.

Example:

Reservation `IG-0042`
→ Product `split-12`
→ Machine `S03`

V1 allocation statuses:

- `held`
- `reserved`
- `active`
- `released`
- `cancelled`

A machine must not have overlapping active allocations.

### Delivery / Collection Job

Represents one operational visit linked to a reservation.

A reservation will normally have:

- one delivery job
- one collection job

Fields:

- `id` — unique job ID
- `reservation_id` — references `reservations.id`
- `job_type`
- `scheduled_date`
- `time_slot`
- `address_line_1`
- `address_line_2`
- `postcode`
- `city`
- `status`
- `assigned_staff_id`
- `assigned_vehicle_id`
- `arrival_time`
- `completion_time`
- `notes`
- `created_at`
- `updated_at`

Relationship:

`service_jobs.reservation_id`
→ `reservations.id`

V1 job types:

- `delivery`
- `collection`

V1 job statuses:

- `scheduled`
- `assigned`
- `in_progress`
- `completed`
- `failed`
- `cancelled`

Delivery and collection must remain separate jobs even though they belong to the same reservation.

Operational states such as en-route, delivered or awaiting collection should be handled by these jobs rather than mixed into the physical machine status.

### Inspection

Represents a condition check carried out on a physical machine.

Fields:

- `id` — unique inspection ID
- `machine_id` — references `physical_machines.id`
- `reservation_id` — references `reservations.id`
- `inspection_type`
- `condition`
- `damage_found`
- `cleaning_required`
- `maintenance_required`
- `notes`
- `inspected_at`
- `created_at`
- `updated_at`

Relationships:

`inspections.machine_id`
→ `physical_machines.id`

`inspections.reservation_id`
→ `reservations.id`

V1 inspection types:

- `pre_delivery`
- `delivery`
- `collection`
- `post_return`
- `maintenance`

An inspection records the condition of the exact machine at a specific point in the rental process.

A returned machine must not become available again until the required post-return inspection has been completed and passed.

If cleaning or maintenance is required, the machine remains unavailable until that work is completed and the machine is cleared for service.

### Photo

Stores references to photos captured during IGLOUE operations.

Fields:

- `id` — unique photo ID
- `reservation_id` — references `reservations.id`
- `machine_id` — references `physical_machines.id`
- `inspection_id` — references `inspections.id`
- `photo_type`
- `file_location`
- `taken_at`
- `uploaded_by`
- `created_at`

Relationships:

`photos.reservation_id`
→ `reservations.id`

`photos.machine_id`
→ `physical_machines.id`

`photos.inspection_id`
→ `inspections.id`

V1 photo types:

- `pre_delivery`
- `delivery`
- `installation`
- `collection`
- `damage`
- `post_return`
- `maintenance`

Photos should be stored in file/object storage.

The database should store the photo reference and metadata, not the actual image file itself.

Photos provide evidence of machine condition, installation, delivery and collection.

### Signature

Represents a customer or staff signature linked to a reservation.

Fields:

- `id` — unique signature ID
- `reservation_id` — references `reservations.id`
- `signature_type`
- `signed_by_name`
- `signed_by_role`
- `file_location`
- `signed_at`
- `created_at`

Relationship:

`signatures.reservation_id`
→ `reservations.id`

V1 signature types:

- `contract`
- `delivery`
- `collection`

A signature proves that a specific action or document was acknowledged.

The database should store the signature reference and metadata rather than embedding a large image directly in the reservation record.

Delivery and collection signatures should remain separate so there is a clear audit trail for each stage of the rental.

### Payment

Represents a financial transaction or payment authorisation linked to a reservation.

Fields:

- `id` — unique payment ID
- `reservation_id` — references `reservations.id`
- `provider`
- `provider_reference`
- `payment_type`
- `amount`
- `currency`
- `status`
- `paid_at`
- `created_at`
- `updated_at`

Relationship:

`payments.reservation_id`
→ `reservations.id`

V1 payment types:

- `rental_payment`
- `deposit_authorisation`
- `extension`
- `damage_charge`
- `refund`

V1 payment statuses:

- `pending`
- `authorised`
- `paid`
- `partially_refunded`
- `refunded`
- `failed`
- `cancelled`

Payment status must remain separate from reservation status.

IGLOUE should store payment references and results from the payment provider, but must never store full card details.

Stripe or another payment provider will remain responsible for secure card handling.

### Accessory / Kit

Represents a reusable accessory or kit supplied with a rental.

Examples:

- exhaust hose
- window kit
- remote control
- drain hose
- extension hose

Fields:

- `id` — unique accessory ID
- `accessory_type`
- `asset_id`
- `status`
- `condition`
- `associated_machine_id`
- `associated_reservation_id`
- `notes`
- `created_at`
- `updated_at`

Relationships:

`accessories.associated_machine_id`
→ `physical_machines.id`

`accessories.associated_reservation_id`
→ `reservations.id`

V1 accessory statuses:

- `available`
- `reserved`
- `rented`
- `returned`
- `inspection`
- `cleaning`
- `maintenance`
- `retired`

Not every accessory needs its own asset ID.

Cheap consumable items can remain untracked individually, while important reusable items can be given an asset ID and tracked like equipment.

Accessories should not be assumed to be part of a machine permanently unless that relationship is explicitly recorded.

---

### Core Relationships

Customer
→ has Reservations

Reservation
→ requests Product

Product
→ has many Physical Machines

Reservation
→ receives one or more Allocations

Allocation
→ assigns Physical Machine to Reservation

Reservation
→ has Delivery / Collection Jobs

Inspection
→ can have Photos

Reservation
→ can have Signatures

Reservation
→ has Payments

Reservation / Machine
→ can have Accessories

Physical Machine
→ has Maintenance Records

## Existing Codebase Audit - 2026-09-12

A read-only Codex audit was completed before backend development.

All six existing test suites passed and the repository remained unchanged.

### What Already Exists

The current frontend already contains useful domain models for:

- Product
- Physical Machine
- Reservation
- Allocation
- Delivery / Collection services
- Availability
- Reservation lifecycle
- Fleet allocation
- Pricing

These existing concepts should be preserved and migrated behind the future backend rather than unnecessarily rebuilt.

### What Does Not Yet Exist

Production implementations are still required for:

- Persistent database
- Real Customer records
- Secure backend API
- Persistent reservations
- Authoritative availability
- Payment processing
- Customer authentication / magic links
- Photo storage
- Signature capture
- Inspection records
- Persistent operational history

Current operational and fleet information is developmental/mock data.

### Important Audit Findings

The future backend must establish a single source of truth for:

- Product catalogue
- Product pricing
- Physical machine inventory
- Availability
- Delivery pricing
- Reservation status
- Machine allocation
- Delivery / collection services
- Date and time rules

Known prototype inconsistencies include:

- Configured inventory and mock physical fleet quantities differ
- Product and delivery prices are duplicated in several places
- Allocation records and reservation assigned-unit IDs can diverge
- Customer and operations slot-capacity rules are not completely aligned
- Setup terminology differs between parts of the code
- Some business/date rules are duplicated

These should be resolved gradually as backend authority replaces prototype data.

### Backend Milestone 1

Build the smallest persistent reservation and availability system.

Success means:

1. A customer can submit the existing normalized reservation draft.
2. The backend validates the reservation.
3. The reservation is stored persistently.
4. The reservation survives browser reload.
5. It appears in IGLOUE Operations.
6. It affects availability consistently.
7. Physical machine commitments cannot be double-booked.
8. Cancelling the reservation releases its commitments.

Backend Milestone 1 does NOT require:

- Stripe
- Magic-link customer accounts
- QR codes
- Photo uploads
- Signatures
- Full inspection workflow
- Advanced routing
- Advanced reporting

These will be separate later milestones.

### Backend Integration Principle

The existing normalized reservation draft will be retained as the initial frontend-to-backend integration boundary.

The frontend should progressively stop owning authoritative business data.

The backend/database will become the source of truth, while the customer website and operations/admin interfaces consume that data.

## 10. Session Log

### 2026-09-12

Done:
- Website cleanup secured and pushed
- Created project documentation folder
- Created IGLOUE Master Plan

Next:
- Design backend architecture
- Define database entities and relationships

---

## 11. Rules For Development

- One controlled change at a time
- Never build large features without defining the data first
- Every major feature gets tests
- Do not expose secrets
- Do not duplicate business rules unnecessarily
- Do not build features just because large competitors have them
- Update this Master Plan at the end of every IGLOUE session

### V1 Entity Scope

#### Required For Launch
- Customer
- Product
- Physical Machine
- Reservation
- Allocation
- Delivery / Collection Job
- Inspection
- Photo
- Signature
- Payment
- Accessory / Kit

#### Can Wait Until After Launch
- Maintenance Record as a full dedicated module
- Advanced staff assignment
- Vehicle management
- Route optimisation
- Complex warehouse locations
- Advanced damage claims workflow
- Automated late-payment recovery
- Advanced reporting
- Multi-depot support

### V1 Principle

If an entity is not required to:

- take a booking
- take payment
- allocate a machine
- deliver it
- prove its condition
- collect it
- inspect it
- make it available again

then it should not block launch.

## Backend State Lifecycles

IGLOUE keeps commercial, operational and physical-asset states separate.

This prevents reservation status, delivery progress and physical machine condition from becoming mixed together.

### Reservation Lifecycle

Represents the commercial state of the customer's booking.

Pending
→ Confirmed
→ Ongoing
→ Completed

Possible exit:
→ Cancelled

Meaning:

- Pending — booking started but not fully confirmed
- Confirmed — booking accepted and secured
- Ongoing — rental period has begun
- Completed — rental successfully finished
- Cancelled — reservation will not proceed

Payment status is tracked separately from reservation status.

---

### Delivery / Collection Job Lifecycle

Represents the operational state of a delivery or collection visit.

Scheduled
→ Assigned
→ In Progress
→ Completed

Possible exception:
→ Failed

Meaning:

- Scheduled — visit exists and has a date/time slot
- Assigned — allocated to staff/vehicle
- In Progress — operational visit underway
- Completed — visit successfully completed
- Failed — visit could not be completed

Delivery and collection are separate jobs associated with the same reservation.

---

### Physical Machine Lifecycle

Represents the real-world state of an individual IGLOUE machine.

Available
→ Reserved
→ Allocated
→ Rented
→ Returned
→ Inspection

After inspection:

PASS
→ Available

or

REQUIRES CLEANING
→ Cleaning
→ Inspection
→ Available

or

REQUIRES MAINTENANCE
→ Maintenance
→ Inspection
→ Available

A returned machine must never automatically become available.

It must pass the required post-return process first.

---

### State Separation Rule

Reservation status answers:

"Is the customer's rental commercially active?"

Job status answers:

"What is happening with the delivery or collection?"

Machine status answers:

"What is happening with this exact physical air conditioner?"

Payment status answers:

"Has the required money/payment authorisation been successfully handled?"

These states must not be combined into one status field.

### Availability And Turnaround Rules

IGLOUE should support same-day turnaround.

A fixed 24-hour turnaround buffer will NOT be required by default.

Instead, a physical machine becomes available for another reservation only when:

- the previous rental has ended
- the machine has been collected or returned
- the required post-return inspection has been completed
- the machine has passed inspection
- any required cleaning has been completed
- the machine is not in maintenance
- the machine status has returned to Available

This allows a machine collected in the morning to be re-rented later the same day if it is inspected and cleared in time.

A machine must never be considered available merely because the previous reservation end time has passed.

### Availability Rule

A machine is bookable only if:

- it belongs to the requested product
- it is active
- it is not retired
- it is not in maintenance
- it is not in cleaning
- it has no overlapping allocation that blocks the requested rental period
- it will be available and cleared before the next reservation begins

Product availability is calculated from the number of eligible physical machines.

Manual stock quantities must not be used as the primary source of truth once individual machine tracking is active.