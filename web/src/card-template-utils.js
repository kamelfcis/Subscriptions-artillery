import defaultTemplate from './card-template.json';

export function getDefaultCardTemplate(){
 return structuredClone(defaultTemplate);
}

export function deepMerge(base,patch){
 if(patch===null||typeof patch!=='object'||Array.isArray(patch))return patch??base;
 const out={...base};
 for(const key of Object.keys(patch)){
  if(patch[key]===undefined)continue;
  const b=base?.[key];
  if(b&&typeof b==='object'&&!Array.isArray(b)&&typeof patch[key]==='object'&&!Array.isArray(patch[key]))
   out[key]=deepMerge(b,patch[key]);
  else out[key]=patch[key];
 }
 return out;
}

export function mergeCardTemplate(saved){
 const patch={...(saved||{})};
 if(patch.backSide===null)delete patch.backSide;
 const merged=deepMerge(getDefaultCardTemplate(),patch);
 // Physical stock has a pre-printed back; duplex stays off unless explicitly re-enabled.
 merged.duplex=Boolean(merged.backSide?.enabled);
 if(merged.overlay==null)merged.overlay=true;
 return merged;
}

export function getAt(obj, path) {
  return path.reduce((a, k) => a?.[k], obj);
}

export function setAt(obj, path, value) {
  const out = structuredClone(obj);
  let cur = out;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const next = path[i + 1];
    if (typeof next === 'number') {
      if (!Array.isArray(cur[k])) cur[k] = [];
      cur = cur[k];
    } else {
      if (cur[k] == null || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k];
    }
  }
  const last = path[path.length - 1];
  if (typeof last === 'number' && Array.isArray(cur)) {
    if (!cur.length && path[path.length - 2] === 'gradient') {
      const fallback =
        path[0] === 'backSide' ? ['#0d2d54', '#124a7a', '#058b8f'] : ['#12386c', '#1262a2', '#06a0a4'];
      cur.push(...fallback);
    }
    cur[last] = value;
    return out;
  }
  cur[last] = value === '' ? null : value;
  return out;
}
