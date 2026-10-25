/** A display hint only. Authentication is always verified by the server. */
export const isAndroidApp=typeof navigator!=='undefined'&&/\bEFLUZAndroid\/\d/.test(navigator.userAgent);
export async function androidLogout(){
 const response=await fetch('/api/auth/android/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!response.ok)throw new Error('Chiqishni yakunlab bo‘lmadi. Internetni tekshirib qayta urinib ko‘ring.');
 try{sessionStorage.removeItem('efootball_session_token');sessionStorage.removeItem('efootball_tg_init_data');}catch{}
 location.reload();
}
