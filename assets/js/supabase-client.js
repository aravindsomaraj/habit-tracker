// Browser configuration contains only the public project URL and publishable key.
window.getSupabaseClient = (function(){
  var client;
  return function(){
    if(client) return client;
    var config=window.APP_CONFIG||{};
    if(!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY){
      throw new Error('Supabase configuration is missing. Supply config.local.js and reload.');
    }
    if(!/^sb_publishable_/.test(config.SUPABASE_PUBLISHABLE_KEY)){
      throw new Error('Supabase requires a public sb_publishable_ key.');
    }
    if(!window.supabase || !window.supabase.createClient){
      throw new Error('The sign-in library could not load. Check your connection and reload.');
    }
    client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    return client;
  };
})();
