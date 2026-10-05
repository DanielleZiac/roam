import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getPublishedPhoto } from "../models/reviews.server";

/*
 * Serves one review photo to the storefront, at /apps/roam/photos/<id>.
 * Only photos on approved reviews are served. The type comes from the file's
 * own contents, checked when it was uploaded, and browsers are told not to
 * guess a different one.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const shop = new URL(request.url).searchParams.get("shop");
  const id = Number(params.id);
  if (!shop || !Number.isInteger(id) || id < 1) return new Response("Not found", { status: 404 });

  const photo = await getPublishedPhoto(shop, id);
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(photo.data, "base64"), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
