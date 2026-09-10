/** Local HTTP/file contexts may expose getRandomValues but not SubtleCrypto.
 * UUIDs are record identifiers only. Simulation randomness uses explicit run seeds. */
export function uuid() {
 if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID()
 if(!globalThis.crypto?.getRandomValues)throw new Error("Secure random record-ID generation is unavailable in this browser.")
 const b=globalThis.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128
 const h=Array.from(b,v=>v.toString(16).padStart(2,"0")).join("")
 return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)
}
// SHA-256 (FIPS 180-4), 512-bit blocks, 64-bit big-endian length padding.
// The fallback is checked against Node SHA-256, including Unicode and 50 MB files.
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2])
const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n))
export function sha256Portable(bytes:Uint8Array) {
 const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64)
 const block=(data:Uint8Array)=>{
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength)
  for(let i=0;i<16;i++)w[i]=v.getUint32(i*4,false)
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(b,17)^rotr(b,19)^(b>>>10))}
  let [a,b,c,d,e,f,g,h]=H
  for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
  const state=[a,b,c,d,e,f,g,h];for(let i=0;i<8;i++)H[i]+=state[i]
 }
 const complete=bytes.length-bytes.length%64
 for(let i=0;i<complete;i+=64)block(bytes.subarray(i,i+64))
 const tail=new Uint8Array(bytes.length-complete<56?64:128);tail.set(bytes.subarray(complete));tail[bytes.length-complete]=128
 const view=new DataView(tail.buffer),bits=bytes.length*8;view.setUint32(tail.length-8,Math.floor(bits/4294967296),false);view.setUint32(tail.length-4,bits>>>0,false)
 for(let i=0;i<tail.length;i+=64)block(tail.subarray(i,i+64))
 return Array.from(H,n=>n.toString(16).padStart(8,"0")).join("")
}
