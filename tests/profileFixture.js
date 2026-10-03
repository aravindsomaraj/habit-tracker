// Existing auth regression fixtures represent returning users with chosen handles.
export function profileQuery() {
  let id;
  return {
    select() { return this; },
    eq(_column, value) { id = value; return this; },
    async maybeSingle() { return { data: { id, handle: 'existing_handle', display_name: 'Existing user' }, error: null }; },
  };
}

export function profileResponse(url) {
  const id = url.searchParams.get('id')?.replace(/^eq\./, '');
  return new Response(JSON.stringify({ id, handle: 'existing_handle', display_name: 'Existing user' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
