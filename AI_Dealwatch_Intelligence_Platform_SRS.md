AI Dealwatch Intelligence Platform

Product Vision & Software Requirements Specification (SRS)

> This document is the permanent technical specification for the
> project. All future development should follow it.

1. Project Vision

 ● Continue developing the existing project, not replace it.
 ● Build an AI-powered Dealwatch Intelligence Platform for an electronics
flipping business.

 ● Help make better buying and selling decisions using both Dealwatch data
and historical business data.

 ● Improve architecture without breaking existing functionality.

2. Existing Project Overview

The project already includes: - Inventory management - Product
database - Purchase history - Sales history - Bundle management - Gaming
PC builder - AI product card generation - Parser infrastructure - Profit
calculations - Dashboard - Marketplace integrations - Analytics

Rules: - Never rewrite the project from scratch. - Preserve
compatibility. - Reuse existing functionality whenever possible.

3. Architecture Principles

 ● Analyze existing code before changing it.
 ● Reuse existing modules first.
 ● Avoid duplicate services and business logic.
 ● Follow SOLID and Clean Architecture.
 ● Separate UI, business logic, AI and parser logic.
 ● Explain the implementation plan before major changes.

4. Refactoring Strategy

Goals: - Organize the project into scalable modules. - Reduce large
files. - Remove duplication.

Suggested structure:
copy


/ai
/services
/parsers
/dealwatch
/analytics
/business
/dashboard
/database
/components
/hooks
/utils
/types
/config

5. Dealwatch Intelligence System

The platform should: - Monitor saved marketplace searches. - Track
prices over time. - Store listing history. - Calculate: - Minimum
price - Average price - Median price - Listing lifetime - Market
trends - New and removed listings

6. Parser System

Requirements: - Use predefined search URLs. - Read listing cards
first. - Store: - Listing ID - URL - Title - Price - Image - Location -
Skip already-known IDs. - Perform deep analysis only for promising
listings. - Classify listings (GPU, Gaming PC, CPU, SSD, Empty Box,
Wanted, Trade, etc.).

7. AI Learning Engine

Use my own historical business data as the primary learning source: -
Purchases - Sales - Bundles - Gaming PCs - ROI - Profit - Selling
speed - Successful configurations

The AI must continuously improve from every completed transaction.

8. AI Recommendation Engine

Combine: - Personal purchase history - Personal sales history - Current
Dealwatch data - Historical Dealwatch data - eBay sold prices - Dealwatch trends

Generate: - Recommended buy price - Recommended sell price - Expected
profit - Expected margin - Expected ROI - Estimated selling time -
Liquidity - Confidence score - BUY / WAIT / SKIP recommendation

For Gaming PCs: - Compare selling complete vs parting out. - Recommend
the most profitable option.

9. Unified Dashboard

This is the most important requirement.

The entire Dealwatch Intelligence system must work through ONE central
page.

Do not create separate standalone pages unless absolutely necessary.

The dashboard should include: - Dealwatch monitoring - AI recommendations -
Purchase history - Sales history - Dealwatch statistics - Charts - Current
opportunities - Best deals - Historical analytics - Bundle
intelligence - ROI analysis - Profit analysis - Inventory insights

This page is the user’s daily workspace.

10. User Experience

 ● Minimal clicks
 ● Fast search
 ● Smart filters
 ● Clear charts
 ● Fast recommendations
 ● Responsive interface
 ● Focus on productivity

11. Development Rules

Before implementing anything: 1. Analyze the current implementation. 2.
Explain how it works. 3. Identify problems. 4. Propose a plan. 5. Wait
for approval before major architectural changes.

Also: - Never break existing features. - Never create duplicate
modules. - Reuse existing code. - Treat all existing data as production
data.

12. Future Roadmap

Potential future features: - AI image analysis - Automatic condition
detection - Price forecasting - Seasonal demand prediction - Seller
reputation analysis - Notifications for good deals - Similar listing
detection - Risk assessment - Automated bundle suggestions

Final Development Philosophy

Think like the CTO and Lead Architect of a commercial SaaS product.

Do not simply implement requested features.

Continuously improve: - Architecture - Performance - Maintainability -
Scalability - User experience

If a better solution exists: - Explain it. - Justify it. - Request
approval. - Then implement it.

Always search for existing functionality before creating new
functionality.

Extend the current architecture instead of bypassing it.