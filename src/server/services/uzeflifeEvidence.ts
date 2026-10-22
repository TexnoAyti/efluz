import {uError} from './uzeflifeService';

/** Accept only bounded JPEG screenshots, then decode/re-encode to remove metadata. */
export async function normalizeUEvidence(value:unknown):Promise<string|null>{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>400000||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw uError('Skrinshot formati noto‘g‘ri. JPG rasm tanlang.');
 const bytes=Buffer.from(value,'base64');
 if(bytes.toString('base64')!==value||bytes.length<100||bytes[0]!==255||bytes[1]!==216)throw uError('JPG skrinshot yuboring.');
 let width=0,height=0;
 for(let i=2;i+9<bytes.length;){
  if(bytes[i++]!==255)throw uError('JPG skrinshot buzilgan.');
  const marker=bytes[i++];if(marker===0xd9||marker===0xda)break;if(marker===0xff){i--;continue;}
  const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)throw uError('JPG skrinshot buzilgan.');
  if([0xc0,0xc1,0xc2].includes(marker)){height=bytes.readUInt16BE(i+3);width=bytes.readUInt16BE(i+5);break;}i+=size;
 }
 if(!width||!height||width>2048||height>2048||width*height>3000000)throw uError('Skrinshot o‘lchami juda katta.');
 try{
  const {createCanvas,loadImage}=await import('@napi-rs/canvas');const image=await loadImage(bytes);
  if(image.width!==width||image.height!==height)throw Error();
  const canvas=createCanvas(width,height);canvas.getContext('2d').drawImage(image,0,0);const jpeg=canvas.toBuffer('image/jpeg',75);
  if(jpeg.length>300000)throw Error();return jpeg.toString('base64');
 }catch{throw uError('Skrinshotni o‘qib bo‘lmadi. Boshqa JPG rasm tanlang.');}
}
