BEGIN;

-- CodeRabbit follow-up to migration 032: the storage UPDATE policy on
-- `campaign-images` originally specified only USING. That allowed an
-- authenticated user with UPDATE rights to mutate `name`/`metadata` to a
-- path *outside* their tenant prefix (e.g. rename the object into another
-- restaurant's folder). Adding a matching WITH CHECK clause re-validates
-- tenant ownership of the post-update row, closing the gap.
--
-- Re-uses the exact same predicate as migration 032 so behaviour is
-- symmetrical for pre- and post-update rows.

DROP POLICY IF EXISTS campaign_images_tenant_update ON storage.objects;

CREATE POLICY campaign_images_tenant_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'campaign-images'
    AND (
      (storage.foldername(name))[1]::uuid IN (SELECT user_restaurant_ids())
      OR is_platform_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'campaign-images'
    AND (
      (storage.foldername(name))[1]::uuid IN (SELECT user_restaurant_ids())
      OR is_platform_admin()
    )
  );

COMMIT;
