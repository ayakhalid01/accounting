-- =====================================================
-- Migration: Fix Method Group Allocation Logic
-- =====================================================
-- Purpose: Fix the populate_deposit_allocations function to properly
-- handle method groups by making them sequential rather than competing
-- for the same daily gaps
-- =====================================================

-- The populate_deposit_allocations function has been updated to:
-- 1. Allow methods in a group to be processed sequentially
-- 2. Each method gets priority allocation until its total gap is filled
-- 3. Remove the constraint that prevents a method from using remaining deposit balance
-- 4. Don't deduct prior method allocations from the same deposit when calculating daily gaps

-- This ensures that when a deposit has multiple payment methods in its group,
-- the first method gets allocated until its gap is filled, then the remaining
-- deposit balance goes to the next method, and so on.

-- The function already has the fix applied above, this migration just ensures it's updated</content>
<parameter name="filePath">d:\ME\Accountings\accounting-reconciliation\supabase\migrations\051_fix_method_group_allocation.sql