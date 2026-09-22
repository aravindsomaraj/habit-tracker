create policy "Users can upload own proof photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'proof-photos'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy "Users can view own proof photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'proof-photos'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy "Users can delete own proof photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'proof-photos'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);