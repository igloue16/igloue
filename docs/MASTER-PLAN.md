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
## 9. Backend Architecture - Core Entities

### Customer
Represents the person renting from IGLOUE.

Core information:
- Customer ID
- Name
- Email
- Phone
- Billing address
- Delivery address
- Account / magic-link access status
- Created date
- Notes

### Product
Represents the customer-facing rental model.

Examples:
- Frost 9
- Frost 12
- Portable Split

Core information:
- Product ID
- Name
- BTU / cooling capacity
- Weekly price
- Deposit amount
- Active / inactive status
- Recommendation rules
- Required accessories
- Description

### Physical Machine
Represents one real air-conditioning unit owned by IGLOUE.

Examples:
- F12-001
- F12-002
- PS-001

Core information:
- Machine ID
- Product ID
- Serial number
- QR code
- Purchase date
- Purchase cost
- Current status
- Current location
- Condition
- Last inspection
- Maintenance status
- Notes

Possible statuses:
- Available
- Reserved
- Allocated
- Out for delivery
- Rented
- Awaiting collection
- Returned
- Cleaning
- Inspection
- Maintenance
- Retired

### Reservation
Represents the customer's rental agreement / booking.

Core information:
- Reservation ID
- Customer ID
- Product ID
- Quantity
- Rental start date
- Rental end date
- Reservation status
- Price
- Delivery fee
- Options
- Deposit requirement
- Payment status
- Delivery address
- Customer notes
- Internal notes
- Created date

### Allocation
Connects a reservation to a specific physical machine.

Example:
Reservation IG-0042
→ Product Frost 12
→ Machine F12-003

Core information:
- Allocation ID
- Reservation ID
- Machine ID
- Allocation date
- Released date
- Status

### Delivery / Collection Job
Represents an operational visit.

Core information:
- Job ID
- Reservation ID
- Job type: Delivery or Collection
- Scheduled date
- Time slot
- Address
- Status
- Assigned staff
- Assigned vehicle
- Arrival time
- Completion time
- Notes

### Inspection
Represents a machine condition check.

Core information:
- Inspection ID
- Machine ID
- Reservation ID
- Inspection type
- Date
- Condition
- Damage found
- Cleaning required
- Maintenance required
- Notes

Inspection types:
- Pre-delivery
- Delivery
- Collection
- Post-return
- Maintenance

### Photo
Stores references to operational photos.

Core information:
- Photo ID
- Reservation ID
- Machine ID
- Inspection ID
- Photo type
- File location
- Date taken
- Uploaded by

### Signature
Represents a customer or staff signature.

Core information:
- Signature ID
- Reservation ID
- Signature type
- Signed by
- Date
- File / signature data reference

Signature types:
- Delivery
- Collection
- Contract

### Payment
Represents payment activity.

Core information:
- Payment ID
- Reservation ID
- Payment provider reference
- Amount
- Payment type
- Status
- Date

Payment types:
- Rental payment
- Deposit / card guarantee
- Extension
- Damage charge
- Refund

### Accessory / Kit
Represents reusable accessories supplied with machines.

Examples:
- Exhaust hose
- Window kit
- Remote control
- Drain hose
- Extension hose

Core information:
- Accessory ID
- Type
- Asset ID if individually tracked
- Current status
- Associated machine
- Associated reservation
- Condition

### Maintenance Record
Represents work performed on a physical machine.

Core information:
- Maintenance ID
- Machine ID
- Date
- Issue
- Work completed
- Cost
- Performed by
- Next action
- Machine returned to service date

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

Physical Machine
→ has Inspections

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