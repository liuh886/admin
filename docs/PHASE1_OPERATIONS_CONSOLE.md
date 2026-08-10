# Phase 1 Operations Console

## Goal

Upgrade admin into the unified Hao Apps product operations console while preserving the existing membership, entitlement, analytics, and billing boundaries.

## Phase 1 scope

### User 360

A unified user view built on existing identity and entitlement data:

- authentication identity
- roles and permissions
- product access
- entitlement status
- account activity summary

### Feature Flags

A centralized product feature control layer:

- product scoped flags
- enabled state
- controlled rollout metadata
- admin-only management

Products consume flags from the shared control plane instead of maintaining duplicated switches.

### Product Health

A lightweight operational overview:

- deployment state
- data freshness
- service status
- product-specific health indicators

## Implementation rules

- admin remains the canonical operations console.
- Reuse existing Supabase, GA4, Cloudflare, and Stripe integrations.
- Do not duplicate product administration logic.
- Build the smallest complete end-to-end version first.
