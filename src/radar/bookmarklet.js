// Bookmark button ("Bookmarklet") for one-click capture of TikTok/Instagram/other profiles.
// It only reads the page the user is looking at and opens a small window on the local
// dashboard (top-level navigation, no request from the foreign page to localhost).

const SOURCE = `(function(){
var o=__ORIGIN__,d=document,u=location.href,h=location.hostname;
function q(s){var e=d.querySelector(s);return e?(e.textContent||'').trim():'';}
function m(p){var e=d.querySelector('meta[property="'+p+'"]')||d.querySelector('meta[name="'+p+'"]');return e?(e.getAttribute('content')||''):'';}
var p={url:u,title:d.title};
if(/(^|\\.)tiktok\\.com$/.test(h)){p.platform='tiktok';p.followers=q('[data-e2e="followers-count"]');p.name=q('[data-e2e="user-subtitle"]')||q('h1')||q('h2');p.bio=q('[data-e2e="user-bio"]');}
else if(/(^|\\.)instagram\\.com$/.test(h)){p.platform='instagram';var ds=m('og:description');var f=ds.match(/^([0-9.,]+\\s?[KkMm]?)\\s+(Followers|Follower|Abonnenten|seguidores|abonn)/i);if(f)p.followers=f[1];p.name=m('og:title').replace(/\\s*\\(@[^)]*\\).*$/,'').replace(/\\s*[•|].*$/,'');p.bio=ds;}
else{p.name=d.title;}
var s=[];for(var k in p){if(p[k])s.push(k+'='+encodeURIComponent(String(p[k]).slice(0,1500)));}
window.open(o+'/capture?'+s.join('&'),'clkcapture','width=480,height=720');
})();`;

/** Ready-to-use "javascript:" bookmark for the given dashboard origin (e.g. http://localhost:3000). */
export function bookmarkletCode(origin) {
  const code = SOURCE.replace('__ORIGIN__', JSON.stringify(String(origin).replace(/\/+$/, '')))
    .split('\n')
    .map((l) => l.trim())
    .join('');
  return `javascript:${code}`;
}
