// Browser configuration contains only the public project URL and publishable key.
window.getSupabaseClient = (function(){
  var client;
  return function(){
    if(client) return client;
    var config=window.APP_CONFIG||{};
    if(!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY){
      throw new Error('Supabase configuration is missing. Check config.js and reload.');
    }
    if(typeof config.SUPABASE_PUBLISHABLE_KEY!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.SUPABASE_PUBLISHABLE_KEY)){
      throw new Error('Supabase requires a public sb_publishable_ key.');
    }
    try{
      if(typeof config.SUPABASE_URL!=='string') throw new Error();
      var url=new URL(config.SUPABASE_URL);
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/') throw new Error();
    }catch(_){throw new Error('Supabase project URL is invalid. Use the HTTPS project URL in config.js.');}
    if(!window.supabase || !window.supabase.createClient){
      throw new Error('The sign-in library could not load. Check your connection and reload.');
    }
    client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    return client;
  };
})();
