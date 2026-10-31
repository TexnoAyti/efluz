/** One failed recipient must not stop later recipients in the same durable job.
 * Failures are retried on the next lease, never repeatedly in the same slice. */
export class NotificationOutboxCursor {
 cursor:number;
 private remaining:number[];
 private failed:number[]=[];
 constructor(private length:number,cursor:unknown,retries:unknown){
  this.cursor=Number.isInteger(cursor)&&Number(cursor)>=0?Math.min(Number(cursor),length):0;
  this.remaining=Array.isArray(retries)?[...new Set(retries.filter((n):n is number=>Number.isInteger(n)&&n>=0&&n<this.cursor))]:[];
 }
 next(){if(this.remaining.length)return this.remaining.shift()!;return this.cursor<this.length?this.cursor++:null;}
 retry(index:number){this.failed.push(index);}
 get retryIndices(){return [...new Set([...this.remaining,...this.failed])];}
 get done(){return this.cursor>=this.length&&!this.remaining.length&&!this.failed.length;}
}
