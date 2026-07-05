# IGLOUE Project Constitution

## 1. Vision

IGLOUE exists to become a premium climate comfort company in France, built around trust, simplicity, technology and reliable service.

The long-term goal is to create a scalable platform for:

- portable air conditioner rental
- fixed air conditioning installation
- heat pump installation
- maintenance subscriptions
- accessories
- bookings
- payments
- customer accounts
- admin tools
- fleet management

IGLOUE should be built as if it could one day become one of the leading climate comfort rental businesses in France.

---

## 2. Mission

To help customers stay comfortable during heatwaves and cold periods by offering simple, professional and reliable climate comfort solutions.

IGLOUE should make renting, installing, maintaining and managing climate comfort equipment feel easy, modern and trustworthy.

---

## 3. Brand Personality

IGLOUE should feel:

- premium
- clean
- modern
- minimal
- calm
- trustworthy
- technology-driven
- professional
- French-market ready

Design inspiration:

- Apple
- Dyson
- premium home technology
- clean medical/technical interfaces
- modern rental platforms

---

## 4. Core Design Principles

The website should use:

- large clean spaces
- rounded corners
- soft shadows
- smooth animations
- clear typography
- calm colours
- strong contrast
- simple navigation
- mobile-first layouts

The user should never feel overwhelmed.

---

## 5. Colour Palette

Primary Ice Blue:

```text
#BFEFFF
Secondary White:
#FFFFFF
Accent Polar Blue:
#1E88E5
Dark Charcoal:
#2E2E2E
Light Grey:
#F5F7F8
Future winter mode orange:
#FF8C42
6. Languages

Default language:

French

Initial additional languages:

English
Spanish

Future possible languages:

German
Italian
Dutch

Every page should be designed with translation in mind.

7. Technical Principles

The project should follow:

mobile-first design
semantic HTML5
CSS variables
modular CSS
modular JavaScript
no unnecessary frameworks
fast loading
accessible markup
SEO best practices
reusable components
clear file names
clean comments

Do not generate huge files without reason.

Build page by page, section by section.

8. Security Rules

During Phase 1, this is a static public website.

Never store the following in GitHub:

customer passwords
payment data
card details
customer private data
contracts with personal data
API keys
admin credentials
secret tokens
private business documents

GitHub Pages is for the public website only.

Future bookings, payments, customer accounts and admin dashboards must use secure external services or a protected backend.

9. Booking Rules

The future booking system must be designed carefully.

It will eventually need to handle:

available rental slots
delivery or collection times
customer details
deposits
payments
cancellations
refunds
equipment availability
maintenance status
admin validation

For Phase 1, booking pages may describe the service and collect interest, but they must not pretend to be a secure booking engine.

10. Payment Rules

Payments must never be processed directly by static website code.

Future payments should use trusted providers such as:

Stripe Checkout
PayPal
SumUp
Mollie
bank payment links

The website can redirect to payment providers, but must not store or process card data.

11. Accessibility Rules

The website should aim for WCAG-friendly design.

Important rules:

good colour contrast
readable font sizes
keyboard-friendly navigation
useful alt text
clear headings
visible focus states
simple forms
no unnecessary motion
reduced motion support where possible
12. SEO Rules

Each page should include:

unique title
meta description
clear H1
logical headings
human-readable URL
internal links
language alternatives later
structured content
fast loading assets

French SEO is the priority.

13. Performance Rules

The site should be:

lightweight
fast on mobile
image-optimised
minimal JavaScript
no unnecessary libraries
simple CSS
cache-friendly

Performance is part of the brand.

A slow website makes IGLOUE feel less premium.

14. Folder Rules

Website code belongs in:

IGLOUE PROJECT / Website / igloue

Business documents belong outside the Git repository.

The repository is for public website code and safe documentation only.

Private files should stay outside GitHub.

15. Working Method

Do not build the whole website in one response.

Work like a professional software team:

Plan the next small section.
Build one file or component.
Test it.
Review it.
Commit it.
Push it.
Move to the next section.

Every commit should have a clear purpose.

16. Current Phase

Phase 1:

static GitHub Pages website
no backend
no real customer login
no real payment processing
no private admin dashboard
no customer database

The goal of Phase 1 is to build a professional public website foundation.

17. Future Platform

Later, IGLOUE may include:

booking engine
customer portal
admin dashboard
fleet management
payment integration
maintenance reminders
quote system
Google Reviews
loyalty programme
QR code setup guides
email automation
Google Sheets or database integration

These should be planned carefully and added only when the public website foundation is solid.

18. North Star

IGLOUE should make climate comfort feel simple, premium and trustworthy.

Every decision should support that.