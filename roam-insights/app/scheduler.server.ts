import { runAllDueDiscounts } from "./models/discounts.server";

/*
 * Starts and ends timed discounts. Once a minute the server checks whether a
 * discount's start or end has come and changes the prices in Shopify.
 *
 * This only happens while the server is running. A discount whose time comes
 * while it is off is started or ended as soon as it is back.
 */
const CHECK_EVERY_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var discountTimerGlobal: NodeJS.Timeout | undefined;
}

// In development the server reloads on every change. Replacing the timer stops reloads from stacking them up.
clearInterval(global.discountTimerGlobal);
global.discountTimerGlobal = setInterval(() => {
  runAllDueDiscounts().catch((error) => console.error("Timed discounts could not be checked", error));
}, CHECK_EVERY_MS);
global.discountTimerGlobal.unref();
