-- Accounting Reconciliation System - Database Schema
-- Migration: 053_add_user_notes_table
-- Created: 2025-12-24
-- Description: Add user notes table for persistent notes across devices

-- ==================== User Notes Table ====================
-- Stores user notes that persist across devices and sessions
CREATE TABLE user_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'deposits', -- 'deposits', 'invoices', etc.
  note_key TEXT NOT NULL DEFAULT 'general', -- 'general', 'filters', etc.
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure one note per user per type per key
  UNIQUE(user_id, note_type, note_key)
);

-- Indexes for performance
CREATE INDEX idx_user_notes_user_id ON user_notes(user_id);
CREATE INDEX idx_user_notes_type ON user_notes(note_type);
CREATE INDEX idx_user_notes_key ON user_notes(note_key);
CREATE INDEX idx_user_notes_user_type_key ON user_notes(user_id, note_type, note_key);

-- Row Level Security (RLS) policies
ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notes
CREATE POLICY "Users can view their own notes" ON user_notes
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert their own notes
CREATE POLICY "Users can insert their own notes" ON user_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own notes
CREATE POLICY "Users can update their own notes" ON user_notes
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own notes
CREATE POLICY "Users can delete their own notes" ON user_notes
  FOR DELETE USING (auth.uid() = user_id);

-- Function to upsert user notes (insert or update)
CREATE OR REPLACE FUNCTION upsert_user_note(
  p_note_type TEXT DEFAULT 'deposits',
  p_note_key TEXT DEFAULT 'general',
  p_content TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_note_id UUID;
BEGIN
  -- Try to update existing note
  UPDATE user_notes
  SET content = p_content,
      updated_at = NOW()
  WHERE user_id = auth.uid()
    AND note_type = p_note_type
    AND note_key = p_note_key;

  -- If no row was updated, insert new note
  IF NOT FOUND THEN
    INSERT INTO user_notes (user_id, note_type, note_key, content)
    VALUES (auth.uid(), p_note_type, p_note_key, p_content)
    RETURNING id INTO v_note_id;
  ELSE
    -- Get the ID of the updated note
    SELECT id INTO v_note_id
    FROM user_notes
    WHERE user_id = auth.uid()
      AND note_type = p_note_type
      AND note_key = p_note_key;
  END IF;

  RETURN v_note_id;
END;
$$;

-- Function to get user note content
CREATE OR REPLACE FUNCTION get_user_note(
  p_note_type TEXT DEFAULT 'deposits',
  p_note_key TEXT DEFAULT 'general'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_content TEXT;
BEGIN
  SELECT content INTO v_content
  FROM user_notes
  WHERE user_id = auth.uid()
    AND note_type = p_note_type
    AND note_key = p_note_key;

  RETURN COALESCE(v_content, '');
END;
$$;