export type UChannelDelivery={round:number;channel:string;state:string;sentPages:number;totalPages:number;matchCount:number;error?:string;checkpoint:string|null;canReconcile:boolean;minConfirmed?:number;maxConfirmed?:number;tokenConfigured?:boolean;legacy?:boolean};
const states=new Set(['idle','pending','sending','sent','failed','unverified']);
/** Older receipts may omit totals; the already-loaded fixture list supplies them. */
export function normalizeUChannelDelivery(value:any,round:number,fixtureCount:number):UChannelDelivery {
 if(!value||value.round!==round||value.channel!=='@uzeflife_turner'||!states.has(value.state))throw Error('Yuborish holati noto‘g‘ri qaytdi. Holatni yangilang.');
 const totalPages=value.totalPages??Math.ceil(fixtureCount/8),matchCount=value.matchCount??fixtureCount;
 if(!Number.isInteger(totalPages)||totalPages<1||totalPages>16||!Number.isInteger(matchCount)||matchCount<1||!Number.isInteger(value.sentPages)||value.sentPages<0||value.sentPages>totalPages)throw Error('Yuborish holatini tekshirib bo‘lmadi. Holatni yangilang.');
 return {...value,totalPages,matchCount,maxConfirmed:value.maxConfirmed??totalPages};
}
