-- =====================================================
-- Migration 052: Fix gap_uncovered calculation for sequential method groups
-- =====================================================
-- Problem: gap_uncovered was showing 0 instead of actual uncovered gap
-- Root Cause: daily_gap was calculated incorrectly for sequential allocation
-- Fix: Change v_gap calculation to use v_daily_sales - v_older_deposits_used - v_allocated
--       instead of v_remaining_gap - v_allocated (which included prior methods)
-- =====================================================

-- This migration updates the populate_deposit_allocations function
-- The actual code change is in 029_populate_allocations_function.sql
-- This file documents the fix for gap_uncovered calculation

-- To apply this fix:
-- 1. The function has been updated in 029_populate_allocations_function.sql
-- 2. Run recalculate_all_deposit_allocations() to fix existing data
-- 3. Verify that gap_uncovered shows correct values for method group deposits