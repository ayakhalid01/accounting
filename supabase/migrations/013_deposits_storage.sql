-- Migration 013: Create storage bucket for deposits files
-- Created: 2025-12-10

-- Create storage bucket for deposit files
INSERT INTO storage.buckets (id, name, public)
VALUES ('deposits', 'deposits', true)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for deposits bucket

-- Users can upload to their own folder
CREATE POLICY "Users can upload deposit files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'deposits' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- All authenticated users can view all files (to see friend's deposits)
CREATE POLICY "Users can view all deposit files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'deposits' AND
  auth.uid() IS NOT NULL
);

-- Users can delete only their own files
CREATE POLICY "Users can delete own deposit files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'deposits' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
