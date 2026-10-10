import type {Rational} from './types.ts';
const abs=(n:bigint)=>n<0n?-n:n;
function check(a:Rational):void {
 if(!a||typeof a.numerator!=='bigint'||typeof a.denominator!=='bigint'||a.denominator<=0n||a.numerator.toString().length>4096||a.denominator.toString().length>4096)throw Error('invalid_rational');
}
export function rational(numerator:bigint,denominator=1n):Rational {
 const a={numerator,denominator};check(a);let x=abs(numerator),y=denominator;
 while(y){const t=x%y;x=y;y=t;}
 return {numerator:numerator/(x||1n),denominator:denominator/(x||1n)};
}
export function decimalToRational(text:string):Rational {
 if(typeof text!=='string'||text.length>256||! /^-?\d+(?:\.\d+)?$/.test(text))throw Error('invalid_amount');
 const scale=text.split('.')[1]?.length??0;
 return rational(BigInt(text.replace('.','')),10n**BigInt(scale));
}
export function addRational(a:Rational,b:Rational):Rational {check(a);check(b);return rational(a.numerator*b.denominator+b.numerator*a.denominator,a.denominator*b.denominator);}
export function multiplyRational(a:Rational,b:Rational):Rational {check(a);check(b);return rational(a.numerator*b.numerator,a.denominator*b.denominator);}
export function compareRational(a:Rational,b:Rational):-1|0|1 {check(a);check(b);const x=a.numerator*b.denominator,y=b.numerator*a.denominator;return x===y?0:x<y?-1:1;}
export function subtractRational(a:Rational,b:Rational):Rational {check(b);return addRational(a,{numerator:-b.numerator,denominator:b.denominator});}
export function divideRational(a:Rational,b:Rational):Rational {check(a);check(b);if(b.numerator===0n)throw Error('invalid_divisor');const sign=b.numerator<0n?-1n:1n;return rational(a.numerator*b.denominator*sign,a.denominator*b.numerator*sign);}
export function ceilToQuantum(a:Rational,q:Rational):Rational {
 check(a);check(q);if(q.numerator<=0n||a.numerator<0n)throw Error('invalid_quantum');
 const ratio=divideRational(a,q);return multiplyRational(rational((ratio.numerator+ratio.denominator-1n)/ratio.denominator),q);
}
export function formatRational(a:Rational,decimals:number,mode:'floor'|'ceil'|'half_up'):string {
 check(a);if(!Number.isInteger(decimals)||decimals<0||decimals>256||!['floor','ceil','half_up'].includes(mode))throw Error('invalid_rounding');
 const n=a.numerator*10n**BigInt(decimals),d=a.denominator;let value=n/d;const remainder=n%d;
 if(mode==='floor'&&remainder<0n)value--;
 if(mode==='ceil'&&remainder>0n)value++;
 if(mode==='half_up'&&abs(remainder)*2n>=d)value+=n<0n?-1n:1n;
 const sign=value<0n?'-':'';const digits=abs(value).toString().padStart(decimals+1,'0');
 const text=decimals?`${digits.slice(0,-decimals)}.${digits.slice(-decimals)}`:digits;
 return sign+text.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}
export const ZERO=rational(0n);
export const minRational=(a:Rational,b:Rational)=>compareRational(a,b)<=0?a:b;
export const maxRational=(a:Rational,b:Rational)=>compareRational(a,b)>=0?a:b;
