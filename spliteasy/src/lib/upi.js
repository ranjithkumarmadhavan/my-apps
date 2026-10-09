// UPI "pay" deep links. These only open the payment app with details filled in;
// no money moves through SplitEasy, and the payer still confirms in their app.
import { toMajorString } from './money';

export const UPI_APPS = [
  { id: 'gpay', label: 'GPay', android: 'com.google.android.apps.nbu.paisa.user', ios: 'gpay://upi/pay' },
  { id: 'phonepe', label: 'PhonePe', android: 'com.phonepe.app', ios: 'phonepe://pay' },
  { id: 'cred', label: 'CRED', android: 'com.dreamplug.androidapp', ios: 'credpay://upi/pay' },
];

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
export const platform = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'desktop';

function params({ upi, name, amount, note }) {
  const q = new URLSearchParams({ pa: upi, pn: name, am: toMajorString(amount, 'INR'), cu: 'INR', tn: note || 'SplitEasy' });
  return q.toString();
}

/** Generic link any UPI app understands (also what the QR code holds). */
export const upiLink = (p) => `upi://pay?${params(p)}`;

/** Link that opens a specific app on this device. */
export function appLink(app, p) {
  if (platform === 'android') {
    return `intent://pay?${params(p)}#Intent;scheme=upi;package=${app.android};end`;
  }
  return `${app.ios}?${params(p)}`;
}
