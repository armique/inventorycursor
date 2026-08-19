import { HUB_BROWSER_DUMP_KIND } from './hubBrowserDump';

const BOOKMARKLET_SOURCE = `(()=>{
  const run=async()=>{
    if(!/ebay\\./i.test(location.hostname)){
      alert('Open Seller Hub on ebay.de while logged in, then click this bookmark again.');
      location.href='https://www.ebay.de/sh/ord/?filter=status%3AALL_ORDERS%2Ctimerange%3ACURRENTYEAR';
      return;
    }
    const origin=location.origin;
    const listUrl=origin+'/sh/ord/?filter=status%3AALL_ORDERS%2Ctimerange%3ACURRENTYEAR&limit=50';
    const idRe=/\\b(\\d{2}-\\d{5}-\\d{5})\\b/g;
    const ids=new Set();
    const add=(s)=>{let m; while((m=idRe.exec(String(s||'')))) ids.add(m[1]);};
    add(document.body&&document.body.innerText||'');
    try{ add(await (await fetch(listUrl,{credentials:'include'})).text()); }catch(e){}
    const list=[...ids].slice(0,35);
    if(!list.length){
      alert('No Hub order IDs found. Stay logged in on Seller Hub → All orders (this year).');
      return;
    }
    const pages=[];
    for(const id of list){
      try{
        const html=await (await fetch(origin+'/sh/ord/details?orderid='+encodeURIComponent(id),{credentials:'include'})).text();
        const doc=new DOMParser().parseFromString(html,'text/html');
        const text=((doc.body&&doc.body.innerText)||'').replace(/[ \\t]+\\n/g,'\\n').trim();
        pages.push({orderId:id,text:text.slice(0,60000)});
      }catch(e){ pages.push({orderId:id,text:''}); }
    }
    const dump={kind:${JSON.stringify(HUB_BROWSER_DUMP_KIND)},version:1,fetchedAt:new Date().toISOString(),pages};
    try{ await navigator.clipboard.writeText(JSON.stringify(dump)); }catch(e){}
    try{
      const w=window.open('http://127.0.0.1:5173/panel/ebay-store-pull','deinHubIngest');
      setTimeout(function(){ try{ w&&w.postMessage({type:'DEINVENTORY_HUB_BROWSER_DUMP',dump:dump},'*'); }catch(e){} },1800);
    }catch(e){}
    alert('Copied '+pages.length+' Hub order(s). Inventory Pro should merge them if it is open; otherwise use Paste Hub dump.');
  };
  run().catch((e)=>alert(e&&e.message||String(e)));
})()`;

export function hubFetchBookmarkletHref(): string {
  return `javascript:${encodeURIComponent(BOOKMARKLET_SOURCE)}`;
}

export function hubFetchBookmarkletSource(): string {
  return BOOKMARKLET_SOURCE;
}
