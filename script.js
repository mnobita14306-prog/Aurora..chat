/* AURORA · script.js — setup scripts + the whole app, in original order.
   Classic script (no module) so index.html also works by double-click.
   'use strict' first: the app code was written as an ES module, which is
   always strict — this keeps its semantics identical. */
'use strict';

/* ==========================================================================
   01-phone-shell.js · SETUP 1 · storage fallback + phone-shell wrapper
   ========================================================================== */

// Force phone shell — ALL UI lives inside #phoneShell
(function(){
  function getShell(){
    return document.getElementById('phoneShell');
  }
  function wrap(){
    var body=document.body;
    if(!body) return;
    var shell=getShell();
    if(!shell){
      shell=document.createElement('div');
      shell.className='phone-shell';
      shell.id='phoneShell';
      body.appendChild(shell);
    }
    // Move every body child into shell (except shell itself)
    Array.prototype.slice.call(body.childNodes).forEach(function(n){
      if(n===shell) return;
      // skip pure whitespace text
      if(n.nodeType===3 && !String(n.textContent||'').trim()) return;
      try{ shell.appendChild(n); }catch(e){}
    });
    body.classList.add('phone-mode');
  }
  // Redirect body.appendChild / insertBefore so dynamic modals stay in phone
  function patchBody(){
    var body=document.body;
    if(!body || body._phonePatched) return;
    body._phonePatched=true;
    var _append=body.appendChild.bind(body);
    var _insert=body.insertBefore.bind(body);
    body.appendChild=function(node){
      var shell=getShell();
      if(shell && node && node!==shell && node.id!=='phoneShell'){
        // keep phone shell as direct body child only
        if(node.id==='phoneShell') return _append(node);
        return shell.appendChild(node);
      }
      return _append(node);
    };
    body.insertBefore=function(node, ref){
      var shell=getShell();
      if(shell && node && node!==shell && node.id!=='phoneShell'){
        if(ref && shell.contains(ref)) return shell.insertBefore(node, ref);
        return shell.appendChild(node);
      }
      return _insert(node, ref);
    };
  }
  function boot(){
    wrap();
    patchBody();
    wrap(); // again after patch
  }
  if(document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
  // Late nodes (module scripts adding UI)
  setTimeout(wrap, 0);
  setTimeout(wrap, 300);
  setTimeout(wrap, 1200);
})();

/* ==========================================================================
   02-splash-gate.js · SETUP 2 · splash screen + welcome gate
   ========================================================================== */

// EMERGENCY - Hide splash; show welcome gate if logged out
(function(){
  function hideSplash(){
    var s=document.getElementById('splash');
    if(!s) return;
    s.classList.add('hide');
    setTimeout(function(){try{s.remove();}catch(e){}},480);
  }
  function showWelcomeIfNeeded(){
    try{
      if(localStorage.getItem('chatbd_local_user_multi') && localStorage.getItem('aurora_force_logout')!=='1') return;
      // After logout → login page; first visit → welcome gate
      if(localStorage.getItem('aurora_force_logout')==='1'){
        var gate=document.getElementById('welcomeGate');
        if(gate){ gate.classList.remove('show'); gate.style.display='none'; }
        var overlay=document.getElementById('loginOverlay');
        if(overlay){ overlay.classList.add('show'); overlay.style.display='flex'; }
        return;
      }
      var gate2=document.getElementById('welcomeGate');
      if(gate2){ gate2.classList.add('show'); gate2.style.display=''; }
    }catch(e){}
  }
  setTimeout(function(){ hideSplash(); showWelcomeIfNeeded(); },700);
  setTimeout(function(){
    var s=document.getElementById('splash');
    if(s){s.style.display='none'; try{s.remove();}catch(e){}}
    showWelcomeIfNeeded();
  },2200);
})();

/* ==========================================================================
   03-voice-messages.js · SETUP 3 · voice-note player (window.AuroraVoice)
   ========================================================================== */

/* AURORA voice messages — no native media-player chrome or external library.
   Detached Audio instances survive receipt updates / complete chat re-renders.
   Only metadata is preloaded; playback always requires a user's tap. */
(function(){
  'use strict';
  const controllers=new Map();
  const rates=[1,1.5,2];
  let root=null, active=null, frame=0;
  const escapeHTML=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validSeconds=value=>Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : 0;
  const formatTime=value=>{
    const n=Math.max(0,Math.floor(Number(value)||0));
    return n>=3600 ? Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0') : Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
  };
  function isVoiceMessage(m){
    return !!m && (/^(audio|voice|voice[-_]?(note|message))$/i.test(String(m.type||'')) || /^data:audio\//i.test(String(m.text||'')));
  }
  function hash(value){
    const str=String(value||'');
    let h=2166136261;
    for(const c of str.slice(0,240)+str.slice(-40)+str.length) h=Math.imul(h^c.charCodeAt(0),16777619);
    return h>>>0;
  }
  function wavePath(m){
    const supplied=Array.isArray(m.waveform) && m.waveform.length>3 ? m.waveform.slice(0,128) : null;
    let seed=hash(m.id||m.fileName||m.text)||7;
    return Array.from({length:40},(_,i)=>{
      // Stored peaks are real audio amplitudes. Legacy notes get a stable,
      // decorative envelope, so they work without a database migration.
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      let peak=supplied ? Number(supplied[Math.min(supplied.length-1,Math.floor(i*supplied.length/40))]) : .16+(seed/4294967296)*.8*(.55+.45*Math.sin((i/39)*Math.PI));
      peak=Number.isFinite(peak)?Math.max(0,Math.min(1,peak)):.2;
      const height=3+peak*24, x=3+i*194/39;
      return 'M'+x.toFixed(2)+','+((32-height)/2).toFixed(2)+'v'+height.toFixed(2);
    }).join('');
  }
  function render(m,caption){
    const src=String(m.text||'');
    const duration=validSeconds(m.audioDuration||m.voiceDuration||m.duration);
    const path=wavePath(m);
    const svg=cls=>'<svg class="'+cls+'" viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true"><path d="'+path+'" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
    return '<div class="voice-message" role="group" aria-label="Voice message" data-voice-src="'+escapeHTML(src)+'" data-voice-duration="'+duration+'" data-voice-key="'+escapeHTML(m.id||hash(src))+'" title="'+escapeHTML(m.fileName||'Voice message')+'">'+
      '<button type="button" class="vm-toggle" aria-label="Play voice message" aria-pressed="false" title="Play voice message">'+
        '<svg class="vm-play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.7c0-.8.9-1.3 1.6-.9l10 6.3c.7.4.7 1.4 0 1.8l-10 6.3c-.7.4-1.6-.1-1.6-.9z"/></svg>'+
        '<svg class="vm-pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.3"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.3"/></svg>'+
        '<svg class="vm-retry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M19 11a7 7 0 1 0-1.5 6M20 7v5"/></svg><span class="vm-loading-ring" aria-hidden="true"></span></button>'+
      '<div class="vm-body"><div class="vm-wave">'+svg('vm-wave-base')+svg('vm-wave-fill')+'<span class="vm-playhead" aria-hidden="true"></span>'+
        '<input class="vm-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek voice message" aria-valuetext="0:00" '+(duration?'':'disabled')+'></div>'+
      '<div class="vm-meta"><span class="vm-time-group"><svg class="vm-mic" viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="5" y="1" width="6" height="11" rx="3"/><path d="M2 9v1a6 6 0 0 0 12 0V9M8 16v3M5 19h6"/></svg><span class="vm-time">'+(duration?formatTime(duration):'--:--')+'</span></span>'+
        '<span class="vm-status" role="status" aria-live="polite">Voice message</span>'+
        '<button class="vm-speed" type="button" aria-label="Playback speed 1 times. Change to 1.5 times" title="Playback speed · 1×">1×</button></div></div></div>'+(caption||'');
  }
  function setText(el,value){if(el && el.textContent!==value) el.textContent=value;}
  function paint(c){
    if(c.disposed || !c.widget) return;
    const w=c.widget, a=c.audio;
    if(validSeconds(a.duration)) c.duration=a.duration;
    const duration=c.duration, time=Math.max(0,a.currentTime||0);
    const position=c.scrubbing ? (Number(c.seek.value)/1000)*duration : time;
    const playing=(!a.paused && !a.ended) || c.wantPlay;
    const progress=duration ? Math.max(0,Math.min(1,position/duration)) : 0;
    w.style.setProperty('--vm-progress',(progress*100).toFixed(2)+'%');
    w.classList.toggle('is-playing',playing);
    w.classList.toggle('is-loading',c.loading && playing);
    w.classList.toggle('has-error',!!c.error);
    w.classList.toggle('has-progress',progress>0);
    const label=c.error?'Retry voice message':playing?'Pause voice message':a.ended?'Replay voice message':'Play voice message';
    c.toggle.setAttribute('aria-label',label);
    c.toggle.title=label;
    c.toggle.setAttribute('aria-pressed',String(playing));
    c.toggle.setAttribute('aria-busy',String(c.loading && playing));
    c.seek.disabled=!duration || !!c.error;
    if(!c.scrubbing) c.seek.value=String(Math.round(progress*1000));
    c.seek.setAttribute('aria-valuetext',formatTime(position)+(duration?' of '+formatTime(duration):''));
    let timeText=duration?formatTime(duration):'--:--';
    if((time>0 || playing || c.scrubbing) && !a.ended) timeText=formatTime(position)+(duration?' / '+formatTime(duration):'');
    setText(c.time,timeText);
    const status=c.error?'Tap to retry':c.loading&&playing?'Loading…':playing?'Playing':a.ended?'Played':c.started?'Paused':'Voice message';
    setText(c.status,status);
    c.status.title=c.error || status;
    const speed=a.playbackRate || 1;
    const next=rates[(rates.indexOf(speed)+1)%rates.length];
    setText(c.speed,speed+'×');
    c.speed.title='Playback speed · '+speed+'×';
    c.speed.setAttribute('aria-label','Playback speed '+speed+' times. Change to '+next+' times');
  }
  function animate(){
    frame=0;
    if(!active || active.disposed || active.audio.paused || active.audio.ended) return;
    paint(active);
    frame=requestAnimationFrame(animate);
  }
  function startAnimation(){if(!frame) frame=requestAnimationFrame(animate);}
  function pause(c){
    c.intent++;
    c.wantPlay=false;
    c.loading=false;
    c.audio.pause();
    if(active===c) active=null;
    paint(c);
  }
  function pauseAll(except){controllers.forEach(c=>{if(c!==except && (!c.audio.paused || c.wantPlay)) pause(c);});}
  function failed(c,message){
    if(c.disposed) return;
    c.error=message || 'Could not load this voice message. Check your connection and tap to retry.';
    pause(c);
  }
  function toggle(c){
    if(c.disposed) return;
    const a=c.audio;
    if(!a.paused || c.wantPlay){pause(c);return;}
    pauseAll(c);
    if(c.error || a.error){
      c.error='';
      const speed=a.playbackRate;
      a.load();
      a.playbackRate=speed;
    }
    if(a.ended || (c.duration && a.currentTime>=c.duration-.05)){
      try{a.currentTime=0;}catch(_){}
    }
    const token=++c.intent;
    c.wantPlay=true;
    c.loading=a.readyState<3;
    active=c;
    paint(c);
    try{
      // Keep play() in the original click handler for mobile autoplay policies.
      const playPromise=a.play();
      if(playPromise && playPromise.then) playPromise.then(()=>{
        if(c.disposed || token!==c.intent || !c.wantPlay){
          if(!c.wantPlay) a.pause();
          return;
        }
        c.loading=false;
        c.started=true;
        paint(c);startAnimation();
      }).catch(err=>{
        if(c.disposed || token!==c.intent || err.name==='AbortError') return;
        failed(c,err.name==='NotAllowedError'?'Playback was blocked. Tap play again.':'Could not play this voice message. Check your connection or audio format, then tap to retry.');
      });
    }catch(err){failed(c,err.message);}
  }
  function seekTo(c){
    if(!c.duration || c.disposed) return;
    try{
      c.audio.currentTime=Math.max(0,Math.min(c.duration,Number(c.seek.value)/1000*c.duration));
      c.started=true;
    }catch(_){}
    paint(c);
  }
  function bindWidget(c,w){
    c.widget=w;
    c.toggle=w.querySelector('.vm-toggle');c.seek=w.querySelector('.vm-seek');
    c.time=w.querySelector('.vm-time');c.status=w.querySelector('.vm-status');c.speed=w.querySelector('.vm-speed');
    c.duration=validSeconds(w.dataset.voiceDuration)||c.duration;
    c.scrubbing=false;
    if(w._voiceController!==c){
      w._voiceController=c;
      w.addEventListener('click',e=>{
        const button=e.target.closest('button');
        if(e.target.closest('button,input')) e.stopPropagation();
        if(!button) return;
        if(button.classList.contains('vm-toggle')) toggle(c);
        if(button.classList.contains('vm-speed')){
          c.audio.playbackRate=rates[(rates.indexOf(c.audio.playbackRate)+1)%rates.length];
          paint(c);
        }
      });
      c.seek.addEventListener('pointerdown',e=>{e.stopPropagation();c.scrubbing=true;});
      c.seek.addEventListener('input',()=>seekTo(c));
      c.seek.addEventListener('change',()=>{c.scrubbing=false;seekTo(c);});
      c.seek.addEventListener('pointerup',()=>{c.scrubbing=false;paint(c);});
      c.seek.addEventListener('pointercancel',()=>{c.scrubbing=false;paint(c);});
      c.seek.addEventListener('blur',()=>{c.scrubbing=false;paint(c);});
      c.seek.addEventListener('keydown',e=>{
        e.stopPropagation();
        if(e.key===' '){e.preventDefault();toggle(c);}
      });
    }
    paint(c);
  }
  function create(w,key){
    const audio=new Audio();
    audio.preload='metadata';
    audio.setAttribute('playsinline','');
    const c={key,src:w.dataset.voiceSrc,audio,widget:null,duration:validSeconds(w.dataset.voiceDuration),started:false,wantPlay:false,loading:false,error:'',intent:0,disposed:false,scrubbing:false};
    bindWidget(c,w);
    ['loadedmetadata','durationchange','timeupdate','ratechange','seeked'].forEach(event=>audio.addEventListener(event,()=>paint(c)));
    audio.addEventListener('play',()=>{
      // A queued event from an earlier tap must not stop the newly selected note.
      if(c.disposed){audio.pause();return;}
      if(audio.paused || !c.wantPlay) return;
      pauseAll(c);active=c;c.started=true;paint(c);startAnimation();
    });
    audio.addEventListener('playing',()=>{if(audio.paused || !c.wantPlay) return;c.loading=false;paint(c);startAnimation();});
    audio.addEventListener('waiting',()=>{c.loading=true;paint(c);});
    audio.addEventListener('canplay',()=>{c.loading=false;paint(c);});
    audio.addEventListener('pause',()=>{if(!audio.paused) return;c.wantPlay=false;c.loading=false;if(active===c) active=null;paint(c);});
    audio.addEventListener('ended',()=>{
      if(!audio.ended) return;
      if(!c.duration && validSeconds(audio.currentTime)) c.duration=audio.currentTime;
      c.wantPlay=false;c.loading=false;c.started=true;if(active===c) active=null;paint(c);
    });
    audio.addEventListener('error',()=>failed(c));
    audio.src=c.src;
    return c;
  }
  function dispose(c){
    pause(c);c.disposed=true;c.widget=null;
    c.audio.removeAttribute('src');c.audio.load();
    controllers.delete(c.key);
  }
  function syncWidgets(){
    if(!root) return;
    const visible=new Set();
    root.querySelectorAll('.voice-message').forEach((w,i)=>{
      const row=w.closest('[data-msg-id]');
      const key=String(root.dataset.roomId||'')+'\u0000'+String(row&&row.dataset.msgId||w.dataset.voiceKey||i);
      visible.add(key);
      let c=controllers.get(key);
      if(c && c.src!==w.dataset.voiceSrc){dispose(c);c=null;}
      if(!c){c=create(w,key);controllers.set(key,c);}
      else if(c.widget!==w) bindWidget(c,w);
    });
    controllers.forEach((c,key)=>{if(!visible.has(key)) dispose(c);});
  }
  function hasWidget(node){return node.nodeType===1 && (node.matches('.voice-message') || !!node.querySelector('.voice-message'));}
  function mount(){
    root=document.getElementById('messages');
    if(!root) return;
    new MutationObserver(records=>{
      if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(hasWidget))) syncWidgets();
    }).observe(root,{childList:true,subtree:true});
    const panel=document.getElementById('mainPanel');
    if(panel) new MutationObserver(()=>{if(!panel.classList.contains('open')) pauseAll();}).observe(panel,{attributes:true,attributeFilter:['class','style']});
    document.getElementById('voiceCallBtn')?.addEventListener('click',()=>pauseAll(),true);
    window.addEventListener('pagehide',()=>pauseAll());
    syncWidgets();
  }
  function analyseFile(file){
    // Analyse the local upload, never re-download remote notes for decoration.
    // Small stored peak arrays also give the receiver an accurate waveform.
    return new Promise(resolve=>{
      const result={};
      let done=false, decoding=false;
      const audio=new Audio(), url=URL.createObjectURL(file);
      const Context=window.OfflineAudioContext||window.webkitOfflineAudioContext;
      const canDecode=!!Context && file.size<=4*1024*1024;
      const finish=()=>{
        if(done) return;done=true;clearTimeout(timer);
        audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
        resolve({...result});
      };
      const timer=setTimeout(finish,2500);
      const decode=()=>{
        if(decoding || done) return;decoding=true;
        if(!canDecode || result.audioDuration>600){finish();return;}
        (async()=>{
          try{
            const context=new Context(1,1,8000);
            const buffer=await context.decodeAudioData(await file.arrayBuffer());
            if(done) return;
            const data=buffer.getChannelData(0), peaks=[];
            for(let i=0;i<40;i++){
              const from=Math.floor(i*data.length/40), to=Math.floor((i+1)*data.length/40);
              const stride=Math.max(1,Math.floor((to-from)/240));
              let sum=0,count=0;
              for(let j=from;j<to;j+=stride){sum+=data[j]*data[j];count++;}
              peaks.push(Math.sqrt(sum/Math.max(1,count)));
            }
            const max=Math.max(.00001,...peaks);
            result.waveform=peaks.map(p=>Number(Math.pow(p/max,.7).toFixed(3)));
            if(validSeconds(buffer.duration)) result.audioDuration=buffer.duration;
          }catch(_){} // Unsupported formats keep their metadata + fallback bars.
          finish();
        })();
      };
      audio.preload='metadata';
      audio.addEventListener('loadedmetadata',()=>{
        if(validSeconds(audio.duration)) result.audioDuration=audio.duration;
        decode();
      },{once:true});
      audio.addEventListener('error',decode,{once:true});
      audio.src=url;
    });
  }
  window.AuroraVoice={render,isVoiceMessage,analyseFile,pauseAll:()=>pauseAll()};
  if(document.getElementById('messages')) mount();
  else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();

/* ==========================================================================
   04-app.js · THE APP
   ========================================================================== */

/* Startups can run where browser storage is simply not available: a sandboxed
   preview iframe with an opaque origin, or Safari private mode. Aurora reads
   localStorage during boot, and one throw there would leave a blank screen.
   Install an in-memory stand-in first; every other reference keeps working. */
(function(){
  try{
    window.localStorage.setItem('aurora_storage_probe','1');
    window.localStorage.removeItem('aurora_storage_probe');
    return;                                  // real storage works — nothing to do
  }catch(e){}
  var mem={};
  var facade={
    getItem:function(k){ return Object.prototype.hasOwnProperty.call(mem,String(k)) ? mem[String(k)] : null; },
    setItem:function(k,v){ mem[String(k)]=String(v); },
    removeItem:function(k){ delete mem[String(k)]; },
    clear:function(){ mem={}; },
    key:function(i){ var ks=Object.keys(mem); return i<ks.length?ks[i]:null; }
  };
  try{ Object.defineProperty(facade,'length',{get:function(){ return Object.keys(mem).length; }}); }catch(e){}
  try{ Object.defineProperty(window,'localStorage',{value:facade,configurable:true}); }
  catch(e2){ try{ window.localStorage=facade; }catch(e3){} }
  try{ console.info('Aurora: browser storage is unavailable here — running in memory-only guest mode.'); }catch(e4){}
})();

// Capture the pristine app before authentication/chat rendering. Exports use
// this template, never the live DOM containing account or conversation data.
const AURORA_EXPORT_BASE='<!DOCTYPE html>\n'+document.documentElement.outerHTML;

// STABLE VERSION BEFORE 4 UPDATES - 7 Requirements + Title bar premium + Delete + Voice + Pic/Video + Mobile fixes + No stuck
window.AURORA_LOGO = { flame: "data:image/png;base64,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", full: "data:image/png;base64,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", flame64: "data:image/png;base64,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" };
window.auroraLogoImg = (size)=>`<img src="${window.AURORA_LOGO.flame}" alt="Aurora" class="aurora-logo-img" draggable="false" style="${size||''}">`;
/* ============================================================================
   ☁️  AURORA CLOUD  ·  Supabase backend (accounts + database + media storage)
   ----------------------------------------------------------------------------
   SETUP (once):  open SUPABASE-SETUP.md — 4 steps, ~3 minutes.

   1) Supabase → Project Settings → API → copy "Project URL" into SUPABASE_URL
   2) …same page → copy "anon public" key into SUPABASE_ANON_KEY
   3) SQL Editor → run supabase/schema.sql   (tables + storage + realtime)

   Blank values are fine: the app then runs in LOCAL MODE (accounts, chats and
   media live only in this browser). Nothing here needs a build step.
   ========================================================================= */
const SUPABASE_URL      = 'https://tslwnwqpmxlzfpvlimyj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Psloil3D8S9Smtb5Xk7B9g_98XDqvGj';
const SUPABASE_BUCKET   = 'aurora-media';           // storage bucket name
const SUPABASE_MAX_UPLOAD_MB = 50;                  // keep in sync with the bucket limit

// supabase-js is loaded lazily (like the old SDK was). If the CDN is blocked the
// app simply stays in local mode instead of dying.
const SUPABASE_CDN_PRIMARY  = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SUPABASE_CDN_FALLBACK = 'https://esm.sh/@supabase/supabase-js@2';

/* Accepts every URL the Supabase dashboard hands out:
   https://xyz.supabase.co   ·   https://xyz.supabase.co/rest/v1/
   https://xyz.supabase.co/auth/v1   ·   with or without a trailing slash. */
function supabaseBase(){
  return String(SUPABASE_URL||'').trim()
    .replace(/\/+$/,'')
    .replace(/\/(rest|auth|storage|realtime|functions)\/v1$/i,'')
    .replace(/\/+$/,'');
}
function cloudConfigured(){
  try{
    const base=supabaseBase();
    return !!(base && SUPABASE_ANON_KEY &&
              !/PASTE_/.test(base) && !/PASTE_/.test(SUPABASE_ANON_KEY) &&
              /^https?:\/\/[a-z0-9.-]+$/i.test(base));
  }catch(e){ return false; }
}

let sb=null;                       // supabase client
let sbSession=null;                // current session (has access_token)
let sbUser=null;                   // current auth user
let sbLoadError=null;

let cloudReadyResolve=null;
const cloudReadyP=new Promise(r=>{cloudReadyResolve=r;});
async function waitCloudReady(maxMs){
  try{
    if(isCloud) return true;
    await Promise.race([cloudReadyP, new Promise(r=>setTimeout(r, (typeof maxMs==='number'?maxMs:12000)))]);
  }catch(e){}
  return isCloud;
}

async function loadSupabaseSdk(){
  if(sb) return sb;
  const urls=[SUPABASE_CDN_PRIMARY, SUPABASE_CDN_FALLBACK];
  let lastErr=null;
  for(const url of urls){
    try{
      const mod=await import(/* @vite-ignore */ url);
      const factory=mod.createClient||(mod.default&&mod.default.createClient);
      if(typeof factory==='function'){
        sb=factory(supabaseBase(), SUPABASE_ANON_KEY, {
          auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false,
                 storageKey:'aurora_supabase_auth' },
          realtime:{ params:{ eventsPerSecond:8 } },
          global:{ headers:{ 'x-application-name':'aurora' } }
        });
        return sb;
      }
      throw new Error('createClient missing from '+url);
    }catch(e){ lastErr=e; sb=null; }
  }
  throw lastErr||new Error('Supabase SDK could not be loaded');
}

/* ---------------------------------------------------------------------------
   AUTH  —  same shape the app already expects (uid / displayName / email),
   so every existing login, sign-out and account-switch screen keeps working.
   Usernames become accounts through a stable synthetic address, exactly like
   before:  username  →  username@aurora-chat.app
--------------------------------------------------------------------------- */
const AURORA_ACCOUNT_DOMAIN='aurora-chat.app';
const auroraEmailFor=u=>String(u||'').toLowerCase().replace(/[^a-z0-9_]/g,'')+'@'+AURORA_ACCOUNT_DOMAIN;

function shimAuthUser(u){
  if(!u) return null;
  const meta=(u.user_metadata)||{};
  const displayName=meta.display_name||meta.full_name||(u.email||'').split('@')[0];
  return {
    uid:u.id,
    id:u.id,
    email:u.email,
    displayName,
    isAnonymous:false,
    emailVerified:!!u.email_confirmed_at,
    getIdToken:async()=>{ try{ return (sbSession&&sbSession.access_token)||''; }catch(e){ return ''; } }
  };
}
function applySession(session){
  sbSession=session||null;
  sbUser=(session&&session.user)||null;
  if(auth) auth.currentUser=shimAuthUser(sbUser);
  return auth.currentUser;
}

async function sbOnAuthStateChanged(cb){
  try{
    await loadSupabaseSdk();
    const { data }=await sb.auth.getSession();
    applySession(data&&data.session);
    cb(auth.currentUser);
    sb.auth.onAuthStateChange((_evt,session)=>{
      applySession(session);
      try{ cb(auth.currentUser); }catch(e){}
    });
  }catch(e){
    sbLoadError=e;
    try{ cb(null); }catch(_){}
  }
}

/* ---------------------------------------------------------------------------
   DATABASE  —  a small document-store adapter over Postgres.
   Why: ~50 places in Aurora already speak a collection()/doc()/onSnapshot() vocabulary.
   Keeping that vocabulary means the whole chat engine (receipts, typing,
   presence, notes, calls, notifications) kept working untouched while the
   storage engine underneath changed.

   Every table stores the document itself in a `data` jsonb column, plus a few
   promoted real columns that are only there for filtering/ordering/realtime.
   See supabase/schema.sql.
--------------------------------------------------------------------------- */
const SB_TABLES={
  users:'users', usernames:'usernames', presence:'presence', notes:'notes',
  rooms:'rooms', verified_users:'verified_users', notification_sounds:'notification_sounds',
  feedback:'feedback', voice_calls:'voice_calls', recovery_otp:'recovery_otp',
  recovery_mail:'recovery_mail'
};
// primary-key column(s) used when the doc id is a single string
const SB_PK={
  users:['uid'], usernames:['username'], presence:['username'], notes:['username'],
  rooms:['id'], verified_users:['id'], notification_sounds:['id'], feedback:['id'],
  voice_calls:['id'], recovery_otp:['username'], recovery_mail:['id'],
  messages:['id'], typing:['username'], voice_candidates:['id']
};
// jsonb keys that also live in a real column (queried / filtered / ordered)
const SB_PROMOTE={
  rooms:['participantUsernames'],
  users:['username'],
  messages:['timestamp'],
  voice_calls:['callee','caller','status'],
  notification_sounds:['scope']
};
// columns that replace the numeric 1MB document limit of the old backend
const SB_NO_CACHE=[];
const SERVER_TS={__aurora_server_ts:true};
function serverTimestamp(){ return {__aurora_server_ts:true}; }
function isServerTs(v){ return !!(v && v.__aurora_server_ts===true); }
function resolveServerValues(obj){
  if(obj===null||obj===undefined) return obj;
  if(Array.isArray(obj)) return obj.map(resolveServerValues);
  if(isServerTs(obj)) return Date.now();
  if(typeof obj==='object'){
    const out={};
    for(const k of Object.keys(obj)) out[k]=resolveServerValues(obj[k]);
    return out;
  }
  return obj;
}

function sbRoute(segs){
  const root=String((segs&&segs[0])||'');
  if(segs.length===3){
    const parent=segs[1], sub=segs[2];
    if(root==='rooms' && sub==='messages') return {table:'messages', fixed:{room_id:parent}, pk:['id']};
    if(root==='rooms' && sub==='typing')   return {table:'typing',   fixed:{room_id:parent}, pk:['username']};
    if(root==='voice_calls' && sub==='callerCandidates') return {table:'voice_candidates', fixed:{call_id:parent, side:'caller'}, pk:['id']};
    if(root==='voice_calls' && sub==='calleeCandidates') return {table:'voice_candidates', fixed:{call_id:parent, side:'callee'}, pk:['id']};
    throw new Error('Aurora cloud: unknown subcollection "'+segs.join('/')+'"');
  }
  const table=SB_TABLES[root];
  if(!table) throw new Error('Aurora cloud: unknown collection "'+root+'"');
  return {table, fixed:{}, pk:SB_PK[table]||['id']};
}
function sbNewId(){
  try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID().replace(/-/g,'').slice(0,20); }catch(e){}
  return (Date.now().toString(36)+Math.random().toString(36).slice(2,10)).slice(0,20);
}
function sbKeysFor(route, docId){
  const keys={};
  for(const c of Object.keys(route.fixed)) keys[c]=route.fixed[c];
  const remaining=(route.pk||[]).filter(c=>!(c in keys));
  if(remaining.length===1 && docId!==undefined && docId!==null && docId!=='') keys[remaining[0]]=String(docId);
  return keys;
}

/* ---- refs & query objects (document-store vocabulary) ---- */
function collection(db, ...segs){ return {__isCol:true, segs:segs.map(s=>String(s)), route:sbRoute(segs.map(s=>String(s)))}; }
function doc(db, ...segments){
  if(db && db.__isCol){
    const route=db.route, id=sbNewId();
    return {__isDoc:true, id, segs:db.segs.concat([id]), route, keys:sbKeysFor(route,id)};
  }
  const segs=segments.map(s=>String(s));
  const id=segs[segs.length-1];
  const route=sbRoute(segs.slice(0,-1));
  return {__isDoc:true, id, segs, route, keys:sbKeysFor(route,id)};
}
function where(field,op,value){ return {__isConstraint:true, kind:'where', field:field==='id'?'id':field, op, value}; }
function orderBy(field,dir){ return {__isConstraint:true, kind:'orderBy', field, dir:dir||'asc'}; }
function limit(n){ return {__isConstraint:true, kind:'limit', n:Number(n)||1}; }
function query(colRef, ...constraints){
  return {__isQuery:true, segs:colRef.segs, route:colRef.route, constraints:constraints.filter(Boolean)};
}
function writeBatch(db){
  const ops=[];
  return {
    set:(ref,data,opts)=>ops.push(()=>setDoc(ref,data,opts||{})),
    update:(ref,data)=>ops.push(()=>updateDoc(ref,data)),
    delete:(ref)=>ops.push(()=>deleteDoc(ref)),
    commit:async()=>{ for(const op of ops){ await op(); } return true; }
  };
}

/* ---- the write RPC: atomic insert-or-merge, matching the old semantics ---- */
async function sbWriteRow(table, keys, patch, upsert){
  const { error }=await sb.rpc('aurora_write_doc',{
    p_table:table, p_keys:keys, p_patch:patch||{}, p_upsert:!!upsert
  });
  if(error) throw new Error(sbErr(error));
}
async function sbPromote(table, keys, cols){
  const fields=Object.keys(cols||{});
  if(!fields.length) return;
  const { error }=await sb.from(table).update(cols).match(keys);
  if(error){ /* promoted columns are an index, never the source of truth */ }
}
function sbErr(e){
  if(!e) return 'Unknown cloud error';
  const m=e.message||String(e);
  if(/relation .* does not exist|Could not find the table/i.test(m))
    return m+' — run supabase/schema.sql in the Supabase SQL editor.';
  if(/permission denied|row-level security|violates row-level/i.test(m))
    return m+' — check the RLS policies from supabase/schema.sql.';
  if(/JWT|token|not authenticated/i.test(m))
    return m+' — sign in again.';
  return m;
}
function isCloudUp(){ return !!(isCloud && sb && auth && auth.currentUser); }
function requireCloud(){
  if(!isCloudUp()) throw new Error('Cloud not connected');
}

function sbBuildWrite(ref, data){
  const resolved=resolveServerValues(data||{});
  const patch={};
  for(const k of Object.keys(resolved)) patch[k]=resolved[k];
  const cols={};
  for(const f of (SB_PROMOTE[ref.route.table]||[])) if(f in patch) cols[f]=patch[f];
  return {keys:ref.keys, patch, cols};
}
async function setDoc(ref, data, opts){
  requireCloud();
  const w=sbBuildWrite(ref,data);
  await sbWriteRow(ref.route.table, w.keys, w.patch, true);       // merge / upsert
  await sbPromote(ref.route.table, w.keys, w.cols);
  return ref;
}
async function updateDoc(ref, data){
  requireCloud();
  const w=sbBuildWrite(ref,data);
  await sbWriteRow(ref.route.table, w.keys, w.patch, false);      // update only — stays faithful to "no document to update"
  await sbPromote(ref.route.table, w.keys, w.cols);
  return ref;
}
async function addDoc(colRef, data){
  requireCloud();
  const ref=doc(colRef);
  await setDoc(ref,data);
  return ref;
}
async function deleteDoc(ref){
  requireCloud();
  const { error }=await sb.from(ref.route.table).delete().match(ref.keys);
  if(error) throw new Error(sbErr(error));
  return true;
}
const SB_ROW_KEYS={};

async function sbSelectOne(ref){
  const { data, error }=await sb.from(ref.route.table).select('*').match(ref.keys).limit(1);
  if(error) throw new Error(sbErr(error));
  return (data&&data[0])||null;
}
function docSnapFrom(ref, row){
  const body=(row&&row.data&&typeof row.data==='object')?row.data:{};
  return {
    id:ref.id,
    ref,
    exists:()=>!!row,
    data:()=>row?body:undefined,
    get:(f)=>row?body[f]:undefined
  };
}
async function getDoc(ref){
  requireCloud();
  const row=await sbSelectOne(ref);
  return docSnapFrom(ref,row);
}

function sbApplyConstraints(builder, constraints){
  let lim=null, ord=null;
  for(const c of constraints||[]){
    if(!c||!c.__isConstraint) continue;
    if(c.kind==='where'){
      const v=c.value;
      if(c.op==='==') builder=builder.eq(c.field,v);
      else if(c.op==='!=') builder=builder.neq(c.field,v);
      else if(c.op==='>') builder=builder.gt(c.field,v);
      else if(c.op==='>=') builder=builder.gte(c.field,v);
      else if(c.op==='<') builder=builder.lt(c.field,v);
      else if(c.op==='<=') builder=builder.lte(c.field,v);
      else if(c.op==='array-contains') builder=builder.contains(c.field,Array.isArray(v)?v:[v]);
      else if(c.op==='in') builder=builder.in(c.field,Array.isArray(v)?v:[v]);
    }else if(c.kind==='orderBy'){ ord={field:c.field, desc:c.dir==='desc'}; }
    else if(c.kind==='limit'){ lim=c.n; }
  }
  if(ord) builder=builder.order(ord.field,{ascending:!ord.desc});
  if(lim) builder=builder.limit(lim);
  return builder;
}
async function sbSelect(target){
  const route=target.route;
  let builder=sb.from(route.table).select('*');
  /* CRITICAL: a subcollection lives in the same table as every other parent's
     rows (rooms/{id}/messages, voice_calls/{id}/callerCandidates, …), so the
     parent key MUST be applied here. Without it, a chat would render messages
     from every room and a call would feed other calls' ICE candidates into its
     peer connection. */
  const fixed=route.fixed||{};
  if(Object.keys(fixed).length) builder=builder.match(fixed);
  builder=sbApplyConstraints(builder,target.constraints||[]);
  const { data, error }=await builder;
  if(error) throw new Error(sbErr(error));
  return (data||[]).map(row=>{
    const body=(row.data&&typeof row.data==='object')?row.data:{};
    return {id:String(row[route.pk[0]]!==undefined?row[route.pk[0]]:row.id), data:body, row};
  });
}
function docsSnapshot(rows, changes){
  const snaps=rows.map(r=>({id:r.id, data:()=>r.data, get:(f)=>r.data[f], exists:()=>true}));
  snaps.forEach((s,i)=>{ s._row=rows[i]; });
  return {
    docs:snaps,
    size:snaps.length,
    empty:snaps.length===0,
    forEach:cb=>snaps.forEach(cb),
    docChanges:()=>changes||[],
    metadata:{fromCache:false}
  };
}

/* ---- realtime: postgres_changes → refetch (indexed queries, tiny payload) ---- */
function sbSubscribeChanges(route, onChange){
  let channel=null;
  try{
    const name='aurora-'+route.table+'-'+Math.random().toString(36).slice(2,9);
    channel=sb.channel(name);
    const cfg={event:'*', schema:'public', table:route.table};
    const fixedCols=Object.keys(route.fixed||{});
    if(fixedCols.length){
      /* Realtime accepts one filter column; the refetch narrows the rest.
         Filtering on the parent key keeps unrelated traffic out of the channel. */
      const c=fixedCols[0];
      cfg.filter=c+'=eq.'+String(route.fixed[c]);
    }
    channel.on('postgres_changes',cfg,()=>{ try{ onChange(); }catch(e){} });
    channel.subscribe();
  }catch(e){
    // Realtime unavailable → the app still works, just without live updates.
    return ()=>{};
  }
  return ()=>{ try{ sb.removeChannel(channel); }catch(e){} };
}

function onSnapshot(target, a, b, c){
  // (ref, cb) | (ref, cb, errCb) | (ref, options, cb) | (ref, options, cb, errCb)
  let opts={}, cb=null, errCb=null;
  if(typeof a==='function'){ cb=a; errCb=typeof b==='function'?b:null; }
  else { opts=a||{}; cb=typeof b==='function'?b:null; errCb=typeof c==='function'?c:null; }
  let stopped=false, unsub=null, prev=new Map(), first=true, timer=null;

  const emit=async()=>{
    if(stopped) return;
    try{
      if(target.__isDoc){
        const row=await sbSelectOne(target);
        if(stopped) return;
        const snap=docSnapFrom(target,row);
        const changes=[{type:row?'modified':'removed', doc:snap}];
        if(first){ changes[0]={type:row?'added':'removed', doc:snap}; first=false; }
        cb(snap);
      }else{
        const rows=await sbSelect(target);
        if(stopped) return;
        const next=new Map();
        const changes=[];
        for(const r of rows){
          next.set(r.id,r.data);
          const before=prev.get(r.id);
          const sig=JSON.stringify(r.data);
          if(!prev.has(r.id)) changes.push({type:'added', doc:{id:r.id, data:()=>r.data, get:f=>r.data[f], exists:()=>true}});
          else if(JSON.stringify(before)!==sig) changes.push({type:'modified', doc:{id:r.id, data:()=>r.data, get:f=>r.data[f], exists:()=>true}});
        }
        for(const id of prev.keys()){
          if(!next.has(id)) changes.push({type:'removed', doc:{id, data:()=>({}), get:()=>undefined, exists:()=>false}});
        }
        prev=next;
        if(first){ changes.length=0; for(const r of rows) changes.push({type:'added', doc:{id:r.id, data:()=>r.data, get:f=>r.data[f], exists:()=>true}}); first=false; }
        cb(docsSnapshot(rows,changes));
      }
    }catch(e){
      if(errCb){ try{ errCb(e); }catch(_){} } else { try{ console.warn('Aurora cloud listener:',sbErr(e)); }catch(_){} }
    }
  };
  const schedule=()=>{ if(timer) return; timer=setTimeout(()=>{ timer=null; emit(); },40); };

  emit();
  if(target.__isDoc){
    const pkCol=(SB_PK[target.route.table]||['id'])[0];
    const fixedCols=Object.keys(target.route.fixed||{});
    const filterCol=fixedCols.length?fixedCols[0]:pkCol;
    const filterVal=fixedCols.length?target.route.fixed[filterCol]:target.keys[pkCol];
    if(filterVal!==undefined){
      unsub=sbSubscribeChanges({table:target.route.table, fixed:{[filterCol]:filterVal}}, schedule);
    }
  }else{
    unsub=sbSubscribeChanges(target.route, schedule);
  }
  return ()=>{ stopped=true; if(timer){ clearTimeout(timer); timer=null; } if(unsub) try{ unsub(); }catch(e){} };
}

async function getDocs(target){
  requireCloud();
  const rows=await sbSelect(target);
  const changes=rows.map(r=>({type:'added', doc:{id:r.id, data:()=>r.data, get:f=>r.data[f], exists:()=>true}}));
  return docsSnapshot(rows,changes);
}

/* ---------------------------------------------------------------------------
   MEDIA  —  Supabase Storage replaces the old third-party uploader.
   Returns the same shape the app already consumed, so the composer, progress
   bar and message payloads did not need rewriting.
--------------------------------------------------------------------------- */
function cloudUploadEnabled(){ try{ return !!(isCloud && sb && auth && auth.currentUser && sbSession && sbSession.access_token); }catch(e){ return false; } }
function safeUploadName(name){
  const base=String(name||'file').replace(/[^\w.\-]+/g,'_').slice(-80);
  return base||'file';
}
async function uploadToStorage(blob, opts){
  opts=opts||{};
  if(!cloudUploadEnabled()) throw new Error('Cloud upload needs a signed-in account');
  const stamp=new Date();
  const folder='aurora-chat/'+stamp.getUTCFullYear()+'-'+String(stamp.getUTCMonth()+1).padStart(2,'0');
  const path=folder+'/'+sbNewId()+'-'+safeUploadName(opts.fileName||(blob&&blob.name)||'file');
  const userToken=(sbSession&&sbSession.access_token)||'';
  const base=supabaseBase();
  const url=base+'/storage/v1/object/'+encodeURIComponent(SUPABASE_BUCKET)+'/'+path.split('/').map(encodeURIComponent).join('/');
  const mime=opts.mime||(blob&&blob.type)||'application/octet-stream';

  const xhr=new XMLHttpRequest();
  const done=new Promise((resolve,reject)=>{
    xhr.open('POST',url);
    xhr.timeout=10*60*1000;                       // slow mobile networks, big videos
    xhr.setRequestHeader('apikey',SUPABASE_ANON_KEY);
    if(userToken) xhr.setRequestHeader('authorization','Bearer '+userToken);
    xhr.setRequestHeader('x-upsert','true');
    xhr.setRequestHeader('cache-control','3600');
    try{ xhr.setRequestHeader('content-type',mime); }catch(e){}
    if(xhr.upload){ xhr.upload.onprogress=e=>{
      if(e&&e.lengthComputable&&opts.onProgress){ try{ opts.onProgress(Math.max(1,Math.floor(e.loaded/e.total*100))); }catch(_){} }
    }; }
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){
        resolve({ secure_url: base+'/storage/v1/object/public/'+encodeURIComponent(SUPABASE_BUCKET)+'/'+path.split('/').map(encodeURIComponent).join('/'),
                  bytes: (blob&&blob.size)||0, public_id: path, path });
      }else{
        let detail=''; try{ detail=JSON.parse(xhr.responseText||'{}').message||''; }catch(e){}
        reject(new Error(detail||('Upload failed ('+xhr.status+')')));
      }
    };
    xhr.onerror=()=>reject(new Error('Network error — check your internet'));
    xhr.ontimeout=()=>reject(new Error('Upload timed out'));
    try{ xhr.send(blob); }catch(e){ reject(new Error('Upload could not start: '+e.message)); }
  });
  return done;
}
/* Public storage URL → force a download under the ORIGINAL file name. */
function mediaDownloadUrl(url, name){
  try{
    if(!url || !/^https?:\/\//.test(url)) return url;
    if(/supabase\.(co|in)\//.test(url) || url.indexOf('/storage/v1/object/public/')>-1){
      const sep=url.indexOf('?')>-1?'&':'?';
      return url.indexOf('download=')>-1?url:(url+sep+'download='+encodeURIComponent(name||''));
    }
    return url;
  }catch(e){ return url; }
}

/* ---------------------------------------------------------------------------
   Drop-in exports. The rest of Aurora imports these exactly where it used to
   import the old SDK, so no call site had to change shape.
--------------------------------------------------------------------------- */
const AURORA_SB = { collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc,
                    deleteDoc, query, where, orderBy, limit, onSnapshot, writeBatch,
                    serverTimestamp };

const AURORA_SB_APP = { initializeApp:()=>({ __isCloudApp:true, name:'aurora' }) };

const AURORA_SB_AUTH = {
  getAuth:()=>auth,
  onAuthStateChanged:(_authRef,cb)=>sbOnAuthStateChanged(cb),
  signOut:async()=>{ try{ await sb.auth.signOut(); }catch(e){} applySession(null); },
  createUserWithEmailAndPassword:async(_authRef,email,password)=>{
    await loadSupabaseSdk();
    const { data, error }=await sb.auth.signUp({ email, password });
    if(error){
      const m=String(error.message||'');
      if(/already registered|already been registered|user already/i.test(m)) throw new Error('email-already-in-use');
      if(/password|weak/i.test(m)) throw new Error('weak-password');
      throw new Error(m);
    }
    if(!data.session){
      /* GoTrue is set to require e-mail confirmation: the account exists but
         cannot be used yet. Say so plainly instead of pretending it worked. */
      throw new Error('email-not-confirmed');
    }
    applySession(data.session);
    return { user:data.user, __cloudUser:shimAuthUser(data.user) };
  },
  signInWithEmailAndPassword:async(_authRef,email,password)=>{
    await loadSupabaseSdk();
    const { data, error }=await sb.auth.signInWithPassword({ email, password });
    if(error){
      const m=String(error.message||'');
      if(/invalid login|invalid credentials|email not confirmed|does not exist/i.test(m)) throw new Error('invalid-credential');
      throw new Error(m);
    }
    applySession(data.session);
    return { user:data.user, __cloudUser:shimAuthUser(data.user) };
  },
  updateProfile:async(_user,fields)=>{
    const displayName=(fields&&fields.displayName)||'';
    try{
      await sb.auth.updateUser({ data:{ display_name:displayName } });
      if(sbUser) sbUser.user_metadata={ ...(sbUser.user_metadata||{}), display_name:displayName };
      if(auth) auth.currentUser=shimAuthUser(sbUser);
    }catch(e){ /* metadata is cosmetic: never block the signup flow */ }
  },
  EmailAuthProvider:{ credential:(email,password)=>({ email, password }) },
  reauthenticateWithCredential:async(_user,cred)=>{
    const { error }=await sb.auth.signInWithPassword({ email:cred.email, password:cred.password });
    /* the token keeps the app's existing "wrong current password" branch working */
    if(error) throw new Error('invalid-credential: current password is incorrect');
    return true;
  },
  updatePassword:async(_user,newPassword)=>{
    const { error }=await sb.auth.updateUser({ password:newPassword });
    if(error){
      const m=String(error.message||'');
      if(/password/i.test(m)) throw new Error('weak-password: '+m);
      if(/session|recent|jwt|token/i.test(m)) throw new Error('requires-recent-login: '+m);
      throw new Error(m);
    }
    return true;
  }
};

/* ---------------------------------------------------------------------------
   BOOT
--------------------------------------------------------------------------- */
async function tryCloudInit(){
  await new Promise(r=>setTimeout(r,(cloudConfigured()?300:1200)));
  if(!cloudConfigured()){
    try{ cloudReadyResolve&&cloudReadyResolve(); }catch(e){}
    try{ window.auroraCloud={ configured:false, mode:'local', ready:false }; }catch(e){}
    return;
  }
  try{
    await loadSupabaseSdk();
    auth={ currentUser:null, __isCloud:true };
    db={ __isCloud:true, client:sb };
    isCloud=true;
    try{ window.AuroraSoundLibrary?.connectCloud(); }catch(e){}
    try{ cloudReadyResolve&&cloudReadyResolve(); }catch(e){}
    try{ bootstrapVerifiedUsers(); }catch(e){}
    const badge=$('#statusBadge');
    if(badge){ badge.textContent='● Live • Premium • Stable'; badge.className='status-badge status-fb'; }
    /* Local accounts still get live receipts/typing once the cloud is up. */
    try{
      if(currentUserData && !currentUserData.cloud){
        initCloudRealtime();
        try{ initIncomingCallListener(); }catch(e){}
      }
    }catch(e){ console.log('Local realtime init fail', e); }

    await sbOnAuthStateChanged(async (user)=>{
      if(localStorage.getItem('aurora_force_logout')==='1'){
        try{ await sb.auth.signOut(); }catch(e){}
        try{ localStorage.removeItem('aurora_force_logout'); localStorage.removeItem('aurora_logged_out_user'); }catch(e){}
        return;
      }
      if(user){
        const username=user.displayName?.split('__')[0]||user.email.split('@')[0];
        const nickname=user.displayName?.split('__')[1]||username;
        currentUser=user;
        currentUserData={ username, nickname, uid:user.uid,
          avatar:(nickname||username).slice(0,2).toUpperCase(),
          color:colors[(nickname||username).length%colors.length], cloud:true };
        try{
          const users=getUsers();
          if(users[username] && users[username].avatarUrl) currentUserData.avatarUrl=users[username].avatarUrl;
        }catch(e){}
        afterLogin();
        initCloudRealtime();
        initIncomingCallListener();
      }
    });

    try{
      window.auroraCloud={
        configured:true, ready:true, mode:'cloud',
        user:()=>sbUser?sbUser.id:null,
        session:()=>sbSession,
        client:()=>sb,
        auth, db,
        selftest:auroraCloudSelfTest
      };
    }catch(e){}
    console.log('%cAurora cloud · Supabase connected','color:#10b981;font-weight:700');
  }catch(e){
    isCloud=false; sbLoadError=e;
    console.warn('Aurora cloud init failed — staying in local mode:', e&&e.message);
    try{ cloudReadyResolve&&cloudReadyResolve(); }catch(x){}
    try{ window.auroraCloud={ configured:cloudConfigured(), mode:'local', error:String(e&&e.message||e) }; }catch(x){}
    try{ showToast({title:'Offline mode', body:'Cloud unreachable — chats stay on this device.', color:'#f59e0b', avatar:'☁️'}); }catch(x){}
  }
}
setTimeout(tryCloudInit, 600);

/* A 10-second health check you can run from the console:  auroraCloud.selftest() */
async function auroraCloudSelfTest(){
  const report={ configured:cloudConfigured(), sdk:!!sb, signedIn:!!(sbSession&&sbSession.user), tables:{}, storage:null };
  if(!sb) return report;
  for(const t of ['users','rooms','messages','presence','notes','voice_calls']){
    try{
      const { error }=await sb.from(t).select('*').limit(1);
      report.tables[t]=error?('✗ '+sbErr(error)):'✓';
    }catch(e){ report.tables[t]='✗ '+(e&&e.message); }
  }
  try{
    const { error }=await sb.storage.from(SUPABASE_BUCKET).list('',{limit:1});
    report.storage=error?('✗ '+error.message):'✓ bucket '+SUPABASE_BUCKET;
  }catch(e){ report.storage='✗ '+(e&&e.message); }
  return report;
}

let app=null, auth=null, db=null, isCloud=false, currentUser=null, currentUserData=null;
let contacts=[], currentRoomId=null, unsubRooms=null, unsubMessages=null;
const $=s=>document.querySelector(s);
const colors=['#2563eb','#0f172a','#f43f5e','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ec4899'];

/* ==================== 🔔 NOTIFICATION SYSTEM ==================== */
let notificationsEnabled=(localStorage.getItem('aurora_notif_enabled')??'1')==='1';
let unreadCounts={}; try{unreadCounts=JSON.parse(localStorage.getItem('aurora_unread')||'{}');}catch{}
const prevRoomSig={};      // roomId -> lastTime|lastMessage (change detect korar jonno)
const recentNotif=new Map(); // account + room + message ID, shared by all arrival listeners
function persistUnread(){try{localStorage.setItem('aurora_unread',JSON.stringify(unreadCounts));}catch{}}
function totalUnread(){return Object.values(unreadCounts).reduce((a,b)=>a+(b||0),0);}
function updateDocTitle(){const n=totalUnread(); document.title=n>0?`(${n}) Aurora • Premium`:'Aurora • Premium • Stable';}
function bumpUnread(roomId){unreadCounts[roomId]=(unreadCounts[roomId]||0)+1; persistUnread(); updateDocTitle();}
function clearUnread(roomId){if(unreadCounts[roomId]){delete unreadCounts[roomId]; persistUnread(); updateDocTitle();}}
function updateNotifBell(){const b=$('#notifBtn'); if(!b) return; b.textContent=notificationsEnabled?'🔔':'🔕'; b.style.background=notificationsEnabled?'#f0fdf4':'#fef2f2'; b.style.border=notificationsEnabled?'1px solid #bbf7d0':'1px solid #fecaca';}

// Notification tones: one sound catalog for previews, Test Alert and real alerts.
// All tones are generated locally with Web Audio; no files or network are needed.
const NOTIF_TONE_PROFILES = Object.freeze({
  breeze:{name:'Aurora Breeze (Default)',description:'Two gentle, falling notes',notes:[
    {at:0,hz:1046.50,duration:.30,level:.14,attack:.018},
    {at:.18,hz:783.99,duration:.40,level:.12,attack:.022}
  ]},
  ping:{name:'Soft Ping',description:'One short, clear high note',notes:[
    {at:0,hz:1318.51,duration:.22,level:.13,attack:.006}
  ]},
  chime:{name:'Glass Chime',description:'Three sparkling bell notes',notes:[
    {at:0,hz:1046.50,duration:.76,level:.09,attack:.004,partials:[[1,1],[2.76,.27],[4.07,.08]]},
    {at:.18,hz:1318.51,duration:.78,level:.08,attack:.004,partials:[[1,1],[2.76,.27],[4.07,.08]]},
    {at:.36,hz:1567.98,duration:.90,level:.075,attack:.004,partials:[[1,1],[2.76,.27],[4.07,.08]]}
  ]},
  pop:{name:'Bubble Pop',description:'Two quick, low bubble pops',notes:[
    {at:0,hz:760,toHz:190,duration:.13,level:.20,attack:.004,type:'sine'},
    {at:.16,hz:540,toHz:150,duration:.12,level:.15,attack:.004,type:'sine'}
  ]},
  silent:{name:'Silent',description:'No notification sound',notes:[]}
});
function normaliseNotifSound(id){
  return typeof id==='string' && (Object.prototype.hasOwnProperty.call(NOTIF_TONE_PROFILES,id) || /^custom-[a-z0-9-]{8,80}$/.test(id))?id:'breeze';
}
let notifAudioCtx=null;
let notifSoundGeneration=0;
let activeNotifTone=null;
function getNotifAudioContext(){
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx) return null;
  if(!notifAudioCtx || notifAudioCtx.state==='closed') notifAudioCtx=new AudioCtx();
  return notifAudioCtx;
}
function stopNotifSound(){
  // Invalidate a pending resume as well as any already-playing preview. A quick
  // selection of Silent must never allow an older tone to start afterwards.
  notifSoundGeneration++;
  const group=activeNotifTone;
  activeNotifTone=null;
  if(!group) return;
  try{
    const now=group.ctx.currentTime;
    group.bus.gain.cancelScheduledValues(now);
    group.bus.gain.setValueAtTime(group.bus.gain.value,now);
    group.bus.gain.linearRampToValueAtTime(0,now+.012);
    group.voices.forEach(({osc})=>{try{osc.stop(now+.014);}catch(e){}});
  }catch(e){}
  // Also disconnect if the page/audio clock is suspended before onended fires.
  setTimeout(()=>{
    group.voices.forEach(({osc,gain})=>{try{osc.disconnect();gain.disconnect();}catch(e){}});
    group.voices.clear();
    try{group.bus.disconnect();}catch(e){}
  },35);
}
function scheduleNotifTone(ctx,profile){
  const bus=ctx.createGain();
  bus.gain.value=.85;
  bus.connect(ctx.destination);
  const group={ctx,bus,voices:new Set()};
  const start=ctx.currentTime+.012;
  profile.notes.forEach(note=>{
    (note.partials||[[1,1]]).forEach(([ratio,weight])=>{
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      const at=start+note.at, end=at+note.duration;
      osc.type=note.type||'sine';
      osc.frequency.setValueAtTime(note.hz*ratio,at);
      if(note.toHz) osc.frequency.exponentialRampToValueAtTime(note.toHz*ratio,at+note.duration*.82);
      gain.gain.setValueAtTime(.0001,at);
      gain.gain.linearRampToValueAtTime(note.level*weight,at+note.attack);
      gain.gain.exponentialRampToValueAtTime(.0001,end);
      osc.connect(gain);gain.connect(bus);
      const voice={osc,gain};group.voices.add(voice);
      osc.onended=()=>{
        try{osc.disconnect();gain.disconnect();}catch(e){}
        group.voices.delete(voice);
        if(!group.voices.size){
          try{bus.disconnect();}catch(e){}
          if(activeNotifTone===group) activeNotifTone=null;
        }
      };
      osc.start(at);osc.stop(end+.015);
    });
  });
  return group;
}
function scheduleCustomNotifTone(ctx,buffer){
  const bus=ctx.createGain(),gain=ctx.createGain(),source=ctx.createBufferSource();
  bus.gain.value=.55;bus.connect(ctx.destination);source.buffer=buffer;
  const at=ctx.currentTime+.012,end=at+buffer.duration;
  gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(1,at+Math.min(.008,buffer.duration/4));
  gain.gain.setValueAtTime(1,Math.max(at+.008,end-.012));gain.gain.linearRampToValueAtTime(.0001,end);
  source.connect(gain);gain.connect(bus);
  const voice={osc:source,gain},group={ctx,bus,voices:new Set([voice])};
  source.onended=()=>{try{source.disconnect();gain.disconnect();bus.disconnect();}catch(e){}group.voices.clear();if(activeNotifTone===group) activeNotifTone=null;};
  source.start(at);source.stop(end+.015);return group;
}
async function playNotifSound(soundId,options={}){
  stopNotifSound();
  const generation=notifSoundGeneration;
  const id=normaliseNotifSound(soundId==null?getNotifPrefs().sound:soundId);
  const profile=NOTIF_TONE_PROFILES[id];
  if(profile && !profile.notes.length) return false; // Silent does not even open an AudioContext.
  try{
    const ctx=getNotifAudioContext();
    if(!ctx) return false;
    if(ctx.state!=='running'){
      let timer;
      // Do not leave a blocked background alert waiting to sound much later.
      const resumed=await Promise.race([
        ctx.resume().then(()=>true,()=>false),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1200);})
      ]);
      clearTimeout(timer);
      if(!resumed) return false;
    }
    if(ctx.state!=='running' || generation!==notifSoundGeneration) return false;
    if(profile){activeNotifTone=scheduleNotifTone(ctx,profile);}
    else{
      let timer;
      const loading=window.AuroraSoundLibrary.audioBuffer(id,ctx);
      let buffer;
      try{buffer=options.preview?await loading:await Promise.race([loading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audio is still loading; the default alert was used.')),1500);})]);}
      finally{clearTimeout(timer);}
      if(ctx.state!=='running' || generation!==notifSoundGeneration) return false;
      activeNotifTone=scheduleCustomNotifTone(ctx,buffer);
    }
    return true;
  }catch(e){
    if(generation===notifSoundGeneration && !profile){
      window.AuroraSoundLibrary?.reportError(new Error('Custom sound unavailable. '+(e.message||'Try again.')));
      // An unavailable custom clip should not silently swallow a real alert.
      if(!options.preview && notifAudioCtx?.state==='running') activeNotifTone=scheduleNotifTone(notifAudioCtx,NOTIF_TONE_PROFILES.breeze);
    }
    return false;
  }
}
// A genuine tap/key gesture unlocks Web Audio for later incoming messages.
// No tone is played here, and mute/Silent preferences are not bypassed.
function unlockNotifAudio(){
  try{
    if(!notificationsEnabled || getNotifPrefs().sound==='silent') return;
    if(notifAudioCtx && notifAudioCtx.state==='running') return;
    const ctx=getNotifAudioContext();
    if(ctx && ctx.state!=='running') ctx.resume().catch(()=>{});
  }catch(e){}
}
document.addEventListener('pointerdown',unlockNotifAudio,{capture:true,passive:true});
document.addEventListener('keydown',unlockNotifAudio,{capture:true});
window.addEventListener('pagehide',stopNotifSound);

// Incoming call ringtone
let ringtoneTimer=null;
function startRingtone(){
  stopRingtone();
  const ring=()=>{try{
    if(!notifAudioCtx) notifAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const ctx=notifAudioCtx; if(ctx.state==='suspended') ctx.resume();
    [0,0.25].forEach(off=>{
      const t=ctx.currentTime+off;
      const o=ctx.createOscillator(); const g=ctx.createGain();
      o.type='sine'; o.frequency.value=off?880:988;
      g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.15,t+.03); g.gain.exponentialRampToValueAtTime(.0001,t+.22);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+.25);
    });
  }catch(e){}};
  ring(); ringtoneTimer=setInterval(ring,2000);
}
function stopRingtone(){if(ringtoneTimer){clearInterval(ringtoneTimer); ringtoneTimer=null;}}

// In-app toast (app khola thakle upore alert dekhabe)
/* BUGFIX: #toastWrap never existed in the HTML, so every showToast() call
   bailed out silently. Create the container on first use, inside #phoneShell
   so the .phone-shell .toast-wrap CSS rules apply. */
function ensureToastWrap(){
  let wrap=document.getElementById('toastWrap');
  if(wrap) return wrap;
  wrap=document.createElement('div');
  wrap.id='toastWrap';
  wrap.className='toast-wrap';
  const host=document.getElementById('phoneShell')||document.body;
  if(!host) return null;
  host.appendChild(wrap);
  return wrap;
}
function showToast(opts){
  const wrap=ensureToastWrap(); if(!wrap) return;
  const t=document.createElement('div');
  t.className='toast';
  t.setAttribute('role','status');
  if(opts.roomId) t.dataset.roomId=opts.roomId;
  const avatar=document.createElement('div');avatar.className='t-avatar';
  const initials=String(opts.avatar||'◐');
  avatar.textContent=initials;avatar.style.background=opts.color||'#7c3aed';
  if(/^data:image\//i.test(String(opts.avatarUrl||''))){
    const image=document.createElement('img');image.alt='';
    image.onerror=()=>{avatar.textContent=initials;avatar.style.background=opts.color||'#7c3aed';};
    image.src=String(opts.avatarUrl);avatar.replaceChildren(image);avatar.style.background='transparent';
  }
  const body=document.createElement('div');body.className='t-body';
  const title=document.createElement('div');title.className='t-title';title.textContent=opts.title||'New message';
  const text=document.createElement('div');text.className='t-text';text.textContent=opts.body||'';
  body.append(title,text);t.append(avatar,body);
  t.onclick=()=>{try{window.focus();}catch{} if(opts.roomId){try{window.switchBottomNav?.('chats');}catch(e){} clearUnread(opts.roomId); openRoom(opts.roomId);} t.remove();};
  wrap.appendChild(t);
  while(wrap.children.length>4) wrap.firstElementChild.remove();
  setTimeout(()=>{t.classList.add('out'); setTimeout(()=>{try{t.remove();}catch{}},320);},4500);
}

/* Foreground notification routing must outlive any one conversation. */
let roomsRealtimeVersion=0;
function isConversationVisible(roomId){
  if(!roomId || currentRoomId!==roomId || document.hidden) return false;
  const panel=document.getElementById('mainPanel');
  if(!panel || !panel.classList.contains('open') || panel.hidden) return false;
  const style=getComputedStyle(panel);
  if(style.display==='none' || style.visibility==='hidden' || !panel.getClientRects().length) return false;
  // A selected room is not necessarily the screen the person is reading.
  return !['settingsView','notifView','profileView','appearView','securityView','billingView','privacyView','helpView','devUsersView'].some(id=>{
    const view=document.getElementById(id);
    return view && view.classList.contains('show') && !view.hidden && getComputedStyle(view).display!=='none';
  });
}
function leaveConversation(){
  const previous=currentRoomId;
  try{stopMyTyping(previous);stopTypingListener();}catch(e){}
  try{if(unsubMessages){unsubMessages();unsubMessages=null;}}catch(e){}
  try{window.AuroraVoice?.pauseAll();}catch(e){}
  currentRoomId=null;
  const panel=document.getElementById('mainPanel');
  if(panel){panel.classList.remove('open');panel.style.display='none';}
  document.body.classList.remove('chat-open');
  document.getElementById('phoneShell')?.classList.remove('chat-open');
  const row=document.getElementById('typingRow');
  if(row){row.classList.remove('show');row.setAttribute('aria-hidden','true');}
  // Keep unsubRooms and prevRoomSig: they belong to the account, not this view.
}
function notificationTime(value){
  if(typeof value==='number') return value;
  if(value?.toMillis) return value.toMillis();
  if(value?.seconds) return value.seconds*1000+(value.nanoseconds||0)/1000000;
  return 0;
}
function notificationRoomSignature(room){
  const last=Array.isArray(room?.messages)?room.messages.at(-1):null;
  return JSON.stringify([
    String(last?.id || room?.lastMessageId || ''),
    notificationTime(last?.timestamp || room?.lastMessageAt),
    String(room?.lastTime || ''),String(room?.lastMessage || '')
  ]);
}
function rememberNotificationMessage(roomId,messageId){
  if(!messageId) return true;
  const key=(currentUserData?.username||'guest')+'|'+roomId+'|'+messageId;
  if(recentNotif.has(key)) return false;
  recentNotif.set(key,Date.now());
  if(recentNotif.size>800) recentNotif.delete(recentNotif.keys().next().value);
  return true;
}
function notificationMessagePreview(message){
  // a reply to someone's note says so in the notification body
  if(message && message.noteReply && message.noteReply.text){
    return '↩ Replied to a note: '+String(message.text||'New message').slice(0,70);
  }
  if(AuroraVoice.isVoiceMessage(message)) return '🎤 Voice message';
  if(message.type==='image') return '📷 Photo';
  if(message.type==='video') return '🎥 Video';
  if(message.type==='file') return '📎 '+String(message.fileName||'File').slice(0,65);
  if(/^(data:|blob:)/.test(String(message.text||''))) return '📎 Media';
  return String(message.text||'New message').slice(0,90);
}
function messageNotificationOptions(roomId,message,room={}){
  const sender=message.senderName||message.sender||room.lastSenderUsername||room.lastSenderName||'';
  const cached=getUsers()[sender]||{};
  const name=message.senderNickname||room.lastSenderNickname||cached.nickname||sender||'New message';
  const isGroup=room.isGroup===true || room.type==='group' || (room.participantUsernames||room.participants||[]).length>2;
  return {
    roomId,messageId:message.id||room.lastMessageId||('legacy:'+notificationRoomSignature(room)),
    senderId:message.senderId||room.lastSenderId||'',senderUsername:sender,
    title:isGroup?(room.name||room.groupName||'Group message'):name,
    body:(isGroup?name+': ':'')+notificationMessagePreview(message),kind:isGroup?'groups':'messages',
    color:message.senderColor||cached.color||room.color||'#7c3aed',
    avatar:String(name).slice(0,2).toUpperCase(),avatarUrl:cached.avatarUrl||room.participantAvatars?.[sender]||null,
    system:message.system===true
  };
}
async function notifyRoomSummary(roomId,room,previous,sessionVersion){
  const username=currentUserData?.username;
  if(!username || !room.lastMessage) return;
  const freshIdentity=room.lastMessageId && room.lastMessageId!==previous?.lastMessageId;
  if(!freshIdentity && ['New conversation','Cleared'].includes(room.lastMessage)) return;
  let message;
  const unchangedId=previous?.lastMessageId && previous.lastMessageId===room.lastMessageId;
  if(room.lastMessageId && (room.lastSenderUsername||room.lastSenderName||room.lastSenderId) && !unchangedId){
    message={id:room.lastMessageId,text:room.lastMessage,type:room.lastMessageType||'text',senderId:room.lastSenderId,senderName:room.lastSenderUsername||room.lastSenderName,senderNickname:room.lastSenderNickname};
  }else{
    // Older senders did not write a message ID/sender in the room summary.
    // Read only the latest message when such a summary changes, not every
    // message in every conversation. New clients need no extra notification read.
    try{
      const {collection,query,orderBy,limit,getDocs}=AURORA_SB;
      const snap=await getDocs(query(collection(db,'rooms',roomId,'messages'),orderBy('timestamp','desc'),limit(1)));
      const latest=snap.docs[0];
      if(latest) message={...latest.data(),id:latest.id};
    }catch(e){
      // Preserve legacy alerts even when an old project's message-list rules
      // don't allow the optional preview read. Normal message reads are unchanged.
      const other=(room.participantUsernames||[]).find(u=>u!==username)||room.otherUsername||'';
      message={id:'legacy:'+notificationRoomSignature(room),text:room.lastMessage,senderName:other};
    }
  }
  if(!message || message.system || currentUserData?.username!==username || sessionVersion!==roomsRealtimeVersion) return;
  if(notifyIncomingMessage(messageNotificationOptions(roomId,message,room))!==false){
    bumpUnread(roomId);renderChats();
  }
}
async function persistCloudChatMessage(roomId,message,preview){
  // Publish the message and its notification identity together: a recipient's
  // account-level listener must never depend on opening that conversation.
  const {collection,doc,writeBatch,serverTimestamp}=AURORA_SB;
  const messageRef=doc(collection(db,'rooms',roomId,'messages'));
  const summary={
    lastMessage:preview,lastTime:message.time||timeNow(),lastMessageId:messageRef.id,
    lastMessageAt:serverTimestamp(),lastSenderId:message.senderId||'',
    lastSenderUsername:message.senderName||'',lastSenderNickname:message.senderNickname||message.senderName||'',
    lastMessageType:message.type||'text'
  };
  const commitAll=async()=>{
    const batch=writeBatch(db);
    batch.set(messageRef,message);
    batch.update(doc(db,'rooms',roomId),summary);
    await batch.commit();
  };
  try{
    await commitAll();
  }catch(err){
    // "No document to update": the room doc is missing (a chat restored from
    // the local index, or a create that never landed). Rebuild the room, then
    // send the message again - typing in a chat must never silently fail.
    try{
      const row=(contacts||[]).find(c=>c.id===roomId)||{};
      const me=String((currentUserData&&currentUserData.username)||'').toLowerCase();
      const other=String(row.otherUsername||row.username||'').toLowerCase() ||
                  String(roomId||'').split('_').find(u=>u&&u!==me) || '';
      await createCloudRoomForEntry({id:roomId,other:other,name:row.displayName||row.nickname||other,
                                     last:preview,time:message.time||timeNow(),color:row.color});
      await commitAll();
      console.log('room repaired then message sent', roomId);
    }catch(err2){
      console.log('persist fail (room repair failed)', err2.message);
      throw err2;
    }
  }
  return messageRef;
}

// Main notifier - toast + sound + browser notification
function notifyIncomingMessage(opts){
  const rid=opts.roomId||'x';
  if(!currentUserData || opts.system ||
      (opts.senderId && opts.senderId===currentUser?.uid) ||
      (opts.senderUsername && opts.senderUsername===currentUserData.username)) return false;
  try{if(opts.senderUsername && isUserBlocked(opts.senderUsername)) return false;}catch(e){}
  const identity=opts.messageId||('legacy:'+String(opts.body||'')+':'+Math.floor(Date.now()/1500));
  if(!rememberNotificationMessage(rid,identity)) return false;
  // Do not notify only when THIS conversation is actually on screen.
  // Merely having the app/tab open must not suppress another room's alert.
  if(isConversationVisible(rid)) return false;
  // 🔕 Check if this chat is muted
  if(localStorage.getItem('aurora_mute_'+rid)==='1'){
    return true; // muted: unread count hobe kintu sound/toast/browser notification bondho
  }
  // 🚫 Check if sender is blocked
  if(opts.senderUsername){
    const blocked=JSON.parse(localStorage.getItem('aurora_blocked')||'[]');
    if(blocked.includes(opts.senderUsername)){
      return false; // blocked user er message notification hobe na, unread o hobe na
    }
  }
  // ⚙️ Notification prefs (message/group/calls + quiet hours)
  try{
    const _p = (typeof getNotifPrefs==='function') ? getNotifPrefs() : null;
    if(_p){
      const kind = opts.kind || 'messages';
      if(kind==='calls' && _p.calls===false) return true;
      if(kind==='groups' && _p.groups===false) return true;
      if(kind!=='calls' && kind!=='groups' && _p.messages===false) return true;
      if(typeof isQuietHoursNow==='function' && isQuietHoursNow()) return true;
      if(_p.sound==='silent'){ /* sound skipped below via flag */ opts._silentSound=true; }
    }
  }catch(e){}
  if(!notificationsEnabled) return true; // unread count hobe, kintu sound/toast off
  if(!opts._silentSound) playNotifSound();
  showToast(opts);
  // Tab hide/minimize thakle browser notification
  if(document.hidden && 'Notification' in window && Notification.permission==='granted'){
    try{
      const n=new Notification(opts.title||'Aurora',{body:opts.body||'New message',tag:'aurora_'+rid,silent:true});
      n.onclick=()=>{try{window.focus();}catch{} if(opts.roomId){try{window.switchBottomNav?.('chats');}catch(e){} clearUnread(opts.roomId); openRoom(opts.roomId);} n.close();};
    }catch(e){}
  }
  return true;
}
/* ================== END NOTIFICATION SYSTEM ================== */

/* ==================== 🔵 ONLINE/OFFLINE PRESENCE SYSTEM ==================== */
/* Heartbeat slowed 30s -> 90s to cut database reads by ~2/3.
   ONLINE_THRESHOLD must stay >= 2x the interval or users flicker offline.
   Instead of showing a stale "Online" for the whole 210s window, anything
   older than one missed beat (>=100s) is reported as "X min ago". */
const PRESENCE_INTERVAL=90000;  // 90s heartbeat
const ONLINE_THRESHOLD=210000;  // 210s = 2.3x, safe against flapping
const ONLINE_FRESH=100000;      // only <100s old counts as a live "Online" dot
let presenceTimer=null;
let unsubPresence=null;
const userPresenceCache={};  // username -> {online: bool, lastSeen: timestamp}
function presenceTimeMs(v){
  try{
    if(!v) return 0;
    if(typeof v==='number') return v;
    if(v.toMillis) return v.toMillis();
    if(v.seconds) return v.seconds*1000;
    const n=Number(v); if(!isNaN(n) && n>0) return n;
    const p=Date.parse(v); return isNaN(p)?0:p;
  }catch(e){ return 0; }
}

// Ami online - heartbeat pathai cloud-এ
async function startPresenceHeartbeat(){
  if(!currentUserData) return;
  // Set online immediately
  await setMyPresence(true);
  // Start heartbeat interval
  if(presenceTimer) clearInterval(presenceTimer);
  /* FIX: the timer used to fire even while the tab was hidden, so the
     visibilitychange handler's "offline" was overwritten 30s later and we
     paid for a pointless write+fanout. Skip the beat when hidden. */
  presenceTimer=setInterval(()=>{
    if(document.hidden) return;
    setMyPresence(true);
  }, PRESENCE_INTERVAL);
}

async function setMyPresence(online){
  if(!currentUserData) return;
  const now=Date.now();
  // Local storage presence (same device multi-tab)
  try{
    const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
    presence[String(currentUserData.username).toLowerCase()]={online:online, lastSeen:now, ts:now};
    localStorage.setItem('aurora_presence',JSON.stringify(presence));
  }catch(e){}
  // Cloud presence
  if(isCloud && db){
    try{
      const {doc,setDoc}=AURORA_SB;
      const myNote=getUserNote(currentUserData.username);
      await setDoc(doc(db,'presence',currentUserData.username),{
        online:online,
        lastSeen:now,
        username:currentUserData.username,
        nickname:currentUserData.nickname||currentUserData.username,
        note: myNote?.text || '',
        noteEmoji: myNote?.emoji || '',
        noteExp: myNote?.exp || 0,
        noteTs: myNote?.ts || 0
      },{merge:true});
    }catch(e){console.log('Presence write fail',e.message);}
  }
}

// Stop heartbeat + set offline
async function stopPresenceHeartbeat(){
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
  if(currentUserData) await setMyPresence(false);
}

// Check if a user is online
function isUserOnline(username){
  if(!username) return false;
  const un=String(username).toLowerCase();
  const cached=userPresenceCache[un] || userPresenceCache[username];
  if(cached && cached.lastSeen){
    const last=presenceTimeMs(cached.lastSeen);
    return !!cached.online && last && (Date.now()-last)<ONLINE_FRESH;
  }
  // Check local storage presence (same browser / local mode)
  try{
    const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
    const row=presence[un]||presence[username];
    if(row && row.lastSeen){
      const last=presenceTimeMs(row.lastSeen);
      const online=!!row.online && last && (Date.now()-last)<ONLINE_FRESH;
      userPresenceCache[un]={online, lastSeen:last, checkedAt:Date.now(), source:'local'};
      return online;
    }
  }catch(e){}
  return false;
}

function getUserLastSeen(username){
  if(!username) return 0;
  const un=String(username).toLowerCase();
  let latest=0;
  // Prefer newest normalized timestamp. This fixes timestamp objects that were stored by the old backend
  // becoming NaN after ~2-3 minutes and falling back to old localStorage data.
  try{
    const c=userPresenceCache[un] || userPresenceCache[username];
    const t=presenceTimeMs(c && c.lastSeen);
    if(t) latest=Math.max(latest,t);
  }catch(e){}
  try{
    const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
    const row=presence[un]||presence[username];
    const t=presenceTimeMs(row && row.lastSeen);
    if(t) latest=Math.max(latest,t);
  }catch(e){}
  return latest||0;
}

function formatLastSeen(timestamp){
  if(!timestamp) return 'Offline';
  const diff=Date.now()-timestamp;
  /* With a 90s heartbeat a "just now" could really be 90s old, so only
     claim that inside one beat; otherwise report real minutes. */
  if(diff<PRESENCE_INTERVAL) return 'Last seen just now';
  if(diff<60000) return 'Last seen just now';
  if(diff<3600000){const m=Math.floor(diff/60000); return `Last seen ${m} min ago`;}
  if(diff<86400000){const h=Math.floor(diff/3600000); return `Last seen ${h}h ago`;}
  const d=new Date(timestamp);
  return `Last seen ${d.toLocaleDateString()}`;
}

// Listen to cloud presence changes for all contacts
/* BUGFIX: nothing watched the signed-in user's own users/<uid> doc, so a role
   granted while they were online only appeared after a full logout+login.
   Live-listen and push changes straight into the session. */
let unsubMyRoles=null;
async function initMyRoleListener(){
  try{
    if(!isCloud || !db || !currentUserData) return;
    const {doc,getDoc,onSnapshot}=AURORA_SB;
    const un=String(currentUserData.username||'').toLowerCase();
    let uid=(currentUser && currentUser.uid && !String(currentUser.uid).startsWith('local_')) ? currentUser.uid : null;
    if(!uid){
      try{ const ud=await getDoc(doc(db,'usernames',un)); if(ud.exists()) uid=ud.data().uid; }catch(e){}
    }
    if(!uid) return;
    try{ if(unsubMyRoles) unsubMyRoles(); }catch(e){}
    unsubMyRoles=onSnapshot(doc(db,'users',uid),(snap)=>{
      try{
        if(!snap.exists()) return;
        const d=snap.data()||{};
        const roles=Array.isArray(d.roles)
          ? d.roles.filter(r=>ROLE_DEFS[String(r||'').toLowerCase()]).map(r=>String(r).toLowerCase())
          : [];
        const users=getUsers();
        const prev=users[un]||{username:un};
        users[un]={...prev, username:un, roles,
          verified:(d.verified===true||d.isVerified===true||prev.verified===true),
          developer:(d.developer===true||d.isDeveloper===true||d.role==='developer'||prev.developer===true)};
        ROLE_ORDER.forEach(r=>{ if(!roles.includes(r)) delete users[un][r]; });
        saveUsers(users);
        syncMyRolesFromRegistry();
      }catch(e){}
    },(err)=>{ try{ console.log('myRoles listen', err.message); }catch(e){} });
  }catch(e){}
}
window.initMyRoleListener=initMyRoleListener;

async function initPresenceListener(){
  if(!isCloud||!db||!currentUserData) return;
  try{
    const {collection,onSnapshot}=AURORA_SB;
    if(unsubPresence) unsubPresence();
    unsubPresence=onSnapshot(collection(db,'presence'),(snap)=>{
      snap.docChanges().forEach(ch=>{
        const data=ch.doc.data();
        const username=String(data.username||ch.doc.id||'').toLowerCase();
        if(username===String(currentUserData?.username||'').toLowerCase()) return;
        const last=presenceTimeMs(data.lastSeen||data.ts||data.updatedAt);
        const elapsed=last ? (Date.now()-last) : Infinity;
        const online=!!data.online && elapsed<ONLINE_FRESH;   // strict: no stale dots
        userPresenceCache[username]={online, lastSeen:last, checkedAt:Date.now(), source:'cloud'};
        try{
          // shared handler: a deleted / expired note now REMOVES the cached copy
          // instead of being ignored (that was why others still saw the note).
          if(applyPresenceNote(username, data)){
            try{ renderActiveNow(); }catch(e){}
          }
        }catch(e){}
      });
      // Re-render chats to update dots
      renderChats();
      // Update open chat header status
      if(currentRoomId){
        const contact=contacts.find(c=>c.id===currentRoomId);
        if(contact) updateChatHeaderPresence(contact);
      }
    });
  }catch(e){console.log('Presence listener fail',e.message);}
}

// Update chat header with online/offline status
function updateChatHeaderPresence(contact){
  if(!contact) return;
  const statusEl=document.getElementById('chatStatus');
  if(!statusEl) return;
  // TYPING has priority over Online / Last seen in the header
  try{
    if(typeof isAnyoneTyping==='function' && contact.id===currentRoomId && isAnyoneTyping(contact.id)){
      statusEl.dataset.typing='1';
      statusEl.style.display='block';
      statusEl.style.visibility='visible';
      statusEl.innerHTML='<span class="status-typing">typing<span class="chat-typing-inline"><i></i><i></i><i></i></span></span>';
      return;
    }
  }catch(e){}
  statusEl.style.display='block';
  statusEl.style.visibility='visible';
  const otherU=contact.otherUsername||contact.username;
  const online=isUserOnline(otherU);
  if(online){
    statusEl.innerHTML='<span class="status-online">Online</span>';
  }else{
    const lastSeen=getUserLastSeen(otherU);
    const lsText=formatLastSeen(lastSeen)||'Offline';
    statusEl.innerHTML=`<span class="status-offline">${esc(lsText)}</span>`;
  }
  // also ensure name still visible
  try{
    const n=document.getElementById('chatName');
    const info=document.getElementById('chatHeaderInfo');
    if(n){ n.style.display='block'; if(!String(n.textContent||'').trim()){ n.textContent=contactDisplayName(contact); } }
    if(info){ info.style.display='flex'; }
  }catch(e){}
}

// Render the online dot HTML for avatar
function onlineDotHTML(username){
  if(!username) return '';
  if(isUserOnline(username)) return '<span class="online-dot pulse"></span>';
  return '';
}

// Tab visibility → start/stop presence
document.addEventListener('visibilitychange',()=>{
  if(!currentUserData) return;
  if(document.hidden){
    setMyPresence(false); // Mark as away when tab hidden
  }else{
    setMyPresence(true); // Back online when tab visible
  }
});

// Before unload → set offline
window.addEventListener('beforeunload',()=>{
  if(currentUserData){
    try{
      const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
      const _un=String(currentUserData.username||'').toLowerCase();
      if(presence[_un]){
        presence[_un].online=false;
        presence[_un].lastSeen=Date.now();
        localStorage.setItem('aurora_presence',JSON.stringify(presence));
      }
    }catch(e){}
    // Try to send offline to the cloud (may not complete)
    if(isCloud && db){
      try{
        const {doc,setDoc}=window._fbModules||{};
        // Best effort - use sendBeacon if available
        const payload=JSON.stringify({online:false,lastSeen:Date.now(),username:currentUserData.username});
        if(navigator.sendBeacon){
          // Can't use sendBeacon for the cloud, just update localStorage
        }
      }catch(e){}
    }
  }
});

// Listen for storage changes (other tabs updating presence)
window.addEventListener('storage',(e)=>{
  if(e.key==='aurora_presence' && currentUserData){
    // Clear cache to force re-read
    Object.keys(userPresenceCache).forEach(k=>{delete userPresenceCache[k];});
    renderChats();
    if(currentRoomId){
      const contact=contacts.find(c=>c.id===currentRoomId);
      if(contact) updateChatHeaderPresence(contact);
    }
  }
});

// Periodic re-check (every 15s) to update dots / "last seen X min ago".
setInterval(()=>{
  // Keep cloud presence entries; their online/offline state is calculated
  // from lastSeen age. Removing them every 15s caused false Offline status
  // because the heartbeat only runs every 90s.
  Object.keys(userPresenceCache).forEach(k=>{
    const v=userPresenceCache[k]||{};
    if(!v.lastSeen || (Date.now()-v.lastSeen)>7*86400000) delete userPresenceCache[k];
  });
  renderChats();
  if(currentRoomId){
    const contact=contacts.find(c=>c.id===currentRoomId);
    if(contact) updateChatHeaderPresence(contact);
  }
},15000);
/* ================== END PRESENCE SYSTEM ================== */

/* ================== TYPING INDICATOR SYSTEM ================== */
/* Works in both modes:
   - Cloud live:  typing table, live subscription (realtime)
   - Local/offline:  localStorage 'aurora_typing' + window 'storage' event
                     (syncs across tabs of the same browser)                */
const TYPING_TTL      = 6000;  // a typing flag older than this is ignored
const TYPING_IDLE_OFF = 2500;  // stop typing this long after last keystroke
const TYPING_THROTTLE = 2000;  // don't re-write "typing:true" more often than this
const TYPING_KEY      = 'aurora_typing';

let _typingLastSent   = 0;     // last time we wrote typing:true
let _typingIdleTimer  = null;  // auto-stop timer
let _typingAmTyping   = false; // my current state for the open room
let _typingUnsub      = null;  // cloud listener for the open room
let _typingRoomId     = null;  // room the listener belongs to
let typingCache       = {};    // roomId -> { username: timestampMs }

function _typingAll(){
  try{ return JSON.parse(localStorage.getItem(TYPING_KEY)||'{}') || {}; }catch(e){ return {}; }
}
function _typingSaveAll(map){
  try{ localStorage.setItem(TYPING_KEY, JSON.stringify(map||{})); }catch(e){}
}

/* ---------- OUTGOING: tell others I'm typing ---------- */
async function setMyTyping(isTyping, roomId){
  const rid = roomId || currentRoomId;
  if(!rid || !currentUserData) return;
  const me = currentUserData.username;
  const now = Date.now();

  // throttle repeated "true" writes, always let "false" through
  if(isTyping){
    if(_typingAmTyping && (now - _typingLastSent) < TYPING_THROTTLE) return;
    _typingLastSent = now;
  }
  _typingAmTyping = !!isTyping;

  // local (multi-tab / offline mode)
  try{
    const map = _typingAll();
    map[rid] = map[rid] || {};
    if(isTyping) map[rid][me] = now;
    else delete map[rid][me];
    if(!Object.keys(map[rid]).length) delete map[rid];
    _typingSaveAll(map);
  }catch(e){}

  // cloud
  if(isCloud && db && currentUser){
    try{
      const {doc,setDoc,deleteDoc} = AURORA_SB;
      const ref = doc(db,'rooms',rid,'typing',me);
      if(isTyping){
        await setDoc(ref,{
          username: me,
          nickname: currentUserData.nickname || me,
          typing: true,
          ts: Date.now()
        });
      }else{
        try{ await deleteDoc(ref); }
        catch(e){ await setDoc(ref,{username:me, typing:false, ts:Date.now()},{merge:true}); }
      }
    }catch(e){ /* offline: local fallback already handled */ }
  }
}

/* called on every keystroke in the composer */
function onComposerActivity(){
  if(!currentRoomId || !currentUserData) return;
  const hasText = !!(document.getElementById('msgInput')?.value || '').trim();
  clearTimeout(_typingIdleTimer);
  if(!hasText){ stopMyTyping(); return; }
  setMyTyping(true);
  _typingIdleTimer = setTimeout(()=>{ stopMyTyping(); }, TYPING_IDLE_OFF);
}

function stopMyTyping(roomId){
  clearTimeout(_typingIdleTimer);
  _typingIdleTimer = null;
  if(!_typingAmTyping && !roomId) return;
  _typingAmTyping = false;
  _typingLastSent = 0;
  setMyTyping(false, roomId);
}

/* ---------- INCOMING: who is typing to me ---------- */
function whoIsTyping(roomId){
  const rid = roomId || currentRoomId;
  if(!rid || !currentUserData) return [];
  const me  = currentUserData.username;
  const now = Date.now();
  const out = [];
  const seen = {};

  const push = (u, ts)=>{
    if(!u || u===me) return;
    if(now - Number(ts||0) > TYPING_TTL) return;
    if(seen[u]) return;
    seen[u]=1; out.push(u);
  };

  try{ Object.entries(typingCache[rid]||{}).forEach(([u,ts])=>push(u,ts)); }catch(e){}
  try{ Object.entries(_typingAll()[rid]||{}).forEach(([u,ts])=>push(u,ts)); }catch(e){}
  return out;
}

function isAnyoneTyping(roomId){ return whoIsTyping(roomId).length > 0; }

/* ---------- UI: bubble above the composer + header status ---------- */
function renderTypingIndicator(){
  const row = document.getElementById('typingRow');
  if(!row) return;
  const users = whoIsTyping(currentRoomId);

  if(!users.length){
    row.classList.remove('show');
    row.setAttribute('aria-hidden','true');
    // restore normal presence text in the header
    try{
      const c = contacts.find(x=>x.id===currentRoomId);
      if(c && document.getElementById('chatStatus')?.dataset.typing==='1'){
        document.getElementById('chatStatus').dataset.typing='0';
        updateChatHeaderPresence(c);
      }
    }catch(e){}
    return;
  }

  // avatar of the first typer
  const av = document.getElementById('typingAvatar');
  if(av){
    const u = (getUsers()||{})[users[0]] || {username:users[0], nickname:users[0]};
    try{
      av.innerHTML = avHTML(u);
      av.style.background = avBg(u, u.color);
    }catch(e){
      av.textContent = String(users[0]).slice(0,2).toUpperCase();
    }
  }

  // label (group chats can have more than one typer)
  const nameEl = document.getElementById('typingName');
  if(nameEl){
    const nice = users.map(u=>{
      const d=(getUsers()||{})[u];
      return (d && d.nickname) ? d.nickname : u;
    });
    nameEl.textContent = nice.length===1 ? '' :
      (nice.length===2 ? `${nice[0]} & ${nice[1]} are typing` : `${nice.length} people are typing`);
  }

  row.classList.add('show');
  row.setAttribute('aria-hidden','false');

  // header status → "typing..."
  try{
    const st = document.getElementById('chatStatus');
    if(st){
      st.dataset.typing='1';
      st.innerHTML = '<span class="status-typing">typing<span class="chat-typing-inline"><i></i><i></i><i></i></span></span>';
    }
  }catch(e){}

  // keep the bubble in view
  try{
    const m = document.getElementById('messages');
    if(m && (m.scrollHeight - m.scrollTop - m.clientHeight) < 120) m.scrollTop = m.scrollHeight;
  }catch(e){}
}

/* ---------- realtime listener for the open room ---------- */
async function startTypingListener(roomId){
  stopTypingListener();
  _typingRoomId = roomId;
  if(!roomId) return;
  if(!(isCloud && db && currentUser)) return; // local mode uses storage events
  try{
    const {collection,onSnapshot} = AURORA_SB;
    _typingUnsub = onSnapshot(collection(db,'rooms',roomId,'typing'),(snap)=>{
      const bucket = {};
      snap.forEach(d=>{
        const v = d.data() || {};
        if(v.typing) bucket[v.username || d.id] = Number(v.ts || 0);
      });
      typingCache[roomId] = bucket;
      if(currentRoomId===roomId) renderTypingIndicator();
      try{ renderChats(); }catch(e){}
    },(err)=>{ /* permission / offline → silent */ });
  }catch(e){}
}
function stopTypingListener(){
  try{ if(_typingUnsub){ _typingUnsub(); } }catch(e){}
  _typingUnsub = null;
  _typingRoomId = null;
}

/* expire stale flags so the bubble can never get stuck on screen */
setInterval(()=>{
  const now = Date.now();
  let changed = false;
  Object.keys(typingCache).forEach(rid=>{
    Object.keys(typingCache[rid]||{}).forEach(u=>{
      if(now - Number(typingCache[rid][u]||0) > TYPING_TTL){ delete typingCache[rid][u]; changed = true; }
    });
  });
  try{
    const map=_typingAll(); let dirty=false;
    Object.keys(map).forEach(rid=>{
      Object.keys(map[rid]||{}).forEach(u=>{
        if(now - Number(map[rid][u]||0) > TYPING_TTL){ delete map[rid][u]; dirty=true; }
      });
      if(!Object.keys(map[rid]||{}).length){ delete map[rid]; dirty=true; }
    });
    if(dirty){ _typingSaveAll(map); changed = true; }
  }catch(e){}
  renderTypingIndicator();
  if(changed){ try{ renderChats(); }catch(e){} }
}, 1500);

/* other tabs typing (local mode) */
window.addEventListener('storage',(e)=>{
  if(e.key===TYPING_KEY){
    renderTypingIndicator();
    try{ renderChats(); }catch(e2){}
  }
});

/* never leave a dangling "typing" flag behind */
window.addEventListener('beforeunload',()=>{ try{ stopMyTyping(); }catch(e){} });
document.addEventListener('visibilitychange',()=>{ if(document.hidden){ try{ stopMyTyping(); }catch(e){} } });

window.setMyTyping=setMyTyping;
window.stopMyTyping=stopMyTyping;
window.whoIsTyping=whoIsTyping;
window.isAnyoneTyping=isAnyoneTyping;
window.renderTypingIndicator=renderTypingIndicator;
window.startTypingListener=startTypingListener;
window.stopTypingListener=stopTypingListener;
/* ================== END TYPING INDICATOR SYSTEM ================== */

/* ================== MEDIA LIGHTBOX ==================
   Tapping a photo/video in a chat used to call
   window.open('data:image/...') which browsers silently block,
   so nothing happened. This opens an in-app viewer instead.
   Supports pinch/tap zoom, drag-to-pan and save.
   ==================================================== */
let _lbZoom = 1, _lbX = 0, _lbY = 0, _lbSrc = '', _lbKind = 'image';

function openLightbox(src, kind, title){
  if(!src) return false;
  const box=document.getElementById('mediaLightbox');
  const stage=document.getElementById('lbStage');
  if(!box || !stage) return false;
  /* must live directly under the phone shell — if it ends up inside a
     display:none wrapper (e.g. #inputArea) it renders with zero size */
  try{
    const host=document.getElementById('phoneShell')||document.body;
    if(box.parentElement!==host) host.appendChild(box);
  }catch(e){}
  _lbSrc=src; _lbKind=kind||'image'; _lbZoom=1; _lbX=0; _lbY=0;

  stage.innerHTML = (_lbKind==='video')
    ? `<video src="${src}" controls autoplay playsinline style="max-width:100%;max-height:100%;"></video>`
    : `<img id="lbImg" src="${src}" alt="media">`;

  const t=document.getElementById('lbTitle');
  if(t) t.textContent = title || (_lbKind==='video' ? 'Video' : 'Photo');
  const z=document.getElementById('lbZoom');
  if(z) z.style.display = (_lbKind==='video') ? 'none' : '';
  const h=document.getElementById('lbHint');
  if(h) h.textContent = (_lbKind==='video')
    ? 'Tap outside or press Esc to close'
    : 'Double-tap to zoom · drag to pan · Esc to close';

  box.classList.add('show');
  try{ document.body.style.overflow='hidden'; }catch(e){}
  if(_lbKind==='image') _lbBindImage();
  return true;
}

function closeLightbox(){
  const box=document.getElementById('mediaLightbox');
  if(!box) return;
  box.classList.remove('show');
  const stage=document.getElementById('lbStage');
  if(stage) stage.innerHTML='';          // stops video playback
  try{ document.body.style.overflow=''; }catch(e){}
  _lbZoom=1; _lbX=0; _lbY=0;
}

function _lbApply(){
  const img=document.getElementById('lbImg');
  if(!img) return;
  img.style.transform=`translate(${_lbX}px,${_lbY}px) scale(${_lbZoom})`;
  img.classList.toggle('zoomed', _lbZoom>1);
  const z=document.getElementById('lbZoom');
  if(z) z.textContent = _lbZoom>1 ? '－' : '＋';
}
function lbToggleZoom(){
  _lbZoom = _lbZoom>1 ? 1 : 2.5;
  if(_lbZoom===1){ _lbX=0; _lbY=0; }
  _lbApply();
}

function _lbBindImage(){
  const img=document.getElementById('lbImg');
  if(!img || img._lbBound) return;
  img._lbBound=true;

  // double-tap / double-click to zoom
  let lastTap=0;
  img.addEventListener('click',(e)=>{
    e.stopPropagation();
    const now=Date.now();
    if(now-lastTap<300){ lbToggleZoom(); lastTap=0; }
    else lastTap=now;
  });
  img.addEventListener('dblclick',(e)=>{ e.stopPropagation(); lbToggleZoom(); });

  // drag to pan while zoomed
  let dragging=false, sx=0, sy=0, ox=0, oy=0;
  const start=(x,y)=>{ if(_lbZoom<=1) return; dragging=true; sx=x; sy=y; ox=_lbX; oy=_lbY; };
  const move=(x,y)=>{ if(!dragging) return; _lbX=ox+(x-sx); _lbY=oy+(y-sy); _lbApply(); };
  const end=()=>{ dragging=false; };
  img.addEventListener('mousedown',e=>{ e.preventDefault(); start(e.clientX,e.clientY); });
  window.addEventListener('mousemove',e=>move(e.clientX,e.clientY));
  window.addEventListener('mouseup',end);

  // touch: 1 finger pans, 2 fingers pinch
  let pinchStart=0, zoomStart=1;
  img.addEventListener('touchstart',(e)=>{
    if(e.touches.length===2){
      pinchStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                            e.touches[0].clientY-e.touches[1].clientY);
      zoomStart=_lbZoom;
    }else if(e.touches.length===1){
      start(e.touches[0].clientX, e.touches[0].clientY);
    }
  },{passive:true});
  img.addEventListener('touchmove',(e)=>{
    if(e.touches.length===2 && pinchStart){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                         e.touches[0].clientY-e.touches[1].clientY);
      _lbZoom=Math.min(4, Math.max(1, zoomStart*(d/pinchStart)));
      if(_lbZoom===1){ _lbX=0; _lbY=0; }
      _lbApply();
      e.preventDefault();
    }else if(e.touches.length===1 && dragging){
      move(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  },{passive:false});
  img.addEventListener('touchend',()=>{ end(); pinchStart=0; });

  // wheel zoom on desktop
  img.addEventListener('wheel',(e)=>{
    e.preventDefault();
    _lbZoom=Math.min(4, Math.max(1, _lbZoom + (e.deltaY<0?0.2:-0.2)));
    if(_lbZoom===1){ _lbX=0; _lbY=0; }
    _lbApply();
  },{passive:false});
}

function lbSave(){
  if(!_lbSrc) return;
  try{
    const a=document.createElement('a');
    const dName='aurora-'+Date.now()+(_lbKind==='video'?'.mp4':'.jpg');
    // Cloud URL হলে download= দিয়ে আসল নামেই download হয়
    a.href=(typeof mediaDownloadUrl==='function') ? mediaDownloadUrl(_lbSrc, dName) : _lbSrc;
    a.download=dName;
    a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    showToast({title:'Saved',body:'Check your downloads',color:'#10b981',avatar:'⬇️'});
  }catch(e){
    try{ showToast({title:'Save failed',body:e.message||'',color:'#ef4444',avatar:'!'}); }catch(_){}
  }
}

/* delegated: works for existing AND future messages */
document.addEventListener('click',(e)=>{
  const expand=e.target.closest?.('[data-lb-open="video"]');
  if(expand){
    const v=expand.parentElement?.querySelector('video');
    if(v){ e.preventDefault(); e.stopPropagation(); try{ v.pause(); }catch(_){}
           openLightbox(v.getAttribute('src'),'video'); }
    return;
  }
  const img=e.target.closest?.('.bubble img[data-lb], .msg-attach-thumb img');
  if(img){
    e.preventDefault(); e.stopPropagation();
    openLightbox(img.getAttribute('src'),'image');
  }
}, true);

document.getElementById('lbClose')?.addEventListener('click',closeLightbox);
document.getElementById('lbZoom')?.addEventListener('click',lbToggleZoom);
document.getElementById('lbSave')?.addEventListener('click',lbSave);
document.getElementById('mediaLightbox')?.addEventListener('click',(e)=>{
  if(e.target.id==='mediaLightbox' || e.target.id==='lbStage') closeLightbox();
});
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape' && document.getElementById('mediaLightbox')?.classList.contains('show')) closeLightbox();
});

window.openLightbox=openLightbox;
window.closeLightbox=closeLightbox;
/* ================== END MEDIA LIGHTBOX ================== */



/* ================== DEVELOPER · ALL USERS SCREEN ==================
   Gated behind isUserDeveloper(currentUserData.username). The row in
   Settings stays display:none for everyone else, and openDevUsersPage()
   re-checks the gate so it cannot be opened from the console by a
   non-developer session either.
   Data sources, merged by username:
     - `users` table    (every registered cloud account)
     - `presence` table (online state, may include users not in `users`)
     - local getUsers()     (accounts known to this device / demo seeds)
   =================================================================== */
let _duCache = [];          // last merged result (real accounts only)
let _duLoading = false;
let _duAllCount = 0;        // everything found, incl. demo
let _duDemoCount = 0;       // how many demo seeds were hidden
let _duStaleCount = 0;      // local-only leftovers dropped because database no longer has them
let _duBrokenCount = 0;     // database docs skipped for having no username

function _duIsDev(){
  // now level-based: Owner and above may browse all users
  try{ return can('users.viewAll'); }catch(e){ return false; }
}

/* Demo accounts seeded by seedTestData() carry test:true. Their usernames
   are also fixed, so catch both (an older seed may predate the flag). */
const DU_DEMO_USERNAMES = ['demo','elena','marcus','sarah','julian'];

/* Throwaway accounts created by old Notes test runs. They live in database
   as real documents (notea1234 / noteb5678 / notetestalpha999 ...) and all
   use the internal @aurora-chat.app address, so they are indistinguishable from
   real signups unless we pattern-match them. */
const DU_TEST_RE = /^(note[ab]\d+|notetest[a-z]*\d+)$/i;
function _duIsTestAccount(u){
  try{
    if(!u) return false;
    const un=String(u.username||'').toLowerCase();
    if(DU_TEST_RE.test(un)) return true;
    // "Alice"/"Bob"/"Alpha Tester"/"Beta Tester" seeded together with them
    const nick=String(u.nickname||'').trim().toLowerCase();
    if(DU_TEST_RE.test(un) || (/^(alice|bob|alpha tester|beta tester)$/.test(nick) &&
        String(u.email||'').endsWith('@aurora-chat.app'))) return true;
    return false;
  }catch(e){ return false; }
}

function _duIsDemo(u){
  try{
    if(!u) return false;
    if(u.test===true || u.isTest===true || u.demo===true) return true;
    if(_duIsTestAccount(u)) return true;
    const un=String(u.username||'').toLowerCase();
    // only treat the known seed names as demo when they are NOT cloud accounts
    if(!u._cloud && !u.cloud && DU_DEMO_USERNAMES.includes(un)) return true;
    return false;
  }catch(e){ return false; }
}

function _duNorm(u){
  const un = String(u.username||'').toLowerCase();
  return {
    demo: _duIsDemo(u),
    username: un,
    nickname: u.nickname || u.displayName || un,
    avatar: u.avatar || '',
    avatarUrl: u.avatarUrl || (String(u.avatar||'').startsWith('data:') ? u.avatar : null),
    color: u.color || '#2563eb',
    title: u.title || '',
    verified: u.verified===true || u.isVerified===true,
    developer: u.developer===true || u.isDeveloper===true || String(u.role||'').toLowerCase()==='developer',
    owner: u.owner===true || u.isOwner===true || String(u.role||'').toLowerCase()==='owner' || String(u.username||'').toLowerCase()==='khalid_01',
    roles: Array.isArray(u.roles) ? u.roles.filter(r=>ROLE_DEFS[String(r||'').toLowerCase()]).map(r=>String(r).toLowerCase()) : [],
    cloud: !!u._cloud,
    online: false,
    lastSeen: 0
  };
}

async function loadAllUsers(force){
  if(_duLoading) return _duCache;
  _duLoading = true;
  const byName = {};
  let cloudOk = false;          // did the `users` table read actually succeed?
  const cloudNames = {};        // usernames that exist in database right now
  _duBrokenCount = 0;

  // local first (always available, instant)
  try{
    Object.values(getUsers()||{}).forEach(u=>{
      if(!u || !u.username) return;
      const n=_duNorm(u);
      byName[n.username] = n;
    });
  }catch(e){}

  // cloud
  if(isCloud && db){
    try{
      const _race=(pr,ms)=>Promise.race([pr,new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),ms))]);
      const {collection,getDocs}=await _race(
        AURORA_SB, 6000);

      try{
        const snap=await _race(getDocs(collection(db,'users')), 8000);
        snap.forEach(d=>{
          const v=d.data()||{};
          // Skip malformed docs (no username at all: stubs like `1000`, or
          // profile fragments written before signup completed).
          if(!v.username || !String(v.username).trim()){ _duBrokenCount++; return; }
          const n=_duNorm({...v, _cloud:true});
          cloudNames[n.username] = true;
          // present in database => a real registered account
          // ...but a Notes test account stays flagged so the toggle hides it
          const isTest=_duIsTestAccount({...v});
          byName[n.username] = {...(byName[n.username]||{}), ...n, cloud:true, demo:isTest};
          // cloud is authoritative for roles/verified
          byName[n.username].roles = n.roles;
          byName[n.username].verified = n.verified;
        });
        cloudOk = true;
      }catch(e){ console.log('devUsers: users read failed', e.message); }

      try{
        const psnap=await _race(getDocs(collection(db,'presence')), 6000);
        const TH=(typeof ONLINE_THRESHOLD!=='undefined')?ONLINE_THRESHOLD:60000;
        psnap.forEach(d=>{
          const v=d.data()||{};
          const un=String(v.username||d.id||'').toLowerCase();
          if(!un) return;
          // FIX: a stale `presence` doc used to RESURRECT a user that was
          // already deleted from `users`. Only trust presence for accounts
          // that still exist in database (when we could read it).
          if(!byName[un]){
            if(cloudOk) return;            // deleted account -> skip entirely
            byName[un]=_duNorm({username:un, nickname:v.nickname||un, _cloud:true});
          }
          const elapsed=Date.now()-(v.lastSeen||0);
          byName[un].online = !!v.online && elapsed < TH;
          byName[un].lastSeen = v.lastSeen||0;
          if(v.nickname && byName[un].nickname===un) byName[un].nickname=v.nickname;
        });
      }catch(e){ console.log('devUsers: presence read failed', e.message); }

    }catch(e){ console.log('devUsers: cloud unavailable', e.message); }
  }

  /* FIX (main cause of "refresh doesn't reduce the count"):
     prefetchUserProfiles() and friends cache every user they ever see into
     localStorage. When you delete an account in the Supabase dashboard the
     local copy survives, gets merged back in above, and the list never
     shrinks. When the cloud read succeeded we treat database as the source
     of truth and drop local-only leftovers — while always keeping the
     signed-in account and genuine demo seeds. */
  if(cloudOk){
    const me = String(currentUserData?.username||'').toLowerCase();
    _duStaleCount = 0;
    const localUsers = (()=>{ try{ return getUsers()||{}; }catch(e){ return {}; } })();
    Object.keys(byName).forEach(un=>{
      if(cloudNames[un]) return;        // still in database
      if(un === me) return;             // never drop yourself
      if(byName[un].demo) return;       // demo seeds are handled by the toggle
      // a real local-only account (has credentials on this device) is NOT stale
      if(localUsers[un] && localUsers[un].password) return;
      delete byName[un];
      _duStaleCount++;
    });
  }else{
    _duStaleCount = 0;
  }

  // local presence fallback for anyone the cloud didn't cover
  try{
    Object.keys(byName).forEach(un=>{
      if(!byName[un].online){
        try{ byName[un].online = isUserOnline(un); }catch(e){}
      }
      if(!byName[un].lastSeen){
        try{ byName[un].lastSeen = getUserLastSeen(un)||0; }catch(e){}
      }
    });
  }catch(e){}

  // keep only real accounts (demo seeds hidden unless the toggle is on)
  const _showDemo = (()=>{ try{ return localStorage.getItem('aurora_du_show_demo')==='1'; }catch(e){ return false; } })();
  if(!cloudOk) _duBrokenCount = 0;
  _duAllCount = Object.keys(byName).length;
  _duDemoCount = Object.values(byName).filter(u=>u.demo).length;

  _duCache = Object.values(byName)
    .filter(u=>_showDemo ? true : !u.demo)
    .sort((a,b)=>{
    if(a.online!==b.online) return a.online?-1:1;          // online first
      if(!!a.owner!==!!b.owner) return a.owner?-1:1;
      if(!!a.developer!==!!b.developer) return a.developer?-1:1;
      return String(a.nickname||'').localeCompare(String(b.nickname||''));
    });
  _duLoading = false;
  return _duCache;
}

function renderDevUsers(){
  const list=document.getElementById('duList');
  if(!list) return;
  const q=(document.getElementById('duSearch')?.value||'').trim().toLowerCase();
  const me=currentUserData?.username;
  const rows=_duCache.filter(u=>{
    if(!q) return true;
    return u.username.includes(q) || String(u.nickname||'').toLowerCase().includes(q);
  });

  // stats always reflect the full set, not the filter
  try{
    const rk=document.getElementById('duMyRank');
    if(rk){
      const lvl=myLevel();
      const caps=[];
      if(can('roles.grant')) caps.push('grant roles');
      else if(can('roles.view')) caps.push('view roles');
      if(can('users.delete'))   caps.push('delete users');
      if(can('chat.deleteAny')) caps.push('delete chats');
      if(can('user.ban'))       caps.push('ban');
      if(can('user.mute'))      caps.push('mute');
      rk.innerHTML='<span>🎖️</span><span>You are <b>'+esc(roleTitle(lvl))+'</b>'+
        (caps.length?' · can '+esc(caps.join(', ')):'')+'</span>';
    }
  }catch(e){}
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=String(v); };
  set('duTotal', _duCache.length);
  set('duOnline', _duCache.filter(u=>u.online).length);
  set('duCloud', _duCache.filter(u=>u.cloud).length);

  // demo-accounts toggle: only worth showing when demo seeds actually exist
  try{
    const tg=document.getElementById('duDemoToggle');
    const tx=document.getElementById('duDemoToggleText');
    if(tg){
      const showing = localStorage.getItem('aurora_du_show_demo')==='1';
      if(_duDemoCount>0 || showing){
        tg.style.display='';
        tg.classList.toggle('on', showing);
        if(tx) tx.textContent = showing
          ? ('⚡ Showing test/demo accounts — tap to hide')
          : (_duDemoCount+' test/demo account'+(_duDemoCount===1?'':'s')+' hidden — tap to show');
      }else{
        tg.style.display='none';
      }
    }
  }catch(e){}

  if(!rows.length){
    const hint = (!q && _duDemoCount>0 && localStorage.getItem('aurora_du_show_demo')!=='1')
      ? 'No real accounts yet<div style="font-size:11px;font-weight:600;margin-top:6px;opacity:.8;">'+_duDemoCount+' demo account'+(_duDemoCount===1?'':'s')+' hidden</div>'
      : (q ? 'No user matches "'+esc(q)+'"' : 'No users found yet');
    list.innerHTML = `<div class="du-empty"><div>${q?'🔍':'👥'}</div>${hint}</div>`;
    return;
  }

  list.innerHTML = rows.map(u=>{
    const isMe = u.username===me;
    const av = u.avatarUrl
      ? `<img src="${u.avatarUrl}" alt="">`
      : esc(String(u.nickname||u.username).slice(0,2).toUpperCase());
    let badges = (u.verified?verifiedBadgeHTML('sm'):'');
    try{
      (u.roles||[]).forEach(r=>{
        const d=ROLE_DEFS[r]; if(!d) return;
        badges += `<span class="du-role-tag ${r}" title="${d.label}">${d.label}</span>`;
      });
    }catch(e){}
    const sub = [ '@'+u.username, u.title||'' ].filter(Boolean).join(' · ');
    return `<button type="button" class="du-item" data-un="${esc(u.username)}">
      <div class="du-av" style="background:${u.avatarUrl?'transparent':esc(u.color)};">
        ${av}${u.online?'<span class="online-dot"></span>':''}
      </div>
      <div class="du-body">
        <div class="du-name">${esc(u.nickname||u.username)}${badges}${isMe?' <span style="font-size:10px;color:#94a3b8;font-weight:700;">(you)</span>':''}</div>
        <div class="du-sub">${esc(sub)}</div>
      </div>
      <div class="du-right">
        <span class="du-pill ${u.online?'on':'off'}">${u.online?'ONLINE':'OFFLINE'}</span>
        <span class="du-src">${u.cloud?'CLOUD':'LOCAL'}</span>
      </div>
    </button>`;
  }).join('');

  list.querySelectorAll('.du-item').forEach(el=>{
    const un=el.getAttribute('data-un');
    let timer=null, longPressed=false;
    const startChat=()=>{
      longPressed=true;
      try{ closeDevUsersPage(); closeSettings(); switchBottomNav('chats'); }catch(e){}
      try{ startChatWith(un); }catch(e){}
    };
    el.addEventListener('click',()=>{
      if(longPressed){ longPressed=false; return; }
      showDevUserCard(un);
    });
    el.addEventListener('contextmenu',(e)=>{ e.preventDefault(); startChat(); });
    el.addEventListener('touchstart',()=>{ timer=setTimeout(startChat, 550); },{passive:true});
    el.addEventListener('touchend',()=>{ clearTimeout(timer); });
    el.addEventListener('touchmove',()=>{ clearTimeout(timer); });
  });
}

/* lightweight profile card (viewProfile() needs an open room, this doesn't) */
function showDevUserCard(un){
  const u=_duCache.find(x=>x.username===un);
  if(!u) return;
  document.getElementById('duCardModal')?.remove();
  const m=document.createElement('div');
  m.id='duCardModal';
  m.className='modal-overlay show';
  m.style.cssText='z-index:10090;align-items:center;justify-content:center;padding:16px;';
  const av=u.avatarUrl?`<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;">`
                      :esc(String(u.nickname||u.username).slice(0,2).toUpperCase());
  const line=(l,v)=>v?`<div class="vp-row"><div class="vp-row-ico">•</div><div class="vp-row-body">
      <div class="vp-row-label">${l}</div><div class="vp-row-value">${esc(v)}</div></div></div>`:'';
  m.innerHTML=`<div class="modal vp-modal" style="max-width:340px;">
    <button type="button" class="vp-close" id="duCardClose">✕</button>
    <div class="vp-hero">
      <div class="vp-avatar" style="background:${u.avatarUrl?'transparent':esc(u.color)};">${av}</div>
      <h2 class="vp-name">${esc(u.nickname||u.username)}${u.verified?verifiedBadgeHTML():''}</h2>
      <p class="vp-user">@${esc(u.username)}</p>
      ${roleBadgesHTML(u.username, u)}
      <div class="vp-status-pill ${u.online?'on':'off'}"><span class="vp-dot"></span>${u.online?'Online':esc(formatLastSeen(u.lastSeen)||'Offline')}</div>
      <div class="vp-actions vp-actions-top">
        <button type="button" class="btn btn-primary vp-msg" id="duCardMsg">Message</button>
        ${((can('roles.grant') && canActOn(u.username,u)) || can('roles.view'))?`<button type="button" class="btn btn-primary" id="duCardRoles"
                style="background:#7c3aed !important;">${can('roles.grant')?'⚙️ Roles':'👁️ Roles'}</button>`:''}
        ${(can('users.delete') && canActOn(u.username,u))?`<button type="button" class="btn btn-primary" id="duCardDelete"
                style="background:#dc2626 !important;">🗑️ Delete</button>`:''}
      </div>
    </div>
    <div class="vp-section"><div class="vp-section-label">Account</div>
      <div class="vp-card">
        ${line('Username','@'+u.username)}
        ${line('Title / Role',u.title)}
        ${line('Rank', roleTitle(getUserLevel(u.username,u)))}
        ${line('Source', u.cloud?'database (cloud)':'This device (local)')}
      </div>
    </div>
  </div>`;
  (document.getElementById('phoneShell')||document.body).appendChild(m);
  m.addEventListener('click',e=>{ if(e.target===m) m.remove(); });
  document.getElementById('duCardClose')?.addEventListener('click',()=>m.remove());
  document.getElementById('duCardMsg')?.addEventListener('click',()=>{
    m.remove();
    try{ closeDevUsersPage(); closeSettings(); switchBottomNav('chats'); }catch(e){}
    try{ startChatWith(u.username); }catch(e){}
  });
  document.getElementById('duCardRoles')?.addEventListener('click',()=>{
    m.remove();
    try{ openRoleManager(u.username); }catch(e){}
  });
  document.getElementById('duCardDelete')?.addEventListener('click',async()=>{
    const ok=await modDeleteUser(u.username);
    if(ok) m.remove();
  });
}

async function openDevUsersPage(){
  if(!_duIsDev()){
    try{ showToast({title:'Developer only', body:'This section is restricted', color:'#ef4444', avatar:'🔒'}); }catch(e){}
    return false;
  }
  const view=document.getElementById('devUsersView');
  if(!view) return false;
  try{
    const host=document.getElementById('phoneShell')||document.body;
    if(view.parentElement!==host) host.appendChild(view);
    const ss=document.querySelector('.s-search'); if(ss) ss.style.display='none';
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView');
    if(sv){ sv.classList.add('show'); sv.style.display='flex'; }
  }catch(e){}
  view.classList.add('show');
  view.hidden=false;
  view.style.cssText='display:flex !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;z-index:10080 !important;position:absolute !important;inset:0 !important;flex-direction:column !important;overflow:hidden !important;';
  try{ document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings')); }catch(e){}

  const list=document.getElementById('duList');
  if(list && !_duCache.length) list.innerHTML='<div class="du-empty"><div>⏳</div>Loading users…</div>';
  await loadAllUsers();
  renderDevUsers();
  return true;
}

function closeDevUsersPage(){
  const v=document.getElementById('devUsersView');
  if(v){ v.classList.remove('show'); v.style.display='none'; v.style.pointerEvents='none'; }
  document.getElementById('duCardModal')?.remove();
}

window.openDevUsersPage=openDevUsersPage;
window.closeDevUsersPage=closeDevUsersPage;
window.loadAllUsers=loadAllUsers;
window.renderDevUsers=renderDevUsers;

document.getElementById('stAllUsers')?.addEventListener('click',(e)=>{
  e.preventDefault(); e.stopPropagation();
  openDevUsersPage();
});
document.getElementById('devUsersBackBtn')?.addEventListener('click',()=>{
  closeDevUsersPage();
  try{ openSettings(); }catch(e){}
});
document.getElementById('duSearch')?.addEventListener('input', ()=>{ try{ renderDevUsers(); }catch(e){} });
document.getElementById('duDemoToggle')?.addEventListener('click', async ()=>{
  const now = localStorage.getItem('aurora_du_show_demo')==='1';
  try{ localStorage.setItem('aurora_du_show_demo', now ? '0' : '1'); }catch(e){}
  _duCache=[];
  await loadAllUsers(true);
  renderDevUsers();
});
document.getElementById('duRefresh')?.addEventListener('click', async ()=>{
  const btn=document.getElementById('duRefresh');
  btn?.classList.add('spin');
  const before=_duCache.length;
  _duCache=[];

  /* Also drop the localStorage copies of cloud accounts, otherwise a user you
     deleted in the Supabase dashboard would be re-merged from cache on the next
     load. Keep the signed-in account, demo seeds and anything holding local
     credentials (password) so real local-only logins are not destroyed. */
  try{
    const me=String(currentUserData?.username||'').toLowerCase();
    const users=getUsers()||{};
    let pruned=0;
    Object.keys(users).forEach(un=>{
      const u=users[un]||{};
      if(String(un).toLowerCase()===me) return;
      if(u.test===true || u.isTest===true) return;   // demo seeds
      if(u.password) return;                          // local account with credentials
      delete users[un]; pruned++;
    });
    if(pruned) saveUsers(users);
  }catch(e){}

  await loadAllUsers(true);
  renderDevUsers();
  btn?.classList.remove('spin');
  const after=_duCache.length;
  const removed=Math.max(0, before-after);
  try{
    showToast({
      title:'Users reloaded',
      body: after+' account'+(after===1?'':'s')+(removed?(' · '+removed+' removed'):''),
      color:'#10b981', avatar:'✓'
    });
  }catch(e){}
});

/* ================== ROLE MANAGER (developer only) ==================
   Lets the developer grant admin / moderator / VIP / verified to any user.
   Writes to database `users/{uid}` so every device sees the badge, and
   mirrors into the local registry for instant + offline display.
   =================================================================== */
let _rmTarget = null;     // username being edited
let _rmSel = {};          // {role:true} pending selection
let _rmVerified = false;

async function openRoleManager(username){
  // Developer edits; Owner may only look
  const _rmReadOnly = !can('roles.grant');
  if(_rmReadOnly && !requirePerm('roles.view','Only Owner and above can view roles')) return false;
  const un=String(username||'').toLowerCase();
  if(!un) return false;
  const u=_duCache.find(x=>x.username===un) || (getUsers()[un]||{username:un});
  // editors may never touch a peer or a superior (viewers can still look)
  if(!_rmReadOnly && !canActOn(un, u)){
    try{ showToast({title:'Not allowed',
      body:'@'+un+' ranks '+roleTitle(getUserLevel(un,u))+' — you cannot change that',
      color:'#ef4444', avatar:'🔒'}); }catch(e){}
    return false;
  }
  _rmTarget=un;

  _rmSel={};
  getUserRoles(un, u).forEach(r=>{ _rmSel[r]=true; });
  _rmVerified = !!(u.verified || isUserVerified(un,u));

  document.getElementById('rmModal')?.remove();
  const m=document.createElement('div');
  m.id='rmModal';
  m.className='modal-overlay show';

  const opts = ROLE_ORDER.filter(r=>{
    if(_rmReadOnly) return true;            // viewers see the full picture
    if(r==='admin' && !can('roles.grantAdmin')) return false;
    return myLevel() > (ROLE_LEVELS[r]||0);
  }).map(r=>{
    const d=ROLE_DEFS[r];
    return `<button type="button" class="rm-opt ${_rmSel[r]?'on':''} ${_rmReadOnly?'ro':''}" data-role="${r}" ${_rmReadOnly?'disabled':''}>
      <div class="rm-ico" style="background:${r==='admin'?'#ffe4e6':r==='moderator'?'#e0f2fe':'#dcfce7'};">${d.icon}</div>
      <div class="rm-txt"><div class="rm-name">${d.label}</div><div class="rm-desc">${d.desc}</div></div>
      <div class="rm-check">${_rmSel[r]?'✓':''}</div>
    </button>`;
  }).join('');

  m.innerHTML=`<div class="modal vp-modal" style="max-width:340px;">
    <button type="button" class="vp-close" id="rmClose">✕</button>
    <div class="vp-hero" style="padding-bottom:6px;">
      <h2 class="vp-name" style="font-size:19px;">${_rmReadOnly?'Roles':'Manage roles'}</h2>
      <p class="vp-user">@${esc(un)}</p>
      <div class="rm-current" id="rmCurrent"></div>
    </div>
    <div class="vp-section" style="margin-top:6px;">
      <div class="vp-section-label">${_rmReadOnly?'Roles held':'Assign roles'}</div>
      <div class="rm-list">
        ${opts}
        <button type="button" class="rm-opt ${_rmVerified?'on':''} ${_rmReadOnly?'ro':''}" data-role="__verified" ${_rmReadOnly?'disabled':''}>
          <div class="rm-ico" style="background:#dbeafe;">✔️</div>
          <div class="rm-txt"><div class="rm-name">Verified</div><div class="rm-desc">Blue tick next to the name</div></div>
          <div class="rm-check">${_rmVerified?'✓':''}</div>
        </button>
      </div>
      ${_rmReadOnly?'':'<button type="button" class="rm-save" id="rmSave">Save changes</button>'}
      <div class="rm-note">${_rmReadOnly
        ? '👁️ View only — only the Developer can change roles.'
        : 'Saved to the cloud — everyone will see these badges.'}</div>
    </div>
  </div>`;
  (document.getElementById('phoneShell')||document.body).appendChild(m);
  _rmPaintPreview();

  m.addEventListener('click',e=>{ if(e.target===m) m.remove(); });
  document.getElementById('rmClose')?.addEventListener('click',()=>m.remove());
  m.querySelectorAll('.rm-opt').forEach(btn=>{
    if(_rmReadOnly) return;              // viewers cannot toggle anything
    btn.addEventListener('click',()=>{
      const r=btn.getAttribute('data-role');
      if(r==='__verified'){ _rmVerified=!_rmVerified; btn.classList.toggle('on',_rmVerified);
                            btn.querySelector('.rm-check').textContent=_rmVerified?'✓':''; }
      else{ _rmSel[r]=!_rmSel[r]; btn.classList.toggle('on',!!_rmSel[r]);
            btn.querySelector('.rm-check').textContent=_rmSel[r]?'✓':''; }
      _rmPaintPreview();
    });
  });
  document.getElementById('rmSave')?.addEventListener('click', saveRoleManager);
  return true;
}

function _rmPaintPreview(){
  const box=document.getElementById('rmCurrent');
  if(!box) return;
  const roles=ROLE_ORDER.filter(r=>_rmSel[r]);
  let html='';
  if(_rmVerified) html+=verifiedBadgeHTML();
  roles.forEach(r=>{ html+=roleBadgeHTML(r); });
  box.innerHTML = html || '<span style="font-size:11px;color:#94a3b8;font-weight:600;">No roles yet</span>';
}

async function saveRoleManager(){
  const btn=document.getElementById('rmSave');
  if(btn){ btn.disabled=true; btn.textContent='Saving…'; }
  const un=_rmTarget;
  if(!can('roles.grant')){ document.getElementById('rmModal')?.remove(); return; }
  // keep roles that this editor was not allowed to see/change
  const editable=ROLE_ORDER.filter(r=>{
    if(r==='admin' && !can('roles.grantAdmin')) return false;
    return myLevel() > (ROLE_LEVELS[r]||0);
  });
  const existing=(()=>{ try{
    const u=_duCache.find(x=>x.username===un)||getUsers()[un]||{};
    return getUserRoles(un,u);
  }catch(e){ return []; } })();
  const roles=ROLE_ORDER.filter(r=>
    editable.includes(r) ? _rmSel[r] : existing.includes(r)
  );
  const verified = can('user.verify') ? !!_rmVerified
                 : !!(_duCache.find(x=>x.username===un)?.verified);

  // 1) local registry (instant, works offline)
  try{
    const users=getUsers();
    const prev=users[un]||{username:un};
    const next={...prev, username:un, roles, verified};
    ROLE_ORDER.forEach(r=>{ if(!roles.includes(r)) delete next[r]; });
    users[un]=next;
    saveUsers(users);
    try{ _verifiedCache[un]=verified===true?true:undefined; }catch(e){}
  }catch(e){}

  // 2) cloud
  let cloudOk=false, cloudMsg='';
  if(isCloud && db){
    try{
      const _race=(pr,ms)=>Promise.race([pr,new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),ms))]);
      const {doc,getDoc,setDoc}=await _race(
        AURORA_SB,6000);
      // username -> uid
      let uid=null;
      try{
        const ud=await _race(getDoc(doc(db,'usernames',un)),6000);
        if(ud.exists()) uid=ud.data().uid;
      }catch(e){}
      if(uid){
        await _race(setDoc(doc(db,'users',uid),{
          roles, verified, isVerified:verified, rolesUpdatedAt:new Date()
        },{merge:true}),8000);
        cloudOk=true;
      }else{
        cloudMsg='No cloud account for @'+un;
      }
    }catch(e){ cloudMsg=e.message||'cloud write failed'; }
  }else{
    cloudMsg='Offline — saved on this device only';
  }

  // 3) refresh everything on screen
  try{
    const c=_duCache.find(x=>x.username===un);
    if(c){ c.roles=roles; c.verified=verified; }
  }catch(e){}
  try{ renderDevUsers(); }catch(e){}
  try{ renderChats(); }catch(e){}
  try{ refreshSettingsUI(); }catch(e){}

  document.getElementById('rmModal')?.remove();
  const label = roles.length ? roles.map(r=>ROLE_DEFS[r].label).join(', ') : 'no roles';
  try{
    showToast({
      title: cloudOk ? 'Roles updated ✓' : 'Saved locally',
      body: '@'+un+' · '+label+(verified?' · Verified':'')+(cloudOk?'':' — '+cloudMsg),
      color: cloudOk ? '#10b981' : '#f59e0b',
      avatar: cloudOk ? '✓' : '!'
    });
  }catch(e){}
}

window.openRoleManager=openRoleManager;
window.saveRoleManager=saveRoleManager;

/* ============ RANK & PERKS + MODERATION SHEETS ============
   Gives Admin / Moderator / VIP something real to open, instead of a
   Settings screen that looks identical to a plain member's.
   ========================================================== */
const PERM_LABELS = {
  'debug.tools':      'Debug tools',
  'roles.grantAdmin': 'Grant any role (incl. Admin)',
  'users.viewAll':    'Browse all users',
  'users.delete':     'Delete user accounts',
  'roles.grant':      'Grant roles & verify users',
  'roles.view':       'View anyone\u2019s roles',
  'chat.deleteAny':   'Delete any conversation',
  'user.ban':         'Ban / unban users',
  'user.verify':      'Verify users',
  'chat.clearAny':    'Clear any conversation',
  'msg.deleteAny':    'Delete any message',
  'user.mute':        'Mute users',
  'user.warn':        'Warn users',
  'upload.large':     'Large file uploads',
  'ads.free':         'Ad-free experience'
};

function openMyPerks(){
  const lvl=myLevel();
  const title=roleTitle(lvl);
  const mine=[], locked=[];
  Object.keys(PERMS).forEach(k=>{
    (lvl>=PERMS[k] ? mine : locked).push({k, need:PERMS[k]});
  });
  locked.sort((a,b)=>a.need-b.need);

  document.getElementById('rmModal')?.remove();
  document.getElementById('perkModal')?.remove();
  const m=document.createElement('div');
  m.id='perkModal';
  m.className='modal-overlay show';

  const badges = roleBadgesHTML(currentUserData?.username, currentUserData) || '';
  const row=(p,on)=>`<div class="pk-row ${on?'on':''}">
      <span class="pk-tick">${on?'✓':'🔒'}</span>
      <span class="pk-txt">${esc(PERM_LABELS[p.k]||p.k)}</span>
      ${on?'':`<span class="pk-need">${esc(roleTitle(p.need))}</span>`}
    </div>`;

  m.innerHTML=`<div class="modal vp-modal" style="max-width:340px;">
    <button type="button" class="vp-close" id="pkClose">✕</button>
    <div class="vp-hero" style="padding-bottom:4px;">
      <div class="pk-crest">${lvl>=100?'💻':lvl>=80?'👑':lvl>=60?'🛡️':lvl>=40?'🔧':lvl>=20?'⭐':'👤'}</div>
      <h2 class="vp-name" style="font-size:20px;">${esc(title)}</h2>
      <p class="vp-user">@${esc(currentUserData?.username||'')}</p>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">${badges}</div>
    </div>
    <div class="vp-section">
      <div class="vp-section-label">You can (${mine.length})</div>
      <div class="pk-card">${mine.length?mine.map(p=>row(p,true)).join(''):'<div class="pk-empty">No special permissions</div>'}</div>
    </div>
    ${locked.length?`<div class="vp-section">
      <div class="vp-section-label">Locked (${locked.length})</div>
      <div class="pk-card">${locked.map(p=>row(p,false)).join('')}</div>
    </div>`:''}
  </div>`;
  (document.getElementById('phoneShell')||document.body).appendChild(m);
  m.addEventListener('click',e=>{ if(e.target===m) m.remove(); });
  document.getElementById('pkClose')?.addEventListener('click',()=>m.remove());
  return true;
}

/* ---- moderation actions (each re-checks the permission) ---- */
function modBlockUser(un){
  un=String(un||'').toLowerCase();
  if(!un) return false;
  if(!requirePerm('user.ban','Only Admin and above can block users')) return false;
  const target=_duCache.find(x=>x.username===un) || getUsers()[un] || {username:un};
  if(!canActOn(un,target)){
    try{ showToast({title:'Not allowed',
      body:'@'+un+' ranks '+roleTitle(getUserLevel(un,target)),
      color:'#ef4444',avatar:'🔒'}); }catch(e){}
    return false;
  }
  try{
    const list=JSON.parse(localStorage.getItem('aurora_blocked')||'[]')||[];
    if(!list.includes(un)){ list.push(un); localStorage.setItem('aurora_blocked',JSON.stringify(list)); }
  }catch(e){}
  try{ showToast({title:'User blocked 🚫',body:'@'+un,color:'#ef4444',avatar:'🚫'}); }catch(e){}
  try{ renderChats(); }catch(e){}
  return true;
}
function modUnblockUser(un){
  un=String(un||'').toLowerCase();
  if(!requirePerm('user.ban','Only Admin and above can unblock users')) return false;
  try{
    const list=(JSON.parse(localStorage.getItem('aurora_blocked')||'[]')||[]).filter(x=>x!==un);
    localStorage.setItem('aurora_blocked',JSON.stringify(list));
  }catch(e){}
  try{ showToast({title:'Unblocked ✅',body:'@'+un,color:'#10b981',avatar:'✅'}); }catch(e){}
  try{ renderChats(); }catch(e){}
  return true;
}
function modMuteUser(un){
  un=String(un||'').toLowerCase();
  if(!un) return false;
  if(!requirePerm('user.mute','Moderator and above only')) return false;
  const target=_duCache.find(x=>x.username===un) || getUsers()[un] || {username:un};
  if(!canActOn(un,target)){
    try{ showToast({title:'Not allowed',
      body:'@'+un+' ranks '+roleTitle(getUserLevel(un,target)),
      color:'#ef4444',avatar:'🔒'}); }catch(e){}
    return false;
  }
  // mute is stored per room id
  const me=String(currentUserData?.username||'').toLowerCase();
  const roomId=[me,un].sort().join('_');
  try{ localStorage.setItem('aurora_mute_'+roomId,'1'); }catch(e){}
  try{ showToast({title:'Muted 🔕',body:'@'+un,color:'#f59e0b',avatar:'🔕'}); }catch(e){}
  try{ renderChats(); }catch(e){}
  return true;
}
function modUnmute(roomId){
  if(!requirePerm('user.mute','Moderator and above only')) return false;
  try{ localStorage.removeItem('aurora_mute_'+roomId); }catch(e){}
  try{ showToast({title:'Unmuted 🔔',body:roomId,color:'#10b981',avatar:'🔔'}); }catch(e){}
  try{ renderChats(); }catch(e){}
  return true;
}
function modWarnUser(un){
  un=String(un||'').toLowerCase();
  if(!requirePerm('user.warn','Moderator and above only')) return false;
  const target=_duCache.find(x=>x.username===un) || getUsers()[un] || {username:un};
  if(!canActOn(un,target)){
    try{ showToast({title:'Not allowed',body:'@'+un+' outranks you',color:'#ef4444',avatar:'🔒'}); }catch(e){}
    return false;
  }
  const text=prompt('Warning message for @'+un+':','Please follow the community rules.');
  if(text===null) return false;
  try{
    const warns=JSON.parse(localStorage.getItem('aurora_warnings')||'{}');
    warns[un]=warns[un]||[];
    warns[un].push({text:String(text).slice(0,200), by:currentUserData?.username||'', ts:Date.now()});
    localStorage.setItem('aurora_warnings',JSON.stringify(warns));
  }catch(e){}
  try{ showToast({title:'Warning issued ⚠️',body:'@'+un,color:'#f59e0b',avatar:'⚠️'}); }catch(e){}
  return true;
}
function modGetWarnings(un){
  try{ return (JSON.parse(localStorage.getItem('aurora_warnings')||'{}')[String(un).toLowerCase()])||[]; }
  catch(e){ return []; }
}
function modClearWarnings(un){
  if(!requirePerm('user.warn')) return false;
  try{
    const w=JSON.parse(localStorage.getItem('aurora_warnings')||'{}');
    delete w[String(un).toLowerCase()];
    localStorage.setItem('aurora_warnings',JSON.stringify(w));
  }catch(e){}
  return true;
}
window.modBlockUser=modBlockUser;
window.modUnblockUser=modUnblockUser;
window.modMuteUser=modMuteUser;
window.modUnmute=modUnmute;
window.modWarnUser=modWarnUser;
window.modGetWarnings=modGetWarnings;

async function openModTools(){
  if(!requirePerm('user.mute','Moderator and above only')) return false;

  const blocked=(()=>{ try{ return JSON.parse(localStorage.getItem('aurora_blocked')||'[]')||[]; }catch(e){ return []; } })();
  const muted=[];
  try{
    Object.keys(localStorage).forEach(k=>{
      if(k.startsWith('aurora_mute_') && localStorage.getItem(k)==='1') muted.push(k.replace('aurora_mute_',''));
    });
  }catch(e){}
  const warns=(()=>{ try{ return JSON.parse(localStorage.getItem('aurora_warnings')||'{}'); }catch(e){ return {}; } })();

  // need the user list so moderators can pick someone to act on
  try{ if(!_duCache.length) await loadAllUsers(); }catch(e){}

  document.getElementById('perkModal')?.remove();
  document.getElementById('modModal')?.remove();
  const m=document.createElement('div');
  m.id='modModal';
  m.className='modal-overlay show';

  const listRow=(txt,kind)=>`<div class="pk-row"><span class="pk-tick">${kind==='b'?'🚫':'🔕'}</span>
      <span class="pk-txt">${esc(txt)}</span>
      <button type="button" class="pk-undo" data-kind="${kind}" data-id="${esc(txt)}">${kind==='b'?'Unblock':'Unmute'}</button></div>`;
  const warnKeys=Object.keys(warns).filter(k=>(warns[k]||[]).length);

  m.innerHTML=`<div class="modal vp-modal" style="max-width:340px;">
    <button type="button" class="vp-close" id="mtClose">✕</button>
    <div class="vp-hero" style="padding-bottom:4px;">
      <div class="pk-crest">🛡️</div>
      <h2 class="vp-name" style="font-size:20px;">Moderation</h2>
      <p class="vp-user">${esc(roleTitle(myLevel()))} tools</p>
    </div>

    <div class="vp-section">
      <div class="vp-section-label">Take action on a user</div>
      <div class="mt-pick">
        <input type="text" id="mtSearch" placeholder="Search @username" autocomplete="off">
        <div class="mt-results" id="mtResults"></div>
      </div>
    </div>

    <div class="vp-section">
      <div class="vp-section-label">Blocked users (${blocked.length})</div>
      <div class="pk-card">${blocked.length?blocked.map(u=>listRow(u,'b')).join(''):'<div class="pk-empty">Nobody blocked</div>'}</div>
    </div>
    <div class="vp-section">
      <div class="vp-section-label">Muted chats (${muted.length})</div>
      <div class="pk-card">${muted.length?muted.map(u=>listRow(u,'m')).join(''):'<div class="pk-empty">Nothing muted</div>'}</div>
    </div>
    ${warnKeys.length?`<div class="vp-section">
      <div class="vp-section-label">Warnings issued (${warnKeys.length})</div>
      <div class="pk-card">${warnKeys.map(u=>`<div class="pk-row"><span class="pk-tick">⚠️</span>
        <span class="pk-txt">${esc(u)} <b style="color:#94a3b8;">×${warns[u].length}</b></span>
        <button type="button" class="pk-undo" data-kind="w" data-id="${esc(u)}">Clear</button></div>`).join('')}</div>
    </div>`:''}
  </div>`;
  (document.getElementById('phoneShell')||document.body).appendChild(m);
  m.addEventListener('click',e=>{ if(e.target===m) m.remove(); });
  document.getElementById('mtClose')?.addEventListener('click',()=>m.remove());

  /* --- undo buttons on the lists --- */
  m.querySelectorAll('.pk-undo').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.getAttribute('data-id'), kind=btn.getAttribute('data-kind');
      if(kind==='b') modUnblockUser(id);
      else if(kind==='m') modUnmute(id);
      else if(kind==='w') modClearWarnings(id);
      m.remove(); openModTools();
    });
  });

  /* --- live user picker with Block / Mute / Warn --- */
  const inp=document.getElementById('mtSearch');
  const box=document.getElementById('mtResults');
  const paint=()=>{
    const q=(inp.value||'').trim().toLowerCase();
    if(!q){ box.innerHTML='<div class="mt-hint">Type a name to block, mute or warn</div>'; return; }
    const me=String(currentUserData?.username||'').toLowerCase();
    const hits=_duCache.filter(u=>u.username!==me &&
      (u.username.includes(q) || String(u.nickname||'').toLowerCase().includes(q))).slice(0,6);
    if(!hits.length){ box.innerHTML='<div class="mt-hint">No user found</div>'; return; }
    box.innerHTML=hits.map(u=>{
      const allowed=canActOn(u.username,u);
      const isBlocked=blocked.includes(u.username);
      return `<div class="mt-hit">
        <div class="mt-hit-info">
          <div class="mt-hit-name">${esc(u.nickname||u.username)}</div>
          <div class="mt-hit-sub">@${esc(u.username)} · ${esc(roleTitle(getUserLevel(u.username,u)))}</div>
        </div>
        ${allowed?`<div class="mt-hit-acts">
          ${can('user.ban')?`<button type="button" class="mt-act ${isBlocked?'off':'ban'}" data-act="${isBlocked?'unblock':'block'}" data-un="${esc(u.username)}">${isBlocked?'Unblock':'Block'}</button>`:''}
          <button type="button" class="mt-act mute" data-act="mute" data-un="${esc(u.username)}">Mute</button>
          <button type="button" class="mt-act warn" data-act="warn" data-un="${esc(u.username)}">Warn</button>
        </div>`:'<span class="mt-locked">🔒 outranks you</span>'}
      </div>`;
    }).join('');
    box.querySelectorAll('.mt-act').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const un=btn.getAttribute('data-un'), act=btn.getAttribute('data-act');
        let ok=false;
        if(act==='block')   ok=modBlockUser(un);
        else if(act==='unblock') ok=modUnblockUser(un);
        else if(act==='mute')    ok=modMuteUser(un);
        else if(act==='warn')    ok=modWarnUser(un);
        if(ok){ m.remove(); openModTools(); }
      });
    });
  };
  inp?.addEventListener('input',paint);
  paint();
  return true;
}

window.openMyPerks=openMyPerks;
window.openModTools=openModTools;
document.getElementById('stMyPerks')?.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); openMyPerks(); });
document.getElementById('stModTools')?.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); Promise.resolve(openModTools()).catch(err=>console.error('modTools',err)); });

/* ============ REMAINING PRIVILEGED ACTIONS ============
   Wires the permissions that had no UI yet:
     msg.deleteAny · users.delete · upload.large · ads.free · debug.tools
   ====================================================== */

/* ---- delete any message (long-press a bubble) ---- */
async function modDeleteMessage(roomId, msgId){
  if(!requirePerm('msg.deleteAny','Moderator and above can delete messages')) return false;
  if(!roomId || !msgId) return false;
  if(!confirm('Delete this message for everyone?')) return false;
  let ok=false;
  if(isCloud && db){
    try{
      const {doc,deleteDoc}=AURORA_SB;
      await deleteDoc(doc(db,'rooms',roomId,'messages',String(msgId)));
      ok=true;
    }catch(e){ console.log('msg delete',e.message); }
  }
  if(!ok){
    try{
      const rooms=getGlobalRooms(); const room=rooms[roomId];
      if(room && Array.isArray(room.messages)){
        room.messages=room.messages.filter(x=>String(x.id)!==String(msgId));
        rooms[roomId]=room; saveGlobalRooms(rooms); ok=true;
      }
    }catch(e){}
  }
  if(ok){
    try{ document.querySelector(`.msg-row[data-msg-id="${msgId}"]`)?.remove(); }catch(e){}
    try{ renderMessagesForRoom(roomId,false); }catch(e){}
    try{ showToast({title:'Message deleted 🗑️',body:'Removed for everyone',color:'#ef4444',avatar:'🗑️'}); }catch(e){}
  }
  return ok;
}
window.modDeleteMessage=modDeleteMessage;

/* long-press / right-click any bubble to delete it */
(function(){
  const bind=()=>{
    const box=document.getElementById('messages');
    if(!box || box._modDelBound) return;
    box._modDelBound=true;
    let t=null;
    const fire=(e)=>{
      if(!can('msg.deleteAny')) return;
      const row=e.target.closest?.('.msg-row[data-msg-id]');
      if(!row) return;
      e.preventDefault();
      modDeleteMessage(currentRoomId, row.dataset.msgId);
    };
    box.addEventListener('contextmenu', fire);
    box.addEventListener('touchstart',(e)=>{
      const row=e.target.closest?.('.msg-row[data-msg-id]');
      if(!row) return;
      t=setTimeout(()=>{ t=null; fire(e); }, 600);
    },{passive:false});
    box.addEventListener('touchend',()=>{ if(t) clearTimeout(t); });
    box.addEventListener('touchmove',()=>{ if(t) clearTimeout(t); });
  };
  bind();
  document.addEventListener('DOMContentLoaded',bind);
  setTimeout(bind,1500);
})();

/* ---- delete a user account (Owner+) ---- */
async function modDeleteUser(un){
  un=String(un||'').toLowerCase();
  if(!requirePerm('users.delete','Only Owner and above can delete accounts')) return false;
  const target=_duCache.find(x=>x.username===un) || getUsers()[un] || {username:un};
  if(!canActOn(un,target)){
    try{ showToast({title:'Not allowed',body:'@'+un+' ranks '+roleTitle(getUserLevel(un,target)),
      color:'#ef4444',avatar:'🔒'}); }catch(e){}
    return false;
  }
  if(!confirm('Delete the account @'+un+' ?\n\nThis removes their profile, username and presence. It cannot be undone.')) return false;

  // local
  try{ const u=getUsers(); delete u[un]; saveUsers(u); }catch(e){}
  // cloud
  if(isCloud && db){
    try{
      const {doc,getDoc,deleteDoc}=AURORA_SB;
      let uid=null;
      try{ const d=await getDoc(doc(db,'usernames',un)); if(d.exists()) uid=d.data().uid; }catch(e){}
      if(uid){ try{ await deleteDoc(doc(db,'users',uid)); }catch(e){} }
      try{ await deleteDoc(doc(db,'usernames',un)); }catch(e){}
      try{ await deleteDoc(doc(db,'presence',un)); }catch(e){}
    }catch(e){ console.log('user delete',e.message); }
  }
  try{ _duCache=_duCache.filter(x=>x.username!==un); renderDevUsers(); }catch(e){}
  try{ showToast({title:'Account deleted',body:'@'+un,color:'#ef4444',avatar:'🗑️'}); }catch(e){}
  return true;
}
window.modDeleteUser=modDeleteUser;

/* ---- VIP perks ---- */
function maxUploadMB(){ return can('upload.large') ? 25 : 5; }
function isAdFree(){ return can('ads.free'); }
window.maxUploadMB=maxUploadMB;
window.isAdFree=isAdFree;

/* ---- debug tools (Developer only) ---- */
function openDebugTools(){
  if(!requirePerm('debug.tools','Developer only')) return false;
  const info={
    user: currentUserData?.username,
    level: myLevel()+' ('+roleTitle(myLevel())+')',
    roles: getUserRoles(currentUserData?.username,currentUserData).join(', ')||'none',
    cloud: (typeof isCloud!=='undefined' && isCloud) ? 'connected' : 'offline',
    room: currentRoomId||'none',
    contacts: (contacts||[]).length,
    cachedUsers: Object.keys(getUsers()||{}).length,
    storageKB: Math.round(JSON.stringify(localStorage).length/1024),
    theme: document.body.getAttribute('data-theme')||'light',
    ua: navigator.userAgent.slice(0,60)
  };
  document.getElementById('dbgModal')?.remove();
  const m=document.createElement('div');
  m.id='dbgModal'; m.className='modal-overlay show';
  m.innerHTML=`<div class="modal vp-modal" style="max-width:340px;">
    <button type="button" class="vp-close" id="dbgClose">✕</button>
    <div class="vp-hero" style="padding-bottom:4px;">
      <div class="pk-crest">💻</div>
      <h2 class="vp-name" style="font-size:20px;">Debug tools</h2>
      <p class="vp-user">Developer only</p>
    </div>
    <div class="vp-section">
      <div class="vp-section-label">Session</div>
      <div class="pk-card">${Object.entries(info).map(([k,v])=>
        `<div class="pk-row"><span class="pk-txt" style="font-weight:700;">${esc(k)}</span>
         <span style="font-size:11px;color:#94a3b8;font-weight:600;text-align:right;max-width:58%;word-break:break-all;">${esc(String(v))}</span></div>`).join('')}</div>
    </div>
    <div class="vp-section">
      <div class="vp-section-label">Actions</div>
      <div class="rm-list">
        <button type="button" class="rm-opt" id="dbgReload"><div class="rm-ico" style="background:#e0f2fe;">🔄</div>
          <div class="rm-txt"><div class="rm-name">Reload users from cloud</div><div class="rm-desc">Refetch database</div></div></button>
        <button type="button" class="rm-opt" id="dbgClearCache"><div class="rm-ico" style="background:#fef3c7;">🧹</div>
          <div class="rm-txt"><div class="rm-name">Clear local caches</div><div class="rm-desc">Keeps your login</div></div></button>
        <button type="button" class="rm-opt" id="dbgCopy"><div class="rm-ico" style="background:#dcfce7;">📋</div>
          <div class="rm-txt"><div class="rm-name">Copy diagnostics</div><div class="rm-desc">To clipboard</div></div></button>
      </div>
    </div>
  </div>`;
  (document.getElementById('phoneShell')||document.body).appendChild(m);
  m.addEventListener('click',e=>{ if(e.target===m) m.remove(); });
  document.getElementById('dbgClose')?.addEventListener('click',()=>m.remove());
  document.getElementById('dbgReload')?.addEventListener('click',async()=>{
    _duCache=[]; await loadAllUsers(true);
    try{ showToast({title:'Reloaded',body:_duCache.length+' accounts',color:'#10b981',avatar:'✓'}); }catch(e){}
  });
  document.getElementById('dbgClearCache')?.addEventListener('click',()=>{
    if(!confirm('Clear cached users, presence and notes?\n\nYour login stays.')) return;
    try{
      ['aurora_presence','aurora_notes_v1','aurora_typing','aurora_unread'].forEach(k=>localStorage.removeItem(k));
      _duCache=[];
    }catch(e){}
    try{ showToast({title:'Caches cleared',body:'Reload to refetch',color:'#f59e0b',avatar:'🧹'}); }catch(e){}
  });
  document.getElementById('dbgCopy')?.addEventListener('click',()=>{
    const txt=Object.entries(info).map(([k,v])=>k+': '+v).join('\n');
    try{ navigator.clipboard?.writeText(txt); showToast({title:'Copied',body:'Diagnostics on clipboard',color:'#10b981',avatar:'📋'}); }catch(e){}
  });
  return true;
}
window.openDebugTools=openDebugTools;
document.getElementById('stDebug')?.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); openDebugTools(); });

/* ========== END REMAINING PRIVILEGED ACTIONS ========== */

/* ========== END RANK & PERKS + MODERATION SHEETS ========== */

/* ================== END ROLE MANAGER ================== */

/* ================ END DEVELOPER · ALL USERS SCREEN ================ */





/* ============ ✓✓ READ RECEIPTS (sent / delivered / seen) ============ */
const roomMeta={};        // roomId -> raw room data (cloud doc / local room)
const prevReadSig={};     // marker change detect korar jonno
const lastSeenMarked={};  // infinite write loop bondho korar guard
const lastDelMarked={};
function ms(v){try{if(!v)return 0; if(typeof v==='number')return v; if(v.toMillis)return v.toMillis(); if(v.seconds)return v.seconds*1000;}catch{} return 0;}
function rcTickHtml(st){
  if(st==='seen') return '<span class="rc-tick rc-seen">✓✓</span>';
  if(st==='delivered') return '<span class="rc-tick rc-del">✓✓</span>';
  return '<span class="rc-tick rc-sent">✓</span>';
}
function rcStatusCloud(m, meta, otherU){
  if(!m) return 'sent';
  if(m.status) return m.status; // ✓✓ v2: receiver message doc e likheche
  if(!m.timestamp) return 'sent';
  const t=ms(m.timestamp); if(!t) return 'sent';
  if(t<=ms(meta['lastSeenAt_'+otherU])) return 'seen';
  if(t<=ms(meta['lastDeliveredAt_'+otherU])) return 'delivered';
  return 'sent';
}
function rcStatusLocal(m, room, otherU){
  const t=m.timestamp||0; if(!t) return 'sent';
  if(t<=(room['lastSeenAt_'+otherU]||0)) return 'seen';
  if(t<=(room['lastDeliveredAt_'+otherU]||0)) return 'delivered';
  return 'sent';
}
// Ami message dekhechi - cloud-এ marker likhi (sender er ticks ✓✓ blue hobe)
async function cloudMarkSeen(roomId){
  if(!isCloud||!db||!currentUserData||!roomId) return;
  const sig=prevRoomSig[roomId]||'';
  if(lastSeenMarked[roomId]===sig) return;
  lastSeenMarked[roomId]=sig;
  try{
    const {doc,setDoc,serverTimestamp}=AURORA_SB;
    await setDoc(doc(db,'rooms',roomId),{['lastSeenAt_'+currentUserData.username]:serverTimestamp()},{merge:true});
    try{if(typeof rcptLog==='function')rcptLog('seen marker ok @'+roomId);}catch(e){}
  }catch(e){try{if(typeof rcptFail==='function')rcptFail('SEEN MARKER ERR: '+e.message);}catch(x){}}
}
// Amar device message peyeche - delivered marker (sender er ticks ✓✓ hobe)
async function cloudMarkDelivered(roomId, sig){
  if(!isCloud||!db||!currentUserData||!roomId) return;
  if(lastDelMarked[roomId]===sig) return;
  lastDelMarked[roomId]=sig;
  try{
    const {doc,setDoc,serverTimestamp}=AURORA_SB;
    await setDoc(doc(db,'rooms',roomId),{['lastDeliveredAt_'+currentUserData.username]:serverTimestamp()},{merge:true});
    try{if(typeof rcptLog==='function')rcptLog('delivered marker ok @'+roomId);}catch(e){}
  }catch(e){try{if(typeof rcptFail==='function')rcptFail('DELIVERED MARKER ERR: '+e.message);}catch(x){}}
}
// Last message er niche TEXT status: Sent / Delivered / Seen + receiver photo
function rcInsertStatusLabel(msgEl, roomId, st, rcC){
  try{
    /* FIX: receipt text is now attached to the correct message row, not
       blindly appended at the bottom. Only the lowest already-seen own message
       shows "Seen"; later unread own messages keep just ✓✓. */
    msgEl.querySelectorAll('.seen-label').forEach(el => el.remove());
  }catch(e){}
}

/* ================== END READ RECEIPTS ================== */

/* ====== ✓✓ v2: PER-MESSAGE STATUS (WhatsApp style) + debug ====== */
function rcptLog(msg){try{console.log('RCPT>',msg);const a=JSON.parse(localStorage.getItem('aurora_rcpt_log')||'[]');a.push(new Date().toLocaleTimeString()+' '+msg);localStorage.setItem('aurora_rcpt_log',JSON.stringify(a.slice(-40)));}catch(e){}}
function rcptFail(msg){rcptLog(msg);try{if(!sessionStorage.getItem('rcpt_fail_shown')){sessionStorage.setItem('rcpt_fail_shown','1');showToast({title:'⚠️ Receipt sync fail',body:String(msg).slice(0,120),color:'#ef4444',avatar:'!'});}}catch(e){}}
// Receiver: amar kache asha message gulor doc e status likhe dei
async function cloudUpgradeRoomMessages(roomId,newStatus){
  if(!isCloud||!db||!currentUserData||!roomId) return;
  try{
    const {collection,getDocs,updateDoc,doc}=AURORA_SB;
    const snap=await getDocs(collection(db,'rooms',roomId,'messages'));
    const me=currentUserData.username;
    const tasks=[];
    snap.forEach(d=>{
      if(tasks.length>=40) return;
      const m=d.data();
      if(m.system) return;
      const mine=(currentUser&&m.senderId===currentUser.uid)||m.senderName===me;
      if(mine) return;
      const st=m.status||'sent';
      if(newStatus==='seen'&&st!=='seen') tasks.push(updateDoc(doc(db,'rooms',roomId,'messages',d.id),{status:'seen'}));
      else if(newStatus==='delivered'&&st==='sent') tasks.push(updateDoc(doc(db,'rooms',roomId,'messages',d.id),{status:'delivered'}));
    });
    if(tasks.length){ await Promise.all(tasks); rcptLog('marked '+newStatus+' x'+tasks.length+' @'+roomId); }
  }catch(e){ rcptFail('UPGRADE ERR '+newStatus+': '+e.message); }
}
// Tab visible hole open room er messages seen mark
document.addEventListener('visibilitychange',()=>{
  if(isConversationVisible(currentRoomId)){try{cloudUpgradeRoomMessages(currentRoomId,'seen'); cloudMarkSeen(currentRoomId);}catch(e){}}
});
/* ================== END v2 ================== */

function timeNow(){return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}

/* ================== CONVERSATION LIST ORDER: NEWEST -> OLDEST ==================
   BUGFIX: the chat list used to be ordered by the *formatted* time text
   ("11:30 PM", "Yesterday", "Monday", ...). Comparing those strings puts
   "11:30 PM" ABOVE "10:45 PM" (wrong), puts every "Yesterday"/"Monday" row
   above today's rows, and a conversation whose room summary carried no time
   string at all stayed wherever it was pushed (new chats stayed stuck on top
   forever). Rows are now ordered by a real numeric activity timestamp:

     1. room.lastMessageAt / lastMessageTs / lastTs / updatedAt
                                                    (cloud serverTimestamp, or
                                                     Date.now() stamped locally)
     2. newest message's real timestamp in the room (timestamp/createdAt/ts)
     3. an earlier real date we memorised for it    (localStorage memory)
     4. room.lastTime / row label parsed to ms      (dateless: "10:45 PM",
                                                     "Yesterday", "Monday")

   Steps 1-3 carry a DATE, step 4 cannot (it only ever describes "today around
   this time"), so step 4 is used last and its value is never memorised.

   Sort is descending (newest first) with a display-name tie-break, so the
   order can never shuffle on repaint. Both the home list (renderChats) and the
   offline/local list builder (loadUserContacts) use the same helper.
   ============================================================================= */
var CONV_TS_KEY='aurora_conv_ts_v1';
function convTsMemory(){
  try{ const o=JSON.parse(localStorage.getItem(CONV_TS_KEY)||'{}'); return (o&&typeof o==='object')?o:{}; }catch(e){ return {}; }
}
function rememberConvTs(roomId,ms){
  try{
    if(!roomId||!ms) return;
    const s=convTsMemory();
    if(!(Number(s[roomId])>=ms)){ s[roomId]=ms; localStorage.setItem(CONV_TS_KEY,JSON.stringify(s)); }
  }catch(e){}
}
/* database Timestamp | Date | number | numeric string -> ms (0 = unknown) */
function convAnyToMs(value){
  try{
    if(value==null||value==='') return 0;
    if(typeof value==='number') return value>1e12?value:(value>1e9?value*1000:0);
    if(value instanceof Date) return value.getTime();
    if(typeof value.toMillis==='function') return value.toMillis();
    if(typeof value.seconds==='number') return value.seconds*1000+Math.floor((value.nanoseconds||0)/1e6);
    const s=String(value).trim(); if(!s) return 0;
    if(/^\d+$/.test(s)){ const n=Number(s); return n>1e12?n:(n>1e9?n*1000:0); }
    const direct=Date.parse(s); return isNaN(direct)?0:direct;
  }catch(e){ return 0; }
}
/* "10:45 PM" / "22:45" -> today's ms. If that clock time is still ahead of now
   (right after midnight / clock skew) treat it as yesterday's. */
function convClockToMs(s){
  try{
    const t=String(s||'').trim(); if(!t) return 0;
    const m=t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
    if(!m) return 0;
    let h=Number(m[1]), mi=Number(m[2]), se=Number(m[3]||0);
    const ap=(m[4]||'').toLowerCase();
    if(ap){ if(ap.charAt(0)==='p'&&h<12) h+=12; if(ap.charAt(0)==='a'&&h===12) h=0; }
    if(h>23||mi>59) return 0;
    const now=new Date();
    let d=new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,mi,se,0).getTime();
    if(d-now.getTime()>5*60*1000) d-=86400000;
    return d;
  }catch(e){ return 0; }
}
var CONV_DAY_MS={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
function convDayLabelToMs(s){
  try{
    const t=String(s||'').trim().toLowerCase(); if(!t) return 0;
    const now=new Date();
    if(/^(just now|now|today|a moment ago)$/.test(t)) return now.getTime();
    if(t==='yesterday') return new Date(now.getFullYear(),now.getMonth(),now.getDate()-1,12,0,0).getTime();
    if(Object.prototype.hasOwnProperty.call(CONV_DAY_MS,t)){
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0,0);
      let diff=(d.getDay()-CONV_DAY_MS[t]+7)%7; if(diff===0) diff=7; // the day name before today
      d.setDate(d.getDate()-diff);
      return d.getTime();
    }
    const day=Date.parse(t); return isNaN(day)?0:day;   // "09/12/2026" style
  }catch(e){ return 0; }
}
function convTimeTextToMs(s){ return convClockToMs(s)||convDayLabelToMs(s); }
/* Newest ABSOLUTE (date-bearing) timestamp inside a room's message list.
   Every message this app writes carries timestamp / createdAt / ts =
   Date.now() (local) or a database Timestamp (cloud), even though the list
   row only shows a "10:45 PM" clock string. That absolute value is what keeps
   the DATE alive, so it is preferred over any label.
   Returns 0 when no message carries a real timestamp. */
function roomMessagesNewestMs(room){
  try{
    const arr=Array.isArray(room&&room.messages)?room.messages:[];
    for(let i=arr.length-1,n=0;i>=0&&n<40;i--,n++){
      const m=arr[i]; if(!m) continue;
      const t=convAnyToMs(m.timestamp)||convAnyToMs(m.createdAt)||convAnyToMs(m.ts)||convAnyToMs(m.sentAt);
      if(t) return t;
    }
    return 0;
  }catch(e){ return 0; }
}
/* Room activity as an ABSOLUTE date+time number (0 when the record cannot
   prove a date). Cloud serverTimestamp or a local Date.now() stamp only — a
   dateless "10:45 PM" label is NOT accepted here, because a label can only say
   "today around this time" and would silently drop the date. */
function roomActivityMs(room){
  try{
    if(!room) return 0;
    const stamp=Math.max(
      convAnyToMs(room.lastMessageAt),
      convAnyToMs(room.lastMessageTs),
      convAnyToMs(room.lastTs),
      convAnyToMs(room.updatedAt)
    );
    if(stamp) return stamp;
    const msg=roomMessagesNewestMs(room);
    if(msg) return msg;                  // newest message's real timestamp
    return convAnyToMs(room.createdAt);  // room opened, nothing said yet
  }catch(e){ return 0; }
}
/* Row label that follows the SAME date+time value used for sorting:
   today -> "10:45 PM", yesterday -> "Yesterday", older -> "12 Sep".
   Old rooms that only carry a clock string keep showing it unchanged.
   Set CONV_LIST_DATE_LABELS=false to keep the raw stored label everywhere. */
/* Row stamp style:
     'relative' (default) = Messenger-style short ago label: 5m · 2h · Yesterday
                            · Mon · 14 Sep
     'datetime'           = permanent date + clock, stacked on two lines
     'off'                = the raw stored label, exactly as before.
   Whatever the style, the value comes from the SAME absolute timestamp the
   list is sorted by, so the order and the printed stamp can never disagree. */
var CONV_LIST_TIME_STYLE='relative';   // 'relative' | 'datetime' | 'off'
var CONV_LIST_DATE_LABELS=true;        // false keeps the raw stored label
function convShortDate(ms){
  try{
    const d=new Date(ms), now=new Date();
    const sameYear=d.getFullYear()===now.getFullYear();
    return d.toLocaleDateString([], sameYear?{day:'numeric',month:'short'}:{day:'numeric',month:'short',year:'numeric'});
  }catch(e){ return ''; }
}
function convFullStamp(ms){
  try{
    return new Date(ms).toLocaleString([], {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }catch(e){ return ''; }
}
function convSameDay(a,b){
  try{ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }catch(e){ return false; }
}
/* Short "how long ago" label - one compact number that grows with the age:
     Now -> 5m (under 1 hour) -> 12h (under a day, up to 24h) -> 1d .. 6d
     -> 1w .. 4w (7d = 1w, 14d = 2w) -> 1mo .. 12mo (30d = 1mo, 60d = 2mo)
     -> 1y, 2y ... (365d = 1y)
   Units: m = minute, h = hour, d = day, w = week, mo = month, y = year.
   The exact date+time stays available on hover (and in 'datetime' style). */
function convRelativeLabel(ms){
  try{
    const v=Number(ms);
    if(!v) return '';
    let diff=Date.now()-v;
    if(!isFinite(diff)) return '';
    if(diff<0) diff=0;                                  // clock skew: never show a future age
    const MIN=60*1000, HOUR=60*MIN, DAY=24*HOUR, WEEK=7*DAY, MONTH=30*DAY, YEAR=365*DAY;
    if(diff<MIN) return 'Now';
    if(diff<HOUR) return Math.max(1,Math.floor(diff/MIN))+'m';   // 1m .. 59m
    if(diff<DAY)  return Math.floor(diff/HOUR)+'h';              // 1h .. 23h
    if(diff<DAY+HOUR) return '24h';                              // the 24th hour
    if(diff<WEEK) return Math.floor(diff/DAY)+'d';               // 1d .. 6d
    if(diff<MONTH) return Math.floor(diff/WEEK)+'w';             // 1w .. 4w
    if(diff<YEAR) return Math.floor(diff/MONTH)+'mo';            // 1mo .. 12mo
    return Math.floor(diff/YEAR)+'y';                            // 1y, 2y ...
  }catch(e){ return ''; }
}
window.convRelativeLabel=convRelativeLabel;
/* Plain-text stamp (also used as the hover title, so the exact date is never
   lost when the row only says "2h"). */
function convTimeLabel(c){
  try{
    const raw=(c&&c.time)||'';
    if(!CONV_LIST_DATE_LABELS || CONV_LIST_TIME_STYLE==='off') return raw;
    const ms=Number(c&&c._convActMs)||0;
    if(!ms) return raw;
    if(c&&c._convDateKnown===false) return raw;      // no real date on record: never invent one
    if(CONV_LIST_TIME_STYLE==='datetime'){
      const dateTxt=convShortDate(ms);
      const timeTxt=new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      return dateTxt?(dateTxt+', '+timeTxt):(timeTxt||raw);
    }
    return convRelativeLabel(ms)||raw;
  }catch(e){ return (c&&c.time)||''; }
}
window.convTimeLabel=convTimeLabel;
/* Row stamp as HTML. 'datetime' renders two lines, 'relative' one short label
   with the full date+time on hover. No real date on record -> raw label kept. */
function convTimeLabelHTML(c){
  try{
    const raw=(c&&c.time)||'';
    if(!CONV_LIST_DATE_LABELS || CONV_LIST_TIME_STYLE==='off') return esc(raw);
    const ms=Number(c&&c._convActMs)||0;
    if(!ms || (c&&c._convDateKnown===false)) return esc(raw);
    if(CONV_LIST_TIME_STYLE==='datetime'){
      const dateTxt=convShortDate(ms);
      const timeTxt=new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      if(!dateTxt) return esc(raw)||esc(timeTxt);
      return `<span class="ct-date">${esc(dateTxt)}</span><span class="ct-time">${esc(timeTxt)}</span>`;
    }
    const label=convRelativeLabel(ms);
    if(!label) return esc(raw);
    return `<span class="ct-rel" title="${esc(convFullStamp(ms))}">${esc(label)}</span>`;
  }catch(e){ return esc((c&&c.time)||''); }
}
window.convTimeLabelHTML=convTimeLabelHTML;

/* ===== chat row extras: "You: ..." preview, inline time, seen mark =====
   Reference look (Messenger):   You: huh · 8h            (avatar + tick)
   Bottom line = preview + timestamp right after it, and the delivered/seen
   mark on the right; the name line keeps only the name. */
function convRoomFor(c){
  try{
    if(!c) return null;
    if(typeof roomMeta==='object' && roomMeta && roomMeta[c.id]) return roomMeta[c.id];
  }catch(e){}
  try{ const rooms=getGlobalRooms(); if(rooms && rooms[c.id]) return rooms[c.id]; }catch(e){}
  return null;
}
/* Was the newest message in this conversation sent by me? */
function convLastIsMine(c){
  try{
    const me=String((currentUserData&&currentUserData.username)||'').toLowerCase();
    const raw=String((c&&c.last)||'');
    const room=convRoomFor(c);
    if(room && me){
      const sender=String(room.lastSenderUsername||room.lastSenderName||'').toLowerCase();
      if(sender) return sender===me;
      const arr=Array.isArray(room.messages)?room.messages:[];
      const last=arr.length?arr[arr.length-1]:null;
      if(last) return String(last.sender||last.senderName||'').toLowerCase()===me;
    }
    return /^You:/.test(raw);      // older rows stored the prefix already
  }catch(e){ return false; }
}
/* 'seen' | 'delivered' | 'sent' for my newest message ('' = not mine) */
function convLastStatus(c){
  try{
    if(!(c && (c.last||'').length)) return '';
    if(/^New conversation$/.test(String(c.last))) return '';
    if(!convLastIsMine(c)) return '';
    const other=String(c.otherUsername||c.username||'').toLowerCase();
    if(!other) return '';
    const room=convRoomFor(c)||{};
    const arr=Array.isArray(room.messages)?room.messages:[];
    const lastMsg=arr.length?arr[arr.length-1]:null;
    const meta=(isCloud && typeof roomMeta==='object' && roomMeta && roomMeta[c.id]) ? roomMeta[c.id] : room;
    const pseudo=lastMsg||{timestamp:Number(c.lastActiveMs)||convAnyToMs(c.lastMessageAt)||0};
    if(isCloud) return rcStatusCloud(pseudo, meta||{}, other);
    return rcStatusLocal(pseudo, meta||{}, other);
  }catch(e){ return ''; }
}
/* Right-hand mark: tiny avatar + tick (seen) / tick (delivered) / single tick */
function convSeenIndicatorHTML(c,st){
  try{
    if(!st) return '';
    if(st==='sent') return '<span class="conv-tick sent" title="Sent">\u2713</span>';
    const label=(st==='seen')?'Seen':(st==='delivered'?'Delivered':'Sent');
    return `<span class="conv-seen ${st}" title="${label}">`
      + `<span class="conv-seen-av" style="background:${avBg(c,(c&&c.color)||'#64748b')}">${avHTML(c)}</span>`
      + `<span class="conv-seen-tick">\u2713</span></span>`;
  }catch(e){ return ''; }
}
window.convLastIsMine=convLastIsMine;
window.convLastStatus=convLastStatus;
window.convSeenIndicatorHTML=convSeenIndicatorHTML;

/* Row layout check - console e:  window.debugRowLayout()
   Dekhay row/list er kono horizontal overflow ache kina (kate jawa-r karon
   prothom row theke dhora pore) ar mark ta daan konay koto tuku boshe ache. */
/* ===== send korle sathe sathe chat list refresh =====
   BUG: message pathanor por chat list ta purono theke jeto - cloud mode e
   database snapshot asha porjonto (koyek second) row-er preview/time purono-i
   thakto, tai "Now" na dekhiye age-r time dekhay. Ekhon send hoye gele sathe
   sathe (optimistic) room + contact row update kore list re-paint kori.
   database snapshot pore ashle asol serverTimestamp diye nijei thik kore ney. */
function afterMessageSent(roomId, previewText, whenMs){
  try{
    if(!roomId) return;
    const me=String((currentUserData&&currentUserData.username)||'').toLowerCase();
    const now=Number(whenMs)||Date.now();
    const preview=String(previewText==null?'':previewText).slice(0,60);
    const stamp=timeNow();
    // 1. local room cache (localStorage) - porer rebuild-o thik thake
    try{
      const rooms=getGlobalRooms();
      const room=rooms[roomId];
      if(room){
        room.lastMessage=preview;
        room.lastTime=stamp;
        room.lastMessageTs=now;
        room.lastSenderUsername=me;
        rooms[roomId]=room;
        saveGlobalRooms(rooms);
      }
    }catch(e){}
    // 2. cloud room meta (ticks / sender info ei object theke ashe)
    try{
      if(typeof roomMeta==='object' && roomMeta && roomMeta[roomId]){
        roomMeta[roomId]=Object.assign({},roomMeta[roomId],{
          lastMessage:preview, lastTime:stamp, lastMessageTs:now, lastSenderUsername:me
        });
      }
    }catch(e){}
    // 3. the row itself (list jodi row ta na jene thake, index theke fire ani)
    try{
      let c=(contacts||[]).find(x=>x&&x.id===roomId);
      if(!c){ contacts=healConversations(contacts); c=(contacts||[]).find(x=>x&&x.id===roomId); }
      // row ekdom na thakle (notun chat, cloud snapshot ekhono asheni) room
      // data theke row ta banai - tail na hoy chat ta list e na dekha jay.
      if(!c){
        try{
          const room=convRoomFor(roomId)||{};
          const parts=Array.isArray(room.participants)?room.participants:(Array.isArray(room.participantUsernames)?room.participantUsernames:[]);
          const other=String(room.otherUsername||parts.find(p=>p&&String(p).toLowerCase()!==me)||String(roomId).split('_').find(u=>u&&u!==me)||'').toLowerCase();
          if(other){
            const u=(typeof getUsers==='function' && getUsers()[other])||{};
            const nm=(Array.isArray(room.participantNicknames)&&room.participantNicknames[0])||null;
            const name=u.nickname||u.displayName||nm||other;
            c={ id:roomId, otherUsername:other, username:other,
                name, displayName:name, nickname:name,
                avatar:u.avatar||other.slice(0,2).toUpperCase(), avatarUrl:u.avatarUrl||null, color:u.color||'#64748b',
                last:preview, time:stamp, lastActiveMs:now, lastMessageAt:now, lastMessageTs:now, lastSenderUsername:me,
                participants:[me,other], participantUsernames:[me,other],
                cloud:!!(isCloud && roomMeta[roomId]) };
            contacts=(contacts||[]).concat([c]);
            try{ rememberConversation(c,{cloud:!!(isCloud&&roomMeta[roomId]),pendingCloud:!!isCloud}); }catch(e){}
          }
        }catch(e){}
      }
      if(c){
        c.last=preview;
        c.time=stamp;
        c.lastActiveMs=now;          // -> label "Now", row top e
        c.lastMessageAt=now;
        c.lastMessageTs=now;
        c.lastSenderUsername=me;
        c._justSentAt=now;
        try{ rememberConversation(c); }catch(e){}
      }
    }catch(e){}
    // 4. paint: prottek send e ek-i bar
    try{ renderChats(); }catch(e){}
    try{ if(window.__rcDebug) console.log('afterMessageSent', roomId, preview, now); }catch(e){}
  }catch(e){}
}
window.afterMessageSent=afterMessageSent;

window.debugRowLayout=function(){
  try{
    const list=document.getElementById('chatList');
    if(!list){ console.log('chatList nei'); return null; }
    const item=list.querySelector('.chat-item');
    const meta=item?item.querySelector('.chat-meta-right'):null;
    const seen=item?item.querySelector('.conv-seen'):null;
    const lr=list.getBoundingClientRect(), ir=item?item.getBoundingClientRect():null;
    const mr=meta?meta.getBoundingClientRect():null, sr=seen?seen.getBoundingClientRect():null;
    const out={
      listOverflowX:(list.scrollWidth-list.clientWidth)+'px',
      rowOverflowX:item?(item.scrollWidth-item.clientWidth)+'px':'n/a',
      listRight:Math.round(lr.right), rowRight:ir?Math.round(ir.right):null,
      metaRight:mr?Math.round(mr.right):null, seenRight:sr?Math.round(sr.right):null,
      gapListToSeen:sr?Math.round(lr.right-sr.right)+'px':'n/a'
    };
    console.table(out);
    return out;
  }catch(e){ console.log('debugRowLayout fail', e.message); return null; }
};

/* One number (DATE + time) per conversation row: newest activity we can prove.
   `getRooms` is an optional lazy cache so a whole sort parses the local room
   store only once (that blob can hold base64 media and is expensive).
   Absolute timestamps always outrank the dateless "10:45 PM" labels. */
function convActivityOf(c,getRooms){
  try{
    if(!c) return 0;
    const known=Number(convTsMemory()[c.id])||0;   // real date recorded earlier
    let ms=0, absolute=false;
    if(Number(c.lastActiveMs)){ ms=Number(c.lastActiveMs); absolute=true; }
    if(!ms && (c.lastMessageTs||c.lastMessageAt)){ ms=convAnyToMs(c.lastMessageTs)||convAnyToMs(c.lastMessageAt); absolute=!!ms; }
    let room=null;
    if(!ms){
      try{
        const rooms=getRooms?getRooms():((typeof getGlobalRooms==='function')?getGlobalRooms():{});
        if(rooms) room=rooms[c.id];
      }catch(e){}
      if(room){ ms=roomActivityMs(room); absolute=!!ms; }
    }
    // chat was opened but nothing was ever said: the creation date is the date
    if(!ms && room) { ms=convAnyToMs(room.createdAt); absolute=!!ms; }
    if(!ms) { ms=convAnyToMs(c.createdAtMs)||convAnyToMs(c.createdAt); absolute=!!ms; }
    if(!ms){ ms=known; absolute=!!ms; }                  // a real date from before
    if(!ms && room) ms=convTimeTextToMs(room.lastTime);  // dateless clock label
    if(!ms) ms=convTimeTextToMs(c.time);                 // dateless row label
    if(absolute && ms) rememberConvTs(c.id,ms);          // only real dates are memorised
    if(!ms) ms=known;
    // tells the row label whether a REAL date exists or only a clock string
    c._convDateKnown=!!absolute;
    return ms;
  }catch(e){ return 0; }
}
/* THE SORT: newest activity first. Equal timestamps -> A→Z by display name. */
function sortContactsByRecency(list){
  try{
    if(!Array.isArray(list)) return list;
    let rooms=null,roomsLoaded=false;
    const getRooms=()=>{ if(!roomsLoaded){ roomsLoaded=true; try{ rooms=(typeof getGlobalRooms==='function')?getGlobalRooms():{}; }catch(e){ rooms={}; } } return rooms; };
    list.forEach(c=>{ if(c) c._convActMs=convActivityOf(c,getRooms); });
    list.sort((a,b)=>{
      const ta=Number(a&&a._convActMs)||0, tb=Number(b&&b._convActMs)||0;
      if(tb!==ta) return tb-ta;
      const na=String(contactDisplayName(a)||(a&&a.username)||'').toLowerCase();
      const nb=String(contactDisplayName(b)||(b&&b.username)||'').toLowerCase();
      return na.localeCompare(nb);
    });
    return list;
  }catch(e){ return list; }
}
window.sortContactsByRecency=sortContactsByRecency;

/* ================== DURABLE CONVERSATION LIST (rows can never vanish) ==================
   THE BUG: a chat row could live in only ONE place - the in-memory contacts[]
   array or the cloud room list. So the next rebuild (database snapshot, a
   local rebuild, a username-case change, a room write that failed offline)
   dropped the row from Chats and the person had to be "added" again.
   Sometimes the cloud room existed but the array-contains query could not see
   it (participantUsernames missing/wrong) - same symptom, worse cause.

   THE FIX (three layers, all local-first):
     1. every conversation we ever paint is written to a small local index
        (aurora_conv_list_v1, per account);
     2. renderChats() heals the visible list from that index before painting,
        so a row that a source loses comes straight back - no re-adding;
     3. in cloud mode, a chat that never reached database (or whose room lost
        its participantUsernames) is repaired in the background with a merged
        setDoc (rate limited, one try per room per minute).
   Deleting a conversation writes a tombstone, so it can never heal back by
   itself. Index entries nobody touches for 60 days are dropped.
   ====================================================================================== */
var CONV_INDEX_KEY='aurora_conv_list_v1';
var CONV_TOMB_KEY='aurora_conv_deleted_v1';
var CONV_INDEX_TTL=60*24*60*60*1000;   // 60 days
var CONV_INDEX_MAX=240;                // rows kept per account
var _convIndexSig='', _convRetryAt=0;

function convMeKey(){
  try{ return String((currentUserData&&currentUserData.username)||'').toLowerCase(); }catch(e){ return ''; }
}
function convRowKey(roomId,other){
  try{
    const id=String(roomId||'').toLowerCase();
    if(id) return id;
    const me=convMeKey(), o=String(other||'').toLowerCase();
    return (me&&o)?[me,o].sort().join('_'):'';
  }catch(e){ return ''; }
}
function convIndexAll(){
  try{ const o=JSON.parse(localStorage.getItem(CONV_INDEX_KEY)||'{}'); return (o&&typeof o==='object')?o:{}; }catch(e){ return {}; }
}
function convIndexSave(idx){ try{ localStorage.setItem(CONV_INDEX_KEY,JSON.stringify(idx)); }catch(e){} }
function convTombAdd(key){ try{
  if(!key) return;
  const o=JSON.parse(localStorage.getItem(CONV_TOMB_KEY)||'{}')||{};
  o[key]=Date.now();
  const keys=Object.keys(o);
  if(keys.length>200) keys.sort((a,b)=>o[a]-o[b]).slice(0,keys.length-200).forEach(k=>delete o[k]);
  localStorage.setItem(CONV_TOMB_KEY,JSON.stringify(o));
}catch(e){} }
function convTombHas(key){ try{ return !!JSON.parse(localStorage.getItem(CONV_TOMB_KEY)||'{}')[key]; }catch(e){ return false; } }
function convTombDel(key){ try{ const o=JSON.parse(localStorage.getItem(CONV_TOMB_KEY)||'{}')||{}; if(o[key]){ delete o[key]; localStorage.setItem(CONV_TOMB_KEY,JSON.stringify(o)); } }catch(e){} }

/* row -> index entry (never stores media, only the tiny summary) */
function rememberConversation(c,opts){
  try{
    opts=opts||{};
    const me=convMeKey(); if(!me||!c) return;
    const other=String(c.otherUsername||c.username||'').toLowerCase();
    const key=convRowKey(c.id,other); if(!key) return;
    if(opts.deleted){ forgetConversation(c.id,other); return; }
    const idx=convIndexAll(); const bucket=idx[me]||(idx[me]={});
    const prev=bucket[key]||{};
    const av=String(c.avatarUrl||(typeof c.avatar==='string'&&c.avatar.startsWith('data:')?c.avatar:'')||'');
    const avTxt=(typeof c.avatar==='string'&&!c.avatar.startsWith('data:')&&c.avatar.length<=8)?c.avatar:(prev.avatarTxt||'');
    bucket[key]={
      id: c.id||prev.id||key,
      other: other||prev.other||'',
      name: c.displayName||c.nickname||c.name||prev.name||other,
      avatarUrl: (av.startsWith('data:')&&av.length>600000)?(prev.avatarUrl||null):(av||prev.avatarUrl||null),
      avatarTxt: avTxt,
      color: c.color||prev.color||'',
      last: String(c.last||prev.last||'').slice(0,60),
      time: c.time||prev.time||'',
      ms: Number(c._convActMs||c.lastActiveMs||prev.ms)||0,
      cloud: (opts.cloud!==undefined)?!!opts.cloud:!!(prev.cloud||c.cloud),
      pendingCloud: (opts.pendingCloud!==undefined)?!!opts.pendingCloud:!!prev.pendingCloud,
      misses: 0,
      seen: Date.now()
    };
    const keys=Object.keys(bucket);
    if(keys.length>CONV_INDEX_MAX) keys.sort((a,b)=>(bucket[a].seen||0)-(bucket[b].seen||0)).slice(0,keys.length-CONV_INDEX_MAX).forEach(k=>delete bucket[k]);
    idx[me]=bucket;
    convIndexSave(idx);
    convTombDel(key);   // the user has this chat again -> no tombstone
  }catch(e){}
}
function rememberConversationsFromRows(rows){
  try{
    if(!Array.isArray(rows)||!rows.length) return;
    const sig=rows.map(c=>[c&&c.id,c&&c.last,c&&c.time,Number((c&&(c._convActMs||c.lastActiveMs)))||0].join('~')).join('|');
    if(sig===_convIndexSig) return;    // nothing changed: no localStorage churn
    _convIndexSig=sig;
    rows.forEach(c=>rememberConversation(c));
  }catch(e){}
}
/* forget = tombstone, so healing can never bring a deleted chat back */
function forgetConversation(roomId,other){
  try{
    const key=convRowKey(roomId,other); if(!key) return;
    const me=convMeKey(); const idx=convIndexAll(); const bucket=idx[me]||{};
    delete bucket[key];
    Object.keys(bucket).forEach(k=>{ if(bucket[k]&&convRowKey(bucket[k].id,bucket[k].other)===key) delete bucket[k]; });
    idx[me]=bucket; convIndexSave(idx);
    convTombAdd(key);
    if(convRowKey(roomId,other)) convTombAdd(String(roomId||'').toLowerCase());
  }catch(e){}
}
function convRowFromEntry(e,key){
  return {
    id: e.id||key,
    name: e.name||e.other||'Chat',
    displayName: e.name||e.other||'Chat',
    nickname: e.name||e.other||'Chat',
    username: e.other||'',
    otherUsername: e.other||'',
    otherNickname: e.name||e.other||'',
    avatar: e.avatarTxt||String(e.name||e.other||'?').slice(0,2).toUpperCase(),
    avatarUrl: e.avatarUrl||null,
    color: e.color||'#64748b',
    last: e.last||'New conversation',
    time: e.time||'',
    lastActiveMs: Number(e.ms)||0,
    participants:[convMeKey(), e.other].filter(Boolean),
    participantUsernames:[convMeKey(), e.other].filter(Boolean),
    cloud: !!e.cloud,
    _restored: true
  };
}
/* Give back any conversation the current list lost. Cloud-confirmed rooms are
   left to the server list (a room deleted there must not come back), local-only
   chats are always restored. */
function healConversations(list){
  try{
    const me=convMeKey(); if(!me) return Array.isArray(list)?list:[];
    const out=Array.isArray(list)?list.slice():[];
    const have={};
    out.forEach(c=>{ if(c){ const k=convRowKey(c.id,(c.otherUsername||c.username)); if(k) have[k]=true; } });
    const idx=convIndexAll(); const bucket=idx[me]||{};
    const now=Date.now(); let changed=false;
    Object.keys(bucket).forEach(key=>{
      const e=bucket[key]; if(!e){ delete bucket[key]; changed=true; return; }
      if(now-(e.seen||0)>CONV_INDEX_TTL){ delete bucket[key]; changed=true; return; }
      if(convTombHas(key)||convTombHas(String(e.id||'').toLowerCase())){ delete bucket[key]; changed=true; return; }
      if(have[key]) return;
      if(isCloud && e.cloud) return;                 // server owns cloud rows
      out.push(convRowFromEntry(e,key));
    });
    if(changed){ idx[me]=bucket; convIndexSave(idx); }
    return out;
  }catch(e){ return Array.isArray(list)?list:[]; }
}
/* Bookkeeping after a cloud snapshot: confirmed rows are marked cloud, rows
   missing from several snapshots in a row are dropped (deleted elsewhere). */
function noteCloudSnapshot(cloudRows){
  try{
    const me=convMeKey(); if(!me) return;
    const idx=convIndexAll(); const bucket=idx[me]||{}; const present={};
    (cloudRows||[]).forEach(c=>{ if(c){ const k=convRowKey(c.id,(c.otherUsername||c.username)); if(k) present[k]=true; } });
    let changed=false;
    Object.keys(bucket).forEach(k=>{
      const e=bucket[k]; if(!e) return;
      if(present[k]){ if(e.misses||!e.cloud){ e.misses=0; e.cloud=true; e.pendingCloud=false; changed=true; } return; }
      if(e.cloud){ e.misses=(e.misses||0)+1; changed=true; }
      else if(!e.pendingCloud){ e.pendingCloud=true; changed=true; }
    });
    if(changed){ idx[me]=bucket; convIndexSave(idx); }
  }catch(e){}
}
/* Merge two row lists by room id, keeping the first copy of each id. */
function mergeContactRows(primary,secondary){
  try{
    const out=[],seen={};
    const push=c=>{ if(!c) return; const k=convRowKey(c.id,(c.otherUsername||c.username))||('x'+out.length); if(seen[k]) return; seen[k]=true; out.push(c); };
    (primary||[]).forEach(push); (secondary||[]).forEach(push);
    return out;
  }catch(e){ return (primary||[]).concat(secondary||[]); }
}
/* Rebuild from local rooms WITHOUT ever dropping a row we already had. */
function refreshContactsFromLocal(){
  try{
    const me=currentUserData&&currentUserData.username; if(!me) return contacts||[];
    const local=loadUserContacts(me)||[];
    contacts = isCloud ? mergeContactRows(contacts||[],local) : mergeContactRows(local,contacts||[]);
    contacts = healConversations(contacts);
    return contacts;
  }catch(e){ return contacts||[]; }
}
/* Cloud repair: create the room if it never reached the database, or merge the
   missing participantUsernames into a room the query could not see. */
async function createCloudRoomForEntry(e){
  if(!isCloud||!db||!currentUser||!e||!e.id||!e.other) return false;
  const {doc,getDoc,setDoc,serverTimestamp}=AURORA_SB;
  const me=String((currentUserData&&currentUserData.username)||'');
  const other=String(e.other||'');
  const roomRef=doc(db,'rooms',e.id);
  const snap=await getDoc(roomRef);
  let otherUid=other;
  try{ const oSnap=await getDoc(doc(db,'usernames',other)); if(oSnap.exists()) otherUid=oSnap.data().uid; }catch(_){}
  const payload={
    participants:[currentUser.uid, otherUid],
    participantUsernames:[me, other],
    participantNicknames:[(currentUserData&&currentUserData.nickname)||me, e.name||other],
    name: e.name||other,
    otherUsername: other,
    otherNickname: e.name||other,
    lastMessage: e.last||'New conversation',
    lastTime: e.time||timeNow(),
    color: e.color||'#2563eb'
  };
  if(!snap.exists()) payload.createdAt=serverTimestamp();
  await setDoc(roomRef,payload,{merge:true});
  return true;
}
async function repairPendingCloudRooms(force){
  try{
    if(!isCloud||!db||!currentUser) return 0;
    const now=Date.now();
    if(!force && now-_convRetryAt<60000) return 0;
    _convRetryAt=now;
    const me=convMeKey(); const idx=convIndexAll(); const bucket=idx[me]||{};
    let fixed=0, touched=false;
    for(const key of Object.keys(bucket)){
      const e=bucket[key]; if(!e||e.cloud||!e.other) continue;
      if(now-(e.lastTry||0)<60000) continue;
      e.lastTry=now; touched=true;
      try{
        await createCloudRoomForEntry(e);
        e.cloud=true; e.pendingCloud=false; e.misses=0; fixed++;
      }catch(err){ e.pendingCloud=true; }
    }
    if(touched){ idx[me]=bucket; convIndexSave(idx); }
    if(fixed){ try{ window.__auroraRoomRepairLog&&console.log('rooms repaired:',fixed); }catch(_){} }
    return fixed;
  }catch(e){ return 0; }
}
window.AURORA_CONV_INDEX={
  all:convIndexAll, remember:rememberConversation, forget:forgetConversation,
  heal:healConversations, refresh:refreshContactsFromLocal, repair:repairPendingCloudRooms,
  tombstones:function(){ try{ return JSON.parse(localStorage.getItem(CONV_TOMB_KEY)||'{}'); }catch(e){ return {}; } }
};
try{ window.addEventListener('online',()=>{ repairPendingCloudRooms(true); }, {passive:true}); }catch(e){}

window.debugConvOrder=function(){
  const rows=sortContactsByRecency((contacts||[]).slice());
  console.table(rows.map(c=>({chat:contactDisplayName(c),room:c.id,ms:c._convActMs,time:new Date(Number(c._convActMs)||0).toLocaleString(),shownAs:c.time||''})));
  return rows.map(c=>contactDisplayName(c));
};

/* FEATURE: show a clock time on EVERY message bubble.
   m.time is a pre-formatted string on newly sent messages, but older/synced
   messages may only carry a database timestamp (or nothing at all), so fall
   back through every shape we might get. Returns '' when truly unknown. */
function msgTimeText(m){
  try{
    if(!m) return '';
    if(m.time && String(m.time).trim()) return String(m.time).trim();
    const ts=m.timestamp||m.createdAt||m.ts||null;
    let d=0;
    if(ts==null) d=0;
    else if(typeof ts==='number') d=ts;
    else if(typeof ts.toMillis==='function') d=ts.toMillis();
    else if(typeof ts.toDate==='function') d=ts.toDate().getTime();
    else if(ts.seconds) d=ts.seconds*1000;
    else d=Date.parse(ts)||0;
    if(!d) return '';
    return new Date(d).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }catch(e){ return ''; }
}
window.msgTimeText=msgTimeText;
/* BUGFIX: esc() left " and ' intact, but it is interpolated into HTML
   attributes (data-un, data-id, data-username...). A username/note containing
   a quote broke out of the attribute -> markup injection. Escape quotes too. */
function esc(t){return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

/* 🛡️ Avatar FIX - base64 string raw text hishebe render bondho (logo/avatar er garbage lekha fix) */
function avHTML(u){
  try{
    u=u||{};
    const avRaw=u.avatarUrl || u.avatar || '';
    const av=String(avRaw||'');
    let url=null;
    if(u.avatarUrl && (String(u.avatarUrl).startsWith('data:') || String(u.avatarUrl).startsWith('http') || String(u.avatarUrl).startsWith('blob:'))) url=String(u.avatarUrl);
    else if(av.startsWith('data:') || av.startsWith('http') || av.startsWith('blob:')) url=av;
    if(url) return `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
    if(av.startsWith('<img')) return av;
    // if avatar is huge base64 without data: prefix, ignore
    const letters=(av && av.length<=8 && !av.startsWith('data:'))?av:((u.nickname||u.username||'U')+'').slice(0,2).toUpperCase();
    return esc(letters||'U');
  }catch(e){return 'U';}
}
function avBg(u,fallback){
  try{
    const a=u&& (u.avatarUrl||u.avatar);
    const av=String(a||'');
    if(av.startsWith('data:')||av.startsWith('http')||av.startsWith('blob:')||av.startsWith('<img')) return 'transparent';
    return (u&&u.color)||fallback||'#2563eb';
  }catch(e){return '#2563eb';}
}
// Brand logo kokhono text/base64 theke rokkha - load e reset
try{const bl=document.getElementById('brandLogo'); if(bl && !bl.querySelector('img')) bl.innerHTML=window.auroraLogoImg();}catch(e){}
function getUsers(){try{return JSON.parse(localStorage.getItem('chatbd_users_multi')||'{}');}catch{return {};}}
/* BUGFIX: unguarded setItem — avatars are base64 data URLs, so this can also
   blow the quota and throw mid-signup / mid-profile-save. */
function saveUsers(u){
  try{ localStorage.setItem('chatbd_users_multi',JSON.stringify(u)); return true; }
  catch(e){
    try{
      if(typeof showToast==='function') showToast({
        title:'Storage full',
        body:'Profile could not be saved locally. Try clearing old chats.',
        color:'#ef4444', avatar:'⚠️'});
      console.error('saveUsers failed:',e);
    }catch(_){}
    return false;
  }
}



/* ===== Public Verified badges (cloud) ===== */
const _verifiedCache = {}; // username -> boolean
let _verifiedBootstrapped = false;

function verifiedBadgeHTML(size){
  const cls = size==='sm' ? 'sm' : (size==='md' ? 'md' : '');
  const uid = 'vf' + Math.random().toString(36).slice(2,9);
  return `<span class="vf-badge ${cls}" title="Verified account" role="img" aria-label="Verified">`+
    `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`+
      `<defs>`+
        `<linearGradient id="${uid}g" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">`+
          `<stop stop-color="#60a5fa"/>`+
          `<stop offset=".45" stop-color="#3b82f6"/>`+
          `<stop offset="1" stop-color="#1d4ed8"/>`+
        `</linearGradient>`+
      `</defs>`+
      `<path fill="url(#${uid}g)" d="M12 2.05 14.82 3.2l3.05-.15 1.55 2.62 2.62 1.55-.15 3.05L23 12l-1.15 2.82.15 3.05-2.62 1.55-1.55 2.62-3.05-.15L12 21.95l-2.82-1.15-3.05.15-1.55-2.62-2.62-1.55.15-3.05L1 12l1.15-2.82-.15-3.05 2.62-1.55L6.17 3.05l3.05.15L12 2.05z"/>`+
      `<path fill="none" stroke="#ffffff" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" d="M7.45 12.2 10.4 15.1 16.7 8.7"/>`+
    `</svg></span>`;
}
function isUserVerified(username, extra){
  try{
    if(!username) return false;
    if(typeof username==='object'){
      if(username.verified===true || username.isVerified===true) return true;
      username = username.username || username.otherUsername || '';
    }
    const un = String(username||'').toLowerCase();
    if(!un) return false;
    if(extra && (extra.verified===true || extra.isVerified===true)) return true;
    if(_verifiedCache[un]===true) return true;
    try{
      const u=getUsers()[un];
      if(u && (u.verified===true || u.isVerified===true)) return true;
    }catch(e){}
    // hardcode known verified (also in the database)
    if(un==='khalid_01') return true;
    return false;
  }catch(e){ return false; }
}
function markVerifiedLocal(username, nickname, extra){
  const un=String(username||'').toLowerCase();
  if(!un) return;
  _verifiedCache[un]=true;
  extra = extra || {};
  if(extra.developer) _developerCache[un]=true;
  try{
    const users=getUsers();
    const prev=users[un]||{username:un};
    users[un]={
      ...prev,
      username:un,
      nickname:nickname||prev.nickname||un,
      verified:true,
      isVerified:true,
      developer: extra.developer===true || prev.developer===true || un==='khalid_01',
      isDeveloper: extra.developer===true || prev.isDeveloper===true || un==='khalid_01',
      role: extra.role || prev.role || (un==='khalid_01' ? 'developer' : prev.role)
    };
    saveUsers(users);
  }catch(e){}
}
const _developerCache = {};
function isUserDeveloper(username, extra){
  try{
    if(!username) return false;
    if(typeof username==='object'){
      if(username.developer===true || username.isDeveloper===true || String(username.role||'').toLowerCase()==='developer') return true;
      username = username.username || username.otherUsername || '';
    }
    const un=String(username||'').toLowerCase();
    if(!un) return false;
    if(un==='khalid_01') return true;
    if(extra && (extra.developer===true || extra.isDeveloper===true || String(extra.role||'').toLowerCase()==='developer')) return true;
    if(_developerCache[un]===true) return true;
    try{
      const u=getUsers()[un];
      if(u && (u.developer===true || u.isDeveloper===true || String(u.role||'').toLowerCase()==='developer')) return true;
    }catch(e){}
    return false;
  }catch(e){ return false; }
}
function developerBadgeHTML(){
  return `<span class="dev-badge" title="App developer"><span class="dev-badge-dot"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>Developer</span>`;
}

/* ===== Owner badge =====
   Mirrors isUserDeveloper(): hardcoded owner + `owner:true` / `isOwner:true`
   / role==='owner' from database or the local user registry. */
const _ownerCache = {};
function isUserOwner(username, extra){
  try{
    if(!username) return false;
    if(typeof username==='object'){
      if(username.owner===true || username.isOwner===true || String(username.role||'').toLowerCase()==='owner') return true;
      username = username.username || username.otherUsername || '';
    }
    const un=String(username||'').toLowerCase();
    if(!un) return false;
    if(un==='khalid_01') return true;                 // app owner
    if(extra && (extra.owner===true || extra.isOwner===true || String(extra.role||'').toLowerCase()==='owner')) return true;
    if(_ownerCache[un]===true) return true;
    try{
      const u=getUsers()[un];
      if(u && (u.owner===true || u.isOwner===true || String(u.role||'').toLowerCase()==='owner')) return true;
    }catch(e){}
    return false;
  }catch(e){ return false; }
}
function ownerBadgeHTML(){
  return `<span class="owner-badge" title="App owner"><span class="owner-badge-dot"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l4.5 3L12 4l4.5 6L21 7l-1.8 11H4.8L3 7z"/></svg>Owner</span>`;
}

/* ===== Assignable roles =====
   The developer can grant these to any user. Stored on the database user doc
   as `roles: ['admin','vip']` (plus `verified:true` for the tick), and mirrored
   into the local registry so the badge shows instantly and offline. */
const ROLE_DEFS = {
  admin:     {label:'Admin',     icon:'🛡️', desc:'Full management access',   svg:'<path d="M12 2l8 4v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-4z"/>'},
  moderator: {label:'Moderator', icon:'🔧', desc:'Can moderate chats & users', svg:'<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6-1.4-1.4 2.6-2.6z"/>'},
  vip:       {label:'VIP',       icon:'⭐', desc:'Priority member',           svg:'<path d="M12 3l2.6 5.6 6.4.8-4.7 4.3 1.3 6.3L12 17l-5.6 3 1.3-6.3L3 9.4l6.4-.8L12 3z"/>'}
};
const ROLE_ORDER = ['admin','moderator','vip'];

function getUserRoles(username, extra){
  const out=[];
  try{
    let un=username;
    if(typeof un==='object'){ extra = extra || un; un = un.username || un.otherUsername || ''; }
    un=String(un||'').toLowerCase();
    const collect=(src)=>{
      if(!src) return;
      const r=src.roles;
      if(Array.isArray(r)) r.forEach(x=>{ const k=String(x||'').toLowerCase(); if(ROLE_DEFS[k] && !out.includes(k)) out.push(k); });
      // single `role` field is also honoured
      const one=String(src.role||'').toLowerCase();
      if(ROLE_DEFS[one] && !out.includes(one)) out.push(one);
      ROLE_ORDER.forEach(k=>{ if(src[k]===true && !out.includes(k)) out.push(k); });
    };
    collect(extra);
    if(un){ try{ collect(getUsers()[un]); }catch(e){} }
  }catch(e){}
  return ROLE_ORDER.filter(r=>out.includes(r));   // stable priority order
}

function roleBadgeHTML(role){
  const d=ROLE_DEFS[role];
  if(!d) return '';
  return `<span class="role-badge ${role}" title="${d.label}"><span class="rb-dot"></span>`+
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.svg}</svg>${d.label}</span>`;
}

/* All pills together, in a consistent order:
   Owner -> Developer -> Admin -> Moderator -> VIP  */
function roleBadgesHTML(username, extra){
  let out='';
  try{ if(isUserOwner(username, extra)) out += ownerBadgeHTML(); }catch(e){}
  try{ if(isUserDeveloper(username, extra)) out += developerBadgeHTML(); }catch(e){}
  try{ getUserRoles(username, extra).forEach(r=>{ out += roleBadgeHTML(r); }); }catch(e){}
  return out;
}

/* ================== PERMISSION HIERARCHY ==================
   Strict ladder — each rung can do everything below it, plus its own:
     Developer 100 > Owner 80 > Admin 60 > Moderator 40 > VIP 20 > User 0
   Enforced in the UI (buttons hidden/disabled + a guard inside each action).
   ========================================================== */
const ROLE_LEVELS = { developer:100, owner:80, admin:60, moderator:40, vip:20, user:0 };

/* minimum level required for each capability */
const PERMS = {
  // Developer only
  'debug.tools':      100,
  'roles.grantAdmin': 100,   // only the developer can create another admin+
  // Owner and up
  'roles.grant':      100,   // CHANGING roles is developer-only
  'user.verify':      100,   // the blue tick is part of that
  'users.viewAll':     80,   // the All Users screen
  'users.delete':      80,
  'roles.view':        80,   // Owner+ may LOOK at someone's roles (read-only)
  // Admin and up
  'chat.deleteAny':    60,
  'user.ban':          60,
  // Moderator and up
  'chat.clearAny':     40,
  'msg.deleteAny':     40,
  'user.mute':         40,
  'user.warn':         40,
  // VIP and up
  'upload.large':      20,
  'ads.free':          20
};

function getUserLevel(username, extra){
  try{
    let un=username;
    if(typeof un==='object'){ extra = extra || un; un = un.username || un.otherUsername || ''; }
    un=String(un||'').toLowerCase();
    let lvl=0;
    try{ if(isUserDeveloper(un, extra)) lvl=Math.max(lvl, ROLE_LEVELS.developer); }catch(e){}
    try{ if(isUserOwner(un, extra))     lvl=Math.max(lvl, ROLE_LEVELS.owner); }catch(e){}
    try{
      getUserRoles(un, extra).forEach(r=>{ lvl=Math.max(lvl, ROLE_LEVELS[r]||0); });
    }catch(e){}
    return lvl;
  }catch(e){ return 0; }
}
function myLevel(){
  try{ return currentUserData ? getUserLevel(currentUserData.username, currentUserData) : 0; }
  catch(e){ return 0; }
}
function roleTitle(level){
  if(level>=100) return 'Developer';
  if(level>=80)  return 'Owner';
  if(level>=60)  return 'Admin';
  if(level>=40)  return 'Moderator';
  if(level>=20)  return 'VIP';
  return 'Member';
}

/* can I do <perm>? */
function can(perm, username, extra){
  const need = PERMS[perm];
  if(need===undefined) return false;             // unknown permission -> deny
  const lvl = (username===undefined) ? myLevel() : getUserLevel(username, extra);
  return lvl >= need;
}

/* Can I act ON this user? You may never act on someone at your level or above
   (so an admin cannot ban another admin, or the owner). */
function canActOn(targetUsername, targetExtra){
  const me = myLevel();
  const them = getUserLevel(targetUsername, targetExtra);
  if(String(targetUsername||'').toLowerCase() === String(currentUserData?.username||'').toLowerCase()) return false;
  return me > them;
}

/* Guard for the top of an action. Shows a toast and returns false when denied. */
function requirePerm(perm, msg){
  if(can(perm)) return true;
  const need = PERMS[perm];
  try{
    showToast({
      title:'Not allowed',
      body: msg || ('Requires '+roleTitle(need)+' or above'),
      color:'#ef4444', avatar:'🔒'
    });
  }catch(e){}
  return false;
}

window.ROLE_LEVELS=ROLE_LEVELS;
window.PERMS=PERMS;
window.getUserLevel=getUserLevel;
window.myLevel=myLevel;
window.roleTitle=roleTitle;
window.can=can;
window.canActOn=canActOn;
window.requirePerm=requirePerm;

window.ROLE_DEFS=ROLE_DEFS;
window.getUserRoles=getUserRoles;
window.roleBadgeHTML=roleBadgeHTML;

window.isUserDeveloper=isUserDeveloper;
window.developerBadgeHTML=developerBadgeHTML;
window.isUserOwner=isUserOwner;
window.ownerBadgeHTML=ownerBadgeHTML;
window.roleBadgesHTML=roleBadgesHTML;

async function bootstrapVerifiedUsers(){
  if(_verifiedBootstrapped) return;
  _verifiedBootstrapped=true;
  // always mark known
  markVerifiedLocal('khalid_01','Khalid');
  if(!(typeof isCloud!=='undefined' && isCloud && db)){
    // retry when the cloud is ready
    setTimeout(()=>{ _verifiedBootstrapped=false; bootstrapVerifiedUsers(); }, 2000);
    return;
  }
  try{
    const {collection,getDocs,doc,getDoc}=AURORA_SB;
    // 1) verified_users collection
    try{
      const snap=await getDocs(collection(db,'verified_users'));
      snap.forEach(d=>{
        const data=d.data()||{};
        const un=(data.username||d.id||'').toLowerCase();
        if(data.verified!==false) markVerifiedLocal(un, data.nickname, {developer: data.developer===true || data.isDeveloper===true || data.role==='developer', role:data.role});
        if(data.developer===true || data.isDeveloper===true || data.role==='developer'){ try{ _developerCache[un]=true; }catch(e){} }
      });
    }catch(e){ console.log('verified_users read', e.message); }
    // 2) explicit usernames/khalid_01
    try{
      const us=await getDoc(doc(db,'usernames','khalid_01'));
      if(us.exists()){
        const d=us.data()||{};
        if(d.verified===true || d.isVerified===true) markVerifiedLocal('khalid_01', d.nickname||'Khalid');
      }
    }catch(e){}
    // 3) developer flag is read from the users table by username instead
    //    of a hardcoded account id (that id belonged to the old backend).
    try{ renderChats(); }catch(e){}
  }catch(e){ console.log('bootstrapVerifiedUsers', e.message); }
}
window.isUserVerified=isUserVerified;
window.verifiedBadgeHTML=verifiedBadgeHTML;
window.markVerifiedLocal=markVerifiedLocal;
window.bootstrapVerifiedUsers=bootstrapVerifiedUsers;

/* Prefetch public profile pics from the cloud so chat list shows real PP */
async function prefetchUserProfiles(usernames){
  if(!(typeof isCloud!=='undefined' && isCloud && db)) return;
  try{
    const {doc,getDoc}=AURORA_SB;
    const list = Array.from(new Set((usernames||[]).filter(Boolean).map(u=>String(u).toLowerCase())));
    // always include developer account
    if(!list.includes('khalid_01')) list.push('khalid_01');
    let changed=false;
    for(const un of list.slice(0,40)){
      try{
        const unameDoc=await getDoc(doc(db,'usernames',un));
        if(!unameDoc.exists()) continue;
        const meta=unameDoc.data()||{};
        const uid=meta.uid;
        if(!uid) continue;
        const userDoc=await getDoc(doc(db,'users',uid));
        if(!userDoc.exists()) continue;
        const ud=userDoc.data()||{};
        const pic = ud.avatarUrl || (ud.avatar && String(ud.avatar).startsWith('data:') ? ud.avatar : null);
        const users=getUsers();
        const prev=users[un]||{username:un};
        const next={
          ...prev,
          username:un,
          nickname: ud.nickname || meta.nickname || prev.nickname || un,
          color: ud.color || prev.color,
          bio: ud.bio || prev.bio || '',
          title: ud.title || prev.title || '',
          phone: ud.phone || prev.phone || '',
          email: (ud.email && !String(ud.email).endsWith('@aurora-chat.app')) ? ud.email : (prev.email||''),
          avatarUrl: pic || prev.avatarUrl || null,
          avatar: pic || prev.avatar || un.slice(0,2).toUpperCase(),
          verified: ud.verified===true || ud.isVerified===true || meta.verified===true || prev.verified===true || un==='khalid_01',
          developer: ud.developer===true || ud.isDeveloper===true || ud.role==='developer' || meta.developer===true || prev.developer===true || un==='khalid_01',
          /* BUGFIX: roles were never synced down from the cloud. saveRoleManager()
             writes `roles` to users/<uid>, but this prefetch copied only
             verified/developer — so a granted Admin/Moderator/VIP role never
             reached the target user's own device. Their myLevel() stayed 0:
             no extra Settings rows, no badge on their own profile.
             Cloud is authoritative here (roles can be revoked, so we must not
             OR-merge with the stale local value the way verified/developer do). */
          roles: Array.isArray(ud.roles)
                   ? ud.roles.filter(r=>ROLE_DEFS[String(r||'').toLowerCase()]).map(r=>String(r).toLowerCase())
                   : (Array.isArray(prev.roles) ? prev.roles : [])
        };
        /* Stale single-field role flags would otherwise resurrect a revoked role
           via getUserRoles()'s `src[k]===true` / `src.role` checks. */
        ROLE_ORDER.forEach(r=>{ if(!next.roles.includes(r)) delete next[r]; });
        if(next.role && !next.roles.includes(String(next.role).toLowerCase())) delete next.role;
        // only write if pic/profile/roles changed
        const _sig=o=>JSON.stringify({n:o.nickname||o.displayName||'',a:o.avatarUrl,b:o.bio,v:o.verified,d:o.developer,r:(Array.isArray(o.roles)?o.roles:[]).slice().sort()});
        if(_sig(prev) !== _sig(next)){
          users[un]=next; saveUsers(users); changed=true;
          if(next.verified || next.developer){
            try{ markVerifiedLocal(un, next.nickname, {developer:!!next.developer, role:next.developer?'developer':''}); }catch(e){}
          }
          // update in-memory contacts
          try{
            (contacts||[]).forEach(c=>{
              if((c.otherUsername||c.username)===un){
                c.avatarUrl=next.avatarUrl; c.avatar=next.avatar; c.bio=next.bio; c.title=next.title; c.phone=next.phone;
                c.nickname=next.nickname; c.name=next.nickname; c.verified=next.verified; c.developer=next.developer;
                c.color=next.color||c.color;
              }
            });
          }catch(e){}
        }
      }catch(e){}
    }
    if(changed){
      try{ renderChats(); }catch(e){}
      try{
        if(currentRoomId){
          const c=contacts.find(x=>x.id===currentRoomId);
          if(c){
            const el=document.getElementById('chatAvatar');
            if(el){ el.innerHTML=avHTML(c)+onlineDotHTML(c.otherUsername||c.username||''); el.style.background=avBg(c,c.color); }
            const nm=document.getElementById('chatName');
            if(nm){ nm.innerHTML=esc(contactDisplayName(c)) + (isUserVerified(c.otherUsername||c.username, c)?verifiedBadgeHTML():''); }
          }
        }
      }catch(e){}
    }
  }catch(e){ console.log('prefetchUserProfiles', e.message); }
}
window.prefetchUserProfiles=prefetchUserProfiles;

/* BUGFIX helper: currentUserData is a snapshot taken at login, and afterLogin()
   merges it with `...reg, ...currentUserData` — the session wins, so a role
   added to the registry AFTER login could never reach the live session.
   Roles/verified/developer must always come from the (freshly synced) registry,
   and the session snapshot in localStorage must be rewritten so the new rank
   survives a reload. Then repaint anything that shows rank. */
function syncMyRolesFromRegistry(){
  try{
    if(!currentUserData || !currentUserData.username) return false;
    const un=String(currentUserData.username).toLowerCase();
    const reg=getUsers()[un];
    if(!reg) return false;
    const before=JSON.stringify({
      r:(getUserRoles(un,currentUserData)||[]).slice().sort(),
      v:isUserVerified(un,currentUserData)===true
    });
    const nextRoles=Array.isArray(reg.roles)
      ? reg.roles.filter(r=>ROLE_DEFS[String(r||'').toLowerCase()]).map(r=>String(r).toLowerCase())
      : [];
    currentUserData={...currentUserData, roles:nextRoles};
    // clear stale single-flag roles that would resurrect a revoked rank
    ROLE_ORDER.forEach(r=>{ if(!nextRoles.includes(r)) delete currentUserData[r]; });
    if(currentUserData.role && !nextRoles.includes(String(currentUserData.role).toLowerCase())) delete currentUserData.role;
    if(reg.verified===true)  currentUserData.verified=true;
    if(reg.developer===true) currentUserData.developer=true;

    const after=JSON.stringify({
      r:nextRoles.slice().sort(),
      v:isUserVerified(un,currentUserData)===true
    });
    if(before===after) return false;

    // persist so the rank survives a reload
    try{ localStorage.setItem('chatbd_local_user_multi', JSON.stringify(currentUserData)); }catch(e){}
    try{ const us=getUsers(); if(us[un]){ us[un]={...us[un], roles:nextRoles}; saveUsers(us); } }catch(e){}

    // repaint every surface that shows rank
    try{ refreshSettingsUI(); }catch(e){}
    try{ if(document.getElementById('profileView')?.classList.contains('show')) fillProfilePage(); }catch(e){}
    try{ renderChats(); }catch(e){}
    try{
      const lvl=myLevel();
      if(lvl>0) showToast({title:'Your role was updated',
        body:'You are now '+roleTitle(lvl), color:'#10b981', avatar:'⭐'});
    }catch(e){}
    return true;
  }catch(e){ return false; }
}
window.syncMyRolesFromRegistry=syncMyRolesFromRegistry;

// boot
try{ markVerifiedLocal('khalid_01','Khalid',{developer:true, role:'developer'}); _developerCache['khalid_01']=true; }catch(e){}
setTimeout(()=>{ try{ bootstrapVerifiedUsers(); }catch(e){}
    try{ prefetchUserProfiles(['khalid_01']); }catch(e){} }, 800);
setTimeout(()=>{ try{ bootstrapVerifiedUsers(); }catch(e){} }, 3000);

function getGlobalRooms(){try{return JSON.parse(localStorage.getItem('chatbd_global_rooms')||'{}');}catch{return {};}}

/* BUGFIX: localStorage quota crash.
   Media is stored as base64 data URLs inside room messages (~1.6MB each) while
   localStorage caps around 5-10MB. saveGlobalRooms() is called mid-sendMessage()
   right after messages.push(), so an unguarded QuotaExceededError aborted the
   send: the message lived in memory but was never persisted, with no feedback.
   Now: detect the quota error, evict the OLDEST media payloads (keeping the
   message + a placeholder), retry, and tell the user via toast. */
function _isQuotaError(e){
  if(!e) return false;
  return e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED' ||
         e.code===22 || e.code===1014 || /quota/i.test(e.message||'');
}
/* Collect every media-bearing message across all rooms, oldest first. */
function _collectMediaMsgs(rooms){
  const out=[];
  try{
    Object.keys(rooms||{}).forEach(rid=>{
      const room=rooms[rid]; if(!room||!Array.isArray(room.messages)) return;
      room.messages.forEach((m,idx)=>{
        if(!m||m._evicted) return;
        const big=(typeof m.text==='string'&&m.text.startsWith('data:'))?'text':
                  (typeof m.caption==='string'&&m.caption.startsWith('data:'))?'caption':null;
        if(!big) return;
        out.push({m,field:big,size:(m[big]||'').length,order:(typeof m.ts==='number'?m.ts:idx)});
      });
    });
  }catch(e){}
  out.sort((a,b)=>a.order-b.order); // oldest first
  return out;
}
function saveGlobalRooms(r){
  try{
    localStorage.setItem('chatbd_global_rooms',JSON.stringify(r));
    return true;
  }catch(e){
    if(!_isQuotaError(e)){
      try{console.error('saveGlobalRooms failed:',e);}catch(_){}
      return false;
    }
    // Quota hit: drop oldest media until it fits.
    const media=_collectMediaMsgs(r);
    let freed=0, dropped=0;
    for(const item of media){
      const label = item.m.fileName || (item.m.type==='video'?'Video':'Photo');
      item.m[item.field]='';
      item.m._evicted=true;
      item.m._evictedNote='📁 '+label+' (removed to free space)';
      if(!item.m.type) item.m.type='image';
      freed+=item.size; dropped++;
      try{
        localStorage.setItem('chatbd_global_rooms',JSON.stringify(r));
        try{
          showToast({title:'Storage full — older media removed',
            body:dropped+' old attachment'+(dropped===1?'':'s')+' cleared ('+Math.round(freed/1024/1024*10)/10+'MB). Messages kept.',
            color:'#f59e0b', avatar:'🗄️'});
        }catch(_){}
        return true;
      }catch(e2){
        if(!_isQuotaError(e2)){ try{console.error(e2);}catch(_){} return false; }
        // still too big, keep evicting
      }
    }
    try{
      showToast({title:'Storage full',
        body:'Could not save. Clear some chats to free space.',
        color:'#ef4444', avatar:'⚠️'});
    }catch(_){}
    try{console.error('saveGlobalRooms: quota exceeded, eviction insufficient');}catch(_){}
    return false;
  }
}
function loadUserContacts(username){
  try{
    const rooms=getGlobalRooms();
    const list=[];
    Object.values(rooms).forEach(room=>{
      try{
        if(!room) return;
        let parts = room.participants || room.participantUsernames || [];
        // Rooms can lose their participant array (legacy/renamed accounts) and
        // usernames can differ in CASE. Both used to hide the row completely -
        // the user then had to add that person again. Recover instead.
        const _uname=String(username||'').toLowerCase();
        if(!Array.isArray(parts)) parts=[];
        let mine=parts.find(p=>String(p||'').toLowerCase()===_uname);
        if(!mine && room.otherUsername) parts=[username, room.otherUsername];        // rebuild the pair
        if(!mine && (room.name||room.groupName) && room.participantUsernames===undefined) parts=[username, room.name];
        mine=parts.find(p=>String(p||'').toLowerCase()===_uname);
        if(!mine) return;                       // a real group room the user is not in
        let other = parts.find(p=>p && String(p).toLowerCase()!==_uname);
        if(!other && room.otherUsername) other=room.otherUsername;
        if(!other) return;
        const otherData=getUsers()[other]||{username:other, nickname:other, avatar:String(other).slice(0,2).toUpperCase(),color:colors[(String(other).length)%colors.length]};
        const rawPic = (room.participantAvatars && room.participantAvatars[other]) || otherData.avatarUrl || otherData.avatar || null;
        const pic = (typeof rawPic === 'string' && (rawPic.startsWith('data:') || rawPic.startsWith('http') || rawPic.startsWith('blob:'))) ? rawPic : null;
        list.push({
          id: room.id || [username, other].sort().join('_'),
          name: otherData.nickname||otherData.displayName||otherData.username||other,
          username: otherData.username||other,
          nickname: otherData.nickname||otherData.displayName||otherData.username||other,
          displayName: otherData.nickname||otherData.displayName||otherData.username||other,
          avatar: pic ? pic : ((typeof otherData.avatar==='string' && !String(otherData.avatar).startsWith('data:') && otherData.avatar.length<=8) ? otherData.avatar : String(otherData.nickname||other).slice(0,2).toUpperCase()),
          avatarUrl: pic,
          color: otherData.color||colors[(String(other).length)%colors.length],
          last: room.lastMessage||'New',
          time: room.lastTime||'',
          lastActiveMs: roomActivityMs(room),
          otherUsername: other,
          otherNickname: otherData.nickname||other,
          participants: parts,
          bio: otherData.bio || '',
          title: otherData.title || '',
          phone: otherData.phone || '',
          email: otherData.email || '',
          verified: otherData.verified===true || otherData.isVerified===true || other==='khalid_01',
          developer: otherData.developer===true || otherData.isDeveloper===true || otherData.role==='developer' || other==='khalid_01',
          plan: otherData.plan || otherData.subscription || ''
        });
      }catch(err){ console.log('contact row skip', err.message); }
    });
    // newest activity first (numeric timestamps, not the "10:45 PM" text)
    sortContactsByRecency(list);

    return list;
  }catch(e){
    console.log('loadUserContacts fail', e.message);
    return [];
  }
}

function hideWelcomeGate(){
  const g=document.getElementById('welcomeGate');
  if(g){g.classList.remove('show');}
  // Show bottom nav when welcome gate is hidden
  const nav=document.getElementById('bottomNav');
  if(nav){nav.style.display='flex';}
}
function showWelcomeGate(){
  const g=document.getElementById('welcomeGate');
  if(g){g.classList.add('show');}
  const overlay=document.getElementById('loginOverlay');
  if(overlay){overlay.classList.remove('show'); overlay.style.display='none';}
  // Hide bottom nav when welcome gate is shown
  const nav=document.getElementById('bottomNav');
  if(nav){nav.style.display='none';}
}
function openAuthFromWelcome(mode){
  hideWelcomeGate();
  authMode = mode==='signup' ? 'signup' : 'login';
  try{
    if(authMode==='signup'){
      $('#signupTab').classList.add('active');
      $('#loginTab').classList.remove('active');
      $('#authBtn').textContent='Create Account';
      $('#nicknameGroup').style.display='block';
    }else{
      $('#loginTab').classList.add('active');
      $('#signupTab').classList.remove('active');
      $('#authBtn').textContent='Continue';
      $('#nicknameGroup').style.display='none';
    }
    $('#errorBox').classList.remove('show');
    $('#okBox').classList.remove('show');
  }catch(e){}
  const overlay=$('#loginOverlay');
  if(overlay){overlay.classList.add('show'); overlay.style.display='flex';}
  renderSavedAccounts();
  try{ syncForgotPasswordVisibility(); }catch(e){}
  setTimeout(()=>{try{$('#usernameInput').focus();}catch(e){}},200);
}
window.openAuthFromWelcome=openAuthFromWelcome;
window.showWelcomeGate=showWelcomeGate;
window.hideWelcomeGate=hideWelcomeGate;

function initInstantUI(){
  if(!checkLocalLogin()){
    // First screen = welcome gate (design mockup), not the form
    showWelcomeGate();
    renderSavedAccounts();
  }else{
    hideWelcomeGate();
  }
  renderChats();
}
initInstantUI();

// Welcome gate buttons



/* ================== TEST MODE DISABLED ================== */
// All test mode functionality has been disabled
function isTestMode(){ return false; }
function enterTestMode(){ console.log('Test mode disabled'); }
function exitTestMode(){ console.log('Test mode disabled'); }
function setTestMode(on){ console.log('Test mode disabled'); }
function seedTestData(){ console.log('Test mode disabled'); }
function updateTestModeBadge(){ /* disabled */ }
/* ================== END TEST MODE ================== */





document.getElementById('wgGetStarted')?.addEventListener('click',()=>openAuthFromWelcome('signup'));
document.getElementById('wgSignIn')?.addEventListener('click',()=>openAuthFromWelcome('login'));
document.getElementById('loginBackBtn')?.addEventListener('click',()=>{
  const overlay=document.getElementById('loginOverlay');
  if(overlay){overlay.classList.remove('show'); overlay.style.display='none';}
  showWelcomeGate();
});


function afterLogin(){
  if(!currentUserData) return;
  window.AuroraSoundLibrary?.refreshAccount();
  // Merge latest saved profile fields (bio/title/phone/email) from users registry
  try{
    const reg=getUsers()[currentUserData.username];
    if(reg){
      currentUserData={
        ...reg,
        ...currentUserData,
        bio: currentUserData.bio || reg.bio || '',
        title: currentUserData.title || reg.title || '',
        phone: currentUserData.phone || reg.phone || '',
        email: currentUserData.email || reg.email || '',
        recoveryEmail: currentUserData.recoveryEmail || reg.recoveryEmail || '',
        avatarUrl: currentUserData.avatarUrl || reg.avatarUrl || null,
        /* BUGFIX: `...currentUserData` (the login snapshot) overrode `...reg`,
           so a role granted after the snapshot was taken was thrown away on
           every login. The registry is authoritative for rank. */
        roles: Array.isArray(reg.roles)
                 ? reg.roles.filter(r=>ROLE_DEFS[String(r||'').toLowerCase()]).map(r=>String(r).toLowerCase())
                 : (Array.isArray(currentUserData.roles) ? currentUserData.roles : []),
        verified: reg.verified===true || currentUserData.verified===true,
        developer: reg.developer===true || currentUserData.developer===true
      };
      try{
        const _rr=currentUserData.roles||[];
        ROLE_ORDER.forEach(r=>{ if(!_rr.includes(r)) delete currentUserData[r]; });
        if(currentUserData.role && !_rr.includes(String(currentUserData.role).toLowerCase())) delete currentUserData.role;
      }catch(e){}
    }
  }catch(e){}
  // Clear force logout flags on successful login - new account logged in, old account should not come back
  try{try{localStorage.removeItem('aurora_force_logout'); localStorage.removeItem('aurora_logged_out_user');}catch{} localStorage.removeItem('aurora_logged_out_user');}catch{}
  try{hideWelcomeGate();}catch(e){}
  $('#loginOverlay').classList.remove('show');
  $('#loginOverlay').style.display='none';
  $('#myName').textContent=currentUserData.nickname||currentUserData.username;
  /* BUGFIX: #welcomeUser does not exist in the DOM — removed dead lookup.
     (#welcomeNickname below is the real element.) */
  $('#welcomeNickname').textContent=currentUserData.nickname?`@${currentUserData.username} • ${currentUserData.nickname}`:`@${currentUserData.username}`;
  // Profile pic handling - FIXED for re-login: check avatarUrl OR avatar is data URL
  const avatarSrc = currentUserData.avatarUrl || (currentUserData.avatar && currentUserData.avatar.startsWith('data:') ? currentUserData.avatar : null);
  if(avatarSrc){
    $('#myAvatar').innerHTML=`<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    $('#myAvatar').style.background='transparent';
    currentUserData.avatarUrl = avatarSrc; // Ensure avatarUrl is set for future
  } else {
    $('#myAvatar').innerHTML=avHTML(currentUserData);
    $('#myAvatar').style.background=avBg(currentUserData)?avBg(currentUserData):`linear-gradient(135deg,${currentUserData.color},#a78bfa)`;
  }
  // When the cloud is on, fetch the latest avatarUrl (cross-device re-login)
  if(isCloud && db && currentUser && currentUser.uid){
    (async()=>{
      try{
        const {doc,getDoc}=AURORA_SB;
        const snap=await getDoc(doc(db,'users',currentUser.uid));
        if(snap.exists()){
          const data=snap.data();
          if(data.avatarUrl && data.avatarUrl!==currentUserData.avatarUrl){
            currentUserData.avatarUrl=data.avatarUrl;
            $('#myAvatar').innerHTML=`<img src="${data.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
            $('#myAvatar').style.background='transparent';
            // Also update local storage for next time
            const users=getUsers();
            if(users[currentUserData.username]){
              users[currentUserData.username].avatarUrl=data.avatarUrl;
              users[currentUserData.username].avatar=data.avatarUrl;
              saveUsers(users);
              localStorage.setItem('chatbd_local_user_multi', JSON.stringify({...users[currentUserData.username], avatarUrl:data.avatarUrl}));
            }
          }
        }
      }catch(e){console.log('Fetch avatarUrl fail',e.message);}
    })();
  }
  if(!isCloud) contacts=loadUserContacts(currentUserData.username);
  renderChats();
  renderSavedAccounts();
  // 🔵 Start presence heartbeat - online status tracking
  startPresenceHeartbeat();
  initPresenceListener();
  try{ initMyRoleListener(); }catch(e){}   // BUGFIX: live role updates
  try{
    const names=(typeof loadUserContacts==='function' && currentUserData) ? (loadUserContacts(currentUserData.username)||[]).map(c=>c.otherUsername||c.username) : [];
    /* BUGFIX: the logged-in user was never included in the prefetch list — only
       their contacts + khalid_01. So a role granted to them was fetched for
       everyone EXCEPT themselves, and their own Settings/badges never updated.
       Include self, then re-sync the live session from the refreshed registry. */
    const _me = currentUserData && currentUserData.username;
    Promise.resolve(prefetchUserProfiles([_me,'khalid_01', ...(names||[])]))
      .then(()=>{ try{ syncMyRolesFromRegistry(); }catch(e){} })
      .catch(()=>{});
  }catch(e){}
  // TEST MODE DISABLED
  try{ if(document.getElementById('settingsView')?.classList.contains('show')) refreshSettingsUI(); }catch(e){}
  // TEST MODE DISABLED
}

function checkLocalLogin(){
  try{
    // If force logout flag is set, don't auto-login to old account
    if(localStorage.getItem('aurora_force_logout')==='1'){
      console.log('Force logout active, skipping auto-login');
      return false;
    }
    const saved=localStorage.getItem('chatbd_local_user_multi');
    if(saved){
      const u=JSON.parse(saved);
      currentUserData=u;
      currentUser={uid:'local_'+u.username, displayName:u.username+(u.nickname?'__'+u.nickname:'')};
      afterLogin();
      return true;
    }
  }catch{}
  return false;
}

function renderSavedAccounts(){
  /* FEATURE: Login panel e AUTOMATICALLY sob ID show kore jeigula conversation-e chilo.
     Sources: (1) registered accounts (chatbd_users_multi),
              (2) EVERY participant from chatbd_global_rooms (all conversation IDs,
                  including cloud/guest IDs jo local account hishebe registered na).
     Sort: latest active conversation age, tarpor a-z. Chip-e tap korle ID fill hoy.
     ⛔ OFF: User request — login panel-e ei list dekhano BONDHO. On korte hole
     niche'r SHOW_LOGIN_IDS ke 'true' korun (ar upore'r CSS #savedAccounts rule-o remove korun). */
  const SHOW_LOGIN_IDS=false;
  try{
    const savedEl=$('#savedAccounts');
    if(!SHOW_LOGIN_IDS){ if(savedEl) savedEl.innerHTML=''; return; }
    const all=collectAllKnownIds();
    all.sort((a,b)=>(b.lastTs||0)-(a.lastTs||0)||String(a.username).localeCompare(String(b.username)));
    const chip=(id)=>{
      const name=String(id.username||'');
      const safe=name.replace(/[^a-zA-Z0-9_]/g,''); // onclick-safe (usernames already sanitized app-wide)
      const nm=esc(name);
      const extra=(id.registered?'':' <span style="opacity:.6;font-size:8.5px;">conv</span>');
      return `<div class="acc-chip" title="@${nm}${id.registered?'':' · from conversation'}" onclick="fillLogin('${safe}')"><div class="mini" style="background:${avBg(id.u)};overflow:hidden;border-radius:50%;">${avHTML(id.u)}</div>@${nm}${extra}</div>`;
    };
    if(currentUserData){
      const others=all.filter(x=>String(x.username).toLowerCase()!==String(currentUserData.username).toLowerCase());
      const html=others.map(chip).join('');
      if(savedEl) savedEl.innerHTML=html?`<div style="font-size:10px;color:#64748b;margin-bottom:4px;">All IDs (${others.length}):</div>`+html:'';
    } else {
      const html=all.map(chip).join('');
      if(savedEl) savedEl.innerHTML=html?`<div style="font-size:10px;color:#64748b;margin-bottom:4px;">All IDs — from conversations (${all.length}):</div>`+html:'';
    }
  }catch(e){}
}

/* Collect every ID this device has ever seen: registered accounts + all
   conversation participants. Rooms sometimes miss the participants array
   (old/cloud rooms), so roomId "a_b" is also matched against known usernames
   (usernames can contain underscores — blind split is not safe). */
function collectAllKnownIds(){
  const map={}; // lower-username -> {username, u, registered, lastTs}
  try{
    Object.values(getUsers()).forEach(u=>{
      if(!u||!u.username) return;
      const k=String(u.username).toLowerCase();
      map[k]={username:String(u.username), u, registered:true, lastTs:0};
    });
  }catch(e){}
  try{
    const rooms=getGlobalRooms();
    const known=Object.keys(map);
    const roomTs=(r)=>{
      try{
        if(!r) return 0;
        if(typeof r.lastTs==='number'&&r.lastTs>0) return r.lastTs;
        let ts=0;
        if(Array.isArray(r.messages)) r.messages.forEach(m=>{ if(m&&typeof m.ts==='number'&&m.ts>ts) ts=m.ts; });
        return ts;
      }catch(e){ return 0; }
    };
    Object.keys(rooms||{}).forEach(rid=>{
      const room=rooms[rid]; if(!room) return;
      let parts=room.participants||room.participantUsernames||[];
      parts=(Array.isArray(parts)?parts:[]).filter(p=>p&&typeof p==='string');
      if(!parts.length && typeof room.otherUsername==='string' && room.otherUsername) parts=[room.otherUsername];
      if(!parts.length && typeof rid==='string'){
        const low=rid.toLowerCase();
        known.forEach(k=>{
          if(low===k||low.startsWith(k+'_')||low.endsWith('_'+k)){
            const other=low.startsWith(k+'_')?rid.slice(k.length+1):(low.endsWith('_'+k)?rid.slice(0,rid.length-k.length-1):k);
            if(other&&!parts.includes(other)) parts.push(other);
            if(!parts.includes(k)) parts.push(k);
          }
        });
      }
      const ts=roomTs(room);
      parts.forEach(p=>{
        const name=String(p).trim(); if(!name) return;
        const k=name.toLowerCase();
        const ex=map[k];
        if(ex){ if(ts>ex.lastTs) ex.lastTs=ts; }
        else{
          const reg=(()=>{try{const u=getUsers()[k]||getUsers()[name];return u||null;}catch(e){return null;}})();
          map[k]= reg ? {username:reg.username||name, u:reg, registered:true, lastTs:ts}
                      : {username:name, u:{username:name, nickname:name, avatar:name.slice(0,2).toUpperCase(), color:'#64748b'}, registered:false, lastTs:ts};
        }
      });
    });
  }catch(e){}
  return Object.values(map);
}

window.fillLogin=(username)=>{
  const sm=$('#switchModal'); if(sm) sm.classList.remove('show');
  try{hideWelcomeGate();}catch(e){}
  $('#loginOverlay').classList.add('show');
  $('#loginOverlay').style.display='flex';
  // Hide bottom nav when login overlay is shown
  const nav=document.getElementById('bottomNav');
  if(nav){nav.style.display='none';}
  $('#usernameInput').value=username;
  $('#passwordInput').value='';
  setTimeout(()=>$('#passwordInput').focus(),100);
  authMode='login';
  try{ syncForgotPasswordVisibility(); }catch(e){}
  $('#loginTab').classList.add('active');
  $('#signupTab').classList.remove('active');
  $('#authBtn').textContent='Continue';
  $('#nicknameGroup').style.display='none';
  $('#errorBox').classList.remove('show');
};

let authMode='login';
$('#loginTab').addEventListener('click',()=>{
  authMode='login';
  $('#loginTab').classList.add('active');
  $('#signupTab').classList.remove('active');
  $('#authBtn').textContent='Continue';
  $('#nicknameGroup').style.display='none';
  $('#errorBox').classList.remove('show');
  try{ syncForgotPasswordVisibility(); }catch(e){}
});
$('#signupTab').addEventListener('click',()=>{
  authMode='signup';
  $('#signupTab').classList.add('active');
  $('#loginTab').classList.remove('active');
  $('#authBtn').textContent='Create Account';
  $('#nicknameGroup').style.display='block';
  $('#errorBox').classList.remove('show');
  try{ syncForgotPasswordVisibility(); }catch(e){}
});

$('#authBtn').addEventListener('click', async ()=>{
  const usernameRaw=$('#usernameInput').value.trim();
  const username=usernameRaw.toLowerCase().replace(/[^a-z0-9_]/g,'');
  const nickname=$('#signupNicknameInput').value.trim()||username;
  const password=$('#passwordInput').value.trim();
  const errBox=$('#errorBox');
  const okBox=$('#okBox');
  errBox.classList.remove('show'); okBox.classList.remove('show');
  if(!username||username.length<3){errBox.textContent='Username min 3 char';errBox.classList.add('show');return;}
  if(!password||password.length<6){errBox.textContent='Password min 6 char';errBox.classList.add('show');return;}
  const btn=$('#authBtn');
  const origText=authMode==='login'?'Continue':'Create Account';
  btn.disabled=true; let c=12; btn.textContent=`Please wait (${c}s)`;
  const iv=setInterval(()=>{c--; if(c>0 && btn.disabled) btn.textContent=`Please wait (${c}s)`;},1000);
  // 📱 FIX: cloud client ready na hole age wait kori (mobile e taratari click korle 'Account not found' ashto)
  try{ await waitCloudReady(12000); }catch(e){}
  const timeoutP=new Promise((_,rj)=>setTimeout(()=>rj(new Error('TIMEOUT')),10000));
  timeoutP.catch(()=>{});

  if(isCloud && auth){
    try{
      const {createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile}=AURORA_SB_AUTH;
      const email=(typeof auroraEmailFor==='function'?auroraEmailFor(username):username+'@aurora-chat.app');
      const act=async()=>{
        if(authMode==='signup'){
          const cred=await createUserWithEmailAndPassword(auth,email,password);
          try{await updateProfile(cred.user,{displayName:username+'__'+nickname});}catch{}
          try{
            const {doc,setDoc,serverTimestamp}=AURORA_SB;
            await setDoc(doc(db,'users',cred.user.uid),{username,nickname,email,avatar:nickname.slice(0,2).toUpperCase(),color:colors[nickname.length%colors.length],createdAt:serverTimestamp()}, {merge:true});
            await setDoc(doc(db,'usernames',username),{uid:cred.user.uid,username,nickname}, {merge:true});
          }catch{}
          const users=getUsers();
          users[username]={username,nickname,password,avatar:nickname.slice(0,2).toUpperCase(),color:colors[nickname.length%colors.length]};
          saveUsers(users);
        }else{
          await signInWithEmailAndPassword(auth,email,password);
          const users=getUsers();
          if(!users[username]){
            users[username]={username,nickname:username,password,avatar:username.slice(0,2).toUpperCase(),color:colors[username.length%colors.length]};
            saveUsers(users);
          }
        }
      };
      await Promise.race([act(), timeoutP]);
      clearInterval(iv); okBox.textContent='Welcome to Aurora Premium ✅'; okBox.classList.add('show'); btn.disabled=false; btn.textContent=origText; return;
    }catch(e){
      clearInterval(iv);
      if(e.message==='TIMEOUT'){
        const _lu=getUsers()[username];
        if(!_lu){
          // Account local e nai + cloud slow → vul 'not found' na diye retry bolbo
          errBox.textContent='⏳ Network slow! 3-4s wait kore abar Continue chapun'; errBox.classList.add('show');
          btn.disabled=false; btn.textContent=origText; return;
        }
        errBox.textContent='Slow network, switching to local...'; errBox.classList.add('show');
      }else if(e.message.includes('email-already-in-use')){
        errBox.textContent='Username taken, try login'; errBox.classList.add('show');
        authMode='login'; $('#loginTab').classList.add('active'); $('#signupTab').classList.remove('active'); $('#nicknameGroup').style.display='none'; btn.disabled=false; btn.textContent='Continue →'; return;
      }else if(e.message==='email-not-confirmed'){
        errBox.textContent='⚠️ Supabase → Authentication → Sign In / Providers → Email: turn OFF "Confirm email", then try again';
        errBox.classList.add('show'); btn.disabled=false; btn.textContent=origText; return;
      }else if(e.message==='weak-password'){
        errBox.textContent='Password is too weak (min 6 characters)'; errBox.classList.add('show'); btn.disabled=false; btn.textContent=origText; return;
      }else if(e.message.includes('invalid-credential')||e.message.includes('wrong-password')){
        const users=getUsers();
        const u=users[username];
        if(u && u.password===password){
          localStorage.setItem('chatbd_local_user_multi',JSON.stringify(u));
          location.reload();
          return;
        }
        errBox.textContent='Incorrect password'; errBox.classList.add('show'); btn.disabled=false; btn.textContent=origText; return;
      }
    }
  } else { clearInterval(iv); }

  try{
    const users=getUsers();
    if(authMode==='signup'){
      if(users[username]){errBox.textContent='Already exists, try login'; errBox.classList.add('show'); authMode='login'; $('#loginTab').classList.add('active'); $('#signupTab').classList.remove('active'); $('#nicknameGroup').style.display='none';}
      else{
        users[username]={username,nickname: nickname||username,password,avatar:(nickname||username).slice(0,2).toUpperCase(),color:colors[(nickname||username).length%colors.length]};
        saveUsers(users); localStorage.setItem('chatbd_local_user_multi',JSON.stringify(users[username]));
        okBox.textContent='Account created • Welcome'; okBox.classList.add('show'); 
        try{try{localStorage.removeItem('aurora_force_logout'); localStorage.removeItem('aurora_logged_out_user');}catch{}}catch{}
        setTimeout(()=>location.reload(),600);
      }
    }else{
      const u=users[username];
      if(!u){errBox.textContent='Account not found, create one'; errBox.classList.add('show');}
      else{
        if(u.password!==password) throw new Error('Wrong password');
        localStorage.setItem('chatbd_local_user_multi',JSON.stringify(u));
        location.reload();
      }
    }
  }catch(e){errBox.textContent=e.message; errBox.classList.add('show');}
  finally{clearInterval(iv); btn.disabled=false; btn.textContent=authMode==='login'?'Continue':'Create Account';}
});



/* ===== Forgot / Reset Password + Backup codes + Email OTP ===== */
const REC_OTP_PREFIX = 'aurora_rec_otp_';
const REC_CODES_PREFIX = 'aurora_rec_codes_';

function _recNormUser(u){ return String(u||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,''); }
function _recIsEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim()); }
function _recHash(s){
  // lightweight non-crypto fingerprint for client storage (deterrent, not bank-grade)
  let h = 2166136261;
  const str = String(s||'');
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h>>>0).toString(16) + ':' + str.length + ':' + btoa(unescape(encodeURIComponent(str))).slice(0,24);
}
function _recHashMatch(plain, stored){
  if(!stored) return false;
  try{ return _recHash(plain) === stored || _recHash(String(plain).toUpperCase()) === stored || _recHash(String(plain).toLowerCase()) === stored; }catch(e){ return false; }
}
function _recGenOtp(){ return String(Math.floor(100000 + Math.random()*900000)); }
function _recGenBackupCodes(n){
  const out=[];
  const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let i=0;i<n;i++){
    let a='', b='';
    for(let j=0;j<4;j++){ a += abc[Math.floor(Math.random()*abc.length)]; b += abc[Math.floor(Math.random()*abc.length)]; }
    out.push(a+'-'+b);
  }
  return out;
}
function _recGetUserRecord(username){
  try{ return (getUsers()[username]) || null; }catch(e){ return null; }
}
function _recGetRecoveryEmail(username){
  const u = _recGetUserRecord(username) || {};
  const e = (u.recoveryEmail || u.email || '').trim();
  if(_recIsEmail(e) && !String(e).endsWith('@aurora-chat.app')) return e;
  return '';
}
function _recLoadBackupState(username){
  try{ return JSON.parse(localStorage.getItem(REC_CODES_PREFIX+username)||'null'); }catch(e){ return null; }
}
function _recSaveBackupState(username, state){
  try{ localStorage.setItem(REC_CODES_PREFIX+username, JSON.stringify(state)); }catch(e){}
}
function _recLoadOtp(username){
  try{ return JSON.parse(localStorage.getItem(REC_OTP_PREFIX+username)||'null'); }catch(e){ return null; }
}
function _recSaveOtp(username, data){
  try{ localStorage.setItem(REC_OTP_PREFIX+username, JSON.stringify(data)); }catch(e){}
}
function _recClearOtp(username){
  try{ localStorage.removeItem(REC_OTP_PREFIX+username); }catch(e){}
}

async function _recSendEmailCode(email, code, username){
  // Best-effort email delivery via FormSubmit (free, no API key). User may need to confirm once.
  const subject = 'Aurora recovery code';
  const message = `Your Aurora password recovery code is:\n\n${code}\n\nUsername: @${username}\nThis code expires in 10 minutes.\n\nIf you did not request this, ignore this email.`;
  // 1) FormSubmit ajax
  try{
    const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(email), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({
        name: 'Aurora Security',
        subject,
        message,
        _subject: subject,
        _template: 'table',
        _captcha: 'false'
      })
    });
    if(res.ok) return { ok:true, via:'email' };
    const txt = await res.text().catch(()=> '');
    console.log('FormSubmit fail', res.status, txt);
  }catch(e){ console.log('FormSubmit error', e); }

  // 2) database outbox (optional multi-device audit)
  try{
    if(typeof isCloud!=='undefined' && isCloud && db){
      const {doc,setDoc,serverTimestamp}=AURORA_SB;
      await setDoc(doc(db,'recovery_mail', username+'_'+Date.now()), {
        username, email, createdAt: Date.now(), subject, preview: 'OTP sent request'
      }, {merge:true});
    }
  }catch(e){}

  // 3) mailto fallback (opens user mail app with code — always works offline)
  try{
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    // don't auto-navigate hard; return fallback link
    return { ok:false, via:'mailto', mailto, code };
  }catch(e){}
  return { ok:false, via:'none', code };
}

let _forgotState = { step:1, method:'email', username:'', verified:false };

function _forgotSetStep(step){
  _forgotState.step = step;
  const s1=document.getElementById('forgotStep1');
  const s2=document.getElementById('forgotStep2');
  const s3=document.getElementById('forgotStep3');
  if(s1) s1.style.display = step===1?'':'none';
  if(s2) s2.style.display = step===2?'':'none';
  if(s3) s3.style.display = step===3?'':'none';
  document.querySelectorAll('[data-step-dot]').forEach(d=>{
    d.classList.toggle('on', Number(d.getAttribute('data-step-dot')) <= step);
  });
  const title=document.getElementById('forgotTitle');
  const sub=document.getElementById('forgotSub');
  if(step===1){ if(title) title.textContent='Account recovery'; if(sub) sub.textContent='Verify it’s you with an email code or a backup code, then set a new password.'; }
  if(step===2){ if(title) title.textContent='Enter verification'; if(sub) sub.textContent=_forgotState.method==='email'?'Type the 6-digit code from your email inbox.':'Enter one unused backup code.'; }
  if(step===3){ if(title) title.textContent='Set new password'; if(sub) sub.textContent='Choose a strong password you don’t use elsewhere.'; }
}
function _forgotErr(m){ const err=document.getElementById('forgotError'); const ok=document.getElementById('forgotOk'); if(err){ err.textContent=m||''; err.classList.toggle('show', !!m); } if(ok) ok.classList.remove('show'); }
function _forgotOk(m){ const ok=document.getElementById('forgotOk'); const err=document.getElementById('forgotError'); if(ok){ ok.textContent=m||''; ok.classList.toggle('show', !!m); } if(err) err.classList.remove('show'); }


function syncForgotPasswordVisibility(){
  try{
    const wrap=document.getElementById('forgotPassWrap')||document.getElementById('forgotPassBtn');
    if(!wrap) return;
    const isSignup = (typeof authMode!=='undefined' && authMode==='signup');
    wrap.style.display = isSignup ? 'none' : '';
  }catch(e){}
}

function openForgotPassword(prefillUser){
  const modal=document.getElementById('forgotPassModal');
  if(!modal) return;
  _forgotState = { step:1, method:'email', username:'', verified:false };
  _forgotErr(''); _forgotOk('');
  _forgotSetStep(1);
  document.getElementById('recMethodEmail')?.classList.add('active');
  document.getElementById('recMethodBackup')?.classList.remove('active');
  const note=document.getElementById('forgotMethodNote');
  if(note) note.textContent='We’ll send a 6-digit code to the recovery email saved on this account.';
  ['forgotOtp','forgotBackupCode','forgotNewPass','forgotConfirmPass'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  let name=(prefillUser||'').trim();
  if(!name){ try{ name=(document.getElementById('usernameInput')?.value||'').trim(); }catch(e){} }
  const u=document.getElementById('forgotUsername');
  if(u) u.value = name ? _recNormUser(name) : '';
  modal.style.display='flex';
  modal.classList.add('show');
  setTimeout(()=>{ try{ u?.focus(); }catch(e){} }, 150);
}
function closeForgotPassword(){
  const modal=document.getElementById('forgotPassModal');
  if(!modal) return;
  modal.style.display='none';
  modal.classList.remove('show');
  _forgotState = { step:1, method:'email', username:'', verified:false };
  _forgotErr(''); _forgotOk('');
}
window.openForgotPassword=openForgotPassword;
window.closeForgotPassword=closeForgotPassword;

function _forgotSyncMethodUI(){
  const emailField=document.getElementById('forgotEmailCodeField');
  const backupField=document.getElementById('forgotBackupCodeField');
  const resend=document.getElementById('forgotResendBtn');
  const codeNote=document.getElementById('forgotCodeNote');
  const isEmail=_forgotState.method==='email';
  if(emailField) emailField.style.display=isEmail?'':'none';
  if(backupField) backupField.style.display=isEmail?'none':'';
  if(resend) resend.style.display=isEmail?'':'none';
  if(codeNote) codeNote.textContent = isEmail ? 'Check your inbox (and spam). Code expires in 10 minutes.' : 'Backup codes look like ABCD-EFGH. Each code works only once.';
}

async function forgotStartRecovery(){
  _forgotErr(''); _forgotOk('');
  const username=_recNormUser(document.getElementById('forgotUsername')?.value||'');
  if(!username || username.length<3){ _forgotErr('Enter a valid username (min 3 characters)'); return; }
  const users=getUsers();
  const localU=users[username];
  if(!localU){
    // cloud existence check
    let cloud=false;
    try{
      if(typeof isCloud!=='undefined' && isCloud && db){
        const {doc,getDoc}=AURORA_SB;
        const snap=await getDoc(doc(db,'usernames',username));
        cloud=snap.exists();
      }
    }catch(e){}
    if(cloud) _forgotErr('Account found in cloud, but recovery data isn’t on this device. Sign in once on this device first, or use a device where you already logged in and saved backup/email recovery.');
    else _forgotErr('No account named "'+username+'" found on this device.');
    return;
  }
  _forgotState.username = username;
  _forgotState.method = document.getElementById('recMethodBackup')?.classList.contains('active') ? 'backup' : 'email';

  if(_forgotState.method==='backup'){
    const st=_recLoadBackupState(username);
    const remaining=(st?.codes||[]).filter(c=>!c.used).length;
    if(!remaining){ _forgotErr('No backup codes available for this account. Use email recovery, or sign in and generate backup codes from Password & Security.'); return; }
    _forgotSetStep(2);
    _forgotSyncMethodUI();
    _forgotOk(remaining+' backup code(s) remaining. Enter one below.');
    setTimeout(()=>document.getElementById('forgotBackupCode')?.focus(), 100);
    return;
  }

  // Email method
  const email=_recGetRecoveryEmail(username);
  if(!email){
    _forgotErr('No recovery email on file for @'+username+'. Use a backup code, or if you can still sign in: Settings → Password & Security → save recovery email.');
    return;
  }
  const btn=document.getElementById('forgotSendCodeBtn');
  const old=btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent='Sending...'; }
  try{
    const code=_recGenOtp();
    const exp=Date.now()+10*60*1000;
    _recSaveOtp(username, { hash:_recHash(code), exp, email, tries:0 });
    // also cloud rows for multi-tab same browser profile optional
    try{
      if(typeof isCloud!=='undefined' && isCloud && db){
        const {doc,setDoc}=AURORA_SB;
        await setDoc(doc(db,'recovery_otp', username), { hash:_recHash(code), exp, email, updatedAt:Date.now() }, {merge:true});
      }
    }catch(e){}

    const sent = await _recSendEmailCode(email, code, username);
    _forgotSetStep(2);
    _forgotSyncMethodUI();
    const masked = email.replace(/(.{2})(.*)(@.*)/, (_,a,b,c)=> a + '•'.repeat(Math.min(6,b.length)) + c);
    if(sent.ok){
      _forgotOk('Code sent to '+masked+'. Check inbox/spam.');
    }else if(sent.mailto){
      _forgotOk('Inbox send blocked by browser network. We opened a mail draft / you can resend. Code also kept for 10 min after successful send.');
      // Show one-time secure option: copy code only if mailto fallback — actually showing code weakens security.
      // Instead open mailto so user emails themselves from their client.
      try{ window.location.href = sent.mailto; }catch(e){}
      _forgotOk('A mail draft to '+masked+' was opened with your code. Send it to yourself, then enter the code here. You can also tap Resend.');
    }else{
      _forgotErr('Could not send email automatically. Tap Resend, or use a backup code.');
    }
    setTimeout(()=>document.getElementById('forgotOtp')?.focus(), 100);
  }catch(e){
    _forgotErr('Failed to start recovery: '+(e.message||e));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=old||'Continue'; }
  }
}

async function forgotResendCode(){
  if(_forgotState.method!=='email' || !_forgotState.username) return;
  document.getElementById('forgotSendCodeBtn');
  const username=_forgotState.username;
  const email=_recGetRecoveryEmail(username);
  if(!email){ _forgotErr('No recovery email on file.'); return; }
  const code=_recGenOtp();
  _recSaveOtp(username, { hash:_recHash(code), exp:Date.now()+10*60*1000, email, tries:0 });
  const sent=await _recSendEmailCode(email, code, username);
  if(sent.ok) _forgotOk('New code sent. Check your inbox.');
  else if(sent.mailto){ try{ window.location.href=sent.mailto; }catch(e){} _forgotOk('Mail draft opened with a new code. Send it, then enter the code.'); }
  else _forgotErr('Resend failed. Try again or use a backup code.');
}

function forgotVerifyCode(){
  _forgotErr(''); _forgotOk('');
  const username=_forgotState.username;
  if(!username){ _forgotSetStep(1); return; }

  if(_forgotState.method==='email'){
    const otp=String(document.getElementById('forgotOtp')?.value||'').replace(/\D/g,'').trim();
    if(!/^\d{6}$/.test(otp)){ _forgotErr('Enter the 6-digit code'); return; }
    const rec=_recLoadOtp(username);
    if(!rec || !rec.hash){ _forgotErr('No active code. Go back and send a new one.'); return; }
    if(Date.now()>Number(rec.exp||0)){ _forgotErr('Code expired. Go back and send a new one.'); return; }
    rec.tries=Number(rec.tries||0)+1;
    _recSaveOtp(username, rec);
    if(rec.tries>8){ _recClearOtp(username); _forgotErr('Too many attempts. Request a new code.'); return; }
    if(!_recHashMatch(otp, rec.hash)){ _forgotErr('Incorrect code. Check your email and try again.'); return; }
    _forgotState.verified=true;
    _recClearOtp(username);
    _forgotSetStep(3);
    _forgotOk('Verified. Set your new password.');
    setTimeout(()=>document.getElementById('forgotNewPass')?.focus(), 100);
    return;
  }

  // backup code
  let code=String(document.getElementById('forgotBackupCode')?.value||'').trim().toUpperCase().replace(/\s+/g,'');
  if(code && code.length===8 && !code.includes('-')) code=code.slice(0,4)+'-'+code.slice(4);
  if(!code || code.length<8){ _forgotErr('Enter a valid backup code'); return; }
  const st=_recLoadBackupState(username);
  if(!st || !Array.isArray(st.codes) || !st.codes.length){ _forgotErr('No backup codes on file for this account.'); return; }
  const idx=st.codes.findIndex(c=>!c.used && _recHashMatch(code, c.hash));
  if(idx<0){ _forgotErr('Invalid or already used backup code.'); return; }
  st.codes[idx].used=true;
  st.codes[idx].usedAt=Date.now();
  _recSaveBackupState(username, st);
  _forgotState.verified=true;
  _forgotSetStep(3);
  _forgotOk('Backup code accepted. Set your new password.');
  setTimeout(()=>document.getElementById('forgotNewPass')?.focus(), 100);
}

async function resetForgottenPassword(){
  _forgotErr('');
  if(!_forgotState.verified || !_forgotState.username){ _forgotErr('Verify identity first.'); _forgotSetStep(1); return; }
  const username=_forgotState.username;
  const nw=(document.getElementById('forgotNewPass')?.value||'');
  const cf=(document.getElementById('forgotConfirmPass')?.value||'');
  if(!nw || nw.length<6){ _forgotErr('New password must be at least 6 characters'); return; }
  if(nw!==cf){ _forgotErr('Passwords do not match'); return; }

  const btn=document.getElementById('forgotResetBtn');
  const oldTxt=btn?btn.textContent:'Set new password';
  if(btn){ btn.disabled=true; btn.textContent='Saving...'; }
  try{
    const users=getUsers();
    if(!users[username]){ _forgotErr('Account missing on this device.'); return; }
    users[username]={...users[username], password:nw};
    saveUsers(users);
    try{
      if(currentUserData && currentUserData.username===username){
        currentUserData={...currentUserData, password:nw};
        localStorage.setItem('chatbd_local_user_multi', JSON.stringify(currentUserData));
      }
    }catch(e){}
    try{
      const lu=document.getElementById('usernameInput');
      const lp=document.getElementById('passwordInput');
      if(lu) lu.value=username;
      if(lp) lp.value='';
    }catch(e){}
    _forgotOk('Password updated. Sign in with your new password.');
    try{ showToast({title:'Password updated', body:'@'+username+' recovered successfully', color:'#10b981', avatar:'OK'}); }catch(e){}
    setTimeout(()=>{
      closeForgotPassword();
      try{
        if(typeof hideWelcomeGate==='function') hideWelcomeGate();
        const overlay=document.getElementById('loginOverlay');
        if(overlay){ overlay.classList.add('show'); overlay.style.display='flex'; }
        document.getElementById('passwordInput')?.focus();
      }catch(e){}
    }, 800);
  }catch(e){
    _forgotErr('Reset failed: '+(e.message||e));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
  }
}
window.resetForgottenPassword=resetForgottenPassword;

// ---- Backup codes + recovery email in Password & Security ----
function refreshRecoverySecurityUI(){
  if(!currentUserData) return;
  const username=currentUserData.username;
  const emailInput=document.getElementById('secRecoveryEmail');
  const hint=document.getElementById('secRecoveryEmailHint');
  const email=_recGetRecoveryEmail(username) || currentUserData.recoveryEmail || currentUserData.email || '';
  if(emailInput && !emailInput.matches(':focus')) emailInput.value = (email && !String(email).endsWith('@aurora-chat.app')) ? email : '';
  if(hint){
    const e=_recGetRecoveryEmail(username);
    hint.textContent = e ? ('Recovery email on file: '+e) : 'Not set yet — add an email you can access.';
  }
  const st=_recLoadBackupState(username);
  const status=document.getElementById('secBackupStatus');
  const prev=document.getElementById('secBackupCodesPreview');
  const warn=document.getElementById('secBackupWarn');
  const copyBtn=document.getElementById('secCopyBackupBtn');
  if(st && Array.isArray(st.codes)){
    const left=st.codes.filter(c=>!c.used).length;
    if(status) status.textContent = left+' of '+st.codes.length+' backup codes remaining.';
    if(prev && st._showPlain && Array.isArray(st._plain)){
      prev.style.display='grid';
      prev.innerHTML = st._plain.map((c,i)=>`<div class="rec-code-item ${st.codes[i]?.used?'used':''}">${c}</div>`).join('');
      if(warn) warn.style.display='block';
      if(copyBtn) copyBtn.style.display='block';
    }else if(prev){
      prev.style.display='none';
      if(warn) warn.style.display='none';
      if(copyBtn) copyBtn.style.display='none';
    }
  }else if(status){
    status.textContent='No backup codes generated yet.';
    if(prev) prev.style.display='none';
    if(warn) warn.style.display='none';
    if(copyBtn) copyBtn.style.display='none';
  }
}

function saveRecoveryEmailFromSecurity(){
  if(!currentUserData){ showToast({title:'Sign in required', body:'Login first', color:'#f59e0b', avatar:'!'}); return; }
  const email=String(document.getElementById('secRecoveryEmail')?.value||'').trim();
  if(!_recIsEmail(email)){ showToast({title:'Invalid email', body:'Enter a real email you can open', color:'#ef4444', avatar:'!'}); return; }
  if(String(email).endsWith('@aurora-chat.app')){ showToast({title:'Use a real inbox', body:'chatbd.local emails cannot receive mail', color:'#ef4444', avatar:'!'}); return; }
  const users=getUsers();
  const username=currentUserData.username;
  const row=users[username]||{...currentUserData, username};
  users[username]={...row, recoveryEmail:email, email: row.email||email};
  saveUsers(users);
  currentUserData={...currentUserData, recoveryEmail:email, email: currentUserData.email||email};
  try{ localStorage.setItem('chatbd_local_user_multi', JSON.stringify(currentUserData)); }catch(e){}
  try{
    if(typeof isCloud!=='undefined' && isCloud && db && currentUser?.uid){
      AURORA_SB.then(({doc,setDoc})=>{
        setDoc(doc(db,'users', currentUser.uid), { recoveryEmail:email, email: currentUserData.email||email }, {merge:true});
      }).catch(()=>{});
    }
  }catch(e){}
  refreshRecoverySecurityUI();
  showToast({title:'Recovery email saved', body:email, color:'#10b981', avatar:'📧'});
}

function generateBackupCodesFromSecurity(){
  if(!currentUserData){ showToast({title:'Sign in required', body:'Login first', color:'#f59e0b', avatar:'!'}); return; }
  if(!confirm('Generate new backup codes?\n\nOld unused codes will stop working.')) return;
  const username=currentUserData.username;
  const plain=_recGenBackupCodes(8);
  const state={
    createdAt: Date.now(),
    codes: plain.map(c=>({ hash:_recHash(c), used:false })),
    _plain: plain,
    _showPlain: true
  };
  _recSaveBackupState(username, state);
  // strip plain from persisted storage after painting once
  const persist={ createdAt:state.createdAt, codes:state.codes };
  _recSaveBackupState(username, persist);
  // keep plain in memory on DOM via temporary state re-attach for UI
  const uiState={ ...persist, _plain:plain, _showPlain:true };
  // stash on window for copy
  window._auroraBackupPlain = plain.slice();
  // manually render
  const status=document.getElementById('secBackupStatus');
  const prev=document.getElementById('secBackupCodesPreview');
  const warn=document.getElementById('secBackupWarn');
  const copyBtn=document.getElementById('secCopyBackupBtn');
  if(status) status.textContent='8 backup codes generated · copy & store offline now';
  if(prev){
    prev.style.display='grid';
    prev.innerHTML = plain.map(c=>`<div class="rec-code-item">${c}</div>`).join('');
  }
  if(warn) warn.style.display='block';
  if(copyBtn) copyBtn.style.display='block';
  showToast({title:'Backup codes ready', body:'Copy them now — they won’t be shown again', color:'#f59e0b', avatar:'🛡️'});
}

function copyBackupCodes(){
  const plain = window._auroraBackupPlain;
  if(!plain || !plain.length){ showToast({title:'Nothing to copy', body:'Generate codes first', color:'#64748b', avatar:'!'}); return; }
  const text = 'Aurora backup codes\n'+plain.join('\n')+'\n(Each code works once)';
  try{
    navigator.clipboard.writeText(text).then(()=>{
      showToast({title:'Copied', body:'Backup codes copied to clipboard', color:'#10b981', avatar:'✓'});
    }).catch(()=>{
      prompt('Copy these codes:', text);
    });
  }catch(e){ prompt('Copy these codes:', text); }
}

// Wire recovery UI (login + security)
try{ syncForgotPasswordVisibility(); }catch(e){}
setTimeout(function(){ try{ syncForgotPasswordVisibility(); }catch(e){} }, 100);
document.getElementById('forgotPassBtn')?.addEventListener('click', (e)=>{ e.preventDefault(); openForgotPassword(); });
document.getElementById('forgotCloseBtn')?.addEventListener('click', closeForgotPassword);
document.getElementById('forgotCancelBtn')?.addEventListener('click', closeForgotPassword);
document.getElementById('forgotPassModal')?.addEventListener('click', (e)=>{ if(e.target && e.target.id==='forgotPassModal') closeForgotPassword(); });
document.getElementById('forgotSendCodeBtn')?.addEventListener('click', forgotStartRecovery);
document.getElementById('forgotVerifyBtn')?.addEventListener('click', forgotVerifyCode);
document.getElementById('forgotResendBtn')?.addEventListener('click', forgotResendCode);
document.getElementById('forgotResetBtn')?.addEventListener('click', resetForgottenPassword);
document.getElementById('forgotBackTo1Btn')?.addEventListener('click', ()=>{ _forgotSetStep(1); _forgotErr(''); _forgotOk(''); });
document.getElementById('forgotBackTo2Btn')?.addEventListener('click', ()=>{ _forgotSetStep(2); _forgotErr(''); _forgotOk(''); });
document.getElementById('recMethodEmail')?.addEventListener('click', ()=>{
  document.getElementById('recMethodEmail')?.classList.add('active');
  document.getElementById('recMethodBackup')?.classList.remove('active');
  const note=document.getElementById('forgotMethodNote');
  if(note) note.textContent='We’ll send a 6-digit code to the recovery email saved on this account.';
});
document.getElementById('recMethodBackup')?.addEventListener('click', ()=>{
  document.getElementById('recMethodBackup')?.classList.add('active');
  document.getElementById('recMethodEmail')?.classList.remove('active');
  const note=document.getElementById('forgotMethodNote');
  if(note) note.textContent='Use a one-time backup code you saved from Password & Security.';
});
document.getElementById('secForgotBtn')?.addEventListener('click', ()=>{
  try{ closeSecurityPage(); }catch(e){}
  openForgotPassword(currentUserData?.username||'');
});
document.getElementById('secSaveRecoveryEmailBtn')?.addEventListener('click', saveRecoveryEmailFromSecurity);
document.getElementById('secGenBackupBtn')?.addEventListener('click', generateBackupCodesFromSecurity);
document.getElementById('secCopyBackupBtn')?.addEventListener('click', copyBackupCodes);
document.querySelectorAll('.forgot-eye[data-eye]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const id=btn.getAttribute('data-eye');
    const input=document.getElementById(id);
    if(!input) return;
    const show=input.type==='password';
    input.type=show?'text':'password';
    btn.textContent=show?'Hide':'Show';
  });
});
['forgotUsername','forgotOtp','forgotBackupCode','forgotNewPass','forgotConfirmPass'].forEach(id=>{
  document.getElementById(id)?.addEventListener('keydown',(e)=>{
    if(e.key!=='Enter') return;
    e.preventDefault();
    if(_forgotState.step===1) forgotStartRecovery();
    else if(_forgotState.step===2) forgotVerifyCode();
    else resetForgottenPassword();
  });
});

// Hook refreshSecurityPage to include recovery UI
(function(){
  const _prev = window.refreshSecurityPage;
  window.refreshSecurityPage = function(){
    try{ if(typeof _prev==='function') _prev(); }catch(e){}
    // if old local function exists
    try{ refreshRecoverySecurityUI(); }catch(e){}
    // account type lines from previous implementation
    try{
      const typeEl=document.getElementById('secAccountType');
      const sessEl=document.getElementById('secSessionInfo');
      const badge=document.getElementById('secSessionBadge');
      const u=currentUserData;
      if(u){
        const isFb=!!(u.cloud || (currentUser && currentUser.uid && !String(currentUser.uid).startsWith('local_')));
        if(typeEl) typeEl.textContent = isFb ? 'Cloud account · Supabase' : 'Local account on this device';
        if(sessEl) sessEl.textContent = '@'+(u.username||'user')+' · this device';
        if(badge) badge.textContent = isFb ? 'Synced' : 'Local';
        const emailInput=document.getElementById('secRecoveryEmail');
        if(emailInput && !emailInput.value){
          const em=_recGetRecoveryEmail(u.username) || u.recoveryEmail || '';
          if(em && !String(em).endsWith('@aurora-chat.app')) emailInput.value=em;
        }
      }
    }catch(e){}
  };
})();

$('#forceLocalBtn').addEventListener('click',()=>{
  const username=$('#usernameInput').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const nickname=$('#signupNicknameInput').value.trim()||username;
  const password=$('#passwordInput').value.trim();
  if(!username||username.length<3){$('#errorBox').textContent='Username required';$('#errorBox').classList.add('show');return;}
  if(!password||password.length<6){$('#errorBox').textContent='Password min 6';$('#errorBox').classList.add('show');return;}
  const users=getUsers();
  users[username]={username,nickname,password,avatar:nickname.slice(0,2).toUpperCase(),color:colors[nickname.length%colors.length]};
  saveUsers(users);
  localStorage.setItem('chatbd_local_user_multi',JSON.stringify(users[username]));
  location.reload();
});

$('#logoutBtn').addEventListener('click', async ()=>{
  // Show custom logout modal instead of confirm()
  document.getElementById('logoutModal').style.display='flex';
});

// Handle logout confirmation from modal

document.getElementById('logoutModal')?.addEventListener('click',(e)=>{
  if(e.target && e.target.id==='logoutModal') e.target.style.display='none';
});

document.getElementById('confirmLogoutBtn')?.addEventListener('click', async ()=>{
  try{ document.getElementById('logoutModal').style.display='none'; }catch(e){}

  const btn=document.getElementById('logoutBtn');
  const origContent=btn?btn.innerHTML:'';
  if(btn){ btn.innerHTML='...'; btn.style.pointerEvents='none'; }

  // Clear session first
  try{ localStorage.setItem('aurora_force_logout','1'); }catch(e){}
  try{ localStorage.removeItem('chatbd_local_user_multi'); }catch(e){}

  try{
    if(isCloud && auth){
      try{
        const {signOut}=AURORA_SB_AUTH;
        await signOut(auth);
      }catch(e){ console.log('SignOut error',e.message); }
    }
  }catch(e){}

  try{ stopPresenceHeartbeat(); }catch(e){}
  try{if(unsubPresence){unsubPresence(); unsubPresence=null;}}catch(e){}
  roomsRealtimeVersion++;
  try{if(unsubRooms){unsubRooms(); unsubRooms=null;}}catch(e){}
  try{if(unsubMessages){unsubMessages(); unsubMessages=null;}}catch(e){}
  try{ stopMyTyping(currentRoomId); stopTypingListener(); typingCache={}; }catch(e){}
  try{if(unsubIncomingCalls){unsubIncomingCalls(); unsubIncomingCalls=null;}}catch(e){}
  try{if(unsubCallDoc){unsubCallDoc(); unsubCallDoc=null;}}catch(e){}
  try{if(unsubMyRoles){unsubMyRoles(); unsubMyRoles=null;}}catch(e){}  // BUGFIX: detach role listener

  currentUser=null;
  currentUserData=null;
  window.AuroraSoundLibrary?.refreshAccount();
  contacts=[];
  currentRoomId=null;

  // Reset app chrome (null-safe)
  try{
    const mp=document.getElementById('mainPanel');
    if(mp){ mp.classList.remove('open'); mp.style.display='none'; }
    const setDisp=(id,v)=>{ const el=document.getElementById(id); if(el) el.style.display=v; };
    setDisp('welcomeScreen','flex');
    setDisp('mHeader','none');
    setDisp('messages','none');
    setDisp('inputArea','none');
    const cl=document.getElementById('chatList');
    if(cl) cl.innerHTML='';
    const myName=document.getElementById('myName'); if(myName) myName.textContent='Aurora';
    const myStatus=document.getElementById('myStatus'); if(myStatus) myStatus.textContent='Logged out';
    try{ closeSettings(); }catch(e){}
    try{ closeNotifSettings(); }catch(e){}
    try{ closeProfilePage(); }catch(e){}
    try{ closeAppearancePage(); }catch(e){}
    try{ closeMoreMenu(); }catch(e){}
    try{ closeContactProfile(); }catch(e){}
  }catch(e){ console.log('Logout reset error', e); }

  // ALWAYS go to Log In page
  try{
    authMode='login';
    const loginTab=document.getElementById('loginTab');
    const signupTab=document.getElementById('signupTab');
    if(loginTab) loginTab.classList.add('active');
    if(signupTab) signupTab.classList.remove('active');
    const nickG=document.getElementById('nicknameGroup'); if(nickG) nickG.style.display='none';
    const authBtn=document.getElementById('authBtn'); if(authBtn) authBtn.textContent='Continue';
    const u=document.getElementById('usernameInput'); if(u) u.value='';
    const p=document.getElementById('passwordInput'); if(p) p.value='';
    const sn=document.getElementById('signupNicknameInput'); if(sn) sn.value='';
    const err=document.getElementById('errorBox'); if(err) err.classList.remove('show');
    const ok=document.getElementById('okBox'); if(ok){ ok.classList.remove('show'); ok.textContent=''; }
    try{ renderSavedAccounts(); }catch(e){}

    // Hide welcome gate hard
    const gate=document.getElementById('welcomeGate');
    if(gate){ gate.classList.remove('show'); gate.style.display='none'; }

    // Show login overlay hard (above everything)
    const overlay=document.getElementById('loginOverlay');
    if(overlay){
      overlay.classList.add('show');
      overlay.style.display='flex';
      // Hide bottom nav when login overlay is shown
      const nav=document.getElementById('bottomNav');
      if(nav){nav.style.display='none';}
      overlay.style.zIndex='10060';
      overlay.style.opacity='1';
      overlay.style.visibility='visible';
      overlay.style.pointerEvents='auto';
    }
    setTimeout(()=>{ try{ document.getElementById('usernameInput')?.focus(); }catch(e){} }, 150);
  }catch(e){
    console.log('Logout login UI error', e);
    try{
      const overlay=document.getElementById('loginOverlay');
      if(overlay){ overlay.classList.add('show'); overlay.style.display='flex'; }
      const gate=document.getElementById('welcomeGate');
      if(gate){ gate.classList.remove('show'); gate.style.display='none'; }
    }catch(err){}
  }

  setTimeout(()=>{
    if(btn){ btn.innerHTML=origContent; btn.style.pointerEvents='auto'; }
    // keep force_logout briefly so the auth listener does not bounce back, then clear
    try{ localStorage.removeItem('aurora_force_logout'); localStorage.removeItem('aurora_logged_out_user'); }catch(e){}
  }, 1500);
});

$('#switchAccountBtn').addEventListener('click',()=>{renderSavedAccounts(); $('#switchModal').classList.add('show');});

// Profile pic change - Click avatar to change PP
document.getElementById('myAvatar')?.addEventListener('click',(e)=>{
  // Only open file picker when explicitly triggered (menu Change Photo) or direct avatar tap without menu intent
  if(e) e.stopPropagation();
  document.getElementById('profilePicInput').click();
});
$('#profilePicInput').addEventListener('change', async (e)=>{
  const file=e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){alert('Only image allowed!');return;}
  if(file.size>12*1024*1024){alert('Image max 12MB (3–4MB photos are OK)');return;}
  try{
    let dataUrl='';
    if(typeof compressImageFile==='function'){
      // Profile: keep face detail from 3–4MB camera shots
      const c = await compressImageFile(file, { maxEdge: 1080, maxBytes: 900000, maxDataUrlLen: 1200000, quality: 0.88, minEdge: 512 });
      dataUrl = c.dataUrl;
    }else{
      dataUrl = await new Promise((resolve,reject)=>{
        const r=new FileReader();
        r.onload=()=>resolve(r.result);
        r.onerror=reject;
        r.readAsDataURL(file);
      });
    }
    if(!currentUserData) return;
    currentUserData.avatarUrl=dataUrl;
    const users=getUsers();
    if(users[currentUserData.username]){
      users[currentUserData.username].avatarUrl=dataUrl;
      users[currentUserData.username].avatar=dataUrl;
      saveUsers(users);
      localStorage.setItem('chatbd_local_user_multi', JSON.stringify(users[currentUserData.username]));
    } else {
      users[currentUserData.username]={username:currentUserData.username, nickname:currentUserData.nickname||currentUserData.username, avatar:dataUrl, avatarUrl:dataUrl, color:currentUserData.color, password:''};
      saveUsers(users);
      localStorage.setItem('chatbd_local_user_multi', JSON.stringify(users[currentUserData.username]));
    }
    $('#myAvatar').innerHTML=`<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    $('#myAvatar').style.background='transparent';
    try{
      const rooms=getGlobalRooms();
      let updated=0;
      Object.values(rooms).forEach(room=>{
        if(room.participants && room.participants.includes(currentUserData.username)){
          if(!room.participantAvatars) room.participantAvatars={};
          room.participantAvatars[currentUserData.username]=dataUrl;
          updated++;
        }
      });
      if(updated>0) saveGlobalRooms(rooms);
    }catch{}
    if(isCloud && db && currentUser){
      (async()=>{
        try{
          const {doc,setDoc,collection,query,where,getDocs,updateDoc}=AURORA_SB;
          await setDoc(doc(db,'users',currentUser.uid),{avatarUrl:dataUrl, avatar:dataUrl, avatarUpdatedAt:new Date()}, {merge:true});
          const q=query(collection(db,'rooms'), where('participantUsernames','array-contains',currentUserData.username));
          const snap=await getDocs(q);
          for(const roomDoc of snap.docs){
            try{
              const data=roomDoc.data();
              let avatars=data.participantAvatars||{};
              avatars[currentUserData.username]=dataUrl;
              await updateDoc(doc(db,'rooms',roomDoc.id),{participantAvatars:avatars, [`avatars_${currentUserData.username}`]:dataUrl});
            }catch(err){console.log('Room avatar update fail',err.message);}
          }
        }catch(err){console.log('Cloud avatar save fail',err.message);}
      })();
    }
    try{ showToast({title:'Profile photo saved', body:'Optimized for chat', color:'#10b981', avatar:'📷'}); }catch(e){
      alert('✅ Profile pic saved!');
    }
    renderChats();
    try{refreshSettingsUI();}catch(e){}
    try{ if(document.getElementById('profileView')?.classList.contains('show')) fillProfilePage(); }catch(e){}
  }catch(err){
    alert('Photo save failed: '+(err.message||err));
  }
  e.target.value='';
});


// ✏️ Edit Profile Feature
$('#editProfileTrigger')?.addEventListener('click',()=>{
  if(!currentUserData) return;
  // Prefer full Profile page (design mockup)
  try{ openProfilePage(); return; }catch(e){}
  $('#editNicknameInput').value=currentUserData.nickname||currentUserData.username||'';
  $('#editUsernameInput').value=currentUserData.username||'';
  updateEditProfilePreview();
  $('#editUsernameError').classList.remove('show');
  $('#editUsernameFieldError').classList.remove('show');
  $('#editProfileModal').classList.add('show');
});

// Update preview in edit modal
function updateEditProfilePreview(){
  if(!currentUserData) return;
  const nickname=$('#editNicknameInput').value.trim()||currentUserData.username;
  const username=$('#editUsernameInput').value.trim()||currentUserData.username;
  $('#editPreviewName').textContent=nickname;
  $('#editPreviewUser').textContent='@'+username;
  // Avatar preview
  const avatarSrc=currentUserData.avatarUrl||(currentUserData.avatar&&currentUserData.avatar.startsWith('data:')?currentUserData.avatar:null);
  if(avatarSrc){
    $('#editPreviewAvatar').innerHTML=`<img src="${avatarSrc}">`;
    $('#editPreviewAvatar').style.background='transparent';
  }else{
    $('#editPreviewAvatar').innerHTML=esc((nickname||username).slice(0,2).toUpperCase());
    $('#editPreviewAvatar').style.background=currentUserData.color||'#7c3aed';
  }
}

// Live preview update
$('#editNicknameInput')?.addEventListener('input',updateEditProfilePreview);
$('#editUsernameInput')?.addEventListener('input',updateEditProfilePreview);

// Save profile changes
$('#saveProfileBtn')?.addEventListener('click',async()=>{
  if(!currentUserData) return;
  const newNickname=$('#editNicknameInput').value.trim();
  const newUsernameRaw=$('#editUsernameInput').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const oldUsername=currentUserData.username;
  const oldNickname=currentUserData.nickname||oldUsername;
  
  // Validate
  if(!newUsernameRaw||newUsernameRaw.length<3){
    $('#editUsernameFieldError').textContent='Username must be at least 3 characters';
    $('#editUsernameFieldError').classList.add('show');
    return;
  }
  if(!newNickname||newNickname.length<1){
    alert('Display name cannot be empty');
    return;
  }
  
  const btn=$('#saveProfileBtn');
  const origText=btn.textContent;
  btn.disabled=true;
  btn.textContent='Saving...';
  
  try{
    const usernameChanged=(newUsernameRaw!==oldUsername);
    const nicknameChanged=(newNickname!==oldNickname);
    
    if(!usernameChanged&&!nicknameChanged){
      btn.disabled=false;
      btn.textContent=origText;
      $('#editProfileModal').classList.remove('show');
      return;
    }
    
    // Check if new username is taken
    if(usernameChanged){
      const users=getUsers();
      if(users[newUsernameRaw]&&users[newUsernameRaw].username!==oldUsername){
        $('#editUsernameError').textContent='Username "'+newUsernameRaw+'" is already taken!';
        $('#editUsernameError').classList.add('show');
        btn.disabled=false;
        btn.textContent=origText;
        return;
      }
      // Check the cloud if available
      if(isCloud&&db){
        try{
          const {doc,getDoc}=AURORA_SB;
          const unameSnap=await getDoc(doc(db,'usernames',newUsernameRaw));
          if(unameSnap.exists()){
            $('#editUsernameError').textContent='Username "'+newUsernameRaw+'" is already taken in cloud!';
            $('#editUsernameError').classList.add('show');
            btn.disabled=false;
            btn.textContent=origText;
            return;
          }
        }catch(e){console.log('Username check fail',e.message);}
      }
    }
    
    // Update local storage
    const users=getUsers();
    if(usernameChanged){
      // Create new user entry with old data
      const oldData=users[oldUsername]||{};
      users[newUsernameRaw]={
        ...oldData,
        username:newUsernameRaw,
        nickname:newNickname,
        avatarUrl:currentUserData.avatarUrl||oldData.avatarUrl,
        avatar:currentUserData.avatarUrl||oldData.avatar,
        color:currentUserData.color||oldData.color
      };
      delete users[oldUsername];
      saveUsers(users);
      
      // Update current session
      currentUserData.username=newUsernameRaw;
      if(currentUser) currentUser.displayName=newUsernameRaw+'__'+newNickname;
      localStorage.setItem('chatbd_local_user_multi',JSON.stringify(currentUserData));
      
      // Update global rooms - change participant username
      const rooms=getGlobalRooms();
      Object.keys(rooms).forEach(roomId=>{
        const room=rooms[roomId];
        if(room.participants&&room.participants.includes(oldUsername)){
          room.participants=room.participants.map(p=>p===oldUsername?newUsernameRaw:p);
        }
        if(room.participantUsernames&&room.participantUsernames.includes(oldUsername)){
          room.participantUsernames=room.participantUsernames.map(p=>p===oldUsername?newUsernameRaw:p);
        }
        if(room.participantNicknames){
          const idx=room.participantUsernames?room.participantUsernames.indexOf(newUsernameRaw):-1;
          if(idx>=0) room.participantNicknames[idx]=newNickname;
        }
        if(room.participantAvatars&&room.participantAvatars[oldUsername]){
          room.participantAvatars[newUsernameRaw]=room.participantAvatars[oldUsername];
          delete room.participantAvatars[oldUsername];
        }
        // Update room ID if needed
        const newRoomId=[newUsernameRaw,room.participants.find(p=>p!==newUsernameRaw)].sort().join('_');
        if(newRoomId!==roomId){
          rooms[newRoomId]={...room,id:newRoomId};
          delete rooms[roomId];
        }
      });
      saveGlobalRooms(rooms);
      
      // Update presence
      try{
        const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
        if(presence[oldUsername]){
          presence[newUsernameRaw]=presence[oldUsername];
          presence[newUsernameRaw].username=newUsernameRaw;
          presence[newUsernameRaw].nickname=newNickname;
          delete presence[oldUsername];
          localStorage.setItem('aurora_presence',JSON.stringify(presence));
        }
      }catch(e){}
    }else if(nicknameChanged){
      // Only nickname changed
      if(users[oldUsername]){
        users[oldUsername].nickname=newNickname;
        saveUsers(users);
      }
      currentUserData.nickname=newNickname;
      localStorage.setItem('chatbd_local_user_multi',JSON.stringify(currentUserData));
    }
    
    // Update the cloud
    if(isCloud&&db&&currentUser){
      try{
        const {doc,setDoc,updateDoc,deleteDoc}=AURORA_SB;
        
        if(usernameChanged){
          // Create new username mapping
          await setDoc(doc(db,'usernames',newUsernameRaw),{
            uid:currentUser.uid,
            username:newUsernameRaw,
            nickname:newNickname
          },{merge:true});
          // Delete old username mapping
          try{await deleteDoc(doc(db,'usernames',oldUsername));}catch(e){}
          
          // Update user document
          await setDoc(doc(db,'users',currentUser.uid),{
            username:newUsernameRaw,
            nickname:newNickname,
            usernameChangedAt:new Date(),
            previousUsername:oldUsername
          },{merge:true});
          
          // Update presence document
          await setDoc(doc(db,'presence',newUsernameRaw),{
            online:true,
            lastSeen:Date.now(),
            username:newUsernameRaw,
            nickname:newNickname
          },{merge:true});
          try{await deleteDoc(doc(db,'presence',oldUsername));}catch(e){}
        }else if(nicknameChanged){
          // Only update nickname
          await setDoc(doc(db,'users',currentUser.uid),{
            nickname:newNickname,
            nicknameUpdatedAt:new Date()
          },{merge:true});
          // Update username mapping
          await setDoc(doc(db,'usernames',oldUsername),{
            nickname:newNickname
          },{merge:true});
        }
      }catch(e){console.log('Cloud profile update fail',e.message);}
    }
    
    // Update UI
    $('#myName').textContent=newNickname;
    $('#myStatus').textContent='Updated ✓';
    $('#welcomeNickname').textContent=`@${currentUserData.username} • ${newNickname}`;
    
    // Reload contacts
    if(!isCloud) contacts=loadUserContacts(currentUserData.username);
    renderChats();
    
    // Close modal
    $('#editProfileModal').classList.remove('show');
    showToast({
      title:'Profile Updated ✅',
      body:usernameChanged?`Username changed to @${newUsernameRaw}`:`Display name changed to ${newNickname}`,
      color:'#10b981',
      avatar:'✓'
    });
    
    setTimeout(()=>{$('#myStatus').textContent='Tap to edit ✏️';},3000);
    
  }catch(e){
    alert('Error saving profile: '+e.message);
    console.log('Profile save error',e);
  }finally{
    btn.disabled=false;
    btn.textContent=origText;
  }
});

// Close modal on outside click
$('#editProfileModal')?.addEventListener('click',(e)=>{
  if(e.target.id==='editProfileModal') e.target.classList.remove('show');
});

// 🎨 Theme System
const THEMES=[
  {id:'aurora',name:'Aurora Blue',desc:'Default premium blue theme',color:'#2563eb',icon:'◆'},
  {id:'midnight',name:'Midnight Dark',desc:'Dark mode for night owls',color:'#1e293b',icon:'🌙'},
  {id:'black',name:'Black Mode',desc:'Pure black surfaces · same dark-mode layout',color:'#000000',icon:'◐'},
  {id:'ocean',name:'Ocean Blue',desc:'Calm blue ocean vibes',color:'#0ea5e9',icon:'🌊'},
  {id:'rose',name:'Rose Pink',desc:'Elegant pink & rose',color:'#e11d48',icon:'🌸'},
  {id:'forest',name:'Forest Green',desc:'Natural green theme',color:'#059669',icon:'🌲'},
  {id:'sunset',name:'Sunset Orange',desc:'Warm sunset colors',color:'#ea580c',icon:'🌅'}
];

let currentTheme=localStorage.getItem('aurora_theme')||'aurora';

// Apply theme on load
function applyTheme(themeId){
  const theme=THEMES.find(t=>t.id===themeId);
  if(!theme) return;
  if(themeId==='aurora'){
    document.body.removeAttribute('data-theme');
  }else{
    document.body.setAttribute('data-theme',themeId);
  }
  currentTheme=themeId;
  localStorage.setItem('aurora_theme',themeId);
  // Match browser chrome to the selected theme (including OLED black).
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta) themeMeta.content=themeId==='black'?'#000000':themeId==='midnight'?'#0f172a':theme.color;
  // Keep splash light / brand-aligned
  const splash=document.querySelector('.splash');
  if(splash){
    splash.style.background=`radial-gradient(800px 500px at 50% 0%, ${theme.color}22 0%, #f8fafc 55%, #f8fafc 100%)`;
  }
}

// Open theme modal
function openThemeModal(){
  const modal=document.getElementById('themeModal');
  if(!modal) return;
  // Populate theme cards
  const container=modal.querySelector('.theme-grid');
  if(!container) return;
  container.innerHTML=THEMES.map(theme=>`
    <div class="theme-card ${currentTheme===theme.id?'active':''}" data-theme-id="${theme.id}" onclick="selectTheme('${theme.id}')">
      <div class="theme-preview" style="background:${theme.color};">${theme.icon}</div>
      <div class="theme-info">
        <div class="theme-name">${theme.name}</div>
        <div class="theme-desc">${theme.desc}</div>
      </div>
      <div class="theme-check">✓</div>
    </div>
  `).join('');
  modal.classList.add('show');
}

// Select theme
function selectTheme(themeId){
  if(!THEMES.some(t=>t.id===themeId)) return;
  // The legacy palette picker and Appearance mode picker share one preference.
  if(themeId==='black' || themeId==='midnight' || themeId==='aurora'){
    applyThemeMode(themeId==='black'?'black':themeId==='midnight'?'dark':'light');
  }else{
    try{localStorage.removeItem('aurora_theme_mode');}catch(e){}
    applyTheme(themeId);
  }
  try{refreshAppearanceUI();refreshSettingsUI();}catch(e){}
  // Update active state in modal
  const cards=document.querySelectorAll('.theme-card');
  cards.forEach(card=>{
    card.classList.remove('active');
    if(card.dataset.themeId===themeId){
      card.classList.add('active');
    }
  });
  showToast({
    title:'Theme Changed 🎨',
    body:`${THEMES.find(t=>t.id===themeId)?.name||'Theme'} applied!`,
    color:THEMES.find(t=>t.id===themeId)?.color||'#7c3aed',
    avatar:'✓'
  });
  // Re-render to update colors
  setTimeout(()=>{renderChats();},100);
}

// Make functions global
window.openThemeModal=openThemeModal;
window.selectTheme=selectTheme;

// Sidebar menu toggle
window.toggleSidebarMenu=function(e){
  e.stopPropagation();
  const menu=document.getElementById('sidebarMenu');
  if(!menu) return;
  
  if(menu.style.display==='none'){
    // Get button position
    const btn=e.currentTarget;
    const rect=btn.getBoundingClientRect();
    const shell=document.getElementById('phoneShell')||document.body;
    const sRect=shell.getBoundingClientRect();
    menu.style.top=(rect.bottom-sRect.top+8)+'px';
    menu.style.right=Math.max(8, sRect.right-rect.right)+'px';
    menu.style.left='auto';
    menu.style.display='block';
    
    // Update notification text
    const notifText=document.getElementById('sidebarNotifText');
    if(notifText){
      const notifBtn=document.getElementById('notifBtn');
      notifText.textContent=notifBtn&&notifBtn.textContent==='🔕'?'Notifications Off':'Notifications On';
    }
  }else{
    menu.style.display='none';
  }
};

// Close sidebar menu on outside click
document.addEventListener('click',()=>{
  const menu=document.getElementById('sidebarMenu');
  if(menu) menu.style.display='none';
});

// Apply saved theme on load
applyTheme(currentTheme);

/* ==================== 🖌️ CHAT BACKGROUND COLOR SYSTEM ==================== */
const CHAT_BG_SOLID=[
  {id:'default',name:'Default',css:'none',color:'#f1f5f9'},
  {id:'soft-blue',name:'Soft Blue',css:'#e0f2fe',color:'#e0f2fe'},
  {id:'soft-pink',name:'Soft Pink',css:'#fce7f3',color:'#fce7f3'},
  {id:'soft-green',name:'Soft Green',css:'#dcfce7',color:'#dcfce7'},
  {id:'soft-yellow',name:'Soft Yellow',css:'#fef9c3',color:'#fef9c3'},
  {id:'soft-purple',name:'Soft Purple',css:'#f3e8ff',color:'#f3e8ff'},
  {id:'soft-orange',name:'Soft Orange',css:'#ffedd5',color:'#ffedd5'},
  {id:'soft-cyan',name:'Soft Cyan',css:'#cffafe',color:'#cffafe'},
  {id:'dark-navy',name:'Dark Navy',css:'#0f172a',color:'#0f172a'},
  {id:'dark-slate',name:'Dark Slate',css:'#1e293b',color:'#1e293b'},
  {id:'dark-green',name:'Dark Forest',css:'#14532d',color:'#14532d'},
  {id:'dark-wine',name:'Dark Wine',css:'#4c0519',color:'#4c0519'}
];
const CHAT_BG_GRADIENT=[
  {id:'grad-sunset',name:'Sunset',css:'linear-gradient(135deg,#ff6b6b 0%,#feca57 100%)',color:'linear-gradient(135deg,#ff6b6b,#feca57)'},
  {id:'grad-ocean',name:'Ocean',css:'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',color:'linear-gradient(135deg,#667eea,#764ba2)'},
  {id:'grad-aurora',name:'Aurora',css:'linear-gradient(135deg,#7c3aed 0%,#06b6d4 100%)',color:'linear-gradient(135deg,#7c3aed,#06b6d4)'},
  {id:'grad-forest',name:'Forest',css:'linear-gradient(135deg,#11998e 0%,#38ef7d 100%)',color:'linear-gradient(135deg,#11998e,#38ef7d)'},
  {id:'grad-rose',name:'Rose',css:'linear-gradient(135deg,#ee9ca7 0%,#ffdde1 100%)',color:'linear-gradient(135deg,#ee9ca7,#ffdde1)'},
  {id:'grad-night',name:'Night',css:'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)',color:'linear-gradient(135deg,#0f0c29,#302b63)'},
  {id:'grad-peach',name:'Peach',css:'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)',color:'linear-gradient(135deg,#ffecd2,#fcb69f)'},
  {id:'grad-mint',name:'Mint',css:'linear-gradient(135deg,#a8edea 0%,#fed6e3 100%)',color:'linear-gradient(135deg,#a8edea,#fed6e3)'}
];
const CHAT_BG_PATTERN=[
  {id:'pat-dots',name:'Dots',css:'radial-gradient(circle,#94a3b8 1px,transparent 1px)',size:'20px 20px',color:'repeating-radial-gradient(circle,#94a3b8 1px,transparent 1px) 0 0/20px 20px'},
  {id:'pat-grid',name:'Grid',css:'linear-gradient(#e2e8f0 1px,transparent 1px),linear-gradient(90deg,#e2e8f0 1px,transparent 1px)',size:'24px 24px',color:'linear-gradient(#e2e8f0 1px,transparent 1px),linear-gradient(90deg,#e2e8f0 1px,transparent 1px)'},
  {id:'pat-waves',name:'Waves',css:'repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(124,58,237,.06) 10px,rgba(124,58,237,.06) 20px)',color:'repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(124,58,237,.06) 10px,rgba(124,58,237,.06) 20px)'},
  {id:'pat-circles',name:'Circles',css:'radial-gradient(circle at 50% 50%,rgba(124,58,237,.08) 0%,transparent 50%)',size:'40px 40px',color:'radial-gradient(circle at 50% 50%,rgba(124,58,237,.08) 0%,transparent 50%)'}
];

function getChatBg(roomId){
  try{
    const perChat=JSON.parse(localStorage.getItem('aurora_chat_bg_per')||'{}');
    if(perChat[roomId]) return perChat[roomId];
  }catch(e){}
  return localStorage.getItem('aurora_chat_bg_global')||'default';
}

function saveChatBg(roomId, bgId, applyAll){
  if(applyAll){
    localStorage.setItem('aurora_chat_bg_global',bgId);
    try{localStorage.removeItem('aurora_chat_bg_per');}catch(e){}
  }else{
    try{
      const perChat=JSON.parse(localStorage.getItem('aurora_chat_bg_per')||'{}');
      perChat[roomId]=bgId;
      localStorage.setItem('aurora_chat_bg_per',JSON.stringify(perChat));
    }catch(e){}
  }
}

function findBgDef(bgId){
  let def=CHAT_BG_SOLID.find(x=>x.id===bgId);
  if(def) return {type:'solid',def};
  def=CHAT_BG_GRADIENT.find(x=>x.id===bgId);
  if(def) return {type:'gradient',def};
  def=CHAT_BG_PATTERN.find(x=>x.id===bgId);
  if(def) return {type:'pattern',def};
  return {type:'solid',def:CHAT_BG_SOLID[0]};
}

function applyChatBg(roomId){
  const bgId=getChatBg(roomId);
  const bgEl=document.getElementById('chatBgColor');
  const wpEl=document.querySelector('.wallpaper');
  if(!bgEl) return;
  /* FEATURE: onno device-theke set kora theme thakle sync kore nei */
  try{ syncWallpaperFromMessages(roomId); }catch(e){}
  /* FEATURE: Gallery custom photo wallpaper — color/pattern-er age apply hoy */
  const photo=getChatWallpaper(roomId);
  if(photo){
    bgEl.style.display='block';
    if(wpEl) wpEl.classList.add('hidden');
    bgEl.style.background='#0f172a';
    bgEl.style.backgroundImage=`url("${photo}")`;
    bgEl.style.backgroundSize='cover';
    bgEl.style.backgroundPosition='center';
    bgEl.style.backgroundRepeat='no-repeat';
    return;
  }
  if(bgId==='default'){
    bgEl.style.display='none';
    if(wpEl) wpEl.classList.remove('hidden');
    return;
  }
  const {type,def}=findBgDef(bgId);
  bgEl.style.display='block';
  if(wpEl) wpEl.classList.add('hidden');
  if(type==='solid'){
    bgEl.style.background=def.css;
    bgEl.style.backgroundSize='';
  }else if(type==='gradient'){
    bgEl.style.background=def.css;
    bgEl.style.backgroundSize='';
  }else if(type==='pattern'){
    bgEl.style.background='#f8fafc '+def.css;
    bgEl.style.backgroundSize=def.size||'auto';
  }
}

function openChatColorModal(){
  if(!currentRoomId){showToast({title:'Open a chat first',body:'Age ekta chat open koro',color:'#f59e0b',avatar:'!'});return;}
  const modal=document.getElementById('chatColorModal');
  if(!modal) return;
  const currentBg=getChatBg(currentRoomId);
  const contact=contacts.find(c=>c.id===currentRoomId);
  document.getElementById('chatColorSubtitle').textContent=`Background for ${contact?.nickname||contact?.name||'this chat'}`;
  // Render solid colors
  const solidC=document.getElementById('solidColors');
  solidC.innerHTML=CHAT_BG_SOLID.map(s=>`
    <div class="chatbg-swatch ${currentBg===s.id?'active':''}" onclick="pickChatBg('${s.id}')" style="background:${s.color};${s.id==='default'?'background:linear-gradient(135deg,#f1f5f9,#e2e8f0);':''}">
      <div class="check">✓</div>
      ${s.id==='default'?'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#64748b;">DEFAULT</div>':''}
    </div>
  `).join('');
  // Render gradients
  const gradC=document.getElementById('gradientColors');
  gradC.innerHTML=CHAT_BG_GRADIENT.map(g=>`
    <div class="chatbg-swatch ${currentBg===g.id?'active':''}" onclick="pickChatBg('${g.id}')" style="background:${g.color};">
      <div class="check">✓</div>
    </div>
  `).join('');
  // Render patterns
  const patC=document.getElementById('patternColors');
  patC.innerHTML=CHAT_BG_PATTERN.map(p=>`
    <div class="chatbg-swatch ${currentBg===p.id?'active':''}" onclick="pickChatBg('${p.id}')" style="background:#f8fafc ${p.color};background-size:${p.size||'auto'};">
      <div class="check">✓</div>
    </div>
  `).join('');
  document.getElementById('applyAllChats').checked=!!localStorage.getItem('aurora_chat_bg_global');
  refreshWallpaperUI();
  modal.classList.add('show');
}

function pickChatBg(bgId){
  if(!currentRoomId) return;
  const applyAll=document.getElementById('applyAllChats').checked;
  /* Photo wallpaper active thakle sorai — nahole photo color-er upore theke jabe */
  try{
    const _active=getChatWallpaper(currentRoomId);
    if(_active){
      const per=JSON.parse(localStorage.getItem(WP_PER_KEY)||'{}');
      delete per[currentRoomId];
      localStorage.setItem(WP_PER_KEY,JSON.stringify(per));
      if(getChatWallpaper(currentRoomId)===_active) localStorage.removeItem(WP_GLOBAL_KEY);
      /* THEME SYNC: onno side-eo photo sorai */
      _wpLocalHold=Date.now();
      sendWallpaperSyncMsg(currentRoomId,'');
    }
  }catch(e){}
  saveChatBg(currentRoomId,bgId,applyAll);
  applyChatBg(currentRoomId);
  // Update swatches
  document.querySelectorAll('.chatbg-swatch').forEach(s=>s.classList.remove('active'));
  event?.target?.closest('.chatbg-swatch')?.classList.add('active');
  const {def}=findBgDef(bgId);
  showToast({
    title:'Chat Background 🖌️',
    body:applyAll?`${def.name} — applied to all chats`:`${def.name} — applied to this chat`,
    color:'#7c3aed',
    avatar:'✓'
  });
}

function resetChatBg(){
  if(!currentRoomId) return;
  const applyAll=document.getElementById('applyAllChats').checked;
  if(applyAll){
    localStorage.removeItem('aurora_chat_bg_global');
    localStorage.removeItem('aurora_chat_bg_per');
  }else{
    try{
      const perChat=JSON.parse(localStorage.getItem('aurora_chat_bg_per')||'{}');
      delete perChat[currentRoomId];
      localStorage.setItem('aurora_chat_bg_per',JSON.stringify(perChat));
    }catch(e){}
  }
  /* Custom photo wallpaper-o clear kori */
  try{
    const per=JSON.parse(localStorage.getItem(WP_PER_KEY)||'{}');
    delete per[currentRoomId];
    localStorage.setItem(WP_PER_KEY,JSON.stringify(per));
    if(applyAll) localStorage.removeItem(WP_GLOBAL_KEY);
    if(getChatWallpaper(currentRoomId)){ _wpLocalHold=Date.now(); sendWallpaperSyncMsg(currentRoomId,''); }
  }catch(e){}
  applyChatBg(currentRoomId);
  openChatColorModal();
  showToast({title:'Chat Background 🖌️',body:'Reset to default',color:'#64748b',avatar:'↺'});
}

// Make functions global
window.openChatColorModal=openChatColorModal;
window.pickChatBg=pickChatBg;
window.resetChatBg=resetChatBg;

/* ===== FEATURE: 🖼️ Custom Photo Wallpaper (Gallery theke) =====
   Conversation-e gallery-er photo chat theme/background hishebe set kora jay.
   - Photo compress hoy (max 1280px, JPEG ~72%) — localStorage quota-friendly
   - Per-room save hoy ("Apply to all chats" checkbox-e global)
   - Photo thakle solid/gradient/pattern-er age dekhabe; Remove korle age-r bg fire ashbe */
const WP_PER_KEY='aurora_chat_wp_per';
const WP_GLOBAL_KEY='aurora_chat_wp_global';
function getChatWallpaper(roomId){
  if(!roomId) return null;
  try{
    const per=JSON.parse(localStorage.getItem(WP_PER_KEY)||'{}');
    if(per[roomId]) return per[roomId];
  }catch(e){}
  try{ const g=localStorage.getItem(WP_GLOBAL_KEY); if(g) return g; }catch(e){}
  return null;
}
function _setChatWallpaper(roomId,dataUrl,applyAll){
  try{
    if(applyAll){
      if(dataUrl) localStorage.setItem(WP_GLOBAL_KEY,dataUrl);
      else localStorage.removeItem(WP_GLOBAL_KEY);
    }else{
      let per={};
      try{ per=JSON.parse(localStorage.getItem(WP_PER_KEY)||'{}')||{}; }catch(pe){ per={}; }
      if(dataUrl) per[roomId]=dataUrl; else delete per[roomId];
      try{ localStorage.setItem(WP_PER_KEY,JSON.stringify(per)); }
      catch(qe){
        showToast({title:'⚠️ Storage full',body:'Photo set hoy nai — choto image try korun or purano media delete korun',color:'#ef4444',avatar:'🗄️'});
      }
    }
  }catch(e){
    showToast({title:'Wallpaper save fail',body:String(e&&e.message||e).slice(0,100),color:'#ef4444',avatar:'!'});
  }
}
function _compressImageFile(file,maxDim,quality,cb){
  try{
    if(!file||!file.type||!String(file.type).startsWith('image/')){
      showToast({title:'Invalid file',body:'Image select koroni — gallery theke photo din',color:'#ef4444',avatar:'!'}); return;
    }
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        try{
          let w=img.width||maxDim, h=img.height||maxDim;
          const scale=Math.min(1, maxDim/Math.max(w,h));
          w=Math.max(1,Math.round(w*scale)); h=Math.max(1,Math.round(h*scale));
          const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
          const cx=cv.getContext('2d');
          cx.drawImage(img,0,0,w,h);
          cb(cv.toDataURL('image/jpeg',quality));
        }catch(e){ showToast({title:'Photo process fail',body:String(e&&e.message||e).slice(0,100),color:'#ef4444',avatar:'!'}); }
      };
      img.onerror=()=>showToast({title:'Photo load fail',body:'Onno image try korun',color:'#ef4444',avatar:'!'});
      img.src=fr.result;
    };
    fr.onerror=()=>showToast({title:'File read fail',body:'Abar try korun',color:'#ef4444',avatar:'!'});
    fr.readAsDataURL(file);
  }catch(e){ showToast({title:'Gallery photo load fail',body:String(e&&e.message||e).slice(0,100),color:'#ef4444',avatar:'!'}); }
}
window.handleWallpaperPick=function(input){
  const file=input&&input.files&&input.files[0];
  if(!file){ return; }
  if(!currentRoomId){ showToast({title:'Open a chat first',body:'Age ekta chat open koro',color:'#f59e0b',avatar:'!'}); input.value=''; return; }
  const wpRoomId=currentRoomId; /* async-er bhitore room switch holeo thik room-e jabe */
  const applyAll=(document.getElementById('applyAllChats')||{}).checked||false;
  showToast({title:'⏳ Processing photo…',body:'Chat theme banacche',color:'#3b82f6',avatar:'🖼️'});
  _compressImageFile(file,1280,0.72,(dataUrl)=>{
    try{
      _wpLocalHold=Date.now();
      _setChatWallpaper(wpRoomId,dataUrl,applyAll);
      /* THEME SYNC: onno jon-o dekhuk — room-e sync message pathi */
      sendWallpaperSyncMsg(wpRoomId,dataUrl);
      applyChatBg(wpRoomId);
      refreshWallpaperUI();
      showToast({title:'Custom theme set ✅',body:applyAll?'Shob chat-e photo background lagano hoyeche':'Ei chat-e photo background — onno side-eo dekhabe',color:'#10b981',avatar:'🖼️'});
    }catch(e){ showToast({title:'Set fail',body:String(e&&e.message||e).slice(0,100),color:'#ef4444',avatar:'!'}); }
    try{ input.value=''; }catch(e){}
  });
};
window.removeChatWallpaper=function(){
  if(!currentRoomId) return;
  const active=getChatWallpaper(currentRoomId);
  try{
    const per=JSON.parse(localStorage.getItem(WP_PER_KEY)||'{}');
    delete per[currentRoomId];
    localStorage.setItem(WP_PER_KEY,JSON.stringify(per));
  }catch(e){}
  // jodi active photo-ta global theke eshe thake, seta-o remove kore dei
  try{ if(active && getChatWallpaper(currentRoomId)===active) localStorage.removeItem(WP_GLOBAL_KEY); }catch(e){}
  /* THEME SYNC: onno side-eo photo remove hok */
  _wpLocalHold=Date.now();
  sendWallpaperSyncMsg(currentRoomId,'');
  applyChatBg(currentRoomId);
  refreshWallpaperUI();
  showToast({title:'Photo removed 🗑️',body:'Age-r background fire ashche — onno side-eo',color:'#f59e0b',avatar:'🖼️'});
};
function refreshWallpaperUI(){
  try{
    const wp=getChatWallpaper(currentRoomId);
    const prev=document.getElementById('chatWpPreview');
    const rm=document.getElementById('chatWpRemoveBtn');
    if(prev){
      if(wp){ prev.style.backgroundImage=`url("${wp}")`; prev.style.backgroundSize='cover'; prev.style.backgroundPosition='center'; prev.style.backgroundRepeat='no-repeat'; prev.textContent=''; }
      else{ prev.style.backgroundImage=''; prev.textContent='📁'; }
    }
    if(rm) rm.style.display=wp?'block':'none';
  }catch(e){}
}
window.refreshWallpaperUI=refreshWallpaperUI;
window.getChatWallpaper=getChatWallpaper;

/* ==== 🔄 THEME SYNC — dui side-e dekhabe ====
   Wallpaper set/remove korle ekta special system message jail awto room-e
   (cloud: messages table + rooms row; local: room-er messages).
   Onno device/client oi message peye theme automatic apply kore — tai dui jon-e
   eki theme dekhe. system:true — tai notification/toast-i pay na. */
async function sendWallpaperSyncMsg(roomId,dataUrl){
  try{
    if(!roomId) return;
    const by=String(currentUserData?.username||'me');
    const label=dataUrl?('🎨 '+by+' set a custom chat theme'):('🎨 '+by+' reset the chat theme');
    if(isCloud && db && currentUser){
      const {collection,addDoc,serverTimestamp}=AURORA_SB;
      await addDoc(collection(db,'rooms',roomId,'messages'),{
        type:'wallpaper', wallpaper:String(dataUrl||''), setBy:by,
        senderId:currentUser.uid, senderName:by,
        senderNickname:currentUserData?.nickname||by,
        senderColor:currentUserData?.color||'#7c3aed',
        text:label, system:true, time:timeNow(), timestamp:serverTimestamp(), status:'sent'
      });
    }else{
      const rooms=getGlobalRooms(); const room=rooms[roomId]; if(!room) return;
      if(!Array.isArray(room.messages)) room.messages=[];
      room.messages.push({id:'wp_'+Date.now(), type:'wallpaper', wallpaper:String(dataUrl||''), setBy:by, system:true, text:label, time:timeNow(), timestamp:Date.now()});
      rooms[roomId]=room; saveGlobalRooms(rooms);
    }
  }catch(e){ try{console.log('wallpaper sync send fail',e&&e.message);}catch(_){} }
}
let _wpSyncBusy=false;
let _wpLocalHold=0; /* local user action-er por ektu sync pause — purano snapshot notun set override kore na */
function syncWallpaperFromMessages(roomId,msgs){
  if(!roomId||_wpSyncBusy) return false;
  if(Date.now()-(_wpLocalHold||0)<1500) return false;
  try{
    if(!Array.isArray(msgs)){
      if(window._msgCache && window._msgCache.roomId===roomId && Array.isArray(window._msgCache.msgs)) msgs=window._msgCache.msgs;
      else{ try{ const room=getGlobalRooms()[roomId]; if(room&&Array.isArray(room.messages)) msgs=room.messages; }catch(e){} }
    }
    if(!Array.isArray(msgs)) return false;
    let last=null; for(const m of msgs){ if(m&&m.type==='wallpaper') last=m; }
    if(!last) return false;
    const want=String(last.wallpaper||'');
    const cur=String(getChatWallpaper(roomId)||'');
    if(want===cur) return false;
    _wpSyncBusy=true;
    try{
      _setChatWallpaper(roomId, want||null, false);
      if(String(last.setBy||'').toLowerCase()!==String(currentUserData?.username||'').toLowerCase()){
        showToast({title:want?'🎨 Chat theme changed':'🎨 Chat theme reset', body:String(last.setBy||'Other user')+(want?' applied a custom theme':' removed the custom theme'), color:'#7c3aed', avatar:'🖼️'});
      }
      if(roomId===currentRoomId){ try{refreshWallpaperUI();}catch(e){} }
    }finally{ _wpSyncBusy=false; }
    return true;
  }catch(e){ return false; }
}
window.sendWallpaperSyncMsg=sendWallpaperSyncMsg;
window.syncWallpaperFromMessages=syncWallpaperFromMessages;
/* FEATURE-END: custom photo wallpaper */

// Hook the more button (⋮) menu
function openMoreMenu(){
  const menu=document.getElementById('moreMenu');
  const bd=document.getElementById('moreMenuBackdrop');
  if(!menu) return;
  buildMoreMenu();
  // center — clear any old absolute coords
  menu.style.top='auto';
  menu.style.left='auto';
  menu.style.right='auto';
  menu.style.bottom='auto';
  menu.style.display='block';
  if(bd){
    bd.style.display='flex';
    bd.classList.add('show');
  }
}
function closeMoreMenu(){
  const menu=document.getElementById('moreMenu');
  const bd=document.getElementById('moreMenuBackdrop');
  if(menu) menu.style.display='none';
  if(bd){ bd.style.display='none'; bd.classList.remove('show'); }
}
window.openMoreMenu=openMoreMenu;
window.closeMoreMenu=closeMoreMenu;

document.getElementById('moreBtn')?.addEventListener('click',(e)=>{
  e.stopPropagation();
  const menu=document.getElementById('moreMenu');
  if(!menu) return;
  const bd=document.getElementById('moreMenuBackdrop');
  const isOpen = (bd && bd.classList.contains('show')) || (menu.style.display==='block');
  if(isOpen) closeMoreMenu();
  else openMoreMenu();
});
// backdrop click closes
document.getElementById('moreMenuBackdrop')?.addEventListener('click',(e)=>{
  if(e.target && e.target.id==='moreMenuBackdrop') closeMoreMenu();
});

function buildMoreMenu(){
  if(!currentRoomId) return;
  const contact=contacts.find(c=>c.id===currentRoomId);
  if(!contact) return;
  const menu=document.getElementById('moreMenu');
  if(!menu) return;
  
  const otherU=contact.otherUsername||contact.username;
  const nickname=contact.nickname||contact.name;
  const avatarUrl=contact.avatarUrl||(contact.avatar&&contact.avatar.startsWith('data:')?contact.avatar:null);
  const isOn=isUserOnline(otherU);
  const statusText=isOn?'Online':'Offline';
  const statusColor=isOn?'#10b981':'#94a3b8';
  
  // Get settings
  const muteKey='aurora_mute_'+currentRoomId;
  const isMuted=localStorage.getItem(muteKey)==='1';
  const disappearKey='aurora_disappear_'+currentRoomId;
  const disappearTime=localStorage.getItem(disappearKey)||'off';
  const customNickKey='aurora_nick_'+currentRoomId;
  const customNick=localStorage.getItem(customNickKey)||'';
  const reactionKey='aurora_reaction_'+currentRoomId;
  const reaction=localStorage.getItem(reactionKey)||'❤️';
  const blocked=JSON.parse(localStorage.getItem('aurora_blocked')||'[]');
  const isBlocked=blocked.includes(otherU);
  
  const reactions=['❤️','👍','😂','😮','😢','😡'];
  
  menu.innerHTML=`
    <div class="mm-header">
      <div class="mmh-avatar" style="background:${avBg(contact,contact.color)};">
        ${avatarUrl?`<img src="${avatarUrl}">`:avHTML(contact)}
      </div>
      <div class="mmh-info">
        <div class="mmh-name">${esc(customNick||nickname)}</div>
        <div class="mmh-sub">
          <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
          ${statusText} • @${esc(otherU)}
        </div>
      </div>
    </div>
    
    <div class="mm-section">
      <div class="mm-label">Profile</div>
      <div class="mm-item" onclick="viewProfile();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#dbeafe;">👤</div>
        <div class="mmi-text">
          <div class="mmi-title">View Profile</div>
          <div class="mmi-desc">See full profile & info</div>
        </div>
        <div class="mmi-right">›</div>
      </div>
      <div class="mm-item" onclick="editNickname();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#fef3c7;">✏️</div>
        <div class="mmi-text">
          <div class="mmi-title">Nickname</div>
          <div class="mmi-desc">${customNick?esc(customNick):'Set a custom name'}</div>
        </div>
        <div class="mmi-right">${customNick?'✓':'›'}</div>
      </div>
    </div>
    
    <div class="mm-section">
      <div class="mm-label">Chat</div>
      <div class="mm-item" onclick="openChatColorModal();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#fae8ff;">🎨</div>
        <div class="mmi-text">
          <div class="mmi-title">Chat Theme</div>
          <div class="mmi-desc">Background colors & styles</div>
        </div>
        <div class="mmi-right">›</div>
      </div>
      <div class="mm-item" onclick="try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#fce7f3;">😊</div>
        <div class="mmi-text">
          <div class="mmi-title">Reaction Emoji</div>
          <div class="mmi-desc">Default tapback emoji</div>
        </div>
        <div class="mmi-right"><span class="mmi-val">${reaction}</span> ›</div>
      </div>
      <div class="mm-emoji-row">
        ${reactions.map(r=>`<div class="mm-emoji ${reaction===r?'active':''}" onclick="setReaction('${r}')">${r}</div>`).join('')}
      </div>
      <div class="mm-item" onclick="searchInChat();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#e0e7ff;">🔍</div>
        <div class="mmi-text">
          <div class="mmi-title">Search in Chat</div>
          <div class="mmi-desc">Find messages & media</div>
        </div>
        <div class="mmi-right">›</div>
      </div>
    </div>
    
    <div class="mm-section">
      <div class="mm-label">Privacy & Notifications</div>
      <div class="mm-item" onclick="toggleMuteChat()">
        <div class="mmi-icon" style="background:${isMuted?'#fef2f2':'#dcfce7'};">${isMuted?'🔕':'🔔'}</div>
        <div class="mmi-text">
          <div class="mmi-title">Mute Notifications</div>
          <div class="mmi-desc">${isMuted?'Notifications off':'Turn off alerts'}</div>
        </div>
        <div class="mm-toggle ${isMuted?'on':''}"></div>
      </div>
      <div class="mm-item" onclick="toggleDisappearing()">
        <div class="mmi-icon" style="background:#fef3c7;">⏱️</div>
        <div class="mmi-text">
          <div class="mmi-title">Disappearing Messages</div>
          <div class="mmi-desc">${disappearTime==='off'?'Off':'Auto-delete after '+disappearTime}</div>
        </div>
        <div class="mmi-right"><span class="mmi-val">${disappearTime==='off'?'Off':'✓'}</span> ›</div>
      </div>
    </div>
    
    <div class="mm-section">
      <div class="mm-item" onclick="clearChat();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="background:#fef3c7;">🗑️</div>
        <div class="mmi-text">
          <div class="mmi-title">Clear Chat</div>
          <div class="mmi-desc">Delete all messages</div>
        </div>
      </div>
      <div class="mm-item ${isBlocked?'':'danger'}" onclick="blockUser();try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}">
        <div class="mmi-icon" style="${isBlocked?'background:#dcfce7;':''}">${isBlocked?'✅':'🚫'}</div>
        <div class="mmi-text">
          <div class="mmi-title">${isBlocked?'Unblock User':'Block User'}</div>
          <div class="mmi-desc">${isBlocked?'Start receiving messages again':'Stop receiving messages'}</div>
        </div>
      </div>
    </div>
  `;
}

function setReaction(emoji){
  if(!currentRoomId) return;
  localStorage.setItem('aurora_reaction_'+currentRoomId,emoji);
  buildMoreMenu();
  showToast({title:'Reaction Updated',body:`Default emoji: ${emoji}`,avatar:emoji,color:'#7c3aed'});
}

function toggleMuteChat(){
  if(!currentRoomId) return;
  const key='aurora_mute_'+currentRoomId;
  const isMuted=localStorage.getItem(key)==='1';
  if(isMuted){
    localStorage.removeItem(key);
    showToast({title:'Notifications On',body:'You will receive alerts',avatar:'🔔',color:'#10b981'});
  }else{
    localStorage.setItem(key,'1');
    showToast({title:'Notifications Muted',body:'Alerts turned off for this chat',avatar:'🔕',color:'#64748b'});
  }
  buildMoreMenu();
}

function toggleDisappearing(){
  if(!currentRoomId) return;
  const key='aurora_disappear_'+currentRoomId;
  const current=localStorage.getItem(key)||'off';
  const options=['off','24h','7d','30d'];
  const labels=['Off','24 hours','7 days','30 days'];
  const idx=options.indexOf(current);
  const next=options[(idx+1)%options.length];
  if(next==='off'){
    localStorage.removeItem(key);
  }else{
    localStorage.setItem(key,next);
  }
  buildMoreMenu();
  showToast({title:'Disappearing Messages',body:next==='off'?'Disabled':'Messages will disappear after '+next,avatar:'⏱️',color:'#f59e0b'});
}

function editNickname(){
  if(!currentRoomId) return;
  const contact=contacts.find(c=>c.id===currentRoomId);
  if(!contact) return;
  
  // Store contact info for later use
  window._nicknameContact = contact;
  window._nicknameRoomId = currentRoomId;
  
  const current=localStorage.getItem('aurora_nick_'+currentRoomId)||'';
  const originalName=contact.nickname||contact.name;
  
  // Update modal content
  document.getElementById('nicknameOriginalName').textContent=originalName;
  document.getElementById('nicknameInput').value=current;
  
  // Show modal
  document.getElementById('nicknameModal').style.display='flex';
  
  // Focus input after animation
  setTimeout(()=>{
    document.getElementById('nicknameInput').focus();
    document.getElementById('nicknameInput').select();
  },300);
}

// Handle nickname save
document.getElementById('confirmNicknameBtn')?.addEventListener('click',()=>{
  const newNick=document.getElementById('nicknameInput').value.trim();
  const roomId=window._nicknameRoomId;
  
  if(!roomId) return;
  
  if(newNick===''){
    localStorage.removeItem('aurora_nick_'+roomId);
    showToast({title:'Nickname Removed',body:'Using original name',avatar:'✏️',color:'#64748b'});
  }else{
    localStorage.setItem('aurora_nick_'+roomId,newNick);
    showToast({title:'Nickname Set',body:newNick,avatar:'✏️',color:'#7c3aed'});
  }
  
  // Close modal and refresh
  document.getElementById('nicknameModal').style.display='none';
  renderChats();
  if(currentRoomId===roomId) openRoom(roomId);
});

// Handle Enter key in nickname input
document.getElementById('nicknameInput')?.addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){
    e.preventDefault();
    document.getElementById('confirmNicknameBtn').click();
  }
});

function searchInChat(){
  try{closeMoreMenu();}catch(e){document.getElementById('moreMenu').style.display='none';}
  // Remove existing search bar if any
  const existing=document.getElementById('chatSearchBar');
  if(existing){existing.remove();document.querySelectorAll('.search-sender-label').forEach(l=>l.remove());return;}
  // Create search bar
  const bar=document.createElement('div');
  bar.id='chatSearchBar';
  bar.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 16px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);z-index:10;flex-shrink:0;';
  bar.innerHTML=`
    <span style="color:#fff;font-size:16px;">🔍</span>
    <input type="text" id="chatSearchInput" placeholder="Search in chat..." style="flex:1;padding:8px 12px;border:none;border-radius:20px;font-size:13px;outline:none;background:rgba(255,255,255,.95);color:#0f172a;">
    <span id="chatSearchCount" style="color:#fff;font-size:11px;font-weight:600;min-width:40px;text-align:center;"></span>
    <button onclick="document.getElementById('chatSearchBar').remove();document.querySelectorAll('.bubble.search-hl').forEach(b=>{b.style.outline='';b.classList.remove('search-hl');});document.querySelectorAll('.search-sender-label').forEach(l=>l.remove());" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;">✕</button>
  `;
  // Insert before messages
  const msgEl=document.getElementById('messages');
  if(msgEl&&msgEl.parentNode){
    msgEl.parentNode.insertBefore(bar,msgEl);
    setTimeout(()=>{document.getElementById('chatSearchInput').focus();},100);
  }
  // Search logic
  document.getElementById('chatSearchInput').addEventListener('input',(e)=>{
    const q=e.target.value.toLowerCase().trim();
    const bubbles=document.querySelectorAll('#messages .bubble');
    // Clear previous highlights and sender labels
    bubbles.forEach(b=>{b.style.outline='';b.classList.remove('search-hl');});
    document.querySelectorAll('.search-sender-label').forEach(l=>l.remove());
    if(!q){document.getElementById('chatSearchCount').textContent='';return;}
    let found=0;let firstMatch=null;
    bubbles.forEach(b=>{
      if(b.textContent.toLowerCase().includes(q)){
        b.style.outline='3px solid #f59e0b';
        b.style.outlineOffset='2px';
        b.classList.add('search-hl');
        found++;
        if(!firstMatch) firstMatch=b;
        
        // Add sender label
        const msgRow=b.closest('.msg-row');
        if(msgRow){
          const isSent=msgRow.classList.contains('sent');
          const senderDiv=b.querySelector('.sender');
          let senderName='You';
          if(!isSent && senderDiv){
            senderName=senderDiv.textContent.trim();
          }else if(!isSent){
            // Try to get from contact
            const contact=contacts.find(c=>c.id===currentRoomId);
            if(contact) senderName=contact.nickname||contact.name;
          }
          
          // Create sender label
          const label=document.createElement('div');
          label.className='search-sender-label';
          label.style.cssText=`font-size:10px;font-weight:600;color:#f59e0b;margin-${isSent?'bottom':'top'}:4px;text-align:${isSent?'right':'left'};`;
          label.textContent=`From: ${senderName}`;
          
          // Insert label
          if(isSent){
            msgRow.insertBefore(label,b);
          }else{
            msgRow.insertBefore(label,msgRow.firstChild.nextSibling||b);
          }
        }
      }
    });
    document.getElementById('chatSearchCount').textContent=found>0?`${found} found`:'No match';
    if(firstMatch) firstMatch.scrollIntoView({behavior:'smooth',block:'center'});
  });
}

function blockUser(){
  if(!currentRoomId) return;
  const contact=contacts.find(c=>c.id===currentRoomId);
  if(!contact) return;
  const name=contact.nickname||contact.name;
  const otherU=contact.otherUsername||contact.username;
  // blocking is a personal action, but you can never block someone who outranks you
  if(getUserLevel(otherU, contact) >= myLevel() && getUserLevel(otherU, contact) >= ROLE_LEVELS.moderator){
    try{ showToast({title:'Not allowed',
      body:'@'+otherU+' is '+roleTitle(getUserLevel(otherU,contact)),
      color:'#ef4444', avatar:'🔒'}); }catch(e){}
    return;
  }
  const blocked=JSON.parse(localStorage.getItem('aurora_blocked')||'[]');
  const isBlocked=blocked.includes(otherU);
  
  if(isBlocked){
    // Unblock option
    if(!confirm(`Unblock ${name}?\n\nYou will start receiving messages from this user again.`)) return;
    unblockUser(otherU);
    showToast({title:'User Unblocked ✅',body:`${name} has been unblocked`,avatar:'✅',color:'#10b981'});
  }else{
    if(!confirm(`Block ${name}?\n\nYou won't receive messages or notifications from this user. Their messages will be hidden.`)) return;
    blocked.push(otherU);
    localStorage.setItem('aurora_blocked',JSON.stringify(blocked));
    showToast({title:'User Blocked 🚫',body:`${name} has been blocked`,avatar:'🚫',color:'#ef4444'});
  }
  renderMessagesForRoom(currentRoomId);
  buildMoreMenu();
}

// ⏱️ Disappearing messages - delete old messages based on timer
function applyDisappearingMessages(roomId){
  const setting=localStorage.getItem('aurora_disappear_'+roomId);
  if(!setting||setting==='off') return;
  const durations={'24h':86400000,'7d':604800000,'30d':2592000000};
  const maxAge=durations[setting];
  if(!maxAge) return;
  const cutoff=Date.now()-maxAge;
  // For local mode
  if(!isCloud||!db){
    const rooms=getGlobalRooms();
    const room=rooms[roomId];
    if(room&&room.messages){
      const before=room.messages.length;
      room.messages=room.messages.filter(m=>!m.timestamp||m.timestamp>=cutoff||m.system);
      if(room.messages.length<before){
        saveGlobalRooms(rooms);
        renderMessagesForRoom(roomId);
      }
    }
    return;
  }
  // For cloud mode
  (async()=>{
    try{
      const {collection,getDocs,deleteDoc,doc,query,where}=AURORA_SB;
      const snap=await getDocs(collection(db,'rooms',roomId,'messages'));
      let deleted=0;
      for(const d of snap.docs){
        const m=d.data();
        if(m.system) continue;
        const ts=m.timestamp?.toMillis?.()||m.timestamp?.seconds*1000||0;
        if(ts&&ts<cutoff){
          await deleteDoc(doc(db,'rooms',roomId,'messages',d.id));
          deleted++;
        }
      }
      if(deleted>0) renderMessagesForRoom(roomId, false);
    }catch(e){console.log('Disappearing messages error',e);}
  })();
}
window.applyDisappearingMessages=applyDisappearingMessages;

// Run disappearing messages check every minute
setInterval(()=>{
  if(currentRoomId) applyDisappearingMessages(currentRoomId);
},60000);

// 😊 Reaction/Tapback on messages - double tap to react
document.addEventListener('dblclick',async (e)=>{
  const bubble=e.target.closest('.bubble');
  if(!bubble||!currentRoomId) return;
  
  // Get message ID from the bubble
  const msgRow=bubble.closest('.msg-row');
  const msgId=msgRow?.dataset?.msgId;
  if(!msgId) return;
  
  const reaction=localStorage.getItem('aurora_reaction_'+currentRoomId)||'❤️';
  const isSent=bubble.classList.contains('sent');
  
  // Toggle reaction
  let existing=bubble.querySelector('.msg-reaction');
  const shouldRemove=!!existing;
  
  if(existing){
    existing.remove();
  }else{
    const rEl=document.createElement('div');
    rEl.className='msg-reaction';
    rEl.textContent=reaction;
    rEl.style.cssText='position:absolute;bottom:-10px;'+(isSent?'right:8px;':'left:8px;')+'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2px 6px;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.1);cursor:pointer;z-index:5;animation:reactionPop .3s ease;';
    rEl.onclick=(ev)=>{ev.stopPropagation();rEl.remove();removeReaction(msgId);};
    bubble.style.position='relative';
    bubble.appendChild(rEl);
  }
  
  // Save to the cloud or localStorage
  if(shouldRemove){
    await removeReaction(msgId);
  }else{
    await saveReaction(msgId,reaction);
  }
});

// Save reaction to the cloud or localStorage
async function saveReaction(msgId,reaction){
  if(isCloud && db){
    try{
      const {doc,updateDoc}=AURORA_SB;
      await updateDoc(doc(db,'rooms',currentRoomId,'messages',msgId),{
        reaction:reaction,
        reactionBy:currentUserData.username,
        reactionAt:Date.now()
      });
    }catch(e){console.log('Save reaction error',e);}
  }else{
    // Local storage mode
    const rooms=getGlobalRooms();
    const room=rooms[currentRoomId];
    if(room && room.messages){
      const msg=room.messages.find(m=>m.id===msgId);
      if(msg){
        msg.reaction=reaction;
        msg.reactionBy=currentUserData.username;
        msg.reactionAt=Date.now();
        saveGlobalRooms(rooms);
      }
    }
  }
}

// Remove reaction from the cloud or localStorage
async function removeReaction(msgId){
  if(isCloud && db){
    try{
      const {doc,updateDoc}=AURORA_SB;
      await updateDoc(doc(db,'rooms',currentRoomId,'messages',msgId),{
        reaction:null,
        reactionBy:null,
        reactionAt:null
      });
    }catch(e){console.log('Remove reaction error',e);}
  }else{
    // Local storage mode
    const rooms=getGlobalRooms();
    const room=rooms[currentRoomId];
    if(room && room.messages){
      const msg=room.messages.find(m=>m.id===msgId);
      if(msg){
        delete msg.reaction;
        delete msg.reactionBy;
        delete msg.reactionAt;
        saveGlobalRooms(rooms);
      }
    }
  }
}

// Add reaction animation CSS
if(!document.getElementById('reactionCSS')){
  const s=document.createElement('style');
  s.id='reactionCSS';
  s.textContent=`@keyframes reactionPop{from{transform:scale(0) translateY(10px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}`;
  document.head.appendChild(s);
}

// 🚫 Block filter - hide blocked user messages in rendering
function isUserBlocked(username){
  if(!username) return false;
  const blocked=JSON.parse(localStorage.getItem('aurora_blocked')||'[]');
  return blocked.includes(username);
}
window.isUserBlocked=isUserBlocked;

function unblockUser(username){
  const blocked=JSON.parse(localStorage.getItem('aurora_blocked')||'[]');
  const idx=blocked.indexOf(username);
  if(idx>-1){
    blocked.splice(idx,1);
    localStorage.setItem('aurora_blocked',JSON.stringify(blocked));
  }
}
window.unblockUser=unblockUser;

// Make all menu functions globally accessible
window.setReaction=setReaction;
window.toggleMuteChat=toggleMuteChat;
window.toggleDisappearing=toggleDisappearing;
window.editNickname=editNickname;
window.searchInChat=searchInChat;
window.blockUser=blockUser;
window.buildMoreMenu=buildMoreMenu;
// Close more menu on outside click
document.addEventListener('click',(e)=>{
  if(e.target && (e.target.closest && (e.target.closest('#moreMenu') || e.target.closest('#moreBtn')))) return;
  try{ closeMoreMenu(); }catch(err){
    const menu=document.getElementById('moreMenu');
    if(menu) menu.style.display='none';
  }
});

// View Profile function


window.viewProfile=async function(){
  /* FIX (profile not showing):
     1. The old code bailed out silently when `contacts` had not been
        rehydrated yet (fresh chat / after reload) -> nothing happened at all.
     2. It then `await`-ed two database reads BEFORE building the modal.
        On a slow/broken/offline connection those promises can hang forever,
        so the modal was never appended and the tap looked "dead".
     Now: always resolve a contact, and never let the network block the UI. */
  if(!currentRoomId){
    try{ showToast({title:'Open a chat first', body:'Kono chat open koro', color:'#f59e0b', avatar:'!'}); }catch(e){}
    return;
  }
  let contact=(contacts||[]).find(c=>c.id===currentRoomId);
  if(!contact){
    // rebuild a minimal contact from the room id so the sheet still opens
    try{
      const parts=String(currentRoomId).split('_');
      const guess=parts.find(p=>p && p!==currentUserData?.username)||parts[parts.length-1]||'user';
      const known=(getUsers()||{})[guess]||{};
      contact={
        id:currentRoomId,
        username:guess, otherUsername:guess,
        nickname:known.nickname||guess, name:known.nickname||guess,
        avatar:known.avatar||String(guess).slice(0,2).toUpperCase(),
        avatarUrl:known.avatarUrl||null,
        color:known.color||'#2563eb'
      };
    }catch(e){ return; }
  }
  const otherU=contact.otherUsername||contact.username||'';
  let userData=getUsers()[otherU]||{};

  if(isCloud && db && otherU){
    try{
      // hard 4s budget: if the cloud is slow we just show local data
      const _fbTimeout=(ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms));
      const {doc,getDoc}=await Promise.race([
        AURORA_SB,
        _fbTimeout(4000)
      ]);
      const _race=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
      let uid=null;
      try{
        const un=await _race(getDoc(doc(db,'usernames',otherU)),4000);
        if(un.exists()) uid=un.data().uid;
      }catch(e){}
      if(uid){
        const us=await _race(getDoc(doc(db,'users',uid)),4000);
        if(us.exists()){
          const d=us.data()||{};
          // merge without wiping non-empty local fields with empty cloud values
          const pick=(a,b)=>{
            const x=(a??''); const y=(b??'');
            const xs=String(x).trim(); const ys=String(y).trim();
            return ys ? y : (xs ? x : '');
          };
          userData={
            ...userData,
            ...d,
            nickname: pick(userData.nickname, d.nickname),
            bio: pick(userData.bio, d.bio),
            title: pick(userData.title, d.title),
            phone: pick(userData.phone, d.phone),
            email: pick(userData.email, d.email),
            avatarUrl: d.avatarUrl || userData.avatarUrl || null,
            color: d.color || userData.color || contact.color
          };
          try{
            const users=getUsers();
            const prev=users[otherU]||{username:otherU};
            users[otherU]={
              ...prev,
              username:otherU,
              nickname: pick(prev.nickname, userData.nickname) || otherU,
              avatar: userData.avatarUrl || userData.avatar || prev.avatar,
              avatarUrl: userData.avatarUrl || prev.avatarUrl || null,
              color: userData.color || prev.color || contact.color,
              bio: pick(prev.bio, userData.bio),
              title: pick(prev.title, userData.title),
              phone: pick(prev.phone, userData.phone),
              email: (userData.email && !String(userData.email).endsWith('@aurora-chat.app')) ? userData.email : (prev.email||''),
              recoveryEmail: userData.recoveryEmail || prev.recoveryEmail || '',
              verified: d.verified===true || d.isVerified===true || prev.verified===true,
              developer: d.developer===true || d.isDeveloper===true || d.role==='developer' || prev.developer===true || otherU==='khalid_01',
              isDeveloper: d.developer===true || d.isDeveloper===true || d.role==='developer' || prev.isDeveloper===true || otherU==='khalid_01',
              role: d.role || prev.role || (otherU==='khalid_01'?'developer':'')
            };
            if(users[otherU].developer){ try{ _developerCache[otherU]=true; }catch(e){} }
            if(users[otherU].verified){ try{ _verifiedCache[otherU]=true; }catch(e){} }
            saveUsers(users);
            userData = {...userData, ...users[otherU]};
          }catch(e){}
        }
      }
    }catch(e){ console.log('viewProfile fetch', e.message); }
  }

  const avatarUrl=contact.avatarUrl||userData.avatarUrl||(userData.avatar&&String(userData.avatar).startsWith('data:')?userData.avatar:null)||(contact.avatar&&String(contact.avatar).startsWith('data:')?contact.avatar:null);
  const isOn=isUserOnline(otherU);
  const lsText=formatLastSeen(getUserLastSeen(otherU));
  const displayName=localStorage.getItem('aurora_nick_'+currentRoomId)||userData.nickname||contact.nickname||contact.name||otherU;
  const title=(userData.title||contact.title||'').trim();
  // Bio from all known sources (never drop a non-empty saved bio)
  const bio = String(
    userData.bio ||
    contact.bio ||
    (getUsers()[otherU]||{}).bio ||
    ''
  ).trim();
  const phone=(userData.phone||contact.phone||'').trim();
  let email=(userData.email||'').trim();
  if(email.endsWith('@aurora-chat.app')) email='';
  const color=userData.color||contact.color||'#2563eb';
  const muted=localStorage.getItem('aurora_mute_'+currentRoomId)==='1';
  let blocked=false;
  try{ blocked=(JSON.parse(localStorage.getItem('aurora_blocked')||'[]')||[]).includes(otherU); }catch(e){}
  const customNick=localStorage.getItem('aurora_nick_'+currentRoomId)||'';

  let existingModal=document.getElementById('viewProfileModal');
  if(existingModal) existingModal.remove();
  const modal=document.createElement('div');
  modal.className='modal-overlay show';
  modal.id='viewProfileModal';

  const row=(label, value, icon)=>{
    if(!value) return '';
    return `<div class="vp-row">
      <div class="vp-row-ico">${icon}</div>
      <div class="vp-row-body">
        <div class="vp-row-label">${label}</div>
        <div class="vp-row-value">${esc(value)}</div>
      </div>
    </div>`;
  };

  const infoRows = [
    row('Display name', displayName, '👤'),
    row('Username', '@'+otherU, '🔗'),
    customNick ? row('Nickname (only you)', customNick, '✏️') : '',
    row('Title / Role', title, '💼'),
    row('Phone', phone, '📱'),
    row('Email', email, '✉️'),
    muted ? row('Notifications', 'Muted in this chat', '🔕') : '',
    blocked ? row('Block', 'You blocked this user', '🚫') : '',
  ].filter(Boolean).join('');

  modal.innerHTML=`
    <div class="modal vp-modal">
      <button type="button" class="vp-close" id="vpCloseBtn" aria-label="Close">✕</button>
      <div class="vp-hero">
        <div class="vp-avatar" style="background:${avatarUrl?'transparent':(color||'#2563eb')};">
          ${avatarUrl?`<img src="${avatarUrl}" alt="">`:avHTML({...contact, ...userData, nickname:displayName, username:otherU})}
          ${isOn?'<span class="vp-online" title="Online"></span>':''}
        </div>
        <h2 class="vp-name">${esc(displayName)}</h2>
        <p class="vp-user">@${esc(otherU)}${isUserVerified(otherU,userData)?verifiedBadgeHTML():''}</p>
        ${title?`<div class="vp-title-pill">${esc(title)}</div>`:''}
        ${roleBadgesHTML(otherU, userData)}
        <div class="vp-status-pill ${isOn?'on':'off'}">
          <span class="vp-dot"></span>
          ${isOn?'Online':esc(lsText||'Offline')}
        </div>
        ${bio?`<div class="vp-bio-line">${esc(bio)}</div>`:''}
        <div class="vp-actions vp-actions-top">
          <button type="button" class="btn btn-primary vp-msg" id="vpMsgBtn">Message</button>
          <button type="button" class="btn btn-primary vp-call" id="vpCallBtn">📞 Call</button>
        </div>
      </div>
      <div class="vp-section">
        <div class="vp-section-label">Profile information</div>
        <div class="vp-card">
          ${infoRows || `<div class="vp-empty">No extra profile details saved yet.</div>`}
        </div>
      </div>
    </div>
  `;
  modal.addEventListener('click',(e)=>{ if(e.target===modal) modal.remove(); });
  const host=document.getElementById('phoneShell')||document.body;
  host.appendChild(modal);
  document.getElementById('vpCloseBtn')?.addEventListener('click',()=>modal.remove());
  document.getElementById('vpMsgBtn')?.addEventListener('click',()=>{ modal.remove(); });
  document.getElementById('vpCallBtn')?.addEventListener('click',()=>{ modal.remove(); try{ startVoiceCall(); }catch(e){} });
};






// Clear Chat function
window.clearChat=function(){
  if(!currentRoomId) return;
  if(!confirm('Clear all messages in this chat?')) return;
  // Use existing clear logic
  try{
    if(typeof confirmClearChat==='function'){
      // Set pending and call directly
      window.pendingDeleteRoomId=currentRoomId;
      confirmClearChat();
    }
  }catch(e){console.log('Clear chat error',e);}
};
// Close modal on outside click
document.getElementById('chatColorModal')?.addEventListener('click',(e)=>{
  if(e.target.id==='chatColorModal') e.target.classList.remove('show');
});
/* ================== END CHAT BACKGROUND SYSTEM ================== */

function contactDisplayName(c){
  try{
    if(!c) return 'Chat';
    const otherU=String(c.otherUsername||c.username||'').toLowerCase();
    const prof=(getUsers&&getUsers()[otherU])||{};
    const profileName=prof.displayName||prof.nickname||prof.name||'';
    // Custom nickname stays optional, but both list and header use this same helper.
    const custom=(c.id && localStorage.getItem('aurora_nick_'+c.id))||'';
    return custom || profileName || c.displayName || c.nickname || c.name || c.otherNickname || c.username || otherU || 'Chat';
  }catch(e){ return (c&& (c.nickname||c.name||c.username)) || 'Chat'; }
}

function renderChats(){
  try{
    if(currentUserData && (!contacts || !contacts.length)){
      const re=loadUserContacts(currentUserData.username)||[];
      if(re.length) contacts=re;
    }
  }catch(e){}
  // SELF-HEAL: any conversation this list lost comes straight back from the
  // local index, so the user never has to add that person again.
  try{ contacts=healConversations(contacts); }catch(e){}
  try{ if(isCloud) repairPendingCloudRooms(); }catch(e){}
  const q=($('#searchInput')?.value||'').toLowerCase();
  let filtered=(contacts||[]).filter(c=>{
    if(!c) return false;
    const dn=contactDisplayName(c).toLowerCase();
    return !q || dn.includes(q) || String(c.name||'').toLowerCase().includes(q) || (c.username&&String(c.username).toLowerCase().includes(q)) || String(c.last||'').toLowerCase().includes(q) || String(c.nickname||'').toLowerCase().includes(q);
  });
  // NEWEST -> OLDEST: re-sorted on every paint, so a new message / a send /
  // a realtime snapshot push immediately moves that conversation to the top.
  sortContactsByRecency(filtered);
  // DURABILITY: everything we are about to paint is stored in the local index,
  // so a later rebuild cannot make these conversations disappear.
  try{ rememberConversationsFromRows(filtered); }catch(e){}
  const activeTab=document.querySelector('.filter-tabs .tab.active')?.dataset.filter || window._navFilter || 'all';

  // Active Now row
  try{ renderActiveNow(); }catch(e){}

  if(activeTab==='users'){
    const label=$('#recentLabel'); if(label) label.textContent='People';
    const an=$('#activeNowSection'); if(an) an.style.display='none';
    if(!q || q.length < 2){
      $('#chatList').innerHTML=`<div style="padding:28px 16px;text-align:center;color:#94a3b8;"><div style="font-size:28px;margin-bottom:8px;">🔍</div><div style="font-size:14px;font-weight:700;color:#0f172a;">Find People</div><div style="font-size:12px;margin-top:6px;line-height:1.5;">Search by username or display name</div></div>`;
      return;
    }
    const users=Object.values(getUsers()).filter(u=>u.username!==currentUserData?.username && (u.username.toLowerCase().includes(q) || (u.nickname&&u.nickname.toLowerCase().includes(q))));
    let html=users.map(u=>{
      const ava = avHTML(u);
      const bg = avBg(u,u.color);
      const vf=isUserVerified(u.username,u)?verifiedBadgeHTML('sm'):'';
      return `<div class="chat-item" data-username="${u.username}"><div class="avatar" style="background:${bg};overflow:hidden;">${ava}</div><div class="chat-info"><div class="chat-top"><div class="chat-name">${esc(u.nickname||u.username)}${vf}</div></div><div class="chat-bottom"><div class="chat-last">@${esc(u.username)} · Tap to chat</div></div></div></div>`;
    }).join('');
    if(isCloud) html+=`<div style="padding:8px;text-align:center;"><button class="btn btn-primary" style="font-size:10px;" onclick="searchCloudUsers('${q.replace(/'/g,"\\'")}')">Search in cloud: "${esc(q)}"</button><div id="fbSearchResult" style="margin-top:6px;"></div></div>`;
    if(!html) html=`<div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">No results</div>`;
    $('#chatList').innerHTML=html;
    document.querySelectorAll('.chat-item[data-username]').forEach(el=>el.addEventListener('click',()=>startChatWith(el.dataset.username)));
    return;
  }

  if(activeTab==='calls'){
    const label=$('#recentLabel'); if(label) label.textContent='Calls';
    const an=$('#activeNowSection'); if(an) an.style.display='none';
    $('#chatList').innerHTML=`<div style="padding:36px 20px;text-align:center;"><div style="width:64px;height:64px;border-radius:20px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">📞</div><div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px;">Voice Calls</div><div style="font-size:12px;color:#94a3b8;line-height:1.5;max-width:260px;margin:0 auto 16px;">Open a chat and tap the call button to start a voice call.</div><button class="btn btn-primary" style="border-radius:999px;padding:10px 18px;" onclick="switchBottomNav('chats')">Back to Chats</button></div>`;
    return;
  }

  const label=$('#recentLabel'); if(label) label.textContent=q?'Search Results':'Recent Messages';
  const an=$('#activeNowSection'); if(an) an.style.display=q?'none':'block';

  $('#chatList').innerHTML=filtered.map(c=>{
    const ava = avHTML(c);
    const ur=unreadCounts[c.id]||0;
    const otherU=c.otherUsername||c.username||'';
    const isOn=isUserOnline(otherU);
    const dotHtml=isOn?'<span class="online-dot pulse"></span>':'';
    const displayName=contactDisplayName(c);
    const isMuted=localStorage.getItem('aurora_mute_'+c.id)==='1';
    const muteIcon=isMuted?' <span style="font-size:11px;opacity:.55;">🔕</span>':'';
    const vfIcon=isUserVerified(otherU, c)?verifiedBadgeHTML('sm'):'';
    let lastText=c.last||'';
    if(lastText==='📷 Photo'||(c.last||'').includes('📷')) lastText='Sent a photo';
    else if((c.last||'').includes('🎥')) lastText='Sent a video';
    const note=getUserNote(otherU);
    const hasNotePreview=!!(note && note.text);
    let typingNow=false;
    try{ typingNow=(typeof isAnyoneTyping==='function') && isAnyoneTyping(c.id); }catch(e){}
    let lastPreview = hasNotePreview
      ? (`<span class="chat-note-inline"><b>${esc(note.emoji||'📝')} Note</b> · ${esc(String(note.text).slice(0,28))}</span>`)
      : esc(String(lastText).slice(0,42));
    // TYPING: live preview in the chat list row (no stamp while they type)
    if(typingNow) lastPreview='<span class="chat-typing-inline">typing<i></i><i></i><i></i></span>';
    // Messenger style: my own message reads "You: ..."
    if(!typingNow && !hasNotePreview && convLastIsMine(c) && !/^You:/.test(String(lastText))) lastPreview='You: '+lastPreview;
    const inlineTime=typingNow ? '' : convTimeLabel(c);
    const timeMs=Number(c._convActMs)||0;
    const inlineTimeHtml=inlineTime
      ? `<span class="chat-time-inline ${ur>0?'unread':''}" title="${esc(timeMs?convFullStamp(timeMs):'')}"><span class="chat-dot">·</span>${esc(inlineTime)}</span>`
      : '';
    let rightMeta='';
    if(ur>0) rightMeta=`<div class="unread-badge">${ur>99?'99+':ur}</div>`;
    else { try{ rightMeta=convSeenIndicatorHTML(c,convLastStatus(c)); }catch(e){ rightMeta=''; } }
    return `
    <div class="chat-item ${currentRoomId===c.id?'active':''}" data-id="${c.id}" oncontextmenu="openCtx(event,'${c.id}')">
      <div class="avatar" style="background:${avBg(c,c.color)};overflow:visible;position:relative;">${ava}${dotHtml}</div>
      <div class="chat-info">
        <div class="chat-top"><div class="chat-name">${esc(displayName)}${vfIcon}${muteIcon}</div></div>
        <div class="chat-bottom"><div class="chat-last ${ur>0?'unread':''}"><span class="chat-preview-text">${lastPreview}</span>${inlineTimeHtml}</div><div class="chat-meta-right">${rightMeta}</div></div>
      </div>
      <button class="del-btn" onclick="event.stopPropagation(); openDeleteModal('${c.id}','delete')">✕</button>
    </div>
  `}).join('')||`<div style="padding:36px 16px;text-align:center;color:#94a3b8;"><div style="font-size:36px;margin-bottom:12px;">💬</div><div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px;">No conversations yet</div><div style="font-size:12px;">Tap the compose button to start</div></div>`;

  filtered.forEach(c=>{
    const el=document.querySelector(`.chat-item[data-id="${c.id}"]`);
    if(el){
      el.addEventListener('click',()=>openRoom(c.id));
      let pressTimer=null;
      el.addEventListener('touchstart', (e)=>{pressTimer=setTimeout(()=>openCtx(e,c.id),600);},{passive:true});
      el.addEventListener('touchend', ()=>clearTimeout(pressTimer));
      el.addEventListener('touchmove', ()=>clearTimeout(pressTimer));
    }
  });
}


/* ===== Messenger-style Notes ===== */
const NOTE_KEY = 'aurora_notes_v1'; // {username:{text,emoji,ts,exp}}
const NOTE_HOURS = 24;

function _notesAll(){
  try{ return JSON.parse(localStorage.getItem(NOTE_KEY)||'{}') || {}; }catch(e){ return {}; }
}
function _notesSaveAll(map){
  try{ localStorage.setItem(NOTE_KEY, JSON.stringify(map||{})); }catch(e){}
}
function getUserNote(username){
  if(!username) return null;
  const un=String(username).toLowerCase();
  const map=_notesAll();
  let n=map[un];
  if(!n || !n.text) return null;
  const tomb=noteTombTs(un);
  if(tomb && Number(n.ts||0)<=tomb){        // a deleted note can never come back
    delete map[un]; _notesSaveAll(map); return null;
  }
  const exp=Number(n.exp||0);
  if(exp && Date.now()>exp){
    delete map[un]; _notesSaveAll(map); return null;
  }
  return n;
}
function setUserNoteLocal(username, note){
  const un=String(username).toLowerCase();
  const map=_notesAll();
  if(!note || !note.text){ delete map[un]; }
  else map[un]=note;
  _notesSaveAll(map);
}

/* ===== NOTE CLEAR PROPAGATION (deleted note must vanish for EVERYONE) =====
   BUG: deleting a note only wrote empty note fields into the presence doc, and
   every other client's presence handler began with  if(data.note){ ... } .
   An empty (or expired) note therefore fell through that branch, so the OLD
   text stayed in their local note map - the deleted note kept showing in Active
   Now and in chat rows until the 24h expiry, or forever. A cloud note doc with
   text:'' had exactly the same effect, and refreshNotesForContacts() re-read
   that stale local copy every minute (fetchNote returns local first).

   FIX: an explicit clear/expiry now (a) deletes the local copy, (b) writes a
   tombstone with the timestamp of the note it kills, so no cache or read path
   can bring the old text back, and (c) publishes noteTs/noteClearedAt so other
   devices can tombstone it too. A NEWER note always beats the tombstone. */
var NOTE_TOMB_KEY='aurora_note_deleted_v1';
function _noteTombs(){ try{ return JSON.parse(localStorage.getItem(NOTE_TOMB_KEY)||'{}')||{}; }catch(e){ return {}; } }
function _noteTombSave(o){ try{ localStorage.setItem(NOTE_TOMB_KEY,JSON.stringify(o||{})); }catch(e){} }
function noteTombTs(username){ try{ return Number(_noteTombs()[String(username||'').toLowerCase()]||0)||0; }catch(e){ return 0; } }
function _noteTombClear(username){
  try{ const un=String(username||'').toLowerCase(); const t=_noteTombs();
       if(t[un]!==undefined){ delete t[un]; _noteTombSave(t); } }catch(e){}
}
/* Hard-clear a note + remember WHEN it was killed (stamp = the note's own ts). */
function forgetUserNote(username, stamp){
  try{
    const un=String(username||'').toLowerCase(); if(!un) return;
    const map=_notesAll();
    if(map[un]){ delete map[un]; _notesSaveAll(map); }
    const s=Number(stamp)||0;
    if(s){ const t=_noteTombs(); t[un]=Math.max(s, Number(t[un])||0); _noteTombSave(t); }
  }catch(e){}
}
/* Accept a note from any sync path, unless a deletion is newer than it. */
function rememberNoteIfNewer(username, note){
  try{
    const un=String(username||'').toLowerCase(); if(!un) return false;
    if(!note || !note.text){ forgetUserNote(un, Number(note&&note.ts)||0); return false; }
    const ts=Number(note.ts)||0, tomb=noteTombTs(un);
    if(tomb && ts<=tomb) return false;      // older than the deletion: ignore
    if(tomb) _noteTombClear(un);
    setUserNoteLocal(un, note);
    return true;
  }catch(e){ return false; }
}
/* One place that decides what a presence doc means for a note - the old inline
   `if(data.note)` check lived here and silently ignored deletions. */
function applyPresenceNote(username, data){
  try{
    const un=String(username||'').toLowerCase(); if(!un||!data) return false;
    const exp=Number(data.noteExp||0)||0, noteTs=Number(data.noteTs||0)||0;
    if(data.note && (!exp || Date.now()<=exp)){
      return rememberNoteIfNewer(un, {text:data.note, emoji:data.noteEmoji||'💬', ts:noteTs||Date.now(), exp:exp||0, username:un, nickname:data.nickname||un});
    }
    // cleared (or expired): drop the local copy and tombstone the note it kills
    const cached=getUserNote(un);
    const stamp=Math.max(noteTs, Number(data.noteClearedAt||0)||0, Number(cached&&cached.ts||0)||0, exp&&Date.now()>exp?exp:0);
    const had=!!(cached&&cached.text);
    forgetUserNote(un, stamp);
    return had;                              // true = a stale note was removed
  }catch(e){ return false; }
}
async function publishMyNote(text, emoji){
  if(!currentUserData) return null;
  const username=currentUserData.username;
  const clean=String(text||'').trim().slice(0,80);
  const em=String(emoji||'💬');
  if(!clean){
    // local: delete + tombstone (so a cached copy cannot resurrect the note)
    forgetUserNote(username, Date.now());
    const clearedAt=Date.now();
    // cloud: the clear itself carries a timestamp, so every other device can
    // tell "removed at X" from "never had one" and drop its cached copy.
    // Rich payload first; if a project's rules hasOnly() the old field list,
    // retry with the minimal legacy payload so the clear still propagates.
    try{
      if(isCloud && db){
        const {doc,setDoc}=AURORA_SB;
        const nick=currentUserData.nickname||username;
        try{
          await setDoc(doc(db,'notes',username),{text:'', emoji:'', ts:clearedAt, exp:0, clearedAt, username, nickname:nick}, {merge:true});
        }catch(e1){
          await setDoc(doc(db,'notes',username),{text:'', emoji:'', ts:clearedAt, exp:0, username, nickname:nick}, {merge:true});
        }
      }
    }catch(e){}
    try{
      if(isCloud && db){
        const {doc,setDoc}=AURORA_SB;
        try{
          await setDoc(doc(db,'presence',username),{note:'', noteEmoji:'', noteExp:0, noteTs:clearedAt, noteClearedAt:clearedAt}, {merge:true});
        }catch(e1){
          await setDoc(doc(db,'presence',username),{note:'', noteEmoji:'', noteExp:0}, {merge:true});
        }
      }
    }catch(e){}
    return null;
  }
  const ts=Date.now();
  const exp=ts + NOTE_HOURS*3600*1000;
  const note={text:clean, emoji:em, ts, exp, username, nickname:currentUserData.nickname||username};
  _noteTombClear(username);          // a brand new note replaces any earlier deletion
  setUserNoteLocal(username, note);
  try{
    if(isCloud && db){
      const {doc,setDoc}=AURORA_SB;
      await setDoc(doc(db,'notes',username), note, {merge:true});
      await setDoc(doc(db,'presence',username),{note:clean, noteEmoji:em, noteExp:exp, noteTs:ts}, {merge:true});
    }
  }catch(e){ console.log('publish note fail', e.message); }
  return note;
}
async function fetchNote(username){
  const un=String(username||'').toLowerCase();
  if(!un) return null;
  // local first
  let n=getUserNote(un);
  if(n) return n;
  if(!(isCloud && db)) return null;
  try{
    const {doc,getDoc}=AURORA_SB;
    const snap=await getDoc(doc(db,'notes',un));
    if(snap.exists()){
      const d=snap.data()||{};
      if(d.text && (!d.exp || Date.now()<=Number(d.exp))){
        const note={text:d.text, emoji:d.emoji||'💬', ts:d.ts||Date.now(), exp:d.exp||0, username:un, nickname:d.nickname||un};
        if(rememberNoteIfNewer(un, note)) return note;
        return null;
      }
      // owner deleted it (or it expired): kill the cached copy for good,
      // otherwise the old text would keep showing on this device.
      forgetUserNote(un, Math.max(Number(d.clearedAt||0)||0, Number(d.ts||0)||0));
    }
  }catch(e){}
  return null;
}
function notePreviewText(note){
  if(!note||!note.text) return '';
  const em=note.emoji? (note.emoji+' ') : '';
  return (em+note.text).trim();
}

/* --- Note auto-expiry (24h) + helpers --- */
function _noteRemaining(note){
  if(!note) return 0;
  const exp=Number(note.exp||0);
  if(!exp) return 0;
  return Math.max(0, exp - Date.now());
}
function _fmtRemaining(ms){
  if(ms<=0) return 'expired';
  const s=Math.floor(ms/1000);
  const h=Math.floor(s/3600);
  const m=Math.floor((s%3600)/60);
  if(h>0) return h+'h '+m+'m';
  const sec=s%60;
  if(m>0) return m+'m '+sec+'s';
  return sec+'s';
}
// Proactively remove expired notes (local + own cloud copy) and refresh UI.
function purgeExpiredNotes(){
  const map=_notesAll();
  const now=Date.now();
  let changed=false;
  let mineExpired=false;
  Object.keys(map).forEach(un=>{
    const n=map[un];
    const exp=Number((n&&n.exp)||0);
    if(n && exp && now>exp){
      forgetUserNote(un, exp);   // tombstone: an expired note must not come back
      changed=true;
      try{ if(currentUserData && un===String(currentUserData.username).toLowerCase()) mineExpired=true; }catch(e){}
    }
  });
  if(changed){
    _notesSaveAll(map);
    if(mineExpired){
      // clear my expired note from the cloud too
      (async()=>{ try{ await publishMyNote('', ''); }catch(e){} })();
    }
    try{ renderActiveNow(); }catch(e){}
    try{ renderChats(); }catch(e){}
  }
  return changed;
}
window.purgeExpiredNotes=purgeExpiredNotes;
// Sweep on load and every 30 seconds so notes disappear the moment 24h pass.
setTimeout(()=>{ try{ purgeExpiredNotes(); }catch(e){} }, 800);
setInterval(()=>{ try{ purgeExpiredNotes(); }catch(e){} }, 30000);

/* --- Live "expires in" countdown shown inside the note modal --- */
let _noteCountdownTimer=null;
function _stopNoteCountdown(){
  if(_noteCountdownTimer){ clearInterval(_noteCountdownTimer); _noteCountdownTimer=null; }
}
function _startNoteCountdown(getNote){
  _stopNoteCountdown();
  const tick=()=>{
    const sub=document.getElementById('noteSub');
    if(!sub) return;
    let note=null; try{ note=getNote(); }catch(e){ note=null; }
    if(!note || !note.text) return;
    const rem=_noteRemaining(note);
    if(rem<=0){
      sub.textContent='Expired — this note has been removed.';
      _stopNoteCountdown();
      try{ purgeExpiredNotes(); }catch(e){}
      try{ closeNoteModal(); }catch(e){}
      return;
    }
    sub.textContent='Visible to friends · auto-removes in '+_fmtRemaining(rem);
  };
  tick();
  _noteCountdownTimer=setInterval(tick, 1000);
}

let _noteModalMode='edit'; // edit | view
let _noteViewUser=null;
let _noteEmoji='';

function openMyNoteEditor(){
  if(!currentUserData){ showToast({title:'Login required', body:'Sign in to share a note', color:'#f59e0b', avatar:'!'}); return; }
  _noteModalMode='edit';
  _noteViewUser=null;
  const modal=document.getElementById('noteModal');
  if(!modal) return;
  const mine=getUserNote(currentUserData.username);
  _noteEmoji=(mine && mine.emoji) || '';
  document.getElementById('noteTitle').textContent='Your note';
  document.getElementById('noteSub').textContent='Friends see this for 24 hours in Active Now.';
  document.getElementById('noteInput').style.display='';
  document.getElementById('noteInput').value=mine?.text||'';
  document.getElementById('noteEmojiRow').style.display='flex';
  document.getElementById('noteEditActions').style.display='flex';
  document.getElementById('noteViewActions').style.display='none';
  document.getElementById('noteHint').textContent='Keep it short — max 80 characters.';
  document.getElementById('noteDeleteBtn').style.display = mine?.text ? '' : 'none';
  if(mine && mine.text){ _startNoteCountdown(()=>getUserNote(currentUserData.username)); }
  else { _stopNoteCountdown(); }
  // preview me
  const av=document.getElementById('notePreviewAv');
  const nm=document.getElementById('notePreviewName');
  const bd=document.getElementById('notePreviewBody');
  if(nm) nm.textContent=currentUserData.nickname||currentUserData.username||'You';
  if(av){
    av.style.background=avBg(currentUserData,currentUserData.color||'#2563eb');
    av.innerHTML=avHTML(currentUserData);
  }
  if(bd) bd.textContent= notePreviewText({text:mine?.text||'Write something...', emoji:_noteEmoji});
  const stage=document.getElementById('noteStageBubble');
  if(stage) stage.textContent= notePreviewText({text:mine?.text||'Write something...', emoji:_noteEmoji});
  document.querySelectorAll('#noteEmojiRow .note-emoji').forEach(b=>{
    b.classList.toggle('active', b.getAttribute('data-emoji')===_noteEmoji);
  });
  try{ _syncNotePreview(); }catch(e){}
  // show composer bits
  try{
    document.getElementById('noteEmojiLabel').style.display='';
    document.getElementById('noteInputWrap').style.display='';
  }catch(e){}
  modal.classList.add('show');
  modal.style.display='flex';
  setTimeout(()=>document.getElementById('noteInput')?.focus(), 150);
}

async function openUserNoteViewer(username, roomId){
  const un=String(username||'').toLowerCase();
  if(!un) return;
  if(currentUserData && un===currentUserData.username){ openMyNoteEditor(); return; }
  _noteModalMode='view';
  _noteViewUser=un;
  const modal=document.getElementById('noteModal');
  if(!modal) return;
  let note=getUserNote(un);
  if(!note) note=await fetchNote(un);
  const users=getUsers();
  const u=users[un]||{username:un,nickname:un};
  // contact fallback
  const c=(contacts||[]).find(x=>(x.otherUsername||x.username)===un);
  const name=c?.nickname||c?.name||u.nickname||un;
  document.getElementById('noteTitle').textContent=name + "'s note";
  document.getElementById('noteSub').textContent= note ? 'Shared in Active Now' : 'No active note';
  if(note && note.text){ _startNoteCountdown(()=> (getUserNote(un) || note)); }
  else { _stopNoteCountdown(); }
  document.getElementById('noteInput').style.display='none';
  document.getElementById('noteEmojiRow').style.display='none';
  document.getElementById('noteEditActions').style.display='none';
  document.getElementById('noteViewActions').style.display='flex';
  document.getElementById('noteHint').textContent= note?.ts ? ('Updated '+new Date(note.ts).toLocaleString()) : '';
  const av=document.getElementById('notePreviewAv');
  const nm=document.getElementById('notePreviewName');
  const bd=document.getElementById('notePreviewBody');
  const person={...(c||{}), ...u, username:un, nickname:name, avatarUrl:c?.avatarUrl||u.avatarUrl, avatar:c?.avatar||u.avatar, color:c?.color||u.color};
  if(nm) nm.textContent=name + (isUserVerified(un,person)?'':'') ;
  if(av){ av.style.background=avBg(person, person.color||'#2563eb'); av.innerHTML=avHTML(person); }
  if(bd) bd.textContent= note ? notePreviewText(note) : 'No note right now';
  // stash room for message button
  modal.dataset.roomId = roomId || (c && c.id) || '';
  modal.dataset.username = un;
  try{
    const stage=document.getElementById('noteStageBubble');
    if(stage) stage.textContent = note ? notePreviewText(note) : 'No note right now';
    document.getElementById('noteEmojiLabel').style.display='none';
    document.getElementById('noteInputWrap').style.display='none';
  }catch(e){}
  modal.classList.add('show');
  modal.style.display='flex';
}

function closeNoteModal(){
  _stopNoteCountdown();
  const modal=document.getElementById('noteModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.style.display='none';
}
window.openMyNoteEditor=openMyNoteEditor;
window.openUserNoteViewer=openUserNoteViewer;
window.closeNoteModal=closeNoteModal;
window.getUserNote=getUserNote;
window.publishMyNote=publishMyNote;

function _syncNotePreview(){
  const bd=document.getElementById('notePreviewBody');
  const stage=document.getElementById('noteStageBubble');
  const input=document.getElementById('noteInput');
  const count=document.getElementById('noteCount');
  if(!input) return;
  const t=input.value.trim();
  const shown = notePreviewText({text:t||'Write something...', emoji:_noteEmoji});
  if(bd) bd.textContent=shown;
  if(stage) stage.textContent=shown;
  if(count){
    count.textContent = (input.value.length||0) + '/80';
    count.classList.toggle('hot', (input.value.length||0) >= 70);
  }
}

document.getElementById('noteCloseBtn')?.addEventListener('click', closeNoteModal);
document.getElementById('noteCloseViewBtn')?.addEventListener('click', closeNoteModal);
document.getElementById('noteModal')?.addEventListener('click',(e)=>{ if(e.target && e.target.id==='noteModal') closeNoteModal(); });
document.getElementById('noteInput')?.addEventListener('input', _syncNotePreview);
document.getElementById('noteEmojiRow')?.addEventListener('click',(e)=>{
  const b=e.target.closest('.note-emoji'); if(!b) return;
  _noteEmoji=b.getAttribute('data-emoji')||'💬';
  document.querySelectorAll('#noteEmojiRow .note-emoji').forEach(x=>x.classList.toggle('active', x===b));
  _syncNotePreview();
});
document.getElementById('noteSaveBtn')?.addEventListener('click', async ()=>{
  const text=(document.getElementById('noteInput')?.value||'').trim();
  if(!text){ showToast({title:'Write a note', body:'Type something first', color:'#f59e0b', avatar:'!'}); return; }
  const btn=document.getElementById('noteSaveBtn');
  const old=btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent='Sharing...'; }
  try{
    await publishMyNote(text, _noteEmoji);
    showToast({title:'Note shared', body:'Visible for 24 hours', color:'#2563eb', avatar:'📝'});
    closeNoteModal();
    try{ renderActiveNow(); renderChats(); }catch(e){}
  }catch(e){
    showToast({title:'Failed', body:String(e.message||e), color:'#ef4444', avatar:'!'});
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=old||'Share note'; }
  }
});
document.getElementById('noteDeleteBtn')?.addEventListener('click', async ()=>{
  if(!confirm('Remove your note?')) return;
  await publishMyNote('', '');
  showToast({title:'Note removed', body:'Your Active Now note is cleared', color:'#64748b', avatar:'✓'});
  closeNoteModal();
  try{ renderActiveNow(); renderChats(); }catch(e){}
});
document.getElementById('noteMessageBtn')?.addEventListener('click',()=>{
  const modal=document.getElementById('noteModal');
  const roomId=modal?.dataset?.roomId||'';
  const un=String(modal?.dataset?.username||'').toLowerCase();
  // read the note BEFORE closing the modal (the modal owns nothing after that)
  let note=null;
  try{ note=un?(getUserNote(un)||null):null; }catch(e){}
  let name=un;
  try{
    const c=(contacts||[]).find(x=>String(x.otherUsername||x.username||'').toLowerCase()===un);
    const u=(getUsers()||{})[un]||{};
    name=(c&&(c.nickname||c.name))||u.nickname||u.displayName||un;
  }catch(e){}
  const ctx=note?{username:un, name, text:note.text, emoji:note.emoji||'📝', ts:note.ts}:{username:un,name,text:'',emoji:'📝',ts:Date.now()};
  closeNoteModal();
  if(!un && !roomId) return;
  cancelReply();
  try{
    if(roomId) openRoom(roomId); else startChatWith(un);
  }catch(e){ console.log('note reply open fail', e.message); }
  // openRoom paints the composer; set the note reply right after it settles
  const arm=()=>{ try{ setNoteReply(ctx); }catch(e){} };
  setTimeout(arm, 260);
  setTimeout(arm, 800);   // a second pass, in case the room finished loading late
});

/* If this device has no note but the cloud still shows one for me, the earlier
   delete never reached database (offline / failed write) - publish it again so
   other people stop seeing a note that no longer exists. Once per session. */
var _myNoteClearChecked=false;
async function syncMyClearedNoteOnce(){
  try{
    if(_myNoteClearChecked||!isCloud||!db||!currentUserData) return false;
    _myNoteClearChecked=true;
    const un=String(currentUserData.username||'').toLowerCase();
    if(!un || getUserNote(un)) return false;            // I have a note: nothing to do
    const {doc,getDoc}=AURORA_SB;
    const snap=await getDoc(doc(db,'presence',un));
    const d=snap.exists()?(snap.data()||{}):{};
    const exp=Number(d.noteExp||0)||0;
    if(d.note && (!exp || Date.now()<=exp)){
      await publishMyNote('','');
      console.log('stale cloud note re-cleared for', un);
      return true;
    }
  }catch(e){}
  return false;
}
window.syncMyClearedNoteOnce=syncMyClearedNoteOnce;
try{ window.addEventListener('online',()=>{ _myNoteClearChecked=false; syncMyClearedNoteOnce(); }, {passive:true}); }catch(e){}

// Pull notes for contacts occasionally
async function refreshNotesForContacts(){
  try{
    try{ purgeExpiredNotes(); }catch(e){}
    try{ await syncMyClearedNoteOnce(); }catch(e){}
    const names=new Set(['khalid_01']);
    if(currentUserData?.username) names.add(currentUserData.username);
    (contacts||[]).forEach(c=>{ const u=c.otherUsername||c.username; if(u) names.add(u); });
    for(const un of Array.from(names).slice(0,30)){
      try{ await fetchNote(un); }catch(e){}
    }
    try{ renderActiveNow(); }catch(e){}
  }catch(e){}
}
window.refreshNotesForContacts=refreshNotesForContacts;
setTimeout(()=>{ try{ refreshNotesForContacts(); }catch(e){} }, 1500);
setInterval(()=>{ try{ refreshNotesForContacts(); }catch(e){} }, 60000);

function renderActiveNow(){
  const scroller=$('#activeNowList');
  if(!scroller) return;
  const onlineContacts=(contacts||[]).filter(c=>{
    const u=c.otherUsername||c.username;
    return u && isUserOnline(u);
  }).slice(0,12);

  // Your note first
  let myNote=null;
  try{ if(currentUserData) myNote=getUserNote(currentUserData.username); }catch(e){}
  const me = currentUserData || {username:'me', nickname:'You', color:'#2563eb'};
  const myLabel = myNote ? 'Your note' : 'Add note';
  const myBubble = myNote ? `<div class="an-note-bubble">${esc((myNote.emoji?myNote.emoji+' ':'') + myNote.text)}</div>` : '';
  let items=`<div class="an-item note-item ${myNote?'':'no-note'}" id="anYourNote" title="Your note">
    <div class="an-avatar-wrap" style="position:relative;">
      ${myBubble}
      <div class="an-avatar" style="background:${avBg(me,me.color)};">${currentUserData?avHTML(me):'+'}</div>
    </div>
    <div class="an-name note-you">${esc(myLabel)}</div>
  </div>`;

  // Build list: people with notes first, then online, then recent
  const seen=new Set();
  const rowForContact=(c, forceNote)=>{
    const un=c.otherUsername||c.username||'';
    if(!un || seen.has(un)) return '';
    if(currentUserData && un===currentUserData.username) return '';
    seen.add(un);
    const name=localStorage.getItem('aurora_nick_'+c.id)||c.nickname||c.name||un;
    const short=(name+'').split(' ')[0];
    const note=getUserNote(un);
    const hasNote=!!(note && note.text);
    if(forceNote && !hasNote) return '';
    const bubble=hasNote?`<div class="an-note-bubble">${esc((note.emoji?note.emoji+' ':'')+note.text)}</div>`:'';
    const ring = hasNote ? '' : (isUserOnline(un) ? '' : 'style="background:#e2e8f0;padding:2px;"');
    const onlineDot = (!hasNote && isUserOnline(un)) ? '<span class="an-dot"></span>' : (hasNote && isUserOnline(un) ? '<span class="an-dot"></span>' : '');
    return `<div class="an-item ${hasNote?'note-item':''} ${hasNote?'':'no-note'}" data-room="${c.id||''}" data-username="${esc(un)}" data-has-note="${hasNote?'1':'0'}">
      <div class="an-avatar-wrap" ${ring} style="position:relative;${hasNote?'':'background:#e2e8f0;padding:2px;'}">
        ${bubble}
        <div class="an-avatar" style="background:${avBg(c,c.color)};">${avHTML(c)}</div>
        ${onlineDot}
      </div>
      <div class="an-name">${esc(short)}</div>
    </div>`;
  };

  // notes from contacts
  (contacts||[]).forEach(c=>{ items += rowForContact(c, true); });
  // online without notes already added
  onlineContacts.forEach(c=>{ items += rowForContact(c, false); });
  // if still few, recent
  if(seen.size < 4){
    (contacts||[]).slice(0,8).forEach(c=>{ items += rowForContact(c, false); });
  }

  scroller.innerHTML=items;

  const myBtn=document.getElementById('anYourNote');
  if(myBtn) myBtn.onclick=()=>openMyNoteEditor();

  scroller.querySelectorAll('.an-item[data-username]').forEach(el=>{
    el.onclick=()=>{
      const un=el.getAttribute('data-username');
      const room=el.getAttribute('data-room')||'';
      const has=el.getAttribute('data-has-note')==='1';
      if(has) openUserNoteViewer(un, room);
      else if(room) openRoom(room);
      else if(un) startChatWith(un);
    };
  });
}

window.renderActiveNow=renderActiveNow;
window.switchBottomNav=function(nav){
  leaveConversation();
  if(nav==='settings'){
    openSettings();
    return;
  }
  try{ hardHideSettingsPages(); }catch(e){}
  closeSettings();
  try{
    document.body.classList.remove('chat-open');
    document.getElementById('phoneShell')?.classList.remove('chat-open');
  }catch(e){}
  try{ restoreChatListChrome(); }catch(e){}
  window._navFilter = nav==='people'?'users':(nav==='calls'?'calls':'all');
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav===nav));
  document.querySelectorAll('.filter-tabs .tab').forEach(t=>{
    t.classList.toggle('active', (nav==='people' && t.dataset.filter==='users') || (nav==='chats' && t.dataset.filter==='all'));
  });
  const title=$('#sidebarTitle');
  if(title){
    title.textContent = nav==='people'?'People':nav==='calls'?'Calls':'Chats';
  }
  // show main chat list chrome
  try{
    const ids=['activeNowSection','recentLabel','chatList','fabNewChat','sSearchWrap'];
    // s-search class container
    document.querySelector('.s-search')&& (document.querySelector('.s-search').style.display='');
    const an=document.getElementById('activeNowSection'); if(an && nav==='chats') an.style.display='';
    const rl=document.getElementById('recentLabel'); if(rl) rl.style.display='';
    const cl=document.getElementById('chatList'); if(cl) cl.style.display='';
    const fab=document.getElementById('fabNewChat'); if(fab) fab.style.display='';
  }catch(e){}
  renderChats();
};

/* FIX: one place that force-hides every settings sub-page.
   Sub-pages (security/billing/privacy/help/notif/profile/appearance) are
   shown with inline `style.cssText = display:flex !important; z-index:10080',
   so clearing the class alone is not enough - the inline style must go too. */
/* FIX: sub-pages hide the sidebar header / search / chat list with inline
   styles. If any of them is still hidden the chat list looks "dead" after
   coming back from Settings, so we always restore them together. */
function restoreChatListChrome(){
  try{
    const ss=document.querySelector('.s-search'); if(ss) ss.style.display='';
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='';
    const sb=document.getElementById('sidebar');
    if(sb){ sb.style.display=''; sb.style.pointerEvents=''; }
    const m=document.getElementById('sidebarMenu'); if(m) m.style.display='none';
  }catch(e){}
  try{ if(typeof renderChats==='function') renderChats(); }catch(e){}
}
window.restoreChatListChrome=restoreChatListChrome;

function hardHideSettingsPages(){
  ['notifView','profileView','appearView','securityView','billingView','privacyView','helpView','devUsersView'].forEach(id=>{
    const v=document.getElementById(id);
    if(!v) return;
    v.classList.remove('show');
    v.style.cssText='';
    v.style.display='none';
    v.style.pointerEvents='none';
    v.hidden=true;
  });
}
window.hardHideSettingsPages=hardHideSettingsPages;

function openSettings(){
  leaveConversation();
  try{ closeNotifSettings(); }catch(e){}
  try{ closeProfilePage(); }catch(e){}
  try{ closeAppearancePage(); }catch(e){}
  try{ closeSecurityPage(); }catch(e){}
  try{ closeBillingPage(); }catch(e){}
  try{ closePrivacyPage(); }catch(e){}
  try{ closeHelpPage(); }catch(e){}
  const view=document.getElementById('settingsView');
  if(!view) return;
  // hide chat list chrome under settings
  try{
    document.querySelector('.s-search')&& (document.querySelector('.s-search').style.display='none');
    const an=document.getElementById('activeNowSection'); if(an) an.style.display='none';
    const rl=document.getElementById('recentLabel'); if(rl) rl.style.display='none';
    const cl=document.getElementById('chatList'); if(cl) cl.style.display='none';
    const fab=document.getElementById('fabNewChat'); if(fab) fab.style.display='none';
    // hide main s-header brand row under settings? keep bottom nav
    const sh=document.querySelector('#sidebar > .s-header');
    if(sh) sh.style.display='none';
  }catch(e){}
  view.classList.add('show');
  view.style.display='';
  view.style.visibility='';
  view.style.opacity='';
  view.style.pointerEvents='';
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings'));
  refreshSettingsUI();
  // close dropdown if open
  try{const m=document.getElementById('sidebarMenu'); if(m) m.style.display='none';}catch(e){}
}
function closeSettings(){
  try{ closeNotifSettings(); }catch(e){}
  try{ closeProfilePage(); }catch(e){}
  try{ closeAppearancePage(); }catch(e){}
  try{ closeSecurityPage(); }catch(e){}
  try{ closeBillingPage(); }catch(e){}
  try{ closePrivacyPage(); }catch(e){}
  try{ closeHelpPage(); }catch(e){}
  // FIX: sub-pages set inline display:flex on #settingsView.
  // Removing only the .show class left the inline style behind, so the
  // settings screen kept covering the chat list after Back/Done.
  try{ hardHideSettingsPages(); }catch(e){}
  const view=document.getElementById('settingsView');
  if(view){
    view.classList.remove('show');
    view.style.display='';
    view.style.visibility='';
    view.style.opacity='';
    view.style.pointerEvents='';
  }
  try{
    document.querySelector('.s-search')&& (document.querySelector('.s-search').style.display='');
    const an=document.getElementById('activeNowSection'); if(an) an.style.display='';
    const rl=document.getElementById('recentLabel'); if(rl) rl.style.display='';
    const cl=document.getElementById('chatList'); if(cl) cl.style.display='';
    const fab=document.getElementById('fabNewChat'); if(fab) fab.style.display='';
    const sh=document.querySelector('#sidebar > .s-header');
    if(sh) sh.style.display='';
  }catch(e){}
}
function refreshSettingsUI(){
  // Developer-only section visibility
  try{
    const devSec=document.getElementById('stDevSection');
    const lvl = myLevel();
    // each row has its own requirement; the section shows if ANY row does
    /* Every row is purely capability-based, so a higher rank always keeps
       everything the ranks below it get (Developer sees the full set). */
    const rowAllUsers = can('users.viewAll');   // Owner+
    const rowModTools = can('user.mute');       // Moderator+ (incl. Admin/Owner/Dev)
    const rowPerks    = lvl > 0;                // VIP+
    const setRow=(id,on)=>{ const e=document.getElementById(id); if(e) e.style.display = on ? '' : 'none'; };
    const rowDebug = can('debug.tools');         // Developer only
    setRow('stAllUsers', rowAllUsers);
    setRow('stModTools', rowModTools);
    setRow('stDebug',    rowDebug);
    setRow('stMyPerks',  rowPerks);
    if(devSec) devSec.style.display = (rowAllUsers || rowModTools || rowDebug || rowPerks) ? '' : 'none';
    try{
      const lbl=document.querySelector('#stDevSection .st-section-label');
      if(lbl) lbl.textContent = roleTitle(lvl) + ' tools';
      const sub=document.getElementById('stAllUsersSub');
      if(sub) sub.textContent = can('roles.grant')
        ? 'Browse accounts · manage roles'
        : (can('roles.view') ? 'Browse accounts · view roles'
                             : 'Browse every registered account');
      const psub=document.getElementById('stMyPerksSub');
      if(psub) psub.textContent = 'You are ' + roleTitle(lvl);
    }catch(e){}
  }catch(e){}


  try{
    if(typeof getBillingPlan==='function'){
      const bp=getBillingPlan();
      const vals=document.querySelectorAll('#settingsView .st-stat .st-stat-val');
      if(vals[0]) vals[0].textContent = bp.id==='free'?'Free':(bp.id==='team'?'Team':'Pro');
    }
  }catch(e){}

  if(!currentUserData) return;
  try{
    const sub=document.getElementById('stTestModeSub');
    if(sub) sub.textContent = isTestMode() ? 'ON · tap to exit demo' : 'Load demo chats & account';
  }catch(e){}

  const name=currentUserData.nickname||currentUserData.username||'User';
  const user=currentUserData.username||'';
  const nameEl=document.getElementById('settingsName');
  const subEl=document.getElementById('settingsSub');
  const avEl=document.getElementById('settingsAvatar');
  const cntEl=document.getElementById('settingsChatCount');
  /* FIX: this used textContent, so the verified / developer badge markup was
     printed as plain text at best and (because it was never added) simply
     never appeared on your OWN profile. Other people's profiles used
     innerHTML and worked fine — that's why it only broke for yourself. */
  if(nameEl){
    let badges='';
    try{
      if(isUserVerified(user, currentUserData)) badges += verifiedBadgeHTML();
    }catch(e){}
    nameEl.innerHTML = esc(name) + badges;
  }
  if(subEl){
    const bits=['@'+user];
    if(currentUserData.title) bits.push(currentUserData.title);
    else if(currentUserData.cloud) bits.push('Premium');
    let html = esc(bits.join(' · '));
    try{
      const _rb = roleBadgesHTML(user, currentUserData);
      if(_rb){
        html += '<div style="margin-top:8px;display:flex;justify-content:center;'
              + 'gap:6px;flex-wrap:wrap;">' + _rb + '</div>';
      }
    }catch(e){}
    subEl.innerHTML = html;
  }
  if(cntEl){
    const n=(contacts&&contacts.length)||0;
    cntEl.textContent = n>=1000 ? (Math.round(n/100)/10)+'k' : String(n);
  }
  if(avEl){
    const src=currentUserData.avatarUrl||(currentUserData.avatar&&String(currentUserData.avatar).startsWith('data:')?currentUserData.avatar:null);
    if(src){
      avEl.innerHTML=`<img src="${src}">`;
      avEl.style.background='transparent';
    }else{
      avEl.innerHTML=esc((name||'U').slice(0,2).toUpperCase());
      avEl.style.background=currentUserData.color||'#2563eb';
    }
  }
  // toggles
  const notifT=document.getElementById('stNotifToggle');
  if(notifT) notifT.classList.toggle('on', !!notificationsEnabled);
  const darkT=document.getElementById('stDarkToggle');
  if(darkT){
    const mode=getPreferredThemeMode();
    const isDark=mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    darkT.classList.toggle('on', isDark);
    darkT.setAttribute('aria-checked',String(!!isDark));
  }
  const blackT=document.getElementById('stBlackToggle');
  if(blackT){
    const isBlack=getPreferredThemeMode()==='black';
    blackT.classList.toggle('on',isBlack);
    blackT.setAttribute('aria-checked',String(isBlack));
  }
}
window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.refreshSettingsUI=refreshSettingsUI;


window.searchCloudUsers=async (q)=>{
  if(!db) return;
  const el=$('#fbSearchResult'); if(!el) return;
  el.innerHTML='Searching...';
  try{
    const {collection,query,where,getDocs}=AURORA_SB;
    const qs=query(collection(db,'users'), where('username','>=',q), where('username','<=',q+'\uf8ff'));
    const snap=await getDocs(qs);
    let users=snap.docs.map(d=>d.data()).filter(u=>u.username!==currentUserData.username);
    const qs2=await getDocs(collection(db,'users'));
    const byNick=qs2.docs.map(d=>d.data()).filter(u=>u.username!==currentUserData.username && u.nickname && u.nickname.toLowerCase().includes(q.toLowerCase()) && !users.find(x=>x.username===u.username));
    users=[...users,...byNick];
    if(users.length===0){el.innerHTML=`<div style="font-size:11px;color:#94a3b8;">No results</div>`; return;}
    el.innerHTML=users.map(u=>`<div class="chat-item" data-fbusername="${u.username}" style="background:#f8fafc;border-radius:12px;margin-bottom:4px;border:1px solid #f1f5f9;"><div class="avatar" style="background:${avBg(u,u.color||'#7c3aed')};overflow:hidden;">${avHTML(u)}</div><div class="chat-info"><div class="chat-top"><div class="chat-name">${u.nickname||u.username}</div></div><div class="chat-bottom"><div class="chat-last">@${u.username} • Premium</div></div></div></div>`).join('');
    el.querySelectorAll('[data-fbusername]').forEach(e=>e.addEventListener('click',()=>startChatWith(e.dataset.fbusername)));
  }catch(e){el.innerHTML=`<div style="font-size:11px;color:#dc2626;">${e.message}</div>`;}
};

async function startChatWith(otherUsername){
  if(!currentUserData) return;
  otherUsername=String(otherUsername||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(!otherUsername){ alert('Valid username dao'); return; }
  if(otherUsername===currentUserData.username){alert('Cannot chat with yourself');return;}
  const myU=currentUserData.username;
  const roomId=[myU,otherUsername].sort().join('_');
  const otherData=getUsers()[otherUsername]||{username:otherUsername, nickname:otherUsername, avatar:otherUsername.slice(0,2).toUpperCase(),color:colors[otherUsername.length%colors.length]};

  /* FIX: Do not manufacture a local "New conversation" placeholder when
     the user is opening an existing cloud conversation from People/search.
     The old flow wrote a dummy local room first, so the chat list showed
     "New conversation" and could hide the real latest preview until the
     account-level room listener refreshed. Resolve the cloud room first and
     keep the optimistic row aligned with its real summary. */
  const cloudChat=!!(isCloud && db && currentUser);
  let cloudRoomData=null;
  if(cloudChat){
    try{
      const {doc,getDoc}=AURORA_SB;
      const roomSnap=await Promise.race([
        getDoc(doc(db,'rooms',roomId)),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('room lookup timeout')),2500))
      ]);
      if(roomSnap.exists()) cloudRoomData={id:roomSnap.id,...roomSnap.data()};
    }catch(e){ /* realtime listener / create path below remains authoritative */ }
  }
  const optimisticLast=cloudRoomData
    ? String(cloudRoomData.lastMessage||'')
    : (cloudChat ? '' : 'New conversation');
  const optimistic={
    id:roomId,
    name:otherData.nickname||otherUsername,
    username:otherUsername,
    nickname:otherData.nickname||otherUsername,
    avatar:otherData.avatar||otherUsername.slice(0,2).toUpperCase(),
    avatarUrl: otherData.avatarUrl || null,
    color:otherData.color||colors[otherUsername.length%colors.length],
    last:optimisticLast,
    time:cloudRoomData?.lastTime||timeNow(),
    lastActiveMs: convAnyToMs(cloudRoomData?.lastMessageAt) || convAnyToMs(cloudRoomData?.lastTs) || (cloudChat?0:Date.now()),
    otherUsername:otherUsername,
    otherNickname:otherData.nickname||otherUsername,
    participants:[myU,otherUsername],
    participantUsernames:[myU,otherUsername],
    bio: otherData.bio||'',
    title: otherData.title||'',
    phone: otherData.phone||'',
    email: otherData.email||'',
    verified: otherData.verified===true || otherData.isVerified===true || otherUsername==='khalid_01'
  };

  /* Local mode owns its room data. Cloud mode must not write a fake local
     room: that fake record is what made an existing chat look like a new one. */
  if(!cloudChat){
    try{
      const rooms=getGlobalRooms();
      if(!rooms[roomId]){
        rooms[roomId]={
          id:roomId,
          participants:[myU,otherUsername],
          participantUsernames:[myU,otherUsername],
          participantNicknames:[currentUserData.nickname||myU, otherData.nickname||otherUsername],
          messages:[{id:'sys',text:`Conversation with ${otherData.nickname||otherUsername}`,system:true,time:timeNow()}],
          lastMessage:'New conversation',
          lastTime:timeNow(),
          lastMessageTs:Date.now(),
          createdAt:Date.now()
        };
      }else{
        // ensure participants include me
        const p=rooms[roomId].participants||rooms[roomId].participantUsernames||[];
        if(!p.includes(myU)) p.push(myU);
        if(!p.includes(otherUsername)) p.push(otherUsername);
        rooms[roomId].participants=p;
        rooms[roomId].participantUsernames=p;
        if(!rooms[roomId].lastMessage) rooms[roomId].lastMessage='New conversation';
        if(!rooms[roomId].lastTime) rooms[roomId].lastTime=timeNow();
        if(!rooms[roomId].lastMessageTs) rooms[roomId].lastMessageTs=Date.now();
      }
      saveGlobalRooms(rooms);
    }catch(e){ console.log('local room save fail', e.message); }
  }

  // Update in-memory list immediately
  try{
    refreshContactsFromLocal();
    const openedContact=contacts.find(c=>c.id===roomId);
    if(openedContact){
      // Replace an older cached placeholder with the real cloud summary.
      if(cloudRoomData) Object.assign(openedContact, optimistic);
    }else{
      contacts.unshift(optimistic);
    }
    // ensure Chats tab visible
    try{
      window._navFilter='all';
      document.querySelectorAll('.filter-tabs .tab').forEach(x=>{
        x.classList.toggle('active', x.dataset.filter==='all');
      });
      document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='chats'));
      const label=document.getElementById('recentLabel'); if(label){ label.style.display=''; label.textContent='Recent Messages'; }
      const an=document.getElementById('activeNowSection'); if(an) an.style.display='';
      const cl=document.getElementById('chatList'); if(cl) cl.style.display='';
    }catch(e){}
    renderChats();
  }catch(e){ console.log('list update fail', e.message); }

  // Cloud room create (best effort)
  if(isCloud && db && currentUser){
    try{
      const {doc,getDoc,setDoc,serverTimestamp}=AURORA_SB;
      const roomRef=doc(db,'rooms',roomId);
      const snap=cloudRoomData ? null : await getDoc(roomRef);
      const exists=cloudRoomData ? true : !!(snap && snap.exists());
      const prevData=(snap && snap.exists() && snap.data) ? (snap.data()||{}) : (cloudRoomData||{});
      // A room that exists but lost participantUsernames is INVISIBLE to the
      // array-contains room query - its rows vanish from Chats. Repair it.
      const noParts=exists && !(Array.isArray(prevData.participantUsernames) && prevData.participantUsernames.length);
      if(!exists || noParts){
        let otherUid=otherUsername;
        try{const oSnap=await getDoc(doc(db,'usernames',otherUsername)); if(oSnap.exists()) otherUid=oSnap.data().uid;}catch{}
        const payload={
          participants:[currentUser.uid, otherUid],
          participantUsernames:[myU, otherUsername],
          participantNicknames:[currentUserData.nickname||myU, otherData.nickname||otherUsername],
          name:otherData.nickname||otherUsername,
          otherUsername:otherUsername,
          otherNickname:otherData.nickname||otherUsername,
          lastMessage: exists ? (prevData.lastMessage||'New conversation') : 'New conversation',
          lastTime: exists ? (prevData.lastTime||timeNow()) : timeNow(),
          color:otherData.color||optimistic.color
        };
        if(!exists) payload.createdAt=serverTimestamp();
        await setDoc(roomRef,payload,{merge:exists});
      }
      try{ rememberConversation(optimistic,{cloud:true,pendingCloud:false}); }catch(e){}
    }catch(e){ console.log('cloud room create fail', e.message); }
  }

  // Always open the chat + keep list
  try{
    refreshContactsFromLocal();
    const openedContact=contacts.find(c=>c.id===roomId);
    if(openedContact){
      // Do not let an old local "New conversation" cache overwrite the
      // existing cloud conversation just before it opens.
      if(cloudRoomData) Object.assign(openedContact, optimistic);
    }else{
      contacts.unshift(optimistic);
    }
    // DURABILITY: remember this chat locally; in cloud mode it stays flagged
    // until the database room is confirmed, so a room that never landed there
    // (or that lost its participantUsernames) is repaired and re-appears.
    try{
      rememberConversation(optimistic,{cloud: !!(isCloud && cloudRoomData), pendingCloud: !!isCloud});
      if(isCloud) repairPendingCloudRooms();
    }catch(e){}
    renderChats();
  }catch(e){}
  openRoom(roomId);
}

async function openRoom(roomId){
  try{closeSettings();hardHideSettingsPages();}catch(e){}
  // TYPING: leaving the previous room must clear my flag + its listener
  try{ if(currentRoomId && currentRoomId!==roomId) stopMyTyping(currentRoomId); }catch(e){}
  // FIX: stop the previous room listener and clear old rows before changing
  // header/body, so one conversation's messages cannot appear in another.
  try{ if(unsubMessages){ unsubMessages(); unsubMessages=null; } }catch(e){}
  try{
    const _msgEl=document.getElementById('messages');
    if(_msgEl && _msgEl.dataset.roomId!==String(roomId||'')){
      _msgEl.innerHTML='';
      _msgEl.classList.remove('short-chat');
      _msgEl.dataset.roomId=String(roomId||'');
      _msgEl.scrollTop=0;
      _msgEl._isScrolling=false;
      _msgEl._pendingRender=false;
      _msgEl._userScrolledUp=false;
      _msgEl._programmaticScroll=false;
      window._msgCache=null;
    }
  }catch(e){}
  currentRoomId=roomId;
  clearUnread(roomId);
  try{
    const tr=document.getElementById('typingRow');
    if(tr){ tr.classList.remove('show'); tr.setAttribute('aria-hidden','true'); }
    startTypingListener(roomId);
  }catch(e){}
  // Keep the account-level last-message baseline when opening or leaving a room.
  $('#welcomeScreen').style.display='none';
  $('#mHeader').style.display='flex';
  $('#messages').style.display='flex';
  $('#inputArea').style.display='flex';
  let contact=contacts.find(c=>c.id===roomId);
  if(!contact){
    const parts=roomId.split('_');
    const otherName=parts.find(p=>p!==currentUserData.username)||roomId;
    const otherData=getUsers()[otherName]||{avatar:otherName.slice(0,2).toUpperCase(),color:colors[otherName.length%colors.length],nickname:otherName,username:otherName};
    contact={id:roomId,name:otherData.nickname||otherName,username:otherData.username||otherName,nickname:otherData.nickname||otherName,avatar:otherData.avatar,color:otherData.color,last:'New',time:timeNow(),otherUsername:otherName,otherNickname:otherData.nickname||otherName,participants:parts,participantUsernames:parts};
    contacts.unshift(contact); renderChats();
  }
  const _otherU=contact.otherUsername||contact.username||'';
  const _dotH=onlineDotHTML(_otherU);
  $('#chatAvatar').innerHTML=avHTML(contact)+_dotH;
  $('#chatAvatar').style.background=avBg(contact,contact.color);
  $('#chatAvatar').style.overflow='visible';
  // Use the same display name in the conversation list and header.
  const _displayName=contactDisplayName(contact);
  const nameEl=document.getElementById('chatName');
  if(nameEl){
    nameEl.innerHTML = esc(_displayName) + (isUserVerified(_otherU, contact)?verifiedBadgeHTML():'');
    nameEl.style.display='block';
    nameEl.style.visibility='visible';
    nameEl.style.opacity='1';
    nameEl.style.color='';
  }
  const infoEl=document.getElementById('chatHeaderInfo');
  if(infoEl){
    infoEl.style.display='flex';
    infoEl.style.visibility='visible';
    infoEl.style.minWidth='0';
    infoEl.style.flex='1';
  }
  const stEl=document.getElementById('chatStatus');
  if(stEl){ stEl.style.display='block'; stEl.style.visibility='visible'; }
  updateChatHeaderPresence(contact);
  // fallback status if empty
  setTimeout(()=>{
    try{
      const s=document.getElementById('chatStatus');
      if(s && !String(s.textContent||'').trim() && !s.innerHTML.trim()){
        s.innerHTML='<span class="status-offline">Aurora</span>';
      }
    }catch(e){}
  },50);
  // 🔕 Mute indicator on status line
  const _isMuted=localStorage.getItem('aurora_mute_'+roomId)==='1';
  if(_isMuted){
    const st=$('#chatStatus');
    if(st) st.innerHTML=(st.innerHTML||'')+' <span style="color:#94a3b8;font-size:11px;letter-spacing:0;text-transform:none;font-weight:600;">· Muted</span>';
  }
  // ⏱️ Apply disappearing messages
  applyDisappearingMessages(roomId);
  // 🖌️ Apply chat background color
  applyChatBg(roomId);
  
  // Add scroll listener to detect when user is scrolling (add early to catch all scroll events)
  const msgEl=$('#messages');
  if(!msgEl._scrollListenerAdded) {
    let scrollTimeout;
    msgEl.addEventListener('scroll', () => {
      const distanceFromBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight;
      if(!msgEl._programmaticScroll){
        if(distanceFromBottom > 80) msgEl._userScrolledUp = true;
        else if(distanceFromBottom < 24) msgEl._userScrolledUp = false;
      }
      msgEl._isScrolling = true;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        msgEl._isScrolling = false;
        // If there was a pending render, do it now
        if(msgEl._pendingRender) {
          msgEl._pendingRender = false;
          renderMessagesForRoom(currentRoomId, false);
        }
      }, 200); // 200ms after scroll stops
    });
    msgEl._scrollListenerAdded = true;
  }
  
  renderChats();
  // Open the flex layout BEFORE measuring/rendering messages. The previous
  // order rendered while #mainPanel was display:none, so clientHeight was 0;
  // after a few sends the message pane could keep the wrong scroll geometry.
  const mp=document.getElementById('mainPanel');
  if(mp){
    mp.classList.add('open');
    mp.style.display='flex';
  }
  renderMessagesForRoom(roomId);
  try{
    const w=document.getElementById('welcomeScreen'); if(w) w.style.display='none';
    const h=document.getElementById('mHeader'); if(h) h.style.display='flex';
    const ms=document.getElementById('messages'); if(ms) ms.style.display='flex';
    const ia=document.getElementById('inputArea'); if(ia) ia.style.display='flex';
  }catch(e){}
  try{ renderTypingIndicator(); }catch(e){}
  // FIX: hide the bottom nav while a conversation is open (:has() fallback)
  try{
    document.body.classList.add('chat-open');
    document.getElementById('phoneShell')?.classList.add('chat-open');
  }catch(e){}
}


function meAvatarHTML(){
  try{
    if(!currentUserData) return 'U';
    return avHTML(currentUserData);
  }catch(e){return 'U';}
}
function meAvatarBg(){
  try{return avBg(currentUserData, currentUserData?.color||'#2563eb');}catch(e){return '#2563eb';}
}

function msgDayLabel(ts){
  try{
    let d=0;
    if(!ts) return 'Today';
    if(typeof ts==='number') d=ts;
    else if(ts.toMillis) d=ts.toMillis();
    else if(ts.seconds) d=ts.seconds*1000;
    else d=Date.parse(ts)||0;
    if(!d) return 'Today';
    const day=new Date(d); const now=new Date();
    const a=new Date(day.getFullYear(),day.getMonth(),day.getDate());
    const b=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const diff=Math.round((b-a)/86400000);
    if(diff===0) return 'Today';
    if(diff===1) return 'Yesterday';
    return day.toLocaleDateString([], {month:'short', day:'numeric'});
  }catch(e){ return 'Today'; }
}
function injectDayChips(msgEl, msgs, getTs){
  try{
    if(!msgEl||!msgs||!msgs.length) return;
    let last='';
    const rows=[...msgEl.querySelectorAll('.msg-row[data-msg-id]')];
    let ri=0;
    msgs.forEach((m)=>{
      if(m.system) return;
      const label=msgDayLabel(getTs(m));
      if(label!==last){
        last=label;
        // find corresponding row
        while(ri<rows.length && rows[ri].dataset.msgId!==String(m.id||'')) ri++;
        const row=rows[ri];
        if(row){
          const chip=document.createElement('div');
          chip.className='msg-day-chip';
          chip.textContent=label;
          row.parentNode.insertBefore(chip, row);
        }
      }
      ri++;
    });
  }catch(e){}
}

function buildMsgRowHTML(m, opts){
  opts=opts||{};
  const isMe=!!opts.isMe;
  const showAvatar=opts.showAvatar!==false && !isMe;
  const otherAvatarHtml=opts.otherAvatarHtml||'';
  const otherAvatarBg=opts.otherAvatarBg||'#2563eb';
  const otherAvatarUrl=opts.otherAvatarUrl||null;
  const rcOtherU=opts.rcOtherU||'';
  const roomMetaObj=opts.roomMeta||{};
  const roomLocal=opts.roomLocal||null;
  const grouped=!!opts.grouped;
  const isLastMine=!!opts.isLastMine;
  const isVoice=AuroraVoice.isVoiceMessage(m) && !m._evicted && /^(data:|https?:|blob:)/.test(String(m.text||''));
  const isMedia=isVoice||m.type==='image'||m.type==='video'||m.type==='audio'||m.type==='file'||(m.text&&String(m.text).startsWith('data:'));
  let body='';
  if(typeof opts.mediaHtml==='string') body=opts.mediaHtml;
  /* BUGFIX companion: quota-evicted media has empty text — show placeholder. */
  else if(m && m._evicted) body=`<span style="opacity:.75;font-style:italic;">${esc(m._evictedNote||'📁 Attachment removed to free space')}</span>`;
  else body=esc(m.text||'');
  /* FEATURE: every message now shows its time, not just the last one I sent.
     The last own message additionally shows Read/Delivered status. System
     messages stay bare. */
  let readHtml='';
  const _t=esc(msgTimeText(m));
  if(!m.system){
    if(isMe){
      let st=opts.receiptStatus||'sent';
      try{
        if(!opts.receiptStatus){
          if(roomLocal) st=rcStatusLocal(m, roomLocal, rcOtherU);
          else st=rcStatusCloud(m, roomMetaObj, rcOtherU);
        }
      }catch(e){}
      const tick=rcTickHtml(st);
      /* FIX: if several of my messages are already seen, only the lowest
         seen message gets the Seen label. Messages sent after that but not
         read yet show only double ticks (Delivered), not a Delivered text. */
      if(opts.receiptMode==='seen-anchor') readHtml=`<div class="msg-read-label">Seen ${_t}</div>`;
      else readHtml=`<div class="msg-read-label msg-time-only">${_t}${_t?' ':''}${tick}</div>`;
    }else if(_t){
      readHtml=`<div class="msg-read-label msg-time-only">${_t}</div>`;
    }
  }
  const avatarDiv=!isMe?`<div class="msg-avatar ${!showAvatar?'hidden':''}" style="background:${otherAvatarBg};">${otherAvatarUrl?`<img src="${otherAvatarUrl}">`:otherAvatarHtml}</div>`:'';
  const reactionHtml=m.reaction?`<div class="msg-reaction" style="position:absolute;bottom:-10px;${isMe?'right:8px;':'left:8px;'}background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2px 6px;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.1);cursor:pointer;z-index:5;">${m.reaction}</div>`:'';
  // FIX: show received photos inside the bubble too (not a tiny side thumb),
  // so the other side can actually see the image and tap it to open big.
  let sideThumb='';
  let bubbleBody=body;
  const bubbleCls=`bubble ${isMe?'sent':'received'}${isMedia?' media-bubble':''}${isVoice?' voice-bubble':''}`;
  const groupCls=grouped?' grouped':'';
  const actionsRow=`<div class="msg-actions">
    <button class="msg-action-btn" onclick="event.stopPropagation();handleMsgActionDirect('reply','${m.id||''}')" title="Reply">↩</button>
    <button class="msg-action-btn danger" onclick="event.stopPropagation();handleMsgActionDirect('delete','${m.id||''}')" title="Delete">🗑</button>
  </div>`;
  
  // Note reply: the note bubble always sits right above the answer
  let noteQuoteHtml='';
  try{ if(m && m.noteReply) noteQuoteHtml=noteQuoteHTML(m.noteReply); }catch(e){}

  // Build reply quote if this message is a reply
  let replyQuoteHtml='';
  if(m.replyTo){
    /* BUGFIX: strict === failed when ids differ in type (database doc ids are
       strings, local ids are Date.now() numbers), so the quote silently
       vanished. Compare as strings. */
    const replyMsg=opts.allMessages?.find(x=>String(x.id)===String(m.replyTo));
    if(replyMsg){
      const replyName=replyMsg.senderName||replyMsg.sender||'Unknown';
      let replyText=AuroraVoice.isVoiceMessage(replyMsg) ? String(replyMsg.caption||'🎤 Voice message') : String(replyMsg.text||'').trim();
      if(!replyText){
        const t=replyMsg.type||'';
        if(/image|photo/i.test(t)) replyText='📷 Photo';
        else if(/video/i.test(t)) replyText='🎬 Video';
        else if(/audio|voice/i.test(t)) replyText='🎤 Voice message';
        else if(/file|doc/i.test(t)) replyText='📎 Attachment';
        else replyText='Media';
      }
      if(replyText.length>80) replyText=replyText.slice(0,80)+'…';
      replyQuoteHtml=`<div class="reply-quote" onclick="event.stopPropagation();jumpToMsg('${m.replyTo}')"><div class="reply-quote-body"><span class="reply-quote-name">${esc(replyName)}</span><span class="reply-quote-text">${esc(replyText)}</span></div></div>`;
    }
  }
  
  return `<div class="msg-row ${isMe?'sent':'received'}${groupCls}${isVoice?' voice-row':''}" data-msg-id="${m.id||''}" oncontextmenu="openMsgMenuFromRow(event,'${m.id||''}')" onclick="toggleMsgActions(event,'${m.id||''}')">${avatarDiv}${sideThumb}<div class="msg-stack">${noteQuoteHtml}${replyQuoteHtml}<div class="msg-bubble-line" style="display:flex;align-items:flex-end;gap:0;"><div class="${bubbleCls}" style="position:relative;">${isMedia?body:bubbleBody}${reactionHtml}</div>${actionsRow}</div>${readHtml}</div></div>`;
}

window.toggleMsgActions=(e, msgId)=>{
  e.stopPropagation();
  document.querySelectorAll('.msg-row.msg-active').forEach(row=>row.classList.remove('msg-active'));
  const row=document.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
  if(row) row.classList.toggle('msg-active');
};

window.openMsgMenuFromRow=(e, msgId)=>{
  e.preventDefault();
  e.stopPropagation();
  const fakeEvent={target:{getBoundingClientRect:()=>({left:e.clientX,top:e.clientY,bottom:e.clientY+20,right:e.clientX+20})}};
  openMsgMenu(fakeEvent, msgId);
};


async function renderMessagesForRoom(roomId, showLoading=true){
  const msgEl=$('#messages');
  // FIX: never reuse the previous conversation's DOM/cache. The smart
  // incremental renderer below looks at existing .msg-row IDs; if we switch
  // chats without clearing, messages from chat A can remain/merge into chat B.
  const _renderRoomId = String(roomId||'');
  const _switchingRooms = msgEl.dataset.roomId !== _renderRoomId;
  if(_switchingRooms){
    msgEl.innerHTML='';
    msgEl.scrollTop=0;
    msgEl._isScrolling=false;
    msgEl._pendingRender=false;
    msgEl._userScrolledUp=false;
    msgEl._programmaticScroll=false;
    try{ window._msgCache=null; }catch(e){}
  }
  msgEl.dataset.roomId = _renderRoomId;
  // Save scroll position before render to prevent jumping
  const savedScrollTop = msgEl.scrollTop;
  const savedScrollHeight = msgEl.scrollHeight;
  const wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 100;
  const isUserScrolling = !wasAtBottom && msgEl.scrollTop > 0;
  const stabilizeMessages = (forceBottom=false)=>{
    try{
      const shortChat = msgEl.scrollHeight <= msgEl.clientHeight + 2;
      const userReadingOlder = !!msgEl._userScrolledUp && !forceBottom;
      msgEl.classList.toggle('short-chat', shortChat);
      if(!shortChat && !userReadingOlder && (forceBottom || wasAtBottom)){
        msgEl._programmaticScroll=true;
        msgEl.scrollTop = msgEl.scrollHeight;
        setTimeout(()=>{ msgEl._programmaticScroll=false; },0);
      }else if(!forceBottom && !wasAtBottom){
        // Realtime snapshots (receipts, typing, or a new message) must not
        // pull the reader back to the bottom after they scroll upward.
        msgEl._programmaticScroll=true;
        msgEl.scrollTop = savedScrollTop;
        setTimeout(()=>{ msgEl._programmaticScroll=false; },0);
      }
    }catch(e){}
  };
  
  // Check if user is actively scrolling - if so, debounce the render
  if(msgEl._isScrolling) {
    // Queue this render for after scroll ends
    msgEl._pendingRender = true;
    return;
  }
  
  // Only show loading if explicitly requested and no messages exist yet
  if(showLoading && msgEl.children.length===0){
    msgEl.innerHTML='<div style="text-align:center;color:#94a3b8;font-size:11px;padding:16px;">Loading...</div>';
  }
  // ✓✓ receipt context: onno user ke (seen/delivered tar marker e count hobe)
  let rcOtherU='';
  try{
    const rcC=(contacts||[]).find(c=>c.id===roomId)||{};
    rcOtherU=rcC.otherUsername||rcC.username||(roomId.split('_').find(p=>p!==(currentUserData&&currentUserData.username)))||'';
  }catch(e){}

  function buildReceiptMap(list, isMineFn, statusFn){
    const map={};
    let lastSeenKey=null;
    try{
      (list||[]).forEach((m,idx)=>{
        if(!m || m.system || !isMineFn(m)) return;
        const key=String(m.id||idx);
        const st=statusFn(m)||'sent';
        map[key]={status:st, mode:''};
        if(st==='seen') lastSeenKey=key;
      });
      if(lastSeenKey && map[lastSeenKey]) map[lastSeenKey].mode='seen-anchor';
    }catch(e){}
    return map;
  }

  function applyReceiptMapToDom(msgEl, list, receiptMap){
    try{
      (list||[]).forEach((m,idx)=>{
        const key=String(m.id||idx);
        const info=receiptMap[key];
        if(!info) return;
        const row=msgEl.querySelector(`.msg-row[data-msg-id="${CSS.escape(String(m.id||''))}"]`);
        if(!row) return;
        const stack=row.querySelector('.msg-stack');
        if(!stack) return;
        const old=[...stack.children].find(el=>el.classList&&el.classList.contains('msg-read-label'));
        const _t=esc(msgTimeText(m));
        const tick=rcTickHtml(info.status||'sent');
        const html=(info.mode==='seen-anchor')
          ? `<div class="msg-read-label">Seen ${_t}</div>`
          : `<div class="msg-read-label msg-time-only">${_t}${_t?' ':''}${tick}</div>`;
        if(old) old.outerHTML=html;
        else stack.insertAdjacentHTML('beforeend', html);
      });
      // no old bottom/global receipt labels
      msgEl.querySelectorAll('.seen-label').forEach(el=>el.remove());
    }catch(e){}
  }
  
  function renderMedia(m){
    /* BUGFIX companion: media evicted by the quota handler would otherwise
       render as an empty bubble. Show a clear placeholder instead. */
    if(m && m._evicted){
      return `<div style="padding:8px 10px;font-size:12px;opacity:.75;font-style:italic;">${esc(m._evictedNote||'📁 Attachment removed to free space')}</div>`;
    }
    const txt=m.text||'';
    const type=m.type|| (txt.startsWith('data:image')?'image': txt.startsWith('data:video')?'video': txt.startsWith('data:audio')?'audio':'text');
    const caption=m.caption?`<div class="media-caption">${esc(m.caption)}</div>`:'';
    if(type==='image' && /^(data:|https?:|blob:)/.test(txt)){
      /* FIX: show/tap photos for both sender and receiver. Inline onclick is a
         fallback for row click handlers; capture listener also handles it. */
      const safeSrc=String(txt).replace(/'/g,'&#39;');
      return `<div style="max-width:260px;"><img src="${txt}" data-lb="image" onclick="event.preventDefault();event.stopPropagation();openLightbox('${safeSrc}','image');" style="max-width:100%;max-height:280px;border-radius:16px;display:block;cursor:zoom-in;" alt="photo">${caption||''}</div>`;
    }
    if(type==='video' && /^(data:|https?:|blob:)/.test(txt)){
      return `<div style="max-width:300px;position:relative;"><video src="${txt}" data-lb="video" controls playsinline style="max-width:100%;max-height:300px;border-radius:16px;display:block;background:#000;"></video><button type="button" class="lb-expand" data-lb-open="video" title="Fullscreen" style="position:absolute;top:8px;right:8px;width:30px;height:30px;border:none;border-radius:50%;background:rgba(2,6,23,.6);color:#fff;cursor:pointer;font-size:13px;line-height:1;">⛶</button>${caption||''}</div>`;
    }
    /* Voice-note UI for both old and new audio messages — no native controls. */
    if(AuroraVoice.isVoiceMessage(m) && /^(data:|https?:|blob:)/.test(txt)){
      return AuroraVoice.render(m,caption);
    }
    /* 📎 GENERIC FILE — pdf, docx, zip, apk, html… download card */
    if(type==='file' && /^(data:|https?:|blob:)/.test(txt)){
      const fsz=(typeof m.fileSize==='number'&&m.fileSize>0)
        ? (m.fileSize>=1048576 ? (Math.round(m.fileSize/1048576*10)/10)+' MB' : Math.max(1,Math.round(m.fileSize/1024))+' KB')
        : '';
      const dlHref=(typeof mediaDownloadUrl==='function') ? mediaDownloadUrl(txt, m.fileName) : txt;
      return `<a href="${dlHref}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="display:flex;align-items:center;gap:11px;text-decoration:none;color:inherit;min-width:210px;max-width:290px;padding:11px 13px;background:rgba(15,23,42,.07);border:1px solid rgba(15,23,42,.08);border-radius:14px;"><span style="font-size:26px;flex-shrink:0;">📎</span><span style="min-width:0;flex:1;text-align:left;"><span style="display:block;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.fileName||'File')}</span><span style="display:block;font-size:11px;opacity:.65;margin-top:1px;">${fsz?fsz+' · ':''}Tap to open / download ⬇</span></span></a>${caption||''}`;
    }
    if(txt.length>500 && txt.startsWith('data:')){
      return `<div style="padding:8px 10px;font-size:12px;opacity:.9;">📎 Large media · <a href="${txt}" target="_blank" style="color:inherit;text-decoration:underline;font-weight:600;">Open</a></div>`;
    }
    return esc(txt);
  }

  if(isCloud && db){
    try{
      if(unsubMessages) unsubMessages();
      const {collection,query,orderBy,onSnapshot}=AURORA_SB;
      // If user switched chats while the SDK import was loading, do not attach
      // a listener for the old room (it can later overwrite unsubMessages).
      if(currentRoomId!==roomId || msgEl.dataset.roomId!==String(roomId||'')) return;
      const q=query(collection(db,'rooms',roomId,'messages'), orderBy('timestamp','asc'));
      let firstMsgSnap=true;
      unsubMessages=onSnapshot(q,(snap)=>{
        // FIX: stale cloud snapshots from a previously opened room must not
        // paint into the currently visible conversation.
        if(currentRoomId!==roomId || msgEl.dataset.roomId!==String(roomId||'')) return;
        const isFirstRender=firstMsgSnap;
        if(firstMsgSnap){
          firstMsgSnap=false;
          snap.docs.forEach(doc=>rememberNotificationMessage(roomId,doc.id));
        }else{
          try{
            snap.docChanges().forEach(ch=>{
              if(ch.type!=='added') return;
              const m={...ch.doc.data(),id:ch.doc.id};
              if(notifyIncomingMessage(messageNotificationOptions(roomId,m,roomMeta[roomId]||{}))!==false){
                bumpUnread(roomId);renderChats();
              }
            });
          }catch(e){}
        }
        try{cloudUpgradeRoomMessages(roomId,isConversationVisible(roomId)?'seen':'delivered');}catch(e){}
        if(!isFirstRender && msgEl._isScrolling){msgEl._pendingRender=true;return;}
        const msgs=snap.docs.map(d=>({id:d.id,...d.data()}));
        /* FEATURE: theme/wallpaper sync message ashle apply kori */
        try{ if(syncWallpaperFromMessages(roomId,msgs)) applyChatBg(roomId); }catch(e){}
        if(msgs.length===0){msgEl.innerHTML=`<div style="display:flex;justify-content:center;margin:20px 0;"><div style="background:#f8fafc;border:1px solid #f1f5f9;padding:8px 12px;border-radius:20px;font-size:11px;color:#64748b;">No messages yet • Send 📷🎥</div></div>`;return;}
        
        // Get other user's avatar for received messages
        const contact=contacts.find(c=>c.id===roomId);
        const otherAvatarHtml=contact?avHTML(contact):'';
        const otherAvatarBg=contact?avBg(contact,contact.color):'#7c3aed';
        const otherAvatarUrl=contact?.avatarUrl||(contact?.avatar&&contact.avatar.startsWith('data:')?contact.avatar:null);
        
        // Smart rendering: only append new messages instead of re-rendering everything
        const existingMsgIds = new Set();
        msgEl.querySelectorAll('.msg-row[data-msg-id]').forEach(el => {
          existingMsgIds.add(el.dataset.msgId);
        });
        const hasNewMessages = msgs.some(m => !m.system && !existingMsgIds.has(String(m.id||'')));
        
        const receiptMap=buildReceiptMap(
          msgs,
          (x)=>x.senderId===currentUser?.uid || x.senderName===currentUserData.username,
          (x)=>rcStatusCloud(x, roomMeta[roomId]||{}, rcOtherU)
        );
        // Check if we need full re-render (first load or message count changed significantly).
        // Receipt-only updates are synced in-place below, so sending a message no longer
        // makes the whole conversation visibly reload.
        const needsFullRender = msgEl.querySelectorAll('.msg-row[data-msg-id]').length === 0 ||
                                Math.abs(msgs.length - existingMsgIds.size) > 5;
        
        if(needsFullRender) {
          // Full re-render for initial load or major changes
          msgEl.classList.add('silent-render');
          msgEl.innerHTML=msgs.map((m,idx)=>{
            if(m.system) return `<div style="display:flex;justify-content:center;margin:10px 0;"><div style="background:#f8fafc;border:1px solid #f1f5f9;padding:6px 12px;border-radius:20px;font-size:10px;color:#64748b;">${esc(m.text)}</div></div>`;
            if(m.senderName && m.senderName!==currentUserData?.username && isUserBlocked(m.senderName)) return `<div style="display:flex;justify-content:center;margin:4px 0;"><div style="background:#fef2f2;border:1px solid #fecaca;padding:4px 10px;border-radius:16px;font-size:10px;color:#991b1b;">🚫 Message from blocked user</div></div>`;
            const isMe=m.senderId===currentUser?.uid || m.senderName===currentUserData.username;
            const mediaHtml=renderMedia(m);
            const prevMsg=msgs[idx-1];
            const nextMsg=msgs[idx+1];
            const prevIsMe=prevMsg?((prevMsg.senderId===currentUser?.uid || prevMsg.senderName===currentUserData.username)===isMe && !prevMsg.system):false;
            const nextIsMe=nextMsg?(nextMsg.senderId===currentUser?.uid || nextMsg.senderName===currentUserData.username):true;
            const showAvatar=!isMe && (nextIsMe || idx===msgs.length-1 || (nextMsg&&nextMsg.system));
            const grouped=!!prevIsMe;
            const isLastMine=isMe && (idx===msgs.length-1 || !(nextMsg && !nextMsg.system && (nextMsg.senderId===currentUser?.uid || nextMsg.senderName===currentUserData.username)));
            const rInfo=receiptMap[String(m.id||idx)]||{};
            return buildMsgRowHTML(m,{isMe,showAvatar,grouped,isLastMine,receiptStatus:rInfo.status,receiptMode:rInfo.mode,otherAvatarHtml,otherAvatarBg,otherAvatarUrl,rcOtherU,roomMeta:roomMeta[roomId]||{},mediaHtml,allMessages:msgs});
          }).join('');
          /* BUGFIX: cache the rendered messages so reply/copy/delete can find
             them. In cloud mode messages live in the database and are NEVER
             written to chatbd_global_rooms, so the old lookup always failed. */
          try{ window._msgCache={roomId, msgs}; }catch(e){}
          try{ injectDayChips(msgEl, msgs, m=>m.timestamp); }catch(e){}
          requestAnimationFrame(()=>msgEl.classList.remove('silent-render'));
        } else {
          // Incremental update: only add new messages
          msgs.forEach((m, idx) => {
            if(m.system || existingMsgIds.has(m.id)) return;
            if(m.senderName && m.senderName!==currentUserData?.username && isUserBlocked(m.senderName)) {
              msgEl.insertAdjacentHTML('beforeend', `<div style="display:flex;justify-content:center;margin:4px 0;"><div style="background:#fef2f2;border:1px solid #fecaca;padding:4px 10px;border-radius:16px;font-size:10px;color:#991b1b;">🚫 Message from blocked user</div></div>`);
              return;
            }
            const isMe=m.senderId===currentUser?.uid || m.senderName===currentUserData.username;
            const mediaHtml=renderMedia(m);
            const nextMsg=msgs[idx+1];
            const nextIsMe=nextMsg?(nextMsg.senderId===currentUser?.uid || nextMsg.senderName===currentUserData.username):true;
            const showAvatar=!isMe && (nextIsMe || idx===msgs.length-1);
            const isLastMine=isMe && idx===msgs.length-1;
            const rInfo=receiptMap[String(m.id||idx)]||{};
            msgEl.insertAdjacentHTML('beforeend', buildMsgRowHTML(m,{isMe,showAvatar,grouped:true,isLastMine,receiptStatus:rInfo.status,receiptMode:rInfo.mode,otherAvatarHtml,otherAvatarBg,otherAvatarUrl,rcOtherU,roomMeta:roomMeta[roomId]||{},mediaHtml,allMessages:msgs}));
            // refresh previous last-mine read label
            /* FEATURE: keep per-message time labels. Only the Read/Delivered
               status line is unique to the newest own message, so prune those
               (never .msg-time-only, which every bubble now carries). */
            try{ msgEl.querySelectorAll('.msg-read-label:not(.msg-time-only)').forEach((el,i,arr)=>{ if(i<arr.length-1) el.remove(); }); }catch(e){}
            try{ window._msgCache={roomId, msgs}; }catch(e){}  // BUGFIX: keep cache fresh on append
          });
        }
        // Receipt-only changes are applied in-place so the chat doesn't visibly reload.
        try{ applyReceiptMapToDom(msgEl, msgs, receiptMap); }catch(e){}
        // ✓✓ Last message er niche TEXT status (Sent / Delivered / Seen + photo)
        try{
          const lastM=msgs[msgs.length-1];
          const lastMine=lastM&&((currentUser&&lastM.senderId===currentUser.uid)||lastM.senderName===currentUserData.username);
          if(lastMine&&lastM){
            const st=rcStatusCloud(lastM,roomMeta[roomId]||{},rcOtherU);
            const rcC=(contacts||[]).find(c=>c.id===roomId)||{};
            rcInsertStatusLabel(msgEl, roomId, st, rcC);
          }
        }catch(e){}
        // Ami ei chat dekhechi -> sender er ticks ✓✓ blue hobe
        if(isConversationVisible(roomId)) cloudMarkSeen(roomId);
        // Invisible auto-scroll: no smooth animation / no jump on receipt-only reloads.
        // Open chat or append while already at bottom -> snap to bottom silently.
        // If user is reading older messages, keep the exact position.
        // Stabilize before paint: short chats align to bottom via CSS class;
        // long chats only snap if the user was already at bottom.
        stabilizeMessages(isFirstRender || (hasNewMessages && wasAtBottom));
      },(err)=>{try{rcptFail('MSG LISTEN ERR: '+err.message);}catch(e){}});
      
      // Add scroll listener to detect when user is scrolling
      if(!msgEl._scrollListenerAdded) {
        let scrollTimeout;
        msgEl.addEventListener('scroll', () => {
      const distanceFromBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight;
      if(!msgEl._programmaticScroll){
        if(distanceFromBottom > 80) msgEl._userScrolledUp = true;
        else if(distanceFromBottom < 24) msgEl._userScrolledUp = false;
      }
      msgEl._isScrolling = true;
      clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            msgEl._isScrolling = false;
            // If there was a pending render, do it now
            if(msgEl._pendingRender) {
              msgEl._pendingRender = false;
              renderMessagesForRoom(currentRoomId, false);
            }
          }, 150); // 150ms after scroll stops
        });
        msgEl._scrollListenerAdded = true;
      }
      
      return;
    }catch(e){}
  }
  const rooms=getGlobalRooms();
  const room=rooms[roomId];
  if(!room){msgEl.innerHTML='<div style="text-align:center;color:#94a3b8;font-size:11px;">No messages</div>';return;}
  // ✓✓ local seen marker - onno tab/user er ticks update hobe
  try{
    const me=currentUserData.username;
    const hasNewer=(room.messages||[]).some(m=>m.sender!==me && (m.timestamp||0)>(room['lastSeenAt_'+me]||0));
    if(hasNewer){room['lastSeenAt_'+me]=Date.now(); saveGlobalRooms(rooms);}
  }catch(e){}
  // Get other user's avatar for received messages
  const contact=contacts.find(c=>c.id===roomId);
  const otherAvatarHtml=contact?avHTML(contact):'';
  const otherAvatarBg=contact?avBg(contact,contact.color):'#7c3aed';
  const otherAvatarUrl=contact?.avatarUrl||(contact?.avatar&&contact.avatar.startsWith('data:')?contact.avatar:null);
  const receiptMap=buildReceiptMap(
    room.messages||[],
    (x)=>x.sender===currentUserData.username,
    (x)=>rcStatusLocal(x, room, rcOtherU)
  );
  msgEl.classList.add('silent-render');
  msgEl.innerHTML=room.messages.map((m,idx)=>{
    if(m.system) return `<div style="display:flex;justify-content:center;margin:10px 0;"><div style="background:#f8fafc;border:1px solid #f1f5f9;padding:6px 12px;border-radius:20px;font-size:10px;color:#64748b;">${esc(m.text)}</div></div>`;
    if(m.sender && m.sender!==currentUserData?.username && isUserBlocked(m.sender)) return `<div style="display:flex;justify-content:center;margin:4px 0;"><div style="background:#fef2f2;border:1px solid #fecaca;padding:4px 10px;border-radius:16px;font-size:10px;color:#991b1b;">🚫 Message from blocked user</div></div>`;
    const isMe=m.sender===currentUserData.username;
    const mediaHtml=renderMedia(m);
    const prevMsg=room.messages[idx-1];
    const nextMsg=room.messages[idx+1];
    const prevSame=prevMsg && !prevMsg.system && ((prevMsg.sender===currentUserData.username)===isMe);
    const nextIsMe=nextMsg?(nextMsg.sender===currentUserData.username):true;
    const showAvatar=!isMe && (nextIsMe || idx===room.messages.length-1 || (nextMsg&&nextMsg.system));
    const grouped=!!prevSame;
    const isLastMine=isMe && (idx===room.messages.length-1 || !(nextMsg && !nextMsg.system && nextMsg.sender===currentUserData.username));
    const rInfo=receiptMap[String(m.id||idx)]||{};
    return buildMsgRowHTML(m,{isMe,showAvatar,grouped,isLastMine,receiptStatus:rInfo.status,receiptMode:rInfo.mode,otherAvatarHtml,otherAvatarBg,otherAvatarUrl,rcOtherU,roomLocal:room,mediaHtml,allMessages:room.messages});
  }).join('');
  /* BUGFIX: same cache for the local path, so msg actions have one source. */
  try{ window._msgCache={roomId, msgs:room.messages||[]}; }catch(e){}
  try{ injectDayChips(msgEl, room.messages||[], m=>m.timestamp); }catch(e){}
  try{ applyReceiptMapToDom(msgEl, room.messages||[], receiptMap); }catch(e){}
  requestAnimationFrame(()=>msgEl.classList.remove('silent-render'));
  // ✓✓ Last message er niche TEXT status (local)
  try{
    const lastM=(room.messages||[])[room.messages.length-1];
    if(lastM&&lastM.sender===currentUserData.username){
      const st=rcStatusLocal(lastM,room,rcOtherU);
      const rcC=(contacts||[]).find(c=>c.id===roomId)||getUsers()[rcOtherU]||{username:rcOtherU};
      rcInsertStatusLabel(msgEl, roomId, st, rcC);
    }
  }catch(e){}
  // Invisible auto-scroll: keep reload/re-render unnoticeable.
  // Stabilize before paint so the message doesn't rise and then drop.
  stabilizeMessages(wasAtBottom);
}

async function sendMessage(){
  const input=$('#msgInput');
  const text=input.value.trim();
  if(!text||!currentRoomId||!currentUserData) return;
  // FIX: lock the target room at the moment Send is tapped. Async work below
  // must not accidentally send into another chat if the user switches quickly.
  const targetRoomId = currentRoomId;
  
  // STEP 1: Clear input IMMEDIATELY (synchronous, no await before this)
  const savedText = text;
  input.value='';
  input.style.height='auto';
  input.rows=1;
  
  // Handle reply (message reply OR note reply)
  let replyToId=null;
  let noteReplyData=null;
  if(window.noteReplyCtx){
    noteReplyData=noteReplyPayload(window.noteReplyCtx);
  }else if(window.replyToMsg){
    replyToId=window.replyToMsg.id;
  }
  cancelReply(); // Clear the reply preview (clears both kinds)
  
  try{ syncSendBtn(); }catch(e){}
  try{ stopMyTyping(targetRoomId); }catch(e){}
  
  // STEP 2: Give browser time to paint (50ms is enough for render but feels instant)
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // STEP 3: Now do heavy async work (input is already visually cleared)
  if(isCloud && db && currentUser){
    try{
      const {collection,addDoc,serverTimestamp,doc,updateDoc}=AURORA_SB;
      const msgData={text: savedText, senderId:currentUser.uid, senderName:currentUserData.username, senderNickname:currentUserData.nickname||currentUserData.username, senderColor:currentUserData.color, time:timeNow(), timestamp:serverTimestamp(), type:'text', status:'sent'};
      if(replyToId) msgData.replyTo=replyToId;
      if(noteReplyData) msgData.noteReply=noteReplyData;
      await persistCloudChatMessage(targetRoomId,msgData,savedText.slice(0,30));
      afterMessageSent(targetRoomId, savedText.slice(0,30), Date.now());   // list-ta sathe sathe
      return;
    }catch(e){
      // If the cloud write fails, restore the text
      input.value=savedText;
      return;
    }
  }
  const rooms=getGlobalRooms();
  const room=rooms[targetRoomId];
  if(!room) return;
  const msg={id:Date.now().toString(), text: savedText, sender:currentUserData.username, senderNickname:currentUserData.nickname||currentUserData.username, time:timeNow(), timestamp:Date.now(), type:'text'};
  if(replyToId) msg.replyTo=replyToId;
  if(noteReplyData) msg.noteReply=noteReplyData;
  room.messages.push(msg); room.lastMessage=savedText.slice(0,30); room.lastTime=timeNow();
  room.lastMessageTs=msg.timestamp;   // absolute stamp (date+time) so sorting never loses the date
  rooms[targetRoomId]=room; saveGlobalRooms(rooms);
  if(currentRoomId===targetRoomId) renderMessagesForRoom(targetRoomId, false);
  afterMessageSent(targetRoomId, savedText.slice(0,30), msg.timestamp);   // "Now" + top e
  refreshContactsFromLocal(); renderChats();
}

/* VIP+ may send bigger files (perk: upload.large) */
function checkUploadLimit(file){
  try{
    const mb=(file?.size||0)/(1024*1024);
    const cap=maxUploadMB();
    if(mb>cap){
      showToast({title:'File too large',
        body:Math.round(mb)+'MB · your limit is '+cap+'MB'+(cap<25?' — VIP gets 25MB':''),
        color:'#ef4444',avatar:'📁'});
      return false;
    }
  }catch(e){}
  return true;
}
window.checkUploadLimit=checkUploadLimit;

function getFileType(file){
  if(file.type.startsWith('image/')) return 'image';
  if(file.type.startsWith('video/')) return 'video';
  if(file.type.startsWith('audio/') || ((!file.type || file.type==='application/octet-stream') && /\.(mp3|m4a|aac|ogg|oga|opus|wav|weba|flac)$/i.test(file.name||''))) return 'audio';
  return 'file';
}


function compressImageFile(file, opts){
  opts = opts || {};
  // Defaults tuned so 3–4MB phone photos still look good after optimize
  const maxEdge = opts.maxEdge || 1920;
  const maxBytes = opts.maxBytes || 1200000; // ~1.2MB binary target (local-friendly)
  const maxDataUrlLen = opts.maxDataUrlLen || 1600000;
  const minEdge = opts.minEdge || 640;
  const startQ = opts.quality || 0.9;
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      try{
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if(!w || !h){ URL.revokeObjectURL(url); reject(new Error('Invalid image')); return; }
        const scale0 = Math.min(1, maxEdge / Math.max(w,h));
        w = Math.max(1, Math.round(w * scale0));
        h = Math.max(1, Math.round(h * scale0));
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha:false, willReadFrequently:true });
        let quality = startQ;
        let dataUrl = '';
        const draw = (ww, hh)=>{
          canvas.width = ww; canvas.height = hh;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0,0,ww,hh);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, ww, hh);
        };
        // iterative compress — handles multi-MB camera photos
        for(let pass=0; pass<18; pass++){
          draw(w,h);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          const approxBytes = Math.floor((dataUrl.length - (dataUrl.indexOf(',')+1)) * 0.75);
          if(dataUrl.length <= maxDataUrlLen && approxBytes <= maxBytes) break;
          if(quality > 0.62) quality = Math.max(0.62, quality - 0.06);
          else {
            w = Math.max(minEdge, Math.round(w * 0.86));
            h = Math.max(minEdge, Math.round(h * 0.86));
            quality = Math.max(0.58, quality - 0.02);
          }
        }
        URL.revokeObjectURL(url);
        resolve({ dataUrl, width:w, height:h, quality, mime:'image/jpeg', approxBytes: Math.floor((dataUrl.length - (dataUrl.indexOf(',')+1)) * 0.75) });
      }catch(err){
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

async function sendMediaMessage(file){
  if(!file||!currentRoomId||!currentUserData){alert('Age chat open koro');return;}
  // Lock the room at attach time; image compression/upload is async.
  const targetRoomId=currentRoomId;
  const type = getFileType(file);
  const isVideo = type==='video';
  const isImage = type==='image';
  const isAudio = type==='audio';
  const isGeneric = !isVideo && !isImage && !isAudio;   // pdf, docx, zip, apk, html ইত্যাদি
  /* ☁️ Signed in → the file is uploaded, so limits are generous:
     photo 25MB (compressed to ~2MB before upload) · video/audio up to
     SUPABASE_MAX_UPLOAD_MB for VIP+ · any other file (pdf/zip/html…) 25MB.
     Not signed in → the local inline path below (photo/video only). */
  const cloudOn = (typeof cloudUploadEnabled==='function') ? cloudUploadEnabled() : false;
  const perkCap = (cloudOn ? (can('upload.large')?SUPABASE_MAX_UPLOAD_MB:Math.min(25,SUPABASE_MAX_UPLOAD_MB)) : maxUploadMB())*1024*1024;
  const hardCap = cloudOn
    ? (isGeneric ? Math.min(25,SUPABASE_MAX_UPLOAD_MB) : SUPABASE_MAX_UPLOAD_MB)*1024*1024
    : (isVideo ? 20*1024*1024 : 12*1024*1024);
  const maxSize = Math.min(perkCap, hardCap);
  if(file.size>maxSize){
    const mb=Math.round(file.size/1048576);
    const capMB=Math.round(maxSize/1048576);
    try{
      showToast({title:'File too large',
        body:mb+'MB · your limit is '+capMB+'MB'+(can('upload.large')?'':' — VIP gets more'),
        color:'#ef4444',avatar:'📁'});
    }catch(e){
      alert('File too large! Max '+capMB+'MB');
    }
    return;
  }
  if(!cloudOn && !isVideo && !isImage){
    try{ showToast({title:'Sign in to send files', body:'🎵 Audio / 📎 files need a cloud account — sign in, or send a photo/video (those work offline too)', color:'#f59e0b', avatar:'📎'}); }
    catch(e){ alert('Sign in to send audio or files (photo/video work without signing in)'); }
    return;
  }

  const msgEl=$('#messages');
  const tempId='temp_'+Date.now();
  if(msgEl){
    msgEl.insertAdjacentHTML('beforeend',`<div class="msg-row sent" id="${tempId}"><div class="bubble sent">📤 Preparing ${(file.size/1024).toFixed(0)}KB...</div></div>`);
    const isNearBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 100;
    if(isNearBottom) msgEl.scrollTop = msgEl.scrollHeight;
  }

  // Metadata analysis runs alongside the upload; it never changes the audio.
  const audioMetaTask = isAudio ? AuroraVoice.analyseFile(file).catch(()=>({})) : Promise.resolve({});
  let uploadedAudioDuration=0;
  const displayText = type==='image'?'📷 Photo':type==='video'?'🎥 Video':type==='audio'?'🎤 Voice message':'📎 '+(file.name||'File');
  const setTemp = (t)=>{ const el=document.getElementById(tempId); if(el){ const b=el.querySelector('.bubble'); if(b) b.textContent=t; } };
  const clearTemp = ()=>{ const el=document.getElementById(tempId); if(el) el.remove(); };

  try{
    let dataUrl = '';
    let outSize = file.size;
    let outName = file.name || (isImage ? 'photo.jpg' : isVideo ? 'video.mp4' : isAudio ? 'audio.mp3' : 'file');

    /* ☁️ CLOUD PATH — the file goes straight to storage and the message keeps
       only a short link, so neither the row limit nor localStorage fills up. */
    if(cloudOn){
      try{
        let upBlob = file;
        if(isImage){
          setTemp('🖼️ Optimizing photo...');
          try{
            const cimg = await compressImageFile(file,{maxEdge:1920,maxBytes:1800000,maxDataUrlLen:2400000,quality:0.9,minEdge:720});
            upBlob = await (await fetch(cimg.dataUrl)).blob();
            outName = (file.name||'photo').replace(/\.\w+$/,'') + '.jpg';
          }catch(_){ upBlob = file; }
        }
        const upIcon = isVideo?'🎥':isAudio?'🎵':isImage?'📷':'📎';
        setTemp(upIcon+' Uploading 0%…');
        const up = await uploadToStorage(upBlob, {
          isVideo,
          fileName: outName,
          onProgress:(p)=> setTemp(upIcon + ' Uploading ' + p + '%…')
        });
        dataUrl = up.secure_url;
        outSize = up.bytes || upBlob.size || file.size;
        if(isAudio && Number.isFinite(up.duration) && up.duration>0) uploadedAudioDuration=up.duration;
        // now dataUrl is a short https link — both the cloud and local paths save it easily ✓
      }catch(upErr){
        console.log('Cloud upload failed, trying inline…', upErr);
        setTemp('⚠️ Cloud upload failed — trying inline…');
        dataUrl = ''; // পুরনো inline (base64) flow-তে fallback
      }
    }

    if(!dataUrl && isImage){
      setTemp('🖼️ Compressing photo...');
      try{
        // Target comfortably under database practical limits
        // Keep quality high for 3–4MB inputs; still fit cloud when possible
        const compressed = await compressImageFile(file, {
          maxEdge: 1920,
          maxBytes: 1800000,      // prefer ~1.5–1.8MB quality locally
          maxDataUrlLen: 2400000,
          quality: 0.9,
          minEdge: 720
        });
        dataUrl = compressed.dataUrl;
        outSize = compressed.approxBytes || Math.floor(dataUrl.length*0.75);
        outName = (file.name || 'photo').replace(/\.\w+$/,'') + '.jpg';
        setTemp('📤 Uploading ~' + Math.max(1, Math.round(outSize/1024)) + 'KB...');
      }catch(cerr){
        console.log('compress fail, fallback raw', cerr);
        // fallback to original dataURL if small enough
        dataUrl = await new Promise((resolve,reject)=>{
          const r=new FileReader();
          r.onload=()=>resolve(r.result);
          r.onerror=reject;
          r.readAsDataURL(file);
        });
        outSize = file.size;
      }
    }else if(!dataUrl){
      // video: keep as dataURL but warn if huge (শুধু cloud বন্ধ/ব্যর্থ হলে)
      setTemp(isAudio?'🎤 Reading voice message…':'📤 Reading video...');
      dataUrl = await new Promise((resolve,reject)=>{
        const r=new FileReader();
        r.onload=()=>resolve(r.result);
        r.onerror=reject;
        r.readAsDataURL(file);
      });
      outSize = file.size;
      if(dataUrl.length > 1200000){
        // still try local only
        console.log('video dataUrl large', dataUrl.length);
      }
    }

    // If cloud is on, make a cloud-safe copy under ~900KB string when needed
    let cloudDataUrl = dataUrl;
    let cloudSize = outSize;
    if(isImage && isCloud && db && currentUser && cloudDataUrl.length > 900000){
      setTemp('☁️ Optimizing for cloud...');
      try{
        const blob = await (await fetch(dataUrl)).blob();
        const harder = await compressImageFile(new File([blob], outName, {type:'image/jpeg'}), {
          maxEdge: 1440,
          maxBytes: 700000,
          maxDataUrlLen: 900000,
          quality: 0.82,
          minEdge: 640
        });
        cloudDataUrl = harder.dataUrl;
        cloudSize = harder.approxBytes || cloudSize;
        // One more tiny pass if the photo is still too large for database.
        // This prevents the old "saved locally" fallback where the receiver
        // could not see the picture.
        if(cloudDataUrl.length > 950000){
          const tinyBlob = await (await fetch(cloudDataUrl)).blob();
          const tiny = await compressImageFile(new File([tinyBlob], outName, {type:'image/jpeg'}), {
            maxEdge: 960,
            maxBytes: 420000,
            maxDataUrlLen: 650000,
            quality: 0.74,
            minEdge: 360
          });
          cloudDataUrl = tiny.dataUrl;
          cloudSize = tiny.approxBytes || cloudSize;
        }
      }catch(e){ console.log('cloud compress fail', e); }
    }

    const audioMeta = await audioMetaTask;
    if(uploadedAudioDuration) audioMeta.audioDuration=uploadedAudioDuration;
    clearTemp();

    // Cloud path
    if(isCloud && db && currentUser){
      try{
        const payloadUrl = (cloudDataUrl && cloudDataUrl.length <= 1000000) ? cloudDataUrl : dataUrl;
        if(payloadUrl.length > 1000000){
          throw new Error('Cloud copy still large — saved locally');
        }
        dataUrl = payloadUrl;
        outSize = cloudSize || outSize;
        setTemp && null;
        const {collection,addDoc,serverTimestamp,doc,updateDoc}=AURORA_SB;
        const messageData={
          text:dataUrl,
          senderId:currentUser.uid,
          senderName:currentUserData.username,
          senderNickname:currentUserData.nickname||currentUserData.username,
          senderColor:currentUserData.color,
          time:timeNow(),
          timestamp:serverTimestamp(),
          type: isImage ? 'image' : type,
          fileName: outName,
          fileSize: outSize,
          status:'sent',
          compressed: !!isImage,
          ...audioMeta
        };
        await persistCloudChatMessage(targetRoomId,messageData,displayText);
        afterMessageSent(targetRoomId, displayText, Date.now());   // list-ta sathe sathe
        try{ showToast({title:isAudio?'Voice message sent':'Photo sent', body: isImage ? ('Ready · ~'+Math.round(outSize/1024)+'KB from multi-MB photo') : 'Uploaded', color:'#10b981', avatar:isAudio?'🎤':'📷'}); }catch(e){}
        return;
      }catch(err){
        console.log('FB media fail', err.message);
        // fall through to local
        try{ showToast({title:'Cloud limit', body:'Saved in local chat · '+String(err.message||'').slice(0,80), color:'#f59e0b', avatar:'!'}); }catch(e){}
      }
    }

    // Local path
    const rooms=getGlobalRooms();
    const room=rooms[targetRoomId];
    if(!room) return;
    const msg={
      id:Date.now().toString(),
      text:dataUrl,
      sender:currentUserData.username,
      senderNickname:currentUserData.nickname||currentUserData.username,
      time:timeNow(),
      timestamp:Date.now(),
      type: isImage ? 'image' : type,
      fileName: outName,
      fileSize: outSize,
      compressed: !!isImage,
      ...audioMeta
    };
    room.messages.push(msg);
    room.lastMessage=displayText;
    room.lastTime=timeNow();
    room.lastMessageTs=msg.timestamp;   // absolute stamp (date+time)
    rooms[targetRoomId]=room;
    saveGlobalRooms(rooms);
    if(currentRoomId===targetRoomId) renderMessagesForRoom(targetRoomId, false);
    afterMessageSent(targetRoomId, displayText, msg.timestamp);   // "Now" + top e
    refreshContactsFromLocal(); if(!(contacts&&contacts.length)) contacts=loadUserContacts(currentUserData.username)||contacts||[];
    renderChats();
  }catch(e){
    clearTemp();
    alert('Send failed: '+(e.message||e));
    console.log('sendMediaMessage error', e);
  }
}



/* Chat composer extras */
document.getElementById('galleryBtn')?.addEventListener('click',()=>document.getElementById('mediaInput')?.click());
/* FIX: the emoji button used to shove a RANDOM emoji straight into the
   textarea instead of showing a picker. Now it opens a real grid. */
const EMOJI_SETS = {
  recent:{icon:'🕘', label:'Recent', list:[]},
  smileys:{icon:'😀', label:'Smileys', list:['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','🫠','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','🫨','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾']},
  gestures:{icon:'👍', label:'People', list:['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👣','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦','💋','🩸','👶','🧒','👦','👧','🧑','👨','👩','🧔','👱','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','🥷','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','👯','🧖','🧗','👭','👫','👬','💏','💑','👪','🗣️','👤','👥']},
  hearts:{icon:'❤️', label:'Hearts', list:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💐','🌹','🥀','🌷','🌸','💮','🏵️','🌺','🌻','🌼','🌱','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🪴','🎋','🎍','💫','⭐','🌟','✨','⚡','🔥','💥','💢','💦','💨','🕳️','💣','💤']},
  animals:{icon:'🐶', label:'Animals', list:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🐾','🐉','🐲']},
  food:{icon:'🍔', label:'Food', list:['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂']},
  activity:{icon:'⚽', label:'Activity', list:['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩','🎉','🎊','🎈','🎁','🎀','🪅','🪩','🧨','✨']},
  travel:{icon:'✈️', label:'Travel', list:['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🪝','⛽','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🛖','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🌌','🎑','🌍','🌎','🌏','🌐','🌞','🌝','🌚','🌙','⛅','🌤️','🌧️','⛈️','🌨️','🌬️','🌀','🌈','☔','❄️','☃️','⛄']},
  objects:{icon:'💡', label:'Objects', list:['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💊','💉','🩹','🩺','🚪','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🪥','🧽','🔑','🗝️','🔒','🔓','🔐','🔏','🪧','📦','📫','📮','📝','✏️','🖊️','🖌️','🖍️','📚','📖','📓','📒','📃','📄','📑','🔖','🏷️','📊','📈','📉','📅','📆','🗓️','📌','📍','📎','🖇️','📐','📏','✂️','🗃️','🗄️','🗑️','👓','🕶️','🥽','👔','👕','👖','🧣','🧤','🧥','🧦','👗','👘','🥻','🩱','👙','👚','👛','👜','👝','🎒','👞','👟','🥾','🥿','👠','👡','👢','👑','👒','🎩','🎓','🧢','⛑️','💄','💍','💼','🌂','☂️']},
  symbols:{icon:'💯', label:'Symbols', list:['✅','❌','❎','✔️','☑️','❓','❔','❗','❕','‼️','⁉️','💯','🔔','🔕','🎵','🎶','➕','➖','➗','✖️','🟰','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','🔘','🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜','◼️','◻️','▪️','▫️','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔲','🔳','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏫','⏬','▶️','◀️','🔼','🔽','🔀','🔁','🔂','🔄','🔃','♻️','⚠️','🚸','⛔','🚫','🚭','☢️','☣️','⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎','🆔','🆕','🆒','🆓','🆗','🆙','🆖','🅰️','🅱️','🅾️','🆎','🈵','🈶','㊗️','㊙️']}
};
let _epTab='smileys';

function _epRecent(){
  try{ return (JSON.parse(localStorage.getItem('aurora_recent_emoji')||'[]')||[]).slice(0,24); }
  catch(e){ return []; }
}
function _epPushRecent(em){
  try{
    let r=_epRecent().filter(x=>x!==em);
    r.unshift(em);
    localStorage.setItem('aurora_recent_emoji', JSON.stringify(r.slice(0,24)));
  }catch(e){}
}

function insertEmoji(em){
  const input=document.getElementById('msgInput');
  if(!input) return;
  const start=input.selectionStart ?? input.value.length;
  const end=input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0,start) + em + input.value.slice(end);
  const pos=start+em.length;
  input.focus();
  try{ input.selectionStart=input.selectionEnd=pos; }catch(e){}
  _epPushRecent(em);
  try{ syncSendBtn(); }catch(e){}
  try{ onComposerActivity(); }catch(e){}
  try{ input.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){}
}

function renderEmojiPicker(){
  const tabs=document.getElementById('epTabs');
  const grid=document.getElementById('epGrid');
  const lab=document.getElementById('epLabel');
  if(!tabs||!grid) return;

  EMOJI_SETS.recent.list=_epRecent();
  const keys=Object.keys(EMOJI_SETS).filter(k=>k!=='recent' || EMOJI_SETS.recent.list.length);
  if(!keys.includes(_epTab)) _epTab='smileys';

  tabs.innerHTML=keys.map(k=>
    `<button type="button" class="ep-tab ${k===_epTab?'on':''}" data-tab="${k}" title="${EMOJI_SETS[k].label}">${EMOJI_SETS[k].icon}</button>`
  ).join('');
  grid.innerHTML=EMOJI_SETS[_epTab].list.map(e=>
    `<button type="button" class="ep-em" data-em="${e}">${e}</button>`
  ).join('');
  if(lab) lab.textContent=EMOJI_SETS[_epTab].label;
  grid.scrollTop=0;

  tabs.querySelectorAll('.ep-tab').forEach(b=>{
    b.addEventListener('click',(ev)=>{ ev.stopPropagation(); _epTab=b.dataset.tab; renderEmojiPicker(); });
  });
  grid.querySelectorAll('.ep-em').forEach(b=>{
    b.addEventListener('click',(ev)=>{ ev.stopPropagation(); insertEmoji(b.dataset.em); });
  });
}

function toggleEmojiPicker(force){
  const box=document.getElementById('emojiPicker');
  const btn=document.getElementById('emojiBtn');
  if(!box) return;
  const open = (force===undefined) ? !box.classList.contains('show') : !!force;
  box.classList.toggle('show', open);
  btn?.classList.toggle('on', open);
  if(open) renderEmojiPicker();
}
window.toggleEmojiPicker=toggleEmojiPicker;
window.insertEmoji=insertEmoji;

document.getElementById('emojiBtn')?.addEventListener('click',(e)=>{
  e.preventDefault(); e.stopPropagation();
  toggleEmojiPicker();
});
document.getElementById('epClose')?.addEventListener('click',(e)=>{
  e.stopPropagation(); toggleEmojiPicker(false);
});
document.getElementById('emojiPicker')?.addEventListener('click',(e)=>e.stopPropagation());
document.addEventListener('click',(e)=>{
  const box=document.getElementById('emojiPicker');
  if(!box || !box.classList.contains('show')) return;
  if(e.target.closest('#emojiPicker,#emojiBtn')) return;
  toggleEmojiPicker(false);
});
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape') toggleEmojiPicker(false);
});
document.getElementById('quickReplies')?.addEventListener('click',(ev)=>{
  const chip=ev.target.closest('.qr-chip');
  if(!chip) return;
  const text=chip.dataset.qr||chip.textContent;
  const input=document.getElementById('msgInput');
  if(!input) return;
  input.value=text;
  input.focus();
  try{ sendMessage(); }catch(e){}
});
document.getElementById('videoCallBtn')?.addEventListener('click',()=>{
  showToast({title:'Video Call',body:'Video calling is coming soon. Use voice call for now.',color:'#2563eb',avatar:'▶'});
});
/* FIX: the two direct listeners below only fire when the tap lands exactly on
   #chatHeaderInfo / #chatAvatar. Taps on their children (the name text, the
   status line, the avatar <img>, the verified badge) bubbled past them and
   nothing opened. One delegated listener on the header covers every child,
   and the errors are surfaced instead of being swallowed by an empty catch. */
document.getElementById('mHeader')?.addEventListener('click',(e)=>{
  // ignore the real buttons in the header (back / call / video / more)
  if(e.target.closest('#backBtn,#moreBtn,#voiceCallBtn,#videoCallBtn,.m-action-btn')) return;
  if(!e.target.closest('#chatHeaderInfo,#chatAvatar,.m-user,.m-name,.m-status')) return;
  e.preventDefault();
  e.stopPropagation();
  Promise.resolve()
    .then(()=>window.viewProfile && window.viewProfile())
    .catch(err=>{
      console.error('viewProfile failed:', err);
      try{ showToast({title:'Profile', body:'Could not open profile', color:'#ef4444', avatar:'!'}); }catch(_){}
    });
});
// pointer affordance
try{
  ['chatHeaderInfo','chatAvatar'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.cursor='pointer';
  });
}catch(e){}
$('#attachBtn').addEventListener('click',()=>$('#fileInput').click());
$('#fileInput').addEventListener('change',(e)=>{const f=e.target.files[0]; if(f) sendMediaMessage(f); e.target.value='';});
const _mi=$('#mediaInput'); if(_mi) _mi.addEventListener('change',(e)=>{const f=e.target.files[0]; if(f) sendMediaMessage(f); e.target.value='';});
$('#searchInput').addEventListener('input',renderChats);
document.querySelectorAll('.filter-tabs .tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.filter-tabs .tab').forEach(x=>x.classList.remove('active')); t.classList.add('active'); renderChats();}));
$('#msgInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});

/* Composer: show send only when typing */
function syncSendBtn(){
  const input=document.getElementById('msgInput');
  const btn=document.getElementById('sendBtn');
  if(!input||!btn) return;
  const has=!!input.value.trim();
  btn.classList.toggle('show', has);
}
document.getElementById('msgInput')?.addEventListener('input', syncSendBtn);
document.getElementById('msgInput')?.addEventListener('focus', syncSendBtn);
// TYPING: broadcast while the user writes, stop on blur / empty input
document.getElementById('msgInput')?.addEventListener('input', ()=>{ try{ onComposerActivity(); }catch(e){} });
document.getElementById('msgInput')?.addEventListener('blur',  ()=>{ try{ stopMyTyping(); }catch(e){} });
document.getElementById('msgInput')?.addEventListener('keydown',(e)=>{
  if(e.key==='Enter' && !e.shiftKey){ try{ stopMyTyping(); }catch(err){} }
});
// + attach opens file menu same as gallery if needed - keep attach as file

$('#sendBtn').addEventListener('click',sendMessage);
document.getElementById('msgInput')?.addEventListener('input', syncSendBtn);

/* ===== Redesigned sidebar controls ===== */
function openSidebarProfileMenu(e){
  if(e) e.stopPropagation();
  // Profile tap → full Settings screen (design mockup)
  openSettings();
}
document.getElementById('headerProfileBtn')?.addEventListener('click', openSidebarProfileMenu);
document.getElementById('headerSettingsBtn')?.addEventListener('click', (e)=>{
  e.stopPropagation();
  openSettings();
});
// Long-press profile → quick menu (includes Settings)
(function(){
  const btn=document.getElementById('headerProfileBtn');
  if(!btn || btn._longPressBound) return;
  btn._longPressBound=true;
  let tmr=null;
  const openMenu=()=>{
    const menu=document.getElementById('sidebarMenu');
    if(!menu) return;
    const rect=btn.getBoundingClientRect();
    const shell=document.getElementById('phoneShell')||document.body;
    const sRect=shell.getBoundingClientRect();
    menu.style.top=(rect.bottom - sRect.top + 8)+'px';
    menu.style.right=Math.max(8, sRect.right - rect.right)+'px';
    menu.style.left='auto';
    menu.style.display='block';
    const notifText=document.getElementById('sidebarNotifText');
    const notifBtn=document.getElementById('notifBtn');
    if(notifText) notifText.textContent=(notificationsEnabled?'Notifications On':'Notifications Off');
  };
  btn.addEventListener('contextmenu', (e)=>{ e.preventDefault(); openMenu(); });
  btn.addEventListener('touchstart', ()=>{ tmr=setTimeout(()=>{ tmr=null; openMenu(); }, 550); }, {passive:true});
  btn.addEventListener('touchend', ()=>{ if(tmr) clearTimeout(tmr); });
  btn.addEventListener('touchmove', ()=>{ if(tmr) clearTimeout(tmr); });
})();

/* ===== Settings screen actions ===== */
function exitSettingsToChats(){
  try{ hardHideSettingsPages(); }catch(e){}
  try{ closeNotifSettings(); }catch(e){}
  try{ closeProfilePage(); }catch(e){}
  try{ closeAppearancePage(); }catch(e){}
  try{ closeSecurityPage(); }catch(e){}
  try{ closeBillingPage(); }catch(e){}
  try{ closePrivacyPage(); }catch(e){}
  try{ closeHelpPage(); }catch(e){}
  try{ closeSettings(); }catch(e){}
  // restore the chat-list chrome even if some sub-page hid it
  try{ restoreChatListChrome(); }catch(e){}
  try{ switchBottomNav('chats'); }catch(e){}
}
window.exitSettingsToChats=exitSettingsToChats;
document.getElementById('settingsBackBtn')?.addEventListener('click', exitSettingsToChats);
document.getElementById('settingsDoneBtn')?.addEventListener('click', exitSettingsToChats);
// legacy ids (if any remain)
/* BUGFIX: #settingsCloseProfileBtn and #settingsSearchBtn do not exist in the
   DOM (leftover legacy ids). Removed — they were permanent no-ops. */

document.getElementById('settingsEditPhotoBtn')?.addEventListener('click',()=>{
  document.getElementById('profilePicInput')?.click();
});
document.getElementById('settingsAvatar')?.addEventListener('click',()=>{
  document.getElementById('profilePicInput')?.click();
});
document.getElementById('stPersonalInfo')?.addEventListener('click',()=>{ openProfilePage(); });

/* ===== Personal Information / Profile page ===== */
function openProfilePage(){
  const view=document.getElementById('profileView');
  if(!view) return;
  try{
    document.querySelector('.s-search')&&(document.querySelector('.s-search').style.display='none');
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView'); if(sv) sv.classList.add('show');
    try{ closeNotifSettings(); }catch(e){}
  }catch(e){}
  // FIX: hardHideSettingsPages() may have left inline display:none/hidden on it
  try{ view.style.cssText=''; view.hidden=false; view.style.pointerEvents=''; }catch(e){}
  view.classList.add('show');
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings'));
  fillProfilePage();
}
function closeProfilePage(){
  const view=document.getElementById('profileView');
  if(view) view.classList.remove('show');
}
function fillProfilePage(){
  if(!currentUserData) return;
  const name=currentUserData.nickname||currentUserData.username||'';
  const user=currentUserData.username||'';
  const set=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val||'';};
  set('pfFullName', name);
  set('pfUsername', user ? ('@'+user.replace(/^@/,'')) : '');
  set('pfEmail', currentUserData.email||'');
  set('pfPhone', currentUserData.phone||'');
  set('pfTitle', currentUserData.title||'');
  set('pfBio', currentUserData.bio||'');
  const dn=document.getElementById('pfDisplayName');
  if(dn){
    let badges='';
    try{ if(isUserVerified(user, currentUserData)) badges += verifiedBadgeHTML(); }catch(e){}
    try{ badges += roleBadgesHTML(user, currentUserData); }catch(e){}
    dn.innerHTML = esc(name||'Aurora User') + badges;
    dn.style.display='flex';
    dn.style.alignItems='center';
    dn.style.justifyContent='center';
    dn.style.gap='4px';
    dn.style.flexWrap='wrap';
  }
  const role=document.getElementById('pfRole');
  if(role) role.textContent=(currentUserData.title||'Member').toUpperCase();
  const av=document.getElementById('pfAvatar');
  if(av){
    const src=currentUserData.avatarUrl||(currentUserData.avatar&&String(currentUserData.avatar).startsWith('data:')?currentUserData.avatar:null);
    if(src){ av.innerHTML=`<img src="${src}">`; av.style.background='transparent'; }
    else{
      av.innerHTML=esc((name||'U').slice(0,2).toUpperCase());
      av.style.background=currentUserData.color||'#2563eb';
    }
  }
  const err=document.getElementById('pfError');
  if(err){ err.classList.remove('show'); err.textContent=''; }
  // live preview name
  const fn=document.getElementById('pfFullName');
  const tt=document.getElementById('pfTitle');
  if(fn && !fn._pfBound){
    fn._pfBound=true;
    fn.addEventListener('input',()=>{
      const v=fn.value.trim()||'Aurora User';
      const d=document.getElementById('pfDisplayName');
      if(d){
        // keep the badges while typing a new display name
        let badges='';
        try{ if(isUserVerified(currentUserData.username, currentUserData)) badges += verifiedBadgeHTML(); }catch(e){}
        try{ badges += roleBadgesHTML(currentUserData.username, currentUserData); }catch(e){}
        d.innerHTML = esc(v) + badges;
      }
    });
  }
  if(tt && !tt._pfBound){
    tt._pfBound=true;
    tt.addEventListener('input',()=>{
      const v=(tt.value.trim()||'Member').toUpperCase();
      const r=document.getElementById('pfRole'); if(r) r.textContent=v;
    });
  }
}
async function saveProfilePage(){
  if(!currentUserData) return;
  const err=document.getElementById('pfError');
  const showErr=(m)=>{ if(err){ err.textContent=m; err.classList.add('show'); } };
  if(err){ err.classList.remove('show'); err.textContent=''; }

  let fullName=(document.getElementById('pfFullName')?.value||'').trim();
  let usernameRaw=(document.getElementById('pfUsername')?.value||'').trim().replace(/^@+/,'').toLowerCase().replace(/[^a-z0-9_]/g,'');
  let email=(document.getElementById('pfEmail')?.value||'').trim();
  let phone=(document.getElementById('pfPhone')?.value||'').trim();
  let title=(document.getElementById('pfTitle')?.value||'').trim();
  let bio=(document.getElementById('pfBio')?.value||'').trim();

  if(!fullName){ showErr('Full name is required'); return; }
  if(!usernameRaw || usernameRaw.length<3){ showErr('Username must be at least 3 characters (a-z, 0-9, _)'); return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showErr('Enter a valid email address'); return; }

  const btn=document.getElementById('pfSaveBtn');
  const oldTxt=btn?btn.textContent:'Save Changes';
  if(btn){ btn.disabled=true; btn.textContent='Saving...'; }

  const oldUsername=currentUserData.username;
  const oldNickname=currentUserData.nickname||oldUsername;
  const usernameChanged=(usernameRaw!==oldUsername);
  const nicknameChanged=(fullName!==oldNickname);

  try{
    // username taken check
    if(usernameChanged){
      const users=getUsers();
      if(users[usernameRaw] && users[usernameRaw].username!==oldUsername){
        showErr('Username "'+usernameRaw+'" is already taken');
        if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
        return;
      }
      if(isCloud&&db){
        try{
          const {doc,getDoc}=AURORA_SB;
          const unameSnap=await getDoc(doc(db,'usernames',usernameRaw));
          if(unameSnap.exists()){
            showErr('Username "'+usernameRaw+'" is already taken in cloud');
            if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
            return;
          }
        }catch(e){console.log('uname check',e.message);}
      }
    }

    // Local users registry
    const users=getUsers();
    const base=users[oldUsername]||{...currentUserData};
    const next={
      ...base,
      username: usernameRaw,
      nickname: fullName,
      email, phone, title, bio,
      avatarUrl: currentUserData.avatarUrl||base.avatarUrl,
      avatar: currentUserData.avatarUrl||base.avatar||currentUserData.avatar,
      color: currentUserData.color||base.color
    };
    if(usernameChanged){
      users[usernameRaw]=next;
      delete users[oldUsername];
      // rooms participant rename (same as edit profile)
      const rooms=getGlobalRooms();
      Object.keys(rooms).forEach(roomId=>{
        const room=rooms[roomId];
        if(room.participants&&room.participants.includes(oldUsername)){
          room.participants=room.participants.map(p=>p===oldUsername?usernameRaw:p);
        }
        if(room.participantUsernames&&room.participantUsernames.includes(oldUsername)){
          room.participantUsernames=room.participantUsernames.map(p=>p===oldUsername?usernameRaw:p);
        }
        if(room.participantNicknames){
          const idx=room.participantUsernames?room.participantUsernames.indexOf(usernameRaw):-1;
          if(idx>=0) room.participantNicknames[idx]=fullName;
        }
        if(room.participantAvatars&&room.participantAvatars[oldUsername]){
          room.participantAvatars[usernameRaw]=room.participantAvatars[oldUsername];
          delete room.participantAvatars[oldUsername];
        }
        const other=room.participants?room.participants.find(p=>p!==usernameRaw):null;
        if(other){
          const newRoomId=[usernameRaw,other].sort().join('_');
          if(newRoomId!==roomId){
            rooms[newRoomId]={...room,id:newRoomId};
            delete rooms[roomId];
          }
        }
      });
      saveGlobalRooms(rooms);
      try{
        const presence=JSON.parse(localStorage.getItem('aurora_presence')||'{}');
        if(presence[oldUsername]){
          presence[usernameRaw]=presence[oldUsername];
          presence[usernameRaw].username=usernameRaw;
          presence[usernameRaw].nickname=fullName;
          delete presence[oldUsername];
          localStorage.setItem('aurora_presence',JSON.stringify(presence));
        }
      }catch(e){}
    }else{
      users[usernameRaw]=next;
    }
    saveUsers(users);

    // session
    currentUserData={...currentUserData, ...next};
    if(currentUser) currentUser.displayName=usernameRaw+'__'+fullName;
    localStorage.setItem('chatbd_local_user_multi', JSON.stringify(currentUserData));

    // cloud profile fields
    if(isCloud&&db&&currentUser){
      try{
        const {doc,setDoc,deleteDoc}=AURORA_SB;
        const payload={
          username:usernameRaw,
          nickname:fullName,
          email:email||null,
          phone:phone||null,
          title:title||null,
          bio:bio||null,
          profileUpdatedAt:new Date()
        };
        if(usernameChanged){
          await setDoc(doc(db,'usernames',usernameRaw),{uid:currentUser.uid,username:usernameRaw,nickname:fullName},{merge:true});
          try{await deleteDoc(doc(db,'usernames',oldUsername));}catch(e){}
          payload.previousUsername=oldUsername;
          payload.usernameChangedAt=new Date();
          await setDoc(doc(db,'presence',usernameRaw),{online:true,lastSeen:Date.now(),username:usernameRaw,nickname:fullName},{merge:true});
          try{await deleteDoc(doc(db,'presence',oldUsername));}catch(e){}
        }
        await setDoc(doc(db,'users',currentUser.uid),payload,{merge:true});
        if(!usernameChanged){
          await setDoc(doc(db,'usernames',usernameRaw),{nickname:fullName},{merge:true});
        }
      }catch(e){console.log('FB profile save',e.message);}
    }

    // UI refresh
    try{
      $('#myName').textContent=fullName;
      $('#myStatus').textContent='Updated ✓';
      $('#welcomeNickname').textContent=`@${usernameRaw} • ${fullName}`;
    }catch(e){}
    try{ refreshSettingsUI(); }catch(e){}
    try{ fillProfilePage(); }catch(e){}
    if(!isCloud) contacts=loadUserContacts(currentUserData.username);
    renderChats();

    showToast({title:'Profile Updated ✅', body: usernameChanged?(`Username changed to @${usernameRaw}`):'Your personal info was saved', color:'#10b981', avatar:'✓'});
    setTimeout(()=>{ try{$('#myStatus').textContent='Tap to edit ✏️';}catch(e){} }, 3000);
    // stay on page so user sees saved values
  }catch(e){
    showErr('Error saving profile: '+(e.message||e));
    console.log('profile save', e);
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
  }
}
window.openProfilePage=openProfilePage;
window.closeProfilePage=closeProfilePage;
window.fillProfilePage=fillProfilePage;

document.getElementById('profileBackBtn')?.addEventListener('click',()=>{
  closeProfilePage();
  openSettings();
});
document.getElementById('pfCamBtn')?.addEventListener('click',()=>{
  document.getElementById('profilePicInput')?.click();
});
document.getElementById('pfAvatar')?.addEventListener('click',()=>{
  document.getElementById('profilePicInput')?.click();
});
document.getElementById('pfSaveBtn')?.addEventListener('click',()=>{ saveProfilePage(); });
// username field: keep @ visible
document.getElementById('pfUsername')?.addEventListener('blur',()=>{
  const el=document.getElementById('pfUsername');
  if(!el) return;
  let v=el.value.trim().replace(/^@+/,'');
  if(v) el.value='@'+v.toLowerCase().replace(/[^a-z0-9_]/g,'');
});


/* ===== Password & Security (fixed) ===== */
window.openSecurityPage = function openSecurityPage(){
  const view = document.getElementById('securityView');
  if(!view){
    alert('Security page not found. Please hard-refresh (Ctrl+Shift+R).');
    return false;
  }
  try{
    // Mount on phone shell / body so nothing covers it
    const host = document.getElementById('phoneShell') || document.body;
    if(view.parentElement !== host){
      host.appendChild(view);
    }
    const ss=document.querySelector('.s-search'); if(ss) ss.style.display='none';
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView');
    if(sv){ sv.classList.add('show'); sv.style.display='flex'; }
    try{ closeNotifSettings(); }catch(e){}
    try{ closeProfilePage(); }catch(e){}
    try{ closeAppearancePage(); }catch(e){}
  }catch(e){ console.log(e); }

  view.classList.add('show');
  view.hidden = false;
  view.style.cssText = [
    'display:flex',
    'visibility:visible',
    'opacity:1',
    'pointer-events:auto',
    'z-index:10080',
    'position:fixed',
    'top:0','left:0','right:0','bottom:0',
    'width:100%','height:100%',
    'flex-direction:column',
    'overflow:hidden',
    'margin:0','padding:0'
  ].map(s=>s+' !important').join(';');
  // phone shell: fixed becomes relative to transformed shell
  try{
    const shell=document.getElementById('phoneShell');
    if(shell && shell.contains(view)){
      view.style.setProperty('position','absolute','important');
    }
  }catch(e){}
  try{ document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings')); }catch(e){}
  try{ refreshSecurityPage(); }catch(e){}
  try{ view.querySelector('.sec-scroll')?.scrollTo?.(0,0); }catch(e){}
  return true;
};

window.closeSecurityPage = function closeSecurityPage(){
  const view=document.getElementById('securityView');
  if(view){
    view.classList.remove('show');
    view.style.display='none';
    view.style.pointerEvents='none';
  }
  ['secCurrentPass','secNewPass','secConfirmPass'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const err=document.getElementById('secError'); if(err){ err.classList.remove('show'); err.textContent=''; }
  const ok=document.getElementById('secOk'); if(ok){ ok.classList.remove('show'); ok.textContent=''; }
};

/* BUGFIX: this assignment used to run AFTER the "hook refreshSecurityPage to
   include recovery UI" wrapper above, silently clobbering it — so
   refreshRecoverySecurityUI() never ran and the Security page showed stale
   recovery-email / backup-code state. Keep the wrapper by chaining onto it. */
window.refreshSecurityPage = function refreshSecurityPage(){
  try{ if(typeof refreshRecoverySecurityUI==='function') refreshRecoverySecurityUI(); }catch(e){}
  const typeEl=document.getElementById('secAccountType');
  const sessEl=document.getElementById('secSessionInfo');
  const badge=document.getElementById('secSessionBadge');
  const u=currentUserData;
  if(!u){
    if(typeEl) typeEl.textContent='Sign in to manage password';
    return;
  }
  const isFb = !!(u.cloud || (currentUser && currentUser.uid && !String(currentUser.uid).startsWith('local_')));
  if(typeEl) typeEl.textContent = isFb ? 'Cloud account · Supabase' : 'Local account on this device';
  if(sessEl) sessEl.textContent = '@'+(u.username||'user')+' · this device';
  if(badge) badge.textContent = isFb ? 'Synced' : 'Local';
};

// aliases for non-window calls inside other functions
function openSecurityPage(){ return window.openSecurityPage(); }
function closeSecurityPage(){ return window.closeSecurityPage(); }
function refreshSecurityPage(){ return window.refreshSecurityPage(); }

document.getElementById('secBackBtn')?.addEventListener('click',()=>{
  closeSecurityPage();
  try{ openSettings(); }catch(e){}
});

document.querySelectorAll('.sec-eye[data-eye]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const id=btn.getAttribute('data-eye');
    const input=document.getElementById(id);
    if(!input) return;
    const show = input.type==='password';
    input.type = show ? 'text' : 'password';
    btn.style.color = show ? '#2563eb' : '';
  });
});

document.getElementById('secSaveBtn')?.addEventListener('click', async ()=>{
  const err=document.getElementById('secError');
  const ok=document.getElementById('secOk');
  const showErr=(m)=>{ if(err){ err.textContent=m; err.classList.add('show'); } if(ok) ok.classList.remove('show'); };
  const showOk=(m)=>{ if(ok){ ok.textContent=m; ok.classList.add('show'); } if(err) err.classList.remove('show'); };
  if(err) err.classList.remove('show');
  if(ok) ok.classList.remove('show');

  if(!currentUserData){ showErr('Please sign in first'); return; }

  const cur=(document.getElementById('secCurrentPass')?.value||'');
  const nw=(document.getElementById('secNewPass')?.value||'');
  const cf=(document.getElementById('secConfirmPass')?.value||'');

  if(!cur){ showErr('Enter your current password'); return; }
  if(!nw || nw.length<6){ showErr('New password must be at least 6 characters'); return; }
  if(nw!==cf){ showErr('New passwords do not match'); return; }
  if(nw===cur){ showErr('New password must be different from current password'); return; }

  const btn=document.getElementById('secSaveBtn');
  const oldTxt=btn?btn.textContent:'Update Password';
  if(btn){ btn.disabled=true; btn.textContent='Updating...'; }

  const username=currentUserData.username;
  const isFb=!!(currentUserData.cloud || (currentUser && currentUser.uid && !String(currentUser.uid).startsWith('local_')));

  try{
    const users=getUsers();
    const localU=users[username];

    if(localU && localU.password && localU.password!==cur){
      showErr('Current password is incorrect');
      if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
      return;
    }

    if(isFb && isCloud && auth && auth.currentUser){
      try{
        const {EmailAuthProvider, reauthenticateWithCredential, updatePassword}=AURORA_SB_AUTH;
        const email=auth.currentUser.email || (username+'@aurora-chat.app');
        const cred=EmailAuthProvider.credential(email, cur);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await updatePassword(auth.currentUser, nw);
      }catch(fe){
        const msg=String(fe.message||fe.code||fe);
        if(msg.includes('wrong-password') || msg.includes('invalid-credential') || msg.includes('invalid-login')){
          showErr('Current password is incorrect'); if(btn){ btn.disabled=false; btn.textContent=oldTxt; } return;
        }else if(msg.includes('requires-recent-login')){
          showErr('For security, sign out and sign in again, then change password.'); if(btn){ btn.disabled=false; btn.textContent=oldTxt; } return;
        }else if(msg.includes('weak-password')){
          showErr('Password is too weak. Use a stronger one.'); if(btn){ btn.disabled=false; btn.textContent=oldTxt; } return;
        }else if(!localU || !localU.password){
          showErr('Could not update cloud password: '+msg.slice(0,120)); if(btn){ btn.disabled=false; btn.textContent=oldTxt; } return;
        }
        console.log('Cloud password update failed, updating local only', msg);
      }
    } else {
      if(localU && localU.password && localU.password!==cur){
        showErr('Current password is incorrect'); if(btn){ btn.disabled=false; btn.textContent=oldTxt; } return;
      }
      if(!localU){
        users[username]={
          username,
          nickname: currentUserData.nickname||username,
          password: nw,
          avatar: currentUserData.avatar,
          avatarUrl: currentUserData.avatarUrl,
          color: currentUserData.color,
          email: currentUserData.email,
          phone: currentUserData.phone,
          title: currentUserData.title,
          bio: currentUserData.bio
        };
      }
    }

    if(!users[username]){
      users[username]={
        username,
        nickname: currentUserData.nickname||username,
        password: nw,
        avatar: currentUserData.avatar,
        avatarUrl: currentUserData.avatarUrl,
        color: currentUserData.color
      };
    }else{
      users[username]={...users[username], password:nw};
    }
    saveUsers(users);
    currentUserData={...currentUserData, password:nw};
    try{ localStorage.setItem('chatbd_local_user_multi', JSON.stringify(currentUserData)); }catch(e){}

    ['secCurrentPass','secNewPass','secConfirmPass'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    showOk('Password updated successfully. Use your new password next time you sign in.');
    showToast({title:'Password Updated 🔒', body:'Your password was changed successfully', color:'#10b981', avatar:'✓'});
  }catch(e){
    showErr('Error: '+(e.message||e));
    console.log('password change error', e);
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=oldTxt; }
  }
});

['secCurrentPass','secNewPass','secConfirmPass'].forEach(id=>{
  document.getElementById(id)?.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('secSaveBtn')?.click(); }
  });
});

// Robust click binding for settings row
(function(){
  function bind(){
    const el=document.getElementById('stPassword');
    if(!el) return;
    if(el._secBound2) return;
    el._secBound2=true;
    el.addEventListener('click', function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      window.openSecurityPage();
    }, true);
  }
  bind();
  document.addEventListener('DOMContentLoaded', bind);
  setTimeout(bind, 0);
  setTimeout(bind, 500);
})();

document.getElementById('stBilling')?.addEventListener('click',(e)=>{
  try{ e?.preventDefault?.(); e?.stopPropagation?.(); }catch(err){}
  openBillingPage();
});
// backup inline-safe global
window.openBillingPage = window.openBillingPage || function(){};


/* ===== Billing & Subscriptions ===== */
const BILL_KEY = 'aurora_billing_plan';
const BILL_PLANS = {
  free: { id:'free', name:'Free', price:'$0', cycle:'/ forever', meta:'Core messaging for personal use', priceNum:0 },
  pro:  { id:'pro',  name:'Aurora Pro', price:'$4.99', cycle:'/ month', meta:'Unlimited chats · Premium theme pack', priceNum:4.99 },
  team: { id:'team', name:'Team', price:'$12.99', cycle:'/ month', meta:'Up to 10 seats · shared workspace', priceNum:12.99 }
};

function getBillingPlan(){
  try{
    const id = localStorage.getItem(BILL_KEY) || 'pro';
    return BILL_PLANS[id] || BILL_PLANS.pro;
  }catch(e){ return BILL_PLANS.pro; }
}
function setBillingPlan(id){
  const plan = BILL_PLANS[id] || BILL_PLANS.free;
  try{ localStorage.setItem(BILL_KEY, plan.id); }catch(e){}
  try{
    // light invoice log
    const inv = JSON.parse(localStorage.getItem('aurora_billing_invoices')||'[]');
    inv.unshift({ id:'inv_'+Date.now(), plan:plan.id, name:plan.name, price:plan.price, at:Date.now() });
    localStorage.setItem('aurora_billing_invoices', JSON.stringify(inv.slice(0,20)));
  }catch(e){}
  return plan;
}

function refreshBillingPage(){
  const plan = getBillingPlan();
  const nameEl=document.getElementById('billPlanName');
  const metaEl=document.getElementById('billPlanMeta');
  const priceEl=document.getElementById('billPlanPrice');
  const cycleEl=document.getElementById('billPlanCycle');
  if(nameEl) nameEl.textContent = plan.name;
  if(metaEl) metaEl.textContent = plan.meta;
  if(priceEl) priceEl.textContent = plan.price;
  if(cycleEl) cycleEl.textContent = plan.cycle;
  document.querySelectorAll('#billPlanOptions .bill-option').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.plan === plan.id);
  });
  // settings stats Pro label if present
  try{
    const stat = document.querySelector('#settingsView .st-stat-val');
    // don't hard-break; optional
  }catch(e){}
  const paySub=document.getElementById('billPayMethodSub');
  if(paySub){
    try{
      const pm=localStorage.getItem('aurora_billing_paymethod');
      paySub.textContent = pm || 'No card on file (demo)';
    }catch(e){ paySub.textContent='No card on file (demo)'; }
  }
  const invSub=document.getElementById('billInvoiceSub');
  if(invSub){
    try{
      const inv=JSON.parse(localStorage.getItem('aurora_billing_invoices')||'[]');
      invSub.textContent = inv.length ? (inv.length+' record(s)') : 'No invoices yet';
    }catch(e){ invSub.textContent='No invoices yet'; }
  }
  // settings Pro chip
  try{
    const chips=[...document.querySelectorAll('#settingsView .st-stat-val')];
    // first stat often Pro - update if text is Pro/Free
    chips.forEach(el=>{
      if(['Pro','Free','Team','Aurora Pro'].includes((el.textContent||'').trim()) || el.id==='settingsPlanChip'){
        el.textContent = plan.id==='free'?'Free':(plan.id==='team'?'Team':'Pro');
      }
    });
  }catch(e){}
}

function openBillingPage(){
  const view=document.getElementById('billingView');
  if(!view){
    alert('Billing page missing. Hard refresh (Ctrl+Shift+R).');
    return false;
  }
  try{
    const host=document.getElementById('phoneShell')||document.body;
    if(view.parentElement!==host) host.appendChild(view);
    const ss=document.querySelector('.s-search'); if(ss) ss.style.display='none';
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView');
    if(sv){ sv.classList.add('show'); sv.style.display='flex'; }
    try{ closeNotifSettings(); }catch(e){}
    try{ closeProfilePage(); }catch(e){}
    try{ closeAppearancePage(); }catch(e){}
    try{ closeSecurityPage(); }catch(e){}
  }catch(e){ console.log(e); }

  view.classList.add('show');
  view.hidden=false;
  view.style.cssText='display:flex !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;z-index:10080 !important;position:absolute !important;inset:0 !important;flex-direction:column !important;overflow:hidden !important;';
  try{ document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings')); }catch(e){}
  try{ refreshBillingPage(); }catch(e){}
  try{ view.querySelector('.bill-scroll')?.scrollTo?.(0,0); }catch(e){}
  return true;
}
function closeBillingPage(){
  const view=document.getElementById('billingView');
  if(view){
    view.classList.remove('show');
    view.style.display='none';
    view.style.pointerEvents='none';
  }
}
window.openBillingPage=openBillingPage;

// Billing UI disabled (hidden). Re-enable by showing #stBilling and restoring openBillingPage.
window.openBillingPage = function(){
  try{ console.log('Billing is temporarily disabled'); }catch(e){}
  return false;
};
window.closeBillingPage = window.closeBillingPage || function(){};
window.closeBillingPage=closeBillingPage;
window.refreshBillingPage=refreshBillingPage;
window.getBillingPlan=getBillingPlan;

document.getElementById('billBackBtn')?.addEventListener('click',()=>{
  closeBillingPage();
  try{ openSettings(); }catch(e){}
});

// plan option select
document.getElementById('billPlanOptions')?.addEventListener('click',(e)=>{
  const btn=e.target.closest('.bill-option');
  if(!btn) return;
  document.querySelectorAll('#billPlanOptions .bill-option').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
});

document.getElementById('billApplyPlanBtn')?.addEventListener('click',()=>{
  const sel=document.querySelector('#billPlanOptions .bill-option.active');
  const id=sel?.dataset?.plan || 'free';
  const plan=setBillingPlan(id);
  refreshBillingPage();
  showToast({title: plan.name+' activated', body:'Demo plan saved on this device · no real charge', color:'#2563eb', avatar:'✦'});
  try{ refreshSettingsUI(); }catch(e){}
});

document.getElementById('billRestoreBtn')?.addEventListener('click',()=>{
  refreshBillingPage();
  const plan=getBillingPlan();
  showToast({title:'Purchases restored', body:'Current demo plan: '+plan.name, color:'#10b981', avatar:'✓'});
});

document.getElementById('billPaymentMethodBtn')?.addEventListener('click',()=>{
  const cur=localStorage.getItem('aurora_billing_paymethod')||'';
  const v=prompt('Add demo payment method (e.g. Visa ••4242). Leave empty to clear.', cur.replace('Demo card: ','')||'Visa ••4242');
  if(v===null) return;
  if(!String(v).trim()){
    localStorage.removeItem('aurora_billing_paymethod');
  }else{
    localStorage.setItem('aurora_billing_paymethod', 'Demo card: '+String(v).trim());
  }
  refreshBillingPage();
  showToast({title:'Payment method', body: v.trim()? 'Saved (demo only)':'Cleared', color:'#2563eb', avatar:'💳'});
});

document.getElementById('billInvoicesBtn')?.addEventListener('click',()=>{
  let inv=[];
  try{ inv=JSON.parse(localStorage.getItem('aurora_billing_invoices')||'[]'); }catch(e){}
  if(!inv.length){
    showToast({title:'Invoices', body:'No invoices yet. Activate a plan to create a demo record.', color:'#64748b', avatar:'📄'});
    return;
  }
  const lines=inv.slice(0,8).map(x=>{
    const d=new Date(x.at||Date.now());
    return `${d.toLocaleDateString()} · ${x.name||x.plan} · ${x.price||''}`;
  }).join('\n');
  alert('Demo invoices\n\n'+lines);
});

document.getElementById('billCancelBtn')?.addEventListener('click',()=>{
  if(!confirm('Cancel current plan and switch to Free?')) return;
  setBillingPlan('free');
  refreshBillingPage();
  showToast({title:'Plan cancelled', body:'You are on Free now', color:'#64748b', avatar:'✓'});
  try{ refreshSettingsUI(); }catch(e){}
});
document.getElementById('stTheme')?.addEventListener('click',()=>openAppearancePage());


/* ===== Appearance page ===== */
const AP_WALLS = [
  {id:'default', name:'Soft Gray', css:'linear-gradient(180deg,#e8edf5 0%,#f4f6fb 100%)'},
  {id:'grad-aurora', name:'Aurora', css:'linear-gradient(135deg,#a5b4fc 0%,#c4b5fd 40%,#fbcfe8 100%)'},
  {id:'grad-ocean', name:'Ocean', css:'linear-gradient(135deg,#667eea 0%,#764ba2 100%)'},
  {id:'grad-peach', name:'Peach', css:'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)'},
  {id:'grad-mint', name:'Mint', css:'linear-gradient(135deg,#a8edea 0%,#fed6e3 100%)'},
  {id:'grad-night', name:'Night', css:'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)'},
  {id:'soft-blue', name:'Soft Blue', css:'#e0f2fe'},
  {id:'soft-purple', name:'Soft Purple', css:'#f3e8ff'},
  {id:'dark-navy', name:'Dark Navy', css:'#0f172a'}
];
const AP_TEXT_LABELS=['Small','Medium','Standard','Large','Extra Large'];

function getPreferredThemeMode(){
  try{
    const saved=localStorage.getItem('aurora_theme_mode');
    if(['light','dark','black','system'].includes(saved)) return saved;
    const theme=localStorage.getItem('aurora_theme');
    return theme==='black'?'black':theme==='midnight'?'dark':'light';
  }catch(e){return 'light';}
}
function getAppearPrefs(){
  try{
    return Object.assign({
      mode: getPreferredThemeMode(),
      wall: localStorage.getItem('aurora_chat_bg_global')||'default',
      textScale: parseInt(localStorage.getItem('aurora_text_scale')||'2',10),
      appIcon: localStorage.getItem('aurora_app_icon')||'blue'
    }, {});
  }catch(e){
    return {mode:'light', wall:'default', textScale:2, appIcon:'blue'};
  }
}
function applyTextScale(scale){
  const s=Math.max(0, Math.min(4, parseInt(scale,10)||2));
  document.documentElement.setAttribute('data-text-scale', String(s));
  try{ localStorage.setItem('aurora_text_scale', String(s)); }catch(e){}
  return s;
}
function applyThemeMode(mode){
  mode = ['light','dark','black','system'].includes(mode)?mode:'light';
  try{ localStorage.setItem('aurora_theme_mode', mode); }catch(e){}
  let resolved=mode;
  if(mode==='system'){
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  if(resolved==='black'){
    if(typeof applyTheme==='function') applyTheme('black');
  }else if(resolved==='dark'){
    if(typeof applyTheme==='function') applyTheme('midnight');
  }else{
    if(typeof applyTheme==='function') applyTheme('aurora');
  }
  return mode;
}
function applyGlobalWallpaper(wallId){
  wallId = wallId||'default';
  try{
    if(wallId==='default'){
      localStorage.removeItem('aurora_chat_bg_global');
    }else{
      localStorage.setItem('aurora_chat_bg_global', wallId);
      try{ localStorage.removeItem('aurora_chat_bg_per'); }catch(e){}
    }
  }catch(e){}
  try{
    if(typeof currentRoomId!=='undefined' && currentRoomId && typeof applyChatBg==='function'){
      applyChatBg(currentRoomId);
    }
  }catch(e){}
  return wallId;
}
function applyAppIconPref(icon){
  icon=icon||'blue';
  try{ localStorage.setItem('aurora_app_icon', icon); }catch(e){}
  // Visual preference only (PWA icon swap limited on web)
  document.querySelectorAll('.ap-icon[data-icon]').forEach(b=>{
    b.classList.toggle('active', b.dataset.icon===icon);
  });
  return icon;
}
function openAppearancePage(){
  const view=document.getElementById('appearView');
  if(!view) return;
  try{
    document.querySelector('.s-search')&&(document.querySelector('.s-search').style.display='none');
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView'); if(sv) sv.classList.add('show');
    try{ closeNotifSettings(); }catch(e){}
    try{ closeProfilePage(); }catch(e){}
  }catch(e){}
  // FIX: hardHideSettingsPages() may have left inline display:none/hidden on it
  try{ view.style.cssText=''; view.hidden=false; view.style.pointerEvents=''; }catch(e){}
  view.classList.add('show');
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings'));
  refreshAppearanceUI();
}
function closeAppearancePage(){
  const view=document.getElementById('appearView');
  if(view) view.classList.remove('show');
}
function refreshAppearanceUI(){
  const p=getAppearPrefs();
  // modes
  document.querySelectorAll('.ap-mode').forEach(btn=>{
    const selected=btn.dataset.mode===p.mode;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed',String(selected));
  });
  // walls
  const strip=document.getElementById('apWallStrip');
  if(strip){
    strip.innerHTML = AP_WALLS.map(w=>`
      <button type="button" class="ap-wall ${p.wall===w.id?'active':''}" data-wall="${w.id}" title="${w.name}" style="background:${w.css};">
        <span class="tick">✓</span>
      </button>
    `).join('');
    strip.querySelectorAll('.ap-wall').forEach(btn=>{
      btn.addEventListener('click',()=>{
        applyGlobalWallpaper(btn.dataset.wall);
        refreshAppearanceUI();
        showToast({title:'Chat Wallpaper', body: (AP_WALLS.find(x=>x.id===btn.dataset.wall)||{}).name||'Updated', color:'#2563eb', avatar:'🎨'});
      });
    });
  }
  // text
  const slider=document.getElementById('apTextSlider');
  const badge=document.getElementById('apTextBadge');
  const scale=typeof p.textScale==='number' && !isNaN(p.textScale) ? p.textScale : 2;
  if(slider){
    slider.value=String(scale);
    const pct=(scale/4)*100;
    slider.style.setProperty('--ap-pct', pct+'%');
  }
  if(badge) badge.textContent=AP_TEXT_LABELS[scale]||'Standard';
  applyAppIconPref(p.appIcon);
}
window.openAppearancePage=openAppearancePage;
window.closeAppearancePage=closeAppearancePage;
window.applyThemeMode=applyThemeMode;
window.applyTextScale=applyTextScale;

document.getElementById('appearBackBtn')?.addEventListener('click',()=>{
  closeAppearancePage();
  openSettings();
});
document.getElementById('appearGoChats')?.addEventListener('click',()=>{
  closeAppearancePage();
  closeSettings();
  switchBottomNav('chats');
});
document.getElementById('appearProfileBtn')?.addEventListener('click',()=>{
  closeAppearancePage();
  openSettings();
});
document.getElementById('apThemeModes')?.addEventListener('click',(e)=>{
  const btn=e.target.closest('.ap-mode');
  if(!btn) return;
  applyThemeMode(btn.dataset.mode);
  refreshAppearanceUI();
  try{ refreshSettingsUI(); }catch(err){}
  showToast({title:'Theme Mode', body: btn.dataset.mode.charAt(0).toUpperCase()+btn.dataset.mode.slice(1), color:'#2563eb', avatar:'◐'});
});
document.getElementById('apTextSlider')?.addEventListener('input',(e)=>{
  const v=+e.target.value;
  const pct=(v/4)*100;
  e.target.style.setProperty('--ap-pct', pct+'%');
  const badge=document.getElementById('apTextBadge');
  if(badge) badge.textContent=AP_TEXT_LABELS[v]||'Standard';
  applyTextScale(v);
});
document.getElementById('apIconRow')?.addEventListener('click',(e)=>{
  const btn=e.target.closest('.ap-icon');
  if(!btn) return;
  if(btn.dataset.icon==='more'){
    showToast({title:'App Icon', body:'Custom icons coming soon on home screen installs', color:'#2563eb', avatar:'+'});
    return;
  }
  applyAppIconPref(btn.dataset.icon);
  showToast({title:'App Icon', body:'Icon style saved for this device', color:'#2563eb', avatar:'◆'});
});
document.getElementById('appearSeeWalls')?.addEventListener('click',()=>{
  // open full wallpaper picker if a chat is open; else apply global via modal-like toast strip already shows all
  if(typeof currentRoomId!=='undefined' && currentRoomId && typeof openChatColorModal==='function'){
    openChatColorModal();
  }else{
    showToast({title:'Chat Wallpaper', body:'Pick a wallpaper below — it applies to all chats. Open a chat for per-chat colors.', color:'#2563eb', avatar:'🖌️'});
    document.getElementById('apWallStrip')?.scrollIntoView({behavior:'smooth', block:'center'});
  }
});
document.getElementById('appearResetBtn')?.addEventListener('click',()=>{
  if(!confirm('Reset appearance to defaults?')) return;
  try{
    localStorage.setItem('aurora_theme_mode','light');
    localStorage.removeItem('aurora_chat_bg_global');
    localStorage.removeItem('aurora_chat_bg_per');
    localStorage.setItem('aurora_text_scale','2');
    localStorage.setItem('aurora_app_icon','blue');
  }catch(e){}
  applyThemeMode('light');
  applyTextScale(2);
  applyGlobalWallpaper('default');
  applyAppIconPref('blue');
  refreshAppearanceUI();
  try{ refreshSettingsUI(); }catch(e){}
  showToast({title:'Appearance Reset', body:'Defaults restored', color:'#64748b', avatar:'↺'});
});

// Apply saved appearance on boot
try{
  const _ap=getAppearPrefs();
  applyTextScale(_ap.textScale);
  // theme mode takes precedence over raw theme id when mode is set
  if(localStorage.getItem('aurora_theme_mode')){
    applyThemeMode(_ap.mode);
  }
}catch(e){}

// System theme changes
try{
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{
      if((localStorage.getItem('aurora_theme_mode')||'')==='system'){
        applyThemeMode('system');
        try{ refreshAppearanceUI(); }catch(e){}
      }
    });
  }
}catch(e){}


/* ===== Privacy Policy + Help & Feedback pages ===== */
function _openInfoPage(viewId){
  const view=document.getElementById(viewId);
  if(!view){
    alert('Page missing. Please hard refresh (Ctrl+Shift+R).');
    return false;
  }
  try{
    const host=document.getElementById('phoneShell')||document.body;
    if(view.parentElement!==host) host.appendChild(view);
    const ss=document.querySelector('.s-search'); if(ss) ss.style.display='none';
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView');
    if(sv){ sv.classList.add('show'); sv.style.display='flex'; }
    try{ closeNotifSettings(); }catch(e){}
    try{ closeProfilePage(); }catch(e){}
    try{ closeAppearancePage(); }catch(e){}
    try{ closeSecurityPage(); }catch(e){}
    try{ closeBillingPage(); }catch(e){}
  try{ closePrivacyPage(); }catch(e){}
  try{ closeHelpPage(); }catch(e){}
    // close sibling info pages
    ['privacyView','helpView'].forEach(id=>{
      if(id===viewId) return;
      const v=document.getElementById(id);
      if(v){ v.classList.remove('show'); v.style.display='none'; }
    });
  }catch(e){ console.log(e); }
  view.classList.add('show');
  view.hidden=false;
  view.style.cssText='display:flex !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;z-index:10080 !important;position:absolute !important;inset:0 !important;flex-direction:column !important;overflow:hidden !important;';
  try{ document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings')); }catch(e){}
  try{ view.querySelector('.info-scroll')?.scrollTo?.(0,0); }catch(e){}
  return true;
}
function closePrivacyPage(){
  const v=document.getElementById('privacyView');
  if(v){ v.classList.remove('show'); v.style.display='none'; v.style.pointerEvents='none'; }
}
function closeHelpPage(){
  const v=document.getElementById('helpView');
  if(v){ v.classList.remove('show'); v.style.display='none'; v.style.pointerEvents='none'; }
}
function openPrivacyPage(){ return _openInfoPage('privacyView'); }
function openHelpPage(){
  const ok=_openInfoPage('helpView');
  try{
    const em=document.getElementById('helpEmail');
    if(em && !em.value && currentUserData){
      const mail=(currentUserData.email||currentUserData.recoveryEmail||'');
      if(mail && !String(mail).endsWith('@aurora-chat.app')) em.value=mail;
    }
  }catch(e){}
  return ok;
}
window.openPrivacyPage=openPrivacyPage;
window.openHelpPage=openHelpPage;
window.closePrivacyPage=closePrivacyPage;
window.closeHelpPage=closeHelpPage;

document.getElementById('stPrivacy')?.addEventListener('click',(e)=>{
  try{ e?.preventDefault?.(); e?.stopPropagation?.(); }catch(err){}
  openPrivacyPage();
}, true);
document.getElementById('stHelp')?.addEventListener('click',(e)=>{
  try{ e?.preventDefault?.(); e?.stopPropagation?.(); }catch(err){}
  openHelpPage();
}, true);
document.getElementById('privacyBackBtn')?.addEventListener('click',()=>{
  closePrivacyPage();
  try{ openSettings(); }catch(e){}
});
document.getElementById('helpBackBtn')?.addEventListener('click',()=>{
  closeHelpPage();
  try{ openSettings(); }catch(e){}
});

// Quick help chips
const HELP_Q = {
  reset: 'Open Login → Forgot password. Use email code (if recovery email is saved) or a backup code, then set a new password.',
  verify: 'Verified accounts show a blue badge. Developer accounts can also show a Developer pill on profile view.',
  photo: 'You can send 3–4MB camera photos. Aurora auto-optimizes them before upload.',
  call: 'Open a chat and tap the call icon. Microphone permission is required. A cloud connection is needed for calls.'
};
document.querySelectorAll('[data-help-q]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const key=btn.getAttribute('data-help-q');
    const el=document.getElementById('helpAnswer');
    if(el) el.textContent = HELP_Q[key] || '';
  });
});

function _helpMsg(){
  const type=document.getElementById('helpType')?.value||'feedback';
  const email=(document.getElementById('helpEmail')?.value||'').trim();
  const message=(document.getElementById('helpMessage')?.value||'').trim();
  const user=currentUserData?.username || 'guest';
  return {type, email, message, user};
}
document.getElementById('helpEmailBtn')?.addEventListener('click',()=>{
  const {type,email,message,user}=_helpMsg();
  if(!message || message.length<5){
    const err=document.getElementById('helpErr');
    if(err){ err.textContent='Please write a short message first.'; err.classList.add('show'); }
    return;
  }
  const subject=`Aurora ${type} from @${user}`;
  const body=`Type: ${type}
User: @${user}
Email: ${email||'-'}

${message}

— Aurora V2.4.1`;
  window.location.href=`mailto:support@aurora.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

document.getElementById('helpSendBtn')?.addEventListener('click', async ()=>{
  const ok=document.getElementById('helpOk');
  const err=document.getElementById('helpErr');
  if(ok) ok.classList.remove('show');
  if(err) err.classList.remove('show');
  const {type,email,message,user}=_helpMsg();
  if(!message || message.length<5){
    if(err){ err.textContent='Please enter at least 5 characters.'; err.classList.add('show'); }
    return;
  }
  const btn=document.getElementById('helpSendBtn');
  const oldTxt=btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent='Sending...'; }
  const payload={
    type, message, email: email||'',
    username: user,
    nickname: currentUserData?.nickname||'',
    createdAt: Date.now(),
    appVersion: '2.4.1',
    userAgent: navigator.userAgent||''
  };
  let saved=false;
  try{
    const key='aurora_feedback_local';
    const arr=JSON.parse(localStorage.getItem(key)||'[]');
    arr.unshift(payload);
    localStorage.setItem(key, JSON.stringify(arr.slice(0,50)));
    saved=true;
  }catch(e){}
  try{
    if(typeof isCloud!=='undefined' && isCloud && db){
      const {collection,addDoc,serverTimestamp}=AURORA_SB;
      await addDoc(collection(db,'feedback'), {...payload, createdAtServer: serverTimestamp()});
      saved=true;
    }
  }catch(e){ console.log('feedback cloud fail', e.message); }
  if(btn){ btn.disabled=false; btn.textContent=oldTxt||'Submit'; }
  if(saved){
    if(ok){ ok.textContent='Thanks! Your feedback was submitted.'; ok.classList.add('show'); }
    const ta=document.getElementById('helpMessage'); if(ta) ta.value='';
    try{ showToast({title:'Feedback sent', body:'Thanks for helping improve Aurora', color:'#10b981', avatar:'✓'}); }catch(e){}
  }else{
    if(err){ err.textContent='Could not submit. Try Email app button.'; err.classList.add('show'); }
  }
});

document.getElementById('stSwitchAccount')?.addEventListener('click',()=>{
  document.getElementById('switchAccountBtn')?.click();
});
document.getElementById('stLogoutBtn')?.addEventListener('click',()=>{
  document.getElementById('logoutBtn')?.click();
});

/* Custom sounds: IndexedDB personal files + public developer catalog.
   Backend writes require a real account whose users.developer flag is true;
   merge the supplied database rule snippet before enabling publishing. */
window.AuroraSoundLibrary=(function(){
  const MAX_BYTES=1048576, MAX_SECONDS=10, MAX_SOUNDS=12;
  const PUBLISHER_UIDS=[];   // publishing is gated by the users.developer flag in the database
  const CACHE_KEY='aurora_shared_sound_index_v1';
  const STORE='files', ID_PATTERN=/^custom-[a-z0-9-]{8,80}$/;
  const personal=new Map(), cachedFiles=new Map(), buffers=new Map(), jobs=new Map();
  let owner='', databasePromise=null, ready=Promise.resolve(), busy=false, epoch=0;
  let subscription=null, connectedDb=null, connectionEpoch=0, cloudStatus='offline', publisherAllowed=false;
  let shared=[], sharedTime=0, embedded=new Map();
  const el=id=>document.getElementById(id);
  const safe=value=>esc(String(value==null?'':value));
  const ownerId=()=>currentUserData?.username?'user:'+String(currentUserData.username).toLowerCase():'guest';
  function developerUI(){try{return publisherAllowed || myLevel()>=100;}catch(e){return false;}}
  function status(text,error=false){const node=el('nsStatus');if(node){node.textContent=text;node.classList.toggle('error',error);}}
  function fail(error){status(error?.message||String(error),true);}
  function cloudURL(value){
    /* Only audio served from OUR storage bucket is trusted. */
    try{
      const u=new URL(value);
      if(u.protocol!=='https:'||u.username||u.password) return false;
      const base=String(SUPABASE_URL||'').replace(/\/+$/,'');
      if(!base) return false;
      return value.startsWith(base+'/storage/v1/object/public/'+encodeURIComponent(SUPABASE_BUCKET)+'/');
    }catch(e){return false;}
  }
  function metadata(value){
    if(!value || !ID_PATTERN.test(value.id||'')) return null;
    const name=String(value.name||'').trim(), bytes=Number(value.bytes), duration=Number(value.duration);
    if(!name || name.length>48 || !Number.isInteger(bytes) || bytes<1 || bytes>MAX_BYTES || !Number.isFinite(duration) || duration<=0 || duration>MAX_SECONDS+.01 || !/^audio\/[a-z0-9.+-]+$/i.test(value.mime||'') || !/^[a-f0-9]{64}$/.test(value.version||'') || !cloudURL(value.url)) return null;
    return {id:value.id,name,bytes,duration,mime:value.mime,version:value.version,url:value.url};
  }
  try{
    const data=JSON.parse(el('aurora-shared-sounds')?.textContent||'{}');
    sharedTime=Number(data.exportedAt)||0;
    for(const item of (Array.isArray(data.sounds)?data.sounds:[]).slice(0,MAX_SOUNDS)){
      const meta=metadata(item);if(!meta) continue;
      shared.push(meta);
      if(typeof item.data==='string' && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(item.data) && item.data.length<MAX_BYTES*1.4+200) embedded.set(meta.id,{version:meta.version,data:item.data});
    }
    const cache=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    if(cache && Number(cache.at)>=sharedTime && Array.isArray(cache.sounds)){
      shared=cache.sounds.map(metadata).filter(Boolean).slice(0,MAX_SOUNDS);sharedTime=Number(cache.at);
    }
  }catch(e){}
  function database(){
    if(!databasePromise) databasePromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('This browser cannot save custom audio. Open Aurora in a regular browser tab.'));return;}
      const req=indexedDB.open('aurora-notification-sounds',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:'key'});};
      req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};
      req.onerror=()=>reject(new Error('Audio storage is unavailable. Check browser storage permissions.'));
      req.onblocked=()=>reject(new Error('Close other Aurora tabs, then try again.'));
    });
    return databasePromise;
  }
  async function storage(mode,work){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result;
      const request=work(store);if(request) request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(new Error('Could not save audio. Free some browser storage and retry.'));
    });
  }
  const put=record=>storage('readwrite',s=>s.put(record));
  const removeKey=key=>storage('readwrite',s=>s.delete(key));
  function all(){
    const publicIds=new Set(shared.map(s=>s.id));
    return [...shared.map(s=>({...s,scope:'shared'})),...[...personal.values()].filter(r=>!publicIds.has(r.meta.id)).map(r=>({...r.meta,scope:'personal'}))];
  }
  const find=id=>all().find(s=>s.id===id)||null;
  function invalidateSelection(){
    try{
      const p=getNotifPrefs();
      if(ID_PATTERN.test(p.sound) && !find(p.sound)){
        stopNotifSound();p.sound='breeze';saveNotifPrefs(p);
        status('The selected custom sound is no longer available. Aurora Breeze is selected.');
      }
    }catch(e){}
  }
  function render(){
    const mine=[...personal.values()].filter(r=>!shared.some(s=>s.id===r.meta.id)).map(r=>({...r.meta,scope:'personal'}));
    const selected=getNotifPrefs().sound, dev=developerUI();
    const row=s=>{
      const cache=cachedFiles.get(s.id),cached=cache?.meta.version===s.version;
      const availability=s.scope==='personal'?'This device':cached?(cache.persisted?'Saved offline':'Ready this session'):'Available online';
      const actions=s.scope==='personal'
        ? '<button type="button" data-ns-action="rename" data-id="'+safe(s.id)+'">Rename</button><button type="button" data-ns-action="remove" data-id="'+safe(s.id)+'">Remove</button>'+(dev?'<button type="button" data-ns-action="publish" data-id="'+safe(s.id)+'">Publish for everyone</button>':'')
        : dev?'<button type="button" data-ns-action="unpublish" data-id="'+safe(s.id)+'">Unpublish</button>':'';
      return '<div class="ns-row" data-sound-id="'+safe(s.id)+'"><button type="button" class="ns-preview" data-ns-action="preview" data-id="'+safe(s.id)+'" aria-label="Preview '+safe(s.name)+'" title="Preview">▶</button><div style="min-width:0"><div class="ns-name" title="'+safe(s.name)+'">'+safe(s.name)+'</div><div class="ns-meta">'+s.duration.toFixed(1)+'s · '+availability+'</div><div class="ns-actions">'+actions+'</div></div><button type="button" class="ns-btn '+(selected===s.id?'selected':'')+'" data-ns-action="use" data-id="'+safe(s.id)+'" aria-pressed="'+(selected===s.id)+'">'+(selected===s.id?'✓ Used':'Use')+'</button></div>';
    };
    if(el('nsPersonalList')) el('nsPersonalList').innerHTML=mine.map(row).join('')||'<div class="ns-empty">Add a sound from your files to get started.</div>';
    if(el('nsSharedList')) el('nsSharedList').innerHTML=shared.map(s=>row({...s,scope:'shared'})).join('')||'<div class="ns-empty">No developer-published sounds yet.</div>';
    if(el('nsPersonalCount')) el('nsPersonalCount').textContent=String(mine.length);
    ['nsScopeRow','nsExportBtn','nsExportHint'].forEach(id=>{if(el(id)) el(id).hidden=!dev;});
    if(el('nsSyncStatus')) el('nsSyncStatus').textContent=cloudStatus==='live'?'Live library · new published sounds are saved on this browser automatically.':cloudStatus==='connecting'?'Connecting to the shared sound library…':cloudStatus==='error'?'Shared library unavailable. Saved sounds still work. Check supabase/schema.sql policies or tap Refresh.':'Offline / not connected · saved and embedded sounds are available.';
    el('nsLibraryCard')?.querySelectorAll('button,select').forEach(node=>{node.disabled=busy;});
    try{refreshNotifSettingsUI();}catch(e){}
  }
  async function run(action){
    if(busy) return;busy=true;render();
    try{await action();}catch(e){fail(e);}finally{busy=false;render();}
  }
  async function refreshAccount(){
    const next=ownerId(), token=++epoch;
    publisherAllowed=false;
    if(owner && owner!==next) stopNotifSound();
    owner=next;personal.clear();buffers.clear();
    ready=(async()=>{
      try{
        const records=await storage('readonly',s=>s.getAll());
        if(token!==epoch) return;
        for(const r of records||[]){
          if(r.kind==='personal' && r.owner===owner && r.blob instanceof Blob) personal.set(r.meta.id,r);
          if(r.kind==='shared' && r.blob instanceof Blob && shared.some(s=>s.id===r.meta.id && s.version===r.meta.version)) cachedFiles.set(r.meta.id,{...r,persisted:true});
        }
      }catch(e){status(e.message,true);}
      if(token!==epoch) return;
      invalidateSelection();render();cacheShared();
    })();
    verifyPublisher().then(()=>{if(token===epoch){publisherAllowed=true;render();}}).catch(()=>{if(token===epoch) render();});
    return ready;
  }
  async function verifyPublisher(){
    const u=auth?.currentUser;
    if(!u) throw new Error('Sign in with your developer account to publish for everyone. Local accounts cannot publish.');
    if(PUBLISHER_UIDS.includes(u.uid)) return u;
    /* Developer rights live in the users table (see supabase/schema.sql). */
    try{
      const { data }=await sb.from('users').select('data').eq('uid',u.uid).limit(1);
      const d=(data&&data[0]&&data[0].data)||{};
      if(d.developer===true||d.isDeveloper===true||d.role==='developer') return u;
    }catch(e){}
    throw new Error('Only an authorized developer can publish or remove shared sounds.');
  }
  async function digest(blob){
    if(!crypto.subtle) throw new Error('Use HTTPS (or localhost) to add custom sounds securely.');
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function decode(blob,ctx){
    const Context=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const target=ctx||(Context?new Context(1,1,22050):null);
    if(!target) throw new Error('Audio decoding is not supported here. Use a recent Chrome, Safari or Firefox browser.');
    let timer;
    try{
      const buffer=await Promise.race([target.decodeAudioData(await blob.arrayBuffer()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audio took too long to decode. Try a short MP3 or WAV clip.')),8000);})]);
      if(!(buffer.duration>0) || buffer.duration>MAX_SECONDS+.01) throw new Error('Notification sounds must be 10 seconds or shorter. Please trim this clip first.');
      return buffer;
    }catch(e){throw new Error(e.message?.includes('seconds')||e.message?.includes('too long')?e.message:'Cannot read this audio format. Try MP3, WAV or M4A.');}
    finally{clearTimeout(timer);}
  }
  async function add(file,audience){
    if(!file) return;
    if(!currentUserData) throw new Error('Sign in before adding personal sounds.');
    if(file.size<1 || file.size>MAX_BYTES) throw new Error('Choose an audio clip no larger than 1 MB.');
    if(!/^audio\//i.test(file.type) && !/\.(mp3|wav|m4a|ogg|opus|aac|flac|weba)$/i.test(file.name||'')) throw new Error('Choose an audio file, such as MP3, WAV or M4A.');
    const capturedOwner=owner, token=epoch;
    await ready;
    if(token!==epoch) throw new Error('Account changed. Add the sound again on the correct account.');
    if(personal.size>=MAX_SOUNDS) throw new Error('You can keep up to 12 personal sounds. Remove one first.');
    if(audience==='everyone') await verifyPublisher();
    status('Checking audio…');
    const buffer=await decode(file), version=await digest(file);
    if(token!==epoch || capturedOwner!==owner) throw new Error('Account changed. Add the sound again on the correct account.');
    const id='custom-'+crypto.randomUUID();
    const ext=(file.name||'').split('.').pop().toLowerCase();
    const types={mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',opus:'audio/ogg',aac:'audio/aac',flac:'audio/flac',weba:'audio/webm'};
    const mime=/^audio\/[a-z0-9.+-]+$/i.test(file.type)?file.type:types[ext]||'audio/mpeg';
    const blob=file.slice(0,file.size,mime);
    const meta={id,name:String(file.name||'My sound').replace(/\.[^.]+$/,'').trim().slice(0,48)||'My sound',bytes:blob.size,duration:buffer.duration,mime,version};
    const record={key:'personal:'+capturedOwner+':'+id,kind:'personal',owner:capturedOwner,meta,blob};
    await put(record);
    if(token!==epoch || capturedOwner!==owner) throw new Error('Account changed. The sound was saved only on the original account.');
    personal.set(id,record);
    status('Sound saved on this account and browser. Tap Use to select it.');render();
    if(audience==='everyone') await publish(id);
  }
  function fromDataURL(value){
    const parts=value.split(','),raw=atob(parts[1]||'');
    if(raw.length>MAX_BYTES) throw new Error('Embedded sound is too large.');
    return new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:parts[0].slice(5).split(';')[0]});
  }
  async function boundedFetch(url){
    if(!cloudURL(url)) throw new Error('Untrusted shared audio URL.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
      if(!response.ok) throw new Error('Audio download failed ('+response.status+').');
      if(Number(response.headers.get('content-length'))>MAX_BYTES) throw new Error('Shared audio exceeds the size limit.');
      if(!response.body){const blob=await response.blob();if(blob.size>MAX_BYTES) throw new Error('Audio exceeds 1 MB.');return blob;}
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done) break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Shared audio exceeds 1 MB.');}chunks.push(value);}
      return new Blob(chunks,{type:response.headers.get('content-type')||'audio/mpeg'});
    }finally{clearTimeout(timer);}
  }
  async function blobFor(id){
    await ready;
    const sound=find(id);if(!sound) throw new Error('This sound is unavailable on this account.');
    const own=personal.get(id),cached=cachedFiles.get(id);
    if(own?.meta.version===sound.version) return own.blob;
    if(cached?.meta.version===sound.version) return cached.blob;
    const key=id+':'+sound.version;
    if(jobs.has(key)) return jobs.get(key);
    const task=(async()=>{
      const built=embedded.get(id);
      const downloaded=built?.version===sound.version?fromDataURL(built.data):await boundedFetch(sound.url);
      // Some raw/CDN assets arrive as application/octet-stream; embed them
      // using their validated audio MIME so fresh offline installs can read them.
      const blob=downloaded.slice(0,downloaded.size,sound.mime);
      if(blob.size!==sound.bytes || await digest(blob)!==sound.version) throw new Error('Audio integrity check failed. Refresh the shared library.');
      await decode(blob);
      if(find(id)?.version!==sound.version) throw new Error('This sound changed. Please retry.');
      const record={key:'shared:'+id,kind:'shared',meta:sound,blob,persisted:false};
      cachedFiles.set(id,record);
      try{await put(record);record.persisted=true;}catch(e){status('Sound is available this session, but could not be saved offline.',true);}
      render();return blob;
    })();
    jobs.set(key,task);
    try{return await task;}finally{jobs.delete(key);}
  }
  async function audioBuffer(id,ctx){
    const token=epoch,blob=await blobFor(id),sound=find(id);
    if(token!==epoch || !sound) throw new Error('This sound is unavailable on this account.');
    const key=id+':'+sound.version;
    if(buffers.has(key)) return buffers.get(key);
    const buffer=await decode(blob,ctx);
    if(buffers.size>=12) buffers.delete(buffers.keys().next().value);
    if(token!==epoch || find(id)?.version!==sound.version) throw new Error('This sound changed. Please retry.');
    buffers.set(key,buffer);return buffer;
  }
  async function cacheShared(){
    const pending=[...shared];
    async function worker(){while(pending.length){const item=pending.shift();try{await blobFor(item.id);}catch(e){/* Retry on selection/refresh; never autoplay. */}}}
    await Promise.all([worker(),worker()]);
  }
  async function writeCatalog(action,id,meta,u){
    if(auth?.currentUser?.uid!==u.uid) throw new Error('Developer account changed. Sign in again.');
    const {doc,setDoc,deleteDoc}=AURORA_SB;
    if(action==='delete'){ await deleteDoc(doc(db,'notification_sounds',id)); return; }
    await setDoc(doc(db,'notification_sounds',id),{
      id, name:meta.name, url:meta.url, mime:meta.mime, version:meta.version,
      bytes:meta.bytes, duration:meta.duration, scope:'shared',
      createdBy:u.uid, createdAt:Date.now()
    },{merge:true});
  }
  function saveSharedIndex(){sharedTime=Date.now();try{localStorage.setItem(CACHE_KEY,JSON.stringify({at:sharedTime,sounds:shared}));}catch(e){}}
  async function publish(id){
    const token=epoch,u=await verifyPublisher();
    if(token!==epoch) throw new Error('Account changed. Publish again on the correct account.');
    if(!isCloudUp()) throw new Error('Connect the cloud and sign in before publishing.');
    const record=personal.get(id);if(!record) throw new Error('Only a sound in your personal library can be published.');
    if(shared.length>=MAX_SOUNDS && !shared.some(s=>s.id===id)) throw new Error('The shared library allows 12 sounds. Unpublish one first.');
    status('Publishing for every user…');
    const mime=record.meta.mime.toLowerCase();
    const ext=mime.includes('wav')?'wav':/mp4|m4a/.test(mime)?'m4a':mime.includes('ogg')?'ogg':mime.includes('opus')?'opus':mime.includes('webm')?'weba':mime.includes('flac')?'flac':mime.includes('aac')?'aac':'mp3';
    const up=await uploadToStorage(record.blob,{fileName:'aurora-notification-'+id+'.'+ext,mime:'audio/'+ext,onProgress:p=>status('Uploading shared sound… '+p+'%')});
    const meta=metadata({...record.meta,url:up.secure_url});
    if(!meta) throw new Error('Storage did not return a valid audio URL. The sound remains personal.');
    status('Verifying the public audio download…');
    const delivered=await boundedFetch(meta.url);
    if(delivered.size!==meta.bytes || await digest(delivered)!==meta.version) throw new Error('The stored audio does not match what was uploaded. Try another format. The sound remains personal.');
    if(token!==epoch) throw new Error('Account changed. The shared sound was not published.');
    await writeCatalog('publish',id,meta,u);
    shared=[...shared.filter(s=>s.id!==id),meta];
    saveSharedIndex();
    const cached={key:'shared:'+id,kind:'shared',meta,blob:record.blob,persisted:false};
    cachedFiles.set(id,cached);
    try{await put(cached);cached.persisted=true;}catch(e){/* Publication is already confirmed; local cache failure must not misreport it. */}
    status('Published for everyone. Updated apps will receive and cache this sound; existing sound choices are kept.');render();
  }
  async function unpublish(id){
    const u=await verifyPublisher();
    if(!confirm('Remove this sound from the shared library for everyone? Existing exported/offline copies may retain it until they sync.')) return;
    await writeCatalog('delete',id,null,u);
    shared=shared.filter(s=>s.id!==id);saveSharedIndex();cachedFiles.delete(id);embedded.delete(id);
    try{await removeKey('shared:'+id);}catch(e){}
    invalidateSelection();status('Unpublished. The audio file stays in storage; only the shared catalog entry was removed.');render();
  }
  async function connectCloud(force=false){
    if(!isCloudUp()){cloudStatus='offline';render();return;}
    if(connectedDb===db && !force) return;
    const connection=++connectionEpoch;
    if(subscription){subscription();subscription=null;}
    connectedDb=db;cloudStatus='connecting';render();
    try{
      const {collection,onSnapshot}=AURORA_SB;
      if(connection!==connectionEpoch) return;
      subscription=onSnapshot(collection(db,'notification_sounds'),{includeMetadataChanges:true},snapshot=>{
        if(connection!==connectionEpoch || snapshot.metadata?.fromCache) return;
        const before=shared;
        shared=snapshot.docs.map(doc=>metadata({...doc.data(),id:doc.id})).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,MAX_SOUNDS);
        cloudStatus='live';saveSharedIndex();
        for(const previous of before){if(!shared.some(s=>s.id===previous.id && s.version===previous.version)){cachedFiles.delete(previous.id);buffers.delete(previous.id+':'+previous.version);removeKey('shared:'+previous.id).catch(()=>{});}}
        ready.then(()=>{invalidateSelection();render();cacheShared();});
      },()=>{if(connection===connectionEpoch){cloudStatus='error';connectedDb=null;render();}});
    }catch(e){if(connection===connectionEpoch){cloudStatus='offline';connectedDb=null;render();}}
  }
  async function rename(id){
    const token=epoch,record=personal.get(id);if(!record) return;
    const name=prompt('Sound name (up to 48 characters)',record.meta.name);if(name===null) return;
    if(!name.trim() || name.trim().length>48) throw new Error('Use a name between 1 and 48 characters.');
    const updated={...record,meta:{...record.meta,name:name.trim()}};await put(updated);
    if(token!==epoch) return;
    personal.set(id,updated);status('Sound renamed.');
  }
  async function remove(id){
    const token=epoch,record=personal.get(id);if(!record) return;
    if(!confirm('Remove this personal sound from this browser?')) return;
    await removeKey(record.key);if(token!==epoch) return;personal.delete(id);buffers.delete(id+':'+record.meta.version);invalidateSelection();status('Personal sound removed.');
  }
  async function select(id){
    stopNotifSound();
    const token=epoch,generation=notifSoundGeneration,previous=getNotifPrefs().sound;
    await blobFor(id);
    if(token!==epoch || !find(id)) throw new Error('This sound is unavailable on this account.');
    // A late download must never undo a more recent Silent/mute/preview action.
    if(generation!==notifSoundGeneration || getNotifPrefs().sound!==previous) return;
    const p=getNotifPrefs();p.sound=id;saveNotifPrefs(p);render();
    status('Selected '+find(id).name+'.');
    if(notificationsEnabled) await playNotifSound(id,{preview:true});
  }
  async function preview(id){
    if(!notificationsEnabled){status('Turn on Push Notifications to preview sounds.');return;}
    status('Playing '+(find(id)?.name||'sound')+'…');
    await playNotifSound(id,{preview:true});
  }
  async function dataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not embed the sound.'));r.readAsDataURL(blob);});}
/* Fold locally-served stylesheets/scripts back into a snapshot, so a downloaded
   "single HTML" stays self-contained now that the app lives in separate files.
   External URLs (Google Fonts) are left alone. */
async function inlineLocalAssets(doc){
  const links=[...doc.querySelectorAll('link[rel="stylesheet"][href]')];
  for(const link of links){
    const href=link.getAttribute('href');
    if(/^(https?:)?\/\//i.test(href)) continue;
    try{
      const res=await fetch(href,{cache:'no-store'});
      if(!res.ok) continue;
      const style=doc.createElement('style');
      if(link.id) style.id=link.id;
      style.textContent=await res.text();
      link.replaceWith(style);
    }catch(e){}
  }
  const nodes=[...doc.querySelectorAll('script[src]')];
  for(const node of nodes){
    const src=node.getAttribute('src');
    if(/^(https?:)?\/\//i.test(src)) continue;
    try{
      const res=await fetch(src,{cache:'no-store'});
      if(!res.ok) continue;
      const code=await res.text();
      if(code.includes('</scr'+'ipt')) continue;
      const inline=doc.createElement('script');
      if(node.type) inline.type=node.type;
      if(node.id) inline.id=node.id;
      inline.textContent=code;
      node.replaceWith(inline);
    }catch(e){}
  }
  return doc;
}

  async function exportHTML(){
    if(!developerUI()) throw new Error('Only the developer can export the shared sound build.');
    if(!shared.length) throw new Error('Publish a sound first, then export the updated HTML.');
    status('Embedding shared audio in a clean copy of the app…');
    const sounds=[];
    for(const meta of shared) sounds.push({...meta,data:await dataURL((await blobFor(meta.id)).slice(0,meta.bytes,meta.mime))});
    const doc=await inlineLocalAssets(new DOMParser().parseFromString(AURORA_EXPORT_BASE,'text/html'));
    const catalog=doc.getElementById('aurora-shared-sounds');
    if(!catalog) throw new Error('The export template is missing its sound catalog.');
    catalog.textContent=JSON.stringify({version:1,exportedAt:Date.now(),sounds}).replace(/</g,'\\u003c');
    const blob=new Blob(['<!DOCTYPE html>\n'+doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AURORA-CHAT-with-sounds.html';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    status('Downloaded HTML with shared sounds embedded. Upload it to your hosting to update the source file. No chats, accounts or personal-only audio were exported.');
  }
  el('nsAddBtn')?.addEventListener('click',()=>el('nsFileInput')?.click());
  el('nsFileInput')?.addEventListener('change',event=>{const file=event.target.files?.[0],audience=developerUI()?el('nsAudience').value:'personal';event.target.value='';run(()=>add(file,audience));});
  el('nsLibraryCard')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-ns-action]');if(!button) return;
    const id=button.dataset.id,action=button.dataset.nsAction;
    if(action==='preview'){preview(id).catch(fail);return;}
    const actions={use:select,rename,remove,publish,unpublish};if(actions[action]) run(()=>actions[action](id));
  });
  el('nsSyncBtn')?.addEventListener('click',()=>run(async()=>{
    await connectCloud(true);await cacheShared();
    if(!isCloudUp()) status('Shared sync needs the cloud connection. If you started offline, reconnect and reload Aurora. Saved sounds are still available.');
  }));
  el('nsExportBtn')?.addEventListener('click',()=>run(exportHTML));
  window.addEventListener('online',()=>connectCloud(true));
  window.addEventListener('offline',()=>{cloudStatus='offline';render();});
  window.addEventListener('storage',event=>{if(event.key===CACHE_KEY){try{const cache=JSON.parse(event.newValue);if(cache && Number(cache.at)>sharedTime){shared=(cache.sounds||[]).map(metadata).filter(Boolean).slice(0,MAX_SOUNDS);sharedTime=cache.at;ready.then(()=>{invalidateSelection();render();cacheShared();});}}catch(e){}}});
  queueMicrotask(()=>{refreshAccount();connectCloud();});
  return {list:all,find,audioBuffer,refreshAccount,connectCloud,refreshUI:render,reportError:fail,ready:()=>ready};
})();

/* ===== Notifications preferences page ===== */
const NF_SOUNDS = Object.entries(NOTIF_TONE_PROFILES).map(([id,tone])=>({
  id, name:tone.name, description:tone.description
}));
function getNotificationSoundOptions(){
  const custom=(window.AuroraSoundLibrary?.list()||[]).map(sound=>({id:sound.id,name:sound.name,description:(sound.scope==='shared'?'Developer sound':'Personal sound')+' · '+sound.duration.toFixed(1)+'s'}));
  return [...NF_SOUNDS.filter(sound=>sound.id!=='silent'),...custom,NF_SOUNDS.find(sound=>sound.id==='silent')];
}
function loadNotifPrefs(){
  try{
    return JSON.parse(localStorage.getItem('aurora_notif_prefs')||'{}');
  }catch(e){ return {}; }
}
function saveNotifPrefs(p){
  try{ localStorage.setItem('aurora_notif_prefs', JSON.stringify(p)); }catch(e){}
}
function getNotifPrefs(){
  const d = {messages:true, groups:true, calls:true, quiet:false, quietFrom:'22:00', quietTo:'07:00', sound:'breeze'};
  const p=Object.assign(d, loadNotifPrefs());
  p.sound=normaliseNotifSound(p.sound);
  return p;
}
function isQuietHoursNow(){
  const p=getNotifPrefs();
  if(!p.quiet) return false;
  try{
    const now=new Date();
    const cur=now.getHours()*60+now.getMinutes();
    const [fh,fm]=(p.quietFrom||'22:00').split(':').map(Number);
    const [th,tm]=(p.quietTo||'07:00').split(':').map(Number);
    const from=fh*60+(fm||0), to=th*60+(tm||0);
    if(from===to) return false;
    if(from<to) return cur>=from && cur<to;
    return cur>=from || cur<to; // overnight
  }catch(e){ return false; }
}
function openNotifSettings(){
  const view=document.getElementById('notifView');
  if(!view) return;
  // ensure settings chrome hidden; notif on top
  try{
    document.querySelector('.s-search')&&(document.querySelector('.s-search').style.display='none');
    ['activeNowSection','recentLabel','chatList','fabNewChat'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    const sh=document.querySelector('#sidebar > .s-header'); if(sh) sh.style.display='none';
    const sv=document.getElementById('settingsView'); if(sv) sv.classList.add('show');
  }catch(e){}
  // FIX: hardHideSettingsPages() may have left inline display:none/hidden on it
  try{ view.style.cssText=''; view.hidden=false; view.style.pointerEvents=''; }catch(e){}
  view.classList.add('show');
  document.querySelectorAll('.bn-item').forEach(b=>b.classList.toggle('active', b.dataset.nav==='settings'));
  refreshNotifSettingsUI();
}
function closeNotifSettings(){
  const view=document.getElementById('notifView');
  if(view) view.classList.remove('show');
}
function refreshNotifSettingsUI(){
  const p=getNotifPrefs();
  const master=document.getElementById('nfMasterToggle');
  if(master) master.classList.toggle('on', !!notificationsEnabled);
  const map={nfMsgToggle:p.messages, nfGroupToggle:p.groups, nfCallToggle:p.calls, nfQuietToggle:p.quiet};
  Object.keys(map).forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.toggle('on', !!map[id]);
  });
  const fromEl=document.getElementById('nfQuietFrom');
  const toEl=document.getElementById('nfQuietTo');
  if(fromEl) fromEl.textContent=p.quietFrom||'22:00';
  if(toEl) toEl.textContent=p.quietTo||'07:00';
  const sound=getNotificationSoundOptions().find(s=>s.id===p.sound)||(/^custom-/.test(p.sound)?{name:'Custom sound',description:'Loading your sound library'}:NF_SOUNDS[0]);
  const sl=document.getElementById('nfSoundLabel');
  if(sl){sl.textContent=sound.name;sl.title=sound.description;}
  const hint=document.getElementById('nfSoundHint');
  if(hint) hint.textContent=sound.description+' · Tap to change';
  const soundRow=document.getElementById('nfSoundRow');
  if(soundRow) soundRow.setAttribute('aria-label','Notification sound: '+sound.name+'. '+sound.description+'. Tap to choose the next sound.');
  // dim category toggles if master off
  const dim=!notificationsEnabled;
  ['nfMsgToggle','nfGroupToggle','nfCallToggle'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.opacity=dim?'.45':'1';
  });
}
window.openNotifSettings=openNotifSettings;
window.closeNotifSettings=closeNotifSettings;
window.getNotifPrefs=getNotifPrefs;
window.isQuietHoursNow=isQuietHoursNow;

// Hook into notifyIncomingMessage - respect prefs
(function(){
  const _orig = window.notifyIncomingMessage;
  // notifyIncomingMessage is a function declaration in module - patch after defined via wrapping at end
})();

function toggleNotifPref(key){
  const p=getNotifPrefs();
  p[key]=!p[key];
  saveNotifPrefs(p);
  refreshNotifSettingsUI();
}
function cycleNotifSound(){
  const p=getNotifPrefs();
  const sounds=getNotificationSoundOptions();
  const idx=sounds.findIndex(s=>s.id===p.sound);
  const next=sounds[(idx+1)%sounds.length];
  p.sound=next.id;
  saveNotifPrefs(p);
  refreshNotifSettingsUI();
  // Play the exact selected tone, not the previous hard-coded default.
  // Selecting Silent also cancels any preview that is still ringing out.
  if(notificationsEnabled || next.id==='silent') playNotifSound(next.id,{preview:true});
  window.AuroraSoundLibrary?.refreshUI();
  showToast({title:'Notification Sound', body:next.name+' · '+next.description, color:'#2563eb', avatar:next.id==='silent'?'🔇':'♪'});
}
function promptQuietTime(which){
  const p=getNotifPrefs();
  const cur=which==='from'?(p.quietFrom||'22:00'):(p.quietTo||'07:00');
  const v=prompt(which==='from'?'Quiet hours FROM (HH:MM)':'Quiet hours TO (HH:MM)', cur);
  if(v==null) return;
  const m=String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!m){ showToast({title:'Invalid time', body:'Use format HH:MM e.g. 22:00', color:'#ef4444', avatar:'!'}); return; }
  let h=+m[1], min=+m[2];
  if(h>23||min>59){ showToast({title:'Invalid time', body:'Hours 0-23, minutes 0-59', color:'#ef4444', avatar:'!'}); return; }
  const norm=String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
  if(which==='from') p.quietFrom=norm; else p.quietTo=norm;
  saveNotifPrefs(p);
  refreshNotifSettingsUI();
}
function testNotifAlert(){
  if(!notificationsEnabled){
    showToast({title:'Notifications Off', body:'Turn on Push Notifications first', color:'#f59e0b', avatar:'🔕'});
    return;
  }
  if(isQuietHoursNow()){
    showToast({title:'Quiet Hours', body:'Alerts are muted during quiet hours', color:'#64748b', avatar:'🌙'});
    return;
  }
  const p=getNotifPrefs();
  if(!p.messages){
    showToast({title:'Message Alerts Off', body:'Enable Message Alerts to preview', color:'#f59e0b', avatar:'!'});
    return;
  }
  playNotifSound(p.sound,{preview:true});
  showToast({
    title:'Sarah Jenkins',
    body:'Sent a photo: "The sunset looks amazing tonight"',
    color:'#2563eb',
    avatar:'SJ'
  });
}

// Wire notif page controls
document.getElementById('stOpenNotifPage')?.addEventListener('click', (e)=>{
  if(e.target.closest('#stNotifToggle')) return;
  openNotifSettings();
});
document.getElementById('stOpenNotifPage')?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openNotifSettings(); }
});
document.getElementById('notifBackBtn')?.addEventListener('click', ()=>{
  closeNotifSettings();
  openSettings();
});
document.getElementById('notifGoChats')?.addEventListener('click', ()=>{
  closeNotifSettings();
  closeSettings();
  switchBottomNav('chats');
});
document.getElementById('notifProfileBtn')?.addEventListener('click', ()=>{
  closeNotifSettings();
  openSettings();
});
document.getElementById('nfMasterRow')?.addEventListener('click', ()=>{
  document.getElementById('notifBtn')?.click();
  setTimeout(()=>{ refreshNotifSettingsUI(); refreshSettingsUI(); }, 150);
});
document.getElementById('nfMsgToggle')?.addEventListener('click', (e)=>{ e.stopPropagation(); toggleNotifPref('messages'); });
document.getElementById('nfGroupToggle')?.addEventListener('click', (e)=>{ e.stopPropagation(); toggleNotifPref('groups'); });
document.getElementById('nfCallToggle')?.addEventListener('click', (e)=>{ e.stopPropagation(); toggleNotifPref('calls'); });
document.getElementById('nfQuietToggle')?.addEventListener('click', (e)=>{ e.stopPropagation(); toggleNotifPref('quiet'); });
document.getElementById('nfQuietFromBtn')?.addEventListener('click', ()=>promptQuietTime('from'));
document.getElementById('nfQuietToBtn')?.addEventListener('click', ()=>promptQuietTime('to'));
document.getElementById('nfSoundRow')?.addEventListener('click', cycleNotifSound);
document.getElementById('nfTestBtn')?.addEventListener('click', testNotifAlert);

// Keep stNotifToggle working without opening page
document.getElementById('stNotifToggle')?.addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('notifBtn')?.click();
  setTimeout(()=>{ refreshSettingsUI(); refreshNotifSettingsUI(); }, 150);
});

// Patch notifyIncomingMessage to respect prefs (after function exists)
setTimeout(function(){
  try{
    if(typeof notifyIncomingMessage!=='function' || notifyIncomingMessage._nfPatched) return;
    const _nf = notifyIncomingMessage;
    window._notifyIncomingMessageRaw = _nf;
    // In module scope notifyIncomingMessage is const-like function - reassign local via wrapping calls is hard.
  }catch(e){}
}, 0);

document.getElementById('stDarkToggle')?.addEventListener('click',()=>{
  const mode=getPreferredThemeMode();
  const darkIsOn=mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(darkIsOn){
    applyThemeMode('light');
  }else{
    applyThemeMode('dark');
  }
  setTimeout(()=>{ refreshSettingsUI(); try{refreshAppearanceUI();}catch(e){} }, 100);
});
document.getElementById('stBlackToggle')?.addEventListener('click',()=>{
  applyThemeMode(getPreferredThemeMode()==='black'?'light':'black');
  refreshSettingsUI();
  try{refreshAppearanceUI();}catch(e){}
});
// Refresh settings avatar after profile pic change
const _picInput=document.getElementById('profilePicInput');
if(_picInput && !_picInput._settingsHook){
  _picInput._settingsHook=true;
  _picInput.addEventListener('change',()=>setTimeout(refreshSettingsUI, 500));
}


document.getElementById('headerSearchBtn')?.addEventListener('click',()=>{
  const inp=document.getElementById('searchInput');
  if(inp){inp.focus(); inp.select?.();}
});
document.getElementById('fabNewChat')?.addEventListener('click',()=>{
  document.getElementById('newChatBtn')?.click();
});
document.getElementById('activeNowViewAll')?.addEventListener('click',()=>switchBottomNav('people'));
document.querySelectorAll('.bn-item').forEach(btn=>{
  btn.addEventListener('click',()=>switchBottomNav(btn.dataset.nav));
});
// Keep myAvatar click → profile pic (event on #myAvatar still works)
try{
  const av=document.getElementById('myAvatar');
  if(av && !av._picBound){
    // afterLogin sets innerHTML; click on header profile opens menu, long-press not needed
  }
}catch(e){}

$('#newChatBtn').addEventListener('click',()=>{
  const users=Object.values(getUsers()).filter(u=>u.username!==currentUserData?.username);
  const sugg=$('#userSuggestions');
  sugg.innerHTML=users.map(u=>`<div style="padding:8px;cursor:pointer;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:10px;" onclick="document.getElementById('newName').value='${u.username}'"><div class="avatar" style="width:28px;height:28px;font-size:10px;background:${avBg(u,u.color)};overflow:hidden;">${avHTML(u)}</div><div style="font-size:12px;font-weight:500;">${u.nickname||u.username}<span style="font-weight:400;color:#94a3b8;font-size:10px;"> @${u.username}</span></div></div>`).join('')||'<div style="font-size:11px;color:#94a3b8;padding:8px;">No recent people — search in People tab</div>';
  $('#newChatModal').classList.add('show');
});
$('#closeModalBtn').addEventListener('click',()=>$('#newChatModal').classList.remove('show'));
$('#newChatModal').addEventListener('click',e=>{if(e.target.id==='newChatModal') e.currentTarget.classList.remove('show');});
$('#createChatBtn').addEventListener('click',()=>{
  const name=($('#newName').value||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(!name){ alert('Username dao'); return; }
  try{ $('#newChatModal').classList.remove('show'); }catch(e){}
  try{ $('#newName').value=''; }catch(e){}
  // ensure chats tab
  try{ if(typeof switchBottomNav==='function') switchBottomNav('chats'); }catch(e){}
  startChatWith(name);
});
$('#backBtn').addEventListener('click',()=>{
  leaveConversation();
  renderChats();
});
$('#switchModal').addEventListener('click',e=>{if(e.target.id==='switchModal') e.currentTarget.classList.remove('show');});

// Delete logic
let ctxRoomId=null, pendingDeleteRoomId=null;
window.openCtx=(e, roomId)=>{e.preventDefault(); ctxRoomId=roomId; const m=$('#ctxMenu'); const shell=document.getElementById('phoneShell')||document.body; const sRect=shell.getBoundingClientRect(); const cx=e.touches?e.touches[0].clientX:e.clientX; const cy=e.touches?e.touches[0].clientY:e.clientY; m.style.left=Math.min(Math.max(8, cx-sRect.left), sRect.width-180)+'px'; m.style.top=Math.min(Math.max(8, cy-sRect.top), sRect.height-120)+'px'; m.classList.add('show');};
/* a room is "mine" when my username is part of it */
function _isMyRoom(roomId){
  try{
    const me=String(currentUserData?.username||'').toLowerCase();
    if(!me || !roomId) return false;
    const c=(contacts||[]).find(x=>x.id===roomId);
    if(c){
      const pu=c.participantUsernames||c.participants||[];
      if(Array.isArray(pu) && pu.length) return pu.map(x=>String(x).toLowerCase()).includes(me);
    }
    return String(roomId).toLowerCase().split('_').join('_').includes(me);
  }catch(e){ return true; }   // fail open for normal 1:1 chats
}
window._isMyRoom=_isMyRoom;

window.handleCtxAction=(action)=>{
  $('#ctxMenu').classList.remove('show');
  if(!ctxRoomId) return;
  if(action==='view'){openRoom(ctxRoomId);}
  else if(action==='clear'||action==='delete'){openDeleteModal(ctxRoomId, action);}
};

// Message context menu functions
let currentMsgId=null;
window.replyToMsg=null;
window.jumpToMsg=function(id){
  if(!id) return;
  const el=document.querySelector(`.msg-row[data-msg-id="${id}"]`);
  if(!el) return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.classList.remove('highlight-jump');
  void el.offsetWidth;
  el.classList.add('highlight-jump');
  setTimeout(()=>el.classList.remove('highlight-jump'),1400);
};

window.openMsgMenu=(e, msgId)=>{
  e.stopPropagation();
  currentMsgId=msgId;
  const menu=$('#msgCtxMenu');
  if(!menu) return;
  
  // Close any other open menus first
  $('#msgCtxMenu').classList.remove('show');
  $('#ctxMenu').classList.remove('show');
  
  // Position menu near the button
  const btn=e.target;
  const rect=btn.getBoundingClientRect();
  const shell=document.getElementById('phoneShell')||document.body;
  const sRect=shell.getBoundingClientRect();
  
  menu.style.left=Math.min(Math.max(8, rect.left-sRect.left), sRect.width-200)+'px';
  menu.style.top=Math.min(Math.max(8, rect.bottom-sRect.top+8), sRect.height-150)+'px';
  menu.classList.add('show');
};

// Close message menu when clicking outside
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.msg-ctx-menu') && !e.target.closest('.msg-menu-btn')){
    $('#msgCtxMenu').classList.remove('show');
  }
});

window.handleMsgAction=(action)=>{
  $('#msgCtxMenu').classList.remove('show');
  if(!currentMsgId||!currentRoomId) return;
  executeMsgAction(action, currentMsgId);
};

window.handleMsgActionDirect=(action, msgId)=>{
  window.executeMsgAction(action, msgId);
};

/* BUGFIX: reply / copy / delete were dead for every CLOUD account.
   They all looked the message up via getGlobalRooms()[currentRoomId], but in cloud mode messages live in the database and are never written to
   localStorage — so `room` was undefined and each action hit `return`
   silently, with no error and no feedback. Only offline accounts worked.
   Now we resolve the message from the render cache first (works in BOTH
   modes) and fall back to localStorage. */
function findMsgById(msgId){
  try{
    const c=window._msgCache;
    if(c && c.roomId===currentRoomId && Array.isArray(c.msgs)){
      const hit=c.msgs.find(m=>String(m.id)===String(msgId));
      if(hit) return hit;
    }
  }catch(e){}
  try{
    const room=getGlobalRooms()[currentRoomId];
    if(room && Array.isArray(room.messages)){
      const hit=room.messages.find(m=>String(m.id)===String(msgId));
      if(hit) return hit;
    }
  }catch(e){}
  return null;
}
window.findMsgById=findMsgById;

/* A message's text for previews — media has no usable text. */
function msgPreviewText(m){
  if(!m) return '';
  if(AuroraVoice.isVoiceMessage(m)) return String(m.caption||'🎤 Voice message');
  const t=String(m.text||'').trim();
  if(t && !t.startsWith('data:')) return t;
  if(m.caption && !String(m.caption).startsWith('data:')) return String(m.caption);
  const ty=String(m.type||'');
  if(/image|photo/i.test(ty)) return '📷 Photo';
  if(/video/i.test(ty)) return '🎬 Video';
  if(/audio|voice/i.test(ty)) return '🎤 Voice message';
  if(t.startsWith('data:')) return '📎 Attachment';
  return '[Media]';
}

window.executeMsgAction=function(action, msgId){
  if(!msgId||!currentRoomId) return;
  const msg=findMsgById(msgId);

  if(action==='reply'){
    if(!msg){
      try{ showToast({title:'Could not reply', body:'Message not found — try reopening the chat', color:'#ef4444', avatar:'!'}); }catch(e){}
      return;
    }
    window.replyToMsg=msg;
    window.noteReplyCtx=null;                 // a message reply replaces a note reply
    const preview=$('#replyPreview');
    const name=$('#replyPreviewName');
    const text=$('#replyPreviewText');
    if(preview&&name&&text){
      const who=msg.senderNickname||msg.senderName||msg.sender||'Unknown';
      name.textContent='Replying to '+who;
      text.textContent=msgPreviewText(msg);
      preview.classList.add('show');
      preview.classList.remove('note-mode');
    }
    try{ document.querySelectorAll('.msg-row.msg-active').forEach(r=>r.classList.remove('msg-active')); }catch(e){}
    try{ $('#msgInput')?.focus(); }catch(e){}
  }
  else if(action==='copy'){
    const raw=String(msg?.text||'');
    const txt=(raw && !raw.startsWith('data:')) ? raw : String(msg?.caption||'');
    if(!txt || txt.startsWith('data:')){
      try{ showToast({title:'Nothing to copy', body:'This message has no text', color:'#f59e0b', avatar:'!'}); }catch(e){}
      return;
    }
    const done=()=>{ try{ showToast({title:'Copied!', body:'Message copied to clipboard', color:'#10b981', avatar:'✓'}); }catch(e){} };
    const fail=()=>{ try{ showToast({title:'Copy failed', body:'Could not copy message', color:'#ef4444', avatar:'!'}); }catch(e){} };
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).then(done).catch(()=>{
          // clipboard API needs a secure context; fall back to execCommand
          try{
            const ta=document.createElement('textarea');
            ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0';
            document.body.appendChild(ta); ta.select();
            const ok=document.execCommand('copy'); ta.remove();
            ok?done():fail();
          }catch(e){ fail(); }
        });
      }else{
        const ta=document.createElement('textarea');
        ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        const ok=document.execCommand('copy'); ta.remove();
        ok?done():fail();
      }
    }catch(e){ fail(); }
  }
  else if(action==='delete'){
    // If I'm replying to the message being deleted, drop the reply state.
    try{ if(window.replyToMsg && String(window.replyToMsg.id)===String(msgId)) cancelReply(); }catch(e){}

    if(isCloud && db){
      /* Cloud message: delete the database doc. The onSnapshot listener
         repaints, so no manual re-render is needed. */
      (async()=>{
        try{
          const {doc,deleteDoc}=AURORA_SB;
          await deleteDoc(doc(db,'rooms',currentRoomId,'messages',String(msgId)));
          try{ showToast({title:'Deleted', body:'Message deleted', color:'#ef4444', avatar:'🗑️'}); }catch(e){}
        }catch(err){
          try{ showToast({title:'Delete failed', body:String(err?.message||'Could not delete'), color:'#ef4444', avatar:'!'}); }catch(e){}
        }
      })();
      return;
    }

    const rooms=getGlobalRooms();
    const room=rooms[currentRoomId];
    if(!room) return;
    room.messages=room.messages.filter(m=>String(m.id)!==String(msgId));
    const lastM=room.messages[room.messages.length-1];
    room.lastMessage=lastM?String(lastM.text||'').slice(0,30):'';
    saveGlobalRooms(rooms);
    renderMessagesForRoom(currentRoomId, false);
    try{ refreshContactsFromLocal(); renderChats(); }catch(e){}
    try{ showToast({title:'Deleted', body:'Message deleted', color:'#ef4444', avatar:'🗑️'}); }catch(e){}
  }
};

window.cancelReply=()=>{
  window.replyToMsg=null;
  window.noteReplyCtx=null;
  const preview=$('#replyPreview');
  if(preview) preview.classList.remove('show','note-mode');
};

/* ================== REPLY TO A NOTE (Active Now notes) ==================
   The note modal's action button opens the chat with that person AND keeps the
   note as the thing being answered: the composer shows the note as a preview
   and the sent message carries a copy of it (noteReply), so the conversation
   renders the note bubble first and the answer right below it - on both sides.
   The note text is snapshotted into the message, so the reply still makes
   sense after the note expires (and it never depends on the note still being
   in the cache of the receiver). */
window.noteReplyCtx=null;
function noteReplyPayload(ctx){
  try{
    if(!ctx) return null;
    const text=String(ctx.text||'').trim().slice(0,80);
    if(!text) return null;
    return {
      username:String(ctx.username||'').toLowerCase(),
      name:String(ctx.name||ctx.username||'').slice(0,40),
      emoji:String(ctx.emoji||'📝').slice(0,8),
      text,
      ts:Number(ctx.ts)||Date.now()
    };
  }catch(e){ return null; }
}
/* Pure: the note bubble that sits above the reply inside the conversation. */
function noteQuoteHTML(nr){
  try{
    const p=noteReplyPayload(nr);
    if(!p) return '';
    const label=esc(p.name+"'s note");          // escape the whole label (' included)
    const tap=p.username.replace(/'/g,"\\'");
    return `<div class="note-quote" title="${label}" onclick="event.stopPropagation();openNoteQuote('${tap}')">`
      + `<span class="nq-emoji">${esc(p.emoji||'📝')}</span>`
      + `<span class="nq-body"><span class="nq-name">${label}</span>`
      + `<span class="nq-text">${esc(p.text)}</span></span></div>`;
  }catch(e){ return ''; }
}
/* Tap on the in-chat note bubble opens that person's note viewer. */
window.openNoteQuote=function(username){
  try{ if(username) openUserNoteViewer(String(username).toLowerCase(),''); }catch(e){}
};
function setNoteReply(ctx){
  try{
    const p=noteReplyPayload(ctx);
    if(!p){ cancelReply(); return null; }
    window.replyToMsg=null;                       // note reply and msg reply are exclusive
    window.noteReplyCtx=p;
    const preview=$('#replyPreview');
    const name=$('#replyPreviewName');
    const text=$('#replyPreviewText');
    if(preview&&name&&text){
      name.textContent='Replying to '+p.name+"'s note";
      text.textContent=((p.emoji?p.emoji+' ':'')+p.text).trim();
      preview.classList.add('show','note-mode');
    }
    try{ $('#msgInput')?.focus(); }catch(e){}
    return p;
  }catch(e){ return null; }
}
window.setNoteReply=setNoteReply;
window.noteQuoteHTML=noteQuoteHTML;
window.openDeleteModal=(roomId, action)=>{
  pendingDeleteRoomId=roomId;
  const modal=$('#deleteModal');
  const clearBtn=$('#confirmClearBtn');
  const delBtn=$('#confirmDeleteBtn');
  const title=$('#deleteTitle');
  const contact=contacts.find(c=>c.id===roomId);
  const name=contact? (contact.nickname||contact.name) : roomId;
  if(action==='clear'){title.textContent='Clear messages?'; document.getElementById('deleteDesc').textContent=`Clear all messages in ${name}? Conversation will stay.`; clearBtn.style.display='block'; delBtn.style.display='none';}
  else{title.textContent='Delete conversation?'; document.getElementById('deleteDesc').textContent=`Delete conversation with ${name}? Cannot be undone.`; clearBtn.style.display='none'; delBtn.style.display='block';}
  modal.classList.add('show');
};
window.confirmClearChat=async()=>{
  const roomId=pendingDeleteRoomId; if(!roomId) return;
  if(!_isMyRoom(roomId) && !requirePerm('chat.clearAny','Only Moderator and above can clear other conversations')){
    $('#deleteModal').classList.remove('show'); return;
  }
  $('#deleteModal').classList.remove('show');
  if(isCloud && db){
    try{
      const {collection,getDocs,deleteDoc,doc,updateDoc}=AURORA_SB;
      const snap=await getDocs(collection(db,'rooms',roomId,'messages'));
      for(const m of snap.docs) await deleteDoc(doc(db,'rooms',roomId,'messages',m.id));
      await updateDoc(doc(db,'rooms',roomId),{lastMessage:'Cleared',lastTime:timeNow()});
      if(currentRoomId===roomId) renderMessagesForRoom(roomId);
      return;
    }catch(e){alert(e.message);}
  }else{
    const rooms=getGlobalRooms();
    const room=rooms[roomId];
    if(room){room.messages=[]; room.lastMessage='Cleared'; room.lastTime=timeNow(); room.lastMessageTs=Date.now(); saveGlobalRooms(rooms); refreshContactsFromLocal(); renderChats(); if(currentRoomId===roomId) renderMessagesForRoom(roomId);}
  }
};
window.confirmDeleteChat=async()=>{
  const roomId=pendingDeleteRoomId; if(!roomId) return;
  // deleting a room you are not part of requires Admin+
  if(!_isMyRoom(roomId) && !requirePerm('chat.deleteAny','Only Admin and above can delete other conversations')){
    $('#deleteModal').classList.remove('show'); return;
  }
  $('#deleteModal').classList.remove('show');
  if(isCloud && db){
    try{
      const {collection,getDocs,deleteDoc,doc}=AURORA_SB;
      try{const snap=await getDocs(collection(db,'rooms',roomId,'messages')); for(const m of snap.docs) await deleteDoc(doc(db,'rooms',roomId,'messages',m.id));}catch{}
      await deleteDoc(doc(db,'rooms',roomId));
      const _goneCloud=contacts.find(c=>c.id===roomId)||{};
      contacts=contacts.filter(c=>c.id!==roomId);
      try{ forgetConversation(roomId,_goneCloud.otherUsername||_goneCloud.username); }catch(e){}
      if(currentRoomId===roomId){currentRoomId=null; $('#welcomeScreen').style.display='flex'; $('#mHeader').style.display='none'; $('#messages').style.display='none'; $('#inputArea').style.display='none'; $('#mainPanel').classList.remove('open');}
      renderChats(); return;
    }catch(e){alert(e.message);}
  }
  const rooms=getGlobalRooms();
  if(rooms[roomId]){delete rooms[roomId]; saveGlobalRooms(rooms);}
  const _goneRow=contacts.find(c=>c.id===roomId)||{};
  contacts=contacts.filter(c=>c.id!==roomId);
  try{ forgetConversation(roomId,_goneRow.otherUsername||_goneRow.username); }catch(e){}
  if(currentRoomId===roomId){currentRoomId=null; $('#welcomeScreen').style.display='flex'; $('#mHeader').style.display='none'; $('#messages').style.display='none'; $('#inputArea').style.display='none'; $('#mainPanel').classList.remove('open');}
  renderChats();
};
document.addEventListener('click',(e)=>{
  const m=$('#ctxMenu');
  if(m && !e.target.closest('#ctxMenu') && !e.target.closest('.chat-item')) m.classList.remove('show');
  if(e.target.id==='deleteModal') e.target.classList.remove('show');
});

// Voice call logic
let pc=null, localStream=null, remoteStream=null;
let currentCallId=null, callTimerInterval=null;
let isMuted=false;
let incomingCallData=null;
let unsubIncomingCalls=null, unsubCallDoc=null, unsubCallerCandidates=null, unsubCalleeCandidates=null;
/* ICE servers used to find a path between the two phones.
   STUN alone only works when both sides can be reached directly — on mobile
   data (carrier-grade NAT) that often fails and the call rings but never
   connects. TURN relays the audio in that case, which is why the free public
   relay below is included as a fallback. For anything beyond testing, swap in
   your own TURN credentials (metered.ca, Twilio, or self-hosted coturn) —
   replace AURORA_TURN_URLS / AURORA_TURN_USER / AURORA_TURN_PASS. */
const AURORA_TURN_URLS = ['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443'];
const AURORA_TURN_USER = 'openrelayproject';
const AURORA_TURN_PASS = 'openrelayproject';
const AURORA_ICE_SERVERS = [
  {urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},
  ...AURORA_TURN_URLS.map(urls=>({urls, username:AURORA_TURN_USER, credential:AURORA_TURN_PASS}))
];
const rtcConfig={iceServers:AURORA_ICE_SERVERS, iceCandidatePoolSize:2};

/* Show what the connection is actually doing, so a failed call says why
   instead of just sitting there in silence. */
function watchCallConnection(connection){
  const label=(text)=>{ const el=document.querySelector('#activeCallSub'); if(el) el.textContent=text; };
  try{
    connection.addEventListener('iceconnectionstatechange',()=>{
      const st=connection.iceConnectionState;
      if(st==='checking') label('Connecting…');
      else if(st==='connected'||st==='completed') label('Voice • Connected');
      else if(st==='disconnected') label('Reconnecting…');
      else if(st==='failed') label('Connection failed — check network / TURN');
      else if(st==='closed') label('Call ended');
    });
    connection.addEventListener('connectionstatechange',()=>{
      if(connection.connectionState==='failed') label('Connection failed — check network / TURN');
    });
  }catch(e){}
}

function getOtherUserFromRoom(){
  if(!currentRoomId || !currentUserData) return null;
  const c=contacts.find(x=>x.id===currentRoomId);
  return c?.otherUsername||c?.username||c?.name;
}

async function startVoiceCall(){
  if(!currentRoomId){alert('Age ekta chat open koro');return;}
  if(!isCloud||!db){alert('Voice calls need the cloud connection (open in Chrome)');return;}
  const other=getOtherUserFromRoom();
  if(!other||other===currentUserData.username){alert('Valid user select koro');return;}
  try{const s=await navigator.mediaDevices.getUserMedia({audio:true}); s.getTracks().forEach(t=>t.stop());}catch(e){alert('Mic permission daw: '+e.message);return;}
  const callId=[currentUserData.username, other].sort().join('_')+'_call_'+Date.now();
  currentCallId=callId;
  const otherContact=contacts.find(c=>c.id===currentRoomId);
  $('#outgoingCallName').textContent=otherContact? (otherContact.nickname||otherContact.name) : other;
  const av=$('#outgoingCallAvatar'); if(otherContact){av.innerHTML=avHTML(otherContact); av.style.background=avBg(otherContact,otherContact.color); av.style.overflow='hidden'; av.style.display='flex';}
  $('#outgoingCallModal').classList.add('show');
  { const ws=$('#outgoingCallStatus'); if(ws) ws.textContent='Ringing • Voice'; }
  try{
    pc=new RTCPeerConnection(rtcConfig);
    watchCallConnection(pc);
    localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    remoteStream=new MediaStream();
    $('#remoteAudio').srcObject=remoteStream;
    pc.ontrack=e=>{e.streams[0].getTracks().forEach(tr=>remoteStream.addTrack(tr));};
    pc.onicecandidate=async ev=>{if(ev.candidate&&db){try{const {collection,addDoc}=AURORA_SB; await addDoc(collection(db,'voice_calls',callId,'callerCandidates'), ev.candidate.toJSON());}catch{}}};
    const offer=await pc.createOffer({offerToReceiveAudio:true});
    await pc.setLocalDescription(offer);
    const {doc,setDoc,serverTimestamp}=AURORA_SB;
    await setDoc(doc(db,'voice_calls',callId),{caller:currentUserData.username,callerUid:currentUser.uid,callerNickname:currentUserData.nickname||currentUserData.username,callee:other,offer:{type:offer.type,sdp:offer.sdp},status:'ringing',createdAt:serverTimestamp(),roomId:currentRoomId});
    const {onSnapshot}=AURORA_SB;
    const {collection,query}=AURORA_SB;
    let callerJoined=false;
    unsubCallDoc=onSnapshot(doc(db,'voice_calls',callId),async snap=>{
      const data=snap.data(); if(!data) return;
      if(data.answer && pc && !pc.currentRemoteDescription){
        try{await pc.setRemoteDescription(new RTCSessionDescription(data.answer));}
        catch(e){ console.log('Could not apply the answer', e.message); }
      }
      /* Accepted (or an answer arrived) → switch the caller to the live screen
         straight away; waiting for the status field alone could leave the caller
         ringing if a network hiccup dropped that one update. */
      if(!callerJoined && (data.status==='accepted' || (data.answer && pc && pc.currentRemoteDescription))){
        callerJoined=true;
        enterActiveCallUI(otherContact, other);
      }
      if(data.status==='rejected'){endVoiceCallUI('Declined');}
      if(data.status==='ended'){endVoiceCallUI('Ended');}
    });
    const {onSnapshot: onSnap2}=AURORA_SB;
    unsubCalleeCandidates=onSnap2(query(collection(db,'voice_calls',callId,'calleeCandidates')),(snap)=>{
      snap.docChanges().forEach(ch=>{if(ch.type==='added'){try{pc.addIceCandidate(new RTCIceCandidate(ch.doc.data()));}catch{}}});
    });
    setTimeout(()=>{if($('#outgoingCallModal').classList.contains('show')){endVoiceCallUI('No answer'); updateCallStatus(callId,'ended');}},45000);
    /* Callee-side ring timeout too, so a missed call never leaves a stuck modal. */
    setTimeout(()=>{if($('#activeCallModal').classList.contains('show') && pc && pc.connectionState!=='connected'){endVoiceCallUI('No answer'); updateCallStatus(callId,'ended');}},60000);
  }catch(e){alert('Call error: '+e.message); endVoiceCallUI('Failed');}
}

async function acceptVoiceCall(){
  try{stopRingtone();}catch{}
  if(!incomingCallData) return;
  const callId=incomingCallData.id;
  currentCallId=callId;
  $('#incomingCallModal').classList.remove('show');
  try{
    const nm=$('#activeCallName'); if(nm) nm.textContent=incomingCallData.callerNickname||incomingCallData.caller;
    const av=$('#activeCallAvatar'); if(av) av.textContent=(incomingCallData.callerNickname||incomingCallData.caller).slice(0,2).toUpperCase();
    const sub=$('#activeCallSub'); if(sub) sub.textContent='Voice • Connecting…';
  }catch(e){}
  $('#activeCallModal').classList.add('show');
  startCallTimer();
  try{
    pc=new RTCPeerConnection(rtcConfig);
    watchCallConnection(pc);
    localStream=await navigator.mediaDevices.getUserMedia({audio:true});
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    remoteStream=new MediaStream();
    $('#remoteAudio').srcObject=remoteStream;
    pc.ontrack=e=>{e.streams[0].getTracks().forEach(tr=>remoteStream.addTrack(tr));};
    pc.onicecandidate=async ev=>{if(ev.candidate&&db){try{const {collection,addDoc}=AURORA_SB; await addDoc(collection(db,'voice_calls',callId,'calleeCandidates'), ev.candidate.toJSON());}catch{}}};
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const {doc,updateDoc,collection,query,onSnapshot}=AURORA_SB;
    await updateDoc(doc(db,'voice_calls',callId),{answer:{type:answer.type,sdp:answer.sdp},status:'accepted'});
    unsubCallerCandidates=onSnapshot(query(collection(db,'voice_calls',callId,'callerCandidates')),(snap)=>{
      snap.docChanges().forEach(ch=>{if(ch.type==='added'){try{pc.addIceCandidate(new RTCIceCandidate(ch.doc.data()));}catch{}}});
    });
    unsubCallDoc=onSnapshot(doc(db,'voice_calls',callId),(snap)=>{const d=snap.data(); if(d&&d.status==='ended') endVoiceCallUI('Ended by other');});
  }catch(e){alert('Accept error: '+e.message); endVoiceCallUI('Failed');}
}

async function rejectVoiceCall(){
  try{stopRingtone();}catch{}
  if(!incomingCallData) return;
  try{const {doc,updateDoc}=AURORA_SB; await updateDoc(doc(db,'voice_calls',incomingCallData.id),{status:'rejected'});}catch{}
  $('#incomingCallModal').classList.remove('show'); incomingCallData=null;
}

async function endVoiceCall(){
  if(currentCallId){await updateCallStatus(currentCallId,'ended');}
  endVoiceCallUI('Ended');
}

function endVoiceCallUI(reason){
  try{stopRingtone();}catch{}
  try{
    if(pc){pc.getSenders().forEach(s=>{try{s.track.stop();}catch{}}); pc.close();}
    if(localStream) localStream.getTracks().forEach(t=>t.stop());
    if(remoteStream) remoteStream.getTracks().forEach(t=>t.stop());
  }catch{}
  pc=null; localStream=null; remoteStream=null;
  try{if(unsubCallDoc) unsubCallDoc();}catch{}
  try{if(unsubCallerCandidates) unsubCallerCandidates();}catch{}
  try{if(unsubCalleeCandidates) unsubCalleeCandidates();}catch{}
  unsubCallDoc=null; unsubCallerCandidates=null; unsubCalleeCandidates=null;
  $('#outgoingCallModal').classList.remove('show');
  $('#incomingCallModal').classList.remove('show');
  $('#activeCallModal').classList.remove('show');
  if(callTimerInterval){clearInterval(callTimerInterval); callTimerInterval=null;}
  currentCallId=null; incomingCallData=null; isMuted=false;
  const muteBtn=$('#muteBtn'); if(muteBtn) muteBtn.textContent='🎙️';
}

async function updateCallStatus(callId,status){
  if(!db) return;
  try{const {doc,updateDoc}=AURORA_SB; await updateDoc(doc(db,'voice_calls',callId),{status});}catch{}
}

/* Move the CALLER from "Ringing…" to the live call screen as soon as the other
   side accepts. Without this the caller stayed on the ringing modal forever. */
function enterActiveCallUI(contact, fallbackName){
  try{
    $('#outgoingCallModal').classList.remove('show');
    const nameEl=$('#activeCallName');
    if(nameEl) nameEl.textContent=(contact&&(contact.nickname||contact.name))||fallbackName||'Connected';
    const avEl=$('#activeCallAvatar');
    if(avEl){
      if(contact){ avEl.innerHTML=avHTML(contact); avEl.style.background=avBg(contact,contact.color); avEl.style.overflow='hidden'; avEl.style.display='flex'; }
      else { avEl.textContent=String(fallbackName||'?').slice(0,2).toUpperCase(); }
    }
    const sub=$('#activeCallSub');
    if(sub) sub.textContent='Voice • Connecting…';
    $('#activeCallModal').classList.add('show');
    startCallTimer();
    /* iOS/Safari refuse to autoplay audio that no tap unlocked: nudge it. */
    try{ const a=$('#remoteAudio'); if(a&&a.play) a.play().catch(()=>{}); }catch(e){}
  }catch(e){}
}

function startCallTimer(){
  let start=Date.now();
  const timerEl=$('#activeCallTimer');
  if(callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval=setInterval(()=>{
    const diff=Math.floor((Date.now()-start)/1000);
    const m=Math.floor(diff/60).toString().padStart(2,'0');
    const s=(diff%60).toString().padStart(2,'0');
    if(timerEl) timerEl.textContent=`${m}:${s}`;
  },1000);
}

function toggleMute(){
  if(!localStream) return;
  isMuted=!isMuted;
  localStream.getAudioTracks().forEach(t=>t.enabled=!isMuted);
  const btn=$('#muteBtn'); if(btn){btn.textContent=isMuted?'🔇':'🎙️'; btn.style.background=isMuted?'#ef4444':'rgba(255,255,255,.1)';}
}
function toggleSpeaker(){
  const remoteAudio=$('#remoteAudio');
  if(!remoteAudio) return;
  const btn=$('#speakerBtn');
  if(btn){btn.textContent='🔊';}
}

async function initIncomingCallListener(){
  if(!db || !currentUserData) return;
  try{
    const {collection,query,where,onSnapshot}=AURORA_SB;
    const q=query(collection(db,'voice_calls'), where('callee','==',currentUserData.username), where('status','==','ringing'));
    if(unsubIncomingCalls) unsubIncomingCalls();
    unsubIncomingCalls=onSnapshot(q,(snap)=>{
      snap.docChanges().forEach(change=>{
        if(change.type==='added'){
          const data=change.doc.data();
          const callId=change.doc.id;
          if(data.caller===currentUserData.username) return;
          const createdAt=data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
          const ageSec=(Date.now()-createdAt.getTime())/1000;
          if(ageSec>60) return;
          incomingCallData={id:callId, ...data};
          $('#incomingCallName').textContent=data.callerNickname||data.caller;
          const avEl=$('#incomingCallAvatar');
          avEl.textContent=(data.callerNickname||data.caller).slice(0,2).toUpperCase();
          $('#incomingCallModal').classList.add('show');
          try{startRingtone();}catch{}
        }
        if(change.type==='modified'){
          const data=change.doc.data();
          const callId=change.doc.id;
          if(data.caller===currentUserData.username && data.status==='accepted' && currentCallId===callId){
            $('#outgoingCallModal').classList.remove('show');
            $('#activeCallName').textContent=data.callee;
            $('#activeCallAvatar').textContent=data.callee.slice(0,2).toUpperCase();
            $('#activeCallModal').classList.add('show');
            startCallTimer();
          }
        }
      });
    });
  }catch(e){}
}

window.startVoiceCall=startVoiceCall;
window.acceptVoiceCall=acceptVoiceCall;
window.rejectVoiceCall=rejectVoiceCall;
window.endVoiceCall=endVoiceCall;
window.toggleMute=toggleMute;
window.toggleSpeaker=toggleSpeaker;

$('#voiceCallBtn')?.addEventListener('click', startVoiceCall);
setTimeout(()=>{const vb=$('#voiceCallBtn'); if(vb && !vb._callAttached){vb.addEventListener('click', startVoiceCall); vb._callAttached=true;}},500);

async function initCloudRealtime(){
  if(!db||!currentUser||!currentUserData) return;
  const sessionVersion=++roomsRealtimeVersion,account=currentUserData.username,accountUid=currentUser.uid;
  const sessionIsCurrent=()=>sessionVersion===roomsRealtimeVersion && currentUserData?.username===account && currentUser?.uid===accountUid;
  try{
    const {collection,query,where,onSnapshot}=AURORA_SB;
    if(!sessionIsCurrent()) return;
    const q=query(collection(db,'rooms'), where('participantUsernames','array-contains',account));
    if(unsubRooms) unsubRooms();
    let primed=false,renderRevision=0;
    unsubRooms=onSnapshot(q,async (snap)=>{
      if(!sessionIsCurrent()) return;
      const initialSnapshot=!primed,revision=++renderRevision;primed=true;
      // This account-level observer stays attached on Chats, Settings, and
      // every other app screen. Message IDs also distinguish repeated previews.
      try{
        snap.docChanges().forEach(ch=>{
          const rid=ch.doc.id;
          if(ch.type==='removed'){delete prevRoomSig[rid];delete roomMeta[rid];return;}
          const d=ch.doc.data(),previous=roomMeta[rid],sig=notificationRoomSignature(d);
          const changed=prevRoomSig[rid]!==sig;
          prevRoomSig[rid]=sig;roomMeta[rid]=d;
          if(initialSnapshot){
            rememberNotificationMessage(rid,d.lastMessageId);
          }else if(changed){
            notifyRoomSummary(rid,d,previous,sessionVersion).catch(e=>console.log('Notification routing failed',e.message));
            const reading=isConversationVisible(rid);
            cloudMarkDelivered(rid,sig);
            try{cloudUpgradeRoomMessages(rid,reading?'seen':'delivered');}catch(e){}
            if(reading){try{cloudMarkSeen(rid);}catch(e){}}
          }
          if(ch.type==='modified'){
            const other=(d.participantUsernames||[]).find(u=>u!==account)||d.otherUsername||'';
            const readSig=ms(d['lastSeenAt_'+other])+'|'+ms(d['lastDeliveredAt_'+other]);
            if(prevReadSig[rid]!==readSig){
              prevReadSig[rid]=readSig;
              if(isConversationVisible(rid)) renderMessagesForRoom(rid,false);
            }
          }
        });
      }catch(e){console.log('notify check err',e);}
      const promises=snap.docs.map(async d=>{
        const data=d.data();
        roomMeta[d.id]=data;
        const otherU=data.participantUsernames?.find(u=>u!==currentUserData.username)||data.otherUsername||'User';
        const otherNick=data.participantNicknames?.find((_,i)=>data.participantUsernames[i]!==currentUserData.username)||otherU;
        let otherData=getUsers()[otherU]||{avatar:(otherNick||otherU).slice(0,2).toUpperCase(),color:colors[(otherNick||otherU).length%colors.length]};
        // Try to get avatarUrl from the room's participantAvatars field, else the users table
        let avatarUrl = data.participantAvatars?.[otherU] || data['avatars_'+otherU] || null;
        if(!avatarUrl){
          try{
            const {doc,getDoc}=AURORA_SB;
            // Try to find user doc by username via usernames collection to get uid, then get user doc
            const unameDoc=await getDoc(doc(db,'usernames',otherU));
            if(unameDoc.exists()){
              const uid=unameDoc.data().uid;
              const userDoc=await getDoc(doc(db,'users',uid));
              if(userDoc.exists()){
                const ud=userDoc.data()||{};
                if(ud.avatarUrl) avatarUrl=ud.avatarUrl;
                else if(ud.avatar && String(ud.avatar).startsWith('data:')) avatarUrl=ud.avatar;
                if(ud.verified===true || ud.isVerified===true || ud.developer===true || ud.isDeveloper===true){
                  try{
                    markVerifiedLocal(otherU, ud.nickname||otherData.nickname, {developer: ud.developer===true||ud.isDeveloper===true||ud.role==='developer', role:ud.role});
                    otherData.verified = ud.verified===true||ud.isVerified===true||otherData.verified;
                    otherData.developer = ud.developer===true||ud.isDeveloper===true||ud.role==='developer';
                  }catch(e){}
                }
                // ALWAYS merge profile pic + public fields into local cache + otherData
                try{
                  const users=getUsers();
                  const prev=users[otherU]||{username:otherU};
                  const pic = avatarUrl || ud.avatarUrl || (ud.avatar&&String(ud.avatar).startsWith('data:')?ud.avatar:null) || prev.avatarUrl || null;
                  users[otherU]={
                    ...prev,
                    username:otherU,
                    nickname:ud.nickname||prev.nickname||otherU,
                    color:ud.color||prev.color||otherData.color,
                    bio:ud.bio||prev.bio||'',
                    title:ud.title||prev.title||'',
                    phone:ud.phone||prev.phone||'',
                    email:(ud.email && !String(ud.email).endsWith('@aurora-chat.app'))?ud.email:(prev.email||''),
                    avatarUrl: pic,
                    avatar: pic || prev.avatar || otherU.slice(0,2).toUpperCase(),
                    verified: ud.verified===true||ud.isVerified===true||prev.verified===true||otherU==='khalid_01',
                    developer: ud.developer===true||ud.isDeveloper===true||ud.role==='developer'||prev.developer===true||otherU==='khalid_01',
                    isDeveloper: ud.developer===true||ud.isDeveloper===true||ud.role==='developer'||prev.isDeveloper===true||otherU==='khalid_01',
                    role: ud.role||prev.role||''
                  };
                  saveUsers(users);
                  otherData={...otherData, ...users[otherU]};
                  if(pic){ otherData.avatarUrl=pic; otherData.avatar=pic; }
                }catch(e){ console.log('cache other profile fail', e.message); }
              }
            }
          }catch{}
        }
        // If avatarUrl is data URL, use it for avatar
        if(avatarUrl && typeof avatarUrl==='string' && avatarUrl.startsWith('data:')){
          otherData.avatarUrl=avatarUrl;
          otherData.avatar=`<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
          // For contact list, store avatarUrl separately
        }
        const displayNick=otherData.nickname||otherNick||otherU;
        return {id:d.id,name:displayNick,username:otherU,nickname:displayNick,displayName:displayNick,avatar:otherData.avatar,color:data.color||otherData.color,avatarUrl:avatarUrl||otherData.avatarUrl||null,last:data.lastMessage||'',time:data.lastTime||'',lastActiveMs:convAnyToMs(data.lastMessageAt)||convAnyToMs(data.lastTs),createdAtMs:convAnyToMs(data.createdAt),otherUsername:otherU,otherNickname:displayNick,bio:otherData.bio||'',title:otherData.title||'',phone:otherData.phone||'',email:otherData.email||'',verified:otherData.verified===true||otherData.isVerified===true||otherU==='khalid_01',plan:otherData.plan||otherData.subscription||'',cloud:true};
      });
      const results=await Promise.all(promises);
      if(!sessionIsCurrent() || revision!==renderRevision) return;
      noteCloudSnapshot(results);
      contacts=healConversations(results);
      window.__auroraCloudRowCount=(results||[]).length;
      renderChats();
      try{
        const names=(contacts||[]).map(c=>c.otherUsername||c.username).filter(Boolean);
        prefetchUserProfiles(names);
      }catch(e){}
    },(err)=>{try{rcptFail('ROOMS LISTEN ERR: '+err.message);}catch(e){}});
  }catch(e){}
}

/* ====== 🔔 Notification button + local mode + startup ====== */
$('#notifBtn')?.addEventListener('click', async ()=>{
  if(!notificationsEnabled){
    notificationsEnabled=true;
    try{localStorage.setItem('aurora_notif_enabled','1');}catch{}
    // Browser permission cai (user gesture tai kaj korbe)
    if('Notification' in window && Notification.permission==='default'){
      try{await Notification.requestPermission();}catch(e){}
    }
    updateNotifBell();
    if('Notification' in window && Notification.permission==='granted'){
      showToast({title:'Aurora 🔔',body:'Notifications ON! New message ashle alert paben.',color:'#7c3aed',avatar:'A'});
    }else if('Notification' in window && Notification.permission==='denied'){
      showToast({title:'Notification blocked ⚠️',body:'Browser settings → Site settings → Notifications → Allow korun. Tohle app er bhitore toast e dekhabe.',color:'#f59e0b',avatar:'!'});
    }else{
      showToast({title:'Aurora 🔔',body:'Notifications ON (in-app) ✅',color:'#7c3aed',avatar:'A'});
    }
  }else{
    notificationsEnabled=false;
    stopNotifSound();
    try{localStorage.setItem('aurora_notif_enabled','0');}catch{}
    updateNotifBell();
    showToast({title:'Aurora 🔕',body:'Notifications OFF (unread count thakbe)',color:'#64748b',avatar:'-'});
  }
});

// Local tab-to-tab arrivals use the same foreground routing as cloud mode.
window.addEventListener('storage',(e)=>{
  if(e.key!=='chatbd_global_rooms'||!currentUserData || currentUserData.cloud===true) return;
  try{
    const rooms=getGlobalRooms();let deliveredChanged=false;
    let previousRooms=null;try{previousRooms=e.oldValue?JSON.parse(e.oldValue):null;}catch(e){}
    Object.values(rooms).forEach(room=>{
      const participants=room.participants||room.participantUsernames||[];
      if(!participants.includes(currentUserData.username)) return;
      const previousSignature=prevRoomSig[room.id],sig=notificationRoomSignature(room),changed=previousSignature!==sig;
      prevRoomSig[room.id]=sig;
      const last=(room.messages||[]).at(-1);
      let previousIdentity='',previousTime=0;
      try{[previousIdentity,previousTime]=JSON.parse(previousSignature||'[]');}catch(e){}
      const existing=(previousRooms?.[room.id]?.messages||[]).some(m=>m.id===last?.id);
      const newIdentity=last && (!last.id || String(last.id)!==previousIdentity);
      const notOlder=!previousTime || !notificationTime(last?.timestamp) || notificationTime(last.timestamp)>=previousTime;
      if(changed && newIdentity && !existing && notOlder && last && !last.system && last.sender!==currentUserData.username){
        const opts=messageNotificationOptions(room.id,last,room);
        if(notifyIncomingMessage(opts)!==false) bumpUnread(room.id);
        room['lastDeliveredAt_'+currentUserData.username]=Date.now();deliveredChanged=true;
      }
      if(isConversationVisible(room.id)) renderMessagesForRoom(room.id,false);
    });
    if(deliveredChanged) saveGlobalRooms(rooms);
    refreshContactsFromLocal(); if(!(contacts&&contacts.length)) contacts=loadUserContacts(currentUserData.username)||contacts||[];renderChats();
  }catch(err){console.log('Local notification routing failed',err.message);}
});

// Startup init
updateNotifBell();
updateDocTitle();
try{rcptLog('boot: user='+(currentUserData?currentUserData.username:'none')+' cloud='+isCloud);}catch(e){}
setTimeout(()=>{try{rcptLog('after sdk: cloud='+isCloud+' roomsListener='+(!!unsubRooms));}catch(e){}},3000);
// 🐞 Receipt debug panel - file ta ?debug=1 diye open korle niche log dekhay
try{
  if(location.search.indexOf('debug')>-1){
    const dbg=document.createElement('div');
    dbg.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:#0f172a;color:#4ade80;font-size:9px;padding:8px;border-radius:8px;max-width:300px;max-height:170px;overflow:auto;font-family:monospace;white-space:pre-wrap;line-height:1.4;border:1px solid #334155;';
    document.body.appendChild(dbg);
    setInterval(()=>{try{dbg.textContent='RECEIPT DEBUG 🐞\n'+(JSON.parse(localStorage.getItem('aurora_rcpt_log')||'[]').slice(-12).join('\n')||'no events yet - 1ta message pathan');}catch(e){}},1500);
  }
}catch(e){}
// Local mode hole age theke room signature set kore rakhi (false alarm bondho)
try{
  if(!isCloud && currentUserData){
    const rooms=getGlobalRooms();
    Object.values(rooms).forEach(r=>{
      prevRoomSig[r.id]=notificationRoomSignature(r);
      rememberNotificationMessage(r.id,(r.messages||[]).at(-1)?.id);
    });
  }
}catch{}

renderChats();
