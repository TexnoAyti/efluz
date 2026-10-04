export interface ImageDownloadTelegram {
  downloadFile?: (params:{url:string;file_name:string},callback?:(accepted:boolean)=>void)=>void;
  isVersionAtLeast?: (version:string)=>boolean;
  openLink?: (url:string)=>void;
}
export function startTournamentImageDownload(url:string,filename:string,telegram:ImageDownloadTelegram|undefined,browserDownload:()=>void){
  if(!/^https:\/\//.test(url))throw new Error('HTTPS_DOWNLOAD_REQUIRED');
  if(telegram?.downloadFile&&telegram.isVersionAtLeast?.('8.0')){
    try{telegram.downloadFile({url,file_name:filename});return 'telegram';}catch{/* Older clients can expose unsupported SDK methods. */}
  }
  if(telegram?.openLink){telegram.openLink(url);return 'external';}
  browserDownload();return 'browser';
}
export async function pngBlobBase64(blob:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('PNG_READ_FAILED'));reader.readAsDataURL(blob);});
}
